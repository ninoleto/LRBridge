local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrDevelopController = import "LrDevelopController"
local LrTasks = import "LrTasks"
local LrJson = import "LrJson"
local LrFileUtils = import "LrFileUtils"
local LrPathUtils = import "LrPathUtils"

local ColorGrading = {}

local metadataPath = LrPathUtils.child(_PLUGIN.path, "color-grading.json")
local metadataText = LrFileUtils.readFile(metadataPath)
if metadataText == nil then error("Color Grading metadata unavailable") end
local metadata = LrJson.decode(metadataText)
if type(metadata) ~= "table" or type(metadata.regions) ~= "table" or type(metadata.scalarControls) ~= "table" or type(metadata.views) ~= "table" then
    error("Invalid Color Grading metadata")
end
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
    local photo = prepareDevelop()
    local processVersion = tonumber(photo:getRawMetadata("processVersion"))
    if processVersion == nil or processVersion < 3 then error("Color Grading view requires Process Version 3 or newer") end
    LrDevelopController.setActiveColorGradingView(view)
    return true
end

function ColorGrading.getParameters()
    return regions, controls
end

return ColorGrading
