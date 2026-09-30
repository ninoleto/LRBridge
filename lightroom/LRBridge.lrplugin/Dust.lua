-- 15.4.1 Dust readback and inspected native presets. Never builds FilterList writes.
local App = import "LrApplication"
local View = import "LrApplicationView"
local Tasks = import "LrTasks"
local SDK = import "LrDevelopController"
local MD5 = import "LrMD5"
local fingerprint = (require "DustPasteDiagnostics").fingerprint
local Dust = {}
local title = "$$$/CRaw/Filter/DustRemoval/FilterPanelTitle=Dust Removal"
local offDigest = "6222ed7b14ec731f0d114e24d9bea1d4"
local renamedOffDigest = "050d98209fce4ca04a671708d5730cf5"
local seen = {}
local diagnosticsEnabled = false
-- Lightroom may omit getenv. Optional diagnostics must never block an edit.
if type(os.getenv) == "function" then
    local ok, value = pcall(os.getenv, "LRBRIDGE_DEVELOPER_DIAGNOSTICS")
    diagnosticsEnabled = ok and value == "1"
end

-- Bounded, sanitized lifecycle evidence; never log photo paths or settings payloads.
function Dust.trace(command, stage, detail)
    if not diagnosticsEnabled then return end
    if type(_PLUGIN) ~= "table" or type(_PLUGIN.path) ~= "string" then return end
    local root = string.gsub(_PLUGIN.path, "[/\\]lightroom[/\\]LRBridge%.lrplugin$", "")
    if root == _PLUGIN.path then return end
    pcall(function()
        local file = io.open(root .. "\\lrplugin-log.txt", "a")
        if file then
            pcall(function() file:write(os.date("%Y-%m-%d %H:%M:%S") .. " Dust: operation=" ..
                tostring(command.operationId) .. " epoch=" .. tostring(command.expectedServerEpoch) .. " stage=" .. stage .. " " ..
                (require "DustDiagnostics").sanitize(detail) .. "\n") end)
            file:close()
        end
    end)
end
local function editable(photo)
    if type(photo.isAvailableForEditing) ~= "function" then return nil end
    local ok, value = Tasks.pcall(function() return photo:isAvailableForEditing() end)
    if ok and type(value) == "boolean" then return value end
    return nil
end

local function md5(value)
    local hash = MD5.digest(value)
    if #hash == 32 and not string.find(hash, "[^%x]") then return string.lower(hash) end
    return (string.gsub(hash, ".", function(c) return string.format("%02x", string.byte(c)) end))
end
local function split(settings)
    if type(settings) ~= "table" then error("Dust settings unavailable.", 0) end
    -- An omitted FilterList supplies no On/Off state. Native preset commands can
    -- still preserve the readable settings and manual repairs; never infer Off.
    if settings.FilterList == nil then return nil, {}, {} end
    if type(settings.FilterList) ~= "table" then error("Dust settings unavailable.", 0) end
    local filters = settings.FilterList.Filters or {}
    if type(filters) ~= "table" then error("Dust filter list unavailable.", 0) end
    local count, dust, other, envelope = 0, 0, {}, {}
    for key in pairs(filters) do
        count = count + 1
        if type(key) ~= "number" or key % 1 ~= 0 or key < 1 or count > 1024 then error("Unknown filter structure.", 0) end
    end
    for index = 1, count do
        local f = filters[index]
        if type(f) ~= "table" then error("Incomplete filter list.", 0) end
        if f.FilterID == 6 or f.Name == "Dust Removal" or f.Title == title then
            if f.FilterID ~= 6 or f.Name ~= "Dust Removal" or f.Title ~= title or f.IsSignalForDelete ~= nil then
                error("Unrecognized Dust state.", 0)
            end
            dust = dust + 1
        else other[#other + 1] = f end
    end
    if dust > 1 then error("Ambiguous Dust state.", 0) end
    for k,v in pairs(settings.FilterList) do if k ~= "Filters" then envelope[k] = v end end
    return dust == 1, other, envelope
end
local function offPreset()
    local match, scanned = nil, 0
    local folders = App.developPresetFolders()
    if type(folders) ~= "table" or #folders > 300 then error("Dust Off preset list unavailable.", 0) end
    for _, folder in ipairs(folders) do
        for _, preset in ipairs(folder:getDevelopPresets()) do
            scanned = scanned + 1
            if scanned > 5000 then error("Preset inventory exceeds bounds.", 0) end
            if preset:getName() == "LRBridge Dust Off" then
                if match then error("Duplicate LRBridge Dust Off presets.", 0) end
                match = preset
            end
        end
    end
    if not match then error("LRBridge Dust Off preset is missing.", 0) end
    local contents = (import "LrFileUtils").readFile(match:getFile())
    if type(contents) ~= "string" or #contents > 8192 or
        (md5(contents) ~= offDigest and md5(contents) ~= renamedOffDigest) then
        error("Dust Off preset differs from the inspected definition.", 0)
    end
    local settings = match:getSetting()
    local allowed = { AllowFilters = true, CompatibleVersion = true, FilterList = true, Version = true }
    for key in pairs(settings) do if not allowed[key] then error("Dust Off preset includes other settings.", 0) end end
    local filters = settings.FilterList and settings.FilterList.Filters
    local f = type(filters) == "table" and filters[1]
    if settings.AllowFilters ~= 1 or type(f) ~= "table" or #filters ~= 1 or f.FilterID ~= 6 or
        f.IsSignalForDelete ~= true or f.Images ~= nil then error("Dust Off preset is not a Dust deletion.", 0) end
    return match
end
local function requireVersion()
    local v = App.versionTable()
    if v.major ~= 15 or v.minor ~= 4 or v.revision ~= 1 then error("Dust state mapping is verified only on Lightroom 15.4.1.", 0) end
end
function Dust.read(photo, contextMatches)
    local ok, result = Tasks.pcall(function()
        requireVersion()
        if not contextMatches() then error("Dust photo context changed.", 0) end
        local settings = photo:getDevelopSettings()
        local applied = split(settings)
        local presetOk = Tasks.pcall(offPreset)
        local onOk = false
        if settings.ProcessVersion == "15.4" and type(photo.applyDevelopPreset) == "function" then
            onOk = Tasks.pcall(function() return (require "DustOnPreset").resolve() end)
        end
        if not contextMatches() then error("Dust photo context changed.", 0) end
        return { available = type(applied) == "boolean", applied = applied,
            canDisable = presetOk and type(photo.applyDevelopPreset) == "function", canEnable = onOk,
            canRequestClose = type(SDK.goToRemove) == "function", panelStateAvailable = false,
            token = fingerprint(settings.FilterList),
            reason = applied == nil and "Dust status unavailable. Check the Apply checkbox in Lightroom Classic." or "",
            commandReason = not presetOk and "Inspected Dust Off preset unavailable or changed." or
                (onOk and "" or "Dust On needs the inspected preset and Process Version 15.4.") }
    end)
    if ok then return result end
    return { available = false, reason = "Dust state unavailable: " .. (require "DustDiagnostics").sanitize(result) }
end
local function evidence(photo, guard, allowPendingAI)
    if not guard() then error("Dust context changed.", 0) end
    local settings = photo:getDevelopSettings()
    local applied, other, envelope = split(settings)
    local unrelated = {}
    for key,value in pairs(settings) do if key ~= "FilterList" then unrelated[key] = value end end
    local manual, preferences = SDK.getAllSpots("manualRemove"), SDK.getRemovePanelPreferences()
    local needsAI = photo:needsUpdateAISettings()
    if type(manual) ~= "table" or type(preferences) ~= "table" or type(needsAI) ~= "boolean" then
        error("Dust preservation baseline unavailable.", 0)
    end
    if needsAI and not allowPendingAI then
        error("Lightroom reports AI settings need updating; Dust On was not attempted.", 0)
    end
    local result = { applied = applied, mode = preferences.newSpotType, token = fingerprint(settings.FilterList),
        processVersion = settings.ProcessVersion, needsAIUpdate = needsAI,
        all = fingerprint(settings), preserved = fingerprint({ unrelated, other, envelope, manual, preferences }) }
    if not guard() then error("Dust context changed during read.", 0) end
    return result
end
local function readback(photo, guard)
    local readyBefore = editable(photo)
    local after = evidence(photo, guard, true)
    after.editableBefore, after.editable = readyBefore, editable(photo)
    if not guard() then error("Dust context changed during completion readback.", 0) end
    return after
end
local function settledReadback(after)
    -- needsUpdateAISettings reports stale AI settings, not a running operation.
    -- Explicit native readiness is required to distinguish that case from processing.
    return after.editableBefore ~= false and after.editable ~= false and
        (not after.needsAIUpdate or after.editableBefore == true and after.editable == true)
end
local function cleanupEvidence(photo, guard)
    local after = readback(photo, guard)
    if not settledReadback(after) then error("Lightroom has not confirmed the photo is ready for Dust Reset or Close.", 0) end
    return after
end
local function aiUpdateNote(after)
    return after.needsAIUpdate and " AI settings still need updating in Lightroom." or ""
end
function Dust.setApplied(command, guard)
    local attempted = false
    local ok, result = Tasks.pcall(function()
        requireVersion()
        local key = command.expectedServerEpoch .. ":" .. command.operationId
        if seen[key] then error("Dust operation already attempted; no retry.", 0) end
        if command.field ~= "dustApply" or type(command.value) ~= "boolean" or
            command.command ~= (command.value and "remove.dust.on" or "remove.dust.off") then error("Invalid Dust Apply operation.", 0) end
        local enabling = command.value
        local label = enabling and "Dust On" or "Dust Off"
        local catalog = App.activeCatalog()
        local photo = catalog:getTargetPhoto()
        local function nativeBound()
            return App.activeCatalog() == catalog and catalog:getTargetPhoto() == photo and photo ~= nil and
                photo:getRawMetadata("uuid") == command.expectedSelectedPhotoUuid and
                View.getCurrentModuleName() == "develop" and SDK.getSelectedTool() == "dust"
        end
        if not guard() then error("Dust context changed.", 0) end
        -- On may update AI, so retain its current-AI baseline requirement. Off only
        -- deletes Dust and can safely preserve stale AI when native editing is ready.
        local before = enabling and evidence(photo, nativeBound) or cleanupEvidence(photo, nativeBound)
        if before.token ~= command.expectedValue or before.mode ~= command.expectedRemoveMode then
            error("Dust state changed before dispatch.", 0)
        end
        if enabling and before.processVersion ~= "15.4" then error("Dust On must not change the photo's Process Version.", 0) end
        local dispatched, callOk, callResult = false, false, nil
        catalog:withWriteAccessDo("LRBridge " .. label, function()
            local preset = enabling and (require "DustOnPreset").resolve() or offPreset()
            if not guard() then error("Dust context changed inside write gate.", 0) end
            -- Readiness was checked before taking our own catalog write gate.
            local current = evidence(photo, nativeBound, not enabling)
            if current.all ~= before.all or current.preserved ~= before.preserved or current.needsAIUpdate ~= before.needsAIUpdate then
                error("Photo edits or AI update state changed before " .. label .. ".", 0)
            end
            seen[key], attempted, dispatched = true, true, true
            -- Apply the real native preset once. Only On requests AI updating, as in the accepted proof.
            -- Catch inside the gate so an SDK exception does not request an implicit rollback.
            Dust.trace(command, "sdk_invoke", label)
            callOk, callResult = Tasks.pcall(function() return photo:applyDevelopPreset(preset, nil, nil, enabling) end)
            Dust.trace(command, "sdk_return", "ok=" .. tostring(callOk) .. " result=" .. tostring(callResult))
        end, { timeout = 2, asynchronous = false })
        if not dispatched then error(label .. " write gate did not execute.", 0) end
        if not callOk then error(label .. " failed: " .. tostring(callResult), 0) end
        if callResult == false then error(label .. " was refused (SDK returned false); detection result unavailable. No retry.", 0) end
        local stable, lastToken, idle, lastIdleToken, lastObservation = 0, nil, 0, nil, nil
        local unknownReason = "Lightroom's completion feedback is unavailable"
        local attempts = enabling and 121 or 8
        for attempt = 1, attempts do
            if not guard() then error("Dust context changed after dispatch.", 0) end
            local after = readback(photo, nativeBound)
            local readyBefore, ready = after.editableBefore, after.editable
            local observation = "applied=" .. tostring(after.applied) .. " needsAIUpdate=" .. tostring(after.needsAIUpdate) ..
                " editableBefore=" .. tostring(readyBefore) .. " editable=" .. tostring(ready) .. " bridgeBusy=" .. tostring(_G.LRBridgeCommandBusy == true)
            unknownReason = ready == false and "Lightroom still reports background processing" or after.needsAIUpdate and
                "Lightroom still reports AI settings needing an update" or "Lightroom's completion feedback is unavailable"
            if observation ~= lastObservation then
                Dust.trace(command, "readback", "sample=" .. attempt .. " " .. observation)
                lastObservation = observation
            end
            if after.preserved ~= before.preserved then error("Other edits changed; " .. label .. " is unconfirmed.", 0) end
            if after.applied == enabling and settledReadback(after) then
                stable = lastToken == after.all and stable + 1 or 1
                lastToken = after.all
                if not enabling or stable >= 3 then
                    return { confirmed = true, attempted = attempted,
                        detail = (enabling and "Dust On" or "Dust Off / Reset") .. " confirmed by Lightroom readback; other edits preserved." .. aiUpdateNote(after) }
                end
            else stable, lastToken = 0, nil end
            -- A returned preset call alone does not prove AI completion. Require Lightroom's
            -- editing-ready signal on both sides of stable, AI-current, preserved Off readback.
            -- This confirms only that Dust was not applied, never that no dust was detected.
            if enabling and readyBefore == true and ready == true and after.applied == false and not after.needsAIUpdate then
                idle = lastIdleToken == after.all and idle + 1 or 1
                lastIdleToken = after.all
                if idle >= 4 then
                    return { outcome = "not_applied", attempted = attempted, preservationConfirmed = true, completionConfirmed = true,
                        detail = "Dust was not applied. Lightroom is ready for editing; no detection result was provided." }
                end
            else idle, lastIdleToken = 0, nil end
            if attempt < attempts then Tasks.sleep(enabling and 0.25 or 0.1) end
        end
        return { outcome = "unknown", attempted = attempted,
            detail = label .. " result is unknown: " .. unknownReason .. ". Check Lightroom; no automatic retry." }
    end)
    if not ok then result = { confirmed = false, attempted = attempted, detail = string.sub((require "DustDiagnostics").sanitize(result), 1, 300) } end
    Dust.trace(command, "settled", "outcome=" .. (result.outcome or (result.confirmed and "confirmed" or "failed")) .. " " .. (result.detail or ""))
    return result
end
function Dust.requestClose(command, guard)
    local attempted = false
    local ok, result = Tasks.pcall(function()
        requireVersion()
        local key = command.expectedServerEpoch .. ":" .. command.operationId
        if seen[key] then error("Dust operation already attempted; no retry.", 0) end
        if command.command ~= "remove.dust.close" or command.field ~= "dustClose" or command.value ~= "manualRemove" or
            type(SDK.goToRemove) ~= "function" then error("Native manual Healing navigation unavailable.", 0) end
        local catalog = App.activeCatalog()
        local photo = catalog:getTargetPhoto()
        local function nativeBound()
            return App.activeCatalog() == catalog and catalog:getTargetPhoto() == photo and photo ~= nil and
                photo:getRawMetadata("uuid") == command.expectedSelectedPhotoUuid and
                View.getCurrentModuleName() == "develop" and SDK.getSelectedTool() == "dust"
        end
        if not guard() then error("Dust context changed.", 0) end
        local before = cleanupEvidence(photo, nativeBound)
        if before.token ~= command.expectedValue or before.mode ~= command.expectedRemoveMode then
            error("Dust state changed before navigation.", 0)
        end
        if not guard() then error("Dust context changed before navigation.", 0) end
        local current = cleanupEvidence(photo, nativeBound)
        if current.all ~= before.all or current.preserved ~= before.preserved or current.needsAIUpdate ~= before.needsAIUpdate then error("Photo edits changed before navigation.", 0) end
        seen[key], attempted = true, true
        -- Native Close retains Healing. Keep its current mode; never select loupe or clear Dust.
        Dust.trace(command, "sdk_invoke", "Dust Close")
        local returned = SDK.goToRemove(nil, "manualRemove")
        Dust.trace(command, "sdk_return", "Dust Close result=" .. tostring(returned))
        if returned == false then error("Native navigation returned false; Close unconfirmed.", 0) end
        local after
        for sample = 1, 3 do
            if sample > 1 then Tasks.sleep(0.1) end
            if not guard() then error("Dust context changed after navigation.", 0) end
            after = cleanupEvidence(photo, nativeBound)
            if after.all ~= before.all or after.preserved ~= before.preserved then
                error("Treatment or other edits changed during navigation; Close unconfirmed.", 0)
            end
        end
        -- SDK exposes no active Dust subsection getter. Preservation is evidence, not a collapse confirmation.
        return { requested = true, preservationConfirmed = true, attempted = true,
            detail = "Native manual Healing navigation requested; edits preserved. Check that Dust collapses in Lightroom; its panel state is not exposed." .. aiUpdateNote(after) }
    end)
    if not ok then result = { requested = false, attempted = attempted, detail = string.sub((require "DustDiagnostics").sanitize(result), 1, 300) } end
    Dust.trace(command, "settled", "outcome=" .. (result.requested and "requested" or "failed") .. " " .. (result.detail or ""))
    return result
end
return Dust
