-- Ordered numeric-step counts. No SDK increment/decrement calls and no cached baseline.
local App = import "LrApplication"
local View = import "LrApplicationView"
local Tasks = import "LrTasks"
local Http = import "LrHttp"
local Driver = require "Driver"
local Query = require "Query"
local Nudge = {}
local base = "http://127.0.0.1:17891/nudge/"
local seen = {} -- High water per epoch; the server claim also survives plug-in reloads.
local function finite(v) return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge end
local function encode(v)
    return (string.gsub(tostring(v), "([^%w%-_%.~])", function(ch) return string.format("%%%02X", string.byte(ch)) end))
end
local function running(owner)
    return _G.LRBridgePollingLifecycle == owner and (not owner or not owner.stopping)
end
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
    -- Metadata/settings can yield. Revalidate the actual photo and module afterward.
    if photo:getRawMetadata("uuid") ~= c.expectedSelectedPhotoUuid then return nil end
    local settings = photo:getDevelopSettings()
    if type(settings) ~= "table" or not nativeSame(a, owner) then return nil end
    a.process = settings.ProcessVersion
    if c.slider == "ProfileAmount" then
        local look = type(settings.Look) == "table" and settings.Look or {}
        local ai = type(settings.AILook) == "table" and settings.AILook or {}
        local isAi = ai.Active == true or type(settings.AILook) == "string" and settings.AILook ~= ""
        local supports = look.SupportsAmount
        if isAi then supports = ai.SupportsAmount end
        -- Same fallback as beta.2's Profile Amount presentation: explicit false
        -- disables; otherwise an active Look/AILook plus a numeric SDK read is required.
        a.available = supports ~= false and supports ~= "false" and
            (isAi or type(look.Name) == "string" and look.Name ~= "")
        a.profile = table.concat({ tostring(settings.CameraProfile), tostring(look.Name), tostring(look.UUID),
            tostring(isAi), tostring(ai.InputDigest), tostring(ai.AILookData), tostring(supports) }, "\n")
    else a.available = true end
    return a
end
local function same(a, b)
    return a and b and a.catalog == b.catalog and a.photo == b.photo and a.process == b.process and a.profile == b.profile
end
local function clamp(v, low, high) return math.min(high, math.max(low, v)) end
local coupledBounds = {
    ParametricShadowSplit = { nil, "ParametricMidtoneSplit", 10 },
    ParametricMidtoneSplit = { "ParametricShadowSplit", "ParametricHighlightSplit", 10 },
    ParametricHighlightSplit = { "ParametricMidtoneSplit", nil, 10 },
    DefringePurpleHueLo = { nil, "DefringePurpleHueHi", 10 },
    DefringePurpleHueHi = { "DefringePurpleHueLo", nil, 10 },
    DefringeGreenHueLo = { nil, "DefringeGreenHueHi", 10 },
    DefringeGreenHueHi = { "DefringeGreenHueLo", nil, 10 }
}
local function currentBounds(slider)
    local low, high = Query.getDevelopRange(slider)
    if not finite(low) or not finite(high) then return nil end
    local pair = coupledBounds[slider]
    if pair then
        if pair[1] then
            local lower = Query.getDevelopValue(pair[1]); if not finite(lower) then return nil end
            low = math.max(low, lower + pair[3])
        end
        if pair[2] then
            local upper = Query.getDevelopValue(pair[2]); if not finite(upper) then return nil end
            high = math.min(high, upper - pair[3])
        end
    end
    return low, high
end
local function calculate(c, value, low, high)
    local scale = 10 ^ c.precision
    for _, count in ipairs(c.steps) do
        local bounded = clamp(value + count * c.numericStep, low, high)
        if math.abs(bounded - low) < 1e-9 then value = low
        elseif math.abs(bounded - high) < 1e-9 then value = high
        else
            local snapped = low + math.floor((bounded - low) / c.numericStep + 0.5 + 1e-9) * c.numericStep
            value = clamp(math.floor(snapped * scale + 0.5 + 1e-9) / scale, low, high)
        end
    end
    return value
end
function Nudge.execute(c)
    local owner = _G.LRBridgePollingLifecycle
    local serial = tonumber(string.match(c.operationId or "", "^nn%-(%d+)$"))
    if not serial or not running(owner) or type(c.expectedServerEpoch) ~= "string" then return end
    if serial <= (seen[c.expectedServerEpoch] or 0) then return end
    seen[c.expectedServerEpoch] = serial -- Consume before yielding, even if execution fails.
    local key = "serverEpoch=" .. encode(c.expectedServerEpoch) .. "&requestId=" .. encode(c.requestId) .. "&operationId=" .. encode(c.operationId)
    local claimed, invoked, outcome = false, false, "stale"
    local revision = c.admittedDevelopCounter
    local values = {}
    local function complete()
        if not claimed or not running(owner) then return end
        local parts = { key, "outcome=" .. outcome, "invoked=" .. tostring(invoked), "executionDevelopCounter=" .. tostring(revision) }
        for k, v in pairs(values) do parts[#parts + 1] = k .. "=" .. encode(v) end
        local response = Http.get(base .. "operation-result?" .. table.concat(parts, "&"))
        if type(response) ~= "string" or not string.find(response, [["ok":true]], 1, true) then error("Numeric nudge result delivery failed") end
    end
    local ok = Tasks.pcall(function()
        local response = Http.get(base .. "claim?" .. key)
        if type(response) ~= "string" or not string.find(response, [["valid":true]], 1, true) then return end
        claimed = true
        local first = capture(c, owner)
        if not first then return end
        if not first.available then outcome = "unavailable"; return end
        local finalIdentity, guardEntered = nil, false
        local written = Driver.setSlider(c.slider, nil, c, function()
            guardEntered = true
            -- Driver has now completed revealPanel/sleep AND startTracking.
            local guard = Http.get(base .. "validate?" .. key)
            if type(guard) ~= "string" or not string.find(guard, [["valid":true]], 1, true) then return nil end
            local observedRevision = tonumber(string.match(guard, '"developCounter"%s*:%s*(%d+)'))
            if not observedRevision or observedRevision < c.admittedDevelopCounter then return nil end
            revision = observedRevision
            local last = capture(c, owner)
            if not same(first, last) then return nil end
            if not last.available then outcome = "unavailable"; return nil end
            -- These are live SDK reads in the serial worker, after the preceding
            -- Reset returned. The existing preparation sleep is NOT a Reset barrier.
            local value = Query.getDevelopValue(c.slider)
            local low, high = currentBounds(c.slider)
            if not nativeSame(last, owner) then return nil end
            if not finite(value) or not finite(low) or not finite(high) or low >= high or value < low or value > high then
                outcome = "unavailable"; return nil
            end
            local target = calculate(c, value, low, high)
            values = { baselineValue = value, requestedValue = target, min = low, max = high }
            finalIdentity, invoked = last, true
            -- No yielding work between the read/calculate/identity check and SDK setValue.
            return target
        end)
        if not invoked then
            if not guardEntered then outcome = "failed" end
            return
        end
        if not written then outcome = "uncertain"; return end
        outcome = "requested"
        -- An independent SDK read, never the calculated target masquerading as feedback.
        local after = capture(c, owner)
        if not same(finalIdentity, after) or not after.available then outcome = "uncertain"; return end
        local readback = Query.getDevelopValue(c.slider)
        if not nativeSame(after, owner) then outcome = "uncertain"; return end
        if finite(readback) and readback >= values.min and readback <= values.max then
            values.sdkValue, outcome = readback, "observed"
        end
    end)
    if not ok then outcome = invoked and "uncertain" or "failed"; values.sdkValue = nil end
    complete()
end
return Nudge
