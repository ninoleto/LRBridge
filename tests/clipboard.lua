clipboardCalls, clipboardResult, clipboardScenario, clipboardUuid = 0, nil, "ordinary", "creation-photo"
clipboardModule, clipboardClaimBody = "develop", '{"valid":true}'
local application, view, http = import "LrApplication", import "LrApplicationView", import "LrHttp"
local first, second, third = { localIdentifier = 1 }, { localIdentifier = 2 }, { localIdentifier = 3 }
local selected, inGate = { first, second }, false
local catalog = { getPath = function() return clipboardScenario == "catalog-path" and "/other/catalog" or "/test/catalog" end }
local other = { getPath = catalog.getPath }
first.getRawMetadata = function(_, key)
    assert(key == "uuid")
    if clipboardScenario == "metadata-error" then error("read failed") end
    if clipboardScenario == "during-metadata" then selected = { first, third } end
    return clipboardUuid
end
catalog.getTargetPhoto = function() if clipboardScenario ~= "no-photo" then return first end end
catalog.getTargetPhotos = function() return selected end
other.getTargetPhoto, other.getTargetPhotos = catalog.getTargetPhoto, catalog.getTargetPhotos
application.activeCatalog = function() return clipboardScenario == "catalog-object" and other or catalog end
view.getCurrentModuleName = function() return clipboardModule end
catalog.withWriteAccessDo = function(_, name, fn, options)
    assert(name == "LRBridge Paste Settings" and options.asynchronous == false and options.timeout == 5)
    if clipboardScenario == "gate-timeout" then return "aborted" end
    if clipboardScenario == "gate-selection" then selected = { first, third } end
    if clipboardScenario == "gate-empty" then selected = {} end
    inGate = true; fn(); inGate = false
    if clipboardScenario == "gate-after-error" then error("gate error after dispatch") end
    return "executed"
end
other.withWriteAccessDo = catalog.withWriteAccessDo
local function action(paste)
    assert(clipboardCalls == 0 and (not paste or inGate), "exactly one SDK call, Paste inside gate")
    clipboardCalls = clipboardCalls + 1
    if clipboardScenario == "sdk-error" then error("SDK error") end
    if clipboardScenario == "sdk-false" then return false end
    if clipboardScenario == "sdk-nil" then return nil end
    return true
end
first.copySettings = function(self, ...)
    assert(self == first and select("#", ...) == 0 and not inGate)
    clipboardMethod = "copy"; return action(false)
end
first.pasteSettings = function(self, updateAI, ...)
    assert(self == first and #selected == 1 and updateAI == true and select("#", ...) == 0)
    clipboardMethod = "photo-paste"; return action(true)
end
catalog.pasteSettings = function(self, photos, updateAI, ...)
    assert(self == catalog and updateAI == true and #photos == #selected and #photos > 1 and select("#", ...) == 0)
    for i, photo in ipairs(photos) do assert(photo == selected[i]) end
    clipboardMethod = "catalog-paste"; return action(true)
end
first.needsUpdateAISettings = function()
    if clipboardScenario == "ai-error" then error("AI status unavailable") end
    if clipboardScenario == "ai-nil" then return nil end
    return clipboardScenario == "ai-pending"
end
second.needsUpdateAISettings, third.needsUpdateAISettings = function() return false end, function() return false end
http.get = function(url)
    if string.find(url, "/clipboard/claim?", 1, true) then
        if clipboardScenario == "selection-same-count" then selected = { first, third } end
        if clipboardScenario == "selection-added" then selected = { first, second, third } end
        if clipboardScenario == "selection-reordered" then selected = { second, first } end
        if clipboardScenario == "active-missing" then selected = { second, third } end
        if clipboardScenario == "duplicate-member" then selected = { first, first } end
        if clipboardScenario == "active-uuid" then clipboardUuid = "another-photo" end
        if clipboardScenario == "module" then clipboardModule = "library" end
        if clipboardScenario == "shutdown" then _G.LRBridgePollingLifecycle = { stopping = true } end
        if clipboardScenario == "generation" then _G.LRBridgePollingLifecycle = { stopping = false } end
        if clipboardScenario == "claim-lost" then return nil end
        return clipboardClaimBody
    end
    if string.find(url, "/clipboard/validate?", 1, true) then
        if clipboardScenario == "validate-lost" then return nil end
        if clipboardScenario == "validate-stale" then return '{"valid":false}' end
        if clipboardScenario == "during-validate" then selected = { first, third } end
        return '{"valid":true}'
    end
    if string.find(url, "/history/result?", 1, true) then return '{"ok":true}' end
    assert(string.find(url, "/clipboard/query-result?", 1, true) or string.find(url, "/clipboard/operation-result?", 1, true), url)
    clipboardResult = url; return '{"ok":true}'
end
function takeResultUrl() return clipboardResult end
function clipboardRun() require("Commands").execute(require("Parser").parse(commandJson)) end
function clipboardResetLease() package.loaded.SettingsClipboard = nil; package.loaded.Commands = nil end
function clipboardSingle() selected = { first } end
function clipboardNoMethods() first.copySettings = nil; first.pasteSettings = nil; catalog.pasteSettings = nil end
