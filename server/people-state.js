"use strict";
const crypto = require("node:crypto");

const actions = ["open", "detect", "remove"];
const fields = ["toolOpen", "count", "inventoryToken", "selectionReadable", "selectedIndex", "selectedToken",
    "navigationSupported", "detectSupported", "removeSupported"];
const bindings = ["expectedServerEpoch", "expectedPeopleRevision", "expectedActiveModule", "expectedSelectedPhotoUuid",
    "expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt"];
const commandFields = ["command", "operationId", "operationKind", "expectedToolOpen", "expectedPeopleCount",
    "expectedPeopleInventoryToken", ...bindings];
const contextFields = ["activeModule", "selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt"];
const token = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

function sanitize(input) {
    if (input.available === false) return { available: false, reason: String(input.reason || "Native People state unavailable.").slice(0, 200) };
    if (input.available !== true || typeof input.toolOpen !== "boolean" || !Number.isSafeInteger(input.count) || input.count < 0 ||
        !token(input.inventoryToken) || typeof input.selectionReadable !== "boolean" ||
        !["navigationSupported", "detectSupported", "removeSupported"].every(k => typeof input[k] === "boolean")) return null;
    const selectedIndex = input.selectedIndex === null ? null : input.selectedIndex;
    const selectedToken = input.selectedToken === null ? null : input.selectedToken;
    if (selectedIndex !== null && (!Number.isSafeInteger(selectedIndex) || selectedIndex < 0) ||
        selectedToken !== null && !token(selectedToken) || !input.selectionReadable && (selectedIndex !== null || selectedToken !== null) ||
        (selectedIndex === null) !== (selectedToken === null)) return null;
    return { available: true, ...Object.fromEntries(fields.map(k => [k, k === "selectedIndex" ? selectedIndex : k === "selectedToken" ? selectedToken : input[k]])) };
}

function validCommand(c) {
    return c && Object.keys(c).length === commandFields.length && commandFields.every(k => Object.hasOwn(c, k)) &&
        c.command === "people.action" && /^pp-\d{1,15}$/.test(c.operationId) && actions.includes(c.operationKind) &&
        typeof c.expectedToolOpen === "boolean" && Number.isSafeInteger(c.expectedPeopleCount) && c.expectedPeopleCount >= 0 &&
        token(c.expectedPeopleInventoryToken) && c.expectedActiveModule === "develop" &&
        typeof c.expectedSelectedPhotoUuid === "string" && c.expectedSelectedPhotoUuid.length > 0 &&
        typeof c.expectedServerEpoch === "string" && c.expectedServerEpoch.length > 0 &&
        ["expectedPeopleRevision", "expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt"]
            .every(k => Number.isSafeInteger(c[k]) && c[k] >= 0);
}

function createPeopleState(options) {
    const now = options.now || Date.now, epoch = options.serverEpoch || crypto.randomUUID();
    let revision = 1, serial = 0, contextKey = null, snapshot = { available: false }, capturedAt = null;
    let query = null, pending = null, lastResult = null, diagnosticResult = null, requestedAt = 0;
    let refreshRequired = true, snapshotSource = null;
    let controllerWorkflowOpen = false, diagnosticSerial = 0;
    const diagnosticEvents = [];
    const context = () => options.getContext();
    const sameBinding = (a, b) => bindings.every(k => a[k] === b[k]);

    function record(stage, data = {}) {
        const event = { sequence: ++diagnosticSerial, at: now(), stage, revision,
            operationId: data.operationId || data.command && data.command.operationId || null,
            operationKind: data.operationKind || data.command && data.command.operationKind || null };
        for (const key of ["outcome", "reason", "phase", "callbackCompleted", "invoked", "inventoryChanged",
            "clientStateRevision", "contextCounter", "developCounter", "selectedPhotoUuid", "snapshotSource",
            "snapshotCapturedAt", "snapshotAgeMs", "inventoryToken", "count"]) {
            if (data[key] !== undefined) event[key] = typeof data[key] === "string" ? data[key].slice(0, 300) : data[key];
        }
        if (data.command) {
            event.expectedPeopleInventoryToken = data.command.expectedPeopleInventoryToken;
            event.expectedPeopleCount = data.command.expectedPeopleCount;
        }
        diagnosticEvents.push(event); if (diagnosticEvents.length > 64) diagnosticEvents.shift();
    }

    function finish(outcome, detail, data) {
        const userDetail = /People inventory token mismatch|People count expected/.test(detail) ?
            "People detections changed. Refreshing; review them before removal." : detail;
        lastResult = { operationId: pending.command.operationId, operationKind: pending.command.operationKind,
            outcome, detail: userDetail, callbackCompleted: data.callbackCompleted, invoked: data.invoked,
            inventoryChanged: data.inventoryChanged };
        diagnosticResult = { ...lastResult, detail };
        record("finished", { command: pending.command, outcome, reason: detail, callbackCompleted: data.callbackCompleted,
            invoked: data.invoked, inventoryChanged: data.inventoryChanged });
        pending = query = null; revision++; requestedAt = 0; refreshRequired = true;
        if (options.onChanged) options.onChanged();
    }
    function sync() {
        const next = JSON.stringify(contextFields.map(k => context()[k]));
        if (contextKey !== next) {
            record("context_changed", { reason: "Photo or Develop context changed.", contextCounter: context().contextCounter,
                developCounter: context().developCounter, selectedPhotoUuid: context().selectedPhotoUuid });
            contextKey = next; snapshot = { available: false, reason: "Photo or Develop context changed." };
            capturedAt = null; query = null; controllerWorkflowOpen = false; refreshRequired = true; snapshotSource = null;
            if (pending) finish("stale", "Photo or Develop context changed; earlier People request cancelled.", pending);
            else lastResult = diagnosticResult = null;
            revision++; requestedAt = 0;
        }
        if (pending && now() - pending.started > (pending.command.operationKind === "remove" ? 120000 : 10000)) {
            finish("failed", pending.command.operationKind === "remove" ?
                "People removal timed out; callback/result unconfirmed. No retry was sent." :
                "People request timed out; delivery unconfirmed. No retry was sent.", pending);
            snapshot = { available: false, reason: "Waiting for fresh People state after timeout." }; capturedAt = null;
        }
        if (query && now() - query.started > 5000) query = null;
    }
    function binding() {
        const c = context();
        return { expectedServerEpoch: epoch, expectedPeopleRevision: revision, expectedActiveModule: c.activeModule,
            expectedSelectedPhotoUuid: c.selectedPhotoUuid, expectedContextCounter: c.contextCounter,
            expectedDevelopCounter: c.developCounter, expectedContextChangedAt: c.contextChangedAt };
    }
    function validateBinding(c) {
        sync(); return Boolean(pending && c.operationId === pending.command.operationId && sameBinding(c, pending.command));
    }
    function removalReason() {
        if (refreshRequired) return "Waiting for updated People detections from Lightroom.";
        if (!snapshot.available || !snapshot.toolOpen) return "Open People in Lightroom first.";
        if (capturedAt === null || now() - capturedAt > 5000) return "Waiting for fresh People feedback.";
        if (snapshot.count < 1) return "No People targets reported yet. Review detection in Lightroom.";
        return null;
    }
    function get(refresh) {
        sync();
        if (refresh && !pending && !query && now() - requestedAt >= 400 && context().activeModule === "develop" && context().selectedPhotoUuid) {
            query = { request: { command: "people.query", requestId: "pq-" + (++serial), ...binding() }, started: now(), dispatched: false };
            requestedAt = now();
        }
        return { ...snapshot, ...context(), serverEpoch: epoch, revision, capturedAt, controllerWorkflowOpen,
            removalAvailable: !pending && removalReason() === null, removalReason: removalReason(), refreshRequired,
            ageMs: capturedAt === null ? null : Math.max(0, now() - capturedAt),
            pendingOperation: pending ? { operationId: pending.command.operationId, operationKind: pending.command.operationKind,
                phase: pending.phase, callbackCompleted: pending.callbackCompleted, invoked: pending.invoked } : null,
            lastResult };
    }

    return { get, validateBinding,
        takeRequest() { sync(); if (!query || query.dispatched || pending) return null; query.dispatched = true; return { ...query.request }; },
        acceptQuery(input) {
            sync(); const next = sanitize(input);
            if (!query || !query.dispatched || pending || query.request.requestId !== input.requestId || !sameBinding(input, query.request) || !next) return false;
            snapshotSource = query.request.requestId;
            query = null; capturedAt = now(); if (JSON.stringify(next) !== JSON.stringify(snapshot) || refreshRequired) revision++;
            refreshRequired = false;
            snapshot = next;
            if (controllerWorkflowOpen && (!next.available || !next.toolOpen)) {
                controllerWorkflowOpen = false; record("workflow_cleared", { reason: "Remove tool is no longer open." });
            }
            return true;
        },
        admitDetailed(operationKind, client) {
            sync();
            const supported = operationKind === "open" ? snapshot.navigationSupported :
                operationKind === "detect" ? snapshot.detectSupported : snapshot.removeSupported;
            let error = null;
            if (!actions.includes(operationKind)) error = "Unsupported People action.";
            else if (pending) error = "A People request is already in progress.";
            else if (!snapshot.available) error = snapshot.reason || "Native People state is unavailable.";
            else if (!supported) error = operationKind === "remove" ? "People removal is unavailable in this Lightroom SDK." :
                operationKind === "detect" ? "People detection is unavailable in this Lightroom SDK." : "People navigation is unavailable in this Lightroom SDK.";
            else if (operationKind !== "open" && !snapshot.toolOpen) error = "Open the Remove tool before using People.";
            else if (capturedAt === null || now() - capturedAt > 5000) error = "People state is stale; wait for fresh Lightroom feedback.";
            else if (client.serverEpoch !== epoch || client.stateRevision !== revision ||
                contextFields.some(k => k !== "activeModule" && client[k] !== context()[k])) error = "Photo or Develop context changed; refresh People controls.";
            else if (operationKind === "remove") error = removalReason();
            if (error) {
                record("admission_rejected", { operationKind, reason: error, clientStateRevision: client.stateRevision,
                    contextCounter: client.contextCounter, developCounter: client.developCounter, selectedPhotoUuid: client.selectedPhotoUuid });
                if (!pending) { refreshRequired = true; get(true); }
                return { command: null, error };
            }
            const command = { command: "people.action", operationId: "pp-" + (++serial), operationKind,
                expectedToolOpen: snapshot.toolOpen, expectedPeopleCount: snapshot.count,
                expectedPeopleInventoryToken: snapshot.inventoryToken, ...binding() };
            if (!validCommand(command)) return { command: null, error: "People request was invalid." };
            pending = { command, started: now(), admitted: false, dispatched: false, phase: "queued",
                callbackCompleted: false, invoked: false, inventoryChanged: false };
            query = null; revision++;
            record("admitted", { command, phase: "queued", clientStateRevision: client.stateRevision,
                contextCounter: client.contextCounter, developCounter: client.developCounter, selectedPhotoUuid: client.selectedPhotoUuid,
                snapshotSource, snapshotCapturedAt: capturedAt, snapshotAgeMs: now() - capturedAt });
            return { command: { ...command }, error: null };
        },
        admit(operationKind, client) { return this.admitDetailed(operationKind, client).command; },
        matches(command, phase) {
            if (!validateBinding(command) || !commandFields.every(k => command[k] === pending.command[k])) return false;
            if (phase === "admit") { if (pending.admitted) return false; pending.admitted = true; record("queue_admitted", { command, phase }); }
            if (phase === "dequeue") { if (!pending.admitted || pending.dispatched) return false; pending.dispatched = true; record("dequeued", { command, phase }); }
            return true;
        },
        reject(command, detail) { if (validateBinding(command)) { record("queue_rejected", { command, reason: detail }); finish("stale", detail, pending); } },
        acceptResult(input) {
            let rejection = null;
            if (!validateBinding(input)) rejection = "Operation binding is no longer current.";
            else if (!pending.dispatched) rejection = "Operation was not dequeued.";
            else if (input.operationKind !== pending.command.operationKind) rejection = "Operation kind does not match.";
            else if (!["requested", "confirmed", "failed", "stale"].includes(input.outcome)) rejection = "Outcome is invalid.";
            else if (!["callbackCompleted", "invoked", "inventoryChanged", "manualRepairsPreserved", "removePreferencesPreserved", "reflectionsPreserved"]
                .every(k => typeof input[k] === "boolean")) rejection = "Result flags are invalid.";
            if (rejection) { record("result_rejected", { operationId: input.operationId, operationKind: input.operationKind,
                outcome: input.outcome, reason: rejection, callbackCompleted: input.callbackCompleted, invoked: input.invoked,
                inventoryChanged: input.inventoryChanged }); return false; }
            const next = sanitize(input);
            if (!next || pending.callbackCompleted && !input.callbackCompleted || pending.invoked && !input.invoked) {
                record("result_rejected", { operationId: input.operationId, operationKind: input.operationKind, outcome: input.outcome,
                    reason: !next ? "Native snapshot is invalid." : "Result flags moved backwards.", callbackCompleted: input.callbackCompleted,
                    invoked: input.invoked, inventoryChanged: input.inventoryChanged }); return false;
            }
            snapshot = next; capturedAt = now(); snapshotSource = input.operationId; pending.callbackCompleted = input.callbackCompleted;
            pending.invoked = input.invoked; pending.inventoryChanged = input.inventoryChanged;
            record("result_accepted", { command: pending.command, outcome: input.outcome, callbackCompleted: input.callbackCompleted,
                invoked: input.invoked, inventoryChanged: input.inventoryChanged });
            if (input.outcome === "requested" && pending.command.operationKind === "remove") {
                pending.phase = "requested"; revision++; if (options.onChanged) options.onChanged(); return true;
            }
            let outcome = input.outcome, detail = input.detail;
            if (pending.command.operationKind === "remove" && outcome === "confirmed" &&
                (!input.callbackCompleted || !input.invoked || !input.manualRepairsPreserved || !input.removePreferencesPreserved || !input.reflectionsPreserved)) {
                outcome = "failed"; detail = "People removal lacks callback or preservation confirmation.";
            }
            if (pending.command.operationKind !== "remove" && outcome === "requested" &&
                (!input.invoked || !input.manualRepairsPreserved || !input.removePreferencesPreserved || !input.reflectionsPreserved)) {
                outcome = "failed"; detail = "People request delivery or preservation was not confirmed.";
            }
            if (pending.command.operationKind === "open" && outcome === "requested" && input.invoked) controllerWorkflowOpen = true;
            finish(outcome, detail, input); return true;
        },
        diagnostics() { sync(); return { serverEpoch: epoch, revision, controllerWorkflowOpen,
            pendingOperation: pending ? { operationId: pending.command.operationId, operationKind: pending.command.operationKind,
                phase: pending.phase, callbackCompleted: pending.callbackCompleted, invoked: pending.invoked } : null,
            lastResult: diagnosticResult ? { ...diagnosticResult } : null, snapshotSource, capturedAt,
            count: snapshot.count, inventoryToken: snapshot.inventoryToken, refreshRequired,
            events: diagnosticEvents.map(event => ({ ...event })) }; },
        recordActionRequest(operationKind, client) { record("action_received", { operationKind, clientStateRevision: client.stateRevision,
            contextCounter: client.contextCounter, developCounter: client.developCounter, selectedPhotoUuid: client.selectedPhotoUuid }); }
    };
}

module.exports = { createPeopleState, validCommand, sanitize, actions, fields, bindings };
