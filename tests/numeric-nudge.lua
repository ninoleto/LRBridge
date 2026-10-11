-- Execute production Parser, Commands, Driver, Query and NumericNudge against a
-- deterministic SDK. These tests do not establish native Lightroom timing.
package.path = pluginRoot .. "/?.lua;" .. package.path
local originalToString = tostring
tostring = function(v) if type(v) == "number" then return string.format("%.14g", v) end return originalToString(v) end
sdkValue, sdkMin, sdkMax, sdkDefault = 2, -5, 5, 0.37
writes, increments, resets, tracking, stopped, reads, sleeps = 0, 0, 0, 0, 0, 0, 0
scenario, moduleName, photoUuid, profileName, processVersion = "ordinary", "develop", "nudge-photo", "creative", "15.0"
claimBody, validateBody, resultBody = '{"valid":true}', '{"valid":true,"developCounter":1}', '{"ok":true}'
resultUrl, lastWrite = nil, nil
local photo, otherPhoto, catalog = {}, {}, {}
local selected = photo
catalog.getTargetPhoto = function() return selected end
photo.getRawMetadata = function() return photoUuid end
otherPhoto.getRawMetadata = function() return "other-photo" end
photo.getDevelopSettings = function()
    local settings = { ProcessVersion = processVersion, Look = { Name = profileName, UUID = "profile-id", SupportsAmount = true } }
    if scenario == "unsupported-profile" then settings.Look.SupportsAmount = false end
    if scenario == "unknown-profile-support" then settings.Look.SupportsAmount = nil end
    if scenario == "camera-profile" then settings.Look = nil; settings.CameraProfile = "Adobe Color" end
    if scenario == "adaptive-false" then settings.AILook = { Active = true, SupportsAmount = false } end
    if scenario == "adaptive-string-false" then settings.AILook = { Active = true, SupportsAmount = "false" } end
    return settings
end
local sdk = {
    revealPanel = function() end,
    startTracking = function()
        tracking = tracking + 1
        if scenario == "photo-tracking" then selected = otherPhoto end
        if scenario == "profile-tracking" then profileName = "changed" end
        if scenario == "range-tracking" then sdkMin, sdkMax = 0, 1 end
    end,
    stopTracking = function() stopped = stopped + 1 end,
    increment = function()
        increments = increments + 1
        if scenario == "legacy-adjust" then sdkValue = sdkValue + 0.01; return end
        error("Numeric nudge must never increment")
    end,
    decrement = function() increments = increments + 1; error("Numeric nudge must never decrement") end,
    getValue = function(parameter)
        reads = reads + 1
        if parameter == "ParametricMidtoneSplit" and neighborValue then return neighborValue end
        if scenario == "read-unavailable" or scenario == "readback-unavailable" and writes > 0 then return nil end
        if scenario == "read-error" then error("SDK read failed") end
        if scenario == "photo-read" then selected = otherPhoto end
        return sdkValue
    end,
    getRange = function() if scenario ~= "range-unavailable" then return sdkMin, sdkMax end end,
    resetToDefault = function()
        resets = resets + 1
        -- Non-default fixture deliberately defeats guessed zero/default baselines.
        sdkValue = sdkDefault
    end,
    setValue = function(_, value)
        writes, lastWrite = writes + 1, value
        if scenario == "write-error" then error("SDK write failed") end
        if scenario ~= "write-no-effect" then sdkValue = value end
        if scenario == "photo-write" then selected = otherPhoto end
    end
}
local http = { get = function(url)
    if respond and string.find(url, "/next", 1, true) then
        local body = respond(url)
        if body == '{"command":null}' then workerActive = false end
        return body
    end
    if respond and string.find(url, "/nudge/claim?", 1, true) then return respond(url) end
    if string.find(url, "/nudge/claim?", 1, true) then return claimBody end
    if string.find(url, "/nudge/validate?", 1, true) then
        if scenario == "photo-validate" then selected = otherPhoto end
        if scenario == "shutdown-validate" then _G.LRBridgePollingLifecycle = { stopping = true } end
        return respond and respond(url) or validateBody
    end
    if string.find(url, "/nudge/operation-result?", 1, true) then
        resultUrl = url
        if respond then assert(_G.LRBridgeCommandBusy, "Completion must occur inside the serial worker"); return respond(url) end
        return resultBody
    end
    if respond then return respond(url) end
    error("Unexpected HTTP request")
end }
local imports = {
    LrApplication = { activeCatalog = function() return catalog end },
    LrApplicationView = { getCurrentModuleName = function() return moduleName end, switchToModule = function() end },
    LrTasks = { pcall = pcall, sleep = function()
        sleeps = sleeps + 1
        if scenario == "photo-preparation" then selected = otherPhoto end
        if scenario == "module-preparation" then moduleName = "library" end
        if scenario == "profile-preparation" then profileName = "changed" end
        if scenario == "process-preparation" then processVersion = "other" end
        if scenario == "baseline-preparation" then sdkValue = 1.23 end
    end },
    LrDevelopController = sdk, LrHttp = http
}
import = function(name) return assert(imports[name], name) end
for _, name in ipairs({ "Selection", "Application", "Photo", "Crop", "ColorGrading", "Enhance", "PointColor", "History",
    "LensBlur", "DevelopCategorical", "ToneCurve", "Profile", "DevelopPresets", "Masking", "Remove", "Reflections", "People", "RedEye", "Export", "SettingsClipboard" }) do
    package.loaded[name] = {}
end
package.loaded.Settings = { load = function() return { pollInterval = 0.1 } end }
package.loaded.PollingTrace = { new = function() return { mark = function() end, call = function(_, fn, ...) return fn(...) end } end }
_PLUGIN = { path = "/mock/lightroom/LRBridge.lrplugin" }
io.open = function() return nil end
function runWorker()
    workerActive = true
    dofile(pluginRoot .. "/AutoStartPolling.lua")(function() return workerActive end)
end
function executeJson() require("Commands").execute(require("Parser").parse(commandJson)) end
function reloadNudge() package.loaded.NumericNudge = nil; package.loaded.Commands = nil end
function result() return resultUrl end
