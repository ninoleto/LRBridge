local LrApplicationView = import "LrApplicationView"
local LrDevelopController = import "LrDevelopController"
local LrHttp = import "LrHttp"
local LrTasks = import "LrTasks"

local LensBlur = {}

local bokehValues = {
    Circle = true,
    SoapBubble = true,
    Blade = true,
    Ring = true,
    Anamorphic = true
}

local function inDevelop()
    return string.lower(tostring(LrApplicationView.getCurrentModuleName())) == "develop"
end

local function prepareDevelop()
    if not inDevelop() then
        LrApplicationView.switchToModule("develop")
    end
end

local function urlEncode(value)
    return string.gsub(tostring(value), "([^%w%-_%.~])", function(character)
        return string.format("%%%02X", string.byte(character))
    end)
end

function LensBlur.setBokeh(value)
    if bokehValues[value] ~= true then error("Invalid Lens Blur Bokeh value") end
    prepareDevelop()
    LrDevelopController.setLensBlurBokeh(value)
    return true
end

function LensBlur.setActive(enabled)
    if type(enabled) ~= "boolean" then error("Invalid Lens Blur Apply value") end
    prepareDevelop()
    LrDevelopController.setValue("LensBlurActive", enabled)
    return true
end

local function parseFocalRange(value)
    if type(value) ~= "string" or value == "" or string.match(value, "^%s") or string.match(value, "%s$") then return nil end
    local values = {}
    for token in string.gmatch(value, "%S+") do
        if string.match(token, "^%-?%d+$") == nil then return nil end
        local number = tonumber(token)
        if number == nil or math.abs(number) > 1000000 then return nil end
        values[#values + 1] = number
    end
    if #values ~= 4 then return nil end
    if values[1] > values[2] or values[2] > values[3] or values[3] > values[4] then return nil end
    local normalized = string.format("%d %d %d %d", values[1], values[2], values[3], values[4])
    if normalized ~= value then return nil end
    return values
end

function LensBlur.setFocalRange(value)
    if parseFocalRange(value) == nil then error("Invalid Lens Blur Focus Range") end
    prepareDevelop()
    LrDevelopController.setValue("LensBlurFocalRange", value)
    LrTasks.sleep(0.1)
    local settled = LrDevelopController.getValue("LensBlurFocalRange")
    if settled ~= value then error("Lightroom did not accept Lens Blur Focus Range") end
    return true
end

function LensBlur.selectDepthRefinement()
    prepareDevelop()
    LrDevelopController.selectTool("depth_refinement")
    return true
end

function LensBlur.closeDepthRefinement()
    prepareDevelop()
    local before = LrDevelopController.getSelectedTool()
    if before ~= "depth_refinement" then return true end
    LrDevelopController.selectTool("loupe")
    LrTasks.sleep(0.1)
    local settled = LrDevelopController.getSelectedTool()
    if settled ~= "loupe" then error("Lightroom did not close Brush Refinement") end
    return true
end

function LensBlur.sendCurrentState()
    local activeOk, active = pcall(function()
        return LrDevelopController.getValue("LensBlurActive")
    end)
    local activeAvailable = activeOk == true and type(active) == "boolean"
    local authoritativeActive = nil
    if activeAvailable then authoritativeActive = active end

    local bokehOk, bokeh = pcall(function()
        return LrDevelopController.getSelectedLensBlurBokeh()
    end)
    local bokehAvailable = bokehOk == true and bokehValues[bokeh] == true

    local toolOk, selectedTool = pcall(function()
        return LrDevelopController.getSelectedTool()
    end)
    local selectedToolAvailable = toolOk == true and type(selectedTool) == "string" and selectedTool ~= ""

    local focalRangeOk, focalRange = pcall(function()
        return LrDevelopController.getValue("LensBlurFocalRange")
    end)
    local focalRangeAvailable = focalRangeOk == true and parseFocalRange(focalRange) ~= nil

    local url = "http://127.0.0.1:17891/lens-blur/result" ..
        "?activeAvailable=" .. tostring(activeAvailable) ..
        "&bokehAvailable=" .. tostring(bokehAvailable) ..
        "&selectedToolAvailable=" .. tostring(selectedToolAvailable) ..
        "&focalRangeAvailable=" .. tostring(focalRangeAvailable)
    if activeAvailable then
        url = url .. "&active=" .. tostring(active)
    end
    if bokehAvailable then
        url = url .. "&bokeh=" .. urlEncode(bokeh)
    end
    if selectedToolAvailable then
        url = url .. "&selectedTool=" .. urlEncode(selectedTool)
    end
    if focalRangeAvailable then
        url = url .. "&focalRange=" .. urlEncode(focalRange)
    end
    LrHttp.get(url)

    return {
        activeAvailable = activeAvailable,
        active = authoritativeActive,
        bokehAvailable = bokehAvailable,
        bokeh = bokehAvailable and bokeh or nil,
        selectedToolAvailable = selectedToolAvailable,
        selectedTool = selectedToolAvailable and selectedTool or nil,
        focalRangeAvailable = focalRangeAvailable,
        focalRange = focalRangeAvailable and focalRange or nil
    }
end

return LensBlur
