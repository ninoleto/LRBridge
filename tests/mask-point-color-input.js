"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
// Replay the same actual parent, server admission and Lua SDK harness against an
// immutable earlier child. This override never changes production source.
if (process.env.LRBRIDGE_POINT_COLOR_TEST_SOURCE) {
    const modulePath = require.resolve("../app/controller-point-color");
    require(modulePath);
    require.cache[modulePath].exports = require(path.resolve(process.env.LRBRIDGE_POINT_COLOR_TEST_SOURCE));
}
const { harness, runSdk, snapshot, pointState, flush } = require("./mask-point-color-confirmation");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function debounceSnapshot(demonstrate) {
    // These are the real masked scalar rows, not the local correction sliders.
    for (const field of ["HueShift", "SatScale", "LumScale", "Variance", "RangeAmount"]) {
        const h = await harness();
        try {
            const initial = Number(h.value(field));
            h.input(field, 65);
            assert.equal(h.value(field), "65");
            assert.equal(h.commands.length, 0, "input is still inside the existing debounce");
            await h.refresh(snapshot());
            if (demonstrate) {
                assert.equal(h.value(field), String(initial));
                await h.release(field);
                const sdk = runSdk(h.commands[0]);
                assert.equal(h.commands[0].value, initial / 100);
                assert.equal(sdk.writes[0][2], initial / 100);
                console.log(JSON.stringify({field, input: 65, parentFeedback: initial,
                    displayedAfterParentRefresh: Number(h.value(field)),
                    submittedOnRelease: h.commands[0].value, simulatedSdkWrites: sdk.writes,
                    cause: "applyAuthoritative overwrites input before enqueue owns it"}));
            } else {
                assert.equal(h.value(field), "65", field + ": parent snapshot must not replace a newer debounced input");
                await h.release(field);
                assert.deepEqual(h.commands.map(c => c.value), [0.65]);
                const sdk = runSdk(h.commands[0], {delay: 0.2});
                assert.equal(await h.result(h.commands[0], sdk), true);
                assert.equal(h.value(field), "65");
                assert.equal(h.intent(field).intended, null);
                await wait(240);
                assert.equal(h.commands.length, 1, "release cancels its debounce; no duplicate or late command");
                assert.equal(h.controller.getInteractionState().correctionBusy, false,
                    "completed input must release the parent's busy guard");
            }
        } finally { h.close(); }
    }
}

async function olderConfirmation() {
    const h = await harness();
    try {
        await h.edit("HueShift", 30);
        h.input("HueShift", 65);
        const sdk = runSdk(h.commands[0], {delay: 0.2});
        await h.result(h.commands[0], sdk);
        assert.equal(h.value("HueShift"), "65", "older confirmation cannot clear a newer input still inside debounce");
        assert.equal(h.intent("HueShift").intended, 65);
        await wait(240); await flush();
        assert.deepEqual(h.commands.map(c => c.value), [0.3, 0.65]);
        await h.result(h.commands[1], runSdk(h.commands[1], {initial: {HueShift: 0.3}}));
        assert.equal(h.value("HueShift"), "65");
        assert.equal(h.controller.getInteractionState().correctionBusy, false);
    } finally { h.close(); }
}

async function alternatingDrags() {
    const h = await harness();
    try {
        await h.edit("HueShift", 30);
        const old = {ok: true, ...h.model.getPublicState()};
        const intended = {HueShift: 30, SatScale: 20, LumScale: -10, Variance: 0, RangeAmount: 50};
        for (const [field, value] of [["HueShift", 70], ["HueShift", -55], ["SatScale", -30],
            ["HueShift", 80], ["LumScale", 40], ["SatScale", 35], ["HueShift", -45],
            ["Variance", -20], ["RangeAmount", 85], ["LumScale", -35]]) {
            h.input(field, value); intended[field] = value;
            await h.refresh(snapshot());
            for (const [key, expected] of Object.entries(intended)) assert.equal(h.value(key), String(expected),
                "a parent snapshot during alternating masked drags must preserve " + key);
        }
        for (const field of Object.keys(intended)) await h.release(field);
        const actual = {HueShift: 0.1, SatScale: 0.2, LumScale: -0.1, Variance: 0, RangeAmount: 0.5};
        const writes = [];
        for (let index = 0; index < 6; index++) {
            const command = h.commands[index];
            assert.ok(command, "each control's final input must be admitted after the preceding confirmation");
            const sdk = runSdk(command, {delay: 0.2, initial: actual});
            assert.equal(sdk.outcome, "confirmed");
            writes.push([command.field, sdk.writes[0][2]]);
            actual[command.field] = command.value;
            assert.equal(await h.result(command, sdk), true);
            await h.oldResponse(old);
            for (const [key, expected] of Object.entries(intended)) assert.equal(h.value(key), String(expected));
            assert.equal(await h.result(command, sdk), false, "duplicate SDK results must not be reaccepted");
        }
        await wait(240);
        assert.deepEqual(writes, [["HueShift", 0.3], ...Object.entries(intended).map(([key, value]) => [key, value / 100])]);
        assert.equal(h.commands.length, 6, "intermediate input values coalesce; no old timer writes afterward");
        assert.equal(h.controller.getInteractionState().correctionBusy, false);
        await h.refresh(snapshot({pointColor: pointState({...actual, HueShift: 0.12})}));
        assert.equal(h.value("HueShift"), "12", "later external Lightroom edits remain authoritative");
    } finally { h.close(); }
}

async function resetAfterInput() {
    for (const [field, start, reset] of [["HueShift", 30, 0], ["RangeAmount", 75, 50]]) {
        const h = await harness();
        try {
            await h.edit(field, start); h.input(field, 90);
            h.row(field).children[5].dispatch("click"); await flush();
            assert.equal(h.value(field), String(reset));
            await h.result(h.commands[0], runSdk(h.commands[0], {delay: 0.2}));
            assert.equal(h.value(field), String(reset));
            assert.deepEqual(h.commands.map(c => c.value), [start / 100, reset / 100]);
            await h.result(h.commands[1], runSdk(h.commands[1], {initial: {[field]: start / 100}}));
            await wait(240);
            assert.equal(h.commands.length, 2);
            assert.equal(h.controller.getInteractionState().correctionBusy, false,
                "Reset cancels the prior input timer and releases the busy guard after real confirmation");
        } finally { h.close(); }
    }
}

async function cancelledInput() {
    for (const change of ["photo", "develop", "mask", "swatch", "unavailable"]) {
        const h = await harness();
        try {
            h.input("HueShift", 65);
            const next = snapshot({pointColor: pointState({HueShift: -0.2,
                ...(change === "swatch" ? {selectedIndex: 2} : {}),
                ...(change === "unavailable" ? {available: false, selectedIndex: 0, swatchCount: 0} : {})}),
                ...(change === "mask" ? {selectedMaskGroupId: "mask-b", selectedMaskGroupIndex: 2,
                    previousAvailable: true, nextAvailable: false, selectedMaskToolId: "tool-mask-b"} : {})});
            if (change === "photo" || change === "develop") await h.changeContext(change === "photo" ?
                {selectedPhotoUuid: "photo-b", contextCounter: 5, contextChangedAt: 11} : {developCounter: 8}, next);
            else await h.refresh(next);
            await wait(240); await flush();
            assert.equal(h.commands.length, 0, change + ": an old debounce must never write into a new context");
            if (change !== "unavailable") assert.equal(h.value("HueShift"), "-20");
            assert.equal(h.controller.getInteractionState().correctionBusy, false);
        } finally { h.close(); }
    }
}

async function failedInput() {
    for (const failure of ["sdk", "commandTimeout", "feedbackTimeout"]) {
        let resolveAdmission;
        const admission = new Promise(resolve => { resolveAdmission = resolve; });
        const h = await harness({commandTimeoutMs: 45, feedbackTimeoutMs: 45,
            admission: failure === "commandTimeout" ? () => admission : undefined});
        try {
            await h.edit("HueShift", 30); h.input("HueShift", 65);
            if (failure === "sdk") await h.result(h.commands[0], runSdk(h.commands[0], {sdkFailure: true}));
            else await wait(70);
            assert.match(h.status(), /ERROR:/, failure + " must remain visible");
            assert.equal(h.value("HueShift"), "10");
            await wait(240);
            assert.equal(h.commands.length, 1, failure + ": cancel unsent input without retrying an uncertain edit");
            resolveAdmission(); await flush();
            assert.equal(h.controller.getInteractionState().correctionBusy, false);
            await h.refresh(snapshot({pointColor: pointState({HueShift: 0.3})}));
            assert.equal(h.value("HueShift"), "30", "late real state is displayed without resending");
        } finally { resolveAdmission(); h.close(); }
    }
}

async function run() {
    const demonstrate = process.argv.includes("--demonstrate-weakness");
    if (demonstrate) return debounceSnapshot(true);
    const cases = {debounceSnapshot: () => debounceSnapshot(false), olderConfirmation,
        alternatingDrags, resetAfterInput, cancelledInput, failedInput};
    let failures = 0;
    for (const [name, runCase] of Object.entries(cases)) {
        try { await runCase(); console.log("PASS " + name); }
        catch (error) { failures++; console.error("FAIL " + name, error); }
    }
    assert.equal(failures, 0, "masked Point Color regressions");
    console.log("Actual masked Point Color controls, production server and Lua exercised with SDK/DOM doubles; no native acceptance implied.");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
