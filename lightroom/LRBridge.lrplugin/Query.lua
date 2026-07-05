local LrDevelopController = import "LrDevelopController"

local Query = {}

local developControllerMap = {
    Exposure = "Exposure",
    Contrast = "Contrast",
    Highlights = "Highlights",
    Shadows = "Shadows",
    Whites = "Whites",
    Blacks = "Blacks",

    Texture = "Texture",
    Clarity = "Clarity",
    Dehaze = "Dehaze",

    Vibrance = "Vibrance",
    Saturation = "Saturation",

    Sharpness = "Sharpness",
    LuminanceNR = "LuminanceSmoothing",
    ColorNR = "ColorNoiseReduction",

    Temperature = "Temperature",
    Tint = "Tint",
}

function Query.getDevelopValue(slider)

    local param = developControllerMap[slider]

    if param == nil then
        return nil
    end

    local ok, value = pcall(function()
        return LrDevelopController.getValue(param)
    end)

    if ok ~= true then
        return nil
    end

    return value

end

return Query
