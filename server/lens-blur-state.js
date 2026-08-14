"use strict";

const focalRangeDefinition = require("./lens-blur-focal-range");

const bokehValues = Object.freeze([
    "Circle",
    "SoapBubble",
    "Blade",
    "Ring",
    "Anamorphic"
]);

function unavailableState() {
    return {
        activeAvailable: false,
        active: null,
        bokehAvailable: false,
        bokeh: null,
        selectedToolAvailable: false,
        selectedTool: null,
        focalRangeAvailable: false,
        focalRange: null
    };
}

function cloneState(state) {
    const clone = Object.assign({}, state);
    if (state.focalRange !== null) clone.focalRange = Object.assign({}, state.focalRange);
    return clone;
}

function sanitizeState(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        typeof input.activeAvailable !== "boolean" ||
        typeof input.bokehAvailable !== "boolean" ||
        typeof input.selectedToolAvailable !== "boolean" ||
        typeof input.focalRangeAvailable !== "boolean") {
        return null;
    }

    const state = unavailableState();
    state.activeAvailable = input.activeAvailable;
    state.bokehAvailable = input.bokehAvailable;
    state.selectedToolAvailable = input.selectedToolAvailable;
    state.focalRangeAvailable = input.focalRangeAvailable;

    if (state.activeAvailable) {
        if (typeof input.active !== "boolean") return null;
        state.active = input.active;
    } else if (input.active !== null && input.active !== undefined) {
        return null;
    }

    if (state.bokehAvailable) {
        if (!bokehValues.includes(input.bokeh)) return null;
        state.bokeh = input.bokeh;
    } else if (input.bokeh !== null && input.bokeh !== undefined) {
        return null;
    }

    if (state.selectedToolAvailable) {
        if (typeof input.selectedTool !== "string" || input.selectedTool.length === 0) return null;
        state.selectedTool = input.selectedTool;
    } else if (input.selectedTool !== null && input.selectedTool !== undefined) {
        return null;
    }

    if (state.focalRangeAvailable) {
        state.focalRange = typeof input.focalRange === "string"
            ? focalRangeDefinition.parse(input.focalRange)
            : focalRangeDefinition.create(input.focalRange);
        if (state.focalRange === null) return null;
    } else if (input.focalRange !== null && input.focalRange !== undefined) {
        return null;
    }

    return state;
}

function createLensBlurState() {
    let state = unavailableState();
    let requestPending = false;
    let lastRequestAt = 0;
    let contextCounter = null;

    return {
        get: function () {
            return cloneState(state);
        },
        update: function (input) {
            const next = sanitizeState(input);
            if (next === null) return false;
            state = next;
            requestPending = false;
            return true;
        },
        invalidateBokeh: function () {
            state.bokehAvailable = false;
            state.bokeh = null;
        },
        invalidateActive: function () {
            state.activeAvailable = false;
            state.active = null;
        },
        invalidateSelectedTool: function () {
            state.selectedToolAvailable = false;
            state.selectedTool = null;
        },
        invalidateFocalRange: function () {
            state.focalRangeAvailable = false;
            state.focalRange = null;
        },
        requestRefresh: function (now, force) {
            now = now === undefined ? Date.now() : now;
            if (!force && (requestPending || now - lastRequestAt < 400)) return false;
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
                state = unavailableState();
                requestPending = false;
                lastRequestAt = 0;
            }
            contextCounter = nextCounter;
        },
        resetForTests: function () {
            state = unavailableState();
            requestPending = false;
            lastRequestAt = 0;
            contextCounter = null;
        }
    };
}

module.exports = {
    bokehValues,
    unavailableState,
    sanitizeState,
    createLensBlurState
};
