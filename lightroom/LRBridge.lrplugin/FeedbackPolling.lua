local LrHttp = import "LrHttp"
local LrTasks = import "LrTasks"
local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrDate = import "LrDate"
local LrDevelopController = import "LrDevelopController"

local Query = require "Query"
local ColorGrading = require "ColorGrading"
local Enhance = require "Enhance"
local PointColor = require "PointColor"
local History = require "History"
local LensBlur = require "LensBlur"

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
    "CropAngle",
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
    "LensProfileEnable",
    "AutoLateralCA",
    "LensProfileVignettingScale",
    "LensManualDistortionAmount",
    "VignetteAmount",
    "VignetteMidpoint",
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
    "ParametricHighlightSplit",
    "LensBlurAmount",
    "LensBlurCatEye",
    "LensBlurHighlightsBoost"
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

local function sendValue(id, slider, value, minValue, maxValue)

    local url =
        "http://127.0.0.1:17891/feedback/result" ..
        "?id=" .. tostring(id) ..
        "&slider=" .. tostring(slider)

    if value == nil then
        url = url .. "&available=0"
    else
        url = url ..
            "&value=" .. tostring(value) ..
            "&min=" .. tostring(minValue) ..
            "&max=" .. tostring(maxValue)
    end

    LrHttp.get(url)

end

local function readFeedbackValue(slider)
    if slider == "CropConstrainToWarp" then
        local ok, value = LrTasks.pcall(function()
            return LrDevelopController.getValue("CropConstrainToWarp")
        end)
        if ok == true and type(value) == "number" and (value == 0 or value == 1) then
            return value, 0, 1
        end
        return nil, nil, nil
    end
    local value = Query.getDevelopValue(slider)
    local minValue, maxValue = Query.getDevelopRange(slider)
    return value, minValue, maxValue
end

local function sendRequestedValue(id, slider)

    waitForNormalCommandToFinish()

    local value, minValue, maxValue = readFeedbackValue(slider)

    if value ~= nil and minValue ~= nil and maxValue ~= nil then
        lastSentValues[slider] = tostring(value)
    else
        value = nil
    end

    sendValue(id, slider, value, minValue, maxValue)

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

        local value, minValue, maxValue = readFeedbackValue(slider)

        if minValue == nil or maxValue == nil then
            value = nil
        end

        if value ~= nil then
            readCount = readCount + 1
        end

        lastSentValues[slider] = value == nil and "__unavailable__" or tostring(value)
        sendValue(id, slider, value, minValue, maxValue)
        sentCount = sentCount + 1

        if firstSent == nil then
            firstSent = tostring(slider) .. "=" .. tostring(value)
        end

    end

    log("feedback many snapshot read " .. tostring(readCount) .. " values, sent " .. tostring(sentCount) .. " results, " .. tostring(firstSent))

end

local function sendAllRequestedValues(id)

    waitForNormalCommandToFinish()

    local readCount = 0
    local sentCount = 0
    local firstSent = nil

    for i, slider in ipairs(watchedSliders) do

        local value, minValue, maxValue = readFeedbackValue(slider)

        if minValue == nil or maxValue == nil then
            value = nil
        end

        if value ~= nil then
            readCount = readCount + 1
        end

        lastSentValues[slider] = value == nil and "__unavailable__" or tostring(value)
        sendValue(id, slider, value, minValue, maxValue)
        sentCount = sentCount + 1

        if firstSent == nil then
            firstSent = tostring(slider) .. "=" .. tostring(value)
        end

    end

    log("feedback all snapshot read " .. tostring(readCount) .. " values, sent " .. tostring(sentCount) .. " results, " .. tostring(firstSent))

end

local function urlEncode(value)
    return string.gsub(tostring(value), "([^%w%-_%.~])", function(character) return string.format("%%%02X", string.byte(character)) end)
end

local function sendColorGradingParameter(id, parameter)
    local ok, value, minimum, maximum = pcall(function()
        local current = LrDevelopController.getValue(parameter)
        local minValue, maxValue = LrDevelopController.getRange(parameter)
        return current, minValue, maxValue
    end)
    local url = "http://127.0.0.1:17891/color-grading/result?id=" .. tostring(id) .. "&parameter=" .. urlEncode(parameter)
    if ok ~= true or type(value) ~= "number" or type(minimum) ~= "number" or type(maximum) ~= "number" or minimum >= maximum then
        LrHttp.get(url .. "&available=0")
    else
        LrHttp.get(url .. "&value=" .. tostring(value) .. "&min=" .. tostring(minimum) .. "&max=" .. tostring(maximum))
    end
end

local function sendColorGradingSnapshot(id)
    waitForNormalCommandToFinish()
    local regions, controls = ColorGrading.getParameters()
    local parameters = {}
    for _, mapping in pairs(regions) do parameters[mapping.hue] = true; parameters[mapping.saturation] = true; parameters[mapping.luminance] = true end
    for _, parameter in pairs(controls) do parameters[parameter] = true end
    for parameter, _ in pairs(parameters) do sendColorGradingParameter(id, parameter) end
    local ok, view = pcall(function() return LrDevelopController.getActiveColorGradingView() end)
    if ok == true and (view == "3-way" or view == "shadow" or view == "midtone" or view == "highlight" or view == "global") then
        LrHttp.get("http://127.0.0.1:17891/color-grading/view-result?id=" .. tostring(id) .. "&view=" .. urlEncode(view))
    else
        LrHttp.get("http://127.0.0.1:17891/color-grading/view-result?id=" .. tostring(id) .. "&available=0")
    end
    log("Color Grading snapshot sent for request " .. tostring(id))
end

local treatmentWorkerActive = false
local pendingTreatmentRequestIds = {}

local function postUnavailableTreatmentResult(id, reason)
    local url = "http://127.0.0.1:17891/treatment/result?id=" .. tostring(id)
    local postOk = LrTasks.pcall(function() LrHttp.get(url .. "&status=unavailable") end)
    if postOk == true then
        log("treatment result posted: unavailable " .. tostring(reason))
    else
        log("treatment result post failed")
    end
end

local function startTreatmentWorker(id)
    table.insert(pendingTreatmentRequestIds, id)
    if treatmentWorkerActive == true then return end

    treatmentWorkerActive = true
    local taskStarted = pcall(function()
        LrTasks.startAsyncTask(function()
            while #pendingTreatmentRequestIds > 0 do
                local requestId = table.remove(pendingTreatmentRequestIds, 1)
                local treatmentOk = LrTasks.pcall(function()
                    waitForNormalCommandToFinish()
                    local url = "http://127.0.0.1:17891/treatment/result?id=" .. tostring(requestId)
                    local unavailableReason = nil
                    local grayscale = nil
                    local catalog = LrApplication.activeCatalog()
                    local photo = catalog and catalog:getTargetPhoto() or nil
                    if photo == nil then
                        unavailableReason = "no_photo"
                    else
                        local ok, settings = LrTasks.pcall(function() return photo:getDevelopSettings() end)
                        if ok ~= true then
                            unavailableReason = "settings_error"
                        elseif type(settings) ~= "table" then
                            unavailableReason = "settings_not_table"
                        else
                            log("treatment settings read succeeded")
                            if settings.ConvertToGrayscale == true then
                                grayscale = true
                            elseif settings.ConvertToGrayscale == false or settings.ConvertToGrayscale == nil then
                                grayscale = false
                            else
                                unavailableReason = "unexpected_type"
                            end
                        end
                    end
                    if unavailableReason ~= nil then
                        postUnavailableTreatmentResult(requestId, unavailableReason)
                    else
                        local postOk = LrTasks.pcall(function()
                            LrHttp.get(url .. "&status=available&grayscale=" .. tostring(grayscale))
                        end)
                        if postOk == true then
                            log("treatment result posted: available " .. (grayscale and "grayscale" or "color"))
                        else
                            log("treatment result post failed")
                        end
                    end
                end)
                if treatmentOk ~= true then
                    log("treatment snapshot failure: runtime_error")
                    postUnavailableTreatmentResult(requestId, "runtime_error")
                end
            end
            treatmentWorkerActive = false
        end)
    end)

    if taskStarted ~= true then
        treatmentWorkerActive = false
        while #pendingTreatmentRequestIds > 0 do
            postUnavailableTreatmentResult(table.remove(pendingTreatmentRequestIds, 1), "task_start_failed")
        end
    end
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

        if string.find(result or "", [["colorGrading":true]], 1, true) then
            local id = parseRequestId(result)
            sendColorGradingSnapshot(id)
            slider = nil
        end

        if string.find(result or "", [["treatment":true]], 1, true) then
            local id = parseRequestId(result)
            log("treatment request received: id=" .. tostring(id))
            startTreatmentWorker(id)
            slider = nil
        end

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

        local enhanceRequest = LrHttp.get("http://127.0.0.1:17891/enhance/next")
        if string.find(enhanceRequest or "", [["requested":true]], 1, true) then
            Enhance.sendCurrentState()
        end

        local pointColorRequest = LrHttp.get("http://127.0.0.1:17891/point-color/next")
        if string.find(pointColorRequest or "", [["requested":true]], 1, true) then
            PointColor.sendCurrentState()
        end

        local historyRequest = LrHttp.get("http://127.0.0.1:17891/history/next")
        if string.find(historyRequest or "", [["requested":true]], 1, true) then
            History.sendCurrentState()
        end

        local lensBlurRequest = LrHttp.get("http://127.0.0.1:17891/lens-blur/next")
        if string.find(lensBlurRequest or "", [["requested":true]], 1, true) then
            LensBlur.sendCurrentState()
        end

        LrTasks.sleep(0.1)

    end

    log("feedback request polling loop stopped")

end)
