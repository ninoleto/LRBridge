"use strict";

// Production Controller + state machine; deterministic, simulated SDK results.
// These checks send no requests to the running bridge or Lightroom.
const assert = require("node:assert/strict");
const ui = require("../app/controller-masking");
const { createMaskingState } = require("../server/masking-state");
const { FakeDocument, findElement, context, snapshot, suppliedBinding, correctionResult, flushAsync } = require("./masking");

class Clock {
    constructor() { this.now = 0; this.timers = new Map(); this.history = []; }
    install() {
        this.originalSet = global.setTimeout;
        this.originalClear = global.clearTimeout;
        global.setTimeout = (callback, delay) => {
            const timer = { callback, delay, due: this.now + delay };
            this.timers.set(timer, timer);
            this.history.push(timer);
            return timer;
        };
        global.clearTimeout = (timer) => this.timers.delete(timer);
    }
    async advance(ms) {
        const end = this.now + ms;
        for (;;) {
            const timer = [...this.timers.values()].sort((a, b) => a.due - b.due)[0];
            if (!timer || timer.due > end) break;
            this.now = timer.due;
            this.timers.delete(timer);
            timer.callback();
            await flushAsync();
        }
        this.now = end;
    }
    restore() { global.setTimeout = this.originalSet; global.clearTimeout = this.originalClear; }
}

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

async function harness(options = {}) {
    const clock = new Clock();
    clock.install();
    const machine = createMaskingState({ serverEpoch: "regular-correction-test" });
    let fields = context();
    let hostFields = fields;
    let sdk = snapshot({ corrections: [
        { parameter: "local_Texture", value: 0, min: -100, max: 100 },
        { parameter: "local_Sharpness", value: 20, min: 0, max: 150 },
        { parameter: "local_Dehaze", value: 0, min: -100, max: 100 },
        { parameter: "local_Grain", value: 24, min: -100, max: 100 }
    ] });
    function publishSdk() {
        machine.requestRefresh(fields, true);
        assert.equal(machine.acceptQueryResult({ ...machine.takeRequest(), snapshot: sdk }, fields), true);
    }
    machine.syncContext(fields);
    publishSdk();
    const document = new FakeDocument();
    const host = document.createElement("div");
    const requests = [], gates = [];
    const controller = ui.createController({
        document, getContext: () => hostFields, setInterval: () => 1, clearInterval() {},
        fetch: async (url) => {
            if (url === "/api/masking/state") {
                return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(machine.getPublicState())) };
            }
            const parsed = new URL(url, "http://fixture");
            assert.ok(parsed.pathname.startsWith("/api/masking/correction/"), url);
            const names = { begin: "gestureBegin", update: "gestureUpdate", end: "gestureEnd", cancel: "gestureCancel", reset: "reset" };
            const kind = parsed.pathname.split("/").pop();
            const query = parsed.searchParams;
            const command = machine.beginCorrection({ kind: names[kind], parameter: query.get("parameter"),
                gestureId: query.get("gestureId"), selectedMaskGroupId: query.get("selectedMaskGroupId"),
                value: query.has("value") ? Number(query.get("value")) : undefined
            }, { selectedPhotoUuid: query.get("selectedPhotoUuid"), contextCounter: Number(query.get("contextCounter")),
                developCounter: Number(query.get("developCounter")), contextChangedAt: Number(query.get("contextChangedAt")),
                serverEpoch: query.get("serverEpoch"), revision: Number(query.get("stateRevision")) }, fields);
            if (!options.allowRejected) assert.ok(command, "production state machine must admit the Controller request: " + url);
            const request = { command, kind, at: clock.now };
            requests.push(request);
            if (!command) return { ok: false, status: 409, json: async () => ({ ok: false,
                code: "stale_context", error: "Lightroom's photo or Develop context changed. Refresh Masking before adjusting again." }) };
            const gateIndex = gates.findIndex((gate) => gate.kind === kind);
            const gate = gateIndex < 0 ? null : gates.splice(gateIndex, 1)[0];
            if (gate) await gate.promise;
            const status = gate && gate.status || 200;
            return { ok: status === 200, status, json: async () => status === 200 ? {
                ok: true, correctionSequence: command.correctionSequence
            } : { ok: false, error: "Admission failed in fixture", ...(gate && gate.body) } };
        }
    });
    controller.activate(host);
    await flushAsync();
    function control(parameter = "local_Texture") {
        const row = findElement(host, (element) => element.dataset.maskingCorrection === parameter);
        return { row, range: row.children[1], number: row.children[2], minus: row.children[3], plus: row.children[4],
            reset: row.children[5], status: row.children[6] };
    }
    function start(value, parameter) {
        const c = control(parameter);
        c.range.dispatch("pointerdown", { pointerId: 1 });
        c.range.value = String(value);
        c.range.dispatch("input");
    }
    async function end(parameter) {
        control(parameter).range.dispatch("pointerup", { pointerId: 1 });
        await flushAsync(20);
    }
    async function drag(value, parameter) { start(value, parameter); await end(parameter); }
    function complete(request, outcome = "confirmed", value) {
        const command = request.command;
        if (outcome === "confirmed") {
            const actual = value === undefined ? command.value : value;
            sdk = { ...sdk, corrections: sdk.corrections.map((entry) => entry.parameter === command.parameter
                ? { ...entry, value: actual } : entry) };
        }
        const result = correctionResult(command, Number.isFinite(command.value) ? command.value : null, sdk,
            { outcome, detail: outcome === "confirmed" ? null : "SDK correction failure (fixture)" });
        assert.equal(machine.acceptCorrectionResult(result, fields), true);
        return result;
    }
    return { machine, controller, requests, clock, control, start, end, drag, complete,
        refresh: async () => { await controller.refresh(); await flushAsync(); },
        last: (kind = "end") => requests.filter((request) => request.kind === kind).at(-1),
        hold(kind, status = 200, body) { const gate = { ...deferred(), kind, status, body }; gates.push(gate); return gate; },
        async changeMask(id) { sdk = { ...sdk, selectedMaskGroupId: id }; publishSdk(); await controller.refresh(); await flushAsync(); },
        async changePhoto() {
            fields = context({ selectedPhotoUuid: "photo-next", contextCounter: 8, contextChangedAt: 2222 });
            hostFields = fields;
            machine.syncContext(fields); publishSdk(); controller.updateContext(fields); await flushAsync();
        },
        async unavailable() { sdk = snapshot({ available: false, unavailableReason: "sdk_unavailable", active: false, corrections: [] }); publishSdk(); await controller.refresh(); await flushAsync(); },
        async advanceDevelop() { fields = { ...fields, developCounter: fields.developCounter + 1,
            maskingCorrectionDevelopFloor: undefined, maskingGrainMaskId: undefined }; machine.syncContext(fields); publishSdk(); await controller.refresh(); await flushAsync(); },
        async compatibleDevelop(hostFirst = true) {
            fields = { ...fields, maskingCorrectionDevelopFloor: fields.maskingCorrectionDevelopFloor ?? fields.developCounter,
                maskingGrainMaskId: sdk.selectedMaskGroupId, developCounter: fields.developCounter + 1 };
            machine.syncContext(fields);
            if (hostFirst) { hostFields = fields; controller.updateContext(fields); }
            await controller.refresh(); await flushAsync();
        },
        async catchUpContext() { hostFields = fields; controller.updateContext(fields); await controller.refresh(); await flushAsync(); },
        async external(value) { sdk = { ...sdk, corrections: sdk.corrections.map((entry) => entry.parameter === "local_Texture" ? { ...entry, value } : entry) }; publishSdk(); await controller.refresh(); await flushAsync(); },
        close() { controller.deactivate(); clock.restore(); }
    };
}

async function check(name, work) {
    const h = await harness();
    try { await work(h); console.log("PASS " + name); }
    finally { h.close(); }
}

async function main() {
    let failures = 0;
    const run = async (name, work) => {
        try { await check(name, work); }
        catch (error) { failures++; console.error("FAIL " + name + ": " + error.message); }
    };
    await run("alternating confirmed sliders survive a single browser poll", async (h) => {
        for (let i = 1; i <= 4; i++) {
            await h.drag(i * 10);
            await h.drag(i * 15, "local_Sharpness");
        }
        for (const request of h.requests.filter((request) => request.kind === "end")) h.complete(request);
        await h.refresh();
        assert.equal(h.control().status.textContent, "", "Texture confirmation was displaced by Sharpness");
        assert.equal(h.control("local_Sharpness").status.textContent, "");
        assert.equal(h.machine.getPublicState().correctionResults.length, 2, "retain only the latest result per parameter");
        const state = h.machine.getPublicState();
        assert.equal(state.lastCorrectionResult.sequence, h.last().command.correctionSequence, "legacy API result remains compatible");
        state.correctionResults[0].outcome = "failed";
        assert.equal(h.machine.getPublicState().correctionResults[0].outcome, "confirmed", "public results are copies");
        await h.clock.advance(3000);
        assert.equal(h.control().status.textContent, "");
        await h.external(-35);
        assert.equal(h.control().range.value, "-35", "later Lightroom edits stay authoritative");
    });
    await run("an old deadline cannot cancel a newer held drag", async (h) => {
        await h.drag(20);
        const old = h.clock.history.find((timer) => timer.delay === 3000);
        await h.clock.advance(2900);
        h.start(80);
        await flushAsync();
        old.callback(); // Also cover a cancelled callback already waiting to run.
        await flushAsync();
        assert.equal(h.control().range.value, "80", "old confirmation timer cleared newer user input");
        assert.equal(h.control().status.textContent, "Updating…");
        await h.end();
        await h.clock.advance(2999);
        assert.equal(h.control().status.textContent, "Updating…");
        await h.clock.advance(1);
        assert.match(h.control().status.textContent, /did not confirm.*in time/, "the latest genuinely missing result must still time out at 3000 ms");
        h.complete(h.last()); await h.refresh();
        assert.equal(h.control().range.value, "80");
        assert.equal(h.control().status.textContent, "", "late authoritative completion may recover accurately");
    });
    await run("delayed older HTTP admission does not start a deadline for newer input", async (h) => {
        const gate = h.hold("end");
        await h.drag(20);
        h.start(70); await flushAsync();
        gate.resolve(); await flushAsync(20);
        await h.clock.advance(3000);
        assert.equal(h.control().range.value, "70");
        assert.equal(h.control().status.textContent, "Updating…");
        await h.end(); h.complete(h.last()); await h.refresh();
        assert.equal(h.control().status.textContent, "");
    });
    await run("step debounce owns input before its end request", async (h) => {
        await h.drag(20); await h.clock.advance(2900);
        h.control().plus.click();
        await h.clock.advance(100);
        assert.equal(h.control().range.value, "21");
        assert.equal(h.control().status.textContent, "Updating…");
        await h.clock.advance(250);
        assert.equal(h.last().command.value, 21);
        h.complete(h.last()); await h.refresh();
        assert.equal(h.control().status.textContent, "");
    });
    await run("superseded failure cannot settle the newer edit; latest failure stays visible", async (h) => {
        await h.drag(20); const older = h.last();
        await h.drag(70); const newer = h.last();
        h.complete(older, "failed"); await h.refresh();
        assert.equal(h.control().range.value, "70");
        assert.equal(h.control().status.textContent, "Updating…");
        await h.drag(60, "local_Sharpness");
        h.complete(newer, "failed"); h.complete(h.last()); await h.refresh();
        assert.match(h.control().status.textContent, /SDK correction failure/, "a different slider must not displace a real failure either");
    });
    await run("same displayed value without a completion is not success", async (h) => {
        await h.drag(0); await h.external(0);
        assert.equal(h.control().status.textContent, "Updating…");
        await h.clock.advance(3000);
        assert.match(h.control().status.textContent, /did not confirm.*in time/);
    });
    await run("Reset waits for its own native result", async (h) => {
        await h.drag(70); const end = h.last();
        h.control().reset.click(); await flushAsync(20); const reset = h.last("reset");
        h.complete(end); await h.refresh();
        assert.equal(h.control().status.textContent, "Resetting…");
        assert.equal(h.control().range.value, "70", "do not invent a reset value");
        h.complete(reset, "confirmed", 0); await h.refresh();
        assert.equal(h.control().range.value, "0");
        assert.equal(h.control().status.textContent, "");
    });
    await run("mask/photo changes and unavailable controls discard previous completion ownership", async (h) => {
        await h.drag(20); const result = h.complete(h.last()); await h.refresh();
        assert.equal(h.machine.acceptCorrectionResult(result, context()), false, "duplicate result stays rejected");
        await h.changeMask("mask-next");
        assert.deepEqual(h.machine.getPublicState().correctionResults, []);
        await h.changeMask("mask-b");
        assert.deepEqual(h.machine.getPublicState().correctionResults, [], "returning to a mask cannot resurrect its old error");
        await h.drag(30); h.complete(h.last()); await h.refresh();
        await h.changePhoto();
        assert.deepEqual(h.machine.getPublicState().correctionResults, []);
        await h.drag(40); await h.unavailable(); await h.clock.advance(3000);
        assert.equal(h.control().range.disabled, true);
        assert.doesNotMatch(h.control().status.textContent, /in time/);
    });
    await run("HTTP failures are owned by the attempted edit", async (h) => {
        const oldGate = h.hold("end", 500);
        await h.drag(20); h.start(60); await flushAsync();
        oldGate.resolve(); await flushAsync(20);
        assert.equal(h.control().range.value, "60", "an older rejected request cannot clear newer input");
        await h.end(); h.complete(h.last()); await h.refresh();
        const latestGate = h.hold("end", 500);
        await h.drag(90); latestGate.resolve(); await flushAsync(20);
        assert.match(h.control().status.textContent, /could not receive/, "latest HTTP failure stays visible");
    });
    await run("older and duplicate completions cannot replace the latest result", async (h) => {
        await h.drag(20); const older = h.last();
        await h.drag(60); const newer = h.last();
        const result = h.complete(newer); await h.refresh();
        assert.equal(h.machine.acceptCorrectionResult(result, context()), false);
        assert.equal(h.machine.acceptCorrectionResult({ ...result, correctionSequence: older.command.correctionSequence,
            gestureId: older.command.gestureId, expectedValue: 20 }, context()), false);
        assert.equal(h.machine.getPublicState().correctionResults[0].sequence, newer.command.correctionSequence);
        assert.equal(h.control().range.value, "60");
    });
    await run("a queue rejection remains visible when another slider completes", async (h) => {
        await h.drag(30); const rejected = h.last();
        await h.drag(55, "local_Sharpness");
        assert.equal(h.machine.rejectCommand(rejected.command, "Correction unavailable (fixture)"), true);
        h.complete(h.last()); await h.refresh();
        assert.match(h.control().status.textContent, /Correction unavailable/);
        assert.equal(h.control("local_Sharpness").status.textContent, "");
    });
    if (failures) throw new Error(failures + " regular Masking confirmation regression(s) failed");
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { harness, main };
