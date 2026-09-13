"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const commands = require("../server/commands");
const pointState = require("../server/point-color-state");
const pointController = require("../app/controller-point-color");
const lua = read("lightroom/LRBridge.lrplugin/PointColor.lua");
const dispatcher = read("lightroom/LRBridge.lrplugin/Commands.lua");
const parser = read("lightroom/LRBridge.lrplugin/Parser.lua");
const feedback = read("lightroom/LRBridge.lrplugin/FeedbackPolling.lua");
const bridge = read("server/bridge.js");
const pointStateSource = read("server/point-color-state.js");
const controller = read("app/controller.html");
const sharedController = read("app/controller-point-color.js");
const maskingController = read("app/controller-masking.js");

assert.match(lua, /isForMasking and "local_PointColors" or "PointColors"/);
assert.match(lua, /getSelectedPointColorSwatchIndex\(isForMasking == true\)/);
assert.match(lua, /return deepCopy\(colors\[selectedIndex\], \{\}\)/);
assert.match(lua, /completeSwatch\[field\] = value/);
assert.match(lua, /completeSwatch\[rangeName\]\[boundary\] = value/);
assert.match(lua, /updateSelectedPointColorSwatch\(completeSwatch, isForMasking == true\)/);
assert.match(lua, /PointColor\.updateContextValue/);
assert.match(lua, /PointColor\.updateContextRange/);
assert.match(lua, /PointColor\.translateContextRange/);
assert.match(lua, /togglePointColorRangeVisualization\(false\)/);
assert.match(lua, /selectTool\("point_color"\)/);
const interactiveLua = lua.slice(lua.indexOf("local function readState"));
assert.doesNotMatch(interactiveLua,
    /addPointColorSwatch|applyDevelopSettings|LrDevelopController\.(?:setValue|increment|decrement)|HueRange\s*=\s*\{|SrcHue\s*=/,
    "normal selected-swatch interactions must remain on the authoritative update API path");
assert.doesNotMatch(lua.match(/local function readState\(isForMasking\)[\s\S]*?\nend/)[0], /validRangeAroundMarker|proposedRangeContainsMarker/);
const scalarStart = lua.indexOf("function PointColor.setValue");
assert.ok(lua.indexOf("PointColor.updateContextValue", scalarStart) >= scalarStart);
assert.match(dispatcher, /PointColor\.setValue\(command\.field, command\.value, command\.expectedSelectedIndex\)/);
assert.match(dispatcher, /PointColor\.setRange\(command\.range, command\.boundary, command\.value, command\.expectedSelectedIndex\)/);
assert.match(dispatcher, /PointColor\.translateRange/);
assert.match(parser, /expectedSelectedIndex/);
assert.match(feedback, /point-color\/next/);

assert.deepEqual(pointState.fields, ["HueShift", "SatScale", "LumScale", "Variance", "RangeAmount"]);
assert.deepEqual(pointController.DEFINITIONS.map(function (definition) { return definition.field; }), pointState.fields);
assert.deepEqual(pointController.RANGE_DEFINITIONS.map(function (definition) { return definition.name; }), pointState.rangeNames);
assert.deepEqual(pointController.RANGE_BOUNDARIES, pointState.boundaries);
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
assert.deepEqual(pointState.sanitizePointColorSnapshot(completeState), completeState);
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
assert.match(controller, /LRBridgePointColor\.createController/);
assert.match(maskingController, /pointColorModule\.createController/);
assert.match(maskingController, /routePrefix:\s*"\/api\/masking\/point-color"/);
assert.match(sharedController, /Select Color Picker/);
assert.match(sharedController, /develop-slider-row point-color-slider-row/);
assert.match(sharedController, /point-color-range-layout/);
assert.match(controller, /\["hsl", "color", "point-color"\]/);
assert.match(sharedController, /Create or select a Point Color sample in Lightroom\./);
assert.match(sharedController, /state\.swatchCount === 0/);
assert.match(sharedController, /Point Color sample selection in progress/);
assert.match(sharedController, /Selecting Point Color sample/);
assert.match(sharedController, /function writesAllowed\(\)/);
assert.match(sharedController, /state\.selectionTransient !== true/);
assert.match(sharedController, /Toggle Visualize Range/);
assert.match(sharedController, /Select Color Picker/);
assert.match(sharedController, /\/range-visualization\/toggle/);
assert.match(controller, /ensurePointColorController\(\)\.mount\(host\)/);
assert.doesNotMatch(controller, /pointColorState|pointColorDefinitions|createPointColorRangeControl/,
    "the global Controller must not retain an independent legacy Point Color engine");
const pointColorRenderStart = sharedController.indexOf("function render() {");
const pointColorRenderEnd = sharedController.indexOf("function isBusy()", pointColorRenderStart);
assert.notEqual(pointColorRenderStart, -1);
assert.notEqual(pointColorRenderEnd, -1);
const pointColorRender = sharedController.slice(pointColorRenderStart, pointColorRenderEnd);
assert.match(pointColorRender,
    /leadingControls\.className = "develop-section-leading-controls";[\s\S]*leadingControls\.appendChild\(picker\); host\.appendChild\(leadingControls\)/,
    "Point Color picker must reuse the shared leading-controls spacing convention");
assert.ok(pointColorRender.indexOf("host.appendChild(leadingControls)") < pointColorRender.indexOf("DEFINITIONS.forEach"),
    "Hue Shift and the remaining scalar controls must follow the Point Color leading controls");
assert.equal((pointColorRender.match(/leadingControls\.appendChild\(picker\)/g) || []).length, 1,
    "Select Color Picker must remain the sole Point Color leading control");
assert.doesNotMatch(lua + controller + sharedController, /SendKeys|mouse_event|keybd_event/);
assert.doesNotMatch(controller + sharedController, /Lightroom does not expose the current Visualize Range state\./);
assert.doesNotMatch(controller + sharedController, /browser eyedropper|Delete Sample|Delete All|sample selector|color field/i);
assert.deepEqual(pointController.DEFINITIONS.map(function (definition) { return definition.field; }),
    ["HueShift", "SatScale", "LumScale", "Variance", "RangeAmount"]);
assert.deepEqual([-1, -0.5, 0, 0.5, 1].map(pointController.sdkToUi), [-100, -50, 0, 50, 100]);
assert.deepEqual([-100, -50, 0, 50, 100].map(pointController.uiToSdk), [-1, -0.5, 0, 0.5, 1]);
assert.deepEqual([0, 0.5, 1].map(pointController.sdkToUi), [0, 50, 100]);
assert.equal(pointController.sdkToUi(0.54), 54);
assert.equal(pointController.uiToSdk(87), 0.87);
assert.deepEqual(pointController.markerIntegerLimits(0.4236),
    { markerUiExact: 42.36, lowerFullMaxUi: 42, upperFullMinUi: 43 });
assert.deepEqual(pointController.markerIntegerLimits(0.42),
    { markerUiExact: 42, lowerFullMaxUi: 42, upperFullMinUi: 42 });
assert.match(sharedController, /markerElement\.style\.left = markerUiExact \+ "%"/);
assert.equal(pointController.MINIMUM_FULL_RANGE_UI, 1);
assert.match(sharedController, /values\.UpperFull - MINIMUM_FULL_RANGE_UI/);
assert.match(sharedController, /values\.LowerFull \+ MINIMUM_FULL_RANGE_UI/);
assert.match(sharedController, /function createRangeControl/);
assert.equal((sharedController.match(/className = "point-color-range-marker"/g) || []).length, 1);
assert.match(sharedController, /getRangeMarker/);
assert.match(sharedController, /markerUiExact - start\.UpperFull/);
assert.match(sharedController, /markerUiExact - start\.LowerFull/);
assert.match(sharedController, /type: "range-translate"/);
assert.match(sharedController, /\/range\/translate/);
assert.equal(pointController.RANGE_DEFINITIONS.length, 3);
assert.deepEqual(pointController.RANGE_BOUNDARIES, ["LowerNone", "LowerFull", "UpperFull", "UpperNone"]);
assert.match(sharedController, /handle\.addEventListener\("pointerdown"/);
assert.match(sharedController, /handle\.addEventListener\("pointermove"/);
assert.match(sharedController, /handle\.addEventListener\("keydown"/);
assert.match(sharedController, /handle\.addEventListener\("pointercancel", function \(event\) \{ finish\(event, true\); \}\)/);
assert.match(sharedController, /handle\.addEventListener\("lostpointercapture", function \(event\) \{ finish\(event, true\); \}\)/);
assert.doesNotMatch(sharedController, /point-color-detail-range[\s\S]{0,500}Reset/);
assert.match(sharedController, /let writeInFlight = null/);
assert.match(sharedController, /edit\.selectedIndex !== state\.selectedIndex/);
assert.ok(lua.indexOf("safeFullRangeWidth(completeSwatch[rangeName])") < lua.indexOf("return updateSwatch(completeSwatch, isForMasking)", lua.indexOf("function PointColor.updateContextRange")));
assert.ok(lua.indexOf("safeFullRangeWidth(translated)") < lua.indexOf("return updateSwatch(completeSwatch, isForMasking)", lua.indexOf("function PointColor.translateContextRange")));
assert.doesNotMatch(lua + bridge, /point-color-threshold-probe|postThresholdResult/);
assert.doesNotMatch(lua + bridge + pointStateSource + sharedController, /rangeVisualization/,
    "Visualize Range must remain momentary when Lightroom exposes no authoritative readable state");
assert.doesNotMatch(lua + bridge, /point-color-visualization-return-probe/,
    "Temporary Visualize Range return diagnostics must not remain in production");
assert.match(sharedController, /control\.authoritative = ui/);
assert.match(sharedController, /control\.intended !== null/);
assert.match(sharedController, /let awaitingWrites = new Map\(\)/);
assert.match(sharedController, /225/);
console.log("Point Color production contracts passed.");
