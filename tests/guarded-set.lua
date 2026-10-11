package.path = pluginRoot .. "/?.lua;" .. package.path
sdkValue, writes, resets, reads, increments, elapsed = 23, 0, 0, 0, 0, 0
mode, moduleName, process = "ordinary", "develop", "15"
events, urls = {}, {}
local function event(e) events[#events + 1] = e end
local photo, other, catalog = {}, {}, {}
selected = photo
photo.getRawMetadata = function() return "guard-photo" end
photo.getDevelopSettings = function() return { ProcessVersion = process } end
other.getRawMetadata = function() return "other-photo" end
other.getDevelopSettings = photo.getDevelopSettings
catalog.getTargetPhoto = function() return selected end
function navigate() selected = other end
local sdk = {
    revealPanel = function() event("prepare") end,
    startTracking = function() if mode == "tracking-photo" then navigate() end end,
    stopTracking = function() event("stop") end,
    getRange = function() if mode == "range-error" then error("range failed") end; return -100, 100 end,
    getProcessVersion = function() return process end,
    getValue = function()
        reads = reads + 1; event("read:" .. sdkValue)
        if mode == "read-error" then error("read failed") end
        if mode == "read-nil" then return nil end
        if mode == "read-photo" then navigate() end
        if mode == "read-process" then process = "16" end
        return sdkValue
    end,
    setValue = function(_, v)
        writes = writes + 1; event("set:" .. v)
        if mode == "set-error" then error("set failed") end
        sdkValue = v
        if mode == "set-photo" then navigate() end
    end,
    resetToDefault = function() resets = resets + 1; sdkValue = 0; event("reset") end,
    increment = function() increments = increments + 1; sdkValue = math.min(100, sdkValue + 5); event("+5") end,
    decrement = function() increments = increments + 1; sdkValue = math.max(-100, sdkValue - 5); event("-5") end
}
local imports = {
    LrApplication = { activeCatalog = function() return catalog end },
    LrApplicationView = { getCurrentModuleName = function() return moduleName end, switchToModule = function() end },
    LrDevelopController = sdk,
    LrTasks = { pcall = pcall, sleep = function(seconds)
        elapsed = elapsed + seconds * 1000
        if _G.LRBridgeCommandBusy then
            if mode == "prepare-photo" then navigate() end
            if mode == "prepare-manual" then sdkValue = 47 end
            if mode == "prepare-process" then process = "16" end
        end
    end },
    LrHttp = { get = function(url)
        urls[#urls + 1] = url
        if string.find(url, "/set/", 1, true) then elapsed = elapsed + 10 end
        if string.find(url, "/set/validate?", 1, true) and mode == "validate-photo" then navigate() end
        if string.find(url, "/set/operation-result?", 1, true) then event("settle"); assert(_G.LRBridgeCommandBusy) end
        return respond(url)
    end }
}
import = function(name) return assert(imports[name], name) end
for _, name in ipairs({ "Selection", "Application", "Photo", "Crop", "ColorGrading", "Enhance", "PointColor", "History", "LensBlur",
    "DevelopCategorical", "ToneCurve", "Profile", "DevelopPresets", "Masking", "Remove", "Reflections", "People", "RedEye", "Export", "SettingsClipboard" }) do package.loaded[name] = {} end
package.loaded.Settings = { load = function() return { pollInterval = 0.1 } end }
package.loaded.PollingTrace = { new = function() return { mark = function() end, call = function(_, fn, ...) return fn(...) end } end }
_PLUGIN = { path = "/test/lightroom/LRBridge.lrplugin" }
io.open = function() return { write = function(_, message) lastLog = message end, close = function() end } end
_G.LRBridgePollingLifecycle = { stopping = false }
local Parser, Commands = require "Parser", require "Commands"
function execute(json)
    local c = Parser.parse(json)
    assert(c, "actual /next envelope must parse")
    _G.LRBridgeCommandBusy = true
    local ok, err = pcall(Commands.execute, c)
    _G.LRBridgeCommandBusy = false
    if not ok then error(err) end
end
function runWorker()
    require("AutoStartPolling")(function() return hasCommands() end)
end
