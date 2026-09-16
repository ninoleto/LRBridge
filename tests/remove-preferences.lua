local sdk = import "LrDevelopController"
removeUuid, removeModule, removeTool = "creation-photo", "develop", "dust"
removePreferences = { newSpotType = "heal", brushSize = 25, brushFeather = 50, useGenerativeAI = true,
    detectObjects = false, toolOverlay = "selected", visualizeSpots = true, visualizationThreshold = 37,
    futurePreference = { retained = "yes" } }
removeCalls, removeValidations, removeResult = 0, 0, nil
removeScenario = "ordinary"
local function copy(t) local out = {}; for k, v in pairs(t) do out[k] = type(v) == "table" and copy(v) or v end; return out end
local photo = { getRawMetadata = function(_, key) assert(key == "uuid"); return removeUuid end }
(import "LrApplication").activeCatalog = function() return { getTargetPhoto = function() return photo end } end
(import "LrApplicationView").getCurrentModuleName = function() return removeModule end
sdk.getSelectedTool = function() return removeTool end
removePanelCalls = 0
sdk.selectTool = function(tool)
    assert(not peoplePanelAllowed, "People must not close Healing or substitute tool closure for Cancel")
    assert(removePanelAllowed, "Remove preferences must not select a tool")
    assert(tool == "loupe", "only Close uses selectTool; Open must specify mode and feature")
    removePanelCalls = removePanelCalls + 1
    if removeScenario == "setter-error" then error("SDK exception") end
    if removeScenario ~= "no-change" then removeTool = tool end
    if removeScenario == "tool-after" then removeTool = "crop" end
    if removeScenario == "photo-after" then removeUuid = "other-photo" end
end
sdk.goToRemove = function(mode, feature, ...)
    if feature == "distractingPeopleRemoval" then
        assert(peoplePanelAllowed and mode == nil and select("#", ...) == 0)
        peoplePanelCalls = peoplePanelCalls + 1
        if peopleScenario == "sdk-error" then error("People navigation failed") end
        removeTool = "dust"
        peopleNativeFeature = feature
        if peopleScenario == "navigation-detection" then peopleSpots = { { id = "navigation-result" } } end
        return
    end
    assert(removePanelAllowed and mode == "heal_patchmatch" and feature == "manualRemove" and select("#", ...) == 0)
    removePanelCalls = removePanelCalls + 1
    if removeScenario == "setter-error" then error("SDK opening exception") end
    if removeScenario == "no-change" then return end
    removeTool = "dust"; removePreferences.newSpotType = mode
    if removeScenario == "wrong-mode" then removePreferences.newSpotType = "clone" end
    if removeScenario == "open-unrelated" then removePreferences.brushFeather = 12 end
    if removeScenario == "tool-after" then removeTool = "crop" end
    if removeScenario == "photo-after" then removeUuid = "other-photo" end
end
manualPeopleSpots, peopleSpots, peopleSelectedIndex = {}, {}, nil
sdk.getSelectedSpotIndex = function(feature)
    if feature == "distractingPeopleRemoval" then return peopleSelectedIndex end
    assert(feature == "manualRemove"); return nil
end
sdk.getSelectedSpotParams = function(feature)
    if feature == "distractingPeopleRemoval" then return peopleSelectedIndex and peopleSpots[peopleSelectedIndex] or nil end
    assert(feature == "manualRemove"); return nil
end
sdk.countAllSpots = function(feature)
    if feature == "distractingPeopleRemoval" then return #peopleSpots end
    assert(feature == "manualRemove"); return #manualPeopleSpots
end
sdk.getAllSpots = function(feature)
    if feature == "distractingPeopleRemoval" then return copy(peopleSpots) end
    assert(feature == "manualRemove"); return copy(manualPeopleSpots)
end
sdk.setSelectedSpotParams = function() error("Remove preferences must not edit existing spots") end
sdk.setSelectedSpotType = function() error("Preference mode must not change an existing spot type") end
sdk.setSelectedSpotIndex = function() error("Preference mode must not change the selected spot") end
sdk.resetSpotRemoval = function() error("Preference Reset must not delete spots") end
sdk.getRemovePanelPreferences = function()
    if removeScenario == "getter-error" then error("read failed") end
    if removeScenario == "getter-nil" then return nil end
    if removeScenario == "shared-future-after" then return removePreferences end
    local p = copy(removePreferences)
    if removeScenario == "malformed" then p.brushSize = "25" end
    return p
end
sdk.setRemovePanelPreferences = function(patch)
    removeCalls = removeCalls + 1
    local n = 0; for k in pairs(patch) do n = n + 1; assert(removePreferences[k] ~= nil, "documented preference field required") end
    assert(n == 1, "only the requested field may be sent")
    if removeScenario == "setter-false" then return false, "SDK rejection" end
    if removeScenario == "setter-error" then error("SDK exception") end
    if removeScenario ~= "no-change" then for k, v in pairs(patch) do removePreferences[k] = v end end
    if removeScenario == "rounded-mismatch" then removePreferences.brushSize = patch.brushSize + 0.2 end
    if removeScenario == "mode-after" then removePreferences.newSpotType = "clone" end
    if removeScenario == "photo-after" then removeUuid = "other-photo" end
    if removeScenario == "tool-after" then removeTool = "masking" end
    if removeScenario == "unrelated-after" then removePreferences.detectObjects = true end
    if removeScenario == "future-after" or removeScenario == "shared-future-after" then removePreferences.futurePreference.retained = "changed" end
    return true
end
(import "LrHttp").get = function(url)
    if string.find(url, "/remove/validate?", 1, true) then
        removeValidations = removeValidations + 1
        if removeValidations == 2 then
            if removeScenario == "mode-before" then removePreferences.newSpotType = "clone" end
            if removeScenario == "photo-before" then removeUuid = "other-photo" end
            if removeScenario == "module-before" then removeModule = "library" end
            if removeScenario == "tool-before" then removeTool = "masking" end
            if removeScenario == "value-before" then removePreferences.brushSize = 33 end
        end
        if removeScenario == "invalid-binding" then return '{"ok":true,"valid":false}' end
        return '{"ok":true,"valid":true}'
    end
    assert(string.find(url, "/remove/query-result?", 1, true) or string.find(url, "/remove/operation-result?", 1, true))
    removeResult = url; return '{"ok":true}'
end
function takeResultUrl() local url = removeResult; assert(url); removeResult = nil; return url end
function removeQuery() assert((require "Remove").sendRequestedSnapshot(queryJson)) end
function removeExecute() (require "Commands").execute((require "Parser").parse(commandJson)) end
function assertOtherPreferences()
    assert(removePreferences.futurePreference.retained == "yes")
end

-- Reflections shares the existing Remove SDK/HTTP runner; no native UI inspection.
reflectionState = { checkboxState = false, amount = 37.4, quality = "standard", enabled = true, isSupported = true }
reflectionScenario, reflectionCalls, reflectionResults, reflectionSleeps, reflectionValidations = "ordinary", 0, {}, 0, 0
local reflectionCallback, reflectionWrite
sdk.getReflectionRemovalPanelState = function(...)
    assert(select("#", ...) == 0)
    if reflectionScenario == "read-error" then error("getter failed") end
    if reflectionScenario == "read-nil" then return nil end
    return reflectionState
end
local function reflectionSet(field, value, callback, args)
    reflectionCalls = reflectionCalls + 1
    if reflectionScenario == "sdk-error" then error("SDK failed") end
    if callback then assert(type(callback) == "function" and args.operationId and args.selectedPhotoUuid == "creation-photo") end
    reflectionCallback = callback
    reflectionWrite = function()
        reflectionState[field] = value
        if (reflectionScenario == "apply-off-disabled" or reflectionScenario == "apply-off-no-callback") and field == "checkboxState" and value == false then
            reflectionState.enabled = false
        end
        if reflectionScenario == "other-setting" then reflectionState[field == "amount" and "quality" or "amount"] = field == "amount" and "best" or -17 end
    end
    if not ({ ["delayed-readback"] = true, ["no-change"] = true, ["photo-callback"] = true })[reflectionScenario] then reflectionWrite() end
    if reflectionScenario == "photo-after" then removeUuid = "other-photo" end
    if callback and not ({ ["delayed-callback"] = true, ["photo-callback"] = true, ["no-callback"] = true,
        ["apply-off-no-callback"] = true })[reflectionScenario] then callback(args) end
end
sdk.toggleReflectionRemoval = function(amount, quality, callback, args, ...)
    assert(select("#", ...) == 0 and amount == reflectionState.amount and quality == reflectionState.quality, "Apply preserves actual native settings")
    reflectionSet("checkboxState", not reflectionState.checkboxState, callback, args)
end
sdk.changeReflectionRemovalAmount = function(value, ...)
    assert(select("#", ...) == 0 and value >= -100 and value <= 100)
    reflectionSet("amount", value)
end
sdk.changeReflectionRemovalQuality = function(value, callback, args, ...)
    assert(select("#", ...) == 0 and ({ preview = true, standard = true, best = true })[value])
    reflectionSet("quality", value, callback, args)
end
local reflectionTasks = import "LrTasks"
reflectionTasks.startAsyncTask = function(fn)
    if peopleScenario == "delayed-task" or peopleScenario == "photo-task" then peopleTask = fn
    elseif reflectionScenario == "async-task" or reflectionScenario == "photo-task" then reflectionTask = fn else fn() end
end
local originalSleep = reflectionTasks.sleep
reflectionTasks.sleep = function(seconds)
    if peopleRemoveCalls and peopleRemoveCalls > 0 then
        peopleSleeps = peopleSleeps + 1
        if peopleSleeps == 3 and peopleScenario == "delayed-callback" and peopleCallback then peopleCallback(peopleCallbackArgs) end
        if peopleSleeps == 3 and peopleScenario == "photo-callback" then removeUuid = "other-photo"; if peopleCallback then peopleCallback(peopleCallbackArgs) end end
        return
    end
    if reflectionCalls == 0 then return originalSleep(seconds) end
    reflectionSleeps = reflectionSleeps + 1
    if reflectionSleeps == 3 then
        if reflectionScenario == "delayed-callback" and reflectionCallback then reflectionCallback() end
        if reflectionScenario == "delayed-readback" then reflectionWrite() end
        if reflectionScenario == "photo-callback" then removeUuid = "other-photo"; if reflectionCallback then reflectionCallback() end end
    end
end
local reflectionHttp = import "LrHttp"
local originalHttpGet = reflectionHttp.get
reflectionHttp.get = function(url)
    if string.find(url, "/people/", 1, true) then
        if string.find(url, "/validate?", 1, true) then
            peopleValidations = peopleValidations + 1
            if peopleValidations == 2 then
                if peopleScenario == "photo-before" then removeUuid = "other-photo" end
                if peopleScenario == "inventory-before" then peopleSpots = { { id = "newer" } } end
            end
            return peopleScenario == "invalid-binding" and '{"valid":false}' or '{"valid":true}'
        end
        table.insert(peopleResults, url); return '{"ok":true}'
    end
    if not string.find(url, "/reflections/", 1, true) then return originalHttpGet(url) end
    if string.find(url, "/validate?", 1, true) then
        reflectionValidations = reflectionValidations + 1
        if reflectionValidations == 2 then
            if reflectionScenario == "photo-before" then removeUuid = "other-photo" end
            if reflectionScenario == "module-before" then removeModule = "library" end
            if reflectionScenario == "settings-before" then reflectionState.amount = -4 end
            if reflectionScenario == "desired-before" then reflectionState.checkboxState = true end
            if reflectionScenario == "disabled-before" then reflectionState.enabled = false end
        end
        return reflectionScenario == "invalid-binding" and '{"valid":false}' or '{"valid":true}'
    end
    table.insert(reflectionResults, url); return '{"ok":true}'
end
function takeReflectionsResultUrl() assert(#reflectionResults > 0); return table.remove(reflectionResults, 1) end
function reflectionsQuery() assert((require "Reflections").sendRequestedSnapshot(queryJson)) end
function reflectionsExecute() (require "Commands").execute((require "Parser").parse(commandJson)) end
function lateReflectionCallback() if reflectionCallback then reflectionCallback() end end
function runReflectionsTask()
    if reflectionTask then
        local task = reflectionTask; reflectionTask = nil
        if reflectionScenario == "photo-task" then removeUuid = "other-photo"; lateReflectionCallback() end
        task()
    end
end

-- SDK 14.5 People removal: explicit feature inventory, separate detection, callback-backed removal.
peopleScenario, peoplePanelAllowed, peoplePanelCalls = "ordinary", false, 0
peopleDetectCalls, peopleRemoveCalls, peopleResults, peopleValidations, peopleSleeps = 0, 0, {}, 0, 0
peopleCallback, peopleCallbackArgs, peopleTask = nil, nil, nil
sdk.detectDistractingPeople = function(...)
    assert(select("#", ...) == 0 and removeTool == "dust")
    peopleDetectCalls = peopleDetectCalls + 1
    if peopleScenario == "sdk-error" then error("People detection failed") end
    if peopleScenario == "detection-change" then peopleSpots = { { id = "detected" } } end
    if peopleScenario == "photo-after" then removeUuid = "other-photo" end
end
sdk.applyRemovalOnDetectedDistractingPeople = function(callback, args, ...)
    assert(select("#", ...) == 0 and removeTool == "dust" and type(callback) == "function" and
        type(args) == "table" and args.operationId and args.selectedPhotoUuid == "creation-photo")
    peopleRemoveCalls = peopleRemoveCalls + 1; peopleCallback, peopleCallbackArgs = callback, args
    if peopleScenario == "sdk-error" then error("People removal failed") end
    if peopleScenario ~= "removal-unchanged" and peopleScenario ~= "no-callback" then peopleSpots = {} end
    if peopleScenario == "manual-change" then manualPeopleSpots = { { id = "manual-changed" } } end
    if peopleScenario == "preference-change" then removePreferences.brushSize = 63 end
    if peopleScenario == "reflection-change" then reflectionState.amount = -12 end
    if peopleScenario == "photo-after" then removeUuid = "other-photo" end
    if not ({ ["delayed-callback"] = true, ["no-callback"] = true, ["photo-callback"] = true,
        ["photo-task"] = true })[peopleScenario] then callback(args) end
end
function takePeopleResultUrl() assert(#peopleResults > 0); return table.remove(peopleResults, 1) end
function peopleQuery() assert((require "People").sendRequestedSnapshot(queryJson)) end
function peopleExecute() (require "Commands").execute((require "Parser").parse(commandJson)) end
function installPeopleInventoryRegression()
    manualPeopleSpots = { { CorrectionID = "manual-correction", CorrectionMasks = { { MaskID = "manual-mask", Payload = "preserved" } } } }
    peopleSpots = {
        { CorrectionID = "correction-a", CorrectionAmount = 1, CorrectionActive = true,
            CorrectionMasks = {
                { MaskID = "mask-a", MaskActive = true, Geometry = { x = 0.25, y = 0.5 }, Payload = "mask-data-a" },
                { MaskID = "mask-b", MaskActive = false, Payload = "mask-data-b" }
            },
            FutureData = { CorrectionID = "retained-correction", MaskID = "retained-mask" } },
        { CorrectionID = "correction-b", CorrectionAmount = 0.5,
            CorrectionMasks = { { MaskID = "mask-c", Payload = "mask-data-c" } } }
    }
    peopleInventoryReads, peopleSelectedReads = 0, 0
    local originalInventory = sdk.getAllSpots
    sdk.getAllSpots = function(feature)
        if feature ~= "distractingPeopleRemoval" then return originalInventory(feature) end
        peopleInventoryReads = peopleInventoryReads + 1
        local spots = copy(peopleSpots)
        for i, spot in ipairs(spots) do
            spot.CorrectionID = "read-" .. peopleInventoryReads .. "-correction-" .. i
            for j, mask in ipairs(spot.CorrectionMasks) do mask.MaskID = "read-" .. peopleInventoryReads .. "-mask-" .. i .. "-" .. j end
        end
        if peopleInventoryChange and peopleValidations >= peopleInventoryChangePhase then peopleInventoryChange(spots) end
        return spots
    end
    sdk.getSelectedSpotParams = function(feature)
        assert(feature == "distractingPeopleRemoval")
        peopleSelectedReads = peopleSelectedReads + 1
        local selected = copy(peopleSpots[1]); selected.CorrectionID = "selected-read-" .. peopleSelectedReads
        return selected
    end
end
function capturePeopleTrace()
    peopleTrace = {}
    _PLUGIN = { path = "D:/fixture/lightroom/LRBridge.lrplugin" }
    io.open = function(path, mode)
        assert(path == "D:/fixture\\lrplugin-log.txt" and mode == "a")
        return { write = function(_, line) table.insert(peopleTrace, line) end, close = function() end }
    end
end
function latePeopleCallback() if peopleCallback then peopleCallback(peopleCallbackArgs) end end
function runPeopleTask()
    if peopleTask then
        local task = peopleTask; peopleTask = nil
        if peopleScenario == "photo-task" then removeUuid = "other-photo"; latePeopleCallback() end
        task()
    end
end
