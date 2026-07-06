local LrHttp = import "LrHttp"
local LrTasks = import "LrTasks"

local Query = require "Query"

local function getPortableRoot()

    local pluginPath = _PLUGIN.path or ""
    local root = string.gsub(pluginPath, "[/\\]lightroom[/\\]LRBridge%.lrplugin$", "")

    if root == pluginPath then
        root = pluginPath .. "\\..\\.."
    end

    return root

end

local logPath = getPortableRoot() .. "\\lrplugin-log.txt"

local function log(message)

    local file = io.open(logPath, "a")

    if file ~= nil then
        file:write(os.date("%Y-%m-%d %H:%M:%S") .. " FeedbackPolling: " .. tostring(message) .. "\n")
        file:close()
    end

end

local watchedSliders = {
    "Exposure",
    "Contrast",
    "Highlights",
    "Shadows",
    "Whites",
    "Blacks",
    "Texture",
    "Clarity",
    "Dehaze",
    "Vibrance",
    "Saturation",
    "Sharpness",
    "SharpenRadius",
    "SharpenDetail",
    "SharpenEdgeMasking",
    "LuminanceNR",
    "LuminanceNoiseReductionDetail",
    "LuminanceNoiseReductionContrast",
    "ColorNR",
    "ColorNoiseReductionDetail",
    "ColorNoiseReductionSmoothness",
    "Temperature",
    "Tint",
    "HueAdjustmentRed",
    "HueAdjustmentOrange",
    "HueAdjustmentYellow",
    "HueAdjustmentGreen",
    "HueAdjustmentAqua",
    "HueAdjustmentBlue",
    "HueAdjustmentPurple",
    "HueAdjustmentMagenta",
    "SaturationAdjustmentRed",
    "SaturationAdjustmentOrange",
    "SaturationAdjustmentYellow",
    "SaturationAdjustmentGreen",
    "SaturationAdjustmentAqua",
    "SaturationAdjustmentBlue",
    "SaturationAdjustmentPurple",
    "SaturationAdjustmentMagenta",
    "LuminanceAdjustmentRed",
    "LuminanceAdjustmentOrange",
    "LuminanceAdjustmentYellow",
    "LuminanceAdjustmentGreen",
    "LuminanceAdjustmentAqua",
    "LuminanceAdjustmentBlue",
    "LuminanceAdjustmentPurple",
    "LuminanceAdjustmentMagenta",
    "GrayMixerRed",
    "GrayMixerOrange",
    "GrayMixerYellow",
    "GrayMixerGreen",
    "GrayMixerAqua",
    "GrayMixerBlue",
    "GrayMixerPurple",
    "GrayMixerMagenta",
    "PostCropVignetteAmount",
    "PostCropVignetteMidpoint",
    "PostCropVignetteFeather",
    "PostCropVignetteRoundness",
    "PostCropVignetteHighlightContrast",
    "GrainAmount",
    "GrainSize",
    "GrainFrequency",
    "ShadowTint",
    "RedHue",
    "RedSaturation",
    "GreenHue",
    "GreenSaturation",
    "BlueHue",
    "BlueSaturation",
    "LensProfileDistortionScale",
    "LensProfileVignettingScale",
    "LensManualDistortionAmount",
    "DefringePurpleAmount",
    "DefringePurpleHueLo",
    "DefringePurpleHueHi",
    "DefringeGreenAmount",
    "DefringeGreenHueLo",
    "DefringeGreenHueHi",
    "PerspectiveVertical",
    "PerspectiveHorizontal",
    "PerspectiveRotate",
    "PerspectiveScale",
    "PerspectiveAspect",
    "PerspectiveX",
    "PerspectiveY",
    "ParametricDarks",
    "ParametricLights",
    "ParametricShadows",
    "ParametricHighlights",
    "ParametricShadowSplit",
    "ParametricMidtoneSplit",
    "ParametricHighlightSplit"
}

local lastSentValues = {}

local function parseRequestId(json)

    if json == nil then
        return nil
    end

    local id = string.match(json, [["id"%s*:%s*(%d+)]])

    if id == nil then
        return nil
    end

    return tonumber(id)

end

local function parseSlider(json)

    if json == nil then
        return nil
    end

    return string.match(json, [["slider"%s*:%s*"([^"]+)"]])

end

local function waitForNormalCommandToFinish()

    local safety = 0

    while _G.LRBridgeCommandBusy == true and safety < 100 do
        LrTasks.sleep(0.02)
        safety = safety + 1
    end

    LrTasks.sleep(0.08)

end

local function sendValue(id, slider, value)

    local url =
        "http://127.0.0.1:17891/feedback/result" ..
        "?id=" .. tostring(id) ..
        "&slider=" .. tostring(slider) ..
        "&value=" .. tostring(value)

    LrHttp.get(url)

end

local function sendRequestedValue(id, slider)

    waitForNormalCommandToFinish()

    local value = Query.getDevelopValue(slider)

    if value ~= nil then
        lastSentValues[slider] = tostring(value)
    end

    sendValue(id, slider, value)

    log("feedback result sent: " .. tostring(slider) .. "=" .. tostring(value))

end

local function sendAllRequestedValues(id)

    waitForNormalCommandToFinish()

    local readCount = 0
    local sentCount = 0
    local firstSent = nil

    for i, slider in ipairs(watchedSliders) do

        local value = Query.getDevelopValue(slider)

        if value ~= nil then

            readCount = readCount + 1

            local valueKey = tostring(value)

            if lastSentValues[slider] ~= valueKey then

                lastSentValues[slider] = valueKey
                sendValue(id, slider, value)

                sentCount = sentCount + 1

                if firstSent == nil then
                    firstSent = tostring(slider) .. "=" .. tostring(value)
                end

            end

        end

    end

    log("feedback all read " .. tostring(readCount) .. " values, sent " .. tostring(sentCount) .. " changed, " .. tostring(firstSent))

end

if _G.LRBridgeFeedbackPollingStarted == true then

    log("feedback polling already running")
    return

end

_G.LRBridgeFeedbackPollingStarted = true

LrTasks.startAsyncTask(function()

    log("feedback request polling loop started")

    while _G.LRBridgeFeedbackPollingStarted == true do

        local result = LrHttp.get("http://127.0.0.1:17891/feedback/next")
        local slider = parseSlider(result)

        if slider ~= nil then

            local id = parseRequestId(result)

            if slider == "__all__" then
                log("feedback all request received")
                sendAllRequestedValues(id)
            else
                log("feedback request received: " .. tostring(slider))
                sendRequestedValue(id, slider)
            end

        end

        LrTasks.sleep(0.1)

    end

    log("feedback request polling loop stopped")

end)
