local LrDevelopController = import "LrDevelopController"
local LrFileUtils = import "LrFileUtils"
local LrPathUtils = import "LrPathUtils"
local LrTasks = import "LrTasks"

local PointColor = require "PointColor"
local ToneCurve = require "ToneCurve"

local MaskPresets = {}
local MAX_FILE_BYTES = 262144
local MAX_NODES = 4096
local MAX_DEPTH = 12

local mappings = {
    { key = "amount", parameter = "local_Amount" },
    { key = "blacks2012", parameter = "local_Blacks" },
    { key = "bluecurve", parameter = "local_Bluecurve", kind = "curve" },
    { key = "clarity2012", parameter = "local_Clarity" },
    { key = "contrast2012", parameter = "local_Contrast" },
    { key = "defringe", parameter = "local_Defringe" },
    { key = "dehaze", parameter = "local_Dehaze" },
    { key = "exposure2012", parameter = "local_Exposure", scale = 4 },
    { key = "grain", parameter = "local_Grain" },
    { key = "greencurve", parameter = "local_Greencurve", kind = "curve" },
    { key = "highlights2012", parameter = "local_Highlights" },
    { key = "hue", parameter = "local_Hue", scale = 180 },
    { key = "luminanceNoise", parameter = "local_LuminanceNoise" },
    { key = "maincurve", parameter = "local_Maincurve", kind = "curve" },
    { key = "moire", parameter = "local_Moire" },
    { key = "pointColors", parameter = "local_PointColors", kind = "pointColors" },
    { key = "redcurve", parameter = "local_Redcurve", kind = "curve" },
    -- Saved exp1.lrtemplate (mo-19) stores Refine directly as 100, not normalized 1.
    { key = "refineSaturation", parameter = "local_RefineSaturation", scale = 1 },
    { key = "saturation", parameter = "local_Saturation" },
    { key = "shadows2012", parameter = "local_Shadows" },
    { key = "sharpness", parameter = "local_Sharpness" },
    { key = "temperature", parameter = "local_Temperature" },
    { key = "texture", parameter = "local_Texture" },
    { key = "tint", parameter = "local_Tint" },
    { key = "toningHue", parameter = "local_ToningHue", scale = 1 },
    { key = "toningSaturation", parameter = "local_ToningSaturation" },
    { key = "whites2012", parameter = "local_Whites" }
}
-- Native Dodge readback (2026-09-11) clears these omitted fields. In particular,
-- Refine's preset default is 0 although SDK resetToDefault returned 100.
-- Other omitted-field reset semantics have not been established by this capture.
local omittedPresetDefaults = { texture = 0, refineSaturation = 0 }
local supportedValueKeys = {}
for _, mapping in ipairs(mappings) do supportedValueKeys[mapping.key] = true end
local legacyValuePairs = { clarity = "clarity2012", contrast = "contrast2012", exposure = "exposure2012" }
local pointColorPresetKeys = {
    SrcHue = true, SrcSat = true, SrcLum = true, HueShift = true, SatScale = true,
    LumScale = true, Variance = true, RangeAmount = true,
    HueRange = true, SatRange = true, LumRange = true
}
local nativePresetParameters = {
    "local_Amount",
    "local_Exposure", "local_Contrast", "local_Highlights", "local_Shadows", "local_Whites", "local_Blacks",
    "local_Temperature", "local_Tint", "local_Hue", "local_Saturation", "local_RefineSaturation",
    "local_Texture", "local_Clarity", "local_Dehaze", "local_Grain", "local_Moire", "local_Defringe",
    "local_Sharpness", "local_LuminanceNoise", "local_ToningSaturation"
}
local nativePresetParameterSet = {}
for _, parameter in ipairs(nativePresetParameters) do nativePresetParameterSet[parameter] = true end

local function finite(value)
    return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

local function deepCopy(value, depth, seen)
    local valueType = type(value)
    if valueType == "number" then if finite(value) then return value end; return nil end
    if valueType == "boolean" or valueType == "string" then return value end
    if valueType ~= "table" or depth > MAX_DEPTH or seen[value] then return nil end
    seen[value] = true
    local copy = {}
    local count = 0
    for key, child in pairs(value) do
        if type(key) ~= "string" and type(key) ~= "number" then seen[value] = nil; return nil end
        local childCopy = deepCopy(child, depth + 1, seen)
        if childCopy == nil then seen[value] = nil; return nil end
        count = count + 1
        if count > MAX_NODES then seen[value] = nil; return nil end
        copy[key] = childCopy
    end
    seen[value] = nil
    return copy
end

local function tokenizer(text)
    local cursor = 1
    local length = string.len(text)

    local function skip()
        while cursor <= length do
            local character = string.sub(text, cursor, cursor)
            if string.match(character, "%s") then cursor = cursor + 1
            elseif string.sub(text, cursor, cursor + 3) == "--[[" then
                local closing = string.find(text, "]]", cursor + 4, true)
                if closing == nil then error("Unterminated preset comment") end
                cursor = closing + 2
            elseif string.sub(text, cursor, cursor + 1) == "--" then
                local lineEnd = string.find(text, "\n", cursor + 2, true)
                cursor = lineEnd and lineEnd + 1 or length + 1
            else return end
        end
    end

    local function nextToken()
        skip()
        if cursor > length then return { kind = "eof" } end
        local character = string.sub(text, cursor, cursor)
        if character == "{" or character == "}" or character == "=" or character == "," then
            cursor = cursor + 1
            return { kind = character }
        end
        if character == '"' or character == "'" then
            local quote = character
            cursor = cursor + 1
            local pieces = {}
            while cursor <= length do
                character = string.sub(text, cursor, cursor)
                if character == quote then cursor = cursor + 1; return { kind = "string", value = table.concat(pieces) } end
                if character == "\\" then
                    local escaped = string.sub(text, cursor + 1, cursor + 1)
                    local replacements = { n = "\n", r = "\r", t = "\t", ['\\'] = "\\", ['"'] = '"', ["'"] = "'" }
                    if replacements[escaped] == nil then error("Unsupported preset string escape") end
                    table.insert(pieces, replacements[escaped])
                    cursor = cursor + 2
                else
                    if string.match(character, "%c") then error("Invalid preset string") end
                    table.insert(pieces, character)
                    cursor = cursor + 1
                end
            end
            error("Unterminated preset string")
        end
        local remaining = string.sub(text, cursor)
        local numberText = string.match(remaining, "^[+-]?%d+%.?%d*[eE][+-]?%d+") or
            string.match(remaining, "^[+-]?%d*%.%d+") or string.match(remaining, "^[+-]?%d+")
        if numberText ~= nil then
            cursor = cursor + string.len(numberText)
            local value = tonumber(numberText)
            if not finite(value) then error("Invalid preset number") end
            return { kind = "number", value = value }
        end
        local identifier = string.match(remaining, "^[%a_][%w_]*")
        if identifier ~= nil then cursor = cursor + string.len(identifier); return { kind = "identifier", value = identifier } end
        error("Unsupported preset syntax")
    end

    return nextToken
end

local function parsePreset(text)
    local nextToken = tokenizer(text)
    local nodes = 0
    local parseValue
    local function parseTable(depth)
        if depth > MAX_DEPTH then error("Preset nesting is too deep") end
        local result = {}
        local nextIndex = 1
        while true do
            local first = nextToken()
            if first.kind == "}" then return result end
            if first.kind == "," then first = nextToken() end
            if first.kind == "}" then return result end
            local separator
            if first.kind == "{" then
                if result[nextIndex] ~= nil then error("Duplicate preset field") end
                result[nextIndex] = parseTable(depth + 1)
                nextIndex = nextIndex + 1
                separator = nextToken()
            else
                local second = nextToken()
                if second.kind == "=" and
                    (first.kind == "identifier" or first.kind == "string" or first.kind == "number") then
                    if result[first.value] ~= nil then error("Duplicate preset field") end
                    result[first.value] = parseValue(depth + 1)
                    separator = nextToken()
                else
                    local value
                    if first.kind == "number" or first.kind == "string" then value = first.value
                    elseif first.kind == "identifier" and (first.value == "true" or first.value == "false") then
                        value = first.value == "true"
                    else error("Invalid preset table entry") end
                    if result[nextIndex] ~= nil then error("Duplicate preset field") end
                    result[nextIndex] = value
                    nextIndex = nextIndex + 1
                    separator = second
                end
            end
            nodes = nodes + 1
            if nodes > MAX_NODES then error("Preset contains too much data") end
            if separator.kind == "}" then return result end
            if separator.kind ~= "," then error("Invalid preset table separator") end
        end
    end
    parseValue = function(depth)
        local token = nextToken()
        if token.kind == "{" then return parseTable(depth) end
        if token.kind == "number" or token.kind == "string" then return token.value end
        if token.kind == "identifier" and (token.value == "true" or token.value == "false") then return token.value == "true" end
        if token.kind == "identifier" and token.value == "ZSTR" then
            local localized = nextToken()
            if localized.kind ~= "string" then error("Invalid localized preset string") end
            return localized.value
        end
        error("Invalid preset value")
    end

    local root = nextToken()
    if root.kind ~= "identifier" or root.value ~= "s" or nextToken().kind ~= "=" or nextToken().kind ~= "{" then
        error("Invalid local adjustment preset")
    end
    local result = parseTable(1)
    if nextToken().kind ~= "eof" or result.type ~= "LocalizedAdjustmentPreset" or type(result.value) ~= "table" then
        error("Not a local adjustment preset")
    end
    return result.value
end

local function safeFilename(filename)
    return type(filename) == "string" and string.len(filename) >= 12 and string.len(filename) <= 180 and
        string.match(string.lower(filename), "^[^\"/\\%c]+%.lrtemplate$") ~= nil
end

local function readPreset(filename)
    if not safeFilename(filename) then return nil, "parse_failure", "The local adjustment preset filename is invalid." end
    local directory = LrPathUtils.child(LrPathUtils.getStandardFilePath("appData"), "Local Adjustment Presets")
    local path = LrPathUtils.child(directory, filename)
    local attributes = LrFileUtils.fileAttributes(path)
    if type(attributes) ~= "table" or not finite(attributes.fileSize) or attributes.fileSize < 1 or
        attributes.fileSize > MAX_FILE_BYTES then
        return nil, "parse_failure", "The local adjustment preset file is unavailable or too large."
    end
    local text = LrFileUtils.readFile(path)
    if type(text) ~= "string" or string.len(text) ~= attributes.fileSize then
        return nil, "parse_failure", "The local adjustment preset file could not be read safely."
    end
    local ok, value = LrTasks.pcall(function() return parsePreset(text) end)
    if ok == true then return value, nil, nil end
    return nil, "parse_failure", "The local adjustment preset contains invalid or unsafe syntax."
end

local function outcome(ok, kind, detail, appliedCount, diagnostics)
    return { ok = ok == true, kind = kind, detail = detail or "", appliedCount = appliedCount or 0,
        diagnostics = diagnostics }
end

local function closeNumber(left, right)
    return finite(left) and finite(right) and math.abs(left - right) <= math.max(0.000001, math.abs(right) * 0.000001)
end

local function readComparable(entry)
    local ok, current = LrTasks.pcall(function() return LrDevelopController.getValue(entry.parameter) end)
    if ok ~= true or current == nil then return nil end
    if entry.kind == "curve" then return ToneCurve.normalizeCurveValue(current) end
    if entry.kind == "pointColors" then return PointColor.copyCollection(current) end
    if finite(current) then return current end
    return nil
end

local function equivalent(entry, current, expected)
    if entry.kind == "curve" then return ToneCurve.curvesEqual(current, expected) end
    if entry.kind == "pointColors" then
        if entry.sourcePresent ~= true then return PointColor.collectionsEquivalent(current, expected) end
        return PointColor.presetCollectionsEquivalent(current, expected)
    end
    return closeNumber(current, expected)
end

local function writeEntry(entry, value, selectedIndex)
    if entry.kind == "pointColors" then
        local replaced = PointColor.replaceContextCollection(deepCopy(value, 0, {}), true, selectedIndex)
        return replaced == true
    end
    LrDevelopController.setValue(entry.parameter, deepCopy(value, 0, {}))
    return true
end

local function copyDiagnosticValue(value)
    if value == nil then return nil end
    return deepCopy(value, 0, {})
end

local function comparisonsFor(readable)
    local comparisons = {}
    local firstMismatch = nil
    for _, entry in ipairs(readable) do
        local current = readComparable(entry)
        local reason = "confirmed"
        if current == nil then reason = "authoritative_omitted"
        elseif not equivalent(entry, current, entry.expected) then reason = "different" end
        local comparison = {
            parameter = entry.parameter, kind = entry.kind,
            sourcePresent = entry.sourcePresent, applied = (entry.sourcePresent and entry.readOnly ~= true) or entry.defaulted == true,
            expected = copyDiagnosticValue(entry.expected), authoritative = copyDiagnosticValue(current), reason = reason,
            status = (entry.readOnly and "present/verified/" or entry.sourcePresent and "present/applied/" or
                entry.defaulted and "absent/defaulted/" or "absent/preserved/") ..
                (reason == "confirmed" and "confirmed" or "mismatched")
        }
        if entry.kind == "pointColors" then
            local selectionOk, selectedIndex = LrTasks.pcall(function()
                return LrDevelopController.getSelectedPointColorSwatchIndex(true)
            end)
            comparison.baselineCount = #entry.baseline
            comparison.baselineSelectedIndex = entry.baselineSelectedIndex
            comparison.authoritativeSelectedIndex = selectionOk == true and finite(selectedIndex) and selectedIndex or nil
        end
        if firstMismatch == nil and reason ~= "confirmed" then firstMismatch = comparison end
        comparisons[#comparisons + 1] = comparison
    end
    return comparisons, firstMismatch
end

local function mismatchDetail(comparison)
    if type(comparison) ~= "table" then return "Lightroom did not confirm every applied preset value." end
    if comparison.reason == "authoritative_omitted" then
        return comparison.parameter .. " was omitted from Lightroom's authoritative preset readback."
    end
    if comparison.kind == "pointColors" then
        local expectedCount = type(comparison.expected) == "table" and #comparison.expected or 0
        local actualCount = type(comparison.authoritative) == "table" and #comparison.authoritative or 0
        return comparison.parameter .. " expected " .. tostring(expectedCount) .. " swatches but Lightroom returned " ..
            tostring(actualCount) .. "."
    end
    if comparison.kind == "scalar" then
        return comparison.parameter .. " expected " .. tostring(comparison.expected) .. " but Lightroom returned " ..
            tostring(comparison.authoritative) .. "."
    end
    if comparison.kind == "curve" and type(comparison.expected) == "table" and
        type(comparison.authoritative) == "table" then
        local count = math.max(#comparison.expected, #comparison.authoritative)
        for index = 1, count do
            if comparison.expected[index] ~= comparison.authoritative[index] then
                return comparison.parameter .. " first differed at curve value " .. tostring(index) .. ": expected " ..
                    tostring(comparison.expected[index]) .. " but Lightroom returned " ..
                    tostring(comparison.authoritative[index]) .. "."
            end
        end
    end
    return comparison.parameter .. " did not match Lightroom's authoritative preset readback."
end

local function explicitTarget(mapping, source)
    if mapping.kind == "curve" then
        if type(source) ~= "table" then return nil, nil end
        for key, _ in pairs(source) do
            if type(key) ~= "number" or key < 1 or key > #source or key ~= math.floor(key) then return nil, nil end
        end
        local normalized = ToneCurve.normalizeCurveValue(source)
        if normalized == nil then return nil, nil end
        return ToneCurve.copyCurve(normalized), normalized
    end
    if mapping.kind == "pointColors" then
        local collection = PointColor.copyCollection(source)
        if collection == nil then return nil, nil end
        for _, swatch in ipairs(collection) do
            for key, _ in pairs(swatch) do
                if pointColorPresetKeys[key] ~= true then
                    return nil, nil, "The preset contains an unsupported Point Color property: " .. tostring(key)
                end
            end
        end
        if #collection == 0 then
            return nil, nil, "An explicit empty Point Color collection is not a proven native clearing instruction."
        end
        return collection, collection
    end
    if not finite(source) then return nil, nil, mapping.key .. " must contain a finite number." end
    local target = source * (mapping.scale or 100)
    local rangeOk, minimum, maximum = LrTasks.pcall(function()
        return LrDevelopController.getRange(mapping.parameter)
    end)
    if rangeOk ~= true or not finite(minimum) or not finite(maximum) or minimum >= maximum then
        return nil, nil, mapping.parameter .. " has no usable SDK range for this mask."
    end
    if not finite(target) or target < minimum or target > maximum then
        return nil, nil, mapping.key .. "=" .. tostring(source) .. " converts to " ..
            mapping.parameter .. "=" .. tostring(target) .. "; SDK range is " ..
            tostring(minimum) .. ".." .. tostring(maximum) .. "."
    end
    return target, target
end

local function applyValues(values, stillValid, trace, nativeParameter)
    local function record(phase, parameter, value)
        if type(trace) == "function" then pcall(trace, phase, parameter, value) end
    end
    local function contextValid()
        return type(stillValid) ~= "function" or stillValid() == true
    end
    if not contextValid() then return outcome(false, "stale_context", "The selected mask or Lightroom context changed. Any settings already applied remain on the previous mask.") end
    local readable = {}
    local requiresModernProcess = false
    for key, value in pairs(values) do
        local paired = legacyValuePairs[key]
        if paired ~= nil and finite(value) and finite(values[paired]) then
            requiresModernProcess = true
            record("inactive-legacy-process-field", key, value)
        elseif supportedValueKeys[key] ~= true and not (key == "toningLuminance" and value == 0) then
            return outcome(false, "unsupported_preset", "The preset contains an unsupported adjustment: " .. tostring(key))
        end
        if type(key) == "string" and string.match(key, "2012$") then requiresModernProcess = true end
    end
    if requiresModernProcess then
        local ok, process = LrTasks.pcall(function() return LrDevelopController.getProcessVersion() end)
        local version = ok == true and tonumber(string.match(tostring(process), "^Version (%d+)$")) or nil
        if version == nil or version < 3 then
            return outcome(false, "unsupported_preset", "This saved preset requires Lightroom Process Version 3 or later.")
        end
    end
    if values.toningLuminance ~= nil then
        -- Installed Adobe files contain this legacy zero. There is no approved
        -- write mapping: require the SDK to prove it already matches, and include
        -- it in settlement and rollback verification instead of silently skipping it.
        local ok, baseline = LrTasks.pcall(function() return LrDevelopController.getValue("local_ToningLuminance") end)
        if ok ~= true or baseline ~= 0 then
            return outcome(false, "unsupported_preset", "The preset's legacy Color luminance cannot be confirmed for this mask.")
        end
        readable[#readable + 1] = { parameter = "local_ToningLuminance", kind = "scalar",
            baseline = baseline, expected = 0, sourcePresent = true, readOnly = true }
    end
    local applied = {}
    local recognizedValues = 0
    for _, mapping in ipairs(mappings) do
        if not contextValid() then return outcome(false, "stale_context", "The selected mask or Lightroom context changed. Any settings already applied remain on the previous mask.") end
        local readOk, current = LrTasks.pcall(function() return LrDevelopController.getValue(mapping.parameter) end)
        local baseline = readOk == true and current ~= nil and deepCopy(current, 0, {}) or nil
        if nativeParameter then
            -- Color tint, color-channel curves and Point Color were not seeded
            -- in the native captures; keep those unmeasured cases guarded.
            if mapping.key == "toningSaturation" and baseline ~= 0 then
                return outcome(false, "unsupported_preset", "Single-adjustment presets have not been verified with an existing Color tint.")
            end
            if mapping.kind == "curve" then
                local curve = ToneCurve.normalizeCurveValue(baseline)
                if curve == nil then
                    return outcome(false, "unsupported_preset", "A local curve is unavailable for authoritative preset confirmation.")
                end
                if mapping.key ~= "maincurve" and
                    (#curve ~= 4 or curve[1] ~= 0 or curve[2] ~= 0 or curve[3] ~= 255 or curve[4] ~= 255) then
                    return outcome(false, "unsupported_preset", "Single-adjustment presets have not been verified with a non-linear color-channel curve.")
                end
            end
            if mapping.kind == "pointColors" and baseline ~= nil and (type(baseline) ~= "table" or #baseline > 0) then
                return outcome(false, "unsupported_preset", "Single-adjustment presets have not been verified with existing Point Color swatches.")
            end
        end
        local source = values[mapping.key]
        local defaulted = source == nil and omittedPresetDefaults[mapping.key] ~= nil
        record(source == nil and "omitted-baseline" or "explicit-baseline", mapping.parameter, baseline)
        if (source ~= nil or defaulted) and baseline == nil then
            return outcome(false, "unsupported_preset", mapping.parameter .. " is unavailable for the selected mask.")
        end
        if baseline ~= nil then
            local entry = { parameter = mapping.parameter, kind = mapping.kind or "scalar", baseline = baseline,
                sourcePresent = source ~= nil, defaulted = defaulted }
            if source ~= nil or defaulted then
                local targetDetail
                local targetSource = source
                if defaulted then targetSource = omittedPresetDefaults[mapping.key] end
                entry.writeValue, entry.expected, targetDetail = explicitTarget(mapping, targetSource)
                if entry.writeValue == nil or entry.expected == nil then
                    return outcome(false, "unsupported_preset",
                        targetDetail or "A supported local-adjustment property contains an invalid value.")
                end
                if source ~= nil then recognizedValues = recognizedValues + 1 end
                applied[#applied + 1] = entry
            else
                -- Preserve remaining omissions until their native behavior is established;
                -- do not reset Amount or synthesize empty structured corrections.
                entry.expected = readComparable(entry)
                if entry.expected == nil then
                    return outcome(false, "unsupported_preset", mapping.parameter .. " could not be read for preservation.")
                end
            end
            if entry.kind == "pointColors" then
                local selectedOk, selectedIndex = LrTasks.pcall(function()
                    return LrDevelopController.getSelectedPointColorSwatchIndex(true)
                end)
                if selectedOk == true and finite(selectedIndex) and selectedIndex >= 1 and
                    selectedIndex <= #baseline and selectedIndex == math.floor(selectedIndex) then
                    entry.baselineSelectedIndex = selectedIndex
                end
            end
            readable[#readable + 1] = entry
        end
    end
    if nativeParameter then
        readable[#readable + 1] = { parameter = "local_ToningLuminance", kind = "scalar",
            baseline = 0, expected = 0, sourcePresent = false }
    end
    if recognizedValues == 0 then
        return outcome(false, "unsupported_preset", "The preset contains no supported local-adjustment values.")
    end

    local attempted = {}
    local function rollback()
        if not contextValid() then return false end
        local restored = true
        for _, entry in ipairs(attempted) do
            if not contextValid() then return false end
            record("restore-start", entry.parameter, entry.baseline)
            local restoreOk, restoreAccepted = LrTasks.pcall(function()
                return writeEntry(entry, entry.baseline, entry.baselineSelectedIndex)
            end)
            record("restore-return", entry.parameter, restoreOk == true and restoreAccepted == true)
            if restoreOk ~= true or restoreAccepted ~= true then restored = false end
        end
        if not restored or not contextValid() then return false end
        -- An SDK write can also disturb a preserved field. Do not claim full
        -- restoration if any readable adjustment still differs from its baseline.
        for _, entry in ipairs(readable) do
            if not contextValid() then return false end
            local expected = entry.baseline
            if entry.kind == "curve" then expected = ToneCurve.normalizeCurveValue(expected) end
            if not equivalent(entry, readComparable(entry), expected) then return false end
        end
        return contextValid()
    end

    local writtenCount = 0
    for _, entry in ipairs(applied) do
        if not contextValid() then
            return outcome(false, "stale_context", "The selected mask or Lightroom context changed. Any settings already applied remain on the previous mask.")
        end
        attempted[#attempted + 1] = entry
        record("write-start", entry.parameter, entry.writeValue)
        local writeOk, writeAccepted = LrTasks.pcall(function() return writeEntry(entry, entry.writeValue) end)
        record("write-return", entry.parameter, writeOk == true and writeAccepted == true)
        if writeOk ~= true or writeAccepted ~= true then
            local rollbackSucceeded = rollback()
            return outcome(false, "lightroom_write_failure",
                "Lightroom rejected " .. entry.parameter .. " while applying the local-adjustment preset.", 0, {
                    comparisons = {}, firstMismatch = nil, supportedCount = #readable,
                    recognizedCount = recognizedValues, writtenCount = writtenCount,
                    appliedFieldCount = #applied, preservedCount = #readable - #applied,
                    rollbackAttempted = true, rollbackSucceeded = rollbackSucceeded
                })
        end
        writtenCount = writtenCount + 1
    end

    local settled = false
    local comparisons = {}
    local firstMismatch = nil
    for _ = 1, 12 do
        if not contextValid() then
            return outcome(false, "stale_context", "The selected mask or Lightroom context changed. Any settings already applied remain on the previous mask.")
        end
        comparisons, firstMismatch = comparisonsFor(readable)
        record("readback", firstMismatch and firstMismatch.parameter or "all", firstMismatch == nil)
        settled = firstMismatch == nil
        if settled then break end
        LrTasks.sleep(0.05)
    end
    if not settled then
        local rollbackSucceeded = rollback()
        return outcome(false, "settlement_failure", mismatchDetail(firstMismatch), 0, {
            comparisons = comparisons,
            firstMismatch = firstMismatch,
            supportedCount = #readable,
            recognizedCount = recognizedValues,
            writtenCount = writtenCount,
            appliedFieldCount = #applied,
            preservedCount = #readable - #applied,
            rollbackAttempted = true,
            rollbackSucceeded = rollbackSucceeded
        })
    end
    return outcome(true, "confirmed", "", #applied, {
        comparisons = comparisons,
        firstMismatch = nil,
        supportedCount = #readable,
        recognizedCount = recognizedValues,
        writtenCount = writtenCount,
        appliedFieldCount = #applied,
        preservedCount = #readable - #applied,
        rollbackAttempted = false,
        rollbackSucceeded = nil
    })
end

function MaskPresets.apply(filename, stillValid, trace)
    if type(stillValid) == "function" and stillValid() ~= true then
        return outcome(false, "stale_context", "The selected mask or Lightroom context changed.")
    end
    if type(trace) == "function" then pcall(trace, "read-file", filename) end
    local values, kind, detail = readPreset(filename)
    if values == nil then return outcome(false, kind, detail) end
    return applyValues(values, stillValid, trace)
end

-- SDK native-menu captures, 2026-09-12: ordinary scalar corrections return to
-- zero and Refine Saturation returns to 100. This differs from saved templates.
-- Paired Exposure capture 019 also proves strength 73 -> 100 and a seeded
-- RGB curve -> linear. Other structured/color behavior remains guarded above.
local singleAdjustmentDefaults = {
    amount = 1, blacks2012 = 0, clarity2012 = 0, contrast2012 = 0, defringe = 0, dehaze = 0,
    exposure2012 = 0, grain = 0, highlights2012 = 0, hue = 0, luminanceNoise = 0,
    maincurve = {0, 0, 255, 255}, moire = 0, refineSaturation = 100,
    saturation = 0, shadows2012 = 0, sharpness = 0, temperature = 0, texture = 0, tint = 0, whites2012 = 0
}

function MaskPresets.applyBuiltin(parameter, target, stillValid, trace)
    if nativePresetParameterSet[parameter] ~= true or parameter == "local_Amount" or
        parameter == "local_RefineSaturation" or parameter == "local_ToningSaturation" or not finite(target) then
        return outcome(false, "unsupported_preset", "That single-adjustment preset is invalid.")
    end
    if type(stillValid) == "function" and stillValid() ~= true then
        return outcome(false, "stale_context", "The selected mask or Lightroom context changed.")
    end
    local luminanceOk, luminance = LrTasks.pcall(function() return LrDevelopController.getValue("local_ToningLuminance") end)
    if luminanceOk ~= true or luminance ~= 0 then
        return outcome(false, "unsupported_preset", "Single-adjustment presets have not been verified with this legacy Color adjustment.")
    end
    local values = {}
    for key, value in pairs(singleAdjustmentDefaults) do values[key] = value end
    for _, mapping in ipairs(mappings) do
        if mapping.parameter == parameter then values[mapping.key] = target / (mapping.scale or 100) end
    end
    -- Reuse the saved-preset preflight, scaled writes, settlement and verified rollback.
    return applyValues(values, stillValid, trace, parameter)
end

local function formatNumber(value)
    return string.format("%.17g", value)
end

local function formatValue(value, depth)
    if value == nil then return "<omitted>" end
    local valueType = type(value)
    if valueType == "number" then return formatNumber(value) end
    if valueType == "boolean" or valueType == "string" then return tostring(value) end
    if valueType ~= "table" or depth > MAX_DEPTH then return "<invalid>" end
    local keys = {}
    for key, _ in pairs(value) do keys[#keys + 1] = key end
    table.sort(keys, function(left, right)
        if type(left) == type(right) then return tostring(left) < tostring(right) end
        return type(left) < type(right)
    end)
    local parts = {}
    for _, key in ipairs(keys) do
        parts[#parts + 1] = tostring(key) .. "=" .. formatValue(value[key], depth + 1)
    end
    return "{" .. table.concat(parts, ",") .. "}"
end

function MaskPresets.formatSettlementDiagnostics(result, context)
    if type(result) ~= "table" then return {} end
    context = type(context) == "table" and context or {}
    local lines = {
        "preset-settlement operation=" .. tostring(context.operationId or "") ..
            " preset=" .. tostring(context.preset or "") .. " file=" .. tostring(context.presetFile or "") ..
            " photo=" .. tostring(context.photoUuid or "") .. " mask=" .. tostring(context.maskId or "") ..
            " component-before=" .. tostring(context.componentBefore or "") ..
            " component-after=" .. tostring(context.componentAfter or "") ..
            " context=" .. tostring(context.contextCounter or "") ..
            " develop=" .. tostring(context.developCounter or "") ..
            " masking=" .. tostring(context.maskingRevision or "") ..
            " epoch=" .. tostring(context.serverEpoch or "") ..
            " result=" .. tostring(result.kind or "") .. " applied=" .. tostring(result.appliedCount or 0) ..
            " recognized=" .. tostring(result.diagnostics and result.diagnostics.recognizedCount or 0) ..
            " supported=" .. tostring(result.diagnostics and result.diagnostics.supportedCount or 0) ..
            " written=" .. tostring(result.diagnostics and result.diagnostics.writtenCount or 0) ..
            " preserved=" .. tostring(result.diagnostics and result.diagnostics.preservedCount or 0) ..
            " rollback-attempted=" .. tostring(result.diagnostics and result.diagnostics.rollbackAttempted == true) ..
            " rollback-succeeded=" .. tostring(result.diagnostics and result.diagnostics.rollbackSucceeded)
    }
    local diagnostics = result.diagnostics
    if type(diagnostics) == "table" and type(diagnostics.comparisons) == "table" then
        for _, comparison in ipairs(diagnostics.comparisons) do
            local line = "preset-settlement-value parameter=" .. tostring(comparison.parameter or "") ..
                " kind=" .. tostring(comparison.kind or "") ..
                " source=" .. (comparison.sourcePresent == true and "present" or "absent") ..
                " applied=" .. tostring(comparison.applied == true)
            line = line .. " expected=" .. formatValue(comparison.expected, 0) ..
                " authoritative=" .. formatValue(comparison.authoritative, 0)
            if comparison.kind == "pointColors" then
                line = line .. " baseline-count=" .. formatValue(comparison.baselineCount, 0) ..
                    " baseline-selection=" .. formatValue(comparison.baselineSelectedIndex, 0) ..
                    " authoritative-selection=" .. formatValue(comparison.authoritativeSelectedIndex, 0)
            end
            lines[#lines + 1] = line .. " comparison=" .. tostring(comparison.status or "")
        end
    end
    lines[#lines + 1] = "preset-settlement-result ok=" .. tostring(result.ok == true) ..
        " kind=" .. tostring(result.kind or "") .. " detail=" .. tostring(result.detail or "")
    return lines
end

return MaskPresets
