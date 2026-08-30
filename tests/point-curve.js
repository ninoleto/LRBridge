const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const pointCurve = require("../server/point-curve-state");
const commands = require("../server/commands");
const context = require("../server/context");
const controllerToneCurve = require("../app/controller-tone-curve");
const { createBridge } = require("../server/bridge");

const root = path.resolve(__dirname, "..");
const read = function (relativePath) { return fs.readFileSync(path.join(root, relativePath), "utf8"); };
const feedbackPolling = read("lightroom/LRBridge.lrplugin/FeedbackPolling.lua");
const luaToneCurve = read("lightroom/LRBridge.lrplugin/ToneCurve.lua");
const luaParser = read("lightroom/LRBridge.lrplugin/Parser.lua");
const luaCommands = read("lightroom/LRBridge.lrplugin/Commands.lua");
const controllerHtml = read("app/controller.html");
const controllerMain = read("app/main.js");

const linear = [0, 0, 255, 255];
const composite = [0, 0, 64, 58, 192, 200, 255, 255];
const red = [0, 0, 128, 140, 255, 255];
const green = [0, 0, 96, 108, 255, 255];
const blue = [0, 0, 160, 148, 255, 255];
const refineSaturation = Object.freeze({ value: 100, min: 0, max: 100 });
// Read-only Lightroom snapshot captured before the raw-spline renderer change
// (photo 0E640600-8990-4822-8CCB-73C1E555A7F9, Develop counter 5).
const authoritativeRenderingFixtures = Object.freeze({
    rgb: Object.freeze([0, 0, 137, 62, 170, 127, 255, 255]),
    red: Object.freeze([0, 0, 80, 63, 102, 128, 168, 108, 174, 192, 255, 255]),
    green: Object.freeze([0, 0, 125, 67, 130, 117, 168, 129, 190, 158, 255, 255]),
    blue: Object.freeze([0, 0, 39, 72, 73, 151, 80, 43, 122, 71, 126, 129, 142, 132,
        156, 189, 168, 122, 190, 139, 194, 193, 215, 188, 255, 255])
});
const interactionFixtures = Object.freeze({
    six: Object.freeze([0, 0, 80, 63, 102, 128, 168, 108, 174, 192, 255, 255]),
    eight: Object.freeze([0, 0, 32, 20, 64, 70, 96, 90, 128, 150, 160, 140, 208, 230, 255, 255]),
    thirteen: authoritativeRenderingFixtures.blue
});
const rendererHashes = Object.freeze({
    six: "4dae23ea0e5fb64591c49c49a4c0a006deb83416da708e72817473398f80bae7",
    eight: "60b6b09bb0bd9e2862cbe7c82f5403d3844ba92d20af9051aa605958f8cd9c75",
    thirteen: "5064bef5857ac70830d6a440f7c4ff953f42de206b3a1e613dec6d32982fc5a0"
});

function routeQuery(values) {
    return Object.keys(values).map(function (key) {
        return encodeURIComponent(key) + "=" + encodeURIComponent(values[key]);
    }).join("&");
}

async function get(bridge, requestPath) {
    const port = bridge.getHttpServer().address().port;
    const response = await fetch("http://127.0.0.1:" + port + requestPath);
    return { status: response.status, body: await response.json() };
}

function drain() {
    const result = [];
    let command;
    while ((command = commands.getNextCommand()) !== null) result.push(command);
    return result;
}

function bindingQuery(binding) {
    return {
        selectedPhotoUuid: binding.selectedPhotoUuid,
        contextCounter: binding.contextCounter,
        developCounter: binding.developCounter
    };
}

function feedbackQuery(binding, curves, name) {
    return routeQuery(Object.assign(bindingQuery(binding), {
        name: name,
        rgb: pointCurve.serializeCurve(curves.rgb),
        red: pointCurve.serializeCurve(curves.red),
        green: pointCurve.serializeCurve(curves.green),
        blue: pointCurve.serializeCurve(curves.blue),
        refineSaturation: refineSaturation.value,
        refineMin: refineSaturation.min,
        refineMax: refineSaturation.max
    }));
}

function gestureQuery(binding, channel, gestureId, baseline, points) {
    const values = Object.assign({
        channel: channel,
        gestureId: gestureId
    }, bindingQuery(binding), { baseline: pointCurve.serializeCurve(baseline) });
    if (points) values.points = pointCurve.serializeCurve(points);
    return routeQuery(values);
}

assert.deepEqual(pointCurve.CHANNEL_FIELDS, {
    rgb: "ToneCurvePV2012",
    red: "ToneCurvePV2012Red",
    green: "ToneCurvePV2012Green",
    blue: "ToneCurvePV2012Blue"
});
assert.equal(pointCurve.REFINE_SATURATION_FIELD, "CurveRefineSaturation");
assert.deepEqual(pointCurve.presetCurve("Linear"), [0, 0, 255, 255]);
assert.deepEqual(pointCurve.presetCurve("Medium Contrast"),
    [0, 0, 32, 22, 64, 56, 128, 128, 192, 196, 255, 255]);
assert.deepEqual(pointCurve.presetCurve("Strong Contrast"),
    [0, 0, 32, 16, 64, 50, 128, 128, 192, 202, 255, 255]);
assert.equal(pointCurve.presetCurve("Custom"), null, "Custom must remain feedback-only");
assert.equal(pointCurve.validRefineSaturation(100, 0, 100), true);
assert.equal(pointCurve.validRefineSaturation(101, 0, 100), false);
assert.equal(pointCurve.serializeCurve(composite), "0,0,64,58,192,200,255,255");
assert.deepEqual(pointCurve.parseCurve("0,0,64,58,192,200,255,255"), composite);

for (const valid of [linear, composite, red, green, blue, [0, 255, 1, 0, 255, 128]]) {
    assert.equal(pointCurve.validCurveArray(valid), true, "Expected structurally valid curve: " + valid);
}
const sparse = [0, 0, 255, 255];
delete sparse[1];
for (const invalid of [
    null, {}, [], [0, 0, 255], [0, 0, 128, 128, 128, 140, 255, 255],
    [1, 0, 255, 255], [0, 0, 254, 255], [0, -1, 255, 255], [0, 0, 255, 256],
    [0, 0, 128.5, 140, 255, 255], [0, 0, NaN, 140, 255, 255], sparse
]) assert.equal(pointCurve.validCurveArray(invalid), false);
for (const invalidText of ["", "0, 0,255,255", "0,0,255", "0,0,255,256", "0,0,128,2,128,3,255,255"] ) {
    assert.equal(pointCurve.parseCurve(invalidText), null);
}

assert.deepEqual(controllerToneCurve.graphCoordinates(0, 0, { left: 0, top: 0, width: 255, height: 255 }), { x: 0, y: 255 });
assert.deepEqual(controllerToneCurve.graphCoordinates(255, 255, { left: 0, top: 0, width: 255, height: 255 }), { x: 255, y: 0 });
assert.deepEqual(controllerToneCurve.graphCoordinates(128, 127, { left: 0, top: 0, width: 255, height: 255 }), { x: 128, y: 128 });
const added = controllerToneCurve.addPoint(linear, 128, 140);
assert.deepEqual(added, { points: red, pointIndex: 1 });
assert.equal(controllerToneCurve.addPoint(red, 128, 20), null, "Duplicate X coordinates must be rejected");
assert.deepEqual(controllerToneCurve.movePoint(red, 1, 300, -20), [0, 0, 254, 0, 255, 255],
    "Interior points must remain between neighbors and within the 0-255 domain");
assert.deepEqual(controllerToneCurve.movePoint(red, 0, 90, 200), [0, 200, 128, 140, 255, 255],
    "The left endpoint X must remain fixed while endpoint Y moves");
assert.deepEqual(controllerToneCurve.movePoint(red, 2, 90, 20), [0, 0, 128, 140, 255, 20],
    "The right endpoint X must remain fixed while endpoint Y moves");
assert.deepEqual(controllerToneCurve.deletePoint(red, 1), linear);
assert.equal(controllerToneCurve.deletePoint(red, 0), null);
assert.equal(controllerToneCurve.deletePoint(red, 2), null);

function cubicValue(start, controlOne, controlTwo, end, t) {
    const inverse = 1 - t;
    return inverse * inverse * inverse * start + 3 * inverse * inverse * t * controlOne +
        3 * inverse * t * t * controlTwo + t * t * t * end;
}

function sampledSegmentRange(segment) {
    let minimum = Infinity;
    let maximum = -Infinity;
    for (let sample = 0; sample <= 1000; sample += 1) {
        const t = sample / 1000;
        const y = cubicValue(segment.y0, segment.c1y, segment.c2y, segment.y1, t);
        minimum = Math.min(minimum, y);
        maximum = Math.max(maximum, y);
    }
    return { minimum: minimum, maximum: maximum };
}

function assertNaturalCurve(points, label) {
    const slopes = controllerToneCurve.adobeSplineSlopes(points);
    const segments = controllerToneCurve.curveSegments(points);
    const pathData = controllerToneCurve.curvePathData(points);
    assert.equal(segments.length, points.length / 2 - 1, label + " must render one spline segment per point interval");
    assert.match(pathData, /^M /, label + " must start with an SVG move command");
    assert.equal((pathData.match(/\bC /g) || []).length, segments.length,
        label + " must render cubic spline commands for every interval");
    assert.doesNotMatch(pathData, /\bL /, label + " must not fall back to straight SVG line segments");
    const pathCoordinates = (pathData.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    assert.equal(pathCoordinates[0], points[0], label + " SVG path must start at the first authoritative X");
    assert.equal(pathCoordinates[1], 255 - points[1], label + " SVG path must start at the first authoritative output");

    segments.forEach(function (segment, index) {
        const sourceOffset = index * 2;
        assert.equal(segment.x0, points[sourceOffset], label + " segment start X must be authoritative");
        assert.equal(segment.y0, points[sourceOffset + 1], label + " segment start Y must be authoritative");
        assert.equal(segment.x1, points[sourceOffset + 2], label + " segment end X must be authoritative");
        assert.equal(segment.y1, points[sourceOffset + 3], label + " segment end Y must be authoritative");
        const pathEndpointOffset = 2 + index * 6 + 4;
        assert.equal(pathCoordinates[pathEndpointOffset], points[sourceOffset + 2],
            label + " SVG segment must end at every authoritative X");
        assert.equal(pathCoordinates[pathEndpointOffset + 1], 255 - points[sourceOffset + 3],
            label + " SVG segment must end at every authoritative output");
        assert.ok(segment.x0 < segment.c1x && segment.c1x < segment.c2x && segment.c2x < segment.x1,
            label + " spline control X coordinates must remain ordered");
        const width = segment.x1 - segment.x0;
        assert.ok(Math.abs(segment.c1y - (segment.y0 + slopes[index] * width / 3)) < 1e-12,
            label + " first tangent must use the unmodified Adobe spline slope");
        assert.ok(Math.abs(segment.c2y - (segment.y1 - slopes[index + 1] * width / 3)) < 1e-12,
            label + " second tangent must use the unmodified Adobe spline slope");
        for (let sample = 0; sample <= 100; sample += 1) {
            const t = sample / 100;
            const x = cubicValue(segment.x0, segment.c1x, segment.c2x, segment.x1, t);
            assert.ok(x >= segment.x0 && x <= segment.x1, label + " sampled spline X must remain ordered");
        }
    });
}

const verifiedSlopes = controllerToneCurve.adobeSplineSlopes(red);
assert.ok(Math.abs(verifiedSlopes[0] - 1.1409940944881891) < 1e-12);
assert.ok(Math.abs(verifiedSlopes[1] - 0.9992618110236217) < 1e-12);
assert.ok(Math.abs(verifiedSlopes[2] - 0.858636811023622) < 1e-12,
    "Adobe natural-cubic slope solver output must remain deterministic");
for (const [channel, points] of Object.entries(authoritativeRenderingFixtures)) {
    assertNaturalCurve(points, channel.toUpperCase() + " authoritative fixture");
}
for (const channel of ["green", "blue"]) {
    const extrema = controllerToneCurve.curveSegments(authoritativeRenderingFixtures[channel]).some(function (segment) {
        const range = sampledSegmentRange(segment);
        return range.minimum < Math.min(segment.y0, segment.y1) - 0.001 ||
            range.maximum > Math.max(segment.y0, segment.y1) + 0.001;
    });
    assert.equal(extrema, true, channel.toUpperCase() +
        " fixture must retain Adobe natural-cubic local extrema between authoritative points");
}
const fixtureLeavesDomain = ["green", "blue"].every(function (channel) {
    return controllerToneCurve.curveSegments(authoritativeRenderingFixtures[channel]).some(function (segment) {
        const range = sampledSegmentRange(segment);
        return range.minimum < 0 || range.maximum > 255;
    });
});
assert.equal(fixtureLeavesDomain, true,
    "Raw Green and Blue fixture splines must remain mathematically unflattened outside the graph domain");
assert.deepEqual(controllerToneCurve.selectedPointValues(red, 1), { input: 128, output: 140 },
    "Selected Input/Output feedback must come directly from the authoritative point pair");
assert.equal(controllerToneCurve.selectedPointValues(red, null), null);
assert.equal(controllerToneCurve.selectedPointValues(red, 3), null);
assert.ok(controllerToneCurve.VISUAL_POINT_RADIUS < controllerToneCurve.TOUCH_TARGET_RADIUS,
    "The restrained visible marker must be independently smaller than its tablet hit target");
for (const [fixtureName, points] of Object.entries(interactionFixtures)) {
    const rendererHash = crypto.createHash("sha256").update(controllerToneCurve.curvePathData(points)).digest("hex");
    assert.equal(rendererHash, rendererHashes[fixtureName],
        fixtureName + " raw Adobe spline output must remain byte-for-byte unchanged");
    for (let pointIndex = 1; pointIndex < points.length / 2 - 1; pointIndex += 1) {
        const moved = controllerToneCurve.movePoint(
            points,
            pointIndex,
            points[pointIndex * 2],
            Math.min(255, points[pointIndex * 2 + 1] + 1)
        );
        assert.ok(moved, fixtureName + " curve interior point " + pointIndex + " must remain movable");
        assert.equal(moved.length, points.length, "Moving a point must not impose a point-count limit");
    }
}
const insertionBase = [0, 0, 64, 70, 128, 150, 255, 255];
const inserted = controllerToneCurve.addPoint(insertionBase, 96, 110);
const insertionIdentity = controllerToneCurve.createInsertionIdentity(insertionBase, inserted.pointIndex);
assert.deepEqual(insertionIdentity.left, [64, 70]);
assert.deepEqual(insertionIdentity.right, [128, 150]);
assert.equal(controllerToneCurve.insertionBaselineMatches(insertionBase, insertionIdentity), true);
assert.equal(controllerToneCurve.locateInsertedPoint(inserted.points, insertionIdentity), inserted.pointIndex,
    "Structural feedback must retain the exact inserted point rather than remapping to its right-hand neighbor");
assert.deepEqual(inserted.points.slice((inserted.pointIndex + 1) * 2, (inserted.pointIndex + 2) * 2),
    insertionIdentity.right, "Point insertion must leave the right-hand neighbor byte-for-byte unchanged");
assert.equal(controllerToneCurve.addPoint([0, 0, 1, 1, 255, 255], 0.5, 50), null,
    "Addition must reject cleanly when no strictly increasing integer X exists between neighbors");

const transactionSnapshot = controllerToneCurve.normalizeSnapshot({
    available: true,
    selectedPhotoUuid: "transaction-photo",
    contextCounter: 7,
    developCounter: 11,
    revision: 30,
    name: "Custom",
    refineSaturation: refineSaturation,
    curves: { rgb: composite, red: red, green: green, blue: blue }
});
const transaction = controllerToneCurve.createAwaitingTarget(
    { id: "transaction_gesture", channel: "green" }, green, transactionSnapshot, 100
);
assert.deepEqual(Object.keys(transaction).sort(), [
    "channel", "contextCounter", "gestureId", "operation", "points", "selectedPhotoUuid", "submittedAt",
    "submittedDevelopCounter", "submittedRevision", "submittedUpdatedAt"
].sort(), "Pending writes must bind gesture, photo, context, Develop counter, revision, channel, and target");
assert.equal(controllerToneCurve.parseRefineEditorValue("72", refineSaturation), 72);
assert.equal(controllerToneCurve.parseRefineEditorValue("120", refineSaturation), 100,
    "Refine editor values must clamp to Lightroom's authoritative maximum");
assert.equal(controllerToneCurve.parseRefineEditorValue("-5", refineSaturation), 0,
    "Refine editor values must clamp to Lightroom's authoritative minimum");
assert.equal(controllerToneCurve.parseRefineEditorValue("not numeric", refineSaturation), null);
assert.equal(controllerToneCurve.resolveAwaitingTarget(transaction, transactionSnapshot), "matched");
const externalSnapshot = controllerToneCurve.normalizeSnapshot(Object.assign({}, transactionSnapshot, {
    revision: 31,
    curves: Object.assign({}, transactionSnapshot.curves, { green: [0, 0, 96, 90, 255, 255] })
}));
assert.equal(controllerToneCurve.resolveAwaitingTarget(transaction, externalSnapshot), "superseded",
    "A newer differing Lightroom array must retire an obsolete browser target");
const laterHeartbeatSnapshot = controllerToneCurve.normalizeSnapshot(Object.assign({}, transactionSnapshot, {
    updatedAt: 101,
    curves: Object.assign({}, transactionSnapshot.curves, { green: [0, 0, 96, 80, 255, 255] })
}));
assert.equal(controllerToneCurve.resolveAwaitingTarget(transaction, laterHeartbeatSnapshot), "superseded",
    "A later authoritative heartbeat must settle a rejected target even when revision counters already advanced");
const scalarTransaction = controllerToneCurve.createAwaitingScalar(75, transactionSnapshot, 100, "refine_1");
assert.equal(controllerToneCurve.resolveAwaitingScalar(scalarTransaction,
    controllerToneCurve.normalizeSnapshot(Object.assign({}, transactionSnapshot, {
        refineSaturation: { value: 75, min: 0, max: 100 }
    }))), "matched");
assert.equal(controllerToneCurve.resolveAwaitingScalar(scalarTransaction,
    controllerToneCurve.normalizeSnapshot(Object.assign({}, transactionSnapshot, {
        revision: 31,
        refineSaturation: { value: 80, min: 0, max: 100 }
    }))), "superseded", "A newer Lightroom scalar value must retire an obsolete Refine target");
const presetTransaction = controllerToneCurve.createAwaitingPreset(
    "Medium Contrast", controllerToneCurve.presetCurve("Medium Contrast"), transactionSnapshot, 100
);
assert.equal(controllerToneCurve.resolveAwaitingPreset(presetTransaction,
    controllerToneCurve.normalizeSnapshot(Object.assign({}, transactionSnapshot, {
        name: "Medium Contrast",
        curves: Object.assign({}, transactionSnapshot.curves, {
            rgb: controllerToneCurve.presetCurve("Medium Contrast")
        })
    }))), "matched");
assert.equal(controllerToneCurve.resolveAwaitingPreset(presetTransaction,
    controllerToneCurve.normalizeSnapshot(Object.assign({}, transactionSnapshot, {
        revision: 31,
        name: "Custom"
    }))), "superseded", "Newer authoritative preset feedback must unlock a stale request");
assert.equal(controllerToneCurve.remapSelectedPointIndex(
    interactionFixtures.thirteen, interactionFixtures.six, 6
), null, "A structural change must clear a selected point that cannot be safely remapped");

const canonicalA = "scalars|ToneCurvePV2012=" + pointCurve.serializeCurve(linear) +
    "|ToneCurvePV2012Red=" + pointCurve.serializeCurve(linear) +
    "|ToneCurvePV2012Green=" + pointCurve.serializeCurve(linear) +
    "|ToneCurvePV2012Blue=" + pointCurve.serializeCurve(linear) +
    "|ToneCurveName2012=Linear|CurveRefineSaturation=100,0,100";
const canonicalB = canonicalA.replace("ToneCurvePV2012=0,0,255,255", "ToneCurvePV2012=0,0,64,58,192,200,255,255")
    .replace("ToneCurveName2012=Linear", "ToneCurveName2012=Custom");
const initialContext = context.updateContext({
    activeModule: "develop", selectedPhotoUuid: "point-curve-fingerprint-photo", developFingerprint: canonicalA
});
const unchangedContext = context.updateContext({
    activeModule: "develop", selectedPhotoUuid: "point-curve-fingerprint-photo", developFingerprint: canonicalA
});
const advancedContext = context.updateContext({
    activeModule: "develop", selectedPhotoUuid: "point-curve-fingerprint-photo", developFingerprint: canonicalB
});
assert.equal(unchangedContext.developCounter, initialContext.developCounter);
assert.equal(advancedContext.developCounter, initialContext.developCounter + 1,
    "A canonical Point Curve array/name change must advance the Develop counter");

for (const field of Object.values(pointCurve.CHANNEL_FIELDS)) {
    assert.ok(luaToneCurve.includes(field + "="), "Develop fingerprint must serialize " + field);
    assert.ok(luaToneCurve.includes('LrDevelopController.getValue("' + field + '")') ||
        luaToneCurve.includes("LrDevelopController.getValue(field)"));
}
assert.ok(feedbackPolling.includes("toneCurve and toneCurve.fingerprint"));
assert.match(luaToneCurve, /LrDevelopController\.getValue\("ToneCurveName2012"\)/);
assert.match(luaToneCurve, /LrDevelopController\.getValue\(refineSaturationField\)/);
assert.match(luaToneCurve, /LrDevelopController\.getRange\(refineSaturationField\)/,
    "Refine Saturation must publish Lightroom's live SDK range instead of assuming 0..100");
assert.doesNotMatch(luaToneCurve, /getRange\(channelFields|Curve coordinates.*getRange/,
    "SDK scalar ranges must never define Point Curve coordinates");
assert.match(luaToneCurve, /CurveRefineSaturation=/,
    "The authoritative Develop fingerprint must include Refine Saturation value and live range");
assert.match(feedbackPolling, /refineSaturation=[\s\S]*refineMin=[\s\S]*refineMax=/,
    "Point Curve feedback must publish the authoritative Refine Saturation value and range");
assert.match(luaToneCurve, /addAdjustmentChangeObserver\(functionContext, owner, function\(\)\s*adjustmentDirty = true\s*end\)/);
assert.match(feedbackPolling, /maybeSendContextHeartbeat\(toneCurveDirty\)/);
assert.match(feedbackPolling, /contextIntervalSeconds = 0\.75/,
    "Periodic heartbeat polling must remain as observer recovery");
assert.doesNotMatch(luaToneCurve, /applyDevelopSettings|UI Automation|mouse|keyboard|Profile/i);
assert.match(luaToneCurve, /LrDevelopController\.startTracking\(command\.field\)/);
assert.match(luaToneCurve, /function ToneCurve\.updateGesture[\s\S]*LrDevelopController\.setValue\(command\.field, copyCurve\(command\.points\)\)/);
assert.match(luaToneCurve, /local function clearActiveGesture\(\)[\s\S]*LrDevelopController\.stopTracking\(false\)[\s\S]*activeGesture = nil/);
const updateGestureSource = luaToneCurve.slice(
    luaToneCurve.indexOf("function ToneCurve.updateGesture"), luaToneCurve.indexOf("function ToneCurve.endGesture")
);
const endGestureSource = luaToneCurve.slice(
    luaToneCurve.indexOf("function ToneCurve.endGesture"), luaToneCurve.indexOf("function ToneCurve.cancelGesture")
);
assert.match(updateGestureSource, /clearActiveGesture\(\)/,
    "A failed Lightroom update must terminate tracking instead of stranding activeGesture");
assert.match(endGestureSource, /clearActiveGesture\(\)/,
    "Each normally completed gesture must terminate Lightroom tracking");
assert.match(luaToneCurve, /function ToneCurve\.cancelGesture\(command\)[\s\S]*clearActiveGesture\(\)/,
    "Explicit cancellation must terminate Lightroom tracking");
assert.match(luaToneCurve, /LrDevelopController\.resetToDefault\(command\.field\)/);
assert.match(luaToneCurve,
    /function ToneCurve\.beginRefineSaturationGesture[\s\S]*startTracking\(refineSaturationField\)/);
assert.match(luaToneCurve,
    /function ToneCurve\.updateRefineSaturationGesture[\s\S]*setValue\(refineSaturationField, command\.value\)/);
assert.match(luaToneCurve,
    /function ToneCurve\.endRefineSaturationGesture[\s\S]*setValue\(refineSaturationField, command\.value\)[\s\S]*clearActiveGesture\(\)/,
    "A Refine gesture must end with authoritative setValue and terminal stopTracking cleanup");
assert.match(luaToneCurve,
    /function ToneCurve\.resetRefineSaturation[\s\S]*resetToDefault\(refineSaturationField\)/);
const presetLuaSource = luaToneCurve.slice(luaToneCurve.indexOf("function ToneCurve.setPreset"));
assert.match(presetLuaSource,
    /startTracking\(channelFields\.rgb\)[\s\S]*setValue\(channelFields\.rgb, copyCurve\(command\.points\)\)[\s\S]*stopTracking\(false\)/,
    "Preset application must be one tracked RGB history operation");
assert.doesNotMatch(presetLuaSource, /ToneCurveName2012|applyDevelopSettings/,
    "The initial production preset route must write only ToneCurvePV2012 until Lightroom proves a name write is needed");
for (const phase of ["begin", "update", "end", "cancel"]) {
    assert.ok(luaCommands.includes('command.command == "tone_curve.gesture.' + phase + '"'));
    assert.ok(luaCommands.includes('command.command == "tone_curve.refine_saturation.gesture.' + phase + '"'));
}
assert.ok(luaCommands.includes('command.command == "tone_curve.refine_saturation.reset"'));
assert.ok(luaCommands.includes('command.command == "tone_curve.preset.set"'));
for (const field of ["channel", "gestureId", "expectedSelectedPhotoUuid", "expectedDevelopCounter", "points", "expectedPoints"]) {
    assert.match(luaParser, new RegExp("\\b" + field + " = " + field + "\\b"));
}

assert.match(controllerHtml, /title\.textContent = "TONE CURVE"/,
    "Point and Parametric controls must share one unified TONE CURVE section");
assert.ok(controllerHtml.indexOf("const pointPanel = pointCurveController.element") <
    controllerHtml.indexOf("parametricPanel.appendChild(createParametricCurveGraph())"),
    "The unified workspace must construct the accepted Point Curve panel before Parametric content");
assert.match(controllerHtml, /\.point-curve-graph[\s\S]*aspect-ratio: 1 \/ 1|\.point-curve-graph-shell[\s\S]*aspect-ratio: 1 \/ 1/);
assert.match(controllerHtml, /\.point-curve-panel\s*\{[\s\S]*width: 100%;/,
    "The Point Curve workspace must expose full row width for touch-friendly controls");
assert.match(controllerHtml, /\.point-curve-graph-shell\s*\{[\s\S]*width: min\(100%, 560px\)/,
    "The accepted Point Curve graph dimensions must remain compact while its controls use full width");
assert.match(controllerHtml, /\.point-curve-channel\s*\{[\s\S]*width: 44px;[\s\S]*height: 44px;/,
    "Compact channel glyphs must retain 44px touch targets");
assert.match(controllerHtml, /\.point-curve-channel::before\s*\{[\s\S]*inset: 9px;/,
    "Visible channel controls must be independently restrained inside their touch targets");
assert.match(controllerHtml, /\.point-curve-grid-minor[\s\S]*\.point-curve-grid-major/,
    "The graph must provide subtle minor divisions and stronger quarter divisions");
const pointCurveControllerSource = read("app/controller-tone-curve.js");
assert.doesNotMatch(pointCurveControllerSource, /heading\.textContent = "POINT CURVE"/,
    "The Point Curve controller must not create a second section heading inside the unified workspace");
assert.match(pointCurveControllerSource, /addEventListener\("pointerdown"/);
assert.match(pointCurveControllerSource, /addEventListener\("pointermove"/);
assert.match(pointCurveControllerSource, /255 - segment\.y1/,
    "SVG output coordinates must invert native Y so 0 is at the bottom");
assert.match(pointCurveControllerSource, /svgElement\("line", \{\s*class: "point-curve-reference"/,
    "The diagonal linear reference must be a separate SVG element from the active path");
assert.match(pointCurveControllerSource,
    /function curveSegments\(points\) \{\s*const slopes = adobeSplineSlopes\(points\);[\s\S]*c1y: y0 \+ slopes\[index\] \* width \/ 3[\s\S]*c2y: y1 - slopes\[index \+ 1\] \* width \/ 3/,
    "Production segments must use raw Adobe slopes without mathematical limiting");
assert.doesNotMatch(controllerToneCurve.curveSegments.toString() + controllerToneCurve.curvePathData.toString(),
    /shapePreservingSlopes|boundPathCoordinate/,
    "Production rendering must not flatten or bound Adobe's natural spline mathematics");
assert.match(pointCurveControllerSource,
    /svgElement\("clipPath", \{[\s\S]*id: "point-curve-domain-clip"[\s\S]*svgElement\("rect", \{ x: 0, y: 0, width: 255, height: 255 \}\)/,
    "The square graph boundary must define an explicit SVG clip path");
assert.match(pointCurveControllerSource,
    /curvePath = svgElement\("path", \{[\s\S]*class: "point-curve-line"[\s\S]*"clip-path": "url\(#point-curve-domain-clip\)"/,
    "The active natural spline must be visually clipped rather than mathematically flattened");
assert.doesNotMatch(pointCurveControllerSource, /svgElement\("polyline"|createElementNS\([^\n]*"polyline"/,
    "Point Curve rendering must not use an SVG polyline");
assert.match(pointCurveControllerSource,
    /r: String\(TOUCH_TARGET_RADIUS\)[\s\S]*classList\.add\("point-curve-hit-target"\)[\s\S]*r: String\(VISUAL_POINT_RADIUS\)[\s\S]*classList\.add\("point-curve-marker"\)/,
    "Visual marker and invisible touch target radii must be independently controlled");
assert.match(controllerHtml, /\.point-curve-hit-target\s*\{[\s\S]*fill: transparent;[\s\S]*pointer-events: all;/);
assert.match(controllerHtml, /\.point-curve-marker\s*\{[\s\S]*pointer-events: none;/);
assert.match(pointCurveControllerSource,
    /selectedPointValues\(points, selectedPointIndex\)[\s\S]*inputValueElement\.textContent = selectedValues[\s\S]*outputValueElement\.textContent = selectedValues/,
    "Displayed Input/Output values must be read from the selected authoritative point");
assert.match(pointCurveControllerSource,
    /rootElement\.appendChild\(graphShell\)[\s\S]*values\.className = "point-curve-values"[\s\S]*rootElement\.appendChild\(values\)[\s\S]*refineRow\.className/,
    "Input and Output must remain in a dedicated row directly below the graph");
assert.match(controllerHtml,
    /\.point-curve-values\s*\{[\s\S]*justify-content: center;[\s\S]*width: min\(100%, 560px\);[\s\S]*font-size: 16px;/,
    "Input and Output must be centered beneath the graph with readable labels");
assert.match(controllerHtml,
    /\.point-curve-value-number\s*\{[\s\S]*font-size: 18px;[\s\S]*font-weight: 700;/,
    "Selected-point values must be visually prominent without overlaying the graph");
assert.match(pointCurveControllerSource, /adjustLabel\.textContent = "Adjust:"/);
assert.doesNotMatch(pointCurveControllerSource, /point-curve-name|nameElement/,
    "The authoritative curve name must no longer float at the right edge of the channel toolbar");
assert.match(pointCurveControllerSource,
    /coordinate % 64 === 0 \? "major" : "minor"[\s\S]*class: "point-curve-grid-" \+ kind/,
    "SVG grid elements must distinguish major and minor divisions");
assert.match(pointCurveControllerSource,
    /refineRow\.hidden = selectedChannel !== "rgb"[\s\S]*const refineChannelAvailable = available && selectedChannel === "rgb"/,
    "Refine Saturation must be visible and enabled only for RGB");
assert.match(pointCurveControllerSource,
    /refineRow\.className = "develop-slider-row point-curve-refine-row"[\s\S]*refineLabel\.className = "slider-name"/,
    "Refine Saturation must use the standard touch-friendly slider row");
assert.match(controllerHtml,
    /\.develop-slider-row,[\s\S]*grid-template-columns: minmax\(140px, 210px\) minmax\(180px, 1fr\) 92px 44px 44px auto;/,
    "Refine Saturation must inherit the same long responsive slider grid as Parametric controls");
assert.doesNotMatch(controllerHtml,
    /\.point-curve-refine-row\s*\{[^}]*grid-template-columns|\.point-curve-refine-row\s*\{[^}]*max-width/,
    "Refine Saturation must not collapse back to a compact track override");
assert.match(pointCurveControllerSource,
    /function stepRefineSaturation\(delta\)[\s\S]*Math\.min\(refine\.max, Math\.max\(refine\.min, refine\.value \+ delta\)\)/,
    "Refine Saturation step buttons must clamp one-point authoritative changes to Lightroom's range");
assert.match(pointCurveControllerSource,
    /refineDecrementButton\.addEventListener\("click", function \(\) \{ stepRefineSaturation\(-1\); \}\)[\s\S]*refineIncrementButton\.addEventListener\("click", function \(\) \{ stepRefineSaturation\(1\); \}\)/,
    "Refine Saturation minus and plus must use the tracked authoritative command path");
assert.match(pointCurveControllerSource,
    /refineRow\.appendChild\(refineLabel\)[\s\S]*refineRow\.appendChild\(refineRange\)[\s\S]*refineRow\.appendChild\(refineNumber\)[\s\S]*refineRow\.appendChild\(refineDecrementButton\)[\s\S]*refineRow\.appendChild\(refineIncrementButton\)[\s\S]*refineRow\.appendChild\(refineResetButton\)/,
    "Refine Saturation controls must render in label, slider, editor, minus, plus, Reset order");
assert.match(pointCurveControllerSource,
    /refineNumber\.type = "text";[\s\S]*refineNumber\.inputMode = "numeric";[\s\S]*setAttribute\("autocomplete", "off"\)[\s\S]*setAttribute\("autocapitalize", "off"\)[\s\S]*setAttribute\("spellcheck", "false"\)/,
    "Refine Saturation must use a numeric-keyboard text editor with autofill and text services disabled");
assert.doesNotMatch(pointCurveControllerSource, /refineNumber\.type = "number"|point-curve-refine-authoritative/,
    "Refine Saturation must not retain a native number input or duplicate visible value");
assert.doesNotMatch(controllerHtml, /\.point-curve-refine-row input\[type="number"\]/,
    "Refine Saturation styling must not conceal a native number editor");
assert.match(pointCurveControllerSource,
    /if \(!refineNumberEditing\) refineNumber\.value = String\(refine\.value\)/,
    "Polling must preserve active Refine editor text, caret, and selection");
assert.match(pointCurveControllerSource,
    /event\.key === "Enter"[\s\S]*commitRefineEditor\(\)[\s\S]*event\.key === "Escape"[\s\S]*cancelRefineEditor\(\)[\s\S]*addEventListener\("blur", function \(\) \{ commitRefineEditor\(\); \}\)/,
    "Enter and blur must commit while Escape restores Lightroom authority");
assert.match(pointCurveControllerSource,
    /addPointButton\.textContent = "\+ Add Point";[\s\S]*setAttribute\("aria-label", "Add point"\)[\s\S]*addPointArmed = !addPointArmed/,
    "A clearly labelled accessible button must explicitly arm one-shot Add Point mode");
assert.match(controllerHtml,
    /\.point-curve-add-button\s*\{[\s\S]*width: auto;[\s\S]*height: 44px;[\s\S]*min-width: 104px;[\s\S]*min-height: 44px;[\s\S]*\.point-curve-add-button\.active/,
    "Labelled Add Point must retain a touch-sized target and visible active state");
assert.match(pointCurveControllerSource,
    /svg\.addEventListener\("pointerdown", function \(event\) \{\s*if \(!addPointArmed \|\| gesture\) return;/,
    "Empty graph space must be inert outside explicit Add Point mode and ignore secondary pointers");
assert.match(pointCurveControllerSource,
    /if \(session\.adding\)[\s\S]*locateInsertedPoint\(baseline, session\.insertion\)[\s\S]*movePoint\(baseline, insertedIndex/,
    "An accepted insertion must continue dragging only its stable inserted identity");
assert.match(pointCurveControllerSource, /updatePresetOptions\(authoritative\.name\)/,
    "The preset selector must render Lightroom's authoritative ToneCurveName2012");
assert.match(pointCurveControllerSource, /presetCurve\(name\)[\s\S]*selectedChannel = "rgb"[\s\S]*selectedPointIndex = null/,
    "A preset selection must switch presentation to RGB and clear structural point selection");
assert.equal((pointCurveControllerSource.match(/authoritative = normalized/g) || []).length, 1,
    "Only accepted authoritative snapshots may replace rendered Point Curve state");
assert.match(controllerHtml, /<script src="\/controller-tone-curve\.js"><\/script>/);
assert.match(controllerMain, /requestUrl\.pathname === "\/controller-tone-curve\.js"/);
assert.match(pointCurveControllerSource, /awaitingReset[\s\S]*normalized\.developCounter > awaitingReset\.submittedDevelopCounter[\s\S]*normalized\.revision > awaitingReset\.submittedRevision/,
    "Reset presentation must remain pending until a newer authoritative Develop revision arrives");
assert.match(pointCurveControllerSource, /resolveAwaitingTarget\(awaitingTarget, normalized\)/,
    "Production feedback settlement must accept newer differing authoritative snapshots");
assert.match(pointCurveControllerSource, /addEventListener\("focus", handleRecoverySignal\)[\s\S]*addEventListener\("online", handleRecoverySignal\)[\s\S]*addEventListener\("visibilitychange", handleRecoverySignal\)/,
    "Focus, reconnect, and visibility recovery must trigger authoritative refresh");

class FakeClassList {
    constructor() { this.values = new Set(); }
    add() { for (const value of arguments) this.values.add(value); }
    toggle(value, enabled) {
        if (enabled) this.values.add(value);
        else this.values.delete(value);
    }
    contains(value) { return this.values.has(value); }
}

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.attributes = {};
        this.listeners = {};
        this.classList = new FakeClassList();
        this.className = "";
        this.textContent = "";
        this.hidden = false;
        this.disabled = false;
        this.value = "";
        this.selectionStart = 0;
        this.selectionEnd = 0;
        this.selectionDirection = "none";
        this.ownerDocument = null;
        this.style = { setProperty: function () {} };
    }
    setAttribute(name, value) {
        this.attributes[name] = String(value);
        if (name === "class") {
            this.className = String(value);
            String(value).split(/\s+/).filter(Boolean).forEach(this.classList.add.bind(this.classList));
        }
    }
    getAttribute(name) { return this.attributes[name]; }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren() { this.children = Array.from(arguments); }
    addEventListener(type, listener) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(listener);
    }
    removeEventListener(type, listener) {
        if (!this.listeners[type]) return;
        this.listeners[type] = this.listeners[type].filter(function (candidate) { return candidate !== listener; });
    }
    dispatch(type, properties) {
        const event = Object.assign({
            type: type,
            preventDefault: function () {},
            stopPropagation: function () {}
        }, properties || {});
        for (const listener of this.listeners[type] || []) listener(event);
    }
    getBoundingClientRect() { return { left: 0, top: 0, width: 255, height: 255 }; }
    setPointerCapture() {}
    setSelectionRange(start, end, direction) {
        this.selectionStart = start;
        this.selectionEnd = end;
        this.selectionDirection = direction || "none";
    }
    focus() {
        if (this.ownerDocument) this.ownerDocument.activeElement = this;
        this.dispatch("focus");
    }
    blur() {
        if (this.ownerDocument && this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null;
        this.dispatch("blur");
    }
}

function createFakeDocument() {
    const documentObject = new FakeElement("document");
    documentObject.visibilityState = "visible";
    documentObject.createElement = function (name) {
        const element = new FakeElement(name);
        element.ownerDocument = documentObject;
        return element;
    };
    documentObject.createElementNS = function (_namespace, name) {
        const element = new FakeElement(name);
        element.ownerDocument = documentObject;
        return element;
    };
    documentObject.createTextNode = function (text) {
        const node = new FakeElement("#text");
        node.textContent = text;
        return node;
    };
    return documentObject;
}

function findElements(element, predicate, matches) {
    matches = matches || [];
    if (predicate(element)) matches.push(element);
    for (const child of element.children || []) findElements(child, predicate, matches);
    return matches;
}

function jsonResponse(body, status) {
    return {
        ok: status === undefined || status < 400,
        status: status || 200,
        json: async function () { return body; }
    };
}

function controllerSnapshot(points, revision, updatedAt) {
    return {
        available: true,
        selectedPhotoUuid: "browser-photo",
        contextCounter: 12,
        developCounter: 18,
        revision: revision,
        updatedAt: updatedAt === undefined ? Date.now() : updatedAt,
        name: "Custom",
        refineSaturation: Object.assign({}, refineSaturation),
        curves: { rgb: points.slice(), red: points.slice(), green: points.slice(), blue: points.slice() }
    };
}

async function flushController() {
    await new Promise(function (resolve) { setImmediate(resolve); });
    await new Promise(function (resolve) { setImmediate(resolve); });
}

async function controllerInteractionTests() {
    const documentObject = createFakeDocument();
    const windowObject = new FakeElement("window");
    let snapshot = controllerSnapshot(interactionFixtures.eight, 1);
    const requests = [];
    const statuses = [];
    const fetchImpl = async function (requestPath) {
        requests.push(requestPath);
        if (requestPath === "/api/tone-curve/state") return jsonResponse({ ok: true, pointCurve: snapshot });
        return jsonResponse({ ok: true });
    };
    const controller = controllerToneCurve.createController({
        document: documentObject,
        window: windowObject,
        fetch: fetchImpl,
        setStatus: function (message) { statuses.push(message); },
        setInterval: function () { return 1; },
        clearInterval: function () {}
    });
    const binding = Object.assign({ activeModule: "develop" }, snapshot);
    controller.activate(binding);
    await flushController();

    const rootElement = controller.element;
    let svg = findElements(rootElement, function (element) {
        return element.classList && element.classList.contains("point-curve-graph");
    })[0];
    let hitTarget = findElements(rootElement, function (element) {
        return element.classList && element.classList.contains("point-curve-hit-target") &&
            element.getAttribute("data-point-index") === "3";
    })[0];
    hitTarget.dispatch("pointerdown", {
        pointerId: 40, pointerType: "mouse", clientX: 96, clientY: 165
    });
    svg.dispatch("pointerup", { pointerId: 40, pointerType: "mouse", clientX: 96, clientY: 165 });
    assert.equal(controller.getState().gestureActive, false,
        "A mouse tap must settle as selection without opening an SDK write gesture");
    const input = findElements(rootElement, function (element) {
        return element.getAttribute && element.getAttribute("aria-label") === "Selected point input";
    })[0];
    const output = findElements(rootElement, function (element) {
        return element.getAttribute && element.getAttribute("aria-label") === "Selected point output";
    })[0];
    assert.equal(input.textContent, String(interactionFixtures.eight[6]));
    assert.equal(output.textContent, String(interactionFixtures.eight[7]),
        "Selected Input/Output must reflect the authoritative array");
    const deleteButton = findElements(rootElement, function (element) {
        return element.tagName === "button" && element.textContent === "Delete selected point";
    })[0];
    assert.equal(deleteButton.disabled, false, "Selecting an interior point must visibly enable deletion");
    const selectedMarker = findElements(rootElement, function (element) {
        return element.classList && element.classList.contains("point-curve-marker") &&
            element.classList.contains("selected");
    })[0];
    assert.ok(selectedMarker, "The selected interior point must have a visible selected marker");

    hitTarget = findElements(rootElement, function (element) {
        return element.classList && element.classList.contains("point-curve-hit-target") &&
            element.getAttribute("data-point-index") === "3";
    })[0];
    hitTarget.dispatch("pointerdown", { pointerId: 1, clientX: 96, clientY: 155 });
    const canonicalPath = findElements(rootElement, function (element) {
        return element.classList && element.classList.contains("point-curve-line");
    })[0];
    const previewPath = findElements(rootElement, function (element) {
        return element.classList && element.classList.contains("point-curve-preview-line");
    })[0];
    const previewMarker = findElements(rootElement, function (element) {
        return element.classList && element.classList.contains("point-curve-preview-marker");
    })[0];
    assert.equal(canonicalPath.getAttribute("d"), controllerToneCurve.curvePathData(interactionFixtures.eight),
        "The committed graph must remain authoritative during a drag");
    assert.equal(previewPath.getAttribute("display"), "none",
        "Pointer-down on an existing point must select it without prematurely admitting a write gesture");
    svg.dispatch("pointermove", { pointerId: 1, clientX: 98, clientY: 153 });
    const movedPreview = interactionFixtures.eight.slice();
    movedPreview[6] = 98;
    movedPreview[7] = 102;
    assert.equal(previewPath.getAttribute("d"), controllerToneCurve.curvePathData(movedPreview),
        "Every pointer move must update the local preview synchronously");
    assert.equal(previewMarker.getAttribute("cy"), "153",
        "The visible drag marker must follow the first intentional pointer movement immediately");
    await flushController();
    assert.equal(controller.getState().gesture.awaitingAuthoritative, true);
    svg.dispatch("pointerup", { pointerId: 1, clientX: 97, clientY: 154 });
    await flushController();
    assert.equal(controller.getState().gesture.finishing, true,
        "Pointer-up must wait for authoritative update feedback instead of committing a stale baseline");
    assert.equal(requests.some(function (requestPath) { return requestPath.includes("/gesture/end?"); }), false);
    const acceptedUpdate = interactionFixtures.eight.slice();
    acceptedUpdate[6] = 98;
    acceptedUpdate[7] = 102;
    snapshot = controllerSnapshot(acceptedUpdate, 2, Date.now() + 100);
    controller.applyAuthoritative(snapshot);
    await flushController();
    assert.equal(controller.getState().gestureActive, false,
        "Pointer-up must reach its terminal end after authoritative rebasing");
    assert.ok(controller.getState().awaitingTarget);
    assert.ok(requests.some(function (requestPath) { return requestPath.includes("/gesture/end?"); }));

    const externalPoints = interactionFixtures.eight.slice();
    externalPoints[7] = 120;
    snapshot = controllerSnapshot(externalPoints, 2, Date.now() + 1000);
    assert.equal(controller.applyAuthoritative(snapshot), true);
    assert.equal(controller.getState().awaitingTarget, null,
        "A newer external Lightroom edit must supersede the browser target and unlock the graph");
    assert.ok(statuses.some(function (message) { return /superseded or normalized/.test(message); }));

    hitTarget = findElements(rootElement, function (element) {
        return element.classList && element.classList.contains("point-curve-hit-target") &&
            element.getAttribute("data-point-index") === "4";
    })[0];
    hitTarget.dispatch("pointerdown", { pointerId: 2, clientX: 128, clientY: 100 });
    svg = findElements(rootElement, function (element) {
        return element.classList && element.classList.contains("point-curve-graph");
    })[0];
    svg.dispatch("pointermove", { pointerId: 2, clientX: 131, clientY: 97 });
    svg.dispatch("pointerup", { pointerId: 2, clientX: 131, clientY: 97 });
    await flushController();
    assert.equal(controller.getState().gestureActive, false,
        "Multiple sequential gestures must remain possible without refreshing");
    const secondTarget = controller.getState().awaitingTarget;
    snapshot = controllerSnapshot(secondTarget.points, 3);
    controller.applyAuthoritative(snapshot);
    assert.equal(controller.getState().awaitingTarget, null);

    hitTarget = findElements(rootElement, function (element) {
        return element.classList && element.classList.contains("point-curve-hit-target") &&
            element.getAttribute("data-point-index") === "6";
    })[0];
    hitTarget.dispatch("click");
    snapshot = controllerSnapshot(interactionFixtures.six, 4);
    controller.applyAuthoritative(snapshot);
    assert.equal(controller.getState().selectedPointIndex, null,
        "A structural authoritative change must not leave an invalid selected index");

    hitTarget = findElements(rootElement, function (element) {
        return element.classList && element.classList.contains("point-curve-hit-target") &&
            element.getAttribute("data-point-index") === "2";
    })[0];
    hitTarget.dispatch("pointerdown", { pointerId: 3, clientX: 102, clientY: 126 });
    svg.dispatch("pointermove", { pointerId: 3, clientX: 106, clientY: 122 });
    svg.dispatch("pointerup", { pointerId: 3, clientX: 106, clientY: 122 });
    await flushController();
    assert.ok(controller.getState().awaitingTarget);
    controller.applyContext({
        activeModule: "develop", selectedPhotoUuid: "other-photo", contextCounter: 13, developCounter: 1
    });
    assert.equal(controller.getState().awaitingTarget, null);
    assert.equal(controller.getState().gestureActive, false,
        "Photo/context navigation must immediately clear all local pending gesture state");
    controller.deactivate();

    const timeoutDocument = createFakeDocument();
    let pollingCallback = null;
    let feedbackAvailable = false;
    const timeoutFetch = function (_requestPath, options) {
        if (feedbackAvailable) return Promise.resolve(jsonResponse({ ok: true, pointCurve: controllerSnapshot(interactionFixtures.six, 5) }));
        return new Promise(function (_resolve, reject) {
            options.signal.addEventListener("abort", function () { reject(new Error("aborted")); }, { once: true });
        });
    };
    const timeoutController = controllerToneCurve.createController({
        document: timeoutDocument,
        window: new FakeElement("window"),
        fetch: timeoutFetch,
        requestTimeoutMs: 10,
        setInterval: function (callback) { pollingCallback = callback; return 2; },
        clearInterval: function () {}
    });
    timeoutController.activate(Object.assign({ activeModule: "develop" }, controllerSnapshot(interactionFixtures.six, 5)));
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
    assert.equal(timeoutController.getState().requestInFlight, false,
        "HTTP timeout must clear requestInFlight");
    feedbackAvailable = true;
    pollingCallback();
    await flushController();
    assert.ok(timeoutController.getState().authoritative,
        "The next authoritative polling tick must recover after timeout without a refresh");
    timeoutController.deactivate();
}

async function controllerRefineAndPresetTests() {
    const documentObject = createFakeDocument();
    const windowObject = new FakeElement("window");
    let currentTime = 1000;
    let snapshot = controllerSnapshot(linear, 1, currentTime);
    snapshot.curves = {
        rgb: linear.slice(), red: red.slice(), green: green.slice(), blue: blue.slice()
    };
    const requests = [];
    let rejectStrong = false;
    const fetchImpl = async function (requestPath) {
        requests.push(requestPath);
        if (requestPath === "/api/tone-curve/state") {
            return jsonResponse({ ok: true, pointCurve: snapshot });
        }
        if (rejectStrong && requestPath.includes("preset=Strong%20Contrast")) {
            return jsonResponse({ ok: false, error: "preset rejected" }, 409);
        }
        return jsonResponse({ ok: true });
    };
    const controller = controllerToneCurve.createController({
        document: documentObject,
        window: windowObject,
        fetch: fetchImpl,
        now: function () { return currentTime; },
        feedbackTimeoutMs: 10,
        setInterval: function () { return 20; },
        clearInterval: function () {}
    });
    controller.activate(Object.assign({ activeModule: "develop" }, snapshot));
    await flushController();
    const rootElement = controller.element;
    const refineRowElement = findElements(rootElement, function (element) {
        return element.className === "develop-slider-row point-curve-refine-row";
    })[0];
    const refineSlider = findElements(rootElement, function (element) {
        return element.getAttribute && element.getAttribute("aria-label") === "Refine Saturation";
    })[0];
    const refineEditor = findElements(rootElement, function (element) {
        return element.getAttribute && element.getAttribute("aria-label") === "Edit Refine Saturation value";
    })[0];
    const refineDecrement = findElements(rootElement, function (element) {
        return element.getAttribute && element.getAttribute("aria-label") === "Decrease Refine Saturation";
    })[0];
    const refineIncrement = findElements(rootElement, function (element) {
        return element.getAttribute && element.getAttribute("aria-label") === "Increase Refine Saturation";
    })[0];
    const presetSelect = findElements(rootElement, function (element) {
        return element.getAttribute && element.getAttribute("aria-label") === "Point Curve preset";
    })[0];
    const redButton = findElements(rootElement, function (element) {
        return element.getAttribute && element.getAttribute("aria-label") === "Adjust Red Point Curve";
    })[0];
    const rgbButton = findElements(rootElement, function (element) {
        return element.getAttribute && element.getAttribute("aria-label") === "Adjust RGB Point Curve";
    })[0];
    assert.equal(refineSlider.min, "0");
    assert.equal(refineSlider.max, "100");
    assert.equal(refineEditor.value, "100");
    assert.equal(refineEditor.type, "text");
    assert.equal(refineEditor.inputMode, "numeric");
    assert.equal(refineEditor.getAttribute("autocomplete"), "off");
    assert.equal(refineEditor.getAttribute("autocapitalize"), "off");
    assert.equal(refineEditor.getAttribute("spellcheck"), "false");
    assert.equal(refineEditor.getAttribute("name"), undefined,
        "The Refine editor must not expose a payment-like form name");
    assert.equal(refineRowElement.className, "develop-slider-row point-curve-refine-row");
    assert.equal(refineDecrement.className, "develop-slider-step");
    assert.equal(refineIncrement.className, "develop-slider-step");
    assert.deepEqual(refineRowElement.children.map(function (element) {
        return element.getAttribute("aria-label") || element.textContent;
    }), [
        "Refine Sat.", "Refine Saturation", "Edit Refine Saturation value",
        "Decrease Refine Saturation", "Increase Refine Saturation", "Reset"
    ], "Refine Saturation must use the standard control order");
    assert.equal(findElements(rootElement, function (element) {
        return element.getAttribute && element.getAttribute("aria-label") ===
            "Authoritative Refine Saturation value";
    }).length, 0, "Refine Saturation must have one visible authoritative numeric field");
    assert.equal(refineRowElement.hidden, false);
    const stepRequestStart = requests.length;
    refineDecrement.dispatch("click");
    await flushController();
    assert.ok(controller.getState().awaitingRefine,
        "Refine minus must wait for authoritative Lightroom feedback");
    assert.equal(refineEditor.getAttribute("aria-busy"), "true",
        "Refine minus must preserve pending-state presentation");
    assert.ok(requests.slice(stepRequestStart).some(function (requestPath) {
        return requestPath.includes("/refine-saturation/gesture/end?") &&
            requestPath.includes("baseline=100") && requestPath.includes("value=99");
    }), "Refine minus must submit exactly one authoritative decrement");
    snapshot = Object.assign({}, snapshot, {
        revision: 2,
        updatedAt: currentTime + 1,
        refineSaturation: { value: 99, min: 0, max: 100 }
    });
    controller.applyAuthoritative(snapshot);
    await flushController();
    assert.equal(controller.getState().awaitingRefine, null);
    assert.equal(refineSlider.value, "99");
    assert.equal(refineEditor.value, "99");

    const incrementRequestStart = requests.length;
    refineIncrement.dispatch("click");
    await flushController();
    assert.ok(requests.slice(incrementRequestStart).some(function (requestPath) {
        return requestPath.includes("/refine-saturation/gesture/end?") &&
            requestPath.includes("baseline=99") && requestPath.includes("value=100");
    }), "Refine plus must submit exactly one authoritative increment");
    snapshot = Object.assign({}, snapshot, {
        revision: 3,
        updatedAt: currentTime + 2,
        refineSaturation: { value: 100, min: 0, max: 100 }
    });
    controller.applyAuthoritative(snapshot);
    await flushController();
    const upperBoundRequestCount = requests.length;
    refineIncrement.dispatch("click");
    await flushController();
    assert.equal(requests.length, upperBoundRequestCount,
        "Refine plus must clamp at Lightroom's authoritative maximum");

    snapshot = Object.assign({}, snapshot, {
        revision: 4,
        updatedAt: currentTime + 3,
        refineSaturation: { value: 0, min: 0, max: 100 }
    });
    controller.applyAuthoritative(snapshot);
    const lowerBoundRequestCount = requests.length;
    refineDecrement.dispatch("click");
    await flushController();
    assert.equal(requests.length, lowerBoundRequestCount,
        "Refine minus must clamp at Lightroom's authoritative minimum");
    snapshot = Object.assign({}, snapshot, {
        revision: 5,
        updatedAt: currentTime + 4,
        refineSaturation: { value: 100, min: 0, max: 100 }
    });
    controller.applyAuthoritative(snapshot);
    redButton.dispatch("click");
    assert.equal(refineRowElement.hidden, true, "Refine Saturation must disappear on individual channels");
    assert.equal(refineSlider.disabled, true);

    presetSelect.value = "Medium Contrast";
    presetSelect.dispatch("change");
    await flushController();
    assert.equal(controller.getState().selectedChannel, "rgb",
        "Selecting a preset from Red must switch the controller to RGB");
    assert.ok(controller.getState().awaitingPreset);
    assert.ok(requests.some(function (requestPath) {
        return requestPath.includes("/api/tone-curve/preset?preset=Medium%20Contrast") &&
            requestPath.includes("selectedPhotoUuid=browser-photo") &&
            requestPath.includes("contextCounter=12") && requestPath.includes("developCounter=18");
    }), "Preset command must carry the authoritative photo/context/Develop binding");
    snapshot = controllerSnapshot(linear, 2, currentTime + 1);
    snapshot.name = "Medium Contrast";
    snapshot.curves = {
        rgb: controllerToneCurve.presetCurve("Medium Contrast"),
        red: red.slice(), green: green.slice(), blue: blue.slice()
    };
    controller.applyAuthoritative(snapshot);
    assert.equal(controller.getState().awaitingPreset, null);
    assert.equal(presetSelect.value, "Medium Contrast");
    assert.deepEqual(controller.getState().authoritative.curves.red, red);
    assert.deepEqual(controller.getState().authoritative.curves.green, green);
    assert.deepEqual(controller.getState().authoritative.curves.blue, blue,
        "Authoritative preset feedback must preserve individual-channel isolation");

    snapshot = Object.assign({}, snapshot, { revision: 3, updatedAt: currentTime + 2, name: "Custom" });
    controller.applyAuthoritative(snapshot);
    assert.equal(presetSelect.value, "Custom", "Custom must render from authoritative ToneCurveName2012 feedback");
    const customOption = presetSelect.children.find(function (option) { return option.value === "Custom"; });
    assert.ok(customOption && customOption.disabled, "Custom must not be a selectable preset action");

    rejectStrong = true;
    presetSelect.value = "Strong Contrast";
    presetSelect.dispatch("change");
    await flushController();
    assert.equal(controller.getState().awaitingPreset, null);
    assert.equal(controller.getState().presetRequestInFlight, false,
        "A rejected preset command must immediately unlock the selector");
    assert.equal(presetSelect.value, "Custom");
    rejectStrong = false;

    presetSelect.value = "Linear";
    presetSelect.dispatch("change");
    await flushController();
    assert.ok(controller.getState().awaitingPreset);
    currentTime += 20;
    await controller.refresh();
    assert.equal(controller.getState().awaitingPreset, null,
        "A timed-out preset must recover to Lightroom authority without browser refresh");

    rgbButton.dispatch("click");
    refineSlider.value = "75";
    refineSlider.dispatch("pointerdown", { pointerId: 7 });
    refineSlider.dispatch("input");
    await flushController();
    assert.equal(controller.getState().refineGesture.awaitingAuthoritative, true);
    assert.equal(refineEditor.value, "100",
        "Local Refine movement must not be published as the authoritative numeric value");
    refineSlider.dispatch("pointerup", { pointerId: 7 });
    snapshot = Object.assign({}, snapshot, {
        revision: 4,
        updatedAt: currentTime + 1,
        refineSaturation: { value: 75, min: 0, max: 100 }
    });
    controller.applyAuthoritative(snapshot);
    await flushController();
    assert.ok(controller.getState().awaitingRefine,
        "Pointer-up must reach the terminal Refine end and await authoritative feedback");
    snapshot = Object.assign({}, snapshot, { revision: 5, updatedAt: currentTime + 2 });
    controller.applyAuthoritative(snapshot);
    assert.equal(controller.getState().awaitingRefine, null);
    assert.equal(refineEditor.value, "75");
    assert.ok(requests.some(function (requestPath) {
        return requestPath.includes("/refine-saturation/gesture/end?") &&
            requestPath.includes("baseline=75") && requestPath.includes("value=75");
    }), "Refine pointer-up must send a terminal, context-bound SDK gesture command");

    snapshot = Object.assign({}, snapshot, {
        revision: 6,
        updatedAt: currentTime + 3,
        refineSaturation: { value: 82, min: 0, max: 100 }
    });
    controller.applyAuthoritative(snapshot);
    assert.equal(refineEditor.value, "82",
        "An external Lightroom Refine Saturation change must update the controller without refresh");

    const refineReset = findElements(rootElement, function (element) {
        return element.className === "reset" && element.textContent === "Reset";
    })[0];
    refineReset.dispatch("click");
    await flushController();
    assert.ok(controller.getState().awaitingRefineReset);
    snapshot = Object.assign({}, snapshot, {
        revision: 7,
        updatedAt: currentTime + 4,
        refineSaturation: { value: 100, min: 0, max: 100 }
    });
    controller.applyAuthoritative(snapshot);
    assert.equal(controller.getState().awaitingRefineReset, null);
    assert.ok(requests.some(function (requestPath) {
        return requestPath.includes("/refine-saturation/reset?") && requestPath.includes("baseline=82");
    }), "Refine reset must use the authoritative baseline and dedicated reset route");

    refineEditor.focus();
    refineEditor.value = "7x";
    refineEditor.setSelectionRange(1, 1, "forward");
    snapshot = Object.assign({}, snapshot, {
        revision: 8,
        updatedAt: currentTime + 5,
        refineSaturation: { value: 90, min: 0, max: 100 }
    });
    controller.applyAuthoritative(snapshot);
    assert.equal(refineEditor.value, "7x",
        "Authoritative polling must not overwrite active Refine editor text");
    assert.equal(refineEditor.selectionStart, 1);
    assert.equal(refineEditor.selectionEnd, 1,
        "Authoritative polling must preserve the active Refine editor caret and selection");
    refineEditor.dispatch("keydown", { key: "Escape" });
    assert.equal(refineEditor.value, "90", "Escape must restore Lightroom's authoritative Refine value");
    assert.equal(controller.getState().refineGestureActive, false);

    refineEditor.focus();
    refineEditor.value = "75";
    refineEditor.dispatch("keydown", { key: "Enter" });
    await flushController();
    assert.ok(controller.getState().awaitingRefine, "Enter must commit through the tracked Refine gesture queue");
    assert.equal(refineEditor.value, "90",
        "A submitted editor value must not replace the authoritative display before Lightroom feedback");
    assert.equal(refineEditor.getAttribute("aria-busy"), "true");
    snapshot = Object.assign({}, snapshot, {
        revision: 9,
        updatedAt: currentTime + 6,
        refineSaturation: { value: 75, min: 0, max: 100 }
    });
    controller.applyAuthoritative(snapshot);
    assert.equal(controller.getState().awaitingRefine, null);
    assert.equal(refineEditor.value, "75");
    assert.equal(refineEditor.getAttribute("aria-busy"), "false");

    refineEditor.focus();
    refineEditor.value = "140";
    refineEditor.blur();
    await flushController();
    assert.ok(controller.getState().awaitingRefine, "Blur must commit the Refine editor");
    assert.ok(requests.some(function (requestPath) {
        return requestPath.includes("/refine-saturation/gesture/end?") && requestPath.includes("value=100");
    }), "Blur submission must clamp against Lightroom's authoritative 0..100 range");
    snapshot = Object.assign({}, snapshot, {
        revision: 10,
        updatedAt: currentTime + 7,
        refineSaturation: { value: 100, min: 0, max: 100 }
    });
    controller.applyAuthoritative(snapshot);
    assert.equal(refineEditor.value, "100");

    refineSlider.value = "60";
    refineSlider.dispatch("pointerdown", { pointerId: 8 });
    refineSlider.dispatch("input");
    await flushController();
    controller.applyContext({
        activeModule: "develop", selectedPhotoUuid: "other-feature-photo", contextCounter: 13, developCounter: 1
    });
    assert.equal(controller.getState().refineGestureActive, false);
    assert.equal(controller.getState().awaitingRefine, null);
    assert.equal(controller.getState().awaitingPreset, null,
        "Photo/context changes must clear every pending Refine and preset transaction");
    controller.deactivate();
}

async function controllerAdditionTests() {
    const documentObject = createFakeDocument();
    const windowObject = new FakeElement("window");
    let currentTime = 3000;
    let revision = 1;
    let requestMode = "ok";
    const curves = {
        rgb: interactionFixtures.eight.slice(), red: red.slice(),
        green: green.slice(), blue: blue.slice()
    };
    function makeSnapshot() {
        const value = controllerSnapshot(curves.rgb, revision, currentTime);
        value.curves = {
            rgb: curves.rgb.slice(), red: curves.red.slice(),
            green: curves.green.slice(), blue: curves.blue.slice()
        };
        return value;
    }
    let snapshot = makeSnapshot();
    const requests = [];
    const fetchImpl = function (requestPath, options) {
        requests.push(requestPath);
        if (requestPath === "/api/tone-curve/state") {
            return Promise.resolve(jsonResponse({ ok: true, pointCurve: snapshot }));
        }
        if (requestMode === "stale" && requestPath.includes("/gesture/begin?")) {
            return Promise.resolve(jsonResponse({ ok: false, error: "stale addition admission" }, 409));
        }
        if (requestMode === "rejected" && requestPath.includes("/gesture/end?")) {
            return Promise.resolve(jsonResponse({ ok: false, error: "addition rejected" }, 409));
        }
        if (requestMode === "request-timeout" && requestPath.includes("/gesture/begin?")) {
            return new Promise(function (_resolve, reject) {
                options.signal.addEventListener("abort", function () { reject(new Error("aborted")); }, { once: true });
            });
        }
        return Promise.resolve(jsonResponse({ ok: true }));
    };
    const controller = controllerToneCurve.createController({
        document: documentObject,
        window: windowObject,
        fetch: fetchImpl,
        now: function () { return currentTime; },
        requestTimeoutMs: 10,
        feedbackTimeoutMs: 10,
        setInterval: function () { return 25; },
        clearInterval: function () {}
    });
    controller.activate(Object.assign({ activeModule: "develop" }, snapshot));
    await flushController();

    const rootElement = controller.element;
    const svg = findElements(rootElement, function (element) {
        return element.classList && element.classList.contains("point-curve-graph");
    })[0];
    const addButton = findElements(rootElement, function (element) {
        return element.getAttribute && element.getAttribute("aria-label") === "Add point";
    })[0];
    assert.equal(addButton.textContent, "+ Add Point",
        "The one-shot Point Curve insertion control must expose its action visibly");
    assert.equal(addButton.getAttribute("aria-label"), "Add point",
        "The labelled insertion control must retain its concise accessible name");
    const instruction = findElements(rootElement, function (element) {
        return element.className === "point-curve-add-instruction";
    })[0];
    const redButton = findElements(rootElement, function (element) {
        return element.getAttribute && element.getAttribute("aria-label") === "Adjust Red Point Curve";
    })[0];
    const rgbButton = findElements(rootElement, function (element) {
        return element.getAttribute && element.getAttribute("aria-label") === "Adjust RGB Point Curve";
    })[0];
    function pointerProperties(pointerType, pointerId, x, y) {
        return { pointerType: pointerType, pointerId: pointerId, clientX: x, clientY: 255 - y };
    }
    function armAdd() {
        if (!controller.getState().addPointArmed) addButton.dispatch("click");
        assert.equal(controller.getState().addPointArmed, true);
        assert.equal(addButton.classList.contains("active"), true);
        assert.equal(addButton.getAttribute("aria-pressed"), "true");
        assert.equal(instruction.hidden, false);
        assert.equal(instruction.textContent, "Tap graph to add point");
    }
    function publishRgb(points) {
        curves.rgb = points.slice();
        revision += 1;
        currentTime += 1;
        snapshot = makeSnapshot();
        controller.applyAuthoritative(snapshot);
    }

    for (const pointerType of ["mouse", "touch"]) {
        const beforeRequests = requests.length;
        const event = pointerProperties(pointerType, pointerType === "mouse" ? 501 : 502, 48, 100);
        svg.dispatch("pointerdown", event);
        svg.dispatch("pointerup", event);
        await flushController();
        assert.equal(requests.slice(beforeRequests).some(function (path) {
            return path.includes("/gesture/");
        }), false, pointerType + " empty-graph input must do nothing in Select/Move mode");
        assert.deepEqual(controller.getState().authoritative.curves.rgb, curves.rgb);
    }

    for (const addition of [
        { pointerType: "mouse", pointerId: 510, x: 48, y: 104 },
        { pointerType: "touch", pointerId: 511, x: 80, y: 118 }
    ]) {
        const before = curves.rgb.slice();
        const expected = controllerToneCurve.addPoint(before, addition.x, addition.y);
        const identity = controllerToneCurve.createInsertionIdentity(before, expected.pointIndex);
        const requestStart = requests.length;
        armAdd();
        const event = pointerProperties(addition.pointerType, addition.pointerId, addition.x, addition.y);
        svg.dispatch("pointerdown", event);
        svg.dispatch("pointerup", event);
        await flushController();
        const transaction = controller.getState().awaitingTarget;
        assert.ok(transaction && transaction.operation === "add");
        assert.equal(controller.getState().addPointArmed, false,
            "Pointer-up must return one-shot addition to Select/Move mode");
        assert.deepEqual(transaction.points, expected.points,
            addition.pointerType + " tap must create exactly one point at its graph coordinate");
        assert.deepEqual(transaction.points.slice((expected.pointIndex + 1) * 2, (expected.pointIndex + 2) * 2),
            identity.right, "A simple addition must not modify its right-hand neighbor");
        const operationRequests = requests.slice(requestStart);
        assert.equal(operationRequests.filter(function (path) { return path.includes("/gesture/begin?"); }).length, 1);
        assert.equal(operationRequests.filter(function (path) { return path.includes("/gesture/end?"); }).length, 1,
            "Successful addition must produce exactly one completed Lightroom history gesture");
        publishRgb(transaction.points);
        assert.equal(controller.getState().awaitingTarget, null);
        assert.equal(controller.getState().selectedPointIndex, expected.pointIndex,
            "Successful authoritative addition feedback must keep the inserted point selected");
    }

    {
        const before = curves.rgb.slice();
        const expected = controllerToneCurve.addPoint(before, 112, 132);
        const identity = controllerToneCurve.createInsertionIdentity(before, expected.pointIndex);
        armAdd();
        const held = pointerProperties("touch", 520, 112, 132);
        svg.dispatch("pointerdown", held);
        const owningGestureId = controller.getState().gesture.id;
        svg.dispatch("pointerdown", pointerProperties("touch", 521, 120, 140));
        assert.equal(controller.getState().gesture.id, owningGestureId,
            "Additional pointers must not retarget an add gesture that owns capture");
        await flushController();
        assert.equal(controller.getState().gesture.awaitingAuthoritative, true);
        assert.deepEqual(identity.right,
            expected.points.slice((expected.pointIndex + 1) * 2, (expected.pointIndex + 2) * 2),
            "A long press without movement must leave the adjacent point unchanged");
        publishRgb(expected.points);
        assert.equal(controller.getState().gesture.pointIndex, expected.pointIndex,
            "Structural feedback must keep the active add gesture bound to the inserted point");
        svg.dispatch("pointerup", held);
        await flushController();
        assert.equal(controller.getState().addPointArmed, false);
        assert.ok(controller.getState().awaitingTarget);
        publishRgb(expected.points);
        assert.equal(controller.getState().selectedPointIndex, expected.pointIndex);
    }

    for (const drag of [
        { pointerType: "mouse", pointerId: 530, startX: 144, startY: 150, endX: 152, endY: 166 },
        { pointerType: "touch", pointerId: 531, startX: 184, startY: 188, endX: 194, endY: 176 }
    ]) {
        const before = curves.rgb.slice();
        const insertedAtStart = controllerToneCurve.addPoint(before, drag.startX, drag.startY);
        const identity = controllerToneCurve.createInsertionIdentity(before, insertedAtStart.pointIndex);
        armAdd();
        const start = pointerProperties(drag.pointerType, drag.pointerId, drag.startX, drag.startY);
        svg.dispatch("pointerdown", start);
        await flushController();
        publishRgb(insertedAtStart.points);
        assert.equal(controller.getState().gesture.pointIndex, insertedAtStart.pointIndex);
        const moved = controllerToneCurve.movePoint(
            insertedAtStart.points, insertedAtStart.pointIndex, drag.endX, drag.endY
        );
        const end = pointerProperties(drag.pointerType, drag.pointerId, drag.endX, drag.endY);
        svg.dispatch("pointermove", end);
        await flushController();
        publishRgb(moved);
        assert.deepEqual(moved.slice((insertedAtStart.pointIndex + 1) * 2,
            (insertedAtStart.pointIndex + 2) * 2), identity.right,
        drag.pointerType + " hold-drag must move only the newly inserted point, never its right neighbor");
        svg.dispatch("pointerup", end);
        await flushController();
        assert.ok(controller.getState().awaitingTarget);
        publishRgb(moved);
        assert.equal(controller.getState().selectedPointIndex, insertedAtStart.pointIndex);
        assert.equal(controller.getState().addPointArmed, false);
    }

    armAdd();
    addButton.dispatch("click");
    assert.equal(controller.getState().addPointArmed, false, "Pressing + again must cancel Add Point mode");
    armAdd();
    documentObject.dispatch("keydown", { key: "Escape" });
    assert.equal(controller.getState().addPointArmed, false, "Escape must cancel Add Point mode");
    armAdd();
    const escapeActive = pointerProperties("mouse", 539, 16, 90);
    svg.dispatch("pointerdown", escapeActive);
    documentObject.dispatch("keydown", { key: "Escape" });
    await flushController();
    assert.equal(controller.getState().addPointArmed, false);
    assert.equal(controller.getState().gestureActive, false,
        "Escape during an active addition must release the gesture and return to Select/Move mode");

    armAdd();
    const existingIndex = 1;
    const existingTarget = findElements(rootElement, function (element) {
        return element.classList && element.classList.contains("point-curve-hit-target") &&
            element.getAttribute("data-point-index") === String(existingIndex);
    })[0];
    const existingEvent = pointerProperties("touch", 540,
        curves.rgb[existingIndex * 2], curves.rgb[existingIndex * 2 + 1]);
    const existingRequestStart = requests.length;
    existingTarget.dispatch("pointerdown", existingEvent);
    svg.dispatch("pointerup", existingEvent);
    assert.equal(controller.getState().addPointArmed, false);
    assert.equal(controller.getState().selectedPointIndex, existingIndex,
        "An existing point pressed while armed must be selected without creating another point");
    assert.equal(requests.slice(existingRequestStart).some(function (path) { return path.includes("/gesture/"); }), false);

    armAdd();
    redButton.dispatch("click");
    assert.equal(controller.getState().addPointArmed, false, "Channel changes must cancel Add Point mode");
    rgbButton.dispatch("click");
    armAdd();
    windowObject.dispatch("offline");
    assert.equal(controller.getState().addPointArmed, false, "Connection changes must cancel Add Point mode");
    armAdd();
    documentObject.visibilityState = "hidden";
    documentObject.dispatch("visibilitychange");
    assert.equal(controller.getState().addPointArmed, false, "Visibility changes must cancel Add Point mode");
    documentObject.visibilityState = "visible";

    requestMode = "ok";
    armAdd();
    const cancelled = pointerProperties("touch", 550, 16, 90);
    svg.dispatch("pointerdown", cancelled);
    svg.dispatch("pointercancel", cancelled);
    await flushController();
    assert.equal(controller.getState().addPointArmed, false);
    assert.equal(controller.getState().gestureActive, false, "Pointer cancellation must terminally cancel addition");

    for (const failureMode of ["rejected", "stale", "request-timeout"]) {
        requestMode = failureMode;
        armAdd();
        const event = pointerProperties("mouse", 560 + failureMode.length, 16, 90);
        svg.dispatch("pointerdown", event);
        svg.dispatch("pointerup", event);
        if (failureMode === "request-timeout") {
            await new Promise(function (resolve) { setTimeout(resolve, 30); });
        }
        await flushController();
        assert.equal(controller.getState().addPointArmed, false);
        assert.equal(controller.getState().gestureActive, false);
        assert.equal(controller.getState().awaitingTarget, null,
            failureMode + " addition must terminate unlocked in Select/Move mode");
    }

    requestMode = "ok";
    armAdd();
    let event = pointerProperties("mouse", 570, 16, 90);
    svg.dispatch("pointerdown", event);
    svg.dispatch("pointerup", event);
    await flushController();
    assert.ok(controller.getState().awaitingTarget);
    revision += 1;
    currentTime += 1;
    snapshot = makeSnapshot();
    controller.applyAuthoritative(snapshot);
    assert.equal(controller.getState().awaitingTarget, null);
    assert.equal(controller.getState().addPointArmed, false,
        "Superseding Lightroom feedback must retire addition in Select/Move mode");

    armAdd();
    event = pointerProperties("touch", 571, 16, 90);
    svg.dispatch("pointerdown", event);
    svg.dispatch("pointerup", event);
    await flushController();
    assert.ok(controller.getState().awaitingTarget);
    currentTime += 20;
    await controller.refresh();
    assert.equal(controller.getState().awaitingTarget, null);
    assert.equal(controller.getState().addPointArmed, false,
        "Addition feedback timeout must restore Lightroom authority and Select/Move mode");

    armAdd();
    controller.applyContext({
        activeModule: "develop", selectedPhotoUuid: "addition-other-photo", contextCounter: 13, developCounter: 1
    });
    assert.equal(controller.getState().addPointArmed, false, "Photo/context changes must cancel Add Point mode");
    controller.deactivate();
}

async function controllerDeletionTests() {
    const documentObject = createFakeDocument();
    const windowObject = new FakeElement("window");
    let currentTime = 5000;
    let revision = 1;
    let requestMode = "ok";
    const curves = {
        rgb: interactionFixtures.eight.slice(),
        red: [0, 0, 32, 38, 64, 76, 128, 146, 192, 208, 255, 255],
        green: [0, 0, 28, 44, 72, 62, 116, 150, 180, 176, 222, 236, 255, 255],
        blue: interactionFixtures.thirteen.slice()
    };
    function makeSnapshot() {
        const value = controllerSnapshot(curves.rgb, revision, currentTime);
        value.curves = {
            rgb: curves.rgb.slice(), red: curves.red.slice(),
            green: curves.green.slice(), blue: curves.blue.slice()
        };
        return value;
    }
    let snapshot = makeSnapshot();
    const requests = [];
    const fetchImpl = function (requestPath, options) {
        requests.push(requestPath);
        if (requestPath === "/api/tone-curve/state") {
            return Promise.resolve(jsonResponse({ ok: true, pointCurve: snapshot }));
        }
        if (requestMode === "stale" && requestPath.includes("/gesture/begin?")) {
            return Promise.resolve(jsonResponse({ ok: false, error: "stale gesture admission" }, 409));
        }
        if (requestMode === "rejected" && requestPath.includes("/gesture/end?")) {
            return Promise.resolve(jsonResponse({ ok: false, error: "deletion rejected" }, 409));
        }
        if (requestMode === "request-timeout" && requestPath.includes("/gesture/begin?")) {
            return new Promise(function (_resolve, reject) {
                options.signal.addEventListener("abort", function () { reject(new Error("aborted")); }, { once: true });
            });
        }
        return Promise.resolve(jsonResponse({ ok: true }));
    };
    const controller = controllerToneCurve.createController({
        document: documentObject,
        window: windowObject,
        fetch: fetchImpl,
        now: function () { return currentTime; },
        requestTimeoutMs: 10,
        feedbackTimeoutMs: 10,
        setInterval: function () { return 30; },
        clearInterval: function () {}
    });
    controller.activate(Object.assign({ activeModule: "develop" }, snapshot));
    await flushController();

    const rootElement = controller.element;
    const svg = findElements(rootElement, function (element) {
        return element.classList && element.classList.contains("point-curve-graph");
    })[0];
    const deleteButton = findElements(rootElement, function (element) {
        return element.tagName === "button" && element.textContent === "Delete selected point";
    })[0];
    function channelButton(channel) {
        const label = channel === "rgb" ? "RGB" : channel.charAt(0).toUpperCase() + channel.slice(1);
        return findElements(rootElement, function (element) {
            return element.getAttribute && element.getAttribute("aria-label") === "Adjust " + label + " Point Curve";
        })[0];
    }
    function tapPoint(channel, pointIndex, pointerType, pointerId) {
        const points = curves[channel];
        const target = findElements(rootElement, function (element) {
            return element.classList && element.classList.contains("point-curve-hit-target") &&
                element.getAttribute("data-point-index") === String(pointIndex);
        })[0];
        const properties = {
            pointerId: pointerId,
            pointerType: pointerType,
            clientX: points[pointIndex * 2],
            clientY: 255 - points[pointIndex * 2 + 1]
        };
        target.dispatch("pointerdown", properties);
        svg.dispatch("pointerup", properties);
    }

    for (const pointerType of ["mouse", "touch"]) {
        for (let pointIndex = 1; pointIndex < curves.rgb.length / 2 - 1; pointIndex += 1) {
            tapPoint("rgb", pointIndex, pointerType, 100 + pointIndex);
            assert.equal(controller.getState().selectedPointIndex, pointIndex,
                pointerType + " must select RGB interior point " + pointIndex);
            assert.equal(deleteButton.disabled, false,
                "Every valid interior selection must enable Delete selected point");
            const pointGroup = findElements(rootElement, function (element) {
                return element.classList && element.classList.contains("point-curve-point") &&
                    element.getAttribute("data-point-index") === String(pointIndex);
            })[0];
            assert.ok(pointGroup.children.some(function (element) {
                return element.classList && element.classList.contains("point-curve-marker") &&
                    element.classList.contains("selected");
            }), "The selected point marker must be visibly highlighted");
        }
    }
    for (const endpoint of [0, curves.rgb.length / 2 - 1]) {
        tapPoint("rgb", endpoint, "touch", 200 + endpoint);
        assert.equal(controller.getState().selectedPointIndex, endpoint);
        assert.equal(deleteButton.disabled, true, "X=0 and X=255 endpoints must never be deletable");
    }

    for (const channel of controllerToneCurve.CHANNELS) {
        channelButton(channel).dispatch("click");
        tapPoint(channel, 1, "touch", 300 + controllerToneCurve.CHANNELS.indexOf(channel));
        const before = Object.fromEntries(controllerToneCurve.CHANNELS.map(function (name) {
            return [name, curves[name].slice()];
        }));
        const requestStart = requests.length;
        deleteButton.dispatch("click");
        await flushController();
        const transaction = controller.getState().awaitingTarget;
        assert.ok(transaction && transaction.operation === "delete",
            channel + " deletion must wait for authoritative Point Curve feedback");
        assert.equal(controller.getState().selectedPointIndex, 1,
            "A queued deletion must retain selection until Lightroom settles it");
        const operationRequests = requests.slice(requestStart);
        assert.equal(operationRequests.filter(function (path) { return path.includes("/gesture/begin?"); }).length, 1);
        assert.equal(operationRequests.filter(function (path) { return path.includes("/gesture/end?"); }).length, 1,
            "A deletion must produce one tracked begin/end Lightroom history gesture");
        assert.deepEqual(transaction.points, controllerToneCurve.deletePoint(before[channel], 1),
            "Deletion must remove exactly the selected authoritative point pair");
        curves[channel] = transaction.points.slice();
        revision += 1;
        currentTime += 1;
        snapshot = makeSnapshot();
        controller.applyAuthoritative(snapshot);
        assert.equal(controller.getState().awaitingTarget, null);
        assert.equal(controller.getState().selectedPointIndex, null,
            "Matching deletion feedback must clear the deleted selection");
        assert.equal(deleteButton.disabled, true);
        for (const isolatedChannel of controllerToneCurve.CHANNELS) {
            if (isolatedChannel !== channel) assert.deepEqual(curves[isolatedChannel], before[isolatedChannel],
                channel + " deletion must not alter " + isolatedChannel);
        }
    }

    channelButton("rgb").dispatch("click");
    requestMode = "rejected";
    tapPoint("rgb", 1, "mouse", 401);
    deleteButton.dispatch("click");
    await flushController();
    assert.equal(controller.getState().gestureActive, false);
    assert.equal(controller.getState().awaitingTarget, null);
    assert.equal(deleteButton.disabled, false, "A rejected deletion must unlock with its selection intact");

    requestMode = "stale";
    deleteButton.dispatch("click");
    await flushController();
    assert.equal(controller.getState().gestureActive, false);
    assert.equal(controller.getState().awaitingTarget, null);
    assert.equal(deleteButton.disabled, false, "A stale admission must terminate and unlock");

    requestMode = "request-timeout";
    deleteButton.dispatch("click");
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
    await flushController();
    assert.equal(controller.getState().gestureActive, false);
    assert.equal(controller.getState().awaitingTarget, null);
    assert.equal(deleteButton.disabled, false, "A timed-out deletion request must terminate and unlock");

    requestMode = "ok";
    deleteButton.dispatch("click");
    await flushController();
    assert.ok(controller.getState().awaitingTarget);
    const superseding = curves.rgb.slice();
    superseding[3] = Math.min(255, superseding[3] + 1);
    curves.rgb = superseding;
    revision += 1;
    currentTime += 1;
    snapshot = makeSnapshot();
    controller.applyAuthoritative(snapshot);
    assert.equal(controller.getState().awaitingTarget, null);
    assert.equal(deleteButton.disabled, false,
        "A newer differing authoritative curve must supersede deletion and unlock");

    deleteButton.dispatch("click");
    await flushController();
    assert.ok(controller.getState().awaitingTarget);
    currentTime += 20;
    await controller.refresh();
    assert.equal(controller.getState().awaitingTarget, null);
    assert.equal(deleteButton.disabled, false, "Deletion feedback timeout must restore interaction");

    deleteButton.dispatch("click");
    await flushController();
    assert.ok(controller.getState().awaitingTarget);
    controller.applyContext({
        activeModule: "develop", selectedPhotoUuid: "deletion-other-photo", contextCounter: 13, developCounter: 1
    });
    assert.equal(controller.getState().awaitingTarget, null);
    assert.equal(controller.getState().gestureActive, false,
        "Photo/context navigation must cancel pending deletion state");
    controller.deactivate();
}

function exerciseMultiPointAdmissions() {
    for (const [fixtureName, fixture] of Object.entries(interactionFixtures)) {
        const state = pointCurve.createPointCurveState();
        const binding = { selectedPhotoUuid: "multi-" + fixtureName, contextCounter: 4, developCounter: 9 };
        const fields = Object.assign({ activeModule: "develop" }, binding);
        state.syncContext(fields);
        let current = fixture.slice();
        const curves = { rgb: current.slice(), red: current.slice(), green: current.slice(), blue: current.slice() };
        assert.equal(state.acceptFeedback(Object.assign({
            name: "Custom", curves: curves, refineSaturation: refineSaturation
        }, binding), fields), true);
        for (let pointIndex = 1; pointIndex < current.length / 2 - 1; pointIndex += 1) {
            const gestureId = fixtureName + "_point_" + pointIndex;
            const target = controllerToneCurve.movePoint(
                current, pointIndex, current[pointIndex * 2], Math.min(255, current[pointIndex * 2 + 1] + 1)
            );
            assert.equal(state.beginGesture(binding, "blue", gestureId, current, fields), true);
            assert.equal(state.updateGesture(binding, "blue", gestureId, current, target, fields), true);
            assert.equal(state.endGesture(binding, "blue", gestureId, current, target, fields), true);
            assert.equal(state.finishGesture(binding, "blue", gestureId), true);
            curves.blue = target.slice();
            assert.equal(state.acceptFeedback(Object.assign({
                name: "Custom", curves: curves, refineSaturation: refineSaturation
            }, binding), fields), true);
            current = target;
        }
        assert.equal(state.getGestureDiagnostics().count, 0,
            fixtureName + " sequential gestures must leave no abandoned admission");
    }
}

exerciseMultiPointAdmissions();

async function integration() {
    commands.resetQueueForTests();
    const bridge = createBridge({
        httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 40
    });
    const originalLog = console.log;
    console.log = function () {};
    try {
        await bridge.start();
        const uuid = "point-curve-route-photo-" + Date.now();
        const contextResponse = await get(bridge, "/context/update?" + routeQuery({
            activeModule: "develop", selectedPhotoUuid: uuid, selectedPhotoKey: uuid,
            developFingerprint: "point-curve-route-linear-" + Date.now()
        }));
        assert.equal(contextResponse.status, 200);
        let binding = {
            selectedPhotoUuid: uuid,
            contextCounter: contextResponse.body.contextCounter,
            developCounter: contextResponse.body.developCounter
        };
        const curves = { rgb: linear.slice(), red: linear.slice(), green: linear.slice(), blue: linear.slice() };
        assert.equal((await get(bridge, "/tone-curve/feedback?" + feedbackQuery(binding, curves, "Linear"))).status, 200);
        const state = await get(bridge, "/tone-curve/state");
        assert.equal(state.body.pointCurve.available, true);
        assert.deepEqual(state.body.pointCurve.curves, curves);
        assert.deepEqual(state.body.pointCurve.refineSaturation, refineSaturation,
            "Server state must expose the authoritative Lightroom Refine Saturation value and range");
        curves.rgb[1] = 99;
        assert.deepEqual((await get(bridge, "/tone-curve/state")).body.pointCurve.curves.rgb, linear,
            "Server state must clone feedback and never expose mutable fabricated state");

        const refineBegin = "/tone-curve/refine-saturation/gesture/begin?" + routeQuery(Object.assign({
            gestureId: "refine_route_1", baseline: 100
        }, bindingQuery(binding)));
        const refineUpdate = "/tone-curve/refine-saturation/gesture/update?" + routeQuery(Object.assign({
            gestureId: "refine_route_1", baseline: 100, value: 75
        }, bindingQuery(binding)));
        const refineEnd = "/tone-curve/refine-saturation/gesture/end?" + routeQuery(Object.assign({
            gestureId: "refine_route_1", baseline: 100, value: 80
        }, bindingQuery(binding)));
        assert.equal((await get(bridge, refineBegin)).status, 200);
        assert.equal((await get(bridge, refineUpdate)).status, 200);
        assert.equal((await get(bridge, refineEnd)).status, 200);
        const refineCommands = drain();
        assert.deepEqual(refineCommands.map(function (command) { return command.command; }), [
            "tone_curve.refine_saturation.gesture.begin",
            "tone_curve.refine_saturation.gesture.end"
        ], "Refine drag updates must coalesce to a tracked begin and terminal end");
        assert.equal(refineCommands[0].field, "CurveRefineSaturation");
        assert.equal(refineCommands[1].value, 80);
        assert.equal(refineCommands[1].expectedSelectedPhotoUuid, uuid);
        assert.equal(refineCommands[1].expectedContextCounter, binding.contextCounter);
        assert.equal(refineCommands[1].expectedDevelopCounter, binding.developCounter);

        assert.equal((await get(bridge, "/tone-curve/refine-saturation/reset?" + routeQuery(Object.assign({
            baseline: 100
        }, bindingQuery(binding))))).status, 200);
        assert.deepEqual(commands.getNextCommand(), {
            command: "tone_curve.refine_saturation.reset",
            field: "CurveRefineSaturation",
            expectedSelectedPhotoUuid: uuid,
            expectedContextCounter: binding.contextCounter,
            expectedDevelopCounter: binding.developCounter,
            expectedValue: 100
        });

        for (const presetName of ["Linear", "Medium Contrast", "Strong Contrast"]) {
            const presetResponse = await get(bridge, "/tone-curve/preset?" + routeQuery(Object.assign({
                preset: presetName,
                baseline: pointCurve.serializeCurve(linear)
            }, bindingQuery(binding))));
            assert.equal(presetResponse.status, 200);
            const presetCommand = commands.getNextCommand();
            assert.equal(presetCommand.command, "tone_curve.preset.set");
            assert.equal(presetCommand.preset, presetName);
            assert.equal(presetCommand.field, "ToneCurvePV2012");
            assert.deepEqual(presetCommand.expectedPoints, linear);
            assert.deepEqual(presetCommand.points, pointCurve.presetCurve(presetName));
            assert.equal(Object.prototype.hasOwnProperty.call(presetCommand, "red"), false);
            assert.equal(Object.prototype.hasOwnProperty.call(presetCommand, "green"), false);
            assert.equal(Object.prototype.hasOwnProperty.call(presetCommand, "blue"), false,
                "Preset commands must carry only the RGB Point Curve target");
        }
        assert.equal((await get(bridge, "/tone-curve/preset?" + routeQuery(Object.assign({
            preset: "Custom", baseline: pointCurve.serializeCurve(linear)
        }, bindingQuery(binding))))).status, 409, "Custom must not be selectable as a preset action");

        assert.equal((await get(bridge, "/tone-curve/gesture/begin?" +
            gestureQuery(binding, "green", "abandoned_1", linear))).status, 200);
        assert.equal((await get(bridge, "/tone-curve/gesture/begin?" +
            gestureQuery(binding, "green", "replacement_1", linear))).status, 200,
        "A stale admission must not block the next gesture on the channel");
        const replacementCommands = drain();
        assert.deepEqual(replacementCommands.map(function (command) { return command.command; }), [
            "tone_curve.gesture.cancel", "tone_curve.gesture.begin"
        ], "Replacing an abandoned gesture must cancel Lightroom tracking before the next begin");
        assert.equal((await get(bridge, "/tone-curve/gesture/cancel?" + routeQuery(Object.assign({
            channel: "green", gestureId: "replacement_1"
        }, bindingQuery(binding))))).status, 200);
        assert.equal((await get(bridge, "/diagnostics/queue")).body.pointCurveGestures.count, 0);
        assert.equal(commands.getNextCommand().command, "tone_curve.gesture.cancel");

        assert.equal((await get(bridge, "/tone-curve/gesture/begin?" +
            gestureQuery(binding, "red", "stale_update_1", linear))).status, 200);
        assert.equal((await get(bridge, "/tone-curve/gesture/update?" +
            gestureQuery(binding, "red", "stale_update_1", red, green))).status, 409);
        assert.equal((await get(bridge, "/diagnostics/queue")).body.pointCurveGestures.count, 0,
            "A failed stale update must release its server admission");
        assert.deepEqual(drain().map(function (command) { return command.command; }), ["tone_curve.gesture.cancel"]);

        const beginPath = "/tone-curve/gesture/begin?" + gestureQuery(binding, "green", "gesture_1", linear);
        assert.equal((await get(bridge, beginPath)).status, 200);
        const updateOne = [0, 0, 96, 100, 255, 255];
        const updateTwo = [0, 0, 96, 108, 255, 255];
        assert.equal((await get(bridge, "/tone-curve/gesture/update?" + gestureQuery(binding, "green", "gesture_1", linear, updateOne))).status, 200);
        assert.equal((await get(bridge, "/tone-curve/gesture/update?" + gestureQuery(binding, "green", "gesture_1", linear, updateTwo))).status, 200);
        assert.equal((await get(bridge, "/tone-curve/gesture/end?" + gestureQuery(binding, "green", "gesture_1", linear, green))).status, 200);
        const gestureDiagnostics = commands.getQueueDiagnostics();
        assert.equal(gestureDiagnostics.queue.pending.byCommand["tone_curve.gesture.begin"], 1);
        assert.equal(gestureDiagnostics.queue.pending.byCommand["tone_curve.gesture.update"], 0);
        assert.equal(gestureDiagnostics.queue.pending.byCommand["tone_curve.gesture.end"], 1);
        assert.equal(gestureDiagnostics.queue.pending.ordinary, 2);
        const coalesced = drain();
        assert.equal(coalesced.length, 2, "Gesture drag updates must coalesce to begin plus one latest completion");
        assert.equal(coalesced[0].command, "tone_curve.gesture.begin");
        assert.equal(coalesced[0].field, "ToneCurvePV2012Green");
        assert.equal(coalesced[1].command, "tone_curve.gesture.end");
        assert.deepEqual(coalesced[1].points, green);

        const reset = await get(bridge, "/tone-curve/reset?" + routeQuery(Object.assign({
            channel: "blue", baseline: pointCurve.serializeCurve(linear)
        }, bindingQuery(binding))));
        assert.equal(reset.status, 200);
        assert.deepEqual(commands.getNextCommand(), {
            command: "tone_curve.reset",
            channel: "blue",
            field: "ToneCurvePV2012Blue",
            expectedSelectedPhotoUuid: uuid,
            expectedContextCounter: binding.contextCounter,
            expectedDevelopCounter: binding.developCounter,
            expectedPoints: linear
        });

        const advanced = await get(bridge, "/context/update?" + routeQuery({
            activeModule: "develop", selectedPhotoUuid: uuid, selectedPhotoKey: uuid,
            developFingerprint: "point-curve-route-custom-" + Date.now()
        }));
        assert.equal(advanced.body.developCounter, binding.developCounter + 1);
        assert.equal((await get(bridge, "/tone-curve/state")).body.pointCurve.available, false,
            "A Develop revision must immediately invalidate the old graph snapshot");
        assert.equal((await get(bridge, "/tone-curve/feedback?" + feedbackQuery(binding, {
            rgb: composite, red: linear, green: linear, blue: linear
        }, "Custom"))).status, 409, "Old-counter feedback must be rejected");
        assert.equal((await get(bridge, beginPath)).status, 409, "Old-counter commands must be rejected");
        assert.equal(commands.getNextCommand().command, "tone_curve.gesture.cancel",
            "A rejected stale gesture must still schedule terminal Lightroom cleanup");

        const staleCommand = {
            command: "tone_curve.reset", channel: "rgb", field: "ToneCurvePV2012",
            expectedSelectedPhotoUuid: uuid, expectedContextCounter: binding.contextCounter,
            expectedDevelopCounter: binding.developCounter, expectedPoints: linear
        };
        assert.equal(commands.tryEnqueueCommand(staleCommand).accepted, true);
        assert.equal(commands.getNextCommand(), null, "A curve command that becomes stale in the queue must be discarded");

        binding = {
            selectedPhotoUuid: uuid,
            contextCounter: advanced.body.contextCounter,
            developCounter: advanced.body.developCounter
        };
        assert.equal((await get(bridge, "/tone-curve/feedback?" + feedbackQuery(binding, {
            rgb: composite, red: linear, green: linear, blue: linear
        }, "Custom"))).status, 200);
        const accepted = (await get(bridge, "/tone-curve/state")).body.pointCurve;
        assert.deepEqual(accepted.curves.red, linear);
        assert.deepEqual(accepted.curves.green, linear);
        assert.deepEqual(accepted.curves.blue, linear);
        assert.deepEqual(accepted.curves.rgb, composite, "Only the targeted authoritative channel may change");

        assert.equal((await get(bridge, "/tone-curve/gesture/begin?" +
            gestureQuery(binding, "blue", "navigation_cancel_1", linear))).status, 200);

        const navigated = await get(bridge, "/context/update?" + routeQuery({
            activeModule: "develop", selectedPhotoUuid: uuid + "-other", selectedPhotoKey: uuid + "-other",
            developFingerprint: "point-curve-other-photo"
        }));
        assert.notEqual(navigated.body.contextCounter, binding.contextCounter);
        assert.deepEqual(drain().map(function (command) { return command.command; }), ["tone_curve.gesture.cancel"],
            "Photo navigation must terminally cancel an admitted gesture");
        assert.equal((await get(bridge, "/tone-curve/state")).body.pointCurve.available, false,
            "Photo UUID/context navigation must invalidate the prior graph immediately");
    } finally {
        console.log = originalLog;
        await bridge.stop();
        commands.resetQueueForTests();
    }
}

controllerInteractionTests().then(controllerRefineAndPresetTests).then(controllerAdditionTests)
    .then(controllerDeletionTests).then(integration).then(function () {
    console.log("Point Curve authoritative SDK, server, queue, and controller tests passed.");
}).catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
