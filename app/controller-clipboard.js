(function(root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory(require("./controller-request-id"));
    else root.LRBridgeControllerClipboard = factory(root.LRBridgeRequestId);
})(typeof globalThis !== "undefined" ? globalThis : this, function(requestIds) {
    "use strict";
    const contextKey = s => s && JSON.stringify([s.activeModule, s.selectedPhotoUuid, s.contextCounter, s.developCounter, s.contextChangedAt]);
    function createController(options) {
        const doc = options.document;
        let buttons = {}, status = null, review = null, state = null, receivedAt = 0;
        let polling = false, transport = false, unresolved = null, localReview = false, timer = null, epoch = null, accepted = null;
        let message = "", reviewError = "", lastResultKey = null, section = null, readFailed = false;
        let requestIdFailure = null;
        const unconfirmedMessage = "Lightroom has not confirmed this copy or paste. Check Lightroom before trying again. Nothing was retried automatically.";
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
        function resultMessage(result) {
            if (!result) return "";
            let text = unconfirmedMessage;
            if (result.outcome === "stale") return "Copy or paste did not start. Check your selection in Lightroom and try again.";
            if (result.outcome === "success") {
                if (result.command === "clipboard.copy") return "Lightroom reported that the settings were copied.";
                if (result.command === "clipboard.paste") {
                    text = result.targetCount === 1 ? "Lightroom reported that the settings were pasted." :
                        result.targetCount > 1 ? "Lightroom reported pasting to at least one of " + result.targetCount +
                            " photos. Pasting is not confirmed for every photo; check each one in Lightroom." :
                            "Lightroom reported pasting. Check the selected photos to see which were updated.";
                }
            }
            if (result.command === "clipboard.paste" && result.invoked === true) {
                if (result.aiPendingCount > 0 && result.aiCheckedCount > 0) {
                    text += " AI edits still need updating on " + result.aiPendingCount + " of " + result.aiCheckedCount +
                        " checked photos. Allow Lightroom to finish any AI processing, then review the photos.";
                } else if (result.aiPendingCount === 0 && result.aiCheckedCount > 0) {
                    text += " No AI updates were reported as pending on the " + result.aiCheckedCount +
                        (result.aiCheckedCount === 1 ? " checked photo." : " checked photos.") + " Review the photos in Lightroom.";
                } else {
                    text += " AI processing status is unknown. Check the photos in Lightroom.";
                }
            }
            return text;
        }
        function render() {
            if (requestIdFailure && requestIdFailure.context !== contextKey(options.getContext())) requestIdFailure = null;
            if (!status) return;
            // Native disabled blurs a focused button in Chromium. Keep these persistent
            // toolbar buttons focusable; action() enforces the same guard for all input.
            for (const [command, button] of Object.entries(buttons)) {
                button.setAttribute("aria-disabled", String(!enabled(command)));
                button.disabled = false;
            }
            setText(status, readFailed ? "Could not get an update from Lightroom. Check the connection before trying again." :
                busy() ? "Waiting for Lightroom…" : localReview || state?.needsReview ?
                    (state?.lastResult?.outcome === "uncertain" ? resultMessage(state.lastResult) : unconfirmedMessage) +
                        (reviewError ? " " + reviewError : "") : requestIdFailure ? requestIdFailure.detail : message);
            status.classList.toggle("clipboard-paste-result", !requestIdFailure && !readFailed && !busy() && !localReview && !state?.needsReview &&
                state?.lastResult?.command === "clipboard.paste" && state.lastResult.outcome === "success" &&
                message === resultMessage(state.lastResult));
            review.hidden = !(localReview || state?.needsReview);
            review.disabled = busy() || !state;
            status.hidden = !status.textContent;
            options.onPresentationChange?.();
        }
        function apply(next, startedAt) {
            if (!next || typeof next.serverEpoch !== "string" || retired.has(next.serverEpoch)) return false;
            if (epoch && next.serverEpoch !== epoch) {
                retired.add(epoch);
                if (unresolved || state?.pendingOperation) { localReview = true; unresolved = null; }
                accepted = null;
                message = ""; reviewError = "";
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
                message = resultMessage(next.lastResult);
                const resultKey = epoch + ":" + next.lastResult.operationId;
                if (resultKey !== lastResultKey) {
                    lastResultKey = resultKey;
                    if (next.lastResult.command === "clipboard.paste") options.onPasteResult?.(next.lastResult);
                }
            }
            if (unresolved && next.lastResult?.requestId === unresolved) unresolved = null;
            if (unresolved && !transport && next.pendingOperation?.requestId !== unresolved) { localReview = true; unresolved = null; }
            if (!localReview && !next.needsReview) reviewError = "";
            render(); notify(); return true;
        }
        async function refresh() {
            if (polling || !status) return;
            clearTimeout(timer); polling = true; const startedAt = Date.now();
            try { apply(await json("state"), startedAt); }
            catch (_) { readFailed = true; receivedAt = 0; message = "Could not get an update from Lightroom. Check the connection before trying again."; render(); }
            finally { polling = false; timer = setTimeout(refresh, 750); }
        }
        async function action(command) {
            if (!enabled(command)) return;
            let requestId;
            requestIdFailure = null;
            try { requestId = (options.requestId || requestIds.createRequestId)(); }
            catch (_) {
                requestIdFailure = { command, context: contextKey(options.getContext()),
                    detail: "The command was not sent because this browser could not create a secure request ID. Reload the Web Controller and try again." };
                render(); notify(); return;
            }
            const params = new URLSearchParams({ command, requestId, serverEpoch: state.serverEpoch, stateRevision: state.revision,
                selectionToken: state.selectionToken, activeModule: state.activeModule, selectedPhotoUuid: state.selectedPhotoUuid,
                contextCounter: state.contextCounter, developCounter: state.developCounter, contextChangedAt: state.contextChangedAt });
            const startedAt = Date.now();
            transport = true; unresolved = requestId; message = ""; render(); notify();
            try { apply(await json("action?" + params), startedAt); }
            catch (_) { message = unconfirmedMessage; }
            finally { transport = false; render(); notify(); refresh(); }
        }
        async function acknowledge() {
            if (busy() || !state) return;
            reviewError = "";
            transport = true; render(); notify();
            try {
                if (state.needsReview) apply(await json("acknowledge?" + new URLSearchParams({ serverEpoch: state.serverEpoch,
                    operationId: state.lastResult.operationId })), Date.now());
                localReview = false; message = "Ready after Lightroom refreshes the selection.";
            } catch (_) { reviewError = "Could not record your review. Check the connection and try again."; }
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
                    button.setAttribute("aria-describedby", command === "clipboard.copy" ? "clipboardCopyHelp" : "clipboardPasteHelp");
                    button.addEventListener("click", () => action(command)); row.appendChild(button);
                }
                const chooseHelp = element("p", "command-group-note");
                chooseHelp.append(element("strong", "", "How to choose which settings to copy:"),
                    " In Lightroom Classic, select a photo and press ", element("strong", "", "Ctrl+Shift+C"),
                    ". Choose which settings to copy, then click ", element("strong", "", "Copy"),
                    ". Use this dialog again whenever you want to change those choices.");
                const copyHelp = element("p", "command-group-note");
                copyHelp.append(element("strong", "", "Quick Copy Settings:"),
                    " Copies the current photo’s settings using those choices, without opening the dialog.");
                copyHelp.id = "clipboardCopyHelp";
                const pasteHelp = element("p", "command-group-note"); pasteHelp.id = "clipboardPasteHelp";
                pasteHelp.append(element("strong", "", "Paste Settings:"),
                    " Select the destination photos, then click this button to apply the copied settings.");
                status = element("div", "command-group-note clipboard-status"); status.id = "clipboardStatus"; status.setAttribute("role", "status"); status.tabIndex = -1;
                review = element("button", "command-neutral clipboard-review", "I’ve checked Lightroom"); review.id = "clipboardReview"; review.type = "button";
                section.append(row, chooseHelp, copyHelp, pasteHelp, status, review);
                review.addEventListener("click", acknowledge); render(); refresh();
            },
            activate(parent) { parent.appendChild(section); render(); },
            deactivate() { section?.remove(); },
            showFeedback() { (review.hidden ? status : review).focus({ preventScroll: true }); section.scrollIntoView({ block: "center" }); },
            runAction: action, actionAvailable: enabled,
            getFeedback() {
                const needsReview = Boolean(localReview || state?.needsReview);
                if (requestIdFailure && !busy() && !needsReview && !readFailed) return {
                    busy: false, needsReview: false, kind: "error", command: requestIdFailure.command,
                    notice: "not sent", short: "Not sent", summary: "Command was not sent", detail: requestIdFailure.detail };
                return { busy: busy(), needsReview, detail: status?.textContent || "",
                    kind: needsReview ? "review" : busy() ? "pending" : readFailed || state?.lastResult?.outcome === "stale" ? "error" : state?.lastResult?.outcome === "success" ? "sent" : "idle",
                    key: state?.lastResult?.operationId, command: state?.pendingOperation?.command || (!busy() || needsReview ? state?.lastResult?.command : undefined),
                    notice: readFailed ? "feedback unavailable" : state?.lastResult?.outcome === "stale" ? "not sent" : "request unconfirmed",
                    short: readFailed ? "Unavailable" : busy() ? "Waiting" : needsReview ? "Check Lightroom" : state?.lastResult?.outcome === "success" ? state.lastResult.command === "clipboard.copy" ? "Copied" : "Paste result" :
                        state?.lastResult?.outcome === "stale" ? "Not sent" : "Result",
                    summary: readFailed ? "Could not get an update from Lightroom" : busy() ? "Waiting for Lightroom" : needsReview ? "Check Lightroom" : state?.lastResult?.outcome === "success" ?
                        state.lastResult.command === "clipboard.copy" ? "Settings copied" : "Paste result" : "Copy/paste result" };
            },
            updateContext: render, refresh, isInteracting: busy
        };
    }
    return { createController };
});
