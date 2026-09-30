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
    if (field === "selectedSelection") return ["cancel", "remove", "add", "subtract"].includes(value);
    if (field === "dustApply") return typeof value === "boolean";
    if (field === "dustClose") return value === "manualRemove";
    if (field === "selectedTool") return value === "dust" || value === "loupe";
    if (["brushSize", "brushFeather", "visualizationThreshold"].includes(field)) return inRange(value, field === "brushSize" ? 1 : 0);
    if (["useGenerativeAI", "detectObjects", "visualizeSpots"].includes(field)) return typeof value === "boolean";
    if (field === "newSpotType") return modes.includes(value);
    if (field === "toolOverlay") return ["always", "auto", "selected", "never"].includes(value);
    return false;
}
const equalValue = (a, b) => typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= 0.000001 : a === b;
const sameBinding = (a, b) => a && b && bindingFields.every(key => a[key] === b[key]);
const selectionToken = value => typeof value === "string" && /^\d+(?::\d+){7}$/.test(value);
const refinementAction = value => value === "add" || value === "subtract";
const refinementToken = value => typeof value === "string" && /^\d+(?::\d+){9}$/.test(value);
function sanitizeSelection(input) {
    if (!input || input.available !== true || typeof input.active !== "boolean" || !selectionToken(input.token) ||
        !["canCancel", "canRemove", "sizeAvailable"].every(k => typeof input[k] === "boolean"))
        return { available: false, reason: String(input?.reason || "Native selection feedback is unavailable or invalid.").slice(0, 240) };
    return { available: true, active: input.active, token: input.token, mode: null, canSetMode: false,
        canCancel: input.active && input.canCancel, canRemove: input.active && input.canRemove,
        sizeAvailable: input.active && input.sizeAvailable,
        refinementToken: refinementToken(input.refinementToken) && input.refinementToken.startsWith(input.token + ":") ? input.refinementToken : null,
        canAdd: input.active && refinementToken(input.refinementToken) && input.refinementToken.startsWith(input.token + ":") && input.canAdd === true,
        canSubtract: input.active && refinementToken(input.refinementToken) && input.refinementToken.startsWith(input.token + ":") && input.canSubtract === true,
        refinementReason: input.canAdd === true && input.canSubtract === true && refinementToken(input.refinementToken) && input.refinementToken.startsWith(input.token + ":") ? null :
            String(input.refinementReason || "Add/Subtract label identification is unavailable.").slice(0, 240) };
}
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
        (c.command === "remove.selection.action" ? c.field === "selectedSelection" && validValue(c.field, c.value) &&
            (refinementAction(c.value) ? refinementToken(c.expectedValue) : selectionToken(c.expectedValue)) && c.expectedRemoveMode === "heal_patchmatch" :
        ["remove.dust.on", "remove.dust.off", "remove.dust.close"].includes(c.command) ?
            (c.command === "remove.dust.close" ? c.field === "dustClose" && c.value === "manualRemove" :
                c.field === "dustApply" && c.value === (c.command === "remove.dust.on")) &&
            typeof c.expectedValue === "string" && /^[a-f0-9]{32,128}$/.test(c.expectedValue) && modes.includes(c.expectedRemoveMode) :
        c.command === "remove.repair.param.set" ? Object.hasOwn(repairParameters,c.field) && unit(c.value) && repairToken(c.expectedValue) && modes.includes(c.expectedRemoveMode) :
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
    const d = input.dust;
    const dust = d && typeof d.available === "boolean" && (!d.available || typeof d.applied === "boolean") && typeof d.canDisable === "boolean" &&
        typeof d.token === "string" && /^[a-f0-9]{32,128}$/.test(d.token) ?
        { available: d.available, applied: d.available ? d.applied : null, canDisable: d.canDisable, token: d.token,
            canEnable: d.canEnable === true, canRequestClose: d.canRequestClose === true, panelStateAvailable: false,
            preservationConfirmed: d.preservationConfirmed === true, reason: String(d.reason || "").slice(0, 200),
            commandReason: String(d.commandReason || "").slice(0, 200) } :
        { available: false, reason: String(d?.reason || "Dust state unavailable.").slice(0, 200) };
    if (dust.available) dust.completionConfirmed = d.completionConfirmed === true;
    const selectedValues = { dust, dustApply: dust.available ? dust.applied : null,
        selectedRepairFill: selectedFill(repair), ...Object.fromEntries(Object.entries(repairParameters).map(([field, key]) => [field, repair.available && repair.selected ? repair[key] : null])) };
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
    let selection = { available: false }, selectionAt = null, selectionRead = null;
    let selectionDiagnostics = null;
    let submittedSelection = null;
    const refinementEvents = [];
    let refinementIdentification = null;
    function traceRefinement(event, command, data = {}) {
        if (command?.field !== "selectedSelection" || !refinementAction(command.value)) return;
        refinementEvents.push({ at: now(), event, operationId: command.operationId || null, value: command.value,
            token: command.expectedValue || command.selectionToken || null,
            contextCounter: command.expectedContextCounter ?? command.contextCounter ?? null,
            developCounter: command.expectedDevelopCounter ?? command.developCounter ?? null,
            expectedRemoveRevision: command.expectedRemoveRevision ?? command.stateRevision ?? null,
            currentContextCounter: context().contextCounter, currentDevelopCounter: context().developCounter,
            currentOperationId: pending?.command.operationId || null, ...data });
        if (refinementEvents.length > 100) refinementEvents.shift();
    }
    const context = () => options.getContext();
    const key = c => JSON.stringify([c.activeModule, c.selectedPhotoUuid, c.contextCounter, c.developCounter, c.contextChangedAt]);
    function sync() {
        const current = key(context());
        if (current !== contextKey) {
            selection = { available: false }; selectionAt = null; selectionRead = null; submittedSelection = null;
            selectionDiagnostics = null;
            refinementIdentification = null;
            contextKey = current; snapshot = { available: false, reason: "context_changed" }; capturedAt = null; query = null;
            if (pending) finish("stale", "Photo or Develop context changed.");
            else lastResult = null;
            revision++; lastRequestAt = 0;
        }
        if (pending && now() - pending.startedAt > (pending.command.command === "remove.selection.action" && refinementAction(pending.command.value) ? 15000 : ["remove.dust.on", "remove.selection.action"].includes(pending.command.command) ? 120000 : 10000))
            finish("failed", "Lightroom did not confirm the Remove operation in time; no automatic retry.");
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
        traceRefinement("settled", c, { outcome, detail });
        if (pending.selectionChallenge) pending.selectionChallenge.resolve(false);
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
            selection: { ...selection, canRemove: selection.canRemove === true && submittedSelection !== selection.token,
                read: { ...selectionDiagnostics, inFlight: Boolean(selectionRead),
                    inFlightAgeMs: selectionRead ? Math.max(0, now() - selectionRead.startedAt) : null },
                ageMs: selectionAt === null ? null : Math.max(0, now() - selectionAt) },
            ageMs: capturedAt === null ? null : Math.max(0, now() - capturedAt),
            pendingOperation: pending ? { operationId: pending.command.operationId, field: pending.command.field, value: pending.command.value,
                targetRepairToken: repairField(pending.command.field) ? pending.command.expectedValue : null } : null,
            lastResult: lastResult && { ...lastResult } });
    }
    function validateBinding(input) {
        sync();
        return Boolean(pending && input.operationId === pending.command.operationId && sameBinding(input, pending.command));
    }
    async function refreshSelection(force = true) {
        sync(); const base = contextKey;
        if (selectionRead?.base === base) return selectionRead.promise;
        // SDK brush writes (including Size gestures) do not own the native reader.
        if (!force && (pending && pending.command.command !== "remove.brush.set" || selectionAt !== null && now() - selectionAt < 750)) return;
        const read = { base, startedAt: now() };
        read.promise = (async () => {
            await Promise.resolve();
            let next = { available: false, reason: "Remove selection context is unavailable." }, timing = null, failure = null, identification = null;
            try {
                if (context().activeModule === "develop" && context().selectedPhotoUuid && snapshot.selectedTool === "dust" && options.nativeBackend?.readRemoveSelection) {
                    options.beforeNativeObservation?.();
                    const result = await options.nativeBackend.readRemoveSelection();
                    next = sanitizeSelection(result); timing = result?.readTiming;
                    identification = result?.refinementDiagnostics || null;
                }
            } catch (error) {
                failure = String(error?.message || "Native selection read failed.").slice(0, 240);
                next = { available: false, reason: failure }; timing = error?.readTiming;
            }
            sync();
            if (contextKey !== base || selectionRead !== read) return;
            refinementIdentification = identification;
            selectionDiagnostics = { startedAt: read.startedAt, completedAt: now(), durationMs: Math.max(0, now() - read.startedAt),
                queueMs: Number.isFinite(timing?.queueMs) ? timing.queueMs : null,
                executionMs: Number.isFinite(timing?.executionMs) ? timing.executionMs : null, failure };
            if (JSON.stringify(selection) !== JSON.stringify(next)) revision++;
            if (next.available && (!next.active || next.token !== submittedSelection)) submittedSelection = null;
            selection = next; selectionAt = now();
        })().finally(() => { if (selectionRead === read) selectionRead = null; });
        selectionRead = read;
        return read.promise;
    }
    return {
        get, sync, refreshSelection,
        traceRefinement,
        refinementDiagnostics() { return { serverEpoch: epoch, identification: refinementIdentification, events: refinementEvents.slice() }; },
        async challengeSelection(input) {
            if (!validateBinding(input) || !pending.nativeInvoked || pending.command.command !== "remove.selection.action" || pending.selectionChallenge) return false;
            const owner = pending;
            traceRefinement("sdk_guard_requested", owner.command);
            const accepted = await new Promise(resolve => {
                const timer = setTimeout(() => { if (owner.selectionChallenge === challenge) owner.selectionChallenge = null; resolve(false); }, refinementAction(owner.command.value) ? 6000 : 1500);
                const challenge = { resolve(valid) { clearTimeout(timer); if (owner.selectionChallenge === challenge) owner.selectionChallenge = null; resolve(valid); } };
                owner.selectionChallenge = challenge;
            });
            const valid = accepted && pending === owner && validateBinding(input);
            traceRefinement("sdk_guard_completed", owner.command, { valid });
            return valid;
        },
        selectionGuard(input, phase, valid) {
            if (!validateBinding(input) || pending.command.command !== "remove.selection.action") return false;
            if (phase === "poll") return Boolean(pending.selectionChallenge);
            if (phase !== "confirm" || typeof valid !== "boolean" || !pending.selectionChallenge) return false;
            traceRefinement("sdk_guard_reply", pending.command, { valid });
            pending.selectionChallenge.resolve(valid);
            return true;
        },
        async invokeSelection(input) {
            if (!validateBinding(input) || !pending.dispatched || pending.command.command !== "remove.selection.action" || refinementAction(pending.command.value) || pending.nativeInvoked) return false;
            const owner = pending;
            owner.nativeInvoked = true; // Claim once before any asynchronous work; never retry uncertain dispatch.
            if (owner.command.value === "remove") submittedSelection = owner.command.expectedValue;
            const url = new URL("http://127.0.0.1:17891/remove/selection-validate");
            for (const k of ["operationId", ...bindingFields]) url.searchParams.set(k, owner.command[k]);
            try {
                const result = await options.nativeBackend.actRemoveSelection(owner.command.value, owner.command.expectedValue, url.href);
                owner.nativeSent = pending === owner && validateBinding(input) && result?.sent === true;
                return owner.nativeSent;
            } catch (_) { return false; }
        },
        invokeRefinement(input) {
            if (!validateBinding(input) || !pending.dispatched || pending.command.command !== "remove.selection.action" || !refinementAction(pending.command.value) || pending.nativeInvoked) return false;
            const owner = pending; owner.nativeInvoked = true;
            traceRefinement("sdk_invoke", owner.command);
            const url = new URL("http://127.0.0.1:17891/remove/selection-validate");
            for (const k of ["operationId", ...bindingFields]) url.searchParams.set(k, owner.command[k]);
            // Return the queue acknowledgement before the SDK must answer its guard.
            // Only this promise invokes native input, once, on the existing action queue.
            void (async () => {
                try {
                    const result = await options.nativeBackend.actRemoveSelectionRefinement(owner.command.value, owner.command.expectedValue, url.href);
                    traceRefinement("native_return", owner.command, { sent: result?.sent === true, inputStatus: result?.inputStatus || "unknown",
                        stage: result?.stage || null, reason: result?.reason || null, diagnostics: result?.diagnostics || null });
                    owner.nativeSent = result?.sent === true;
                    owner.nativeInputStatus = result?.inputStatus || "unknown";
                    owner.nativeReason = result?.reason || null;
                    await refreshSelection();
                } catch (error) { owner.nativeInputStatus = "unknown"; owner.nativeReason = String(error?.message || "Native dispatch failed.").slice(0, 240);
                    traceRefinement("native_error", owner.command, { reason: owner.nativeReason }); }
                finally { owner.nativeDone = true; }
            })();
            return true;
        },
        refinementStatus(input) {
            if (!validateBinding(input) || pending.command.command !== "remove.selection.action" || !refinementAction(pending.command.value)) return null;
            return { requested: Boolean(pending.selectionChallenge), complete: pending.nativeDone === true,
                sent: pending.nativeSent === true, inputStatus: pending.nativeInputStatus || "unknown", reason: pending.nativeReason || null };
        },
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
            const selecting = field === "selectedSelection";
            const dust = field === "dustApply" || field === "dustClose";
            const repair = repairField(field), fill = field === "selectedRepairFill", parameter = Object.hasOwn(repairParameters,field);
            const replacing = pending && pending.command.field !== "selectedTool" &&
                (panel && value === "loupe" || field === "newSpotType" && pending.command.field !== "newSpotType");
            const supported = selecting ? snapshot.available && snapshot.newSpotType === "heal_patchmatch" && selection.available && selection.active &&
                selectionAt !== null && now() - selectionAt < 2500 && client.selectionToken === (refinementAction(value) ? selection.refinementToken : selection.token) &&
                (value === "add" ? selection.canAdd : value === "subtract" ? selection.canSubtract : value === "cancel" ? selection.canCancel : selection.canRemove && submittedSelection !== selection.token) : dust ? snapshot.available && snapshot.dust?.token && (field === "dustClose" ?
                snapshot.dust.canRequestClose :
                (value ? snapshot.dust.canEnable : snapshot.dust.canDisable)) :
                repair ? snapshot.selectedTool === "dust" && snapshot.repair && snapshot.repair.selected === true &&
                snapshot.repair.available && client.repairToken === snapshot.repair.token &&
                (!(fill || parameter) || snapshot.available && (fill ? selectedFill(snapshot.repair) !== null : unit(snapshot[field]))) : panel ? tools.includes(snapshot.selectedTool) &&
                value === (snapshot.selectedTool === "dust" ? "loupe" : "dust") :
                snapshot.available && fieldSupported(field, snapshot.newSpotType, snapshot);
            if (pending && !replacing || !supported || capturedAt === null || now() - capturedAt > (replacing ? 10000 : 5000) ||
                !(parameter ? unit(value) : fill ? fillChoices.includes(value) : repair ? ["refresh", "delete"].includes(value) : validValue(field, value)) || client.serverEpoch !== epoch || client.stateRevision !== revision || client.mode !== (snapshot.newSpotType || null) ||
                ["selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt"].some(k => client[k] !== c[k])) return null;
            if (replacing) finish("stale", panel ? "Preference edit cancelled by Close Remove." : "Brush edit cancelled by a mode change.");
            const command = Object.assign({ command: selecting ? "remove.selection.action" : dust ? field === "dustClose" ? "remove.dust.close" : value ? "remove.dust.on" : "remove.dust.off" : parameter ? "remove.repair.param.set" : fill ? "remove.repair.fill.set" : repair ? "remove.repair.action" : panel ? "remove.panel.set" : "remove.brush.set", operationId: "rb-" + (++counter), field, value,
                expectedValue: selecting ? refinementAction(value) ? selection.refinementToken : selection.token : dust ? snapshot.dust.token : repair ? snapshot.repair.token : snapshot[field], expectedRemoveMode: snapshot.newSpotType || null }, binding());
            if (!validCommand(command)) return null;
            pending = { command, startedAt: now(), admitted: false, dispatched: false }; query = null; revision++;
            traceRefinement("admitted", command);
            return { ...command };
        },
        matches(command, phase) {
            if (!validateBinding(command) || !commandFields.every(k => command[k] === pending.command[k])) return false;
            if (phase === "admit") { if (pending.admitted) return false; pending.admitted = true; }
            if (phase === "dequeue") { if (!pending.admitted || pending.dispatched) return false; pending.dispatched = true; traceRefinement("dequeued", command); }
            return true;
        },
        validateBinding,
        reject(command, detail) { sync(); if (pending && pending.command.operationId === command.operationId) finish("stale", detail); },
        acceptResult(input) {
            traceRefinement("sdk_result_received", input, { outcome: input.outcome });
            if (!validateBinding(input) || !pending.dispatched || input.field !== pending.command.field || input.value !== pending.command.value ||
                !["confirmed", "failed", "stale", "requested", "not_applied", "unknown"].includes(input.outcome)) {
                traceRefinement("sdk_result_rejected", input, { reason: "Operation/context binding or result fields do not match." }); return false;
            }
            const next = sanitize(input); if (!next) return false;
            let outcome = input.outcome, detail = input.detail;
            const mode = pending.command.field === "newSpotType" ? pending.command.value : pending.command.expectedRemoveMode;
            const panel = pending.command.command === "remove.panel.set";
            const repair = repairField(pending.command.field), fill = pending.command.field === "selectedRepairFill", parameter = Object.hasOwn(repairParameters,pending.command.field);
            if (repair && input.targetRepairToken !== pending.command.expectedValue) return false;
            const dustClose = pending.command.command === "remove.dust.close";
            const dustApply = ["remove.dust.on", "remove.dust.off"].includes(pending.command.command);
            const selecting = pending.command.command === "remove.selection.action";
            const refining = selecting && refinementAction(pending.command.value);
            if (refining) {
                if (outcome === "not_applied") return false;
                if (pending.nativeInputStatus === "not_sent") {
                    outcome = "failed"; detail = "Not sent: " + String(pending.nativeReason || "Native target or SDK validation was rejected.").slice(0, 260);
                } else if (outcome === "confirmed" || outcome === "requested") {
                    const preserved = pending.nativeDone && pending.nativeSent && input.otherPreferencesPreserved === true && next.available && next.newSpotType === mode;
                    outcome = preserved ? "requested" : "unknown";
                    detail = preserved ? (pending.command.value === "add" ? "Add" : "Subtract") + " request sent. Active refinement mode is not exposed." : "Refinement result is unknown. Check Lightroom; no automatic retry.";
                }
                snapshot = next; capturedAt = now(); finish(outcome, detail); return true;
            }
            if (outcome === "unknown" && !(dustApply || selecting) || outcome === "not_applied" && pending.command.command !== "remove.dust.on") return false;
            if (outcome === "not_applied" && !(next.available && next.dust?.available && next.dust.applied === false &&
                next.dust.token === pending.command.expectedValue && next.dust.completionConfirmed && next.dust.preservationConfirmed &&
                input.otherPreferencesPreserved === true && next.newSpotType === mode)) {
                outcome = "unknown"; detail = "Dust result is unknown: completed, unapplied state and preservation were not confirmed. Check Lightroom.";
            }
            if (outcome === "requested" && !(dustClose || pending.command.command === "remove.repair.action" && pending.command.value === "refresh")) return false;
            if (dustClose && outcome === "requested" && !(next.available && next.dust?.available && next.dust.applied === snapshot.dust.applied &&
                next.dust.token === pending.command.expectedValue && next.dust.preservationConfirmed && input.otherPreferencesPreserved === true && next.newSpotType === mode)) {
                outcome = "failed"; detail = "Native navigation did not preserve Dust treatment and other edits.";
            }
            const confirmed = selecting ? pending.nativeSent === true && input.selectionCompletionConfirmed === true && input.otherPreferencesPreserved === true &&
                selection.available && selection.active === false && selection.token === pending.command.expectedValue && selectionAt !== null && now() - selectionAt < 2500 && next.available && next.newSpotType === mode :
                dustClose ? false : ["remove.dust.off", "remove.dust.on"].includes(pending.command.command) ? next.available && next.dust?.available &&
                next.dust.applied === pending.command.value && next.dust.preservationConfirmed === true && input.otherPreferencesPreserved === true && next.newSpotType === mode :
                fill || parameter ? input.repairEditConfirmed === true && input.otherPreferencesPreserved === true && next.available && next.newSpotType === mode &&
                equalValue(next[pending.command.field],pending.command.value) && next.repair?.selected && next.repair.count === snapshot.repair.count && next.repair.index === snapshot.repair.index :
                repair ? pending.command.value === "delete" && input.repairRemovalConfirmed === true &&
                next.repair && next.repair.available && snapshot.repair && next.repair.count === snapshot.repair.count - 1 &&
                next.repair.token !== pending.command.expectedValue :
                equalValue(next[pending.command.field], pending.command.value) && (panel ? pending.command.value !== "dust" ||
                    next.available && next.newSpotType === "heal_patchmatch" : next.available && next.newSpotType === mode && input.otherPreferencesPreserved === true);
            if (outcome === "confirmed" && !confirmed) {
                outcome = "failed"; detail = dustClose ? "Dust subsection state is not exposed; Close cannot be reported as confirmed." :
                    fill || parameter ? "Lightroom did not confirm the selected repair edit and preservation of its context." :
                    repair ? "Fresh Lightroom inventory did not confirm deletion of the original repair and preservation of remaining repairs." :
                    panel ? "Lightroom did not confirm the selected tool." :
                    "Lightroom did not confirm the requested preference and preservation of other preferences.";
            }
            snapshot = next; capturedAt = now(); finish(outcome, detail); return true;
        }
    };
}
module.exports = { createRemoveState, preferenceFields, bindingFields, validCommand, validValue, fieldSupported, sanitize, sanitizeRepair, selectedFill, fillChoices, repairParameters, unit, sanitizeSelection };
