"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const html = fs.readFileSync(path.join(__dirname, "../app/controller.html"), "utf8");
function sourceBetween(start, end) {
    const first = html.indexOf(start);
    const last = html.indexOf(end, first);
    assert.ok(first >= 0 && last > first);
    return html.slice(first, last);
}
const source = sourceBetween("function developSliderFeedbackBinding()", "async function requestLiveFeedbackSnapshot(") +
    sourceBetween("async function requestDevelopSliderStepFeedback(", "function handleDevelopSliderStepSubmission(");

async function checkFeedback(slider, change, rejection) {
    let settle;
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const delayed = new Promise((resolve, reject) => { settle = rejection ? reject : resolve; });
    const applied = [];
    const errors = [];
    const context = {
        genericFeedbackGeneration: 4, lastControllerActiveModule: "develop",
        lastControllerSelectedPhotoUuid: "grain-photo-a", lastControllerContextCounter: 2,
        lastControllerContextChangedAt: 1000, lastControllerDevelopCounter: 7,
        fetch: async () => ({ ok: true, json: async () => ({ request: { id: 1 } }) }),
        pollFeedbackSnapshot: () => { entered(); return delayed; },
        applyDevelopSliderFeedbackIfChanged: (_control, result) => applied.push(result.value),
        cancelDevelopSliderStep: () => errors.push("cancel"),
        showDevelopSliderLocal: () => errors.push("restore"),
        setStatus: message => errors.push(message),
        console: { error: message => errors.push(message) }
    };
    vm.runInNewContext(source, context);
    const control = { definition: { id: slider }, row: { isConnected: true }, authoritativeValue: 12 };
    const pending = context.requestDevelopSliderStepFeedback(control, true);
    await started;
    if (change) change(context, control);
    settle(rejection ? new Error("delayed fixture failure")
        : { snapshot: { results: { [slider]: { available: true, value: 64 } } } });
    await pending;
    return { applied, errors };
}

(async () => {
    // Retained mask display is not a valid command or feedback binding after a
    // shared global Grain write advances the Develop revision.
    const masking = require("../app/controller-masking");
    const maskSource = fs.readFileSync(path.join(__dirname, "../app/controller-masking.js"), "utf8");
    const first = maskSource.indexOf("function commandQuery()");
    const last = maskSource.indexOf("function admissionError(", first);
    const state = { ok: true, selectedPhotoUuid: "grain-photo-a", contextCounter: 2, contextChangedAt: 1000,
        developCounter: 7, serverEpoch: "grain-test", revision: 10 };
    const current = Object.assign({}, state, { developCounter: 8 });
    const maskContext = { state, currentContext: () => current, sameContext: masking.sameContext, encodeURIComponent };
    vm.runInNewContext(maskSource.slice(first, last), maskContext);
    assert.equal(maskContext.commandQuery(), null, "retained stale display must not issue mask commands");
    assert.equal(masking.acceptState(state, Object.assign({}, state, { revision: 11 }), current), state,
        "delayed old Develop feedback must not be accepted");
    const fresh = Object.assign({}, current, { revision: 12 });
    assert.equal(masking.acceptState(state, fresh, current), fresh);
    maskContext.state = fresh;
    assert.match(maskContext.commandQuery(), /developCounter=8/);
    for (const slider of ["GrainSize", "GrainFrequency"]) {
        assert.deepEqual(await checkFeedback(slider), { applied: [64], errors: [] });
        // Mask identity does not bind a whole-photo Grain value.
        assert.deepEqual(await checkFeedback(slider, context => { context.selectedMaskGroupId = "mask-b"; }),
            { applied: [64], errors: [] });
        for (const [field, value] of Object.entries({
            genericFeedbackGeneration: 5, lastControllerActiveModule: "library",
            lastControllerSelectedPhotoUuid: "grain-photo-b", lastControllerContextCounter: 3,
            lastControllerContextChangedAt: 2000, lastControllerDevelopCounter: 8
        })) {
            assert.deepEqual(await checkFeedback(slider, context => { context[field] = value; }),
                { applied: [], errors: [] }, slider + " must reject stale " + field);
        }
        assert.deepEqual(await checkFeedback(slider, (_context, control) => { control.row.isConnected = false; }),
            { applied: [], errors: [] }, "detached hosts must ignore late feedback");
        assert.deepEqual(await checkFeedback(slider, context => { context.lastControllerContextCounter += 1; }, true),
            { applied: [], errors: [] }, "old-context errors must not overwrite current status");
        assert.ok((await checkFeedback(slider, null, true)).errors.length > 0,
            "current-context feedback failures must remain visible");
    }
    console.log("Grain targeted feedback rejects stale photo/context/revision/host results and preserves current errors.");
})().catch(error => { console.error(error); process.exitCode = 1; });
