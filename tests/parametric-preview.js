"use strict";
const assert = require("node:assert/strict"), path = require("node:path");
const curve = require(process.env.LRBRIDGE_PARAMETRIC_SOURCE || "../app/controller-tone-curve");
const observed = require("./fixtures/parametric-lightroom-graphs.json");
const fields = Object.values(curve.PARAMETRIC_CURVE_FIELDS);
const state = (amounts, splits) => Object.fromEntries(fields.map((key, i) => [key, [...amounts, ...splits][i]]));
const linear = [0, 0, 255, 255];
const regressions = [[60, -35, -20, -10], [100, -64, -58, -44]];
for (const amounts of regressions) for (const splits of [[25, 50, 75], [10, 20, 75], [45, 60, 85], [20, 55, 90]]) {
    const values = state(amounts, splits);
    let previous = 0;
    for (let x = 0; x <= 100; x += .125) {
        const y = curve.parametricCurveOutputAt(values, linear, x);
        assert(Number.isFinite(y) && y >= 0 && y <= 100);
        assert(y >= previous - 1e-8, "False Parametric-only reversal at " + x + " with splits " + splits);
        previous = y;
    }
}
function at(segments, x) {
    const s = segments.find(s => x <= s.x1 + 1e-8) || segments.at(-1), t = (x - s.x0) / (s.x1 - s.x0), u = 1 - t;
    return u*u*u*s.y0 + 3*u*u*t*s.c1y + 3*u*t*t*s.c2y + t*t*t*s.y1;
}
const metrics = [];
for (const fixture of observed) {
    const segments = curve.parametricDisplaySegments(fixture.values, fixture.rgbCurve);
    const deltas = fixture.samples.map(([x, y]) => {
        const computed = curve.parametricCurveOutputAt(fixture.values, fixture.rgbCurve, x);
        const rendered = at(segments, x * 2.55) / 2.55;
        assert(Math.abs(computed-y) <= fixture.tolerance, fixture.id + " exceeds measured Lightroom tolerance at " + x + ": " + computed + " vs " + y);
        assert(Math.abs(rendered-y) <= fixture.tolerance, fixture.id + " rendered path exceeds measured Lightroom tolerance at " + x);
        return rendered-y;
    });
    metrics.push({ id: fixture.id, max: Math.max(...deltas.map(Math.abs)), rmse: Math.sqrt(deltas.reduce((sum, x) => sum+x*x, 0)/deltas.length) });
}
// Curve shape/representation checks are mathematical regressions. Separate
// native graph fixtures establish the Parametric/RGB display independence.
const turning = [0, 18, 64, 118, 128, 72, 192, 222, 255, 236];
const neutral = state([0, 0, 0, 0], [10, 20, 75]);
assert.equal(curve.parametricCurvePathData(neutral, turning), curve.curvePathData(linear),
    "Neutral Parametric display remains diagonal independently of the RGB point curve");
for (const amounts of [[0, 0, 0, 0], [10, -20, 25, -15]]) {
    const values = state(amounts, [30, 55, 80]), segments = curve.parametricDisplaySegments(values, turning);
    assert.equal(segments[0].y0, 0);
    assert.equal(segments.at(-1).y1, 255);
    assert.equal(curve.parametricCurvePathData(values, turning), curve.parametricCurvePathData(values, linear));
    const pointSegments = curve.curveSegments(turning);
    assert.equal(pointSegments[0].y0, 18);
    assert.equal(pointSegments.at(-1).y1, 236);
    assert(at(pointSegments, 128) < at(pointSegments, 64), "The separate Point Curve must retain intentional RGB reversals");
}
for (const amounts of [[-100, -100, -100, -100], [100, 100, 100, 100], [-100, 100, -100, 100], [100, -100, 100, -100]])
for (const splits of [[10, 20, 30], [70, 80, 90], [10, 80, 90], [25, 50, 75]]) {
    const values = state(amounts, splits), segments = curve.parametricDisplaySegments(values, linear);
    let previous = -1;
    for (let x = 0; x <= 255; x += .25) {
        const y = at(segments, x), exact = curve.parametricCurveOutputAt(values, linear, x / 2.55) * 2.55;
        assert(y >= previous - 1e-7 && y >= -1e-7 && y <= 255 + 1e-7);
        assert(Math.abs(y-exact) <= .15, "SVG approximation must stay close to the actual model even in narrow/extreme regions");
        previous = y;
    }
}
console.log("PASS recorded reversal cases, nine recorded Lightroom graph fixtures (unchanged ±2.5 tolerance; six calibration/three validation), RGB shape/endpoints and narrow/extreme SVG representation checks.");
console.log(JSON.stringify(metrics));
