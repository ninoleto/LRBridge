-- Bounded investigation only. No navigation, selection, preferences or photo writes.
local LrApplication = import "LrApplication"
local LrApplicationView = import "LrApplicationView"
local SDK = import "LrDevelopController"
local LrTasks = import "LrTasks"
local Diagnostics = require "DustDiagnostics"
local Probe = {}

local function eyeName(name)
    name = string.lower(tostring(name))
    return string.find(name, "eye", 1, true) or string.find(name, "pupil", 1, true) or
        string.find(name, "darken", 1, true) or string.find(name, "catchlight", 1, true)
end

local function read(fn)
    local ok, value = LrTasks.pcall(fn)
    if not ok then return { ok = false, error = Diagnostics.sanitize(value) } end
    return { ok = true, value = Diagnostics.summarize(value) }
end

function Probe.capture(photo, uuid)
    local function requireContext()
        if LrApplication.activeCatalog():getTargetPhoto() ~= photo or photo:getRawMetadata("uuid") ~= uuid or
            photo:getRawMetadata("isVideo") == true or LrApplicationView.getCurrentModuleName() ~= "develop" or
            SDK.getSelectedTool() ~= "redeye" then error("Selected photo or Red Eye tool changed; capture rejected.", 0) end
    end
    local function settings()
        requireContext()
        local value = photo:getDevelopSettings()
        if type(value) ~= "table" or next(value) == nil then error("Develop settings unavailable.", 0) end
        return value
    end
    local ok, result = LrTasks.pcall(function()
        local before = settings()
        local fields, eyeFields, settingsComplete = {}, {}, true
        for key, value in pairs(before) do
            if type(key) ~= "string" then error("Unexpected Develop settings key.", 0) end
            fields[key] = Diagnostics.summarize(value)
            if fields[key].truncated then settingsComplete = false end
            if eyeName(key) then eyeFields[key] = fields[key] end
        end
        -- Keep a missing field distinct from an empty correction list.
        local redEyeInfo = Diagnostics.summarize(before.RedEyeInfo)
        local selected = {
            getSelectedSpotIndex = read(function() return SDK.getSelectedSpotIndex() end),
            getSelectedSpotParams = read(function() return SDK.getSelectedSpotParams() end),
            getSelectedSpotType = read(function() return SDK.getSelectedSpotType() end),
        }
        -- Enumerate only publicly imported names. Never invoke guessed methods or inspect private modules.
        local publicNames = read(function()
            local names = {}
            for name, value in pairs(SDK) do
                if type(name) == "string" and type(value) == "function" then names[#names + 1] = name end
            end
            table.sort(names); return names
        end)
        -- Read-only candidate keys, NOT an assertion that these are supported parameters.
        -- A numeric return (or a range) alone cannot establish selected-eye semantics.
        local names = { "PupilSize", "RedEyePupilSize", "Darken", "RedEyeDarken", "AddCatchlight", "PetEyeAddCatchlight" }
        local seen = {}; for _, name in ipairs(names) do seen[name] = true end
        local nodes = 0
        local function discover(value, depth)
            nodes = nodes + 1
            if nodes > 512 or depth > 12 or type(value) ~= "table" then return end
            for key, child in pairs(value) do
                if #names < 20 and type(key) == "string" and #key < 80 and eyeName(key) and not seen[key] then
                    names[#names + 1] = key; seen[key] = true
                end
                discover(child, depth + 1)
            end
        end
        discover(before.RedEyeInfo, 0)
        local parameters = {}
        for _, name in ipairs(names) do
            requireContext()
            parameters[name] = {
                classification = "unverified candidate; selected correction versus new-correction default unknown",
                getValue = read(function() return SDK.getValue(name) end),
                getRange = read(function()
                    local minimum, maximum = SDK.getRange(name)
                    return { minimum = Diagnostics.summarize(minimum), maximum = Diagnostics.summarize(maximum) }
                end),
            }
        end
        local after = settings()
        local changed = {}
        for key, value in pairs(after) do
            local summary = Diagnostics.summarize(value)
            if summary.truncated then settingsComplete = false end
            if not fields[key] or summary.hash ~= fields[key].hash then changed[#changed + 1] = key end
        end
        for key in pairs(before) do if after[key] == nil then changed[#changed + 1] = key end end
        table.sort(changed)
        requireContext()
        return { readOnly = true, available = true, selectedPhotoUuid = uuid, activeModule = "develop", selectedTool = "redeye",
            hostVersion = Diagnostics.summarize(LrApplication.versionTable()),
            mode = "not readable; user must identify Red Eye or Pet Eye", selectedEyeIdentity = "not established",
            redEyeInfo = redEyeInfo, eyeSettings = eyeFields, settings = fields,
            settingsComplete = settingsComplete, changedSettingsDuringCapture = changed,
            selectionGetters = selected, publicFunctionNames = publicNames, parameterCandidates = parameters,
            limitations = "Array order is not selection. Values may be saved edits or defaults. No write route or range is established by this snapshot." }
    end)
    if ok then return result end
    return { readOnly = true, available = false, reason = Diagnostics.sanitize(result) }
end
return Probe
