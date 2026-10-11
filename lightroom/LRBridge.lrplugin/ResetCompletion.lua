-- Runs synchronously inside Commands.execute, while the serial worker is busy.
-- Independent feedback reads can never complete an identified Reset.
local App = import "LrApplication"
local View = import "LrApplicationView"
local Tasks = import "LrTasks"
local Http = import "LrHttp"
local Driver = require "Driver"
local Query = require "Query"
local Reset = {}
local base = "http://127.0.0.1:17891/reset/"
local function finite(v) return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge end
local function encode(v)
    return (string.gsub(tostring(v), "([^%w%-_%.~])", function(ch) return string.format("%%%02X", string.byte(ch)) end))
end
local function running(owner) return _G.LRBridgePollingLifecycle == owner and (not owner or not owner.stopping) end
local function nativeSame(a, owner)
    if not a or not running(owner) or View.getCurrentModuleName() ~= "develop" then return false end
    local catalog = App.activeCatalog()
    return catalog == a.catalog and catalog:getTargetPhoto() == a.photo
end
local function capture(c, owner)
    if not running(owner) or View.getCurrentModuleName() ~= "develop" then return nil end
    local catalog = App.activeCatalog()
    local photo = catalog and catalog:getTargetPhoto()
    if not photo then return nil end
    local a = { catalog = catalog, photo = photo }
    if photo:getRawMetadata("uuid") ~= c.expectedSelectedPhotoUuid or not nativeSame(a, owner) then return nil end
    local settings = photo:getDevelopSettings()
    if type(settings) ~= "table" or not nativeSame(a, owner) then return nil end
    a.process, a.available = settings.ProcessVersion, true
    if c.slider == "ProfileAmount" then
        local look = type(settings.Look) == "table" and settings.Look or {}
        local ai = type(settings.AILook) == "table" and settings.AILook or {}
        local isAi = ai.Active == true or type(settings.AILook) == "string" and settings.AILook ~= ""
        local supports = look.SupportsAmount
        if isAi then supports = ai.SupportsAmount end
        a.available = supports ~= false and supports ~= "false" and (isAi or type(look.Name) == "string" and look.Name ~= "")
        a.profile = table.concat({ tostring(settings.CameraProfile), tostring(look.Name), tostring(look.UUID), tostring(isAi),
            tostring(ai.InputDigest), tostring(ai.AILookData), tostring(supports) }, "\n")
    end
    return a
end
local function same(a, b)
    return a and b and a.catalog == b.catalog and a.photo == b.photo and a.process == b.process and a.profile == b.profile
end
function Reset.execute(c)
    local owner = _G.LRBridgePollingLifecycle
    if not running(owner) then return end
    local key = "serverEpoch=" .. encode(c.expectedServerEpoch) .. "&requestId=" .. encode(c.requestId) .. "&operationId=" .. encode(c.operationId)
    local claimed, invoked, succeeded, outcome, value = false, false, false, "stale", nil
    local revision, first = c.admittedDevelopCounter, nil
    local function validate()
        local response = Http.get(base .. "validate?" .. key)
        if not running(owner) or type(response) ~= "string" or not string.find(response, [["valid":true]], 1, true) then return false end
        local current = tonumber(string.match(response, '"developCounter"%s*:%s*(%d+)'))
        if not current or current < c.admittedDevelopCounter then return false end
        revision = current
        return true
    end
    local function owns()
        local current = capture(c, owner)
        return same(first, current)
    end
    local ok = Tasks.pcall(function()
        local response = Http.get(base .. "claim?" .. key)
        if type(response) ~= "string" or not string.find(response, [["valid":true]], 1, true) then return end
        claimed = true -- One-use server claim also prevents replay after plug-in reload.
        first = capture(c, owner)
        if not first then return end
        if not first.available then outcome = "unavailable"; return end
        local guardEntered = false
        local resetOk = Driver.resetSlider(c.slider, c, function()
            guardEntered = true
            -- Driver's reveal/sleep/tracking can yield. Recheck server ownership
            -- and actual photo/process/profile before the SDK mutation.
            if not validate() or not owns() then return false end
            invoked = true
            return true
        end)
        if not invoked then if not guardEntered then outcome = "failed" end; return end
        if resetOk ~= true then outcome = "failed"; return end
        succeeded = true
        outcome = "uncertain"
        if not nativeSame(first, owner) then return end
        -- EXACT CAPTURE LOCATION: after this Reset's successful Driver return,
        -- inside this serial command, before /operation-result or the next edit.
        local readback = Query.getDevelopValue(c.slider)
        if not owns() then return end
        if not finite(readback) then outcome = "unavailable"; return end
        value, outcome = readback, "observed"
    end)
    if not ok then outcome, value = succeeded and "uncertain" or "failed", nil end
    if not claimed or not running(owner) then return end
    -- Result delivery yields too. Validate immediately before publishing; the
    -- server independently rejects old epochs and invalidated receipt owners.
    local guardOk, valid = Tasks.pcall(function() return validate() and (not first or owns()) end)
    if guardOk ~= true or not valid then outcome, value = invoked and "uncertain" or "stale", nil end
    if not running(owner) then return end -- Server timeout supplies an uncertain outcome.
    local parts = { key, "slider=" .. encode(c.slider), "selectedPhotoUuid=" .. encode(c.expectedSelectedPhotoUuid),
        "contextCounter=" .. encode(c.expectedContextCounter), "contextChangedAt=" .. encode(c.expectedContextChangedAt),
        "executionDevelopCounter=" .. encode(revision), "outcome=" .. outcome, "invoked=" .. tostring(invoked), "resetSucceeded=" .. tostring(succeeded) }
    if value ~= nil and outcome == "observed" then parts[#parts + 1] = "sdkValue=" .. encode(value) end
    local response = Http.get(base .. "operation-result?" .. table.concat(parts, "&"))
    if type(response) ~= "string" or not string.find(response, [["ok":true]], 1, true) then error("Reset completion delivery rejected or unavailable") end
end
return Reset
