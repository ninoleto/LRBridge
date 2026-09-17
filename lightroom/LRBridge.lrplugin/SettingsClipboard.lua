local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrTasks = import "LrTasks"
local LrHttp = import "LrHttp"
local SettingsClipboard = {}
local base = "http://127.0.0.1:17891/clipboard/"
local fields = { "command", "requestId", "expectedServerEpoch", "expectedActiveModule", "expectedSelectedPhotoUuid",
    "expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt" }
local lease = nil
local seen = {}
local function encode(v)
    return (string.gsub(tostring(v == nil and "null" or v), "([^%w%-_%.~])", function(c) return string.format("%%%02X", string.byte(c)) end))
end
local function urlFields(c, action)
    local parts = {}
    for _, k in ipairs(fields) do parts[#parts + 1] = k .. "=" .. encode(c[k]) end
    if action then
        for _, k in ipairs({ "operationId", "expectedSelectionToken", "updateAISettings" }) do parts[#parts + 1] = k .. "=" .. encode(c[k]) end
    end
    return table.concat(parts, "&")
end
local function running(owner)
    local lifecycle = _G.LRBridgePollingLifecycle
    return lifecycle == owner and (not lifecycle or not lifecycle.stopping)
end
local function identity()
    local catalog = LrApplication.activeCatalog()
    local photo = catalog and catalog:getTargetPhoto()
    if not photo or type(photo.localIdentifier) ~= "number" then return nil end
    local ids, photos, unique, containsActive = {}, {}, {}, false
    -- Reject missing active photo before the SDK's all-Filmstrip fallback.
    for _, p in ipairs(catalog:getTargetPhotos()) do
        local id = p.localIdentifier
        if type(id) ~= "number" or unique[id] then return nil end
        ids[#ids + 1], photos[#photos + 1], unique[id] = id, p, true
        if id == photo.localIdentifier then containsActive = true end
    end
    if #ids == 0 or not containsActive then return nil end
    table.sort(ids)
    local path = catalog:getPath()
    if type(path) ~= "string" or path == "" then return nil end
    return { catalog = catalog, path = path, photo = photo, active = photo.localIdentifier,
        ids = ids, photos = photos, module = LrApplicationView.getCurrentModuleName() }
end
local function same(a, b)
    if not a or not b or a.catalog ~= b.catalog or a.path ~= b.path or a.active ~= b.active or a.module ~= b.module or #a.ids ~= #b.ids then return false end
    for i, id in ipairs(a.ids) do if b.ids[i] ~= id then return false end end
    return true
end
local function capture(c, owner)
    local first = identity()
    if not first or (first.module ~= "library" and first.module ~= "develop") or first.module ~= c.expectedActiveModule then return nil end
    local uuid = first.photo:getRawMetadata("uuid") -- May yield: repeat the entire identity afterwards.
    local last = identity()
    if not running(owner) or uuid ~= c.expectedSelectedPhotoUuid or not same(first, last) then return nil end
    last.uuid = uuid
    return last
end
local function canPaste(native)
    return #native.photos == 1 and type(native.photo.pasteSettings) == "function" or
        #native.photos > 1 and type(native.catalog.pasteSettings) == "function"
end
function SettingsClipboard.query(c)
    local owner = _G.LRBridgePollingLifecycle
    local ok, native = LrTasks.pcall(capture, c, owner)
    local available = ok and native ~= nil
    local copy, paste = false, false
    if available then
        copy, paste = type(native.photo.copySettings) == "function", canPaste(native)
        if not lease or lease.epoch ~= c.expectedServerEpoch or not same(lease.native, native) or lease.native.uuid ~= native.uuid then
            lease = { native = native, epoch = c.expectedServerEpoch, token = c.expectedServerEpoch .. ":" .. c.requestId }
        end
    else lease = nil end
    if not running(owner) then return end
    LrHttp.get(base .. "query-result?" .. urlFields(c, false) .. "&available=" .. tostring(available) ..
        "&selectionToken=" .. encode(available and lease.token or nil) .. "&selectionCount=" .. tostring(available and #native.ids or 0) ..
        "&copySupported=" .. tostring(copy) .. "&pasteSupported=" .. tostring(paste))
end
function SettingsClipboard.execute(c)
    local owner = _G.LRBridgePollingLifecycle
    local paste = c.command == "clipboard.paste"
    local number = tonumber(string.match(c.operationId or "", "^cb%-(%d+)$"))
    if (not paste and c.command ~= "clipboard.copy") or not number or c.updateAISettings ~= paste or
        type(c.expectedServerEpoch) ~= "string" or not running(owner) then return end
    if number <= (seen[c.expectedServerEpoch] or 0) then return end
    seen[c.expectedServerEpoch] = number -- Consume even failed/uncertain attempts; never replay.
    local invoked, claimed, sdkOk, sdkResult, targets = false, false, false, nil, nil
    local aiPending, aiChecked = nil, 0
    local expected = lease
    local function validNative()
        local body = LrHttp.get(base .. "validate?" .. urlFields(c, true))
        if type(body) ~= "string" or not string.find(body, [["valid":true]], 1, true) then return nil end
        local native = capture(c, owner)
        if not expected or expected ~= lease or expected.epoch ~= c.expectedServerEpoch or expected.token ~= c.expectedSelectionToken or
            not same(expected.native, native) or expected.native.uuid ~= native.uuid then return nil end
        if paste and not canPaste(native) or not paste and type(native.photo.copySettings) ~= "function" then return nil end
        return native
    end
    local function invoke()
        if invoked then return end
        local native = validNative() -- For Paste this runs INSIDE the acquired write gate.
        if not native then return end
        lease, targets, invoked = nil, native.photos, true
        -- No HTTP/yield/selection rewrite after final validation; one SDK mutation only.
        -- Catch inside the gate so an SDK exception cannot trigger an implicit retry/rollback.
        sdkOk, sdkResult = LrTasks.pcall(function()
            if not paste then return native.photo:copySettings() end
            if #targets == 1 then return native.photo:pasteSettings(true) end
            return native.catalog:pasteSettings(targets, true)
        end)
    end
    local ok = LrTasks.pcall(function()
        local body = LrHttp.get(base .. "claim?" .. urlFields(c, true))
        if type(body) ~= "string" or not string.find(body, [["valid":true]], 1, true) then return end
        claimed = true
        if paste then
            local catalog = LrApplication.activeCatalog()
            catalog:withWriteAccessDo("LRBridge Paste Settings", invoke, { timeout = 5, asynchronous = false })
        else invoke() end
    end)
    if not claimed then return end
    if paste and invoked and running(owner) then
        -- Read only the captured destinations. This is status at the time of each read,
        -- not an AI job/completion observer and not proof of preservation or visual success.
        local readOk = LrTasks.pcall(function()
            local pending = 0
            for _, photo in ipairs(targets) do
                if not running(owner) or LrApplication.activeCatalog() ~= expected.native.catalog then return end
                local value = photo:needsUpdateAISettings()
                if type(value) ~= "boolean" then return end
                aiChecked = aiChecked + 1
                if value then pending = pending + 1 end
            end
            aiPending = pending
        end)
        if not readOk then aiPending = nil end
        LrTasks.pcall(function() if running(owner) then require("History").sendCurrentState() end end)
    end
    local outcome = not invoked and "stale" or ok and sdkOk and sdkResult == true and "success" or "uncertain"
    if not sdkOk or type(sdkResult) ~= "boolean" then sdkResult = nil end
    LrTasks.pcall(function()
        if running(owner) then LrHttp.get(base .. "operation-result?" .. urlFields(c, true) .. "&outcome=" .. outcome ..
            "&invoked=" .. tostring(invoked) .. "&sdkResult=" .. encode(sdkResult) ..
            "&aiPendingCount=" .. encode(aiPending) .. "&aiCheckedCount=" .. tostring(aiChecked)) end
    end)
end
return SettingsClipboard
