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
    selectTool = function(value) tool = value end,
    goToMasking = function() tool = "masking" end,
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
componentCreationCalls = 0
local function createComponent(kind, maskType, maskSubtype, ...)
    assert(select("#", ...) == 0, "SDK Add/Subtract takes only maskType and maskSubtype")
    assert(kind == expectedKind and maskType == expectedType and (maskSubtype or "") == expectedSubtype)
    assert(selectedMask == "mask-2" and tool == "masking" and uuid == "creation-photo" and moduleName == "develop",
        "Only mutate the originally selected photo and mask")
    componentCreationCalls = componentCreationCalls + 1
    if scenario == "sdk-error" then error("SDK component error") end
    if scenario == "photo-during" then uuid = "other-photo"; return end
    if scenario == "module-during" then moduleName = "library"; return end
    if scenario == "mask-during" then selectedMask, selectedTool = "mask-1", "tool-1"; return end
    if scenario == "incomplete" then masks[2].Tools = {}; return end
    if scenario == "automatic" or scenario == "interactive-entry" or scenario == "multiple-interactive" or
        scenario == "replace-old" or scenario == "wrong-group" or scenario == "old-selected" then
        table.insert(masks[2].Tools, { ID = "new-component", Type = maskType, Subtype = maskSubtype,
            Inverted = kind == "subtract", Hidden = false })
        selectedTool = scenario == "old-selected" and "extra-2" or "new-component"
        if scenario == "multiple-interactive" then table.insert(masks[2].Tools, { ID = "another-component", Hidden = false }) end
        if scenario == "replace-old" then masks[2].Tools[1].ID = "replacement" end
        if scenario == "wrong-group" then masks[1].ID = "replacement-group" end
    end
end
sdk.addToCurrentMask = function(...) return createComponent("add", ...) end
sdk.subtractFromCurrentMask = function(...) return createComponent("subtract", ...) end
componentDeletionCalls = 0
sdk.deleteMaskTool = function(id, ...)
    assert(select("#", ...) == 0 and id == componentDeleteToolId and selectedMask == componentDeleteMaskId,
        "deleteMaskTool must receive only the originally selected component ID")
    componentDeletionCalls = componentDeletionCalls + 1
    if componentDeleteScenario == "sdk-error" then error("deleteMaskTool failure") end
    if componentDeleteScenario == "no-change" then return end
    local maskIndex, toolIndex
    for index, mask in ipairs(masks) do if mask.ID == selectedMask then
        maskIndex = index
        for i, component in ipairs(mask.Tools) do if component.ID == id then toolIndex = i end end
    end end
    local parent = masks[maskIndex]
    table.remove(parent.Tools, componentDeleteScenario == "wrong-component" and (toolIndex == 1 and 2 or 1) or toolIndex)
    if componentDeleteScenario == "collateral" then table.remove(masks[1].Tools, 1) end
    if #parent.Tools == 0 and componentDeleteScenario ~= "retain-empty" and componentDeleteScenario ~= "retain-empty-closed" or
        componentDeleteScenario == "wrong-parent" then
        table.remove(masks, maskIndex); selectedMask, selectedTool = nil, nil
    else
        selectedTool = nil
    end
    if componentDeleteScenario == "deleted-selection" then selectedTool = id end
    if componentDeleteScenario == "empty-selection" then selectedTool = "" end
    if componentDeleteScenario == "no-mask-selection" or componentDeleteScenario == "user-before-component" then selectedMask = nil end
    if componentDeleteScenario == "native-selection" then selectedMask, selectedTool = parent.ID, parent.Tools[1].ID end
    if componentDeleteScenario == "native-other-mask" then selectedMask, selectedTool = "mask-1", "extra-1" end
    if componentDeleteScenario == "photo-during" then uuid = "other-photo" end
    if componentDeleteScenario == "module-during" then moduleName = "library" end
    if componentDeleteScenario == "closed-during" or componentDeleteScenario == "retain-empty-closed" then tool = "loupe" end
end
local imports = {
    LrDevelopController = sdk,
    LrApplicationView = { getCurrentModuleName = function() return moduleName end },
    LrApplication = { activeCatalog = function() return { getTargetPhoto = function() return photo end } end },
    LrTasks = { pcall = pcall, sleep = function() end },
    LrDate = { currentTime = function() return 100 end },
    LrHttp = { get = function(url)
        if url == "http://127.0.0.1:17891/context" then
            if inversionBeforeWrite then inversionBeforeWrite() end
            if componentDeleteScenario then
                if componentDeletionCalls == 0 then
                    if componentDeleteScenario == "photo-before" then uuid = "other-photo" end
                    if componentDeleteScenario == "module-before" then moduleName = "library" end
                    if componentDeleteScenario == "mask-before" then selectedMask, selectedTool = "mask-1", "tool-1" end
                    if componentDeleteScenario == "component-before" then selectedTool = "component-1" end
                    if componentDeleteScenario == "inventory-before" then table.insert(masks[2].Tools, { ID = "user-added", Hidden = false }) end
                else
                    if componentDeleteScenario == "photo-before-selection" then uuid = "other-photo" end
                    if componentDeleteScenario == "user-before-selection" then selectedMask, selectedTool = "mask-1", "extra-1" end
                    if componentDeleteScenario == "user-mask-only" then selectedMask, selectedTool = "mask-1", nil end
                    if componentDeleteScenario == "user-component" then selectedTool = "component-1" end
                    if componentDeleteScenario == "user-before-component" and #selectionCalls > 0 then selectedMask, selectedTool = "mask-1", "extra-1" end
                    if componentDeleteScenario == "inventory-after" then masks[1].Tools[1].ID = "user-changed" end
                end
            end
            if scenario == "mask-before-call" then selectedMask, selectedTool = "mask-1", "tool-1" end
            if scenario == "component-before-call" then selectedTool = "extra-2" end
            if scenario == "components-before-call" then table.insert(masks[2].Tools, { ID = "unrelated-new", Hidden = false }) end
            if scenario == "module-before-call" then moduleName = "library" end
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
    assert(command and (command.command == "masking.panel.set" or command.command == "masking.group.navigate" or
        command.command == "masking.component.invert" or command.command == "masking.component.delete" or command.command == "masking.component.add" or command.command == "masking.component.subtract" or
        command.command == "masking.create" or command.command == "masking.selected.delete" or
        command.command == "masking.all.delete"), "Parser must preserve the mask command")
    Commands.execute(command)
end
function fixtureNoComponentSelection() selectedTool = nil end
function fixtureInversion(value, mode, maskType, maskSubtype)
    inversionCalls = 0
    local target = masks[2].Tools[1]
    target.Inverted, target.Type, target.Subtype = value, maskType or "brush", maskSubtype
    local reads = 0
    inversionBeforeWrite = function()
        reads = reads + 1
        if reads ~= 3 then return end
        if mode == "photo-before" then uuid = "other-photo" end
        if mode == "mask-before" then selectedMask, selectedTool = "mask-1", "tool-1" end
        if mode == "component-before" then selectedTool = "extra-2" end
        if mode == "inverted-before" then target.Inverted = not value end
    end
    sdk.getAllMasks = function() return masks end
    sdk.toggleInvertMaskTool = function(id, ...)
        inversionCalls = inversionCalls + 1
        assert(select("#", ...) == 0 and id == "tool-2" and selectedMask == "mask-2" and selectedTool == id)
        if mode == "sdk-error" then error("SDK inversion error") end
        if mode == "no-change" then return end
        if mode == "delayed" then
            local count = 0
            sdk.getAllMasks = function() count = count + 1; if count >= 3 then target.Inverted = not value end; return masks end
            return
        end
        if value ~= nil then target.Inverted = not value end
        if mode == "unreadable-after" then target.Inverted = nil end
        if mode == "malformed-after" then target.Inverted = "true" end
        if mode == "photo-during" then uuid = "other-photo" end
        if mode == "module-during" then moduleName = "library" end
        if mode == "mask-during" then selectedMask, selectedTool = "mask-1", "tool-1" end
        if mode == "component-during" then selectedTool = "extra-2" end
    end
    sdk.invertMask = function() globalWrites = globalWrites + 1; error("Whole-mask inversion is forbidden") end
end
function fixtureInversionPreserved()
    assert(#masks == 3 and #masks[2].Tools == 2 and masks[2].Tools[2].ID == "extra-2")
    assert(masks[1].Tools[1].Inverted == nil and masks[2].Tools[2].Inverted == nil and masks[3].Tools[1].Inverted == nil)
    assert(creationCalls == 0 and deletionCalls == 0 and globalWrites == 0 and #selectionCalls == 0 and #componentCalls == 0)
end
function fixtureNativeInvert() masks[2].Tools[1].Inverted = not masks[2].Tools[1].Inverted end
function fixtureNoMaskSelection() selectedMask, selectedTool = nil, nil end
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
function fixtureComponentMasks(maskCount, toolCount, toolIndex, maskIndex)
    fixtureMasks(maskCount, false, maskIndex)
    local parent = masks[maskIndex]
    parent.Tools = {}
    for index = 1, toolCount do parent.Tools[index] = { ID = "component-" .. index, Type = "brush", Hidden = false } end
    selectedTool = parent.Tools[toolIndex].ID
    componentDeleteMaskId, componentDeleteToolId = selectedMask, selectedTool
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
