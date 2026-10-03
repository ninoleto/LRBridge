os.getenv = nil -- Real Lightroom omits getenv; diagnostics must not abort Dust edits.
dofile("tests/remove-preferences.lua")
local App, SDK, Tasks = import "LrApplication", import "LrDevelopController", import "LrTasks"
local catalog = App.activeCatalog()
local photo = catalog:getTargetPhoto()
local originalImport, originalDigest = import, (import "LrMD5").digest
local enabling, closing = dustDirection == "on", dustDirection == "close"
local function dustFilter()
    return { FilterID = 6, Name = "Dust Removal", Title = "$$$/CRaw/Filter/DustRemoval/FilterPanelTitle=Dust Removal", Images = { { X = 0.2 } } }
end
local offPreset = { getName = function() return "LRBridge Dust Off" end,
    getFile = function() return "/fixture/off.xmp" end,
    getSetting = function() return { AllowFilters = 1, CompatibleVersion = 285212672, Version = "18.4",
        FilterList = { Filters = { { FilterID = 6, IsSignalForDelete = true } } } } end }
local onPreset = { getName = function() return "LRBridge Dust On" end, getFile = function() return "/fixture/on.xmp" end,
    getSetting = function()
        local f = dustFilter(); f.Images = nil
        local value = { AllowFilters = 1, ProcessVersion = "15.4", Version = "18.4", FilterList = { Filters = { f } } }
        if dustScenario == "preset-extra-edit" then value.Exposure2012 = 2 end
        return value
    end }
local nativePreset = enabling and onPreset or offPreset
import = function(name)
    if name == "LrFileUtils" then return { readFile = function(path)
        return (dustScenario == "changed-preset" or dustPresetChanged) and "changed" or path == "/fixture/on.xmp" and "inspected-on" or "inspected-off"
    end } end
    return originalImport(name)
end
(import "LrMD5").digest = function(value)
    if value == "inspected-off" then return dustScenario == "helper-warning-group" and "016630864d1d1677e6cb37fdc5a88dea" or dustScenario == "renamed-group" and "050d98209fce4ca04a671708d5730cf5" or "6222ed7b14ec731f0d114e24d9bea1d4" end
    if value == "inspected-on" then return dustScenario == "helper-warning-group" and "69a611513c55d731c77181a87d3ffe97" or dustScenario == "renamed-group" and "dec42dfb8c93e593e8582c377a25bef8" or "ca1e4c9e0e49724b8fd9167c496026ba" end
    return originalDigest(value)
end
App.activeCatalog = function() return catalog end
App.versionTable = function() return { major = 15, minor = dustScenario == "version" and 5 or 4, revision = 1 } end
App.developPresetFolders = function()
    return { { getDevelopPresets = function()
        if dustScenario == "missing-preset" then return {} end
        if dustScenario == "duplicate-preset" then return { nativePreset, nativePreset } end
        return { offPreset, onPreset }
    end } }
end
dustSettings = { Exposure2012 = 0.7, CropTop = 0.1, ProcessVersion = "15.4", FilterList = { Filters = {
    { FilterID = 3, Name = "Other AI", Payload = "preserved" },
    { FilterID = 6, Name = "Dust Removal", Title = "$$$/CRaw/Filter/DustRemoval/FilterPanelTitle=Dust Removal", Images = { { X = 0.2 } } }
} }, MaskGroupBasedCorrections = { { ID = "existing-mask", Amount = 0.2 } } }
manualPeopleSpots = { { CorrectionID = "manual-original", X = 0.4 } }
if enabling or closing and dustScenario == "no-treatment" then table.remove(dustSettings.FilterList.Filters, 2) end
if dustScenario == "process-version" then dustSettings.ProcessVersion = "15.3" end
if dustScenario == "unknown-state" then dustSettings.FilterList = nil end
if dustScenario == "already-target" then
    if enabling then dustSettings.FilterList.Filters[2] = dustFilter() else table.remove(dustSettings.FilterList.Filters, 2) end
end
photo.getDevelopSettings = function() return dustSettings end
local pendingAI = dustScenario == "pending-ai" or dustScenario == "ai-update-needed" or
    dustScenario == "ai-update-locked" or dustScenario == "ai-update-unavailable"
photo.needsUpdateAISettings = function() return pendingAI end
local editingReady = dustScenario ~= "pending-ai" and dustScenario ~= "ai-update-locked"
photo.isAvailableForEditing = function()
    if dustScenario == "editing-feedback-error" then error("editing feedback failed") end
    if dustScenario == "editing-feedback-unknown" or dustScenario == "ai-update-unavailable" or dustScenario == "ai-update-unavailable-after" then return nil end
    return editingReady
end
if dustScenario == "editing-feedback-missing" then photo.isAvailableForEditing = nil end
dustCalls = 0
local inGate = false
catalog.withWriteAccessDo = function(_, label, fn, options)
    assert(not closing and label == (enabling and "LRBridge Dust On" or "LRBridge Dust Off") and options.asynchronous == false and options.timeout == 2)
    if dustScenario == "gate-timeout" then return "aborted" end
    if dustScenario == "gate-photo" then removeUuid = "other-photo" end
    if dustScenario == "gate-edit" then dustSettings.Exposure2012 = 0.8 end
    if dustScenario == "gate-manual" then manualPeopleSpots[1].X = 0.9 end
    if dustScenario == "gate-mode" then removePreferences.newSpotType = "clone" end
    if dustScenario == "gate-preset" then dustPresetChanged = true end
    inGate = true; fn(); inGate = false
end
local function alterAfter()
    if dustScenario == "other-edit" then dustSettings.Exposure2012 = 1 end
    if dustScenario == "other-ai" then dustSettings.FilterList.Filters[1].Payload = "changed" end
    if dustScenario == "manual" then manualPeopleSpots[1].X = 0.8 end
    if dustScenario == "mask" then dustSettings.MaskGroupBasedCorrections[1].Amount = 0.9 end
    if dustScenario == "preference" then removePreferences.brushSize = 55 end
    if dustScenario == "after-photo" then removeUuid = "other-photo" end
    if dustScenario == "dust-changed" then dustSettings.FilterList.Filters[2].Images[1].X = 0.7 end
    if dustScenario == "closes-healing" then removeTool = "loupe" end
end
photo.applyDevelopPreset = function(_, preset, plugin, amount, updateAI, ...)
    assert(not closing and inGate and preset == nativePreset and plugin == nil and amount == nil and updateAI == enabling and select("#", ...) == 0)
    dustCalls = dustCalls + 1
    if dustScenario == "unknown-state" then return true end -- SDK success alone is not state confirmation.
    if dustScenario == "sdk-error" then error("preset failed C:/private/photo.raw") end
    if dustScenario ~= "no-change" and not string.find(dustScenario, "^no%-dust") and
        not string.find(dustScenario, "editing%-feedback") and dustScenario ~= "delayed" then
        if enabling then dustSettings.FilterList.Filters[2] = dustFilter() else table.remove(dustSettings.FilterList.Filters, 2) end
    end
    if dustScenario == "ai-pending-after" or dustScenario == "ai-settles" or dustScenario == "ai-update-locked-after" or dustScenario == "ai-update-unavailable-after" then pendingAI = true end
    if dustScenario == "no-dust-after-processing" or dustScenario == "still-processing" or dustScenario == "delayed" or dustScenario == "ai-update-locked-after" then editingReady = false end
    alterAfter()
    if dustScenario == "false-return" then return false end
    if dustScenario == "void-return" then return end
    return true -- Deliberately insufficient for confirmation.
end
SDK.goToRemove = function(mode, feature, ...)
    assert(closing and not inGate and mode == nil and feature == "manualRemove" and select("#", ...) == 0)
    dustCalls = dustCalls + 1
    if dustScenario == "sdk-error" then error("navigation failed C:/private/photo.raw") end
    alterAfter()
    if dustScenario == "false-return" then return false end
end
if dustScenario == "missing-navigation" then SDK.goToRemove = nil end
dustSleeps = 0
Tasks.sleep = function()
    dustSleeps = dustSleeps + 1
    if enabling and dustSleeps == 3 then
        if dustScenario == "delayed" then dustSettings.FilterList.Filters[2] = dustFilter() end
        if dustScenario == "ai-settles" then pendingAI = false end
        if dustScenario == "no-dust-after-processing" or dustScenario == "delayed" then editingReady = true end
    end
end
photo.pasteSettings = function() error("Never paste from the clipboard") end
photo.applyDevelopSettings = function() error("Never replay a settings table") end
function dustAlter()
    if dustScenario == "stale-filter" then dustSettings.FilterList.Filters[1].Payload = "stale" end
    if dustScenario == "wrong-identity" then dustSettings.FilterList.Filters[enabling and 1 or 2].Name = "Dust Removal";
        dustSettings.FilterList.Filters[enabling and 1 or 2].FilterID = 999 end
end
