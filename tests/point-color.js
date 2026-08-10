"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const commands = require("../server/commands");
const pointState = require("../server/point-color-state");
const lua = read("lightroom/LRBridge.lrplugin/PointColor.lua");
const dispatcher = read("lightroom/LRBridge.lrplugin/Commands.lua");
const parser = read("lightroom/LRBridge.lrplugin/Parser.lua");
const feedback = read("lightroom/LRBridge.lrplugin/FeedbackPolling.lua");
const bridge = read("server/bridge.js");
const pointStateSource = read("server/point-color-state.js");
const controller = read("app/controller.html");

assert.match(lua, /getValue\("PointColors"\)/);
assert.match(lua, /getSelectedPointColorSwatchIndex\(false\)/);
assert.match(lua, /local completeSwatch = deepCopy\(colors\[selectedIndex\], \{\}\)/);
assert.match(lua, /completeSwatch\[field\] = value/);
assert.match(lua, /completeSwatch\[rangeName\]\[boundary\] = value/);
assert.match(lua, /updateSelectedPointColorSwatch\(completeSwatch, false\)/);
assert.match(lua, /togglePointColorRangeVisualization\(false\)/);
assert.match(lua, /selectTool\("point_color"\)/);
assert.doesNotMatch(lua, /addPointColorSwatch|applyDevelopSettings|LrDevelopController\.(?:setValue|increment|decrement)|HueRange\s*=\s*\{|SrcHue\s*=/);
assert.doesNotMatch(lua.match(/local function readState\(\)[\s\S]*?\nend/)[0], /validRangeAroundMarker|proposedRangeContainsMarker/);
const scalarStart = lua.indexOf("function PointColor.setValue");
assert.ok(lua.indexOf('getValue("PointColors")', scalarStart) < lua.indexOf("updateSelectedPointColorSwatch", scalarStart));
assert.match(dispatcher, /PointColor\.setValue\(command\.field, command\.value, command\.expectedSelectedIndex\)/);
assert.match(dispatcher, /PointColor\.setRange\(command\.range, command\.boundary, command\.value, command\.expectedSelectedIndex\)/);
assert.match(dispatcher, /PointColor\.translateRange/);
assert.match(parser, /expectedSelectedIndex/);
assert.match(feedback, /point-color\/next/);

assert.deepEqual(pointState.fields, ["HueShift", "SatScale", "LumScale", "Variance", "RangeAmount"]);
for (const field of pointState.fields) {
    const [min, max] = pointState.ranges[field];
    assert.equal(pointState.validValue(field, min), true); assert.equal(pointState.validValue(field, max), true);
    assert.equal(pointState.validValue(field, min - 0.01), false); assert.equal(pointState.validValue(field, max + 0.01), false);
}
for (const value of [NaN, Infinity, -Infinity, "0", null]) assert.equal(pointState.validValue("HueShift", value), false);
assert.equal(pointState.validValue("SrcHue", 0), false);
const validNested = { LowerNone: 0, LowerFull: 0.2, UpperFull: 0.54, UpperNone: 0.87 };
assert.deepEqual(pointState.sanitizeNestedRange(validNested), validNested);
assert.equal(pointState.minimumFullRangeWidth, 0.01);
assert.equal(pointState.safeFullRangeWidth({ LowerNone: 0, LowerFull: 0.5, UpperFull: 0.5, UpperNone: 1 }), false);
assert.equal(pointState.safeFullRangeWidth({ LowerNone: 0, LowerFull: 0.5, UpperFull: 0.505, UpperNone: 1 }), false);
assert.equal(pointState.safeFullRangeWidth({ LowerNone: 0, LowerFull: 0.5, UpperFull: 0.51, UpperNone: 1 }), true);
assert.equal(pointState.safeFullRangeWidth({ LowerNone: 0, LowerFull: 0.49, UpperFull: 0.52, UpperNone: 1 }), true);
const stateStore = pointState.createPointColorState();
const completeState = { available: true, swatchCount: 1, selectedIndex: 1, selectionTransient: false, HueShift: 0, SatScale: 0, LumScale: 0, Variance: 0, RangeAmount: 0.5,
    HueRange: validNested, SatRange: validNested, LumRange: validNested, HueRangeMarker: 0.5, SatRangeMarker: 0.4, LumRangeMarker: 0.4 };
assert.equal(stateStore.update(completeState), true);
assert.deepEqual(Object.keys(stateStore.get().HueRange), pointState.boundaries);
assert.equal(stateStore.update({ ...completeState, HueRange: { ...validNested, extra: 1 } }), false);
assert.equal(stateStore.update({ ...completeState, HueRangeMarker: 0.1 }), true);
assert.equal(stateStore.get().HueRangeMarker, validNested.LowerFull);
assert.equal(stateStore.get().selectedIndex, 1);
assert.equal(stateStore.get().HueShift, 0); assert.deepEqual(stateStore.get().HueRange, validNested);
assert.equal(stateStore.update({ available: true, swatchCount: 0, selectedIndex: 0, selectionTransient: false }), true);
assert.deepEqual(stateStore.get(), { available: true, swatchCount: 0, selectedIndex: 0, selectionTransient: false });
assert.equal(stateStore.update(completeState), true);
assert.equal(stateStore.update({ available: true, swatchCount: 1, selectedIndex: 0, selectionTransient: true }), true);
assert.equal(stateStore.get().selectionTransient, true); assert.equal(stateStore.get().selectedIndex, 0); assert.equal(stateStore.get().displaySelectedIndex, 1);
assert.equal(stateStore.get().HueShift, 0); assert.deepEqual(stateStore.get().LumRange, validNested);
stateStore.syncContext(1); stateStore.syncContext(2);
assert.deepEqual(stateStore.get(), { available: false, swatchCount: 0, selectedIndex: 0, selectionTransient: false });
assert.equal(stateStore.update({ available: true, swatchCount: 1, selectedIndex: 0, selectionTransient: true }), true);
assert.equal(stateStore.get().displaySelectedIndex, undefined);
assert.equal(stateStore.update(completeState), true);
assert.equal(stateStore.update({ available: true, swatchCount: 0, selectedIndex: 0, selectionTransient: false }), true);
assert.equal(stateStore.update({ available: true, swatchCount: 1, selectedIndex: 0, selectionTransient: true }), true);
assert.equal(stateStore.get().displaySelectedIndex, undefined);
assert.equal(stateStore.update({ ...completeState, HueRange: { LowerNone: 0.3, LowerFull: 0.2, UpperFull: 0.54, UpperNone: 0.87 } }), false);
assert.equal(pointState.getPointColorRangeMarker("HueRange", { SrcHue: 5.2 }), 0.5);
assert.equal(pointState.getPointColorRangeMarker("SatRange", { SrcSat: 0.453009 }), 0.453009);
assert.ok(Math.abs(pointState.getPointColorRangeMarker("LumRange", { SrcLum: 0.048692 }) - 0.2446) < 0.002);
assert.ok(Math.abs(pointState.getPointColorRangeMarker("LumRange", { SrcLum: 0.331798 }) - 0.6111) < 0.002);
for (const malformed of [[], null, { LowerNone: 0, LowerFull: 0.2, UpperFull: 0.54 },
    { ...validNested, extra: 1 }, { ...validNested, LowerNone: -0.1 }, { ...validNested, UpperNone: 1.1 },
    { ...validNested, LowerFull: Infinity }, { ...validNested, LowerFull: "0.2" },
    { LowerNone: 0.3, LowerFull: 0.2, UpperFull: 0.54, UpperNone: 0.87 }]) assert.equal(pointState.sanitizeNestedRange(malformed), null);
for (const range of pointState.rangeNames) for (const boundary of pointState.boundaries) {
    assert.equal(commands.validateCommand({ command: "point_color.range.set", range, boundary, value: 0.5 }), true);
}
for (const command of [
    { command: "point_color.range.set", range: "Bad", boundary: "LowerFull", value: 0.5 },
    { command: "point_color.range.set", range: "HueRange", boundary: "Bad", value: 0.5 },
    { command: "point_color.range.set", range: "HueRange", boundary: "LowerFull", value: Infinity },
    { command: "point_color.range.set", range: "HueRange", boundary: "LowerFull", value: 1.1 },
    { command: "point_color.range.set", range: "HueRange", boundary: "LowerFull", value: 0.5, extra: true }
]) assert.equal(commands.validateCommand(command), false);
assert.equal(commands.validateCommand({ command: "point_color.value.set", field: "HueShift", value: 0.25 }), true);
assert.equal(commands.validateCommand({ command: "point_color.value.set", field: "HueShift", value: 0, extra: true }), false);
assert.equal(commands.validateCommand({ command: "point_color.range_visualization.toggle" }), true);
assert.equal(commands.validateCommand({ command: "point_color.tool.select" }), true);
assert.equal(commands.validateCommand({ command: "point_color.tool.select", extra: true }), false);
const translated = { command: "point_color.range.translate", range: "HueRange", LowerNone: 0.04, LowerFull: 0.46, UpperFull: 0.62, UpperNone: 1 };
commands.resetQueueForTests();
commands.setPointColorAdmissionContextProvider(function () { return { selectedIndex: 0, contextCounter: 4 }; });
assert.equal(commands.tryEnqueueCommand({ command: "point_color.value.set", field: "HueShift", value: 0.2 }).accepted, false);
assert.equal(commands.tryEnqueueCommand({ command: "point_color.range.set", range: "HueRange", boundary: "LowerFull", value: 0.4 }).accepted, false);
assert.equal(commands.tryEnqueueCommand(translated).accepted, false);
assert.equal(commands.getStatus().queueLength, 0);
assert.equal(commands.validateCommand(translated), true);
assert.equal(commands.validateCommand({ ...translated, LowerFull: 0.5, UpperFull: 0.5 }), false);
assert.equal(commands.validateCommand({ ...translated, LowerFull: 0.5, UpperFull: 0.505 }), false);
assert.equal(commands.validateCommand({ ...translated, LowerFull: 0.5, UpperFull: 0.51 }), true);
assert.equal(commands.validateCommand({ ...translated, LowerFull: 0.7 }), false);
assert.equal(commands.validateCommand({ ...translated, extra: true }), false);

commands.resetQueueForTests();
commands.enqueueCommand({ command: "point_color.value.set", field: "HueShift", value: 0.1, expectedSelectedIndex: 1, expectedContextCounter: 0 });
commands.enqueueCommand({ command: "point_color.value.set", field: "HueShift", value: 0.2, expectedSelectedIndex: 1, expectedContextCounter: 0 });
commands.enqueueCommand({ command: "point_color.value.set", field: "SatScale", value: 0.3, expectedSelectedIndex: 1, expectedContextCounter: 0 });
assert.equal(commands.getStatus().queueLength, 2);
assert.equal(commands.getNextCommand().value, 0.2);
assert.equal(commands.getNextCommand().field, "SatScale");
commands.resetQueueForTests();
commands.enqueueCommand({ command: "point_color.range.set", range: "HueRange", boundary: "LowerFull", value: 0.2, expectedSelectedIndex: 1, expectedContextCounter: 0 });
commands.enqueueCommand({ command: "point_color.range.set", range: "HueRange", boundary: "LowerFull", value: 0.3, expectedSelectedIndex: 1, expectedContextCounter: 0 });
commands.enqueueCommand({ command: "point_color.range.set", range: "HueRange", boundary: "UpperFull", value: 0.6, expectedSelectedIndex: 1, expectedContextCounter: 0 });
commands.enqueueCommand({ command: "point_color.range.set", range: "SatRange", boundary: "LowerFull", value: 0.1, expectedSelectedIndex: 1, expectedContextCounter: 0 });
assert.equal(commands.getStatus().queueLength, 3);
assert.equal(commands.getNextCommand().value, 0.3); assert.equal(commands.getNextCommand().boundary, "UpperFull"); assert.equal(commands.getNextCommand().range, "SatRange");
commands.resetQueueForTests();
commands.enqueueCommand({ command: "point_color.value.set", field: "RangeAmount", value: 0.5, expectedSelectedIndex: 1, expectedContextCounter: 0 });
commands.enqueueCommand({ command: "point_color.range.set", range: "LumRange", boundary: "UpperNone", value: 0.9, expectedSelectedIndex: 1, expectedContextCounter: 0 });
assert.equal(commands.getNextCommand().command, "point_color.value.set"); assert.equal(commands.getNextCommand().command, "point_color.range.set");
commands.resetQueueForTests();
commands.enqueueCommand({ ...translated, expectedSelectedIndex: 1, expectedContextCounter: 0 });
commands.enqueueCommand({ ...translated, LowerNone: 0.05, LowerFull: 0.47, expectedSelectedIndex: 1, expectedContextCounter: 0 });
assert.equal(commands.getStatus().queueLength, 1); assert.equal(commands.getNextCommand().LowerFull, 0.47);

assert.match(bridge, /app\.get\("\/point-color\/state"/);
assert.match(bridge, /app\.get\("\/point-color\/value"/);
assert.match(bridge, /app\.get\("\/point-color\/range"/);
assert.match(bridge, /app\.get\("\/point-color\/range\/translate"/);
assert.match(bridge, /app\.get\("\/point-color\/tool\/select"/);
assert.match(bridge, /app\.get\("\/point-color\/range-visualization\/toggle"/);
assert.match(controller, /\["hsl", "color", "point-color"\]/);
assert.match(controller, /Create or select a Point Color sample in Lightroom\./);
assert.match(lua, /swatchCount = swatchCount \+ 1/);
assert.match(controller, /pointColorState\.swatchCount === 0/);
assert.match(controller, /Point Color sample selection in progress/);
assert.match(controller, /Selecting Point Color sample/);
assert.match(controller, /pointColorWritesAllowed/);
assert.match(controller, /pointColorState\.selectionTransient !== true/);
assert.match(controller, /Toggle Visualize Range/);
assert.match(controller, /Select Color Picker/);
assert.match(controller, /\/api\/point-color\/tool\/select/);
assert.ok(controller.indexOf('picker.id = "pointColorPickerSelect"') < controller.indexOf("if (!pointColorState.available)"));
const pointColorRenderStart = controller.indexOf("function renderPointColorView(host) {");
const pointColorRenderEnd = controller.indexOf('let colorMixerView = "hsl";', pointColorRenderStart);
assert.notEqual(pointColorRenderStart, -1);
assert.notEqual(pointColorRenderEnd, -1);
const pointColorRender = controller.slice(pointColorRenderStart, pointColorRenderEnd);
assert.match(pointColorRender,
    /leadingControls\.className = "develop-section-leading-controls";[\s\S]*leadingControls\.appendChild\(picker\); host\.appendChild\(leadingControls\)/,
    "Point Color picker must reuse the shared leading-controls spacing convention");
assert.ok(pointColorRender.indexOf("host.appendChild(leadingControls)") < pointColorRender.indexOf("pointColorDefinitions.forEach"),
    "Hue Shift and the remaining scalar controls must follow the Point Color leading controls");
assert.equal((pointColorRender.match(/leadingControls\.appendChild\(picker\)/g) || []).length, 1,
    "Select Color Picker must remain the sole Point Color leading control");
assert.doesNotMatch(lua + controller, /SendKeys|mouse_event|keybd_event/);
assert.doesNotMatch(controller, /Lightroom does not expose the current Visualize Range state\./);
assert.doesNotMatch(controller, /browser eyedropper|Delete Sample|Delete All|sample selector|color field/i);
const definitionsText = controller.match(/const pointColorDefinitions = Object\.freeze\(\[[\s\S]*?\]\);/)[0];
assert.equal((definitionsText.match(/field:/g) || []).length, 5);
const sdkToUi = vm.runInNewContext("(" + controller.match(/function pointColorSdkToUi\(value\) \{[^}]+\}/)[0] + ")");
const uiToSdk = vm.runInNewContext("(" + controller.match(/function pointColorUiToSdk\(value\) \{[^}]+\}/)[0] + ")");
assert.deepEqual([-1, -0.5, 0, 0.5, 1].map(sdkToUi), [-100, -50, 0, 50, 100]);
assert.deepEqual([-100, -50, 0, 50, 100].map(uiToSdk), [-1, -0.5, 0, 0.5, 1]);
assert.deepEqual([0, 0.5, 1].map(sdkToUi), [0, 50, 100]);
assert.equal(sdkToUi(0.54), 54); assert.equal(uiToSdk(87), 0.87);
const limitsSource = controller.match(/function pointColorMarkerIntegerLimits\(markerSdkExact\) \{[\s\S]*?\n        \}/)[0];
const markerLimits = vm.runInNewContext("(function () { const pointColorMarkerEpsilon = 1e-8; return " + limitsSource + "; })() ");
assert.equal(JSON.stringify(markerLimits(0.4236)), JSON.stringify({ markerUiExact: 42.36, lowerFullMaxUi: 42, upperFullMinUi: 43 }));
assert.equal(JSON.stringify(markerLimits(0.42)), JSON.stringify({ markerUiExact: 42, lowerFullMaxUi: 42, upperFullMinUi: 42 }));
assert.match(controller, /markerElement\.style\.left = markerUiExact \+ "%"/);
assert.match(controller, /pointColorMinimumFullRangeUi = 1/);
assert.match(controller, /values\.UpperFull - pointColorMinimumFullRangeUi/);
assert.match(controller, /values\.LowerFull \+ pointColorMinimumFullRangeUi/);
assert.match(controller, /createPointColorRangeControl/);
assert.equal((controller.match(/className = "point-color-range-marker"/g) || []).length, 1);
assert.match(controller, /getPointColorRangeMarker/);
assert.match(controller, /markerUiExact - start\.UpperFull/);
assert.match(controller, /markerUiExact - start\.LowerFull/);
assert.match(controller, /enqueuePointColorRangeTranslation/);
assert.match(controller, /point-color\/range\/translate/);
assert.doesNotMatch(controller, /enqueuePointColorRangeWrite\(rangeName, "LowerNone"[\s\S]{0,500}enqueuePointColorRangeWrite\(rangeName, "UpperNone"/);
assert.equal((controller.match(/name: "(?:HueRange|SatRange|LumRange)"/g) || []).length, 3);
assert.match(controller, /pointColorRangeBoundaries = Object\.freeze\(\["LowerNone", "LowerFull", "UpperFull", "UpperNone"\]\)/);
assert.match(controller, /handle\.addEventListener\("pointerdown"/); assert.match(controller, /handle\.addEventListener\("pointermove"/); assert.match(controller, /handle\.addEventListener\("keydown"/);
assert.match(controller, /handle\.addEventListener\("pointercancel", function \(event\) \{ finish\(event, true\); \}\)/);
assert.match(controller, /handle\.addEventListener\("lostpointercapture", function \(event\) \{ finish\(event, true\); \}\)/);
assert.match(controller, /boundary === "LowerNone"[\s\S]*boundary === "LowerFull"[\s\S]*boundary === "UpperFull"/);
assert.doesNotMatch(controller, /point-color-detail-range[\s\S]{0,500}Reset/);
assert.match(controller, /pointColorWriteInFlight/);
assert.match(controller, /edit\.selectedIndex !== pointColorState\.selectedIndex/);
assert.ok(lua.indexOf("safeFullRangeWidth(completeSwatch[rangeName])") < lua.indexOf("updateSelectedPointColorSwatch(completeSwatch, false)", lua.indexOf("function PointColor.setRange")));
assert.ok(lua.indexOf("safeFullRangeWidth(translated)") < lua.indexOf("updateSelectedPointColorSwatch(completeSwatch, false)", lua.indexOf("function PointColor.translateRange")));
assert.doesNotMatch(lua + bridge, /point-color-threshold-probe|postThresholdResult/);
assert.doesNotMatch(lua + bridge + pointStateSource + controller, /rangeVisualization/,
    "Visualize Range must remain momentary when Lightroom exposes no authoritative readable state");
assert.doesNotMatch(lua + bridge, /point-color-visualization-return-probe/,
    "Temporary Visualize Range return diagnostics must not remain in production");
assert.match(controller, /if \(control\.dirty && ui !== control\.committed\) return/);
assert.match(controller, /225/);
console.log("Point Color production contracts passed.");
