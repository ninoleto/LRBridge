local scenario = dustPasteScenario
local app, view, sdk, tasks = import "LrApplication", import "LrApplicationView", import "LrDevelopController", import "LrTasks"
local originalImport = import
local photo, other, catalog = {}, {}, {}
local selected, module = photo, scenario == "library" and "library" or "develop"
local lines, messages, logs = {}, {}, {}
local calls, confirms, sleeps, flushes = 0, 0, 0, 0
local inTask, inGate, closed, prepared = false, false, false, false
local settings = { Exposure2012 = 0.7, CropTop = 0.1, FilterList = { Filters = {
    { FilterID = 3, Name = "Unrelated AI", Payload = string.rep("a", 700) }
} }, MaskGroupBasedCorrections = { { ID = "existing-mask", Amount = 0.2 } } }
local manual = { { CorrectionID = "existing-manual", X = 0.2, Y = 0.6 } }
local preferences = { visualizeSpots = false, visualizationThreshold = 58.6 }
local needsUpdate = scenario == "pending-ai"
local function dustFilter()
    return { FilterID = 6, Name = "Dust Removal", Title = "$$$/CRaw/Filter/DustRemoval/FilterPanelTitle=Dust Removal",
        Images = { { ReferenceImageAreaLeft = 10, ReferenceImageAreaTop = 20, ReferenceImageAreaRight = 30,
            ReferenceImageAreaBottom = 40, GlobalInputDigest = "destination-data", LocalInputDigest = "target-region" } } }
end
if scenario == "existing-dust" then settings.FilterList.Filters[2] = dustFilter() end
if scenario == "large-mask" or scenario == "large-mask-change" then
    settings.MaskGroupBasedCorrections = {}; for i = 1, 900 do settings.MaskGroupBasedCorrections[i] = i end
end
if scenario == "cycle" then settings.MaskGroupBasedCorrections.self = settings.MaskGroupBasedCorrections end
if scenario == "missing-photo" then selected = nil end
local function forbidden() error("Unexpected write, copy, navigation or selection API") end
photo.getRawMetadata = function(_, key) assert(inTask and key == "uuid"); return "destination-photo" end
other.getRawMetadata = function(_, key) assert(inTask and key == "uuid"); return "other-photo" end
photo.getDevelopSettings = function()
    if scenario == "unreadable" then error("settings unavailable https://private.example/token=secret") end
    return settings
end
photo.needsUpdateAISettings = function() return needsUpdate end
photo.pasteSettings = function(self, updateAI)
    assert(self == photo and selected == photo and module == "develop" and inTask and inGate and updateAI == true)
    assert(prepared and calls == 0 and _G.LRBridgeDustPasteAttempted)
    assert(string.find(table.concat(lines), '"stage":"baseline"', 1, true) and flushes >= 5)
    calls = calls + 1
    if scenario ~= "false-return" and scenario ~= "slow-result" then settings.FilterList.Filters[2] = dustFilter() end
    if scenario == "sdk-error" then error("paste failed C:/private/photo.raw") end
    if scenario == "photo-in-call" then selected = other end
    if scenario == "unrelated-change" then settings.Exposure2012 = 1.2 end
    if scenario == "manual-change" then manual[1].X = 0.8 end
    if scenario == "manual-id-change" then manual[1].CorrectionID = "changed" end
    if scenario == "ai-change" then settings.FilterList.Filters[1].Payload = string.rep("b", 700) end
    if scenario == "mask-change" then settings.MaskGroupBasedCorrections[1].Amount = 0.9 end
    if scenario == "large-mask-change" then settings.MaskGroupBasedCorrections[900] = 42 end
    if scenario == "preference-change" then preferences.visualizationThreshold = 75 end
    if scenario == "ai-pending-after" then needsUpdate = true end
    if scenario == "false-return" then return false end
    return true
end
photo.applyDevelopSettings, photo.applyDevelopPreset, photo.updateAISettings, photo.copySettings = forbidden, forbidden, forbidden, forbidden
catalog.getTargetPhoto = function() return selected end
catalog.setSelectedPhotos, catalog.pasteSettings = forbidden, forbidden
catalog.withWriteAccessDo = function(_, name, fn, options)
    assert(inTask and prepared and options.timeout == 5 and options.asynchronous == false)
    if scenario == "gate-timeout" then return "aborted" end
    if scenario == "photo-before-gate" then selected = other end
    if scenario == "module-before-gate" then module = "library" end
    if scenario == "stale-settings" then settings.CropTop = 0.2 end
    if scenario == "stale-manual" then manual[1].Y = 0.7 end
    if scenario == "command-before-gate" then _G.LRBridgeLastCommandFinishedAt = 2 end
    inGate = true; fn(); inGate = false
    return "executed"
end
app.activeCatalog = function() return catalog end
app.versionTable = function() return { major = 15, minor = 4, revision = 1 } end
view.getCurrentModuleName = function() return module end
view.switchToModule = function(target) assert(target == "develop" and scenario == "library"); module = target end
sdk.getSelectedTool = function() return "dust" end
sdk.getAllSpots = function(feature) assert(feature == "manualRemove"); return manual end
sdk.getRemovePanelPreferences = function() return preferences end
sdk.selectTool, sdk.goToRemove, sdk.setRemovePanelPreferences = forbidden, forbidden, forbidden
_PLUGIN = { path = "D:/fixture/lightroom/LRBridge.lrplugin" }
local output = {
    write = function(_, text)
        if scenario == "file-write" or scenario == "file-after-paste" and calls > 0 then return nil, "disk full C:/private/capture" end
        lines[#lines + 1] = text; return true
    end,
    flush = function() if scenario == "file-flush" then return nil, "flush failed" end; flushes = flushes + 1; return true end,
    close = function() closed = true; return true end
}
io.open = function(path, mode)
    if mode == "a" then return { write = function(_, text) logs[#logs + 1] = text; return true end, close = function() return true end } end
    assert(mode == "w" and string.find(path, "lrbridge-dust-paste-", 1, true))
    if scenario == "file-open" then return nil, "file open failed C:/private/capture" end
    return output
end
import = function(name)
    if name == "LrDialogs" then return {
        message = function(title, text) messages[#messages + 1] = { title = title, text = text } end,
        confirm = function(title, text, action, cancel)
            confirms = confirms + 1
            assert(calls == 0 and flushes >= 2 and action == "Prepared - paste once" and cancel == "Cancel test")
            if scenario == "duplicate-running" then
                dofile("lightroom/LRBridge.lrplugin/TestDustPaste.lua")
                dofile("lightroom/LRBridge.lrplugin/CaptureDust.lua")
                assert(not _G.LRBridgeDustCaptureStarted and messages[#messages].title == "Dust capture")
            end
            if scenario == "cancel" then return "cancel" end
            if scenario == "photo-in-confirm" then selected = other end
            prepared = true; return "ok"
        end
    } end
    if name == "LrPathUtils" then return { getStandardFilePath = function(which) assert(which == "temp"); return "/temp" end,
        child = function(parent, child) return parent .. "/" .. child end } end
    if name == "LrFileUtils" then return { chooseUniqueFileName = function(path) return path end } end
    return originalImport(name)
end
tasks.startAsyncTask = function(fn) inTask = true; fn(); inTask = false end
tasks.sleep = function(seconds)
    if seconds == 0.1 then return end
    assert(seconds == 0.5); sleeps = sleeps + 1
    if scenario == "slow-result" and sleeps == 3 then settings.FilterList.Filters[2] = dustFilter() end
    if scenario == "photo-after-call" then selected = other end
    if scenario == "module-after-call" then module = "library" end
    if scenario == "command-after-call" then _G.LRBridgeLastCommandFinishedAt = 3 end
    if scenario == "transient-change" then settings.Exposure2012 = sleeps == 1 and 9 or 0.7 end
end
dofile("lightroom/LRBridge.lrplugin/TestDustPaste.lua")
assert(not _G.LRBridgeDustPasteRunning)
local noDispatch = { ["existing-dust"] = true, ["pending-ai"] = true, ["missing-photo"] = true,
    ["unreadable"] = true, ["cycle"] = true, ["cancel"] = true, ["file-open"] = true, ["file-write"] = true,
    ["file-flush"] = true, ["photo-in-confirm"] = true, ["gate-timeout"] = true, ["photo-before-gate"] = true,
    ["module-before-gate"] = true, ["stale-settings"] = true, ["stale-manual"] = true, ["command-before-gate"] = true }
assert(calls == (noDispatch[scenario] and 0 or 1), "dispatch count: " .. scenario)
if calls == 1 then
    assert(_G.LRBridgeDustPasteAttempted)
    dofile("lightroom/LRBridge.lrplugin/TestDustPaste.lua")
    assert(calls == 1 and messages[#messages].title == "Dust SDK paste already attempted", "Never repeat an attempted paste")
end
if confirms > 0 then assert(closed) end
assert(not string.find(table.concat(logs), "private", 1, true))
function takeResultUrl() return table.concat(lines) end
