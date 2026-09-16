-- Read-only evidence for the single-use clipboard proof. Never constructs a write payload.
local Diagnostics = require "DustDiagnostics"
local SDK = import "LrDevelopController"
local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local LrTasks = import "LrTasks"
local LrMD5 = import "LrMD5"
local Proof = {}

local function digest(value)
    return (string.gsub(LrMD5.digest(value), ".", function(c) return string.format("%02x", string.byte(c)) end))
end

-- Unlike the readable summaries, these include every value, or fail closed.
-- Long strings are hashed in full; no coordinates or opaque blobs are reconstructed.
function Proof.fingerprint(value)
    local seen, nodes = {}, 0
    local function visit(item, depth)
        nodes = nodes + 1
        if nodes > 200000 or depth > 64 then error("Full preservation fingerprint exceeds bounds.", 0) end
        local kind = type(item)
        if kind == "string" then return "s" .. #item .. ":" .. digest(item) end
        if kind == "boolean" then return item and "b1" or "b0" end
        if kind == "nil" then return "nil" end
        if kind == "number" and item == item and math.abs(item) < math.huge then return "n" .. string.format("%.17g", item) end
        if kind ~= "table" or seen[item] then error("Unsupported or cyclic preservation data.", 0) end
        seen[item] = true
        local entries = {}
        for key, child in pairs(item) do
            if type(key) ~= "string" and type(key) ~= "number" then error("Unsupported preservation key.", 0) end
            entries[#entries + 1] = visit(key, depth + 1) .. "=" .. visit(child, depth + 1)
        end
        table.sort(entries); seen[item] = nil
        return "t" .. #entries .. ":" .. digest(table.concat(entries, ";"))
    end
    return digest(visit(value, 0))
end

local function splitFilters(value)
    local other, dust, envelope = {}, {}, {}
    if value == nil then return other, dust, envelope end
    if type(value) ~= "table" then error("FilterList is not readable.", 0) end
    for key, item in pairs(value) do if key ~= "Filters" then envelope[key] = item end end
    local filters = value.Filters or {}
    if type(filters) ~= "table" then error("FilterList.Filters is not a table.", 0) end
    local count = 0
    for key in pairs(filters) do
        count = count + 1
        if type(key) ~= "number" or key < 1 or key % 1 ~= 0 then error("Unknown filter collection structure.", 0) end
    end
    for index = 1, count do
        local filter = filters[index]
        if type(filter) ~= "table" then error("Incomplete filter collection.", 0) end
        -- Observed readback identity on 15.4.1, never an invocation parameter.
        local possibleDust = filter.FilterID == 6 or filter.Name == "Dust Removal" or
            filter.Title == "$$$/CRaw/Filter/DustRemoval/FilterPanelTitle=Dust Removal"
        if possibleDust then
            if filter.FilterID ~= 6 or filter.Name ~= "Dust Removal" or
                filter.Title ~= "$$$/CRaw/Filter/DustRemoval/FilterPanelTitle=Dust Removal" then
                error("Unrecognized Dust filter identity; cannot classify safely.", 0)
            end
            dust[#dust + 1] = filter
        else other[#other + 1] = filter end
    end
    return other, dust, envelope
end

function Proof.requireContext(photo, uuid, catalog, commandStamp)
    if LrApplication.activeCatalog() ~= catalog or catalog:getTargetPhoto() ~= photo or photo:getRawMetadata("uuid") ~= uuid then
        error("Destination photo or catalog changed; no further operation is allowed.", 0)
    end
    if LrApplicationView.getCurrentModuleName() ~= "develop" then error("Destination must remain in Develop.", 0) end
    if _G.LRBridgeCommandBusy or _G.LRBridgeLastCommandFinishedAt ~= commandStamp then
        error("An LRBridge command ran during the proof; capture cannot isolate the Dust paste.", 0)
    end
end

function Proof.capture(photo, uuid, catalog, commandStamp)
    local ok, result = LrTasks.pcall(function()
        Proof.requireContext(photo, uuid, catalog, commandStamp)
        local snapshot = Diagnostics.capture(photo, uuid)
        if not snapshot.available then error(snapshot.reason, 0) end
        local raw = photo:getDevelopSettings()
        if type(raw) ~= "table" then error("Full Develop settings unavailable.", 0) end
        local tokens, count = {}, 0
        for key, item in pairs(raw) do
            if not snapshot.settings[key] or Diagnostics.summarize(item).hash ~= snapshot.settings[key].hash then
                error("Develop settings changed during capture.", 0)
            end
            tokens[key] = Proof.fingerprint(item); count = count + 1
        end
        local capturedCount = 0
        for _ in pairs(snapshot.settings) do capturedCount = capturedCount + 1 end
        if count ~= capturedCount then error("Develop setting fields changed during capture.", 0) end
        local manual = SDK.getAllSpots("manualRemove")
        local preferences = SDK.getRemovePanelPreferences()
        if type(manual) ~= "table" or type(preferences) ~= "table" then error("Manual repairs or Remove preferences unavailable.", 0) end
        if not snapshot.preferences or Diagnostics.summarize(preferences).hash ~= snapshot.preferences.hash then
            error("Remove preferences changed during capture.", 0)
        end
        if type(photo.needsUpdateAISettings) ~= "function" then error("AI-update status API unavailable.", 0) end
        local needsUpdate = photo:needsUpdateAISettings()
        if type(needsUpdate) ~= "boolean" then error("AI-update status unreadable.", 0) end
        local other, dust, envelope = splitFilters(raw.FilterList)
        local evidence = { schema = 1, settings = tokens, manualSpots = Diagnostics.summarize(manual),
            manualToken = Proof.fingerprint(manual), preferencesToken = Proof.fingerprint(preferences),
            nonDustFiltersToken = Proof.fingerprint(other), filterEnvelopeToken = Proof.fingerprint(envelope),
            dustCount = #dust, dustFilters = {}, needsAIUpdate = needsUpdate,
            photoPasteMethod = type(photo.pasteSettings) }
        for index, filter in ipairs(dust) do evidence.dustFilters[index] = Diagnostics.summarize(filter) end
        evidence.beforeToken = Proof.fingerprint({ settings = tokens, manual = evidence.manualToken,
            preferences = evidence.preferencesToken, needsAIUpdate = needsUpdate, selectedTool = snapshot.selectedTool })
        snapshot.pasteEvidence = evidence
        Proof.requireContext(photo, uuid, catalog, commandStamp)
        return snapshot
    end)
    if ok then return result end
    return { available = false, reason = Diagnostics.sanitize(result) }
end

function Proof.requireEligible(snapshot)
    if not snapshot.available then error(snapshot.reason or "Destination baseline unavailable.", 0) end
    local evidence = snapshot.pasteEvidence
    if evidence.photoPasteMethod ~= "function" then error("photo:pasteSettings is unavailable.", 0) end
    if evidence.dustCount ~= 0 then error("Destination already has automatic Dust data. Select an untreated disposable destination.", 0) end
    if evidence.needsAIUpdate then error("Destination has pending AI updates. Use a destination whose existing AI edits are already current.", 0) end
end

function Proof.compare(before, after)
    if not after or not after.available then return { available = false, reason = after and after.reason or "No final sample." } end
    local a, b = before.pasteEvidence, after.pasteEvidence
    local changed, keys = {}, {}
    for key in pairs(a.settings) do keys[key] = true end
    for key in pairs(b.settings) do keys[key] = true end
    for key in pairs(keys) do if key ~= "FilterList" and a.settings[key] ~= b.settings[key] then changed[#changed + 1] = key end end
    table.sort(changed)
    return { available = true, unrelatedSettingsChanged = changed, manualSpotsUnchanged = a.manualToken == b.manualToken,
        removePreferencesUnchanged = a.preferencesToken == b.preferencesToken,
        nonDustFiltersUnchanged = a.nonDustFiltersToken == b.nonDustFiltersToken,
        filterEnvelopeUnchanged = a.filterEnvelopeToken == b.filterEnvelopeToken,
        dustFilterCount = b.dustCount, needsAIUpdate = b.needsAIUpdate,
        visualRemovalConfirmed = false, freshDetectionConfirmed = false }
end

return Proof
