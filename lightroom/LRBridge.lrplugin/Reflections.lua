local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local SDK = import "LrDevelopController"
local LrTasks = import "LrTasks"
local LrHttp = import "LrHttp"
local Parser = require "Parser"
local Reflections = {}
local base = "http://127.0.0.1:17891/reflections/"
local fields = { "checkboxState", "amount", "quality", "enabled", "isSupported" }
local bindings = { "expectedServerEpoch", "expectedReflectionsRevision", "expectedActiveModule", "expectedSelectedPhotoUuid",
    "expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt" }
local seenEpoch, highestOperation = nil, 0
local function encode(value)
    return (string.gsub(tostring(value == nil and "null" or value), "([^%w%-_%.~])", function(c) return string.format("%%%02X", string.byte(c)) end))
end
local function bindingUrl(c)
    local url = ""; for _, k in ipairs(bindings) do url = url .. "&" .. k .. "=" .. encode(c[k]) end; return url
end
local function photoMatches(c)
    local photo = LrApplication.activeCatalog():getTargetPhoto()
    return c.expectedActiveModule == "develop" and LrApplicationView.getCurrentModuleName() == "develop" and
        photo ~= nil and photo:getRawMetadata("uuid") == c.expectedSelectedPhotoUuid
end
local function valid(field, value)
    if field == "checkboxState" then return type(value) == "boolean" end
    if field == "amount" then return type(value) == "number" and value == value and value >= -100 and value <= 100 end
    return field == "quality" and ({ preview = true, standard = true, best = true })[value] == true
end
local function read(c)
    local ok, snapshot = LrTasks.pcall(function()
        if not photoMatches(c) then return nil end
        local p = SDK.getReflectionRemovalPanelState()
        if type(p) ~= "table" or not valid("checkboxState", p.checkboxState) or not valid("amount", p.amount) or
            not valid("quality", p.quality) or type(p.enabled) ~= "boolean" or type(p.isSupported) ~= "boolean" or not photoMatches(c) then return nil end
        local out = { available = true }; for _, k in ipairs(fields) do out[k] = p[k] end; return out
    end)
    return ok and snapshot or { available = false, reason = "Native Reflections state unavailable." }
end
local function snapshotUrl(s)
    local url = "&available=" .. tostring(s.available) .. "&reason=" .. encode(s.reason)
    for _, k in ipairs(fields) do url = url .. "&" .. k .. "=" .. encode(s[k]) end; return url
end
local function snapshotDetail(s)
    if not s or not s.available then return "native state unavailable" end
    return "Apply=" .. (s.checkboxState and "on" or "off") .. ", Amount=" .. tostring(s.amount) ..
        ", Quality=" .. tostring(s.quality) .. ", panel enabled=" .. tostring(s.enabled) ..
        ", supported=" .. tostring(s.isSupported)
end
local function validate(c)
    local body = LrHttp.get(base .. "validate?operationId=" .. encode(c.operationId) .. bindingUrl(c))
    return type(body) == "string" and string.find(body, [["valid":true]], 1, true) ~= nil
end
function Reflections.sendRequestedSnapshot(json)
    local c = Parser.parse(json)
    if not c or c.command ~= "reflections.query" or not c.requestId then return false end
    LrHttp.get(base .. "query-result?requestId=" .. encode(c.requestId) .. bindingUrl(c) .. snapshotUrl(read(c)))
    return true
end
function Reflections.set(c)
    -- A closure belongs only to this original command; late callbacks never write or publish state.
    local alive, completed, invoked, deferred = true, false, false, false
    local function result(outcome, detail, snapshot, preserved)
        LrHttp.get(base .. "operation-result?operationId=" .. encode(c.operationId) .. bindingUrl(c) ..
            "&field=" .. encode(c.field) .. "&value=" .. encode(c.value) .. "&outcome=" .. outcome .. "&detail=" .. encode(detail) ..
            "&callbackCompleted=" .. tostring(completed) .. "&invoked=" .. tostring(invoked) .. "&preserved=" .. tostring(preserved == true) .. snapshotUrl(snapshot or read(c)))
    end
    local function preserved(s)
        return s.available and (c.field == "checkboxState" or s.checkboxState == c.expectedCheckboxState) and
            (c.field == "amount" or s.amount == c.expectedAmount) and (c.field == "quality" or s.quality == c.expectedQuality)
    end
    local function baseline(s)
        local expected = c.field == "checkboxState" and c.expectedCheckboxState or c.field == "amount" and c.expectedAmount or c.expectedQuality
        -- Avoid Lua's false-valued ternary for the checkbox baseline.
        if c.field == "checkboxState" then expected = c.expectedCheckboxState end
        return s.available and s.enabled and s.isSupported and preserved(s) and (s[c.field] == expected or s[c.field] == c.value)
    end
    local ok = LrTasks.pcall(function()
        if not valid(c.field, c.value) or not validate(c) or not photoMatches(c) then result("stale", "Reflections context changed."); return end
        local number = tonumber(string.match(c.operationId or "", "^rf%-(%d+)$"))
        if not number then result("failed", "Invalid Reflections operation."); return end
        if seenEpoch ~= c.expectedServerEpoch then seenEpoch, highestOperation = c.expectedServerEpoch, 0 end
        if number <= highestOperation then return end
        highestOperation = number
        local before = read(c)
        if not baseline(before) or not validate(c) then result("stale", "Reflections availability or native settings changed.", before); return end
        -- The validation HTTP call yields: reread settings and photo immediately before any SDK mutation.
        before = read(c)
        if not baseline(before) or not photoMatches(c) then result("stale", "Reflections settings changed before execution.", before); return end
        if before[c.field] == c.value then result("confirmed", "Requested Reflections state already confirmed by Lightroom.", before, true); return end
        local callback = function() if alive then completed = true end end
        local args = { operationId = c.operationId, selectedPhotoUuid = c.expectedSelectedPhotoUuid, serverEpoch = c.expectedServerEpoch }
        invoked = true
        -- Exact SDK15.3 signatures. Supply current native settings to Apply, never optional SDK defaults.
        if c.field == "checkboxState" then SDK.toggleReflectionRemoval(before.amount, before.quality, callback, args)
        elseif c.field == "quality" then SDK.changeReflectionRemovalQuality(c.value, callback, args)
        else SDK.changeReflectionRemovalAmount(c.value) end
        result("requested", "Request sent to Lightroom; awaiting native confirmation.")
        local publishedCallback = completed
        -- Wait outside the serial command worker so normal heartbeat/context feedback continues.
        -- Admission retains one Reflections owner. This task only validates and reads, never retries.
        LrTasks.startAsyncTask(function()
        local waitOk = LrTasks.pcall(function()
        local lastAfter
        for attempt = 1, (c.field == "amount" and 40 or 900) do
            if not validate(c) or not photoMatches(c) then result("stale", "Photo or context changed during Reflections processing."); return end
            local after = read(c)
            lastAfter = after
            if completed and not publishedCallback then
                result("requested", "SDK callback received; awaiting native readback.", after); publishedCallback = true
            end
            if after.available and not preserved(after) then result("failed", "Other Reflections settings changed before confirmation.", after); return end
            -- Turning Apply off may disable the panel UI represented by `enabled`. The requested
            -- checkbox readback remains authoritative; keep callback and support requirements.
            local enabledForConfirmation = after.enabled or (c.field == "checkboxState" and c.value == false)
            if after.available and enabledForConfirmation and after.isSupported and after[c.field] == c.value and (c.field == "amount" or completed) then
                result("confirmed", "Reflections confirmed by Lightroom readback.", after, true); return
            end
            if attempt < (c.field == "amount" and 40 or 900) then LrTasks.sleep(0.1) end
        end
        result("failed", "Reflections timed out: " .. snapshotDetail(lastAfter) .. "; SDK callback " ..
            (completed and "received" or "not received") .. ". No retry was sent.", lastAfter)
        end)
        alive = false
        if not waitOk then LrTasks.pcall(function() result("failed", "Reflections readback failed; result unconfirmed. No retry sent.") end) end
        end)
        deferred = true
    end)
    if not deferred or not ok then alive = false end
    if not ok then LrTasks.pcall(function() result("failed", "SDK error; Reflections result unconfirmed. No retry was sent.") end) end
end
return Reflections
