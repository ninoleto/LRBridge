"use strict";

const fields = ["HueShift", "SatScale", "LumScale", "Variance", "RangeAmount"];
const ranges = Object.freeze({ HueShift: [-1, 1], SatScale: [-1, 1], LumScale: [-1, 1], Variance: [-1, 1], RangeAmount: [0, 1] });
const rangeNames = ["HueRange", "SatRange", "LumRange"];
const boundaries = ["LowerNone", "LowerFull", "UpperFull", "UpperNone"];
const markerFields = Object.freeze({ HueRange: "HueRangeMarker", SatRange: "SatRangeMarker", LumRange: "LumRangeMarker" });
const markerEpsilon = 1e-10;
const minimumFullRangeWidth = 0.01;
const widthEpsilon = 2e-8;

function linearToDisplay(value) { return value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055; }
function getPointColorRangeMarker(rangeName, swatch) {
    if (!swatch || typeof swatch !== "object" || Array.isArray(swatch)) return null;
    if (rangeName === "HueRange") return 0.5;
    if (rangeName === "SatRange") return typeof swatch.SrcSat === "number" && Number.isFinite(swatch.SrcSat) && swatch.SrcSat >= 0 && swatch.SrcSat <= 1 ? swatch.SrcSat : null;
    if (rangeName === "LumRange") return typeof swatch.SrcLum === "number" && Number.isFinite(swatch.SrcLum) && swatch.SrcLum >= 0 && swatch.SrcLum <= 1 ? linearToDisplay(swatch.SrcLum) : null;
    return null;
}
function effectiveMarker(range, marker) {
    const nested = sanitizeNestedRange(range);
    if (!nested || typeof marker !== "number" || !Number.isFinite(marker) || marker < 0 || marker > 1) return null;
    return Math.max(nested.LowerFull, Math.min(marker, nested.UpperFull));
}
function rangeContainsMarker(range, marker) {
    const nested = sanitizeNestedRange(range);
    return !!nested && typeof marker === "number" && Number.isFinite(marker) && nested.LowerFull <= marker + markerEpsilon && nested.UpperFull + markerEpsilon >= marker;
}
function safeFullRangeWidth(range) {
    const nested = sanitizeNestedRange(range);
    return !!nested && nested.UpperFull - nested.LowerFull + widthEpsilon >= minimumFullRangeWidth;
}

function sanitizeNestedRange(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== boundaries.length ||
        Object.keys(value).some(function (key) { return !boundaries.includes(key); })) return null;
    const result = {};
    for (const boundary of boundaries) {
        if (typeof value[boundary] !== "number" || !Number.isFinite(value[boundary]) || value[boundary] < 0 || value[boundary] > 1) return null;
        result[boundary] = value[boundary];
    }
    if (!(result.LowerNone <= result.LowerFull && result.LowerFull <= result.UpperFull && result.UpperFull <= result.UpperNone)) return null;
    return result;
}

function unavailableState() { return { available: false, swatchCount: 0, selectedIndex: 0, selectionTransient: false }; }

function cloneState(value) {
    const copy = Object.assign({}, value);
    for (const name of rangeNames) if (copy[name]) copy[name] = Object.assign({}, copy[name]);
    return copy;
}

function createPointColorState() {
    let state = unavailableState();
    let requestPending = false;
    let lastRequestAt = 0;
    let contextCounter = null;
    let retainedSelected = null;
    function sanitize(input) {
        if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.available !== "boolean" ||
            !Number.isInteger(input.swatchCount) || input.swatchCount < 0 || input.swatchCount > 8 ||
            !Number.isInteger(input.selectedIndex) || input.selectedIndex < 0 || input.selectedIndex > 8 ||
            typeof input.selectionTransient !== "boolean") return null;
        const result = { available: input.available, swatchCount: input.swatchCount, selectedIndex: input.selectedIndex, selectionTransient: input.selectionTransient };
        if (!input.available) return input.swatchCount === 0 && input.selectedIndex === 0 && !input.selectionTransient ? result : null;
        if (input.swatchCount === 0) return input.selectedIndex === 0 && !input.selectionTransient ? result : null;
        if (input.selectedIndex === 0) {
            if (!input.selectionTransient) return null;
            if (!retainedSelected) return result;
            const retained = cloneState(retainedSelected);
            retained.swatchCount = input.swatchCount; retained.selectedIndex = 0; retained.selectionTransient = true;
            retained.displaySelectedIndex = retainedSelected.selectedIndex;
            return retained;
        }
        if (input.selectionTransient) return null;
        for (const field of fields) {
            const value = input[field]; const range = ranges[field];
            if (typeof value !== "number" || !Number.isFinite(value) || value < range[0] || value > range[1]) return null;
            result[field] = value;
        }
        for (const rangeName of rangeNames) {
            const nested = sanitizeNestedRange(input[rangeName]);
            if (!nested) return null;
            result[rangeName] = nested;
            const marker = effectiveMarker(nested, input[markerFields[rangeName]]);
            if (marker !== null) result[markerFields[rangeName]] = marker;
        }
        return result;
    }
    return {
        get: function () { return cloneState(state); },
        update: function (input) {
            const next = sanitize(input); if (!next) return false;
            state = next;
            if (next.swatchCount === 0 || !next.available) retainedSelected = null;
            else if (next.selectedIndex > 0 && !next.selectionTransient) retainedSelected = cloneState(next);
            requestPending = false; return true;
        },
        requestRefresh: function (now, force) { now = now === undefined ? Date.now() : now; if (!force && (requestPending || now - lastRequestAt < 400)) return false; requestPending = true; lastRequestAt = now; return true; },
        takeRequest: function () { if (!requestPending) return false; requestPending = false; return true; },
        syncContext: function (nextCounter) { if (contextCounter !== null && nextCounter !== contextCounter) { state = unavailableState(); retainedSelected = null; requestPending = false; lastRequestAt = 0; } contextCounter = nextCounter; },
        resetForTests: function () { state = unavailableState(); retainedSelected = null; requestPending = false; lastRequestAt = 0; contextCounter = null; }
    };
}

function validValue(field, value) { const range = ranges[field]; return !!range && typeof value === "number" && Number.isFinite(value) && value >= range[0] && value <= range[1]; }
function validRangeValue(rangeName, boundary, value) { return rangeNames.includes(rangeName) && boundaries.includes(boundary) && typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
function validRangeTranslation(rangeName, value) { return rangeNames.includes(rangeName) && !!sanitizeNestedRange(value); }

module.exports = { createPointColorState, fields, ranges, rangeNames, boundaries, markerFields, markerEpsilon, minimumFullRangeWidth, widthEpsilon, linearToDisplay, getPointColorRangeMarker, effectiveMarker, rangeContainsMarker, safeFullRangeWidth, sanitizeNestedRange, validValue, validRangeValue, validRangeTranslation };
