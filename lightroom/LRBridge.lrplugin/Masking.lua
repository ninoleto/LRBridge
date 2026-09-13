local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrDevelopController = import "LrDevelopController"
local LrHttp = import "LrHttp"
local LrTasks = import "LrTasks"
local LrDate = import "LrDate"

local Parser = require "Parser"
local MaskPresets = require "MaskPresets"
local PointColor = require "PointColor"
local ToneCurve = require "ToneCurve"
local MaskToneCurveTrace = require "MaskToneCurveTrace"

local Masking = {}
local MAX_MASK_GROUPS = 512
local MAX_MASK_TOOLS_PER_GROUP = 2048
local CORRECTION_PARAMETERS = {
    "local_Amount",
    "local_Exposure", "local_Contrast", "local_Highlights", "local_Shadows", "local_Whites", "local_Blacks",
    "local_Temperature", "local_Tint", "local_Hue", "local_Saturation", "local_RefineSaturation",
    "local_ToningHue", "local_ToningSaturation", "local_ToningLuminance",
    "local_Texture", "local_Clarity", "local_Dehaze", "local_Grain", "local_Moire", "local_Defringe",
    "local_Sharpness", "local_LuminanceNoise"
}
local CORRECTION_PARAMETER_SET = {}
for _, parameter in ipairs(CORRECTION_PARAMETERS) do CORRECTION_PARAMETER_SET[parameter] = true end
local RESET_PARAMETERS = {
    "local_Amount",
    "local_Exposure", "local_Contrast", "local_Highlights", "local_Shadows", "local_Whites", "local_Blacks",
    "local_Temperature", "local_Tint", "local_Hue", "local_Saturation",
    "local_ToningHue", "local_ToningSaturation",
    "local_Texture", "local_Clarity", "local_Dehaze", "local_Grain", "local_Moire", "local_Defringe",
    "local_Sharpness", "local_LuminanceNoise", "local_PointColors",
    "local_Maincurve", "local_Redcurve", "local_Greencurve", "local_Bluecurve", "local_RefineSaturation"
}
local activeCorrectionGesture = nil

local function stopActiveCorrectionGesture(trace)
    if activeCorrectionGesture == nil then return true end
    local ok, result = LrTasks.pcall(function() return LrDevelopController.stopTracking(true) end)
    MaskToneCurveTrace.record(trace, "stopTracking", { isLocalParam = true, ok = ok, result = result,
        gesture = activeCorrectionGesture })
    activeCorrectionGesture = nil
    return ok == true
end

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

local function validMaskName(value)
    return type(value) == "string" and string.len(value) >= 1 and string.len(value) <= 512 and
        string.find(value, "%c") == nil and string.find(value, "%S") ~= nil
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
        selectedMaskGroupName = nil,
        selectedMaskHidden = nil,
        previousAvailable = false,
        nextAvailable = false,
        selectedMaskToolAvailable = false,
        selectedMaskToolId = nil,
        selectedMaskToolName = nil,
        selectedMaskToolType = nil,
        selectedMaskToolSubtype = nil,
        selectedMaskToolHidden = nil,
        selectedMaskToolCount = nil,
        selectedMaskToolIndex = nil,
        previousMaskToolAvailable = false,
        nextMaskToolAvailable = false,
        corrections = {},
        pointColor = { available = false, swatchCount = 0, selectedIndex = 0, selectionTransient = false },
        curves = { available = false }
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

local function readCorrections()
    local corrections = {}
    for _, parameter in ipairs(CORRECTION_PARAMETERS) do
        local rangeOk, minimum, maximum = LrTasks.pcall(function()
            return LrDevelopController.getRange(parameter)
        end)
        local valueOk, value = LrTasks.pcall(function()
            return LrDevelopController.getValue(parameter)
        end)
        if rangeOk == true and valueOk == true and finiteNumber(minimum) and finiteNumber(maximum) and
            finiteNumber(value) and minimum < maximum and value >= minimum and value <= maximum then
            table.insert(corrections, { parameter = parameter, value = value, min = minimum, max = maximum })
        end
    end
    return corrections
end

local POINT_COLOR_RANGES = { "HueRange", "SatRange", "LumRange" }
local POINT_COLOR_BOUNDARIES = { "LowerNone", "LowerFull", "UpperFull", "UpperNone" }
local POINT_COLOR_PRESET_SOURCES = { "SrcHue", "SrcSat", "SrcLum" }
local POINT_COLOR_PRESET_SCALARS = { "HueShift", "SatScale", "LumScale", "Variance", "RangeAmount" }
local LOCAL_CURVE_FIELDS = {
    rgb = "local_Maincurve", red = "local_Redcurve", green = "local_Greencurve", blue = "local_Bluecurve"
}
local LOCAL_CURVE_CHANNELS = { "rgb", "red", "green", "blue" }

local function readPointColor()
    local ok, result = LrTasks.pcall(function() return PointColor.readContextState(true) end)
    if ok == true and type(result) == "table" then return result end
    return { available = false, swatchCount = 0, selectedIndex = 0, selectionTransient = false }
end

local function validCurve(points)
    if type(points) ~= "table" then return false end
    local count = denseArrayLength(points, 512)
    if count == nil or count < 4 or count % 2 ~= 0 then return false end
    local previousX = nil
    for index = 1, count, 2 do
        local x = points[index]
        local y = points[index + 1]
        if not finiteNumber(x) or x ~= math.floor(x) or x < 0 or x > 255 or not finiteNumber(y) or
            y ~= math.floor(y) or y < 0 or y > 255 or previousX ~= nil and x <= previousX then return false end
        previousX = x
    end
    return points[1] == 0 and points[count - 1] == 255
end

local function normalizeCurve(value)
    return ToneCurve.normalizeCurveValue(value)
end

local function readCurves(trace)
    local result = { available = true }
    for _, channel in ipairs(LOCAL_CURVE_CHANNELS) do
        local ok, value = LrTasks.pcall(function() return LrDevelopController.getValue(LOCAL_CURVE_FIELDS[channel]) end)
        local curve = ok == true and normalizeCurve(value) or nil
        MaskToneCurveTrace.record(trace, "getValue", { channel = channel, field = LOCAL_CURVE_FIELDS[channel],
            ok = ok, raw = value, normalized = curve })
        if curve == nil then return { available = false } end
        result[channel] = curve
    end
    return result
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
        -- An explicitly reported empty Tools array can survive deletion of the final component.
        -- Require complete group metadata; incomplete tool-creation placeholders still fail closed.
        if toolCount == nil or toolCount == 0 and type(mask.Hidden) ~= "boolean" then return nil end
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
            normalizedTools[toolIndex] = {
                ID = tool.ID,
                Name = validMaskName(tool.Name) and tool.Name or nil,
                Type = validMaskName(tool.Type) and tool.Type or nil,
                Subtype = validMaskName(tool.Subtype) and tool.Subtype or nil,
                Hidden = tool.Hidden,
                Inverted = tool.Inverted
            }
        end
        normalized[index] = { ID = mask.ID, Name = validMaskName(mask.Name) and mask.Name or nil,
            Hidden = mask.Hidden, Tools = normalizedTools }
    end
    return normalized
end

local function readInventory(expectedPhotoUuid)
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
        active = selectedTool == "masking" or selectedTool == "local_point_color",
        maskGroupCount = #masks,
        hasSelectedMaskGroup = nil,
        selectedMaskGroupIndex = nil,
        selectedMaskGroupId = nil,
        selectedMaskGroupName = nil,
        selectedMaskHidden = nil,
        previousAvailable = false,
        nextAvailable = false,
        selectedMaskToolAvailable = false,
        selectedMaskToolId = nil,
        selectedMaskToolName = nil,
        selectedMaskToolType = nil,
        selectedMaskToolSubtype = nil,
        selectedMaskToolHidden = nil,
        selectedMaskToolCount = nil,
        selectedMaskToolIndex = nil,
        previousMaskToolAvailable = false,
        nextMaskToolAvailable = false,
        corrections = {},
        pointColor = { available = false, swatchCount = 0, selectedIndex = 0, selectionTransient = false },
        curves = { available = false },
        _masks = masks,
        _photo = beforePhoto,
        _selectedTool = selectedTool
    }

    local finalToolOk, finalTool = LrTasks.pcall(function() return LrDevelopController.getSelectedTool() end)
    if finalToolOk ~= true or finalTool ~= selectedTool or not inDevelop() or selectedPhoto() ~= beforePhoto or
        photoUuid(beforePhoto) ~= expectedPhotoUuid and expectedPhotoUuid ~= nil then return unavailable("context_changed") end
    return snapshot
end

local function readSnapshot(expectedPhotoUuid, trace, deletion)
    local snapshot = readInventory(expectedPhotoUuid)
    if snapshot.available ~= true then return snapshot end
    local masks, beforePhoto, selectedTool = snapshot._masks, snapshot._photo, snapshot._selectedTool
    local observedSelectedMaskId

    if snapshot.active and #masks > 0 then
        local maskOk, selectedMaskId = LrTasks.pcall(function()
            return LrDevelopController.getSelectedMask()
        end)
        if maskOk ~= true then return unavailable("sdk_error") end
        observedSelectedMaskId = selectedMaskId
        if deletion then
            local stillPresent = false
            for _, mask in ipairs(masks) do if mask.ID == selectedMaskId then stillPresent = true end end
            -- Only the delete operation may reconcile its removed ID or an empty SDK selection.
            if selectedMaskId == "" or selectedMaskId == deletion.maskId and not stillPresent then selectedMaskId = nil end
        end
        if selectedMaskId == nil or selectedMaskId == "" then
            snapshot.hasSelectedMaskGroup = false
        elseif validOpaqueId(selectedMaskId) then
            for index, mask in ipairs(masks) do
                if mask.ID == selectedMaskId then
                    if type(mask.Hidden) ~= "boolean" then return unavailable("invalid_inventory") end
                    snapshot.hasSelectedMaskGroup = true
                    snapshot.selectedMaskGroupIndex = index
                    snapshot.selectedMaskGroupId = selectedMaskId
                    snapshot.selectedMaskGroupName = mask.Name
                    snapshot.selectedMaskHidden = mask.Hidden
                    snapshot.previousAvailable = index > 1
                    snapshot.nextAvailable = index < #masks
                    break
                end
            end
            if snapshot.hasSelectedMaskGroup ~= true then return unavailable("unreconciled_selection") end
            snapshot.corrections = readCorrections()
            snapshot.pointColor = readPointColor()
            snapshot.curves = readCurves(trace)
            snapshot.selectedMaskToolCount = #masks[snapshot.selectedMaskGroupIndex].Tools

            local maskToolOk, selectedMaskToolId = LrTasks.pcall(function()
                return LrDevelopController.getSelectedMaskTool()
            end)
            if maskToolOk ~= true then return unavailable("sdk_error") end
            if snapshot.selectedMaskToolCount == 0 then selectedMaskToolId = nil end
            if deletion and (selectedMaskToolId == "" or (deletion.toolIds or {})[selectedMaskToolId]) then
                selectedMaskToolId = nil
            end
            if selectedMaskToolId ~= nil then
                if not validOpaqueId(selectedMaskToolId) then return unavailable("unreconciled_tool") end
                for toolIndex, maskTool in ipairs(masks[snapshot.selectedMaskGroupIndex].Tools) do
                    if maskTool.ID == selectedMaskToolId then
                        if type(maskTool.Hidden) ~= "boolean" then return unavailable("invalid_inventory") end
                        snapshot.selectedMaskToolAvailable = true
                        snapshot.selectedMaskToolId = selectedMaskToolId
                        snapshot.selectedMaskToolName = maskTool.Name
                        snapshot.selectedMaskToolType = maskTool.Type
                        snapshot.selectedMaskToolSubtype = maskTool.Subtype
                        snapshot.selectedMaskToolHidden = maskTool.Hidden
                        snapshot.selectedMaskToolInverted = maskTool.Inverted
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
    elseif snapshot.active then
        -- A complete empty inventory has no selectable mask, regardless of a stale selection getter.
        snapshot.hasSelectedMaskGroup = false
    end

    local finalToolOk, finalSelectedTool = LrTasks.pcall(function()
        return LrDevelopController.getSelectedTool()
    end)
    local finalMaskOk, finalSelectedMaskId = LrTasks.pcall(function()
        return LrDevelopController.getSelectedMask()
    end)
    local afterPhoto = selectedPhoto()
    if finalToolOk ~= true or finalSelectedTool ~= selectedTool or not inDevelop() or afterPhoto ~= beforePhoto or
        afterPhoto == nil or photoUuid(afterPhoto) ~= photoUuid(beforePhoto) or
        (snapshot.active == true and #masks > 0 and
            (finalMaskOk ~= true or finalSelectedMaskId ~= observedSelectedMaskId)) then return unavailable("context_changed") end
    return snapshot
end

local function queryValue(value)
    if value == nil then return "null" end
    if type(value) == "boolean" then return tostring(value) end
    if type(value) == "number" then return tostring(value) end
    return urlEncode(value)
end

local function appendSnapshot(url, snapshot)
    local serializedCorrections = {}
    for _, correction in ipairs(snapshot.corrections or {}) do
        table.insert(serializedCorrections, correction.parameter .. "," .. tostring(correction.value) .. "," ..
            tostring(correction.min) .. "," .. tostring(correction.max))
    end
    local pointColor = snapshot.pointColor or { available = false, swatchCount = 0, selectedIndex = 0,
        selectionTransient = false }
    local serializedPointColor = {
        tostring(pointColor.available == true), tostring(pointColor.swatchCount or 0),
        tostring(pointColor.selectedIndex or 0), tostring(pointColor.selectionTransient == true)
    }
    if pointColor.available == true and pointColor.selectedIndex > 0 then
        for _, field in ipairs({ "HueShift", "SatScale", "LumScale", "Variance", "RangeAmount" }) do
            table.insert(serializedPointColor, tostring(pointColor[field]))
        end
        for _, rangeName in ipairs(POINT_COLOR_RANGES) do
            for _, boundary in ipairs(POINT_COLOR_BOUNDARIES) do
                table.insert(serializedPointColor, tostring(pointColor[rangeName][boundary]))
            end
        end
        for _, rangeName in ipairs(POINT_COLOR_RANGES) do
            table.insert(serializedPointColor, queryValue(pointColor[rangeName .. "Marker"]))
        end
    end
    local function serializePointColorPreset(collection)
        local copied = PointColor.copyCollection(collection)
        if copied == nil then return "null" end
        local values = { tostring(#copied) }
        for _, swatch in ipairs(copied) do
            for _, field in ipairs(POINT_COLOR_PRESET_SOURCES) do values[#values + 1] = tostring(swatch[field]) end
            for _, field in ipairs(POINT_COLOR_PRESET_SCALARS) do values[#values + 1] = tostring(swatch[field]) end
            for _, rangeName in ipairs(POINT_COLOR_RANGES) do
                for _, boundary in ipairs(POINT_COLOR_BOUNDARIES) do
                    values[#values + 1] = tostring(swatch[rangeName][boundary])
                end
            end
        end
        return table.concat(values, ",")
    end
    local curves = snapshot.curves or { available = false }
    local function serializeCurve(points)
        if not validCurve(points) then return "" end
        local values = {}
        for index = 1, #points do values[index] = tostring(points[index]) end
        return table.concat(values, ",")
    end
    return url ..
        "&available=" .. queryValue(snapshot.available) ..
        "&unavailableReason=" .. queryValue(snapshot.unavailableReason) ..
        "&active=" .. queryValue(snapshot.active) ..
        "&maskGroupCount=" .. queryValue(snapshot.maskGroupCount) ..
        "&hasSelectedMaskGroup=" .. queryValue(snapshot.hasSelectedMaskGroup) ..
        "&selectedMaskGroupIndex=" .. queryValue(snapshot.selectedMaskGroupIndex) ..
        "&selectedMaskGroupId=" .. queryValue(snapshot.selectedMaskGroupId) ..
        "&selectedMaskGroupName=" .. queryValue(snapshot.selectedMaskGroupName) ..
        "&selectedMaskHidden=" .. queryValue(snapshot.selectedMaskHidden) ..
        "&previousAvailable=" .. queryValue(snapshot.previousAvailable) ..
        "&nextAvailable=" .. queryValue(snapshot.nextAvailable) ..
        "&selectedMaskToolAvailable=" .. queryValue(snapshot.selectedMaskToolAvailable) ..
        "&selectedMaskToolId=" .. queryValue(snapshot.selectedMaskToolId) ..
        "&selectedMaskToolName=" .. queryValue(snapshot.selectedMaskToolName) ..
        "&selectedMaskToolType=" .. queryValue(snapshot.selectedMaskToolType) ..
        "&selectedMaskToolSubtype=" .. queryValue(snapshot.selectedMaskToolSubtype) ..
        "&selectedMaskToolHidden=" .. queryValue(snapshot.selectedMaskToolHidden) ..
        "&selectedMaskToolInverted=" .. queryValue(snapshot.selectedMaskToolInverted) ..
        "&selectedMaskToolCount=" .. queryValue(snapshot.selectedMaskToolCount) ..
        "&selectedMaskToolIndex=" .. queryValue(snapshot.selectedMaskToolIndex) ..
        "&previousMaskToolAvailable=" .. queryValue(snapshot.previousMaskToolAvailable) ..
        "&nextMaskToolAvailable=" .. queryValue(snapshot.nextMaskToolAvailable) ..
        "&corrections=" .. urlEncode(table.concat(serializedCorrections, ";")) ..
        "&pointColor=" .. urlEncode(table.concat(serializedPointColor, ",")) ..
        "&pointColorPreset=" .. urlEncode(serializePointColorPreset(pointColor.presetCollection)) ..
        "&curvesAvailable=" .. tostring(curves.available == true) ..
        "&localCurveRgb=" .. urlEncode(serializeCurve(curves.rgb)) ..
        "&localCurveRed=" .. urlEncode(serializeCurve(curves.red)) ..
        "&localCurveGreen=" .. urlEncode(serializeCurve(curves.green)) ..
        "&localCurveBlue=" .. urlEncode(serializeCurve(curves.blue))
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

local function traceDeletion(command, phase, message)
    if command.command ~= "masking.selected.delete" and command.command ~= "masking.all.delete" then return end
    -- Append to the existing local plug-in log; no extra HTTP/SDK work or state writes.
    pcall(function()
        if not _PLUGIN or type(_PLUGIN.path) ~= "string" then return end
        local root = string.gsub(_PLUGIN.path, "[/\\]lightroom[/\\]LRBridge%.lrplugin$", "")
        if root == _PLUGIN.path then root = _PLUGIN.path .. "\\..\\.." end
        local file = io.open(root .. "\\lrplugin-log.txt", "a")
        if file then
            local text = tostring(type(message) == "function" and message() or message)
            local clipped = string.len(text) > 65536
            file:write(os.date("%Y-%m-%d %H:%M:%S") .. " MaskDeletion: version=mask-delete-confirmation-1 operation=" ..
                tostring(command.operationId) .. " phase=" .. phase .. " length=" .. tostring(string.len(text)) ..
                " truncated=" .. tostring(clipped) .. " " .. string.sub(text, 1, 65536) .. "\n")
            file:close()
        end
    end)
end

local function sendOperationResult(command, outcome, detail, snapshot, presetDiagnostics, deletion)
    local url = "http://127.0.0.1:17891/masking/operation-result?operationId=" .. urlEncode(command.operationId) ..
        "&outcome=" .. urlEncode(outcome) .. "&detail=" .. urlEncode(detail or "") .. resultBindingUrl(command)
    if command.command == "masking.component.delete" or command.command == "masking.component.invert" then
        url = url .. "&targetMaskId=" .. urlEncode(command.expectedSelectedMaskId) ..
            "&targetToolId=" .. urlEncode(command.expectedSelectedMaskToolId)
    end
    if type(presetDiagnostics) == "string" and string.len(presetDiagnostics) > 0 then
        url = url .. "&presetDiagnostics=" .. urlEncode(presetDiagnostics)
    end
    if deletion then
        local beforeIds, afterIds = {}, {}
        for _, mask in ipairs(deletion.before) do table.insert(beforeIds, (urlEncode(mask.ID))) end
        for _, mask in ipairs(deletion.after) do table.insert(afterIds, (urlEncode(mask.ID))) end
        url = url .. "&deletionBefore=" .. urlEncode(table.concat(beforeIds, ",")) ..
            "&deletionAfter=" .. urlEncode(table.concat(afterIds, ","))
        if deletion.components then
            beforeIds, afterIds = {}, {}
            for _, tool in ipairs(deletion.components.before) do table.insert(beforeIds, (urlEncode(tool.ID))) end
            for _, tool in ipairs(deletion.components.after) do table.insert(afterIds, (urlEncode(tool.ID))) end
            url = url .. "&componentBefore=" .. urlEncode(table.concat(beforeIds, ",")) ..
                "&componentAfter=" .. urlEncode(table.concat(afterIds, ","))
        end
    end
    local ok, body, headers = LrTasks.pcall(function()
        local requestUrl = appendSnapshot(url, snapshot or unavailable("sdk_error"))
        traceDeletion(command, "submitted", requestUrl)
        return LrHttp.get(requestUrl)
    end)
    traceDeletion(command, "response", function() return "pcall=" .. tostring(ok) .. " status=" ..
        tostring(type(headers) == "table" and headers.status or nil) .. " body=" .. tostring(body) end)
    return ok == true
end

local function sendCorrectionResult(command, outcome, detail, snapshot)
    local expectedValue = command.value
    if expectedValue == nil then expectedValue = "null" end
    local url = "http://127.0.0.1:17891/masking/correction-result?correctionSequence=" ..
        tostring(command.correctionSequence) .. "&gestureId=" .. urlEncode(command.gestureId or "") ..
        "&kind=" .. urlEncode(command.command) .. "&parameter=" .. urlEncode(command.parameter) ..
        "&outcome=" .. urlEncode(outcome) .. "&detail=" .. urlEncode(detail or "") ..
        "&expectedValue=" .. tostring(expectedValue) .. "&expectedSelectedMaskId=" ..
        urlEncode(command.expectedSelectedMaskId) .. resultBindingUrl(command)
    local ok = LrTasks.pcall(function()
        LrHttp.get(appendSnapshot(url, snapshot or unavailable("sdk_error")))
    end)
    return ok == true
end

local function sendEditResult(command, outcome, detail, snapshot, trace)
    local url = "http://127.0.0.1:17891/masking/edit-result?editSequence=" .. tostring(command.editSequence) ..
        "&kind=" .. urlEncode(command.command) .. "&outcome=" .. urlEncode(outcome) ..
        "&detail=" .. urlEncode(detail or "") .. "&expectedSelectedMaskId=" ..
        urlEncode(command.expectedSelectedMaskId) .. resultBindingUrl(command)
    local ok, response = LrTasks.pcall(function()
        return LrHttp.get(appendSnapshot(url, snapshot or unavailable("sdk_error")))
    end)
    MaskToneCurveTrace.record(trace, "editResult", { outcome = outcome, detail = detail,
        selectedMaskGroupId = snapshot and snapshot.selectedMaskGroupId,
        snapshotAvailable = snapshot and snapshot.available, curves = snapshot and snapshot.curves,
        transportOk = ok, response = response })
    return ok == true
end

local function correctionFromSnapshot(snapshot, parameter)
    if type(snapshot) ~= "table" or type(snapshot.corrections) ~= "table" then return nil end
    for _, correction in ipairs(snapshot.corrections) do
        if correction.parameter == parameter then return correction end
    end
    return nil
end

local function correctionBindingMatches(command, trace)
    if not validBinding(command) or not validOpaqueId(command.expectedSelectedMaskId) or not inDevelop() then return false end
    local photo = selectedPhoto()
    if photo == nil or photoUuid(photo) ~= command.expectedSelectedPhotoUuid then return false end
    local contextOk, contextJson = LrTasks.pcall(function()
        return LrHttp.get("http://127.0.0.1:17891/context")
    end)
    local stateOk, stateJson = LrTasks.pcall(function()
        return LrHttp.get("http://127.0.0.1:17891/masking/state")
    end)
    MaskToneCurveTrace.record(trace, "binding", { contextOk = contextOk, context = contextJson,
        stateOk = stateOk, state = stateJson })
    if contextOk ~= true or stateOk ~= true or type(contextJson) ~= "string" or type(stateJson) ~= "string" then
        return false
    end
    local currentRevision = jsonInteger(stateJson, "revision")
    if jsonString(contextJson, "activeModule") ~= "develop" or
        jsonString(contextJson, "selectedPhotoUuid") ~= command.expectedSelectedPhotoUuid or
        jsonInteger(contextJson, "contextCounter") ~= command.expectedContextCounter or
        jsonInteger(contextJson, "developCounter") ~= command.expectedDevelopCounter or
        jsonInteger(contextJson, "contextChangedAt") ~= command.expectedContextChangedAt or
        jsonString(stateJson, "serverEpoch") ~= command.expectedServerEpoch or currentRevision == nil or
        currentRevision < command.expectedMaskingRevision or
        jsonString(stateJson, "selectedMaskGroupId") ~= command.expectedSelectedMaskId then return false end
    local maskOk, selectedMaskId = LrTasks.pcall(function() return LrDevelopController.getSelectedMask() end)
    local afterPhoto = selectedPhoto()
    return maskOk == true and selectedMaskId == command.expectedSelectedMaskId and inDevelop() and
        afterPhoto == photo and photoUuid(afterPhoto) == command.expectedSelectedPhotoUuid
end

local function settledCorrectionSnapshot(command, expectedValue)
    local lastSnapshot = unavailable("sdk_error")
    for _ = 1, 12 do
        lastSnapshot = readSnapshot(command.expectedSelectedPhotoUuid)
        local correction = correctionFromSnapshot(lastSnapshot, command.parameter)
        if lastSnapshot.available == true and lastSnapshot.active == true and
            lastSnapshot.selectedMaskGroupId == command.expectedSelectedMaskId and correction ~= nil and
            (expectedValue == nil or math.abs(correction.value - expectedValue) <=
                math.max(0.000000001, math.abs(expectedValue) * 0.000000001)) then return lastSnapshot
        end
        LrTasks.sleep(0.05)
    end
    return lastSnapshot
end

local function settledResetSnapshot(command)
    local lastSnapshot = unavailable("sdk_error")
    local previousValue = nil
    for _ = 1, 12 do
        lastSnapshot = readSnapshot(command.expectedSelectedPhotoUuid)
        local correction = correctionFromSnapshot(lastSnapshot, command.parameter)
        if lastSnapshot.available == true and lastSnapshot.active == true and
            lastSnapshot.selectedMaskGroupId == command.expectedSelectedMaskId and correction ~= nil then
            if previousValue ~= nil and math.abs(correction.value - previousValue) <=
                math.max(0.000000001, math.abs(correction.value) * 0.000000001) then return lastSnapshot end
            previousValue = correction.value
        else
            previousValue = nil
        end
        LrTasks.sleep(0.05)
    end
    return lastSnapshot
end

local function executeCorrection(command)
    local gestureCommand = command.command ~= "masking.correction.reset"
    local carriesValue = command.command == "masking.correction.gesture.update" or
        command.command == "masking.correction.gesture.end"
    if CORRECTION_PARAMETER_SET[command.parameter] ~= true or not validInteger(command.correctionSequence) or
        command.correctionSequence < 1 or not validOpaqueId(command.expectedSelectedMaskId) or
        (gestureCommand and (type(command.gestureId) ~= "string" or
            string.match(command.gestureId, "^mg%-%w[%w_%-]*$") == nil)) or
        (carriesValue and not finiteNumber(command.value)) then error("Invalid Masking correction command") end
    if not correctionBindingMatches(command) then
        if activeCorrectionGesture ~= nil and activeCorrectionGesture.id == command.gestureId then
            stopActiveCorrectionGesture()
        end
        if carriesValue or command.command == "masking.correction.reset" then
            sendCorrectionResult(command, "stale", "The selected mask or Lightroom context changed.",
                unavailable("context_changed"))
        end
        return false
    end
    local before = readSnapshot(command.expectedSelectedPhotoUuid)
    local correction = correctionFromSnapshot(before, command.parameter)
    if before.available ~= true or before.active ~= true or
        before.selectedMaskGroupId ~= command.expectedSelectedMaskId or correction == nil then
        if carriesValue or command.command == "masking.correction.reset" then
            sendCorrectionResult(command, "stale", "That Masking correction is no longer available.", before)
        end
        return false
    end
    if carriesValue and (command.value < correction.min or command.value > correction.max) then
        sendCorrectionResult(command, "failed", "The requested value is outside Lightroom's current range.", before)
        return false
    end

    if command.command == "masking.correction.gesture.begin" then
        if activeCorrectionGesture ~= nil then stopActiveCorrectionGesture() end
        local startOk = LrTasks.pcall(function() LrDevelopController.startTracking(command.parameter) end)
        if startOk == true then
            activeCorrectionGesture = { id = command.gestureId, parameter = command.parameter,
                maskId = command.expectedSelectedMaskId }
        end
        return startOk == true
    end
    if command.command == "masking.correction.gesture.cancel" then
        return stopActiveCorrectionGesture()
    end

    if command.command == "masking.correction.reset" then
        if activeCorrectionGesture ~= nil then stopActiveCorrectionGesture() end
        local resetOk = LrTasks.pcall(function() LrDevelopController.resetToDefault(command.parameter) end)
        if resetOk ~= true then
            sendCorrectionResult(command, "failed", "Lightroom could not reset that Masking correction.", before)
            return false
        end
        local afterReset = settledResetSnapshot(command)
        if correctionFromSnapshot(afterReset, command.parameter) ~= nil then
            sendCorrectionResult(command, "confirmed", "", afterReset)
            return true
        end
        sendCorrectionResult(command, "failed", "Lightroom did not report the reset correction.", afterReset)
        return false
    end

    if activeCorrectionGesture == nil or activeCorrectionGesture.id ~= command.gestureId or
        activeCorrectionGesture.parameter ~= command.parameter or
        activeCorrectionGesture.maskId ~= command.expectedSelectedMaskId then
        if activeCorrectionGesture ~= nil then stopActiveCorrectionGesture() end
        local startOk = LrTasks.pcall(function() LrDevelopController.startTracking(command.parameter) end)
        if startOk ~= true then
            sendCorrectionResult(command, "failed", "Lightroom could not begin that Masking adjustment.", before)
            return false
        end
        activeCorrectionGesture = { id = command.gestureId, parameter = command.parameter,
            maskId = command.expectedSelectedMaskId }
    end
    local setOk = LrTasks.pcall(function() LrDevelopController.setValue(command.parameter, command.value) end)
    local stopOk = true
    if command.command == "masking.correction.gesture.end" then
        stopOk = stopActiveCorrectionGesture()
    end
    if setOk ~= true or stopOk ~= true then
        sendCorrectionResult(command, "failed", "Lightroom could not apply that Masking correction.", before)
        return false
    end
    local after = settledCorrectionSnapshot(command, command.value)
    local authoritative = correctionFromSnapshot(after, command.parameter)
    if authoritative ~= nil and math.abs(authoritative.value - command.value) <=
        math.max(0.000000001, math.abs(command.value) * 0.000000001) then
        sendCorrectionResult(command, "confirmed", "", after)
        return true
    end
    sendCorrectionResult(command, "failed", "Lightroom did not confirm that Masking correction.", after)
    return false
end

local function stableValue(value, depth, seen)
    local valueType = type(value)
    if valueType == "nil" then return "nil" end
    if valueType == "boolean" or valueType == "string" then return valueType .. ":" .. tostring(value) end
    if valueType == "number" then
        if not finiteNumber(value) then return nil end
        return "number:" .. tostring(value)
    end
    if valueType ~= "table" or depth > 8 or seen[value] then return nil end
    seen[value] = true
    local entries = {}
    local count = 0
    for key, child in pairs(value) do
        local keyType = type(key)
        if keyType ~= "string" and keyType ~= "number" then seen[value] = nil; return nil end
        local childText = stableValue(child, depth + 1, seen)
        if childText == nil then seen[value] = nil; return nil end
        count = count + 1
        if count > 4096 then seen[value] = nil; return nil end
        entries[count] = keyType .. ":" .. tostring(key) .. "=" .. childText
    end
    table.sort(entries)
    seen[value] = nil
    return "table:{" .. table.concat(entries, ",") .. "}"
end

local function copyResetValue(value, depth, seen)
    local valueType = type(value)
    if valueType == "number" then if finiteNumber(value) then return value end; return nil end
    if valueType == "boolean" or valueType == "string" then return value end
    if valueType ~= "table" or depth > 8 or seen[value] then return nil end
    seen[value] = true
    local copy = {}
    local count = 0
    for key, child in pairs(value) do
        if type(key) ~= "number" and type(key) ~= "string" then seen[value] = nil; return nil end
        local childCopy = copyResetValue(child, depth + 1, seen)
        if childCopy == nil then seen[value] = nil; return nil end
        count = count + 1
        if count > 4096 then seen[value] = nil; return nil end
        copy[key] = childCopy
    end
    seen[value] = nil
    return copy
end

local function readableResetParameters()
    local readable = {}
    local baselines = {}
    for _, parameter in ipairs(RESET_PARAMETERS) do
        local ok, value = LrTasks.pcall(function() return LrDevelopController.getValue(parameter) end)
        local baseline = ok == true and copyResetValue(value, 0, {}) or nil
        if baseline ~= nil and stableValue(value, 0, {}) ~= nil then
            table.insert(readable, parameter)
            baselines[parameter] = baseline
        end
    end
    return readable, baselines
end

local function resetFingerprint(parameters)
    local values = {}
    for _, parameter in ipairs(parameters) do
        local ok, value = LrTasks.pcall(function() return LrDevelopController.getValue(parameter) end)
        local serialized = ok == true and stableValue(value, 0, {}) or nil
        if serialized == nil then return nil end
        table.insert(values, parameter .. "=" .. serialized)
    end
    return table.concat(values, "|")
end

local function resetParameters(parameters)
    for _, parameter in ipairs(parameters) do
        local ok = LrTasks.pcall(function() LrDevelopController.resetToDefault(parameter) end)
        if ok ~= true then return false end
    end
    return true
end

local function rollbackResetParameters(command, before, parameters, baselines)
    if not serverBindingMatches(command, command.operationId) then return false end
    local current = readSnapshot(command.expectedSelectedPhotoUuid)
    if current.available ~= true or current.active ~= true or current.hasSelectedMaskGroup ~= true or
        current.selectedMaskGroupId ~= before.selectedMaskGroupId or
        current.selectedMaskToolAvailable ~= before.selectedMaskToolAvailable or
        current.selectedMaskToolId ~= before.selectedMaskToolId then return false end
    local restored = true
    for _, parameter in ipairs(parameters) do
        local baseline = copyResetValue(baselines[parameter], 0, {})
        local ok = baseline ~= nil and LrTasks.pcall(function() LrDevelopController.setValue(parameter, baseline) end)
        if ok ~= true then restored = false end
    end
    return restored
end

local function deletedInventoryMatches(before, after, removedId)
    if after.available ~= true or after.maskGroupCount ~= before.maskGroupCount - 1 then return false end
    local remaining = {}
    for _, mask in ipairs(before._masks) do if mask.ID ~= removedId then remaining[mask.ID] = true end end
    for _, mask in ipairs(after._masks) do if not remaining[mask.ID] then return false end end
    return true
end

local function settleDeletedSelection(command, before, removedInventory, components)
    local deletion = { maskId = command.expectedSelectedMaskId, toolIds = {} }
    for _, tool in ipairs(before._masks[before.selectedMaskGroupIndex].Tools) do deletion.toolIds[tool.ID] = true end
    local proof = { before = before._masks, after = removedInventory._masks, components = components }
    local neighbor = before._masks[before.selectedMaskGroupIndex + 1] or before._masks[before.selectedMaskGroupIndex - 1]
    local selectedOnce, componentOnce = false, false
    local after = readSnapshot(command.expectedSelectedPhotoUuid, nil, deletion)
    local function incomplete(detail)
        if components then detail = "Component and parent mask deleted. " .. detail end
        sendOperationResult(command, "deleted", detail, after, nil, proof)
        return true -- Removal succeeded; it must never be retried as a deletion failure.
    end
    local function selectionStillMatches(maskId)
        local maskOk, currentMaskId = LrTasks.pcall(function() return LrDevelopController.getSelectedMask() end)
        if not maskOk then return false end
        if maskId then
            if currentMaskId ~= maskId then return false end
            local toolOk, currentToolId = LrTasks.pcall(function() return LrDevelopController.getSelectedMaskTool() end)
            if not toolOk or currentToolId ~= nil and currentToolId ~= "" and not deletion.toolIds[currentToolId] then return false end
        elseif currentMaskId ~= nil and currentMaskId ~= "" and currentMaskId ~= deletion.maskId then return false end
        return inDevelop() and selectedPhoto() == before._photo and photoUuid(selectedPhoto()) == command.expectedSelectedPhotoUuid
    end
    for _ = 1, 12 do
        if not serverBindingMatches(command, command.operationId) then
            after = unavailable("context_changed")
            return incomplete("Mask deleted; replacement selection was cancelled because Lightroom context changed.")
        end
        local inventory = readInventory(command.expectedSelectedPhotoUuid)
        if not deletedInventoryMatches(before, inventory, command.expectedSelectedMaskId) then
            after = readSnapshot(command.expectedSelectedPhotoUuid, nil, deletion)
            return incomplete("Mask was deleted; Lightroom's inventory changed before replacement selection finished.")
        end
        after = readSnapshot(command.expectedSelectedPhotoUuid, nil, deletion)
        if after.available == true and deletedInventoryMatches(before, after, command.expectedSelectedMaskId) then
            if after.maskGroupCount == 0 or (after.hasSelectedMaskGroup == true and
                (after.selectedMaskToolAvailable == true or after.selectedMaskToolCount == 0)) then
                sendOperationResult(command, "confirmed", "", after, nil, proof)
                return true
            end
            if after.active ~= true then
                return incomplete("Mask deleted; Masking closed before a remaining mask could be selected.")
            end
            if after.hasSelectedMaskGroup == true then
                -- Preserve any surviving native/user-selected group; supply its first component only if absent.
                if not componentOnce and selectionStillMatches(after.selectedMaskGroupId) then
                    local targetTool = after._masks[after.selectedMaskGroupIndex].Tools[1]
                    componentOnce = true
                    local ok = LrTasks.pcall(function() LrDevelopController.selectMaskTool(targetTool.ID) end)
                    if not ok then
                        after = readSnapshot(command.expectedSelectedPhotoUuid, nil, deletion)
                        return incomplete("Mask deleted, but Lightroom could not select its replacement component. Select a component in Lightroom.")
                    end
                end
            elseif not selectedOnce and selectionStillMatches(nil) then
                selectedOnce = true
                local ok = LrTasks.pcall(function() LrDevelopController.selectMask(neighbor.ID) end)
                if not ok then
                    after = readSnapshot(command.expectedSelectedPhotoUuid, nil, deletion)
                    return incomplete("Mask deleted, but Lightroom could not select a remaining mask. Select a mask in Lightroom.")
                end
            end
        end
        LrTasks.sleep(0.05)
    end
    after = readSnapshot(command.expectedSelectedPhotoUuid, nil, deletion)
    return incomplete("Mask deleted, but Lightroom did not confirm a replacement mask/component selection. Select a mask in Lightroom.")
end

local function componentRemovalProof(command, before, after)
    if after.available ~= true then return nil end
    local target = before._masks[before.selectedMaskGroupIndex]
    local groups, parent = {}, nil
    for _, mask in ipairs(after._masks) do
        groups[mask.ID] = mask
        if mask.ID == target.ID then parent = mask end
    end
    if #after._masks ~= #before._masks - (parent and 0 or 1) or not parent and #target.Tools ~= 1 then return nil end
    for _, old in ipairs(before._masks) do
        local current = groups[old.ID]
        if old.ID ~= target.ID or parent then
            if not current or #current.Tools ~= #old.Tools - (old.ID == target.ID and 1 or 0) then return nil end
            local remaining = {}
            for _, tool in ipairs(old.Tools) do if tool.ID ~= command.expectedSelectedMaskToolId then remaining[tool.ID] = true end end
            for _, tool in ipairs(current.Tools) do if not remaining[tool.ID] then return nil end end
        end
    end
    return { before = before._masks, after = after._masks,
        components = { before = target.Tools, after = parent and parent.Tools or {} }, parentRemoved = parent == nil }
end

local function settleDeletedComponent(command, before, removedInventory, proof)
    if proof.parentRemoved then
        -- The SDK removed the parent. Reuse whole-group recovery without another delete call.
        return settleDeletedSelection(command, before, removedInventory, proof.components)
    end
    local deletion = { maskId = command.expectedSelectedMaskId, toolIds = { [command.expectedSelectedMaskToolId] = true } }
    local tools = before._masks[before.selectedMaskGroupIndex].Tools
    local neighbor = tools[before.selectedMaskToolIndex + 1] or tools[before.selectedMaskToolIndex - 1]
    local maskOnce, toolOnce = false, false
    local after
    local function incomplete(detail)
        sendOperationResult(command, "deleted", detail, after, nil, proof)
        return true
    end
    local function selectionStillMatches(maskId)
        local maskOk, currentMask = LrTasks.pcall(function() return LrDevelopController.getSelectedMask() end)
        local toolOk, currentTool = LrTasks.pcall(function() return LrDevelopController.getSelectedMaskTool() end)
        if not maskOk or not toolOk then return false end
        if maskId then
            if currentMask ~= maskId then return false end
        elseif currentMask ~= nil and currentMask ~= "" then return false end
        return (currentTool == nil or currentTool == "" or currentTool == command.expectedSelectedMaskToolId) and
            inDevelop() and selectedPhoto() == before._photo and photoUuid(selectedPhoto()) == command.expectedSelectedPhotoUuid
    end
    for _ = 1, 12 do
        if not serverBindingMatches(command, command.operationId) then
            after = unavailable("context_changed")
            return incomplete("Component deleted; replacement selection cancelled because Lightroom context changed.")
        end
        local inventory = readInventory(command.expectedSelectedPhotoUuid)
        if not componentRemovalProof(command, before, inventory) then
            after = readSnapshot(command.expectedSelectedPhotoUuid, nil, deletion)
            return incomplete("Component deleted; the inventory changed before replacement selection finished.")
        end
        after = readSnapshot(command.expectedSelectedPhotoUuid, nil, deletion)
        if after.available == true and componentRemovalProof(command, before, after) then
            if after.hasSelectedMaskGroup == true and (after.selectedMaskToolAvailable == true or after.selectedMaskToolCount == 0) then
                sendOperationResult(command, "confirmed", "", after, nil, proof)
                return true
            end
            if after.active ~= true then return incomplete("Component deleted; Masking closed before selection was confirmed.") end
            if after.hasSelectedMaskGroup == true then
                if after.selectedMaskGroupId ~= command.expectedSelectedMaskId then
                    return incomplete("Component deleted; the newer mask selection was preserved. Select a component in Lightroom.")
                end
                if neighbor and not toolOnce and selectionStillMatches(command.expectedSelectedMaskId) then
                    toolOnce = true
                    local ok = LrTasks.pcall(function() LrDevelopController.selectMaskTool(neighbor.ID) end)
                    if not ok then
                        after = readSnapshot(command.expectedSelectedPhotoUuid, nil, deletion)
                        return incomplete("Component deleted, but Lightroom could not select a remaining component. Select a component in Lightroom.")
                    end
                end
            elseif not maskOnce and selectionStillMatches(nil) then
                maskOnce = true
                local ok = LrTasks.pcall(function() LrDevelopController.selectMask(command.expectedSelectedMaskId) end)
                if not ok then
                    after = readSnapshot(command.expectedSelectedPhotoUuid, nil, deletion)
                    return incomplete("Component deleted, but Lightroom could not select its parent mask. Select a mask in Lightroom.")
                end
            end
        end
        LrTasks.sleep(0.05)
    end
    after = readSnapshot(command.expectedSelectedPhotoUuid, nil, deletion)
    return incomplete("Component deleted, but Lightroom did not confirm a replacement selection. Select a component in Lightroom.")
end

local function executeComponentDelete(command)
    if not validOpaqueId(command.expectedSelectedMaskId) or not validOpaqueId(command.expectedSelectedMaskToolId) or
        not validInteger(command.expectedMaskCount) or command.expectedMaskCount < 1 or
        not validInteger(command.expectedMaskToolCount) or command.expectedMaskToolCount < 1 then error("Invalid Delete Component command") end
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    if activeCorrectionGesture ~= nil then stopActiveCorrectionGesture() end
    local before = readSnapshot(command.expectedSelectedPhotoUuid)
    if before.available ~= true or before.active ~= true or before.hasSelectedMaskGroup ~= true or before.selectedMaskToolAvailable ~= true or
        before.selectedMaskGroupId ~= command.expectedSelectedMaskId or before.selectedMaskToolId ~= command.expectedSelectedMaskToolId or
        before.maskGroupCount ~= command.expectedMaskCount or before.selectedMaskToolCount ~= command.expectedMaskToolCount then
        sendOperationResult(command, "stale", "The selected photo, mask or component changed before deletion.", before)
        return false
    end
    -- SDK 15.3 names the tool-ID parameter under an ambiguous (id, param) heading.
    -- Use the ID call convention shared with selectMaskTool/deleteMask; never retry with another signature.
    if not inDevelop() or selectedPhoto() ~= before._photo or photoUuid(selectedPhoto()) ~= command.expectedSelectedPhotoUuid or
        LrDevelopController.getSelectedMask() ~= command.expectedSelectedMaskId or
        LrDevelopController.getSelectedMaskTool() ~= command.expectedSelectedMaskToolId then
        sendOperationResult(command, "stale", "The selected photo, mask or component changed before deletion.", unavailable("context_changed"))
        return false
    end
    local ok = LrTasks.pcall(function() LrDevelopController.deleteMaskTool(command.expectedSelectedMaskToolId) end)
    if not ok then
        sendOperationResult(command, "failed", "Lightroom could not delete the selected component.", readSnapshot(command.expectedSelectedPhotoUuid))
        return false
    end
    for _ = 1, 12 do
        local after = readInventory(command.expectedSelectedPhotoUuid)
        if after.unavailableReason == "context_changed" or after.unavailableReason == "not_develop" or after.unavailableReason == "no_photo" then
            sendOperationResult(command, "stale", "Lightroom context changed during component deletion.", after)
            return false
        end
        local proof = componentRemovalProof(command, before, after)
        if proof then return settleDeletedComponent(command, before, after, proof) end
        LrTasks.sleep(0.05)
    end
    sendOperationResult(command, "failed", "Lightroom did not confirm removal of the selected component. Check its inventory before another delete.",
        readSnapshot(command.expectedSelectedPhotoUuid))
    return false
end

local function executeSelectedDelete(command)
    if not validOpaqueId(command.expectedSelectedMaskId) or not validInteger(command.expectedMaskCount) or
        command.expectedMaskCount < 1 then error("Invalid Delete Mask command") end
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    if activeCorrectionGesture ~= nil then stopActiveCorrectionGesture() end
    -- Read immediately before the write, after the yielding server-binding checks.
    local before = readSnapshot(command.expectedSelectedPhotoUuid)
    if before.available ~= true or before.active ~= true or before.hasSelectedMaskGroup ~= true or
        before.selectedMaskGroupId ~= command.expectedSelectedMaskId or before.maskGroupCount ~= command.expectedMaskCount then
        sendOperationResult(command, "stale", "The selected mask or photo's inventory changed.", before)
        return false
    end
    local deleteOk = LrTasks.pcall(function() LrDevelopController.deleteMask(command.expectedSelectedMaskId) end)
    if deleteOk ~= true then
        sendOperationResult(command, "failed", "Lightroom could not delete the selected mask.", before)
        return false
    end
    local after = unavailable("sdk_error")
    for _ = 1, 12 do
        after = readInventory(command.expectedSelectedPhotoUuid)
        if after.unavailableReason == "context_changed" or after.unavailableReason == "not_develop" or
            after.unavailableReason == "no_photo" then
            sendOperationResult(command, "stale", "Lightroom context changed during mask deletion.", after)
            return false
        end
        if deletedInventoryMatches(before, after, command.expectedSelectedMaskId) then
            return settleDeletedSelection(command, before, after)
        end
        LrTasks.sleep(0.05)
    end
    sendOperationResult(command, "failed", "Lightroom did not confirm that the selected mask was deleted.",
        readSnapshot(command.expectedSelectedPhotoUuid))
    return false
end

local function executeDeleteAll(command)
    if not validInteger(command.expectedMaskCount) or command.expectedMaskCount < 1 then
        error("Invalid Delete All Masks command")
    end
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    if activeCorrectionGesture ~= nil then stopActiveCorrectionGesture() end
    local before = readSnapshot(command.expectedSelectedPhotoUuid)
    if before.available ~= true or before.maskGroupCount ~= command.expectedMaskCount then
        sendOperationResult(command, "stale", "The selected photo's mask inventory changed.", before)
        return false
    end
    local resetOk = LrTasks.pcall(function() LrDevelopController.resetMasking() end)
    if resetOk ~= true then
        sendOperationResult(command, "failed", "Lightroom could not delete all masks.", before)
        return false
    end
    local after = unavailable("sdk_error")
    for _ = 1, 12 do
        after = readSnapshot(command.expectedSelectedPhotoUuid, nil, {})
        if after.unavailableReason == "context_changed" or after.unavailableReason == "not_develop" or
            after.unavailableReason == "no_photo" then
            sendOperationResult(command, "stale", "Lightroom context changed during mask deletion.", after)
            return false
        end
        if after.available == true and after.maskGroupCount == 0 and after.hasSelectedMaskGroup ~= true then
            sendOperationResult(command, "confirmed", "", after)
            return true
        end
        LrTasks.sleep(0.05)
    end
    sendOperationResult(command, "failed", "Lightroom did not confirm that all masks were deleted.", after)
    return false
end

local function executeSelectedReset(command)
    if not validOpaqueId(command.expectedSelectedMaskId) then error("Invalid selected-mask Reset command") end
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
    local parameters, baselines = readableResetParameters()
    if #parameters == 0 then
        sendOperationResult(command, "failed", "Lightroom exposed no resettable corrections for this mask.", before)
        return false
    end
    if activeCorrectionGesture ~= nil then stopActiveCorrectionGesture() end
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    if not resetParameters(parameters) then
        rollbackResetParameters(command, before, parameters, baselines)
        sendOperationResult(command, "failed", "Lightroom could not reset every selected-mask correction.",
            readSnapshot(command.expectedSelectedPhotoUuid))
        return false
    end
    local firstFingerprint = resetFingerprint(parameters)
    if firstFingerprint == nil or not resetParameters(parameters) then
        rollbackResetParameters(command, before, parameters, baselines)
        sendOperationResult(command, "failed", "Lightroom could not verify the selected-mask reset.",
            readSnapshot(command.expectedSelectedPhotoUuid))
        return false
    end
    local secondFingerprint = resetFingerprint(parameters)
    local after = readSnapshot(command.expectedSelectedPhotoUuid)
    if firstFingerprint == secondFingerprint and after.available == true and after.active == true and
        after.hasSelectedMaskGroup == true and after.selectedMaskGroupId == command.expectedSelectedMaskId and
        after.selectedMaskToolAvailable == before.selectedMaskToolAvailable and
        after.selectedMaskToolCount == before.selectedMaskToolCount and
        after.selectedMaskToolIndex == before.selectedMaskToolIndex and
        after.selectedMaskToolId == before.selectedMaskToolId then
        sendOperationResult(command, "confirmed", "", after)
        return true
    end
    if after.available == true and after.active == true and after.hasSelectedMaskGroup == true and
        after.selectedMaskGroupId == before.selectedMaskGroupId then
        rollbackResetParameters(command, before, parameters, baselines)
        after = readSnapshot(command.expectedSelectedPhotoUuid)
    end
    sendOperationResult(command, "failed", "Lightroom did not confirm a complete selected-mask reset.", after)
    return false
end

local function executePreset(command)
    -- Bounded in-memory evidence; never participates in admission or settlement.
    local traceSequence = 0
    local traceLines = {}
    local traceBytes = 0
    local function trace(phase, parameter, value)
        pcall(function()
            traceSequence = traceSequence + 1
            local line = "mask-preset-trace operation=" .. tostring(command.operationId) ..
                " sequence=" .. tostring(traceSequence) .. " time=" .. tostring(LrDate.currentTime()) ..
                " cpu=" .. tostring(os.clock()) .. " phase=" .. tostring(phase) ..
                " parameter=" .. tostring(parameter or "") .. " value=" .. tostring(value) ..
                " photo=" .. tostring(command.expectedSelectedPhotoUuid) ..
                " mask=" .. tostring(command.expectedSelectedMaskId) ..
                " component=" .. tostring(command.expectedSelectedMaskToolId) ..
                " context=" .. tostring(command.expectedContextCounter) ..
                " develop=" .. tostring(command.expectedDevelopCounter) ..
                " revision=" .. tostring(command.expectedMaskingRevision) ..
                " epoch=" .. tostring(command.expectedServerEpoch)
            if traceBytes + string.len(line) < 60000 then
                traceLines[#traceLines + 1] = line
                traceBytes = traceBytes + string.len(line) + 1
            end
        end)
    end
    local function complete(outcome, detail, snapshot, report)
        if snapshot then trace("completion-selection", snapshot.selectedMaskGroupId, snapshot.selectedMaskToolId) end
        trace("completion-send", outcome, detail)
        sendOperationResult(command, outcome, detail, snapshot, report)
        trace("completion-return", outcome)
        LrTasks.pcall(function()
            LrHttp.post("http://127.0.0.1:17891/diagnostics/masking-preset-trace", table.concat(traceLines, "\n"),
                { { field = "Content-Type", value = "text/plain" } }, "POST", 1)
        end)
    end
    trace("execution-start", command.presetFile)
    local filePreset = command.presetKind == "file" and type(command.presetFile) == "string" and
        string.len(command.presetFile) <= 180 and
        string.match(string.lower(command.presetFile), "^[^\"/\\%c]+%.lrtemplate$") ~= nil and
        command.presetParameter == nil and command.presetValue == nil
    if not validOpaqueId(command.expectedSelectedMaskId) or not validOpaqueId(command.expectedSelectedMaskToolId) or type(command.preset) ~= "string" or
        string.match(command.preset, "^lp%-%w[%w_%-]*$") == nil or not filePreset then
        error("Invalid local adjustment preset command")
    end
    if not serverBindingMatches(command, command.operationId) then
        complete("stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    local before = readSnapshot(command.expectedSelectedPhotoUuid)
    if before.available ~= true or before.active ~= true or before.hasSelectedMaskGroup ~= true or
        before.selectedMaskGroupId ~= command.expectedSelectedMaskId or
        before.selectedMaskToolId ~= command.expectedSelectedMaskToolId then
        complete("stale", "The selected mask changed.", before)
        return false
    end
    if activeCorrectionGesture ~= nil then stopActiveCorrectionGesture() end
    if not serverBindingMatches(command, command.operationId) then
        complete("stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    local applyOk, applied = LrTasks.pcall(function()
        local stillValid = function()
            if not inDevelop() then return false end
            local photo = selectedPhoto()
            if photo == nil or photoUuid(photo) ~= command.expectedSelectedPhotoUuid then return false end
            local maskOk, selectedMaskId = LrTasks.pcall(function() return LrDevelopController.getSelectedMask() end)
            if maskOk ~= true or selectedMaskId ~= command.expectedSelectedMaskId then return false end
            local toolOk, selectedToolId = LrTasks.pcall(function() return LrDevelopController.getSelectedMaskTool() end)
            return toolOk == true and selectedToolId == before.selectedMaskToolId
        end
        return MaskPresets.apply(command.presetFile, stillValid, trace)
    end)
    local after = readSnapshot(command.expectedSelectedPhotoUuid)
    local presetDiagnostics = nil
    if applyOk == true and type(applied) == "table" then
        presetDiagnostics = table.concat(MaskPresets.formatSettlementDiagnostics(applied, {
            operationId = command.operationId,
            preset = command.preset,
            presetFile = command.presetFile,
            photoUuid = command.expectedSelectedPhotoUuid,
            maskId = command.expectedSelectedMaskId,
            componentBefore = before.selectedMaskToolId,
            componentAfter = after.selectedMaskToolId,
            contextCounter = command.expectedContextCounter,
            developCounter = command.expectedDevelopCounter,
            maskingRevision = command.expectedMaskingRevision,
            serverEpoch = command.expectedServerEpoch
        }), "\n")
        trace("settlement-report", "", presetDiagnostics)
        if string.len(presetDiagnostics) > 6000 then presetDiagnostics = nil end
    end
    if applyOk == true and type(applied) == "table" and applied.ok == true and
        after.available == true and after.active == true and
        after.hasSelectedMaskGroup == true and after.selectedMaskGroupId == command.expectedSelectedMaskId and
        after.selectedMaskToolAvailable == before.selectedMaskToolAvailable and
        after.selectedMaskToolCount == before.selectedMaskToolCount and
        after.selectedMaskToolIndex == before.selectedMaskToolIndex and
        after.selectedMaskToolId == before.selectedMaskToolId then
        complete("confirmed", "", after, presetDiagnostics)
        return true
    end
    local detail = "Lightroom could not confirm the preset settings. Some settings may have changed."
    if applyOk ~= true then
        detail = "The preset failed inside Lightroom. Some settings may have changed."
    elseif type(applied) == "table" and applied.kind == "parse_failure" then
        detail = "Local adjustment preset parse failure: " .. tostring(applied.detail or "invalid preset")
    elseif type(applied) == "table" and applied.kind == "unsupported_preset" then
        detail = "Unsupported local adjustment preset: " .. tostring(applied.detail or "no supported values")
    elseif type(applied) == "table" and applied.kind == "lightroom_write_failure" then
        detail = "Lightroom write failure: " .. tostring(applied.detail or "preset value rejected")
    elseif type(applied) == "table" and applied.kind == "settlement_failure" then
        detail = "Preset settlement failure: " .. tostring(applied.detail or "authoritative values not confirmed")
    end
    if type(applied) == "table" and applied.diagnostics and applied.diagnostics.rollbackAttempted then
        detail = detail .. (applied.diagnostics.rollbackSucceeded == true and
            " Attempted settings were restored and verified. Other settings may remain changed." or
            " Some settings may remain changed; restoration could not be confirmed.")
    end
    if type(applied) == "table" and applied.kind == "stale_context" then
        complete("stale", tostring(applied.detail or "The selected mask or Lightroom context changed."),
            after, presetDiagnostics)
        return false
    end
    if after.available ~= true or after.active ~= true or after.hasSelectedMaskGroup ~= true or
        after.selectedMaskGroupId ~= command.expectedSelectedMaskId or
        after.selectedMaskToolAvailable ~= before.selectedMaskToolAvailable or
        after.selectedMaskToolCount ~= before.selectedMaskToolCount or
        after.selectedMaskToolIndex ~= before.selectedMaskToolIndex or
        after.selectedMaskToolId ~= before.selectedMaskToolId then
        complete("stale", "The selected photo, mask, or component changed while applying the preset.",
            after, presetDiagnostics)
        return false
    end
    complete("failed", detail, after, presetDiagnostics)
    return false
end

local function pointColorBinding(command, snapshot)
    return validInteger(command.editSequence) and command.editSequence >= 1 and
        validOpaqueId(command.expectedSelectedMaskId) and snapshot.available == true and snapshot.active == true and
        snapshot.hasSelectedMaskGroup == true and snapshot.selectedMaskGroupId == command.expectedSelectedMaskId and
        snapshot.pointColor.available == true
end

local function pointColorSettled(command, predicate)
    local after = unavailable("sdk_error")
    for _ = 1, 12 do
        after = readSnapshot(command.expectedSelectedPhotoUuid)
        if pointColorBinding(command, after) and predicate(after.pointColor) then return after end
        LrTasks.sleep(0.05)
    end
    return after
end

local function executePointColor(command)
    if not validInteger(command.editSequence) or command.editSequence < 1 or
        not correctionBindingMatches(command) then
        sendEditResult(command, "stale", "The selected mask or Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    local before = readSnapshot(command.expectedSelectedPhotoUuid)
    if not pointColorBinding(command, before) then
        sendEditResult(command, "stale", "Mask-local Point Color is no longer available.", before)
        return false
    end
    if activeCorrectionGesture ~= nil then stopActiveCorrectionGesture() end
    if command.command == "masking.point_color.sample.select" then
        if not validInteger(command.selectedIndex) or command.selectedIndex < 1 or
            command.selectedIndex > before.pointColor.swatchCount then error("Invalid mask Point Color sample") end
        local ok = LrTasks.pcall(function() LrDevelopController.selectPointColorSwatch(command.selectedIndex, true) end)
        local after = pointColorSettled(command, function(value) return value.selectedIndex == command.selectedIndex end)
        if ok == true and after.pointColor and after.pointColor.selectedIndex == command.selectedIndex then
            sendEditResult(command, "confirmed", "", after); return true
        end
        sendEditResult(command, "failed", "Lightroom did not confirm the Point Color sample.", after); return false
    end
    if not validInteger(command.expectedSelectedIndex) or command.expectedSelectedIndex ~= before.pointColor.selectedIndex then
        sendEditResult(command, "stale", "The selected Point Color sample changed.", before); return false
    end
    local predicate
    local updateOk, success, message
    if command.command == "masking.point_color.value.set" then
        if not PointColor.validValue(command.field, command.value) then
            error("Invalid mask Point Color value")
        end
        predicate = function(value) return value.selectedIndex == command.expectedSelectedIndex and value[command.field] == command.value end
        if not correctionBindingMatches(command) then
            sendEditResult(command, "stale", "The selected mask or Lightroom context changed.", unavailable("context_changed")); return false
        end
        updateOk, success, message = LrTasks.pcall(function()
            return PointColor.updateContextValue(command.field, command.value, command.expectedSelectedIndex, true)
        end)
    elseif command.command == "masking.point_color.range.set" then
        if not finiteNumber(command.value) or
            command.value < 0 or command.value > 1 then error("Invalid mask Point Color range") end
        local validBoundary = false
        for _, boundary in ipairs(POINT_COLOR_BOUNDARIES) do if command.boundary == boundary then validBoundary = true end end
        if not validBoundary then error("Invalid mask Point Color range boundary") end
        predicate = function(value)
            return value.selectedIndex == command.expectedSelectedIndex and
                value[command.range][command.boundary] == command.value
        end
        if not correctionBindingMatches(command) then
            sendEditResult(command, "stale", "The selected mask or Lightroom context changed.", unavailable("context_changed")); return false
        end
        updateOk, success, message = LrTasks.pcall(function()
            return PointColor.updateContextRange(command.range, command.boundary, command.value,
                command.expectedSelectedIndex, true)
        end)
    elseif command.command == "masking.point_color.range.translate" then
        local translated = { LowerNone = command.LowerNone, LowerFull = command.LowerFull,
            UpperFull = command.UpperFull, UpperNone = command.UpperNone }
        if not PointColor.validRange(translated) then error("Invalid mask Point Color range translation") end
        predicate = function(value)
            if value.selectedIndex ~= command.expectedSelectedIndex then return false end
            for _, boundary in ipairs(POINT_COLOR_BOUNDARIES) do
                if value[command.range][boundary] ~= translated[boundary] then return false end
            end
            return true
        end
        if not correctionBindingMatches(command) then
            sendEditResult(command, "stale", "The selected mask or Lightroom context changed.", unavailable("context_changed")); return false
        end
        updateOk, success, message = LrTasks.pcall(function()
            return PointColor.translateContextRange(command.range, command.LowerNone, command.LowerFull,
                command.UpperFull, command.UpperNone, command.expectedSelectedIndex, true)
        end)
    else error("Invalid mask Point Color command") end
    local after = pointColorSettled(command, predicate)
    if updateOk == true and success == true and pointColorBinding(command, after) then
        sendEditResult(command, "confirmed", "", after); return true
    end
    local detail = message == "range_excludes_selected_color" and "That range would exclude the selected color." or
        "Lightroom did not confirm the mask-local Point Color edit."
    sendEditResult(command, "failed", detail, after)
    return false
end

local function sameCurve(left, right)
    return ToneCurve.curvesEqual(left, right)
end

local function curveForWrite(points)
    return ToneCurve.copyCurve(points)
end

local function curveSettled(command, expected, trace)
    local after = unavailable("sdk_error")
    for attempt = 1, 12 do
        after = readSnapshot(command.expectedSelectedPhotoUuid, trace)
        MaskToneCurveTrace.record(trace, "comparison", { attempt = attempt, expected = expected,
            actual = after.curves and after.curves[command.channel],
            exactMatch = expected == nil or sameCurve(after.curves and after.curves[command.channel], expected),
            available = after.available, active = after.active, unavailableReason = after.unavailableReason,
            selectedMaskGroupId = after.selectedMaskGroupId, curvesAvailable = after.curves and after.curves.available })
        if after.available == true and after.active == true and after.selectedMaskGroupId == command.expectedSelectedMaskId and
            after.curves.available == true and (expected == nil or sameCurve(after.curves[command.channel], expected)) then return after end
        LrTasks.sleep(0.05)
    end
    return after
end

local function curveSdkCall(trace, event, callback)
    local function pack(...) return { n = select("#", ...), ... } end
    local results = pack(LrTasks.pcall(callback))
    MaskToneCurveTrace.record(trace, event, results)
    return unpack(results, 1, results.n)
end

local function executeToneCurve(command, trace)
    if not validInteger(command.editSequence) or command.editSequence < 1 or
        not correctionBindingMatches(command, trace) then
        sendEditResult(command, "stale", "The selected mask or Lightroom context changed.", unavailable("context_changed"), trace); return false
    end
    local before = readSnapshot(command.expectedSelectedPhotoUuid, trace)
    local field = LOCAL_CURVE_FIELDS[command.channel]
    if field == nil or command.field ~= field or before.curves.available ~= true or
        before.selectedMaskGroupId ~= command.expectedSelectedMaskId or not sameCurve(before.curves[command.channel], command.expectedPoints) then
        sendEditResult(command, "stale", "The mask-local curve changed before the command ran.", before, trace); return false
    end
    local phase = string.match(command.command, "^masking%.tone_curve%.gesture%.([a-z]+)$")
    if phase ~= nil then
        if type(command.gestureId) ~= "string" or string.match(command.gestureId, "^curve_[%w_%-]+$") == nil then
            error("Invalid mask curve gesture")
        end
        if phase == "begin" then
            if activeCorrectionGesture ~= nil then stopActiveCorrectionGesture(trace) end
            local ok = curveSdkCall(trace, "startTracking", function() return LrDevelopController.startTracking(field) end)
            if ok == true then activeCorrectionGesture = { id = command.gestureId, parameter = field,
                maskId = command.expectedSelectedMaskId } end
            return ok == true
        end
        if phase == "cancel" then return stopActiveCorrectionGesture(trace) end
        if not validCurve(command.points) then error("Invalid mask curve points") end
        if activeCorrectionGesture == nil or activeCorrectionGesture.id ~= command.gestureId or
            activeCorrectionGesture.parameter ~= field or activeCorrectionGesture.maskId ~= command.expectedSelectedMaskId then
            if activeCorrectionGesture ~= nil then stopActiveCorrectionGesture(trace) end
            local startOk = curveSdkCall(trace, "startTracking", function() return LrDevelopController.startTracking(field) end)
            if startOk ~= true then sendEditResult(command, "failed", "Lightroom could not begin the mask curve edit.", before, trace); return false end
            activeCorrectionGesture = { id = command.gestureId, parameter = field, maskId = command.expectedSelectedMaskId }
        end
        local setOk = curveSdkCall(trace, "setValue", function() return LrDevelopController.setValue(field, curveForWrite(command.points)) end)
        local stopOk = true
        if phase == "end" then stopOk = stopActiveCorrectionGesture(trace) end
        local after = curveSettled(command, command.points, trace)
        if setOk == true and stopOk == true and after.curves.available == true and
            sameCurve(after.curves[command.channel], command.points) then
            sendEditResult(command, "confirmed", "", after, trace)
            return true
        end
        sendEditResult(command, "failed", "Lightroom did not confirm the mask-local curve.", after, trace)
        return false
    end
    if activeCorrectionGesture ~= nil then stopActiveCorrectionGesture(trace) end
    if command.command == "masking.tone_curve.reset" then
        local startOk = curveSdkCall(trace, "startTracking", function() return LrDevelopController.startTracking(field) end)
        if startOk == true then activeCorrectionGesture = { id = "curve_reset_" .. tostring(command.editSequence),
            parameter = field, maskId = command.expectedSelectedMaskId } end
        local resetOk = startOk == true and curveSdkCall(trace, "resetToDefault", function() return LrDevelopController.resetToDefault(field) end)
        local stopOk = stopActiveCorrectionGesture(trace)
        local first = curveSettled(command, nil, trace)
        local firstCurve = first.curves.available == true and first.curves[command.channel] or nil
        local secondStartOk = curveSdkCall(trace, "startTracking", function() return LrDevelopController.startTracking(field) end)
        if secondStartOk == true then activeCorrectionGesture = {
            id = "curve_reset_verify_" .. tostring(command.editSequence), parameter = field,
            maskId = command.expectedSelectedMaskId
        } end
        local secondOk = secondStartOk == true and
            curveSdkCall(trace, "resetToDefault", function() return LrDevelopController.resetToDefault(field) end)
        local secondStopOk = stopActiveCorrectionGesture(trace)
        local after = curveSettled(command, firstCurve, trace)
        if resetOk == true and stopOk == true and secondOk == true and secondStopOk == true and
            firstCurve ~= nil and sameCurve(after.curves[command.channel], firstCurve) then
            sendEditResult(command, "confirmed", "", after, trace); return true
        end
        sendEditResult(command, "failed", "Lightroom did not confirm the mask-local curve reset.", after, trace); return false
    end
    if command.command == "masking.tone_curve.preset.set" and command.channel == "rgb" and validCurve(command.points) then
        local startOk = curveSdkCall(trace, "startTracking", function() return LrDevelopController.startTracking(field) end)
        if startOk == true then activeCorrectionGesture = { id = "curve_preset_" .. tostring(command.editSequence),
            parameter = field, maskId = command.expectedSelectedMaskId } end
        local setOk = startOk == true and
            curveSdkCall(trace, "setValue", function() return LrDevelopController.setValue(field, curveForWrite(command.points)) end)
        local stopOk = stopActiveCorrectionGesture(trace)
        local after = curveSettled(command, command.points, trace)
        if setOk == true and stopOk == true and sameCurve(after.curves.rgb, command.points) then
            sendEditResult(command, "confirmed", "", after, trace); return true
        end
        sendEditResult(command, "failed", "Lightroom did not confirm the mask-local curve preset.", after, trace); return false
    end
    error("Invalid mask-local curve command")
end

local function executeRefineSaturation(command)
    if not validInteger(command.editSequence) or command.editSequence < 1 or command.field ~= "local_RefineSaturation" or
        not correctionBindingMatches(command) then
        sendEditResult(command, "stale", "The selected mask or Lightroom context changed.", unavailable("context_changed")); return false
    end
    local before = readSnapshot(command.expectedSelectedPhotoUuid)
    local correction = correctionFromSnapshot(before, command.field)
    if correction == nil or correction.value ~= command.expectedValue then
        sendEditResult(command, "stale", "Refine Saturation changed before the command ran.", before); return false
    end
    local phase = string.match(command.command, "^masking%.tone_curve%.refine_saturation%.gesture%.([a-z]+)$")
    if phase ~= nil then
        if type(command.gestureId) ~= "string" or string.match(command.gestureId, "^refine_[%w_%-]+$") == nil then
            error("Invalid Refine Saturation gesture")
        end
        if phase == "begin" then
            if activeCorrectionGesture ~= nil then stopActiveCorrectionGesture() end
            local ok = LrTasks.pcall(function() LrDevelopController.startTracking(command.field) end)
            if ok == true then activeCorrectionGesture = { id = command.gestureId, parameter = command.field,
                maskId = command.expectedSelectedMaskId } end
            return ok == true
        end
        if phase == "cancel" then return stopActiveCorrectionGesture() end
        if not finiteNumber(command.value) or command.value < correction.min or command.value > correction.max then
            error("Invalid Refine Saturation value")
        end
        if activeCorrectionGesture == nil or activeCorrectionGesture.id ~= command.gestureId then
            if activeCorrectionGesture ~= nil then stopActiveCorrectionGesture() end
            local startOk = LrTasks.pcall(function() LrDevelopController.startTracking(command.field) end)
            if startOk ~= true then sendEditResult(command, "failed", "Lightroom could not begin Refine Saturation.", before); return false end
            activeCorrectionGesture = { id = command.gestureId, parameter = command.field,
                maskId = command.expectedSelectedMaskId }
        end
        local setOk = LrTasks.pcall(function() LrDevelopController.setValue(command.field, command.value) end)
        local stopOk = true
        if phase == "end" then stopOk = stopActiveCorrectionGesture() end
        local after = settledCorrectionSnapshot({ expectedSelectedPhotoUuid = command.expectedSelectedPhotoUuid,
            expectedSelectedMaskId = command.expectedSelectedMaskId, parameter = command.field }, command.value)
        local result = correctionFromSnapshot(after, command.field)
        if setOk == true and stopOk == true and result ~= nil and result.value == command.value then
            sendEditResult(command, "confirmed", "", after)
            return true
        end
        sendEditResult(command, "failed", "Lightroom did not confirm Refine Saturation.", after)
        return false
    end
    if command.command == "masking.tone_curve.refine_saturation.reset" then
        if activeCorrectionGesture ~= nil then stopActiveCorrectionGesture() end
        local resetOk = LrTasks.pcall(function() LrDevelopController.resetToDefault(command.field) end)
        local after = settledResetSnapshot({ expectedSelectedPhotoUuid = command.expectedSelectedPhotoUuid,
            expectedSelectedMaskId = command.expectedSelectedMaskId, parameter = command.field })
        if resetOk == true and correctionFromSnapshot(after, command.field) ~= nil then sendEditResult(command, "confirmed", "", after); return true end
        sendEditResult(command, "failed", "Lightroom did not confirm the Refine Saturation reset.", after); return false
    end
    error("Invalid Refine Saturation command")
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

local function executeComponentInvert(command)
    if not validOpaqueId(command.expectedSelectedMaskId) or not validOpaqueId(command.expectedSelectedMaskToolId) or
        (command.expectedInverted ~= nil and type(command.expectedInverted) ~= "boolean") then
        error("Invalid component inversion command")
    end
    local function matches(snapshot)
        return snapshot.available == true and snapshot.active == true and snapshot.hasSelectedMaskGroup == true and
            snapshot.selectedMaskToolAvailable == true and snapshot.selectedMaskGroupId == command.expectedSelectedMaskId and
            snapshot.selectedMaskToolId == command.expectedSelectedMaskToolId
    end
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    local before = readSnapshot(command.expectedSelectedPhotoUuid)
    if not matches(before) or before.selectedMaskToolInverted ~= command.expectedInverted then
        sendOperationResult(command, "stale", "The component or its inversion changed before the command ran.", before)
        return false
    end
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    -- HTTP binding reads may yield. Recheck native selection and baseline immediately before the one SDK write.
    local current = readSnapshot(command.expectedSelectedPhotoUuid)
    if not matches(current) or current.selectedMaskToolInverted ~= command.expectedInverted or
        current.maskGroupCount ~= before.maskGroupCount or current.selectedMaskToolCount ~= before.selectedMaskToolCount or
        LrDevelopController.getSelectedMask() ~= command.expectedSelectedMaskId or
        LrDevelopController.getSelectedMaskTool() ~= command.expectedSelectedMaskToolId then
        sendOperationResult(command, "stale", "The selected component changed before inversion.", current)
        return false
    end
    -- The SDK's generated (id, param) heading describes a single tool ID; no mask ID or receiver argument.
    LrDevelopController.toggleInvertMaskTool(command.expectedSelectedMaskToolId)
    local after = unavailable("sdk_error")
    for attempt = 1, 12 do
        if not serverBindingMatches(command, command.operationId) then
            sendOperationResult(command, "stale", "Lightroom context changed during inversion.", unavailable("context_changed"))
            return false
        end
        after = readSnapshot(command.expectedSelectedPhotoUuid)
        if after.available == true and not matches(after) then
            sendOperationResult(command, "stale", "The selected mask or component changed during inversion.", after)
            return false
        end
        if matches(after) and after.maskGroupCount == before.maskGroupCount and
            after.selectedMaskToolCount == before.selectedMaskToolCount and after.selectedMaskHidden == before.selectedMaskHidden and
            after.selectedMaskToolHidden == before.selectedMaskToolHidden then
            if command.expectedInverted == nil then
                sendOperationResult(command, "requested", "Inversion requested; Lightroom did not supply a readable prior inversion state.", after)
                return true
            end
            if after.selectedMaskToolInverted == not command.expectedInverted then
                sendOperationResult(command, "confirmed", "Component inversion confirmed by Lightroom.", after)
                return true
            end
        end
        if attempt < 12 then LrTasks.sleep(0.05) end
    end
    sendOperationResult(command, "failed", "Lightroom did not confirm component inversion. Check the component in Lightroom.", after)
    return false
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
        (after.hasSelectedMaskGroup ~= true or after.selectedMaskToolAvailable ~= true and after.selectedMaskToolCount ~= 0) then
        local targetIndex = 1
        if after.hasSelectedMaskGroup == true then targetIndex = after.selectedMaskGroupIndex end
        local targetMask = after._masks and after._masks[targetIndex] or nil
        local targetTool = targetMask and targetMask.Tools and targetMask.Tools[1] or nil
        if type(targetMask) ~= "table" or not validOpaqueId(targetMask.ID) or
            (#targetMask.Tools > 0 and (type(targetTool) ~= "table" or not validOpaqueId(targetTool.ID))) then
            sendOperationResult(command, "failed", "The first available mask could not be reconciled.",
                unavailable("invalid_inventory"))
            return false
        end
        if not serverBindingMatches(command, command.operationId) then
            sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
            return false
        end
        LrDevelopController.selectMask(targetMask.ID)
        if targetTool then
            LrDevelopController.selectMaskTool(targetTool.ID)
            after = settledSnapshot(command, true, targetMask.ID, targetTool.ID)
        else
            after = settledSnapshot(command, true, targetMask.ID)
        end
    end
    local openSelectionReady = not command.open
    if command.open and after.available == true then
        openSelectionReady = (after.maskGroupCount == 0 and after.hasSelectedMaskGroup == false) or
            (after.maskGroupCount > 0 and after.hasSelectedMaskGroup == true and
                (after.selectedMaskToolAvailable == true or after.selectedMaskToolCount == 0))
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

local function executePointColorTool(command)
    if not validOpaqueId(command.expectedSelectedMaskId) or
        not validOpaqueId(command.expectedSelectedMaskToolId) then
        error("Invalid mask-local Point Color tool command")
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
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    local selectOk = LrTasks.pcall(function()
        LrDevelopController.selectTool("local_point_color")
    end)
    local after = settledSnapshot(command, true, before.selectedMaskGroupId, before.selectedMaskToolId)
    if selectOk == true and after.available == true and after.active == true and
        after.selectedMaskGroupId == before.selectedMaskGroupId and
        after.selectedMaskToolId == before.selectedMaskToolId then
        sendOperationResult(command, "confirmed", "", after)
        return true
    end
    if after.unavailableReason == "context_changed" then
        sendOperationResult(command, "stale", "Lightroom context changed.", after)
        return false
    end
    sendOperationResult(command, "failed", "Lightroom did not confirm the mask-local Color Picker.", after)
    return false
end

local function executePointColorVisualization(command)
    if not validOpaqueId(command.expectedSelectedMaskId) or
        not validOpaqueId(command.expectedSelectedMaskToolId) then
        error("Invalid mask-local Point Color visualization command")
    end
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    local before = readSnapshot(command.expectedSelectedPhotoUuid)
    if before.available ~= true or before.active ~= true or before.hasSelectedMaskGroup ~= true or
        before.selectedMaskGroupId ~= command.expectedSelectedMaskId or before.pointColor.available ~= true or
        before.pointColor.selectedIndex < 1 or before.selectedMaskToolAvailable ~= true or
        before.selectedMaskToolId ~= command.expectedSelectedMaskToolId then
        sendOperationResult(command, "stale", "Mask-local Point Color changed.", before)
        return false
    end
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    local toggleOk = LrTasks.pcall(function()
        LrDevelopController.togglePointColorRangeVisualization(true)
    end)
    local after = readSnapshot(command.expectedSelectedPhotoUuid)
    if toggleOk == true and after.available == true and after.active == true and
        after.selectedMaskGroupId == before.selectedMaskGroupId and
        after.selectedMaskToolId == before.selectedMaskToolId then
        sendOperationResult(command, "confirmed", "", after)
        return true
    end
    if after.unavailableReason == "context_changed" then
        sendOperationResult(command, "stale", "Lightroom context changed.", after)
        return false
    end
    sendOperationResult(command, "failed", "Lightroom could not run mask-local Visualize Range.", after)
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
    if type(targetMask) ~= "table" or not validOpaqueId(targetMask.ID) or
        (#targetMask.Tools > 0 and (type(targetTool) ~= "table" or not validOpaqueId(targetTool.ID))) then
        sendOperationResult(command, "failed", "The adjacent mask could not be reconciled.", unavailable("invalid_inventory"))
        return false
    end
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    LrDevelopController.selectMask(targetMask.ID)
    if targetTool then LrDevelopController.selectMaskTool(targetTool.ID) end
    local after = settledSnapshot(command, true, targetMask.ID)
    if after.available == true and after.active == true and after.selectedMaskGroupIndex == targetIndex and
        after.selectedMaskGroupId == targetMask.ID then
        sendOperationResult(command, "confirmed", "", after)
        return true
    end
    sendOperationResult(command, "failed", "Lightroom did not confirm the mask selection.", after)
    return false
end

local function executeComponentCreation(command)
    local subtypes = {
        brush = { [""] = true }, gradient = { [""] = true }, radialGradient = { [""] = true },
        rangeMask = { color = true, luminance = true, depth = true },
        aiSelection = { subject = true, sky = true, background = true, objects = true, people = true, landscape = true }
    }
    local subtype = command.maskSubtype or ""
    if not subtypes[command.maskType] or not subtypes[command.maskType][subtype] or
        not validOpaqueId(command.expectedSelectedMaskId) or
        command.expectedSelectedMaskToolId ~= nil and not validOpaqueId(command.expectedSelectedMaskToolId) or
        not validInteger(command.expectedMaskCount) or command.expectedMaskCount < 1 or command.expectedMaskCount > MAX_MASK_GROUPS or
        not validInteger(command.expectedMaskToolCount) or command.expectedMaskToolCount < 1 or
        command.expectedMaskToolCount >= MAX_MASK_TOOLS_PER_GROUP then error("Invalid mask component request") end
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    -- Read after the yielding server checks. Never select a mask to make an old request fit.
    local before = readSnapshot(command.expectedSelectedPhotoUuid)
    if before.available ~= true or before.active ~= true or before.hasSelectedMaskGroup ~= true or
        before.selectedMaskGroupId ~= command.expectedSelectedMaskId or before.maskGroupCount ~= command.expectedMaskCount or
        before.selectedMaskToolId ~= command.expectedSelectedMaskToolId or before.selectedMaskToolCount ~= command.expectedMaskToolCount then
        sendOperationResult(command, "stale", "The selected mask or its components changed before Add/Subtract.", before)
        return false
    end
    local existingGroups, existingTools = {}, {}
    for _, mask in ipairs(before._masks) do
        existingGroups[mask.ID] = {}
        for _, component in ipairs(mask.Tools) do existingGroups[mask.ID][component.ID] = true end
    end
    existingTools = existingGroups[command.expectedSelectedMaskId]
    -- These documented methods take type/subtype, not a mask ID. Recheck identity immediately before calling.
    if not inDevelop() or photoUuid(selectedPhoto()) ~= command.expectedSelectedPhotoUuid or
        LrDevelopController.getSelectedTool() ~= "masking" or
        LrDevelopController.getSelectedMask() ~= command.expectedSelectedMaskId or
        LrDevelopController.getSelectedMaskTool() ~= command.expectedSelectedMaskToolId then
        sendOperationResult(command, "stale", "The selected photo or mask changed before Add/Subtract.", unavailable("context_changed"))
        return false
    end
    if command.command == "masking.component.add" then
        LrDevelopController.addToCurrentMask(command.maskType, subtype ~= "" and subtype or nil)
    else
        LrDevelopController.subtractFromCurrentMask(command.maskType, subtype ~= "" and subtype or nil)
    end
    local automatic = command.maskType == "aiSelection" and
        (subtype == "subject" or subtype == "sky" or subtype == "background")
    local after
    for attempt = 1, (automatic and 50 or 12) do
        after = readSnapshot(command.expectedSelectedPhotoUuid)
        if after.available == true and after.selectedMaskGroupId == command.expectedSelectedMaskId and after.selectedMaskToolCount == 0 then
            -- Add/Subtract still treats a temporarily empty target as unfinished tool inventory.
            after = unavailable("invalid_inventory")
        end
        if after.unavailableReason == "context_changed" or after.unavailableReason == "not_develop" or
            after.unavailableReason == "no_photo" then
            sendOperationResult(command, "stale", "Lightroom context changed during Add/Subtract.", after)
            return false
        end
        if after.available == true then
            if after.active ~= true or after.selectedMaskGroupId ~= command.expectedSelectedMaskId then
                sendOperationResult(command, "stale", "The selected mask changed during Add/Subtract.", after)
                return false
            end
            local retained = after.maskGroupCount == before.maskGroupCount
            for _, mask in ipairs(after._masks) do
                local old = existingGroups[mask.ID]
                if not old then retained = false else
                    local seen = {}
                    for _, component in ipairs(mask.Tools) do
                        seen[component.ID] = true
                        if mask.ID ~= command.expectedSelectedMaskId and not old[component.ID] then retained = false end
                    end
                    for id in pairs(old) do if not seen[id] then retained = false end end
                end
            end
            if not retained or automatic and after.selectedMaskToolCount > before.selectedMaskToolCount + 1 then break end
            if automatic and after.selectedMaskToolCount == before.selectedMaskToolCount + 1 and
                after.selectedMaskToolAvailable == true and not existingTools[after.selectedMaskToolId] then
                sendOperationResult(command, "confirmed", "Component inventory and selection confirmed by Lightroom.", after)
                return true
            end
            if not automatic then
                -- A tool entry does not prove the photographer finished drawing or selecting.
                sendOperationResult(command, "started", "Component tool requested; complete drawing or selection in Lightroom.", after)
                return true
            end
            if attempt == 50 then
                sendOperationResult(command, "started", "Waiting for Lightroom to confirm the new component and selection.", after)
                return true
            end
        end
        LrTasks.sleep(0.1)
    end
    if after and after.available ~= true and inDevelop() and photoUuid(selectedPhoto()) == command.expectedSelectedPhotoUuid and
        LrDevelopController.getSelectedTool() == "masking" and LrDevelopController.getSelectedMask() == command.expectedSelectedMaskId then
        sendOperationResult(command, "started", "Waiting for Lightroom component inventory and selection feedback.", after)
        return true
    end
    sendOperationResult(command, "failed", "Lightroom did not confirm Add/Subtract. Check the selected mask and its components.", after)
    return false
end

local function executeCreate(command)
    local subtypes = {
        brush = { [""] = true }, gradient = { [""] = true }, radialGradient = { [""] = true },
        rangeMask = { color = true, luminance = true, depth = true },
        aiSelection = { subject = true, sky = true, background = true, objects = true, people = true, landscape = true }
    }
    local subtype = command.maskSubtype or ""
    if not subtypes[command.maskType] or not subtypes[command.maskType][subtype] or
        not finiteNumber(command.expectedMaskCount) or command.expectedMaskCount ~= math.floor(command.expectedMaskCount) or
        command.expectedMaskCount < 0 or command.expectedMaskCount >= MAX_MASK_GROUPS then error("Invalid mask creation type") end
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    local before = readSnapshot(command.expectedSelectedPhotoUuid)
    if before.available ~= true or before.maskGroupCount ~= command.expectedMaskCount then
        sendOperationResult(command, "stale", "Mask inventory changed before creation.", before)
        return false
    end
    local existingIds = {}
    for _, mask in ipairs(before._masks) do existingIds[mask.ID] = true end
    if not serverBindingMatches(command, command.operationId) then
        sendOperationResult(command, "stale", "Lightroom context changed.", unavailable("context_changed"))
        return false
    end
    -- No reset preference, adjustment values or selected-mask writes are emulated.
    LrDevelopController.createNewMask(command.maskType, subtype ~= "" and subtype or nil)
    local automatic = command.maskType == "aiSelection" and
        (subtype == "subject" or subtype == "sky" or subtype == "background")
    local after
    for _ = 1, (automatic and 50 or 12) do
        after = readSnapshot(command.expectedSelectedPhotoUuid)
        if after.unavailableReason == "context_changed" or after.unavailableReason == "not_develop" or
            after.unavailableReason == "no_photo" then
            sendOperationResult(command, "stale", "Lightroom context changed during mask creation.", after)
            return false
        end
        if after.available == true and after.active == true then
            local retained = 0
            for _, mask in ipairs(after._masks) do if existingIds[mask.ID] then retained = retained + 1 end end
            if retained ~= before.maskGroupCount or automatic and after.maskGroupCount > before.maskGroupCount + 1 then break end
            local newSelection = after.maskGroupCount == before.maskGroupCount + 1 and
                after.hasSelectedMaskGroup == true and existingIds[after.selectedMaskGroupId] ~= true and
                after.selectedMaskToolAvailable == true
            if automatic and newSelection then
                sendOperationResult(command, "confirmed", "New mask inventory and selection confirmed by Lightroom.", after)
                return true
            end
            if not automatic then
                -- A new tool/inventory entry does not prove that drawing or native selection is finished.
                sendOperationResult(command, "started", "Mask tool requested in Lightroom; complete its drawing or selection there.", after)
                return true
            end
        end
        LrTasks.sleep(0.1)
    end
    if after and after.available == true and after.active == true and after.maskGroupCount == before.maskGroupCount then
        sendOperationResult(command, "started", "Mask creation requested; Lightroom has not yet confirmed a new mask.", after)
        return true
    end
    if after and after.available ~= true and after.unavailableReason ~= "context_changed" and
        inDevelop() and photoUuid(selectedPhoto()) == command.expectedSelectedPhotoUuid then
        -- Some tools expose a temporary/incomplete inventory until the photographer draws/selects.
        -- Preserve that unavailable SDK snapshot; never manufacture a completed mask from it.
        sendOperationResult(command, "started", "Mask tool requested; waiting for Lightroom inventory and selection feedback.", after)
        return true
    end
    sendOperationResult(command, "failed", "Lightroom did not confirm mask creation. Check the selected photo and tool in Lightroom.", after)
    return false
end

function Masking.execute(command)
    local pointColorToolCommand = type(command) == "table" and
        command.command == "masking.point_color.tool.select"
    local pointColorVisualizationCommand = type(command) == "table" and
        command.command == "masking.point_color.range_visualization.toggle"
    local correctionCommand = type(command) == "table" and type(command.command) == "string" and
        string.sub(command.command, 1, 19) == "masking.correction."
    local editCommand = type(command) == "table" and type(command.command) == "string" and
        not pointColorToolCommand and not pointColorVisualizationCommand and
        (string.sub(command.command, 1, 20) == "masking.point_color." or
            string.sub(command.command, 1, 19) == "masking.tone_curve.")
    if not validBinding(command) or (not correctionCommand and not editCommand and (type(command.operationId) ~= "string" or
        string.match(command.operationId, "^mo%-%d+$") == nil)) then error("Invalid Masking command") end
    local curveTrace = nil
    if editCommand and string.sub(command.command, 1, 19) == "masking.tone_curve." and
        string.sub(command.command, 1, 37) ~= "masking.tone_curve.refine_saturation." then
        curveTrace = MaskToneCurveTrace.start(command)
    end
    local ok, result = LrTasks.pcall(function()
        if correctionCommand then return executeCorrection(command) end
        if pointColorToolCommand then return executePointColorTool(command) end
        if pointColorVisualizationCommand then return executePointColorVisualization(command) end
        if string.sub(command.command, 1, 20) == "masking.point_color." then return executePointColor(command) end
        if string.sub(command.command, 1, 37) == "masking.tone_curve.refine_saturation." then
            return executeRefineSaturation(command)
        end
        if string.sub(command.command, 1, 19) == "masking.tone_curve." then return executeToneCurve(command, curveTrace) end
        if command.command == "masking.component.delete" then return executeComponentDelete(command) end
        if command.command == "masking.component.invert" then return executeComponentInvert(command) end
        if command.command == "masking.component.add" or command.command == "masking.component.subtract" then
            return executeComponentCreation(command)
        end
        if command.command == "masking.create" then return executeCreate(command) end
        if command.command == "masking.panel.set" then return executePanel(command) end
        if command.command == "masking.group.navigate" then return executeNavigation(command) end
        if command.command == "masking.tool.navigate" then return executeToolNavigation(command) end
        if command.command == "masking.group.visibility.set" then return executeVisibility(command, false) end
        if command.command == "masking.tool.visibility.set" then return executeVisibility(command, true) end
        if command.command == "masking.all.delete" then return executeDeleteAll(command) end
        if command.command == "masking.selected.delete" then return executeSelectedDelete(command) end
        if command.command == "masking.selected.reset" then return executeSelectedReset(command) end
        if command.command == "masking.preset.apply" then return executePreset(command) end
        error("Invalid Masking command")
    end)
    MaskToneCurveTrace.finish(curveTrace, ok, result)
    if ok ~= true then
        local fallback = readSnapshot(command.expectedSelectedPhotoUuid)
        if correctionCommand then
            if command.command ~= "masking.correction.gesture.begin" and
                command.command ~= "masking.correction.gesture.cancel" then
                sendCorrectionResult(command, "failed", "Lightroom could not complete the Masking correction.", fallback)
            end
        elseif editCommand then
            local terminal = command.command == "masking.point_color.value.set" or
                command.command == "masking.point_color.range.set" or
                command.command == "masking.point_color.range.translate" or
                command.command == "masking.point_color.sample.select" or
                command.command == "masking.tone_curve.gesture.update" or
                command.command == "masking.tone_curve.gesture.end" or command.command == "masking.tone_curve.reset" or
                command.command == "masking.tone_curve.preset.set" or
                command.command == "masking.tone_curve.refine_saturation.gesture.update" or
                command.command == "masking.tone_curve.refine_saturation.gesture.end" or
                command.command == "masking.tone_curve.refine_saturation.reset"
            if terminal then sendEditResult(command, "failed", "Lightroom could not complete the Masking edit.", fallback) end
        else
            sendOperationResult(command, "failed", "Lightroom could not complete the Masking command.", fallback)
        end
        return false
    end
    return result
end

return Masking
