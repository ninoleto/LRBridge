"use strict";
const crypto = require("node:crypto");
const actions = ["export.dialog", "export.previous"];
const contextFields = ["activeModule", "selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt"];
const bindings = ["expectedServerEpoch", "expectedActiveModule", "expectedSelectedPhotoUuid", "expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt"];
const snapshotFields = ["available", "selectionToken", "selectionCount", "dialogSupported", "previousSupported"];
const clientFields = ["requestId", "serverEpoch", "stateRevision", "selectionToken", ...contextFields];
const safeText = v => typeof v === "string" && /^[a-zA-Z0-9:_-]{1,120}$/.test(v);
const integer = v => Number.isSafeInteger(v) && v >= 0;
function validCommand(c) {
    if (!c || !["export.query", ...actions].includes(c.command)) return false;
    const fields = ["command", "requestId", ...bindings, ...(c.command === "export.query" ? [] : ["operationId", "expectedSelectionToken"])];
    return Object.keys(c).length === fields.length && fields.every(k => Object.hasOwn(c, k)) &&
        safeText(c.requestId) && safeText(c.expectedServerEpoch) && ["library", "develop"].includes(c.expectedActiveModule) &&
        safeText(c.expectedSelectedPhotoUuid) && ["expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt"].every(k => integer(c[k])) &&
        (c.command === "export.query" || /^ex-\d{1,15}$/.test(c.operationId) && safeText(c.expectedSelectionToken));
}
function createExportState(options) {
    const now = options.now || Date.now, epoch = options.serverEpoch || crypto.randomUUID();
    const empty = () => ({ available: false, selectionToken: null, selectionCount: 0, dialogSupported: false, previousSupported: false });
    let snapshot = empty(), capturedAt = null, revision = 1, serial = 0, query = null, pending = null, lastResult = null, key = null;
    let lastQueryAt = -Infinity, needsReview = false;
    // Never evict a request ID and allow it to execute again in this server epoch.
    const receipts = new Map();
    const context = () => options.getContext();
    const same = (a, b) => a && b && Object.keys(b).every(k => a[k] === b[k]);
    function binding() {
        const c = context();
        return { expectedServerEpoch: epoch, expectedActiveModule: c.activeModule, expectedSelectedPhotoUuid: c.selectedPhotoUuid,
            expectedContextCounter: c.contextCounter, expectedDevelopCounter: c.developCounter, expectedContextChangedAt: c.contextChangedAt };
    }
    function finish(outcome, detail, invoked) {
        if (!pending) return;
        lastResult = { requestId: pending.command.requestId, command: pending.command.command, operationId: pending.command.operationId, outcome, detail, invoked };
        receipts.get(pending.command.requestId).result = lastResult;
        needsReview = needsReview || outcome === "uncertain";
        pending = null; query = null; snapshot = empty(); capturedAt = null; revision++; lastQueryAt = -Infinity;
    }
    function sync() {
        const next = JSON.stringify(contextFields.map(k => context()[k]));
        if (next !== key) {
            key = next; query = null; snapshot = empty(); capturedAt = null; revision++; lastQueryAt = -Infinity;
            if (pending) finish(pending.dispatched ? "uncertain" : "stale", pending.dispatched ?
                "Context changed after dispatch. Check Lightroom; no retry was sent." : "Context changed before dispatch; export was not requested.", pending.dispatched ? null : false);
        }
        if (query && now() - query.started > 5000) { query = null; snapshot = empty(); capturedAt = null; revision++; }
        if (pending && now() - pending.started > 15000) finish(pending.dispatched ? "uncertain" : "stale",
            pending.dispatched ? "Export request unconfirmed. Check Lightroom; no retry was sent." : "Export request expired before dispatch.", pending.dispatched ? null : false);
    }
    function get(refresh = false) {
        sync();
        if (refresh && !pending && !query && now() - lastQueryAt >= 1000 && ["library", "develop"].includes(context().activeModule) && context().selectedPhotoUuid) {
            const command = { command: "export.query", requestId: "eq-" + (++serial), ...binding() };
            if (validCommand(command)) {
                query = { command, started: now(), admitted: false, dispatched: false }; lastQueryAt = now();
                if (!options.enqueue(command)) query = null;
            }
        }
        return { ...snapshot, ...context(), serverEpoch: epoch, revision, capturedAt,
            ageMs: capturedAt === null ? null : Math.max(0, now() - capturedAt), needsReview,
            pendingOperation: pending ? { requestId: pending.command.requestId, command: pending.command.command } : null, lastResult };
    }
    function owns(c) { return pending && same(c, pending.command); }
    return { get,
        matches(c, phase) {
            sync(); const owner = c.command === "export.query" ? query : pending;
            if (!owner || !same(c, owner.command) || !same(c, binding())) return false;
            if (phase === "admit") { if (owner.admitted) return false; owner.admitted = true; }
            if (phase === "dequeue") { if (!owner.admitted || owner.dispatched) return false; owner.dispatched = true; }
            return true;
        },
        reject(c) {
            if (c.command === "export.query") { if (query && same(c, query.command)) query = null; }
            else if (owns(c)) finish("stale", "Export request could not be dispatched.", false);
        },
        acceptQuery(input) {
            sync();
            if (!query || !query.dispatched || !same(input, query.command) || !same(input, binding()) || pending ||
                typeof input.available !== "boolean" || typeof input.dialogSupported !== "boolean" || typeof input.previousSupported !== "boolean" ||
                !integer(input.selectionCount) || (input.available ? !safeText(input.selectionToken) || input.selectionCount < 1 : input.selectionToken !== null || input.selectionCount !== 0)) return false;
            const next = Object.fromEntries(snapshotFields.map(k => [k, input[k]]));
            if (JSON.stringify(next) !== JSON.stringify(snapshot)) revision++;
            snapshot = next; capturedAt = now(); query = null; return true;
        },
        admit(action, input) {
            sync();
            if (!actions.includes(action) || !safeText(input.requestId) || input.serverEpoch !== epoch) return null;
            const fingerprint = JSON.stringify([action, ...clientFields.map(k => input[k])]);
            const prior = receipts.get(input.requestId);
            if (prior) return prior.fingerprint === fingerprint ? { duplicate: true, receipt: prior.result || { requestId: input.requestId, outcome: "pending" } } : null;
            if (receipts.size >= 10000 || pending || needsReview || !snapshot.available || capturedAt === null || now() - capturedAt > 5000 ||
                !snapshot[action === "export.dialog" ? "dialogSupported" : "previousSupported"] || input.stateRevision !== revision ||
                input.selectionToken !== snapshot.selectionToken || contextFields.some(k => input[k] !== context()[k])) return null;
            const command = { command: action, requestId: input.requestId, operationId: "ex-" + (++serial),
                expectedSelectionToken: snapshot.selectionToken, ...binding() };
            if (!validCommand(command)) return null;
            receipts.set(input.requestId, { fingerprint, result: null });
            pending = { command, started: now(), admitted: false, dispatched: false, claimed: false };
            query = null; revision++;
            return { command };
        },
        claim(c) {
            sync();
            if (!owns(c) || !pending.dispatched || pending.claimed || !same(c, binding())) return false;
            pending.claimed = true; return true;
        },
        acceptResult(input) {
            sync();
            if (!owns(input) || !pending.dispatched || !pending.claimed || !["requested", "stale", "uncertain"].includes(input.outcome) ||
                typeof input.invoked !== "boolean" || input.outcome === "requested" && !input.invoked || input.outcome === "stale" && input.invoked) return false;
            finish(input.outcome, input.outcome === "requested" ?
                (input.command === "export.dialog" ? "Export dialog requested." : "Export with Previous requested.") :
                input.outcome === "stale" ? "Catalog, photo or selection changed; export was not requested." :
                    "Export request unconfirmed. Check Lightroom; no retry was sent.", input.invoked);
            return true;
        },
        acknowledge(input) {
            sync();
            if (!needsReview || pending || input.serverEpoch !== epoch || input.operationId !== lastResult?.operationId) return false;
            needsReview = false; revision++; return true;
        }
    };
}
module.exports = { createExportState, validCommand, actions, bindings, snapshotFields, clientFields };
