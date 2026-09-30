"use strict";

// Production HTTP handlers, state machine and queue. SDK feedback is simulated;
// this test uses ephemeral ports and never contacts the running Lightroom bridge.
const assert = require("node:assert/strict");
const { createBridge } = require("../server/bridge");
const commands = require("../server/commands");
const { get, queryString, snapshot, suppliedBinding, submitQueryResult,
    correctionRequestPath, submitCorrectionResult } = require("./masking");

async function fixture(test) {
    commands.resetQueueForTests();
    let now = 10000;
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1",
        maskingStateOptions: { serverEpoch: "mask-recorded-context", now: () => now } });
    await bridge.start();
    const port = bridge.getHttpServer().address().port;
    const request = pathname => get(port, pathname);
    let fingerprint = 0;
    const update = overrides => request("/context/update?" + queryString({ activeModule: "develop",
        selectedPhotoUuid: "recorded-photo", developFingerprint: "fp-" + (++fingerprint), ...overrides }));
    const corrections = ["local_Dehaze", "local_Grain", "local_Texture", "local_Sharpness"]
        .map(parameter => ({ parameter, value: parameter === "local_Grain" ? -67 : 0, min: -100, max: 100 }));
    let sdk = snapshot({ corrections });
    async function publish(overrides) {
        if (overrides) sdk = { ...sdk, ...overrides };
        now += 450;
        await request("/masking/state");
        const query = (await request("/masking/next")).body.request;
        assert.ok(query);
        assert.equal((await submitQueryResult(port, query, sdk)).status, 200);
        return (await request("/masking/state")).body;
    }
    try {
        await update();
        let state = await publish();
        const binding = () => ({ ...suppliedBinding(state), selectedMaskGroupId: state.selectedMaskGroupId });
        async function send(kind, parameter, value, gestureId, supplied = binding()) {
            return request(correctionRequestPath(kind, parameter, value, supplied, gestureId));
        }
        await test({ request, update, publish, send, binding,
            state: () => state, refresh: async overrides => (state = await publish(overrides)),
            complete: async command => {
                sdk = { ...sdk, corrections: sdk.corrections.map(entry => entry.parameter === command.parameter
                    ? { ...entry, value: command.command.endsWith("reset") ? 0 : command.value } : entry) };
                assert.equal((await submitCorrectionResult(port, command, command.value, sdk)).status, 200);
                state = (await request("/masking/state")).body;
            } });
    } finally { commands.resetQueueForTests(); await bridge.stop(); }
}

const cases = {
    async heldContextChange() {
        for (const kind of ["photo", "mask"]) {
            const h = await require("./masking-correction-confirmation").harness();
            try {
                h.start(90); await require("./masking").flushAsync();
                const count = h.requests.length;
                if (kind === "photo") await h.changePhoto(); else await h.changeMask("mask-new");
                h.control().range.value = "80"; h.control().range.dispatch("input");
                await h.end();
                assert.equal(h.requests.length, count, "the old held gesture cannot transfer to a different " + kind);
                await h.drag(30); h.complete(h.last()); await h.refresh();
                assert.equal(h.control().number.value, "30");
            } finally { h.close(); }
        }
    },
    async controller() {
        const h = await require("./masking-correction-confirmation").harness({ allowRejected: true });
        try {
            await h.advanceDevelop(); // Masking poll is newer; host's context poll is still old.
            const control = h.control("local_Dehaze");
            h.start(20, "local_Dehaze");
            await require("./masking").flushAsync();
            for (let n = 0; n < 31; n++) {
                control.range.value = String(n);
                control.range.dispatch("input");
                await require("./masking").flushAsync();
            }
            assert.equal(h.requests.length, 1, "one stale rejection must stop requests with that binding during the held drag");
            assert.match(control.status.textContent, /context changed/i);
            assert.doesNotMatch(control.status.textContent, /no longer available/i);
            await h.catchUpContext();
            control.range.value = "65"; control.range.dispatch("input");
            await h.end("local_Dehaze");
            assert.equal(h.requests.length, 1, "a rejected adjustment must not be replayed automatically");
            await h.drag(40, "local_Dehaze");
            assert.ok(h.last().command);
            h.complete(h.last()); await h.refresh();
            assert.equal(control.number.value, "40");
        } finally { h.close(); }
    },
    async rejection() {
        await fixture(async f => {
            const old = f.binding();
            await f.update(); // Same photo and mask; changed Develop fingerprint, as recorded.
            await f.refresh();
            const result = await f.send("begin", "local_Dehaze", null, "mg-recorded-dehaze", old);
            assert.equal(result.status, 409);
            assert.equal(result.body.code, "stale_context");
            assert.match(result.body.error, /context changed/i);
            assert.equal(commands.getNextCommand(), null, "a rejected edit is never retried or dispatched");
            const unsupported = await f.send("reset", "local_Exposure", null);
            assert.equal(unsupported.status, 409);
            assert.equal(unsupported.body.code, "correction_unavailable");
        });
    },
    async cancellationDisplay() {
        const h = await require("./masking-correction-confirmation").harness();
        try {
            await h.drag(10);
            const command = h.last().command;
            await h.advanceDevelop();
            h.machine.rejectCommand(command, "Masking context changed before dequeue.");
            await h.catchUpContext();
            assert.match(h.control().status.textContent, /cancelled before reaching Lightroom/);
            assert.equal(h.control().number.value, "0", "cancellation must not invent the submitted value");
            await h.drag(25); h.complete(h.last()); await h.refresh();
            assert.equal(h.control().number.value, "25");
            assert.equal(h.control().status.textContent, "", "an older cancellation cannot replace a newer confirmed edit");
        } finally { h.close(); }
    },
    async lateRejection() {
        const h = await require("./masking-correction-confirmation").harness();
        try {
            const older = h.hold("end", 409, { code: "stale_context", error: "Old request's context changed." });
            await h.drag(20);
            h.start(75);
            older.resolve(); await require("./masking").flushAsync();
            assert.equal(h.control().range.disabled, false, "older rejected admission cannot cancel a newer gesture");
            await h.end(); h.complete(h.last()); await h.refresh();
            assert.equal(h.control().number.value, "75");
            assert.equal(h.control().status.textContent, "");
        } finally { h.close(); }
    },
    async grainCancellation() {
        await fixture(async f => {
            // The final recorded gesture: -41 -> 31 -> -48 -> 10. Earlier
            // requests advance the sequence to the recorded 136..140.
            for (let i = 1; i <= 135; i++) {
                await f.send("begin", "local_Texture", null, "mg-prior-" + i);
                assert.ok(commands.getNextCommand());
            }
            const globalBinding = "&preserveMaskingPanel=true&selectedPhotoUuid=recorded-photo&contextCounter=" + f.binding().contextCounter;
            assert.equal((await f.request("/set?slider=GrainFrequency&value=28" + globalBinding)).status, 200);
            assert.equal((await f.request("/set?slider=GrainSize&value=34" + globalBinding)).status, 200);
            await f.send("begin", "local_Grain", null, "mg-final-grain");
            for (const value of [-41, 31, -48]) await f.send("update", "local_Grain", value, "mg-final-grain");
            const admitted = await f.send("end", "local_Grain", 10, "mg-final-grain");
            assert.equal(admitted.status, 200);
            assert.equal(admitted.body.correctionSequence, 140);
            assert.equal(commands.getNextCommand().slider, "GrainFrequency");
            assert.equal(commands.getNextCommand().slider, "GrainSize");
            // A possible fingerprint transition, not a claim that the missing
            // native fingerprint-input log proves this particular cause.
            await f.update();
            assert.equal(commands.getNextCommand(), null);
            await f.refresh();
            const cancelled = f.state().correctionCancellations?.find(entry => entry.sequence === 140);
            assert.ok(cancelled, "queued final value must leave a cancellation receipt after context invalidation");
            assert.equal(cancelled.outcome, "cancelled");
            assert.equal(cancelled.dispatched, false);
            assert.equal(cancelled.value, 10);
            assert.equal(cancelled.parameter, "local_Grain");
            assert.equal(f.state().corrections.find(entry => entry.parameter === "local_Grain").value, -67);
        });
    },
    async rapidAndReset() {
        await fixture(async f => {
            const parameters = ["local_Texture", "local_Sharpness", "local_Grain"];
            for (let drag = 0; drag < 12; drag++) {
                const parameter = parameters[drag % parameters.length], id = "mg-burst-" + drag;
                await f.send("begin", parameter, null, id);
                await f.send("update", parameter, -70 + drag, id);
                await f.send("end", parameter, drag === 11 ? 10 : drag, id);
            }
            const writes = [];
            for (let command; (command = commands.getNextCommand());) writes.push(command);
            assert.deepEqual(writes.map(command => [command.parameter, command.value]),
                [["local_Texture", 9], ["local_Sharpness", 10], ["local_Grain", 10]],
                "superseded, undispatched gestures must not build a backlog ahead of the final values");
            for (const command of writes) await f.complete(command);
            assert.equal(f.state().correctionResults.find(entry => entry.parameter === "local_Grain").outcome, "confirmed");
            await f.send("end", "local_Grain", 80, "mg-before-reset");
            await f.send("reset", "local_Grain", null);
            await f.send("end", "local_Grain", 22, "mg-after-reset");
            const reset = commands.getNextCommand(), after = commands.getNextCommand();
            assert.equal(reset.command, "masking.correction.reset");
            assert.equal(after.value, 22);
            assert.equal(commands.getNextCommand(), null);
            await f.complete(reset); await f.complete(after);
            assert.equal(f.state().corrections.find(entry => entry.parameter === "local_Grain").value, 22);
            await f.send("end", "local_Grain", 11, "mg-before-global");
            assert.equal((await f.request("/set?slider=GrainSize&value=34&preserveMaskingPanel=true&selectedPhotoUuid=recorded-photo&contextCounter=" + f.binding().contextCounter)).status, 200);
            await f.send("end", "local_Grain", 12, "mg-after-global");
            assert.equal(commands.getNextCommand().value, 11, "coalescing cannot move an edit across a global write");
            assert.equal(commands.getNextCommand().slider, "GrainSize");
            assert.equal(commands.getNextCommand().value, 12);
            await f.send("end", "local_Grain", 55, "mg-old-photo");
            await f.update({ selectedPhotoUuid: "different-photo" });
            assert.equal(commands.getNextCommand(), null, "actual photo changes still cancel edits");
        });
    }
};

async function main() {
    const names = process.argv[2] ? [process.argv[2]] : Object.keys(cases);
    for (const name of names) { await cases[name](); console.log("PASS " + name); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { fixture };
