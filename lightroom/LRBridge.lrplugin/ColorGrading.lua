local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrDevelopController = import "LrDevelopController"
local LrTasks = import "LrTasks"
local LrFileUtils = import "LrFileUtils"
local LrPathUtils = import "LrPathUtils"

local ColorGrading = {}

local regionNames = { "shadows", "midtones", "highlights", "global" }
local scalarSpecs = {
    { "shadow_luminance", "shadows" }, { "midtone_luminance", "midtones" },
    { "highlight_luminance", "highlights" }, { "global_luminance", "global" },
    { "blending", nil }, { "balance", nil }
}
local expectedViews = { "3-way", "shadow", "midtone", "highlight", "global" }

local function trim(value)
    return string.match(value, "^%s*(.-)%s*$")
end

local function parseMetadata(text)
    if type(text) ~= "string" then error("Invalid Color Grading metadata text") end
    local allowed = { runtimeRangeRequired = true, feedbackSupported = true, resetSupported = true }
    for _, region in ipairs(regionNames) do
        for _, field in ipairs({ "label", "hue", "saturation", "luminance" }) do allowed["region." .. region .. "." .. field] = true end
    end
    for _, spec in ipairs(scalarSpecs) do
        allowed["scalar." .. spec[1] .. ".label"] = true
        allowed["scalar." .. spec[1] .. ".parameter"] = true
        if spec[2] ~= nil then allowed["scalar." .. spec[1] .. ".region"] = true end
    end
    for index = 1, #expectedViews do allowed["view." .. tostring(index)] = true end

    local values = {}
    local lineNumber = 0
    for source in string.gmatch(text .. "\n", "([^\n]*)\n") do
        lineNumber = lineNumber + 1
        local line = trim(string.gsub(source, "\r$", ""))
        if line ~= "" and string.sub(line, 1, 1) ~= "#" then
            local separator = string.find(line, "=", 1, true)
            if separator == nil or separator == 1 or string.find(line, "=", separator + 1, true) ~= nil then error("Malformed Color Grading metadata line " .. tostring(lineNumber)) end
            local key = trim(string.sub(line, 1, separator - 1))
            local value = trim(string.sub(line, separator + 1))
            if key == "" or value == "" or string.match(key, "^[%w_.%-]+$") == nil then error("Malformed Color Grading metadata line " .. tostring(lineNumber)) end
            if allowed[key] ~= true then error("Unknown Color Grading metadata key: " .. key) end
            if values[key] ~= nil then error("Duplicate Color Grading metadata key: " .. key) end
            values[key] = value
        end
    end
    for key, _ in pairs(allowed) do if values[key] == nil then error("Missing Color Grading metadata key: " .. key) end end

    local metadata = { regions = {}, scalarControls = {}, views = {} }
    local identifiers = {}
    local identifierCount = 0
    local function addIdentifier(parameter)
        if string.match(parameter, "^[A-Za-z][A-Za-z0-9]*$") == nil or identifiers[parameter] == true then error("Invalid or duplicate Adobe parameter: " .. parameter) end
        identifiers[parameter] = true; identifierCount = identifierCount + 1
    end
    for _, region in ipairs(regionNames) do
        local prefix = "region." .. region .. "."
        local item = { label = values[prefix .. "label"], hue = values[prefix .. "hue"], saturation = values[prefix .. "saturation"], luminance = values[prefix .. "luminance"] }
        addIdentifier(item.hue); addIdentifier(item.saturation); addIdentifier(item.luminance)
        metadata.regions[region] = item
    end
    for _, spec in ipairs(scalarSpecs) do
        local control, region = spec[1], spec[2]
        local prefix = "scalar." .. control .. "."
        local definition = { label = values[prefix .. "label"], parameter = values[prefix .. "parameter"] }
        if string.match(definition.parameter, "^[A-Za-z][A-Za-z0-9]*$") == nil then error("Invalid Adobe parameter: " .. definition.parameter) end
        if region ~= nil then
            if values[prefix .. "region"] ~= region or definition.parameter ~= metadata.regions[region].luminance then error("Invalid regional scalar mapping: " .. control) end
            definition.region = region
        else addIdentifier(definition.parameter) end
        metadata.scalarControls[control] = definition
    end
    if identifierCount ~= 14 then error("Color Grading metadata must contain fourteen unique Adobe parameters") end
    for index, expected in ipairs(expectedViews) do
        local view = values["view." .. tostring(index)]
        if view ~= expected then error("Invalid Color Grading view " .. tostring(index)) end
        metadata.views[index] = view
    end
    for _, field in ipairs({ "runtimeRangeRequired", "feedbackSupported", "resetSupported" }) do
        if values[field] ~= "true" and values[field] ~= "false" then error("Invalid Boolean metadata: " .. field) end
        metadata[field] = values[field] == "true"
    end
    return metadata
end

local metadataPath = LrPathUtils.child(_PLUGIN.path, "color-grading.properties")
local metadataText = LrFileUtils.readFile(metadataPath)
if metadataText == nil then error("Color Grading metadata unavailable") end
local metadata = parseMetadata(metadataText)
local regions = metadata.regions
local controls = {}
for control, definition in pairs(metadata.scalarControls) do
    if type(definition) ~= "table" or type(definition.parameter) ~= "string" then error("Invalid Color Grading control metadata") end
    controls[control] = definition.parameter
end
local views = {}
for _, view in ipairs(metadata.views) do views[view] = true end

local function activePhoto()
    local photo = LrApplication.activeCatalog():getTargetPhoto()
    if photo == nil then error("Color Grading requires an active photo") end
    return photo
end

local function prepareDevelop()
    local photo = activePhoto()
    LrApplicationView.switchToModule("develop")
    LrTasks.sleep(0.2)
    if string.lower(tostring(LrApplicationView.getCurrentModuleName())) ~= "develop" then
        error("Color Grading requires the Develop module")
    end
    return photo
end

local function runtimeRange(parameter)
    local minimum, maximum = LrDevelopController.getRange(parameter)
    if type(minimum) ~= "number" or type(maximum) ~= "number" or minimum ~= minimum or maximum ~= maximum or minimum >= maximum then
        error("Color Grading parameter unavailable: " .. tostring(parameter))
    end
    return minimum, maximum
end

local function validateValue(parameter, value)
    if type(value) ~= "number" or value ~= value or value == math.huge or value == -math.huge then error("Invalid Color Grading value") end
    local minimum, maximum = runtimeRange(parameter)
    if value < minimum or value > maximum then error("Color Grading value outside current Lightroom range") end
end

function ColorGrading.setWheel(region, hue, saturation)
    local mapping = regions[region]
    if mapping == nil then error("Invalid Color Grading region") end
    prepareDevelop()
    validateValue(mapping.hue, hue)
    validateValue(mapping.saturation, saturation)
    LrDevelopController.startTracking(mapping.hue)
    LrDevelopController.startTracking(mapping.saturation)
    LrDevelopController.setValue(mapping.hue, hue)
    LrDevelopController.setValue(mapping.saturation, saturation)
    return true
end

function ColorGrading.setValue(control, value)
    local parameter = controls[control]
    if parameter == nil then error("Invalid Color Grading control") end
    prepareDevelop()
    validateValue(parameter, value)
    LrDevelopController.startTracking(parameter)
    LrDevelopController.setValue(parameter, value)
    return true
end

function ColorGrading.resetValue(control)
    local parameter = controls[control]
    if parameter == nil then error("Invalid Color Grading control") end
    prepareDevelop()
    runtimeRange(parameter)
    LrDevelopController.resetToDefault(parameter)
    return true
end

function ColorGrading.resetRegion(region)
    local mapping = regions[region]
    if mapping == nil then error("Invalid Color Grading region") end
    prepareDevelop()
    runtimeRange(mapping.hue); runtimeRange(mapping.saturation); runtimeRange(mapping.luminance)
    LrDevelopController.resetToDefault(mapping.hue)
    LrDevelopController.resetToDefault(mapping.saturation)
    LrDevelopController.resetToDefault(mapping.luminance)
    return true
end

function ColorGrading.setView(view)
    if views[view] ~= true then error("Invalid Color Grading view") end
    prepareDevelop()
    LrDevelopController.setActiveColorGradingView(view)
    return true
end

function ColorGrading.getParameters()
    return regions, controls
end

return ColorGrading
