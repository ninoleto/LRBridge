local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrDevelopController = import "LrDevelopController"
local LrHttp = import "LrHttp"
local LrTasks = import "LrTasks"

local DevelopPresets = {}

local outcomeStale = "stale/rejected"
local outcomeObserved = "SDK call completed and covered effect observed"
local outcomeNoChange = "SDK call completed with no detectable change"
local outcomeFailed = "failed"
local presetAmountParameter = "PresetAmount"
local amountAdjustmentDirty = true
local amountObserverOwner = nil

local function urlEncode(value)
    return string.gsub(tostring(value), "([^%w%-_%.~])", function(character)
        return string.format("%%%02X", string.byte(character))
    end)
end

local function validId(value)
    return type(value) == "string" and string.len(value) >= 1 and string.len(value) <= 64 and
        string.match(value, "^[A-Za-z0-9_-]+$") ~= nil
end

local function validInteger(value)
    return type(value) == "number" and value >= 0 and value == math.floor(value)
end

local function inExpectedModule(command)
    local ok, moduleName = pcall(function() return LrApplicationView.getCurrentModuleName() end)
    return ok == true and string.lower(tostring(moduleName or "")) == command.expectedActiveModule
end

local function photoUuid(photo)
    if photo == nil then return "" end
    local ok, uuid = LrTasks.pcall(function() return photo:getRawMetadata("uuid") end)
    if ok == true and uuid ~= nil then return tostring(uuid) end
    return ""
end

local function jsonInteger(json, field)
    if type(json) ~= "string" then return nil end
    local value = string.match(json, '"' .. field .. '"%s*:%s*(%d+)')
    return value and tonumber(value) or nil
end

local function jsonString(json, field)
    if type(json) ~= "string" then return nil end
    return string.match(json, '"' .. field .. '"%s*:%s*"([^"]*)"')
end

local function jsonBoolean(json, field)
    if type(json) ~= "string" then return nil end
    local value = string.match(json, '"' .. field .. '"%s*:%s*(true)')
    if value == "true" then return true end
    value = string.match(json, '"' .. field .. '"%s*:%s*(false)')
    if value == "false" then return false end
    return nil
end

local function serverContextMatches(command)
    local ok, result = LrTasks.pcall(function()
        return LrHttp.get("http://127.0.0.1:17891/context")
    end)
    if ok ~= true or type(result) ~= "string" then return false end
    local contextMatches = jsonString(result, "activeModule") == command.expectedActiveModule and
        jsonString(result, "selectedPhotoUuid") == command.expectedSelectedPhotoUuid and
        jsonInteger(result, "contextCounter") == command.expectedContextCounter and
        jsonInteger(result, "developCounter") == command.expectedDevelopCounter and
        jsonInteger(result, "contextChangedAt") == command.expectedContextChangedAt
    if not contextMatches then return false end
    local epochOk, presetState = LrTasks.pcall(function()
        return LrHttp.get("http://127.0.0.1:17891/develop-presets/state")
    end)
    if epochOk ~= true or type(presetState) ~= "string" or
        jsonString(presetState, "serverEpoch") ~= command.expectedServerEpoch then return false end
    if command.command == "develop_preset.amount.set" then
        return jsonString(presetState, "cursorUuid") == command.expectedPresetUuid and
            jsonBoolean(presetState, "cursorAmountEnabled") == true
    end
    return true
end

local function stableSerialize(value, seen)
    local valueType = type(value)
    if valueType == "nil" then return "nil" end
    if valueType == "boolean" or valueType == "number" or valueType == "string" then
        return valueType .. ":" .. tostring(value)
    end
    if valueType ~= "table" then return "<" .. valueType .. ">" end
    if seen[value] then return "<cycle>" end
    seen[value] = true
    local keys = {}
    for key, _ in pairs(value) do keys[#keys + 1] = key end
    table.sort(keys, function(left, right)
        local leftKey = type(left) .. ":" .. tostring(left)
        local rightKey = type(right) .. ":" .. tostring(right)
        return leftKey < rightKey
    end)
    local parts = {}
    for _, key in ipairs(keys) do
        parts[#parts + 1] = stableSerialize(key, seen) .. "=" .. stableSerialize(value[key], seen)
    end
    seen[value] = nil
    return "{" .. table.concat(parts, ",") .. "}"
end

local function developFingerprint(photo)
    local ok, settings = LrTasks.pcall(function() return photo:getDevelopSettings() end)
    if ok ~= true or type(settings) ~= "table" then return nil end
    return stableSerialize(settings, {})
end

local function sendInventoryFailure(requestId, message)
    LrHttp.get(
        "http://127.0.0.1:17891/develop-presets/inventory/fail" ..
        "?requestId=" .. urlEncode(requestId) ..
        "&error=" .. urlEncode(message)
    )
end

function DevelopPresets.refreshInventory(requestId)
    if not validId(requestId) then return false end
    local ok, failure = LrTasks.pcall(function()
        local folders = LrApplication.developPresetFolders()
        if type(folders) ~= "table" then error("Lightroom did not provide Develop preset folders") end
        for _, folder in ipairs(folders) do
            local folderName = folder:getName()
            local presets = folder:getDevelopPresets()
            if type(folderName) ~= "string" or folderName == "" or string.len(folderName) > 300 or type(presets) ~= "table" then
                error("Lightroom returned an invalid Develop preset folder")
            end
            for _, preset in ipairs(presets) do
                local uuid = preset:getUuid()
                local name = preset:getName()
                if type(uuid) ~= "string" or uuid == "" or string.len(uuid) > 200 or
                    type(name) ~= "string" or name == "" or string.len(name) > 300 then
                    error("Lightroom returned an invalid Develop preset")
                end
                local itemResult = LrHttp.get(
                    "http://127.0.0.1:17891/develop-presets/inventory/item" ..
                    "?requestId=" .. urlEncode(requestId) ..
                    "&uuid=" .. urlEncode(uuid) ..
                    "&folder=" .. urlEncode(folderName) ..
                    "&name=" .. urlEncode(name)
                )
                if type(itemResult) ~= "string" or string.find(itemResult, [["ok":true]], 1, true) == nil then
                    error("LRBridge rejected a Develop preset inventory item")
                end
            end
        end
        local completionResult = LrHttp.get(
            "http://127.0.0.1:17891/develop-presets/inventory/complete" ..
            "?requestId=" .. urlEncode(requestId)
        )
        if type(completionResult) ~= "string" or string.find(completionResult, [["ok":true]], 1, true) == nil then
            error("LRBridge rejected Develop preset inventory completion")
        end
    end)
    if ok ~= true then
        LrTasks.pcall(function()
            sendInventoryFailure(requestId, "Lightroom Develop preset inventory failed: " .. tostring(failure))
        end)
        return false
    end
    return true
end

local function validApplicationCommand(command)
    return type(command) == "table" and validId(command.operationId) and
        command.command == "develop_preset.apply" and command.operationKind == "preset" and
        type(command.uuid) == "string" and command.uuid ~= "" and string.len(command.uuid) <= 200 and
        command.presetAmount == nil and
        type(command.updateAISettings) == "boolean" and command.expectedActiveModule == "develop" and
        type(command.expectedSelectedPhotoUuid) == "string" and command.expectedSelectedPhotoUuid ~= "" and
        validInteger(command.expectedContextCounter) and validInteger(command.expectedDevelopCounter) and
        validInteger(command.expectedContextChangedAt) and validId(command.expectedServerEpoch)
end

local function applyCapturedPhoto(command)
    if not validApplicationCommand(command) then return outcomeFailed, "Invalid Develop preset application command." end
    if not inExpectedModule(command) then return outcomeStale, "Active module changed before preset application." end
    local catalog = LrApplication.activeCatalog()
    if catalog == nil then return outcomeStale, "Active catalog is unavailable." end
    local capturedPhoto = catalog:getTargetPhoto()
    if capturedPhoto == nil or photoUuid(capturedPhoto) ~= command.expectedSelectedPhotoUuid then
        return outcomeStale, "Selected photo changed before preset application."
    end
    if not serverContextMatches(command) then
        return outcomeStale, "Server photo, module, context, or Develop revision changed before preset application."
    end
    local beforeFingerprint = developFingerprint(capturedPhoto)
    if beforeFingerprint == nil then return outcomeFailed, "Could not read the captured photo's Develop settings." end
    if not inExpectedModule(command) or catalog:getTargetPhoto() ~= capturedPhoto or
        photoUuid(capturedPhoto) ~= command.expectedSelectedPhotoUuid or not serverContextMatches(command) then
        return outcomeStale, "Captured preset context changed during pre-operation validation."
    end

    local staleInsideGate = false
    local presetMissing = false
    local sdkCompleted = false
    local gateOk = LrTasks.pcall(function()
        catalog:withWriteAccessDo("LRBridge Develop Preset", function()
            local gateFingerprint = developFingerprint(capturedPhoto)
            if not inExpectedModule(command) or catalog:getTargetPhoto() ~= capturedPhoto or
                photoUuid(capturedPhoto) ~= command.expectedSelectedPhotoUuid or
                gateFingerprint ~= beforeFingerprint or not serverContextMatches(command) then
                staleInsideGate = true
                error("Develop preset context changed inside write gate")
            end
            local preset = LrApplication.developPresetByUuid(command.uuid)
            if preset == nil then
                presetMissing = true
                error("Develop preset UUID is unavailable")
            end
            if command.updateAISettings == true then
                capturedPhoto:applyDevelopPreset(preset, _PLUGIN, nil, true)
            else
                capturedPhoto:applyDevelopPreset(preset, _PLUGIN)
            end
            sdkCompleted = true
        end)
    end)
    if staleInsideGate then return outcomeStale, "Captured preset context changed inside the Lightroom write gate." end
    if presetMissing then return outcomeFailed, "Configured Develop preset UUID is unavailable in Lightroom." end
    if gateOk ~= true or sdkCompleted ~= true then return outcomeFailed, "Lightroom preset SDK call failed." end

    LrTasks.sleep(0.1)
    local afterFingerprint = developFingerprint(capturedPhoto)
    if afterFingerprint ~= nil and afterFingerprint ~= beforeFingerprint then
        return outcomeObserved, "The SDK call completed and the captured photo's covered Develop settings changed."
    end
    return outcomeNoChange, "The SDK call completed but no covered Develop-setting change was detectable."
end

local function sendApplicationResult(command, outcome, detail)
    LrHttp.get(
        "http://127.0.0.1:17891/develop-presets/apply-result" ..
        "?operationId=" .. urlEncode(command.operationId or "invalid") ..
        "&uuid=" .. urlEncode(command.uuid or "invalid") ..
        "&serverEpoch=" .. urlEncode(command.expectedServerEpoch or "invalid") ..
        "&outcome=" .. urlEncode(outcome) ..
        "&detail=" .. urlEncode(detail)
    )
end

function DevelopPresets.apply(command)
    local ok, outcome, detail = LrTasks.pcall(applyCapturedPhoto, command)
    if ok ~= true then
        outcome = outcomeFailed
        detail = "Unexpected Lightroom preset application failure."
    end
    LrTasks.pcall(function() sendApplicationResult(command or {}, outcome, detail) end)
    return outcome == outcomeObserved or outcome == outcomeNoChange
end

local function validAmountCommand(command)
    return type(command) == "table" and command.command == "develop_preset.amount.set" and
        validInteger(command.presetAmount) and command.presetAmount <= 200 and
        type(command.expectedPresetUuid) == "string" and command.expectedPresetUuid ~= "" and
        string.len(command.expectedPresetUuid) <= 200 and command.expectedActiveModule == "develop" and
        type(command.expectedSelectedPhotoUuid) == "string" and command.expectedSelectedPhotoUuid ~= "" and
        validInteger(command.expectedContextCounter) and validInteger(command.expectedDevelopCounter) and
        validInteger(command.expectedContextChangedAt) and validId(command.expectedServerEpoch) and
        validInteger(command.expectedFeedbackId) and command.expectedFeedbackId > 0
end

function DevelopPresets.setAmount(command)
    if not validAmountCommand(command) or not inExpectedModule(command) then return false end
    local catalog = LrApplication.activeCatalog()
    if catalog == nil then return false end
    local capturedPhoto = catalog:getTargetPhoto()
    if capturedPhoto == nil or photoUuid(capturedPhoto) ~= command.expectedSelectedPhotoUuid or
        not serverContextMatches(command) then return false end
    local rangeOk, minValue, maxValue = LrTasks.pcall(function()
        return LrDevelopController.getRange(presetAmountParameter)
    end)
    local valueOk, currentValue = LrTasks.pcall(function()
        return LrDevelopController.getValue(presetAmountParameter)
    end)
    if rangeOk ~= true or valueOk ~= true or type(minValue) ~= "number" or type(maxValue) ~= "number" or
        type(currentValue) ~= "number" or minValue >= maxValue or currentValue < minValue or currentValue > maxValue or
        command.presetAmount < minValue or command.presetAmount > maxValue then return false end
    if not inExpectedModule(command) or catalog:getTargetPhoto() ~= capturedPhoto or
        photoUuid(capturedPhoto) ~= command.expectedSelectedPhotoUuid or not serverContextMatches(command) then return false end
    local writeOk = LrTasks.pcall(function()
        LrDevelopController.setValue(presetAmountParameter, command.presetAmount)
    end)
    local immediateOk, immediateValue = LrTasks.pcall(function()
        return LrDevelopController.getValue(presetAmountParameter)
    end)
    if writeOk == true then amountAdjustmentDirty = true end
    return writeOk == true and immediateOk == true and immediateValue == command.presetAmount
end

function DevelopPresets.installAmountObserver(functionContext)
    if amountObserverOwner ~= nil then return true end
    local owner = {}
    local ok = LrTasks.pcall(function()
        LrDevelopController.addAdjustmentChangeObserver(functionContext, owner, function()
            amountAdjustmentDirty = true
        end)
    end)
    if ok == true then amountObserverOwner = owner end
    return ok == true
end

function DevelopPresets.consumeAmountDirty()
    local dirty = amountAdjustmentDirty
    amountAdjustmentDirty = false
    return dirty
end

return DevelopPresets
