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
    SharpenRadius = "SharpenRadius",
    SharpenDetail = "SharpenDetail",
    SharpenEdgeMasking = "SharpenEdgeMasking",
    LuminanceNR = "LuminanceSmoothing",
    LuminanceNoiseReductionDetail = "LuminanceNoiseReductionDetail",
    LuminanceNoiseReductionContrast = "LuminanceNoiseReductionContrast",
    ColorNR = "ColorNoiseReduction",
    ColorNoiseReductionDetail = "ColorNoiseReductionDetail",
    ColorNoiseReductionSmoothness = "ColorNoiseReductionSmoothness",
    Temperature = "Temperature",
    Tint = "Tint",
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
    ParametricHighlightSplit = "ParametricHighlightSplit"
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
