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
    assert(removePanelAllowed, "Remove preferences must not select a tool")
    assert(tool == "loupe", "only Close uses selectTool; Open must specify mode and feature")
    removePanelCalls = removePanelCalls + 1
    if removeScenario == "setter-error" then error("SDK exception") end
    if removeScenario ~= "no-change" then removeTool = tool end
    if removeScenario == "tool-after" then removeTool = "crop" end
    if removeScenario == "photo-after" then removeUuid = "other-photo" end
end
sdk.goToRemove = function(mode, feature, ...)
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
sdk.getSelectedSpotIndex = function(feature) assert(feature == "manualRemove"); return nil end
sdk.countAllSpots = function(feature) assert(feature == "manualRemove"); return 0 end
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
