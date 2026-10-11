-- Production worker, parser, Driver, Query and ResetCompletion with deterministic
-- cooperative SDK/HTTP doubles. This does not establish native SDK timing.
package.path = pluginRoot .. "/?.lua;" .. package.path
local originalToString = tostring
tostring = function(v) if type(v) == "number" then return string.format("%.14g", v) end return originalToString(v) end
sdkValue, resetValue, writes, resets, reads = 4.2, 0.37, 0, 0, 0
scenario, moduleName, photoUuid, profileName, processVersion = "ordinary", "develop", "reset-photo", "creative", "15.0"
events, resultUrl, feedbackUrl, workerActive = {}, nil, nil, true
local function event(s) events[#events + 1] = s end
local photo, otherPhoto, catalog = {}, {}, {}
local selected = photo
catalog.getTargetPhoto = function() return selected end
photo.getRawMetadata = function()
    if scenario == "metadata-photo" then selected = otherPhoto end
    return photoUuid
end
otherPhoto.getRawMetadata = function() return "other-photo" end
photo.getDevelopSettings = function()
    if scenario == "settings-photo" then selected = otherPhoto end
    local settings = { ProcessVersion = processVersion, Look = { Name = profileName, UUID = "profile-id", SupportsAmount = true } }
    if scenario == "disabled-profile" then settings.Look.SupportsAmount = false end
    if scenario == "camera-profile" then settings.Look = nil; settings.CameraProfile = "Adobe Color" end
    if scenario == "adaptive-disabled" then settings.AILook = { Active = true, SupportsAmount = false } end
    return settings
end
local sdk = {
    revealPanel = function() end,
    startTracking = function() if scenario == "tracking-photo" then selected = otherPhoto end end,
    getValue = function(parameter)
        reads = reads + 1; event("read:" .. parameter .. ":" .. tostring(sdkValue))
        if _G.LRBridgeCommandBusy then assert(lastMutation == "reset", "Reset SDK capture must precede next editing command") end
        if scenario == "read-error" then error("SDK read failure") end
        if scenario == "read-nil" then return nil end
        if scenario == "read-photo" then selected = otherPhoto end
        if scenario == "read-process" then processVersion = "other" end
        if scenario == "read-profile" then profileName = "other" end
        return sdkValue
    end,
    getRange = function() return -100, 50000 end,
    resetToDefault = function(parameter)
        resets = resets + 1; lastMutation = "reset"; event("reset:" .. parameter)
        if scenario == "reset-error" then error("SDK Reset failed") end
        if scenario == "reset-false" then return false end
        sdkValue = resetValues and resetValues[resets] or resetValue
        if scenario == "reset-photo" then selected = otherPhoto end
        if scenario == "reset-process" then processVersion = "other" end
    end,
    setValue = function(parameter, value)
        writes = writes + 1
        if parameter == "ProfileAmount" and value == 100 then
            lastMutation = "reset"; event("reset:" .. parameter)
            if scenario == "reset-error" then error("SDK Amount reset failed") end
            if scenario == "reset-false" then return false end
            -- Deliberately differs from requested 100: result must come from getValue.
            sdkValue = profileSdkValue or 137
        else lastMutation = "set"; sdkValue = value; event("set:" .. tostring(value)) end
    end,
    increment = function() error("Reset must not increment") end,
    decrement = function() error("Reset must not decrement") end
}
local http = { get = function(url)
    if string.find(url, "/next", 1, true) and not string.find(url, "/feedback/", 1, true) then
        local body = respond(url)
        if body == '{"command":null}' then workerActive = false; return body end
        return body
    end
    if string.find(url, "/reset/validate?", 1, true) then
        validates = (validates or 0) + 1
        if scenario == "validate-photo" then selected = otherPhoto end
        if scenario == "publish-photo" and validates >= 2 then selected = otherPhoto end
        if scenario == "shutdown" then _G.LRBridgePollingLifecycle = { stopping = true } end
    end
    if string.find(url, "/reset/operation-result?", 1, true) then
        resultUrl = url; event("publish"); assert(_G.LRBridgeCommandBusy, "Result must be delivered within serial worker")
    end
    return respond(url)
end }
local imports = {
    LrApplication = { activeCatalog = function() return catalog end },
    LrApplicationView = { getCurrentModuleName = function() return moduleName end, switchToModule = function() end },
    LrTasks = { pcall = pcall, sleep = function()
        if not _G.LRBridgeCommandBusy then return end
        if scenario == "preparation-photo" then selected = otherPhoto end
        if scenario == "preparation-module" then moduleName = "library" end
        if scenario == "preparation-process" then processVersion = "other" end
        if scenario == "preparation-profile" then profileName = "other" end
    end }, LrDevelopController = sdk, LrHttp = http
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
_G.LRBridgePollingLifecycle = { stopping = false }
function runWorker()
    workerActive = true
    dofile(pluginRoot .. "/AutoStartPolling.lua")(function() return workerActive end)
end
function executeJson() require("Commands").execute(require("Parser").parse(commandJson)) end
function runFeedback(json)
    -- Execute the actual independent reader while a Reset is queued and the
    -- command worker has not started it: the real busy guard is false.
    assert(_G.LRBridgeCommandBusy ~= true)
    local env = setmetatable({}, { __index = _G })
    env._G = env
    local calls = 0
    local readImports = {
        LrTasks = imports.LrTasks, LrApplication = imports.LrApplication, LrApplicationView = imports.LrApplicationView,
        LrDevelopController = sdk, LrDate = {}, LrFunctionContext = { callWithContext = function(_, fn) return fn({}) end },
        LrHttp = { get = function(url)
            if string.find(url, "/feedback/next", 1, true) then calls = calls + 1; return calls == 1 and json or '{"request":null}' end
            if string.find(url, "/feedback/result?", 1, true) then feedbackUrl = url; event("feedback"); return '{"ok":true}' end
            error("Unexpected feedback HTTP")
        end }
    }
    env.import = function(name) return assert(readImports[name], name) end
    env.require = function(name)
        if name == "Query" then return require("Query") end
        if name == "PollingTrace" then return { new = function() return {
            call = function(_, fn, ...) return fn(...) end,
            mark = function(phase, operation) if phase == "enter" and operation == "sdk.observerSetup" then error("CYCLE_BOUNDARY") end end
        } end } end
        return {}
    end
    local f = assert(load(feedbackSource, "@FeedbackPolling.lua", "t", env))()
    local ok, err = pcall(f, function() return true end, function() error("Unexpected child task") end)
    assert(not ok and string.find(tostring(err), "CYCLE_BOUNDARY", 1, true), tostring(err))
end
