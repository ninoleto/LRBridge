"use strict";

// Bounded, process-local evidence only. Nothing in this module acknowledges an
// operation, refreshes SDK state, or changes command/selection ownership.
const VERSION = "mask-delete-confirmation-1";
function summarize(state) {
    if (!state) return null;
    const result = {};
    for (const key of ["serverEpoch", "revision", "selectedPhotoUuid", "contextCounter", "developCounter",
        "contextChangedAt", "capturedAt", "available", "unavailableReason", "active", "maskGroupCount",
        "hasSelectedMaskGroup", "selectedMaskGroupId", "selectedMaskGroupIndex", "selectedMaskToolAvailable",
        "selectedMaskToolId", "selectedMaskToolIndex", "pendingOperation", "lastResult"]) result[key] = state[key];
    return result;
}
function create() {
    const events = [];
    let sequence = 0;
    function record(event, data) {
        try {
            const encoded = JSON.stringify(data);
            events.push({ sequence: ++sequence, receivedAt: Date.now(), event,
                data: encoded.length <= 65536 ? JSON.parse(encoded) : { truncated: true, length: encoded.length } });
            if (events.length > 256) events.shift();
        } catch (_) { /* Diagnostics must never interfere with an adjustment. */ }
    }
    function hasOperation(id) {
        return typeof id === "string" && events.some(item => item.data && item.data.operationId === id);
    }
    return { record, hasOperation, read: () => ({ version: VERSION, events: JSON.parse(JSON.stringify(events)) }) };
}
module.exports = { VERSION, create, summarize };
