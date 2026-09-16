local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local SDK = import "LrDevelopController"
local LrTasks = import "LrTasks"
local LrHttp = import "LrHttp"
local LrMD5 = import "LrMD5"
local Parser = require "Parser"

local People = {}
local feature = "distractingPeopleRemoval"
local base = "http://127.0.0.1:17891/people/"
local fields = { "toolOpen", "count", "inventoryToken", "selectionReadable", "selectedIndex", "selectedToken",
    "navigationSupported", "detectSupported", "removeSupported" }
local bindings = { "expectedServerEpoch", "expectedPeopleRevision", "expectedActiveModule", "expectedSelectedPhotoUuid",
    "expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt" }
local seenEpoch, highestOperation = nil, 0

local function safeText(value, limit)
    local safe = tostring(value or "")
    safe = string.gsub(safe, "https?://%S+", "[redacted URL]")
    safe = string.gsub(safe, "%a:[/\\][^%c]+", "[redacted path]")
    safe = string.gsub(safe, "%?[^%s]+", "?[redacted]")
    safe = string.gsub(safe, "[%c]", " ")
    return string.sub(safe, 1, limit or 300)
end
local function describe(value)
    local kind = type(value)
    -- Never dump spot payloads, preferences, metatables or object addresses.
    if kind == "table" or kind == "function" or kind == "userdata" or kind == "thread" then return kind end
    return kind .. ":" .. safeText(tostring(value), 70)
end
local function trace(c, stage, detail)
    if type(_PLUGIN) ~= "table" or type(_PLUGIN.path) ~= "string" then return end
    local root = string.gsub(_PLUGIN.path, "[/\\]lightroom[/\\]LRBridge%.lrplugin$", "")
    if root == _PLUGIN.path then return end
    local safe = safeText(detail)
    pcall(function()
        local file = io.open(root .. "\\lrplugin-log.txt", "a")
        if file ~= nil then
            pcall(function()
                file:write(os.date("%Y-%m-%d %H:%M:%S") .. " People: operation=" .. safeText(c and c.operationId, 24) ..
                    " epoch=" .. safeText(c and c.expectedServerEpoch, 64) ..
                    " kind=" .. safeText(c and c.operationKind, 16) .. " stage=" .. safeText(stage, 32) ..
                    (#safe > 0 and " " .. safe or "") .. "\n")
            end)
            file:close()
        end
    end)
end

local function requireType(name, value, expected)
    if type(value) ~= expected then error(name .. " expected " .. expected .. "; got " .. describe(value), 0) end
end
local function reader(c, phase)
    local current = "photoMatches"
    local function capture(name, fn)
        current = name
        local value = fn()
        if phase then trace(c, "readback", phase .. " " .. name .. "=" .. describe(value)) end
        return value
    end
    local function failed(failure)
        local reason = safeText(current .. ": " .. tostring(failure), 200)
        if phase then trace(c, "read_failed", phase .. " " .. reason) end
        return reason
    end
    return capture, failed
end

local function encode(value)
    return (string.gsub(tostring(value == nil and "null" or value), "([^%w%-_%.~])", function(c) return string.format("%%%02X", string.byte(c)) end))
end
local function bindingUrl(c)
    local url = ""; for _, key in ipairs(bindings) do url = url .. "&" .. key .. "=" .. encode(c[key]) end; return url
end
local function photoMatches(c)
    local photo = LrApplication.activeCatalog():getTargetPhoto()
    return c.expectedActiveModule == "develop" and LrApplicationView.getCurrentModuleName() == "develop" and
        photo ~= nil and photo:getRawMetadata("uuid") == c.expectedSelectedPhotoUuid
end
local function quote(value)
    return '"' .. string.gsub(value, '[%z\1-\31\\"]', function(c) return string.format("\\u%04x", string.byte(c)) end) .. '"'
end
local function canonical(value, seen, budget, depth, scope)
    local kind = type(value); budget.n = budget.n + 1
    if budget.n > 20000 or depth > 12 then error("People inventory exceeds capture bounds") end
    if kind == "nil" or kind == "boolean" then return kind .. ":" .. tostring(value) end
    if kind == "number" and value == value and math.abs(value) < math.huge then return "number:" .. string.format("%.17g", value) end
    if kind == "string" and #value < 65536 then return "string:" .. quote(value) end
    if kind ~= "table" or seen[value] then error("Unsupported People inventory value: " .. describe(value), 0) end
    seen[value] = true
    local entries = {}
    for key, item in pairs(value) do
        if type(key) ~= "number" and type(key) ~= "string" then error("Unsupported People inventory key") end
        -- Repeated People reads regenerate these two IDs (pp-594 / pq-593).
        -- Ignore only their inventory paths; selection and preservation tokens stay raw.
        local ignored = scope == "spot" and key == "CorrectionID" or scope == "mask" and key == "MaskID"
        if not ignored then
            local childScope
            if type(key) == "number" and key >= 1 and key == math.floor(key) then
                if scope == "spots" then childScope = "spot"
                elseif scope == "masks" then childScope = "mask" end
            elseif scope == "spot" and key == "CorrectionMasks" then childScope = "masks" end
            table.insert(entries, canonical(key, seen, budget, depth + 1) .. "=" .. canonical(item, seen, budget, depth + 1, childScope))
        end
    end
    seen[value] = nil; table.sort(entries)
    local result = "table{" .. table.concat(entries, ";") .. "}"
    if #result > 262144 then error("People inventory exceeds capture bounds") end
    return result
end
local function token(value, scope)
    local raw = LrMD5.digest(canonical(value, {}, { n = 0 }, 0, scope))
    return (string.gsub(raw, ".", function(c) return string.format("%02x", string.byte(c)) end))
end
-- Read-only, bounded field evidence. It never supplies or relaxes an edit token.
local inventoryEvidence, evidenceOrder, evidenceContext, previousQuery, queryDifferences = {}, {}, nil, nil, 0
local function captureInventory(c, inventory, inventoryToken, phase)
    local context = tostring(c.expectedServerEpoch) .. ":" .. tostring(c.expectedSelectedPhotoUuid) .. ":" .. tostring(c.expectedContextCounter)
    if evidenceContext ~= context then
        inventoryEvidence, evidenceOrder, previousQuery, queryDifferences = {}, {}, nil, 0
        evidenceContext = context
    end
    local evidence = { source = c.requestId or c.operationId, phase = phase or "query", token = inventoryToken, values = {}, truncated = false }
    local budget, seen = 0, {}
    local function visit(value, path, depth)
        budget = budget + 1
        if budget > 512 or depth > 12 or #path > 512 then evidence.truncated = true; return end
        evidence.values[path] = { key = type(value) == "table" and "table" or token(value), value = describe(value) }
        if type(value) ~= "table" or seen[value] then return end
        seen[value] = true
        local keys = {}; for key in pairs(value) do keys[#keys + 1] = key end
        table.sort(keys, function(a, b) return canonical(a, {}, { n = 0 }, 0) < canonical(b, {}, { n = 0 }, 0) end)
        for _, key in ipairs(keys) do
            if budget >= 512 then evidence.truncated = true; break end
            visit(value[key], path .. "[" .. type(key) .. ":" .. tostring(key) .. "]", depth + 1)
        end
        seen[value] = nil
    end
    visit(inventory, "spots", 0)
    if not inventoryEvidence[inventoryToken] then
        evidenceOrder[#evidenceOrder + 1] = inventoryToken
        if #evidenceOrder > 24 then inventoryEvidence[table.remove(evidenceOrder, 1)] = nil end
    end
    inventoryEvidence[inventoryToken] = evidence
    return evidence
end
local function traceInventoryDifference(c, before, after, phase)
    trace(c, "inventory_comparison", phase .. " source=" .. tostring(before and before.source) ..
        " expected=" .. tostring(before and before.token) .. " got=" .. tostring(after and after.token))
    if not before or not after then trace(c, "inventory_difference", "Capture not retained; no field comparison available."); return end
    local paths, union = {}, {}
    for path in pairs(before.values) do union[path] = true end
    for path in pairs(after.values) do union[path] = true end
    for path in pairs(union) do paths[#paths + 1] = path end
    table.sort(paths)
    local changed = 0
    for _, path in ipairs(paths) do
        local a, b = before.values[path], after.values[path]
        if not a or not b or a.key ~= b.key then
            changed = changed + 1
            if changed <= 12 then trace(c, "inventory_difference", safeText(path, 130) .. " before=" ..
                (a and a.value or "absent") .. " after=" .. (b and b.value or "absent")) end
        end
    end
    trace(c, "inventory_difference", "changedFields=" .. changed .. " truncated=" .. tostring(before.truncated or after.truncated or changed > 12))
end
local function supported()
    return type(SDK.goToRemove) == "function", type(SDK.detectDistractingPeople) == "function",
        type(SDK.applyRemovalOnDetectedDistractingPeople) == "function"
end
local function read(c, phase)
    local capture, failed = reader(c, phase)
    local ok, snapshot = LrTasks.pcall(function()
        local navigationSupported, detectSupported, removeSupported = supported()
        if not photoMatches(c) then error("photo/module identity mismatch", 0) end
        for _, name in ipairs({ "getSelectedTool", "countAllSpots", "getAllSpots" }) do requireType(name, SDK[name], "function") end
        local count = capture("countAllSpots(People)", function() return SDK.countAllSpots(feature) end)
        local inventory = capture("getAllSpots(People)", function() return SDK.getAllSpots(feature) end)
        requireType("countAllSpots(People)", count, "number")
        if count ~= math.floor(count) or count < 0 then error("countAllSpots(People) expected nonnegative integer; got " .. describe(count), 0) end
        requireType("getAllSpots(People)", inventory, "table")
        local selectedTool = capture("getSelectedTool", function() return SDK.getSelectedTool() end)
        local toolOpen = selectedTool == "dust"
        local selectionReadable, selectedIndex, selectedToken = false, nil, nil
        if toolOpen and type(SDK.getSelectedSpotIndex) == "function" and type(SDK.getSelectedSpotParams) == "function" then
            local indexOk, index = LrTasks.pcall(function() return SDK.getSelectedSpotIndex(feature) end)
            local paramsOk, params = LrTasks.pcall(function() return SDK.getSelectedSpotParams(feature) end)
            if phase then trace(c, "selection_readback", phase .. " indexOk=" .. tostring(indexOk) .. " index=" .. describe(index) ..
                " paramsOk=" .. tostring(paramsOk) .. " params=" .. describe(params)) end
            if indexOk and paramsOk and ((index == nil and params == nil) or
                (type(index) == "number" and index == math.floor(index) and index >= 0 and type(params) == "table")) then
                selectionReadable = true; selectedIndex = index
                if index ~= nil then selectedToken = capture("getSelectedSpotParams(People).token", function()
                    return token({ index = index, params = params }) end) end
            end
        end
        if not photoMatches(c) then error("photo/module identity changed during People read", 0) end
        local inventoryToken = capture("getAllSpots(People).token", function() return token(inventory, "spots") end)
        local evidenceOk, evidence = LrTasks.pcall(function() return captureInventory(c, inventory, inventoryToken, phase) end)
        return { available = true, toolOpen = toolOpen, count = count, inventoryToken = inventoryToken,
            _inventoryEvidence = evidenceOk and evidence or nil,
            selectionReadable = selectionReadable, selectedIndex = selectedIndex, selectedToken = selectedToken,
            navigationSupported = navigationSupported, detectSupported = detectSupported, removeSupported = removeSupported }
    end)
    if ok then return snapshot end
    return { available = false, reason = failed(snapshot) }
end
local function snapshotUrl(snapshot)
    local url = "&available=" .. tostring(snapshot.available) .. "&reason=" .. encode(snapshot.reason)
    for _, key in ipairs(fields) do url = url .. "&" .. key .. "=" .. encode(snapshot[key]) end; return url
end
local function validate(c, phase)
    local body = LrHttp.get(base .. "validate?operationId=" .. encode(c.operationId) .. bindingUrl(c))
    local valid = type(body) == "string" and string.find(body, [["valid":true]], 1, true) ~= nil
    if phase or not valid then trace(c, "binding_validation", (phase or "callback wait") ..
        " response=" .. describe(body) .. " valid=" .. tostring(valid)) end
    return valid
end
local function readPreserved(c, phase)
    local capture, failed = reader(c, phase)
    local ok, value = LrTasks.pcall(function()
        if not photoMatches(c) then error("photo/module identity mismatch", 0) end
        local manual = capture("getAllSpots(manualRemove)", function() return SDK.getAllSpots("manualRemove") end)
        local removePreferences = capture("getRemovePanelPreferences", function() return SDK.getRemovePanelPreferences() end)
        local reflections = capture("getReflectionRemovalPanelState", function() return SDK.getReflectionRemovalPanelState() end)
        if phase and type(reflections) == "table" then
            local values = {}
            for _, key in ipairs({ "checkboxState", "amount", "quality", "enabled", "isSupported" }) do
                values[#values + 1] = key .. "=" .. describe(reflections[key])
            end
            trace(c, "reflection_readback", phase .. " " .. table.concat(values, " "))
        end
        requireType("getAllSpots(manualRemove)", manual, "table")
        requireType("getRemovePanelPreferences", removePreferences, "table")
        requireType("getReflectionRemovalPanelState", reflections, "table")
        for _, field in ipairs({ { "checkboxState", "boolean" }, { "amount", "number" }, { "quality", "string" }, { "isSupported", "boolean" } }) do
            requireType("getReflectionRemovalPanelState." .. field[1], reflections[field[1]], field[2])
        end
        return { manual = capture("getAllSpots(manualRemove).token", function() return token(manual) end),
            removePreferences = capture("getRemovePanelPreferences.token", function() return token(removePreferences) end),
            reflections = capture("getReflectionRemovalPanelState.token", function() return token({ checkboxState = reflections.checkboxState,
                amount = reflections.amount, quality = reflections.quality, isSupported = reflections.isSupported }) end) }
    end)
    if ok then return value end
    return nil, failed(value)
end

function People.sendRequestedSnapshot(json)
    local c = Parser.parse(json)
    if not c or c.command ~= "people.query" or not c.requestId then return false end
    local snapshot = read(c)
    local response = LrHttp.get(base .. "query-result?requestId=" .. encode(c.requestId) .. bindingUrl(c) .. snapshotUrl(snapshot))
    if snapshot._inventoryEvidence then
        if previousQuery and previousQuery.token ~= snapshot.inventoryToken and queryDifferences < 8 then
            queryDifferences = queryDifferences + 1
            trace(c, "query_capture", "request=" .. c.requestId .. " accepted=" .. tostring(type(response) == "string" and
                string.find(response, [["ok":true]], 1, true) ~= nil))
            traceInventoryDifference(c, previousQuery, snapshot._inventoryEvidence, "consecutive queries")
        end
        previousQuery = snapshot._inventoryEvidence
    end
    return true
end

function People.execute(c)
    local alive, completed, invoked, deferred = true, false, false, false
    local function result(outcome, detail, snapshot, inventoryChanged, manualPreserved, removePreferencesPreserved, reflectionsPreserved)
        detail = safeText(detail)
        trace(c, "result_ready", "outcome=" .. tostring(outcome) .. " " .. detail)
        local response = LrHttp.get(base .. "operation-result?operationId=" .. encode(c.operationId) .. bindingUrl(c) ..
            "&operationKind=" .. encode(c.operationKind) .. "&outcome=" .. encode(outcome) .. "&detail=" .. encode(detail) ..
            "&callbackCompleted=" .. tostring(completed) .. "&invoked=" .. tostring(invoked) ..
            "&inventoryChanged=" .. tostring(inventoryChanged == true) .. "&manualRepairsPreserved=" .. tostring(manualPreserved == true) ..
            "&removePreferencesPreserved=" .. tostring(removePreferencesPreserved == true) ..
            "&reflectionsPreserved=" .. tostring(reflectionsPreserved == true) .. snapshotUrl(snapshot or read(c)))
        trace(c, "result_post", "outcome=" .. tostring(outcome) .. " callback=" .. tostring(completed) ..
            " invoked=" .. tostring(invoked) .. " accepted=" .. tostring(type(response) == "string" and
                string.find(response, [["ok":true]], 1, true) ~= nil))
    end
    local function comparePreserved(before, after)
        return before ~= nil and after ~= nil and before.manual == after.manual,
            before ~= nil and after ~= nil and before.removePreferences == after.removePreferences,
            before ~= nil and after ~= nil and before.reflections == after.reflections
    end
    local function preconditionFailure(before, preserved, preservationError, phase)
        local reason
        if not before.available then reason = "People read unavailable: " .. tostring(before.reason)
        elseif before.toolOpen ~= c.expectedToolOpen then
            reason = "toolOpen expected " .. describe(c.expectedToolOpen) .. "; got " .. describe(before.toolOpen)
        elseif c.operationKind == "remove" and before.count ~= c.expectedPeopleCount then
            reason = "People count expected " .. describe(c.expectedPeopleCount) .. "; got " .. describe(before.count)
        elseif c.operationKind == "remove" and before.inventoryToken ~= c.expectedPeopleInventoryToken then
            traceInventoryDifference(c, inventoryEvidence[c.expectedPeopleInventoryToken], before._inventoryEvidence, phase)
            reason = "People inventory token mismatch; expected=" .. tostring(c.expectedPeopleInventoryToken) .. "; got=" .. tostring(before.inventoryToken)
        elseif not preserved then reason = "Preservation read unavailable: " .. tostring(preservationError) end
        if reason then
            reason = safeText(phase .. ": " .. reason)
            trace(c, "precondition_rejected", reason)
        end
        return reason
    end
    local function preservationDetail(manual, preferences, reflections, readError)
        return readError or ("manualRepairsPreserved=" .. tostring(manual) ..
            "; removePreferencesPreserved=" .. tostring(preferences) .. "; reflectionsPreserved=" .. tostring(reflections))
    end
    trace(c, "execute_enter")
    local ok, failure = LrTasks.pcall(function()
        if not ({ open = true, detect = true, remove = true })[c.operationKind] then
            result("stale", "Unsupported People operation kind."); return end
        if not validate(c, "initial") then result("stale", "Initial server operation binding validation rejected."); return end
        if not photoMatches(c) then result("stale", "Initial photo/module identity mismatch."); return end
        local number = tonumber(string.match(c.operationId or "", "^pp%-(%d+)$"))
        if not number then result("failed", "Invalid People operation."); return end
        if seenEpoch ~= c.expectedServerEpoch then seenEpoch, highestOperation = c.expectedServerEpoch, 0 end
        if number <= highestOperation then trace(c, "duplicate_discarded"); return end
        highestOperation = number
        local before = read(c, "before")
        local preservedBefore, preservationError = readPreserved(c, "before")
        local rejected = preconditionFailure(before, preservedBefore, preservationError, "before")
        if rejected then result("stale", rejected, before); return end
        if c.operationKind ~= "open" and not before.toolOpen then
            result("stale", "Open the Remove tool before using People.", before); return
        end
        if not validate(c, "final") then result("stale", "Final server operation binding validation rejected.", before); return end
        before = read(c, "final")
        preservedBefore, preservationError = readPreserved(c, "final")
        rejected = preconditionFailure(before, preservedBefore, preservationError, "final")
        if rejected then result("stale", rejected, before); return end
        if not photoMatches(c) then result("stale", "Final photo/module identity mismatch.", before); return end
        if c.operationKind == "open" then
            if not before.navigationSupported then result("failed", "People navigation is unavailable in this SDK.", before); return end
            trace(c, "sdk_invocation_start", "goToRemove(nil,distractingPeopleRemoval)")
            invoked = true; SDK.goToRemove(nil, feature)
            trace(c, "sdk_invocation_returned")
            local after = read(c, "after")
            local preservedAfter, readError = readPreserved(c, "after")
            local manualPreserved, removePreferencesPreserved, reflectionsPreserved = comparePreserved(preservedBefore, preservedAfter)
            trace(c, "preservation_readback", preservationDetail(manualPreserved, removePreferencesPreserved, reflectionsPreserved, readError))
            local changed = after.available and (after.count ~= before.count or after.inventoryToken ~= before.inventoryToken)
            result("requested", "People panel navigation sent. Review Lightroom; navigation-triggered detection is not documented.",
                after, changed, manualPreserved, removePreferencesPreserved, reflectionsPreserved); return
        end
        if c.operationKind == "detect" then
            if not before.detectSupported then result("failed", "People detection is unavailable in this SDK.", before); return end
            trace(c, "sdk_invocation_start", "detectDistractingPeople()")
            invoked = true; SDK.detectDistractingPeople()
            trace(c, "sdk_invocation_returned")
            local after = read(c, "after")
            local preservedAfter, readError = readPreserved(c, "after")
            local manualPreserved, removePreferencesPreserved, reflectionsPreserved = comparePreserved(preservedBefore, preservedAfter)
            trace(c, "preservation_readback", preservationDetail(manualPreserved, removePreferencesPreserved, reflectionsPreserved, readError))
            local changed = after.available and (after.count ~= before.count or after.inventoryToken ~= before.inventoryToken)
            result("requested", "Detection request delivered. Review detections and exclusions in Lightroom; readiness is not exposed.",
                after, changed, manualPreserved, removePreferencesPreserved, reflectionsPreserved); return
        end
        if not before.removeSupported then result("failed", "People removal is unavailable in this SDK.", before); return end
        local callbackArgs = { operationId = c.operationId, selectedPhotoUuid = c.expectedSelectedPhotoUuid,
            serverEpoch = c.expectedServerEpoch }
        local callback = function(args)
            if alive and type(args) == "table" and args.operationId == c.operationId and
                args.selectedPhotoUuid == c.expectedSelectedPhotoUuid and args.serverEpoch == c.expectedServerEpoch then
                completed = true; trace(c, "callback_received")
            else trace(c, "callback_ignored") end
        end
        trace(c, "sdk_invocation_start", "applyRemovalOnDetectedDistractingPeople(callback,args)")
        invoked = true; SDK.applyRemovalOnDetectedDistractingPeople(callback, callbackArgs)
        trace(c, "sdk_invocation_returned")
        result("requested", "People removal request delivered; waiting for Lightroom callback.", before, false, true, true, true)
        LrTasks.startAsyncTask(function()
            local waitOk = LrTasks.pcall(function()
                for attempt = 1, 900 do
                    if not validate(c) or not photoMatches(c) then result("stale", "Photo or context changed during People removal."); return end
                    if completed then
                        local after = read(c, "callback")
                        local preservedAfter, readError = readPreserved(c, "callback")
                        local manualPreserved, removePreferencesPreserved, reflectionsPreserved = comparePreserved(preservedBefore, preservedAfter)
                        local detail = preservationDetail(manualPreserved, removePreferencesPreserved, reflectionsPreserved, readError)
                        trace(c, "preservation_readback", detail)
                        local changed = after.available and (after.count ~= before.count or after.inventoryToken ~= before.inventoryToken)
                        if not after.available or not manualPreserved or not removePreferencesPreserved or not reflectionsPreserved then
                            result("failed", "Removal callback readback unconfirmed: " .. (not after.available and tostring(after.reason) or detail),
                                after, changed, manualPreserved, removePreferencesPreserved, reflectionsPreserved); return
                        end
                        result("confirmed", changed and
                            "Lightroom callback received; immediate People inventory changed. Review the result in Lightroom." or
                            "Lightroom callback received; People inventory was unchanged. Removal is unconfirmed; review Lightroom.",
                            after, changed, manualPreserved, removePreferencesPreserved, reflectionsPreserved); return
                    end
                    if attempt < 900 then LrTasks.sleep(0.1) end
                end
                result("failed", "People removal timed out; callback not received. No retry was sent.", read(c), false, true, true, true)
            end)
            alive = false
            if not waitOk then LrTasks.pcall(function()
                result("failed", "SDK readback failed; People removal result unconfirmed. No retry was sent.")
            end) end
        end)
        deferred = true
    end)
    if not deferred or not ok then alive = false end
    if not ok then
        trace(c, "sdk_exception", failure)
        LrTasks.pcall(function() result("failed", "Lightroom SDK call failed; People result unconfirmed. No retry was sent.") end)
    end
end

return People
