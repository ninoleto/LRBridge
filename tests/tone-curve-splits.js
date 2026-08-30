const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const controller = fs.readFileSync(path.join(root, "app/controller.html"), "utf8");
const metadata = require("../config/sliders.json");
const sliders = require("../server/sliders");
const commands = require("../server/commands");
const toneCurve = require("../app/controller-tone-curve");

const splitIds = [
    "ParametricShadowSplit",
    "ParametricMidtoneSplit",
    "ParametricHighlightSplit"
];

function metadataFor(id) {
    const definition = metadata.find((item) => item.id === id);
    assert.ok(definition, "Missing Tone Curve split metadata for " + id);
    return definition;
}

assert.deepEqual(splitIds.map(function (id) {
    const definition = metadataFor(id);
    return {
        id: definition.id,
        min: definition.min,
        max: definition.max,
        rangeStep: definition.rangeStep,
        numericStep: definition.numericStep,
        default: definition.default
    };
}), [
    { id: "ParametricShadowSplit", min: 10, max: 70, rangeStep: 1, numericStep: 1, default: 25 },
    { id: "ParametricMidtoneSplit", min: 20, max: 80, rangeStep: 1, numericStep: 1, default: 50 },
    { id: "ParametricHighlightSplit", min: 30, max: 90, rangeStep: 1, numericStep: 1, default: 75 }
]);
[
    { id: "ParametricShadowSplit", minimum: 10, maximum: 70 },
    { id: "ParametricMidtoneSplit", minimum: 20, maximum: 80 },
    { id: "ParametricHighlightSplit", minimum: 30, maximum: 90 }
].forEach(function (testCase) {
    assert.equal(sliders.parseAbsoluteValue(testCase.id, String(testCase.minimum)), testCase.minimum);
    assert.equal(sliders.parseAbsoluteValue(testCase.id, String(testCase.maximum)), testCase.maximum);
    assert.equal(sliders.parseAbsoluteValue(testCase.id, String(testCase.minimum - 1)), null);
    assert.equal(sliders.parseAbsoluteValue(testCase.id, String(testCase.maximum + 1)), null);
    assert.equal(commands.validateCommand({
        command: "develop.set", slider: testCase.id, value: testCase.minimum
    }), true);
    assert.equal(commands.validateCommand({
        command: "develop.set", slider: testCase.id, value: testCase.maximum + 1
    }), false);
});

const neutralParametricValues = {
    ParametricShadows: 0,
    ParametricDarks: 0,
    ParametricLights: 0,
    ParametricHighlights: 0,
    ParametricShadowSplit: 25,
    ParametricMidtoneSplit: 50,
    ParametricHighlightSplit: 75
};
assert.deepEqual(toneCurve.normalizeParametricCurveValues(neutralParametricValues), {
    shadows: 0,
    darks: 0,
    lights: 0,
    highlights: 0,
    shadowSplit: 25,
    midtoneSplit: 50,
    highlightSplit: 75
});
assert.deepEqual(toneCurve.parametricCurveSplitPositions(neutralParametricValues).map(function (value) {
    return Number(value.toFixed(6));
}), [63.75, 127.5, 191.25], "Split markers must retain their absolute Lightroom percentages");
const linearRgbCurve = [0, 0, 255, 255];
const nonlinearRgbCurve = toneCurve.PRESET_CURVES["Medium Contrast"].slice();
for (const input of [0, 10, 25, 50, 75, 90, 100]) {
    assert.ok(Math.abs(toneCurve.parametricCurveOutputAt(
        neutralParametricValues, linearRgbCurve, input
    ) - input) < 1e-9, "Linear Point Curve plus neutral Parametric values must remain linear");
    assert.ok(Math.abs(toneCurve.parametricCurveOutputAt(
        neutralParametricValues, nonlinearRgbCurve, input
    ) - toneCurve.evaluatePointCurve(nonlinearRgbCurve, input * 2.55) / 2.55) < 1e-9,
    "Nonlinear Point Curve plus neutral Parametric values must retain the authoritative RGB base");
}

function parametricSampleFailures(fixtures, tolerance) {
    const failures = [];
    fixtures.forEach(function (fixture) {
        fixture.samples.forEach(function (sample) {
            const output = toneCurve.parametricCurveOutputAt(fixture.values, fixture.rgbCurve, sample[0]);
            if (Math.abs(output - sample[1]) > tolerance) {
                failures.push(fixture.name + " sample " + sample[0] + "→" + sample[1] +
                    " drifted to " + output);
            }
        });
    });
    return failures;
}

// Screenshot-derived graph coordinates are approximate pixels, not exact SDK curve samples.
const LIGHTROOM_SCREENSHOT_SAMPLE_TOLERANCE = 2.5;
const capturedLightroomFixture = Object.freeze({
    name: "Lightroom screenshot fixture A",
    selectedPhotoUuid: "CF9977E3-26CE-4230-B3C2-A63CF595BF6D",
    contextCounter: 1,
    developCounter: 17,
    toneCurveName: "Linear",
    rgbCurve: Object.freeze([0, 0, 255, 255]),
    values: Object.freeze({
        ParametricShadowSplit: 33,
        ParametricMidtoneSplit: 54,
        ParametricHighlightSplit: 79,
        ParametricShadows: -49,
        ParametricDarks: 44,
        ParametricLights: 0,
        ParametricHighlights: 0
    }),
    samples: Object.freeze([
        [10, 4], [20, 16], [33, 36], [40, 45], [50, 57],
        [54, 61], [60, 66], [70, 73], [79, 81], [90, 90]
    ])
});
const currentExtremeFixture = Object.freeze({
    name: "Lightroom screenshot fixture B",
    rgbCurve: Object.freeze([0, 0, 255, 255]),
    values: Object.freeze({
        ParametricShadowSplit: 25,
        ParametricMidtoneSplit: 44,
        ParametricHighlightSplit: 75,
        ParametricShadows: 21,
        ParametricDarks: 4,
        ParametricLights: 81,
        ParametricHighlights: -26
    }),
    samples: Object.freeze([
        [10, 13], [20, 26], [30, 40], [40, 56], [50, 73],
        [60, 86], [70, 94], [80, 98], [90, 100]
    ])
});

const isolatedLightsFixture = Object.freeze({
    name: "Lightroom screenshot fixture C (isolated Lights +81)",
    toneCurveName: "Linear",
    rgbCurve: Object.freeze([0, 0, 255, 255]),
    values: Object.freeze({
        ParametricShadowSplit: 25,
        ParametricMidtoneSplit: 44,
        ParametricHighlightSplit: 75,
        ParametricShadows: 0,
        ParametricDarks: 0,
        ParametricLights: 81,
        ParametricHighlights: 0
    }),
    samples: Object.freeze([
        [10, 12], [20, 23], [30, 38], [40, 55], [50, 73],
        [60, 87], [70, 95], [80, 98], [90, 100]
    ])
});

const isolatedLightsMidrangeFixture = Object.freeze({
    name: "Lightroom screenshot fixture D (isolated Lights +40)",
    toneCurveName: "Linear",
    rgbCurve: Object.freeze([0, 0, 255, 255]),
    values: Object.freeze({
        ParametricShadowSplit: 25,
        ParametricMidtoneSplit: 44,
        ParametricHighlightSplit: 75,
        ParametricShadows: 0,
        ParametricDarks: 0,
        ParametricLights: 40,
        ParametricHighlights: 0
    }),
    samples: Object.freeze([
        [10, 11], [20, 22], [30, 34], [40, 47], [50, 60],
        [60, 73], [70, 84], [80, 92], [90, 98]
    ])
});

const isolatedLightsNegativeFixture = Object.freeze({
    name: "Lightroom screenshot fixture E (isolated Lights -40)",
    toneCurveName: "Linear",
    rgbCurve: Object.freeze([0, 0, 255, 255]),
    values: Object.freeze({
        ParametricShadowSplit: 25,
        ParametricMidtoneSplit: 44,
        ParametricHighlightSplit: 75,
        ParametricShadows: 0,
        ParametricDarks: 0,
        ParametricLights: -40,
        ParametricHighlights: 0
    }),
    samples: Object.freeze([
        [10, 10], [20, 19], [30, 28], [40, 36], [50, 43],
        [60, 52], [70, 62], [80, 73], [90, 85]
    ])
});

const isolatedDarksFixture = Object.freeze({
    name: "Lightroom screenshot fixture F (isolated Darks +44)",
    toneCurveName: "Linear",
    rgbCurve: Object.freeze([0, 0, 255, 255]),
    values: Object.freeze({
        ParametricShadowSplit: 33,
        ParametricMidtoneSplit: 54,
        ParametricHighlightSplit: 79,
        ParametricShadows: 0,
        ParametricDarks: 44,
        ParametricLights: 0,
        ParametricHighlights: 0
    }),
    samples: Object.freeze([
        [10, 15], [20, 27], [33, 41], [40, 49], [50, 58],
        [54, 61], [60, 66], [70, 74], [79, 81], [90, 90]
    ])
});

const isolatedShadowsFixture = Object.freeze({
    name: "Lightroom screenshot fixture G (isolated Shadows -49)",
    toneCurveName: "Linear",
    rgbCurve: Object.freeze([0, 0, 255, 255]),
    values: Object.freeze({
        ParametricShadowSplit: 33,
        ParametricMidtoneSplit: 54,
        ParametricHighlightSplit: 79,
        ParametricShadows: -49,
        ParametricDarks: 0,
        ParametricLights: 0,
        ParametricHighlights: 0
    }),
    samples: Object.freeze([
        [10, 3], [20, 12], [33, 27], [40, 37], [50, 50],
        [54, 54], [60, 60], [70, 70], [79, 79], [90, 90]
    ])
});

const isolatedHighlightsFixture = Object.freeze({
    name: "Lightroom screenshot fixture H (isolated Highlights -26)",
    toneCurveName: "Linear",
    rgbCurve: Object.freeze([0, 0, 255, 255]),
    values: Object.freeze({
        ParametricShadowSplit: 25,
        ParametricMidtoneSplit: 44,
        ParametricHighlightSplit: 75,
        ParametricShadows: 0,
        ParametricDarks: 0,
        ParametricLights: 0,
        ParametricHighlights: -26
    }),
    samples: Object.freeze([
        [10, 10], [20, 20], [30, 30], [40, 40], [50, 50],
        [60, 59], [70, 68], [80, 77], [90, 88]
    ])
});

const stressFixture = Object.freeze({
    name: "Parametric display-interpolation stress fixture",
    rgbCurve: Object.freeze([0, 0, 255, 255]),
    values: Object.freeze({
        ParametricShadowSplit: 25,
        ParametricMidtoneSplit: 44,
        ParametricHighlightSplit: 75,
        ParametricShadows: -90,
        ParametricDarks: 73,
        ParametricLights: 0,
        ParametricHighlights: -100
    }),
    inputs: Object.freeze([5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95]),
    lightroomOutputs: Object.freeze([
        1.4, 2.4, 6.2, 15.2, 25.6, 35.5, 45.5, 53.1, 58.3, 61.1,
        63.5, 64.9, 66.4, 67.8, 69.2, 71.6, 75.4, 80.1, 88.2
    ]),
    // Exact evaluator outputs captured before changing display interpolation.
    // This is a regression snapshot, not another Lightroom calibration table.
    evaluatorOutputs: Object.freeze([
        0, 2.3726933113099133, 7.655756415478537, 14.833487997620256, 24.86369937695388,
        37.557736630849554, 46.87440298228274, 53.250859977642854, 57.26006797389639,
        61.42953242212887, 63.040582375850036, 63.554200832618285, 65.54080093329557,
        68.00111598629894, 70.31435219586379, 72.86584764813257, 76.39604313210853,
        80.99615418527588, 90.05931500794148
    ])
});

function cubicBezierValue(start, controlOne, controlTwo, end, t) {
    const inverse = 1 - t;
    return inverse * inverse * inverse * start + 3 * inverse * inverse * t * controlOne +
        3 * inverse * t * t * controlTwo + t * t * t * end;
}

function parametricDisplayOutputAt(segments, inputPercent) {
    const coordinate = inputPercent * 2.55;
    let segment = segments[segments.length - 1];
    for (const candidate of segments) {
        if (coordinate <= candidate.x1 + 1e-9) {
            segment = candidate;
            break;
        }
    }
    const t = (coordinate - segment.x0) / (segment.x1 - segment.x0);
    return cubicBezierValue(segment.y0, segment.c1y, segment.c2y, segment.y1, t) / 2.55;
}

function displayVariation(outputs) {
    const slopes = outputs.slice(1).map(function (output, index) {
        return output - outputs[index];
    });
    const curvatures = slopes.slice(1).map(function (slope, index) {
        return slope - slopes[index];
    });
    return {
        slope: curvatures.reduce(function (total, curvature) {
            return total + Math.abs(curvature);
        }, 0),
        curvature: curvatures.slice(1).reduce(function (total, curvature, index) {
            return total + Math.abs(curvature - curvatures[index]);
        }, 0)
    };
}

const calibratedFixtures = Object.freeze([
    capturedLightroomFixture,
    currentExtremeFixture,
    isolatedLightsFixture,
    isolatedLightsMidrangeFixture,
    isolatedLightsNegativeFixture,
    isolatedDarksFixture,
    isolatedShadowsFixture,
    isolatedHighlightsFixture
]);

assert.deepEqual(stressFixture.inputs.map(function (input) {
    return toneCurve.parametricCurveOutputAt(stressFixture.values, stressFixture.rgbCurve, input);
}), stressFixture.evaluatorOutputs,
    "Display fitting must not change the calibrated Parametric output function");

const stressSamples = toneCurve.parametricCurveSamples(stressFixture.values, stressFixture.rgbCurve);
const stressSegments = toneCurve.parametricDisplaySegments(stressFixture.values, stressFixture.rgbCurve);
const stressPath = toneCurve.parametricCurvePathData(stressFixture.values, stressFixture.rgbCurve);
assert.ok(stressSegments.length >= 10 && stressSegments.length <= 20,
    "The globally fitted Parametric display must use a bounded low number of cubic spans");
assert.equal(stressSegments.length, 12,
    "Fifteen global B-spline controls must produce twelve fair cubic spans");
assert.equal((stressPath.match(/\bC /g) || []).length, stressSegments.length,
    "Parametric SVG must serialize only the fitted global cubic spans");
assert.doesNotMatch(stressPath, /\bL /, "Parametric SVG must not fall back to line segments");

const nonInterpolatedSamples = stressSamples.filter(function (sample) {
    return Math.abs(parametricDisplayOutputAt(stressSegments, sample.x / 2.55) - sample.y / 2.55) > 1e-6;
});
assert.ok(nonInterpolatedSamples.length > stressSamples.length * 0.75,
    "The fair display fit must not be forced through all 129 raw evaluator samples");

const stressPathCoordinates = (stressPath.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
assert.equal(stressPathCoordinates[0], 0, "Parametric SVG must keep the 0/0 endpoint fixed");
assert.equal(stressPathCoordinates[1], 255, "Parametric SVG must keep the 0/0 endpoint fixed");
stressSegments.forEach(function (segment, index) {
    assert.ok(segment.x0 < segment.c1x && segment.c1x < segment.c2x && segment.c2x < segment.x1,
        "Every fitted cubic span must advance through the graph domain");
    [segment.y0, segment.c1y, segment.c2y, segment.y1].forEach(function (coordinate) {
        assert.ok(coordinate >= -1e-9 && coordinate <= 255 + 1e-9,
            "Fitted cubic controls must remain inside the graph domain");
    });
    for (let step = 0; step <= 100; step += 1) {
        const t = step / 100;
        const x = cubicBezierValue(segment.x0, segment.c1x, segment.c2x, segment.x1, t);
        const y = cubicBezierValue(segment.y0, segment.c1y, segment.c2y, segment.y1, t);
        assert.ok(x >= 0 && x <= 255 && y >= -1e-9 && y <= 255 + 1e-9,
            "Parametric cubic interpolation must remain inside the graph domain");
    }
    if (index === stressSegments.length - 1) return;
    const next = stressSegments[index + 1];
    const width = segment.x1 - segment.x0;
    const nextWidth = next.x1 - next.x0;
    const incomingSlope = 3 * (segment.y1 - segment.c2y) / width;
    const outgoingSlope = 3 * (next.c1y - next.y0) / nextWidth;
    const incomingCurvature = 6 * (segment.c1y - 2 * segment.c2y + segment.y1) / (width * width);
    const outgoingCurvature = 6 * (next.y0 - 2 * next.c1y + next.c2y) / (nextWidth * nextWidth);
    assert.ok(Math.abs(incomingSlope - outgoingSlope) < 1e-8,
        "The global Parametric fit must retain continuous slopes between spans");
    assert.ok(Math.abs(incomingCurvature - outgoingCurvature) < 1e-8,
        "The global Parametric fit must retain continuous curvature between spans");
});
const stressPathFinalOffset = 2 + (stressSegments.length - 1) * 6 + 4;
assert.equal(stressSegments[0].x0, 0);
assert.equal(stressSegments[0].y0, 0);
assert.equal(stressSegments[stressSegments.length - 1].x1, 255);
assert.equal(stressSegments[stressSegments.length - 1].y1, 255);
assert.equal(stressPathCoordinates[stressPathFinalOffset], 255,
    "Parametric SVG must keep the rendered 100/100 input endpoint fixed");
assert.equal(stressPathCoordinates[stressPathFinalOffset + 1], 0,
    "Parametric SVG must keep the rendered 100/100 output endpoint fixed");

stressFixture.inputs.forEach(function (input, index) {
    const output = parametricDisplayOutputAt(stressSegments, input);
    assert.ok(Math.abs(output - stressFixture.lightroomOutputs[index]) <= 2.5,
        "The fair display fit must remain within Lightroom stress evidence at input " + input);
});

const displayEvidence = calibratedFixtures.concat([Object.freeze({
    name: stressFixture.name,
    rgbCurve: stressFixture.rgbCurve,
    values: stressFixture.values,
    samples: Object.freeze(stressFixture.inputs.map(function (input, index) {
        return Object.freeze([input, stressFixture.lightroomOutputs[index]]);
    }))
})]);
displayEvidence.forEach(function (fixture) {
    const segments = toneCurve.parametricDisplaySegments(fixture.values, fixture.rgbCurve);
    fixture.samples.forEach(function (sample) {
        assert.ok(Math.abs(parametricDisplayOutputAt(segments, sample[0]) - sample[1]) <= 2.5,
            fixture.name + " fair display fit left the Lightroom evidence envelope at " + sample[0]);
    });
    const sourceOutputs = [];
    const fittedOutputs = [];
    for (let step = 0; step <= 2000; step += 1) {
        const input = step / 20;
        sourceOutputs.push(toneCurve.parametricCurveOutputAt(fixture.values, fixture.rgbCurve, input));
        fittedOutputs.push(parametricDisplayOutputAt(segments, input));
    }
    fittedOutputs.forEach(function (output, index) {
        assert.ok(output >= -1e-9 && output <= 100 + 1e-9,
            fixture.name + " fair display fit escaped the graph domain");
        assert.ok(Math.abs(output - sourceOutputs[index]) <= 2.5,
            fixture.name + " fair display fit left the calibrated evaluator envelope");
    });
    const sourceIsMonotone = sourceOutputs.every(function (output, index) {
        return index === 0 || output + 1e-9 >= sourceOutputs[index - 1];
    });
    if (sourceIsMonotone) {
        fittedOutputs.forEach(function (output, index) {
            if (index > 0) assert.ok(output + 1e-9 >= fittedOutputs[index - 1],
                fixture.name + " monotone source gained a reversal or overshoot");
        });
    }
});

const rawStressOutputs = stressSamples.map(function (sample) { return sample.y / 2.55; });
const fittedStressOutputs = stressSamples.map(function (sample) {
    return parametricDisplayOutputAt(stressSegments, sample.x / 2.55);
});
const rawStressVariation = displayVariation(rawStressOutputs);
const fittedStressVariation = displayVariation(fittedStressOutputs);
assert.ok(fittedStressVariation.slope < rawStressVariation.slope * 0.85,
    "The global fit must materially reduce slope variation from the rejected dense-knot path");
assert.ok(fittedStressVariation.curvature < rawStressVariation.curvature * 0.25,
    "The global fit must materially reduce curvature variation from the rejected dense-knot path");

const adjustedLinearOutput = toneCurve.parametricCurveOutputAt(
    capturedLightroomFixture.values, linearRgbCurve, 50
);
const adjustedNonlinearOutput = toneCurve.parametricCurveOutputAt(
    capturedLightroomFixture.values, nonlinearRgbCurve, 50
);
assert.notEqual(adjustedLinearOutput, 50, "Linear Point Curve plus adjusted Parametric values must render adjustment");
assert.ok(Math.abs(adjustedNonlinearOutput - (
    toneCurve.evaluatePointCurve(nonlinearRgbCurve, 127.5) / 2.55 + adjustedLinearOutput - 50
)) < 1e-9, "Nonlinear Point Curve plus adjusted Parametric values must compose the authoritative base and Parametric offset");
assert.notEqual(adjustedNonlinearOutput, adjustedLinearOutput,
    "Adjusted nonlinear and adjusted linear composition cases must remain distinguishable");
assert.match(toneCurve.parametricCurvePathData(capturedLightroomFixture.values, linearRgbCurve), /^M .+ C /);
assert.equal(toneCurve.parametricCurvePathData(capturedLightroomFixture.values, null), "",
    "A Parametric graph must fail closed without the authoritative RGB Point Curve array");
assert.equal(toneCurve.normalizeParametricCurveValues(Object.assign({}, neutralParametricValues, {
    ParametricMidtoneSplit: 34,
    ParametricShadowSplit: 25
})), null, "Invalid authoritative split gaps must not fabricate a graph");
assert.equal(toneCurve.normalizeParametricCurveValues(Object.assign({}, neutralParametricValues, {
    ParametricShadows: null
})), null, "Missing scalar feedback must not be coerced into an authoritative zero");

assert.equal(toneCurve.parametricRegionFieldAtInput(10, capturedLightroomFixture.values), "ParametricShadows");
assert.equal(toneCurve.parametricRegionFieldAtInput(40, capturedLightroomFixture.values), "ParametricDarks");
assert.equal(toneCurve.parametricRegionFieldAtInput(60, capturedLightroomFixture.values), "ParametricLights");
assert.equal(toneCurve.parametricRegionFieldAtInput(90, capturedLightroomFixture.values), "ParametricHighlights");
assert.equal(toneCurve.parametricRegionFieldAtInput(33, capturedLightroomFixture.values), "ParametricDarks",
    "The authoritative Shadow Split must select Darks at its boundary");
assert.equal(toneCurve.parametricRegionFieldAtInput(54, capturedLightroomFixture.values), "ParametricLights");
assert.equal(toneCurve.parametricRegionFieldAtInput(79, capturedLightroomFixture.values), "ParametricHighlights");
["mouse", "touch"].forEach(function (pointerType) {
    assert.equal(toneCurve.intentionalParametricDrag("region", 0, 0), false,
        pointerType + " pointer-down must not start a value change");
    assert.equal(toneCurve.intentionalParametricDrag("region", 30, 1), false,
        pointerType + " horizontal curve movement must not create a vertical adjustment");
    assert.equal(toneCurve.intentionalParametricDrag("region", 0, 2), true);
    assert.equal(toneCurve.parametricRegionDragValue(20, 0, 400), 20,
        pointerType + " pointer-down must retain the authoritative baseline");
    assert.equal(toneCurve.parametricRegionDragValue(20, -40, 400), 40);
    assert.equal(toneCurve.intentionalParametricDrag("split", 1, 50), false);
    assert.equal(toneCurve.intentionalParametricDrag("split", 2, 0), true);
    assert.equal(toneCurve.parametricSplitDragValue(33, 0, 500), 33);
    assert.equal(toneCurve.parametricSplitDragValue(33, 50, 500), 43);
});

assert.match(controller, /title\.textContent = "TONE CURVE"/);
assert.match(controller, /tabs\.className = "color-mixer-view-tabs tone-curve-view-tabs"/);
assert.match(controller, /button\.className = "color-mixer-view-button tone-curve-view-button"/);
assert.match(controller, /\{ id: "parametric", label: "Parametric Curve" \}[\s\S]*\{ id: "point", label: "Point Curve" \}/,
    "Parametric Curve must be the first compact tab");
assert.match(controller, /let toneCurveView = "parametric";/,
    "Parametric Curve must be the fresh-session default");
assert.match(controller, /pointPanel\.hidden = view !== "point";[\s\S]*parametricPanel\.hidden = view !== "parametric";/,
    "Compact sub-tab navigation must retain both live panels and toggle only presentation");
assert.match(controller, /sessionStorage\.setItem\("lrbridge\.toneCurveView", view\)/);
assert.match(controller, /parametricPanel\.appendChild\(createParametricCurveGraph\(\)\)[\s\S]*toneCurveDisplayOrder\.forEach/,
    "The authoritative graph must precede every Parametric control");
assert.match(controller, /sliderBlock\.className = "tone-curve-slider-block parametric-curve-slider-block"/,
    "Parametric controls must use a dedicated slider block after the graph");
assert.match(controller, /\.parametric-curve-slider-block\s*\{\s*margin-top: 12px;\s*\}/,
    "The Parametric graph-to-first-row gap must increase without changing row spacing");
assert.match(controller, /if \(index === toneCurveSplitCount\)[\s\S]*divider\.className = "tone-curve-divider"/,
    "A divider must separate the three split controls from the four region controls");
assert.match(controller, /collectParametricCurveValues\(false\)[\s\S]*authoritativeParametricPointCurve\(\)[\s\S]*parametricCurvePathData\(authoritativeValues, pointCurve\.rgbCurve\)/,
    "The canonical graph path must use authoritative Lightroom scalar and RGB Point Curve feedback");
assert.match(controller, /collectParametricCurveValues\(true\)[\s\S]*!parametricCurveValuesEqual\(authoritativeValues, presentedValues\)/,
    "Mouse and touch interaction may render a distinct local preview without replacing the canonical graph");
assert.match(controller, /parametricCurveGraphElement\.dataset\.feedbackState = previewing \? "preview" : "authoritative"/);
assert.match(controller, /if \(isParametricCurveControl\(control\)\) updateParametricCurveGraph\(\)/,
    "Every generic slider presentation update must refresh the graph");
const graphFactorySource = controller.match(/function createParametricCurveGraph[\s\S]*?function collectParametricCurveValues/)[0];
assert.match(graphFactorySource, /svg\.addEventListener\("pointerdown", beginParametricCurveRegionPointer\)/);
assert.match(graphFactorySource, /pointermove[\s\S]*pointerup[\s\S]*pointercancel[\s\S]*lostpointercapture/,
    "Mouse and touch graph gestures must have complete Pointer Events cleanup");
assert.doesNotMatch(graphFactorySource, /histogram/i, "The Web Controller must not fabricate a Parametric histogram");
assert.doesNotMatch(graphFactorySource, /point-curve-hit-target|point-curve-marker|addPoint/,
    "Parametric mode must not create Point Curve control points");
assert.match(controller, /setPointerCapture\(event\.pointerId\)/);
assert.match(controller, /if \(submitFinal && gesture\.moved && !gesture\.control\.contextInvalidated\)/,
    "A stationary tap must not write and an invalidated gesture must not commit");
assert.match(controller, /stageDevelopSliderRangeValue\(gesture\.control, nextValue\)[\s\S]*flushDevelopSliderValue\(gesture\.control, gesture\.lastValue, "range"\)/,
    "Graph interaction must use the accepted coalesced slider command path");
assert.match(controller, /parametricCurveGraphPreviewPath\.setAttribute\("display", "inline"\)/,
    "Local interaction preview must remain visually distinct until authoritative settlement");
assert.match(controller, /cancelParametricCurveGesture\("Parametric Curve gesture timed out/);
assert.match(controller, /cancelParametricCurveGesture\("Parametric Curve gesture cancelled because Lightroom context changed/);
assert.match(controller, /cancelParametricCurveGesture\("Parametric Curve gesture cancelled by navigation/);
assert.match(controller, /\.parametric-curve-graph \{ touch-action: none; cursor: ns-resize; \}/);
assert.match(controller, /\.parametric-curve-split-target \{[\s\S]*width: 44px;[\s\S]*height: 44px;/,
    "Every split marker must expose at least a 44×44 CSS-pixel touch target");
assert.match(controller, /--parametric-curve-interaction-gutter: 36px;/,
    "The graph-to-slider interaction gutter must remain between 32 and 40 CSS pixels");
assert.match(controller, /\.tone-curve-slider-block \{[\s\S]*width: 100%;/,
    "Parametric rows must use the standard full-width Develop slider presentation");
assert.doesNotMatch(controller.match(/\.tone-curve-group \{[\s\S]*?\}/)[0], /560px/,
    "The full Parametric slider block must not inherit the narrower graph width");
["Shadow Split", "Midtone Split", "Highlight Split", "Shadows", "Darks", "Lights", "Highlights"].forEach(function (label) {
    assert.match(controller, new RegExp('"' + label + '"'));
});
assert.doesNotMatch(toneCurve.parametricCurvePathData.toString(), /naturalSpline|curveSegments/,
    "Parametric calibration must not silently reuse Point Curve natural-cubic smoothing");
assert.doesNotMatch(fs.readFileSync(path.join(root, "app/controller-tone-curve.js"), "utf8"),
    /darktable|parametricCurveControlPoints|parametricCurveSegments/,
    "The rejected darktable six-knot construction must not remain asserted as Lightroom output");

const constraintStart = controller.indexOf("const parametricCurveSplitConstraintDefinitions");
const constraintEnd = controller.indexOf("function compoundDevelopRangeValue", constraintStart);
assert.notEqual(constraintStart, -1, "Missing Parametric Curve constraint definitions");
assert.notEqual(constraintEnd, -1, "Missing coupled-slider constraint helpers");
const constraintSource = controller.slice(constraintStart, constraintEnd);
const configureRangeSource = controller.slice(
    controller.indexOf("function configureDevelopSliderRange"),
    controller.indexOf("function setDevelopSliderState")
);
assert.match(
    configureRangeSource,
    /if \(isParametricCurveSplitControl\(control\)\) \{\s*control\.range\.min = "0";\s*control\.range\.max = "100";\s*control\.range\.step = "1";/,
    "Each Parametric Curve split must render on a fixed native 0-100 range"
);
const updateConstraintSource = constraintSource.slice(
    constraintSource.indexOf("function updateParametricCurveSplitConstraints")
);
assert.doesNotMatch(
    updateConstraintSource,
    /configureDevelopSliderRange|control\.range\.(?:min|max|step)\s*=/,
    "Constraint recalculation must never rewrite the split track geometry"
);

function fakeRange() {
    return {
        min: "0",
        max: "100",
        step: "1",
        value: "",
        disabled: true,
        progress: null,
        style: {
            setProperty(name, value) {
                if (name === "--slider-progress") this.progress = value;
            }
        }
    };
}

function controlFor(id, authoritativeValue) {
    return {
        definition: Object.assign({}, metadataFor(id)),
        localValue: null,
        desiredValue: null,
        authoritativeValue,
        feedbackState: "available",
        visualProgress: null,
        range: fakeRange(),
        decrement: { disabled: true },
        increment: { disabled: true }
    };
}

const controls = {
    ParametricShadowSplit: controlFor("ParametricShadowSplit", 25),
    ParametricMidtoneSplit: controlFor("ParametricMidtoneSplit", 50),
    ParametricHighlightSplit: controlFor("ParametricHighlightSplit", 75)
};
const constraintContext = { developSliderControls: controls, Math, Number, Object };
vm.runInNewContext(
    constraintSource + "\nthis.api = {" +
        " coupledBounds: coupledDevelopSliderBounds," +
        " outerBounds: parametricCurveSplitOuterBounds," +
        " effectiveBounds: parametricCurveSplitEffectiveBounds," +
        " constrain: constrainParametricCurveSplitValue," +
        " ready: parametricCurveSplitConstraintsReady," +
        " prepare: prepareParametricCurveSplitCommit," +
        " isSplit: isParametricCurveSplitControl," +
        " update: updateParametricCurveSplitConstraints" +
    " };",
    constraintContext
);
const coupled = constraintContext.api;

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

assert.deepEqual(plain(coupled.effectiveBounds(controls.ParametricShadowSplit)), { minimum: 10, maximum: 40 });
assert.deepEqual(plain(coupled.effectiveBounds(controls.ParametricMidtoneSplit)), { minimum: 35, maximum: 65 });
assert.deepEqual(plain(coupled.effectiveBounds(controls.ParametricHighlightSplit)), { minimum: 60, maximum: 90 });

assert.equal(coupled.constrain(controls.ParametricShadowSplit, 9), 10);
assert.equal(coupled.constrain(controls.ParametricShadowSplit, 70), 40);
assert.equal(coupled.constrain(controls.ParametricHighlightSplit, 30), 60);
assert.equal(coupled.constrain(controls.ParametricHighlightSplit, 91), 90);

controls.ParametricShadowSplit.authoritativeValue = 35;
controls.ParametricHighlightSplit.authoritativeValue = 72;
assert.deepEqual(plain(coupled.effectiveBounds(controls.ParametricMidtoneSplit)), { minimum: 45, maximum: 62 });
assert.equal(coupled.constrain(controls.ParametricMidtoneSplit, 20), 45);
assert.equal(coupled.constrain(controls.ParametricMidtoneSplit, 80), 62);
assert.equal(controls.ParametricShadowSplit.authoritativeValue, 35, "Clamping Midtone must not rewrite Shadow");
assert.equal(controls.ParametricHighlightSplit.authoritativeValue, 72, "Clamping Midtone must not rewrite Highlight");

controls.ParametricShadowSplit.authoritativeValue = 10;
controls.ParametricMidtoneSplit.authoritativeValue = 20;
controls.ParametricHighlightSplit.authoritativeValue = 30;
assert.deepEqual(plain(coupled.effectiveBounds(controls.ParametricShadowSplit)), { minimum: 10, maximum: 10 });
assert.deepEqual(plain(coupled.effectiveBounds(controls.ParametricMidtoneSplit)), { minimum: 20, maximum: 20 });
assert.deepEqual(plain(coupled.effectiveBounds(controls.ParametricHighlightSplit)), { minimum: 30, maximum: 90 });
controls.ParametricShadowSplit.authoritativeValue = 70;
controls.ParametricMidtoneSplit.authoritativeValue = 80;
controls.ParametricHighlightSplit.authoritativeValue = 90;
assert.deepEqual(plain(coupled.effectiveBounds(controls.ParametricShadowSplit)), { minimum: 10, maximum: 70 });
assert.deepEqual(plain(coupled.effectiveBounds(controls.ParametricMidtoneSplit)), { minimum: 80, maximum: 80 });
assert.deepEqual(plain(coupled.effectiveBounds(controls.ParametricHighlightSplit)), { minimum: 90, maximum: 90 });

controls.ParametricShadowSplit.authoritativeValue = 25;
controls.ParametricMidtoneSplit.authoritativeValue = 50;
controls.ParametricHighlightSplit.authoritativeValue = 75;
coupled.update();
assert.deepEqual(splitIds.map(function (id) {
    const control = controls[id];
    return {
        id,
        min: control.range.min,
        max: control.range.max,
        step: control.range.step,
        value: control.range.value,
        progress: control.visualProgress
    };
}), [
    { id: "ParametricShadowSplit", min: "0", max: "100", step: "1", value: "25", progress: "25%" },
    { id: "ParametricMidtoneSplit", min: "0", max: "100", step: "1", value: "50", progress: "50%" },
    { id: "ParametricHighlightSplit", min: "0", max: "100", step: "1", value: "75", progress: "75%" }
]);

controls.ParametricMidtoneSplit.authoritativeValue = 55;
coupled.update();
assert.deepEqual(plain(coupled.effectiveBounds(controls.ParametricShadowSplit)), { minimum: 10, maximum: 45 },
    "Authoritative Midtone readback must recalculate Shadow's allowed maximum");
assert.deepEqual(plain(coupled.effectiveBounds(controls.ParametricHighlightSplit)), { minimum: 65, maximum: 90 },
    "Authoritative Midtone readback must recalculate Highlight's allowed minimum");
splitIds.forEach(function (id) {
    assert.deepEqual(
        { min: controls[id].range.min, max: controls[id].range.max, step: controls[id].range.step },
        { min: "0", max: "100", step: "1" },
        "Authoritative neighbor changes must preserve the fixed track for " + id
    );
});
assert.equal(controls.ParametricShadowSplit.authoritativeValue, 25);
assert.equal(controls.ParametricMidtoneSplit.authoritativeValue, 55);
assert.equal(controls.ParametricHighlightSplit.authoritativeValue, 75);

controls.ParametricShadowSplit.authoritativeValue = 60;
controls.ParametricMidtoneSplit.authoritativeValue = 70;
controls.ParametricHighlightSplit.authoritativeValue = 80;
coupled.update();
assert.deepEqual(splitIds.map(function (id) {
    const control = controls[id];
    return { value: control.range.value, progress: control.visualProgress };
}), [
    { value: "60", progress: "60%" },
    { value: "70", progress: "70%" },
    { value: "80", progress: "80%" }
], "Values 60 / 70 / 80 must retain their absolute positions on the fixed track");

controls.ParametricShadowSplit.authoritativeValue = 25;
controls.ParametricMidtoneSplit.authoritativeValue = 55;
controls.ParametricHighlightSplit.authoritativeValue = 75;

assert.equal(coupled.ready(), true);
assert.equal(coupled.prepare(controls.ParametricShadowSplit, 70), 45,
    "The final commit guard must re-clamp against the latest authoritative Midtone");
controls.ParametricHighlightSplit.authoritativeValue = null;
assert.equal(coupled.ready(), false);
assert.equal(coupled.prepare(controls.ParametricMidtoneSplit, 55), null,
    "A split write must fail closed until all three authoritative values exist");
coupled.update();
assert.equal(controls.ParametricShadowSplit.range.disabled, true);
assert.equal(controls.ParametricMidtoneSplit.range.disabled, true);
assert.equal(controls.ParametricHighlightSplit.range.disabled, true);
controls.ParametricHighlightSplit.authoritativeValue = 75;
coupled.update();

controls.ParametricMidtoneSplit.localValue = 60;
assert.equal(coupled.effectiveBounds(controls.ParametricShadowSplit).maximum, 50,
    "Optimistic neighbor presentation must immediately constrain dragging");
assert.equal(coupled.effectiveBounds(controls.ParametricHighlightSplit).minimum, 70);
controls.ParametricMidtoneSplit.localValue = null;

const genericStart = controller.indexOf("function formatDevelopSliderValue");
const genericEnd = controller.indexOf("function configureDevelopSliderRange", genericStart);
assert.notEqual(genericStart, -1);
assert.notEqual(genericEnd, -1);
const genericSource = controller.slice(genericStart, genericEnd);
const genericContext = { developSliderControls: controls, Math, Number, Object };
vm.runInNewContext(
    constraintSource + genericSource + "\nthis.genericApi = {" +
        " parse: parseDevelopSliderValue," +
        " next: nextDevelopSliderStepValue," +
        " fromPosition: developSliderControlPositionToActual," +
        " constrain: constrainParametricCurveSplitValue," +
        " outerBounds: parametricCurveSplitOuterBounds" +
    " };",
    genericContext
);
const generic = genericContext.genericApi;

controls.ParametricShadowSplit.authoritativeValue = 25;
controls.ParametricMidtoneSplit.authoritativeValue = 50;
controls.ParametricHighlightSplit.authoritativeValue = 75;
assert.equal(generic.parse(controls.ParametricShadowSplit.definition, "10", generic.outerBounds(controls.ParametricShadowSplit)), 10);
assert.equal(generic.parse(controls.ParametricShadowSplit.definition, "70", generic.outerBounds(controls.ParametricShadowSplit)), 70);
assert.equal(generic.parse(controls.ParametricShadowSplit.definition, "9", generic.outerBounds(controls.ParametricShadowSplit)), null);
assert.equal(generic.parse(controls.ParametricHighlightSplit.definition, "91", generic.outerBounds(controls.ParametricHighlightSplit)), null);
assert.equal(generic.constrain(controls.ParametricShadowSplit, 65), 40,
    "A valid outer-range numeric commit must clamp to its dynamic neighbor limit");
assert.equal(generic.constrain(controls.ParametricMidtoneSplit, 20), 35);
assert.equal(generic.constrain(controls.ParametricMidtoneSplit, 80), 65);
assert.equal(generic.constrain(controls.ParametricHighlightSplit, 30), 60);

controls.ParametricShadowSplit.localValue = 40;
assert.equal(generic.next(controls.ParametricShadowSplit, 1), 40, "Plus must stop at Midtone minus ten");
assert.equal(generic.next(controls.ParametricShadowSplit, -1), 39, "Minus must retain step 1");
controls.ParametricShadowSplit.localValue = null;
controls.ParametricHighlightSplit.localValue = 60;
assert.equal(generic.next(controls.ParametricHighlightSplit, -1), 60, "Minus must stop at Midtone plus ten");
assert.equal(generic.next(controls.ParametricHighlightSplit, 1), 61, "Plus must retain step 1");
controls.ParametricHighlightSplit.localValue = null;
controls.ParametricMidtoneSplit.localValue = 35;
assert.equal(generic.next(controls.ParametricMidtoneSplit, -1), 35, "Midtone minus must stop at Shadow plus ten");
controls.ParametricMidtoneSplit.localValue = 65;
assert.equal(generic.next(controls.ParametricMidtoneSplit, 1), 65, "Midtone plus must stop at Highlight minus ten");
controls.ParametricMidtoneSplit.localValue = null;
assert.equal(generic.fromPosition(controls.ParametricShadowSplit, 65), 65);
assert.equal(generic.constrain(controls.ParametricShadowSplit, generic.fromPosition(controls.ParametricShadowSplit, 65)), 40,
    "Range and keyboard-slider values must use the same dynamic clamp");

const stageStart = controller.indexOf("function stageDevelopSliderRangeValue");
const stageEnd = controller.indexOf("function flushDevelopSliderValue", stageStart);
const stageSource = controller.slice(stageStart, stageEnd);
const staged = [];
const scheduled = [];
const stageContext = {
    showDevelopSliderLocal(control, value) { staged.push({ id: control.definition.id, value }); },
    scheduleDevelopSliderValue(control, value) { scheduled.push({ id: control.definition.id, value }); },
    isParametricCurveSplitControl(control) { return splitIds.includes(control.definition.id); }
};
vm.runInNewContext(stageSource + "\nthis.stage = stageDevelopSliderRangeValue;", stageContext);
stageContext.stage(controls.ParametricShadowSplit, 35);
assert.deepEqual(staged, [{ id: "ParametricShadowSplit", value: 35 }]);
assert.deepEqual(scheduled, [], "Tone Curve drag staging must not issue intermediate Lightroom writes");
stageContext.stage({ definition: { id: "Exposure" } }, 1);
assert.deepEqual(scheduled, [{ id: "Exposure", value: 1 }],
    "Ordinary Develop slider throttling must remain unchanged");

const sliderFactory = controller.slice(
    controller.indexOf("function createDevelopSliderControl"),
    controller.indexOf("function updateLensBlurExplicitSwitch")
);
const rangeInputBlock = sliderFactory.match(/range\.addEventListener\("input"[\s\S]*?\n            \}\);/)[0];
assert.match(rangeInputBlock, /constrainParametricCurveSplitValue/);
assert.match(rangeInputBlock, /stageDevelopSliderRangeValue/);
assert.doesNotMatch(rangeInputBlock, /scheduleDevelopSliderValue/);
const finishRangeBlock = sliderFactory.match(/function finishRangeInteraction[\s\S]*?range\.addEventListener\("pointerup"/)[0];
assert.equal((finishRangeBlock.match(/flushDevelopSliderValue\(/g) || []).length, 1,
    "A committed split drag must perform one final write");
const flushBlock = controller.slice(
    controller.indexOf("function flushDevelopSliderValue"),
    controller.indexOf("function clearDevelopSliderStepTimers")
);
assert.match(flushBlock, /prepareParametricCurveSplitCommit\(control, value\)/,
    "Every final range or numeric commit must re-check the live coupled bounds");
assert.match(flushBlock, /showDevelopSliderLocal\(control, value\)/,
    "A late final clamp must immediately replace an invalid optimistic value");
const numericCommitBlock = sliderFactory.match(/function commitNumericValue[\s\S]*?number\.addEventListener\("focus"/)[0];
assert.match(numericCommitBlock, /parametricCurveSplitOuterBounds\(control\)/);
assert.match(numericCommitBlock, /constrainParametricCurveSplitValue\(control, parsedValue\)/);
assert.match(
    numericCommitBlock,
    /const nextValue = constrainParametricCurveSplitValue\(control, parsedValue\);\s*showDevelopSliderLocal\(control, nextValue\);\s*if \(nextValue !== control\.numberCommittedValue\)/,
    "A numeric value that clamps to the committed value must still normalize the displayed input without writing"
);
assert.equal((numericCommitBlock.match(/flushDevelopSliderValue\(/g) || []).length, 1,
    "A numeric split commit must perform one write");
assert.doesNotMatch(numericCommitBlock, /Parametric(?:Shadow|Midtone|Highlight)Split/,
    "Numeric commit must submit the active control without naming or rewriting neighbors");

const notifyBlock = controller.slice(
    controller.indexOf("function notifyDevelopSliderPresentation"),
    controller.indexOf("function showDevelopSliderLocal")
);
assert.match(notifyBlock, /updateParametricCurveSplitConstraints\(\)/,
    "Every authoritative presentation update must recalculate all split limits");
const compoundBoundsBlock = controller.slice(
    controller.indexOf("function compoundDevelopRangeEffectiveBounds"),
    controller.indexOf("function clampCompoundDevelopRangeValue")
);
assert.match(compoundBoundsBlock, /coupledDevelopSliderBounds\(/,
    "Purple and Green Hue must share the generalized coupled-bound calculation");

const observedParametricFailures = parametricSampleFailures(
    calibratedFixtures, LIGHTROOM_SCREENSHOT_SAMPLE_TOLERANCE
);
assert.equal(observedParametricFailures.length, 0,
    "Parametric evaluator diverges from screenshot-observed Lightroom evidence:\n" +
    observedParametricFailures.join("\n"));

console.log("Tone Curve coupled split constraints passed.");
