exportCalls, exportResult, exportScenario, exportUuid = 0, nil, "ordinary", "creation-photo"
exportModule, exportClaimBody = "develop", '{"valid":true}'
local application = import "LrApplication"
local view = import "LrApplicationView"
local http = import "LrHttp"
local first, second, third = { localIdentifier = 1 }, { localIdentifier = 2 }, { localIdentifier = 3 }
local selected = { first, second }
local catalog = { getPath = function() return exportScenario == "catalog-path" and "/other/catalog" or "/test/catalog" end }
local other = { getPath = catalog.getPath }
first.getRawMetadata = function(_, key)
    assert(key == "uuid")
    if exportScenario == "metadata-error" then error("read failed") end
    if exportScenario == "during-metadata" then selected = { first, third } end
    return exportUuid
end
catalog.getTargetPhoto = function() if exportScenario ~= "no-photo" then return first end end
catalog.getTargetPhotos = function() return selected end
other.getTargetPhoto, other.getTargetPhotos = catalog.getTargetPhoto, catalog.getTargetPhotos
application.activeCatalog = function() return exportScenario == "catalog-object" and other or catalog end
view.getCurrentModuleName = function() return exportModule end
local function action(self, ...)
    assert(self == first and select("#", ...) == 0, "invoke the active photo method once, without arguments")
    exportCalls = exportCalls + 1
    if exportScenario == "sdk-error" then error("write failed") end
    if exportScenario == "sdk-false" then return false end
end
first.openExportDialog = function(...) exportMethod = "dialog"; return action(...) end
first.openExportWithPreviousDialog = function(...) exportMethod = "previous"; return action(...) end
http.get = function(url)
    if string.find(url, "/export/claim?", 1, true) then
        if exportScenario == "selection-same-count" then selected = { first, third } end
        if exportScenario == "selection-added" then selected = { first, second, third } end
        if exportScenario == "selection-reordered" then selected = { second, first } end
        if exportScenario == "active-missing" then selected = { second, third } end
        if exportScenario == "duplicate-member" then selected = { first, first } end
        if exportScenario == "active-uuid" then exportUuid = "another-photo" end
        if exportScenario == "module" then exportModule = "library" end
        if exportScenario == "shutdown" then _G.LRBridgePollingLifecycle = { stopping = true } end
        if exportScenario == "generation" then _G.LRBridgePollingLifecycle = { stopping = false } end
        if exportScenario == "claim-lost" then return nil end
        return exportClaimBody
    end
    assert(string.find(url, "/export/query-result?", 1, true) or string.find(url, "/export/operation-result?", 1, true), url)
    exportResult = url; return '{"ok":true}'
end
function takeResultUrl() return exportResult end
function exportRun() require("Commands").execute(require("Parser").parse(commandJson)) end
function exportResetLease() package.loaded.Export = nil; package.loaded.Commands = nil end
