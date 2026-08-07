"use strict";

const IDLE_STATES = new Set(["unavailable", "ready"]);
const TERMINAL_STATES = new Set(["applied", "failed", "uncertain"]);
const OPERATION_STATES = new Set(["unavailable", "ready", "starting", "processing", "applied", "failed", "uncertain"]);
const ERROR_CATEGORIES = new Set([
    "not_develop", "no_photo", "unavailable", "already_applied", "invalid_amount",
    "duplicate", "sdk_error", "rejected", "state_error", "confirmation_timeout", "invalid_enabled"
]);

function unavailableState() {
    return {
        available: false,
        denoiseState: false,
        denoiseEnabled: false,
        denoiseAmount: null,
        rawDetailsState: false,
        rawDetailsEnabled: false,
        superResState: false,
        superResEnabled: false,
        enhanceNeedsUpdate: false,
        operation: "unavailable",
        info: "Enhance state unavailable"
    };
}

function createEnhanceState() {
    let state = unavailableState();
    let pending = false;
    let contextCounter = null;
    let requestPending = false;
    let lastRequestAt = 0;
    let amountPending = false;

    function sanitize(input) {
        if (!input || typeof input !== "object" || Array.isArray(input)) return null;
        if (!OPERATION_STATES.has(input.operation)) return null;
        const result = {};
        for (const field of ["available", "denoiseState", "denoiseEnabled", "rawDetailsState",
            "rawDetailsEnabled", "superResState", "superResEnabled", "enhanceNeedsUpdate"]) {
            if (typeof input[field] !== "boolean") return null;
            result[field] = input[field];
        }
        if (input.denoiseAmount === null) result.denoiseAmount = null;
        else if (Number.isInteger(input.denoiseAmount) && input.denoiseAmount >= 1 && input.denoiseAmount <= 100) {
            result.denoiseAmount = input.denoiseAmount;
        } else return null;
        result.operation = input.operation;
        if (typeof input.info === "string" && input.info.length <= 160) result.info = input.info;
        if (input.errorCategory !== undefined) {
            if (!ERROR_CATEGORIES.has(input.errorCategory)) return null;
            result.errorCategory = input.errorCategory;
        }
        if (input.requestedEnabled !== undefined) {
            if (typeof input.requestedEnabled !== "boolean") return null;
            result.requestedEnabled = input.requestedEnabled;
        }
        if (input.operationTarget !== undefined) {
            if (input.operationTarget !== "denoise" && input.operationTarget !== "rawDetails" && input.operationTarget !== "superResolution") return null;
            result.operationTarget = input.operationTarget;
        }
        return result;
    }

    return {
        get: function () { return Object.assign({}, state); },
        update: function (input) {
            const sanitized = sanitize(input);
            if (!sanitized) return false;
            if (pending && IDLE_STATES.has(sanitized.operation)) {
                sanitized.operation = "processing";
                sanitized.requestedEnabled = state.requestedEnabled;
                sanitized.operationTarget = state.operationTarget;
                delete sanitized.errorCategory;
            }
            if (amountPending) {
                sanitized.amountOperation = state.amountOperation;
                sanitized.requestedAmount = state.requestedAmount;
                if (state.amountErrorCategory) sanitized.amountErrorCategory = state.amountErrorCategory;
            }
            state = sanitized;
            requestPending = false;
            if (sanitized.operation === "starting" || sanitized.operation === "processing") pending = true;
            else if (TERMINAL_STATES.has(sanitized.operation)) pending = false;
            return true;
        },
        acceptAmountOperation: function (amount) {
            amountPending = true;
            state = Object.assign({}, state, { amountOperation: "starting", requestedAmount: amount });
        },
        updateAmount: function (input) {
            if (!input || !["starting", "processing", "applied", "failed", "uncertain"].includes(input.amountOperation) ||
                !Number.isInteger(input.requestedAmount) || input.requestedAmount < 1 || input.requestedAmount > 100) return false;
            const sanitized = sanitize(Object.assign({}, input, { operation: state.operation }));
            if (!sanitized) return false;
            state = Object.assign({}, state, sanitized, { amountOperation: input.amountOperation, requestedAmount: input.requestedAmount });
            delete state.amountErrorCategory;
            if (input.amountErrorCategory) state.amountErrorCategory = input.amountErrorCategory;
            amountPending = input.amountOperation === "starting" || input.amountOperation === "processing";
            return true;
        },
        acceptOperation: function (requestedEnabled, operationTarget) {
            if (pending || amountPending || !["denoise", "rawDetails", "superResolution"].includes(operationTarget)) return false;
            pending = true;
            state = Object.assign({}, state, { operation: "starting", requestedEnabled: requestedEnabled, operationTarget: operationTarget });
            delete state.errorCategory;
            return true;
        },
        cancelAdmission: function () {
            pending = false;
            state = Object.assign({}, state, {
                operation: state.available && state.denoiseEnabled && !state.denoiseState ? "ready" : "unavailable"
            });
        },
        isPending: function () { return pending; },
        requestRefresh: function (now, force) {
            now = now === undefined ? Date.now() : now;
            if (!force && (requestPending || now - lastRequestAt < 750)) return false;
            requestPending = true;
            lastRequestAt = now;
            return true;
        },
        takeRequest: function () {
            if (!requestPending) return false;
            requestPending = false;
            return true;
        },
        syncContext: function (nextCounter) {
            if (contextCounter !== null && nextCounter !== contextCounter) {
                const requestedEnabled = state.requestedEnabled;
                const operationTarget = state.operationTarget;
                const requestedAmount = state.requestedAmount;
                state = unavailableState();
                if (pending) {
                    state.operation = "processing";
                    state.info = "Enhance operation pending";
                    state.requestedEnabled = requestedEnabled;
                    state.operationTarget = operationTarget;
                }
                if (amountPending) {
                    state.amountOperation = "processing";
                    state.requestedAmount = requestedAmount;
                }
                requestPending = false;
                lastRequestAt = 0;
            }
            contextCounter = nextCounter;
        },
        resetForTests: function () {
            state = unavailableState(); pending = false; amountPending = false; contextCounter = null;
            requestPending = false; lastRequestAt = 0;
        },
        IDLE_STATES,
        TERMINAL_STATES
    };
}

module.exports = { createEnhanceState, OPERATION_STATES, ERROR_CATEGORIES, IDLE_STATES, TERMINAL_STATES };
