-- Opaque synthetic fields exercise identity/preservation; these are not proposed SDK parameter mappings.
removeSpots = { { fixtureIdentity = "one", fixtureValue = 0.5 }, { fixtureIdentity = "two", fixtureValue = 0.8 } }
removeSpotIndex, removeSpotType, removeSpotGenAI, repairCalls, repairScenario = 1, "heal", false, 0, "ordinary"
local originalImport = import
local digests, digestCount = {}, 0
function import(name)
    if name == "LrMD5" then return { digest = function(value)
        if not digests[value] then digestCount = digestCount + 1; digests[value] = string.format("%032x", digestCount) end
        return digests[value]
    end } end
    return originalImport(name)
end
local sdk = import "LrDevelopController"
-- These root fields/scales are captured from the user's selected Heal repair. Other fields above remain synthetic.
for _, spot in ipairs(removeSpots) do spot.Opacity = 0.5; spot.Feather = 0.33; spot.Masks = {{ Flow = 1 }} end
sdk.getSelectedSpotIndex = function(feature) assert(feature == "manualRemove"); return removeSpotIndex end
sdk.getSelectedSpotType = function(...) assert(select("#", ...) == 0); return removeSpotType, removeSpotGenAI end
local postWriteParamReads = 0
sdk.getSelectedSpotParams = function(feature)
    assert(feature == "manualRemove")
    if repairCalls > 0 then
        postWriteParamReads = postWriteParamReads + 1
        if repairScenario == "readback-replacement" and postWriteParamReads == 3 then removeSpots[1].fixtureIdentity = "native-replacement" end
    end
    return removeSpots[removeSpotIndex]
end
sdk.getAllSpots = function(feature) assert(feature == "manualRemove"); return removeSpots end
sdk.countAllSpots = function(feature) assert(feature == "manualRemove"); return #removeSpots end
sdk.setSelectedSpotParams = function(params, ...)
    assert(repairParameterAllowed and select("#", ...) == 0)
    local before = removeSpots[removeSpotIndex]
    local field = repairParameterName or "Opacity"
    local other = field == "Opacity" and "Feather" or "Opacity"
    assert(params ~= before and params.Masks ~= before.Masks, "fresh deep copy required")
    assert(params[other] == before[other] and params.Masks[1].Flow == 1 and params.fixtureIdentity == before.fixtureIdentity)
    repairCalls = repairCalls + 1
    if repairScenario == "sdk-error" then error("Parameter failed") end
    if repairScenario == "no-change" then return end
    -- Mutate the SDK's reused table to exercise frozen before-write identity/preservation.
    before[field] = params[field]
    if repairScenario == "rounded-mismatch" then before[field] = params[field] + 0.001 end
    if repairScenario == "other-parameter" then before[other] = 0.2 end
    if repairScenario == "nested-parameter" then before.Masks[1].Flow = 0.2 end
    if repairScenario == "other-repair" then removeSpots[2].fixtureValue = 0.1 end
    if repairScenario == "preference-after" then removePreferences.brushSize = 7 end
    if repairScenario == "selection-after" then removeSpotIndex = 2 end
    if repairScenario == "photo-after" then removeUuid = "new-photo" end
end
sdk.setSelectedSpotType = function(spotType, useGenAI, ...)
    assert(repairFillAllowed and select("#", ...) == 0 and type(useGenAI) == "boolean")
    assert(spotType == "heal_patchmatch" or spotType == "heal" or spotType == "clone")
    repairCalls = repairCalls + 1
    if repairScenario == "sdk-error" then error("Fill failed") end
    if repairScenario == "no-change" then return end
    removeSpotType, removeSpotGenAI = spotType, useGenAI
    if repairScenario == "wrong-genai" then removeSpotGenAI = not useGenAI end
    removeSpots[removeSpotIndex].fixtureType = removeSpotType
    removeSpots[removeSpotIndex].fixtureGenAI = removeSpotGenAI
    if repairScenario == "other-repair" then removeSpots[2].fixtureValue = 0.1 end
    if repairScenario == "preference-after" then removePreferences.brushSize = 7 end
    if repairScenario == "selection-after" then removeSpotIndex = 2 end
    if repairScenario == "photo-after" then removeUuid = "new-photo" end
end
sdk.refreshSelectedSpot = function(feature)
    assert(feature == "manualRemove"); repairCalls = repairCalls + 1
    if repairScenario == "sdk-error" then error("Refresh failed") end
end
sdk.deleteSelectedSpot = function(feature)
    assert(feature == "manualRemove"); repairCalls = repairCalls + 1
    if repairScenario == "sdk-error" then error("Delete failed") end
    if repairScenario == "no-change" then return end
    table.remove(removeSpots, repairScenario == "wrong-delete" and 2 or removeSpotIndex)
    removeSpotIndex = nil
    if repairScenario == "photo-after" then removeUuid = "new-photo" end
end
local http = import "LrHttp"
local get = http.get
http.get = function(url)
    local result = get(url)
    if string.find(url, "/remove/validate?", 1, true) and removeValidations == 2 then
        if repairScenario == "selection-before" then removeSpotIndex = 2 end
        if repairScenario == "inventory-before" then removeSpots[1].fixtureIdentity = "replacement" end
        if repairScenario == "type-before" then removeSpotType = "clone" end
        if repairScenario == "photo-before" then removeUuid = "new-photo" end
    end
    return result
end
