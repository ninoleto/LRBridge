"use strict";

const whiteBalanceOptions = Object.freeze([
    Object.freeze({ value: "As Shot", label: "As Shot", writable: false }),
    Object.freeze({ value: "Auto", label: "Auto", writable: true }),
    Object.freeze({ value: "Daylight", label: "Daylight", writable: true }),
    Object.freeze({ value: "Cloudy", label: "Cloudy", writable: true }),
    Object.freeze({ value: "Shade", label: "Shade", writable: true }),
    Object.freeze({ value: "Tungsten", label: "Tungsten", writable: true }),
    Object.freeze({ value: "Fluorescent", label: "Fluorescent", writable: true }),
    Object.freeze({ value: "Flash", label: "Flash", writable: true }),
    Object.freeze({ value: "Custom", label: "Custom", writable: false })
]);
const processOptions = Object.freeze([
    Object.freeze({ value: "Version 6", label: "Version 6 (Current)" }),
    Object.freeze({ value: "Version 5", label: "Version 5" }),
    Object.freeze({ value: "Version 4", label: "Version 4" }),
    Object.freeze({ value: "Version 3", label: "Version 3 (2012)" }),
    Object.freeze({ value: "Version 2", label: "Version 2 (2010)" }),
    Object.freeze({ value: "Version 1", label: "Version 1 (2003)" })
]);

const vignetteStyleOptions = Object.freeze([
    Object.freeze({ value: 1, label: "Highlight Priority" }),
    Object.freeze({ value: 2, label: "Color Priority" }),
    Object.freeze({ value: 3, label: "Paint Overlay" })
]);

const uprightModeOptions = Object.freeze([
    Object.freeze({ value: 0, label: "Off" }),
    Object.freeze({ value: 1, label: "Auto" }),
    Object.freeze({ value: 5, label: "Guided" }),
    Object.freeze({ value: 3, label: "Level" }),
    Object.freeze({ value: 4, label: "Vertical" }),
    Object.freeze({ value: 2, label: "Full" })
]);

const whiteBalanceValues = Object.freeze(whiteBalanceOptions.map(function (option) { return option.value; }));
const whiteBalanceWritableValues = Object.freeze(whiteBalanceOptions
    .filter(function (option) { return option.writable; })
    .map(function (option) { return option.value; }));
const processValues = Object.freeze(processOptions.map(function (option) { return option.value; }));
const vignetteStyleValues = Object.freeze(vignetteStyleOptions.map(function (option) { return option.value; }));
const uprightModeValues = Object.freeze(uprightModeOptions.map(function (option) { return option.value; }));
const constrainCropValues = Object.freeze([0, 1]);

const capabilities = Object.freeze({
    transformUpdate: Object.freeze({
        available: false,
        enabled: false,
        reason: "Lightroom Classic 15.3 does not expose a reliable SDK action or enabled-state query for Update."
    })
});

function unavailableState() {
    return {
        whiteBalanceAvailable: false,
        whiteBalance: null,
        processAvailable: false,
        process: null,
        vignetteStyleAvailable: false,
        vignetteStyle: null,
        uprightModeAvailable: false,
        uprightMode: null,
        constrainCropAvailable: false,
        constrainCrop: null,
        selectedToolAvailable: false,
        selectedTool: null
    };
}

function sanitizeState(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const state = unavailableState();
    for (const field of ["whiteBalanceAvailable", "processAvailable", "vignetteStyleAvailable", "uprightModeAvailable", "constrainCropAvailable", "selectedToolAvailable"]) {
        if (typeof input[field] !== "boolean") return null;
        state[field] = input[field];
    }

    if (state.whiteBalanceAvailable) {
        if (!whiteBalanceValues.includes(input.whiteBalance)) return null;
        state.whiteBalance = input.whiteBalance;
    } else if (input.whiteBalance !== null && input.whiteBalance !== undefined) return null;

    if (state.processAvailable) {
        if (!processValues.includes(input.process)) return null;
        state.process = input.process;
    } else if (input.process !== null && input.process !== undefined) return null;

    if (state.vignetteStyleAvailable) {
        if (!vignetteStyleValues.includes(input.vignetteStyle)) return null;
        state.vignetteStyle = input.vignetteStyle;
    } else if (input.vignetteStyle !== null && input.vignetteStyle !== undefined) return null;

    if (state.uprightModeAvailable) {
        if (!uprightModeValues.includes(input.uprightMode)) return null;
        state.uprightMode = input.uprightMode;
    } else if (input.uprightMode !== null && input.uprightMode !== undefined) return null;

    if (state.constrainCropAvailable) {
        if (!constrainCropValues.includes(input.constrainCrop)) return null;
        state.constrainCrop = input.constrainCrop;
    } else if (input.constrainCrop !== null && input.constrainCrop !== undefined) return null;

    if (state.selectedToolAvailable) {
        if (typeof input.selectedTool !== "string" || input.selectedTool.length === 0 || input.selectedTool.length > 64) return null;
        state.selectedTool = input.selectedTool;
    } else if (input.selectedTool !== null && input.selectedTool !== undefined) return null;

    return state;
}

function createDevelopCategoricalState() {
    let state = unavailableState();
    let revision = 0;
    let requestPending = false;
    let lastRequestAt = 0;
    let contextCounter = null;

    return {
        get: function () { return Object.assign({}, state); },
        getRevision: function () { return revision; },
        update: function (input) {
            const next = sanitizeState(input);
            if (next === null) return false;
            state = next;
            revision += 1;
            requestPending = false;
            return true;
        },
        invalidate: function (control) {
            if (control === "whiteBalance") {
                state.whiteBalanceAvailable = false;
                state.whiteBalance = null;
            } else if (control === "process") {
                state.processAvailable = false;
                state.process = null;
            } else if (control === "vignetteStyle") {
                state.vignetteStyleAvailable = false;
                state.vignetteStyle = null;
            } else if (control === "uprightMode") {
                state.uprightModeAvailable = false;
                state.uprightMode = null;
            } else if (control === "constrainCrop") {
                state.constrainCropAvailable = false;
                state.constrainCrop = null;
            } else if (control === "selectedTool") {
                state.selectedToolAvailable = false;
                state.selectedTool = null;
            }
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
            revision = 0;
            requestPending = false;
            lastRequestAt = 0;
            contextCounter = null;
        }
    };
}

module.exports = {
    whiteBalanceOptions,
    processOptions,
    vignetteStyleOptions,
    uprightModeOptions,
    whiteBalanceValues,
    whiteBalanceWritableValues,
    processValues,
    vignetteStyleValues,
    uprightModeValues,
    constrainCropValues,
    capabilities,
    unavailableState,
    sanitizeState,
    createDevelopCategoricalState
};
