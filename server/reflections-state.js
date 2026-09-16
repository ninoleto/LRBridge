"use strict";
const crypto = require("node:crypto");
const fields = ["checkboxState", "amount", "quality", "enabled", "isSupported"];
const bindings = ["expectedServerEpoch", "expectedReflectionsRevision", "expectedActiveModule", "expectedSelectedPhotoUuid",
    "expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt"];
const commandFields = ["command", "operationId", "field", "value", "expectedCheckboxState", "expectedAmount", "expectedQuality", ...bindings];
const contextFields = ["activeModule", "selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt"];
const valid = (field, value) => field === "checkboxState" ? typeof value === "boolean" : field === "amount" ?
    typeof value === "number" && Number.isFinite(value) && value >= -100 && value <= 100 :
    field === "quality" && ["preview", "standard", "best"].includes(value);
const same = (a, b) => bindings.every(k => a[k] === b[k]);
function sanitize(input) {
    if (input.available === false) return { available: false, reason: String(input.reason || "Native Reflections state unavailable.").slice(0, 200) };
    if (input.available !== true || !["checkboxState", "amount", "quality"].every(k => valid(k, input[k])) ||
        !["enabled", "isSupported"].every(k => typeof input[k] === "boolean")) return null;
    return { available: true, ...Object.fromEntries(fields.map(k => [k, input[k]])) };
}
function validCommand(c) {
    return c && Object.keys(c).length === commandFields.length && commandFields.every(k => Object.hasOwn(c, k)) &&
        c.command === "reflections.set" && /^rf-\d{1,15}$/.test(c.operationId) && valid(c.field, c.value) &&
        valid("checkboxState", c.expectedCheckboxState) && valid("amount", c.expectedAmount) && valid("quality", c.expectedQuality) &&
        c.expectedActiveModule === "develop" && typeof c.expectedSelectedPhotoUuid === "string" && c.expectedSelectedPhotoUuid.length > 0 &&
        typeof c.expectedServerEpoch === "string" && c.expectedServerEpoch.length > 0 &&
        ["expectedReflectionsRevision", "expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt"].every(k => Number.isSafeInteger(c[k]) && c[k] >= 0);
}
function createReflectionsState(options) {
    const now = options.now || Date.now, epoch = options.serverEpoch || crypto.randomUUID();
    let revision = 1, serial = 0, key = null, snapshot = { available: false }, capturedAt = null, query = null, pending = null, lastResult = null, requestedAt = 0;
    const context = () => options.getContext();
    function finish(outcome, detail, callbackCompleted = false, invoked = false) {
        lastResult = { operationId: pending.command.operationId, field: pending.command.field, value: pending.command.value,
            outcome, detail, callbackCompleted, invoked };
        pending = query = null; revision++; requestedAt = 0;
        if (options.onChanged) options.onChanged();
    }
    function sync() {
        const next = JSON.stringify(contextFields.map(k => context()[k]));
        if (key !== next) {
            key = next; snapshot = { available: false, reason: "Photo or Develop context changed." }; capturedAt = null; query = null;
            if (pending) finish("stale", "Photo or Develop context changed; earlier Reflections request cancelled.");
            else lastResult = null;
            revision++; requestedAt = 0;
        }
        if (pending && now() - pending.started > 120000) {
            finish("failed", "Reflections timed out; result unconfirmed. Read native state before another request.", pending.callbackCompleted, pending.invoked);
            snapshot = { available: false, reason: "Waiting for fresh Reflections state after timeout." }; capturedAt = null;
        }
        if (query && now() - query.started > 5000) query = null;
    }
    function binding() {
        const c = context();
        return { expectedServerEpoch: epoch, expectedReflectionsRevision: revision, expectedActiveModule: c.activeModule,
            expectedSelectedPhotoUuid: c.selectedPhotoUuid, expectedContextCounter: c.contextCounter,
            expectedDevelopCounter: c.developCounter, expectedContextChangedAt: c.contextChangedAt };
    }
    function validateBinding(c) { sync(); return Boolean(pending && c.operationId === pending.command.operationId && same(c, pending.command)); }
    function get(refresh) {
        sync();
        if (refresh && !pending && !query && now() - requestedAt >= 400 && context().activeModule === "develop" && context().selectedPhotoUuid) {
            query = { request: { command: "reflections.query", requestId: "fq-" + (++serial), ...binding() }, started: now(), dispatched: false }; requestedAt = now();
        }
        return { ...snapshot, ...context(), serverEpoch: epoch, revision, capturedAt, ageMs: capturedAt === null ? null : Math.max(0, now() - capturedAt),
            pendingOperation: pending ? { operationId: pending.command.operationId, field: pending.command.field, value: pending.command.value,
                phase: pending.phase, callbackCompleted: pending.callbackCompleted, invoked: pending.invoked } : null, lastResult };
    }
    return { get, validateBinding,
        takeRequest() { sync(); if (!query || query.dispatched || pending) return null; query.dispatched = true; return { ...query.request }; },
        acceptQuery(input) {
            sync(); const next = sanitize(input);
            if (!query || !query.dispatched || pending || query.request.requestId !== input.requestId || !same(input, query.request) || !next) return false;
            query = null; capturedAt = now(); if (JSON.stringify(next) !== JSON.stringify(snapshot)) revision++;
            snapshot = next; return true;
        },
        admit(field, value, client) {
            sync();
            if (pending || !valid(field, value) || !snapshot.available || !snapshot.enabled || !snapshot.isSupported ||
                capturedAt === null || now() - capturedAt > 5000 || client.serverEpoch !== epoch || client.stateRevision !== revision ||
                contextFields.some(k => k !== "activeModule" && client[k] !== context()[k])) return null;
            const command = { command: "reflections.set", operationId: "rf-" + (++serial), field, value,
                expectedCheckboxState: snapshot.checkboxState, expectedAmount: snapshot.amount, expectedQuality: snapshot.quality, ...binding() };
            if (!validCommand(command)) return null;
            pending = { command, started: now(), admitted: false, dispatched: false, phase: "queued", callbackCompleted: false, invoked: false };
            query = null; revision++; return { ...command };
        },
        matches(command, phase) {
            if (!validateBinding(command) || !commandFields.every(k => command[k] === pending.command[k])) return false;
            if (phase === "admit") { if (pending.admitted) return false; pending.admitted = true; }
            if (phase === "dequeue") { if (!pending.admitted || pending.dispatched) return false; pending.dispatched = true; }
            return true;
        },
        reject(command, detail) { if (validateBinding(command)) finish("stale", detail); },
        acceptResult(input) {
            if (!validateBinding(input) || !pending.dispatched || input.field !== pending.command.field || input.value !== pending.command.value ||
                !["requested", "confirmed", "failed", "stale"].includes(input.outcome) || typeof input.callbackCompleted !== "boolean" || typeof input.invoked !== "boolean") return false;
            const next = sanitize(input); if (!next || pending.callbackCompleted && !input.callbackCompleted || pending.invoked && !input.invoked) return false;
            snapshot = next; capturedAt = now();
            if (input.outcome === "requested") {
                pending.phase = "requested"; pending.callbackCompleted = input.callbackCompleted; pending.invoked = input.invoked; revision++;
                if (options.onChanged) options.onChanged(); return true;
            }
            let outcome = input.outcome, detail = input.detail;
            const enabledForConfirmation = next.enabled || input.field === "checkboxState" && input.value === false;
            if (outcome === "confirmed" && (!next.available || !enabledForConfirmation || !next.isSupported || next[input.field] !== input.value ||
                input.preserved !== true || ["checkboxState", "amount", "quality"].some(f => f !== input.field &&
                    next[f] !== pending.command["expected" + f[0].toUpperCase() + f.slice(1)]) ||
                input.invoked && input.field !== "amount" && !input.callbackCompleted)) {
                outcome = "failed"; detail = "Reflections result lacks callback or native preservation/readback confirmation.";
            }
            finish(outcome, detail, input.callbackCompleted, input.invoked); return true;
        }
    };
}
module.exports = { createReflectionsState, validCommand, valid, fields, bindings };
