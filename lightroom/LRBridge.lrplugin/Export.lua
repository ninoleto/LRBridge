local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrTasks = import "LrTasks"
local LrHttp = import "LrHttp"
local Export = {}
local base = "http://127.0.0.1:17891/export/"
local fields = { "command", "requestId", "expectedServerEpoch", "expectedActiveModule", "expectedSelectedPhotoUuid",
    "expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt" }
local lease = nil
local seen = {} -- Per-server-epoch high water marks; never reset when an old epoch reappears.
local function encode(v)
    return (string.gsub(tostring(v == nil and "null" or v), "([^%w%-_%.~])", function(c) return string.format("%%%02X", string.byte(c)) end))
end
local function urlFields(c, action)
    local parts = {}
    for _, k in ipairs(fields) do parts[#parts + 1] = k .. "=" .. encode(c[k]) end
    if action then
        parts[#parts + 1] = "operationId=" .. encode(c.operationId)
        parts[#parts + 1] = "expectedSelectionToken=" .. encode(c.expectedSelectionToken)
    end
    return table.concat(parts, "&")
end
local function running(owner)
    local lifecycle = _G.LRBridgePollingLifecycle
    return lifecycle == owner and (not lifecycle or not lifecycle.stopping)
end
-- localIdentifier is SDK-documented, read-only and unique within its catalog.
-- Selection membership uses exact sorted identifiers, never count/active-photo alone.
local function identity()
    local catalog = LrApplication.activeCatalog()
    local photo = catalog:getTargetPhoto()
    if not photo or type(photo.localIdentifier) ~= "number" then return nil end
    local ids, unique, containsActive = {}, {}, false
    for _, p in ipairs(catalog:getTargetPhotos()) do
        local id = p.localIdentifier
        if type(id) ~= "number" or unique[id] then return nil end
        ids[#ids + 1], unique[id] = id, true
        if id == photo.localIdentifier then containsActive = true end
    end
    if #ids == 0 or not containsActive then return nil end
    table.sort(ids)
    local path = catalog:getPath()
    if type(path) ~= "string" or path == "" then return nil end
    return { catalog = catalog, path = path, photo = photo, active = photo.localIdentifier,
        ids = ids, module = LrApplicationView.getCurrentModuleName() }
end
local function same(a, b)
    if not a or not b or a.catalog ~= b.catalog or a.path ~= b.path or a.active ~= b.active or a.module ~= b.module or #a.ids ~= #b.ids then return false end
    for i, id in ipairs(a.ids) do if b.ids[i] ~= id then return false end end
    return true
end
local function capture(c, owner)
    local first = identity()
    if not first or (first.module ~= "library" and first.module ~= "develop") or first.module ~= c.expectedActiveModule then return nil end
    -- Metadata can yield: read it before a second complete native identity check.
    local uuid = first.photo:getRawMetadata("uuid")
    local last = identity()
    if not running(owner) or uuid ~= c.expectedSelectedPhotoUuid or not same(first, last) then return nil end
    last.uuid = uuid
    return last
end
function Export.query(c)
    local owner = _G.LRBridgePollingLifecycle
    local ok, native = LrTasks.pcall(capture, c, owner)
    local available = ok and native ~= nil
    local dialog, previous = false, false
    if available then
        dialog = type(native.photo.openExportDialog) == "function"
        previous = type(native.photo.openExportWithPreviousDialog) == "function"
        if not lease or lease.epoch ~= c.expectedServerEpoch or not same(lease.native, native) or lease.native.uuid ~= native.uuid then
            lease = { native = native, epoch = c.expectedServerEpoch, token = c.expectedServerEpoch .. ":" .. c.requestId }
        end
    else lease = nil end
    if not running(owner) then return end
    LrHttp.get(base .. "query-result?" .. urlFields(c, false) .. "&available=" .. tostring(available) ..
        "&selectionToken=" .. encode(available and lease.token or nil) .. "&selectionCount=" .. tostring(available and #native.ids or 0) ..
        "&dialogSupported=" .. tostring(dialog) .. "&previousSupported=" .. tostring(previous))
end
function Export.execute(c)
    local owner = _G.LRBridgePollingLifecycle
    local method = ({ ["export.dialog"] = "openExportDialog", ["export.previous"] = "openExportWithPreviousDialog" })[c.command]
    local number = tonumber(string.match(c.operationId or "", "^ex%-(%d+)$"))
    if not method or not number or type(c.expectedServerEpoch) ~= "string" or not running(owner) then return end
    if number <= (seen[c.expectedServerEpoch] or 0) then return end
    seen[c.expectedServerEpoch] = number -- Consumed before any yielding network/SDK work, including failures.
    local invoked, claimed = false, false
    local function result(outcome)
        if running(owner) then LrHttp.get(base .. "operation-result?" .. urlFields(c, true) .. "&outcome=" .. outcome .. "&invoked=" .. tostring(invoked)) end
    end
    local ok = LrTasks.pcall(function()
        local expected = lease
        local body = LrHttp.get(base .. "claim?" .. urlFields(c, true))
        if type(body) ~= "string" or not string.find(body, [["valid":true]], 1, true) then return end
        claimed = true
        local native = capture(c, owner) -- HTTP claim yields; final native check must follow it.
        if not expected or expected ~= lease or expected.epoch ~= c.expectedServerEpoch or expected.token ~= c.expectedSelectionToken or
            not same(expected.native, native) or expected.native.uuid ~= native.uuid or type(native.photo[method]) ~= "function" then
            result("stale"); return
        end
        lease = nil
        -- No HTTP, sleep, selection changes or per-photo loop between the final check and this single call.
        invoked = true
        local accepted = native.photo[method](native.photo)
        result(accepted == false and "uncertain" or "requested")
    end)
    if not ok and claimed then LrTasks.pcall(function() result(invoked and "uncertain" or "stale") end) end
end
return Export
