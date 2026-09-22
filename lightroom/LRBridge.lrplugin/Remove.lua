local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrDevelopController = import "LrDevelopController"
local LrTasks = import "LrTasks"
local LrHttp = import "LrHttp"
local Parser = require "Parser"
local Repair = require "RemoveRepair"
local Dust = require "Dust"
local Remove = {}
local baseUrl = "http://127.0.0.1:17891/remove/"
local modes = { heal_patchmatch = true, heal = true, clone = true }
local fields = { "newSpotType", "brushSize", "brushFeather", "useGenerativeAI", "detectObjects",
    "toolOverlay", "visualizeSpots", "visualizationThreshold" }
local bindings = { "expectedServerEpoch", "expectedRemoveRevision", "expectedActiveModule", "expectedSelectedPhotoUuid",
    "expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt" }
local function encode(value)
    return (string.gsub(tostring(value == nil and "null" or value), "([^%w%-_%.~])", function(c) return string.format("%%%02X", string.byte(c)) end))
end
local function inRange(value, minimum)
    return type(value) == "number" and value == value and value >= minimum and value <= 100
end
local function selectedPhoto() return LrApplication.activeCatalog():getTargetPhoto() end
local function uuid(photo) return photo and photo:getRawMetadata("uuid") or nil end
local function photoMatches(command)
    return command.expectedActiveModule == "develop" and LrApplicationView.getCurrentModuleName() == "develop" and
        uuid(selectedPhoto()) == command.expectedSelectedPhotoUuid
end
local function contextMatches(command)
    return photoMatches(command) and LrDevelopController.getSelectedTool() == "dust"
end
local function validPreferences(p)
    return type(p) == "table" and modes[p.newSpotType] == true and inRange(p.brushSize, 1) and inRange(p.brushFeather, 0) and
        type(p.useGenerativeAI) == "boolean" and type(p.detectObjects) == "boolean" and type(p.visualizeSpots) == "boolean" and
        inRange(p.visualizationThreshold, 0) and ({ always = true, auto = true, selected = true, never = true })[p.toolOverlay] == true
end
local function copyPreferences(value, depth)
    if type(value) ~= "table" then return value end
    if depth > 8 then error("Unsupported nested Remove preference") end
    local copy = {}
    for key, item in pairs(value) do copy[key] = copyPreferences(item, depth + 1) end
    return copy
end
local function read(command)
    local diagnostics = Repair.diagnostics()
    diagnostics.activeModule = Repair.observe(diagnostics, "getCurrentModuleName", function() return LrApplicationView.getCurrentModuleName() end)
    diagnostics.selectedPhotoUuid = Repair.observe(diagnostics, "getTargetPhoto.uuid", function() return uuid(selectedPhoto()) end)
    local selectedTool
    local ok, preferences = LrTasks.pcall(function()
        if not photoMatches(command) then return nil end
        selectedTool = Repair.observe(diagnostics, "getSelectedTool", function() return LrDevelopController.getSelectedTool() end)
        if type(LrDevelopController.getRemovePanelPreferences) ~= "function" or
            type(LrDevelopController.setRemovePanelPreferences) ~= "function" then return nil end
        local p = Repair.observe(diagnostics, "getRemovePanelPreferences", function() return LrDevelopController.getRemovePanelPreferences() end)
        diagnostics.selectedTool = selectedTool
        diagnostics.newSpotType = type(p) == "table" and p.newSpotType or nil
        if not contextMatches(command) or not validPreferences(p) then return nil end
        -- Freeze the baseline even if Lightroom reuses its returned table on later reads.
        return copyPreferences(p, 0)
    end)
    if not photoMatches(command) then selectedTool = nil end
    local repair = Repair.public(Repair.read(function() return contextMatches(command) end, diagnostics))
    local dust = Dust.read(selectedPhoto(), function() return photoMatches(command) end)
    if not ok or not preferences then return { available = false, selectedTool = selectedTool, repair = repair,
        dust = dust, reason = "Open Remove in Develop to read brush preferences." } end
    local snapshot = { available = true, selectedTool = selectedTool, preferences = preferences, repair = repair, dust = dust }
    for _, field in ipairs(fields) do snapshot[field] = preferences[field] end
    return snapshot
end
local function bindingUrl(command)
    local url = ""
    for _, field in ipairs(bindings) do url = url .. "&" .. field .. "=" .. encode(command[field]) end
    return url
end
local function snapshotUrl(snapshot)
    local url = "&available=" .. tostring(snapshot.available) .. "&reason=" .. encode(snapshot.reason) .. "&selectedTool=" .. encode(snapshot.selectedTool) ..
        "&repair=" .. encode(Repair.json(snapshot.repair or { available = false })) ..
        "&dust=" .. encode(Repair.json(snapshot.dust or { available = false }))
    for _, field in ipairs(fields) do url = url .. "&" .. field .. "=" .. encode(snapshot[field]) end
    return url
end
local function validate(command)
    local body = LrHttp.get(baseUrl .. "validate?operationId=" .. encode(command.operationId) .. bindingUrl(command))
    return type(body) == "string" and string.find(body, [["valid":true]], 1, true) ~= nil
end
function Remove.setDust(command)
    local closing = command.command == "remove.dust.close"
    local result = (closing and Dust.requestClose or Dust.setApplied)(command, function()
        return validate(command) and contextMatches(command)
    end)
    local snapshot = read(command)
    local preserved = result.confirmed == true or result.preservationConfirmed == true
    snapshot.dust.preservationConfirmed = preserved
    snapshot.dust.completionConfirmed = result.completionConfirmed == true
    local detail = result.detail or (closing and
        "Native manual Healing navigation requested; edits preserved. Check that Dust collapses in Lightroom; its panel state is not exposed." or
        ((command.value and "Dust On" or "Dust Off / Reset") .. " confirmed by Lightroom readback; other edits preserved."))
    local response = LrHttp.get(baseUrl .. "operation-result?operationId=" .. encode(command.operationId) .. bindingUrl(command) ..
        "&repairEditConfirmed=false&repairRemovalConfirmed=false&targetRepairToken=null&field=" .. encode(command.field) .. "&value=" .. encode(command.value) .. "&outcome=" ..
        (result.outcome or (result.confirmed and "confirmed" or result.requested and "requested" or "failed")) .. "&detail=" .. encode(detail) ..
        "&otherPreferencesPreserved=" .. tostring(preserved) .. snapshotUrl(snapshot))
    Dust.trace(command, "result_post", "accepted=" .. tostring(type(response) == "string" and string.find(response, [["ok":true]], 1, true) ~= nil))
end
function Remove.sendRequestedSnapshot(json)
    local command = Parser.parse(json)
    if not command or not command.requestId then return false end
    local snapshot = read(command)
    LrHttp.get(baseUrl .. "query-result?requestId=" .. encode(command.requestId) .. bindingUrl(command) .. snapshotUrl(snapshot))
    return true
end
local function equal(a, b, depth)
    if type(a) ~= type(b) then return false end
    if type(a) ~= "table" then return a == b end
    if depth > 8 then return false end
    for k, v in pairs(a) do if not equal(v, b[k], depth + 1) then return false end end
    for k in pairs(b) do if a[k] == nil then return false end end
    return true
end
local function othersPreserved(before, after, field)
    for k, v in pairs(before) do if k ~= field and not equal(v, after[k], 0) then return false end end
    for k in pairs(after) do if k ~= field and before[k] == nil then return false end end
    return true
end
local function fieldSupported(field, mode, preferences)
    if not modes[mode] then return false end
    if field == "brushFeather" then return mode ~= "heal_patchmatch" end
    if field == "useGenerativeAI" or field == "detectObjects" then return mode == "heal_patchmatch" end
    if field == "visualizationThreshold" then return not preferences or preferences.visualizeSpots == true end
    return field == "brushSize" or field == "newSpotType" or field == "toolOverlay" or field == "visualizeSpots"
end
local function validValue(field, value)
    if field == "brushSize" or field == "brushFeather" or field == "visualizationThreshold" then return inRange(value, field == "brushSize" and 1 or 0) end
    if field == "useGenerativeAI" or field == "detectObjects" or field == "visualizeSpots" then return type(value) == "boolean" end
    if field == "newSpotType" then return modes[value] == true end
    if field == "toolOverlay" then return ({ always = true, auto = true, selected = true, never = true })[value] == true end
    return false
end
local function valueMatches(a, b)
    if type(a) == "number" and type(b) == "number" then return math.abs(a - b) <= 0.000001 end
    return a == b
end
function Remove.setBrushPreference(command)
    local function result(outcome, detail, snapshot, preserved)
        LrHttp.get(baseUrl .. "operation-result?operationId=" .. encode(command.operationId) .. bindingUrl(command) ..
            "&repairEditConfirmed=false&repairRemovalConfirmed=false&targetRepairToken=null&field=" .. encode(command.field) .. "&value=" .. encode(command.value) .. "&outcome=" .. outcome ..
            "&detail=" .. encode(detail or "") .. "&otherPreferencesPreserved=" .. tostring(preserved == true) .. snapshotUrl(snapshot or read(command)))
    end
    local ok = LrTasks.pcall(function()
        if not fieldSupported(command.field, command.expectedRemoveMode) or not validValue(command.field, command.value) then
            result("failed", "Unsupported brush preference."); return
        end
        if not validate(command) then result("stale", "Remove brush context changed."); return end
        local before = read(command)
        if not before.available or before.newSpotType ~= command.expectedRemoveMode or before[command.field] ~= command.expectedValue or
            not fieldSupported(command.field, before.newSpotType, before.preferences) then
            result("stale", "Remove brush mode or value changed before the write.", before); return
        end
        -- HTTP calls can yield. Recheck native context, mode and baseline after the last yielding admission check.
        if not validate(command) then result("stale", "Remove brush context changed."); return end
        before = read(command)
        if not before.available or before.newSpotType ~= command.expectedRemoveMode or before[command.field] ~= command.expectedValue or
            not fieldSupported(command.field, before.newSpotType, before.preferences) or not contextMatches(command) then
            result("stale", "Remove brush mode or value changed before the write.", before); return end
        -- SDK 14.1+ accepts a partial table. Sending one field preserves other and future preferences without replaying stale values.
        -- newSpotType governs NEW spots; never call selected-spot setters, select a tool, or reveal a panel.
        local success = LrDevelopController.setRemovePanelPreferences({ [command.field] = command.value })
        if success ~= true then result("failed", "Lightroom rejected the brush preference.", read(command)); return end
        local after
        for attempt = 1, 8 do
            if not validate(command) then result("stale", "Remove brush context changed after the write."); return end
            after = read(command)
            local expectedMode = command.field == "newSpotType" and command.value or command.expectedRemoveMode
            if not after.available or after.newSpotType ~= expectedMode then
                result("stale", "Remove tool or mode changed after the write.", after); return
            end
            if not othersPreserved(before.preferences, after.preferences, command.field) then
                result("failed", "Brush preference sent; other preferences changed before confirmation.", after); return
            end
            if valueMatches(after[command.field], command.value) then
                result("confirmed", "Brush preference confirmed by Lightroom.", after, true); return
            end
            if attempt < 8 then LrTasks.sleep(0.05) end
        end
        result("failed", "Lightroom did not confirm the brush preference.", after)
    end)
    if not ok then LrTasks.pcall(function() result("failed", "Lightroom could not update the brush preference.") end) end
end
local function selectionRefinement(command)
    local resultAttempted = false
    local label = command.value == "add" and "Add" or "Subtract"
    local function get(path)
        local body, headers = LrHttp.get(baseUrl .. path .. "&operationId=" .. encode(command.operationId) .. bindingUrl(command), nil, 3)
        if type(body) ~= "string" or type(headers) ~= "table" or headers.status ~= 200 then error("Selected refinement HTTP response unavailable") end
        return body
    end
    local function result(outcome, detail, preserved, snapshot)
        resultAttempted = true
        get("operation-result?field=selectedSelection&value=" .. encode(command.value) .. "&outcome=" .. outcome ..
            "&detail=" .. encode(detail) .. "&otherPreferencesPreserved=" .. tostring(preserved == true) ..
            "&repairEditConfirmed=false&repairRemovalConfirmed=false&targetRepairToken=null&selectionCompletionConfirmed=false" .. snapshotUrl(snapshot or read(command)))
    end
    local function guardSnapshot()
        if not contextMatches(command) then return nil end
        local preferences = LrDevelopController.getRemovePanelPreferences()
        local settings = selectedPhoto():getDevelopSettings()
        if type(preferences) ~= "table" or preferences.newSpotType ~= command.expectedRemoveMode or type(settings) ~= "table" or not contextMatches(command) then return nil end
        return { preferences=copyPreferences(preferences, 0), settings=copyPreferences(settings, 0) }
    end
    local function preserved(before, after)
        return before and after and equal(before.preferences, after.preferences, 0) and equal(before.settings, after.settings, 0)
    end
    local ok = LrTasks.pcall(function()
        if command.field ~= "selectedSelection" or command.expectedRemoveMode ~= "heal_patchmatch" or not validate(command) then
            result("stale", "Selected refinement context changed before dispatch."); return
        end
        local before = guardSnapshot()
        if not before then result("stale", "Original photo, Remove tool or settings are unavailable."); return end
        -- Queue once and receive the acknowledgement BEFORE the native guard.
        -- This command has one sequential HTTP caller, without a guard coroutine.
        local queued = get("selection-refinement-native?action=invoke")
        if not string.find(queued, '"queued"%s*:%s*true') then error("Refinement queuing acknowledgement missing") end
        local guardAttempted = false
        for attempt = 1, 120 do
            local status = get("selection-refinement-native?action=status")
            if string.find(status, '"complete"%s*:%s*true') then
                local after = read(command)
                local stable = preserved(before, guardSnapshot()) and after.available and validate(command) and contextMatches(command)
                if string.find(status, '"sent"%s*:%s*true') and stable then
                    result("requested", label .. " request sent. Active refinement mode is not exposed.", true, after)
                else
                    result("unknown", label .. " result is unknown. Check Lightroom; no automatic retry.", false, after)
                end
                return
            end
            if string.find(status, '"requested"%s*:%s*true') and not guardAttempted then
                guardAttempted = true
                -- The new snapshot follows the shared native queue wait. The
                -- server also revalidates UUID/context/Develop/epoch ownership.
                local valid = preserved(before, guardSnapshot())
                local ack = get("selection-guard?phase=confirm&valid=" .. tostring(valid == true))
                if not string.find(ack, '"accepted"%s*:%s*true') then error("Fresh SDK guard was not accepted") end
            end
            LrTasks.sleep(0.05)
        end
        error("Refinement completion not received")
    end)
    if not ok and not resultAttempted then
        -- Settle uncertainty once; never retry native invoke or a guard reply.
        LrTasks.pcall(function() result("unknown", label .. " request could not be confirmed. Check Lightroom; no automatic retry.") end)
    end
end
function Remove.selectionAction(command)
    if command.value == "add" or command.value == "subtract" then return selectionRefinement(command) end
    local guardActive = false
    local function native(action)
        local body = LrHttp.get(baseUrl .. "selection-native?action=" .. action .. "&operationId=" .. encode(command.operationId) .. bindingUrl(command))
        if type(body) ~= "string" or not string.find(body, '"ok"%s*:%s*true') then return {} end
        return { available = string.find(body, '"available"%s*:%s*true') ~= nil,
            active = string.find(body, '"active"%s*:%s*true') ~= nil,
            inactive = string.find(body, '"active"%s*:%s*false') ~= nil,
            sent = string.find(body, '"sent"%s*:%s*true') ~= nil,
            token = string.match(body, '"token"%s*:%s*"([%d:]+)"') }
    end
    local function result(outcome, detail, confirmed, snapshot)
        LrHttp.get(baseUrl .. "operation-result?operationId=" .. encode(command.operationId) .. bindingUrl(command) ..
            "&repairEditConfirmed=false&repairRemovalConfirmed=false&targetRepairToken=null&field=selectedSelection&value=" .. encode(command.value) ..
            "&outcome=" .. outcome .. "&detail=" .. encode(detail) .. "&otherPreferencesPreserved=" .. tostring(confirmed == true) ..
            "&selectionCompletionConfirmed=" .. tostring(confirmed == true) .. snapshotUrl(snapshot or read(command)))
    end
    local ok = LrTasks.pcall(function()
        if command.field ~= "selectedSelection" or (command.value ~= "cancel" and command.value ~= "remove") or
            command.expectedRemoveMode ~= "heal_patchmatch" or not validate(command) or not contextMatches(command) then
            result("stale", "Remove selection context changed before dispatch."); return
        end
        local before = read(command)
        local inventory = Repair.remaining(function() return contextMatches(command) end).records
        local selected = native("read")
        if not before.available or before.newSpotType ~= "heal_patchmatch" or not inventory or not selected.available or
            not selected.active or selected.token ~= command.expectedValue or not validate(command) or not contextMatches(command) then
            result("stale", "The original manual Remove selection is no longer available."); return
        end
        -- The native helper revalidates operation ownership and control identity
        -- after its queue wait. There is exactly one invoke, even after uncertainty.
        guardActive = true
        LrTasks.startAsyncTask(function()
            -- Answer the helper's just-in-time challenge while HTTP invoke yields.
            -- The normal photo heartbeat pauses during command work.
            LrTasks.pcall(function()
                for attempt = 1, 200 do
                    if not guardActive then return end
                    local guardUrl = baseUrl .. "selection-guard?operationId=" .. encode(command.operationId) .. bindingUrl(command)
                    local body = LrHttp.get(guardUrl .. "&phase=poll&valid=null")
                    if type(body) == "string" and string.find(body, '"requested"%s*:%s*true') then
                        local readable, current = LrTasks.pcall(function() return LrDevelopController.getRemovePanelPreferences() end)
                        local valid = guardActive and readable and type(current) == "table" and current.newSpotType == command.expectedRemoveMode and contextMatches(command)
                        LrHttp.get(guardUrl .. "&phase=confirm&valid=" .. tostring(valid == true))
                        return
                    end
                    LrTasks.sleep(0.05)
                end
            end)
        end)
        local sent = native("invoke")
        guardActive = false
        if not sent.sent then result("unknown", "Native selection dispatch was not confirmed. Check Lightroom; no automatic retry."); return end
        local stable, previous = 0, nil
        for attempt = 1, 24 do
            if not validate(command) or not contextMatches(command) then
                result("stale", "Photo or Remove context changed after the selection action."); return
            end
            local current = native("read")
            local after = read(command)
            local records = Repair.remaining(function() return contextMatches(command) end).records
            if not contextMatches(command) or not after.available or after.newSpotType ~= before.newSpotType then
                result("stale", "Photo, tool or Remove mode changed before selection confirmation."); return
            end
            local unchanged = records and equal(inventory, records, 0)
            local preserved = othersPreserved(before.preferences, after.preferences, "__none__")
            local readyOk, ready = LrTasks.pcall(function() return LrDevelopController.isAvailableForEditing() end)
            local completed = current.available and current.inactive and current.token == command.expectedValue and records and preserved and
                (command.value == "cancel" and unchanged or command.value == "remove" and not unchanged and readyOk and ready == true)
            if completed and previous and equal(previous, records, 0) then stable = stable + 1 else stable = completed and 1 or 0 end
            previous = records
            if stable >= 3 then
                result("confirmed", command.value == "cancel" and "Selection cancelled; existing repairs preserved." or
                    "Remove completed; Lightroom confirmed the updated repair inventory.", true, after); return
            end
            if attempt < 24 then LrTasks.sleep(0.1) end
        end
        result("unknown", "Selection action sent; Lightroom completion could not be confirmed. Check Lightroom; no automatic retry.")
    end)
    guardActive = false
    if not ok then LrTasks.pcall(function() result("unknown", "Selection action could not be confirmed. Check Lightroom; no automatic retry.") end) end
end
function Remove.setPanel(command)
    local function result(outcome, detail, snapshot, preserved)
        LrHttp.get(baseUrl .. "operation-result?operationId=" .. encode(command.operationId) .. bindingUrl(command) ..
            "&repairEditConfirmed=false&repairRemovalConfirmed=false&targetRepairToken=null&field=" .. encode(command.field) .. "&value=" .. encode(command.value) .. "&outcome=" .. outcome ..
            "&detail=" .. encode(detail) .. "&otherPreferencesPreserved=" .. tostring(preserved == true) .. snapshotUrl(snapshot or read(command)))
    end
    local ok = LrTasks.pcall(function()
        local target = command.expectedValue == "dust" and "loupe" or "dust"
        if command.field ~= "selectedTool" or command.value ~= target or type(command.expectedValue) ~= "string" then
            result("failed", "Unsupported Remove tool request."); return
        end
        -- Like Masking lifecycle: validate original photo/tool, use the SDK, then read actual tool state.
        if not validate(command) or not photoMatches(command) or LrDevelopController.getSelectedTool() ~= command.expectedValue then
            result("stale", "Photo or selected tool changed before Open/Close Remove."); return
        end
        if not validate(command) or not photoMatches(command) or LrDevelopController.getSelectedTool() ~= command.expectedValue then
            result("stale", "Photo or selected tool changed before Open/Close Remove."); return
        end
        local baselineOk, baseline = LrTasks.pcall(function()
            local p = LrDevelopController.getRemovePanelPreferences()
            return validPreferences(p) and copyPreferences(p, 0) or nil
        end)
        if not photoMatches(command) or LrDevelopController.getSelectedTool() ~= command.expectedValue then
            result("stale", "Photo or selected tool changed before opening."); return
        end
        if target == "dust" then LrDevelopController.goToRemove("heal_patchmatch", "manualRemove")
        else LrDevelopController.selectTool("loupe") end
        for attempt = 1, 8 do
            if not validate(command) or not photoMatches(command) then
                result("stale", "Photo or context changed during Open/Close Remove."); return
            end
            local after = read(command)
            if after.selectedTool == target and (target == "loupe" or after.available and after.newSpotType == "heal_patchmatch") then
                local preserved = baselineOk and baseline and after.preferences and othersPreserved(baseline, after.preferences, "newSpotType")
                local changed = baselineOk and baseline and after.preferences and not preserved
                result(changed and "failed" or "confirmed", target == "loupe" and "Healing Tool closed in Lightroom." or
                    not changed and "Healing Tool open; Remove mode and preference values read back. Native control-enabled state is not exposed." or
                    "Healing Tool opened, but another preference changed during confirmation.", after, preserved); return
            end
            if after.selectedTool ~= command.expectedValue and after.selectedTool ~= target then
                result("stale", "A newer Lightroom tool selection was preserved.", after); return
            end
            if attempt < 8 then LrTasks.sleep(0.05) end
        end
        local after = read(command)
        result("failed", after.selectedTool == "dust" and "Healing Tool is open, but Remove mode and brush preferences were not confirmed." or
            "Lightroom did not confirm Open/Close Healing Tool.", after)
    end)
    if not ok then LrTasks.pcall(function() result("failed", "Lightroom could not change the selected tool.") end) end
end
function Remove.repairAction(command)
    local function result(outcome, detail, preserved)
        LrHttp.get(baseUrl .. "operation-result?operationId=" .. encode(command.operationId) .. bindingUrl(command) ..
            "&targetRepairToken=" .. encode(command.expectedValue) .. "&field=" .. encode(command.field) .. "&value=" .. encode(command.value) .. "&outcome=" .. outcome ..
            "&detail=" .. encode(detail) .. "&repairEditConfirmed=false&otherPreferencesPreserved=false&repairRemovalConfirmed=" .. tostring(preserved == true) .. snapshotUrl(read(command)))
    end
    local ok = LrTasks.pcall(function()
        if command.field ~= "selectedRepair" or (command.value ~= "refresh" and command.value ~= "delete") then
            result("failed", "Unsupported selected repair action."); return
        end
        if not validate(command) then result("stale", "Selected repair context changed."); return end
        local before = Repair.read(function() return contextMatches(command) end)
        if Repair.token(before) ~= command.expectedValue then result("stale", "Selected repair changed before the action."); return end
        if not validate(command) then result("stale", "Selected repair context changed."); return end
        before = Repair.read(function() return contextMatches(command) end)
        if not contextMatches(command) or Repair.token(before) ~= command.expectedValue then
            result("stale", "Selected repair changed before the action."); return
        end
        if command.value == "refresh" then
            LrDevelopController.refreshSelectedSpot("manualRemove")
            if not validate(command) or not contextMatches(command) then result("stale", "Context changed after Refresh."); return end
            result("requested", "Refresh requested for the original repair; the SDK does not expose completion status."); return
        end
        LrDevelopController.deleteSelectedSpot("manualRemove")
        for attempt = 1, 8 do
            if not validate(command) or not contextMatches(command) then result("stale", "Context changed after Delete."); return end
            local after = Repair.remaining(function() return contextMatches(command) end)
            if Repair.removalConfirmed(before, after) then
                result("confirmed", "Selected repair deleted; remaining repairs preserved. Selection follows Lightroom.", true); return
            end
            if attempt < 8 then LrTasks.sleep(0.05) end
        end
        result("failed", "Delete requested; fresh inventory did not confirm removal and preservation of remaining repairs.")
    end)
    if not ok then LrTasks.pcall(function() result("failed", "Lightroom could not complete the selected repair action.") end) end
end
function Remove.setRepairFill(command)
    local choices = { remove = { "heal_patchmatch", false }, heal = { "heal", false }, clone = { "clone", false }, generative_remove = { "heal_patchmatch", true } }
    local target = choices[command.value]
    local function result(outcome, detail, proof, snapshot)
        LrHttp.get(baseUrl .. "operation-result?operationId=" .. encode(command.operationId) .. bindingUrl(command) ..
            "&targetRepairToken=" .. encode(command.expectedValue) .. "&field=" .. encode(command.field) .. "&value=" .. encode(command.value) ..
            "&outcome=" .. outcome .. "&detail=" .. encode(detail) .. "&repairRemovalConfirmed=false&repairEditConfirmed=" .. tostring(proof == true) ..
            "&otherPreferencesPreserved=" .. tostring(proof == true) .. snapshotUrl(snapshot or read(command)))
    end
    local ok = LrTasks.pcall(function()
        if command.field ~= "selectedRepairFill" or not target then result("failed", "Unsupported selected Fill choice."); return end
        if not validate(command) then result("stale", "Selected repair context changed."); return end
        local before = Repair.read(function() return contextMatches(command) end)
        if Repair.token(before) ~= command.expectedValue then result("stale", "Selected repair changed before Fill."); return end
        if not validate(command) then result("stale", "Selected repair context changed."); return end
        local preferences = read(command)
        before = Repair.read(function() return contextMatches(command) end)
        if not preferences.available or preferences.newSpotType ~= command.expectedRemoveMode or
            not contextMatches(command) or Repair.token(before) ~= command.expectedValue then
            result("stale", "Photo, tool, mode or selected repair changed before Fill."); return
        end
        -- SDK14.1: exactly spotType, useGenAI; changes the existing repair, not newSpotType.
        LrDevelopController.setSelectedSpotType(target[1], target[2])
        for attempt = 1, 8 do
            if not validate(command) or not contextMatches(command) then result("stale", "Context changed after Fill."); return end
            local after = Repair.read(function() return contextMatches(command) end)
            local selected, brush = Repair.public(after), read(command)
            if not brush.available or not othersPreserved(preferences.preferences, brush.preferences, "") then
                result("failed", "Fill requested; brush preference preservation was not confirmed."); return
            end
            if selected.available and selected.selected and selected.spotType == target[1] and
                (target[1] ~= "heal_patchmatch" or selected.useGenAI == target[2]) and Repair.editConfirmed(before, after) and
                brush.repair.token == Repair.token(after) then
                result("confirmed", "Selected repair Fill confirmed by Lightroom; other repairs and brush preferences preserved.", true, brush); return
            end
            if selected.selected and selected.index ~= before.index then result("stale", "A newer repair selection was preserved."); return end
            if attempt < 8 then LrTasks.sleep(0.05) end
        end
        result("failed", "Fill requested; Lightroom did not confirm the type and preservation of other repairs.")
    end)
    if not ok then LrTasks.pcall(function() result("failed", "Lightroom could not change selected repair Fill.") end) end
end
function Remove.setRepairParameter(command)
    local names = { selectedRepairOpacity = "Opacity", selectedRepairFeather = "Feather" }
    local parameter = names[command.field]
    local function result(outcome, detail, proof, snapshot)
        LrHttp.get(baseUrl .. "operation-result?operationId=" .. encode(command.operationId) .. bindingUrl(command) ..
            "&targetRepairToken=" .. encode(command.expectedValue) .. "&field=" .. encode(command.field) .. "&value=" .. encode(command.value) ..
            "&outcome=" .. outcome .. "&detail=" .. encode(detail) .. "&repairRemovalConfirmed=false&repairEditConfirmed=" .. tostring(proof == true) ..
            "&otherPreferencesPreserved=" .. tostring(proof == true) .. snapshotUrl(snapshot or read(command)))
    end
    local ok = LrTasks.pcall(function()
        if not parameter or Repair.unit(command.value) == nil then result("failed", "Unsupported selected repair parameter."); return end
        if not validate(command) then result("stale", "Selected repair context changed."); return end
        local before = Repair.read(function() return contextMatches(command) end)
        if Repair.token(before) ~= command.expectedValue then result("stale", "Selected repair changed before the edit."); return end
        if not validate(command) then result("stale", "Selected repair context changed."); return end
        local preferences = read(command)
        before = Repair.read(function() return contextMatches(command) end)
        if not preferences.available or preferences.newSpotType ~= command.expectedRemoveMode or not contextMatches(command) or
            Repair.token(before) ~= command.expectedValue or not before.params or Repair.unit(before.params[parameter]) == nil then
            result("stale", "Photo, mode or selected repair parameter changed before the edit."); return
        end
        -- Preserve the complete fresh native table; partial-update semantics are not documented.
        local params = Repair.copyParams(before); params[parameter] = command.value
        LrDevelopController.setSelectedSpotParams(params)
        for attempt = 1, 8 do
            if not validate(command) or not contextMatches(command) then result("stale", "Context changed after the selected repair edit."); return end
            local after = Repair.read(function() return contextMatches(command) end)
            local selected, brush = Repair.public(after), read(command)
            if not brush.available or not othersPreserved(preferences.preferences, brush.preferences, "") then
                result("failed", "Selected repair edit sent; brush preference preservation was not confirmed."); return
            end
            if selected.selected and selected.index ~= before.index then result("stale", "A newer repair selection was preserved."); return end
            if selected.available and after.params and valueMatches(after.params[parameter],command.value) and
                Repair.parameterEditConfirmed(before,after,parameter) and brush.repair.token == Repair.token(after) then
                result("confirmed", "Selected " .. parameter .. " confirmed by Lightroom; other parameters and repairs preserved.", true, brush); return
            end
            if attempt < 8 then LrTasks.sleep(0.05) end
        end
        result("failed", "Selected repair edit sent; native value and preservation were not confirmed.")
    end)
    if not ok then LrTasks.pcall(function() result("failed", "Lightroom could not update the selected repair parameter.") end) end
end
return Remove
