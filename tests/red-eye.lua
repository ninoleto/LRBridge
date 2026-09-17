local sdk = import "LrDevelopController"
eyeUuid, eyeModule, eyeTool = "creation-photo", "develop", "redeye"
eyeCalls, eyeValidations, eyeResult, eyeMode, eyeScenario = 0, 0, nil, nil, "ordinary"
local photo = { getRawMetadata = function(_, key) if key == "uuid" then return eyeUuid end; return key == "isVideo" and eyeScenario == "video" end }
(import "LrApplication").activeCatalog = function() return { getTargetPhoto = function() if eyeScenario ~= "no-photo" then return photo end end } end
(import "LrApplicationView").getCurrentModuleName = function() return eyeModule end
sdk.getSelectedTool = function()
    if eyeScenario == "getter-error" then error("read failed") end
    if eyeScenario == "getter-nil" then return nil end
    if eyeScenario == "getter-unknown" then return "future_tool" end
    return eyeTool
end
local function mutate()
    eyeCalls = eyeCalls + 1
    if eyeScenario == "sdk-error" then error("SDK failed") end
    if eyeScenario == "sdk-false" then return false end
    if eyeScenario == "photo-after" then eyeUuid = "other-photo" end
    return true
end
sdk.goToEyeCorrection = function(mode, ...)
    assert((mode == "red_eye" or mode == "pet_eye") and select("#", ...) == 0)
    if not mutate() then return false end
    eyeMode = mode
    if eyeScenario ~= "no-change" then eyeTool = "redeye" end
end
sdk.selectTool = function(tool, ...)
    assert(tool == "loupe" and eyeTool == "redeye" and select("#", ...) == 0, "Close must never dismiss another tool")
    if not mutate() then return false end
    if eyeScenario ~= "no-change" then eyeTool = "loupe" end
end
sdk.resetRedeye = function(...)
    assert(select("#", ...) == 0 and eyeUuid == "creation-photo", "reset intended current photo only")
    if not mutate() then return false end
end
sdk.resetSpotRemoval = function() error("Healing must not be reset") end
sdk.resetHealing = function() error("Healing must not be reset") end
sdk.setValue = function() error("No generic adjustment writes") end
sdk.setSelectedSpotParams = function() error("No Healing writes") end
(import "LrHttp").get = function(url)
    if string.find(url, "/red-eye/validate?", 1, true) then
        eyeValidations = eyeValidations + 1
        if eyeValidations == 2 then
            if eyeScenario == "photo-before" then eyeUuid = "another-photo" end
            if eyeScenario == "module-before" then eyeModule = "library" end
            if eyeScenario == "tool-before" then eyeTool = "masking" end
        end
        if eyeScenario == "invalid-binding" then return '{"valid":false}' end
        return '{"valid":true}'
    end
    assert(string.find(url, "/red-eye/query-result?", 1, true) or string.find(url, "/red-eye/operation-result?", 1, true))
    eyeResult = url; return '{"ok":true}'
end
function takeResultUrl() return eyeResult end
function eyeQuery() require("RedEye").sendRequestedSnapshot(queryJson) end
function eyeExecute() require("Commands").execute(require("Parser").parse(commandJson)) end
