"use strict";
const crypto = require("node:crypto");
const kinds = ["red_eye", "pet_eye", "reset", "close"];
const tools = ["loupe", "crop", "dust", "redeye", "masking", "upright", "point_color", "local_point_color", "depth_refinement"];
const contextFields = ["activeModule", "selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt"];
const bindings = ["expectedServerEpoch", "expectedRedEyeRevision", "expectedActiveModule", "expectedSelectedPhotoUuid",
    "expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt"];
const snapshotFields = ["available", "selectedTool", "openSupported", "closeSupported", "resetSupported", "reason"];
const commandFields = ["command", "operationId", "operationKind", "expectedSelectedTool", ...bindings];
const same = (a, b) => bindings.every(k => a[k] === b[k]);
function sanitize(input) {
    if (typeof input.available !== "boolean" || !["openSupported", "closeSupported", "resetSupported"].every(k => typeof input[k] === "boolean") ||
        (input.available ? !tools.includes(input.selectedTool) : input.selectedTool !== null)) return null;
    return { available: input.available, selectedTool: input.selectedTool, openSupported: input.openSupported,
        closeSupported: input.closeSupported, resetSupported: input.resetSupported,
        reason: input.available ? null : "Red Eye tool state unavailable." };
}
function validCommand(c) {
    return Boolean(c && Object.keys(c).length === commandFields.length && commandFields.every(k => Object.hasOwn(c, k)) &&
        c.command === "red_eye.action" && /^re-\d{1,15}$/.test(c.operationId) && kinds.includes(c.operationKind) &&
        tools.includes(c.expectedSelectedTool) && (c.operationKind !== "close" || c.expectedSelectedTool === "redeye") &&
        c.expectedActiveModule === "develop" && typeof c.expectedSelectedPhotoUuid === "string" && c.expectedSelectedPhotoUuid.length > 0 &&
        typeof c.expectedServerEpoch === "string" && c.expectedServerEpoch.length > 0 &&
        ["expectedRedEyeRevision", "expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt"].every(k => Number.isSafeInteger(c[k]) && c[k] >= 0));
}
function createRedEyeState(options) {
    const now = options.now || Date.now, epoch = options.serverEpoch || crypto.randomUUID();
    const unavailable = () => ({ available: false, selectedTool: null, openSupported: false, closeSupported: false, resetSupported: false, reason: "Red Eye tool state unavailable." });
    let revision = 1, serial = 0, key = null, snapshot = unavailable(), capturedAt = null, query = null, pending = null, lastResult = null, requestedAt = -Infinity;
    const context = () => options.getContext();
    function finish(outcome, detail, invoked = false) {
        lastResult = { operationId: pending.command.operationId, operationKind: pending.command.operationKind, outcome, detail, invoked };
        pending = query = null; revision++; requestedAt = -Infinity;
        if (options.onChanged) options.onChanged();
    }
    function sync() {
        const next = JSON.stringify(contextFields.map(k => context()[k]));
        if (key !== next) {
            key = next; snapshot = unavailable(); capturedAt = null; query = null;
            if (pending) finish("stale", "Photo or Develop context changed; earlier Red Eye request cancelled.");
            else lastResult = null;
            revision++; requestedAt = -Infinity;
        }
        if (pending && now() - pending.started > 15000) {
            finish("failed", "Red Eye request timed out; result unconfirmed. No retry sent.");
            snapshot = unavailable(); capturedAt = null;
        }
        if (query && now() - query.started > 5000) query = null;
    }
    function binding() {
        const c = context();
        return { expectedServerEpoch: epoch, expectedRedEyeRevision: revision, expectedActiveModule: c.activeModule,
            expectedSelectedPhotoUuid: c.selectedPhotoUuid, expectedContextCounter: c.contextCounter,
            expectedDevelopCounter: c.developCounter, expectedContextChangedAt: c.contextChangedAt };
    }
    function owns(c) { sync(); return Boolean(pending && c.operationId === pending.command.operationId && same(c, pending.command)); }
    function get(refresh) {
        sync();
        if (refresh && !pending && !query && now() - requestedAt >= 300 && context().activeModule === "develop" && context().selectedPhotoUuid) {
            query = { request: { command: "red_eye.query", requestId: "rq-" + (++serial), ...binding() }, started: now(), dispatched: false };
            requestedAt = now();
        }
        return { ...snapshot, ...context(), serverEpoch: epoch, revision, capturedAt,
            ageMs: capturedAt === null ? null : Math.max(0, now() - capturedAt),
            pendingOperation: pending ? { operationId: pending.command.operationId, operationKind: pending.command.operationKind } : null, lastResult };
    }
    return { get,
        validateBinding(c) { return owns(c) && pending.dispatched; },
        takeRequest() { sync(); if (!query || query.dispatched || pending) return null; query.dispatched = true; return { ...query.request }; },
        acceptQuery(input) {
            sync(); const next = sanitize(input);
            if (!query || !query.dispatched || pending || query.request.requestId !== input.requestId || !same(input, query.request) || !next) return false;
            query = null; capturedAt = now(); if (JSON.stringify(next) !== JSON.stringify(snapshot)) revision++;
            snapshot = next; return true;
        },
        admit(operationKind, client) {
            sync();
            const capability = operationKind === "close" ? "closeSupported" : operationKind === "reset" ? "resetSupported" : "openSupported";
            if (pending || !kinds.includes(operationKind) || !snapshot.available || !snapshot[capability] ||
                operationKind === "close" && snapshot.selectedTool !== "redeye" || capturedAt === null || now() - capturedAt > 5000 ||
                client.serverEpoch !== epoch || client.stateRevision !== revision ||
                contextFields.some(k => k !== "activeModule" && client[k] !== context()[k])) return null;
            const command = { command: "red_eye.action", operationId: "re-" + (++serial), operationKind,
                expectedSelectedTool: snapshot.selectedTool, ...binding() };
            if (!validCommand(command)) return null;
            pending = { command, started: now(), admitted: false, dispatched: false }; query = null; revision++;
            return { ...command };
        },
        matches(c, phase) {
            if (!owns(c) || !commandFields.every(k => c[k] === pending.command[k])) return false;
            if (phase === "admit") { if (pending.admitted) return false; pending.admitted = true; }
            if (phase === "dequeue") { if (!pending.admitted || pending.dispatched) return false; pending.dispatched = true; }
            return true;
        },
        reject(c, detail) { if (owns(c)) finish("stale", detail); },
        acceptResult(input) {
            if (!owns(input) || !pending.dispatched || input.operationKind !== pending.command.operationKind ||
                !["requested", "confirmed", "failed", "stale"].includes(input.outcome) || typeof input.invoked !== "boolean") return false;
            const next = sanitize(input); if (!next) return false;
            const kind = pending.command.operationKind;
            // Reset is dispatch-only. A successful SDK return cannot prove removal or Pet Eye scope.
            if (input.outcome === "requested" && (kind !== "reset" || !input.invoked) ||
                input.outcome === "confirmed" && (kind === "reset" || !input.invoked || !next.available ||
                    next.selectedTool !== (kind === "close" ? "loupe" : "redeye"))) return false;
            snapshot = next; capturedAt = now();
            const detail = input.outcome === "requested" ? "Reset requested" : input.outcome === "confirmed" ?
                kind === "close" ? "Tool closed." : (kind === "pet_eye" ? "Pet Eye" : "Red Eye") + " mode requested; tool open." : input.detail;
            finish(input.outcome, detail, input.invoked); return true;
        }
    };
}
module.exports = { createRedEyeState, validCommand, kinds, bindings, snapshotFields };
