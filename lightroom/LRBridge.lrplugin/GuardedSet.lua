-- One absolute target per accumulated button batch. Runs in the existing worker.
local App = import "LrApplication"
local View = import "LrApplicationView"
local Tasks = import "LrTasks"
local Http = import "LrHttp"
local SDK = import "LrDevelopController"
local Driver = require "Driver"
local M = {}
local function encode(v)
    if type(v) == "number" and v == math.floor(v) then v = string.format("%.0f", v) end
    return (string.gsub(tostring(v), "([^%w%-_%.~])", function(ch) return string.format("%%%02X", string.byte(ch)) end))
end
local function finite(v) return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge end
function M.execute(c)
    local lifecycle = _G.LRBridgePollingLifecycle
    local function running() return _G.LRBridgePollingLifecycle == lifecycle and (not lifecycle or not lifecycle.stopping) end
    if not running() then return end
    local key = "serverEpoch=" .. encode(c.expectedServerEpoch) .. "&requestId=" .. encode(c.requestId) .. "&operationId=" .. encode(c.operationId)
    local base = "http://127.0.0.1:17891/set/"
    local claimed, invoked, entered, outcome, reason = false, false, false, "rejected", "ownership"
    local catalog, photo, process, nativeProcess
    local function same()
        return running() and View.getCurrentModuleName() == "develop" and catalog and App.activeCatalog() == catalog and catalog:getTargetPhoto() == photo
    end
    local function owns()
        if not same() then return false end
        local uuid = photo:getRawMetadata("uuid")
        if uuid ~= c.expectedSelectedPhotoUuid or not same() then return false end
        local settings = photo:getDevelopSettings()
        return type(settings) == "table" and settings.ProcessVersion == process and same()
    end
    local ok = Tasks.pcall(function()
        local response = Http.get(base .. "claim?" .. key)
        if type(response) ~= "string" or not string.find(response, [["valid":true]], 1, true) then return end
        claimed = true
        catalog = App.activeCatalog(); photo = catalog and catalog:getTargetPhoto()
        if not photo or not same() then return end
        local settings = photo:getDevelopSettings()
        if type(settings) ~= "table" or not same() then return end
        process = settings.ProcessVersion
        nativeProcess = SDK.getProcessVersion()
        if not owns() then return end
        local succeeded = Driver.setSlider(c.slider, c.value, c, function()
            entered = true
            -- revealPanel/sleep/startTracking have already yielded. Validate the
            -- receipt after those operations, then inspect native ownership.
            local valid = Http.get(base .. "validate?" .. key)
            if type(valid) ~= "string" or not string.find(valid, [["valid":true]], 1, true) or not owns() then return nil end
            local lo, hi = SDK.getRange(c.slider)
            if not finite(lo) or not finite(hi) or c.value < lo or c.value > hi or not same() then reason = "unavailable"; return nil end
            -- Last SDK read before the write; no HTTP or yielding preparation
            -- follows it. No cached value, requested value or guessed default.
            local actual = SDK.getValue(c.slider)
            if not same() or SDK.getProcessVersion() ~= nativeProcess or not same() then return nil end
            if not finite(actual) then reason = "unavailable"; return nil end
            if actual ~= c.expectedValue then reason = "baseline-mismatch"; return nil end
            invoked = true
            return c.value
        end)
        if invoked then outcome, reason = succeeded == true and "applied" or "uncertain", succeeded == true and "sdk-returned" or "sdk-error"
        elseif not entered then reason = "unavailable" end
    end)
    if not ok then outcome, reason = invoked and "uncertain" or "rejected", "sdk-error" end
    if entered and not invoked then Tasks.pcall(function() SDK.stopTracking(false) end) end
    if not claimed or not running() then return end -- Retained receipt times out; never replay blindly.
    -- Applied describes successful SDK invocation of this operation. It is NOT a
    -- confirmed/current slider value; separate normal feedback owns that display.
    if invoked and not same() then outcome, reason = "uncertain", "ownership" end
    local parts = { key, "slider=" .. encode(c.slider), "selectedPhotoUuid=" .. encode(c.expectedSelectedPhotoUuid),
        "contextCounter=" .. encode(c.expectedContextCounter), "contextChangedAt=" .. encode(c.expectedContextChangedAt),
        "outcome=" .. outcome, "reason=" .. reason, "invoked=" .. tostring(invoked) }
    local response = Http.get(base .. "operation-result?" .. table.concat(parts, "&"))
    if type(response) ~= "string" or not string.find(response, [["ok":true]], 1, true) then error("Guarded Set settlement unavailable; do not replay") end
end
return M
