(function (root, factory) {
    "use strict";
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.LRBridgeControllerMasking = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const POLL_MS = 450;

    function sameContext(state, context) {
        return Boolean(state && context && state.selectedPhotoUuid === context.selectedPhotoUuid &&
            state.contextCounter === context.contextCounter && state.developCounter === context.developCounter &&
            state.contextChangedAt === context.contextChangedAt);
    }

    function acceptState(current, next, context) {
        if (!next || next.ok !== true || typeof next.serverEpoch !== "string" ||
            !Number.isSafeInteger(next.revision) || next.revision < 0 || !sameContext(next, context)) return current;
        if (current && current.serverEpoch === next.serverEpoch && current.revision > next.revision) return current;
        return next;
    }

    function confirmedMaskIndex(state) {
        return state && state.available === true && state.active === true &&
            state.hasSelectedMaskGroup === true && Number.isSafeInteger(state.selectedMaskGroupIndex) &&
            Number.isSafeInteger(state.maskGroupCount) && state.maskGroupCount > 0
            ? state.selectedMaskGroupIndex : null;
    }

    function clampMaskIndex(index, count) {
        if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || count < 1) return null;
        return Math.max(1, Math.min(count, index));
    }

    function confirmedMaskToolIndex(state) {
        return state && state.available === true && state.active === true &&
            state.hasSelectedMaskGroup === true && state.selectedMaskToolAvailable === true &&
            Number.isSafeInteger(state.selectedMaskToolIndex) &&
            Number.isSafeInteger(state.selectedMaskToolCount) && state.selectedMaskToolCount > 0
            ? state.selectedMaskToolIndex : null;
    }

    function navigationBindingKey(state) {
        if (!state || typeof state.serverEpoch !== "string" || typeof state.selectedPhotoUuid !== "string" ||
            !Number.isSafeInteger(state.contextCounter) || !Number.isSafeInteger(state.developCounter) ||
            !Number.isSafeInteger(state.contextChangedAt)) return null;
        return [state.serverEpoch, state.selectedPhotoUuid, state.contextCounter,
            state.developCounter, state.contextChangedAt].join("\u001f");
    }

    function toolNavigationBindingKey(state) {
        const binding = navigationBindingKey(state);
        return binding !== null && state && typeof state.selectedMaskGroupId === "string"
            ? binding + "\u001f" + state.selectedMaskGroupId : null;
    }

    function serverOperationMatchesActive(serverOperation, activeOperation) {
        if (!serverOperation || !activeOperation || serverOperation.kind !== activeOperation.kind) return false;
        if (activeOperation.operationId && serverOperation.operationId !== activeOperation.operationId) return false;
        if (activeOperation.kind === "panel") return serverOperation.open === activeOperation.open;
        if (activeOperation.kind === "maskVisibility" || activeOperation.kind === "toolVisibility") {
            return serverOperation.hidden === activeOperation.hidden;
        }
        return serverOperation.direction === activeOperation.direction;
    }

    function unavailableMessage(reason, context) {
        if (!context || context.activeModule !== "develop") return "Open a photo in Develop to use Masking.";
        if (!context.selectedPhotoUuid) return "Select a photo in Develop to use Masking.";
        if (reason === "sdk_unavailable") return "Masking is not available in this Lightroom version.";
        if (reason === "invalid_inventory" || reason === "unreconciled_selection" || reason === "unreconciled_tool") {
            return "Lightroom’s current masks could not be read safely.";
        }
        if (reason === "sdk_error") return "Lightroom could not report Masking right now.";
        return "Refreshing Masking state…";
    }

    function present(state, context, local) {
        local = local || {};
        const contextReady = Boolean(context && context.activeModule === "develop" && context.selectedPhotoUuid);
        const confirmed = contextReady && state && sameContext(state, context) ? state : null;
        const activeOperation = local.activeOperation || null;
        const serverOperation = confirmed && confirmed.pendingOperation ? confirmed.pendingOperation : null;
        const operation = activeOperation || serverOperation;
        const navigating = local.navigationIntentActive === true;
        const toolNavigating = local.toolNavigationIntentActive === true;
        const confirmedIndex = confirmedMaskIndex(confirmed);
        const desiredIndex = confirmed && navigating
            ? clampMaskIndex(local.desiredMaskGroupIndex, confirmed.maskGroupCount) : confirmedIndex;
        const confirmedToolIndex = confirmedMaskToolIndex(confirmed);
        const desiredToolIndex = confirmed && toolNavigating
            ? clampMaskIndex(local.desiredMaskToolIndex, confirmed.selectedMaskToolCount) : confirmedToolIndex;
        const foreignOperation = Boolean(serverOperation &&
            !serverOperationMatchesActive(serverOperation, activeOperation));
        const presentation = {
            panelLabel: confirmed && confirmed.available === true && confirmed.active === true ? "Close Masking" : "Open Masking",
            panelDisabled: true,
            previousDisabled: true,
            nextDisabled: true,
            previousComponentDisabled: true,
            nextComponentDisabled: true,
            maskVisibilityLabel: "Hide Mask",
            maskVisibilityAriaLabel: "Hide Mask",
            maskVisibilityTitle: "",
            maskVisibilityDisabled: true,
            maskVisibilityHidden: false,
            componentVisibilityLabel: "Hide Component",
            componentVisibilityAriaLabel: "Hide Component",
            componentVisibilityTitle: "",
            componentVisibilityDisabled: true,
            componentVisibilityHidden: false,
            position: contextReady ? "Reading Masking state…" : unavailableMessage(null, context),
            componentPosition: "",
            status: "",
            statusKind: "",
            confirmed: confirmed
        };
        if (!confirmed) return presentation;
        if (confirmed.available !== true) {
            presentation.position = unavailableMessage(confirmed.unavailableReason, context);
            if (local.error) {
                presentation.statusKind = "error";
                presentation.status = local.error;
            }
            return presentation;
        }
        const navigationReady = confirmed.active === true && confirmedIndex !== null;
        const navigationBlocked = Boolean((operation && operation.kind !== "navigate") || foreignOperation || toolNavigating);
        const toolNavigationReady = navigationReady && confirmedToolIndex !== null;
        const toolNavigationBlocked = Boolean((operation && operation.kind !== "toolNavigate") ||
            foreignOperation || navigating);
        const visibilityReady = toolNavigationReady && typeof confirmed.selectedMaskHidden === "boolean" &&
            typeof confirmed.selectedMaskToolHidden === "boolean";
        const visibilityBlocked = Boolean(operation || foreignOperation || navigating || toolNavigating);
        presentation.panelDisabled = Boolean(operation || navigating || toolNavigating);
        presentation.previousDisabled = !navigationReady || navigationBlocked || desiredIndex <= 1;
        presentation.nextDisabled = !navigationReady || navigationBlocked || desiredIndex >= confirmed.maskGroupCount;
        presentation.previousComponentDisabled = !toolNavigationReady || toolNavigationBlocked || desiredToolIndex <= 1;
        presentation.nextComponentDisabled = !toolNavigationReady || toolNavigationBlocked ||
            desiredToolIndex >= confirmed.selectedMaskToolCount;
        presentation.maskVisibilityLabel = confirmed.selectedMaskHidden === true ? "Mask Hidden" : "Hide Mask";
        presentation.maskVisibilityAriaLabel = confirmed.selectedMaskHidden === true ? "Show Mask" : "Hide Mask";
        presentation.maskVisibilityTitle = confirmed.selectedMaskHidden === true ? "Click to show mask" : "";
        presentation.maskVisibilityHidden = confirmed.selectedMaskHidden === true;
        presentation.componentVisibilityLabel = confirmed.selectedMaskToolHidden === true
            ? "Component Hidden" : "Hide Component";
        presentation.componentVisibilityAriaLabel = confirmed.selectedMaskToolHidden === true
            ? "Show Component" : "Hide Component";
        presentation.componentVisibilityTitle = confirmed.selectedMaskToolHidden === true
            ? "Click to show component" : "";
        presentation.componentVisibilityHidden = confirmed.selectedMaskToolHidden === true;
        presentation.maskVisibilityDisabled = !visibilityReady || visibilityBlocked;
        presentation.componentVisibilityDisabled = !visibilityReady || visibilityBlocked;
        if (confirmed.maskGroupCount === 0) presentation.position = "No masks available.";
        else if (confirmed.active !== true) {
            presentation.position = confirmed.maskGroupCount === 1
                ? "1 mask on this photo."
                : confirmed.maskGroupCount + " masks on this photo.";
        } else if (confirmed.hasSelectedMaskGroup !== true) presentation.position = "No mask is selected.";
        else presentation.position = "Mask " + confirmed.selectedMaskGroupIndex + " of " + confirmed.maskGroupCount;
        if (confirmed.active === true && confirmed.hasSelectedMaskGroup === true) {
            presentation.componentPosition = confirmed.selectedMaskToolAvailable === true
                ? "Component " + confirmed.selectedMaskToolIndex + " of " + confirmed.selectedMaskToolCount
                : "No mask component is selected.";
        }

        if (local.error) {
            presentation.statusKind = "error";
            presentation.status = local.error;
        } else if (navigating && desiredIndex !== null) {
            presentation.statusKind = "pending";
            presentation.status = "Moving to Mask " + desiredIndex + "…";
        } else if (toolNavigating && desiredToolIndex !== null) {
            presentation.statusKind = "pending";
            presentation.status = "Moving to Component " + desiredToolIndex + "…";
        } else if (operation) {
            presentation.statusKind = "pending";
            if (operation.kind === "panel") presentation.status = operation.open ? "Opening Masking…" : "Closing Masking…";
            else if (operation.kind === "navigate") presentation.status = "Updating mask selection…";
            else if (operation.kind === "toolNavigate") presentation.status = "Updating mask component selection…";
            else if (operation.kind === "maskVisibility") {
                presentation.status = operation.hidden ? "Hiding Mask…" : "Showing Mask…";
            } else presentation.status = operation.hidden ? "Hiding Component…" : "Showing Component…";
        }
        return presentation;
    }

    function createButton(documentRef, label, className) {
        const button = documentRef.createElement("button");
        button.type = "button";
        button.textContent = label;
        if (className) button.className = className;
        return button;
    }

    function createVisibilityIcon(documentRef, hidden) {
        const namespace = "http://www.w3.org/2000/svg";
        const svg = documentRef.createElementNS(namespace, "svg");
        svg.setAttribute("class", hidden ? "masking-eye-icon masking-eye-off-icon" :
            "masking-eye-icon masking-eye-open-icon");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        function path(data) {
            const element = documentRef.createElementNS(namespace, "path");
            element.setAttribute("d", data);
            svg.appendChild(element);
        }
        if (hidden) {
            path("M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.45 18.45 0 0 1 5.06-5.94");
            path("M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19");
            path("M14.12 14.12a3 3 0 1 1-4.24-4.24");
            path("M1 1l22 22");
        } else {
            path("M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z");
            const pupil = documentRef.createElementNS(namespace, "circle");
            pupil.setAttribute("cx", "12");
            pupil.setAttribute("cy", "12");
            pupil.setAttribute("r", "3");
            svg.appendChild(pupil);
        }
        return svg;
    }

    function createVisibilityButton(documentRef, label, className) {
        const button = createButton(documentRef, "", "masking-visibility-button " + className);
        const icon = createVisibilityIcon(documentRef, false);
        const text = documentRef.createElement("span");
        text.className = "masking-visibility-label";
        text.textContent = label;
        button.setAttribute("aria-label", label);
        button.appendChild(icon);
        button.appendChild(text);
        return { button: button, icon: icon, text: text, hidden: false };
    }

    function renderVisibilityButton(control, label, ariaLabel, title, hidden, disabled) {
        if (control.hidden !== hidden) {
            const icon = createVisibilityIcon(control.button.ownerDocument, hidden);
            control.button.replaceChild(icon, control.icon);
            control.icon = icon;
            control.hidden = hidden;
        }
        control.text.textContent = label;
        control.button.classList.toggle("masking-visibility-visible", !hidden);
        control.button.classList.toggle("masking-visibility-hidden", hidden);
        control.button.setAttribute("aria-label", ariaLabel);
        control.button.title = title;
        control.button.disabled = disabled;
    }

    function createController(options) {
        options = options || {};
        const documentRef = options.document;
        const fetchImpl = options.fetch;
        const getContext = options.getContext;
        const setIntervalImpl = typeof options.setInterval === "function" ? options.setInterval : setInterval;
        const clearIntervalImpl = typeof options.clearInterval === "function" ? options.clearInterval : clearInterval;
        let rootElement = null;
        let controls = null;
        let state = null;
        let context = null;
        let activeOperation = null;
        let desiredMaskGroupIndex = null;
        let navigationIntentActive = false;
        let desiredBindingKey = null;
        let desiredMaskToolIndex = null;
        let toolNavigationIntentActive = false;
        let desiredToolBindingKey = null;
        let requestInFlight = false;
        let abortController = null;
        let interval = null;
        let generation = 0;
        let persistentError = "";

        function currentContext() {
            const supplied = typeof getContext === "function" ? getContext() : context;
            return supplied || {};
        }

        function render() {
            if (!controls) return;
            const view = present(state, currentContext(), {
                activeOperation: activeOperation,
                desiredMaskGroupIndex: desiredMaskGroupIndex,
                navigationIntentActive: navigationIntentActive,
                desiredMaskToolIndex: desiredMaskToolIndex,
                toolNavigationIntentActive: toolNavigationIntentActive,
                error: persistentError
            });
            controls.panel.textContent = view.panelLabel;
            controls.panel.disabled = view.panelDisabled;
            controls.previous.disabled = view.previousDisabled;
            controls.next.disabled = view.nextDisabled;
            controls.position.textContent = view.position;
            controls.componentPrevious.disabled = view.previousComponentDisabled;
            controls.componentNext.disabled = view.nextComponentDisabled;
            controls.componentPosition.textContent = view.componentPosition;
            renderVisibilityButton(controls.maskVisibilityControl, view.maskVisibilityLabel,
                view.maskVisibilityAriaLabel, view.maskVisibilityTitle,
                view.maskVisibilityHidden, view.maskVisibilityDisabled);
            renderVisibilityButton(controls.componentVisibilityControl, view.componentVisibilityLabel,
                view.componentVisibilityAriaLabel, view.componentVisibilityTitle,
                view.componentVisibilityHidden, view.componentVisibilityDisabled);
            controls.status.className = "masking-status";
            if (view.statusKind) controls.status.classList.add(view.statusKind);
            controls.status.textContent = view.status;
        }

        function setDesiredToConfirmed(nextState) {
            desiredMaskGroupIndex = confirmedMaskIndex(nextState);
            desiredBindingKey = navigationBindingKey(nextState);
            navigationIntentActive = false;
            desiredMaskToolIndex = confirmedMaskToolIndex(nextState);
            desiredToolBindingKey = toolNavigationBindingKey(nextState);
            toolNavigationIntentActive = false;
        }

        function stopNavigation(message) {
            setDesiredToConfirmed(state);
            if (message) persistentError = message;
        }

        function operationFailureMessage(operation, stale) {
            if (operation.kind === "navigate") return stale
                ? "Lightroom changed before that mask change finished. Please try again."
                : "Lightroom could not confirm that mask change. Please try again.";
            if (operation.kind === "toolNavigate") return stale
                ? "Lightroom changed before that mask component change finished. Please try again."
                : "Lightroom could not confirm that mask component change. Please try again.";
            if (operation.kind === "maskVisibility") return stale
                ? "Lightroom changed before that mask visibility change finished. Please try again."
                : "Lightroom could not confirm that mask visibility change. Please try again.";
            if (operation.kind === "toolVisibility") return stale
                ? "Lightroom changed before that component visibility change finished. Please try again."
                : "Lightroom could not confirm that component visibility change. Please try again.";
            const action = operation.open ? "Open Masking" : "Close Masking";
            return stale
                ? "Lightroom changed before " + action + " finished. Please try again."
                : "Lightroom could not confirm " + action + ". Please try again.";
        }

        function successfulOperation(operation, result) {
            persistentError = "";
            if (operation.kind === "panel") {
                setDesiredToConfirmed(state);
                return;
            }
            if (operation.kind === "maskVisibility" || operation.kind === "toolVisibility") {
                setDesiredToConfirmed(state);
                return;
            }
            if (operation.kind === "toolNavigate") {
                const confirmedGroupIndex = confirmedMaskIndex(state);
                const confirmedToolIndex = confirmedMaskToolIndex(state);
                const expectedToolIndex = clampMaskIndex(operation.baseMaskToolIndex +
                    (operation.direction === "previous" ? -1 : 1), operation.baseMaskToolCount);
                desiredMaskToolIndex = clampMaskIndex(desiredMaskToolIndex, state.selectedMaskToolCount);
                if (confirmedGroupIndex !== operation.baseMaskGroupIndex ||
                    state.selectedMaskGroupId !== operation.baseSelectedMaskId ||
                    confirmedToolIndex === null || desiredMaskToolIndex === null || expectedToolIndex === null ||
                    state.selectedMaskToolCount !== operation.baseMaskToolCount ||
                    confirmedToolIndex !== expectedToolIndex ||
                    (result.outcome === "no_change" && confirmedToolIndex !== desiredMaskToolIndex)) {
                    stopNavigation("Lightroom could not confirm that mask component change. Please try again.");
                    return;
                }
                if (confirmedToolIndex === desiredMaskToolIndex) toolNavigationIntentActive = false;
                return;
            }
            const confirmedIndex = confirmedMaskIndex(state);
            const expectedIndex = clampMaskIndex(operation.baseMaskGroupIndex +
                (operation.direction === "previous" ? -1 : 1), operation.baseMaskGroupCount);
            desiredMaskGroupIndex = clampMaskIndex(desiredMaskGroupIndex, state.maskGroupCount);
            if (confirmedIndex === null || desiredMaskGroupIndex === null || expectedIndex === null ||
                state.maskGroupCount !== operation.baseMaskGroupCount || confirmedIndex !== expectedIndex ||
                (result.outcome === "no_change" && confirmedIndex !== desiredMaskGroupIndex)) {
                stopNavigation("Lightroom could not confirm that mask change. Please try again.");
                return;
            }
            if (confirmedIndex === desiredMaskGroupIndex) navigationIntentActive = false;
        }

        function reconcileOperation(next) {
            if (!activeOperation || !activeOperation.operationId) return;
            if (next.pendingOperation && next.pendingOperation.operationId === activeOperation.operationId) return;
            if (next.lastResult && next.lastResult.operationId === activeOperation.operationId) {
                const operation = activeOperation;
                activeOperation = null;
                if (next.lastResult.outcome === "confirmed" || next.lastResult.outcome === "no_change") {
                    successfulOperation(operation, next.lastResult);
                } else {
                    stopNavigation(operationFailureMessage(operation, next.lastResult.outcome === "stale"));
                }
                return;
            }
            if (next.revision > activeOperation.baseRevision && !next.pendingOperation) {
                const operation = activeOperation;
                activeOperation = null;
                stopNavigation(operationFailureMessage(operation, false));
            }
        }

        function acceptRefreshedState(next) {
            const previous = state;
            const accepted = acceptState(previous, next, currentContext());
            if (accepted === previous) return false;
            const previousBinding = navigationBindingKey(previous);
            const nextBinding = navigationBindingKey(accepted);
            const bindingChanged = previousBinding !== null && previousBinding !== nextBinding;
            const interrupted = Boolean(activeOperation || navigationIntentActive || toolNavigationIntentActive);
            state = accepted;
            if (bindingChanged) {
                activeOperation = null;
                setDesiredToConfirmed(state);
                if (interrupted) {
                    persistentError = previous.serverEpoch !== accepted.serverEpoch
                        ? "LRBridge restarted. Please try the Masking action again."
                        : "Lightroom context changed. Please try the Masking action again.";
                }
                return true;
            }
            if (desiredBindingKey !== nextBinding) setDesiredToConfirmed(state);
            reconcileOperation(state);
            if (navigationIntentActive) {
                desiredMaskGroupIndex = clampMaskIndex(desiredMaskGroupIndex, state.maskGroupCount);
                if (desiredMaskGroupIndex === null) stopNavigation();
            } else if (!activeOperation || activeOperation.kind !== "navigate") {
                desiredMaskGroupIndex = confirmedMaskIndex(state);
            }
            if (desiredToolBindingKey !== toolNavigationBindingKey(state)) {
                desiredMaskToolIndex = confirmedMaskToolIndex(state);
                desiredToolBindingKey = toolNavigationBindingKey(state);
                toolNavigationIntentActive = false;
            } else if (toolNavigationIntentActive) {
                desiredMaskToolIndex = clampMaskIndex(desiredMaskToolIndex, state.selectedMaskToolCount);
                if (desiredMaskToolIndex === null) stopNavigation();
            } else if (!activeOperation || activeOperation.kind !== "toolNavigate") {
                desiredMaskToolIndex = confirmedMaskToolIndex(state);
            }
            return true;
        }

        async function refresh() {
            if (!rootElement || requestInFlight) return;
            const requestGeneration = generation;
            requestInFlight = true;
            try {
                const response = await fetchImpl("/api/masking/state", { cache: "no-store" });
                const next = await response.json();
                if (!rootElement || requestGeneration !== generation) return;
                if (!response.ok) throw new Error("state");
                acceptRefreshedState(next);
            } catch (error) {
                if (!abortController || !abortController.signal.aborted) {
                    persistentError = "Could not refresh Masking state.";
                }
            } finally {
                requestInFlight = false;
                if (requestGeneration === generation) {
                    render();
                    driveNavigation();
                    driveToolNavigation();
                }
            }
        }

        function commandQuery() {
            const confirmed = state;
            if (!confirmed) return null;
            return "selectedPhotoUuid=" + encodeURIComponent(confirmed.selectedPhotoUuid) +
                "&contextCounter=" + encodeURIComponent(confirmed.contextCounter) +
                "&developCounter=" + encodeURIComponent(confirmed.developCounter) +
                "&contextChangedAt=" + encodeURIComponent(confirmed.contextChangedAt) +
                "&serverEpoch=" + encodeURIComponent(confirmed.serverEpoch) +
                "&stateRevision=" + encodeURIComponent(confirmed.revision);
        }

        function admissionError(kind, status, value) {
            if (status === 409) {
                if (kind === "navigate") return "That mask change is no longer available. Masking state was refreshed.";
                if (kind === "toolNavigate") return "That mask component change is no longer available. Masking state was refreshed.";
                if (kind === "maskVisibility") return "That mask visibility change is no longer available. Masking state was refreshed.";
                if (kind === "toolVisibility") return "That component visibility change is no longer available. Masking state was refreshed.";
                return (value ? "Open Masking" : "Close Masking") +
                    " is no longer available. Masking state was refreshed.";
            }
            if (kind === "navigate") return "Lightroom could not receive that mask change. Please try again.";
            if (kind === "toolNavigate") return "Lightroom could not receive that mask component change. Please try again.";
            if (kind === "maskVisibility") return "Lightroom could not receive that mask visibility change. Please try again.";
            if (kind === "toolVisibility") return "Lightroom could not receive that component visibility change. Please try again.";
            return "Lightroom could not receive " + (value ? "Open Masking" : "Close Masking") +
                ". Please try again.";
        }

        async function sendOperation(kind, value) {
            if (activeOperation || !state || state.available !== true || !sameContext(state, currentContext()) ||
                state.pendingOperation) return false;
            const query = commandQuery();
            if (!query) return false;
            const requestGeneration = generation;
            const operation = kind === "panel"
                ? { kind: kind, open: value, baseRevision: state.revision, operationId: null }
                : kind === "navigate" ? {
                    kind: kind,
                    direction: value,
                    baseRevision: state.revision,
                    baseMaskGroupIndex: confirmedMaskIndex(state),
                    baseMaskGroupCount: state.maskGroupCount,
                    operationId: null
                } : kind === "toolNavigate" ? {
                    kind: kind,
                    direction: value,
                    baseRevision: state.revision,
                    baseMaskGroupIndex: confirmedMaskIndex(state),
                    baseSelectedMaskId: state.selectedMaskGroupId,
                    baseMaskToolIndex: confirmedMaskToolIndex(state),
                    baseMaskToolCount: state.selectedMaskToolCount,
                    operationId: null
                } : {
                    kind: kind,
                    hidden: value,
                    baseRevision: state.revision,
                    baseMaskGroupIndex: confirmedMaskIndex(state),
                    baseSelectedMaskId: state.selectedMaskGroupId,
                    baseMaskHidden: state.selectedMaskHidden,
                    baseMaskToolIndex: confirmedMaskToolIndex(state),
                    baseMaskToolCount: state.selectedMaskToolCount,
                    baseSelectedMaskToolId: state.selectedMaskToolId,
                    baseMaskToolHidden: state.selectedMaskToolHidden,
                    operationId: null
                };
            activeOperation = operation;
            render();
            const endpoint = kind === "panel"
                ? "/api/masking/panel?open=" + encodeURIComponent(value) + "&" + query
                : kind === "navigate"
                    ? "/api/masking/group/navigate?direction=" + encodeURIComponent(value) + "&" + query
                    : kind === "toolNavigate"
                        ? "/api/masking/tool/navigate?direction=" + encodeURIComponent(value) + "&" + query
                        : kind === "maskVisibility"
                            ? "/api/masking/group/visibility?hidden=" + encodeURIComponent(value) + "&" + query
                            : "/api/masking/tool/visibility?hidden=" + encodeURIComponent(value) + "&" + query;
            try {
                const response = await fetchImpl(endpoint, { cache: "no-store" });
                const data = await response.json();
                if (requestGeneration !== generation || !rootElement || activeOperation !== operation) return false;
                if (!response.ok || !data || data.ok !== true || typeof data.operationId !== "string") {
                    activeOperation = null;
                    stopNavigation(admissionError(kind, response.status, value));
                    render();
                    refresh();
                    return false;
                }
                if (data.serverEpoch !== state.serverEpoch || !Number.isSafeInteger(data.revision) ||
                    data.revision <= operation.baseRevision || !data.pendingOperation ||
                    data.pendingOperation.operationId !== data.operationId ||
                    !serverOperationMatchesActive(data.pendingOperation, operation)) {
                    activeOperation = null;
                    stopNavigation(operationFailureMessage(operation, false));
                    render();
                    refresh();
                    return false;
                }
                operation.operationId = data.operationId;
                render();
                await refresh();
                return true;
            } catch (error) {
                if (requestGeneration !== generation || !rootElement || activeOperation !== operation) return false;
                activeOperation = null;
                stopNavigation(admissionError(kind, null, value));
                render();
                refresh();
                return false;
            }
        }

        function driveNavigation() {
            if (!rootElement || activeOperation || !navigationIntentActive || !state || state.pendingOperation ||
                desiredBindingKey !== navigationBindingKey(state)) return false;
            const confirmedIndex = confirmedMaskIndex(state);
            desiredMaskGroupIndex = clampMaskIndex(desiredMaskGroupIndex, state.maskGroupCount);
            if (confirmedIndex === null || desiredMaskGroupIndex === null) {
                stopNavigation();
                render();
                return false;
            }
            if (confirmedIndex === desiredMaskGroupIndex) {
                navigationIntentActive = false;
                render();
                return true;
            }
            sendOperation("navigate", desiredMaskGroupIndex < confirmedIndex ? "previous" : "next");
            return true;
        }

        function driveToolNavigation() {
            if (!rootElement || activeOperation || !toolNavigationIntentActive || !state || state.pendingOperation ||
                desiredToolBindingKey !== toolNavigationBindingKey(state)) return false;
            const confirmedIndex = confirmedMaskToolIndex(state);
            desiredMaskToolIndex = clampMaskIndex(desiredMaskToolIndex, state.selectedMaskToolCount);
            if (confirmedIndex === null || desiredMaskToolIndex === null) {
                stopNavigation();
                render();
                return false;
            }
            if (confirmedIndex === desiredMaskToolIndex) {
                toolNavigationIntentActive = false;
                render();
                return true;
            }
            sendOperation("toolNavigate", desiredMaskToolIndex < confirmedIndex ? "previous" : "next");
            return true;
        }

        function requestNavigation(delta) {
            persistentError = "";
            if (!state || state.available !== true || state.active !== true ||
                toolNavigationIntentActive ||
                (activeOperation && activeOperation.kind !== "navigate") ||
                (state.pendingOperation && !serverOperationMatchesActive(state.pendingOperation, activeOperation))) {
                render();
                return false;
            }
            const confirmedIndex = confirmedMaskIndex(state);
            const bindingKey = navigationBindingKey(state);
            if (confirmedIndex === null || bindingKey === null) {
                render();
                return false;
            }
            if (desiredBindingKey !== bindingKey) setDesiredToConfirmed(state);
            const baseIndex = navigationIntentActive && Number.isSafeInteger(desiredMaskGroupIndex)
                ? desiredMaskGroupIndex : confirmedIndex;
            desiredMaskGroupIndex = clampMaskIndex(baseIndex + delta, state.maskGroupCount);
            desiredBindingKey = bindingKey;
            navigationIntentActive = Boolean((activeOperation && activeOperation.kind === "navigate") ||
                desiredMaskGroupIndex !== confirmedIndex);
            render();
            driveNavigation();
            return true;
        }

        function requestToolNavigation(delta) {
            persistentError = "";
            if (!state || state.available !== true || state.active !== true ||
                state.hasSelectedMaskGroup !== true || state.selectedMaskToolAvailable !== true ||
                navigationIntentActive || (activeOperation && activeOperation.kind !== "toolNavigate") ||
                (state.pendingOperation && !serverOperationMatchesActive(state.pendingOperation, activeOperation))) {
                render();
                return false;
            }
            const confirmedIndex = confirmedMaskToolIndex(state);
            const bindingKey = toolNavigationBindingKey(state);
            if (confirmedIndex === null || bindingKey === null) {
                render();
                return false;
            }
            if (desiredToolBindingKey !== bindingKey) setDesiredToConfirmed(state);
            const baseIndex = toolNavigationIntentActive && Number.isSafeInteger(desiredMaskToolIndex)
                ? desiredMaskToolIndex : confirmedIndex;
            desiredMaskToolIndex = clampMaskIndex(baseIndex + delta, state.selectedMaskToolCount);
            desiredToolBindingKey = bindingKey;
            toolNavigationIntentActive = Boolean((activeOperation && activeOperation.kind === "toolNavigate") ||
                desiredMaskToolIndex !== confirmedIndex);
            render();
            driveToolNavigation();
            return true;
        }

        function requestVisibility(kind) {
            persistentError = "";
            if (!state || state.available !== true || state.active !== true ||
                state.hasSelectedMaskGroup !== true || state.selectedMaskToolAvailable !== true ||
                typeof state.selectedMaskHidden !== "boolean" || typeof state.selectedMaskToolHidden !== "boolean" ||
                activeOperation || navigationIntentActive || toolNavigationIntentActive || state.pendingOperation) {
                render();
                return false;
            }
            const hidden = kind === "maskVisibility" ? state.selectedMaskHidden : state.selectedMaskToolHidden;
            sendOperation(kind, !hidden);
            return true;
        }

        function build() {
            const section = documentRef.createElement("section");
            section.className = "group tools-section masking-section";
            section.dataset.toolsSection = "masking";
            const title = documentRef.createElement("div");
            title.className = "group-title";
            title.textContent = "Masking";
            const body = documentRef.createElement("div");
            body.className = "masking-body";
            const panelRow = documentRef.createElement("div");
            panelRow.className = "masking-panel-row";
            const panel = createButton(documentRef, "Open Masking", "positive masking-panel-button");
            panelRow.appendChild(panel);
            const navigation = documentRef.createElement("div");
            navigation.className = "masking-navigation";
            const previous = createButton(documentRef, "Previous Mask", "masking-navigation-button");
            const next = createButton(documentRef, "Next Mask", "masking-navigation-button");
            const maskVisibilityControl = createVisibilityButton(documentRef, "Hide Mask",
                "masking-mask-visibility-button");
            const maskVisibility = maskVisibilityControl.button;
            navigation.appendChild(previous);
            navigation.appendChild(maskVisibility);
            navigation.appendChild(next);
            const position = documentRef.createElement("div");
            position.className = "masking-position";
            position.setAttribute("aria-live", "polite");
            const componentNavigation = documentRef.createElement("div");
            componentNavigation.className = "masking-component-navigation";
            const componentPrevious = createButton(documentRef, "Previous Component", "masking-navigation-button");
            const componentNext = createButton(documentRef, "Next Component", "masking-navigation-button");
            const componentVisibilityControl = createVisibilityButton(documentRef, "Hide Component",
                "masking-component-visibility-button");
            const componentVisibility = componentVisibilityControl.button;
            componentNavigation.appendChild(componentPrevious);
            componentNavigation.appendChild(componentVisibility);
            componentNavigation.appendChild(componentNext);
            const componentPosition = documentRef.createElement("div");
            componentPosition.className = "masking-component-position";
            componentPosition.setAttribute("aria-live", "polite");
            const status = documentRef.createElement("div");
            status.className = "masking-status";
            status.setAttribute("aria-live", "polite");
            body.appendChild(panelRow);
            body.appendChild(navigation);
            body.appendChild(position);
            body.appendChild(componentNavigation);
            body.appendChild(componentPosition);
            body.appendChild(status);
            section.appendChild(title);
            section.appendChild(body);
            panel.addEventListener("click", function () {
                persistentError = "";
                const view = present(state, currentContext(), {});
                if (view.confirmed && !activeOperation && !navigationIntentActive &&
                    !toolNavigationIntentActive && !state.pendingOperation) {
                    sendOperation("panel", view.confirmed.active !== true);
                }
            });
            previous.addEventListener("click", function () { requestNavigation(-1); });
            next.addEventListener("click", function () { requestNavigation(1); });
            componentPrevious.addEventListener("click", function () { requestToolNavigation(-1); });
            componentNext.addEventListener("click", function () { requestToolNavigation(1); });
            maskVisibility.addEventListener("click", function () { requestVisibility("maskVisibility"); });
            componentVisibility.addEventListener("click", function () { requestVisibility("toolVisibility"); });
            controls = { title: title, panel: panel, previous: previous, next: next, position: position,
                componentPrevious: componentPrevious, componentNext: componentNext,
                componentPosition: componentPosition, maskVisibility: maskVisibility,
                maskVisibilityControl: maskVisibilityControl, componentVisibility: componentVisibility,
                componentVisibilityControl: componentVisibilityControl, status: status };
            return section;
        }

        function activate(host, decorate) {
            deactivate();
            rootElement = build();
            host.appendChild(rootElement);
            if (typeof decorate === "function") decorate(rootElement, controls.title);
            generation += 1;
            abortController = typeof AbortController === "function" ? new AbortController() : null;
            context = currentContext();
            setDesiredToConfirmed(state);
            render();
            refresh();
            interval = setIntervalImpl(refresh, POLL_MS);
            return rootElement;
        }

        function deactivate() {
            generation += 1;
            if (interval !== null) clearIntervalImpl(interval);
            interval = null;
            if (abortController) abortController.abort();
            abortController = null;
            requestInFlight = false;
            activeOperation = null;
            desiredMaskGroupIndex = null;
            navigationIntentActive = false;
            desiredBindingKey = null;
            desiredMaskToolIndex = null;
            toolNavigationIntentActive = false;
            desiredToolBindingKey = null;
            persistentError = "";
            if (rootElement && rootElement.parentElement) rootElement.remove();
            rootElement = null;
            controls = null;
        }

        function updateContext(next) {
            const before = context;
            context = next || currentContext();
            if (!before || before.activeModule !== context.activeModule || before.selectedPhotoUuid !== context.selectedPhotoUuid ||
                before.contextCounter !== context.contextCounter || before.developCounter !== context.developCounter ||
                before.contextChangedAt !== context.contextChangedAt) {
                state = null;
                activeOperation = null;
                desiredMaskGroupIndex = null;
                navigationIntentActive = false;
                desiredBindingKey = null;
                desiredMaskToolIndex = null;
                toolNavigationIntentActive = false;
                desiredToolBindingKey = null;
                persistentError = "";
                generation += 1;
                render();
                refresh();
            }
        }

        return {
            activate: activate,
            deactivate: deactivate,
            updateContext: updateContext,
            refresh: refresh,
            getState: function () { return state; },
            isActive: function () { return rootElement !== null; }
        };
    }

    return {
        createController: createController,
        acceptState: acceptState,
        sameContext: sameContext,
        present: present,
        unavailableMessage: unavailableMessage,
        confirmedMaskIndex: confirmedMaskIndex,
        confirmedMaskToolIndex: confirmedMaskToolIndex,
        clampMaskIndex: clampMaskIndex
    };
});
