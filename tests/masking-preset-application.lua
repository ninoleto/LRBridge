-- Execute the production preset parser, writer, and semantic comparators against
-- a controlled SDK. These are contract tests, not live Lightroom acceptance.
package.path = "lightroom/LRBridge.lrplugin/?.lua;" .. package.path
local values, writes, selectedIndex, onWrite, onAdd, valid, source
local function copy(value)
    if type(value) ~= "table" then return value end
    local result = {}
    for key, child in pairs(value) do result[key] = copy(child) end
    return result
end
local controller = {}
local processVersion = "Version 6"
controller.getProcessVersion = function() return processVersion end
controller.getValue = function(parameter) return copy(values[parameter]) end
controller.getRange = function(parameter)
    if values[parameter] == nil then return nil end
    if parameter == "local_Exposure" then return -4, 4 end
    if parameter == "local_Hue" then return -180, 180 end
    if parameter == "local_ToningHue" then return 0, 360 end
    if parameter == "local_Amount" then return 0, 200 end
    if parameter == "local_RefineSaturation" then return 0, 100 end
    return -100, 100
end
controller.setValue = function(parameter, value)
    writes[#writes + 1] = { parameter = parameter, value = copy(value) }
    if onWrite and onWrite(parameter, value) == false then return end
    values[parameter] = copy(value)
end
controller.resetToDefault = function() error("File presets must not reset omitted settings") end
controller.getSelectedPointColorSwatchIndex = function() return selectedIndex end
controller.selectPointColorSwatch = function(index) selectedIndex = index end
controller.deletePointColorSwatch = function() values.local_PointColors = {}; return true end
controller.addPointColorSwatch = function(swatch)
    if onAdd then onAdd(swatch) end
    for _, key in ipairs({"SrcHue", "SrcLum", "SrcSat"}) do
        swatch[key] = math.floor(swatch[key] * 100 + 0.5) / 100
    end
    values.local_PointColors[#values.local_PointColors + 1] = copy(swatch)
    return true
end
local modules = {
    LrDevelopController = controller,
    LrTasks = { pcall = pcall, sleep = function() end },
    LrPathUtils = { getStandardFilePath = function() return "fixture" end,
        child = function(parent, child) return parent .. "/" .. child end },
    LrFileUtils = { fileAttributes = function() return { fileSize = #source } end,
        readFile = function() return source end },
    LrApplicationView = { getCurrentModuleName = function() return "develop" end }
}
import = function(name) return modules[name] or {} end
local presets = require "MaskPresets"
local pointColor = require "PointColor"
local swatch = {
    SrcHue = 1.253421, SrcSat = 0.503214, SrcLum = 0.401234,
    HueShift = 0.2, SatScale = -0.1, LumScale = 0.15, Variance = 0.05, RangeAmount = 0.5,
    HueRange = { LowerNone = 0.1, LowerFull = 0.3, UpperFull = 0.7, UpperNone = 0.9 },
    SatRange = { LowerNone = 0.1, LowerFull = 0.25, UpperFull = 0.75, UpperNone = 0.9 },
    LumRange = { LowerNone = 0.05, LowerFull = 0.2, UpperFull = 0.8, UpperNone = 0.95 }
}
local function reset(fixture)
    values, writes, selectedIndex, onWrite, onAdd, valid = {}, {}, 1, nil, nil, true
    processVersion = "Version 6"
    for _, name in ipairs({ "Amount", "Blacks", "Clarity", "Contrast", "Defringe", "Dehaze", "Exposure",
        "Grain", "Highlights", "Hue", "LuminanceNoise", "Moire", "RefineSaturation", "Saturation", "Shadows",
        "Sharpness", "Temperature", "Texture", "Tint", "ToningHue", "ToningSaturation", "Whites" }) do
        values["local_" .. name] = 0.1
    end
    values.local_Amount, values.local_RefineSaturation = 61, 33
    values.local_ToningLuminance = 0
    values.local_PointColors = { copy(swatch) }
    for _, name in ipairs({ "Maincurve", "Redcurve", "Greencurve", "Bluecurve" }) do
        values["local_" .. name] = { "0,0", "128,140", "255,255" }
    end
    source = readFixture(fixture or "live-burn-darken.lrtemplate")
end
local function apply() return presets.apply("fixture.lrtemplate", function() return valid end) end
local function close(left, right) return math.abs(left - right) < 0.000001 end

-- Actual exp1.lrtemplate from failed operation mo-19: Refine is stored in
-- SDK percentage units. Multiplying its saved 100 by 100 incorrectly rejects it.
reset("live-exp-one.lrtemplate")
local savedRefineResult = apply()
assert(savedRefineResult.ok, "Actual exp1 preset failed: " .. savedRefineResult.detail)
assert(values.local_RefineSaturation == 100 and values.local_Exposure == 0 and values.local_Texture == 0)
for _, comparison in ipairs(savedRefineResult.diagnostics.comparisons) do
    assert(comparison.reason == "confirmed", comparison.parameter)
end
for _, savedRefine in ipairs({0, 0.42, 1, 42, 100}) do
    reset("live-exp-one.lrtemplate")
    source = source:gsub("refineSaturation = 100", "refineSaturation = " .. tostring(savedRefine))
    assert(apply().ok and values.local_RefineSaturation == savedRefine,
        "Saved Refine units must not depend on the value's magnitude")
end
for _, invalidRefine in ipairs({-1, 100.01, 10000}) do
    reset("live-exp-one.lrtemplate")
    source = source:gsub("refineSaturation = 100", "refineSaturation = " .. tostring(invalidRefine))
    local rejected = apply()
    assert(not rejected.ok and rejected.kind == "unsupported_preset" and #writes == 0)
    assert(rejected.detail:find("refineSaturation", 1, true) and rejected.detail:find("0..100", 1, true),
        "Range rejection must identify the field and unchanged SDK bounds")
end
reset("live-exp-one.lrtemplate")
local savedRefineBaseline = values.local_RefineSaturation
onWrite = function(parameter, value)
    if parameter == "local_RefineSaturation" and value == 100 then return false end
end
local savedRefineFailure = apply()
assert(not savedRefineFailure.ok and savedRefineFailure.kind == "settlement_failure")
assert(savedRefineFailure.diagnostics.firstMismatch.parameter == "local_RefineSaturation")
assert(savedRefineFailure.diagnostics.rollbackSucceeded and values.local_RefineSaturation == savedRefineBaseline,
    "A dropped supported write still requires verified rollback")
reset("live-exp-one.lrtemplate"); values.local_RefineSaturation = nil
assert(not apply().ok and #writes == 0, "Unavailable current-mask feedback must still reject before writing")
reset("live-exp-one.lrtemplate")
assert(apply().ok, "A prior context failure must not blacklist this saved preset")

-- Native SDK capture, 2026-09-11: revisions 33/37 share the same starting
-- adjustments; native Dodge at revision 34 clears Texture and Refine to zero.
-- SDK Reset had returned Refine to 100, so resetToDefault is not this operation.
reset("live-dodge-lighten.lrtemplate")
for parameter, value in pairs(values) do if type(value) == "number" then values[parameter] = 0 end end
values.local_Amount, values.local_Texture, values.local_RefineSaturation, values.local_ToningHue = 100, 25, 100, 240
values.local_PointColors = nil
for _, channel in ipairs({"Maincurve", "Redcurve", "Greencurve", "Bluecurve"}) do values["local_" .. channel] = {0, 0, 255, 255} end
local nativeExpected = copy(values)
nativeExpected.local_Exposure, nativeExpected.local_Texture, nativeExpected.local_RefineSaturation = 0.25, 0, 0
local nativeResult = apply()
assert(nativeResult.ok, nativeResult.detail)
for parameter, expected in pairs(nativeExpected) do
    if type(expected) == "number" then assert(close(values[parameter], expected), "Native Dodge mismatch: " .. parameter) end
end
local defaultCount = 0
for _, comparison in ipairs(nativeResult.diagnostics.comparisons) do
    if comparison.status == "absent/defaulted/confirmed" then
        defaultCount = defaultCount + 1
        assert(comparison.applied and not comparison.sourcePresent and comparison.authoritative == 0)
    end
end
assert(defaultCount == 2)

reset("live-dodge-lighten.lrtemplate")
source = source:gsub("value = {", "value = { texture = 0.23, refineSaturation = 42,")
assert(apply().ok and close(values.local_Texture, 23) and close(values.local_RefineSaturation, 42),
    "Explicit preset fields must override omitted-field defaults")
reset("live-dodge-lighten.lrtemplate")
values.local_RefineSaturation = nil
assert(not apply().ok and #writes == 0, "Unreadable required defaults must fail before mutation")
for _, parameter in ipairs({"local_Texture", "local_RefineSaturation"}) do
    reset("live-dodge-lighten.lrtemplate")
    local baseline = copy(values)
    onWrite = function(name, value) if name == parameter and value == 0 then return false end end
    local failed = apply()
    assert(not failed.ok and failed.kind == "settlement_failure" and failed.diagnostics.firstMismatch.parameter == parameter)
    assert(failed.diagnostics.rollbackSucceeded and values[parameter] == baseline[parameter] and
        values.local_Exposure == baseline.local_Exposure, "Default failure must retain verified restoration")
end

reset()
local original = copy(values)
onWrite = function() selectedIndex = 0 end -- UI selection metadata is not adjustment data.
local result = apply()
assert(result.ok and result.appliedCount == 15, result.detail)
assert(close(values.local_Exposure, -0.3) and values.local_ToningHue == 240)
assert(values.local_Clarity == 0 and values.local_Amount == 61 and values.local_RefineSaturation == 0 and values.local_Texture == 0)
assert(pointColor.collectionsEquivalent(values.local_PointColors, original.local_PointColors))
assert(values.local_Maincurve[2] == "128,140")
for _, comparison in ipairs(result.diagnostics.comparisons) do assert(comparison.reason == "confirmed") end

reset()
local trace = {}
result = presets.apply("fixture.lrtemplate", function() return valid end, function(phase, parameter, value)
    trace[#trace + 1] = { phase = phase, parameter = parameter, value = value }
end)
assert(result.ok and #writes == 15)
local started, returned = 0, 0
for _, event in ipairs(trace) do
    if event.phase == "write-start" then started = started + 1; assert(started == returned + 1) end
    if event.phase == "write-return" then returned = returned + 1; assert(returned == started) end
    if event.phase == "readback" then assert(started == 15 and returned == 15 and event.value == true) end
end
assert(trace[#trace].phase == "readback")
reset()
assert(presets.apply("fixture.lrtemplate", function() return valid end, function() error("diagnostic failure") end).ok,
    "Diagnostics must not change application success or ordering")

reset("absent-fields.lrtemplate")
result = apply()
assert(result.ok and #writes == 3 and close(values.local_Saturation, -20), result.detail)

reset("localized-scalars.lrtemplate")
source = source:gsub("value = {", "value = { hue = 0.5,")
result = apply()
assert(result.ok, result.detail)
assert(close(values.local_Exposure, 1) and close(values.local_Hue, 90))

reset("tables-supported.lrtemplate")
onWrite = function(parameter, value)
    if parameter:find("curve") then
        local encoded = {}
        for index = 1, #value, 2 do encoded[#encoded + 1] = tostring(value[index]) .. "," .. tostring(value[index + 1]) end
        values[parameter] = encoded
        return false
    end
end
result = apply()
assert(result.ok, result.detail) -- String-pair and flat SDK curve forms are equivalent.
local normalized = copy(swatch)
normalized.SrcHue = 1.25; normalized.SrcLum = 0.40; normalized.SrcSat = 0.50
assert(pointColor.presetCollectionsEquivalent({normalized}, {swatch}))
normalized.HueShift = 0.3
assert(not pointColor.presetCollectionsEquivalent({normalized}, {swatch}))
normalized = copy(swatch); normalized.HueRange.UpperFull = 0.8
assert(not pointColor.presetCollectionsEquivalent({normalized}, {swatch}))

reset("tables-supported.lrtemplate")
onWrite = function(parameter, value)
    if parameter:find("curve") and type(value[1]) == "number" then
        values[parameter] = copy(value)
        values[parameter][4] = values[parameter][4] + 1
        return false
    end
end
result = apply()
assert(not result.ok and result.kind == "settlement_failure")
assert(result.diagnostics.firstMismatch.kind == "curve", "different curve coordinates must not count as equivalent representations")

reset("tables-supported.lrtemplate")
onAdd = function(value) value.HueShift = value.HueShift + 0.1 end
result = apply()
assert(not result.ok and result.kind == "settlement_failure")
assert(not result.diagnostics.rollbackSucceeded, "image-affecting Point Color differences must remain failures")

reset("absent-fields.lrtemplate")
onWrite = function(parameter, value)
    if value == -20 then values[parameter] = nil; return false end
end
result = apply()
assert(not result.ok and result.diagnostics.firstMismatch.reason == "authoritative_omitted")

reset(); values.local_Exposure = nil
result = apply()
assert(not result.ok and result.kind == "unsupported_preset" and #writes == 0)

-- Compatibility is checked again in Lua, including files changed after HTTP admission.
for _, content in ipairs({
    readFixture("tables-and-unsupported.lrtemplate"),
    's = { type = "LocalizedAdjustmentPreset", value = { exposure2012 = 0.25, futureAdjustment = 0 } }',
    's = { type = "LocalizedAdjustmentPreset", value = { exposure2012 = 0.25, toningLuminance = 0.1 } }'
}) do
    reset(); source = content
    result = apply()
    assert(not result.ok and result.kind == "unsupported_preset" and #writes == 0,
        "Unsupported content must fail before every write, even when another field is supported")
end
reset("tables-supported.lrtemplate")
source = source:gsub("HueShift = 0.2,", "HueShift = 0.2, FutureShift = 0.1,")
result = apply()
assert(not result.ok and result.kind == "unsupported_preset" and #writes == 0)
for _, unavailable in ipairs({false, true}) do
    reset()
    if unavailable then values.local_ToningLuminance = nil else values.local_ToningLuminance = 1 end
    result = apply()
    assert(not result.ok and result.kind == "unsupported_preset" and #writes == 0,
        "Legacy zero requires authoritative equality before mutation")
end
reset()
onWrite = function() values.local_ToningLuminance = 2 end
result = apply()
assert(not result.ok and result.kind == "settlement_failure" and not result.diagnostics.rollbackSucceeded)
assert(result.diagnostics.firstMismatch.parameter == "local_ToningLuminance",
    "A change to the verified legacy zero cannot escape authoritative settlement")
for _, version in ipairs({"Version 1", "Version 2", "unavailable"}) do
    reset(); processVersion = version
    assert(not apply().ok and #writes == 0, "Do not discard active legacy process adjustments")
end
reset(); source = 's = { type = "LocalizedAdjustmentPreset", value = { exposure = 0.2, saturation = 0.1 } }'
assert(not apply().ok and #writes == 0, "An unpaired legacy field cannot silently disappear")
reset(); source = 's = { type = "LocalizedAdjustmentPreset", value = { saturation = 0.1, maincurve = { 1 = 0, 0, 255, 255 } } }'
result = apply()
assert(not result.ok and result.kind == "parse_failure" and #writes == 0,
    "Mixed numeric keys cannot overwrite earlier preset data")

reset(); source = 's = { type = "LocalizedAdjustmentPreset", value = { exposure2012 = 20 } }'
result = apply()
assert(not result.ok and result.kind == "unsupported_preset" and #writes == 0)

reset("absent-fields.lrtemplate")
onWrite = function(parameter, value) if value == -20 then return false end end
result = apply()
assert(not result.ok and result.kind == "settlement_failure")
assert(result.diagnostics.rollbackSucceeded and close(values.local_Saturation, 0.1))

reset("absent-fields.lrtemplate")
onWrite = function(parameter, value)
    if parameter == "local_Saturation" then
        values[parameter] = 71
        error("write failed after modifying the value")
    end
end
result = apply()
assert(not result.ok and result.kind == "lightroom_write_failure")
assert(result.diagnostics.rollbackAttempted and not result.diagnostics.rollbackSucceeded)
assert(values.local_Saturation == 71)

reset("absent-fields.lrtemplate")
onWrite = function(parameter, value) if value == -20 then values.local_Amount = 70 end end
result = apply()
assert(not result.ok and result.kind == "settlement_failure")
assert(result.diagnostics.firstMismatch.parameter == "local_Amount", "preserved image changes must remain failures")

reset("absent-fields.lrtemplate")
onWrite = function(parameter, value) if value == -20 then values.local_PointColors = {} end end
result = apply()
assert(not result.ok and result.kind == "settlement_failure")
assert(result.diagnostics.firstMismatch.parameter == "local_PointColors", "swatch loss is not selection metadata")

reset()
onWrite = function() valid = false end
result = apply()
assert(not result.ok and result.kind == "stale_context" and #writes == 1)

reset(); source = 's = { type = "LocalizedAdjustmentPreset", value = { pointColors = {} } }'
result = apply()
assert(not result.ok and #writes == 0, "unproven empty Point Color writes must fail before mutation")

-- Native results are a separate captured contract, not saved-template defaults.
local function singleBaseline()
    reset()
    for parameter, value in pairs(nativeCapture.baseline) do values[parameter] = value end
    values.local_PointColors = nil
    for _, channel in ipairs({"Maincurve", "Redcurve", "Greencurve", "Bluecurve"}) do
        values["local_" .. channel] = {0, 0, 255, 255}
    end
end
local function applySingle(parameter, target)
    return presets.applyBuiltin(parameter or "local_Tint", target or 25, function() return valid end)
end
local function exposureBaseline()
    singleBaseline()
    for parameter, value in pairs(nativeExposureCapture.before.values) do values[parameter] = value end
    for parameter, curve in pairs(nativeExposureCapture.before.curves) do values[parameter] = copy(curve) end
end
local function assertSnapshot(expected)
    for parameter, value in pairs(expected.values) do
        assert(close(values[parameter], value), "Captured native mismatch: " .. parameter)
    end
    local curves = require "ToneCurve"
    for parameter, curve in pairs(expected.curves) do
        assert(curves.curvesEqual(curves.normalizeCurveValue(values[parameter]), curve),
            "Captured native curve mismatch: " .. parameter)
    end
end
exposureBaseline()
local exposureResult = applySingle("local_Exposure", nativeExposureCapture.after.values.local_Exposure)
assert(exposureResult.ok, exposureResult.detail)
assertSnapshot(nativeExposureCapture.after)
-- Every newly evidenced reset must be confirmed, including writes that return
-- normally but silently leave the previous value in Lightroom.
for _, parameter in ipairs({"local_Amount", "local_Temperature", "local_Highlights", "local_Shadows",
    "local_Hue", "local_LuminanceNoise", "local_Defringe", "local_RefineSaturation", "local_Maincurve"}) do
    exposureBaseline()
    onWrite = function(name, value)
        if name ~= parameter then return end
        if parameter == "local_Maincurve" then
            if #value == 4 then return false end
        elseif value == nativeExposureCapture.after.values[parameter] then return false end
    end
    local failed = applySingle("local_Exposure", 1)
    assert(not failed.ok and failed.kind == "settlement_failure" and
        failed.diagnostics.firstMismatch.parameter == parameter, "Dropped reset escaped confirmation: " .. parameter)
    assert(failed.diagnostics.rollbackSucceeded, "Baseline could not be restored: " .. parameter)
    assertSnapshot(nativeExposureCapture.before)
end
exposureBaseline()
onWrite = function(parameter, value)
    if parameter == "local_Temperature" and value == 0 then return false end
    if parameter == "local_Maincurve" and #value == 6 then return false end
end
result = applySingle("local_Exposure", 1)
assert(not result.ok and not result.diagnostics.rollbackSucceeded and #values.local_Maincurve == 4,
    "A failed RGB-curve restoration must remain a partial failure")
for _, parameter in ipairs({"local_Amount", "local_Defringe", "local_Maincurve"}) do
    exposureBaseline(); values[parameter] = nil
    assert(not applySingle("local_Exposure", 1).ok and #writes == 0,
        "Required reset baseline must be readable before mutation: " .. parameter)
end
-- The actual user preset previously hit the guarded Highlights/Shadows case.
singleBaseline(); source = readFixture("live-nino-test.lrtemplate")
-- The stored -0.70999997854233 is not exactly -0.71; verify its scaled value.
assert(apply().ok and close(values.local_Exposure, 2.7) and close(values.local_Highlights, -70.999997854233) and
    close(values.local_Shadows, -70.999997854233) and values.local_RefineSaturation == 0)
assert(applySingle("local_Exposure", 1).ok and values.local_Exposure == 1 and values.local_Highlights == 0 and
    values.local_Shadows == 0 and values.local_RefineSaturation == 100 and values.local_ToningHue == 240,
    "nino_test must transition to a single adjustment with its inactive Color hue preserved")
exposureBaseline(); source = readFixture("live-dodge-lighten.lrtemplate")
assert(apply().ok and values.local_Amount == 73 and values.local_RefineSaturation == 0 and
    #values.local_Maincurve == 6, "Single-choice defaults must not leak into saved-preset omissions")
for index, captured in ipairs(nativeCapture.cases) do
    singleBaseline()
    local definition = nativeDefinitions[index]
    assert(definition.name == captured.name)
    if captured.name == "Amount" then
        assert(definition.parameter == "local_Grain" and captured.values.local_Grain == 25 and
            captured.values.local_Amount == 100, "Native Amount is Grain, not mask strength")
    end
    local applied = applySingle(definition.parameter, captured.values[definition.parameter])
    assert(applied.ok, captured.name .. ": " .. tostring(applied.detail))
    for parameter, expected in pairs(captured.values) do
        assert(close(values[parameter], expected), captured.name .. " differs from captured native " .. parameter)
    end
    assert(values.local_RefineSaturation == 100)
    exposureBaseline()
    assert(applySingle(definition.parameter, captured.values[definition.parameter]).ok)
    for parameter, expected in pairs(captured.values) do
        assert(close(values[parameter], expected), captured.name .. " did not settle the scalar reset plan: " .. parameter)
    end
    assert(#values.local_Maincurve == 4 and values.local_Maincurve[3] == 255)
end
for _, parameter in ipairs({"local_Tint", "local_RefineSaturation", "local_Texture"}) do
    singleBaseline()
    local baseline = copy(values)
    local expected = parameter == "local_Tint" and 25 or parameter == "local_RefineSaturation" and 100 or 0
    onWrite = function(name, value) if name == parameter and value == expected then return false end end
    local failed = applySingle()
    assert(not failed.ok and failed.kind == "settlement_failure" and failed.diagnostics.rollbackSucceeded)
    assert(failed.diagnostics.firstMismatch.parameter == parameter and values[parameter] == baseline[parameter])
end
singleBaseline()
local nativeBefore = copy(values)
onWrite = function(parameter, value)
    if parameter == "local_Tint" and value == 25 then error("injected SDK failure") end
end
result = applySingle()
assert(not result.ok and result.kind == "lightroom_write_failure" and result.diagnostics.rollbackSucceeded)
assert(values.local_Clarity == nativeBefore.local_Clarity and values.local_RefineSaturation == nativeBefore.local_RefineSaturation)
singleBaseline()
onWrite = function(parameter, value)
    if parameter == "local_Tint" then return false end
    if parameter == "local_Clarity" and value == -15 then return false end
end
result = applySingle()
assert(not result.ok and not result.diagnostics.rollbackSucceeded, "Dropped restoration must be reported as partial failure")
singleBaseline()
onWrite = function() values.local_Maincurve = {0, 0, 128, 140, 255, 255} end
result = applySingle()
assert(not result.ok and result.diagnostics.firstMismatch.parameter == "local_Maincurve" and
    not result.diagnostics.rollbackSucceeded, "Unexpected curve changes cannot be reported as fully restored")
singleBaseline()
onWrite = function() valid = false end
result = applySingle()
assert(not result.ok and result.kind == "stale_context" and #writes == 1)
singleBaseline()
assert(not applySingle("local_Amount", 100).ok and #writes == 0)
assert(not applySingle("local_Tint", 101).ok and #writes == 0)
for _, parameter in ipairs({"local_ToningSaturation", "local_ToningLuminance"}) do
    singleBaseline(); values[parameter] = 17
    assert(not applySingle().ok and #writes == 0, "Unmeasured reset must fail before writes: " .. parameter)
end
singleBaseline(); values.local_PointColors = {copy(swatch)}
assert(not applySingle().ok and #writes == 0)
for _, parameter in ipairs({"local_Redcurve", "local_Greencurve", "local_Bluecurve"}) do
    singleBaseline(); values[parameter] = {0, 0, 128, 140, 255, 255}
    assert(not applySingle().ok and #writes == 0)
end
singleBaseline(); values.local_ToningHue = 240
assert(applySingle().ok and values.local_ToningHue == 240, "Inactive Color hue is preserved and checked, not mistaken for image change")
print("Saved and captured single-adjustment application, scaling, settlement, rollback, partial failure and context tests passed.")
