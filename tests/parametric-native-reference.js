"use strict";
const assert = require("node:assert/strict");
const curve = require(process.env.LRBRIDGE_PARAMETRIC_SOURCE || "../app/controller-tone-curve");
const references = require("./fixtures/parametric-lightroom-native-20261001.json");
function displayedAt(segments, x) {
    const s = segments.find(s => x <= s.x1) || segments.at(-1);
    const t = (x - s.x0) / (s.x1 - s.x0), u = 1 - t;
    return (u*u*u*s.y0 + 3*u*u*t*s.c1y + 3*u*t*t*s.c2y + t*t*t*s.y1) / 2.55;
}
const results = [];
for (const reference of references.cases) {
    const segments = curve.parametricDisplaySegments(reference.values, reference.rgbCurve);
    const errors = reference.samples.map(([x, measured]) => {
        const evaluated = curve.parametricCurveOutputAt(reference.values, reference.rgbCurve, x);
        const displayed = displayedAt(segments, x * 2.55);
        assert(Math.abs(evaluated - measured) <= reference.tolerance,
            `${reference.id}: computed ${evaluated} vs native ${measured} at ${x}`);
        assert(Math.abs(displayed - measured) <= reference.tolerance,
            `${reference.id}: displayed ${displayed} vs native ${measured} at ${x}`);
        return displayed - measured;
    });
    results.push({ id: reference.id, max: Math.max(...errors.map(Math.abs)),
        rmse: Math.sqrt(errors.reduce((sum, error) => sum + error*error, 0) / errors.length) });
}
// Native neutral/non-linear and identical asymmetric before/after RGB graphs
// establish that Lightroom displays the Parametric function independently.
const neutral = references.cases.find(c => c.id === "rgb-neutral");
assert.equal(curve.parametricCurvePathData(neutral.values, neutral.rgbCurve), curve.curvePathData([0,0,255,255]));
const asymmetric = references.cases.find(c => c.id === "asymmetric");
const combined = references.cases.find(c => c.id === "rgb-combined");
assert.deepEqual(asymmetric.values, combined.values);
assert.equal(curve.parametricCurvePathData(asymmetric.values, asymmetric.rgbCurve),
    curve.parametricCurvePathData(combined.values, combined.rgbCurve));
const turning = references.cases.find(c => c.id === "rgb-turning");
// The Point Curve path itself must still show the user's deliberate turn and
// lifted endpoints. Neither measurement nor Parametric rendering may mutate it.
const original = turning.rgbCurve.slice();
const pointSegments = curve.curveSegments(original);
assert.equal(pointSegments[0].y0, 18);
assert.equal(pointSegments.at(-1).y1, 236);
assert(curve.evaluatePointCurve(original, 128) < curve.evaluatePointCurve(original, 64));
curve.parametricCurvePathData(turning.values, original);
assert.deepEqual(original, turning.rgbCurve);
console.log("PASS six independent native Lightroom graphs: default/narrow/asymmetric splits, mixed signs, non-linear RGB isolation and preserved Point Curve turns/endpoints. No fitting to these samples.");
console.log(JSON.stringify(results));
