local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrDevelopController = import "LrDevelopController"
local LrHttp = import "LrHttp"
local LrTasks = import "LrTasks"

local Enhance = {}
local operationPending = false
local amountOperationPending = false

local function bool(value) return value == true end
local function encode(value)
    return string.gsub(tostring(value or ""), "([^%w%-_%.~])", function(character)
        return string.format("%%%02X", string.byte(character))
    end)
end

local function sendAmountState(state, amountOperation, requestedAmount, errorCategory)
    state = state or {
        available = false, denoiseState = false, denoiseEnabled = false, denoiseAmount = nil,
        rawDetailsState = false, rawDetailsEnabled = false, superResState = false,
        superResEnabled = false, enhanceNeedsUpdate = false
    }
    local url = "http://127.0.0.1:17891/enhance/amount-result" ..
        "?available=" .. tostring(state.available) .. "&denoiseState=" .. tostring(state.denoiseState) ..
        "&denoiseEnabled=" .. tostring(state.denoiseEnabled) ..
        "&denoiseAmount=" .. (state.denoiseAmount == nil and "null" or tostring(state.denoiseAmount)) ..
        "&rawDetailsState=" .. tostring(state.rawDetailsState) .. "&rawDetailsEnabled=" .. tostring(state.rawDetailsEnabled) ..
        "&superResState=" .. tostring(state.superResState) .. "&superResEnabled=" .. tostring(state.superResEnabled) ..
        "&enhanceNeedsUpdate=" .. tostring(state.enhanceNeedsUpdate) ..
        "&amountOperation=" .. encode(amountOperation) .. "&requestedAmount=" .. tostring(requestedAmount)
    if errorCategory ~= nil then url = url .. "&errorCategory=" .. encode(errorCategory) end
    LrTasks.pcall(function() LrHttp.get(url) end)
end

local function activeModule()
    local ok, value = LrTasks.pcall(function() return LrApplicationView.getCurrentModuleName() end)
    if ok ~= true or value == nil then return "unknown" end
    return string.lower(tostring(value))
end

local function targetPhoto()
    local catalog = LrApplication.activeCatalog()
    if catalog == nil then return nil end
    local ok, photo = LrTasks.pcall(function() return catalog:getTargetPhoto() end)
    if ok ~= true then return nil end
    return photo
end

function Enhance.readState()
    if activeModule() ~= "develop" or targetPhoto() == nil then return nil end
    local ok, source = LrTasks.pcall(function()
        return LrDevelopController.getEnhancePanelState()
    end)
    if ok ~= true or type(source) ~= "table" then return nil end
    local amount = tonumber(source.denoiseAmount)
    if amount ~= nil then amount = math.floor(amount + 0.5) end
    if amount == nil or amount < 1 or amount > 100 then amount = nil end
    return {
        available = true,
        denoiseState = bool(source.denoiseState),
        denoiseEnabled = bool(source.denoiseEnabled),
        denoiseAmount = amount,
        rawDetailsState = bool(source.rawDetailsState),
        rawDetailsEnabled = bool(source.rawDetailsEnabled),
        superResState = bool(source.superResState),
        superResEnabled = bool(source.superResEnabled),
        enhanceNeedsUpdate = bool(source.enhanceNeedsUpdate)
    }
end

local function sendState(state, operation, errorCategory, info, requestedEnabled)
    state = state or {
        available = false, denoiseState = false, denoiseEnabled = false, denoiseAmount = nil,
        rawDetailsState = false, rawDetailsEnabled = false, superResState = false,
        superResEnabled = false, enhanceNeedsUpdate = false
    }
    local url = "http://127.0.0.1:17891/enhance/result" ..
        "?available=" .. tostring(state.available) ..
        "&denoiseState=" .. tostring(state.denoiseState) ..
        "&denoiseEnabled=" .. tostring(state.denoiseEnabled) ..
        "&denoiseAmount=" .. (state.denoiseAmount == nil and "null" or tostring(state.denoiseAmount)) ..
        "&rawDetailsState=" .. tostring(state.rawDetailsState) ..
        "&rawDetailsEnabled=" .. tostring(state.rawDetailsEnabled) ..
        "&superResState=" .. tostring(state.superResState) ..
        "&superResEnabled=" .. tostring(state.superResEnabled) ..
        "&enhanceNeedsUpdate=" .. tostring(state.enhanceNeedsUpdate) ..
        "&operation=" .. encode(operation)
    if requestedEnabled ~= nil then url = url .. "&requestedEnabled=" .. tostring(requestedEnabled) end
    if errorCategory ~= nil then url = url .. "&errorCategory=" .. encode(errorCategory) end
    if info ~= nil then url = url .. "&info=" .. encode(info) end
    LrTasks.pcall(function() LrHttp.get(url) end)
end

function Enhance.sendCurrentState()
    local state = Enhance.readState()
    if operationPending == true then
        if state ~= nil then
            sendState(state, "processing")
        end
        return
    end
    if state == nil then
        sendState(nil, "unavailable", nil, "Enhance state unavailable")
    elseif state.denoiseState == true then
        sendState(state, "applied")
    elseif state.denoiseEnabled == true then
        sendState(state, "ready")
    else
        sendState(state, "unavailable", nil, "Denoise unavailable for this photo")
    end
end

function Enhance.setDenoiseAmount(amount)
    if type(amount) ~= "number" or amount ~= math.floor(amount) or amount < 1 or amount > 100 then sendAmountState(Enhance.readState(), "failed", amount or 0, "invalid_amount"); return false end
    if amountOperationPending == true or operationPending == true then sendAmountState(Enhance.readState(), "failed", amount, "duplicate"); return false end
    if activeModule() ~= "develop" then sendAmountState(nil, "failed", amount, "not_develop"); return false end
    local photo = targetPhoto()
    local initial = Enhance.readState()
    if photo == nil then sendAmountState(nil, "failed", amount, "no_photo"); return false end
    if initial == nil then sendAmountState(nil, "failed", amount, "state_error"); return false end
    if initial.denoiseState ~= true then sendAmountState(initial, "failed", amount, "unavailable"); return false end
    if initial.denoiseAmount == amount then sendAmountState(initial, "applied", amount); return true end
    amountOperationPending = true
    sendAmountState(initial, "starting", amount)
    LrTasks.startAsyncTask(function()
        sendAmountState(initial, "processing", amount)
        local callOk = LrTasks.pcall(function()
            return LrDevelopController.changeDenoiseAmount(amount)
        end)
        if callOk ~= true then
            amountOperationPending = false
            sendAmountState(Enhance.readState(), "failed", amount, "sdk_error")
            return
        end
        for attempt = 1, 10 do
            if activeModule() ~= "develop" or targetPhoto() ~= photo then
                amountOperationPending = false
                sendAmountState(initial, "uncertain", amount, "confirmation_timeout")
                return
            end
            local confirmed = Enhance.readState()
            if confirmed ~= nil and confirmed.denoiseState == true and confirmed.denoiseAmount == amount then
                amountOperationPending = false
                sendAmountState(confirmed, "applied", amount)
                return
            end
            LrTasks.sleep(0.25)
        end
        amountOperationPending = false
        sendAmountState(Enhance.readState(), "uncertain", amount, "confirmation_timeout")
    end)
    return true
end

function Enhance.setDenoise(enabled, amount)
    if type(enabled) ~= "boolean" then
        sendState(Enhance.readState(), "failed", "invalid_enabled")
        return false
    end
    if type(amount) ~= "number" or amount ~= math.floor(amount) or amount < 1 or amount > 100 then
        sendState(Enhance.readState(), "failed", "invalid_amount")
        return false
    end
    if operationPending == true then
        sendState(Enhance.readState(), "failed", "duplicate")
        return false
    end
    if activeModule() ~= "develop" then sendState(nil, "failed", "not_develop"); return false end
    local photo = targetPhoto()
    if photo == nil then sendState(nil, "failed", "no_photo"); return false end
    local initial = Enhance.readState()
    if initial == nil then sendState(nil, "failed", "state_error"); return false end
    if enabled == true and initial.denoiseEnabled ~= true then sendState(initial, "failed", "unavailable", nil, enabled); return false end
    if initial.denoiseState == enabled then sendState(initial, "applied", nil, nil, enabled); return true end

    operationPending = true
    sendState(initial, "starting", nil, nil, enabled)
    local started = pcall(function()
        LrTasks.startAsyncTask(function()
            sendState(initial, "processing", nil, nil, enabled)
            local callOk, callResult = LrTasks.pcall(function()
                return LrDevelopController.setEnhance("denoise", enabled, amount)
            end)
            if callOk ~= true or callResult == false then
                operationPending = false
                sendState(Enhance.readState(), "failed", callOk == true and "rejected" or "sdk_error", nil, enabled)
                return
            end
            for attempt = 1, 10 do
                if activeModule() ~= "develop" or targetPhoto() ~= photo then
                    operationPending = false
                    sendState(nil, "uncertain", "confirmation_timeout", nil, enabled)
                    return
                end
                local confirmed = Enhance.readState()
                if confirmed ~= nil and confirmed.denoiseState == enabled then
                    operationPending = false
                    sendState(confirmed, "applied", nil, nil, enabled)
                    return
                end
                LrTasks.sleep(0.5)
            end
            operationPending = false
            sendState(Enhance.readState(), "uncertain", "confirmation_timeout", nil, enabled)
        end)
    end)
    if started ~= true then
        operationPending = false
        sendState(initial, "failed", "sdk_error", nil, enabled)
        return false
    end
    return true
end

return Enhance
