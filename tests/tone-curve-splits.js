const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const controller = fs.readFileSync(path.join(root, "app/controller.html"), "utf8");
const metadata = require("../config/sliders.json");
const sliders = require("../server/sliders");
const commands = require("../server/commands");

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

console.log("Tone Curve coupled split constraints passed.");
