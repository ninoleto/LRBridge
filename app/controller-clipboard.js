(function(root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LRBridgeControllerClipboard = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
    "use strict";
    const contextKey = s => s && JSON.stringify([s.activeModule, s.selectedPhotoUuid, s.contextCounter, s.developCounter, s.contextChangedAt]);
    function createController(options) {
        const doc = options.document;
        let buttons = {}, status = null, selection = null, review = null, state = null, receivedAt = 0;
        let polling = false, transport = false, unresolved = null, localReview = false, timer = null, epoch = null, accepted = null;
        let message = "", lastResultKey = null, section = null, summary = null, details = null, readFailed = false;
        const retired = new Set();
        const busy = () => Boolean(transport || unresolved || state?.pendingOperation);
        const notify = () => options.onInteractionChange?.();
        async function json(path) {
            const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), options.requestTimeoutMs || 8000);
            try {
                const response = await options.fetch("/api/clipboard/" + path, { cache: "no-store", signal: abort.signal });
                const body = await response.json();
                if (!response.ok || body.ok !== true) throw Error("Copy/paste request unconfirmed.");
                return body;
            } finally { clearTimeout(timeout); }
        }
        function fresh() {
            return state?.available && contextKey(state) === contextKey(options.getContext()) && typeof state.ageMs === "number" &&
                state.ageMs + Date.now() - receivedAt <= 5000;
        }
        function enabled(command) {
            return fresh() && !busy() && !localReview && !state.needsReview && !options.isBlocked?.() &&
                state[command === "clipboard.copy" ? "copySupported" : "pasteSupported"];
        }
        function setText(node, text) { if (node.textContent !== text) node.textContent = text; }
        function render() {
            if (!status) return;
            // Native disabled blurs a focused button in Chromium. Keep these persistent
            // toolbar buttons focusable; action() enforces the same guard for all input.
            for (const [command, button] of Object.entries(buttons)) {
                button.setAttribute("aria-disabled", String(!enabled(command)));
                button.disabled = false;
            }
            setText(selection, fresh() ? "Paste destination: " + state.selectionCount + (state.selectionCount === 1 ? " photo" : " photos") : "Paste destination: selection unavailable");
            setText(status, busy() ? "Waiting for Lightroom copy/paste feedback…" : localReview || state?.needsReview ?
                (state?.lastResult?.detail || "Request unconfirmed. Check Lightroom before another copy/paste request. No retry was sent.") : message);
            review.hidden = !(localReview || state?.needsReview);
            review.disabled = busy() || !state;
            status.hidden = !status.textContent;
            setText(summary, busy() ? "Waiting for Lightroom…" : localReview || state?.needsReview ? "Request unconfirmed. Check Lightroom, then review below." :
                readFailed ? "Copy/paste feedback unavailable. See Details." :
                state?.lastResult?.outcome === "success" ? state.lastResult.command === "clipboard.copy" ? "Lightroom reported settings copied." :
                    state.lastResult.targetCount > 1 ? "Lightroom reported paste for at least one photo. See Details." : "Lightroom reported paste. See Details for AI status." :
                    message ? "See Details for the latest response." : "");
            summary.hidden = !summary.textContent;
            options.onPresentationChange?.();
        }
        function apply(next, startedAt) {
            if (!next || typeof next.serverEpoch !== "string" || retired.has(next.serverEpoch)) return false;
            if (epoch && next.serverEpoch !== epoch) {
                retired.add(epoch);
                if (unresolved || state?.pendingOperation) { localReview = true; unresolved = null; }
                accepted = null;
            }
            if (accepted && next.serverEpoch === epoch &&
                (next.revision < accepted.revision || next.revision === accepted.revision && next.capturedAt < accepted.capturedAt)) return false;
            epoch = next.serverEpoch;
            accepted = { revision: next.revision, capturedAt: next.capturedAt };
            state = next; receivedAt = startedAt;
            readFailed = false;
            // Receipts describe their captured targets even after navigation or Paste's own
            // Develop changes. Only fresh matching context can enable a NEW action.
            if (next.lastResult) {
                message = next.lastResult.detail;
                const resultKey = epoch + ":" + next.lastResult.operationId;
                if (resultKey !== lastResultKey) {
                    lastResultKey = resultKey;
                    if (next.lastResult.command === "clipboard.paste") options.onPasteResult?.(next.lastResult);
                }
            }
            if (unresolved && next.lastResult?.requestId === unresolved) unresolved = null;
            if (unresolved && !transport && next.pendingOperation?.requestId !== unresolved) { localReview = true; unresolved = null; }
            render(); notify(); return true;
        }
        async function refresh() {
            if (polling || !status) return;
            clearTimeout(timer); polling = true; const startedAt = Date.now();
            try { apply(await json("state"), startedAt); }
            catch (_) { readFailed = true; receivedAt = 0; message = "Could not read Lightroom copy/paste state."; render(); }
            finally { polling = false; timer = setTimeout(refresh, 750); }
        }
        async function action(command) {
            if (!enabled(command)) return;
            const requestId = (options.requestId || (() => globalThis.crypto.randomUUID()))();
            const params = new URLSearchParams({ command, requestId, serverEpoch: state.serverEpoch, stateRevision: state.revision,
                selectionToken: state.selectionToken, activeModule: state.activeModule, selectedPhotoUuid: state.selectedPhotoUuid,
                contextCounter: state.contextCounter, developCounter: state.developCounter, contextChangedAt: state.contextChangedAt });
            const startedAt = Date.now();
            transport = true; unresolved = requestId; message = ""; render(); notify();
            try { apply(await json("action?" + params), startedAt); }
            catch (_) { message = "Copy/paste request unconfirmed. No retry was sent."; }
            finally { transport = false; render(); notify(); refresh(); }
        }
        async function acknowledge() {
            if (busy() || !state) return;
            transport = true; render(); notify();
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
            initialize() {
                section = element("section", "group clipboard-controls"); section.id = "clipboardSection";
                section.appendChild(element("div", "group-title", "Copy / Paste Settings"));
                const row = element("div", "command-grid clipboard-button-row");
                for (const [command, id, label] of [["clipboard.copy", "copySettingsButton", "Quick Copy Settings"], ["clipboard.paste", "pasteSettingsButton", "Paste Settings"]]) {
                    const button = buttons[command] = element("button", "command-primary", label);
                    button.id = id; button.type = "button";
                    if (command === "clipboard.copy") button.title = "Copies settings from the active photo without opening a dialog. Uses the categories last selected in Lightroom’s Copy Settings dialog.";
                    button.setAttribute("aria-describedby", command === "clipboard.copy" ? "clipboardCopyHelp" : "clipboardPasteHelp clipboardSelectionCount");
                    button.addEventListener("click", () => action(command)); row.appendChild(button);
                }
                const copyHelp = element("p", "command-group-note", "Choose the settings categories in Lightroom’s Copy Settings dialog. Use Quick Copy Settings to copy the active photo’s current settings, select destination photos, then Paste Settings. Copying directly in Lightroom also works; Quick Copy is not required.");
                copyHelp.id = "clipboardCopyHelp";
                selection = element("p", "command-group-note clipboard-selection"); selection.id = "clipboardSelectionCount";
                const pasteHelp = element("p", "command-group-note", "Paste targets the shown selection. Allow Lightroom to process AI edits, then review the destination photos."); pasteHelp.id = "clipboardPasteHelp";
                details = element("details", "clipboard-details");
                details.appendChild(element("summary", "", "Details"));
                const scope = element("p", "command-group-note", "Photo-level actions, including in Masking. You can copy directly in Lightroom; a web Copy is not required. Clipboard contents and validity cannot be inspected."); scope.id = "clipboardScopeHelp";
                details.append(scope, element("p", "command-group-note", "Paste uses the clipboard available when Lightroom runs the request. Existing AI edits may also be affected. A batch result does not confirm success for every photo, and pending AI status does not confirm completed processing or visual results."));
                status = element("div", "command-group-note clipboard-status"); status.id = "clipboardStatus"; status.setAttribute("role", "status"); status.tabIndex = -1;
                summary = element("p", "command-group-note clipboard-status"); summary.id = "clipboardSummary"; summary.setAttribute("role", "status");
                review = element("button", "command-neutral clipboard-review", "I’ve checked Lightroom"); review.id = "clipboardReview"; review.type = "button";
                details.appendChild(status);
                section.append(row, copyHelp, selection, pasteHelp, summary, details, review);
                review.addEventListener("click", acknowledge); render(); refresh();
            },
            activate(parent) { parent.appendChild(section); render(); },
            deactivate() { section?.remove(); },
            showFeedback() { details.open = true; (review.hidden ? status : review).focus({ preventScroll: true }); section.scrollIntoView({ block: "center" }); },
            runAction: action, actionAvailable: enabled,
            getFeedback() {
                const needsReview = Boolean(localReview || state?.needsReview);
                return { busy: busy(), needsReview, detail: status?.textContent || "",
                    kind: needsReview ? "review" : busy() ? "pending" : readFailed || state?.lastResult?.outcome === "stale" ? "error" : state?.lastResult?.outcome === "success" ? "sent" : "idle",
                    key: state?.lastResult?.operationId, command: state?.pendingOperation?.command || (!busy() || needsReview ? state?.lastResult?.command : undefined),
                    notice: readFailed ? "feedback unavailable" : state?.lastResult?.outcome === "stale" ? "not sent" : "request unconfirmed",
                    short: readFailed ? "Unavailable" : state?.lastResult?.outcome === "success" ? state.lastResult.command === "clipboard.copy" ? "Copied" : "Paste result" :
                        state?.lastResult?.outcome === "stale" ? "Not sent" : "Result",
                    summary: busy() ? "Copy/paste pending" : needsReview ? "Review copy/paste" : state?.lastResult?.outcome === "success" ?
                        state.lastResult.command === "clipboard.copy" ? "Settings copied" : "Paste reported" : "Copy/paste details" };
            },
            updateContext: render, refresh, isInteracting: busy
        };
    }
    return { createController };
});
