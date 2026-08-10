"use strict";

function createHistoryState() {
    let state = { available: false, canUndo: false, canRedo: false };
    let refreshRequested = true;
    return {
        get: function () { return Object.assign({}, state); },
        update: function (next) {
            if (!next || typeof next.available !== "boolean" || typeof next.canUndo !== "boolean" || typeof next.canRedo !== "boolean" || Object.keys(next).length !== 3) return false;
            state = Object.assign({}, next); refreshRequested = false; return true;
        },
        invalidate: function () { state = { available: false, canUndo: false, canRedo: false }; refreshRequested = true; },
        requestRefresh: function () { refreshRequested = true; },
        takeRequest: function () { const requested = refreshRequested; refreshRequested = false; return requested; }
    };
}

module.exports = { createHistoryState };
