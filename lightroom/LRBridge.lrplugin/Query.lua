local LrApplication = import "LrApplication"

local Query = {}

local developSettingsMap = {
    Exposure = "Exposure2012",
    Contrast = "Contrast2012",
    Highlights = "Highlights2012",
    Shadows = "Shadows2012",
    Whites = "Whites2012",
    Blacks = "Blacks2012",

    Texture = "Texture",
    Clarity = "Clarity2012",
    Dehaze = "Dehaze",

    Vibrance = "Vibrance",
    Saturation = "Saturation",

    Sharpness = "Sharpness",
    LuminanceNR = "LuminanceSmoothing",
    ColorNR = "ColorNoiseReduction",

    Temperature = "IncrementalTemperature",
    Tint = "IncrementalTint",
}

function Query.getDevelopValue(slider)

    local settingName = developSettingsMap[slider]

    if settingName == nil then
        return nil
    end

    local catalog = LrApplication.activeCatalog()
    local value = nil

    catalog:withReadAccessDo(function()

        local photo = catalog:getTargetPhoto()

        if photo == nil then
            return
        end

        local settings = photo:getDevelopSettings()
        value = settings[settingName]

    end)

    return value

end

return Query


