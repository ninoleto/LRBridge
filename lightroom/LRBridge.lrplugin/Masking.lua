local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrDevelopController = import "LrDevelopController"
local LrHttp = import "LrHttp"
local LrTasks = import "LrTasks"

local Parser = require "Parser"

local Masking = {}
local MAX_MASK_GROUPS = 512
local MAX_MASK_TOOLS_PER_GROUP = 2048

local function urlEncode(value)
    return string.gsub(tostring(value), "([^%w%-_%.~])", function(character)
        return string.format("%%%02X", string.byte(character))
    end)
end

local function inDevelop()
    return string.lower(tostring(LrApplicationView.getCurrentModuleName())) == "develop"
end

local function selectedPhoto()
    local catalog = LrApplication.activeCatalog()
    if catalog == nil then return nil end
    local ok, photo = LrTasks.pcall(function() return catalog:getTargetPhoto() end)
    if ok == true then return photo end
    return nil
end

local function photoUuid(photo)
    if photo == nil then return "" end
    local ok, uuid = LrTasks.pcall(function() return photo:getRawMetadata("uuid") end)
    if ok == true and uuid ~= nil then return tostring(uuid) end
    return ""
end

local function jsonString(json, field)
    if type(json) ~= "string" then return nil end
    return string.match(json, '"' .. field .. '"%s*:%s*"([^"%c]*)"')
end

local function jsonInteger(json, field)
    if type(json) ~= "string" then return nil end
    local value = string.match(json, '"' .. field .. '"%s*:%s*(%d+)')
    return value and tonumber(value) or nil
end

local function validInteger(value)
    return type(value) == "number" and value >= 0 and value == math.floor(value)
end

local function validOpaqueId(value)
    return type(value) == "string" and value ~= "" and string.len(value) <= 256 and
        string.find(value, "%c") == nil
end

local function validBinding(command)
    return type(command) == "table" and command.expectedActiveModule == "develop" and
        type(command.expectedSelectedPhotoUuid) == "string" and command.expectedSelectedPhotoUuid ~= "" and
        string.len(command.expectedSelectedPhotoUuid) <= 200 and validInteger(command.expectedContextCounter) and
        validInteger(command.expectedDevelopCounter) and validInteger(command.expectedContextChangedAt) and
        type(command.expectedServerEpoch) == "string" and command.expectedServerEpoch ~= "" and
        string.len(command.expectedServerEpoch) <= 64 and validInteger(command.expectedMaskingRevision)
end

local function serverBindingMatches(command, pendingOperationId)
    if not validBinding(command) or not inDevelop() then return false end
    local photo = selectedPhoto()
    if photo == nil or photoUuid(photo) ~= command.expectedSelectedPhotoUuid then return false end

    local contextOk, contextJson = LrTasks.pcall(function()
        return LrHttp.get("http://127.0.0.1:17891/context")
    end)
    local stateOk, stateJson = LrTasks.pcall(function()
        return LrHttp.get("http://127.0.0.1:17891/masking/state")
    end)
    if contextOk ~= true or stateOk ~= true or type(contextJson) ~= "string" or type(stateJson) ~= "string" then
        return false
    end
    if jsonString(contextJson, "activeModule") ~= "develop" or
        jsonString(contextJson, "selectedPhotoUuid") ~= command.expectedSelectedPhotoUuid or
        jsonInteger(contextJson, "contextCounter") ~= command.expectedContextCounter or
        jsonInteger(contextJson, "developCounter") ~= command.expectedDevelopCounter or
        jsonInteger(contextJson, "contextChangedAt") ~= command.expectedContextChangedAt or
        jsonString(stateJson, "serverEpoch") ~= command.expectedServerEpoch or
        jsonInteger(stateJson, "revision") ~= command.expectedMaskingRevision then return false end
    if pendingOperationId ~= nil then
        local pendingText = '"pendingOperation":{"operationId":"' .. pendingOperationId .. '"'
        if string.find(stateJson, pendingText, 1, true) == nil then return false end
    end
    local afterPhoto = selectedPhoto()
    return inDevelop() and afterPhoto == photo and photoUuid(afterPhoto) == command.expectedSelectedPhotoUuid
end

local function unavailable(reason)
    return {
        available = false,
        unavailableReason = reason,
        active = nil,
        maskGroupCount = nil,
        hasSelectedMaskGroup = nil,
        selectedMaskGroupIndex = nil,
        selectedMaskGroupId = nil,
        selectedMaskHidden = nil,
        previousAvailable = false,
        nextAvailable = false,
        selectedMaskToolAvailable = false,
        selectedMaskToolId = nil,
        selectedMaskToolHidden = nil,
        selectedMaskToolCount = nil,
        selectedMaskToolIndex = nil,
        previousMaskToolAvailable = false,
        nextMaskToolAvailable = false
    }
end

local function denseArrayLength(value, maximum)
    if type(value) ~= "table" then return nil end
    local count = 0
    local largest = 0
    for key, _ in pairs(value) do
        if type(key) ~= "number" or key < 1 or key ~= math.floor(key) then return nil end
        count = count + 1
        if count > maximum then return nil end
        if key > largest then largest = key end
    end
    if largest ~= count then return nil end
    return count
end

local function validOptionalField(container, key, expectedType)
    return container[key] == nil or type(container[key]) == expectedType
end

local function finiteNumber(value)
    return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

local function validateInventory(masks)
    local maskCount = denseArrayLength(masks, MAX_MASK_GROUPS)
    if maskCount == nil then return nil end
    local normalized = {}
    local maskIds = {}
    local toolIds = {}
    local groupFields = { ID = true, Name = true, Hidden = true, Tools = true }
    local toolFields = {
        ID = true, Name = true, Type = true, Subtype = true, Hidden = true, Inverted = true,
        MaskSubCategoryID = true
    }
    for index = 1, maskCount do
        local mask = masks[index]
        if type(mask) ~= "table" or not validOpaqueId(mask.ID) or maskIds[mask.ID] == true or
            not validOptionalField(mask, "Name", "string") or not validOptionalField(mask, "Hidden", "boolean") then
            return nil
        end
        for key, _ in pairs(mask) do
            if type(key) ~= "string" or groupFields[key] ~= true then return nil end
        end
        maskIds[mask.ID] = true
        local toolCount = denseArrayLength(mask.Tools, MAX_MASK_TOOLS_PER_GROUP)
        if toolCount == nil or toolCount < 1 then return nil end
        local normalizedTools = {}
        for toolIndex = 1, toolCount do
            local tool = mask.Tools[toolIndex]
            if type(tool) ~= "table" or not validOpaqueId(tool.ID) or toolIds[tool.ID] == true or
                not validOptionalField(tool, "Name", "string") or not validOptionalField(tool, "Type", "string") or
                not validOptionalField(tool, "Subtype", "string") or
                not validOptionalField(tool, "Hidden", "boolean") or
                not validOptionalField(tool, "Inverted", "boolean") or
                (tool.MaskSubCategoryID ~= nil and not finiteNumber(tool.MaskSubCategoryID)) then return nil end
            for key, _ in pairs(tool) do
                if type(key) ~= "string" or toolFields[key] ~= true then return nil end
            end
            toolIds[tool.ID] = true
            normalizedTools[toolIndex] = { ID = tool.ID, Hidden = tool.Hidden }
        end
        normalized[index] = { ID = mask.ID, Hidden = mask.Hidden, Tools = normalizedTools }
    end
    return normalized
end

local function readSnapshot(expectedPhotoUuid)
    if not inDevelop() then return unavailable("not_develop") end
    local beforePhoto = selectedPhoto()
    if beforePhoto == nil then return unavailable("no_photo") end
    if expectedPhotoUuid ~= nil and photoUuid(beforePhoto) ~= expectedPhotoUuid then
        return unavailable("context_changed")
    end

    local toolOk, selectedTool = LrTasks.pcall(function()
        return LrDevelopController.getSelectedTool()
    end)
    if toolOk ~= true or type(selectedTool) ~= "string" or selectedTool == "" then
        return unavailable("sdk_error")
    end
    local inventoryOk, allMasks = LrTasks.pcall(function()
        return LrDevelopController.getAllMasks()
    end)
    if inventoryOk ~= true then return unavailable("sdk_unavailable") end
    local masks = validateInventory(allMasks)
    if masks == nil then return unavailable("invalid_inventory") end

    local snapshot = {
        available = true,
        unavailableReason = nil,
        active = selectedTool == "masking",
        maskGroupCount = #masks,
        hasSelectedMaskGroup = nil,
        selectedMaskGroupIndex = nil,
        selectedMaskGroupId = nil,
        selectedMaskHidden = nil,
        previousAvailable = false,
        nextAvailable = false,
        selectedMaskToolAvailable = false,
        selectedMaskToolId = nil,
        selectedMaskToolHidden = nil,
        selectedMaskToolCount = nil,
        selectedMaskToolIndex = nil,
        previousMaskToolAvailable = false,
        nextMaskToolAvailable = false,
        _masks = masks
    }

    if snapshot.active then
        local maskOk, selectedMaskId = LrTasks.pcall(function()
            return LrDevelopController.getSelectedMask()
        end)
        if maskOk ~= true then return unavailable("sdk_error") end
        if selectedMaskId == nil then
            snapshot.hasSelectedMaskGroup = false
        elseif validOpaqueId(selectedMaskId) then
            for index, mask in ipairs(masks) do
                if mask.ID == selectedMaskId then
                    if type(mask.Hidden) ~= "boolean" then return unavailable("invalid_inventory") end
                    snapshot.hasSelectedMaskGroup = true
                    snapshot.selectedMaskGroupIndex = index
                    snapshot.selectedMaskGroupId = selectedMaskId
                    snapshot.selectedMaskHidden = mask.Hidden
                    snapshot.previousAvailable = index > 1
                    snapshot.nextAvailable = index < #masks
                    break
                end
            end
            if snapshot.hasSelectedMaskGroup ~= true then return unavailable("unreconciled_selection") end
            snapshot.selectedMaskToolCount = #masks[snapshot.selectedMaskGroupIndex].Tools

            local maskToolOk, selectedMaskToolId = LrTasks.pcall(function()
                return LrDevelopController.getSelectedMaskTool()
            end)
            if maskToolOk ~= true then return unavailable("sdk_error") end
            if selectedMaskToolId ~= nil then
                if not validOpaqueId(selectedMaskToolId) then return unavailable("unreconciled_tool") end
                for toolIndex, maskTool in ipairs(masks[snapshot.selectedMaskGroupIndex].Tools) do
                    if maskTool.ID == selectedMaskToolId then
                        if type(maskTool.Hidden) ~= "boolean" then return unavailable("invalid_inventory") end
                        snapshot.selectedMaskToolAvailable = true
                        snapshot.selectedMaskToolId = selectedMaskToolId
                        snapshot.selectedMaskToolHidden = maskTool.Hidden
                        snapshot.selectedMaskToolIndex = toolIndex
                        snapshot.previousMaskToolAvailable = toolIndex > 1
                        snapshot.nextMaskToolAvailable = toolIndex < snapshot.selectedMaskToolCount
                        break
                    end
                end
                if snapshot.selectedMaskToolAvailable ~= true then return unavailable("unreconciled_tool") end
            end
        else
            return unavailable("unreconciled_selection")
        end
    end

    local finalToolOk, finalSelectedTool = LrTasks.pcall(function()
        return LrDevelopController.getSelectedTool()
    end)
    local afterPhoto = selectedPhoto()
    if finalToolOk ~= true or finalSelectedTool ~= selectedTool or not inDevelop() or afterPhoto ~= beforePhoto or
        afterPhoto == nil or photoUuid(afterPhoto) ~= photoUuid(beforePhoto) then return unavailable("context_changed") end
    return snapshot
end

local function queryValue(value)
    if value == nil then return "null" end
    if type(value) == "boolean" then return tostring(value) end
    if type(value) == "number" then return tostring(value) end
    return urlEncode(value)
end

local function appendSnapshot(url, snapshot)
    return url ..
        "&available=" .. queryValue(snapshot.available) ..
        "&unavailableReason=" .. queryValue(snapshot.unavailableReason) ..
        "&active=" .. queryValue(snapshot.active) ..
        "&maskGroupCount=" .. queryValue(snapshot.maskGroupCount) ..
        "&hasSelectedMaskGroup=" .. queryValue(snapshot.hasSelectedMaskGroup) ..
        "&selectedMaskGroupIndex=" .. queryValue(snapshot.selectedMaskGroupIndex) ..
        "&selectedMaskGroupId=" .. queryValue(snapshot.selectedMaskGroupId) ..
        "&selectedMaskHidden=" .. queryValue(snapshot.selectedMaskHidden) ..
        "&previousAvailable=" .. queryValue(snapshot.previousAvailable) ..
        "&nextAvailable=" .. queryValue(snapshot.nextAvailable) ..
        "&selectedMaskToolAvailable=" .. queryValue(snapshot.selectedMaskToolAvailable) ..
        "&selectedMaskToolId=" .. queryValue(snapshot.selectedMaskToolId) ..
        "&selectedMaskToolHidden=" .. queryValue(snapshot.selectedMaskToolHidden) ..
        "&selectedMaskToolCount=" .. queryValue(snapshot.selectedMaskToolCount) ..
        "&selectedMaskToolIndex=" .. queryValue(snapshot.selectedMaskToolIndex) ..
        "&previousMaskToolAvailable=" .. queryValue(snapshot.previousMaskToolAvailable) ..
        "&nextMaskToolAvailable=" .. queryValue(snapshot.nextMaskToolAvailable)
end

local function resultBindingUrl(command)
    return "&expectedServerEpoch=" .. urlEncode(command.expectedServerEpoch) ..
        "&expectedMaskingRevision=" .. tostring(command.expectedMaskingRevision) ..
        "&expectedActiveModule=" .. urlEncode(command.expectedActiveModule) ..
        "&expectedSelectedPhotoUuid=" .. urlEncode(command.expectedSelectedPhotoUuid) ..
        "&expectedContextCounter=" .. tostring(command.expectedContextCounter) ..
        "&expectedDevelopCounter=" .. tostring(command.expectedDevelopCounter) ..
        "&expectedContextChangedAt=" .. tostring(command.expectedContextChangedAt)
end

local function sendQueryResult(command, snapshot)
    local url = "http://127.0.0.1:17891/masking/query-result?requestId=" .. urlEncode(command.requestId) ..
        resultBindingUrl(command)
    local ok = LrTasks.pcall(function() LrHttp.get(appendSnapshot(url, snapshot)) end)
    return ok == true
end

local function sendOperationResult(command, outcome, detail, snapshot)
    local url = "http://127.0.0.1:17891/masking/operation-result?operationId=" .. urlEncode(command.operationId) ..
        "&outcome=" .. urlEncode(outcome) .. "&detail=" .. urlEncode(detail or "") .. resultBindingUrl(command)
    local ok = LrTasks.pcall(function()
        LrHttp.get(appendSnapshot(url, snapshot or unavailable("sdk_error")))
    end)
    return ok == true
end

local function settledSnapshot(command, expectedActive, expectedMaskId, expectedMaskToolId,
    expectedMaskHidden, expectedMaskToolHidden)
    local lastSnapshot = unavailable("sdk_error")
    for _ = 1, 12 do
        lastSnapshot = readSnapshot(command.expectedSelectedPhotoUuid)
        if lastSnapshot.available == true and
            (expectedActive == nil or lastSnapshot.active == expectedActive) and
            (expectedMaskId == nil or lastSnapshot.selectedMaskGroupId == expectedMaskId) and
            (expectedMaskToolId == nil or lastSnapshot.selectedMaskToolId == expectedMaskToolId) and
            (expectedMaskHidden == nil or lastSnapshot.selectedMaskHidden == expectedMaskHidden) and
            (expectedMaskToolHidden == nil or lastSnapshot.selectedMaskToolHidden == expectedMaskToolHidden) then
            return lastSnapshot
        end
        LrTasks.sleep(0.05)
    end
    return lastSnapshot
end

local function executeVisibility(command, component)
    if type(command.hidden) ~= "boolean" or type(command.expectedHidden) ~= "boolean" or
        command.hidden == command.expectedHidden or not validOpaqueId(command.expectedSelectedMaskId) or
        not validOpaqueId(command.expectedSelectedMaskToolId) then
        error("Invalid Masking visibility command")
    end
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end

    local before = readSnapshot(command.expectedSelectedPhotoUuid)
    if before.available ~= true or before.active ~= true or before.hasSelectedMaskGroup ~= true or
        before.selectedMaskGroupId ~= command.expectedSelectedMaskId or
        before.selectedMaskToolAvailable ~= true or
        before.selectedMaskToolId ~= command.expectedSelectedMaskToolId then
        sendOperationResult(command, "stale", "The selected mask or component changed.", before)
        return false
    end
    local beforeHidden = before.selectedMaskHidden
    if component then beforeHidden = before.selectedMaskToolHidden end
    if beforeHidden ~= command.expectedHidden then
        sendOperationResult(command, "stale", "Mask visibility changed before the command ran.", before)
        return false
    end
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end

    if component then
        LrDevelopController.toggleHideMaskTool(command.expectedSelectedMaskToolId)
    else
        LrDevelopController.toggleHideMask(command.expectedSelectedMaskId)
    end
    local expectedMaskHidden = command.hidden
    local expectedMaskToolHidden = before.selectedMaskToolHidden
    if component then
        expectedMaskHidden = before.selectedMaskHidden
        expectedMaskToolHidden = command.hidden
    end
    local after = settledSnapshot(command, true, command.expectedSelectedMaskId,
        command.expectedSelectedMaskToolId, expectedMaskHidden, expectedMaskToolHidden)
    if after.available == true and after.active == true and after.hasSelectedMaskGroup == true and
        after.maskGroupCount == before.maskGroupCount and
        after.selectedMaskGroupIndex == before.selectedMaskGroupIndex and
        after.selectedMaskGroupId == before.selectedMaskGroupId and
        after.selectedMaskToolAvailable == true and
        after.selectedMaskToolCount == before.selectedMaskToolCount and
        after.selectedMaskToolIndex == before.selectedMaskToolIndex and
        after.selectedMaskToolId == before.selectedMaskToolId and
        after.selectedMaskHidden == expectedMaskHidden and
        after.selectedMaskToolHidden == expectedMaskToolHidden then
        sendOperationResult(command, "confirmed", "", after)
        return true
    end
    sendOperationResult(command, "failed", "Lightroom did not confirm the Masking visibility change.", after)
    return false
end

local function executeToolNavigation(command)
    if (command.direction ~= "previous" and command.direction ~= "next") or
        not validOpaqueId(command.expectedSelectedMaskId) or
        not validOpaqueId(command.expectedSelectedMaskToolId) then
        error("Invalid Masking component navigation command")
    end
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    local before = readSnapshot(command.expectedSelectedPhotoUuid)
    if before.available ~= true or before.active ~= true or before.hasSelectedMaskGroup ~= true or
        before.selectedMaskGroupId ~= command.expectedSelectedMaskId or
        before.selectedMaskToolAvailable ~= true or
        before.selectedMaskToolId ~= command.expectedSelectedMaskToolId then
        sendOperationResult(command, "stale", "The selected mask component changed.", before)
        return false
    end
    local targetIndex = before.selectedMaskToolIndex + (command.direction == "previous" and -1 or 1)
    if targetIndex < 1 or targetIndex > before.selectedMaskToolCount then
        sendOperationResult(command, "no_change", "There is no mask component in that direction.", before)
        return true
    end
    local selectedMask = before._masks[before.selectedMaskGroupIndex]
    local targetTool = selectedMask and selectedMask.Tools and selectedMask.Tools[targetIndex] or nil
    if type(selectedMask) ~= "table" or selectedMask.ID ~= before.selectedMaskGroupId or
        type(targetTool) ~= "table" or not validOpaqueId(targetTool.ID) then
        sendOperationResult(command, "failed", "The adjacent mask component could not be reconciled.", unavailable("invalid_inventory"))
        return false
    end
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    LrDevelopController.selectMask(selectedMask.ID)
    LrDevelopController.selectMaskTool(targetTool.ID)
    local after = settledSnapshot(command, true, selectedMask.ID, targetTool.ID)
    if after.available == true and after.active == true and
        after.selectedMaskGroupIndex == before.selectedMaskGroupIndex and
        after.selectedMaskGroupId == selectedMask.ID and
        after.selectedMaskToolAvailable == true and
        after.selectedMaskToolCount == before.selectedMaskToolCount and
        after.selectedMaskToolIndex == targetIndex and after.selectedMaskToolId == targetTool.ID then
        sendOperationResult(command, "confirmed", "", after)
        return true
    end
    sendOperationResult(command, "failed", "Lightroom did not confirm the mask component selection.", after)
    return false
end

function Masking.sendRequestedSnapshot(json)
    local command = Parser.parse(json)
    if command == nil or command.command ~= "masking.query" or type(command.requestId) ~= "string" or
        string.match(command.requestId, "^mq%-%d+$") == nil or not serverBindingMatches(command, nil) then return false end
    return sendQueryResult(command, readSnapshot(command.expectedSelectedPhotoUuid))
end

local function executePanel(command)
    if type(command.open) ~= "boolean" then error("Invalid Masking panel command") end
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    local before = readSnapshot(command.expectedSelectedPhotoUuid)
    if before.available ~= true then
        sendOperationResult(command, "failed", "Masking is unavailable.", before)
        return false
    end
    if before.active == command.open then
        sendOperationResult(command, "no_change", "Masking was already in the requested state.", before)
        return true
    end
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    if command.open then LrDevelopController.goToMasking() else LrDevelopController.selectTool("loupe") end
    local after = settledSnapshot(command, command.open, nil)
    if command.open and after.available == true and after.active == true and after.maskGroupCount > 0 and
        (after.hasSelectedMaskGroup ~= true or after.selectedMaskToolAvailable ~= true) then
        local targetIndex = 1
        if after.hasSelectedMaskGroup == true then targetIndex = after.selectedMaskGroupIndex end
        local targetMask = after._masks and after._masks[targetIndex] or nil
        local targetTool = targetMask and targetMask.Tools and targetMask.Tools[1] or nil
        if type(targetMask) ~= "table" or not validOpaqueId(targetMask.ID) or
            type(targetTool) ~= "table" or not validOpaqueId(targetTool.ID) then
            sendOperationResult(command, "failed", "The first available mask could not be reconciled.",
                unavailable("invalid_inventory"))
            return false
        end
        if not serverBindingMatches(command, command.operationId) then
            sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
            return false
        end
        LrDevelopController.selectMask(targetMask.ID)
        LrDevelopController.selectMaskTool(targetTool.ID)
        after = settledSnapshot(command, true, targetMask.ID, targetTool.ID)
    end
    local openSelectionReady = not command.open
    if command.open and after.available == true then
        openSelectionReady = (after.maskGroupCount == 0 and after.hasSelectedMaskGroup == false) or
            (after.maskGroupCount > 0 and after.hasSelectedMaskGroup == true and
                after.selectedMaskToolAvailable == true)
    end
    if after.available == true and after.active == command.open and openSelectionReady then
        sendOperationResult(command, "confirmed", "", after)
        return true
    end
    if after.unavailableReason == "context_changed" then
        sendOperationResult(command, "stale", "Lightroom context changed.", after)
        return false
    end
    sendOperationResult(command, "failed", "Lightroom did not confirm the Masking panel change.", after)
    return false
end

local function executeNavigation(command)
    if (command.direction ~= "previous" and command.direction ~= "next") or
        not validOpaqueId(command.expectedSelectedMaskId) then error("Invalid Masking navigation command") end
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    local before = readSnapshot(command.expectedSelectedPhotoUuid)
    if before.available ~= true or before.active ~= true or before.hasSelectedMaskGroup ~= true or
        before.selectedMaskGroupId ~= command.expectedSelectedMaskId then
        sendOperationResult(command, "stale", "The selected mask changed.", before)
        return false
    end
    local targetIndex = before.selectedMaskGroupIndex + (command.direction == "previous" and -1 or 1)
    if targetIndex < 1 or targetIndex > before.maskGroupCount then
        sendOperationResult(command, "no_change", "There is no mask in that direction.", before)
        return true
    end
    local targetMask = before._masks[targetIndex]
    local targetTool = targetMask and targetMask.Tools and targetMask.Tools[1] or nil
    if type(targetMask) ~= "table" or not validOpaqueId(targetMask.ID) or type(targetTool) ~= "table" or
        not validOpaqueId(targetTool.ID) then
        sendOperationResult(command, "failed", "The adjacent mask could not be reconciled.", unavailable("invalid_inventory"))
        return false
    end
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    LrDevelopController.selectMask(targetMask.ID)
    LrDevelopController.selectMaskTool(targetTool.ID)
    local after = settledSnapshot(command, true, targetMask.ID)
    if after.available == true and after.active == true and after.selectedMaskGroupIndex == targetIndex and
        after.selectedMaskGroupId == targetMask.ID then
        sendOperationResult(command, "confirmed", "", after)
        return true
    end
    sendOperationResult(command, "failed", "Lightroom did not confirm the mask selection.", after)
    return false
end

function Masking.execute(command)
    if not validBinding(command) or type(command.operationId) ~= "string" or
        string.match(command.operationId, "^mo%-%d+$") == nil then error("Invalid Masking command") end
    local ok, result = LrTasks.pcall(function()
        if command.command == "masking.panel.set" then return executePanel(command) end
        if command.command == "masking.group.navigate" then return executeNavigation(command) end
        if command.command == "masking.tool.navigate" then return executeToolNavigation(command) end
        if command.command == "masking.group.visibility.set" then return executeVisibility(command, false) end
        if command.command == "masking.tool.visibility.set" then return executeVisibility(command, true) end
        error("Invalid Masking command")
    end)
    if ok ~= true then
        local fallback = readSnapshot(command.expectedSelectedPhotoUuid)
        sendOperationResult(command, "failed", "Lightroom could not complete the Masking command.", fallback)
        return false
    end
    return result
end

return Masking
