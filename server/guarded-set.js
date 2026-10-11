"use strict";
// Optional compare-and-set batches. Legacy GET /set and Reset remain independent.
const crypto = require("node:crypto");
const SLIDERS = ["Contrast", "Clarity", "Vibrance"], MAX_RECEIPTS = 8192, TIMEOUT_MS = 15000;
const clientFields = ["requestId", "serverEpoch", "slider", "value", "expectedValue", "selectedPhotoUuid", "contextCounter", "contextChangedAt"];
const commandFields = ["command", "operationId", "requestId", "slider", "value", "expectedValue", "expectedServerEpoch",
    "expectedSelectedPhotoUuid", "expectedContextCounter", "expectedContextChangedAt", "admittedDevelopCounter"];
const text = v => typeof v === "string" && /^[A-Za-z0-9:_-]{1,120}$/.test(v);
const integer = v => Number.isSafeInteger(v) && v >= 0;
const exact = (v, fields) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v, k));
const value = v => Number.isFinite(v) && v >= -100 && v <= 100;
function validCommand(c) {
    return exact(c, commandFields) && c.command === "develop.set.guarded" && SLIDERS.includes(c.slider) &&
        /^gs-\d{1,10}$/.test(c.operationId) && ["requestId", "expectedServerEpoch", "expectedSelectedPhotoUuid"].every(k => text(c[k])) &&
        ["expectedContextCounter", "expectedContextChangedAt", "admittedDevelopCounter"].every(k => integer(c[k])) &&
        value(c.expectedValue) && value(c.value);
}
function createGuardedSet(options) {
    const epoch = options.serverEpoch || crypto.randomUUID(), now = options.now || Date.now, receipts = new Map();
    let serial = 0, sweep;
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    function owns(c) {
        const ctx = options.getContext();
        return ctx.activeModule === "develop" && epoch === c.expectedServerEpoch && ctx.selectedPhotoUuid === c.expectedSelectedPhotoUuid &&
            ctx.contextCounter === c.expectedContextCounter && ctx.contextChangedAt === c.expectedContextChangedAt && ctx.developCounter >= c.admittedDevelopCounter;
    }
    function finish(r, outcome, reason, invoked) {
        r.phase = "complete";
        const c = r.command;
        r.result = { serverEpoch: epoch, requestId: c.requestId, operationId: c.operationId, slider: c.slider,
            selectedPhotoUuid: c.expectedSelectedPhotoUuid, contextCounter: c.expectedContextCounter, contextChangedAt: c.expectedContextChangedAt,
            expectedValue: c.expectedValue, requestedValue: c.value, admittedDevelopCounter: c.admittedDevelopCounter,
            outcome, reason, invoked, completedAt: now() };
    }
    function sync(r) {
        if (r.phase === "complete") return;
        if (!owns(r.command)) finish(r, r.claimed ? "uncertain" : "rejected", "ownership", r.claimed ? null : false);
        else if (now() - r.started >= TIMEOUT_MS) finish(r, r.claimed ? "uncertain" : "rejected", "timeout", r.claimed ? null : false);
    }
    function receipt(r) { sync(r); return structuredClone({ serverEpoch: epoch, requestId: r.command.requestId, operationId: r.command.operationId, phase: r.phase, result: r.result }); }
    function lookup(input) { const r = receipts.get(input.requestId); return input.serverEpoch === epoch && r && input.operationId === r.command.operationId ? r : null; }
    function owner(c) { const r = receipts.get(c.requestId); return r && equal(r.command, c) ? r : null; }
    const state = {
        capabilities() { return { supported: true, version: 1, serverEpoch: epoch, endpoint: "/set", method: "POST", sliders: SLIDERS,
            timeoutMs: TIMEOUT_MS, maxReceipts: MAX_RECEIPTS, completion: "applied is successful SDK invocation, not authoritative feedback", context: options.getContext() }; },
        admit(input) {
            if (!exact(input, clientFields) || !["requestId", "serverEpoch", "selectedPhotoUuid"].every(k => text(input[k])) ||
                !SLIDERS.includes(input.slider) || !value(input.value) || !value(input.expectedValue) ||
                !integer(input.contextCounter) || !integer(input.contextChangedAt)) return { status: 400, error: "Invalid guarded Set payload" };
            if (input.serverEpoch !== epoch) return { status: 409, error: "Server epoch changed; do not replay an uncertain write" };
            const canonical = Object.fromEntries(clientFields.map(k => [k, input[k]])), previous = receipts.get(input.requestId);
            if (previous) return equal(previous.input, canonical) ? { status: 200, duplicate: true, receipt: receipt(previous) } : { status: 409, error: "requestId payload conflict" };
            if (receipts.size >= MAX_RECEIPTS) return { status: 503, error: "Receipt capacity reached; no IDs evicted" };
            const command = { command: "develop.set.guarded", operationId: "gs-" + (++serial), requestId: input.requestId, slider: input.slider,
                value: input.value, expectedValue: input.expectedValue, expectedServerEpoch: epoch, expectedSelectedPhotoUuid: input.selectedPhotoUuid,
                expectedContextCounter: input.contextCounter, expectedContextChangedAt: input.contextChangedAt, admittedDevelopCounter: options.getContext().developCounter };
            const r = { input: canonical, command, started: now(), claimed: false, phase: "new", result: null };
            receipts.set(command.requestId, r);
            if (!owns(command)) { finish(r, "rejected", "ownership", false); return { status: 409, receipt: receipt(r) }; }
            const admission = options.enqueue({ ...command });
            if (!admission.accepted) { finish(r, "rejected", "queue-unavailable", false); return { status: 503, receipt: receipt(r) }; }
            return { status: 202, duplicate: false, receipt: receipt(r) };
        },
        matches(c, phase) {
            const r = owner(c); if (!r) return false; sync(r);
            if (r.phase === "complete") return false;
            if (phase === "admit") { if (r.phase !== "new") return false; r.phase = "queued"; }
            if (phase === "dequeue") { if (r.phase !== "queued") return false; r.phase = "dispatched"; }
            return true;
        },
        reject(c) { const r = owner(c); if (r && r.phase !== "complete") finish(r, "rejected", "ownership", false); },
        claim(input) { const r = lookup(input); if (!r) return false; sync(r); if (r.phase !== "dispatched" || r.claimed) return false; r.claimed = true; r.phase = "executing"; return true; },
        validate(input) { const r = lookup(input); if (!r) return { valid: false }; sync(r); return { valid: r.phase === "executing" && r.claimed && owns(r.command) }; },
        get(input) { const r = receipts.get(input.requestId); return input.serverEpoch === epoch && r ? receipt(r) : null; },
        acceptResult(input) {
            const r = lookup(input); if (!r) return false; sync(r);
            if (r.phase !== "executing" || !r.claimed || !owns(r.command)) return false;
            const c = r.command;
            if (input.slider !== c.slider || input.selectedPhotoUuid !== c.expectedSelectedPhotoUuid || input.contextCounter !== c.expectedContextCounter ||
                input.contextChangedAt !== c.expectedContextChangedAt || typeof input.invoked !== "boolean" ||
                !["applied", "rejected", "uncertain"].includes(input.outcome) ||
                !["sdk-returned", "baseline-mismatch", "ownership", "unavailable", "sdk-error"].includes(input.reason) ||
                (input.outcome === "rejected" ? input.invoked : !input.invoked) ||
                (input.outcome === "applied" ? input.reason !== "sdk-returned" : input.reason === "sdk-returned") ||
                (input.outcome === "uncertain" && !["sdk-error", "ownership"].includes(input.reason))) return false;
            finish(r, input.outcome, input.reason, input.invoked); return true;
        },
        syncAll() { for (const r of receipts.values()) sync(r); },
        start() { if (!sweep) { sweep = setInterval(state.syncAll, 1000); sweep.unref(); } },
        stop() { clearInterval(sweep); sweep = null; for (const r of receipts.values()) if (r.phase !== "complete") finish(r, r.claimed ? "uncertain" : "rejected", "stopped", r.claimed ? null : false); }
    };
    return state;
}
module.exports = { createGuardedSet, validCommand, SLIDERS, MAX_RECEIPTS, TIMEOUT_MS };
