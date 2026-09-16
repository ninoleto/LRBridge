local scenario = dustButtonScenario
local action = string.find(scenario, "close", 1, true) and "close" or "reset"
local app, view, sdk, tasks = import "LrApplication", import "LrApplicationView", import "LrDevelopController", import "LrTasks"
local originalImport = import
local photo, other, catalog = {}, {}, {}
local selected, module, tool = photo, scenario == "library" and "library" or "develop", "dust"
local settings = { Exposure2012 = 0.7, FilterList = { Filters = {
    { FilterID = 6, Name = "Dust Removal", Title = "$$$/CRaw/Filter/DustRemoval/FilterPanelTitle=Dust Removal", Images = { { X = 0.4 } } }
} } }
local manual, preferences = { { X = 0.5, Y = 0.6 } }, { brushSize = 25, visualizeSpots = false, visualizationThreshold = 64 }
local lines, messages = {}, {}
local sleeps, flushes, ready, closed, inTask, navigation = 0, 0, false, false, false, 0
if scenario == "missing-photo" then selected = nil end
if scenario == "no-dust" or scenario == "close-after-reset" then settings.FilterList = {} end
if scenario == "no-manual" or scenario == "close-after-reset" then manual = {} end
if scenario == "tool-closed" then tool = "loupe" end
local function forbidden() error("Read-only observation invoked a write API") end
photo.pasteSettings, photo.applyDevelopSettings, photo.applyDevelopPreset, photo.updateAISettings, photo.copySettings = forbidden, forbidden, forbidden, forbidden, forbidden
photo.getRawMetadata = function(_, key) assert(inTask and key == "uuid"); return "treated-photo" end
photo.getDevelopSettings = function()
    if scenario == "settings-unavailable" then error("settings failed C:/private/photo.raw") end
    return settings
end
photo.needsUpdateAISettings = function() return scenario == "pending-ai" end
catalog.getTargetPhoto = function() return selected end
catalog.withWriteAccessDo, catalog.setSelectedPhotos = forbidden, forbidden
app.activeCatalog = function() return catalog end
app.versionTable = function() return { major = 15, minor = 4, revision = 1 } end
app.developPresetFolders = forbidden
view.getCurrentModuleName = function() return module end
view.switchToModule = function(target) assert(target == "develop" and selected == photo); navigation = navigation + 1; module = target end
sdk.getSelectedTool = function() return tool end
sdk.getRemovePanelPreferences = function() return preferences end
sdk.getAllSpots = function(feature)
    assert(feature == "manualRemove")
    if scenario == "close-unreadable" and tool == "loupe" then error("manual inventory unavailable") end
    return manual
end
sdk.selectTool, sdk.goToRemove, sdk.resetSpotRemoval, sdk.setRemovePanelPreferences = forbidden, forbidden, forbidden, forbidden
local output = {
    write = function(_, text)
        if scenario == "file-write" then return nil, "write failed C:/private/log" end
        lines[#lines + 1] = text; return true
    end,
    flush = function() if scenario == "file-flush" then return nil, "flush failed" end; flushes = flushes + 1; return true end,
    close = function() closed = true; return scenario ~= "file-close", "close failed" end
}
io.open = function(path, mode)
    assert(mode == "w" and string.find(path, "lrbridge-dust-" .. action .. "-", 1, true))
    if scenario == "file-open" then return nil, "open failed C:/private/log" end
    return output
end
import = function(name)
    if name == "LrFileUtils" then return { chooseUniqueFileName = function(path) return path end } end
    if name == "LrPathUtils" then return { getStandardFilePath = function(which) assert(which == "temp"); return "/temp" end,
        child = function(parent, child) return parent .. "/" .. child end } end
    if name == "LrDialogs" then return { message = function(title, text)
        messages[#messages + 1] = { title = title, text = text }
        assert(not string.find(text, "C:/private", 1, true))
        if string.find(title, "observation ready", 1, true) then
            assert(flushes >= 2 and string.find(table.concat(lines), '"stage":"baseline"', 1, true))
            assert(string.find(text, "There is no countdown", 1, true))
            assert(string.find(text, "Wait for the single-button instruction", 1, true))
            ready = true
            if scenario == "other-menu" then
                (require "DustButtonObservation").run("close")
                assert(messages[#messages].title == "Dust observation already running")
                assert(not _G.LRBridgeDustButtonObservation.finishRequested)
            end
            if scenario == "finish-at-ready" then (require "DustButtonObservation").run(action) end
            if scenario == "competing-diagnostic" then
                dofile("lightroom/LRBridge.lrplugin/TestDustPreset.lua")
                assert(messages[#messages].title == "Dust preset test unavailable")
            end
        end
    end } end
    return originalImport(name)
end
tasks.startAsyncTask = function(fn) inTask = true; fn(); inTask = false end
tasks.sleep = function(seconds)
    if seconds == 0.1 then return end
    assert(seconds == 0.5); sleeps = sleeps + 1
    if sleeps == 1 then
        -- Simulated native USER actions, not calls made by the observer.
        if scenario == "reset-dust-only" or scenario == "reset-all-healing" then settings.FilterList = {} end
        if scenario == "reset-all-healing" then manual = {} end
        if action == "close" then tool = "loupe" end
        if scenario == "photo-change" then selected = other end
        if scenario == "module-change" then module = "library" end
        if scenario == "command-change" then _G.LRBridgeLastCommandFinishedAt = 4 end
    end
    local finishAt = scenario == "long-wait-no-click" and 721 or 3
    if sleeps == finishAt then (require "DustButtonObservation").run(action) end
    assert(sleeps <= finishAt, "Same menu must finish the observer")
end
if scenario == "busy" then _G.LRBridgeCommandBusy = true end
dofile("lightroom/LRBridge.lrplugin/" .. (action == "reset" and "ObserveDustReset.lua" or "ObserveDustClose.lua"))
assert(not _G.LRBridgeDustButtonObservation and not _G.LRBridgeDustCaptureStarted)
assert(navigation == (scenario == "library" and 1 or 0))
if scenario == "long-wait-no-click" then assert(sleeps == 721 and ready, "No two-minute deadline or implied native click") end
local preflightFailure = { ["missing-photo"] = true, ["no-dust"] = true, ["no-manual"] = true, ["tool-closed"] = true,
    ["pending-ai"] = true, ["settings-unavailable"] = true, ["file-open"] = true, ["file-write"] = true, ["file-flush"] = true, busy = true }
assert(ready ~= not not preflightFailure[scenario], "Ready only after a valid saved baseline: " .. scenario)
if #lines > 0 then assert(closed) end
function takeResultUrl() return table.concat(lines) end
