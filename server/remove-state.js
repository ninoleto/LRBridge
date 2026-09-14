"use strict";

const crypto = require("node:crypto");
const modes = ["heal_patchmatch", "heal", "clone"];
const tools = ["loupe", "crop", "dust", "redeye", "masking", "point_color", "local_point_color", "depth_refinement"];
const preferenceFields = ["newSpotType", "brushSize", "brushFeather", "useGenerativeAI", "detectObjects",
    "toolOverlay", "visualizeSpots", "visualizationThreshold"];
const bindingFields = ["expectedServerEpoch", "expectedRemoveRevision", "expectedActiveModule", "expectedSelectedPhotoUuid",
    "expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt"];
const commandFields = ["command", "operationId", "field", "value", "expectedValue", "expectedRemoveMode"].concat(bindingFields);
const inRange = (n, min) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= 100;
const fieldSupported = (field, mode, preferences) => modes.includes(mode) && preferenceFields.includes(field) &&
    (field !== "brushFeather" || mode !== "heal_patchmatch") &&
    (!["useGenerativeAI", "detectObjects"].includes(field) || mode === "heal_patchmatch") &&
    (field !== "visualizationThreshold" || !preferences || preferences.visualizeSpots === true);
function validValue(field, value) {
    if (field === "selectedTool") return value === "dust" || value === "loupe";
    if (["brushSize", "brushFeather", "visualizationThreshold"].includes(field)) return inRange(value, field === "brushSize" ? 1 : 0);
    if (["useGenerativeAI", "detectObjects", "visualizeSpots"].includes(field)) return typeof value === "boolean";
    if (field === "newSpotType") return modes.includes(value);
    if (field === "toolOverlay") return ["always", "auto", "selected", "never"].includes(value);
    return false;
}
const equalValue = (a, b) => typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= 0.000001 : a === b;
const sameBinding = (a, b) => a && b && bindingFields.every(key => a[key] === b[key]);
const repairToken = value => typeof value === "string" && /^\d{1,8}:[a-f0-9]{32,128}$/.test(value);
const fillChoices = ["remove", "heal", "clone", "generative_remove"];
const repairParameters = { selectedRepairOpacity: "opacity", selectedRepairFeather: "feather" };
const unit = value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const repairField = field => field === "selectedRepair" || field === "selectedRepairFill" || Object.hasOwn(repairParameters, field);
function selectedFill(repair) {
    if (!repair || !repair.available || !repair.selected) return null;
    if (repair.spotType === "heal" || repair.spotType === "clone") return repair.spotType;
    return repair.spotType === "heal_patchmatch" && typeof repair.useGenAI === "boolean" ? repair.useGenAI ? "generative_remove" : "remove" : null;
}
function sanitizeDiagnostics(input) {
    if (!input || input.reader !== "healing-focus-1") return null;
    const getters = {}, parameterNumbers = {};
    for (const [name, value] of Object.entries(input.getters || {}).slice(0, 20)) {
        if (!/^[a-zA-Z.]{1,60}$/.test(name) || !value || typeof value.ok !== "boolean") continue;
        getters[name] = { ok: value.ok, kind: String(value.kind || "unknown").slice(0, 16) };
        if (!value.ok) getters[name].error = String(value.error || "SDK error").slice(0, 200);
    }
    for (const [name, value] of Object.entries(input.parameterNumbers || {}).slice(0, 48)) {
        if (name.length <= 120 && (typeof value === "boolean" || typeof value === "number" && Number.isFinite(value))) parameterNumbers[name] = value;
    }
    return { reader: input.reader, foreground: "not_observed", getters, parameterNumbers, numbersTruncated: input.numbersTruncated === true,
        activeModule: typeof input.activeModule === "string" ? input.activeModule.slice(0, 32) : null,
        selectedPhotoUuid: typeof input.selectedPhotoUuid === "string" ? input.selectedPhotoUuid.slice(0, 256) : null,
        selectedTool: tools.includes(input.selectedTool) ? input.selectedTool : null,
        newSpotType: modes.includes(input.newSpotType) ? input.newSpotType : null,
        identityError: input.identityError ? String(input.identityError).slice(0, 200) : null };
}
function sanitizeRepair(input) {
    if (!input || typeof input.available !== "boolean") return { available: false };
    const evidence = {
        index: Number.isSafeInteger(input.index) ? input.index : null, spotType: modes.includes(input.spotType) ? input.spotType : null,
        count: Number.isSafeInteger(input.count) && input.count >= 0 ? input.count : null,
        useGenAI: typeof input.useGenAI === "boolean" ? input.useGenAI : null,
        paramsDiagnostic: typeof input.paramsDiagnostic === "string" ? input.paramsDiagnostic.slice(0, 2048) : null,
        diagnosticTruncated: input.diagnosticTruncated === true, diagnostics: sanitizeDiagnostics(input.diagnostics) };
    if (!input.available) return { ...evidence, available: false, reason: String(input.reason || "Selected repair unavailable.").slice(0, 160) };
    if (input.selected === false && Number.isSafeInteger(input.count) && input.count >= 0) return { ...evidence, available: true, selected: false, count: input.count };
    if (input.selected !== true || !Number.isSafeInteger(input.index) || !Number.isSafeInteger(input.count) ||
        input.index < 1 || input.index > input.count || !modes.includes(input.spotType) || !repairToken(input.token)) return { available: false };
    return { ...evidence, available: true, selected: true, index: input.index, count: input.count, spotType: input.spotType,
        opacity: unit(input.opacity) ? input.opacity : null, feather: unit(input.feather) ? input.feather : null,
        useGenAI: typeof input.useGenAI === "boolean" ? input.useGenAI : null, token: input.token,
        paramsDiagnostic: typeof input.paramsDiagnostic === "string" ? input.paramsDiagnostic.slice(0, 2048) : null,
        diagnosticTruncated: input.diagnosticTruncated === true };
}
function validCommand(c) {
    return c && Object.keys(c).length === commandFields.length && commandFields.every(key => Object.hasOwn(c, key)) &&
        /^rb-\d{1,15}$/.test(c.operationId) &&
        (c.command === "remove.repair.param.set" ? Object.hasOwn(repairParameters,c.field) && unit(c.value) && repairToken(c.expectedValue) && modes.includes(c.expectedRemoveMode) :
        c.command === "remove.repair.fill.set" ? c.field === "selectedRepairFill" && fillChoices.includes(c.value) &&
            repairToken(c.expectedValue) && modes.includes(c.expectedRemoveMode) :
        c.command === "remove.repair.action" ? c.field === "selectedRepair" && ["refresh", "delete"].includes(c.value) &&
            repairToken(c.expectedValue) && (c.expectedRemoveMode === null || modes.includes(c.expectedRemoveMode)) :
        c.command === "remove.panel.set" ? c.field === "selectedTool" && tools.includes(c.expectedValue) &&
            validValue(c.field, c.value) && c.value === (c.expectedValue === "dust" ? "loupe" : "dust") &&
            (c.expectedRemoveMode === null || modes.includes(c.expectedRemoveMode)) :
            c.command === "remove.brush.set" && fieldSupported(c.field, c.expectedRemoveMode) &&
            validValue(c.field, c.value) && validValue(c.field, c.expectedValue)) && c.expectedActiveModule === "develop" &&
        typeof c.expectedSelectedPhotoUuid === "string" && c.expectedSelectedPhotoUuid.length > 0 &&
        c.expectedSelectedPhotoUuid.length <= 256 && !/[\x00-\x1f\x7f]/.test(c.expectedSelectedPhotoUuid) &&
        typeof c.expectedServerEpoch === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(c.expectedServerEpoch) &&
        ["expectedRemoveRevision", "expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt"]
            .every(key => Number.isSafeInteger(c[key]) && c[key] >= 0);
}
function sanitize(input) {
    if (!input || typeof input.available !== "boolean" || input.selectedTool !== null && !tools.includes(input.selectedTool)) return null;
    const repair = sanitizeRepair(input.repair);
    const selectedValues = { selectedRepairFill: selectedFill(repair), ...Object.fromEntries(Object.entries(repairParameters).map(([field, key]) => [field, repair.available && repair.selected ? repair[key] : null])) };
    if (!input.available) return { available: false, selectedTool: input.selectedTool, repair, ...selectedValues,
        reason: typeof input.reason === "string" ? input.reason : "unavailable" };
    if (input.selectedTool !== "dust") return null;
    if (!modes.includes(input.newSpotType) || !inRange(input.brushSize, 1) || !inRange(input.brushFeather, 0) ||
        !inRange(input.visualizationThreshold, 0) || !["always", "auto", "selected", "never"].includes(input.toolOverlay) ||
        !["useGenerativeAI", "detectObjects", "visualizeSpots"].every(key => typeof input[key] === "boolean")) return null;
    return Object.assign({ available: true, selectedTool: input.selectedTool, repair, ...selectedValues, reason: null }, Object.fromEntries(preferenceFields.map(key => [key, input[key]])));
}
function createRemoveState(options) {
    const now = options.now || Date.now, epoch = options.serverEpoch || crypto.randomUUID();
    let revision = 1, counter = 0, contextKey = null, snapshot = { available: false, reason: "unavailable" };
    let query = null, pending = null, lastResult = null, capturedAt = null, lastRequestAt = 0;
    const context = () => options.getContext();
    const key = c => JSON.stringify([c.activeModule, c.selectedPhotoUuid, c.contextCounter, c.developCounter, c.contextChangedAt]);
    function sync() {
        const current = key(context());
        if (current !== contextKey) {
            contextKey = current; snapshot = { available: false, reason: "context_changed" }; capturedAt = null; query = null;
            if (pending) finish("stale", "Photo or Develop context changed.");
            else lastResult = null;
            revision++; lastRequestAt = 0;
        }
        if (pending && now() - pending.startedAt > 10000) finish("failed", "Lightroom did not confirm the Remove operation in time.");
        if (query && now() - query.startedAt > 5000) query = null;
    }
    function binding() {
        const c = context();
        return { expectedServerEpoch: epoch, expectedRemoveRevision: revision, expectedActiveModule: c.activeModule,
            expectedSelectedPhotoUuid: c.selectedPhotoUuid, expectedContextCounter: c.contextCounter,
            expectedDevelopCounter: c.developCounter, expectedContextChangedAt: c.contextChangedAt };
    }
    function finish(outcome, detail) {
        const c = pending.command;
        lastResult = { operationId: c.operationId, field: c.field, value: c.value, outcome, detail,
            targetRepairToken: repairField(c.field) ? c.expectedValue : null,
            resultRepairToken: outcome === "confirmed" && (c.field === "selectedRepairFill" || Object.hasOwn(repairParameters,c.field)) ? snapshot.repair.token : null };
        pending = null; query = null; revision++; lastRequestAt = 0;
    }
    function get(refresh) {
        sync();
        if (refresh && !pending && !query && now() - lastRequestAt >= 400 && context().activeModule === "develop" && context().selectedPhotoUuid) {
            query = { request: Object.assign({ command: "remove.query", requestId: "rq-" + (++counter) }, binding()), startedAt: now(), dispatched: false };
            lastRequestAt = now();
        }
        return Object.assign({}, snapshot, context(), { serverEpoch: epoch, revision, capturedAt,
            ageMs: capturedAt === null ? null : Math.max(0, now() - capturedAt),
            pendingOperation: pending ? { operationId: pending.command.operationId, field: pending.command.field, value: pending.command.value,
                targetRepairToken: repairField(pending.command.field) ? pending.command.expectedValue : null } : null,
            lastResult: lastResult && { ...lastResult } });
    }
    function validateBinding(input) {
        sync();
        return Boolean(pending && input.operationId === pending.command.operationId && sameBinding(input, pending.command));
    }
    return {
        get, sync,
        takeRequest() { sync(); if (!query || query.dispatched || pending) return null; query.dispatched = true; return { ...query.request }; },
        acceptQuery(input) {
            sync(); const next = sanitize(input);
            if (!query || !query.dispatched || pending || input.requestId !== query.request.requestId || !sameBinding(input, query.request) || !next) return false;
            query = null; capturedAt = now();
            // Diagnostic getter details cannot invalidate an otherwise unchanged editing baseline.
            const semantic = value => JSON.stringify(value, (key, item) => key === "diagnostics" ? undefined : item);
            if (semantic(snapshot) !== semantic(next)) revision++;
            snapshot = next; return true;
        },
        admit(field, value, client) {
            sync(); const c = context();
            // A mode request or Close revokes obsolete preference work before admitting the new operation.
            // The command worker remains serial; the old envelope cannot validate or settle the new operation.
            const panel = field === "selectedTool";
            const repair = repairField(field), fill = field === "selectedRepairFill", parameter = Object.hasOwn(repairParameters,field);
            const replacing = pending && pending.command.field !== "selectedTool" &&
                (panel && value === "loupe" || field === "newSpotType" && pending.command.field !== "newSpotType");
            const supported = repair ? snapshot.selectedTool === "dust" && snapshot.repair && snapshot.repair.selected === true &&
                snapshot.repair.available && client.repairToken === snapshot.repair.token &&
                (!(fill || parameter) || snapshot.available && (fill ? selectedFill(snapshot.repair) !== null : unit(snapshot[field]))) : panel ? tools.includes(snapshot.selectedTool) &&
                value === (snapshot.selectedTool === "dust" ? "loupe" : "dust") :
                snapshot.available && fieldSupported(field, snapshot.newSpotType, snapshot);
            if (pending && !replacing || !supported || capturedAt === null || now() - capturedAt > (replacing ? 10000 : 5000) ||
                !(parameter ? unit(value) : fill ? fillChoices.includes(value) : repair ? ["refresh", "delete"].includes(value) : validValue(field, value)) || client.serverEpoch !== epoch || client.stateRevision !== revision || client.mode !== (snapshot.newSpotType || null) ||
                ["selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt"].some(k => client[k] !== c[k])) return null;
            if (replacing) finish("stale", panel ? "Preference edit cancelled by Close Remove." : "Brush edit cancelled by a mode change.");
            const command = Object.assign({ command: parameter ? "remove.repair.param.set" : fill ? "remove.repair.fill.set" : repair ? "remove.repair.action" : panel ? "remove.panel.set" : "remove.brush.set", operationId: "rb-" + (++counter), field, value,
                expectedValue: repair ? snapshot.repair.token : snapshot[field], expectedRemoveMode: snapshot.newSpotType || null }, binding());
            if (!validCommand(command)) return null;
            pending = { command, startedAt: now(), admitted: false, dispatched: false }; query = null; revision++;
            return { ...command };
        },
        matches(command, phase) {
            if (!validateBinding(command) || !commandFields.every(k => command[k] === pending.command[k])) return false;
            if (phase === "admit") { if (pending.admitted) return false; pending.admitted = true; }
            if (phase === "dequeue") { if (!pending.admitted || pending.dispatched) return false; pending.dispatched = true; }
            return true;
        },
        validateBinding,
        reject(command, detail) { sync(); if (pending && pending.command.operationId === command.operationId) finish("stale", detail); },
        acceptResult(input) {
            if (!validateBinding(input) || !pending.dispatched || input.field !== pending.command.field || input.value !== pending.command.value ||
                !["confirmed", "failed", "stale", "requested"].includes(input.outcome)) return false;
            const next = sanitize(input); if (!next) return false;
            let outcome = input.outcome, detail = input.detail;
            const mode = pending.command.field === "newSpotType" ? pending.command.value : pending.command.expectedRemoveMode;
            const panel = pending.command.command === "remove.panel.set";
            const repair = repairField(pending.command.field), fill = pending.command.field === "selectedRepairFill", parameter = Object.hasOwn(repairParameters,pending.command.field);
            if (repair && input.targetRepairToken !== pending.command.expectedValue) return false;
            if (outcome === "requested" && !(pending.command.command === "remove.repair.action" && pending.command.value === "refresh")) return false;
            const confirmed = fill || parameter ? input.repairEditConfirmed === true && input.otherPreferencesPreserved === true && next.available && next.newSpotType === mode &&
                equalValue(next[pending.command.field],pending.command.value) && next.repair?.selected && next.repair.count === snapshot.repair.count && next.repair.index === snapshot.repair.index :
                repair ? pending.command.value === "delete" && input.repairRemovalConfirmed === true &&
                next.repair && next.repair.available && snapshot.repair && next.repair.count === snapshot.repair.count - 1 &&
                next.repair.token !== pending.command.expectedValue :
                equalValue(next[pending.command.field], pending.command.value) && (panel ? pending.command.value !== "dust" ||
                    next.available && next.newSpotType === "heal_patchmatch" : next.available && next.newSpotType === mode && input.otherPreferencesPreserved === true);
            if (outcome === "confirmed" && !confirmed) {
                outcome = "failed"; detail = fill || parameter ? "Lightroom did not confirm the selected repair edit and preservation of its context." :
                    repair ? "Fresh Lightroom inventory did not confirm deletion of the original repair and preservation of remaining repairs." :
                    panel ? "Lightroom did not confirm the selected tool." :
                    "Lightroom did not confirm the requested preference and preservation of other preferences.";
            }
            snapshot = next; capturedAt = now(); finish(outcome, detail); return true;
        }
    };
}
module.exports = { createRemoveState, preferenceFields, bindingFields, validCommand, validValue, fieldSupported, sanitize, sanitizeRepair, selectedFill, fillChoices, repairParameters, unit };
