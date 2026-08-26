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
        blue: pointCurve.serializeCurve(curves.blue)
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

const transactionSnapshot = controllerToneCurve.normalizeSnapshot({
    available: true,
    selectedPhotoUuid: "transaction-photo",
    contextCounter: 7,
    developCounter: 11,
    revision: 30,
    name: "Custom",
    curves: { rgb: composite, red: red, green: green, blue: blue }
});
const transaction = controllerToneCurve.createAwaitingTarget(
    { id: "transaction_gesture", channel: "green" }, green, transactionSnapshot, 100
);
assert.deepEqual(Object.keys(transaction).sort(), [
    "channel", "contextCounter", "gestureId", "points", "selectedPhotoUuid", "submittedAt",
    "submittedDevelopCounter", "submittedRevision", "submittedUpdatedAt"
].sort(), "Pending writes must bind gesture, photo, context, Develop counter, revision, channel, and target");
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
assert.equal(controllerToneCurve.remapSelectedPointIndex(
    interactionFixtures.thirteen, interactionFixtures.six, 6
), null, "A structural change must clear a selected point that cannot be safely remapped");

const canonicalA = "scalars|ToneCurvePV2012=" + pointCurve.serializeCurve(linear) +
    "|ToneCurvePV2012Red=" + pointCurve.serializeCurve(linear) +
    "|ToneCurvePV2012Green=" + pointCurve.serializeCurve(linear) +
    "|ToneCurvePV2012Blue=" + pointCurve.serializeCurve(linear) + "|ToneCurveName2012=Linear";
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
assert.doesNotMatch(luaToneCurve, /LrDevelopController\.getRange/,
    "The misleading -100..100 SDK range must never define Point Curve coordinates");
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
for (const phase of ["begin", "update", "end", "cancel"]) {
    assert.ok(luaCommands.includes('command.command == "tone_curve.gesture.' + phase + '"'));
}
for (const field of ["channel", "gestureId", "expectedSelectedPhotoUuid", "expectedDevelopCounter", "points", "expectedPoints"]) {
    assert.match(luaParser, new RegExp("\\b" + field + " = " + field + "\\b"));
}

assert.ok(controllerHtml.indexOf("pointCurveController.element") < controllerHtml.indexOf('title.textContent = "Parametric Curve"'),
    "POINT CURVE must render before the accepted PARAMETRIC CURVE section");
assert.match(controllerHtml, /\.point-curve-graph[\s\S]*aspect-ratio: 1 \/ 1|\.point-curve-graph-shell[\s\S]*aspect-ratio: 1 \/ 1/);
const pointCurveControllerSource = read("app/controller-tone-curve.js");
assert.match(pointCurveControllerSource, /addEventListener\("pointerdown"/);
assert.match(pointCurveControllerSource, /addEventListener\("pointermove"/);
assert.match(pointCurveControllerSource, /255 - segment\.y1/,
    "SVG output coordinates must invert native Y so 0 is at the bottom");
assert.match(pointCurveControllerSource, /svgElement\("line", \{\s*class: "point-curve-reference"/,
    "The diagonal linear reference must be a separate SVG element from the active path");
assert.match(pointCurveControllerSource,
    /function curveSegments\(points\) \{\s*const slopes = adobeSplineSlopes\(points\);[\s\S]*c1y: y0 \+ slopes\[index\] \* width \/ 3[\s\S]*c2y: y1 - slopes\[index \+ 1\] \* width \/ 3/,
    "Production segments must use raw Adobe slopes without mathematical limiting");
assert.doesNotMatch(pointCurveControllerSource, /shapePreservingSlopes|boundPathCoordinate/,
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
}

function createFakeDocument() {
    const documentObject = new FakeElement("document");
    documentObject.visibilityState = "visible";
    documentObject.createElement = function (name) { return new FakeElement(name); };
    documentObject.createElementNS = function (_namespace, name) { return new FakeElement(name); };
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
    hitTarget.dispatch("click");
    const input = findElements(rootElement, function (element) {
        return element.getAttribute && element.getAttribute("aria-label") === "Selected point input";
    })[0];
    const output = findElements(rootElement, function (element) {
        return element.getAttribute && element.getAttribute("aria-label") === "Selected point output";
    })[0];
    assert.equal(input.textContent, String(interactionFixtures.eight[6]));
    assert.equal(output.textContent, String(interactionFixtures.eight[7]),
        "Selected Input/Output must reflect the authoritative array");

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
    const immediatePreview = interactionFixtures.eight.slice();
    immediatePreview[7] = 100;
    assert.equal(previewPath.getAttribute("d"), controllerToneCurve.curvePathData(immediatePreview),
        "The unchanged Adobe spline must render a synchronous local drag preview");
    assert.equal(previewMarker.getAttribute("cy"), "155",
        "The visible drag marker must follow the pointer before any HTTP response");
    svg.dispatch("pointermove", { pointerId: 1, clientX: 98, clientY: 153 });
    const movedPreview = interactionFixtures.eight.slice();
    movedPreview[6] = 98;
    movedPreview[7] = 102;
    assert.equal(previewPath.getAttribute("d"), controllerToneCurve.curvePathData(movedPreview),
        "Every pointer move must update the local preview synchronously");
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
    svg.dispatch("pointerup", { pointerId: 2, clientX: 129, clientY: 99 });
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
    svg.dispatch("pointerup", { pointerId: 3, clientX: 103, clientY: 125 });
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

function exerciseMultiPointAdmissions() {
    for (const [fixtureName, fixture] of Object.entries(interactionFixtures)) {
        const state = pointCurve.createPointCurveState();
        const binding = { selectedPhotoUuid: "multi-" + fixtureName, contextCounter: 4, developCounter: 9 };
        const fields = Object.assign({ activeModule: "develop" }, binding);
        state.syncContext(fields);
        let current = fixture.slice();
        const curves = { rgb: current.slice(), red: current.slice(), green: current.slice(), blue: current.slice() };
        assert.equal(state.acceptFeedback(Object.assign({ name: "Custom", curves: curves }, binding), fields), true);
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
            assert.equal(state.acceptFeedback(Object.assign({ name: "Custom", curves: curves }, binding), fields), true);
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
        curves.rgb[1] = 99;
        assert.deepEqual((await get(bridge, "/tone-curve/state")).body.pointCurve.curves.rgb, linear,
            "Server state must clone feedback and never expose mutable fabricated state");

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

controllerInteractionTests().then(integration).then(function () {
    console.log("Point Curve authoritative SDK, server, queue, and controller tests passed.");
}).catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
