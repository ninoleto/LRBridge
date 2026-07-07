local LrHttp = import "LrHttp"
local LrTasks = import "LrTasks"
local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrDate = import "LrDate"

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
local lastContextSentAt = 0
local contextIntervalSeconds = 0.75

local function urlEncode(value)

    value = tostring(value or "")
    value = string.gsub(value, "\n", "\r\n")
    value = string.gsub(value, "([^%w%-_%.~])", function(char)
        return string.format("%%%02X", string.byte(char))
    end)

    return value

end

local function hashString(value)

    value = tostring(value or "")
    local hash = 5381

    for i = 1, string.len(value) do
        hash = ((hash * 33) + string.byte(value, i)) % 2147483647
    end

    return tostring(hash)

end

local function getActiveModule()

    local ok, moduleName = pcall(function()
        return LrApplicationView.getCurrentModuleName()
    end)

    if ok == true and moduleName ~= nil then
        return string.lower(tostring(moduleName))
    end

    return "unknown"

end

local function getPhotoKey(photo)

    if photo == nil then
        return ""
    end

    local okUuid, uuid = pcall(function()
        return photo:getRawMetadata("uuid")
    end)

    if okUuid == true and uuid ~= nil and tostring(uuid) ~= "" then
        return tostring(uuid)
    end

    local okPath, path = pcall(function()
        return photo:getRawMetadata("path")
    end)

    if okPath == true and path ~= nil and tostring(path) ~= "" then
        return tostring(path)
    end

    local okDirectPath, directPath = pcall(function()
        return photo.path
    end)

    if okDirectPath == true and directPath ~= nil and tostring(directPath) ~= "" then
        return tostring(directPath)
    end

    return tostring(photo)

end

local function getSelectedPhotoKey()

    local catalog = LrApplication.activeCatalog()

    if catalog == nil then
        return ""
    end

    local okTargetPhoto, targetPhoto = pcall(function()
        return catalog:getTargetPhoto()
    end)

    local targetKey = ""

    if okTargetPhoto == true and targetPhoto ~= nil then
        targetKey = getPhotoKey(targetPhoto)
    end

    if targetKey ~= nil and targetKey ~= "" then
        return targetKey
    end

    local okTargetPhotos, targetPhotos = pcall(function()
        return catalog:getTargetPhotos()
    end)

    if okTargetPhotos == true and targetPhotos ~= nil and #targetPhotos > 0 then
        return getPhotoKey(targetPhotos[1])
    end

    return ""

end

local function getDevelopFingerprint(activeModule)

    if activeModule ~= "develop" then
        return ""
    end

    local parts = {}

    for i, slider in ipairs(watchedSliders) do

        local value = Query.getDevelopValue(slider)

        if value ~= nil then
            table.insert(parts, tostring(slider) .. "=" .. tostring(value))
        end

    end

    if #parts == 0 then
        return ""
    end

    return hashString(table.concat(parts, "|"))

end

local function sendContextHeartbeat()

    if _G.LRBridgeCommandBusy == true then
        return
    end

    local activeModule = getActiveModule()
    local selectedPhotoKey = getSelectedPhotoKey()
    local developFingerprint = getDevelopFingerprint(activeModule)

    local url =
        "http://127.0.0.1:17891/context/update" ..
        "?activeModule=" .. urlEncode(activeModule) ..
        "&selectedPhotoKey=" .. urlEncode(selectedPhotoKey) ..
        "&developFingerprint=" .. urlEncode(developFingerprint)

    LrHttp.get(url)

end

local function maybeSendContextHeartbeat()

    local now = LrDate.currentTime()

    if now - lastContextSentAt < contextIntervalSeconds then
        return
    end

    lastContextSentAt = now

    sendContextHeartbeat()

end

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

local function splitManySliderRequest(slider)

    local sliders = {}
    local prefix = "__many__:"

    if string.sub(slider, 1, string.len(prefix)) ~= prefix then
        return sliders
    end

    local body = string.sub(slider, string.len(prefix) + 1)

    for item in string.gmatch(body, "([^,]+)") do
        table.insert(sliders, item)
    end

    return sliders

end

local function sendManyRequestedValues(id, requestedSliders)

    waitForNormalCommandToFinish()

    local readCount = 0
    local sentCount = 0
    local firstSent = nil

    for i, slider in ipairs(requestedSliders) do

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

    log("feedback many read " .. tostring(readCount) .. " values, sent " .. tostring(sentCount) .. " changed, " .. tostring(firstSent))

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
            elseif string.sub(slider, 1, 9) == "__many__:" then
                local requestedSliders = splitManySliderRequest(slider)
                log("feedback many request received: " .. tostring(#requestedSliders) .. " sliders")
                sendManyRequestedValues(id, requestedSliders)
            else
                log("feedback request received: " .. tostring(slider))
                sendRequestedValue(id, slider)
            end

        end

        maybeSendContextHeartbeat()

        LrTasks.sleep(0.1)

    end

    log("feedback request polling loop stopped")

end)
