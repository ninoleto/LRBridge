local scenario = dustPresetScenario
local app, view, sdk, tasks = import "LrApplication", import "LrApplicationView", import "LrDevelopController", import "LrTasks"
local originalImport, originalDigest = import, (import "LrMD5").digest
local photo, other, catalog = {}, {}, {}
local selected, module, tool = photo, scenario == "library" and "library" or "develop", "dust"
local lines, messages = {}, {}
local calls, flushes, ready, nativeSleeps, observeSleeps = 0, 0, false, 0, 0
local inTask, inGate, closed, changedPreset = false, false, false, false
local settings = { Exposure2012 = 0.7, CropTop = 0.1, ProcessVersion = "15.4", FilterList = { Filters = {
    { FilterID = 3, Name = "Other AI", Payload = "retained" }
} }, MaskGroupBasedCorrections = { { ID = "mask", Amount = 0.2 } } }
local manual = { { CorrectionID = "manual", X = 0.2, Y = 0.6 } }
local preferences = { brushSize = 37, visualizeSpots = true, visualizationThreshold = 64 }
local needsUpdate = scenario == "pending-ai"
local function dust()
    return { FilterID = 6, Name = "Dust Removal", Title = "$$$/CRaw/Filter/DustRemoval/FilterPanelTitle=Dust Removal",
        Images = { { ReferenceImageAreaLeft = 10, ReferenceImageAreaTop = 20, ReferenceImageAreaRight = 30, ReferenceImageAreaBottom = 40 } } }
end
if scenario == "existing-dust" then settings.FilterList.Filters[2] = dust() end
if scenario == "no-manual" then manual = {} end
if scenario == "process-version" then settings.ProcessVersion = "15.3" end
if scenario == "missing-photo" then selected = nil end
if scenario == "tool-closed" then tool = "loupe" end
local preset = { getName = function() return "LRBridge Dust On" end, getFile = function() return "/fixture/on.xmp" end,
    getUuid = function() return "sdk-preset-uuid" end,
    getSetting = function()
        local f = dust(); f.Images = nil
        local value = { AllowFilters = 1, ProcessVersion = "15.4", Version = "18.4", FilterList = { Filters = { f } } }
        if scenario == "preset-extra-edit" then value.Exposure2012 = 1 end
        return value
    end }
app.activeCatalog = function() return catalog end
app.versionTable = function() return { major = 15, minor = scenario == "version" and 5 or 4, revision = 1 } end
app.developPresetFolders = function() return { { getDevelopPresets = function()
    if scenario == "missing-preset" then return {} end
    return scenario == "duplicate-preset" and { preset, preset } or { preset }
end } } end
photo.getRawMetadata = function(_, key)
    assert(inTask and key == "uuid")
    return scenario == "source-photo" and "B7A5079E-65BC-400B-A41D-91579B06666D" or "destination-photo"
end
photo.getDevelopSettings = function()
    if scenario == "unreadable" then error("settings unavailable C:/private/photo.raw") end
    return settings
end
photo.needsUpdateAISettings = function() return needsUpdate end
local function forbidden() error("Unexpected clipboard, raw settings, reset, tool selection or other write") end
photo.pasteSettings, photo.copySettings, photo.applyDevelopSettings, photo.updateAISettings = forbidden, forbidden, forbidden, forbidden
photo.applyDevelopPreset = function(self, actualPreset, plugin, amount, updateAI)
    assert(self == photo and actualPreset == preset and selected == photo and module == "develop" and inTask and inGate)
    assert(plugin == nil and amount == nil and updateAI == true and calls == 0 and flushes >= 4 and _G.LRBridgeDustPresetAttempted)
    calls = calls + 1
    if scenario ~= "no-change" and scenario ~= "false-return" and scenario ~= "delayed" then settings.FilterList.Filters[2] = dust() end
    if scenario == "sdk-error" then error("preset failed C:/private/photo.raw") end
    if scenario == "photo-in-call" then selected = other end
    if scenario == "edit-change" then settings.Exposure2012 = 1.2 end
    if scenario == "manual-change" then manual[1].X = 0.8 end
    if scenario == "mask-change" then settings.MaskGroupBasedCorrections[1].Amount = 0.8 end
    if scenario == "ai-change" then settings.FilterList.Filters[1].Payload = "changed" end
    if scenario == "preference-change" then preferences.brushSize = 55 end
    if scenario == "ai-pending-after" then needsUpdate = true end
    if scenario == "false-return" then return false end
    if scenario == "void-return" then return end
    return true
end
catalog.getTargetPhoto = function() return selected end
catalog.withWriteAccessDo = function(_, _, fn, options)
    assert(options.asynchronous == false and options.timeout == 5)
    if scenario == "gate-timeout" then return "aborted" end
    if scenario == "gate-photo" then selected = other end
    if scenario == "gate-edit" then settings.Exposure2012 = 0.8 end
    if scenario == "gate-manual" then manual[1].Y = 0.8 end
    if scenario == "gate-preset" then changedPreset = true end
    if scenario == "gate-command" then _G.LRBridgeLastCommandFinishedAt = 5 end
    inGate = true; fn(); inGate = false; return "executed"
end
view.getCurrentModuleName = function() return module end
view.switchToModule = function(target) assert(target == "develop" and scenario == "library"); module = target end
sdk.getSelectedTool = function() return tool end
sdk.getAllSpots = function(feature)
    assert(feature == "manualRemove")
    if scenario == "closed-unreadable" and tool == "loupe" then error("manual inventory unavailable after Close") end
    return manual
end
sdk.getRemovePanelPreferences = function() return preferences end
sdk.selectTool, sdk.goToRemove, sdk.setRemovePanelPreferences, sdk.resetSpotRemoval = forbidden, forbidden, forbidden, forbidden
local output = {
    write = function(_, text)
        if scenario == "file-write" or scenario == "file-after-call" and calls > 0 then return nil, "write failed C:/private/capture" end
        lines[#lines + 1] = text; return true
    end,
    flush = function() if scenario == "file-flush" then return nil, "flush failed" end; flushes = flushes + 1; return true end,
    close = function() closed = true; return true end
}
io.open = function(path, mode)
    assert(mode == "w" and string.find(path, "lrbridge-dust-preset-", 1, true))
    if scenario == "file-open" then return nil, "open failed C:/private/capture" end
    return output
end
(import "LrMD5").digest = function(value)
    if value == "inspected-on" then return "ca1e4c9e0e49724b8fd9167c496026ba" end
    return originalDigest(value)
end
import = function(name)
    if name == "LrFileUtils" then return { chooseUniqueFileName = function(path) return path end,
        readFile = function() return (scenario == "changed-preset" or changedPreset) and "changed" or "inspected-on" end } end
    if name == "LrPathUtils" then return { getStandardFilePath = function(which) assert(which == "temp"); return "/temp" end,
        child = function(parent, child) return parent .. "/" .. child end } end
    if name == "LrDialogs" then return {
        confirm = function(_, _, action, cancel)
            assert(action == "Apply preset once" and cancel == "Cancel test" and flushes >= 2 and calls == 0)
            if scenario == "cancel" then return "cancel" end
            if scenario == "duplicate-running" then
                dofile("lightroom/LRBridge.lrplugin/TestDustPreset.lua")
                assert(messages[#messages].title == "Dust preset test unavailable")
            end
            return "ok"
        end,
        message = function(title, text)
            messages[#messages + 1] = { title = title, text = text }
            assert(not string.find(text, "C:/private", 1, true), "Sanitize SDK/file failures")
            if title == "Dust On readback recorded - native buttons next" then
                assert(calls == 1 and settings.FilterList.Filters[2] and not needsUpdate)
                assert(not ready); ready = true
            end
        end
    } end
    return originalImport(name)
end
tasks.startAsyncTask = function(fn) inTask = true; fn(); inTask = false end
tasks.sleep = function(seconds)
    if seconds == 0.1 then return end
    assert(seconds == 0.5)
    if ready then
        nativeSleeps = nativeSleeps + 1
        if nativeSleeps == 2 and scenario ~= "no-native-actions" then
            -- Simulated USER actions, never production SDK reset/close calls.
            table.remove(settings.FilterList.Filters, 2)
            if scenario == "reset-all-healing" then manual = {} end
        end
        if nativeSleeps == 12 and scenario ~= "no-native-actions" then tool = "loupe" end
    else
        observeSleeps = observeSleeps + 1
        if scenario == "delayed" and observeSleeps == 4 then settings.FilterList.Filters[2] = dust() end
        if scenario == "transient-edit" then settings.Exposure2012 = observeSleeps == 1 and 9 or 0.7 end
        if scenario == "module-after-call" then module = "library" end
    end
end
dofile("lightroom/LRBridge.lrplugin/TestDustPreset.lua")
assert(not _G.LRBridgeDustPasteRunning)
local noCall = { ["existing-dust"] = true, ["pending-ai"] = true, ["no-manual"] = true, ["process-version"] = true,
    ["missing-photo"] = true, ["tool-closed"] = true, ["missing-preset"] = true, ["duplicate-preset"] = true,
    ["version"] = true, ["changed-preset"] = true, ["preset-extra-edit"] = true, ["source-photo"] = true,
    ["unreadable"] = true, ["cancel"] = true, ["file-open"] = true, ["file-write"] = true, ["file-flush"] = true,
    ["gate-timeout"] = true, ["gate-photo"] = true, ["gate-edit"] = true, ["gate-manual"] = true, ["gate-preset"] = true, ["gate-command"] = true }
assert(calls == (noCall[scenario] and 0 or 1), "dispatch count: " .. scenario)
local shouldReady = { success = true, library = true, delayed = true, ["duplicate-running"] = true,
    ["reset-all-healing"] = true, ["closed-unreadable"] = true, ["no-native-actions"] = true, ["void-return"] = true }
assert(ready == not not shouldReady[scenario], "readback readiness: " .. scenario)
if calls > 0 then
    dofile("lightroom/LRBridge.lrplugin/TestDustPreset.lua")
    assert(calls == 1 and messages[#messages].title == "Dust preset already attempted", "No retry after any dispatched outcome")
end
if #lines > 0 then assert(closed) end
function takeResultUrl() return table.concat(lines) end
