local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrDevelopController = import "LrDevelopController"
local LrTasks = import "LrTasks"

local Crop = {}
local angleParameter = "straightenAngle"

local function validatePhoto(photo)
    if LrApplication.activeCatalog():getTargetPhoto() ~= photo then
        error("Photo changed during Crop Angle command")
    end
    if string.lower(tostring(LrApplicationView.getCurrentModuleName())) ~= "develop" then
        error("Crop Angle requires the Develop module")
    end
end

local function prepareAngle()
    local photo = LrApplication.activeCatalog():getTargetPhoto()

    if photo == nil then
        error("No active photo")
    end

    if string.lower(tostring(LrApplicationView.getCurrentModuleName())) ~= "develop" then
        LrApplicationView.switchToModule("develop")
        LrTasks.sleep(0.2)
    end
    validatePhoto(photo)

    local minimum, maximum = LrDevelopController.getRange(angleParameter)
    validatePhoto(photo)

    if type(minimum) ~= "number" or type(maximum) ~= "number" or minimum > -45 or maximum < 45 then
        error("Crop Angle range is unavailable")
    end
    return photo
end

function Crop.setAngle(value)
    if type(value) ~= "number" or value ~= value or value < -45 or value > 45 or
        math.abs(value * 100 - math.floor(value * 100 + 0.5)) > 0.000000001 then
        error("Invalid crop angle")
    end

    local photo = prepareAngle()
    LrDevelopController.startTracking(angleParameter)
    validatePhoto(photo)
    LrDevelopController.setValue(angleParameter, value)
    return true
end

function Crop.resetAngle()
    local photo = prepareAngle()
    validatePhoto(photo)
    LrDevelopController.resetToDefault(angleParameter)
    return true
end

return Crop
