local LrDevelopController = import "LrDevelopController"

local Driver = {}

local sliderMap = {
    Exposure = "Exposure",
    Contrast = "Contrast",
    Highlights = "Highlights",
    Shadows = "Shadows",
    Whites = "Whites",
    Blacks = "Blacks",

    Temperature = "Temperature",
    Tint = "Tint",

    Texture = "Texture",
    Clarity = "Clarity",
    Dehaze = "Dehaze",

    Vibrance = "Vibrance",
    Saturation = "Saturation",

    Sharpness = "Sharpness",
    LuminanceNR = "LuminanceSmoothing",
    ColorNR = "ColorNoiseReduction",
}

local function revealSlider(developSlider)

    LrDevelopController.revealPanel(developSlider)

end

function Driver.adjustSlider(slider, amount)

    local developSlider = sliderMap[slider]

    if developSlider == nil then
        return false
    end

    revealSlider(developSlider)

    if amount > 0 then
        for i = 1, amount do
            LrDevelopController.increment(developSlider)
        end
    elseif amount < 0 then
        for i = 1, -amount do
            LrDevelopController.decrement(developSlider)
        end
    end

    return true

end

function Driver.setSlider(slider, value)

    local developSlider = sliderMap[slider]

    if developSlider == nil then
        return false
    end

    revealSlider(developSlider)

    LrDevelopController.setValue(developSlider, value)

    return true

end

function Driver.resetSlider(slider)

    local developSlider = sliderMap[slider]

    if developSlider == nil then
        return false
    end

    revealSlider(developSlider)

    LrDevelopController.resetToDefault(developSlider)

    return true

end

return Driver