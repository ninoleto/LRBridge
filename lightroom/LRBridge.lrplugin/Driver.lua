local LrApplicationView = import "LrApplicationView"
local LrDevelopController = import "LrDevelopController"
local LrTasks = import "LrTasks"

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
    Vibrance = "Vibrance",
    Saturation = "Saturation",
    Texture = "Texture",
    Clarity = "Clarity",
    Dehaze = "Dehaze",
    Sharpness = "Sharpness",
    SharpenRadius = "SharpenRadius",
    SharpenDetail = "SharpenDetail",
    SharpenEdgeMasking = "SharpenEdgeMasking",
    LuminanceNR = "LuminanceSmoothing",
    LuminanceNoiseReductionDetail = "LuminanceNoiseReductionDetail",
    LuminanceNoiseReductionContrast = "LuminanceNoiseReductionContrast",
    ColorNR = "ColorNoiseReduction",
    ColorNoiseReductionDetail = "ColorNoiseReductionDetail",
    ColorNoiseReductionSmoothness = "ColorNoiseReductionSmoothness",
    HueAdjustmentRed = "HueAdjustmentRed",
    HueAdjustmentOrange = "HueAdjustmentOrange",
    HueAdjustmentYellow = "HueAdjustmentYellow",
    HueAdjustmentGreen = "HueAdjustmentGreen",
    HueAdjustmentAqua = "HueAdjustmentAqua",
    HueAdjustmentBlue = "HueAdjustmentBlue",
    HueAdjustmentPurple = "HueAdjustmentPurple",
    HueAdjustmentMagenta = "HueAdjustmentMagenta",
    SaturationAdjustmentRed = "SaturationAdjustmentRed",
    SaturationAdjustmentOrange = "SaturationAdjustmentOrange",
    SaturationAdjustmentYellow = "SaturationAdjustmentYellow",
    SaturationAdjustmentGreen = "SaturationAdjustmentGreen",
    SaturationAdjustmentAqua = "SaturationAdjustmentAqua",
    SaturationAdjustmentBlue = "SaturationAdjustmentBlue",
    SaturationAdjustmentPurple = "SaturationAdjustmentPurple",
    SaturationAdjustmentMagenta = "SaturationAdjustmentMagenta",
    LuminanceAdjustmentRed = "LuminanceAdjustmentRed",
    LuminanceAdjustmentOrange = "LuminanceAdjustmentOrange",
    LuminanceAdjustmentYellow = "LuminanceAdjustmentYellow",
    LuminanceAdjustmentGreen = "LuminanceAdjustmentGreen",
    LuminanceAdjustmentAqua = "LuminanceAdjustmentAqua",
    LuminanceAdjustmentBlue = "LuminanceAdjustmentBlue",
    LuminanceAdjustmentPurple = "LuminanceAdjustmentPurple",
    LuminanceAdjustmentMagenta = "LuminanceAdjustmentMagenta",
    GrayMixerRed = "GrayMixerRed",
    GrayMixerOrange = "GrayMixerOrange",
    GrayMixerYellow = "GrayMixerYellow",
    GrayMixerGreen = "GrayMixerGreen",
    GrayMixerAqua = "GrayMixerAqua",
    GrayMixerBlue = "GrayMixerBlue",
    GrayMixerPurple = "GrayMixerPurple",
    GrayMixerMagenta = "GrayMixerMagenta",
    PostCropVignetteAmount = "PostCropVignetteAmount",
    PostCropVignetteMidpoint = "PostCropVignetteMidpoint",
    PostCropVignetteFeather = "PostCropVignetteFeather",
    PostCropVignetteRoundness = "PostCropVignetteRoundness",
    PostCropVignetteHighlightContrast = "PostCropVignetteHighlightContrast",
    GrainAmount = "GrainAmount",
    GrainSize = "GrainSize",
    GrainFrequency = "GrainFrequency",
    ShadowTint = "ShadowTint",
    RedHue = "RedHue",
    RedSaturation = "RedSaturation",
    GreenHue = "GreenHue",
    GreenSaturation = "GreenSaturation",
    BlueHue = "BlueHue",
    BlueSaturation = "BlueSaturation",
    LensProfileDistortionScale = "LensProfileDistortionScale",
    LensProfileEnable = "LensProfileEnable",
    AutoLateralCA = "AutoLateralCA",
    LensProfileChromaticAberrationScale = "LensProfileChromaticAberrationScale",
    LensProfileVignettingScale = "LensProfileVignettingScale",
    LensManualDistortionAmount = "LensManualDistortionAmount",
    DefringePurpleAmount = "DefringePurpleAmount",
    DefringePurpleHueLo = "DefringePurpleHueLo",
    DefringePurpleHueHi = "DefringePurpleHueHi",
    DefringeGreenAmount = "DefringeGreenAmount",
    DefringeGreenHueLo = "DefringeGreenHueLo",
    DefringeGreenHueHi = "DefringeGreenHueHi",
    PerspectiveVertical = "PerspectiveVertical",
    PerspectiveHorizontal = "PerspectiveHorizontal",
    PerspectiveRotate = "PerspectiveRotate",
    PerspectiveScale = "PerspectiveScale",
    PerspectiveAspect = "PerspectiveAspect",
    PerspectiveX = "PerspectiveX",
    PerspectiveY = "PerspectiveY",
    ParametricDarks = "ParametricDarks",
    ParametricLights = "ParametricLights",
    ParametricShadows = "ParametricShadows",
    ParametricHighlights = "ParametricHighlights",
    ParametricShadowSplit = "ParametricShadowSplit",
    ParametricMidtoneSplit = "ParametricMidtoneSplit",
    ParametricHighlightSplit = "ParametricHighlightSplit",
}

local function prepareDevelopSlider(developSlider)

    LrApplicationView.switchToModule("develop")
    LrTasks.sleep(0.2)

    LrDevelopController.revealPanel(developSlider)
    LrTasks.sleep(0.05)

end

function Driver.adjustSlider(slider, amount)

    local developSlider = sliderMap[slider]

    if developSlider == nil then
        return false
    end

    prepareDevelopSlider(developSlider)

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

    prepareDevelopSlider(developSlider)

    LrDevelopController.setValue(developSlider, value)

    return true

end

function Driver.resetSlider(slider)

    local developSlider = sliderMap[slider]

    if developSlider == nil then
        return false
    end

    prepareDevelopSlider(developSlider)

    LrDevelopController.resetToDefault(developSlider)

    return true

end

local actionMap = {
    resetCrop = function()
        LrDevelopController.resetCrop()
    end,

    resetTransforms = function()
        LrDevelopController.resetTransforms()
    end,

    setAutoTone = function()
        LrDevelopController.setAutoTone()
    end,

    setAutoWhiteBalance = function()
        LrDevelopController.setAutoWhiteBalance()
    end,

    resetSpotRemoval = function()
        LrDevelopController.resetSpotRemoval()
    end,

    resetRedeye = function()
        LrDevelopController.resetRedeye()
    end,

    selectCropTool = function()
        LrDevelopController.selectTool("crop")
    end,
}

function Driver.runAction(action)

    local run = actionMap[action]

    if run == nil then
        return false
    end

    LrApplicationView.switchToModule("develop")
    LrTasks.sleep(0.2)

    run()

    return true

end

return Driver


