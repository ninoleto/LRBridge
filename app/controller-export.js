(function(root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LRBridgeControllerExport = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
    "use strict";
    const contextKey = s => s && JSON.stringify([s.activeModule, s.selectedPhotoUuid, s.contextCounter, s.developCounter, s.contextChangedAt]);
    function createController(options) {
        const doc = options.document;
        let section = null, selection = null, status = null, review = null, buttons = {}, state = null;
        let timer = null, polling = false, transport = false, unresolved = null, localReview = false, receivedAt = 0, message = "";
        let epoch = null, generation = 0, accepted = null;
        const retired = new Set();
        const busy = () => Boolean(transport || unresolved || state?.pendingOperation);
        const notify = () => options.onInteractionChange?.();
        async function json(path) {
            const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), options.requestTimeoutMs || 8000);
            try {
                const response = await options.fetch("/api/export/" + path, { cache: "no-store", signal: abort.signal });
                const body = await response.json();
                if (!response.ok || body.ok !== true) throw Error("Export request unconfirmed.");
                return body;
            } finally { clearTimeout(timeout); }
        }
        function fresh() {
            return state?.available && contextKey(state) === contextKey(options.getContext()) && typeof state.ageMs === "number" &&
                state.ageMs + Date.now() - receivedAt <= 5000;
        }
        function enabled(command) {
            return fresh() && !busy() && !localReview && !state.needsReview && !options.isBlocked?.() &&
                state[command === "export.dialog" ? "dialogSupported" : "previousSupported"];
        }
        function render() {
            if (!section) return;
            for (const [command, button] of Object.entries(buttons)) button.disabled = !enabled(command);
            selection.textContent = fresh() ? state.selectionCount + (state.selectionCount === 1 ? " photo selected in Lightroom." : " photos selected in Lightroom.") : "Waiting for Lightroom selection…";
            status.textContent = busy() ? "Waiting for Lightroom…" : localReview || state?.needsReview ?
                "Request unconfirmed. Check Lightroom before making another export request. No retry was sent." : message;
            review.hidden = !(localReview || state?.needsReview);
            review.disabled = busy() || !state;
        }
        function apply(next, startedAt) {
            if (!next || contextKey(next) !== contextKey(options.getContext()) || typeof next.serverEpoch !== "string" || retired.has(next.serverEpoch)) return false;
            if (epoch && next.serverEpoch !== epoch) {
                retired.add(epoch);
                if (unresolved || state?.pendingOperation) { localReview = true; unresolved = null; }
                accepted = null;
            }
            epoch = next.serverEpoch;
            if (accepted && (next.revision < accepted.revision || next.revision === accepted.revision && next.capturedAt < accepted.capturedAt)) return false;
            accepted = { revision: next.revision, capturedAt: next.capturedAt };
            state = next; receivedAt = startedAt;
            if (next.lastResult) message = next.lastResult.detail;
            if (unresolved && next.lastResult?.requestId === unresolved) unresolved = null;
            if (unresolved && !transport && next.pendingOperation?.requestId !== unresolved) { localReview = true; unresolved = null; }
            render(); notify(); return true;
        }
        async function refresh() {
            if (polling || !section && !busy()) return;
            clearTimeout(timer); polling = true; const version = generation, startedAt = Date.now();
            try { const next = await json("state"); if (version === generation) apply(next, startedAt); }
            catch (_) { if (version === generation) { state = null; message = "Could not read Lightroom selection."; render(); } }
            finally { polling = false; if (section || busy()) timer = setTimeout(refresh, 500); }
        }
        async function action(command) {
            if (!enabled(command)) return;
            const requestId = (options.requestId || (() => globalThis.crypto.randomUUID()))();
            const params = new URLSearchParams({ command, requestId, serverEpoch: state.serverEpoch, stateRevision: state.revision,
                selectionToken: state.selectionToken, activeModule: state.activeModule, selectedPhotoUuid: state.selectedPhotoUuid,
                contextCounter: state.contextCounter, developCounter: state.developCounter, contextChangedAt: state.contextChangedAt });
            const version = generation, startedAt = Date.now();
            transport = true; unresolved = requestId; message = ""; render(); notify();
            try { const next = await json("action?" + params); if (version === generation) apply(next, startedAt); }
            catch (_) { message = "Export request unconfirmed. No retry was sent."; }
            finally { transport = false; render(); notify(); refresh(); }
        }
        async function acknowledge() {
            if (busy() || !state) return;
            transport = true; render();
            try {
                if (state.needsReview) apply(await json("acknowledge?" + new URLSearchParams({ serverEpoch: state.serverEpoch,
                    operationId: state.lastResult.operationId })), Date.now());
                localReview = false; message = "Ready for a new request after Lightroom selection refresh.";
            } catch (_) { message = "Could not acknowledge the request. Check the connection."; }
            finally { transport = false; render(); notify(); refresh(); }
        }
        function element(tag, className, text) {
            const node = doc.createElement(tag); node.className = className; if (text) node.textContent = text; return node;
        }
        return {
            activate(parent) {
                section = element("section", "group export-controls"); buttons = {};
                section.appendChild(element("div", "group-title", "Export"));
                selection = element("div", "command-group-note export-selection"); section.appendChild(selection);
                const row = element("div", "command-grid export-button-row");
                for (const [command, label] of [["export.dialog", "Export…"], ["export.previous", "Export with Previous"]]) {
                    const button = buttons[command] = element("button", "command-primary", label);
                    button.type = "button"; button.dataset.exportAction = command; button.addEventListener("click", () => action(command)); row.appendChild(button);
                    if (command === "export.previous") button.setAttribute("aria-describedby", "exportPreviousHelp");
                }
                const help = element("p", "command-group-note", "Export with Previous reuses Lightroom’s last export settings and may start immediately.");
                help.id = "exportPreviousHelp";
                status = element("div", "command-group-note export-status"); status.setAttribute("role", "status");
                review = element("button", "command-neutral export-review", "I’ve checked Lightroom"); review.type = "button";
                review.addEventListener("click", acknowledge);
                section.append(row, help, status, review); parent.appendChild(section); render(); refresh();
            },
            deactivate() { section = selection = status = review = null; buttons = {}; clearTimeout(timer); if (busy()) timer = setTimeout(refresh, 0); },
            updateContext() {
                if (state && contextKey(state) !== contextKey(options.getContext())) { generation++; state = null; accepted = null; }
                render();
            },
            refresh, isInteracting: busy
        };
    }
    return { createController };
});
