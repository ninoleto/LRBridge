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
local seen = {}

local function md5(value)
    local hash = MD5.digest(value)
    if #hash == 32 and not string.find(hash, "[^%x]") then return string.lower(hash) end
    return (string.gsub(hash, ".", function(c) return string.format("%02x", string.byte(c)) end))
end
local function split(settings)
    if type(settings) ~= "table" or type(settings.FilterList) ~= "table" then error("Dust settings unavailable.", 0) end
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
    if type(contents) ~= "string" or #contents > 8192 or md5(contents) ~= offDigest then
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
        if not applied and settings.ProcessVersion == "15.4" and type(photo.applyDevelopPreset) == "function" then
            onOk = Tasks.pcall(function() return (require "DustOnPreset").resolve() end)
        end
        if not contextMatches() then error("Dust photo context changed.", 0) end
        return { available = true, applied = applied, canDisable = presetOk, canEnable = onOk,
            canRequestClose = type(SDK.goToRemove) == "function", panelStateAvailable = false,
            token = fingerprint(settings.FilterList), reason = applied and (presetOk and "" or "Inspected Dust Off preset unavailable or changed.") or
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
    if type(manual) ~= "table" or type(preferences) ~= "table" or type(needsAI) ~= "boolean" or needsAI and not allowPendingAI then
        error("Dust preservation baseline unavailable or AI processing pending.", 0)
    end
    local result = { applied = applied, mode = preferences.newSpotType, token = fingerprint(settings.FilterList),
        processVersion = settings.ProcessVersion, needsAIUpdate = needsAI,
        all = fingerprint(settings), preserved = fingerprint({ unrelated, other, envelope, manual, preferences }) }
    if not guard() then error("Dust context changed during read.", 0) end
    return result
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
        local before = evidence(photo, nativeBound)
        if before.applied == enabling or before.token ~= command.expectedValue or before.mode ~= command.expectedRemoveMode then
            error("Dust state changed before dispatch.", 0)
        end
        if enabling and before.processVersion ~= "15.4" then error("Dust On must not change the photo's Process Version.", 0) end
        local dispatched, callOk, callResult = false, false, nil
        catalog:withWriteAccessDo("LRBridge " .. label, function()
            local preset = enabling and (require "DustOnPreset").resolve() or offPreset()
            if not guard() then error("Dust context changed inside write gate.", 0) end
            local current = evidence(photo, nativeBound)
            if current.all ~= before.all or current.preserved ~= before.preserved then error("Photo edits changed before " .. label .. ".", 0) end
            seen[key], attempted, dispatched = true, true, true
            -- Apply the real native preset once. Only On requests AI updating, as in the accepted proof.
            -- Catch inside the gate so an SDK exception does not request an implicit rollback.
            callOk, callResult = Tasks.pcall(function() return photo:applyDevelopPreset(preset, nil, nil, enabling) end)
        end, { timeout = 2, asynchronous = false })
        if not dispatched then error(label .. " write gate did not execute.", 0) end
        if not callOk then error(callResult, 0) end
        if callResult == false then error(label .. " SDK call returned false; state unconfirmed, no retry.", 0) end
        local stable, lastToken = 0, nil
        local attempts = enabling and 121 or 8
        for attempt = 1, attempts do
            if not guard() then error("Dust context changed after dispatch.", 0) end
            local after = evidence(photo, nativeBound, enabling)
            if after.preserved ~= before.preserved then error("Other edits changed; " .. label .. " is unconfirmed.", 0) end
            if after.applied == enabling and not after.needsAIUpdate then
                stable = lastToken == after.all and stable + 1 or 1
                lastToken = after.all
                if not enabling or stable >= 3 then return { confirmed = true, attempted = attempted } end
            else stable, lastToken = 0, nil end
            if attempt < attempts then Tasks.sleep(enabling and 0.25 or 0.1) end
        end
        error(label .. " state was not confirmed after the SDK call; no retry.", 0)
    end)
    if ok then return result end
    return { confirmed = false, attempted = attempted, detail = (require "DustDiagnostics").sanitize(result) }
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
        local before = evidence(photo, nativeBound)
        if not before.applied or before.token ~= command.expectedValue or before.mode ~= command.expectedRemoveMode then
            error("Dust state changed before navigation.", 0)
        end
        if not guard() then error("Dust context changed before navigation.", 0) end
        local current = evidence(photo, nativeBound)
        if current.all ~= before.all or current.preserved ~= before.preserved then error("Photo edits changed before navigation.", 0) end
        seen[key], attempted = true, true
        -- Native Close retains Healing. Keep its current mode; never select loupe or clear Dust.
        if SDK.goToRemove(nil, "manualRemove") == false then error("Native navigation returned false; Close unconfirmed.", 0) end
        for sample = 1, 3 do
            if sample > 1 then Tasks.sleep(0.1) end
            if not guard() then error("Dust context changed after navigation.", 0) end
            local after = evidence(photo, nativeBound)
            if after.all ~= before.all or after.preserved ~= before.preserved then
                error("Treatment or other edits changed during navigation; Close unconfirmed.", 0)
            end
        end
        -- SDK exposes no active Dust subsection getter. Preservation is evidence, not a collapse confirmation.
        return { requested = true, preservationConfirmed = true, attempted = true }
    end)
    if ok then return result end
    return { requested = false, attempted = attempted, detail = (require "DustDiagnostics").sanitize(result) }
end
return Dust
