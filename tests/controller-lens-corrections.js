const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const controller = fs.readFileSync(path.join(root, "app/controller.html"), "utf8");
const metadata = require("../config/sliders.json");
const query = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/Query.lua"), "utf8");
const driver = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/Driver.lua"), "utf8");
const polling = fs.readFileSync(path.join(root, "lightroom/LRBridge.lrplugin/FeedbackPolling.lua"), "utf8");
const audit = fs.readFileSync(path.join(root, "docs/LIGHTROOM_15_3_SDK_CAPABILITY_AUDIT.md"), "utf8");

function metadataFor(id) {
    const definition = metadata.find((item) => item.id === id);
    assert.ok(definition, "Missing slider metadata for " + id);
    return definition;
}

function extractFunctionBlock(firstName, nextName) {
    const start = controller.indexOf("function " + firstName + "(");
    const end = controller.indexOf("function " + nextName + "(", start);
    assert.notEqual(start, -1, "Missing function " + firstName);
    assert.notEqual(end, -1, "Missing following function " + nextName);
    return controller.slice(start, end);
}

const lensRendererStart = controller.indexOf("function renderLensCorrectionsSection(");
const lensRendererEnd = controller.indexOf("window.addEventListener(\"blur\"", lensRendererStart);
assert.notEqual(lensRendererStart, -1);
assert.notEqual(lensRendererEnd, -1);
const lensBlock = controller.slice(lensRendererStart, lensRendererEnd);

assert.match(controller, /className = "lens-corrections-tabs"/);
assert.match(lensBlock, /setAttribute\("role", "tablist"\)/);
assert.match(lensBlock, /\[\["profile", "Profile", profilePanel\], \["manual", "Manual", manualPanel\]\]/);
assert.match(lensBlock, /sessionStorage\.setItem\("lrbridge\.lensCorrectionsView", lensCorrectionsView\)/);
assert.match(controller, /sessionStorage\.getItem\("lrbridge\.lensCorrectionsView"\)/);
assert.match(controller, /section\.id === "lens-corrections"[\s\S]*renderLensCorrectionsSection\(groupElement, section\)/);

const manualStart = lensBlock.indexOf("manualPanel.appendChild(createLensSubheading(\"Distortion\"))");
assert.notEqual(manualStart, -1);
const profileBuild = lensBlock.slice(0, manualStart);
const manualBuild = lensBlock.slice(manualStart);
for (const id of ["AutoLateralCA", "LensProfileEnable", "LensProfileDistortionScale", "LensProfileVignettingScale"]) {
    assert.ok(profileBuild.includes('"' + id + '"'), id + " must render under Profile");
    assert.ok(!manualBuild.includes('"' + id + '"'), id + " must not render under Manual");
}
for (const id of [
    "LensManualDistortionAmount", "DefringePurpleAmount",
    "DefringePurpleHueLo", "DefringePurpleHueHi", "DefringeGreenAmount",
    "DefringeGreenHueLo", "DefringeGreenHueHi", "VignetteAmount", "VignetteMidpoint"
]) {
    assert.ok(manualBuild.includes('"' + id + '"'), id + " must render under Manual");
    assert.ok(!profileBuild.includes('"' + id + '"'), id + " must not render under Profile");
}
assert.ok(!lensBlock.includes('"CropConstrainToWarp"'),
    "Lens Manual must reuse the established categorical presentation rather than create a second parameter");
const manualDistortionPosition = manualBuild.indexOf('appendSlider(manualPanel, "LensManualDistortionAmount", "Amount")');
const constrainCropPosition = manualBuild.indexOf("appendConstrainCropControl(manualPanel)");
const defringePosition = manualBuild.indexOf('manualPanel.appendChild(createLensSubheading("Defringe"))');
assert.ok(manualDistortionPosition >= 0 && manualDistortionPosition < constrainCropPosition &&
    constrainCropPosition < defringePosition,
"Lens Manual Constrain Crop must render after Distortion Amount and before Defringe");
assert.match(controller, /developCategoricalControls\.constrainCrop\.push\(\{ row: row, buttons: buttons, status: status \}\)/,
    "Both Constrain Crop presentations must register against the shared categorical state");

assert.match(lensBlock, /createCompoundDevelopRangeControl\("Purple Hue", purpleLow, purpleHigh\)/);
assert.match(lensBlock, /createCompoundDevelopRangeControl\("Green Hue", greenLow, greenHigh\)/);
assert.match(lensBlock, /const purpleLow = sliderDefinition\("DefringePurpleHueLo"/);
assert.match(lensBlock, /const purpleHigh = sliderDefinition\("DefringePurpleHueHi"/);
assert.match(lensBlock, /const greenLow = sliderDefinition\("DefringeGreenHueLo"/);
assert.match(lensBlock, /const greenHigh = sliderDefinition\("DefringeGreenHueHi"/);
assert.equal((lensBlock.match(/createCompoundDevelopRangeControl\(\s*"Purple Hue"/g) || []).length, 1);
assert.equal((lensBlock.match(/createCompoundDevelopRangeControl\(\s*"Green Hue"/g) || []).length, 1);
assert.doesNotMatch(controller, /reverseVisualAxis|reverse-visual-axis|direction:\s*rtl/,
    "Compound hue geometry must remain normal left-to-right");
const compoundFactory = extractFunctionBlock("createCompoundDevelopRangeControl", "createLensSubheading");
assert.match(compoundFactory, /createDevelopSliderControl\(lowDefinition\)/);
assert.match(compoundFactory, /createDevelopSliderControl\(highDefinition\)/);
assert.match(compoundFactory, /lowControl\.range\.dataset\.sliderId = lowDefinition\.id/);
assert.match(compoundFactory, /highControl\.range\.dataset\.sliderId = highDefinition\.id/);
assert.match(compoundFactory, /lowHandle\.dataset\.sliderId = lowDefinition\.id/);
assert.match(compoundFactory, /highHandle\.dataset\.sliderId = highDefinition\.id/);
assert.doesNotMatch(compoundFactory, /lowControl\.range\.dataset\.sliderId = highDefinition\.id/);
assert.doesNotMatch(compoundFactory, /highControl\.range\.dataset\.sliderId = lowDefinition\.id/);
assert.match(compoundFactory, /document\.createElement\("button"\)/);
assert.match(compoundFactory, /track\.appendChild\(lowHandle\)/);
assert.match(compoundFactory, /track\.appendChild\(highHandle\)/);
assert.match(compoundFactory, /visualMinimum: 0/);
assert.match(compoundFactory, /visualMaximum: 100/);
assert.match(compoundFactory, /minimumGap: 10/);
assert.doesNotMatch(compoundFactory, /track\.appendChild\(lowControl\.range\)|track\.appendChild\(highControl\.range\)/,
    "Detached semantic range inputs must not compete for compound pointer events");
assert.match(controller, /\.compound-develop-range-handle\s*\{[\s\S]*touch-action: none/);
assert.doesNotMatch(controller, /\.compound-develop-range-track input\[type="range"\]/);
assert.doesNotMatch(controller, /\.compound-range-high\s*\{[\s\S]*z-index/,
    "The Hi endpoint must not own the entire compound track through z-index");

function fakeClassList() {
    const values = new Set();
    return {
        add(value) { values.add(value); },
        remove(...items) { items.forEach((item) => values.delete(item)); },
        has(value) { return values.has(value); }
    };
}

function fakeRange() {
    return {
        value: "",
        disabled: true,
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; }
    };
}

function fakeHandle() {
    const listeners = {};
    let capturedPointer = null;
    return {
        disabled: true,
        style: {},
        attributes: {},
        addEventListener(name, listener) { listeners[name] = listener; },
        setAttribute(name, value) { this.attributes[name] = value; },
        setPointerCapture(pointerId) { capturedPointer = pointerId; },
        hasPointerCapture(pointerId) { return capturedPointer === pointerId; },
        releasePointerCapture(pointerId) { if (capturedPointer === pointerId) capturedPointer = null; },
        dispatch(name, properties) {
            assert.ok(listeners[name], "Missing " + name + " listener");
            listeners[name](Object.assign({
                pointerId: 1,
                button: 0,
                clientX: 0,
                preventDefault() {}
            }, properties));
        }
    };
}

function testDefinition(id, range) {
    return {
        id,
        min: range.min,
        max: range.max,
        rangeStep: 1,
        numericStep: 1,
        displayPrecision: 0
    };
}

const scheduledSubmissions = [];
const flushedSubmissions = [];
let throttleCancellations = 0;
const coupledSource = extractFunctionBlock("coupledDevelopSliderValue", "compoundDevelopRangeValue");
const updateSource = extractFunctionBlock("compoundDevelopRangeValue", "createCompoundDevelopRangeControl");
assert.doesNotMatch(updateSource, /100\s*-\s*(?:progress|compoundDevelopRangeProgress)/,
    "Compound value progress must never be reversed with a 100-progress transform");
const pointerSource = extractFunctionBlock("compoundDevelopRangePointerValue", "compoundDevelopRangeControl");
assert.doesNotMatch(pointerSource, /definition\.(?:min|max)/,
    "Pointer geometry must not use Lightroom's mutable endpoint range");
assert.match(pointerSource, /visualMinimum \+ progress \* \(visualMaximum - visualMinimum\)/);
const updateContext = {
    actualToDevelopSliderPosition(_definition, value) { return value; },
    formatDevelopSliderValue(_definition, value) { return String(value); },
    valuesMatchDevelopSlider(_definition, left, right) { return Number(left) === Number(right); },
    showDevelopSliderLocal(control, value) { control.localValue = value; control.range.value = String(value); },
    scheduleDevelopSliderValue(control, value) {
        scheduledSubmissions.push({ id: control.definition.id, value });
    },
    flushDevelopSliderValue(control, value) {
        flushedSubmissions.push({ id: control.definition.id, value });
    },
    cancelDevelopSliderStep() {},
    cancelDevelopSliderThrottle() { throttleCancellations += 1; },
    beginDevelopSliderInteraction() {},
    endDevelopSliderInteraction() {},
    scheduleDevelopSliderStepSubmission(control) { flushedSubmissions.push(control.definition.id); },
    Math,
    Number
};
vm.runInNewContext(
    coupledSource + updateSource + "\nthis.update = updateCompoundDevelopRange;" +
        "\nthis.pointerValue = compoundDevelopRangePointerValue;" +
        "\nthis.visualProgress = compoundDevelopRangeVisualProgress;" +
        "\nthis.effectiveBounds = compoundDevelopRangeEffectiveBounds;" +
        "\nthis.clampValue = clampCompoundDevelopRangeValue;" +
        "\nthis.bindHandle = bindCompoundDevelopRangeHandle;",
    updateContext
);

function makeCompound(lowId, highId, lowValue, highValue, lowRange, highRange) {
    const styleValues = {};
    const lowControl = {
        localValue: null, authoritativeValue: lowValue, feedbackState: "available",
        contextInvalidated: false, definition: testDefinition(lowId, lowRange), range: fakeRange()
    };
    const highControl = {
        localValue: null, authoritativeValue: highValue, feedbackState: "available",
        contextInvalidated: false, definition: testDefinition(highId, highRange), range: fakeRange()
    };
    const compound = {
        lowControl,
        highControl,
        lowHandle: fakeHandle(),
        highHandle: fakeHandle(),
        track: {
            getBoundingClientRect() { return { left: 0, width: 100 }; },
            style: { setProperty(name, value) { styleValues[name] = value; } }
        },
        value: { textContent: "" },
        reset: { disabled: true },
        row: { classList: fakeClassList() },
        state: { textContent: "" },
        activeEndpoint: null,
        activePointerId: null,
        dragChanged: false,
        dragValue: null,
        visualMinimum: 0,
        visualMaximum: 100,
        minimumGap: 10
    };
    compound.styleValues = styleValues;
    return compound;
}

const purpleCompound = makeCompound(
    "DefringePurpleHueLo",
    "DefringePurpleHueHi",
    41,
    85,
    { min: 0, max: 75 },
    { min: 51, max: 100 }
);
updateContext.update(purpleCompound);
assert.equal(updateContext.pointerValue(
    purpleCompound.lowControl.definition, 41, { left: 0, width: 100 }, 0, 100
), 41);
assert.equal(updateContext.pointerValue(
    purpleCompound.highControl.definition, 85, { left: 0, width: 100 }, 0, 100
), 85);
assert.equal(updateContext.visualProgress(41, 0, 100), 41);
assert.equal(updateContext.visualProgress(85, 0, 100), 85);
assert.equal(purpleCompound.lowControl.range.value, "41");
assert.equal(purpleCompound.highControl.range.value, "85");
assert.equal(purpleCompound.lowHandle.style.left, "41%",
    "Purple HueLo=41 must ignore its authoritative 0..75 allowed range for geometry");
assert.equal(purpleCompound.highHandle.style.left, "85%",
    "Purple HueHi=85 must ignore its authoritative 51..100 allowed range for geometry");
assert.notEqual(purpleCompound.lowHandle.style.left, "54.666666666666664%");
assert.notEqual(purpleCompound.highHandle.style.left, "69.38775510204081%");
assert.equal(purpleCompound.styleValues["--compound-fill-start"], "41%");
assert.equal(purpleCompound.styleValues["--compound-fill-end"], "85%");
assert.equal(purpleCompound.value.textContent, "41 / 85");
assert.deepEqual(
    JSON.parse(JSON.stringify(updateContext.effectiveBounds(purpleCompound, "low"))),
    { minimum: 0, maximum: 75 }
);
assert.deepEqual(
    JSON.parse(JSON.stringify(updateContext.effectiveBounds(purpleCompound, "high"))),
    { minimum: 51, maximum: 100 }
);
assert.equal(purpleCompound.lowHandle.attributes["aria-valuemin"], "0");
assert.equal(purpleCompound.lowHandle.attributes["aria-valuemax"], "75");
assert.equal(purpleCompound.highHandle.attributes["aria-valuemin"], "51");
assert.equal(purpleCompound.highHandle.attributes["aria-valuemax"], "100");

purpleCompound.lowControl.definition.max = 70;
updateContext.update(purpleCompound);
assert.equal(purpleCompound.lowHandle.style.left, "41%",
    "Changing only Lo's allowed maximum must not move Lo");
assert.equal(purpleCompound.highHandle.style.left, "85%",
    "Changing only Lo's allowed maximum must not move Hi");
assert.equal(purpleCompound.lowHandle.attributes["aria-valuemax"], "75",
    "Custom Lo ARIA bounds must ignore stale Lightroom endpoint ranges");

purpleCompound.lowControl.definition.max = 75;
purpleCompound.lowControl.authoritativeValue = 46;
purpleCompound.highControl.definition.min = 56;
updateContext.update(purpleCompound);
assert.equal(purpleCompound.lowHandle.style.left, "46%");
assert.equal(purpleCompound.highHandle.style.left, "85%",
    "Hi must remain at 85% when only Lo changes and Hi's allowed minimum follows");
assert.equal(purpleCompound.value.textContent, "46 / 85");

purpleCompound.lowControl.authoritativeValue = 41;
purpleCompound.highControl.definition.min = 51;
updateContext.update(purpleCompound);

const greenCompound = makeCompound(
    "DefringeGreenHueLo",
    "DefringeGreenHueHi",
    42,
    92,
    { min: 0, max: 82 },
    { min: 52, max: 100 }
);
updateContext.update(greenCompound);
assert.equal(updateContext.pointerValue(
    greenCompound.lowControl.definition, 42, { left: 0, width: 100 }, 0, 100
), 42);
assert.equal(updateContext.pointerValue(
    greenCompound.highControl.definition, 92, { left: 0, width: 100 }, 0, 100
), 92);
assert.equal(greenCompound.lowControl.range.value, "42");
assert.equal(greenCompound.highControl.range.value, "92");
assert.equal(greenCompound.lowHandle.style.left, "42%",
    "Green HueLo=42 must ignore its authoritative 0..82 allowed range for geometry");
assert.equal(greenCompound.highHandle.style.left, "92%",
    "Green HueHi=92 must ignore its authoritative 52..100 allowed range for geometry");
assert.notEqual(greenCompound.lowHandle.style.left, "51.21951219512195%");
assert.notEqual(greenCompound.highHandle.style.left, "83.33333333333333%");
assert.equal(greenCompound.styleValues["--compound-fill-start"], "42%");
assert.equal(greenCompound.styleValues["--compound-fill-end"], "92%");
assert.equal(greenCompound.value.textContent, "42 / 92");

const liveClampSource = extractFunctionBlock(
    "compoundDevelopRangeEffectiveBounds",
    "updateCompoundDevelopRange"
);
assert.doesNotMatch(liveClampSource, /definition\.(?:min|max)/,
    "Compound interaction bounds must not use asynchronous Lightroom endpoint ranges");
assert.match(liveClampSource, /compound\.visualMinimum/);
assert.match(liveClampSource, /compound\.visualMaximum/);
assert.match(liveClampSource, /compoundDevelopRangeValue\(compoundDevelopRangeOtherControl/);

function assertFixedEndpointDrag(
    compound,
    role,
    clientX,
    expectedId,
    unexpectedId,
    expectedValue,
    untouchedValue,
    pointerId,
    pastBoundaryClientX
) {
    scheduledSubmissions.length = 0;
    flushedSubmissions.length = 0;
    const activeHandle = role === "low" ? compound.lowHandle : compound.highHandle;
    const otherHandle = role === "low" ? compound.highHandle : compound.lowHandle;
    const activeControl = role === "low" ? compound.lowControl : compound.highControl;
    const otherControl = role === "low" ? compound.highControl : compound.lowControl;
    activeHandle.dispatch("pointerdown", { pointerId, button: 0 });
    assert.equal(compound.activeEndpoint, role, "pointerdown must permanently select " + role);
    otherHandle.dispatch("pointermove", { pointerId, clientX: role === "low" ? 99 : 1 });
    assert.equal(compound.activeEndpoint, role, "the other handle must not steal an active drag");
    activeHandle.dispatch("pointermove", { pointerId, clientX });
    if (pastBoundaryClientX !== undefined) {
        activeHandle.dispatch("pointermove", { pointerId, clientX: pastBoundaryClientX });
    }
    assert.equal(activeControl.localValue, expectedValue);
    assert.equal(otherControl.localValue, null, "A compound drag must not synthesize the other endpoint");
    assert.equal(otherControl.authoritativeValue, untouchedValue, "A compound drag must not alter the other endpoint");
    activeHandle.dispatch("pointerup", { pointerId, clientX });
    assert.deepEqual(scheduledSubmissions, [{ id: expectedId, value: expectedValue }]);
    assert.deepEqual(flushedSubmissions, [{ id: expectedId, value: expectedValue }]);
    assert.ok(
        !scheduledSubmissions.some(entry => entry.id === unexpectedId) &&
            !flushedSubmissions.some(entry => entry.id === unexpectedId),
        unexpectedId + " must receive zero submissions during the " + role + " drag");
    assert.equal(compound.activeEndpoint, null);
}

for (const compound of [purpleCompound, greenCompound]) {
    updateContext.bindHandle(compound, "low");
    updateContext.bindHandle(compound, "high");
}
assertFixedEndpointDrag(
    purpleCompound,
    "low",
    80,
    "DefringePurpleHueLo",
    "DefringePurpleHueHi",
    75,
    85,
    11,
    99
);
purpleCompound.lowControl.localValue = null;
purpleCompound.lowControl.authoritativeValue = 41;
assertFixedEndpointDrag(
    purpleCompound,
    "high",
    45,
    "DefringePurpleHueHi",
    "DefringePurpleHueLo",
    51,
    41,
    12,
    1
);
assertFixedEndpointDrag(
    greenCompound,
    "low",
    45,
    "DefringeGreenHueLo",
    "DefringeGreenHueHi",
    45,
    92,
    21
);
greenCompound.lowControl.localValue = null;
greenCompound.lowControl.authoritativeValue = 42;
assertFixedEndpointDrag(
    greenCompound,
    "high",
    80,
    "DefringeGreenHueHi",
    "DefringeGreenHueLo",
    80,
    42,
    22
);

const rapidLowRace = makeCompound(
    "DefringePurpleHueLo",
    "DefringePurpleHueHi",
    34,
    65,
    { min: 0, max: 55 },
    { min: 44, max: 100 }
);
updateContext.bindHandle(rapidLowRace, "low");
updateContext.bindHandle(rapidLowRace, "high");
rapidLowRace.highHandle.dispatch("pointerdown", { pointerId: 31, button: 0 });
rapidLowRace.highHandle.dispatch("pointermove", { pointerId: 31, clientX: 95 });
rapidLowRace.highHandle.dispatch("pointerup", { pointerId: 31, clientX: 95 });
assert.equal(rapidLowRace.highControl.localValue, 95);
assert.equal(rapidLowRace.lowControl.definition.max, 55,
    "The race fixture must retain Lightroom's stale Lo maximum");

scheduledSubmissions.length = 0;
flushedSubmissions.length = 0;
rapidLowRace.lowHandle.dispatch("pointerdown", { pointerId: 32, button: 0 });
rapidLowRace.lowHandle.dispatch("pointermove", { pointerId: 32, clientX: 80 });
assert.equal(rapidLowRace.lowControl.localValue, 80,
    "Lo must immediately follow the latest local Hi value instead of stopping at stale max=55");
rapidLowRace.lowHandle.dispatch("pointermove", { pointerId: 32, clientX: 95 });
assert.equal(rapidLowRace.lowControl.localValue, 85,
    "Lo must stop at current local Hi minus the ten-point gap");
assert.equal(rapidLowRace.highControl.localValue, 95);
rapidLowRace.lowHandle.dispatch("pointerup", { pointerId: 32, clientX: 95 });
assert.deepEqual(scheduledSubmissions, [
    { id: "DefringePurpleHueLo", value: 80 },
    { id: "DefringePurpleHueLo", value: 85 }
]);
assert.deepEqual(flushedSubmissions, [{ id: "DefringePurpleHueLo", value: 85 }]);

const rapidHighRace = makeCompound(
    "DefringeGreenHueLo",
    "DefringeGreenHueHi",
    34,
    65,
    { min: 0, max: 55 },
    { min: 44, max: 100 }
);
updateContext.bindHandle(rapidHighRace, "low");
updateContext.bindHandle(rapidHighRace, "high");
rapidHighRace.lowHandle.dispatch("pointerdown", { pointerId: 41, button: 0 });
rapidHighRace.lowHandle.dispatch("pointermove", { pointerId: 41, clientX: 5 });
rapidHighRace.lowHandle.dispatch("pointerup", { pointerId: 41, clientX: 5 });
assert.equal(rapidHighRace.lowControl.localValue, 5);
assert.equal(rapidHighRace.highControl.definition.min, 44,
    "The race fixture must retain Lightroom's stale Hi minimum");

scheduledSubmissions.length = 0;
flushedSubmissions.length = 0;
rapidHighRace.highHandle.dispatch("pointerdown", { pointerId: 42, button: 0 });
rapidHighRace.highHandle.dispatch("pointermove", { pointerId: 42, clientX: 20 });
assert.equal(rapidHighRace.highControl.localValue, 20,
    "Hi must immediately follow the latest local Lo value instead of stopping at stale min=44");
rapidHighRace.highHandle.dispatch("pointermove", { pointerId: 42, clientX: 0 });
assert.equal(rapidHighRace.highControl.localValue, 15,
    "Hi must stop at current local Lo plus the ten-point gap");
assert.equal(rapidHighRace.lowControl.localValue, 5);
rapidHighRace.highHandle.dispatch("pointerup", { pointerId: 42, clientX: 0 });
assert.deepEqual(scheduledSubmissions, [
    { id: "DefringeGreenHueHi", value: 20 },
    { id: "DefringeGreenHueHi", value: 15 }
]);
assert.deepEqual(flushedSubmissions, [{ id: "DefringeGreenHueHi", value: 15 }]);

const activeRangeUpdate = makeCompound(
    "DefringePurpleHueLo",
    "DefringePurpleHueHi",
    34,
    95,
    { min: 0, max: 55 },
    { min: 44, max: 100 }
);
updateContext.bindHandle(activeRangeUpdate, "low");
updateContext.bindHandle(activeRangeUpdate, "high");
scheduledSubmissions.length = 0;
flushedSubmissions.length = 0;
const cancellationsBeforeRangeUpdate = throttleCancellations;
activeRangeUpdate.lowHandle.dispatch("pointerdown", { pointerId: 51, button: 0 });
activeRangeUpdate.lowHandle.dispatch("pointermove", { pointerId: 51, clientX: 70 });
assert.equal(activeRangeUpdate.lowControl.localValue, 70);
activeRangeUpdate.lowControl.definition.max = 60;
updateContext.update(activeRangeUpdate);
assert.equal(activeRangeUpdate.activeEndpoint, "low");
assert.equal(activeRangeUpdate.activePointerId, 51);
assert.equal(activeRangeUpdate.lowHandle.hasPointerCapture(51), true);
assert.equal(activeRangeUpdate.lowControl.localValue, 70,
    "A dynamic getRange change must not roll back the active local value");
assert.equal(activeRangeUpdate.lowHandle.attributes["aria-valuemax"], "85");
assert.equal(throttleCancellations, cancellationsBeforeRangeUpdate,
    "A dynamic getRange change must not cancel the active compound throttle");
activeRangeUpdate.lowHandle.dispatch("pointermove", { pointerId: 51, clientX: 80 });
assert.equal(activeRangeUpdate.lowControl.localValue, 80,
    "The drag must continue after a dynamic range update");
activeRangeUpdate.lowHandle.dispatch("pointerup", { pointerId: 51, clientX: 80 });
assert.deepEqual(scheduledSubmissions, [
    { id: "DefringePurpleHueLo", value: 70 },
    { id: "DefringePurpleHueLo", value: 80 }
]);
assert.deepEqual(flushedSubmissions, [{ id: "DefringePurpleHueLo", value: 80 }]);

const staleKeyboardRange = makeCompound(
    "DefringeGreenHueLo",
    "DefringeGreenHueHi",
    60,
    95,
    { min: 0, max: 55 },
    { min: 44, max: 100 }
);
updateContext.bindHandle(staleKeyboardRange, "low");
flushedSubmissions.length = 0;
staleKeyboardRange.lowHandle.dispatch("keydown", { key: "ArrowRight" });
assert.equal(staleKeyboardRange.lowControl.localValue, 61,
    "Keyboard movement must also ignore a stale endpoint maximum");
assert.deepEqual(flushedSubmissions, ["DefringeGreenHueLo"]);

greenCompound.highControl.feedbackState = "unavailable";
greenCompound.highControl.authoritativeValue = null;
greenCompound.highControl.localValue = null;
updateContext.update(greenCompound);
assert.equal(greenCompound.lowHandle.disabled, true);
assert.equal(greenCompound.highHandle.disabled, true);
assert.equal(greenCompound.reset.disabled, true);
assert.equal(greenCompound.value.textContent, "-- / --");
assert.equal(greenCompound.state.textContent, "Unavailable");

assert.match(compoundFactory, /sendCommand\("\/api\/reset\?slider=" \+ encodeURIComponent\(lowDefinition\.id\)\)/);
assert.match(compoundFactory, /sendCommand\("\/api\/reset\?slider=" \+ encodeURIComponent\(highDefinition\.id\)\)/);
assert.match(compoundFactory, /markSliderCommandSent\(\)/);
assert.match(controller, /submitDevelopSliderValue[\s\S]*control\.definition\.id/,
    "Each compound endpoint must retain generic submission through its own Lightroom parameter ID");

assert.deepEqual(
    [metadataFor("DefringePurpleHueLo").default, metadataFor("DefringePurpleHueHi").default],
    [30, 70]
);
assert.deepEqual(
    [metadataFor("DefringeGreenHueLo").default, metadataFor("DefringeGreenHueHi").default],
    [40, 60]
);
assert.deepEqual(
    { min: metadataFor("VignetteAmount").min, max: metadataFor("VignetteAmount").max, default: metadataFor("VignetteAmount").default },
    { min: -100, max: 100, default: 0 }
);
assert.deepEqual(
    { min: metadataFor("VignetteMidpoint").min, max: metadataFor("VignetteMidpoint").max, default: metadataFor("VignetteMidpoint").default },
    { min: 0, max: 100, default: 50 }
);
for (const id of ["VignetteAmount", "VignetteMidpoint", "LensProfileEnable", "AutoLateralCA"]) {
    assert.equal(metadataFor(id).feedbackSupported, true);
    assert.match(driver, new RegExp(id + " = \\\"" + id + "\\\""));
    assert.match(query, new RegExp(id + " = \\\"" + id + "\\\""));
    assert.match(polling, new RegExp("\\\"" + id + "\\\""));
}

assert.match(lensBlock, /control\.hideWhenUnavailable = true/);
assert.match(controller, /if \(control\.hideWhenUnavailable\) control\.row\.hidden = true/);
assert.match(controller, /if \(control\.hideWhenUnavailable\) control\.row\.hidden = false/);
for (const unsupported of ["LensProfileSetup", "LensProfileMake", "LensProfileModel", "LensProfileName", "DefringeEyedropper", "selectDefringeTool"]) {
    assert.ok(!controller.includes(unsupported), unsupported + " must not be represented as a working Web Controller control");
}
assert.doesNotMatch(lensBlock, /createElement\("select"\)|Built-in Lens Profile applied|eyedropper/i);
assert.match(audit, /do not expose Lens Profile Setup, Make, Model, or Profile selection/);
assert.match(audit, /no dedicated authoritative built-in-lens-profile status getter or reliable lens-profile inventory/);
assert.match(audit, /Specific lens profiles can be applied through ordinary configured Develop presets/);
assert.match(audit, /No Defringe eyedropper\/tool-selection value is documented/);

console.log("Lens Corrections Profile/Manual, authoritative feedback, and compound hue contracts passed.");
