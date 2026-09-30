(function(root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LRBridgeControllerPeople = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
    "use strict";
    const contextKey = value => value && JSON.stringify([value.activeModule, value.selectedPhotoUuid, value.contextCounter,
        value.developCounter, value.contextChangedAt]);

    function createController(options) {
        const doc = options.document, fetcher = options.fetch;
        let section = null, controls = null, status = null, state = null, pollTimer = null, polling = false;
        let generation = 0, submitting = false, message = "", lastResultId = null;
        const requestTimeoutMs = Number.isSafeInteger(options.requestTimeoutMs) && options.requestTimeoutMs > 0 ? options.requestTimeoutMs : 8000;
        const busy = () => submitting || Boolean(state && state.pendingOperation);
        function notify() { if (options.onInteractionChange) options.onInteractionChange(); }
        async function json(path) {
            const controller = typeof AbortController === "function" ? new AbortController() : null;
            let timedOut = false;
            const timer = controller ? setTimeout(() => { timedOut = true; controller.abort(); }, requestTimeoutMs) : null;
            try {
                const response = await fetcher("/api" + path, { cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
                let body = null;
                try { body = await response.json(); } catch (_) { /* Report the HTTP failure below. */ }
                if (!response.ok || body && body.ok === false) {
                    const error = new Error("HTTP " + response.status);
                    error.userMessage = body && typeof body.error === "string" ? body.error : null;
                    throw error;
                }
                if (!body) throw new Error("People response was not valid JSON.");
                return body;
            } catch (error) {
                if (timedOut) { const timeout = new Error("People request timed out."); timeout.code = "PEOPLE_REQUEST_TIMEOUT"; throw timeout; }
                throw error;
            } finally { if (timer) clearTimeout(timer); }
        }
        function setEnabled(button, enabled) {
            button.disabled = !enabled; button.setAttribute("aria-disabled", enabled ? "false" : "true");
        }
        function userMessage(detail) {
            return /People inventory token mismatch|People count expected/.test(detail || "") ?
                "People detections changed. Refreshing; review them before removal." : detail;
        }
        function availability(operationKind) {
            if (busy()) return { enabled: false, reason: "A People request is already in progress." };
            if (!state) return { enabled: false, reason: "People controls are waiting for native SDK state." };
            if (!state.available) return { enabled: false, reason: state.reason || "Native People state is unavailable." };
            if (options.isBlocked && options.isBlocked()) return { enabled: false, reason: "People controls are temporarily unavailable while another Controller action finishes." };
            const supported = operationKind === "open" ? state.navigationSupported :
                operationKind === "detect" ? state.detectSupported : state.removeSupported;
            if (!supported) return { enabled: false, reason: operationKind === "remove" ? "People removal is unavailable in this Lightroom SDK." :
                operationKind === "detect" ? "People detection is unavailable in this Lightroom SDK." : "People navigation is unavailable in this Lightroom SDK." };
            if (operationKind !== "open" && !state.toolOpen) return { enabled: false, reason: "Open the Remove tool before using People." };
            if (operationKind === "remove" && (state.removalAvailable !== true || state.count < 1)) return {
                enabled: false, reason: state.removalReason || "Waiting for updated People detections from Lightroom." };
            return { enabled: true, reason: "" };
        }
        function render() {
            if (!section || !controls) return;
            const available = Boolean(state && state.available), pending = state && state.pendingOperation;
            setEnabled(controls.open, availability("open").enabled);
            setEnabled(controls.detect, availability("detect").enabled);
            setEnabled(controls.remove, availability("remove").enabled);
            if (pending) {
                status.textContent = pending.operationKind === "remove" && pending.phase === "requested" ?
                    "Removal request delivered; waiting for Lightroom callback." :
                    (pending.operationKind === "open" ? "Opening the People panel in Lightroom…" :
                        pending.operationKind === "detect" ? "Sending the People detection request…" : "Sending the People removal request…");
            } else if (state && !available) status.textContent = state.reason || "Native People state is unavailable.";
            else if (!submitting && state && state.refreshRequired) status.textContent =
                message ? message + " Waiting for updated People detections." : "Waiting for updated People detections from Lightroom.";
            else if (message) status.textContent = message;
            else if (!available) status.textContent = "People controls are waiting for native SDK state.";
            else if (!state.toolOpen) status.textContent = "Open the People panel before detection or removal.";
            else status.textContent = "Review People detections and exclusions in Lightroom.";
            if (!pending && !submitting && state && state.removalAvailable === true && state.count > 0) {
                status.textContent += " Lightroom reports " + state.count + " People targets.";
            }
        }
        function apply(next) {
            if (!next || contextKey(next) !== contextKey(options.getContext())) return;
            if (state && next.serverEpoch === state.serverEpoch && Number.isSafeInteger(next.revision) &&
                Number.isSafeInteger(state.revision) && next.revision < state.revision) return;
            state = next;
            const resultId = next.lastResult ? String(next.serverEpoch) + ":" + next.lastResult.operationId : null;
            if (next.lastResult && resultId !== lastResultId) {
                lastResultId = resultId;
                message = next.lastResult.operationKind === "open" && !next.toolOpen ? "" :
                    userMessage(next.lastResult.detail) || "People request finished.";
                if (next.lastResult.operationKind === "remove" && options.onHistoryChanged) options.onHistoryChanged();
            }
            render(); notify();
        }
        async function refresh() {
            if (polling || !section && !busy()) return;
            clearTimeout(pollTimer); polling = true; const current = generation;
            try { const next = await json("/people/state"); if (current === generation) apply(next); }
            catch (_) { if (current === generation) { state = null; message = "Could not read People state."; render(); notify(); } }
            finally { polling = false; if (section || busy()) pollTimer = setTimeout(refresh, 300); }
        }
        async function action(operationKind) {
            const allowed = availability(operationKind);
            if (!allowed.enabled) { message = allowed.reason; render(); notify(); return; }
            submitting = true;
            message = operationKind === "remove" ? "Submitting the People removal request…" :
                operationKind === "detect" ? "Submitting the People detection request…" :
                    "Submitting People panel navigation…";
            render(); notify(); const current = generation;
            try {
                const query = new URLSearchParams({ operationKind, selectedPhotoUuid: state.selectedPhotoUuid,
                    contextCounter: state.contextCounter, developCounter: state.developCounter,
                    contextChangedAt: state.contextChangedAt, serverEpoch: state.serverEpoch, stateRevision: state.revision });
                const next = await json("/people/action?" + query);
                if (current === generation) {
                    apply(next);
                    if (operationKind === "remove" && options.onSubmitted) options.onSubmitted();
                }
            } catch (error) {
                if (current === generation) {
                    message = error && error.code === "PEOPLE_REQUEST_TIMEOUT" ?
                        (operationKind === "remove" ? "Removal submission response timed out; Lightroom may still be processing. No retry was sent." :
                            "People submission response timed out; delivery is unconfirmed. No retry was sent.") :
                        error && error.userMessage ? userMessage(error.userMessage) :
                            (operationKind === "remove" ? "Could not submit the People removal request; delivery is unconfirmed. No retry was sent." :
                                "Could not submit the People request; delivery is unconfirmed. No retry was sent.");
                }
            } finally {
                if (current === generation) { submitting = false; render(); notify(); refresh(); }
            }
        }
        function element(tag, className, text) {
            const node = doc.createElement(tag); node.className = className; if (text) node.textContent = text; return node;
        }
        function button(text, label, kind) {
            const node = element("button", "", text); node.type = "button"; node.setAttribute("aria-label", label);
            node.addEventListener("click", () => action(typeof kind === "function" ? kind() : kind)); return node;
        }
        return {
            activate(parent) {
                section = element("section", "people-controls");
                section.appendChild(element("h4", "", "People"));
                section.appendChild(element("p", "remove-reset-defaults people-help",
                    "Open People in Lightroom. If detection has not started there, choose Detect People. Review detections and exclude unwanted selections before removal."));
                controls = {};
                const openRow = element("div", "people-open-row");
                controls.open = button("Open People Panel", "Open People panel in Lightroom", "open"); openRow.appendChild(controls.open);
                section.appendChild(openRow);
                const actionRow = element("div", "people-action-row");
                controls.detect = button("Detect People", "Detect distracting people", "detect");
                controls.remove = button("Remove Detected", "Remove reviewed distracting people detections", "remove");
                actionRow.append(controls.detect, controls.remove); section.appendChild(actionRow);
                const cancelHelp = element("p", "command-group-note people-help");
                cancelHelp.innerHTML = "To cancel, use <strong>Cancel</strong> in Lightroom Classic. This button is not available in the Web Controller.";
                section.appendChild(cancelHelp);
                status = element("div", "people-status"); status.setAttribute("role", "status"); section.appendChild(status);
                parent.appendChild(section); render(); refresh();
            },
            deactivate() { section = controls = status = null; clearTimeout(pollTimer); if (busy()) pollTimer = setTimeout(refresh, 0); },
            updateContext() {
                if (state && contextKey(state) !== contextKey(options.getContext())) {
                    generation++; state = null; submitting = false;
                    message = "Photo or Develop context changed; earlier People controls were cleared.";
                    render(); notify(); refresh();
                }
            },
            isInteracting: busy,
            refresh
        };
    }
    return { createController };
});
