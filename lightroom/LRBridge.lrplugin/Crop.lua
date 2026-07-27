local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrDevelopController = import "LrDevelopController"
local LrTasks = import "LrTasks"

local Crop = {}
local angleParameter = "straightenAngle"

local function prepareAngle()
    local photo = LrApplication.activeCatalog():getTargetPhoto()

    if photo == nil then
        error("No active photo")
    end

    LrApplicationView.switchToModule("develop")
    LrTasks.sleep(0.2)

    if string.lower(tostring(LrApplicationView.getCurrentModuleName())) ~= "develop" then
        error("Crop Angle requires the Develop module")
    end

    local minimum, maximum = LrDevelopController.getRange(angleParameter)

    if type(minimum) ~= "number" or type(maximum) ~= "number" or minimum > -45 or maximum < 45 then
        error("Crop Angle range is unavailable")
    end
end

function Crop.setAngle(value)
    if type(value) ~= "number" or value ~= value or value < -45 or value > 45 or
        math.abs(value * 100 - math.floor(value * 100 + 0.5)) > 0.000000001 then
        error("Invalid crop angle")
    end

    prepareAngle()
    LrDevelopController.startTracking(angleParameter)
    LrDevelopController.setValue(angleParameter, value)
    return true
end

function Crop.resetAngle()
    prepareAngle()
    LrDevelopController.resetToDefault(angleParameter)
    return true
end

return Crop
