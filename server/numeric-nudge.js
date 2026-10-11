"use strict";
const crypto = require("node:crypto");
const sliders = require("./sliders");
const MAX_ADJUSTMENTS = 64, MAX_STEP_COUNT = 1000, MAX_TOTAL_STEPS = 4096, MAX_RECEIPTS = 8192;
const clientFields = ["requestId", "serverEpoch", "slider", "steps", "selectedPhotoUuid", "contextCounter", "contextChangedAt"];
const bindingFields = ["expectedServerEpoch", "expectedSelectedPhotoUuid", "expectedContextCounter", "expectedContextChangedAt", "admittedDevelopCounter"];
const commandFields = ["command", "operationId", "requestId", "slider", "steps", "numericStep", "precision", ...bindingFields];
const safeText = v => typeof v === "string" && /^[A-Za-z0-9:_-]{1,120}$/.test(v);
const integer = v => Number.isSafeInteger(v) && v >= 0;
const exact = (v, keys) => v && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
function definition(id) {
    const d = sliders.getById(id);
    // Boolean controls and the unreadable legacy placeholder have no numeric nudge contract.
    return d && d.feedbackSupported === true && d.max - d.min > 1 ? d : null;
}
function validSteps(steps) {
    return Array.isArray(steps) && steps.length > 0 && steps.length <= MAX_ADJUSTMENTS &&
        steps.every(n => Number.isSafeInteger(n) && n !== 0 && Math.abs(n) <= MAX_STEP_COUNT) &&
        steps.reduce((sum, n) => sum + Math.abs(n), 0) <= MAX_TOTAL_STEPS;
}
function validCommand(c) {
    const d = c && definition(c.slider);
    return !!d && exact(c, commandFields) && c.command === "develop.nudge" && /^nn-\d{1,10}$/.test(c.operationId) &&
        safeText(c.requestId) && safeText(c.expectedServerEpoch) && safeText(c.expectedSelectedPhotoUuid) &&
        ["expectedContextCounter", "expectedContextChangedAt", "admittedDevelopCounter"].every(k => integer(c[k])) &&
        c.numericStep === d.numericStep && c.precision === d.displayPrecision && validSteps(c.steps);
}
function createNumericNudge(options) {
    const epoch = options.serverEpoch || crypto.randomUUID(), now = options.now || Date.now;
    const receipts = new Map();
    let serial = 0;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    function matchesContext(c) {
        const ctx = options.getContext();
        return ctx.activeModule === "develop" && c.expectedServerEpoch === epoch &&
            c.expectedSelectedPhotoUuid === ctx.selectedPhotoUuid && c.expectedContextCounter === ctx.contextCounter &&
            c.expectedContextChangedAt === ctx.contextChangedAt && ctx.developCounter >= c.admittedDevelopCounter;
    }
    function finish(r, outcome, detail, values = {}) {
        r.phase = "complete";
        r.result = { requestId: r.command.requestId, operationId: r.command.operationId, slider: r.command.slider,
            selectedPhotoUuid: r.command.expectedSelectedPhotoUuid, contextCounter: r.command.expectedContextCounter,
            contextChangedAt: r.command.expectedContextChangedAt, admittedDevelopCounter: r.command.admittedDevelopCounter,
            outcome, detail, ...values };
        if (["failed", "uncertain"].includes(outcome)) console.warn("Numeric nudge:", r.result);
    }
    function sync(r) {
        if (r.phase === "complete") return;
        if (!matchesContext(r.command)) finish(r, r.claimed ? "uncertain" : "stale", "Photo or Develop navigation context changed.");
        else if (now() - r.started > 60000) finish(r, r.claimed ? "uncertain" : "stale", "Nudge expired; no automatic retry. Inspect Lightroom if execution was claimed.");
    }
    function receipt(r) { sync(r); return { serverEpoch: epoch, requestId: r.command.requestId, operationId: r.command.operationId, phase: r.phase, result: r.result }; }
    function owner(c) { const r = receipts.get(c.requestId); return r && same(c, r.command) ? r : null; }
    function lookup(input) {
        const r = receipts.get(input.requestId);
        return r && input.serverEpoch === epoch && input.operationId === r.command.operationId ? r : null;
    }
    return {
        capabilities() {
            const ctx = options.getContext();
            return { supported: true, version: 1, serverEpoch: epoch, command: "develop.nudge", endpoint: "/nudge", method: "POST",
                units: "ordered counts of numericStep (not SDK increment/decrement counts)",
                maxAdjustments: MAX_ADJUSTMENTS, maxStepCount: MAX_STEP_COUNT, maxTotalSteps: MAX_TOTAL_STEPS, maxReceipts: MAX_RECEIPTS,
                retry: "Reuse identical requestId, body and serverEpoch; IDs are never evicted in this epoch. Never retry with a new ID after uncertainty.",
                context: { selectedPhotoUuid: ctx.selectedPhotoUuid, contextCounter: ctx.contextCounter, contextChangedAt: ctx.contextChangedAt, developCounter: ctx.developCounter },
                sliders: sliders.getAll().filter(d => definition(d.id)).map(d => ({ id: d.id, numericStep: d.numericStep, precision: d.displayPrecision,
                    runtimeRangeRequired: d.id !== "ProfileAmount", available: "checked by SDK at execution" })) };
        },
        admit(input) {
            if (!exact(input, clientFields) || !safeText(input.requestId) || !safeText(input.serverEpoch) ||
                !safeText(input.selectedPhotoUuid) || !integer(input.contextCounter) || !integer(input.contextChangedAt) ||
                !definition(input.slider) || !validSteps(input.steps)) return { status: 400, error: "Invalid numeric nudge payload" };
            const canonical = Object.fromEntries(clientFields.map(k => [k, input[k]]));
            const previous = receipts.get(input.requestId);
            if (previous) return same(previous.input, canonical) ? { status: 200, duplicate: true, receipt: receipt(previous) } :
                { status: 409, error: "requestId already used with a different payload" };
            if (input.serverEpoch !== epoch) return { status: 409, error: "Server epoch changed; old requests cannot be replayed" };
            if (receipts.size >= MAX_RECEIPTS) return { status: 503, error: "Request receipt capacity reached; no IDs were evicted" };
            const d = definition(input.slider), ctx = options.getContext();
            const command = { command: "develop.nudge", operationId: "nn-" + (++serial), requestId: input.requestId,
                slider: input.slider, steps: [...input.steps], numericStep: d.numericStep, precision: d.displayPrecision,
                expectedServerEpoch: epoch, expectedSelectedPhotoUuid: input.selectedPhotoUuid,
                expectedContextCounter: input.contextCounter, expectedContextChangedAt: input.contextChangedAt, admittedDevelopCounter: ctx.developCounter };
            if (!matchesContext(command)) return { status: 409, error: "Stale photo or Develop navigation context" };
            // Copy request intent; neither callers nor queue consumers can mutate the receipt.
            const r = { input: JSON.parse(JSON.stringify(canonical)), command: JSON.parse(JSON.stringify(command)), started: now(), phase: "new", claimed: false, result: null };
            receipts.set(command.requestId, r);
            const admission = options.enqueue(command);
            if (!admission.accepted) {
                // Never reuse an accepted ID. An admission failure has not reached the worker.
                receipts.delete(command.requestId);
                return { status: admission.status === "queue_full" ? 503 : 409, error: "Nudge was not queued" };
            }
            return { status: 202, duplicate: false, receipt: receipt(r) };
        },
        matches(c, phase) {
            const r = owner(c); if (!r) return false; sync(r);
            if (r.phase === "complete" || !matchesContext(c)) return false;
            if (phase === "admit") { if (r.phase !== "new") return false; r.phase = "queued"; }
            if (phase === "dequeue") { if (r.phase !== "queued") return false; r.phase = "dispatched"; }
            return true;
        },
        reject(c) { const r = owner(c); if (r && r.phase !== "complete") finish(r, "stale", "Nudge could not be dispatched."); },
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
            if (r.phase !== "executing" || !r.claimed) return false;
            const outcomes = ["observed", "requested", "unavailable", "stale", "failed", "uncertain"];
            if (!outcomes.includes(input.outcome) || typeof input.invoked !== "boolean" || !integer(input.executionDevelopCounter) ||
                input.executionDevelopCounter < r.command.admittedDevelopCounter) return false;
            const values = { invoked: input.invoked, executionDevelopCounter: input.executionDevelopCounter };
            for (const k of ["baselineValue", "requestedValue", "sdkValue", "min", "max"]) {
                if (input[k] !== undefined) { if (!Number.isFinite(input[k])) return false; values[k] = input[k]; }
            }
            if (["observed", "requested"].includes(input.outcome) && (!input.invoked ||
                !["baselineValue", "requestedValue", "min", "max"].every(k => Number.isFinite(values[k])) ||
                values.min >= values.max || values.baselineValue < values.min || values.baselineValue > values.max ||
                values.requestedValue < values.min || values.requestedValue > values.max)) return false;
            if (input.outcome === "observed" && (!Number.isFinite(values.sdkValue) || values.sdkValue < values.min || values.sdkValue > values.max)) return false;
            if (input.outcome !== "observed" && values.sdkValue !== undefined) return false;
            if (values.sdkValue !== undefined) { values.valueSource = "sdk"; values.matchesRequested = Math.abs(values.sdkValue - values.requestedValue) < 1e-9; }
            finish(r, input.outcome, "Worker completion; requestedValue is calculated, sdkValue is a separate execution-time read.", values);
            return true;
        }
    };
}
module.exports = { createNumericNudge, validCommand, validSteps, definition, MAX_ADJUSTMENTS, MAX_STEP_COUNT, MAX_TOTAL_STEPS, MAX_RECEIPTS };
