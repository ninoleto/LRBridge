"use strict";

const crypto = require("crypto");
const maskingCorrections = require("../app/controller-masking-corrections");
const pointColorDefinition = require("./point-color-state");
const pointCurveDefinition = require("./point-curve-state");
const localPresets = require("./local-adjustment-presets");

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_MASK_GROUPS = 512;
const MAX_MASK_TOOLS_PER_GROUP = 2048;
const SNAPSHOT_FRESH_MS = 3000;
const QUERY_RETRY_MS = 2500;
const OPERATION_TIMEOUT_MS = 10000;
const VALID_UNAVAILABLE_REASONS = new Set([
    "not_develop",
    "no_photo",
    "sdk_unavailable",
    "sdk_error",
    "invalid_inventory",
    "unreconciled_selection",
    "unreconciled_tool",
    "context_changed"
]);
const COMMAND_RELEVANT_SNAPSHOT_FIELDS = [
    "available",
    "unavailableReason",
    "active",
    "maskGroupCount",
    "hasSelectedMaskGroup",
    "selectedMaskGroupIndex",
    "selectedMaskGroupId",
    "selectedMaskGroupName",
    "selectedMaskHidden",
    "previousAvailable",
    "nextAvailable",
    "selectedMaskToolAvailable",
    "selectedMaskToolId",
    "selectedMaskToolName",
    "selectedMaskToolType",
    "selectedMaskToolSubtype",
    "selectedMaskToolHidden",
    "selectedMaskToolInverted",
    "selectedMaskToolCount",
    "selectedMaskToolIndex",
    "previousMaskToolAvailable",
    "nextMaskToolAvailable"
];

function createId(prefix) {
    return prefix + crypto.randomBytes(12).toString("base64url");
}

function unavailableSnapshot(reason) {
    return {
        available: false,
        unavailableReason: reason || "context_changed",
        active: null,
        maskGroupCount: null,
        hasSelectedMaskGroup: null,
        selectedMaskGroupIndex: null,
        selectedMaskGroupId: null,
        selectedMaskGroupName: null,
        selectedMaskHidden: null,
        previousAvailable: false,
        nextAvailable: false,
        selectedMaskToolAvailable: false,
        selectedMaskToolId: null,
        selectedMaskToolName: null,
        selectedMaskToolType: null,
        selectedMaskToolSubtype: null,
        selectedMaskToolHidden: null,
        selectedMaskToolInverted: null,
        selectedMaskToolCount: null,
        selectedMaskToolIndex: null,
        previousMaskToolAvailable: false,
        nextMaskToolAvailable: false,
        corrections: [],
        pointColor: { available: false, swatchCount: 0, selectedIndex: 0, selectionTransient: false },
        pointColorPresetCollection: null,
        curves: { available: false }
    };
}

function validOpaqueId(value) {
    return typeof value === "string" && value.length >= 1 && value.length <= 256 &&
        !/[\u0000-\u001f\u007f]/.test(value);
}

function validMaskName(value) {
    return typeof value === "string" && value.length >= 1 && value.length <= 512 && /\S/.test(value) &&
        !/[\u0000-\u001f\u007f]/.test(value);
}

function sanitizeCurves(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.available !== "boolean") return null;
    if (!input.available) return { available: false };
    const result = { available: true };
    for (const channel of pointCurveDefinition.CHANNELS) {
        if (!pointCurveDefinition.validCurveArray(input[channel])) return null;
        result[channel] = input[channel].slice();
    }
    return result;
}

function sanitizeSnapshot(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.available !== "boolean") return null;
    if (input.available === false) {
        if (!VALID_UNAVAILABLE_REASONS.has(input.unavailableReason)) return null;
        return unavailableSnapshot(input.unavailableReason);
    }
    if (input.unavailableReason !== null && input.unavailableReason !== undefined) return null;
    if (input.selectedMaskToolInverted != null && (typeof input.selectedMaskToolInverted !== "boolean" ||
        input.active !== true || input.hasSelectedMaskGroup !== true || input.selectedMaskToolAvailable !== true)) return null;
    if (typeof input.active !== "boolean" || !Number.isSafeInteger(input.maskGroupCount) ||
        input.maskGroupCount < 0 || input.maskGroupCount > MAX_MASK_GROUPS) return null;

    const selected = input.hasSelectedMaskGroup;
    const corrections = maskingCorrections.sanitizeCorrections(input.corrections === undefined ? [] : input.corrections);
    const pointColor = pointColorDefinition.sanitizePointColorSnapshot(input.pointColor === undefined
        ? { available: false, swatchCount: 0, selectedIndex: 0, selectionTransient: false } : input.pointColor);
    let pointColorPresetCollection = null;
    if (input.pointColorPresetCollection !== undefined && input.pointColorPresetCollection !== null) {
        pointColorPresetCollection = pointColorDefinition.sanitizePointColorCollection(input.pointColorPresetCollection);
        if (!pointColorPresetCollection) return null;
    }
    const curves = sanitizeCurves(input.curves === undefined ? { available: false } : input.curves);
    if (!corrections || !pointColor || !curves) return null;
    if (input.active === false) {
        if (selected !== null || input.selectedMaskGroupIndex !== null || input.selectedMaskGroupId !== null ||
            input.selectedMaskGroupName !== null && input.selectedMaskGroupName !== undefined ||
            input.selectedMaskHidden !== null ||
            input.previousAvailable !== false || input.nextAvailable !== false ||
            input.selectedMaskToolAvailable !== false || input.selectedMaskToolId !== null ||
            input.selectedMaskToolName !== null && input.selectedMaskToolName !== undefined ||
            input.selectedMaskToolType !== null && input.selectedMaskToolType !== undefined ||
            input.selectedMaskToolSubtype !== null && input.selectedMaskToolSubtype !== undefined ||
            input.selectedMaskToolHidden !== null ||
            input.selectedMaskToolCount !== null || input.selectedMaskToolIndex !== null ||
            input.previousMaskToolAvailable !== false || input.nextMaskToolAvailable !== false || corrections.length !== 0 ||
            pointColor.available !== false || pointColorPresetCollection !== null || curves.available !== false) return null;
    } else {
        if (typeof selected !== "boolean") return null;
        if (!selected) {
            if (input.selectedMaskGroupIndex !== null || input.selectedMaskGroupId !== null ||
                input.selectedMaskGroupName !== null && input.selectedMaskGroupName !== undefined ||
                input.selectedMaskHidden !== null ||
                input.previousAvailable !== false || input.nextAvailable !== false ||
                input.selectedMaskToolAvailable !== false || input.selectedMaskToolId !== null ||
                input.selectedMaskToolName !== null && input.selectedMaskToolName !== undefined ||
                input.selectedMaskToolType !== null && input.selectedMaskToolType !== undefined ||
                input.selectedMaskToolSubtype !== null && input.selectedMaskToolSubtype !== undefined ||
                input.selectedMaskToolHidden !== null ||
                input.selectedMaskToolCount !== null || input.selectedMaskToolIndex !== null ||
                input.previousMaskToolAvailable !== false || input.nextMaskToolAvailable !== false || corrections.length !== 0 ||
                pointColor.available !== false || pointColorPresetCollection !== null || curves.available !== false) return null;
        } else {
            if (!Number.isSafeInteger(input.selectedMaskGroupIndex) || input.selectedMaskGroupIndex < 1 ||
                input.selectedMaskGroupIndex > input.maskGroupCount || !validOpaqueId(input.selectedMaskGroupId) ||
                (input.selectedMaskGroupName !== null && input.selectedMaskGroupName !== undefined &&
                    !validMaskName(input.selectedMaskGroupName)) || typeof input.selectedMaskHidden !== "boolean") return null;
            if (input.previousAvailable !== (input.selectedMaskGroupIndex > 1) ||
                input.nextAvailable !== (input.selectedMaskGroupIndex < input.maskGroupCount) ||
                typeof input.selectedMaskToolAvailable !== "boolean" ||
                !Number.isSafeInteger(input.selectedMaskToolCount) || input.selectedMaskToolCount < 0 ||
                input.selectedMaskToolCount > MAX_MASK_TOOLS_PER_GROUP) return null;
            if (input.selectedMaskToolAvailable) {
                if (!validOpaqueId(input.selectedMaskToolId) || !Number.isSafeInteger(input.selectedMaskToolIndex) ||
                    input.selectedMaskToolIndex < 1 || input.selectedMaskToolIndex > input.selectedMaskToolCount ||
                    (input.selectedMaskToolName !== null && input.selectedMaskToolName !== undefined &&
                        !validMaskName(input.selectedMaskToolName)) ||
                    (input.selectedMaskToolType !== null && input.selectedMaskToolType !== undefined &&
                        !validMaskName(input.selectedMaskToolType)) ||
                    (input.selectedMaskToolSubtype !== null && input.selectedMaskToolSubtype !== undefined &&
                        !validMaskName(input.selectedMaskToolSubtype)) ||
                    typeof input.selectedMaskToolHidden !== "boolean" ||
                    input.previousMaskToolAvailable !== (input.selectedMaskToolIndex > 1) ||
                    input.nextMaskToolAvailable !== (input.selectedMaskToolIndex < input.selectedMaskToolCount)) return null;
            } else if (input.selectedMaskToolId !== null ||
                input.selectedMaskToolName !== null && input.selectedMaskToolName !== undefined ||
                input.selectedMaskToolType !== null && input.selectedMaskToolType !== undefined ||
                input.selectedMaskToolSubtype !== null && input.selectedMaskToolSubtype !== undefined ||
                input.selectedMaskToolIndex !== null ||
                input.selectedMaskToolHidden !== null ||
                input.previousMaskToolAvailable !== false || input.nextMaskToolAvailable !== false) return null;
            if (pointColorPresetCollection !== null &&
                (pointColor.available !== true || pointColorPresetCollection.length !== pointColor.swatchCount)) return null;
        }
    }

    return {
        available: true,
        unavailableReason: null,
        active: input.active,
        maskGroupCount: input.maskGroupCount,
        hasSelectedMaskGroup: selected,
        selectedMaskGroupIndex: input.selectedMaskGroupIndex,
        selectedMaskGroupId: input.selectedMaskGroupId,
        selectedMaskGroupName: validMaskName(input.selectedMaskGroupName) ? input.selectedMaskGroupName : null,
        selectedMaskHidden: input.selectedMaskHidden,
        previousAvailable: input.previousAvailable,
        nextAvailable: input.nextAvailable,
        selectedMaskToolAvailable: input.selectedMaskToolAvailable,
        selectedMaskToolId: input.selectedMaskToolId,
        selectedMaskToolName: validMaskName(input.selectedMaskToolName) ? input.selectedMaskToolName : null,
        selectedMaskToolType: validMaskName(input.selectedMaskToolType) ? input.selectedMaskToolType : null,
        selectedMaskToolSubtype: validMaskName(input.selectedMaskToolSubtype) ? input.selectedMaskToolSubtype : null,
        selectedMaskToolHidden: input.selectedMaskToolHidden,
        selectedMaskToolInverted: typeof input.selectedMaskToolInverted === "boolean" ? input.selectedMaskToolInverted : null,
        selectedMaskToolCount: input.selectedMaskToolCount,
        selectedMaskToolIndex: input.selectedMaskToolIndex,
        previousMaskToolAvailable: input.previousMaskToolAvailable,
        nextMaskToolAvailable: input.nextMaskToolAvailable,
        corrections: corrections,
        pointColor: pointColor,
        pointColorPresetCollection: pointColorPresetCollection,
        curves: curves
    };
}

function sameSemanticSnapshot(left, right) {
    return Boolean(left && right && COMMAND_RELEVANT_SNAPSHOT_FIELDS.every(function (field) {
        return Object.is(left[field], right[field]);
    }) && maskingCorrections.sameCorrections(left.corrections || [], right.corrections || []) &&
        JSON.stringify(left.pointColor) === JSON.stringify(right.pointColor) &&
        JSON.stringify(left.pointColorPresetCollection) === JSON.stringify(right.pointColorPresetCollection) &&
        JSON.stringify(left.curves) === JSON.stringify(right.curves));
}

function correctionSelectionKey(value) {
    if (!value || value.available !== true || value.active !== true ||
        value.hasSelectedMaskGroup !== true || typeof value.selectedMaskGroupId !== "string") return null;
    return value.selectedMaskGroupId;
}

function contextBinding(fields) {
    return {
        activeModule: fields.activeModule,
        selectedPhotoUuid: fields.selectedPhotoUuid,
        contextCounter: fields.contextCounter,
        developCounter: fields.developCounter,
        contextChangedAt: fields.contextChangedAt,
        maskingCorrectionDevelopFloor: Number.isSafeInteger(fields.maskingCorrectionDevelopFloor)
            ? fields.maskingCorrectionDevelopFloor : fields.developCounter,
        maskingGrainMaskId: fields.maskingGrainMaskId || null
    };
}

function sameBinding(left, right) {
    return Boolean(left && right && left.activeModule === right.activeModule &&
        left.selectedPhotoUuid === right.selectedPhotoUuid && left.contextCounter === right.contextCounter &&
        left.developCounter === right.developCounter && left.contextChangedAt === right.contextChangedAt);
}

function bindingMatches(left, right) {
    return Boolean(left && right && left.activeModule === "develop" && right.activeModule === "develop" &&
        sameBinding(left, right));
}

function contextUnavailableReason(fields) {
    if (!fields || fields.activeModule !== "develop") return "not_develop";
    if (typeof fields.selectedPhotoUuid !== "string" || fields.selectedPhotoUuid.length < 1 ||
        fields.selectedPhotoUuid.length > 200) return "no_photo";
    return null;
}

const LOCAL_CURVE_FIELDS = Object.freeze({
    rgb: "local_Maincurve",
    red: "local_Redcurve",
    green: "local_Greencurve",
    blue: "local_Bluecurve"
});

function isEditCommand(command) {
    return Boolean(command && typeof command.command === "string" &&
        command.command !== "masking.point_color.tool.select" &&
        command.command !== "masking.point_color.range_visualization.toggle" &&
        (command.command.startsWith("masking.point_color.") || command.command.startsWith("masking.tone_curve.")));
}

function sameArray(left, right) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
        left.every(function (value, index) { return value === right[index]; });
}

function sameCommandValue(left, right) {
    if (Array.isArray(left) || Array.isArray(right)) return sameArray(left, right);
    return left === right;
}

function createMaskingState(options) {
    options = options || {};
    function traceDeletion(event, data) {
        if (typeof options.onDeletionDiagnostic !== "function") return;
        try { options.onDeletionDiagnostic(event, data); } catch (_) { /* Evidence cannot alter settlement. */ }
    }
    function tracePendingDeletion(event, data) {
        if (pendingOperation && ["deleteSelected", "deleteAll"].includes(pendingOperation.kind)) {
            traceDeletion(event, Object.assign({ operationId: pendingOperation.operationId,
                pendingOperation, serverEpoch, revision, binding }, data));
        }
    }
    if (options.serverEpoch !== undefined && !ID_PATTERN.test(options.serverEpoch)) {
        throw new TypeError("serverEpoch must be a safe identifier");
    }
    const serverEpoch = options.serverEpoch || createId("mask-");
    const nowProvider = typeof options.now === "function" ? options.now : Date.now;
    let revision = 0;
    let snapshot = unavailableSnapshot("context_changed");
    let capturedAt = null;
    let binding = null;
    let queuedQuery = null;
    let outstandingQuery = null;
    let pendingOperation = null;
    let lastResult = null;
    function componentResultTargets(operation) {
        return operation && ["deleteComponent", "invertComponent"].includes(operation.kind) ? {
            targetMaskId: operation.beforeSelectedMaskId, targetToolId: operation.beforeSelectedMaskToolId
        } : {};
    }
    let lastPresetDiagnostics = null;
    const presetDiagnosticHistory = [];
    function recordPresetDiagnostics(entry) {
        if (pendingOperation) entry.binding = {
            selectedPhotoUuid: pendingOperation.selectedPhotoUuid,
            selectedMaskGroupId: pendingOperation.beforeSelectedMaskId,
            selectedMaskToolId: pendingOperation.beforeSelectedMaskToolId,
            contextCounter: pendingOperation.contextCounter,
            developCounter: pendingOperation.developCounter,
            contextChangedAt: pendingOperation.contextChangedAt,
            serverEpoch: serverEpoch, revision: pendingOperation.expectedMaskingRevision,
            startedAt: pendingOperation.startedAt
        };
        lastPresetDiagnostics = entry;
        presetDiagnosticHistory.push(entry);
        if (presetDiagnosticHistory.length > 64) presetDiagnosticHistory.shift();
    }
    let requestCounter = 0;
    let operationCounter = 0;
    let correctionSequence = 0;
    let correctionFeedbackSequence = 0;
    let correctionSelectionRevision = 0;
    let lastCorrectionResult = null;
    // One completion per supported parameter, scoped to the current photo/mask.
    // A single last result loses confirmations when multiple sliders finish
    // between browser polls. Keep the legacy field for existing HTTP clients.
    const correctionResults = new Map();
    const correctionAdmissions = new Map();
    // Queue cancellation is an execution receipt, not a snapshot. Retain its
    // original identity across invalidation so an admitted final edit cannot
    // disappear without explaining that it never reached the SDK.
    const correctionCancellations = new Map();
    let editSequence = 0;
    let editFeedbackSequence = 0;
    let lastEditResult = null;
    const editAdmissions = new Map();
    function publicState() {
        const publishedSnapshot = Object.assign({}, snapshot);
        delete publishedSnapshot.pointColorPresetCollection;
        return Object.assign({
            ok: true,
            serverEpoch: serverEpoch,
            revision: revision,
            capturedAt: capturedAt,
            selectedPhotoUuid: binding ? binding.selectedPhotoUuid : null,
            contextCounter: binding ? binding.contextCounter : null,
            developCounter: binding ? binding.developCounter : null,
            contextChangedAt: binding ? binding.contextChangedAt : null,
            maskingCorrectionDevelopFloor: binding ? binding.maskingCorrectionDevelopFloor : null,
            maskingGrainMaskId: binding ? binding.maskingGrainMaskId : null,
            pendingOperation: pendingOperation ? Object.assign({
                operationId: pendingOperation.operationId,
                kind: pendingOperation.kind,
                open: pendingOperation.open,
                direction: pendingOperation.direction,
                hidden: pendingOperation.hidden
            }, pendingOperation.kind === "preset" ? { presetId: pendingOperation.presetId } : {},
            ["deleteSelected", "deleteComponent", "invertComponent", "add", "subtract"].includes(pendingOperation.kind) ? { beforeSelectedMaskId: pendingOperation.beforeSelectedMaskId } : {},
            ["deleteComponent", "invertComponent"].includes(pendingOperation.kind) ? { beforeSelectedMaskToolId: pendingOperation.beforeSelectedMaskToolId } : {},
            ["create", "add", "subtract"].includes(pendingOperation.kind) ? { maskType: pendingOperation.maskType, maskSubtype: pendingOperation.maskSubtype } : {}) : null,
            lastResult: lastResult ? Object.assign({}, lastResult) : null,
            correctionFeedbackSequence: correctionFeedbackSequence,
            lastCorrectionResult: lastCorrectionResult ? Object.assign({}, lastCorrectionResult) : null,
            correctionResults: Array.from(correctionResults.values(), result => Object.assign({}, result)),
            correctionCancellations: Array.from(correctionCancellations.values(), result => Object.assign({}, result)),
            editFeedbackSequence: editFeedbackSequence,
            lastEditResult: lastEditResult ? Object.assign({}, lastEditResult) : null,
            currentPreset: null,
            presetIdentityAvailable: false,
            presetIdentityReason: "unsupported_sdk"
        }, publishedSnapshot);
    }

    function syncContext(fields) {
        const nextBinding = contextBinding(fields || {});
        const changed = !sameBinding(binding, nextBinding);
        if (!changed) { binding = nextBinding; return false; }
        const compatibleGrain = binding && !pendingOperation && snapshot.available === true &&
            snapshot.active === true && snapshot.hasSelectedMaskGroup === true &&
            binding.activeModule === "develop" && nextBinding.activeModule === "develop" &&
            binding.selectedPhotoUuid === nextBinding.selectedPhotoUuid &&
            binding.contextCounter === nextBinding.contextCounter &&
            binding.contextChangedAt === nextBinding.contextChangedAt &&
            nextBinding.maskingGrainMaskId === snapshot.selectedMaskGroupId &&
            nextBinding.maskingCorrectionDevelopFloor <= binding.developCounter &&
            nextBinding.developCounter > binding.developCounter;
        binding = nextBinding;
        if (compatibleGrain) {
            // Grain changes no local correction. Keep its admission/result ownership
            // and original freshness, while other Masking operations stay revision-bound.
            queuedQuery = null;
            outstandingQuery = null;
            editFeedbackSequence = 0;
            lastEditResult = null;
            editAdmissions.clear();
            revision += 1;
            return true;
        }
        snapshot = unavailableSnapshot(contextUnavailableReason(fields) || "context_changed");
        capturedAt = null;
        queuedQuery = null;
        outstandingQuery = null;
        if (pendingOperation) {
            tracePendingDeletion("context-cancelled", { fields });
            if (pendingOperation.kind === "preset") {
                recordPresetDiagnostics({
                    operationId: pendingOperation.operationId,
                    presetId: pendingOperation.presetId,
                    presetFile: pendingOperation.presetFile,
                    outcome: "stale",
                    detail: "Lightroom context changed.",
                    report: null,
                    completedAt: nowProvider()
                });
            }
            lastResult = {
            ...componentResultTargets(pendingOperation),
                operationId: pendingOperation.operationId,
                outcome: "stale",
                detail: "Lightroom context changed.",
                completedAt: nowProvider()
            };
        }
        pendingOperation = null;
        correctionFeedbackSequence = 0;
        lastCorrectionResult = null;
        correctionResults.clear();
        correctionAdmissions.clear();
        editFeedbackSequence = 0;
        lastEditResult = null;
        editAdmissions.clear();
        revision += 1;
        correctionSelectionRevision = revision;
        return true;
    }

    function requestRefresh(fields, force) {
        syncContext(fields);
        const now = nowProvider();
        if (pendingOperation && now - pendingOperation.startedAt > (["create", "add", "subtract"].includes(pendingOperation.kind) ? 60000 : OPERATION_TIMEOUT_MS)) {
            tracePendingDeletion("timeout", { elapsedMs: now - pendingOperation.startedAt });
            if (pendingOperation.kind === "preset") {
                recordPresetDiagnostics({
                    operationId: pendingOperation.operationId,
                    presetId: pendingOperation.presetId,
                    presetFile: pendingOperation.presetFile,
                    outcome: "failed",
                    detail: "Lightroom did not confirm the Masking action in time.",
                    report: null,
                    completedAt: now
                });
            }
            lastResult = {
            ...componentResultTargets(pendingOperation),
                operationId: pendingOperation.operationId,
                outcome: "failed",
                detail: "Lightroom did not confirm the Masking action in time.",
                completedAt: now
            };
            pendingOperation = null;
            capturedAt = null;
            revision += 1;
        }
        if (contextUnavailableReason(fields) || pendingOperation) return false;
        if (queuedQuery) return false;
        if (outstandingQuery && now - outstandingQuery.requestedAt < QUERY_RETRY_MS) return false;
        if (outstandingQuery) outstandingQuery = null;
        if (!force && capturedAt !== null && now - capturedAt < 400) return false;
        requestCounter += 1;
        queuedQuery = Object.assign({
            command: "masking.query",
            requestId: "mq-" + requestCounter,
            expectedServerEpoch: serverEpoch,
            expectedMaskingRevision: revision,
            requestedAt: now
        }, {
            expectedActiveModule: "develop",
            expectedSelectedPhotoUuid: binding.selectedPhotoUuid,
            expectedContextCounter: binding.contextCounter,
            expectedDevelopCounter: binding.developCounter,
            expectedContextChangedAt: binding.contextChangedAt
        });
        return true;
    }

    function takeRequest() {
        if (!queuedQuery) return null;
        outstandingQuery = queuedQuery;
        queuedQuery = null;
        return Object.assign({}, outstandingQuery);
    }

    function queryMatches(result, fields) {
        return Boolean(outstandingQuery && result && result.requestId === outstandingQuery.requestId &&
            result.expectedServerEpoch === serverEpoch && result.expectedMaskingRevision === revision &&
            result.expectedMaskingRevision === outstandingQuery.expectedMaskingRevision &&
            result.expectedActiveModule === outstandingQuery.expectedActiveModule &&
            result.expectedSelectedPhotoUuid === outstandingQuery.expectedSelectedPhotoUuid &&
            result.expectedContextCounter === outstandingQuery.expectedContextCounter &&
            result.expectedDevelopCounter === outstandingQuery.expectedDevelopCounter &&
            result.expectedContextChangedAt === outstandingQuery.expectedContextChangedAt &&
            bindingMatches(binding, contextBinding(fields || {})));
    }

    function acceptQueryResult(result, fields) {
        if (!queryMatches(result, fields) || pendingOperation) return false;
        const next = sanitizeSnapshot(result.snapshot);
        if (!next) return false;
        const changed = !sameSemanticSnapshot(snapshot, next);
        const correctionSelectionChanged = correctionSelectionKey(snapshot) !== correctionSelectionKey(next);
        snapshot = next;
        capturedAt = nowProvider();
        outstandingQuery = null;
        if (changed) revision += 1;
        if (correctionSelectionChanged) {
            correctionSelectionRevision = revision;
            correctionResults.clear();
        }
        return true;
    }

    function beginOperation(specification, suppliedBinding, fields) {
        syncContext(fields);
        const now = nowProvider();
        if (!specification || pendingOperation || !bindingMatches(binding, contextBinding(fields || {})) ||
            !bindingMatches(binding, Object.assign({ activeModule: "develop" }, suppliedBinding || {})) ||
            suppliedBinding.serverEpoch !== serverEpoch || suppliedBinding.revision !== revision ||
            capturedAt === null || now - capturedAt > SNAPSHOT_FRESH_MS || snapshot.available !== true) return null;

        let kind;
        let open = null;
        let direction = null;
        let hidden = null;
        let presetId = null;
        let presetKind = null;
        let presetFile = null;
        let presetParameter = null;
        let presetValue = null;
        if (specification.kind === "create" && maskingCorrections.creationType(specification.maskType, specification.maskSubtype)) {
            kind = "create";
            if (!Number.isSafeInteger(snapshot.maskGroupCount) || snapshot.maskGroupCount >= 512) return null;
        } else if (["add", "subtract"].includes(specification.kind) &&
            maskingCorrections.creationType(specification.maskType, specification.maskSubtype)) {
            kind = specification.kind;
            if (snapshot.active !== true || snapshot.hasSelectedMaskGroup !== true ||
                specification.selectedMaskGroupId !== snapshot.selectedMaskGroupId ||
                !Number.isSafeInteger(snapshot.selectedMaskToolCount) || snapshot.selectedMaskToolCount < 1 ||
                snapshot.selectedMaskToolCount >= MAX_MASK_TOOLS_PER_GROUP) return null;
        } else if (specification.kind === "panel" && typeof specification.open === "boolean") {
            kind = "panel";
            open = specification.open;
            if (snapshot.active === open) return null;
        } else if (specification.kind === "navigate" &&
            (specification.direction === "previous" || specification.direction === "next")) {
            kind = "navigate";
            direction = specification.direction;
            if (snapshot.active !== true || snapshot.hasSelectedMaskGroup !== true ||
                (direction === "previous" ? snapshot.previousAvailable !== true : snapshot.nextAvailable !== true)) return null;
        } else if (specification.kind === "toolNavigate" &&
            (specification.direction === "previous" || specification.direction === "next")) {
            kind = "toolNavigate";
            direction = specification.direction;
            if (snapshot.active !== true || snapshot.hasSelectedMaskGroup !== true ||
                snapshot.selectedMaskToolAvailable !== true ||
                (direction === "previous"
                    ? snapshot.previousMaskToolAvailable !== true
                    : snapshot.nextMaskToolAvailable !== true)) return null;
        } else if ((specification.kind === "maskVisibility" || specification.kind === "toolVisibility") &&
            typeof specification.hidden === "boolean") {
            kind = specification.kind;
            hidden = specification.hidden;
            if (snapshot.active !== true || snapshot.hasSelectedMaskGroup !== true ||
                snapshot.selectedMaskToolAvailable !== true || typeof snapshot.selectedMaskHidden !== "boolean" ||
                typeof snapshot.selectedMaskToolHidden !== "boolean" ||
                hidden === (kind === "maskVisibility" ? snapshot.selectedMaskHidden : snapshot.selectedMaskToolHidden)) return null;
        } else if (specification.kind === "deleteAll") {
            kind = "deleteAll";
            if (snapshot.maskGroupCount < 1) return null;
        } else if (specification.kind === "deleteSelected") {
            kind = "deleteSelected";
            if (snapshot.active !== true || snapshot.hasSelectedMaskGroup !== true ||
                specification.selectedMaskGroupId !== snapshot.selectedMaskGroupId) return null;
        } else if (specification.kind === "deleteComponent" || specification.kind === "invertComponent") {
            kind = specification.kind;
            if (snapshot.active !== true || snapshot.hasSelectedMaskGroup !== true || snapshot.selectedMaskToolAvailable !== true ||
                specification.selectedMaskGroupId !== snapshot.selectedMaskGroupId ||
                specification.selectedMaskToolId !== snapshot.selectedMaskToolId) return null;
        } else if (specification.kind === "resetSelected") {
            kind = "resetSelected";
            if (snapshot.active !== true || snapshot.hasSelectedMaskGroup !== true ||
                specification.selectedMaskGroupId !== snapshot.selectedMaskGroupId) return null;
        } else if (specification.kind === "pointColorPicker") {
            kind = "pointColorPicker";
            if (snapshot.active !== true || snapshot.hasSelectedMaskGroup !== true ||
                snapshot.selectedMaskToolAvailable !== true ||
                specification.selectedMaskGroupId !== snapshot.selectedMaskGroupId) return null;
        } else if (specification.kind === "pointColorVisualize") {
            kind = "pointColorVisualize";
            if (snapshot.active !== true || snapshot.hasSelectedMaskGroup !== true ||
                snapshot.selectedMaskToolAvailable !== true || snapshot.pointColor.available !== true ||
                snapshot.pointColor.selectedIndex < 1 ||
                specification.selectedMaskGroupId !== snapshot.selectedMaskGroupId) return null;
        } else if (specification.kind === "preset" && typeof specification.presetId === "string" &&
            /^[A-Za-z0-9_-]{1,80}$/.test(specification.presetId) &&
            (((specification.presetKind === undefined || specification.presetKind === "file") &&
                typeof specification.presetFile === "string" &&
                specification.presetFile.length <= 180 &&
                /^[^"\\/\u0000-\u001f\u007f]+\.lrtemplate$/i.test(specification.presetFile) &&
                (specification.presetParameter === undefined || specification.presetParameter === null) &&
                (specification.presetValue === undefined || specification.presetValue === null)) ||
            (specification.presetKind === "builtin" && specification.presetFile === null &&
                typeof specification.presetParameter === "string" &&
                Object.prototype.hasOwnProperty.call(maskingCorrections.byParameter, specification.presetParameter) &&
                localPresets.validBuiltinPreset(specification.presetId,
                    specification.presetParameter, specification.presetValue)))) {
            kind = "preset";
            presetId = specification.presetId;
            presetKind = specification.presetKind || "file";
            presetFile = specification.presetFile;
            presetParameter = specification.presetParameter === undefined ? null : specification.presetParameter;
            presetValue = specification.presetValue === undefined ? null : specification.presetValue;
            if (snapshot.active !== true || snapshot.hasSelectedMaskGroup !== true ||
                snapshot.selectedMaskToolAvailable !== true ||
                specification.selectedMaskGroupId !== snapshot.selectedMaskGroupId ||
                specification.selectedMaskToolId !== snapshot.selectedMaskToolId) return null;
        } else return null;

        operationCounter += 1;
        revision += 1;
        if (kind === "panel" || kind === "navigate" || kind === "deleteAll" || kind === "deleteSelected") {
            correctionSelectionRevision = revision;
            correctionResults.clear();
        }
        queuedQuery = null;
        outstandingQuery = null;
        pendingOperation = Object.assign({
            operationId: "mo-" + operationCounter,
            kind: kind,
            maskType: ["create", "add", "subtract"].includes(kind) ? specification.maskType : null,
            maskSubtype: ["create", "add", "subtract"].includes(kind) ? specification.maskSubtype : null,
            open: open,
            direction: direction,
            hidden: hidden,
            presetId: presetId,
            presetKind: presetKind,
            presetFile: presetFile,
            presetParameter: presetParameter,
            presetValue: presetValue,
            startedAt: now,
            expectedMaskingRevision: revision,
            beforeIndex: snapshot.selectedMaskGroupIndex,
            beforeCount: snapshot.maskGroupCount,
            beforeSelectedMaskId: snapshot.selectedMaskGroupId,
            beforeMaskHidden: snapshot.selectedMaskHidden,
            beforeSelectedMaskToolAvailable: snapshot.selectedMaskToolAvailable,
            beforeToolIndex: snapshot.selectedMaskToolIndex,
            beforeToolCount: snapshot.selectedMaskToolCount,
            beforeSelectedMaskToolId: snapshot.selectedMaskToolId,
            beforeMaskToolHidden: snapshot.selectedMaskToolHidden,
            beforeMaskToolInverted: snapshot.selectedMaskToolInverted
        }, binding);
        let commandName;
        let operationFields;
        if (kind === "create") {
            commandName = "masking.create";
            operationFields = { maskType: specification.maskType, maskSubtype: specification.maskSubtype,
                expectedMaskCount: snapshot.maskGroupCount };
        } else if (kind === "add" || kind === "subtract") {
            commandName = "masking.component." + kind;
            operationFields = { maskType: specification.maskType, maskSubtype: specification.maskSubtype,
                expectedMaskCount: snapshot.maskGroupCount, expectedSelectedMaskId: snapshot.selectedMaskGroupId,
                expectedSelectedMaskToolId: snapshot.selectedMaskToolId, expectedMaskToolCount: snapshot.selectedMaskToolCount };
        } else if (kind === "deleteComponent") {
            commandName = "masking.component.delete";
            operationFields = { expectedMaskCount: snapshot.maskGroupCount, expectedMaskToolCount: snapshot.selectedMaskToolCount,
                expectedSelectedMaskId: snapshot.selectedMaskGroupId, expectedSelectedMaskToolId: snapshot.selectedMaskToolId };
        } else if (kind === "invertComponent") {
            commandName = "masking.component.invert";
            operationFields = { expectedInverted: snapshot.selectedMaskToolInverted,
                expectedSelectedMaskId: snapshot.selectedMaskGroupId, expectedSelectedMaskToolId: snapshot.selectedMaskToolId };
        } else if (kind === "panel") {
            commandName = "masking.panel.set";
            operationFields = { open: open };
        } else if (kind === "navigate") {
            commandName = "masking.group.navigate";
            operationFields = { direction: direction, expectedSelectedMaskId: snapshot.selectedMaskGroupId };
        } else if (kind === "toolNavigate") {
            commandName = "masking.tool.navigate";
            operationFields = {
                direction: direction,
                expectedSelectedMaskId: snapshot.selectedMaskGroupId,
                expectedSelectedMaskToolId: snapshot.selectedMaskToolId
            };
        } else if (kind === "maskVisibility" || kind === "toolVisibility") {
            commandName = kind === "maskVisibility"
                ? "masking.group.visibility.set" : "masking.tool.visibility.set";
            operationFields = {
                hidden: hidden,
                expectedHidden: kind === "maskVisibility"
                    ? snapshot.selectedMaskHidden : snapshot.selectedMaskToolHidden,
                expectedSelectedMaskId: snapshot.selectedMaskGroupId,
                expectedSelectedMaskToolId: snapshot.selectedMaskToolId
            };
        } else if (kind === "deleteAll") {
            commandName = "masking.all.delete";
            operationFields = { expectedMaskCount: snapshot.maskGroupCount };
        } else if (kind === "deleteSelected") {
            commandName = "masking.selected.delete";
            operationFields = { expectedMaskCount: snapshot.maskGroupCount, expectedSelectedMaskId: snapshot.selectedMaskGroupId };
        } else if (kind === "resetSelected") {
            commandName = "masking.selected.reset";
            operationFields = { expectedSelectedMaskId: snapshot.selectedMaskGroupId };
        } else if (kind === "pointColorPicker") {
            commandName = "masking.point_color.tool.select";
            operationFields = {
                expectedSelectedMaskId: snapshot.selectedMaskGroupId,
                expectedSelectedMaskToolId: snapshot.selectedMaskToolId
            };
        } else if (kind === "pointColorVisualize") {
            commandName = "masking.point_color.range_visualization.toggle";
            operationFields = {
                expectedSelectedMaskId: snapshot.selectedMaskGroupId,
                expectedSelectedMaskToolId: snapshot.selectedMaskToolId
            };
        } else {
            commandName = "masking.preset.apply";
            operationFields = {
                preset: presetId,
                presetKind: presetKind,
                presetFile: presetFile,
                presetParameter: presetParameter,
                presetValue: presetValue,
                expectedSelectedMaskId: snapshot.selectedMaskGroupId,
                expectedSelectedMaskToolId: snapshot.selectedMaskToolId
            };
        }
        return Object.assign({
            command: commandName,
            operationId: pendingOperation.operationId,
            expectedActiveModule: "develop",
            expectedSelectedPhotoUuid: binding.selectedPhotoUuid,
            expectedContextCounter: binding.contextCounter,
            expectedDevelopCounter: binding.developCounter,
            expectedContextChangedAt: binding.contextChangedAt,
            expectedServerEpoch: serverEpoch,
            expectedMaskingRevision: revision
        }, operationFields);
    }

    function correctionDevelopMatches(developCounter, maskId) {
        return binding && (developCounter === binding.developCounter ||
            Number.isSafeInteger(developCounter) && Number.isSafeInteger(binding.maskingCorrectionDevelopFloor) &&
            maskId === binding.maskingGrainMaskId && maskId === snapshot.selectedMaskGroupId &&
            developCounter >= binding.maskingCorrectionDevelopFloor && developCounter < binding.developCounter);
    }

    function correctionAdmissionError(specification, suppliedBinding, fields) {
        syncContext(fields);
        const now = nowProvider();
        if (!specification || !suppliedBinding) return { code: "invalid_correction", error: "Invalid Masking correction command." };
        if (!bindingMatches(binding, contextBinding(fields || {})) ||
            !bindingMatches(binding, Object.assign({ activeModule: "develop" }, suppliedBinding,
                { developCounter: binding.developCounter })) ||
            !correctionDevelopMatches(suppliedBinding.developCounter, specification.selectedMaskGroupId) ||
            suppliedBinding.serverEpoch !== serverEpoch) return { code: "stale_context",
                error: "Lightroom's photo or Develop context changed. Refresh Masking before adjusting again." };
        if (!Number.isSafeInteger(suppliedBinding.revision) || suppliedBinding.revision < correctionSelectionRevision ||
            suppliedBinding.revision > revision || snapshot.available === true &&
            specification.selectedMaskGroupId !== snapshot.selectedMaskGroupId) return { code: "stale_selection",
                error: "The selected mask changed. Refresh Masking before adjusting again." };
        if (pendingOperation) return { code: "operation_pending", error: "Another Masking action is still pending." };
        if (capturedAt === null || now - capturedAt > SNAPSHOT_FRESH_MS || snapshot.available !== true ||
            snapshot.active !== true || snapshot.hasSelectedMaskGroup !== true) return { code: "feedback_unavailable",
                error: "Lightroom's current Masking state is not available. Refresh Masking before adjusting again." };

        const correction = maskingCorrections.correctionFor(snapshot.corrections, specification.parameter);
        if (!correction) return { code: "correction_unavailable", error: "That correction is not available for the selected mask." };
        const kind = specification.kind;
        const gesture = kind === "gestureBegin" || kind === "gestureUpdate" ||
            kind === "gestureEnd" || kind === "gestureCancel";
        if (!gesture && kind !== "reset") return { code: "invalid_correction", error: "Invalid Masking correction command." };
        if (gesture && (typeof specification.gestureId !== "string" ||
            !/^mg-[A-Za-z0-9_-]{1,60}$/.test(specification.gestureId))) return { code: "invalid_correction", error: "Invalid Masking correction gesture." };
        const carriesValue = kind === "gestureUpdate" || kind === "gestureEnd";
        if (carriesValue && (!Number.isFinite(specification.value) || specification.value < correction.min ||
            specification.value > correction.max)) return { code: "invalid_value", error: "The requested value is outside Lightroom's current range." };
        return null;
    }

    function beginCorrection(specification, suppliedBinding, fields) {
        if (correctionAdmissionError(specification, suppliedBinding, fields)) return null;
        const kind = specification.kind;
        const gesture = kind !== "reset";
        const carriesValue = kind === "gestureUpdate" || kind === "gestureEnd";

        correctionSequence += 1;
        const commandNames = {
            gestureBegin: "masking.correction.gesture.begin",
            gestureUpdate: "masking.correction.gesture.update",
            gestureEnd: "masking.correction.gesture.end",
            gestureCancel: "masking.correction.gesture.cancel",
            reset: "masking.correction.reset"
        };
        const command = {
            command: commandNames[kind],
            correctionSequence: correctionSequence,
            parameter: specification.parameter,
            expectedSelectedMaskId: snapshot.selectedMaskGroupId,
            expectedActiveModule: "develop",
            expectedSelectedPhotoUuid: binding.selectedPhotoUuid,
            expectedContextCounter: binding.contextCounter,
            expectedDevelopCounter: binding.developCounter,
            expectedContextChangedAt: binding.contextChangedAt,
            expectedServerEpoch: serverEpoch,
            expectedMaskingRevision: revision
        };
        if (gesture) command.gestureId = specification.gestureId;
        if (carriesValue) command.value = specification.value;
        correctionAdmissions.set(command.correctionSequence, Object.assign({}, command));
        while (correctionAdmissions.size > 256) {
            correctionAdmissions.delete(correctionAdmissions.keys().next().value);
        }
        return command;
    }

    function beginEdit(specification, suppliedBinding, fields) {
        syncContext(fields);
        const now = nowProvider();
        if (!specification || pendingOperation || !bindingMatches(binding, contextBinding(fields || {})) ||
            !bindingMatches(binding, Object.assign({ activeModule: "develop" }, suppliedBinding || {})) ||
            suppliedBinding.serverEpoch !== serverEpoch || !Number.isSafeInteger(suppliedBinding.revision) ||
            suppliedBinding.revision < correctionSelectionRevision || suppliedBinding.revision > revision ||
            capturedAt === null || now - capturedAt > SNAPSHOT_FRESH_MS || snapshot.available !== true ||
            snapshot.active !== true || snapshot.hasSelectedMaskGroup !== true ||
            specification.selectedMaskGroupId !== snapshot.selectedMaskGroupId) return null;

        const command = {
            command: null,
            editSequence: editSequence + 1,
            expectedSelectedMaskId: snapshot.selectedMaskGroupId,
            expectedActiveModule: "develop",
            expectedSelectedPhotoUuid: binding.selectedPhotoUuid,
            expectedContextCounter: binding.contextCounter,
            expectedDevelopCounter: binding.developCounter,
            expectedContextChangedAt: binding.contextChangedAt,
            expectedServerEpoch: serverEpoch,
            expectedMaskingRevision: revision
        };
        const pointColor = snapshot.pointColor;
        const curves = snapshot.curves;
        if (specification.kind === "pointValue" && pointColor.available === true && pointColor.selectedIndex > 0 &&
            specification.selectedIndex === pointColor.selectedIndex &&
            pointColorDefinition.validValue(specification.field, specification.value)) {
            Object.assign(command, { command: "masking.point_color.value.set", field: specification.field,
                value: specification.value, expectedSelectedIndex: pointColor.selectedIndex });
        } else if (specification.kind === "pointRange" && pointColor.available === true && pointColor.selectedIndex > 0 &&
            specification.selectedIndex === pointColor.selectedIndex &&
            pointColorDefinition.validRangeValue(specification.range, specification.boundary, specification.value)) {
            Object.assign(command, { command: "masking.point_color.range.set", range: specification.range,
                boundary: specification.boundary, value: specification.value,
                expectedSelectedIndex: pointColor.selectedIndex });
        } else if (specification.kind === "pointTranslate" && pointColor.available === true && pointColor.selectedIndex > 0 &&
            specification.selectedIndex === pointColor.selectedIndex &&
            pointColorDefinition.validRangeTranslation(specification.range, specification.values) &&
            pointColorDefinition.safeFullRangeWidth(specification.values)) {
            Object.assign(command, { command: "masking.point_color.range.translate", range: specification.range,
                LowerNone: specification.values.LowerNone, LowerFull: specification.values.LowerFull,
                UpperFull: specification.values.UpperFull, UpperNone: specification.values.UpperNone,
                expectedSelectedIndex: pointColor.selectedIndex });
        } else if (specification.kind === "pointSelect" && pointColor.available === true &&
            Number.isSafeInteger(specification.selectedIndex) && specification.selectedIndex >= 1 &&
            specification.selectedIndex <= pointColor.swatchCount) {
            Object.assign(command, { command: "masking.point_color.sample.select",
                selectedIndex: specification.selectedIndex });
        } else if (specification.kind === "curveGesture" && curves.available === true &&
            pointCurveDefinition.validChannel(specification.channel) &&
            /^curve_[A-Za-z0-9_-]+$/.test(specification.gestureId || "") &&
            ["begin", "update", "end", "cancel"].includes(specification.phase) &&
            (specification.phase === "cancel" || (pointCurveDefinition.validCurveArray(specification.baseline) &&
                sameArray(curves[specification.channel], specification.baseline))) &&
            ((specification.phase !== "update" && specification.phase !== "end") ||
                pointCurveDefinition.validCurveArray(specification.points))) {
            Object.assign(command, { command: "masking.tone_curve.gesture." + specification.phase,
                channel: specification.channel, field: LOCAL_CURVE_FIELDS[specification.channel],
                gestureId: specification.gestureId,
                expectedPoints: (specification.phase === "cancel" ? curves[specification.channel] : specification.baseline).slice() });
            if (specification.phase === "update" || specification.phase === "end") command.points = specification.points.slice();
        } else if (specification.kind === "curveReset" && curves.available === true &&
            pointCurveDefinition.validChannel(specification.channel) &&
            pointCurveDefinition.validCurveArray(specification.baseline) &&
            sameArray(curves[specification.channel], specification.baseline)) {
            Object.assign(command, { command: "masking.tone_curve.reset", channel: specification.channel,
                field: LOCAL_CURVE_FIELDS[specification.channel], expectedPoints: specification.baseline.slice() });
        } else if (specification.kind === "curvePreset" && curves.available === true &&
            pointCurveDefinition.validChannel(specification.channel) && specification.channel === "rgb" &&
            typeof specification.preset === "string" && pointCurveDefinition.presetCurve(specification.preset) &&
            pointCurveDefinition.validCurveArray(specification.baseline) &&
            sameArray(curves.rgb, specification.baseline)) {
            Object.assign(command, { command: "masking.tone_curve.preset.set", channel: "rgb",
                field: LOCAL_CURVE_FIELDS.rgb, preset: specification.preset,
                expectedPoints: specification.baseline.slice(), points: pointCurveDefinition.presetCurve(specification.preset) });
        } else if (specification.kind === "refine" &&
            ["begin", "update", "end", "cancel", "reset"].includes(specification.phase)) {
            const correction = maskingCorrections.correctionFor(snapshot.corrections, "local_RefineSaturation");
            if (!correction || (specification.phase !== "cancel" && specification.baseline !== correction.value) ||
                ((specification.phase === "update" || specification.phase === "end") &&
                    (!Number.isFinite(specification.value) || specification.value < correction.min ||
                        specification.value > correction.max)) ||
                (specification.phase !== "reset" && !/^refine_[A-Za-z0-9_-]+$/.test(specification.gestureId || ""))) return null;
            Object.assign(command, { command: "masking.tone_curve.refine_saturation." +
                (specification.phase === "reset" ? "reset" : "gesture." + specification.phase),
                field: "local_RefineSaturation", expectedValue: correction.value });
            if (specification.phase !== "reset") command.gestureId = specification.gestureId;
            if (specification.phase === "update" || specification.phase === "end") command.value = specification.value;
        } else return null;

        editSequence += 1;
        command.editSequence = editSequence;
        const admittedCommand = Object.assign({}, command);
        if (command.expectedPoints) admittedCommand.expectedPoints = command.expectedPoints.slice();
        if (command.points) admittedCommand.points = command.points.slice();
        editAdmissions.set(editSequence, admittedCommand);
        while (editAdmissions.size > 256) editAdmissions.delete(editAdmissions.keys().next().value);
        return command;
    }

    function correctionCommandMatches(command, fields) {
        const admitted = command && correctionAdmissions.get(command.correctionSequence);
        if (!command || typeof command.command !== "string" ||
            !command.command.startsWith("masking.correction.") || pendingOperation ||
            !admitted || admitted.command !== command.command || admitted.parameter !== command.parameter ||
            admitted.expectedSelectedMaskId !== command.expectedSelectedMaskId ||
            admitted.gestureId !== command.gestureId || admitted.value !== command.value ||
            admitted.expectedMaskingRevision !== command.expectedMaskingRevision ||
            command.expectedServerEpoch !== serverEpoch || command.expectedActiveModule !== "develop" ||
            command.expectedSelectedPhotoUuid !== binding.selectedPhotoUuid ||
            command.expectedContextCounter !== binding.contextCounter ||
            command.expectedDevelopCounter !== admitted.expectedDevelopCounter ||
            !correctionDevelopMatches(command.expectedDevelopCounter, command.expectedSelectedMaskId) ||
            command.expectedContextChangedAt !== binding.contextChangedAt ||
            !Number.isSafeInteger(command.expectedMaskingRevision) || command.expectedMaskingRevision > revision ||
            !Number.isSafeInteger(command.correctionSequence) || command.correctionSequence < 1 ||
            command.correctionSequence > correctionSequence || !bindingMatches(binding, contextBinding(fields || {})) ||
            snapshot.available !== true || snapshot.active !== true || snapshot.hasSelectedMaskGroup !== true ||
            command.expectedSelectedMaskId !== snapshot.selectedMaskGroupId) return false;
        const correction = maskingCorrections.correctionFor(snapshot.corrections, command.parameter);
        if (!correction) return false;
        if (command.command === "masking.correction.gesture.update" ||
            command.command === "masking.correction.gesture.end") {
            return Number.isFinite(command.value) && command.value >= correction.min && command.value <= correction.max;
        }
        return command.command === "masking.correction.gesture.begin" ||
            command.command === "masking.correction.gesture.cancel" || command.command === "masking.correction.reset";
    }

    function editCommandMatches(command, fields) {
        const admitted = command && editAdmissions.get(command.editSequence);
        if (!isEditCommand(command) || pendingOperation || !admitted ||
            command.expectedServerEpoch !== serverEpoch || command.expectedActiveModule !== "develop" ||
            command.expectedSelectedPhotoUuid !== binding.selectedPhotoUuid ||
            command.expectedContextCounter !== binding.contextCounter || command.expectedDevelopCounter !== binding.developCounter ||
            command.expectedContextChangedAt !== binding.contextChangedAt ||
            !Number.isSafeInteger(command.expectedMaskingRevision) || command.expectedMaskingRevision > revision ||
            !Number.isSafeInteger(command.editSequence) || command.editSequence < 1 || command.editSequence > editSequence ||
            !bindingMatches(binding, contextBinding(fields || {})) || snapshot.available !== true || snapshot.active !== true ||
            snapshot.hasSelectedMaskGroup !== true || command.expectedSelectedMaskId !== snapshot.selectedMaskGroupId) return false;
        const keys = Object.keys(admitted);
        if (Object.keys(command).length !== keys.length || keys.some(function (key) {
            return !sameCommandValue(admitted[key], command[key]);
        })) return false;
        if (command.command.startsWith("masking.point_color.")) {
            if (snapshot.pointColor.available !== true) return false;
            if (command.command === "masking.point_color.sample.select") {
                return command.selectedIndex >= 1 && command.selectedIndex <= snapshot.pointColor.swatchCount;
            }
            return snapshot.pointColor.selectedIndex === command.expectedSelectedIndex;
        }
        if (command.command.startsWith("masking.tone_curve.refine_saturation.")) {
            const correction = maskingCorrections.correctionFor(snapshot.corrections, "local_RefineSaturation");
            return Boolean(correction && correction.value === command.expectedValue);
        }
        return snapshot.curves.available === true && pointCurveDefinition.validChannel(command.channel) &&
            sameArray(snapshot.curves[command.channel], command.expectedPoints);
    }

    function commandMatches(command, fields) {
        if (isEditCommand(command)) return editCommandMatches(command, fields);
        if (command && typeof command.command === "string" && command.command.startsWith("masking.correction.")) {
            return correctionCommandMatches(command, fields);
        }
        if (!pendingOperation || !command || command.operationId !== pendingOperation.operationId ||
            command.expectedServerEpoch !== serverEpoch || command.expectedMaskingRevision !== revision ||
            command.expectedActiveModule !== "develop" || command.expectedSelectedPhotoUuid !== binding.selectedPhotoUuid ||
            command.expectedContextCounter !== binding.contextCounter || command.expectedDevelopCounter !== binding.developCounter ||
            command.expectedContextChangedAt !== binding.contextChangedAt || !bindingMatches(binding, contextBinding(fields || {}))) return false;
        if (pendingOperation.kind === "create") {
            return command.command === "masking.create" && command.maskType === pendingOperation.maskType &&
                command.maskSubtype === pendingOperation.maskSubtype && command.expectedMaskCount === pendingOperation.beforeCount;
        }
        if (pendingOperation.kind === "add" || pendingOperation.kind === "subtract") {
            return command.command === "masking.component." + pendingOperation.kind &&
                command.maskType === pendingOperation.maskType && command.maskSubtype === pendingOperation.maskSubtype &&
                command.expectedMaskCount === pendingOperation.beforeCount &&
                command.expectedSelectedMaskId === pendingOperation.beforeSelectedMaskId &&
                command.expectedSelectedMaskToolId === pendingOperation.beforeSelectedMaskToolId &&
                command.expectedMaskToolCount === pendingOperation.beforeToolCount;
        }
        if (pendingOperation.kind === "panel") {
            return command.command === "masking.panel.set" && command.open === pendingOperation.open;
        }
        if (pendingOperation.kind === "navigate") {
            return command.command === "masking.group.navigate" && command.direction === pendingOperation.direction &&
                command.expectedSelectedMaskId === pendingOperation.beforeSelectedMaskId;
        }
        if (pendingOperation.kind === "toolNavigate") {
            return command.command === "masking.tool.navigate" && command.direction === pendingOperation.direction &&
                command.expectedSelectedMaskId === pendingOperation.beforeSelectedMaskId &&
                command.expectedSelectedMaskToolId === pendingOperation.beforeSelectedMaskToolId;
        }
        if (pendingOperation.kind === "deleteAll") {
            return command.command === "masking.all.delete" &&
                command.expectedMaskCount === pendingOperation.beforeCount;
        }
        if (pendingOperation.kind === "deleteSelected") {
            return command.command === "masking.selected.delete" &&
                command.expectedMaskCount === pendingOperation.beforeCount &&
                command.expectedSelectedMaskId === pendingOperation.beforeSelectedMaskId;
        }
        if (pendingOperation.kind === "deleteComponent") {
            return command.command === "masking.component.delete" && command.expectedMaskCount === pendingOperation.beforeCount &&
                command.expectedMaskToolCount === pendingOperation.beforeToolCount &&
                command.expectedSelectedMaskId === pendingOperation.beforeSelectedMaskId &&
                command.expectedSelectedMaskToolId === pendingOperation.beforeSelectedMaskToolId;
        }
        if (pendingOperation.kind === "invertComponent") {
            return command.command === "masking.component.invert" && command.expectedInverted === pendingOperation.beforeMaskToolInverted &&
                command.expectedSelectedMaskId === pendingOperation.beforeSelectedMaskId &&
                command.expectedSelectedMaskToolId === pendingOperation.beforeSelectedMaskToolId;
        }
        if (pendingOperation.kind === "resetSelected") {
            return command.command === "masking.selected.reset" &&
                command.expectedSelectedMaskId === pendingOperation.beforeSelectedMaskId;
        }
        if (pendingOperation.kind === "pointColorPicker") {
            return command.command === "masking.point_color.tool.select" &&
                command.expectedSelectedMaskId === pendingOperation.beforeSelectedMaskId &&
                command.expectedSelectedMaskToolId === pendingOperation.beforeSelectedMaskToolId;
        }
        if (pendingOperation.kind === "pointColorVisualize") {
            return command.command === "masking.point_color.range_visualization.toggle" &&
                command.expectedSelectedMaskId === pendingOperation.beforeSelectedMaskId &&
                command.expectedSelectedMaskToolId === pendingOperation.beforeSelectedMaskToolId;
        }
        if (pendingOperation.kind === "preset") {
            return command.command === "masking.preset.apply" && command.preset === pendingOperation.presetId &&
                command.presetKind === pendingOperation.presetKind &&
                command.presetFile === pendingOperation.presetFile &&
                command.presetParameter === pendingOperation.presetParameter &&
                command.presetValue === pendingOperation.presetValue &&
                command.expectedSelectedMaskId === pendingOperation.beforeSelectedMaskId &&
                command.expectedSelectedMaskToolId === pendingOperation.beforeSelectedMaskToolId;
        }
        return command.command === (pendingOperation.kind === "maskVisibility"
            ? "masking.group.visibility.set" : "masking.tool.visibility.set") &&
            command.hidden === pendingOperation.hidden &&
            command.expectedHidden === (pendingOperation.kind === "maskVisibility"
                ? pendingOperation.beforeMaskHidden : pendingOperation.beforeMaskToolHidden) &&
            command.expectedSelectedMaskId === pendingOperation.beforeSelectedMaskId &&
            command.expectedSelectedMaskToolId === pendingOperation.beforeSelectedMaskToolId;
    }

    function rejectCommand(command, detail) {
        if (isEditCommand(command)) {
            const admitted = editAdmissions.get(command.editSequence);
            if (!admitted || admitted.command !== command.command ||
                admitted.expectedSelectedMaskId !== command.expectedSelectedMaskId ||
                admitted.expectedServerEpoch !== serverEpoch || command.editSequence <= editFeedbackSequence) return false;
            editFeedbackSequence = command.editSequence;
            lastEditResult = {
                sequence: command.editSequence,
                kind: command.command,
                maskGroupId: command.expectedSelectedMaskId,
                outcome: "stale",
                detail: detail || "Masking edit became stale.",
                completedAt: nowProvider()
            };
            return true;
        }
        if (command && typeof command.command === "string" && command.command.startsWith("masking.correction.")) {
            if (command.expectedServerEpoch === serverEpoch) {
                correctionCancellations.set(command.correctionSequence, {
                    sequence: command.correctionSequence, parameter: command.parameter, kind: command.command,
                    value: Number.isFinite(command.value) ? command.value : null,
                    maskGroupId: command.expectedSelectedMaskId, selectedPhotoUuid: command.expectedSelectedPhotoUuid,
                    contextCounter: command.expectedContextCounter, developCounter: command.expectedDevelopCounter,
                    contextChangedAt: command.expectedContextChangedAt, serverEpoch,
                    outcome: "cancelled", dispatched: false, detail: detail || "Masking context changed before dispatch.",
                    completedAt: nowProvider()
                });
                while (correctionCancellations.size > 64) correctionCancellations.delete(correctionCancellations.keys().next().value);
            }
            const admitted = correctionAdmissions.get(command.correctionSequence);
            if (!admitted || admitted.command !== command.command || admitted.parameter !== command.parameter ||
                admitted.expectedSelectedMaskId !== command.expectedSelectedMaskId ||
                command.expectedSelectedMaskId !== snapshot.selectedMaskGroupId ||
                admitted.expectedSelectedPhotoUuid !== binding.selectedPhotoUuid ||
                admitted.expectedContextCounter !== binding.contextCounter ||
                admitted.expectedServerEpoch !== serverEpoch || command.correctionSequence <= correctionFeedbackSequence) {
                return false;
            }
            correctionFeedbackSequence = command.correctionSequence;
            lastCorrectionResult = {
                sequence: command.correctionSequence,
                gestureId: command.gestureId || null,
                parameter: command.parameter,
                maskGroupId: command.expectedSelectedMaskId,
                kind: command.command,
                outcome: "stale",
                detail: detail || "Masking correction command became stale.",
                completedAt: nowProvider()
            };
            correctionResults.set(lastCorrectionResult.parameter, lastCorrectionResult);
            return true;
        }
        if (!pendingOperation || !command || command.operationId !== pendingOperation.operationId) return false;
        if (pendingOperation.kind === "preset") {
            recordPresetDiagnostics({
                operationId: pendingOperation.operationId,
                presetId: pendingOperation.presetId,
                presetFile: pendingOperation.presetFile,
                outcome: "stale",
                detail: detail || "Masking command became stale.",
                report: null,
                completedAt: nowProvider()
            });
        }
        lastResult = {
            ...componentResultTargets(pendingOperation),
            operationId: pendingOperation.operationId,
            outcome: "stale",
            detail: detail || "Masking command became stale.",
            completedAt: nowProvider()
        };
        pendingOperation = null;
        capturedAt = null;
        revision += 1;
        return true;
    }

    function acceptCorrectionResult(result, fields) {
        const admitted = result && correctionAdmissions.get(result.correctionSequence);
        if (!result || !Number.isSafeInteger(result.correctionSequence) || result.correctionSequence < 1 ||
            result.correctionSequence > correctionSequence || result.correctionSequence <= correctionFeedbackSequence ||
            !["confirmed", "failed", "stale"].includes(result.outcome) ||
            !admitted || result.kind !== admitted.command || result.parameter !== admitted.parameter ||
            result.gestureId !== (admitted.gestureId || null) ||
            result.expectedSelectedMaskId !== admitted.expectedSelectedMaskId ||
            result.expectedValue !== (Number.isFinite(admitted.value) ? admitted.value : null) ||
            result.expectedServerEpoch !== serverEpoch || result.expectedActiveModule !== "develop" ||
            result.expectedSelectedPhotoUuid !== binding.selectedPhotoUuid ||
            result.expectedContextCounter !== binding.contextCounter ||
            result.expectedDevelopCounter !== admitted.expectedDevelopCounter ||
            !correctionDevelopMatches(result.expectedDevelopCounter, result.expectedSelectedMaskId) ||
            result.expectedContextChangedAt !== binding.contextChangedAt || !bindingMatches(binding, contextBinding(fields || {})) ||
            snapshot.available !== true || snapshot.active !== true || snapshot.hasSelectedMaskGroup !== true ||
            result.expectedSelectedMaskId !== snapshot.selectedMaskGroupId ||
            !Object.prototype.hasOwnProperty.call(maskingCorrections.byParameter, result.parameter)) return false;
        const next = result.snapshot === null ? null : sanitizeSnapshot(result.snapshot);
        if (result.snapshot !== null && !next) return false;
        let outcome = result.outcome;
        let detail = result.detail || null;
        if (outcome === "confirmed") {
            const correction = next && next.available === true && next.active === true &&
                next.hasSelectedMaskGroup === true && next.selectedMaskGroupId === result.expectedSelectedMaskId
                ? maskingCorrections.correctionFor(next.corrections, result.parameter) : null;
            if (!correction || (result.expectedValue !== null && result.expectedValue !== undefined &&
                Math.abs(correction.value - result.expectedValue) > Math.max(1e-9, Math.abs(result.expectedValue) * 1e-9))) {
                outcome = "failed";
                detail = "Lightroom's Masking correction result could not be reconciled safely.";
            }
        }
        if (next && next.available === true && next.active === true && next.hasSelectedMaskGroup === true &&
            next.selectedMaskGroupId === result.expectedSelectedMaskId) {
            const changed = !sameSemanticSnapshot(snapshot, next);
            const correctionSelectionChanged = correctionSelectionKey(snapshot) !== correctionSelectionKey(next);
            snapshot = next;
            capturedAt = nowProvider();
            queuedQuery = null;
            outstandingQuery = null;
            if (changed) revision += 1;
            if (correctionSelectionChanged) {
                correctionSelectionRevision = revision;
                correctionResults.clear();
            }
        }
        correctionFeedbackSequence = result.correctionSequence;
        for (const sequence of correctionAdmissions.keys()) {
            if (sequence <= result.correctionSequence) correctionAdmissions.delete(sequence);
        }
        lastCorrectionResult = {
            sequence: result.correctionSequence,
            gestureId: result.gestureId || null,
            parameter: result.parameter,
            maskGroupId: result.expectedSelectedMaskId,
            kind: result.kind,
            outcome: outcome,
            detail: detail,
            completedAt: nowProvider()
        };
        correctionResults.set(lastCorrectionResult.parameter, lastCorrectionResult);
        return true;
    }

    function acceptEditResult(result, fields) {
        const admitted = result && editAdmissions.get(result.editSequence);
        if (!result || !Number.isSafeInteger(result.editSequence) || result.editSequence < 1 ||
            result.editSequence > editSequence || result.editSequence <= editFeedbackSequence ||
            !["confirmed", "failed", "stale"].includes(result.outcome) || !admitted ||
            result.kind !== admitted.command || result.expectedSelectedMaskId !== admitted.expectedSelectedMaskId ||
            result.expectedServerEpoch !== serverEpoch || result.expectedActiveModule !== "develop" ||
            result.expectedSelectedPhotoUuid !== binding.selectedPhotoUuid ||
            result.expectedContextCounter !== binding.contextCounter || result.expectedDevelopCounter !== binding.developCounter ||
            result.expectedContextChangedAt !== binding.contextChangedAt ||
            !bindingMatches(binding, contextBinding(fields || {})) || snapshot.available !== true ||
            snapshot.active !== true || snapshot.hasSelectedMaskGroup !== true ||
            result.expectedSelectedMaskId !== snapshot.selectedMaskGroupId) return false;
        const next = sanitizeSnapshot(result.snapshot);
        if (!next || next.available !== true || next.active !== true || next.hasSelectedMaskGroup !== true ||
            next.selectedMaskGroupId !== result.expectedSelectedMaskId) return false;
        let reconciled = result.outcome !== "confirmed";
        if (result.outcome === "confirmed") {
            if (admitted.command === "masking.point_color.sample.select") {
                reconciled = next.pointColor.available === true && next.pointColor.selectedIndex === admitted.selectedIndex;
            } else if (admitted.command === "masking.point_color.value.set") {
                reconciled = next.pointColor.available === true &&
                    next.pointColor.selectedIndex === admitted.expectedSelectedIndex;
            } else if (admitted.command === "masking.point_color.range.set") {
                reconciled = next.pointColor.available === true &&
                    next.pointColor.selectedIndex === admitted.expectedSelectedIndex;
            } else if (admitted.command === "masking.point_color.range.translate") {
                reconciled = next.pointColor.available === true &&
                    next.pointColor.selectedIndex === admitted.expectedSelectedIndex;
            } else if (admitted.command === "masking.tone_curve.gesture.update" ||
                admitted.command === "masking.tone_curve.gesture.end" ||
                admitted.command === "masking.tone_curve.preset.set") {
                reconciled = next.curves.available === true && sameArray(next.curves[admitted.channel], admitted.points);
            } else if (admitted.command === "masking.tone_curve.reset") {
                reconciled = next.curves.available === true && pointCurveDefinition.validCurveArray(next.curves[admitted.channel]);
            } else if (admitted.command === "masking.tone_curve.refine_saturation.gesture.update" ||
                admitted.command === "masking.tone_curve.refine_saturation.gesture.end") {
                const correction = maskingCorrections.correctionFor(next.corrections, "local_RefineSaturation");
                reconciled = Boolean(correction && correction.value === admitted.value);
            } else if (admitted.command === "masking.tone_curve.refine_saturation.reset") {
                reconciled = Boolean(maskingCorrections.correctionFor(next.corrections, "local_RefineSaturation"));
            }
        }
        const changed = !sameSemanticSnapshot(snapshot, next);
        snapshot = next;
        capturedAt = nowProvider();
        queuedQuery = null;
        outstandingQuery = null;
        if (changed) revision += 1;
        editFeedbackSequence = result.editSequence;
        for (const sequence of editAdmissions.keys()) if (sequence <= result.editSequence) editAdmissions.delete(sequence);
        lastEditResult = {
            sequence: result.editSequence,
            kind: result.kind,
            maskGroupId: result.expectedSelectedMaskId,
            outcome: reconciled ? result.outcome : "failed",
            detail: reconciled ? (result.detail || null) : "Lightroom's Masking edit could not be reconciled safely.",
            completedAt: nowProvider()
        };
        return true;
    }

    function operationResultMatches(result, fields) {
        return Boolean(pendingOperation && result && result.operationId === pendingOperation.operationId &&
            result.expectedServerEpoch === serverEpoch && result.expectedMaskingRevision === revision &&
            result.expectedActiveModule === "develop" && result.expectedSelectedPhotoUuid === binding.selectedPhotoUuid &&
            result.expectedContextCounter === binding.contextCounter && result.expectedDevelopCounter === binding.developCounter &&
            result.expectedContextChangedAt === binding.contextChangedAt && bindingMatches(binding, contextBinding(fields || {})));
    }

    function finishOperation(result, fields) {
        const tracing = Boolean(pendingOperation && ["deleteSelected", "deleteAll"].includes(pendingOperation.kind) || result && result.deletion);
        function rejected(reason) {
            if (tracing) traceDeletion("validation-rejected", { operationId: result && result.operationId,
                reason, pendingOperation, binding, fields, serverEpoch, revision, deletion: result && result.deletion });
            return false;
        }
        if (!operationResultMatches(result, fields) || !["confirmed", "deleted", "started", "requested", "no_change", "failed", "stale"].includes(result.outcome) ||
            result.outcome === "requested" && pendingOperation.kind !== "invertComponent" ||
            result.outcome === "started" && !["create", "add", "subtract"].includes(pendingOperation.kind)) return rejected("operation-binding-or-outcome");
        let removalConfirmed = false;
        const deletingComponent = pendingOperation.kind === "deleteComponent";
        const invertingComponent = pendingOperation.kind === "invertComponent";
        let parentRemoved = false;
        if (deletingComponent || invertingComponent ? result.targetMaskId !== pendingOperation.beforeSelectedMaskId ||
            result.targetToolId !== pendingOperation.beforeSelectedMaskToolId : result.targetMaskId != null ||
            result.targetToolId != null || result.componentDeletion != null) return rejected("component-target-binding");
        if (invertingComponent && (result.deletion || result.componentDeletion)) return rejected("unexpected-removal-proof");
        if (deletingComponent && (result.deletion || result.componentDeletion)) {
            const validIds = (ids, max) => Array.isArray(ids) && ids.length <= max && ids.every(validOpaqueId) && new Set(ids).size === ids.length;
            const groups = result.deletion, components = result.componentDeletion;
            if (!groups || !components || !validIds(groups.before, MAX_MASK_GROUPS) || !validIds(groups.after, MAX_MASK_GROUPS) ||
                !validIds(components.before, MAX_MASK_TOOLS_PER_GROUP) || !validIds(components.after, MAX_MASK_TOOLS_PER_GROUP) ||
                groups.before.length !== pendingOperation.beforeCount || !groups.before.includes(pendingOperation.beforeSelectedMaskId) ||
                groups.after.some(id => !groups.before.includes(id)) || components.before.length !== pendingOperation.beforeToolCount ||
                !components.before.includes(pendingOperation.beforeSelectedMaskToolId) || components.after.includes(pendingOperation.beforeSelectedMaskToolId) ||
                components.after.length !== components.before.length - 1 || components.after.some(id => !components.before.includes(id))) {
                return rejected("component-removal-proof");
            }
            parentRemoved = !groups.after.includes(pendingOperation.beforeSelectedMaskId);
            if (parentRemoved ? components.before.length !== 1 || groups.after.length !== groups.before.length - 1 :
                groups.after.length !== groups.before.length) return rejected("component-parent-proof");
            removalConfirmed = true;
        } else if (result.deletion) {
            const before = result.deletion.before, after = result.deletion.after;
            const validIds = ids => Array.isArray(ids) && ids.length <= MAX_MASK_GROUPS &&
                ids.every(validOpaqueId) && new Set(ids).size === ids.length;
            if (pendingOperation.kind !== "deleteSelected" || !validIds(before) || !validIds(after) ||
                before.length !== pendingOperation.beforeCount || after.length !== before.length - 1 ||
                !before.includes(pendingOperation.beforeSelectedMaskId) || after.includes(pendingOperation.beforeSelectedMaskId) ||
                after.some(id => !before.includes(id))) return rejected("removal-inventory-proof");
            removalConfirmed = true;
        }
        if (result.outcome === "deleted" && !removalConfirmed || (pendingOperation.kind === "deleteSelected" || deletingComponent) &&
            result.outcome === "confirmed" && !removalConfirmed) return rejected("missing-removal-proof");
        const presetOperation = pendingOperation.kind === "preset";
        if ((!presetOperation && result.presetDiagnostics !== null && result.presetDiagnostics !== undefined) ||
            (result.presetDiagnostics !== null && result.presetDiagnostics !== undefined &&
                (typeof result.presetDiagnostics !== "string" || result.presetDiagnostics.length < 1 ||
                    result.presetDiagnostics.length > 12000 ||
                    /[\u0000-\u0009\u000b-\u001f\u007f]/.test(result.presetDiagnostics)))) return rejected("unexpected-preset-diagnostics");
        if (presetOperation && typeof result.presetDiagnostics === "string") {
            const expectedPrefix = "preset-settlement operation=" + pendingOperation.operationId +
                " preset=" + pendingOperation.presetId + " file=" + (pendingOperation.presetFile || "") +
                " photo=" + pendingOperation.selectedPhotoUuid + " mask=" + pendingOperation.beforeSelectedMaskId;
            if (!result.presetDiagnostics.startsWith(expectedPrefix) ||
                !result.presetDiagnostics.includes(" context=" + pendingOperation.contextCounter) ||
                !result.presetDiagnostics.includes(" develop=" + pendingOperation.developCounter) ||
                !result.presetDiagnostics.includes(" masking=" + pendingOperation.expectedMaskingRevision) ||
                !result.presetDiagnostics.includes(" epoch=" + serverEpoch) ||
                !/\npreset-settlement-result ok=(?:true|false) kind=/.test(result.presetDiagnostics)) return false;
        }
        const completedOperation = pendingOperation;
        const next = result.snapshot === null ? null : sanitizeSnapshot(result.snapshot);
        if (result.snapshot !== null && !next) return rejected("invalid-snapshot");
        if ((result.outcome === "confirmed" || result.outcome === "deleted" || result.outcome === "started" || result.outcome === "requested" || result.outcome === "no_change") && !next) return rejected("missing-snapshot");
        let outcome = result.outcome;
        let detail = result.detail || null;
        let reconciled = !(presetOperation && outcome === "no_change");
        if (deletingComponent) {
            if (outcome === "no_change") reconciled = false;
            if (outcome === "confirmed") reconciled = Boolean(next.available === true &&
                next.maskGroupCount === result.deletion.after.length &&
                (next.maskGroupCount === 0 ? next.hasSelectedMaskGroup !== true :
                    next.active === true && next.hasSelectedMaskGroup === true && result.deletion.after.includes(next.selectedMaskGroupId) &&
                    (next.selectedMaskGroupId === pendingOperation.beforeSelectedMaskId ?
                        next.selectedMaskToolCount === result.componentDeletion.after.length &&
                        (next.selectedMaskToolCount === 0 ? next.selectedMaskToolAvailable === false :
                            next.selectedMaskToolAvailable === true && result.componentDeletion.after.includes(next.selectedMaskToolId)) :
                        next.selectedMaskToolAvailable === true || next.selectedMaskToolCount === 0)));
        }
        if (pendingOperation.kind === "create") {
            const type = maskingCorrections.creationType(pendingOperation.maskType, pendingOperation.maskSubtype);
            if (outcome === "no_change") reconciled = false;
            if (outcome === "confirmed") reconciled = Boolean(!type.instruction && next.available === true && next.active === true &&
                next.maskGroupCount === pendingOperation.beforeCount + 1 && next.hasSelectedMaskGroup === true &&
                next.selectedMaskGroupId !== pendingOperation.beforeSelectedMaskId && next.selectedMaskToolAvailable === true);
            if (outcome === "started") reconciled = Boolean(next.available !== true ?
                !["context_changed", "not_develop", "no_photo"].includes(next.unavailableReason) : next.active === true &&
                next.maskGroupCount >= pendingOperation.beforeCount && (type.instruction || next.maskGroupCount <= pendingOperation.beforeCount + 1));
        }
        if (pendingOperation.kind === "add" || pendingOperation.kind === "subtract") {
            const type = maskingCorrections.creationType(pendingOperation.maskType, pendingOperation.maskSubtype);
            const sameMask = next && next.available === true && next.active === true &&
                next.hasSelectedMaskGroup === true && next.maskGroupCount === pendingOperation.beforeCount &&
                next.selectedMaskGroupId === pendingOperation.beforeSelectedMaskId;
            if (outcome === "no_change") reconciled = false;
            if (outcome === "confirmed") reconciled = Boolean(!type.instruction && sameMask &&
                next.selectedMaskToolCount === pendingOperation.beforeToolCount + 1 &&
                next.selectedMaskToolAvailable === true && next.selectedMaskToolId !== pendingOperation.beforeSelectedMaskToolId);
            if (outcome === "started") reconciled = Boolean(next.available !== true ?
                !["context_changed", "not_develop", "no_photo"].includes(next.unavailableReason) : sameMask &&
                next.selectedMaskToolCount >= pendingOperation.beforeToolCount &&
                (type.instruction || next.selectedMaskToolCount <= pendingOperation.beforeToolCount + 1));
        }
        if (outcome === "confirmed" && pendingOperation.kind === "panel") {
            if (next.available !== true || next.active !== pendingOperation.open) reconciled = false;
            if (pendingOperation.open === true &&
                !((next.maskGroupCount === 0 && next.hasSelectedMaskGroup === false) ||
                    (next.maskGroupCount > 0 && next.hasSelectedMaskGroup === true &&
                        (next.selectedMaskToolAvailable === true || next.selectedMaskToolCount === 0)))) reconciled = false;
        }
        if (result.outcome === "confirmed" && pendingOperation.kind === "navigate") {
            const delta = pendingOperation.direction === "previous" ? -1 : 1;
            if (next.available !== true || next.active !== true || next.hasSelectedMaskGroup !== true ||
                next.maskGroupCount !== pendingOperation.beforeCount ||
                next.selectedMaskGroupIndex !== pendingOperation.beforeIndex + delta ||
                next.selectedMaskGroupId === pendingOperation.beforeSelectedMaskId) reconciled = false;
        }
        if (result.outcome === "confirmed" && pendingOperation.kind === "toolNavigate") {
            const delta = pendingOperation.direction === "previous" ? -1 : 1;
            if (next.available !== true || next.active !== true || next.hasSelectedMaskGroup !== true ||
                next.maskGroupCount !== pendingOperation.beforeCount ||
                next.selectedMaskGroupIndex !== pendingOperation.beforeIndex ||
                next.selectedMaskGroupId !== pendingOperation.beforeSelectedMaskId ||
                next.selectedMaskToolAvailable !== true ||
                next.selectedMaskToolCount !== pendingOperation.beforeToolCount ||
                next.selectedMaskToolIndex !== pendingOperation.beforeToolIndex + delta ||
                next.selectedMaskToolId === pendingOperation.beforeSelectedMaskToolId) reconciled = false;
        }
        if (result.outcome === "confirmed" && pendingOperation.kind === "deleteAll" &&
            (next.available !== true || next.maskGroupCount !== 0 ||
                next.hasSelectedMaskGroup === true)) reconciled = false;
        if (pendingOperation.kind === "deleteAll" && outcome === "no_change") reconciled = false;
        if (pendingOperation.kind === "deleteSelected" &&
            (outcome === "no_change" || outcome === "confirmed" && (next.available !== true ||
                next.maskGroupCount !== pendingOperation.beforeCount - 1 ||
                next.selectedMaskGroupId === pendingOperation.beforeSelectedMaskId ||
                next.maskGroupCount > 0 && (next.hasSelectedMaskGroup !== true || next.selectedMaskToolAvailable !== true && next.selectedMaskToolCount !== 0 ||
                    !result.deletion.after.includes(next.selectedMaskGroupId)) ||
                next.maskGroupCount === 0 && next.hasSelectedMaskGroup === true))) reconciled = false;
        if (result.outcome === "confirmed" &&
            (pendingOperation.kind === "resetSelected" || pendingOperation.kind === "preset" ||
                pendingOperation.kind === "pointColorPicker" || pendingOperation.kind === "pointColorVisualize") &&
            (next.available !== true || next.active !== true || next.hasSelectedMaskGroup !== true ||
                next.maskGroupCount !== pendingOperation.beforeCount ||
                next.selectedMaskGroupId !== pendingOperation.beforeSelectedMaskId ||
                next.selectedMaskToolAvailable !== pendingOperation.beforeSelectedMaskToolAvailable ||
                next.selectedMaskToolCount !== pendingOperation.beforeToolCount ||
                next.selectedMaskToolIndex !== pendingOperation.beforeToolIndex ||
                next.selectedMaskToolId !== pendingOperation.beforeSelectedMaskToolId)) reconciled = false;
        const sameVisibilitySelection = Boolean(next && next.available === true && next.active === true &&
            next.hasSelectedMaskGroup === true && next.maskGroupCount === pendingOperation.beforeCount &&
            next.selectedMaskGroupIndex === pendingOperation.beforeIndex &&
            next.selectedMaskGroupId === pendingOperation.beforeSelectedMaskId &&
            next.selectedMaskToolAvailable === true && next.selectedMaskToolCount === pendingOperation.beforeToolCount &&
            next.selectedMaskToolIndex === pendingOperation.beforeToolIndex &&
            next.selectedMaskToolId === pendingOperation.beforeSelectedMaskToolId);
        if (invertingComponent) {
            const known = typeof pendingOperation.beforeMaskToolInverted === "boolean";
            if (outcome === "no_change") reconciled = false;
            if (outcome === "confirmed" || outcome === "requested") {
                if (!sameVisibilitySelection || next.selectedMaskHidden !== pendingOperation.beforeMaskHidden ||
                    next.selectedMaskToolHidden !== pendingOperation.beforeMaskToolHidden) reconciled = false;
                if (outcome === "confirmed" && (!known || next.selectedMaskToolInverted !== !pendingOperation.beforeMaskToolInverted)) reconciled = false;
                if (outcome === "requested" && known) reconciled = false;
            }
        }
        if (result.outcome === "confirmed" && pendingOperation.kind === "maskVisibility" &&
            (!sameVisibilitySelection || next.selectedMaskHidden !== pendingOperation.hidden ||
                next.selectedMaskToolHidden !== pendingOperation.beforeMaskToolHidden)) reconciled = false;
        if (result.outcome === "confirmed" && pendingOperation.kind === "toolVisibility" &&
            (!sameVisibilitySelection || next.selectedMaskHidden !== pendingOperation.beforeMaskHidden ||
                next.selectedMaskToolHidden !== pendingOperation.hidden)) reconciled = false;
        if (result.outcome === "no_change" && pendingOperation.kind === "panel" &&
            next.active === pendingOperation.open) reconciled = false;
        if (result.outcome === "no_change" && pendingOperation.kind === "navigate" &&
            (next.maskGroupCount !== pendingOperation.beforeCount ||
                next.selectedMaskGroupIndex !== pendingOperation.beforeIndex ||
                next.selectedMaskGroupId !== pendingOperation.beforeSelectedMaskId)) reconciled = false;
        if (result.outcome === "no_change" && pendingOperation.kind === "toolNavigate" &&
            (next.maskGroupCount !== pendingOperation.beforeCount ||
                next.selectedMaskGroupIndex !== pendingOperation.beforeIndex ||
                next.selectedMaskGroupId !== pendingOperation.beforeSelectedMaskId ||
                next.selectedMaskToolCount !== pendingOperation.beforeToolCount ||
                next.selectedMaskToolIndex !== pendingOperation.beforeToolIndex ||
                next.selectedMaskToolId !== pendingOperation.beforeSelectedMaskToolId)) reconciled = false;
        if (result.outcome === "no_change" &&
            (pendingOperation.kind === "maskVisibility" || pendingOperation.kind === "toolVisibility") &&
            (!sameVisibilitySelection || next.selectedMaskHidden !== pendingOperation.beforeMaskHidden ||
                next.selectedMaskToolHidden !== pendingOperation.beforeMaskToolHidden)) reconciled = false;
        if (!reconciled) {
            outcome = deletingComponent && removalConfirmed ? "deleted" : "failed";
            detail = deletingComponent && removalConfirmed ? "Component deleted; Lightroom's replacement selection could not be confirmed." :
                presetOperation ? "Lightroom could not confirm the preset settings. Some settings may have changed." :
                "Lightroom's Masking result could not be reconciled safely.";
        }
        if (next) {
            const correctionSelectionChanged = correctionSelectionKey(snapshot) !== correctionSelectionKey(next);
            snapshot = next;
            capturedAt = nowProvider();
            if (correctionSelectionChanged) {
                correctionSelectionRevision = revision + 1;
                correctionResults.clear();
            }
        }
        lastResult = {
            ...componentResultTargets(pendingOperation),
            operationId: completedOperation.operationId,
            outcome: outcome,
            detail: detail,
            completedAt: nowProvider()
        };
        if (deletingComponent && removalConfirmed) Object.assign(lastResult, {
            parentRemoved, remainingComponentCount: result.componentDeletion.after.length
        });
        if (tracing) traceDeletion("settled", { operationId: completedOperation.operationId,
            removalConfirmed, reconciled, submittedOutcome: result.outcome, lastResult });
        if (presetOperation) {
            recordPresetDiagnostics({
                operationId: completedOperation.operationId,
                presetId: completedOperation.presetId,
                presetFile: completedOperation.presetFile,
                outcome: outcome,
                detail: detail,
                report: typeof result.presetDiagnostics === "string" ? result.presetDiagnostics : null,
                completedAt: lastResult.completedAt
            });
        }
        pendingOperation = null;
        queuedQuery = null;
        outstandingQuery = null;
        revision += 1;
        return true;
    }

    function rejectResult(result, fields, detail) {
        if (!operationResultMatches(result, fields)) return false;
        if (pendingOperation.kind === "preset") {
            recordPresetDiagnostics({
                operationId: pendingOperation.operationId,
                presetId: pendingOperation.presetId,
                presetFile: pendingOperation.presetFile,
                outcome: "failed",
                detail: detail || "Lightroom's Masking result was invalid.",
                report: null,
                completedAt: nowProvider()
            });
        }
        lastResult = {
            ...componentResultTargets(pendingOperation),
            operationId: pendingOperation.operationId,
            outcome: "failed",
            detail: detail || "Lightroom's Masking result was invalid.",
            completedAt: nowProvider()
        };
        snapshot = unavailableSnapshot("invalid_inventory");
        capturedAt = null;
        pendingOperation = null;
        queuedQuery = null;
        outstandingQuery = null;
        revision += 1;
        correctionSelectionRevision = revision;
        correctionResults.clear();
        return true;
    }

    return {
        getPublicState: publicState,
        getPresetDiagnosticState: function () {
            return JSON.parse(JSON.stringify({
                state: Object.assign(publicState(), { pointColorPresetCollection: snapshot.pointColorPresetCollection }),
                pending: pendingOperation,
                history: presetDiagnosticHistory
            }));
        },
        syncContext: syncContext,
        requestRefresh: requestRefresh,
        takeRequest: takeRequest,
        acceptQueryResult: acceptQueryResult,
        beginOperation: beginOperation,
        beginCorrection: beginCorrection,
        correctionAdmissionError: correctionAdmissionError,
        beginEdit: beginEdit,
        commandMatches: commandMatches,
        rejectCommand: rejectCommand,
        acceptCorrectionResult: acceptCorrectionResult,
        acceptEditResult: acceptEditResult,
        finishOperation: finishOperation,
        rejectResult: rejectResult,
        getLastPresetDiagnostics: function () {
            return lastPresetDiagnostics ? Object.assign({}, lastPresetDiagnostics) : null;
        },
        getServerEpoch: function () { return serverEpoch; }
    };
}

module.exports = {
    ID_PATTERN,
    MAX_MASK_GROUPS,
    MAX_MASK_TOOLS_PER_GROUP,
    SNAPSHOT_FRESH_MS,
    OPERATION_TIMEOUT_MS,
    validOpaqueId,
    validMaskName,
    sanitizeSnapshot,
    sameSemanticSnapshot,
    unavailableSnapshot,
    createMaskingState
};
