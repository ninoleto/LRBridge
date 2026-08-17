"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const commands = require("../server/commands");
const lensBlurDefinition = require("../server/lens-blur-state");
const focalRange = require("../server/lens-blur-focal-range");
const nativeDefinition = require("../server/windows-lightroom-native");
const lensBlurUi = require("../app/controller-lens-blur");
const { createBridge } = require("../server/bridge");

const root = path.join(__dirname, "..");
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), "utf8"); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

const metadata = require("../config/sliders.json");
const scalarIds = ["LensBlurAmount", "LensBlurCatEye", "LensBlurHighlightsBoost"];
const expectedBokeh = [
    { value: "Circle", label: "Circle" },
    { value: "SoapBubble", label: "Bubble" },
    { value: "Blade", label: "5-Blade" },
    { value: "Ring", label: "Ring" },
    { value: "Anamorphic", label: "Anamorphic" }
];

assert.deepEqual(metadata.filter((item) => item.group === "Lens Blur").map((item) => item.id), scalarIds);
for (const id of scalarIds) {
    const definition = metadata.find((item) => item.id === id);
    assert.deepEqual([definition.min, definition.max, definition.rangeStep, definition.numericStep], [0, 100, 1, 1]);
    assert.equal(definition.feedbackSupported, true);
    assert.equal(definition.adjustSupported, false);
    assert.equal(definition.resetSupported, true);
}

assert.deepEqual(Array.from(lensBlurDefinition.bokehValues), expectedBokeh.map((item) => item.value));
assert.deepEqual(Array.from(lensBlurUi.bokehOptions), expectedBokeh);
const subjectRangeA = { nearOuter: -45, nearInner: 35, farInner: 86, farOuter: 166 };
const manualRangeB = { nearOuter: -45, nearInner: 35, farInner: 77, farOuter: 157 };
const subjectRangeC = { nearOuter: -42, nearInner: 38, farInner: 82, farOuter: 162 };
function focusState(source, range, tool) {
    return {
        selectedToolAvailable: true,
        selectedTool: tool || "loupe",
        focalRangeSourceAvailable: true,
        focalRangeSource: source,
        focalRangeAvailable: true,
        focalRange: range
    };
}

const subjectPresentation = lensBlurUi.createSubjectFocusPresentation();
let derivedSubject = subjectPresentation.applyAuthoritative(focusState(1, subjectRangeA), {
    revision: 10,
    focalRangeCommitId: "focus-range-a"
});
assert.equal(derivedSubject.active, false, "Raw source 1 alone must not bootstrap Subject presentation");
assert.equal(subjectPresentation.confirmSubjectAction(focusState(1, subjectRangeA), {
    revision: 11,
    focalRangeCommitId: "focus-range-a"
}), true);
derivedSubject = subjectPresentation.get();
assert.equal(derivedSubject.active, true, "A confirmed Subject action must establish Subject presentation");
assert.deepEqual(derivedSubject.subjectSignature, subjectRangeA);
assert.equal(lensBlurUi.focusSourceText(derivedSubject), "Focus source: Subject");

derivedSubject = subjectPresentation.beginManualEdit();
assert.equal(derivedSubject.active, false, "A pending Web Focus Range edit must present Manual immediately");
assert.equal(lensBlurUi.focusSourceText(derivedSubject), "Focus source: Manual");
derivedSubject = subjectPresentation.applyAuthoritative(focusState(1, manualRangeB), {
    revision: 12,
    focalRangeCommitId: "focus-range-b"
});
assert.equal(derivedSubject.active, false, "Raw source 1 must not override a pending Manual presentation");
subjectPresentation.confirmManualEdit();
for (const revision of [13, 14, 15]) {
    derivedSubject = subjectPresentation.applyAuthoritative(focusState(1, manualRangeB), {
        revision: revision,
        focalRangeCommitId: "focus-range-b"
    });
    assert.equal(derivedSubject.active, false, "Confirmed Manual presentation must survive repeated raw-source-1 polls");
}
assert.deepEqual(subjectPresentation.get().subjectSignature, subjectRangeA,
    "A manual Focus Range edit must preserve the last confirmed Subject signature");
derivedSubject = subjectPresentation.applyAuthoritative(focusState(1, subjectRangeA), {
    revision: 16,
    focalRangeCommitId: "focus-range-b"
});
assert.equal(derivedSubject.active, false);
assert.equal(derivedSubject.externalCandidateCount, 1,
    "Returning to the Subject signature must start external reactivation confirmation");
derivedSubject = subjectPresentation.applyAuthoritative(focusState(1, subjectRangeA), {
    revision: 16,
    focalRangeCommitId: "focus-range-b"
});
assert.equal(derivedSubject.externalCandidateCount, 1, "Duplicate revisions must not advance external reactivation");
derivedSubject = subjectPresentation.applyAuthoritative(focusState(1, subjectRangeA), {
    revision: 17,
    focalRangeCommitId: "focus-range-b"
});
assert.equal(derivedSubject.active, false);
derivedSubject = subjectPresentation.applyAuthoritative(focusState(1, subjectRangeA), {
    revision: 18,
    focalRangeCommitId: "focus-range-b"
});
assert.equal(derivedSubject.active, true,
    "Three stable fresh revisions at the stored signature must reactivate Subject without a Web action");
derivedSubject = subjectPresentation.applyAuthoritative(focusState(1, manualRangeB), {
    revision: 19,
    focalRangeCommitId: "focus-range-b"
});
assert.equal(derivedSubject.active, false, "Moving away from the Subject signature must return presentation to Manual");

const blockedExternalPresentation = lensBlurUi.createSubjectFocusPresentation();
blockedExternalPresentation.applyAuthoritative(focusState(1, subjectRangeA), { revision: 30, focalRangeCommitId: null });
blockedExternalPresentation.confirmSubjectAction(focusState(1, subjectRangeA), { revision: 31, focalRangeCommitId: null });
blockedExternalPresentation.beginManualEdit();
blockedExternalPresentation.applyAuthoritative(focusState(1, manualRangeB), {
    revision: 32,
    focalRangeCommitId: "focus-range-blocked",
    manualTransactionBlocked: true
});
for (const revision of [33, 34, 35]) {
    derivedSubject = blockedExternalPresentation.applyAuthoritative(focusState(1, subjectRangeA), {
        revision: revision,
        focalRangeCommitId: "focus-range-blocked",
        manualTransactionBlocked: true
    });
}
assert.equal(derivedSubject.active, false, "A pending manual transaction must block external Subject reactivation");
assert.equal(derivedSubject.externalCandidateCount, 0,
    "Blocked authoritative revisions must not accumulate toward external reactivation");

const sourceTransitionPresentation = lensBlurUi.createSubjectFocusPresentation();
sourceTransitionPresentation.applyAuthoritative(focusState(1, manualRangeB), { revision: 40, focalRangeCommitId: null });
sourceTransitionPresentation.applyAuthoritative(focusState(2, manualRangeB), { revision: 41, focalRangeCommitId: null });
derivedSubject = sourceTransitionPresentation.applyAuthoritative(focusState(1, subjectRangeC), {
    revision: 42,
    focalRangeCommitId: null
});
assert.equal(derivedSubject.externalCandidateCount, 1,
    "A fresh source-2-to-source-1 transition must arm external Subject confirmation without a stored signature");
sourceTransitionPresentation.applyAuthoritative(focusState(1, subjectRangeC), { revision: 42, focalRangeCommitId: null });
sourceTransitionPresentation.applyAuthoritative(focusState(1, subjectRangeC), { revision: 43, focalRangeCommitId: null });
derivedSubject = sourceTransitionPresentation.applyAuthoritative(focusState(1, subjectRangeC), {
    revision: 44,
    focalRangeCommitId: null
});
assert.equal(derivedSubject.active, true, "A stable source transition must reactivate Subject after three fresh revisions");
assert.deepEqual(derivedSubject.subjectSignature, subjectRangeC,
    "Source-transition reactivation must record its stable complete range as the Subject signature");

const noSignaturePresentation = lensBlurUi.createSubjectFocusPresentation();
for (const revision of [50, 51, 52, 53]) {
    derivedSubject = noSignaturePresentation.applyAuthoritative(focusState(1, manualRangeB), {
        revision: revision,
        focalRangeCommitId: null
    });
}
assert.equal(derivedSubject.active, false, "Raw source 1 without a signature or source transition must remain Manual");
assert.equal(derivedSubject.externalCandidateCount, 0);

const failedEditPresentation = lensBlurUi.createSubjectFocusPresentation();
failedEditPresentation.applyAuthoritative(focusState(1, subjectRangeA), { revision: 20, focalRangeCommitId: null });
failedEditPresentation.confirmSubjectAction(focusState(1, subjectRangeA), { revision: 21, focalRangeCommitId: null });
failedEditPresentation.beginManualEdit();
failedEditPresentation.applyAuthoritative(focusState(1, subjectRangeA), { revision: 22, focalRangeCommitId: null });
derivedSubject = failedEditPresentation.rollbackManualEdit();
assert.equal(derivedSubject.active, true, "A failed Focus Range edit must restore the previous Subject presentation");
assert.deepEqual(derivedSubject.subjectSignature, subjectRangeA);

const pendingSubjectContext = {
    subjectCandidateRange: null,
    subjectCandidateCount: 0,
    subjectCandidateRevision: null
};
assert.equal(subjectPresentation.canConfirmSubjectAction(focusState(1, manualRangeB), pendingSubjectContext,
    { revision: 20 }), false, "The first post-action raw-source-1 poll must not confirm Subject");
assert.equal(subjectPresentation.canConfirmSubjectAction(focusState(1, subjectRangeC), pendingSubjectContext,
    { revision: 21 }), false, "A changed Subject candidate must settle before confirmation");
assert.equal(subjectPresentation.canConfirmSubjectAction(focusState(1, subjectRangeC), pendingSubjectContext,
    { revision: 21 }), false, "Repeated rendering of one revision must not count as another authoritative poll");
assert.equal(subjectPresentation.canConfirmSubjectAction(focusState(1, subjectRangeC), pendingSubjectContext,
    { revision: 22 }), false, "A Subject candidate requires several stable fresh polls");
assert.equal(subjectPresentation.canConfirmSubjectAction(focusState(1, subjectRangeC), pendingSubjectContext,
    { revision: 23 }), true, "Three stable fresh complete ranges must confirm the Subject action");
assert.equal(subjectPresentation.confirmSubjectAction(focusState(1, subjectRangeC), {
    revision: 23,
    focalRangeCommitId: "focus-range-b"
}), true);
derivedSubject = subjectPresentation.get();
assert.equal(derivedSubject.active, true, "A confirmed Subject action must clear the Manual override");
assert.deepEqual(derivedSubject.subjectSignature, subjectRangeC, "Subject confirmation must record the complete range signature");

derivedSubject = subjectPresentation.applyAuthoritative(focusState(1, manualRangeB), {
    revision: 24,
    focalRangeCommitId: "focus-range-b"
});
assert.equal(derivedSubject.active, false,
    "A fresh authoritative Lightroom range change away from the Subject signature must present Manual");
subjectPresentation.confirmSubjectAction(focusState(1, subjectRangeC), { revision: 25, focalRangeCommitId: null });
derivedSubject = subjectPresentation.applyAuthoritative(focusState(1, manualRangeB), {
    revision: 24,
    focalRangeCommitId: "stale"
});
assert.equal(derivedSubject.active, true, "An older stale poll must not invalidate a newer Subject signature");
derivedSubject = subjectPresentation.applyAuthoritative(focusState(2, subjectRangeC), {
    revision: 26,
    focalRangeCommitId: null
});
assert.equal(derivedSubject.active, false, "Raw source 2 must always present Manual");
assert.equal(lensBlurUi.focusSourceText(derivedSubject), "Focus source: Manual");

const independentPointState = focusState(1, subjectRangeC, "focal_range");
assert.deepEqual(lensBlurUi.focusActionActiveStates(independentPointState, {
    available: true,
    active: false
}), { subject: false, pointArea: true }, "Point / Area armed state must remain independent of Subject provenance");
assert.deepEqual(lensBlurUi.focusActionActiveStates(independentPointState, {
    available: true,
    active: true
}), { subject: true, pointArea: true }, "Subject and Point / Area may be presented active simultaneously");
derivedSubject = subjectPresentation.reset();
assert.deepEqual({ available: derivedSubject.available, active: derivedSubject.active, mode: derivedSubject.mode },
    { available: false, active: false, mode: "unknown" }, "Subject provenance must reset at a photo-context boundary");
assert.equal(lensBlurUi.focusSourceText(derivedSubject), "Focus source: Unavailable");
const pointInactiveState = { selectedToolAvailable: true, selectedTool: "loupe" };
const pointActiveState = { selectedToolAvailable: true, selectedTool: "focal_range" };
assert.equal(lensBlurUi.pointAreaToggleIntent(pointInactiveState), true,
    "Point / Area click must intend activation from an authoritative inactive state");
assert.equal(lensBlurUi.pointAreaToggleConfirmed(pointActiveState, true), true,
    "Point / Area activation must confirm false to true");
assert.equal(lensBlurUi.pointAreaToggleIntent(pointActiveState), false,
    "Point / Area click must intend deactivation from an authoritative active state");
assert.equal(lensBlurUi.pointAreaToggleConfirmed(pointInactiveState, false), true,
    "Point / Area deactivation must confirm true to false without a false error");
assert.equal(lensBlurUi.pointAreaToggleConfirmed(pointActiveState, false), false);
assert.equal(lensBlurUi.pointAreaToggleIntent({ selectedToolAvailable: false, selectedTool: null }), null,
    "Point / Area toggle intent must fail closed without authoritative selected-tool feedback");
assert.equal(commands.validateCommand({ command: "lens_blur.active.set", enabled: false }), true);
assert.equal(commands.validateCommand({ command: "lens_blur.active.set", enabled: 0 }), false);
for (const value of lensBlurDefinition.bokehValues) {
    assert.equal(commands.validateCommand({ command: "lens_blur.bokeh.set", value: value }), true);
}
assert.equal(commands.validateCommand({ command: "lens_blur.depth_visualization.toggle" }), false,
    "The production command surface must not admit blind Visualize Depth toggles");
assert.equal(commands.validateCommand({ command: "lens_blur.depth_refinement.close" }), true);
assert.equal(commands.validateCommand({ command: "lens_blur.depth_refinement.close", target: "loupe" }), false);

const capturedRanges = [
    "-50 30 85 165",
    "-80 0 55 135",
    "-35 45 100 180",
    "-20 60 78 158",
    "-43 37 94 174",
    "-43 37 57 137"
];
for (const value of capturedRanges) {
    const parsed = focalRange.parse(value);
    assert.ok(parsed, value);
    assert.equal(focalRange.format(parsed), value);
    assert.equal(commands.validateCommand({ command: "lens_blur.focal_range.set", value: value }), true);
}
for (const invalid of ["", "-43 37 57", "-43 37 57 137 1", "-43 38 37 137", "-43.5 37 57 137",
    " -43 37 57 137", "-43  37 57 137", "NaN 37 57 137", "-1000001 0 1 2"]) {
    assert.equal(focalRange.parse(invalid), null, invalid);
    assert.equal(commands.validateCommand({ command: "lens_blur.focal_range.set", value: invalid }), false);
}
const originalRange = focalRange.parse("-43 37 57 137");
assert.deepEqual(focalRange.translate(originalRange, "whole", 2), { nearOuter: -41, nearInner: 39, farInner: 59, farOuter: 139 });
assert.deepEqual(focalRange.translate(originalRange, "near", -37), { nearOuter: -80, nearInner: 0, farInner: 57, farOuter: 137 });
assert.deepEqual(focalRange.translate(originalRange, "far", -2), { nearOuter: -43, nearInner: 37, farInner: 55, farOuter: 135 });
assert.equal(focalRange.translate(originalRange, "near", 30), null, "Near movement must not cross the Far inner edge");
assert.deepEqual(lensBlurUi.translateFocalRange(originalRange, "whole", 2), { nearOuter: -41, nearInner: 39, farInner: 59, farOuter: 139 });
assert.deepEqual(lensBlurUi.translateFocalRange(originalRange, "near", -37), { nearOuter: -80, nearInner: 0, farInner: 57, farOuter: 137 });
assert.deepEqual(lensBlurUi.translateFocalRange(originalRange, "far", -2), { nearOuter: -43, nearInner: 37, farInner: 55, farOuter: 135 });
assert.equal(lensBlurUi.translateFocalRange(originalRange, "near", 30), null);
assert.deepEqual(lensBlurUi.focalRangeDeltaBounds(originalRange, "whole"), { min: -37, max: 43 });
assert.deepEqual(lensBlurUi.focalRangeDeltaBounds(originalRange, "near"), { min: -37, max: 20 });
assert.deepEqual(lensBlurUi.focalRangeDeltaBounds(originalRange, "far"), { min: -20, max: 43 });

const nearMoved = lensBlurUi.translateFocalRange(originalRange, "near", -12);
assert.equal(nearMoved.nearInner - nearMoved.nearOuter, originalRange.nearInner - originalRange.nearOuter,
    "Near edge movement must preserve the near transition width");
const farMoved = lensBlurUi.translateFocalRange(originalRange, "far", 18);
assert.equal(farMoved.farOuter - farMoved.farInner, originalRange.farOuter - originalRange.farInner,
    "Far edge movement must preserve the far transition width");

const focalTransaction = lensBlurUi.createFocalRangeTransaction();
focalTransaction.applyAuthoritative(originalRange);
assert.equal(focalTransaction.begin("whole"), true);
let focalTransactionState = focalTransaction.move(5);
assert.deepEqual(focalTransactionState.displayed, { nearOuter: -38, nearInner: 42, farInner: 62, farOuter: 142 });
focalTransaction.applyAuthoritative(originalRange);
assert.deepEqual(focalTransaction.get().displayed, focalTransactionState.displayed,
    "Polling must not replace the local range during pointer movement");
const focalCommit = focalTransaction.finish();
assert.equal(focalCommit.submit, true);
assert.deepEqual(focalCommit.expected, originalRange);
focalTransaction.applyAuthoritative(originalRange);
assert.deepEqual(focalTransaction.get().displayed, focalCommit.range,
    "Stale polling must not replace a committed range awaiting readback");
assert.equal(focalTransaction.confirm(originalRange), false, "Only the complete requested range can confirm a commit");
assert.equal(focalTransaction.confirm(focalCommit.range), true);
assert.equal(focalTransaction.get().pending, null);

const latestAuthoritative = { nearOuter: -35, nearInner: 45, farInner: 65, farOuter: 145 };
focalTransaction.applyAuthoritative(originalRange);
assert.equal(focalTransaction.begin("near"), true);
focalTransaction.move(-5);
focalTransaction.applyAuthoritative(latestAuthoritative);
assert.deepEqual(focalTransaction.cancel().displayed, latestAuthoritative,
    "Cancellation must restore the latest authoritative complete range");

commands.resetQueueForTests();
assert.equal(commands.tryEnqueueCommand({ command: "lens_blur.focal_range.set", value: "-43 37 57 137" }).accepted, true);
const coalescedFocal = commands.tryEnqueueCommand({ command: "lens_blur.focal_range.set", value: "-40 40 60 140" });
assert.equal(coalescedFocal.accepted, true);
assert.equal(coalescedFocal.status, commands.ADMISSION_COALESCED);
assert.deepEqual(commands.getNextCommand(), { command: "lens_blur.focal_range.set", value: "-40 40 60 140" },
    "Queued Focus Range writes must retain only the latest complete value");

const decimalEditor = lensBlurUi.createNumericEditor({ precision: 1, min: 0.1, max: 100 });
assert.equal(decimalEditor.applyAuthoritative(42, true, 0.1, 100).text, "42.0");
decimalEditor.begin("42.0");
decimalEditor.change("3");
let editorState = decimalEditor.applyAuthoritative(43, true, 0.1, 100);
assert.equal(editorState.authoritative, 43, "Polling must continue updating the authoritative editor model");
assert.equal(editorState.text, "3", "Polling must not overwrite actively edited text");
assert.equal(editorState.dirty, true);
assert.equal(decimalEditor.cancel().text, "43.0", "Escape semantics restore the latest authoritative value");
decimalEditor.begin("43.0");
decimalEditor.change("31.0");
const preparedDecimal = decimalEditor.prepareCommit("31.0");
assert.deepEqual({ ok: preparedDecimal.ok, submit: preparedDecimal.submit, value: preparedDecimal.value },
    { ok: true, submit: true, value: 31 });
decimalEditor.applyAuthoritative(43, true, 0.1, 100);
assert.equal(decimalEditor.get().text, "31.0", "Committed text remains visible while submission is in flight");
decimalEditor.acceptSubmission();
assert.equal(decimalEditor.get().pending, true, "Accepted submission remains dirty until authoritative confirmation");
editorState = decimalEditor.applyAuthoritative(31, true, 0.1, 100);
assert.equal(editorState.pending, false);
assert.equal(editorState.text, "31.0");
decimalEditor.begin("31.0");
decimalEditor.change("500");
assert.equal(decimalEditor.prepareCommit("500").ok, false, "Out-of-range Brush values must be rejected explicitly");
assert.equal(decimalEditor.rejectSubmission("Invalid numeric value").text, "31.0");

const integerEditor = lensBlurUi.createNumericEditor({ integer: true, min: -1000000, max: 1000000 });
integerEditor.applyAuthoritative(-43, true, -1000000, 1000000);
integerEditor.begin("-43");
integerEditor.change("-80");
assert.equal(integerEditor.prepareCommit("-80").value, -80, "Negative Focus Range integers remain valid");

function runDelayedStepBurst(step, precision, directions, expected) {
    const interaction = lensBlurUi.createStepInteraction({ step: step, precision: precision });
    interaction.applyAuthoritative(50);
    const submitted = [];
    let result = interaction.click(directions[0], 50, 0, 100);
    assert.equal(result.accepted, true);
    assert.ok(Number.isFinite(result.target) && result.target !== 0);
    let request = interaction.takeNextRequest();
    submitted.push(request.target);
    for (let index = 1; index < directions.length; index += 1) {
        interaction.applyAuthoritative(index % 2 === 0 ? 49 : 50);
        result = interaction.click(directions[index], null, 0, 100);
        assert.equal(result.accepted, true);
        assert.ok(Number.isFinite(result.state.pendingTarget) && result.state.pendingTarget !== 0);
        assert.equal(interaction.takeNextRequest(), null, "Only one delayed native request may be in flight");
    }
    interaction.markIdle();
    assert.equal(interaction.takeNextRequest(), null);
    interaction.completeRequest(request, true, request.target);
    request = interaction.takeNextRequest();
    submitted.push(request.target);
    assert.equal(request.final, true);
    assert.equal(request.target, expected);
    interaction.completeRequest(request, true, expected);
    assert.equal(interaction.get().active, false);
    assert.equal(interaction.get().authoritative, expected);
    for (const value of submitted) assert.ok(Number.isFinite(value) && value !== 0 && value !== null);
}

runDelayedStepBurst(1, 0, [1, 1, 1, 1, 1, -1, -1, -1], 52);
runDelayedStepBurst(0.1, 1, [1, 1, 1, 1, 1, -1, -1, -1], 50.2);
runDelayedStepBurst(1, 0, [1, -1, 1, -1], 50);
runDelayedStepBurst(1, 0, [1, 1, -1, 1, -1, 1, 1, -1, 1, -1, 1, 1, -1, 1, -1, 1, 1, -1, 1, -1], 54);
runDelayedStepBurst(0.1, 1, [1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1], 50);

const midBurst = lensBlurUi.createStepInteraction({ step: 1, precision: 0 });
midBurst.applyAuthoritative(50);
midBurst.click(1, 50, 0, 100);
const midFirst = midBurst.takeNextRequest();
midBurst.click(1, null, 0, 100);
midBurst.applyAuthoritative(49);
midBurst.click(1, undefined, 0, 100);
midBurst.completeRequest(midFirst, true, 51);
const midSecond = midBurst.takeNextRequest();
assert.deepEqual({ target: midSecond.target, final: midSecond.final }, { target: 53, final: false });
for (const direction of [1, 1, -1, -1, -1]) {
    midBurst.applyAuthoritative(50);
    midBurst.click(direction, "", 0, 100);
}
midBurst.markIdle();
midBurst.completeRequest(midSecond, true, 53);
const midFinal = midBurst.takeNextRequest();
assert.deepEqual({ target: midFinal.target, final: midFinal.final }, { target: 52, final: true });
midBurst.completeRequest(midFinal, true, 52);
assert.equal(midBurst.get().authoritative, 52);

const rejectedStep = lensBlurUi.createStepInteraction({ step: 1, precision: 0 });
rejectedStep.applyAuthoritative(50);
rejectedStep.click(1, 50, 0, 100);
const rejectedRequest = rejectedStep.takeNextRequest();
rejectedStep.applyAuthoritative(49);
const rejectedOutcome = rejectedStep.completeRequest(rejectedRequest, false, 49);
assert.equal(rejectedOutcome.rollback, 49);
assert.equal(rejectedOutcome.state.active, false);

const model = lensBlurUi.createModel();
let presentation = lensBlurUi.presentationFor(model.get());
assert.equal(presentation.applyAvailable, false);
assert.equal(presentation.focalRangeAvailable, false);
assert.equal(presentation.refinementMode, "unknown");
model.applyAuthoritative({
    activeAvailable: true,
    active: true,
    bokehAvailable: true,
    bokeh: "Circle",
    selectedToolAvailable: true,
    selectedTool: "depth_refinement",
    focalRangeSourceAvailable: true,
    focalRangeSource: 2,
    focalRangeAvailable: true,
    focalRange: originalRange,
    windowsNative: {
        available: true,
        brush: {
            amount: { available: true, value: 100, min: 0, max: 100 },
            size: { available: true, value: 42, min: 0.1, max: 100 },
            feather: { available: true, value: 100, min: 0, max: 100 },
            flow: { available: true, value: 100, min: 1, max: 100 }
        },
        visualizeDepth: { available: true, value: false },
        autoMask: { available: true, value: false },
        refinementMode: "focus",
        refinementModeTargetsAvailable: true,
        refinementDisclosure: { available: true, value: true },
        refinementReset: { available: true, enabled: false },
        focusActions: {
            subject: { available: true, enabled: true },
            pointArea: { available: true, enabled: true }
        }
    }
});
presentation = lensBlurUi.presentationFor(model.get());
assert.equal(presentation.applyOnSelected, true);
assert.equal(presentation.refinementActive, true);
assert.equal(presentation.focalRange.nearOuter, -43);
assert.equal(presentation.brush.size.value, 42);
assert.equal(presentation.visualizeDepth.value, false);
assert.equal(presentation.refinementMode, "focus");
assert.equal(presentation.refinementModeTargetsAvailable, true);
assert.deepEqual(presentation.refinementDisclosure, { available: true, value: true });
assert.deepEqual(presentation.refinementReset, { available: true, enabled: false });
assert.equal(presentation.focalRangeSource, 2);
assert.deepEqual(presentation.focusActions.subject, { available: true, enabled: true });
model.applyWindowsNative(null);
assert.equal(lensBlurUi.presentationFor(model.get()).focalRangeAvailable, true, "Native invalidation must preserve SDK state");
assert.equal(lensBlurUi.presentationFor(model.get()).brush.size.available, false);

const driver = read("lightroom/LRBridge.lrplugin/Driver.lua");
const query = read("lightroom/LRBridge.lrplugin/Query.lua");
const feedback = read("lightroom/LRBridge.lrplugin/FeedbackPolling.lua");
const luaCommands = read("lightroom/LRBridge.lrplugin/Commands.lua");
const lensBlurLua = read("lightroom/LRBridge.lrplugin/LensBlur.lua");
const controller = read("app/controller.html");
const bridgeSource = read("server/bridge.js");
const nativeSource = read("server/windows-lightroom-native.ps1");
const nativeJsSource = read("server/windows-lightroom-native.js");

for (const id of scalarIds) {
    assert.match(driver, new RegExp(id + " = \"" + id + "\""));
    assert.match(query, new RegExp(id + " = \"" + id + "\""));
    assert.match(feedback, new RegExp("\"" + id + "\""));
}
assert.match(lensBlurLua, /LrDevelopController\.setValue\("LensBlurFocalRange", value\)/);
assert.match(lensBlurLua, /LrDevelopController\.getValue\("LensBlurFocalRange"\)/);
assert.match(luaCommands, /lens_blur\.focal_range\.set[\s\S]*LensBlur\.setFocalRange\(command\.value\)[\s\S]*LensBlur\.sendCurrentState\(command\.commitId\)/);
assert.match(lensBlurLua, /photo:getDevelopSettings\(\)[\s\S]*settings\.LensBlur\.FocalRangeSource/,
    "Subject Focus confirmation must use authoritative photo develop settings");
assert.match(lensBlurLua, /focalRangeCommitId[\s\S]*urlEncode\(focalRangeCommitId\)/,
    "A completed Focus Range command must identify its authoritative readback");
assert.match(lensBlurLua, /function LensBlur\.closeDepthRefinement\(\)[\s\S]*getSelectedTool\(\)[\s\S]*selectTool\("loupe"\)[\s\S]*settled ~= "loupe"/,
    "The proposed Close writer must be target-aware and self-verify with authoritative selected-tool readback");
assert.match(luaCommands, /lens_blur\.depth_refinement\.close[\s\S]*LensBlur\.closeDepthRefinement\(\)[\s\S]*LensBlur\.sendCurrentState\(\)/);
assert.doesNotMatch(lensBlurLua + luaCommands, /toggleLensBlurDepthVisualization|depth_visualization\.toggle/);
assert.doesNotMatch(lensBlurLua, /getRange\("LensBlurFocalRange"\)/);

assert.match(nativeSource, /TBM_SETPOS/);
assert.match(nativeSource, /TB_THUMBTRACK[\s\S]*TB_THUMBPOSITION[\s\S]*TB_ENDTRACK/);
assert.match(nativeSource, /BM_GETCHECK/);
assert.match(nativeSource, /if \(\$current\.value -ne \$Enabled\)[\s\S]*BM_CLICK/);
assert.match(nativeSource, /Discover-NativeControls/);
assert.match(nativeSource, /Get-TrackbarWriteDiscovery[\s\S]*Refresh-RefinementDiscovery/,
    "A Brush drag may reuse only a transaction-scoped root with fresh subtree discovery");
assert.match(nativeSource, /Get-NativeStateFromDiscovery \$discovery/,
    "A native write must reuse only its freshly discovered, revalidated controls for authoritative readback");
assert.match(nativeSource, /TB_ENDTRACK[\s\S]*RedrawWindow/,
    "Native trackbar writes must explicitly repaint after Lightroom processes the notifications");
assert.match(nativeSource, /Refresh-TrackbarPaint[\s\S]*GetClientRect[\s\S]*WM_MOUSEMOVE[\s\S]*RedrawWindow/,
    "Frozen Lightroom thumbs require a target-local client-relative hover repaint trigger");
assert.doesNotMatch(nativeSource, /TBM_GETTHUMBRECT|0x0419/,
    "Pointer-bearing trackbar messages must never cross the Lightroom process boundary");
assert.match(nativeSource, /Find-ModeActivationTarget[\s\S]*Focus \(Bridge View\)[\s\S]*Blur \(Bridge View\)/);
assert.match(nativeSource, /GetClientRect[\s\S]*PostMessage[\s\S]*WM_LBUTTONDOWN[\s\S]*WM_LBUTTONUP/,
    "Mode activation must remain target-local and use verified client-relative coordinates");
assert.match(nativeSource, /Set-RefinementMode[\s\S]*if \(\$state\.refinementMode -eq \$Mode\)[\s\S]*Post-ModeClientActivation[\s\S]*if \(\$state\.refinementMode -ne \$Mode\)/,
    "Mode writes must be target-aware and accepted only after authoritative branch readback");
assert.match(nativeSource, /Read-RefinementModeTargetsAvailable[\s\S]*Find-ModeActivationTarget \$Discovery "focus"[\s\S]*Find-ModeActivationTarget \$Discovery "blur"/,
    "Mode target availability must be independent of initially unknown branch visibility");
assert.doesNotMatch(nativeSource.match(/function Set-RefinementMode[\s\S]*?^}/m)[0], /Authoritative Brush Refinement mode is unknown/,
    "An unknown mode must not deadlock two verified mode targets");
assert.match(nativeSource, /Find-RefinementDisclosure[\s\S]*Brush Refinement[\s\S]*ControlId -eq 65535/,
    "The disclosure must be rediscovered structurally beside Lightroom's Brush Refinement label");
assert.match(nativeSource, /Set-RefinementDisclosure[\s\S]*if \(\$current\.value -eq \$Open\)[\s\S]*Post-VerifiedClientClick[\s\S]*state\.refinementDisclosure\.value -ne \$Open/,
    "Disclosure writes must no-op at target and verify visible/hidden Brush controls afterward");
assert.match(nativeSource, /Read-RefinementDisclosureState[\s\S]*Read-RefinementModeTargetsAvailable \$Discovery[\s\S]*rootVisible -and \$modeTargetsAvailable[\s\S]*value=\$true/,
    "Verified Focus/Blur targets must prove that Brush Refinement is expanded without an active mode or slider branch");
assert.match(nativeSource, /Find-RefinementResetTarget[\s\S]*Class -eq "Static"[\s\S]*Text -eq "Reset"[\s\S]*SS_NOTIFY/,
    "Reset Depth Refinement must be discovered as Lightroom's unique notifying Static target");
assert.match(nativeSource, /Invoke-RefinementReset[\s\S]*Post-VerifiedClientClick[\s\S]*refinementReset\.enabled -eq \$false/,
    "Reset Depth Refinement must use its verified target and require authoritative disabled readback");
assert.match(nativeSource, /Reset-Trackbar[\s\S]*Get-ResetTrackbarContext[\s\S]*Post-TrackbarClientDoubleClick[\s\S]*Refresh-RefinementDiscovery[\s\S]*Refresh-TrackbarPaint/,
    "Each Brush reset must double-click its verified trackbar and repaint authoritative output");
assert.match(nativeSource, /TBM_GETTHUMBLENGTH[\s\S]*NativeMax-\$Control\.NativeMin[\s\S]*WM_LBUTTONDBLCLK/,
    "Reset coordinates must derive from safe scalar trackbar geometry and native position");
assert.match(nativeJsSource, /result\.affected[\s\S]*state\.brush\[control\] = affected[\s\S]*refreshStateInBackground\(\)/,
    "Reset must return the affected authoritative value before refreshing the remaining native state");
assert.match(nativeSource, /LensBlurContents/);
assert.match(nativeSource, /LensBlurRefinement/);
assert.match(nativeSource, /Find-FocusRangeActionTargets[\s\S]*Text -eq "Focus Range"[\s\S]*\$icons\.Count -ne 2/,
    "Focus actions must fail closed unless the exact structural icon pair is present");
assert.match(nativeSource, /\$subject = \$icons\[0\][\s\S]*\$pointArea = \$icons\[1\]/,
    "The left and right native icons must be selected only from the verified ordered pair");
assert.match(nativeSource, /Invoke-FocusRangeAction[\s\S]*Assert-FocusRangeActionIdentity[\s\S]*Post-VerifiedFocusRangeActionSequence/,
    "Focus actions must use revalidated target-local client coordinates");
const focusActionSequence = nativeSource.match(/function Post-VerifiedFocusRangeActionSequence[\s\S]*?^}/m)?.[0] || "";
assert.match(focusActionSequence,
    /& \$Validate[\s\S]*message=\$WM_MOUSEMOVE;wParam=0;lParam=\$coordinates[\s\S]*message=\$WM_LBUTTONDOWN;wParam=\$MK_LBUTTON;lParam=\$coordinates[\s\S]*message=\$WM_LBUTTONUP;wParam=0;lParam=\$coordinates[\s\S]*message=\$WM_MOUSELEAVE;wParam=0;lParam=0[\s\S]*SendMessageTimeout/,
    "Focus actions must synchronously send move → down → up → leave to one target-local icon");
assert.equal((focusActionSequence.match(/\[PSCustomObject\]@\{message=/g) || []).length, 4,
    "Focus action interaction must contain exactly four ordered pointer messages");
assert.match(focusActionSequence,
    /\$handle = \[IntPtr\]\$Target\.Handle[\s\S]*foreach \(\$entry[\s\S]*SendMessageTimeout\([\s\S]*\$handle/,
    "Every ordered Focus action message must target the same revalidated icon HWND");
assert.match(focusActionSequence,
    /SMTO_BLOCK -bor \$SMTO_ABORTIFHUNG[\s\S]*FOCUS_ACTION_MESSAGE_TIMEOUT_MS[\s\S]*if \(\$delivered -eq \[IntPtr\]::Zero\)[\s\S]*Throw-Unavailable/,
    "Every Focus action message must use bounded hung-window protection and fail closed");
assert.match(nativeSource, /\$FOCUS_ACTION_MESSAGE_TIMEOUT_MS = 250/,
    "Focus action messages must use a strict 250 ms per-message timeout");
assert.match(focusActionSequence, /& \$Validate \| Out-Null/,
    "The Focus action target must be revalidated after the synchronous sequence");
assert.doesNotMatch(focusActionSequence,
    /InvalidateRect|RedrawWindow|UpdateWindow|RDW_UPDATENOW|Start-Sleep|PostMessage|\]::SendMessage\(|SendInput|SetCursorPos/,
    "Focus action submission must not add repaint, delay, asynchronous, unbounded, or global-input work");
assert.match(focusActionSequence,
    /if \(\$delivered -eq \[IntPtr\]::Zero\)[\s\S]*Throw-Unavailable/,
    "Every bounded Focus action message failure must fail closed without hanging the Web Controller");
const invokeFocusRangeAction = nativeSource.match(/function Invoke-FocusRangeAction[\s\S]*?^}/m)?.[0] || "";
assert.match(invokeFocusRangeAction, /Post-VerifiedFocusRangeActionSequence \$target \$validator/,
    "Both Subject and Point / Area clicks must use the shared ordered message path");
assert.doesNotMatch(invokeFocusRangeAction, /Post-VerifiedClientClick|Refresh-FocusRangeActionPaint|Start-Sleep/,
    "Focus actions must not retain the fixed-delay repaint race");
assert.doesNotMatch(nativeSource,
    /Post-VerifiedFocusRangePaintSequence|Invoke-FocusRangeActionPaintRefresh|refreshFocusRangeActions/,
    "Focus actions must not expose a post-confirmation native repaint operation");
assert.doesNotMatch(nativeSource, /\bInvalidateRect\b/,
    "Abandoned Focus Range invalidation hooks must not remain in the native backend");
const resultRoute = bridgeSource.match(/app\.get\("\/lens-blur\/result"[\s\S]*?^}\);/m)?.[0] || "";
assert.match(resultRoute, /app\.get\("\/lens-blur\/result", function/,
    "The authoritative Lens Blur result handler must remain synchronous");
assert.match(resultRoute, /lensBlur\.update\(input\)[\s\S]*res\.json\(\{ ok: true \}\)/,
    "The authoritative Lens Blur result handler must ingest state before replying");
assert.doesNotMatch(resultRoute, /await|windowsNativeBackend|refresh|paint|setTimeout|setImmediate/i,
    "Authoritative result feedback must never wait for native or cosmetic work");
assert.doesNotMatch(bridgeSource,
    /pendingFocusActionPaintConfirmation|focusActionPaintConfirmed|refreshFocusRangeActions/,
    "Paint-confirmation plumbing must not participate anywhere in the server state path");
const focusActionRoute = bridgeSource.match(/app\.get\("\/lens-blur\/focus-action"[\s\S]*?^}\);/m)?.[0] || "";
assert.doesNotMatch(focusActionRoute, /expectedActive|refreshFocusRangeActions/,
    "Focus action transport must not carry cosmetic confirmation state");
assert.match(nativeSource, /\$visualizeButton = Add-AnchorIdentity \(Find-UniqueButtonInRoot \$windows \$lensRoot "Visualize Depth"\)/);
assert.match(nativeSource, /\$autoMaskButton = Add-AnchorIdentity \(Find-UniqueButtonInRoot \$windows \$refinementRoot "Auto Mask"\)/);
assert.doesNotMatch(nativeSource, /Discover-Panel|Build-PanelCandidate/,
    "Native controls must not be coupled to one all-or-nothing panel candidate");
assert.match(nativeSource, /Assert-TrackIdentity/);
assert.match(nativeSource, /Assert-ButtonIdentity/);
assert.doesNotMatch(nativeSource, /HWND\s*0x[0-9a-f]+/i, "Runtime HWNDs must never be stored in production source");
assert.doesNotMatch(nativeSource + bridgeSource, /SendInput|keybd_event|mouse_event|SetCursorPos/i);
assert.doesNotMatch(nativeSource + bridgeSource, /image canvas|canvas pointer|click canvas/i,
    "Focus actions must never inject a pointer action into Lightroom's image canvas");

assert.match(controller, /FOCUS RANGE/);
assert.match(controller, /Visualize Depth/);
assert.match(controller, /modeFocus = makeButton\("Focus"[\s\S]*modeBlur = makeButton\("Blur"/);
assert.match(controller, /Auto Mask/);
assert.match(controller, /\[\["amount", "Amount"[\s\S]*\["size", "Size"[\s\S]*\["feather", "Feather"[\s\S]*\["flow", "Flow"/);
assert.match(controller, /\/api\/lens-blur\/visualize-depth\?enabled=/);
assert.match(controller, /\/api\/lens-blur\/auto-mask\?enabled=/);
assert.doesNotMatch(controller, /\/api\/lens-blur\/depth-visualization\/toggle/);
const lensBlurUiBlock = controller.match(/function renderLensBlurSection[\s\S]*?let lensCorrectionsView/)[0];
const lensBlurControllerBlock = controller.match(/function updateLensBlurExplicitSwitch[\s\S]*?let lensCorrectionsView/)[0];
assert.match(lensBlurControllerBlock, /"Subject Focus"[\s\S]*"Point \/ Area Focus"/);
assert.match(lensBlurControllerBlock,
    /view\.subjectButton\.classList\.toggle\("active", subjectActive\)[\s\S]*view\.subjectButton\.setAttribute\("aria-pressed", String\(subjectActive\)\)[\s\S]*aria-busy/,
    "Subject Focus must bind its active and pressed state to derived presentation feedback");
assert.match(lensBlurControllerBlock,
    /view\.source\.textContent = lensBlurHelper\.focusSourceText\(subjectPresentation\)/,
    "Focus source text must use the separate derived Subject presentation");
assert.match(lensBlurControllerBlock,
    /if \(commit\.submit\) lensBlurSubjectPresentation\.beginManualEdit\(\)[\s\S]*submitLensBlurFocalRange/,
    "A pending user-authored Focus Range commit must switch presentation to Manual optimistically");
assert.match(lensBlurControllerBlock,
    /transaction\.confirm\(state\.focalRange\)[\s\S]*lensBlurSubjectPresentation\.confirmManualEdit\(\)/,
    "A confirmed Focus Range commit must preserve Manual presentation");
assert.match(lensBlurControllerBlock,
    /transaction\.reject\([\s\S]*lensBlurSubjectPresentation\.rollbackManualEdit\(\)/,
    "Rejected Focus Range commits must restore their previous Subject presentation");
assert.match(controller,
    /classification === "navigation"[\s\S]*lensBlurSubjectPresentation\.reset\(\)/,
    "Photo navigation must reset derived Subject provenance");
assert.match(lensBlurControllerBlock,
    /showLensBlurFocusActionFeedback\(view, "Subject Focus applied", false\)[\s\S]*setTimeout[\s\S]*2500/,
    "Subject Focus success and failure feedback must be brief");
assert.match(lensBlurControllerBlock,
    /pointAreaToggleIntent\(lensBlurHelper\.presentationFor\(lensBlurModel\.get\(\)\)\)[\s\S]*expectedActive: expectedActive/,
    "Point / Area must store the inverse of its authoritative pre-click state");
assert.match(lensBlurControllerBlock,
    /pointAreaToggleConfirmed\(state, view\.actionPending\.expectedActive\)/,
    "Fresh authoritative feedback must confirm the intended Point / Area toggle state");
assert.doesNotMatch(lensBlurControllerBlock, /actionPath \+= "&expectedActive="/,
    "Point / Area intent must remain local and settle only from authoritative selected-tool feedback");
assert.match(lensBlurControllerBlock,
    /expectedActive[\s\S]*"Arming Point \/ Area Focus…"[\s\S]*"Leaving Point \/ Area Focus…"[\s\S]*else if \(pointActive\) view\.status\.textContent = "Click or drag on the image in Lightroom to choose the focus area\."/,
    "Point / Area instructions must appear only while authoritatively active");
assert.match(lensBlurControllerBlock,
    /timedOutExpectedActive[\s\S]*"Lightroom did not arm Point \/ Area Focus"[\s\S]*"Lightroom did not exit Point \/ Area Focus"/,
    "Point / Area timeout errors must distinguish activation from deactivation");
assert.match(lensBlurControllerBlock, /createElementNS\("http:\/\/www\.w3\.org\/2000\/svg", "svg"\)/,
    "Focus actions must use LRBridge-native SVG artwork");
assert.match(lensBlurControllerBlock, /Click or drag on the image in Lightroom to choose the focus area\./);
for (const removedLabel of ["Near Outer", "Near Inner", "Far Inner", "Far Outer", "Advanced values", "Whole −", "Near −", "Far −"]) {
    assert.equal(lensBlurControllerBlock.includes(removedLabel), false, "Internal Focus Range UI remained visible: " + removedLabel);
}
assert.match(lensBlurControllerBlock, /setLensBlurRefinementMode[\s\S]*\/api\/lens-blur\/refinement-mode\?value=/,
    "Runtime-proven Focus/Blur buttons must dispatch explicit native mode targets");
assert.match(lensBlurControllerBlock, /modeAvailable = presentation\.refinementModeTargetsAvailable === true/,
    "Verified Focus/Blur targets must remain clickable while selected mode is unknown");
assert.match(lensBlurControllerBlock, /if \(!native \|\| native\.refinementModeTargetsAvailable !== true\) return false;[\s\S]*if \(native\.refinementMode === mode\) return true;/,
    "Unknown mode must activate an explicit verified target; only an authoritative match may no-op");
assert.match(lensBlurControllerBlock, /setLensBlurRefinementDisclosure[\s\S]*\/api\/lens-blur\/refinement-disclosure\?open=/,
    "Brush Refinement disclosure must dispatch an explicit native target state");
assert.match(lensBlurControllerBlock, /lensBlurRefinementButton\.textContent = lensBlurDisclosureRequestInFlight[\s\S]*"Closing…"[\s\S]*"Opening…"[\s\S]*"Close Brush Refinement"[\s\S]*"Open Brush Refinement"/,
    "Disclosure text must follow authoritative native subtree visibility");
assert.match(lensBlurControllerBlock, /classList\.toggle\("command-primary", !danger\)[\s\S]*classList\.toggle\("command-danger", danger\)/,
    "Collapsed/Opening must be primary blue while Expanded/Closing must be danger red");
assert.match(lensBlurControllerBlock, /setAttribute\("aria-pressed", String\(disclosureOpen\)\)/,
    "Disclosure aria-pressed must reflect only authoritative expanded state");
assert.doesNotMatch(lensBlurUiBlock, /depth-refinement\/(?:select|close)/,
    "The disclosure button must not switch Lightroom's selected tool");
assert.match(lensBlurControllerBlock, /modeAvailable[\s\S]*focus\.disabled = !modeAvailable[\s\S]*blur\.disabled = !modeAvailable/,
    "Mode buttons must fail closed when authoritative branch visibility is unknown");
assert.doesNotMatch(lensBlurControllerBlock, /\.type\s*=\s*"number"/,
    "Lens Blur exact-value editors must not expose browser number spinners");
assert.match(lensBlurControllerBlock, /number\.type = "text";[\s\S]*number\.inputMode = "decimal"/);
assert.match(lensBlurControllerBlock, /number\.addEventListener\("keydown"[\s\S]*event\.key === "Enter"[\s\S]*commitLensBlurNativeEditor/,
    "Brush Enter must commit through the guarded editor");
assert.match(lensBlurControllerBlock, /number\.addEventListener\("blur"[\s\S]*commitLensBlurNativeEditor/,
    "Brush blur must commit through the guarded editor");
assert.match(lensBlurControllerBlock, /event\.key === "Escape"[\s\S]*control\.editor\.cancel\(\)/,
    "Brush Escape must restore authoritative state");
assert.match(lensBlurControllerBlock, /focalDepthMinimum[\s\S]*focalDepthMaximum/,
    "Focus Range must use the fixed image depth axis");
assert.match(lensBlurControllerBlock, /selection\.style\.left = nearInner[\s\S]*selection\.style\.width = Math\.max\(0, farInner - nearInner\)/,
    "The draggable interval must represent the fully focused interval");
assert.match(lensBlurControllerBlock, /nearHandle\.style\.left = nearInner[\s\S]*farHandle\.style\.left = farInner/,
    "Edge grips must move the paired transition boundaries at each focused edge");
assert.match(lensBlurControllerBlock, /target\.setPointerCapture/);
const focalMoveBlock = lensBlurControllerBlock.match(/function move\(moveEvent\)[\s\S]*?^            }/m)[0];
assert.doesNotMatch(focalMoveBlock, /fetch|sendCommand|submitLensBlurFocalRange/,
    "Pointer movement must remain local and perform no Lightroom writes");
assert.match(lensBlurControllerBlock, /const commit = view\.transaction\.finish\(\)[\s\S]*if \(commit\.submit\) submitLensBlurFocalRange\(commit\.range, commit\.expected\)/,
    "Pointer release must send exactly one complete range transaction");
assert.match(lensBlurControllerBlock, /pointercancel[\s\S]*lostpointercapture[\s\S]*transaction\.cancel\(\)/,
    "Pointer cancellation must restore the latest authoritative range");
assert.match(lensBlurControllerBlock, /keyEvent\.key === "Escape"[\s\S]*cancelDrag/,
    "Escape must cancel the Focus Range drag");
assert.match(lensBlurControllerBlock, /pendingCommitId[\s\S]*lensBlurFocalRangeCommitId === view\.pendingCommitId[\s\S]*focalRangesEqual/,
    "Optimistic presentation must remain until the matching complete readback arrives");
assert.doesNotMatch(lensBlurControllerBlock, /view\.minimum\s*=|view\.maximum\s*=/,
    "Focus Range must not expand or autoscale its visible depth axis");
assert.match(lensBlurControllerBlock, /row\.className = "develop-slider-row lens-blur-native-row unavailable"/,
    "Brush controls must use the standard LRBridge slider component");
assert.match(lensBlurControllerBlock, /scheduleLensBlurNativeValue[\s\S]*}, 100\)/,
    "Brush slider movement must be locally optimistic and coalesced");
assert.match(lensBlurControllerBlock, /pointerup[\s\S]*finishLensBlurNativeRange\(control, event, true\)/,
    "Brush slider release must force a final native write");
assert.doesNotMatch(lensBlurControllerBlock, /Waiting for Lightroom/,
    "Optimistic Brush and Focus Range controls must not display blocking wait text");
assert.match(lensBlurControllerBlock, /const reset = makeButton\("Reset", "reset", function \(\) \{ resetLensBlurNativeValue\(control\); \}\)/,
    "Every generated native Brush row must use Lightroom's per-trackbar reset path");
assert.match(lensBlurControllerBlock, /row\.appendChild\(increment\);[\s\S]*row\.appendChild\(reset\);/,
    "Brush Reset belongs directly after + in the standard row layout");
assert.match(lensBlurUiBlock, /modeRow[\s\S]*makeButton\("Reset Refinement", "reset"[\s\S]*modeRow\.appendChild\(refinementReset\)/,
    "Reset Refinement must appear beside Focus and Blur while preserving per-row resets");
assert.match(lensBlurControllerBlock, /Available after Focus or Blur refinements have been painted\./,
    "Disabled Reset Refinement must explain Lightroom's native enable condition");
assert.match(lensBlurControllerBlock, /window\.confirm\("Remove all painted Lens Blur refinements from this photo\?"\)[\s\S]*\/api\/lens-blur\/refinement-reset\?confirmed=true/,
    "Reset Refinement must require explicit destructive confirmation");
assert.doesNotMatch(lensBlurControllerBlock, /(?:amount|size|feather|flow)[\s\S]{0,80}(?:100|42)[\s\S]{0,80}reset/i,
    "Production must not encode guessed Brush reset defaults");
assert.match(lensBlurControllerBlock, /stepInteraction\.click[\s\S]*showLensBlurNativeLocal\(control, result\.target\)[\s\S]*pumpLensBlurNativeStep\(control\)/,
    "Rapid +/- clicks must use the finite accumulator and dispatch the first absolute target immediately");
assert.match(lensBlurControllerBlock, /stepInteraction: lensBlurHelper\.createStepInteraction\(\{ step: step, precision: precision \}\)/);
assert.doesNotMatch(lensBlurControllerBlock, /stepTimer = setTimeout[\s\S]{0,300}submitLensBlurNativeValue/,
    "No delayed callback may normalize a cleared desired value into zero");
assert.match(lensBlurControllerBlock, /typeof value !== "number" && typeof value !== "string"[\s\S]*value\.trim\(\) === ""[\s\S]*return null/,
    "Native value normalization must reject null, undefined, and empty input before numeric conversion");
assert.match(lensBlurControllerBlock, /control\.reset\.disabled = control\.resetInFlight === true;[\s\S]*Resetting…/,
    "Reset must acknowledge immediately without disabling the entire Brush row");

const initialNativeState = {
    available: true,
    reason: null,
    brush: {
        amount: { available: true, value: 100, min: 0, max: 100 },
        size: { available: true, value: 42, min: 0.1, max: 100 },
        feather: { available: true, value: 100, min: 0, max: 100 },
        flow: { available: true, value: 100, min: 1, max: 100 }
    },
    visualizeDepth: { available: true, value: false },
    autoMask: { available: true, value: false },
    refinementMode: "focus",
    refinementModeTargetsAvailable: true,
    refinementDisclosure: { available: true, value: true },
    refinementReset: { available: true, enabled: false },
    focusActions: {
        subject: { available: true, enabled: true },
        pointArea: { available: true, enabled: true }
    }
};

const partialNativeState = nativeDefinition.sanitizeNativeState({
    available: true,
    brush: {
        amount: { available: false },
        size: { available: false },
        feather: { available: false },
        flow: { available: false }
    },
    visualizeDepth: { available: true, value: true },
    autoMask: { available: false },
    refinementMode: "unknown",
    refinementModeTargetsAvailable: true,
    refinementDisclosure: { available: true, value: false },
    refinementReset: { available: false, enabled: false },
    focusActions: {
        subject: { available: false, enabled: false },
        pointArea: { available: true, enabled: true }
    }
});
assert.equal(partialNativeState.available, true, "A partial native result must keep the backend healthy");
assert.deepEqual(partialNativeState.visualizeDepth, { available: true, value: true });
assert.equal(partialNativeState.brush.size.available, false);
assert.equal(partialNativeState.autoMask.available, false);
assert.deepEqual(partialNativeState.refinementDisclosure, { available: true, value: false });
assert.deepEqual(partialNativeState.refinementReset, { available: false, enabled: false });
assert.equal(partialNativeState.refinementMode, "unknown");
assert.equal(partialNativeState.refinementModeTargetsAvailable, true);
assert.deepEqual(partialNativeState.focusActions.pointArea, { available: true, enabled: true });

function createFakeNativeBackend() {
    let state = clone(initialNativeState);
    let paintBehavior = "hung";
    const calls = [];
    return {
        calls: calls,
        setFocusPaintBehavior: function (behavior) { paintBehavior = behavior; },
        readState: async function () { calls.push(["readState"]); return clone(state); },
        setBrushValue: async function (control, value, options) {
            calls.push(["setBrushValue", control, value, options]); state.brush[control].value = value; return clone(state);
        },
        resetBrushValue: async function (control) {
            calls.push(["resetBrushValue", control]); state.brush[control].value = control === "size" ? 25 : 50; return clone(state);
        },
        adjustBrushValue: async function (control, amount) {
            calls.push(["adjustBrushValue", control, amount]); state.brush[control].value += amount; return clone(state);
        },
        setCheckbox: async function (control, enabled) {
            calls.push(["setCheckbox", control, enabled]); state[control].value = enabled; return clone(state);
        },
        setRefinementMode: async function (mode) {
            calls.push(["setRefinementMode", mode]); state.refinementMode = mode; return clone(state);
        },
        setRefinementDisclosure: async function (open) {
            calls.push(["setRefinementDisclosure", open]); state.refinementDisclosure.value = open; return clone(state);
        },
        resetRefinement: async function () {
            calls.push(["resetRefinement"]); state.refinementReset = { available: true, enabled: false }; return clone(state);
        },
        activateFocusRangeAction: async function (action) {
            calls.push(["activateFocusRangeAction", action]); return clone(state);
        },
        refreshFocusRangeActions: function () {
            calls.push(["refreshFocusRangeActions"]);
            if (paintBehavior === "rejected") return Promise.reject(new Error("paint failed"));
            if (paintBehavior === "slow") return new Promise(function (resolve) { setTimeout(resolve, 60000); });
            return new Promise(function () {});
        },
        stop: async function () { calls.push(["stop"]); }
    };
}

async function request(base, pathname) {
    const response = await fetch(base + pathname);
    const body = await response.json();
    return { response: response, body: body };
}

async function requestWithin(base, pathname, timeoutMs) {
    let timer = null;
    try {
        return await Promise.race([
            request(base, pathname),
            new Promise(function (_, reject) {
                timer = setTimeout(function () { reject(new Error("Request timed out: " + pathname)); }, timeoutMs);
            })
        ]);
    } finally {
        if (timer !== null) clearTimeout(timer);
    }
}

(async function () {
    commands.resetQueueForTests();
    const fakeNative = createFakeNativeBackend();
    const bridge = createBridge({
        httpPort: 0,
        wsPort: 0,
        httpHost: "127.0.0.1",
        wsHost: "127.0.0.1",
        windowsNativeBackend: fakeNative
    });
    await bridge.start();
    const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    try {
        let result = await request(base, "/lens-blur/state");
        assert.deepEqual(result.body.state.windowsNative, initialNativeState);
        assert.equal(result.body.state.focalRangeAvailable, false);

        result = await request(base, "/lens-blur/brush/size/set?value=31.0");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["setBrushValue", "size", 31, undefined]);
        assert.equal(result.body.windowsNative.brush.size.value, 31);
        result = await request(base, "/lens-blur/brush/size/set?value=32&interaction=drag-one&final=false");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["setBrushValue", "size", 32, { interaction: "drag-one", final: false }]);
        result = await request(base, "/lens-blur/brush/size/set?value=33&interaction=drag-one&final=true");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["setBrushValue", "size", 33, { interaction: "drag-one", final: true }]);
        result = await request(base, "/lens-blur/brush/size/set?value=34&interaction=bad%20id&final=false");
        assert.equal(result.response.status, 400);
        result = await request(base, "/lens-blur/brush/flow/adjust?amount=-1");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["adjustBrushValue", "flow", -1]);
        result = await request(base, "/lens-blur/brush/reset/set?value=1");
        assert.equal(result.response.status, 400);
        result = await request(base, "/lens-blur/brush/size/reset");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["resetBrushValue", "size"]);
        assert.equal(result.body.windowsNative.brush.size.value, 25);
        result = await request(base, "/lens-blur/brush/reset/reset");
        assert.equal(result.response.status, 400);

        result = await request(base, "/lens-blur/visualize-depth?enabled=true");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["setCheckbox", "visualizeDepth", true]);
        assert.equal(result.body.windowsNative.visualizeDepth.value, true);
        result = await request(base, "/lens-blur/auto-mask?enabled=true");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["setCheckbox", "autoMask", true]);
        result = await request(base, "/lens-blur/refinement-mode?value=blur");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["setRefinementMode", "blur"]);
        assert.equal(result.body.windowsNative.refinementMode, "blur");
        result = await request(base, "/lens-blur/refinement-disclosure?open=false");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["setRefinementDisclosure", false]);
        assert.equal(result.body.windowsNative.refinementDisclosure.value, false);
        result = await request(base, "/lens-blur/refinement-disclosure?open=toggle");
        assert.equal(result.response.status, 400);
        result = await request(base, "/lens-blur/refinement-reset");
        assert.equal(result.response.status, 400);
        result = await request(base, "/lens-blur/refinement-reset?confirmed=false");
        assert.equal(result.response.status, 400);
        result = await request(base, "/lens-blur/refinement-reset?confirmed=true");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["resetRefinement"]);
        assert.deepEqual(result.body.windowsNative.refinementReset, { available: true, enabled: false });

        const subjectStateQuery = "/lens-blur/result?activeAvailable=true&active=true&bokehAvailable=true&bokeh=Circle" +
            "&selectedToolAvailable=true&selectedTool=loupe&focalRangeSourceAvailable=true&focalRangeSource=1" +
            "&focalRangeAvailable=true&focalRange=" + encodeURIComponent("-43 37 57 137");
        const pointActiveStateQuery = "/lens-blur/result?activeAvailable=true&active=true&bokehAvailable=true&bokeh=Circle" +
            "&selectedToolAvailable=true&selectedTool=focal_range&focalRangeSourceAvailable=true&focalRangeSource=1" +
            "&focalRangeAvailable=true&focalRange=" + encodeURIComponent("-43 37 57 137");
        const pointAreaStateQuery = "/lens-blur/result?activeAvailable=true&active=true&bokehAvailable=true&bokeh=Circle" +
            "&selectedToolAvailable=true&selectedTool=loupe&focalRangeSourceAvailable=true&focalRangeSource=2" +
            "&focalRangeAvailable=true&focalRange=" + encodeURIComponent("-43 37 57 137");
        const refreshCount = function () {
            return fakeNative.calls.filter(function (call) { return call[0] === "refreshFocusRangeActions"; }).length;
        };
        const revisionBeforeResult = (await request(base, "/lens-blur/state")).body.revision;
        for (const paintBehavior of ["slow", "rejected", "hung"]) {
            fakeNative.setFocusPaintBehavior(paintBehavior);
            result = await requestWithin(base, subjectStateQuery, 2000);
            assert.equal(result.response.status, 200,
                "Lens Blur result ingestion must ignore " + paintBehavior + " optional native painting");
        }
        const stateAfterResult = await request(base, "/lens-blur/state");
        assert.equal(stateAfterResult.body.revision > revisionBeforeResult, true,
            "Lens Blur result ingestion must advance the authoritative revision");
        assert.equal(stateAfterResult.body.state.focalRangeSource, 1,
            "Lens Blur result ingestion must store authoritative Subject source feedback");
        assert.equal(refreshCount(), 0,
            "A hung optional paint method must never be called by authoritative result ingestion");
        result = await request(base, "/lens-blur/focus-action?value=subject");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["activateFocusRangeAction", "subject"]);
        assert.equal(Number.isSafeInteger(result.body.confirmationAfterRevision), true);
        result = await requestWithin(base, subjectStateQuery, 2000);
        assert.equal(result.response.status, 200);
        assert.equal(refreshCount(), 0, "Subject feedback must remain independent of native icon painting");

        result = await request(base, "/lens-blur/focus-action?value=point-area");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["activateFocusRangeAction", "point-area"]);
        result = await requestWithin(base, pointActiveStateQuery, 2000);
        assert.equal(result.response.status, 200);
        assert.equal(refreshCount(), 0, "Point / Area armed feedback must not depend on native icon painting");

        result = await request(base, "/lens-blur/focus-action?value=point-area");
        assert.equal(result.response.status, 200);
        assert.deepEqual(fakeNative.calls.at(-1), ["activateFocusRangeAction", "point-area"]);
        result = await requestWithin(base, pointAreaStateQuery, 2000);
        assert.equal(result.response.status, 200);
        assert.equal(refreshCount(), 0, "Point / Area off feedback must settle even when optional painting is hung");

        result = await request(base, "/lens-blur/focus-action?value=point-area&expectedActive=false");
        assert.equal(result.response.status, 400);
        result = await request(base, "/lens-blur/focus-action?value=canvas");
        assert.equal(result.response.status, 400);
        result = await request(base, "/lens-blur/depth-visualization/toggle");
        assert.equal(result.response.status, 410);
        assert.equal(commands.getNextCommand(), null);

        const stateQuery = "/lens-blur/result?activeAvailable=true&active=true&bokehAvailable=true&bokeh=Circle" +
            "&selectedToolAvailable=true&selectedTool=depth_refinement&focalRangeSourceAvailable=true&focalRangeSource=2" +
            "&focalRangeAvailable=true&focalRange=" +
            encodeURIComponent("-43 37 57 137");
        result = await request(base, stateQuery);
        assert.equal(result.response.status, 200);
        result = await request(base, "/lens-blur/state");
        assert.deepEqual(result.body.state.focalRange, originalRange);

        result = await request(base, "/lens-blur/focal-range/set?nearOuter=-80&nearInner=0&farInner=55&farOuter=135&expected=" +
            encodeURIComponent("-43 37 57 137"));
        assert.equal(result.response.status, 200);
        let queuedFocal = commands.getNextCommand();
        assert.deepEqual({ command: queuedFocal.command, value: queuedFocal.value },
            { command: "lens_blur.focal_range.set", value: "-80 0 55 135" });
        assert.equal(queuedFocal.commitId, result.body.focalRangeCommitId);
        result = await request(base, "/lens-blur/state");
        assert.equal(result.body.state.focalRangeAvailable, false, "Accepted writes invalidate state until Lightroom reports readback");

        await request(base, stateQuery);
        result = await request(base, "/lens-blur/focal-range/adjust?part=near&amount=-1&expected=" +
            encodeURIComponent("-43 37 57 137"));
        assert.equal(result.response.status, 200);
        queuedFocal = commands.getNextCommand();
        assert.equal(queuedFocal.value, "-44 36 57 137");
        assert.equal(queuedFocal.commitId, result.body.focalRangeCommitId);
        await request(base, stateQuery);
        result = await request(base, "/lens-blur/focal-range/adjust?part=far&amount=50&expected=" +
            encodeURIComponent("-43 37 57 137"));
        assert.equal(result.response.status, 200);
        queuedFocal = commands.getNextCommand();
        assert.equal(queuedFocal.value, "-43 37 107 187");
        assert.equal(queuedFocal.commitId, result.body.focalRangeCommitId);
        await request(base, stateQuery);
        result = await request(base, "/lens-blur/focal-range/set?nearOuter=-80&nearInner=0&farInner=55&farOuter=135&expected=stale");
        assert.equal(result.response.status, 409);
        assert.equal(commands.getNextCommand(), null);

        result = await request(base, "/lens-blur/apply?enabled=false");
        assert.equal(result.response.status, 200);
        assert.deepEqual(commands.getNextCommand(), { command: "lens_blur.active.set", enabled: false });
        result = await request(base, "/lens-blur/bokeh?value=SoapBubble");
        assert.equal(result.response.status, 200);
        assert.deepEqual(commands.getNextCommand(), { command: "lens_blur.bokeh.set", value: "SoapBubble" });
        result = await request(base, "/lens-blur/depth-refinement/select");
        assert.equal(result.response.status, 200);
        assert.deepEqual(commands.getNextCommand(), { command: "lens_blur.depth_refinement.select" });
        result = await request(base, "/lens-blur/depth-refinement/close");
        assert.equal(result.response.status, 409, "Close must fail closed while selected-tool authority is invalidated");
        await request(base, stateQuery);
        result = await request(base, "/lens-blur/depth-refinement/close");
        assert.equal(result.response.status, 200);
        assert.deepEqual(commands.getNextCommand(), { command: "lens_blur.depth_refinement.close" });
    } finally {
        await bridge.stop();
    }
    assert.deepEqual(fakeNative.calls.at(-1), ["stop"]);

    const nonWindows = nativeDefinition.createWindowsLightroomNativeBackend({ platform: "linux" });
    const unavailable = await nonWindows.readState();
    assert.equal(unavailable.available, false);
    assert.equal(unavailable.refinementMode, "unknown");
    assert.deepEqual(unavailable.refinementReset, { available: false, enabled: false });
    assert.deepEqual(unavailable.focusActions.subject, { available: false, enabled: false });
    await assert.rejects(nonWindows.setBrushValue("size", 31), { code: "LIGHTROOM_NATIVE_UNAVAILABLE" });
    await assert.rejects(nonWindows.resetRefinement(), { code: "LIGHTROOM_NATIVE_UNAVAILABLE" });
    await assert.rejects(nonWindows.activateFocusRangeAction("subject"), { code: "LIGHTROOM_NATIVE_UNAVAILABLE" });
    await nonWindows.stop();

    console.log("Lens Blur native backend, Focus Range, state, transport, and UI contract tests passed.");
})().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
