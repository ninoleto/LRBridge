"use strict";
const crypto = require("node:crypto");
const sliders = require("./sliders");
const MAX_RECEIPTS = 8192, TIMEOUT_MS = 60000;
const clientFields = ["requestId", "serverEpoch", "slider", "selectedPhotoUuid", "contextCounter", "contextChangedAt"];
const commandFields = ["command", "operationId", "requestId", "slider", "expectedServerEpoch", "expectedSelectedPhotoUuid",
    "expectedContextCounter", "expectedContextChangedAt", "admittedDevelopCounter"];
const safeText = v => typeof v === "string" && /^[A-Za-z0-9:_-]{1,120}$/.test(v);
const integer = v => Number.isSafeInteger(v) && v >= 0;
const exact = (v, fields) => v && typeof v === "object" && !Array.isArray(v) &&
    Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v, k));
function definition(id) {
    const d = sliders.getById(id);
    return d && d.feedbackSupported === true && d.resetSupported !== false ? d : null;
}
function validCommand(c) {
    return exact(c, commandFields) && c.command === "develop.reset.correlated" && !!definition(c.slider) &&
        /^rc-\d{1,10}$/.test(c.operationId) && ["requestId", "expectedServerEpoch", "expectedSelectedPhotoUuid"].every(k => safeText(c[k])) &&
        ["expectedContextCounter", "expectedContextChangedAt", "admittedDevelopCounter"].every(k => integer(c[k]));
}
// Same receipt/claim/validate protocol as Numeric Nudge, with independent bounded
// storage and Reset-specific results. No feedback request can complete a receipt.
function createResetCompletion(options) {
    const epoch = options.serverEpoch || crypto.randomUUID(), now = options.now || Date.now;
    const receipts = new Map();
    let serial = 0, sweep = null;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    function matchesContext(c) {
        const ctx = options.getContext();
        return ctx.activeModule === "develop" && c.expectedServerEpoch === epoch &&
            ctx.selectedPhotoUuid === c.expectedSelectedPhotoUuid && ctx.contextCounter === c.expectedContextCounter &&
            ctx.contextChangedAt === c.expectedContextChangedAt && ctx.developCounter >= c.admittedDevelopCounter;
    }
    function finish(r, outcome, detail, values = {}) {
        r.phase = "complete";
        const c = r.command;
        r.result = { serverEpoch: epoch, requestId: c.requestId, operationId: c.operationId, slider: c.slider,
            selectedPhotoUuid: c.expectedSelectedPhotoUuid, contextCounter: c.expectedContextCounter,
            contextChangedAt: c.expectedContextChangedAt, admittedDevelopCounter: c.admittedDevelopCounter,
            outcome, detail, completedAt: now(), ...values };
    }
    function sync(r) {
        if (r.phase === "complete") return;
        if (!matchesContext(r.command)) finish(r, r.claimed ? "uncertain" : "stale", "Photo or Develop navigation context changed.");
        else if (now() - r.started >= TIMEOUT_MS) finish(r, r.claimed ? "uncertain" : "timeout",
            r.claimed ? "Worker claimed Reset but no owned completion arrived; inspect Lightroom before any new operation." : "Reset expired before execution claim.");
    }
    function receipt(r) {
        sync(r);
        // A retained observation describes its original operation, never current feedback.
        return JSON.parse(JSON.stringify({ serverEpoch: epoch, requestId: r.command.requestId, operationId: r.command.operationId,
            phase: r.phase, result: r.result }));
    }
    function owner(c) { const r = receipts.get(c.requestId); return r && same(c, r.command) ? r : null; }
    function lookup(input) {
        const r = receipts.get(input.requestId);
        return input.serverEpoch === epoch && r && input.operationId === r.command.operationId ? r : null;
    }
    const state = {
        capabilities() {
            const ctx = options.getContext();
            return { supported: true, version: 1, serverEpoch: epoch, command: "develop.reset.correlated", endpoint: "/reset", method: "POST",
                capture: "SDK read in serial command worker after successful Driver.resetSlider return",
                maxReceipts: MAX_RECEIPTS, timeoutMs: TIMEOUT_MS,
                context: { selectedPhotoUuid: ctx.selectedPhotoUuid, contextCounter: ctx.contextCounter,
                    contextChangedAt: ctx.contextChangedAt, developCounter: ctx.developCounter },
                sliders: sliders.getAll().filter(d => definition(d.id)).map(d => d.id) };
        },
        admit(input) {
            if (!exact(input, clientFields) || !["requestId", "serverEpoch", "selectedPhotoUuid"].every(k => safeText(input[k])) ||
                !integer(input.contextCounter) || !integer(input.contextChangedAt) || !definition(input.slider)) {
                return { status: 400, error: "Invalid identified Reset payload" };
            }
            const canonical = Object.fromEntries(clientFields.map(k => [k, input[k]]));
            if (input.serverEpoch !== epoch) return { status: 409, error: "Server epoch changed; old Reset requests cannot be replayed" };
            const previous = receipts.get(input.requestId);
            if (previous) return same(previous.input, canonical) ? { status: 200, duplicate: true, receipt: receipt(previous) } :
                { status: 409, error: "requestId already used with a different Reset payload" };
            if (receipts.size >= MAX_RECEIPTS) return { status: 503, error: "Reset receipt capacity reached; no IDs were evicted" };
            const command = { command: "develop.reset.correlated", operationId: "rc-" + (++serial), requestId: input.requestId, slider: input.slider,
                expectedServerEpoch: epoch, expectedSelectedPhotoUuid: input.selectedPhotoUuid, expectedContextCounter: input.contextCounter,
                expectedContextChangedAt: input.contextChangedAt, admittedDevelopCounter: options.getContext().developCounter };
            if (!matchesContext(command)) return { status: 409, error: "Stale photo or Develop navigation context" };
            const r = { input: canonical, command: { ...command }, started: now(), claimed: false, phase: "new", result: null };
            receipts.set(command.requestId, r);
            const admission = options.enqueue(command);
            if (!admission.accepted) {
                finish(r, "unavailable", "Reset was not admitted to the command queue.", { invoked: false, resetSucceeded: false });
                return { status: admission.status === "queue_full" ? 503 : 409, error: "Reset was not queued", receipt: receipt(r) };
            }
            return { status: 202, duplicate: false, receipt: receipt(r) };
        },
        matches(c, phase) {
            const r = owner(c); if (!r) return false; sync(r);
            if (r.phase === "complete") return false;
            if (phase === "admit") { if (r.phase !== "new") return false; r.phase = "queued"; }
            if (phase === "dequeue") { if (r.phase !== "queued") return false; r.phase = "dispatched"; }
            return true;
        },
        reject(c) { const r = owner(c); if (r && r.phase !== "complete") finish(r, "stale", "Reset could not be dispatched."); },
        claim(input) {
            const r = lookup(input); if (!r) return false; sync(r);
            if (r.phase !== "dispatched" || r.claimed) return false;
            r.claimed = true; r.phase = "executing"; return true;
        },
        validate(input) {
            const r = lookup(input); if (!r) return { valid: false }; sync(r);
            return { valid: r.phase === "executing" && r.claimed && matchesContext(r.command), developCounter: options.getContext().developCounter };
        },
        get(input) { const r = receipts.get(input.requestId); return input.serverEpoch === epoch && r ? receipt(r) : null; },
        acceptResult(input) {
            const r = lookup(input); if (!r) return false; sync(r);
            if (r.phase !== "executing" || !r.claimed || !matchesContext(r.command)) return false;
            const c = r.command;
            if (input.slider !== c.slider || input.selectedPhotoUuid !== c.expectedSelectedPhotoUuid ||
                input.contextCounter !== c.expectedContextCounter || input.contextChangedAt !== c.expectedContextChangedAt ||
                !integer(input.executionDevelopCounter) || input.executionDevelopCounter < c.admittedDevelopCounter ||
                typeof input.invoked !== "boolean" || typeof input.resetSucceeded !== "boolean" ||
                !["observed", "stale", "unavailable", "failed", "uncertain"].includes(input.outcome) ||
                input.resetSucceeded && !input.invoked) return false;
            if (input.outcome === "observed" ? !input.resetSucceeded || !Number.isFinite(input.sdkValue) : input.sdkValue !== undefined) return false;
            if (input.outcome === "failed" && input.resetSucceeded) return false;
            if (input.outcome === "stale" && input.invoked) return false;
            const currentRevision = options.getContext().developCounter;
            if (input.executionDevelopCounter > currentRevision) return false;
            if (input.executionDevelopCounter < currentRevision) {
                finish(r, "uncertain", "Develop revision changed during final Reset result delivery.",
                    { invoked: input.invoked, resetSucceeded: input.resetSucceeded, executionDevelopCounter: input.executionDevelopCounter });
                return false;
            }
            const values = { invoked: input.invoked, resetSucceeded: input.resetSucceeded, executionDevelopCounter: input.executionDevelopCounter };
            if (input.outcome === "observed") Object.assign(values, { sdkValue: input.sdkValue, valueSource: "sdk", capture: "serial-worker-after-reset" });
            finish(r, input.outcome, "Reset worker result; observed means SDK Reset returned successfully, followed by an owned SDK read.", values);
            return true;
        },
        syncAll() { for (const r of receipts.values()) sync(r); },
        start() { if (!sweep) { sweep = setInterval(state.syncAll, 1000); sweep.unref(); } },
        stop() {
            clearInterval(sweep); sweep = null;
            for (const r of receipts.values()) if (r.phase !== "complete") finish(r, r.claimed ? "uncertain" : "stale", "Bridge stopped before Reset completion.");
        }
    };
    return state;
}
module.exports = { createResetCompletion, validCommand, definition, MAX_RECEIPTS, TIMEOUT_MS };
