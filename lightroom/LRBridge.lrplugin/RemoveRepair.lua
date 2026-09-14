local SDK = import "LrDevelopController"
local Tasks = import "LrTasks"
local Repair = {}
local feature = "manualRemove"
local function quote(value)
    return '"' .. string.gsub(value, '[%z\1-\31\\"]', function(c)
        return string.format("\\u%04x", string.byte(c))
    end) .. '"'
end
function Repair.json(value)
    if value == nil then return "null" end
    if type(value) == "string" then return quote(value) end
    if type(value) == "boolean" or type(value) == "number" then return tostring(value) end
    local entries = {}
    for k, v in pairs(value) do table.insert(entries, quote(tostring(k)) .. ":" .. Repair.json(v)) end
    table.sort(entries)
    return "{" .. table.concat(entries, ",") .. "}"
end
-- Opaque, type-preserving equality evidence; no interpretation of undocumented spot fields.
local function canonical(value, seen, budget, depth)
    local kind = type(value)
    budget.n = budget.n + 1
    if budget.n > 20000 or depth > 12 then error("Repair inventory exceeds capture bounds") end
    if kind == "nil" or kind == "boolean" then return kind .. ":" .. tostring(value) end
    if kind == "number" and value == value and math.abs(value) < math.huge then return "number:" .. string.format("%.17g", value) end
    if kind == "string" and #value < 65536 then return "string:" .. quote(value) end
    if kind ~= "table" or seen[value] then error("Unsupported repair inventory value") end
    seen[value] = true
    local entries = {}
    for key, item in pairs(value) do
        if type(key) ~= "number" and type(key) ~= "string" then error("Unsupported repair key") end
        table.insert(entries, canonical(key, seen, budget, depth + 1) .. "=" .. canonical(item, seen, budget, depth + 1))
    end
    seen[value] = nil; table.sort(entries)
    local result = "table{" .. table.concat(entries, ";") .. "}"
    if #result > 262144 then error("Repair inventory exceeds capture bounds") end
    return result
end
local function stable(value) return canonical(value, {}, { n = 0 }, 0) end
local function clone(value)
    if type(value) ~= "table" then return value end
    local copy = {}; for key, item in pairs(value) do copy[key] = clone(item) end; return copy
end
function Repair.unit(value)
    return type(value) == "number" and value == value and value >= 0 and value <= 1 and value or nil
end
local function digest(value)
    local raw = (import "LrMD5").digest(value)
    return (string.gsub(raw, ".", function(c) return string.format("%02x", string.byte(c)) end))
end
function Repair.diagnostics() return { reader = "healing-focus-1", getters = {}, foreground = "not_observed" } end
function Repair.observe(diagnostics, name, getter)
    local ok, value, extra = Tasks.pcall(getter)
    diagnostics.getters[name] = { ok = ok, kind = ok and type(value) or "error" }
    if not ok then diagnostics.getters[name].error = string.sub(tostring(value), 1, 200); return nil, false end
    return value, true, extra
end
-- Bounded numeric/boolean paths are evidence only; no field is interpreted as an editable preference.
local function parameterNumbers(value, out, path, depth, budget)
    if type(value) ~= "table" or depth > 3 then return end
    local keys = {}; for key in pairs(value) do if type(key) == "string" or type(key) == "number" then table.insert(keys, key) end end
    table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
    for _, key in ipairs(keys) do
        local item, name = value[key], path .. "/" .. tostring(key)
        if #name < 120 and (type(item) == "number" and item == item and math.abs(item) < math.huge or type(item) == "boolean") then
            if budget.n >= 48 or budget.bytes + #name + 24 > 1800 then budget.truncated = true
            else out[name] = item; budget.n = budget.n + 1; budget.bytes = budget.bytes + #name + 24 end
        end
    end
    for _, key in ipairs(keys) do if type(value[key]) == "table" then parameterNumbers(value[key], out, path .. "/" .. tostring(key), depth + 1, budget) end end
end
function Repair.read(contextMatches, diagnostics)
    diagnostics = diagnostics or Repair.diagnostics()
    local evidence = { diagnostics = diagnostics }
    local ok, result = Tasks.pcall(function()
        -- Run every read independently, including nil selection and inactive-window failures.
        -- Module identity is never treated as foreground-application evidence.
        local index, indexOk = Repair.observe(diagnostics, "getSelectedSpotIndex", function() return SDK.getSelectedSpotIndex(feature) end)
        local params, paramsOk = Repair.observe(diagnostics, "getSelectedSpotParams", function() return SDK.getSelectedSpotParams(feature) end)
        local spotType, typeOk, genAI = Repair.observe(diagnostics, "getSelectedSpotType", function() return SDK.getSelectedSpotType() end)
        -- The second return value has meaning only for heal_patchmatch (SDK14.1 contract).
        if spotType ~= "heal_patchmatch" then genAI = nil end
        local inventory, inventoryOk = Repair.observe(diagnostics, "getAllSpots", function() return SDK.getAllSpots(feature) end)
        local count, countOk = Repair.observe(diagnostics, "countAllSpots", function() return SDK.countAllSpots(feature) end)
        evidence.index, evidence.spotType = index, spotType
        evidence.count = count
        if type(genAI) == "boolean" then evidence.useGenAI = genAI end
        diagnostics.parameterNumbers = {}; local budget = { n = 0, bytes = 0, truncated = false }
        parameterNumbers(params, diagnostics.parameterNumbers, "", 0, budget); diagnostics.numbersTruncated = budget.truncated
        local diagnosticOk, diagnostic = Tasks.pcall(function() return stable(params) end)
        if diagnosticOk then
            evidence.paramsDiagnostic = string.sub(diagnostic, 1, 2048); evidence.diagnosticTruncated = #diagnostic > 2048
        else
            local entries = {}
            if type(params) == "table" then for key, value in pairs(params) do
                if #entries < 64 and (type(key) == "string" or type(key) == "number") then
                    local scalarOk, scalar = Tasks.pcall(function() return stable(value) end)
                    table.insert(entries, tostring(key) .. "=" .. (scalarOk and string.sub(scalar, 1, 128) or "<" .. type(value) .. ">"))
                end
            end end
            table.sort(entries); evidence.paramsDiagnostic = string.sub(table.concat(entries, ";"), 1, 2048); evidence.diagnosticTruncated = true
        end
        local matched, matchedOk = Repair.observe(diagnostics, "contextMatches", contextMatches)
        if not matchedOk or not matched then error("Photo or tool context unavailable") end
        if not indexOk or not countOk or type(count) ~= "number" or count < 0 or count ~= math.floor(count) then error("Unreadable repair selection/count") end
        if index == nil then
            local finalIndex, finalOk = Repair.observe(diagnostics, "getSelectedSpotIndex.recheck", function() return SDK.getSelectedSpotIndex(feature) end)
            if not finalOk or finalIndex ~= nil or not contextMatches() then error("Selection changed") end
            evidence.available, evidence.selected = true, false
            return evidence
        end
        if not paramsOk or not typeOk or not inventoryOk then error("A selected repair getter failed") end
        if type(index) ~= "number" or index ~= math.floor(index) or type(inventory) ~= "table" or
            type(params) ~= "table" or type(count) ~= "number" or count ~= #inventory or inventory[index] == nil then
            error("Selected repair cannot be bound to native inventory")
        end
        if not ({ heal_patchmatch = true, heal = true, clone = true })[spotType] then error("Unknown selected repair type") end
        local records = {}
        for i, item in ipairs(inventory) do records[i] = stable(item) end
        local rawParams, rawInventory = stable(params), stable(inventory)
        local finalType, finalTypeOk, finalGenAI = Repair.observe(diagnostics, "getSelectedSpotType.recheck", function() return SDK.getSelectedSpotType() end)
        if finalType ~= "heal_patchmatch" then finalGenAI = nil end
        local finalIndex, finalIndexOk = Repair.observe(diagnostics, "getSelectedSpotIndex.recheck", function() return SDK.getSelectedSpotIndex(feature) end)
        local finalParams, finalParamsOk = Repair.observe(diagnostics, "getSelectedSpotParams.recheck", function() return SDK.getSelectedSpotParams(feature) end)
        local finalInventory, finalInventoryOk = Repair.observe(diagnostics, "getAllSpots.recheck", function() return SDK.getAllSpots(feature) end)
        if not finalTypeOk or not finalIndexOk or not finalParamsOk or not finalInventoryOk or not contextMatches() or
            finalType ~= spotType or finalGenAI ~= genAI or finalIndex ~= index or
            stable(finalParams) ~= rawParams or stable(finalInventory) ~= rawInventory then error("Selection changed") end
        local selected = evidence
        selected.available, selected.selected = true, true
        -- Observed Selected Opacity 50/75 corresponds to native root Opacity 0.50/0.75.
        selected.opacity = Repair.unit(params.Opacity)
        -- Observed Selected Feather 33/60 corresponds to native root Feather 0.33/0.60.
        selected.feather = Repair.unit(params.Feather)
        selected.token = tostring(index) .. ":" .. digest(rawInventory .. "|" .. rawParams .. "|" .. spotType .. "|" .. tostring(genAI))
        if spotType == "heal_patchmatch" and type(genAI) == "boolean" then selected.useGenAI = genAI end
        -- Local-only full inventory evidence is never sent as parameter data or used to invent field mappings.
        return { public = selected, records = records, index = index, params = clone(params) }
    end)
    if not ok then
        evidence.available = false; evidence.reason = "Selected repair SDK identity/readback is unavailable."
        diagnostics.identityError = string.sub(tostring(result), 1, 200)
        return evidence
    end
    return result
end
function Repair.public(snapshot) return snapshot.public or snapshot end
function Repair.token(snapshot) return Repair.public(snapshot).token end
function Repair.editConfirmed(before, after)
    if not before.records or not after.records or before.index ~= after.index or #before.records ~= #after.records then return false end
    for i, record in ipairs(before.records) do if i ~= before.index and after.records[i] ~= record then return false end end
    return true
end
function Repair.copyParams(snapshot) return snapshot.params and clone(snapshot.params) or nil end
function Repair.parameterEditConfirmed(before, after, field)
    if not Repair.editConfirmed(before, after) or not before.params or not after.params then return false end
    local a, b = Repair.public(before), Repair.public(after)
    if a.spotType ~= b.spotType or a.useGenAI ~= b.useGenAI then return false end
    local left, right = clone(before.params), clone(after.params)
    left[field], right[field] = nil, nil
    return stable(left) == stable(right)
end
function Repair.removalConfirmed(before, after)
    if not before.records or not after.records or #after.records ~= #before.records - 1 then return false end
    local nextIndex = 1
    for i, record in ipairs(before.records) do
        if i ~= before.index then
            if after.records[nextIndex] ~= record then return false end
            nextIndex = nextIndex + 1
        end
    end
    return true
end
-- Read the remaining inventory even if Lightroom leaves no selected repair after deletion.
function Repair.remaining(contextMatches)
    local ok, records = Tasks.pcall(function()
        if not contextMatches() then return nil end
        local inventory = SDK.getAllSpots(feature)
        if type(inventory) ~= "table" or SDK.countAllSpots(feature) ~= #inventory then return nil end
        local out = {}; for i, item in ipairs(inventory) do out[i] = stable(item) end
        if not contextMatches() then return nil end
        return out
    end)
    return ok and records and { records = records } or {}
end
return Repair
