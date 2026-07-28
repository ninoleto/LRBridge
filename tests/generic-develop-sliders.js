const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const metadata = require("../config/sliders.json");
const sliders = require("../server/sliders");
const controller = fs.readFileSync(path.join(root, "app/controller.html"), "utf8");
const builder = fs.readFileSync(path.join(root, "app/companion-cheatsheet.html"), "utf8");
const driver = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/Driver.lua"), "utf8");
const feedback = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/FeedbackPolling.lua"), "utf8");
const query = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/Query.lua"), "utf8");
const parser = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/Parser.lua"), "utf8");
const luaCommands = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/Commands.lua"), "utf8");

assert.equal(metadata.length, 96, "Slider registry count changed");
assert.equal(new Set(metadata.map((item) => item.id)).size, metadata.length, "Duplicate slider ID");

for (const item of metadata) {
    for (const field of [
        "id", "label", "group", "min", "max", "default", "rangeStep",
        "numericStep", "displayPrecision", "feedbackSupported"
    ]) {
        assert.notEqual(item[field], undefined, item.id + " lacks " + field);
    }
    assert.equal(typeof item.id, "string");
    assert.equal(typeof item.label, "string");
    assert.equal(typeof item.group, "string");
    assert.ok(Number.isFinite(item.min) && Number.isFinite(item.max) && item.min < item.max);
    assert.ok(Number.isFinite(item.rangeStep) && item.rangeStep > 0);
    assert.ok(Number.isFinite(item.numericStep) && item.numericStep > 0);
    assert.ok(Number.isInteger(item.displayPrecision) && item.displayPrecision >= 0);
}

const feedbackDefinitions = metadata.filter((item) => item.feedbackSupported === true);
assert.equal(feedbackDefinitions.length, 93, "Generic slider control count changed");
assert.deepEqual(
    metadata.filter((item) => item.feedbackSupported === false).map((item) => item.id),
    ["LensProfileEnable", "AutoLateralCA", "LensProfileChromaticAberrationScale"]
);
const effectiveMetadata = sliders.getAll();
assert.equal(effectiveMetadata.find((item) => item.id === "Temperature").visualScale, "temperature");
assert.equal(effectiveMetadata.find((item) => item.id === "Tint").visualScale || "linear", "linear");
assert.equal(
    effectiveMetadata.filter((item) => item.id !== "Temperature")
        .every((item) => (item.visualScale || "linear") === "linear"),
    true,
    "Only Temperature may use nonlinear visual scaling"
);

assert.match(controller, /function createDevelopSliderControl\(definition\)/);
assert.match(controller, /fetch\("\/api\/sliders", \{ cache: "no-store" \}\)/);
assert.match(controller, /definition\.feedbackSupported === true/);
assert.match(controller, /control\.range\.min = String\(control\.definition\.min\)/);
assert.match(controller, /control\.range\.max = String\(control\.definition\.max\)/);
assert.match(controller, /control\.range\.step = String\(control\.definition\.rangeStep\)/);
assert.match(controller, /number\.type = "text"/);
assert.match(controller, /number\.inputMode = "decimal"/);
assert.match(controller, /number\.autocomplete = "off"/);
assert.match(controller, /number\.spellcheck = false/);
assert.match(controller, /setDevelopSliderState\(control, "loading", "Loading…"\)/);
assert.match(controller, /setDevelopSliderState\(control, "unavailable", "Unavailable"\)/);
assert.match(controller, /setDevelopSliderState\(control, "error", "Feedback error"\)/);
assert.doesNotMatch(controller, /value\.textContent = "--"/);
assert.doesNotMatch(controller, /className = "develop-slider-value/);
assert.match(controller, /control\.dragging \|\|\s*control\.editing/);
assert.match(controller, /setTimeout\(function \(\) \{[\s\S]*\}, 100\)/);
assert.match(controller, /"\/api\/set\?slider="/);
assert.match(controller, /"\/api\/reset\?slider="/);
assert.match(controller, /requestLiveFeedbackSnapshot\(true\)/);
assert.match(controller, /pollFeedbackSnapshot\(request\.id, 4000\)/);
assert.match(controller, /data\.contextCounter !== lastControllerContextCounter/);
assert.match(controller, /markAllDevelopSlidersLoading\(\)/);
assert.match(controller, /pointerup/);
assert.match(controller, /event\.key === "Enter"/);
assert.match(controller, /event\.key === "Escape"/);
assert.match(controller, /number\.addEventListener\("blur"/);
assert.match(controller, /number\.select\(\)/);
assert.match(controller, /rawValue\.replace\(",", "\."\)/);
assert.doesNotMatch(
    controller.match(/function createDevelopSliderControl[\s\S]*?function renderActionGroup/)[0],
    /number\.addEventListener\("input"/
);
assert.match(controller, /makeButton\("−", "develop-slider-step"/);
assert.match(controller, /makeButton\("\+", "develop-slider-step"/);
assert.match(controller, /"Decrease " \+ definition\.label/);
assert.match(controller, /"Increase " \+ definition\.label/);
assert.match(controller, /baseValue \+ direction \* control\.definition\.rangeStep/);
assert.match(controller, /control\.desiredValue !== null[\s\S]*control\.localValue !== null[\s\S]*control\.authoritativeValue/);
assert.match(controller, /control\.desiredValue = nextValue/);
assert.match(controller, /\}, 350\)/);
assert.match(controller, /\}, 2000\)/);
assert.match(controller, /valuesMatchDevelopSlider\(control\.definition, numericValue, control\.desiredValue\)/);
assert.match(controller, /control\.stepConfirmationExpired[\s\S]*showDevelopSliderLocal\(control, numericValue\)/);
assert.match(controller, /function cancelDevelopSliderStep\(control\)/);
assert.match(controller, /pendingKind === "step"/);
const stepConfirmationBlock = controller.match(
    /async function requestDevelopSliderStepFeedback[\s\S]*?function scheduleDevelopSliderStepSubmission/
)[0];
assert.match(stepConfirmationBlock, /"\/api\/feedback\/request\?slider="/);
assert.match(stepConfirmationBlock, /pollFeedbackSnapshot\(request\.id, 1900\)/);
assert.doesNotMatch(stepConfirmationBlock, /requestLiveFeedbackSnapshot/);
assert.doesNotMatch(stepConfirmationBlock, /request-many/);
assert.match(controller, /function applyDevelopSliderFeedbackIfChanged\(control, result\)/);
assert.match(controller, /control\.range\.value === visualText/);
assert.match(controller, /control\.number\.value === numberText/);
assert.match(controller, /control\.visualProgress === progressText/);
assert.match(controller, /if \(unchanged\) return false/);
assert.match(controller, /if \(control\.range\.disabled\) control\.range\.disabled = false/);
assert.doesNotMatch(stepConfirmationBlock, /renderSlidersTab|markAllDevelopSlidersLoading|content\.innerHTML|switchTab/);
assert.match(controller, /range\.addEventListener\("pointerdown", function \(\) \{\s*cancelDevelopSliderStep\(control\)/);
assert.match(controller, /function commitNumericValue\(\) \{\s*cancelDevelopSliderStep\(control\)/);
assert.match(controller, /makeButton\("Reset"[\s\S]*cancelDevelopSliderStep\(control\)/);
assert.match(controller, /"\/api\/set\?slider="/);
assert.doesNotMatch(
    controller.match(/function stepDevelopSliderValue[\s\S]*?function createDevelopSliderControl/)[0],
    /\/api\/adjust/
);
assert.match(controller, /element\.isConnected/);
assert.doesNotMatch(controller, /function makeDragStrip/);
assert.doesNotMatch(controller, /drag-strip/);
assert.doesNotMatch(controller, /makeButton\("-5"/);
assert.doesNotMatch(controller, /makeButton\("-1"/);
assert.doesNotMatch(controller, /makeButton\("\+1"/);
assert.doesNotMatch(controller, /makeButton\("\+5"/);
assert.match(controller, /\.develop-slider-row\s*\{[\s\S]*min-width:\s*0/);
assert.match(controller, /@media \(max-width: 760px\)[\s\S]*\.develop-slider-row/);
assert.match(controller, /::-webkit-slider-thumb[\s\S]*width:\s*24px[\s\S]*height:\s*24px/);
assert.match(controller, /::-moz-range-thumb[\s\S]*width:\s*24px[\s\S]*height:\s*24px/);
assert.match(controller, /grid-template-columns:\s*minmax\(140px, 210px\)[\s\S]*44px 44px auto/);

function extractFunctions(firstName, nextName) {
    const start = controller.indexOf("function " + firstName + "(");
    const end = controller.indexOf("function " + nextName + "(", start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    return controller.slice(start, end);
}

const scaleContext = {};
require("node:vm").runInNewContext(
    extractFunctions("formatDevelopSliderValue", "configureDevelopSliderRange") +
    "\nthis.api = { parseDevelopSliderValue, roundDevelopSliderValue, " +
    "actualToDevelopSliderPosition, developSliderPositionToActual, " +
    "nextDevelopSliderStepValue };",
    scaleContext
);
const scale = scaleContext.api;
const temperature = {
    id: "Temperature",
    min: 2000,
    max: 50000,
    rangeStep: 50,
    numericStep: 1,
    displayPrecision: 0,
    visualScale: "temperature"
};
assert.equal(scale.actualToDevelopSliderPosition(temperature, temperature.min), 0);
assert.equal(scale.actualToDevelopSliderPosition(temperature, temperature.max), 1000);
let previousPosition = -1;
for (const value of [2000, 3000, 5450, 10000, 25000, 50000]) {
    const position = scale.actualToDevelopSliderPosition(temperature, value);
    assert.ok(position > previousPosition);
    previousPosition = position;
    const roundTrip = scale.developSliderPositionToActual(temperature, position);
    assert.ok(Math.abs(roundTrip - value) <= temperature.rangeStep);
}
const tint = {
    id: "Tint", min: -150, max: 150, rangeStep: 1, numericStep: 1,
    displayPrecision: 0, visualScale: "linear"
};
assert.equal(scale.actualToDevelopSliderPosition(tint, 12), 12);
assert.equal(scale.developSliderPositionToActual(tint, 12), 12);
const exposure = {
    id: "Exposure", min: -5, max: 5, rangeStep: 0.1, numericStep: 0.01,
    displayPrecision: 2, visualScale: "linear"
};
assert.equal(scale.parseDevelopSliderValue(exposure, "-0.3"), -0.3);
assert.equal(scale.parseDevelopSliderValue(exposure, "-0,3"), -0.3);
for (const temporary of ["", "-", ".", "-.", "-0."]) {
    if (temporary === "-0.") {
        assert.ok(scale.parseDevelopSliderValue(exposure, temporary) === 0);
    } else {
        assert.equal(scale.parseDevelopSliderValue(exposure, temporary), null);
    }
}

function runStepSequence(definition, start, directions) {
    const control = {
        definition,
        authoritativeValue: start,
        localValue: start,
        desiredValue: null
    };
    const visible = [];
    for (const direction of directions) {
        const next = scale.nextDevelopSliderStepValue(control, direction);
        control.desiredValue = next;
        control.localValue = next;
        visible.push(next);
    }
    return { visible, desiredValue: control.desiredValue };
}

assert.deepEqual(
    runStepSequence(tint, 4, [1, 1, 1]),
    { visible: [5, 6, 7], desiredValue: 7 }
);
assert.deepEqual(
    runStepSequence(tint, 4, [-1, -1, -1]),
    { visible: [3, 2, 1], desiredValue: 1 }
);
assert.deepEqual(
    runStepSequence(tint, 4, [1, 1, -1, 1]),
    { visible: [5, 6, 5, 6], desiredValue: 6 }
);
assert.deepEqual(
    runStepSequence(exposure, 0, [1, 1, 1]).visible,
    [0.1, 0.2, 0.3]
);

const scheduledTimers = new Map();
let nextTimerId = 1;
const submittedStepValues = [];
let handledSubmissions = 0;
const debounceContext = {
    setTimeout(callback, delay) {
        const id = nextTimerId++;
        scheduledTimers.set(id, { callback, delay });
        return id;
    },
    clearTimeout(id) {
        scheduledTimers.delete(id);
    },
    submitDevelopSliderValue(_control, value, kind, completion) {
        submittedStepValues.push({ value, kind });
        completion(true);
    },
    handleDevelopSliderStepSubmission() {
        handledSubmissions += 1;
    }
};
require("node:vm").runInNewContext(
    extractFunctions("scheduleDevelopSliderStepSubmission", "stepDevelopSliderValue") +
    "\nthis.schedule = scheduleDevelopSliderStepSubmission;",
    debounceContext
);
const burstControl = { desiredValue: 4, stepDebounceTimer: null };
for (const value of [5, 6, 7, 8, 9]) {
    burstControl.desiredValue = value;
    debounceContext.schedule(burstControl);
}
assert.equal(scheduledTimers.size, 1);
const finalTimer = Array.from(scheduledTimers.values())[0];
assert.equal(finalTimer.delay, 350);
assert.deepEqual(submittedStepValues, []);
finalTimer.callback();
assert.deepEqual(submittedStepValues, [{ value: 9, kind: "step" }]);
assert.equal(handledSubmissions, 1);

assert.match(builder, /id:\s*"set"[\s\S]*route:\s*"set"[\s\S]*valueSource:\s*"sliders"/);
assert.match(builder, /return "\/api\/set\?slider="/);
assert.match(builder, /slider\.numericStep/);
assert.match(builder, /builderAmount\.min = String\(slider\.min\)/);
assert.match(builder, /builderAmount\.max = String\(slider\.max\)/);
assert.match(builder, /builderAmount\.step = String\(slider\.numericStep\)/);
assert.match(builder, /copyBuilderPath"\)\.disabled = !valid/);
assert.match(builder, /copyBuilderFull"\)\.disabled = !valid/);
assert.match(builder, /fetch\("\/api\/sliders"\)/);

for (const item of feedbackDefinitions) {
    assert.equal(sliders.parseAbsoluteValue(item.id, String(item.min)), item.min);
    assert.equal(sliders.parseAbsoluteValue(item.id, String(item.max)), item.max);
}
assert.equal(sliders.parseAbsoluteValue("Exposure", "1.25"), 1.25);
assert.equal(sliders.parseAbsoluteValue("Exposure", "1.234"), null);
assert.equal(sliders.parseAbsoluteValue("Contrast", "1.5"), null);
assert.equal(sliders.parseAbsoluteValue("Unknown", "0"), null);

assert.match(driver, /startTracking\(developSlider\)[\s\S]*setValue\(developSlider, value\)/);
assert.match(feedback, /available=0/);
assert.match(feedback, /feedback many snapshot read/);
assert.doesNotMatch(
    feedback.match(/local function sendManyRequestedValues[\s\S]*?local function sendAllRequestedValues/)[0],
    /lastSentValues\[slider\]\s*~=/
);
assert.match(query, /Tint = "Tint"/);
assert.match(query, /LrDevelopController\.getRange\(param\)/);
assert.match(driver, /Tint = "Tint"/);
assert.match(driver, /setValue\(developSlider, value\)/);
assert.match(parser, /value = string\.match\(json, \[\["value":\(\[%\-\]\?%d\+%\.\?%d\*\)\]\]\)/);
assert.match(luaCommands, /Driver\.setSlider\(\s*command\.slider,\s*command\.value\s*\)/);

console.log("Generic Develop slider metadata, controller, Builder, and feedback contracts passed.");
console.log("Validated 96 definitions and 93 reusable authoritative-feedback controls.");
