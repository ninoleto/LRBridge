"use strict";

const crypto = require("crypto");

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
    "previousAvailable",
    "nextAvailable",
    "selectedMaskToolAvailable",
    "selectedMaskToolId",
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
        previousAvailable: false,
        nextAvailable: false,
        selectedMaskToolAvailable: false,
        selectedMaskToolId: null,
        selectedMaskToolCount: null,
        selectedMaskToolIndex: null,
        previousMaskToolAvailable: false,
        nextMaskToolAvailable: false
    };
}

function validOpaqueId(value) {
    return typeof value === "string" && value.length >= 1 && value.length <= 256 &&
        !/[\u0000-\u001f\u007f]/.test(value);
}

function sanitizeSnapshot(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.available !== "boolean") return null;
    if (input.available === false) {
        if (!VALID_UNAVAILABLE_REASONS.has(input.unavailableReason)) return null;
        return unavailableSnapshot(input.unavailableReason);
    }
    if (input.unavailableReason !== null && input.unavailableReason !== undefined) return null;
    if (typeof input.active !== "boolean" || !Number.isSafeInteger(input.maskGroupCount) ||
        input.maskGroupCount < 0 || input.maskGroupCount > MAX_MASK_GROUPS) return null;

    const selected = input.hasSelectedMaskGroup;
    if (input.active === false) {
        if (selected !== null || input.selectedMaskGroupIndex !== null || input.selectedMaskGroupId !== null ||
            input.previousAvailable !== false || input.nextAvailable !== false ||
            input.selectedMaskToolAvailable !== false || input.selectedMaskToolId !== null ||
            input.selectedMaskToolCount !== null || input.selectedMaskToolIndex !== null ||
            input.previousMaskToolAvailable !== false || input.nextMaskToolAvailable !== false) return null;
    } else {
        if (typeof selected !== "boolean") return null;
        if (!selected) {
            if (input.selectedMaskGroupIndex !== null || input.selectedMaskGroupId !== null ||
                input.previousAvailable !== false || input.nextAvailable !== false ||
                input.selectedMaskToolAvailable !== false || input.selectedMaskToolId !== null ||
                input.selectedMaskToolCount !== null || input.selectedMaskToolIndex !== null ||
                input.previousMaskToolAvailable !== false || input.nextMaskToolAvailable !== false) return null;
        } else {
            if (!Number.isSafeInteger(input.selectedMaskGroupIndex) || input.selectedMaskGroupIndex < 1 ||
                input.selectedMaskGroupIndex > input.maskGroupCount || !validOpaqueId(input.selectedMaskGroupId)) return null;
            if (input.previousAvailable !== (input.selectedMaskGroupIndex > 1) ||
                input.nextAvailable !== (input.selectedMaskGroupIndex < input.maskGroupCount) ||
                typeof input.selectedMaskToolAvailable !== "boolean" ||
                !Number.isSafeInteger(input.selectedMaskToolCount) || input.selectedMaskToolCount < 1 ||
                input.selectedMaskToolCount > MAX_MASK_TOOLS_PER_GROUP) return null;
            if (input.selectedMaskToolAvailable) {
                if (!validOpaqueId(input.selectedMaskToolId) || !Number.isSafeInteger(input.selectedMaskToolIndex) ||
                    input.selectedMaskToolIndex < 1 || input.selectedMaskToolIndex > input.selectedMaskToolCount ||
                    input.previousMaskToolAvailable !== (input.selectedMaskToolIndex > 1) ||
                    input.nextMaskToolAvailable !== (input.selectedMaskToolIndex < input.selectedMaskToolCount)) return null;
            } else if (input.selectedMaskToolId !== null || input.selectedMaskToolIndex !== null ||
                input.previousMaskToolAvailable !== false || input.nextMaskToolAvailable !== false) return null;
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
        previousAvailable: input.previousAvailable,
        nextAvailable: input.nextAvailable,
        selectedMaskToolAvailable: input.selectedMaskToolAvailable,
        selectedMaskToolId: input.selectedMaskToolId,
        selectedMaskToolCount: input.selectedMaskToolCount,
        selectedMaskToolIndex: input.selectedMaskToolIndex,
        previousMaskToolAvailable: input.previousMaskToolAvailable,
        nextMaskToolAvailable: input.nextMaskToolAvailable
    };
}

function sameSemanticSnapshot(left, right) {
    return Boolean(left && right && COMMAND_RELEVANT_SNAPSHOT_FIELDS.every(function (field) {
        return Object.is(left[field], right[field]);
    }));
}

function contextBinding(fields) {
    return {
        activeModule: fields.activeModule,
        selectedPhotoUuid: fields.selectedPhotoUuid,
        contextCounter: fields.contextCounter,
        developCounter: fields.developCounter,
        contextChangedAt: fields.contextChangedAt
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

function createMaskingState(options) {
    options = options || {};
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
    let requestCounter = 0;
    let operationCounter = 0;

    function publicState() {
        return Object.assign({
            ok: true,
            serverEpoch: serverEpoch,
            revision: revision,
            capturedAt: capturedAt,
            selectedPhotoUuid: binding ? binding.selectedPhotoUuid : null,
            contextCounter: binding ? binding.contextCounter : null,
            developCounter: binding ? binding.developCounter : null,
            contextChangedAt: binding ? binding.contextChangedAt : null,
            pendingOperation: pendingOperation ? {
                operationId: pendingOperation.operationId,
                kind: pendingOperation.kind,
                open: pendingOperation.open,
                direction: pendingOperation.direction
            } : null,
            lastResult: lastResult ? Object.assign({}, lastResult) : null
        }, snapshot);
    }

    function syncContext(fields) {
        const nextBinding = contextBinding(fields || {});
        const changed = !sameBinding(binding, nextBinding);
        if (!changed) return false;
        binding = nextBinding;
        snapshot = unavailableSnapshot(contextUnavailableReason(fields) || "context_changed");
        capturedAt = null;
        queuedQuery = null;
        outstandingQuery = null;
        if (pendingOperation) {
            lastResult = {
                operationId: pendingOperation.operationId,
                outcome: "stale",
                detail: "Lightroom context changed.",
                completedAt: nowProvider()
            };
        }
        pendingOperation = null;
        revision += 1;
        return true;
    }

    function requestRefresh(fields, force) {
        syncContext(fields);
        const now = nowProvider();
        if (pendingOperation && now - pendingOperation.startedAt > OPERATION_TIMEOUT_MS) {
            lastResult = {
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
        snapshot = next;
        capturedAt = nowProvider();
        outstandingQuery = null;
        if (changed) revision += 1;
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
        if (specification.kind === "panel" && typeof specification.open === "boolean") {
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
        } else return null;

        operationCounter += 1;
        revision += 1;
        queuedQuery = null;
        outstandingQuery = null;
        pendingOperation = Object.assign({
            operationId: "mo-" + operationCounter,
            kind: kind,
            open: open,
            direction: direction,
            startedAt: now,
            expectedMaskingRevision: revision,
            beforeIndex: snapshot.selectedMaskGroupIndex,
            beforeCount: snapshot.maskGroupCount,
            beforeSelectedMaskId: snapshot.selectedMaskGroupId,
            beforeToolIndex: snapshot.selectedMaskToolIndex,
            beforeToolCount: snapshot.selectedMaskToolCount,
            beforeSelectedMaskToolId: snapshot.selectedMaskToolId
        }, binding);
        return Object.assign({
            command: kind === "panel" ? "masking.panel.set" :
                (kind === "navigate" ? "masking.group.navigate" : "masking.tool.navigate"),
            operationId: pendingOperation.operationId,
            expectedActiveModule: "develop",
            expectedSelectedPhotoUuid: binding.selectedPhotoUuid,
            expectedContextCounter: binding.contextCounter,
            expectedDevelopCounter: binding.developCounter,
            expectedContextChangedAt: binding.contextChangedAt,
            expectedServerEpoch: serverEpoch,
            expectedMaskingRevision: revision
        }, kind === "panel" ? { open: open } : kind === "navigate" ? {
            direction: direction,
            expectedSelectedMaskId: snapshot.selectedMaskGroupId
        } : {
            direction: direction,
            expectedSelectedMaskId: snapshot.selectedMaskGroupId,
            expectedSelectedMaskToolId: snapshot.selectedMaskToolId
        });
    }

    function commandMatches(command, fields) {
        if (!pendingOperation || !command || command.operationId !== pendingOperation.operationId ||
            command.expectedServerEpoch !== serverEpoch || command.expectedMaskingRevision !== revision ||
            command.expectedActiveModule !== "develop" || command.expectedSelectedPhotoUuid !== binding.selectedPhotoUuid ||
            command.expectedContextCounter !== binding.contextCounter || command.expectedDevelopCounter !== binding.developCounter ||
            command.expectedContextChangedAt !== binding.contextChangedAt || !bindingMatches(binding, contextBinding(fields || {}))) return false;
        if (pendingOperation.kind === "panel") {
            return command.command === "masking.panel.set" && command.open === pendingOperation.open;
        }
        if (pendingOperation.kind === "navigate") {
            return command.command === "masking.group.navigate" && command.direction === pendingOperation.direction &&
                command.expectedSelectedMaskId === pendingOperation.beforeSelectedMaskId;
        }
        return command.command === "masking.tool.navigate" && command.direction === pendingOperation.direction &&
            command.expectedSelectedMaskId === pendingOperation.beforeSelectedMaskId &&
            command.expectedSelectedMaskToolId === pendingOperation.beforeSelectedMaskToolId;
    }

    function rejectCommand(command, detail) {
        if (!pendingOperation || !command || command.operationId !== pendingOperation.operationId) return false;
        lastResult = {
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

    function operationResultMatches(result, fields) {
        return Boolean(pendingOperation && result && result.operationId === pendingOperation.operationId &&
            result.expectedServerEpoch === serverEpoch && result.expectedMaskingRevision === revision &&
            result.expectedActiveModule === "develop" && result.expectedSelectedPhotoUuid === binding.selectedPhotoUuid &&
            result.expectedContextCounter === binding.contextCounter && result.expectedDevelopCounter === binding.developCounter &&
            result.expectedContextChangedAt === binding.contextChangedAt && bindingMatches(binding, contextBinding(fields || {})));
    }

    function finishOperation(result, fields) {
        if (!operationResultMatches(result, fields) || !["confirmed", "no_change", "failed", "stale"].includes(result.outcome)) return false;
        const next = result.snapshot === null ? null : sanitizeSnapshot(result.snapshot);
        if (result.snapshot !== null && !next) return false;
        if ((result.outcome === "confirmed" || result.outcome === "no_change") && !next) return false;
        let outcome = result.outcome;
        let detail = result.detail || null;
        let reconciled = true;
        if (outcome === "confirmed" && pendingOperation.kind === "panel" && next.active !== pendingOperation.open) reconciled = false;
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
        if (!reconciled) {
            outcome = "failed";
            detail = "Lightroom's Masking result could not be reconciled safely.";
        }
        if (next) {
            snapshot = next;
            capturedAt = nowProvider();
        }
        lastResult = {
            operationId: pendingOperation.operationId,
            outcome: outcome,
            detail: detail,
            completedAt: nowProvider()
        };
        pendingOperation = null;
        queuedQuery = null;
        outstandingQuery = null;
        revision += 1;
        return true;
    }

    function rejectResult(result, fields, detail) {
        if (!operationResultMatches(result, fields)) return false;
        lastResult = {
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
        return true;
    }

    return {
        getPublicState: publicState,
        syncContext: syncContext,
        requestRefresh: requestRefresh,
        takeRequest: takeRequest,
        acceptQueryResult: acceptQueryResult,
        beginOperation: beginOperation,
        commandMatches: commandMatches,
        rejectCommand: rejectCommand,
        finishOperation: finishOperation,
        rejectResult: rejectResult,
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
    sanitizeSnapshot,
    sameSemanticSnapshot,
    unavailableSnapshot,
    createMaskingState
};
