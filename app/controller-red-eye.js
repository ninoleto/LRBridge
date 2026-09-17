(function(root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LRBridgeControllerRedEye = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
    "use strict";
    const contextKey = s => s && JSON.stringify([s.activeModule, s.selectedPhotoUuid, s.contextCounter, s.developCounter, s.contextChangedAt]);
    function createController(options) {
        const doc = options.document;
        let section = null, buttons = {}, toolStatus = null, actionStatus = null, state = null;
        let timer = null, polling = false, generation = 0, transport = null, message = "", resultId = null, receivedAt = 0;
        let currentEpoch = null;
        let reconcileContext = null;
        let lastAccepted = null;
        const retiredEpochs = new Set();
        const busy = () => Boolean(reconcileContext || transport || state && state.pendingOperation);
        const notify = () => options.onInteractionChange?.();
        async function json(path) {
            const abort = new AbortController();
            const timeout = setTimeout(() => abort.abort(), options.requestTimeoutMs || 8000);
            try {
                const response = await options.fetch("/api/red-eye/" + path, { cache: "no-store", signal: abort.signal });
                const body = await response.json();
                if (!response.ok || body.ok !== true) throw Error(body.error || "Red Eye request failed.");
                return body;
            } finally { clearTimeout(timeout); }
        }
        function fresh() {
            return state && contextKey(state) === contextKey(options.getContext()) && state.activeModule === "develop" &&
                state.selectedPhotoUuid && state.available && typeof state.ageMs === "number" && state.ageMs + Date.now() - receivedAt <= 5000;
        }
        function enabled(kind) {
            if (!fresh() || busy() || options.isBlocked?.()) return false;
            return kind === "close" ? state.closeSupported && state.selectedTool === "redeye" :
                kind === "reset" ? state.resetSupported : state.openSupported;
        }
        function render() {
            if (!section) return;
            for (const [kind, button] of Object.entries(buttons)) {
                button.disabled = !enabled(kind); button.setAttribute("aria-disabled", String(button.disabled));
            }
            toolStatus.textContent = !fresh() ? "Tool status unavailable" : state.selectedTool === "redeye" ? "Tool open" : "Tool closed";
            actionStatus.textContent = busy() ? "Waiting for Lightroom…" : message;
        }
        function apply(next, startedAt = Date.now()) {
            if (!next || contextKey(next) !== contextKey(options.getContext())) return false;
            if (typeof next.serverEpoch !== "string" || retiredEpochs.has(next.serverEpoch)) return false;
            if (currentEpoch && currentEpoch !== next.serverEpoch) retiredEpochs.add(currentEpoch);
            currentEpoch = next.serverEpoch;
            if (lastAccepted && contextKey(next) === lastAccepted.context && next.serverEpoch === lastAccepted.epoch &&
                (next.revision < lastAccepted.revision || next.revision === lastAccepted.revision && next.capturedAt < lastAccepted.capturedAt)) return false;
            lastAccepted = { context: contextKey(next), epoch: next.serverEpoch, revision: next.revision, capturedAt: next.capturedAt };
            state = next; receivedAt = startedAt; reconcileContext = null;
            const id = next.lastResult && next.serverEpoch + ":" + next.lastResult.operationId;
            if (id && id !== resultId) {
                resultId = id;
                const r = next.lastResult;
                message = r.operationKind === "reset" && r.outcome === "requested" ? "Reset requested" : r.detail;
                if (r.operationKind === "reset") options.onHistoryChanged?.();
            }
            render(); notify(); return true;
        }
        async function refresh() {
            if (polling || !section && !busy()) return;
            clearTimeout(timer); polling = true; const current = generation, startedAt = Date.now(), priorState = state;
            try { const next = await json("state"); if (current === generation) apply(next, startedAt); }
            catch (_) {
                if (current === generation && state === priorState) {
                    if (busy()) reconcileContext = contextKey(options.getContext());
                    state = null; message = "Could not read Red Eye tool status."; render(); notify();
                }
            } finally {
                polling = false;
                if (section || busy()) timer = setTimeout(refresh, 300);
            }
        }
        async function action(operationKind) {
            if (!enabled(operationKind)) { render(); return; }
            const query = new URLSearchParams({ operationKind, selectedPhotoUuid: state.selectedPhotoUuid,
                contextCounter: state.contextCounter, developCounter: state.developCounter, contextChangedAt: state.contextChangedAt,
                serverEpoch: state.serverEpoch, stateRevision: state.revision });
            const request = { generation, base: contextKey(state), startedAt: Date.now() };
            transport = request; message = ""; render(); notify();
            if (operationKind === "reset") options.onSubmitted?.();
            try {
                const next = await json("action?" + query);
                if (generation !== request.generation || transport !== request) return;
                if (contextKey(next) !== request.base || next.pendingOperation?.operationKind !== operationKind) throw Error("Red Eye admission was not confirmed.");
                apply(next, request.startedAt);
            } catch (_) {
                if (generation === request.generation && transport === request) {
                    reconcileContext = request.base; state = null; message = "Red Eye request unconfirmed. No retry sent.";
                }
            } finally {
                if (transport === request) transport = null;
                render(); notify(); refresh();
            }
        }
        function element(tag, className, text) {
            const node = doc.createElement(tag); node.className = className; if (text) node.textContent = text; return node;
        }
        return {
            activate(parent) {
                section = element("div", "red-eye-controls"); buttons = {};
                for (const row of [[["red_eye", "Open Red Eye"], ["pet_eye", "Open Pet Eye"]], [["reset", "Reset Red Eye"], ["close", "Close"]]]) {
                    const host = element("div", "red-eye-button-row");
                    for (const [kind, label] of row) {
                        const button = buttons[kind] = element("button", "", label);
                        button.type = "button"; button.dataset.redEyeAction = kind;
                        button.addEventListener("click", () => action(kind)); host.appendChild(button);
                    }
                    section.appendChild(host);
                }
                toolStatus = element("div", "red-eye-tool-status"); toolStatus.setAttribute("role", "status");
                actionStatus = element("div", "red-eye-action-status"); actionStatus.setAttribute("role", "status");
                section.append(toolStatus, actionStatus, element("p", "remove-reset-defaults red-eye-help",
                    "Place corrections and adjust individual eyes in Lightroom."));
                parent.appendChild(section); render(); refresh();
            },
            deactivate() { section = toolStatus = actionStatus = null; buttons = {}; clearTimeout(timer); if (busy()) timer = setTimeout(refresh, 0); },
            updateContext() {
                if (state && contextKey(state) !== contextKey(options.getContext()) || transport && transport.base !== contextKey(options.getContext()) ||
                    reconcileContext && reconcileContext !== contextKey(options.getContext())) {
                    generation++; state = null; transport = null; reconcileContext = null; resultId = null; message = "";
                    render(); notify(); refresh();
                } else render();
            },
            isInteracting: busy, refresh
        };
    }
    return { createController };
});
