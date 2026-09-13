package.path = "lightroom/LRBridge.lrplugin/?.lua;" .. package.path
-- Match Lightroom's Lua number formatting; Fengari otherwise appends .0 to large integers.
local nativeToString = tostring
function tostring(value)
    if type(value) == "number" and value == math.floor(value) then return string.format("%.0f", value) end
    return nativeToString(value)
end
local masks, tool, selectedMask, selectedTool = {}, "loupe", nil, nil
local uuid, moduleName = "creation-photo", "develop"
local photo = { getRawMetadata = function(_, key) assert(key == "uuid"); return uuid end }
creationCalls, deletionCalls, globalWrites, resultUrls = 0, 0, 0, {}
selectionCalls, componentCalls = {}, {}
local sdk = {
    getAllMasks = function() return masks end,
    getSelectedTool = function() return tool end,
    getSelectedMask = function() return selectedMask end,
    getSelectedMaskTool = function() return selectedTool end,
    getRange = function() return nil end,
    getValue = function() return nil end,
    setValue = function() globalWrites = globalWrites + 1 end,
    resetToDefault = function() globalWrites = globalWrites + 1 end,
    selectMask = function(id)
        table.insert(selectionCalls, id)
        local found = false
        for _, mask in ipairs(masks) do if mask.ID == id then found = true end end
        assert(found, "replacement must survive in the authoritative inventory")
        if scenario == "selection-error" then error("SDK selection failure") end
        if scenario == "selection-no-effect" then return end
        selectedMask, selectedTool = id, nil
        if scenario == "photo-in-selection" then uuid = "other-photo" end
    end,
    selectMaskTool = function(id)
        table.insert(componentCalls, id)
        if scenario == "component-error" then error("SDK component selection failure") end
        local found = false
        for _, mask in ipairs(masks) do if mask.ID == selectedMask then
            for _, component in ipairs(mask.Tools) do if component.ID == id then found = true end end
        end end
        assert(found, "replacement component must belong to the current mask")
        selectedTool = id
        if scenario == "photo-in-component" then uuid = "other-photo" end
    end,
    deleteMask = function(id, ...)
        assert(select("#", ...) == 0 and id == selectedMask, "delete the intended whole group by ID")
        deletionCalls = deletionCalls + 1
        if scenario == "sdk-error" then error("SDK deletion failure") end
        if scenario == "no-change" then return end
        local index
        for i, mask in ipairs(masks) do if mask.ID == id then index = i end end
        if scenario == "wrong-mask" then table.remove(masks, 1) else table.remove(masks, index) end
        if scenario == "photo-during" then uuid = "other-photo" end
        -- Live Lightroom leaves no selection until selectMask/selectMaskTool run explicitly.
        selectedMask, selectedTool = nil, nil
        if scenario == "native-selection" then selectedMask, selectedTool = masks[1].ID, masks[1].Tools[2].ID end
        if scenario == "empty-selection" then selectedMask, selectedTool = "", "" end
        if scenario == "deleted-selection" then selectedMask, selectedTool = id, "tool-" .. index end
        if #masks == 0 and scenario == "last" then tool = "loupe" end
    end,
    resetMasking = function(...)
        assert(select("#", ...) == 0)
        deletionCalls = deletionCalls + 1
        if scenario == "sdk-error" then error("SDK deletion failure") end
        if scenario == "no-change" then return end
        masks = {}
        if scenario ~= "deleted-selection" then selectedMask, selectedTool = nil, nil end
        if scenario == "empty-selection" then selectedMask, selectedTool = "", "" end
        if scenario == "photo-during" then uuid = "other-photo" end
    end,
    createNewMask = function(maskType, maskSubtype)
        creationCalls = creationCalls + 1
        assert(maskType == expectedType and (maskSubtype or "") == expectedSubtype)
        tool = "masking"
        if scenario == "sdk-error" then error("SDK creation failure") end
        if scenario == "photo-during" then uuid = "other-photo"; return end
        if scenario == "incomplete" then masks = { { ID = "new-mask", Tools = {} } }; return end
        if scenario == "automatic" or scenario == "multiple-interactive" then
            selectedMask, selectedTool = "new-mask", "new-tool"
            masks = { { ID = selectedMask, Name = "New mask", Hidden = false,
                Tools = { { ID = selectedTool, Name = "New tool", Type = maskType, Subtype = maskSubtype, Hidden = false } } } }
            if scenario == "multiple-interactive" then
                masks[2] = { ID = "second-mask", Name = "Second mask", Hidden = false,
                    Tools = { { ID = "second-tool", Type = maskType, Subtype = maskSubtype, Hidden = false } } }
            end
        end
    end
}
local imports = {
    LrDevelopController = sdk,
    LrApplicationView = { getCurrentModuleName = function() return moduleName end },
    LrApplication = { activeCatalog = function() return { getTargetPhoto = function() return photo end } end },
    LrTasks = { pcall = pcall, sleep = function() end },
    LrDate = { currentTime = function() return 100 end },
    LrHttp = { get = function(url)
        if url == "http://127.0.0.1:17891/context" then
            if deletionCalls > 0 then
                if scenario == "photo-before-selection" or scenario == "photo-before-component" and #selectionCalls > 0 then uuid = "other-photo" end
                if scenario == "user-before-selection" or scenario == "user-before-component" and #selectionCalls > 0 then
                    selectedMask, selectedTool = "mask-1", "extra-1"
                end
                if scenario == "inventory-before-selection" and #masks == 2 then
                    masks[3] = { ID = "newer-mask", Tools = { { ID = "newer-tool", Hidden = false } }, Hidden = false }
                end
            end
            return contextJson
        end
        if url == "http://127.0.0.1:17891/masking/state" then return maskingJson end
        assert(string.find(url, "/masking/query-result?", 1, true) or string.find(url, "/masking/operation-result?", 1, true), url)
        resultUrls[#resultUrls + 1] = url
        return '{"ok":true}', { status = 200 }
    end }
}
function import(name) assert(imports[name], name); return imports[name] end
for _, name in ipairs({ "Driver", "Query", "Selection", "Application", "Photo", "Crop", "ColorGrading", "Enhance",
    "History", "LensBlur", "DevelopCategorical", "ToneCurve", "Profile", "DevelopPresets", "MaskPresets" }) do
    package.loaded[name] = {}
end
package.loaded.PointColor = { copyCollection = function() return nil end }
package.loaded.ToneCurve = { normalizeCurveValue = function() return nil end }
package.loaded.MaskToneCurveTrace = { finish = function() end, record = function() end }
local Parser, Masking, Commands = require "Parser", require "Masking", require "Commands"
function fixtureQuery() assert(Masking.sendRequestedSnapshot(queryJson)); end
function fixtureExecute()
    if scenario == "photo-before" then uuid = "other-photo" end
    if scenario == "module-before" then moduleName = "library" end
    if scenario == "selection-before" then selectedMask = "mask-1"; selectedTool = "tool-1" end
    if scenario == "count-before" then table.remove(masks, 1) end
    local command = Parser.parse(commandJson)
    assert(command and (command.command == "masking.create" or command.command == "masking.selected.delete" or
        command.command == "masking.all.delete"), "Parser must preserve the mask command")
    Commands.execute(command)
end
function fixtureMasks(count, closed, selectedIndex)
    masks = {}
    for index = 1, count do
        masks[index] = { ID = "mask-" .. index, Name = "Mask " .. index, Hidden = false,
            Tools = { { ID = "tool-" .. index, Type = "brush", Hidden = false },
                { ID = "extra-" .. index, Type = "gradient", Hidden = false } } }
    end
    selectedMask, selectedTool = "mask-" .. (selectedIndex or count), "tool-" .. (selectedIndex or count)
    tool = closed and "loupe" or "masking"
end
function takeResultUrl() local url = resultUrls[#resultUrls]; assert(url); resultUrls = {}; return url end
function fixtureEnableDeletionTrace()
    deletionTraceLines = {}
    _PLUGIN = { path = "D:/fixture/lightroom/LRBridge.lrplugin" }
    io.open = function(path, mode)
        assert(path == "D:/fixture\\lrplugin-log.txt" and mode == "a")
        return { write = function(_, text) table.insert(deletionTraceLines, text) end, close = function() end }
    end
end
