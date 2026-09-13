"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const presets = require("../server/local-adjustment-presets");

const fixtureDirectory = path.join(__dirname, "fixtures", "masking-local-presets");
function fixture(name) {
    return fs.readFileSync(path.join(fixtureDirectory, name), "utf8");
}

const localized = presets.parseLocalAdjustmentPreset(fixture("localized-scalars.lrtemplate"));
assert.equal(localized.type, "LocalizedAdjustmentPreset");
assert.equal(localized.title, "$$$/AgCameraRaw/Localized/Fixture=Localized Scalar Fixture");
assert.equal(localized.value.exposure2012, 0.25);
assert.equal(localized.value.toningLuminance, 0);

const tables = presets.parseLocalAdjustmentPreset(fixture("tables-and-unsupported.lrtemplate"));
assert.deepEqual(tables.value.maincurve, ["0,0", "64,52", "128,128", "255,255"]);
assert.equal(tables.value.pointColors.length, 1);
assert.equal(tables.value.pointColors[0].HueShift, 0.2);
assert.equal(tables.value.pointColors[0].HueRange.LowerFull, 0.3);
assert.equal(tables.value.futureAdjustment.payload, "ignored");

const absent = presets.parseLocalAdjustmentPreset(fixture("absent-fields.lrtemplate"));
assert.deepEqual(Object.keys(absent.value), ["saturation"]);
assert.throws(function () { presets.parseLocalAdjustmentPreset(fixture("unsafe.lrtemplate")); },
    /Invalid preset value|separator|syntax/);

const liveBurnShape = presets.parseLocalAdjustmentPreset(fixture("live-burn-darken.lrtemplate"));
assert.equal(liveBurnShape.value.toningHue, 240,
    "the real Burn preset hue is already expressed in Lightroom degrees");
assert.equal(liveBurnShape.value.toningLuminance, 0,
    "the installed legacy zero must remain parseable and require SDK equality verification");
const authoritativeSelectedMaskPointColors = tables.value.pointColors;
assert.equal(Object.prototype.hasOwnProperty.call(liveBurnShape.value, "pointColors"), false,
    "Burn omits Point Color and therefore must not modify the selected mask collection");
assert.equal(authoritativeSelectedMaskPointColors.length, 1,
    "the authoritative live regression begins with one selected mask Point Color sample");

const preBurnState = {
    local_Amount: 73,
    local_PointColors: authoritativeSelectedMaskPointColors,
    selectedPointColorIndex: 1,
    local_Maincurve: [0, 0, 64, 38, 192, 214, 255, 255],
    local_Redcurve: [0, 0, 96, 83, 255, 255],
    local_Greencurve: [0, 0, 128, 141, 255, 255],
    local_Bluecurve: [0, 0, 160, 149, 255, 255],
    local_RefineSaturation: 47,
    local_Blacks: -21,
    local_Dehaze: 32,
    local_Defringe: 16,
    local_Grain: 28,
    local_Hue: -18,
    local_Texture: 24,
    local_Whites: 13
};
const burnStoredCorrections = {
    local_Clarity: liveBurnShape.value.clarity2012 * 100,
    local_Contrast: liveBurnShape.value.contrast2012 * 100,
    local_Exposure: liveBurnShape.value.exposure2012 * 4,
    local_Highlights: liveBurnShape.value.highlights2012 * 100,
    local_LuminanceNoise: liveBurnShape.value.luminanceNoise * 100,
    local_Moire: liveBurnShape.value.moire * 100,
    local_Saturation: liveBurnShape.value.saturation * 100,
    local_Shadows: liveBurnShape.value.shadows2012 * 100,
    local_Sharpness: liveBurnShape.value.sharpness * 100,
    local_Temperature: liveBurnShape.value.temperature * 100,
    local_Tint: liveBurnShape.value.tint * 100,
    local_ToningHue: liveBurnShape.value.toningHue,
    local_ToningSaturation: liveBurnShape.value.toningSaturation * 100
};
const modeledBurnResult = Object.assign({}, preBurnState, burnStoredCorrections,
    { local_Texture: 0, local_RefineSaturation: 0 });
for (const field of ["local_Amount", "local_PointColors", "selectedPointColorIndex", "local_Maincurve", "local_Redcurve",
    "local_Greencurve", "local_Bluecurve", "local_Blacks", "local_Dehaze",
    "local_Defringe", "local_Grain", "local_Hue", "local_Whites"]) {
    assert.deepEqual(modeledBurnResult[field], preBurnState[field],
        "Burn must preserve omitted correction " + field);
}
assert.equal(modeledBurnResult.local_Exposure, -0.300000011920928,
    "Burn's actual stored Exposure correction must still be applied");
assert.equal(modeledBurnResult.local_ToningHue, 240,
    "Burn's explicitly stored Toning Hue correction must still be applied");

const inventory = presets.createInventory({ directory: fixtureDirectory });
const entries = inventory.list();
assert.equal(entries.some(function (entry) { return entry.file === "unsafe.lrtemplate"; }), false);
const localizedEntry = entries.find(function (entry) { return entry.file === "localized-scalars.lrtemplate"; });
assert.ok(localizedEntry);
assert.equal(localizedEntry.name, "Localized Scalar Fixture");
assert.equal(inventory.resolveWithStatus(localizedEntry.id).status, "ok");
assert.equal(entries.some(function (entry) { return entry.file === "unsupported-only.lrtemplate"; }), false);
assert.equal(inventory.resolveWithStatus(presets.presetId("unsupported-only.lrtemplate")).status,
    "unsupported_preset");
assert.equal(inventory.resolveWithStatus(presets.presetId("tables-and-unsupported.lrtemplate")).status,
    "unsupported_preset", "one unsupported field must reject the whole preset");
assert.ok(entries.some(entry => entry.file === "tables-supported.lrtemplate"));
assert.ok(entries.some(entry => entry.file === "live-nino-test.lrtemplate"));
const failedLivePreset = presets.parseLocalAdjustmentPreset(fixture("live-exp-one.lrtemplate"));
assert.equal(failedLivePreset.value.refineSaturation, 100);
assert.equal(failedLivePreset.value.refineSaturation * presets.SCALAR_PRESET_MAPPINGS.refineSaturation.scale, 100,
    "the failed saved Refine value is already in SDK units");
assert.ok(entries.some(entry => entry.file === "live-exp-one.lrtemplate"),
    "the newly saved compatible preset remains selectable");
assert.throws(() => presets.parseLocalAdjustmentPreset(
    's = { type = "LocalizedAdjustmentPreset", value = { saturation = 0.1, saturation = 0.2 } }'), /Duplicate/);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "lrbridge-local-presets-"));
try {
    const filename = "Mutable.lrtemplate";
    fs.copyFileSync(path.join(fixtureDirectory, "localized-scalars.lrtemplate"), path.join(temporaryDirectory, filename));
    const mutableInventory = presets.createInventory({ directory: temporaryDirectory });
    const listed = mutableInventory.list()[0];
    assert.equal(mutableInventory.resolveWithStatus(listed.id).status, "ok");
    for (const value of [
        "saturation = 0.1, futureAdjustment = 0",
        "saturation = 0.1, toningLuminance = 0.1",
        "saturation = 0.1, exposure = 0.2",
        "saturation = 0.1, __proto__ = { futureAdjustment = 1 }"
    ]) {
        fs.writeFileSync(path.join(temporaryDirectory, filename),
            's = { type = "LocalizedAdjustmentPreset", value = { ' + value + ' } }');
        assert.equal(mutableInventory.resolveWithStatus(listed.id).status, "unsupported_preset");
        assert.equal(mutableInventory.menu().length, 0);
    }
    fs.writeFileSync(path.join(temporaryDirectory, filename), fixture("tables-supported.lrtemplate")
        .replace("HueShift = 0.2,", "HueShift = 0.2, FutureShift = 0.1,"));
    assert.equal(mutableInventory.resolveWithStatus(listed.id).status, "unsupported_preset",
        "Point Color extensions cannot be silently discarded by sanitization");
    fs.writeFileSync(path.join(temporaryDirectory, filename), fixture("unsafe.lrtemplate"), "utf8");
    assert.equal(mutableInventory.resolveWithStatus(listed.id).status, "parse_failure");
    for (const refine of [-1, 100.01, 10000]) {
        fs.writeFileSync(path.join(temporaryDirectory, filename), fixture("live-exp-one.lrtemplate")
            .replace("refineSaturation = 100", "refineSaturation = " + refine));
        assert.equal(mutableInventory.resolveWithStatus(listed.id).status, "unsupported_preset");
        assert.equal(mutableInventory.menu().length, 0, "file-invalid Refine values must not enter the picker");
    }
    fs.writeFileSync(path.join(temporaryDirectory, filename), fixture("live-exp-one.lrtemplate"));
    assert.equal(mutableInventory.resolveWithStatus(listed.id).status, "ok");
    assert.equal(mutableInventory.menu().length, 1, "compatible edits must reappear without a blacklist");
} finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

const nativeValues = Object.create(null);
presets.NATIVE_CORRECTION_PRESETS.forEach(function (entry) {
    if (entry.preference) nativeValues[entry.preference] = 0.25;
});
const nativeMenuDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "lrbridge-native-local-presets-"));
try {
    ["Burn (Darken)", "Dodge (Lighten)", "Iris Enhance", "Soften Skin (Lite)", "Soften Skin", "Teeth Whitening"]
        .forEach(function (name, index) {
            fs.writeFileSync(path.join(nativeMenuDirectory, "fixture-" + index + ".lrtemplate"),
                "s = { internalName = \"" + name + "\", type = \"LocalizedAdjustmentPreset\", " +
                "value = { saturation = " + (index + 1) / 100 + ", }, }", "utf8");
        });
    const nativeInventory = presets.createInventory({ directory: nativeMenuDirectory, nativeValues: nativeValues });
    assert.deepEqual(nativeInventory.menu().filter(entry => entry.kind === "file").map(function (entry) { return entry.name; }), [
        "Burn (Darken)", "Dodge (Lighten)", "Iris Enhance", "Soften Skin (Lite)",
        "Soften Skin", "Teeth Whitening"
    ], "single adjustments must not displace the installed and saved files");
    assert.ok(nativeInventory.menu().every(entry => entry.kind === "file"));
    for (const definition of presets.NATIVE_CORRECTION_PRESETS) {
        assert.equal(nativeInventory.resolveWithStatus(definition.id).status, "unsupported_preset");
        assert.equal(nativeInventory.resolve(definition.id), null);
        assert.equal(presets.validBuiltinPreset(definition.id, definition.parameter, 25), false);
    }
    fs.writeFileSync(path.join(nativeMenuDirectory, "Arbitrary User Name.lrtemplate"),
        's = { title = "Arbitrary User Name", type = "LocalizedAdjustmentPreset", value = { texture = 0.2 } }');
    assert.ok(nativeInventory.menu().some(entry => entry.name === "Arbitrary User Name"),
        "new compatible files must appear dynamically without a name whitelist");
    assert.equal(nativeInventory.menu().some(function (entry) {
        return entry.name === "Save Current Settings as New Preset…" || entry.name === "Restore Default Presets";
    }), false, "commands without a public Lightroom SDK execution path must not enter the Web Controller inventory");
} finally {
    fs.rmSync(nativeMenuDirectory, { recursive: true, force: true });
}

const parsedPreferences = presets.parseApplicationPreferences([
    "prefs = {", "  AgDevelop_localizedExposure2012Last = 0.25,",
    "  AgDevelop_localizedClarity2012Last = -0.5,", "}"
].join("\n"));
assert.equal(parsedPreferences.AgDevelop_localizedExposure2012Last, 0.25);
assert.equal(parsedPreferences.AgDevelop_localizedClarity2012Last, -0.5);
const nativeInventory = presets.createInventory({ directory: null, nativeValues: nativeValues });
assert.equal(typeof nativeInventory.reconcile, "undefined",
    "preset inventory must not expose correction-value identity reconciliation");

const lua = fs.readFileSync(path.join(__dirname, "..", "lightroom", "LRBridge.lrplugin", "MaskPresets.lua"), "utf8");
assert.doesNotMatch(lua, /loadstring|load\s*\(|dofile|io\.popen|os\.execute/);
assert.doesNotMatch(lua, /key = "toningLuminance", parameter = "local_ToningLuminance"/,
    "legacy Color luminance must not acquire a preset write mapping");
const mappedFields = Array.from(lua.matchAll(/\{ key = "([^"]+)", parameter = "([^"]+)"/g), function (match) {
    return { key: match[1], parameter: match[2] };
});
assert.deepEqual(mappedFields.filter(function (mapping) {
    return !Object.prototype.hasOwnProperty.call(liveBurnShape.value, mapping.key);
}).map(function (mapping) { return mapping.parameter; }), [
    "local_Amount", "local_Blacks", "local_Bluecurve", "local_Defringe", "local_Dehaze", "local_Grain",
    "local_Greencurve", "local_Hue", "local_Maincurve", "local_PointColors", "local_Redcurve",
    "local_RefineSaturation", "local_Texture", "local_Whites"
], "the omission audit must cover every scalar, Point Color, curve, and Refine family absent from real Burn");
assert.match(lua, /key\s*=\s*"toningHue"[^\r\n]*parameter\s*=\s*"local_ToningHue"[^\r\n]*scale\s*=\s*1/,
    "the exact live toningHue=240 shape must not be multiplied by the generic scalar scale");
assert.match(lua, /PointColor\.copyCollection/);
assert.match(lua,
    /entry\.kind == "pointColors"[\s\S]*PointColor\.replaceContextCollection\([\s\S]*true\)/,
    "preset Point Color replacement must use Lightroom's dedicated masking API path");
assert.match(lua, /"absent\/preserved\/"/);
assert.match(lua,
    /comparisonsFor\(readable\)[\s\S]*expected = copyDiagnosticValue\(entry\.expected\)[\s\S]*authoritative = copyDiagnosticValue\(current\)/,
    "settlement must retain a complete expected/authoritative comparison for every applied field");
assert.match(lua, /reason = "authoritative_omitted"/,
    "a present field omitted from Lightroom readback must remain a named settlement mismatch");
assert.match(lua,
    /comparison\.kind == "pointColors"[\s\S]*expectedCount[\s\S]*comparison\.parameter \.\. " expected "[\s\S]*" swatches but Lightroom returned "/,
    "Point Color settlement failure must name exact expected and returned collection counts");
assert.match(lua, /source=" \.\. \(comparison\.sourcePresent == true and "present" or "absent"\)/);
assert.match(lua, /for _, entry in ipairs\(applied\)[\s\S]*attempted\[#attempted \+ 1\] = entry[\s\S]*writeEntry\(entry, entry\.writeValue\)/,
    "only explicit supported fields may enter the preset write loop");
assert.match(lua, /for _, entry in ipairs\(attempted\)[\s\S]*writeEntry\(entry, entry\.baseline, entry\.baselineSelectedIndex\)/,
    "rollback must restore only fields actually attempted by the preset operation");
const fileApplyBlock = lua.slice(lua.indexOf("function MaskPresets.apply(filename"),
    lua.indexOf("function MaskPresets.applyBuiltin"));
assert.doesNotMatch(fileApplyBlock, /entry\.reset|resetToDefault\(entry\.parameter\)/,
    "omitted scalar, curve, Refine Saturation, and Point Color fields must never synthesize resets");
assert.doesNotMatch(lua, /LrDevelopController\.resetToDefault\(/,
    "preset settlement must use independently expected values, not accept whatever reset returned");
assert.match(lua, /refineSaturation = 100\b/,
    "the archived single-choice fixture retains Refine 100 after correcting the shared field units");
assert.match(lua, /ToneCurve\.normalizeCurveValue/);
assert.match(lua, /unsupported_preset/);
assert.match(lua, /lightroom_write_failure/);
assert.match(lua, /settlement_failure/);

const pointColorLua = fs.readFileSync(path.join(__dirname, "..", "lightroom", "LRBridge.lrplugin",
    "PointColor.lua"), "utf8");
assert.match(pointColorLua, /deletePointColorSwatch\(true, 1, isForMasking == true\)/,
    "explicit nonempty Point Color replacement may clear the previous collection through Adobe's API");
assert.match(pointColorLua, /addPointColorSwatch\(deepCopy\(value\[index\],[\s\S]*isForMasking == true\)/,
    "explicit preset Point Color values and rollback must use Adobe's add API");
assert.match(lua, /if #collection == 0 then[\s\S]*not a proven native clearing instruction/,
    "an unproven empty Point Color table must not synthesize a clearing operation");
assert.match(pointColorLua,
    /normalizedSourceEquivalent[\s\S]*math\.floor\(expected \* 100 \+ 0\.5\) \/ 100[\s\S]*presetEquivalentCollection/,
    "known Adobe source-coordinate precision normalization must compare semantically");
assert.match(pointColorLua,
    /for field, _ in pairs\(fields\)[\s\S]*closeNumber\(leftSwatch\[field\], rightSwatch\[field\]\)[\s\S]*for rangeName, _ in pairs\(rangeNames\)/,
    "normalization allowance must not weaken Point Color adjustment or range settlement");

console.log("Local adjustment preset parsing and safety contracts passed.");
