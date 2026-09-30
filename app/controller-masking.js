(function (root, factory) {
    "use strict";
    const dependency = typeof module === "object" && module.exports
        ? require("./controller-masking-corrections")
        : root.LRBridgeMaskingCorrections;
    const toneCurveDependency = typeof module === "object" && module.exports
        ? require("./controller-tone-curve")
        : root.LRBridgeToneCurve;
    const pointColorDependency = typeof module === "object" && module.exports
        ? require("./controller-point-color")
        : root.LRBridgePointColor;
    const api = factory(dependency, toneCurveDependency, pointColorDependency);
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.LRBridgeControllerMasking = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (maskingCorrections, toneCurveModule, pointColorModule) {
    "use strict";

    const POLL_MS = 450;
    const componentCreation = kind => kind === "add" || kind === "subtract";
    const componentActionLabel = kind => kind === "add" ? "Add Component" : "Subtract from Mask";
    function selectedComponentHeading(state) {
        if (!state || state.selectedMaskToolAvailable !== true) return "Selected Component";
        const type = maskingCorrections.creationType(state.selectedMaskToolType, state.selectedMaskToolSubtype || "");
        return type ? (type.maskType === "aiSelection" ? "Select " : "") + type.label : "Selected Component";
    }
    const PRESET_BUTTON_LABEL = "Apply Mask Preset…";
    const PRESET_EXPLANATION = "Applies saved settings to the selected mask. Some Lightroom presets are unavailable, and Lightroom may show Custom or an edited preset name.";

    function sameContext(state, context) {
        return Boolean(state && context && state.selectedPhotoUuid === context.selectedPhotoUuid &&
            state.contextCounter === context.contextCounter && state.developCounter === context.developCounter &&
            state.contextChangedAt === context.contextChangedAt);
    }

    function pointColorBindingQuery(binding) {
        return "selectedPhotoUuid=" + encodeURIComponent(binding.selectedPhotoUuid) +
            "&contextCounter=" + encodeURIComponent(binding.contextCounter) +
            "&developCounter=" + encodeURIComponent(binding.developCounter) +
            "&contextChangedAt=" + encodeURIComponent(binding.contextChangedAt) +
            "&serverEpoch=" + encodeURIComponent(binding.serverEpoch) +
            "&stateRevision=" + encodeURIComponent(binding.maskingRevision) +
            "&selectedMaskGroupId=" + encodeURIComponent(binding.selectedMaskGroupId);
    }

    function acceptState(current, next, context) {
        if (!next || next.ok !== true || typeof next.serverEpoch !== "string" ||
            !Number.isSafeInteger(next.revision) || next.revision < 0 || !sameContext(next, context)) return current;
        if (current && current.serverEpoch === next.serverEpoch && current.revision > next.revision) return current;
        if (current && current.serverEpoch === next.serverEpoch && current.revision === next.revision &&
            Number.isSafeInteger(current.correctionFeedbackSequence) &&
            Number.isSafeInteger(next.correctionFeedbackSequence) &&
            current.correctionFeedbackSequence > next.correctionFeedbackSequence) return current;
        if (current && current.serverEpoch === next.serverEpoch && current.revision === next.revision &&
            Number.isSafeInteger(current.editFeedbackSequence) && Number.isSafeInteger(next.editFeedbackSequence) &&
            current.editFeedbackSequence > next.editFeedbackSequence) return current;
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
        if (activeOperation.kind === "create") return serverOperation.maskType === activeOperation.maskType &&
            serverOperation.maskSubtype === activeOperation.maskSubtype;
        if (componentCreation(activeOperation.kind)) return serverOperation.maskType === activeOperation.maskType &&
            serverOperation.maskSubtype === activeOperation.maskSubtype &&
            serverOperation.beforeSelectedMaskId === activeOperation.baseSelectedMaskId;
        if (activeOperation.kind === "maskVisibility" || activeOperation.kind === "toolVisibility") {
            return serverOperation.hidden === activeOperation.hidden;
        }
        if (activeOperation.kind === "pointColorPicker" || activeOperation.kind === "pointColorVisualize") return true;
        if (activeOperation.kind === "preset") return serverOperation.presetId === activeOperation.presetId;
        if (activeOperation.kind === "deleteSelected") return serverOperation.beforeSelectedMaskId === activeOperation.baseSelectedMaskId;
        if (activeOperation.kind === "deleteComponent" || activeOperation.kind === "invertComponent") return serverOperation.beforeSelectedMaskId === activeOperation.baseSelectedMaskId &&
            serverOperation.beforeSelectedMaskToolId === activeOperation.baseSelectedMaskToolId;
        if (activeOperation.kind === "deleteAll" || activeOperation.kind === "resetSelected") return true;
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
        const maskSelectionLoading = navigating || Boolean(operation && operation.kind === "navigate");
        const componentSelectionLoading = maskSelectionLoading || toolNavigating ||
            Boolean(operation && operation.kind === "toolNavigate");
        const confirmedIndex = confirmedMaskIndex(confirmed);
        const desiredIndex = confirmed && navigating
            ? clampMaskIndex(local.desiredMaskGroupIndex, confirmed.maskGroupCount) : confirmedIndex;
        const confirmedToolIndex = confirmedMaskToolIndex(confirmed);
        const desiredToolIndex = confirmed && toolNavigating
            ? clampMaskIndex(local.desiredMaskToolIndex, confirmed.selectedMaskToolCount) : confirmedToolIndex;
        const foreignOperation = Boolean(serverOperation &&
            !serverOperationMatchesActive(serverOperation, activeOperation));
        const correctionBusy = local.correctionBusy === true;
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
        const navigationBlocked = Boolean((operation && operation.kind !== "navigate") || foreignOperation || toolNavigating || correctionBusy);
        const toolNavigationReady = navigationReady && confirmedToolIndex !== null;
        const toolNavigationBlocked = Boolean((operation && operation.kind !== "toolNavigate") ||
            foreignOperation || navigating || correctionBusy);
        const visibilityReady = toolNavigationReady && typeof confirmed.selectedMaskHidden === "boolean" &&
            typeof confirmed.selectedMaskToolHidden === "boolean";
        const visibilityBlocked = Boolean(operation || foreignOperation || navigating || toolNavigating || correctionBusy);
        presentation.panelDisabled = Boolean(operation || navigating || toolNavigating || correctionBusy);
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
        else {
            const maskPosition = "Mask " + confirmed.selectedMaskGroupIndex + " of " + confirmed.maskGroupCount;
            if (maskSelectionLoading) {
                presentation.position = maskPosition;
            } else {
            presentation.position = typeof confirmed.selectedMaskGroupName === "string" &&
                confirmed.selectedMaskGroupName.length > 0
                ? confirmed.selectedMaskGroupName + " — " + maskPosition : maskPosition;
            }
        }
        if (confirmed.active === true && confirmed.hasSelectedMaskGroup === true) {
            if (confirmed.selectedMaskToolAvailable === true) {
                const componentPosition = "Component " + confirmed.selectedMaskToolIndex + " of " +
                    confirmed.selectedMaskToolCount;
                presentation.componentPosition = !componentSelectionLoading &&
                    typeof confirmed.selectedMaskToolName === "string" &&
                    confirmed.selectedMaskToolName.trim().length > 0
                    ? confirmed.selectedMaskToolName + " — " + componentPosition : componentPosition;
            } else presentation.componentPosition = confirmed.selectedMaskToolCount === 0 ? "No components in this mask." : "No mask component is selected.";
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
            else if (operation.kind === "create") presentation.status = "Requesting a new mask in Lightroom…";
            else if (componentCreation(operation.kind)) presentation.status = "Requesting " + componentActionLabel(operation.kind) + " in Lightroom…";
            else if (operation.kind === "deleteComponent") presentation.status = "Deleting the selected component in Lightroom…";
            else if (operation.kind === "invertComponent") presentation.status = "Inverting the selected component in Lightroom…";
            else if (operation.kind === "navigate") presentation.status = "Updating mask selection…";
            else if (operation.kind === "toolNavigate") presentation.status = "Updating mask component selection…";
            else if (operation.kind === "maskVisibility") {
                presentation.status = operation.hidden ? "Hiding Mask…" : "Showing Mask…";
            } else if (operation.kind === "toolVisibility") {
                presentation.status = operation.hidden ? "Hiding Component…" : "Showing Component…";
            } else if (operation.kind === "deleteAll") presentation.status = "Deleting all masks…";
            else if (operation.kind === "deleteSelected") presentation.status = "Deleting mask…";
            else if (operation.kind === "resetSelected") presentation.status = "Resetting mask corrections…";
            else if (operation.kind === "preset") presentation.status = "Applying mask preset…";
            else if (operation.kind === "pointColorPicker") presentation.status = "Selecting mask Color Picker…";
            else if (operation.kind === "pointColorVisualize") presentation.status = "Toggling mask Visualize Range…";
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

    function focusElement(element) {
        if (element && typeof element.focus === "function") element.focus();
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
        const confirmImpl = typeof options.confirm === "function" ? options.confirm :
            (typeof confirm === "function" ? confirm : function () { return false; });
        const createSharedDevelopSliderControl = typeof options.createSharedDevelopSliderControl === "function"
            ? options.createSharedDevelopSliderControl : null;
        let rootElement = null;
        let controls = null;
        let state = null;
        let rejectedCorrectionBinding = null;
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
        let deletionSelectionWarning = null;
        let deletionRemovalWarning = null;
        let deletionTrace = null;
        let deletionTraceAttempt = 0;
        const deletionTraceClient = "delete-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
        function deletionTraceState(value) {
            if (!value) return null;
            const result = {};
            for (const key of ["serverEpoch", "revision", "selectedPhotoUuid", "contextCounter", "developCounter",
                "contextChangedAt", "available", "unavailableReason", "active", "maskGroupCount", "hasSelectedMaskGroup",
                "selectedMaskGroupId", "selectedMaskToolAvailable", "selectedMaskToolId", "pendingOperation", "lastResult"]) {
                result[key] = value[key];
            }
            return result;
        }
        function traceDeletion(event, data) {
            if (!deletionTrace || Date.now() - deletionTrace.startedAt > 60000 || deletionTrace.sequence >= 128) return;
            try {
                const encoded = JSON.stringify(data);
                if (deletionTrace.previous[event] === encoded) return;
                deletionTrace.previous[event] = encoded;
                const report = JSON.stringify({ version: "mask-delete-confirmation-1", client: deletionTraceClient,
                    attempt: deletionTrace.attempt, sequence: ++deletionTrace.sequence, at: Date.now(), event,
                    operationId: deletionTrace.operation.operationId, kind: deletionTrace.operation.kind,
                    generation, data });
                if (report.length > 8000) return;
                // Fire-and-forget evidence only: never acknowledge an operation,
                // refresh state, set an error, or retry an SDK action from this response.
                Promise.resolve(fetchImpl("/api/diagnostics/masking-deletion-browser?report=" + encodeURIComponent(report),
                    { cache: "no-store" })).catch(function () {});
            } catch (_) { /* Diagnostics cannot affect the controller. */ }
        }
        let creationFeedback = "";
        let componentFeedbackBinding = null;
        let componentFeedbackToolId = null;
        let creationAwaitingInventory = null;
        let creationMenuClose = null;
        let correctionGestureCounter = 0;
        let correctionRequestCount = 0;
        let correctionControls = Object.create(null);
        let correctionGroups = Object.create(null);
        let correctionStatus = null;
        let presets = [];
        let presetRequestInFlight = false;
        let presetRequestToken = 0;
        let presetPicker = null;
        let presetFeedback = null;
        let queuedPreset = null;
        let pointColorStatus = null;
        let pointColorVisualizeStatus = null;
        let sharedPointColorController = null;
        let toneCurveController = null;
        let toneCurveStatus = null;
        let sharedGrainControlCount = 0;

        let correctionGeneration = 0;
        function sameCorrectionContext(value, current) {
            if (sameContext(value, current)) return true;
            return Boolean(value && current && current.activeModule === "develop" &&
                value.selectedPhotoUuid === current.selectedPhotoUuid && value.contextCounter === current.contextCounter &&
                value.contextChangedAt === current.contextChangedAt && value.selectedMaskGroupId === current.maskingGrainMaskId &&
                Number.isSafeInteger(current.maskingCorrectionDevelopFloor) &&
                value.developCounter >= current.maskingCorrectionDevelopFloor && value.developCounter < current.developCounter);
        }
        function correctionBindingKey(value) {
            const compatible = value && value.maskingGrainMaskId === value.selectedMaskGroupId &&
                Number.isSafeInteger(value.maskingCorrectionDevelopFloor) && value.maskingCorrectionDevelopFloor <= value.developCounter;
            const base = navigationBindingKey(compatible ? Object.assign({}, value,
                { developCounter: value.maskingCorrectionDevelopFloor }) : value);
            return base !== null && value && value.available === true && value.active === true &&
                value.hasSelectedMaskGroup === true && typeof value.selectedMaskGroupId === "string"
                ? base + "\u001f" + value.selectedMaskGroupId : null;
        }

        function correctionBusy(admittingPointColorVisualization) {
            // The child reserves its Visualize button before calling this parent.
            // That reservation owns this operation; actual edits must still block it.
            const sharedPointColorBusy = sharedPointColorController && (admittingPointColorVisualization === true
                ? sharedPointColorController.hasPendingEdits() : sharedPointColorController.isBusy());
            const pointColorBusy = sharedPointColorBusy;
            const toneState = toneCurveController && typeof toneCurveController.getState === "function"
                ? toneCurveController.getState() : null;
            const toneCurveBusy = Boolean(toneState && (toneState.gestureActive || toneState.refineGestureActive ||
                toneState.awaitingTarget || toneState.awaitingReset || toneState.awaitingRefine ||
                toneState.awaitingRefineReset || toneState.refineStepIntent ||
                toneState.awaitingPreset || toneState.presetRequestInFlight));
            return correctionRequestCount > 0 || pointColorBusy || toneCurveBusy ||
                Object.keys(correctionControls).some(function (parameter) {
                const control = correctionControls[parameter];
                return control.pointerActive || control.requestInFlight || control.queuedSubmission !== null ||
                    control.desiredValue !== null || control.resetInFlight ||
                    control.throttleTimer !== null || control.stepTimer !== null;
            });
        }

        function pointColorBinding(value) {
            const current = currentContext();
            if (!value || value.available !== true || value.active !== true || value.hasSelectedMaskGroup !== true ||
                typeof value.selectedMaskGroupId !== "string" || !current || current.activeModule !== "develop") return null;
            return {
                activeModule: "develop",
                selectedPhotoUuid: value.selectedPhotoUuid,
                contextCounter: value.contextCounter,
                developCounter: value.developCounter,
                contextChangedAt: value.contextChangedAt,
                serverEpoch: value.serverEpoch,
                maskingRevision: value.revision,
                selectedMaskGroupId: value.selectedMaskGroupId,
                lastEditResult: value.lastEditResult || null
            };
        }

        function toneCurveBinding(value) {
            const current = currentContext();
            if (!value || value.available !== true || value.active !== true || value.hasSelectedMaskGroup !== true ||
                typeof value.selectedMaskGroupId !== "string" || !current || current.activeModule !== "develop") return null;
            return {
                activeModule: "develop",
                selectedPhotoUuid: value.selectedPhotoUuid,
                contextCounter: value.contextCounter,
                developCounter: value.developCounter,
                contextChangedAt: value.contextChangedAt,
                serverEpoch: value.serverEpoch,
                maskingRevision: value.revision,
                selectedMaskGroupId: value.selectedMaskGroupId
            };
        }

        function currentContext() {
            const supplied = typeof getContext === "function" ? getContext() : context;
            return supplied || {};
        }

        function presetContextKey(value) {
            return value ? [value.serverEpoch, value.selectedPhotoUuid, value.contextCounter,
                value.contextChangedAt].join("\u001f") : null;
        }

        function presetFeedbackKey(value) {
            if (!value || value.available !== true || value.active !== true ||
                typeof value.selectedMaskGroupId !== "string" || typeof value.selectedMaskToolId !== "string") return null;
            return [presetContextKey(value), value.selectedMaskGroupId, value.selectedMaskToolId].join("\u001f");
        }

        function setPresetFeedback(message, kind) {
            presetFeedback = { key: presetFeedbackKey(state), contextKey: presetContextKey(state), message: message, kind: kind };
        }

        function presetFeedbackMessage() {
            return sameContext(state, currentContext()) && presetFeedback && presetFeedback.key !== null && presetFeedback.key === presetFeedbackKey(state)
                ? presetFeedback.message : "";
        }

        function closePresetPicker(restoreFocus) {
            if (!presetPicker || !presetPicker.open) return;
            presetPicker.open = false;
            presetPicker.dialog.hidden = true;
            if (typeof presetPicker.dialog.close === "function" && presetPicker.dialog.open) {
                try { presetPicker.dialog.close(); } catch (error) { /* The hidden fallback is sufficient. */ }
            }
            if (controls && controls.preset) controls.preset.setAttribute("aria-expanded", "false");
            if (restoreFocus !== false && controls) focusElement(controls.preset);
        }

        function focusPresetOption(rows, row, key) {
            if (rows.length === 0) return;
            const current = rows.indexOf(row);
            let index = 0;
            if (key === "End") index = rows.length - 1;
            else if (key === "ArrowUp") index = current <= 0 ? rows.length - 1 : current - 1;
            else if (key === "ArrowDown") index = current < 0 || current === rows.length - 1 ? 0 : current + 1;
            else if (key === "Home") index = 0;
            focusElement(rows[index]);
        }

        function appendPresetPickerGroup(label, entries, rows) {
            if (!presetPicker) return;
            const heading = documentRef.createElement("div");
            heading.className = "develop-preset-picker-folder masking-preset-picker-group";
            heading.setAttribute("role", "presentation");
            heading.textContent = label;
            presetPicker.list.appendChild(heading);
            if (entries.length === 0) {
                const empty = documentRef.createElement("div");
                empty.className = "develop-preset-picker-empty masking-preset-picker-empty";
                empty.textContent = "No applicable mask presets found.";
                presetPicker.list.appendChild(empty);
                return;
            }
            entries.forEach(function (entry) {
                const row = createButton(documentRef, "",
                    "develop-preset-picker-option masking-preset-picker-option");
                row.dataset.presetId = entry.id;
                row._maskingPreset = entry;
                row.setAttribute("aria-label", "Apply settings from " + entry.name);
                const labels = documentRef.createElement("span");
                labels.className = "develop-preset-picker-option-labels";
                const primary = documentRef.createElement("span");
                primary.className = "develop-preset-picker-option-primary";
                primary.textContent = entry.name;
                labels.appendChild(primary);
                row.appendChild(labels);
                row.addEventListener("click", function () {
                    if (row.getAttribute("aria-disabled") !== "true") choosePreset(entry);
                });
                row.addEventListener("keydown", function (event) {
                    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                    if (event.preventDefault) event.preventDefault();
                    focusPresetOption(rows, row, event.key);
                });
                rows.push(row);
                presetPicker.list.appendChild(row);
            });
        }

        function updatePresetPickerState() {
            const message = presetFeedbackMessage();
            if (controls && controls.presetFeedback) {
                controls.presetFeedback.className = "masking-preset-feedback masking-status" +
                    (presetFeedback && presetFeedback.kind === "error" ? " error" : "");
                controls.presetFeedback.textContent = message;
                controls.presetFeedback.hidden = !message;
            }
            if (!presetPicker || !presetPicker.open) return;
            const scrollTop = presetPicker.list.scrollTop;
            const ownPreset = activeOperation && activeOperation.kind === "preset" &&
                activeOperation.bindingKey === presetFeedbackKey(state);
            const blocked = Boolean(activeOperation && !ownPreset || state && state.pendingOperation &&
                !serverOperationMatchesActive(state.pendingOperation, activeOperation) || correctionBusy() ||
                navigationIntentActive || toolNavigationIntentActive || !presetFeedbackKey(state) ||
                !sameContext(state, currentContext()));
            presetPicker.rows.forEach(function (row) {
                if (row.getAttribute("aria-disabled") !== String(blocked)) row.setAttribute("aria-disabled", String(blocked));
            });
            const status = (message || (presetRequestInFlight ? "Refreshing presets…" : "")) +
                (queuedPreset ? " Next: " + queuedPreset.name + "." : "");
            if (presetPicker.status.textContent !== status) presetPicker.status.textContent = status;
            if (presetPicker.list.scrollTop !== scrollTop) presetPicker.list.scrollTop = scrollTop;
        }

        function rebuildPresetPickerInventory() {
            if (!presetPicker) return;
            const scrollTop = presetPicker.open && Number.isFinite(presetPicker.list.scrollTop)
                ? presetPicker.list.scrollTop : 0;
            const activeElement = documentRef.activeElement;
            const focusedPresetId = activeElement && activeElement.dataset
                ? activeElement.dataset.presetId : null;
            const closeFocused = activeElement === presetPicker.close;
            presetPicker.list.replaceChildren();
            const rows = [];
            appendPresetPickerGroup("Installed and saved presets", presets.filter(function (entry) {
                return entry.kind === "file";
            }), rows);
            presetPicker.rows = rows;
            updatePresetPickerState();
            if (presetPicker.open && focusedPresetId) {
                const replacement = rows.find(function (row) {
                    return row.dataset.presetId === focusedPresetId;
                });
                if (replacement) focusElement(replacement);
            } else if (presetPicker.open && closeFocused) {
                focusElement(presetPicker.close);
            }
            presetPicker.list.scrollTop = scrollTop;
        }

        function openPresetPicker() {
            if (!presetPicker || presetPicker.open || !controls || controls.preset.disabled) return;
            presetPicker.open = true;
            presetPicker.dialog.hidden = false;
            controls.preset.setAttribute("aria-expanded", "true");
            if (presetPicker.rows.length === 0) rebuildPresetPickerInventory();
            updatePresetPickerState();
            if (typeof presetPicker.dialog.showModal === "function") {
                try { presetPicker.dialog.showModal(); } catch (error) { /* A connected fallback remains visible. */ }
            }
            const scrollTop = presetPicker.list.scrollTop;
            focusElement(presetPicker.rows[0] || presetPicker.close);
            presetPicker.list.scrollTop = scrollTop;
            refreshPresets();
        }

        function render() {
            if (!controls) return;
            renderCorrections();
            const view = present(state, currentContext(), {
                activeOperation: activeOperation,
                desiredMaskGroupIndex: desiredMaskGroupIndex,
                navigationIntentActive: navigationIntentActive,
                desiredMaskToolIndex: desiredMaskToolIndex,
                toolNavigationIntentActive: toolNavigationIntentActive,
                correctionBusy: correctionBusy(),
                error: persistentError
            });
            if (state && !sameContext(state, currentContext())) {
                // Keep the last confirmed labels in place while their actions are
                // disabled. An empty component label also collapses a line of layout.
                const previousView = present(state, state);
                ["panelLabel", "position", "componentPosition", "maskVisibilityLabel",
                    "maskVisibilityAriaLabel", "maskVisibilityTitle", "maskVisibilityHidden",
                    "componentVisibilityLabel", "componentVisibilityAriaLabel",
                    "componentVisibilityTitle", "componentVisibilityHidden"].forEach(function (key) {
                    view[key] = previousView[key];
                });
            }
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
            if (creationFeedback && !activeOperation && !persistentError) controls.status.textContent = creationFeedback;
            traceDeletion("render", { state: deletionTraceState(state), activeOperation,
                persistentError, status: controls.status.textContent });
            const contextStale = !sameContext(state, currentContext());
            const actionBlocked = Boolean(contextStale || activeOperation || state && state.pendingOperation || correctionBusy() ||
                navigationIntentActive || toolNavigationIntentActive);
            if (sharedPointColorController && typeof sharedPointColorController.setBlocked === "function") {
                const pointColorSelfBusy = sharedPointColorController.isBusy();
                sharedPointColorController.setBlocked(Boolean(contextStale || activeOperation || state && state.pendingOperation ||
                    navigationIntentActive || toolNavigationIntentActive || correctionBusy() && !pointColorSelfBusy));
            }
            const selected = Boolean(state && state.available === true && state.active === true &&
                state.hasSelectedMaskGroup === true);
            controls.create.disabled = actionBlocked || !state || state.available !== true || state.maskGroupCount >= 512;
            controls.add.disabled = controls.subtract.disabled = actionBlocked || !selected ||
                !Number.isSafeInteger(state.selectedMaskToolCount) || state.selectedMaskToolCount < 1 || state.selectedMaskToolCount >= 2048;
            if (creationMenuClose) creationMenuClose.validate();
            controls.resetSelected.disabled = actionBlocked || !selected;
            controls.deleteSelected.disabled = actionBlocked || !selected;
            controls.deleteComponent.disabled = actionBlocked || !selected || state.selectedMaskToolAvailable !== true;
            const selectedComponent = selected && !contextStale && state.selectedMaskToolAvailable === true;
            const inversionKnown = selectedComponent && typeof state.selectedMaskToolInverted === "boolean";
            controls.componentHeading.textContent = selectedComponent ? selectedComponentHeading(state) : "Selected Component";
            controls.invertCheckboxLabel.hidden = !inversionKnown;
            controls.invertComponent.hidden = inversionKnown;
            controls.invertCheckbox.checked = inversionKnown && state.selectedMaskToolInverted;
            controls.invertCheckbox.disabled = controls.invertComponent.disabled = actionBlocked || !selectedComponent;
            controls.preset.disabled = actionBlocked || !selected || state.selectedMaskToolAvailable !== true;
            controls.preset.textContent = PRESET_BUTTON_LABEL;
            controls.preset.setAttribute("aria-label", PRESET_BUTTON_LABEL);
            updatePresetPickerState();
            controls.deleteAll.disabled = actionBlocked || !state || state.available !== true ||
                !Number.isSafeInteger(state.maskGroupCount) || state.maskGroupCount < 1;
            if (typeof options.onInteractionChange === "function") options.onInteractionChange();
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

        function operationFailureMessage(operation, stale, detail) {
            if (operation.kind === "invertComponent") return stale ? "Photo, mask or component changed during inversion. Refreshing Lightroom feedback." :
                (detail || "Lightroom could not confirm component inversion. Check the component in Lightroom.");
            if (operation.kind === "deleteComponent") return stale ? "Photo, mask or component changed during Delete Component. Refreshing Lightroom feedback." :
                (detail || "Lightroom could not confirm component removal. Check its inventory before another delete.");
            if (componentCreation(operation.kind)) return stale ? "Photo or selected mask changed during " + componentActionLabel(operation.kind) + "." :
                (detail || "Lightroom did not confirm " + componentActionLabel(operation.kind) + ". Check the selected mask and its components.");
            if (operation.kind === "create") return stale ? "Photo or Masking context changed during mask creation." :
                (detail || "Lightroom did not confirm the new mask request.");
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
            if (operation.kind === "deleteAll") return stale
                ? "Lightroom changed before Delete All Masks finished. Please try again."
                : "Lightroom could not confirm that every mask was deleted. Please try again.";
            if (operation.kind === "deleteSelected") return stale
                ? "Lightroom changed during Delete Mask. Refreshing the current mask inventory."
                : "Lightroom could not confirm removal. Check the current mask inventory before another delete.";
            if (operation.kind === "resetSelected") return stale
                ? "Lightroom changed before the selected-mask Reset finished. Please try again."
                : "Lightroom could not confirm a complete selected-mask Reset. Please try again.";
            if (operation.kind === "preset") {
                if (stale) return "Lightroom changed before that mask preset was applied. Please try again.";
                return typeof detail === "string" && detail.trim() ? detail.trim() :
                    "Lightroom could not safely apply that local adjustment preset. Please try again.";
            }
            if (operation.kind === "pointColorPicker") return stale
                ? "Lightroom changed before the mask Color Picker was selected. Please try again."
                : "Lightroom could not confirm the mask Color Picker. Please try again.";
            if (operation.kind === "pointColorVisualize") return stale
                ? "Lightroom changed before mask Visualize Range ran. Please try again."
                : "Lightroom could not run mask Visualize Range. Please try again.";
            const action = operation.open ? "Open Masking" : "Close Masking";
            return stale
                ? "Lightroom changed before " + action + " finished. Please try again."
                : "Lightroom could not confirm " + action + ". Please try again.";
        }

        function completedDeletion(operation, result) {
            deletionSelectionWarning = null;
            if (result.outcome === "deleted") {
                creationFeedback = "";
                if (!persistentError) {
                    persistentError = result.detail || "Mask deleted; replacement selection could not be confirmed. Select a mask in Lightroom.";
                    deletionSelectionWarning = { message: persistentError, contextKey: presetContextKey(state) };
                }
            } else {
                creationFeedback = operation.kind === "deleteComponent" ? result.parentRemoved ?
                    (state.maskGroupCount === 0 ? "Component deleted; Lightroom removed its parent mask. No masks remain." :
                        "Component and parent mask deleted; inventory and selection confirmed by Lightroom.") :
                    result.remainingComponentCount === 0 ? "Component deleted; Lightroom retained the empty parent mask." :
                        "Component deleted; inventory and selection confirmed by Lightroom." :
                    operation.kind === "deleteAll" ? "All masks deleted; confirmed by Lightroom." :
                    state.maskGroupCount === 0 ? "Mask deleted; no masks remain. Confirmed by Lightroom." :
                        "Mask deleted; inventory and selection confirmed by Lightroom.";
            }
            setDesiredToConfirmed(state);
            if (typeof options.onHistoryChanged === "function") options.onHistoryChanged();
        }

        function reconcileRemovalWarning(next) {
            const warning = deletionRemovalWarning;
            if (!warning) return;
            if (navigationBindingKey(next) !== warning.bindingKey || !sameContext(next, currentContext())) {
                deletionRemovalWarning = null;
                return;
            }
            if (next.revision <= warning.admissionRevision || next.pendingOperation || !next.lastResult ||
                next.lastResult.operationId !== warning.operation.operationId ||
                !["confirmed", "deleted"].includes(next.lastResult.outcome)) return;
            // Only the server's strictly reconciled result for this admitted ID
            // proves removal. A surviving selection or another result cannot.
            deletionRemovalWarning = null;
            if (persistentError === warning.message) persistentError = warning.previousError;
            traceDeletion("removal-warning-reconciled", { operationId: warning.operation.operationId, result: next.lastResult });
            completedDeletion(warning.operation, next.lastResult);
        }

        function successfulOperation(operation, result) {
            if (operation.kind === "invertComponent") {
                persistentError = "";
                if (typeof options.onHistoryChanged === "function") options.onHistoryChanged();
                if (state.selectedMaskGroupId === operation.baseSelectedMaskId && state.selectedMaskToolId === operation.baseSelectedMaskToolId) {
                    componentFeedbackBinding = toolNavigationBindingKey(state);
                    componentFeedbackToolId = operation.baseSelectedMaskToolId;
                    creationFeedback = result.outcome === "confirmed" ? "Component inversion confirmed by Lightroom." :
                        "Inversion requested; Lightroom did not supply a readable prior inversion state. Check the component in Lightroom.";
                }
                setDesiredToConfirmed(state);
                return;
            }
            if (operation.kind === "deleteSelected" || operation.kind === "deleteAll" || operation.kind === "deleteComponent") {
                completedDeletion(operation, result);
                return;
            }
            persistentError = "";
            deletionSelectionWarning = null;
            if (componentCreation(operation.kind)) {
                componentFeedbackBinding = toolNavigationBindingKey(state);
                if (typeof options.onHistoryChanged === "function") options.onHistoryChanged();
                const type = maskingCorrections.creationType(operation.maskType, operation.maskSubtype);
                creationFeedback = result.outcome === "confirmed" ? componentActionLabel(operation.kind) +
                    "; component inventory and selection confirmed by Lightroom." : componentActionLabel(operation.kind) +
                    " — " + type.label + " requested. " + (type.instruction || "Lightroom has not yet confirmed the new component and selection.");
                setDesiredToConfirmed(state);
                return;
            }
            if (operation.kind === "create") {
                const type = maskingCorrections.creationType(operation.maskType, operation.maskSubtype);
                creationFeedback = result.outcome === "confirmed" ? "New mask inventory and selection confirmed by Lightroom." :
                    type.label + " requested in Lightroom. " + (type.instruction || "Waiting for Lightroom to create the mask.");
                if (result.outcome === "started" && !type.instruction) creationAwaitingInventory = {
                    contextKey: presetContextKey(state), beforeCount: operation.baseMaskGroupCount,
                    beforeMaskId: operation.baseSelectedMaskId
                };
                setDesiredToConfirmed(state);
                return;
            }
            if (operation.kind === "preset") setPresetFeedback("Applied settings from " + operation.presetName + ".", "success");
            if (operation.kind === "panel") {
                setDesiredToConfirmed(state);
                return;
            }
            if (operation.kind === "maskVisibility" || operation.kind === "toolVisibility") {
                setDesiredToConfirmed(state);
                return;
            }
            if (operation.kind === "deleteAll" || operation.kind === "resetSelected" ||
                operation.kind === "preset" || operation.kind === "pointColorPicker" ||
                operation.kind === "pointColorVisualize") {
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
                traceDeletion("matching-result", { activeOperation, result: next.lastResult });
                const operation = activeOperation;
                activeOperation = null;
                if ((operation.kind === "deleteComponent" || operation.kind === "invertComponent") && (next.lastResult.targetMaskId !== operation.baseSelectedMaskId ||
                    next.lastResult.targetToolId !== operation.baseSelectedMaskToolId)) {
                    stopNavigation(operationFailureMessage(operation, false));
                    return;
                }
                if (operation.kind === "deleteComponent" && next.lastResult.outcome === "deleted") {
                    completedDeletion(operation, next.lastResult);
                    return;
                }
                if (operation.kind === "deleteSelected" && next.lastResult.outcome === "deleted") {
                    completedDeletion(operation, next.lastResult);
                    return;
                }
                if (next.lastResult.outcome === "confirmed" || operation.kind === "invertComponent" && next.lastResult.outcome === "requested" ||
                    (operation.kind === "create" || componentCreation(operation.kind)) && next.lastResult.outcome === "started" ||
                    operation.kind !== "preset" && operation.kind !== "create" && operation.kind !== "deleteSelected" &&
                    operation.kind !== "deleteAll" && operation.kind !== "deleteComponent" && operation.kind !== "invertComponent" && !componentCreation(operation.kind) && next.lastResult.outcome === "no_change") {
                    successfulOperation(operation, next.lastResult);
                } else {
                    queuedPreset = null;
                    const message = operationFailureMessage(operation, next.lastResult.outcome === "stale", next.lastResult.detail);
                    if (operation.kind === "preset") setPresetFeedback(message, "error");
                    else stopNavigation(message);
                }
                return;
            }
            if (next.revision > activeOperation.baseRevision && !next.pendingOperation) {
                traceDeletion("result-missing", { activeOperation, state: deletionTraceState(next) });
                queuedPreset = null;
                const operation = activeOperation;
                activeOperation = null;
                if (operation.kind === "preset") setPresetFeedback("Preset application could not be confirmed. Some settings may have changed.", "error");
                else stopNavigation(operationFailureMessage(operation, false));
            }
        }

        function acceptRefreshedState(next) {
            const previous = state;
            const accepted = acceptState(previous, next, currentContext());
            traceDeletion("feedback", { accepted: accepted !== previous, incoming: deletionTraceState(next),
                previous: deletionTraceState(previous), context: currentContext(), activeOperation });
            if (accepted === previous) return false;
            // syncContext emits an empty placeholder before its SDK query returns.
            // Keep the previous same-photo display disabled during that interval;
            // the placeholder does not establish a new mask/component selection.
            if (previous && previous.available === true && accepted.available === false &&
                accepted.unavailableReason === "context_changed" && accepted.capturedAt === null &&
                presetContextKey(previous) === presetContextKey(accepted) &&
                previous.developCounter !== accepted.developCounter) return false;
            const previousBinding = navigationBindingKey(previous);
            const nextBinding = navigationBindingKey(accepted);
            const bindingChanged = previousBinding !== null && previousBinding !== nextBinding;
            const interrupted = Boolean(activeOperation && activeOperation.kind !== "preset" || navigationIntentActive || toolNavigationIntentActive);
            if (queuedPreset && (bindingChanged || accepted.available !== true ||
                queuedPreset.bindingKey !== presetFeedbackKey(accepted))) queuedPreset = null;
            if (presetFeedback && (presetFeedback.contextKey !== presetContextKey(accepted) ||
                accepted.available === true && presetFeedback.key !== presetFeedbackKey(accepted))) presetFeedback = null;
            if (activeOperation && activeOperation.kind === "preset" && accepted.available === true &&
                activeOperation.bindingKey !== presetFeedbackKey(accepted)) activeOperation = null;
            state = accepted;
            if (componentFeedbackBinding && (bindingChanged || accepted.available === true &&
                (componentFeedbackBinding !== toolNavigationBindingKey(accepted) ||
                    componentFeedbackToolId && componentFeedbackToolId !== accepted.selectedMaskToolId))) {
                componentFeedbackBinding = null;
                componentFeedbackToolId = null;
                creationFeedback = "";
            }
            reconcileRemovalWarning(state);
            if (deletionSelectionWarning && (deletionSelectionWarning.contextKey !== presetContextKey(accepted) ||
                accepted.available === true && (accepted.maskGroupCount === 0 ||
                    accepted.hasSelectedMaskGroup === true && (accepted.selectedMaskToolAvailable === true || accepted.selectedMaskToolCount === 0)))) {
                if (persistentError === deletionSelectionWarning.message) persistentError = "";
                deletionSelectionWarning = null;
            }
            if (creationAwaitingInventory) {
                if (creationAwaitingInventory.contextKey !== presetContextKey(accepted)) {
                    creationAwaitingInventory = null;
                    creationFeedback = "";
                } else if (accepted.available === true && accepted.active === true && accepted.hasSelectedMaskGroup === true &&
                    accepted.selectedMaskToolAvailable === true && accepted.maskGroupCount === creationAwaitingInventory.beforeCount + 1 &&
                    accepted.selectedMaskGroupId !== creationAwaitingInventory.beforeMaskId) {
                    creationFeedback = "New mask inventory and selection confirmed by Lightroom.";
                    creationAwaitingInventory = null;
                }
            }
            if (sharedPointColorController) {
                const pointBinding = pointColorBinding(accepted);
                sharedPointColorController.applyContext(pointBinding);
                sharedPointColorController.applyAuthoritative(accepted.pointColor, pointBinding);
            }
            if (toneCurveController) toneCurveController.applyContext(toneCurveBinding(accepted));
            if (bindingChanged) {
                traceDeletion("binding-changed", { previousBinding, nextBinding, interrupted, activeOperation });
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
                    traceDeletion("refresh-error", { message: String(error), activeOperation });
                }
            } finally {
                requestInFlight = false;
                if (requestGeneration === generation) {
                    render();
                    driveNavigation();
                    driveToolNavigation();
                    drivePreset();
                }
            }
        }

        function presetInventorySignature(value) {
            return JSON.stringify(value.map(function (preset) {
                return [preset.id, preset.name, preset.kind, preset.supported, preset.unavailableReason];
            }));
        }

        async function refreshPresets() {
            if (!rootElement || presetRequestInFlight) return;
            const requestToken = ++presetRequestToken;
            presetRequestInFlight = true;
            render();
            try {
                const response = await fetchImpl("/api/masking/presets", { cache: "no-store" });
                const data = await response.json();
                if (!rootElement || requestToken !== presetRequestToken) return;
                if (!response.ok || !data || data.ok !== true ||
                    !Array.isArray(data.presets) || data.presets.some(function (preset) {
                        return !preset || typeof preset.id !== "string" || !/^lp-[A-Za-z0-9_-]{1,76}$/.test(preset.id) ||
                            typeof preset.name !== "string" || preset.name.length < 1 || preset.name.length > 160 ||
                            !["marker", "builtin", "file"].includes(preset.kind) ||
                            typeof preset.supported !== "boolean" ||
                            (preset.unavailableReason !== null && typeof preset.unavailableReason !== "string");
                    })) throw new Error("presets");
                const nextPresets = data.presets.filter(function (preset) {
                    return preset.kind === "file" && preset.supported === true;
                });
                const inventoryChanged = presetInventorySignature(presets) !== presetInventorySignature(nextPresets);
                presets = nextPresets;
                if (inventoryChanged && presetPicker && presetPicker.open) rebuildPresetPickerInventory();
            } catch (error) {
                if (rootElement && requestToken === presetRequestToken) {
                    if (presets.length === 0) persistentError = "Local presets are unavailable right now.";
                }
            } finally {
                if (requestToken === presetRequestToken) {
                    presetRequestInFlight = false;
                    render();
                    refresh();
                }
            }
        }

        function commandQuery(regularCorrection) {
            const confirmed = state;
            if (!confirmed || !(regularCorrection === true ? sameCorrectionContext : sameContext)(confirmed, currentContext())) return null;
            return "selectedPhotoUuid=" + encodeURIComponent(confirmed.selectedPhotoUuid) +
                "&contextCounter=" + encodeURIComponent(confirmed.contextCounter) +
                "&developCounter=" + encodeURIComponent(confirmed.developCounter) +
                "&contextChangedAt=" + encodeURIComponent(confirmed.contextChangedAt) +
                "&serverEpoch=" + encodeURIComponent(confirmed.serverEpoch) +
                "&stateRevision=" + encodeURIComponent(confirmed.revision);
        }

        function admissionError(kind, status, value, detail) {
            if (kind === "invertComponent") return status === 409 ? "Photo, mask or component changed. Component inversion was cancelled." :
                "Lightroom could not receive component inversion.";
            if (kind === "deleteComponent") return status === 409 ? "Photo, mask or component changed. Delete Component was cancelled." :
                "Lightroom could not receive Delete Component.";
            if (componentCreation(kind)) return status === 409 ? "Photo or selected mask changed. Choose the component type again." :
                "Lightroom could not receive " + componentActionLabel(kind) + ".";
            if (kind === "create") return status === 409 ? "Photo or Masking state changed. Choose the mask type again." :
                "Lightroom could not receive the new mask request.";
            if (kind === "preset" && status === 422 && typeof detail === "string" && detail.trim()) {
                return detail.trim() + ".";
            }
            if (status === 409) {
                if (kind === "navigate") return "That mask change is no longer available. Masking state was refreshed.";
                if (kind === "toolNavigate") return "That mask component change is no longer available. Masking state was refreshed.";
                if (kind === "maskVisibility") return "That mask visibility change is no longer available. Masking state was refreshed.";
                if (kind === "toolVisibility") return "That component visibility change is no longer available. Masking state was refreshed.";
                if (kind === "deleteAll") return "Delete All Masks is no longer available. Masking state was refreshed.";
                if (kind === "deleteSelected") return "Delete Mask is no longer available for that selection. Masking state was refreshed.";
                if (kind === "resetSelected") return "Reset is no longer available for that selected mask. Masking state was refreshed.";
                if (kind === "preset") return "That local adjustment preset is no longer available for the selected mask.";
                if (kind === "pointColorPicker") return "The mask Color Picker is no longer available for the selected mask.";
                if (kind === "pointColorVisualize") return "Visualize Range is no longer available for the selected mask.";
                return (value ? "Open Masking" : "Close Masking") +
                    " is no longer available. Masking state was refreshed.";
            }
            if (kind === "navigate") return "Lightroom could not receive that mask change. Please try again.";
            if (kind === "toolNavigate") return "Lightroom could not receive that mask component change. Please try again.";
            if (kind === "maskVisibility") return "Lightroom could not receive that mask visibility change. Please try again.";
            if (kind === "toolVisibility") return "Lightroom could not receive that component visibility change. Please try again.";
            if (kind === "deleteAll") return "Lightroom could not receive Delete All Masks. Please try again.";
            if (kind === "deleteSelected") return "Lightroom could not receive Delete Mask. Please try again.";
            if (kind === "resetSelected") return "Lightroom could not receive the selected-mask Reset. Please try again.";
            if (kind === "preset") return "Lightroom could not receive that local adjustment preset. Please try again.";
            if (kind === "pointColorPicker") return "Lightroom could not receive the mask Color Picker request. Please try again.";
            if (kind === "pointColorVisualize") return "Lightroom could not receive mask Visualize Range. Please try again.";
            return "Lightroom could not receive " + (value ? "Open Masking" : "Close Masking") +
                ". Please try again.";
        }

        function choosePreset(preset) {
            if (!presetFeedbackKey(state) || !sameContext(state, currentContext())) return;
            if (activeOperation && activeOperation.kind === "preset") {
                if (activeOperation.bindingKey !== presetFeedbackKey(state)) return;
                // Retain only the newest choice; tapping the active preset cancels the queued replacement.
                queuedPreset = preset.id === activeOperation.presetId ? null : {
                    id: preset.id, name: preset.name, bindingKey: presetFeedbackKey(state)
                };
                render();
                return;
            }
            sendOperation("preset", preset.id);
        }

        function drivePreset() {
            if (!queuedPreset || activeOperation || !state || state.pendingOperation) return;
            const choice = queuedPreset;
            queuedPreset = null;
            if (choice.bindingKey !== presetFeedbackKey(state) || !sameContext(state, currentContext())) return;
            sendOperation("preset", choice.id);
        }

        async function sendOperation(kind, value) {
            const creationType = (kind === "create" || componentCreation(kind)) && value ? maskingCorrections.creationType(value.maskType, value.maskSubtype) : null;
            if ((kind === "create" || componentCreation(kind)) && !creationType) return false;
            const preset = kind === "preset" ? presets.find(function (entry) { return entry.id === value; }) : null;
            if (kind === "preset" && (!preset || !presetFeedbackKey(state))) return false;
            if (activeOperation || !state || state.available !== true || !sameContext(state, currentContext()) ||
                state.pendingOperation) return false;
            if (correctionBusy(kind === "pointColorVisualize")) {
                if (kind === "pointColorVisualize" && pointColorVisualizeStatus) {
                    pointColorVisualizeStatus.textContent = "Wait for the current adjustment to finish, then try again.";
                    pointColorVisualizeStatus.hidden = false;
                }
                return false;
            }
            if (kind === "deleteSelected" && (state.active !== true || state.hasSelectedMaskGroup !== true ||
                value !== state.selectedMaskGroupId)) return false;
            if (kind === "deleteAll" && state.maskGroupCount < 1) return false;
            if (kind === "deleteComponent" && (controls.deleteComponent.disabled || state.selectedMaskToolAvailable !== true ||
                value.maskId !== state.selectedMaskGroupId || value.toolId !== state.selectedMaskToolId)) return false;
            if (kind === "invertComponent" && (controls.invertComponent.disabled || state.selectedMaskToolAvailable !== true ||
                value.maskId !== state.selectedMaskGroupId || value.toolId !== state.selectedMaskToolId)) return false;
            if (componentCreation(kind) && (state.active !== true || state.hasSelectedMaskGroup !== true ||
                navigationIntentActive || toolNavigationIntentActive || controls[kind].disabled)) return false;
            const query = commandQuery();
            if (!query) return false;
            const requestGeneration = generation;
            const operation = kind === "create" || componentCreation(kind) ? {
                kind: kind, maskType: creationType.maskType, maskSubtype: creationType.maskSubtype,
                baseMaskGroupCount: state.maskGroupCount, baseSelectedMaskId: state.selectedMaskGroupId,
                baseRevision: state.revision, operationId: null
            } : kind === "panel"
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
                } : kind === "deleteAll" ? {
                    kind: kind,
                    baseRevision: state.revision,
                    baseMaskGroupCount: state.maskGroupCount,
                    operationId: null
                } : kind === "deleteComponent" || kind === "invertComponent" ? {
                    kind, baseRevision: state.revision, baseSelectedMaskId: state.selectedMaskGroupId,
                    baseSelectedMaskToolId: state.selectedMaskToolId, operationId: null
                } : kind === "resetSelected" || kind === "deleteSelected" ? {
                    kind: kind,
                    baseRevision: state.revision,
                    baseMaskGroupCount: state.maskGroupCount,
                    baseSelectedMaskId: state.selectedMaskGroupId,
                    operationId: null
                } : kind === "preset" ? {
                    kind: kind, presetId: preset.id, presetName: preset.name,
                    bindingKey: presetFeedbackKey(state), baseRevision: state.revision, operationId: null
                } : kind === "pointColorPicker" ? {
                    kind: kind,
                    baseRevision: state.revision,
                    baseMaskGroupCount: state.maskGroupCount,
                    baseSelectedMaskId: state.selectedMaskGroupId,
                    baseSelectedMaskToolId: state.selectedMaskToolId,
                    operationId: null
                } : kind === "pointColorVisualize" ? {
                    kind: kind,
                    baseRevision: state.revision,
                    baseMaskGroupCount: state.maskGroupCount,
                    baseSelectedMaskId: state.selectedMaskGroupId,
                    baseSelectedMaskToolId: state.selectedMaskToolId,
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
            componentFeedbackToolId = null;
            deletionRemovalWarning = null;
            if (kind === "deleteSelected" || kind === "deleteAll") {
                deletionTrace = { operation, attempt: ++deletionTraceAttempt, startedAt: Date.now(), sequence: 0, previous: Object.create(null) };
                traceDeletion("submit", { operation, state: deletionTraceState(state), context: currentContext() });
            }
            if ((kind === "deleteSelected" || kind === "deleteAll" || kind === "deleteComponent" || kind === "invertComponent" || componentCreation(kind)) && typeof options.onCorrectionSubmitted === "function") {
                options.onCorrectionSubmitted();
            }
            creationFeedback = "";
            componentFeedbackBinding = null;
            creationAwaitingInventory = null;
            if (kind === "preset") {
                persistentError = "";
                setPresetFeedback("Applying " + preset.name + "…", "pending");
            }
            render();
            const endpoint = kind === "deleteComponent" || kind === "invertComponent" ? "/api/masking/component/" +
                (kind === "invertComponent" ? "invert" : "delete") + "?selectedMaskGroupId=" + encodeURIComponent(operation.baseSelectedMaskId) +
                "&selectedMaskToolId=" + encodeURIComponent(operation.baseSelectedMaskToolId) + "&" + query
                : componentCreation(kind) ? "/api/masking/component/" + kind + "?maskType=" + encodeURIComponent(creationType.maskType) +
                "&maskSubtype=" + encodeURIComponent(creationType.maskSubtype) + "&selectedMaskGroupId=" + encodeURIComponent(operation.baseSelectedMaskId) + "&" + query
                : kind === "create" ? "/api/masking/create?maskType=" + encodeURIComponent(creationType.maskType) +
                "&maskSubtype=" + encodeURIComponent(creationType.maskSubtype) + "&" + query : kind === "panel"
                ? "/api/masking/panel?open=" + encodeURIComponent(value) + "&" + query
                : kind === "navigate"
                    ? "/api/masking/group/navigate?direction=" + encodeURIComponent(value) + "&" + query
                    : kind === "toolNavigate"
                        ? "/api/masking/tool/navigate?direction=" + encodeURIComponent(value) + "&" + query
                        : kind === "maskVisibility"
                            ? "/api/masking/group/visibility?hidden=" + encodeURIComponent(value) + "&" + query
                            : kind === "toolVisibility"
                                ? "/api/masking/tool/visibility?hidden=" + encodeURIComponent(value) + "&" + query
                                : kind === "deleteAll"
                                    ? "/api/masking/all/delete?" + query
                                    : kind === "deleteSelected"
                                        ? "/api/masking/selected/delete?selectedMaskGroupId=" +
                                            encodeURIComponent(operation.baseSelectedMaskId) + "&" + query
                                    : kind === "resetSelected"
                                        ? "/api/masking/selected/reset?selectedMaskGroupId=" +
                                            encodeURIComponent(state.selectedMaskGroupId) + "&" + query
                                        : kind === "preset"
                                            ? "/api/masking/preset/apply?preset=" + encodeURIComponent(preset.id) +
                                                "&selectedMaskGroupId=" + encodeURIComponent(state.selectedMaskGroupId) +
                                                "&selectedMaskToolId=" + encodeURIComponent(state.selectedMaskToolId) + "&" + query
                                        : kind === "pointColorPicker"
                                            ? "/api/masking/point-color/tool/select?selectedMaskGroupId=" +
                                                encodeURIComponent(state.selectedMaskGroupId) + "&" + query
                                            : kind === "pointColorVisualize"
                                                ? "/api/masking/point-color/range-visualization/toggle?selectedMaskGroupId=" +
                                                    encodeURIComponent(state.selectedMaskGroupId) + "&" + query
                                                : null;
            if (!endpoint) {
                activeOperation = null;
                render();
                return false;
            }
            try {
                const response = await fetchImpl(endpoint, { cache: "no-store" });
                const data = await response.json();
                if (kind === "deleteSelected" || kind === "deleteAll") traceDeletion("admission-response", {
                    status: response.status, data, requestGeneration, currentOperation: activeOperation,
                    ignored: requestGeneration !== generation || !rootElement || activeOperation !== operation });
                if (requestGeneration !== generation || !rootElement || activeOperation !== operation) return false;
                if (!response.ok || !data || data.ok !== true || typeof data.operationId !== "string") {
                    if (kind === "preset") queuedPreset = null;
                    activeOperation = null;
                    if (kind === "preset") setPresetFeedback(admissionError(kind, response.status, value, data && data.error), "error");
                    else stopNavigation(admissionError(kind, response.status, value, data && data.error));
                    render();
                    refresh();
                    return false;
                }
                if (data.serverEpoch !== state.serverEpoch || !Number.isSafeInteger(data.revision) ||
                    data.revision <= operation.baseRevision || !data.pendingOperation ||
                    data.pendingOperation.operationId !== data.operationId ||
                    !serverOperationMatchesActive(data.pendingOperation, operation)) {
                    if (kind === "preset") queuedPreset = null;
                    activeOperation = null;
                    if (kind === "preset") setPresetFeedback("Preset application could not be confirmed. Some settings may have changed.", "error");
                    else {
                        const message = operationFailureMessage(operation, false);
                        // Older server responses omitted this public field although
                        // the queued command retained its exact selected-mask target.
                        // Keep warning ownership, without accepting that admission
                        // or claiming removal until its authoritative result arrives.
                        if (kind === "deleteSelected" && sameContext(state, currentContext()) &&
                            data.serverEpoch === state.serverEpoch && Number.isSafeInteger(data.revision) &&
                            data.revision > operation.baseRevision && data.pendingOperation &&
                            data.pendingOperation.operationId === data.operationId && data.pendingOperation.kind === kind &&
                            !Object.prototype.hasOwnProperty.call(data.pendingOperation, "beforeSelectedMaskId")) {
                            operation.operationId = data.operationId;
                            deletionRemovalWarning = { operation, message, previousError: persistentError, bindingKey: navigationBindingKey(state),
                                admissionRevision: data.revision };
                        }
                        stopNavigation(message);
                        reconcileRemovalWarning(state);
                    }
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
                if (kind === "deleteSelected" || kind === "deleteAll") traceDeletion("admission-error", { message: String(error), operation });
                if (kind === "preset") queuedPreset = null;
                activeOperation = null;
                if (kind === "preset") setPresetFeedback("Connection lost while applying the preset. Some settings may have changed.", "error");
                else stopNavigation(admissionError(kind, null, value));
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
                toolNavigationIntentActive || correctionBusy() ||
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
                navigationIntentActive || correctionBusy() || (activeOperation && activeOperation.kind !== "toolNavigate") ||
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
                activeOperation || navigationIntentActive || toolNavigationIntentActive || state.pendingOperation ||
                correctionBusy()) {
                render();
                return false;
            }
            const hidden = kind === "maskVisibility" ? state.selectedMaskHidden : state.selectedMaskToolHidden;
            sendOperation(kind, !hidden);
            return true;
        }

        function createPointColorSection() {
            const root = documentRef.createElement("div");
            root.className = "masking-correction-group masking-point-color";
            const title = documentRef.createElement("div");
            title.className = "masking-correction-group-title";
            title.textContent = "Point Color";
            pointColorStatus = documentRef.createElement("div");
            pointColorStatus.className = "masking-corrections-status";
            pointColorVisualizeStatus = documentRef.createElement("p");
            pointColorVisualizeStatus.className = "command-group-note masking-point-color-visualize-status";
            pointColorVisualizeStatus.setAttribute("role", "status");
            pointColorVisualizeStatus.hidden = true;
            const host = documentRef.createElement("div");
            host.className = "masking-point-color-shared";
            root.appendChild(title);
            root.appendChild(pointColorStatus);
            root.appendChild(host);
            root.appendChild(pointColorVisualizeStatus);
            if (!pointColorModule || typeof pointColorModule.createController !== "function") {
                pointColorStatus.textContent = "Mask-local Point Color is unavailable in this controller.";
                return root;
            }
            sharedPointColorController = pointColorModule.createController({
                document: documentRef,
                fetch: fetchImpl,
                routePrefix: "/api/masking/point-color",
                externalState: true,
                commandTimeoutMs: options.pointColorCommandTimeoutMs,
                feedbackTimeoutMs: options.pointColorFeedbackTimeoutMs,
                includeSelectedIndexQuery: true,
                showHeading: false,
                showVisualize: true,
                pickerAction: function () { return sendOperation("pointColorPicker"); },
                visualizeAction: function () { return sendOperation("pointColorVisualize"); },
                pickerId: "maskPointColorPickerSelect",
                bindingKey: function (binding) {
                    if (!binding) return null;
                    return [binding.serverEpoch, binding.selectedPhotoUuid, binding.contextCounter,
                        binding.developCounter, binding.contextChangedAt, binding.selectedMaskGroupId].join("\u001f");
                },
                bindingQuery: pointColorBindingQuery,
                resultForBinding: function (binding) {
                    const result = binding && binding.lastEditResult;
                    return result && result.maskGroupId === binding.selectedMaskGroupId &&
                        typeof result.kind === "string" && result.kind.indexOf("masking.point_color.") === 0
                        ? result : null;
                },
                requestCommand: async function (path) {
                    const response = await fetchImpl(path, { cache: "no-store" });
                    const body = await response.json();
                    if (!response.ok || !body || body.ok !== true) {
                        throw new Error(body && body.error || "Mask Point Color request failed");
                    }
                    return body;
                },
                setStatus: function (message) {
                    if (pointColorStatus) pointColorStatus.textContent = message || "";
                    if (pointColorVisualizeStatus) {
                        pointColorVisualizeStatus.textContent = "";
                        pointColorVisualizeStatus.hidden = true;
                    }
                },
                onRefreshRequested: function () { refresh(); },
                onInteractionChange: function () { if (rootElement) render(); }
            });
            const binding = pointColorBinding(state);
            sharedPointColorController.applyContext(binding);
            if (state && state.pointColor) sharedPointColorController.applyAuthoritative(state.pointColor, binding);
            sharedPointColorController.mount(host);
            return root;
        }

        function correctionValueText(control, value) {
            return Number.isFinite(value) ? value.toFixed(control.precision) : "";
        }

        function showCorrectionValue(control, value) {
            if (!Number.isFinite(value)) return;
            const clamped = Math.min(control.maximum, Math.max(control.minimum, value));
            control.range.value = String(clamped);
            if (control.range.style && control.range.style.setProperty) {
                const progress = control.maximum > control.minimum
                    ? 100 * (clamped - control.minimum) / (control.maximum - control.minimum) : 0;
                control.range.style.setProperty("--slider-progress", progress + "%");
            }
            if (control.numberEditing !== true) control.number.value = correctionValueText(control, clamped);
        }

        function clearCorrectionTimers(control) {
            if (control.throttleTimer !== null) clearTimeout(control.throttleTimer);
            if (control.stepTimer !== null) clearTimeout(control.stepTimer);
            if (control.confirmationTimer !== null) clearTimeout(control.confirmationTimer);
            control.throttleTimer = null;
            control.stepTimer = null;
            control.confirmationTimer = null;
        }

        function cancelCorrectionControl(control, restore) {
            clearCorrectionTimers(control);
            control.editRevision += 1;
            control.queuedSubmission = null;
            control.interruptedPointer = Boolean(control.interruptedPointer || control.pointerActive);
            control.pointerActive = false;
            control.gestureId = null;
            control.desiredValue = null;
            control.resetInFlight = false;
            control.confirmationTimedOut = false;
            control.numberEditing = false;
            control.numberOriginalText = null;
            if (restore && Number.isFinite(control.authoritativeValue)) showCorrectionValue(control, control.authoritativeValue);
        }

        function correctionCommandQuery(control) {
            if (correctionBindingRejected()) return null;
            const query = commandQuery(true);
            const groupId = state && state.selectedMaskGroupId;
            if (!query || typeof groupId !== "string") return null;
            return "parameter=" + encodeURIComponent(control.definition.parameter) +
                "&selectedMaskGroupId=" + encodeURIComponent(groupId) + "&" + query;
        }

        function correctionEndpoint(control, submission) {
            const query = correctionCommandQuery(control);
            if (!query) return null;
            if (submission.kind === "reset") return "/api/masking/correction/reset?" + query;
            let endpoint = "/api/masking/correction/gesture/";
            if (submission.kind === "begin") endpoint += "begin";
            else if (submission.kind === "update") endpoint += "update";
            else if (submission.kind === "end") endpoint += "end";
            else endpoint += "cancel";
            endpoint += "?gestureId=" + encodeURIComponent(submission.gestureId);
            if (submission.kind === "update" || submission.kind === "end") {
                endpoint += "&value=" + encodeURIComponent(submission.value);
            }
            return endpoint + "&" + query;
        }

        function correctionFailure(control, message) {
            control.error = message || "Lightroom could not apply that Masking correction.";
            control.desiredValue = null;
            control.gestureId = null;
            control.resetInFlight = false;
            if (control.confirmationTimer !== null) clearTimeout(control.confirmationTimer);
            control.confirmationTimer = null;
            if (Number.isFinite(control.authoritativeValue)) showCorrectionValue(control, control.authoritativeValue);
        }

        function correctionBindingRejected() {
            return Boolean(rejectedCorrectionBinding && state &&
                rejectedCorrectionBinding.key === correctionBindingKey(state) &&
                state.revision <= rejectedCorrectionBinding.revision);
        }

        function retainInterruptedCorrection(control) {
            if (!state || !control.lastSubmittedSequence ||
                (control.desiredValue === null && !control.resetInFlight && !control.confirmationTimedOut)) return;
            control.interrupted = { sequence: control.lastSubmittedSequence, serverEpoch: state.serverEpoch,
                selectedPhotoUuid: state.selectedPhotoUuid, maskGroupId: state.selectedMaskGroupId };
        }

        function ownCorrectionEdit(control) {
            control.editRevision += 1;
            control.interrupted = null;
            control.confirmationTimedOut = false;
            if (control.confirmationTimer !== null) clearTimeout(control.confirmationTimer);
            control.confirmationTimer = null;
            control.resetInFlight = false;
        }

        function queueCorrectionSubmission(control, submission) {
            if (!rootElement || control.bindingKey !== correctionBindingKey(state)) return false;
            if (submission.editRevision === undefined) {
                submission = Object.assign({ editRevision: control.editRevision }, submission);
            }
            if (control.requestInFlight) {
                if (!control.queuedSubmission || submission.kind !== "update" ||
                    control.queuedSubmission.kind === "update") control.queuedSubmission = submission;
                render();
                return true;
            }
            const endpoint = correctionEndpoint(control, submission);
            if (!endpoint) return false;
            const requestGeneration = correctionGeneration;
            const requestBinding = control.bindingKey;
            const requestRevision = state.revision;
            control.requestInFlight = true;
            correctionRequestCount += 1;
            render();
            if (typeof options.onCorrectionSubmitted === "function") options.onCorrectionSubmitted();
            Promise.resolve(fetchImpl(endpoint, { cache: "no-store" })).then(function (response) {
                return response.json().then(function (body) { return { response: response, body: body }; });
            }).then(function (result) {
                if (!rootElement || requestGeneration !== correctionGeneration || requestBinding !== correctionBindingKey(state)) return;
                if (!result.response.ok || !result.body || result.body.ok !== true ||
                    !Number.isSafeInteger(result.body.correctionSequence)) {
                    const code = result.body && result.body.code;
                    if (submission.editRevision === control.editRevision && result.response.status === 409 &&
                        (code === "stale_context" || code === "stale_selection" && requestRevision >= state.revision)) {
                        rejectedCorrectionBinding = { key: requestBinding, revision: state.revision };
                        Object.keys(correctionControls).forEach(function (parameter) {
                            const other = correctionControls[parameter];
                            if (other.bindingKey === requestBinding) {
                                other.interruptedPointer = other.pointerActive;
                                retainInterruptedCorrection(other);
                                cancelCorrectionControl(other, false);
                            }
                        });
                        correctionFailure(control, result.body.error);
                        control.ignoreNextRangeChange = true;
                        render();
                    } else if (submission.editRevision === control.editRevision) {
                        correctionFailure(control, result.response.status === 409
                            ? result.body && result.body.error || "Lightroom rejected that Masking correction. Refresh Masking and check the selected mask."
                            : "Lightroom could not receive that Masking correction.");
                        control.queuedSubmission = null;
                    }
                    refresh();
                    return;
                }
                control.lastSubmittedSequence = Math.max(control.lastSubmittedSequence, result.body.correctionSequence);
                if (submission.editRevision !== control.editRevision) return;
                if (submission.kind === "reset") control.resetInFlight = true;
                if (submission.kind === "end" || submission.kind === "reset") {
                    const confirmationSequence = result.body.correctionSequence;
                    if (control.confirmationTimer !== null) clearTimeout(control.confirmationTimer);
                    control.confirmationTimer = setTimeout(function () {
                        // A prior end response/deadline cannot take ownership from
                        // newer input, even before its next request is admitted.
                        if (submission.editRevision !== control.editRevision ||
                            confirmationSequence !== control.lastSubmittedSequence) return;
                        control.confirmationTimer = null;
                        if (control.bindingKey === correctionBindingKey(state) &&
                            (control.desiredValue !== null || control.resetInFlight)) {
                            control.confirmationTimedOut = true;
                            correctionFailure(control, "Lightroom did not confirm that Masking correction in time.");
                            render();
                            refresh();
                        }
                    }, 3000);
                }
            }).catch(function () {
                if (rootElement && requestGeneration === correctionGeneration && requestBinding === correctionBindingKey(state) &&
                    submission.editRevision === control.editRevision) {
                    correctionFailure(control, "Could not send that Masking correction.");
                    control.queuedSubmission = null;
                }
            }).finally(function () {
                control.requestInFlight = false;
                correctionRequestCount = Math.max(0, correctionRequestCount - 1);
                if (!rootElement || requestGeneration !== correctionGeneration || requestBinding !== correctionBindingKey(state)) {
                    control.queuedSubmission = null;
                    render();
                    return;
                }
                const queued = control.queuedSubmission;
                control.queuedSubmission = null;
                render();
                if (queued) queueCorrectionSubmission(control, queued);
                else refresh();
            });
            return true;
        }

        function newCorrectionGesture(control) {
            ownCorrectionEdit(control);
            correctionGestureCounter += 1;
            control.gestureId = "mg-" + correctionGestureCounter + "-" + Date.now().toString(36);
            control.error = "";
            queueCorrectionSubmission(control, { kind: "begin", gestureId: control.gestureId });
            return control.gestureId;
        }

        function beginCorrectionGesture(control) {
            return control.gestureId || newCorrectionGesture(control);
        }

        function stageCorrectionValue(control, value) {
            if (control.range.disabled || control.interruptedPointer) return false;
            if (!Number.isFinite(value)) return false;
            const normalized = Math.min(control.maximum, Math.max(control.minimum, value));
            control.desiredValue = Number(normalized.toFixed(control.precision));
            showCorrectionValue(control, control.desiredValue);
            const gestureId = beginCorrectionGesture(control);
            if (control.throttleTimer === null) {
                control.throttleTimer = setTimeout(function () {
                    control.throttleTimer = null;
                    if (control.gestureId === gestureId && control.desiredValue !== null) {
                        queueCorrectionSubmission(control, {
                            kind: "update", gestureId: gestureId, value: control.desiredValue
                        });
                    }
                }, 100);
            }
            render();
            return true;
        }

        function finishCorrectionGesture(control, value) {
            if (control.range.disabled || control.interruptedPointer) return false;
            if (control.throttleTimer !== null) clearTimeout(control.throttleTimer);
            control.throttleTimer = null;
            const gestureId = beginCorrectionGesture(control);
            const normalized = Math.min(control.maximum, Math.max(control.minimum, value));
            control.desiredValue = Number(normalized.toFixed(control.precision));
            showCorrectionValue(control, control.desiredValue);
            queueCorrectionSubmission(control, { kind: "end", gestureId: gestureId, value: control.desiredValue });
            control.gestureId = null;
            render();
        }

        function cancelCorrectionGesture(control) {
            ownCorrectionEdit(control);
            const gestureId = control.gestureId;
            if (control.throttleTimer !== null) clearTimeout(control.throttleTimer);
            control.throttleTimer = null;
            control.desiredValue = null;
            control.gestureId = null;
            if (gestureId) queueCorrectionSubmission(control, { kind: "cancel", gestureId: gestureId });
            if (Number.isFinite(control.authoritativeValue)) showCorrectionValue(control, control.authoritativeValue);
            render();
        }

        function commitCorrectionNumber(control) {
            if (control.number.disabled) { control.numberEditing = false; return false; }
            const text = String(control.number.value || "").trim();
            const numeric = text === "" ? NaN : Number(text);
            const unchanged = control.numberOriginalText !== null && text === control.numberOriginalText;
            control.numberEditing = false;
            control.numberOriginalText = null;
            if (unchanged) {
                if (Number.isFinite(control.authoritativeValue)) showCorrectionValue(control, control.authoritativeValue);
                render();
                return true;
            }
            if (!Number.isFinite(numeric) || numeric < control.minimum || numeric > control.maximum) {
                control.error = "Enter a value from " + correctionValueText(control, control.minimum) + " to " +
                    correctionValueText(control, control.maximum) + ".";
                if (Number.isFinite(control.authoritativeValue)) showCorrectionValue(control, control.authoritativeValue);
                render();
                return false;
            }
            const gestureId = newCorrectionGesture(control);
            control.desiredValue = Number(numeric.toFixed(control.precision));
            showCorrectionValue(control, control.desiredValue);
            queueCorrectionSubmission(control, { kind: "end", gestureId: gestureId, value: control.desiredValue });
            control.gestureId = null;
            render();
            return true;
        }

        function stepCorrection(control, direction) {
            if (control.range.disabled) return;
            const base = control.desiredValue !== null ? control.desiredValue : control.authoritativeValue;
            if (!Number.isFinite(base)) return;
            ownCorrectionEdit(control);
            control.error = "";
            control.desiredValue = Math.min(control.maximum, Math.max(control.minimum,
                Number((base + direction * control.step).toFixed(control.precision))));
            showCorrectionValue(control, control.desiredValue);
            if (control.stepTimer !== null) clearTimeout(control.stepTimer);
            control.stepTimer = setTimeout(function () {
                control.stepTimer = null;
                const gestureId = newCorrectionGesture(control);
                queueCorrectionSubmission(control, {
                    kind: "end", gestureId: gestureId, value: control.desiredValue
                });
                control.gestureId = null;
                render();
            }, 350);
            render();
        }

        function resetCorrection(control) {
            if (control.reset.disabled) return;
            const displayedValue = Number(control.range.value);
            clearCorrectionTimers(control);
            ownCorrectionEdit(control);
            if (control.gestureId) {
                queueCorrectionSubmission(control, { kind: "cancel", gestureId: control.gestureId });
            }
            control.gestureId = null;
            // Hold the current display until this Reset's SDK result supplies
            // its value. Retire the preceding completion even if admission fails.
            control.desiredValue = displayedValue;
            control.lastHandledFeedbackSequence = Math.max(control.lastHandledFeedbackSequence, control.lastSubmittedSequence);
            control.error = "";
            queueCorrectionSubmission(control, { kind: "reset" });
        }

        function createCorrectionControl(definition) {
            const row = documentRef.createElement("div");
            row.className = "develop-slider-row masking-correction-row";
            row.dataset.maskingCorrection = definition.parameter;
            const name = documentRef.createElement("div");
            name.className = "slider-name";
            name.textContent = definition.label;
            const range = documentRef.createElement("input");
            range.type = "range";
            range.disabled = true;
            range.setAttribute("aria-label", definition.label);
            const number = documentRef.createElement("input");
            number.type = "text";
            number.inputMode = "decimal";
            number.autocomplete = "off";
            number.spellcheck = false;
            number.disabled = true;
            number.setAttribute("aria-label", definition.label + " numeric value");
            const decrement = createButton(documentRef, "−", "develop-slider-step");
            decrement.setAttribute("aria-label", "Decrease " + definition.label);
            const increment = createButton(documentRef, "+", "develop-slider-step");
            increment.setAttribute("aria-label", "Increase " + definition.label);
            const reset = createButton(documentRef, "Reset", "reset");
            const status = documentRef.createElement("span");
            status.className = "develop-slider-state";
            const control = {
                definition: definition, row: row, range: range, number: number, decrement: decrement,
                increment: increment, reset: reset, status: status, available: false, authoritativeValue: null,
                desiredValue: null, minimum: null, maximum: null, precision: 0, step: 1, pointerActive: false,
                numberEditing: false, numberOriginalText: null, gestureId: null, requestInFlight: false, queuedSubmission: null,
                resetInFlight: false, throttleTimer: null, stepTimer: null, confirmationTimer: null, editRevision: 0,
                bindingKey: null, error: "", lastSubmittedSequence: 0, lastHandledFeedbackSequence: 0,
                ignoreNextRangeChange: false, interrupted: null, interruptedPointer: false, confirmationTimedOut: false
            };
            range.addEventListener("pointerdown", function () {
                if (range.disabled) return;
                control.interruptedPointer = false;
                control.pointerActive = true;
                beginCorrectionGesture(control);
            });
            range.addEventListener("input", function () { stageCorrectionValue(control, Number(range.value)); });
            range.addEventListener("pointerup", function () {
                control.pointerActive = false;
                control.ignoreNextRangeChange = true;
                if (control.interruptedPointer) { control.interruptedPointer = false; return; }
                finishCorrectionGesture(control, Number(range.value));
            });
            range.addEventListener("pointercancel", function () {
                control.pointerActive = false;
                control.ignoreNextRangeChange = true;
                cancelCorrectionGesture(control);
            });
            range.addEventListener("lostpointercapture", function () {
                if (!control.pointerActive) return;
                control.pointerActive = false;
                control.ignoreNextRangeChange = true;
                cancelCorrectionGesture(control);
            });
            range.addEventListener("change", function () {
                if (control.ignoreNextRangeChange) {
                    control.ignoreNextRangeChange = false;
                    return;
                }
                if (!control.pointerActive && control.gestureId === null) {
                    finishCorrectionGesture(control, Number(range.value));
                }
            });
            number.addEventListener("focus", function () {
                control.numberEditing = true;
                control.numberOriginalText = String(number.value || "").trim();
                control.error = "";
            });
            number.addEventListener("keydown", function (event) {
                if (event.key === "Enter") { if (event.preventDefault) event.preventDefault(); commitCorrectionNumber(control); }
                if (event.key === "Escape") {
                    if (event.preventDefault) event.preventDefault();
                    control.numberEditing = false;
                    control.numberOriginalText = null;
                    control.error = "";
                    showCorrectionValue(control, control.desiredValue !== null
                        ? control.desiredValue : control.authoritativeValue);
                    render();
                }
            });
            number.addEventListener("blur", function () { if (control.numberEditing) commitCorrectionNumber(control); });
            decrement.addEventListener("click", function () { stepCorrection(control, -1); });
            increment.addEventListener("click", function () { stepCorrection(control, 1); });
            reset.addEventListener("click", function () { resetCorrection(control); });
            [range, number, decrement, increment, reset].forEach(function (element) { element.disabled = true; });
            row.appendChild(name);
            row.appendChild(range);
            row.appendChild(number);
            row.appendChild(decrement);
            row.appendChild(increment);
            row.appendChild(reset);
            row.appendChild(status);
            return control;
        }

        function renderCorrections() {
            if (!correctionStatus) return;
            const bindingKey = correctionBindingKey(state);
            const values = state && Array.isArray(state.corrections) ? state.corrections : [];
            const availableByParameter = Object.create(null);
            values.forEach(function (entry) { availableByParameter[entry.parameter] = entry; });
            const groupCounts = Object.create(null);
            maskingCorrections.groups.forEach(function (group) { groupCounts[group] = 0; });
            const results = state && Array.isArray(state.correctionResults) ? state.correctionResults
                : state && state.lastCorrectionResult ? [state.lastCorrectionResult] : [];
            Object.keys(correctionControls).forEach(function (parameter) {
                const control = correctionControls[parameter];
                const result = results.find(function (entry) { return entry.parameter === parameter; });
                const entry = bindingKey ? availableByParameter[parameter] : null;
                if (control.bindingKey !== bindingKey) {
                    cancelCorrectionControl(control, false);
                    control.bindingKey = bindingKey;
                    control.error = "";
                    control.lastSubmittedSequence = 0;
                    control.lastHandledFeedbackSequence = 0;
                }
                if (control.interrupted) {
                    const interrupted = control.interrupted;
                    if (!state || interrupted.serverEpoch !== state.serverEpoch ||
                        interrupted.selectedPhotoUuid !== state.selectedPhotoUuid ||
                        interrupted.maskGroupId !== state.selectedMaskGroupId) control.interrupted = null;
                    else {
                        const cancellation = (state.correctionCancellations || []).find(function (entry) {
                            return entry.sequence === interrupted.sequence && entry.parameter === parameter &&
                                entry.serverEpoch === interrupted.serverEpoch && entry.selectedPhotoUuid === interrupted.selectedPhotoUuid &&
                                entry.maskGroupId === interrupted.maskGroupId && entry.dispatched === false;
                        });
                        control.error = cancellation
                            ? "This adjustment was cancelled before reaching Lightroom because its context changed. Adjust again when ready."
                            : "Lightroom's context changed before this adjustment was confirmed. Check the value in Lightroom.";
                    }
                }
                if (!control.interrupted && result && result.parameter === parameter && result.maskGroupId === state.selectedMaskGroupId &&
                    Number.isSafeInteger(result.sequence) &&
                    // Admission can trail the next local edit. Keep that edit's ownership
                    // until its sequence is known; an earlier completion cannot settle it.
                    !control.requestInFlight && !control.queuedSubmission && !control.pointerActive &&
                    !control.gestureId && control.throttleTimer === null && control.stepTimer === null &&
                    result.sequence > control.lastHandledFeedbackSequence) {
                    control.lastHandledFeedbackSequence = result.sequence;
                    if (result.sequence >= control.lastSubmittedSequence) {
                        control.confirmationTimedOut = false;
                        if (result.outcome !== "confirmed") {
                            correctionFailure(control, result.detail || "Lightroom rejected that Masking correction.");
                        } else {
                            control.desiredValue = null;
                            control.resetInFlight = false;
                            control.error = "";
                            if (control.confirmationTimer !== null) clearTimeout(control.confirmationTimer);
                            control.confirmationTimer = null;
                        }
                    }
                }
                const available = entry && Number.isFinite(entry.value) && Number.isFinite(entry.min) &&
                    Number.isFinite(entry.max) && entry.min < entry.max && entry.value >= entry.min && entry.value <= entry.max;
                const wasAvailable = control.available;
                control.available = Boolean(available);
                control.row.hidden = !available;
                if (!available) {
                    if (wasAvailable) cancelCorrectionControl(control, false);
                    [control.range, control.number, control.decrement, control.increment, control.reset].forEach(function (element) {
                        element.disabled = true;
                    });
                    return;
                }
                groupCounts[control.definition.group] += 1;
                control.authoritativeValue = entry.value;
                control.minimum = entry.min;
                control.maximum = entry.max;
                control.precision = maskingCorrections.precisionForRange(entry.min, entry.max);
                control.step = Math.pow(10, -control.precision);
                if (control.desiredValue !== null &&
                    (control.desiredValue < control.minimum || control.desiredValue > control.maximum)) {
                    correctionFailure(control, "Lightroom changed this correction's available range.");
                }
                control.range.min = String(entry.min);
                control.range.max = String(entry.max);
                control.range.step = String(control.step);
                const blocked = Boolean(correctionBindingRejected() || !sameCorrectionContext(state, currentContext()) || activeOperation || state.pendingOperation || navigationIntentActive || toolNavigationIntentActive);
                control.range.disabled = blocked;
                control.number.disabled = blocked;
                control.decrement.disabled = blocked || (control.desiredValue !== null
                    ? control.desiredValue : entry.value) <= entry.min;
                control.increment.disabled = blocked || (control.desiredValue !== null
                    ? control.desiredValue : entry.value) >= entry.max;
                control.reset.disabled = blocked || control.resetInFlight || control.requestInFlight;
                showCorrectionValue(control, control.desiredValue !== null ? control.desiredValue : entry.value);
                control.row.classList.toggle("error", Boolean(control.error));
                control.row.classList.toggle("loading", !control.error &&
                    (control.requestInFlight || control.queuedSubmission !== null || control.desiredValue !== null || control.resetInFlight));
                control.status.textContent = control.error || (control.resetInFlight ? "Resetting…" :
                    (control.requestInFlight || control.queuedSubmission !== null || control.desiredValue !== null ? "Updating…" : ""));
            });
            const selected = state && state.available === true && state.active === true && state.hasSelectedMaskGroup === true;
            maskingCorrections.groups.forEach(function (group) {
                if (correctionGroups[group]) correctionGroups[group].hidden = groupCounts[group] === 0 &&
                    !(group === "Effects" && selected && sharedGrainControlCount > 0);
            });
            correctionStatus.textContent = !bindingKey ? "" : values.length === 0
                ? "No supported scalar corrections are available for this mask." : "";
            correctionStatus.hidden = !selected || values.length > 0;
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
            const creation = documentRef.createElement("div");
            creation.className = "masking-create-control";
            const create = createButton(documentRef, "Create New Mask", "positive masking-create-button");
            const add = createButton(documentRef, "Add", "positive masking-add-button");
            add.setAttribute("aria-label", componentActionLabel("add"));
            const subtract = createButton(documentRef, "Subtract", "masking-subtract-button");
            subtract.setAttribute("aria-label", componentActionLabel("subtract"));
            const deleteComponent = createButton(documentRef, "Delete Component", "destructive masking-delete-component-button");
            [add, subtract].forEach(function (button) {
                button.setAttribute("aria-haspopup", "dialog");
                button.setAttribute("aria-expanded", "false");
            });
            create.setAttribute("aria-haspopup", "dialog");
            create.setAttribute("aria-expanded", "false");
            create.disabled = true;
            const creationMenu = documentRef.createElement("dialog");
            creationMenu.className = "masking-create-menu";
            creationMenu.setAttribute("role", "dialog");
            creationMenu.setAttribute("aria-label", "Choose new mask type");
            creationMenu.setAttribute("aria-modal", "true");
            creationMenu.hidden = true;
            const creationHeader = documentRef.createElement("div");
            creationHeader.className = "masking-create-header";
            const creationTitle = documentRef.createElement("strong");
            creationTitle.textContent = "Create New Mask";
            const creationClose = createButton(documentRef, "Close", "masking-create-close");
            creationHeader.appendChild(creationTitle);
            creationHeader.appendChild(creationClose);
            const creationChoices = documentRef.createElement("div");
            creationChoices.className = "masking-create-choices";
            creationMenu.appendChild(creationHeader);
            creationMenu.appendChild(creationChoices);
            let creationMenuBinding = null;
            let creationMenuKind = "create";
            let creationMenuTrigger = create;
            creationMenuClose = function (restoreFocus) {
                if (creationMenu.open && typeof creationMenu.close === "function") creationMenu.close();
                creationMenu.hidden = true;
                creationMenuBinding = null;
                creationMenuTrigger.setAttribute("aria-expanded", "false");
                if (restoreFocus && typeof creationMenuTrigger.focus === "function") creationMenuTrigger.focus({ preventScroll: true });
            };
            const pickerBinding = kind => componentCreation(kind) ? toolNavigationBindingKey(state) : navigationBindingKey(state);
            creationMenuClose.validate = function () {
                if (!creationMenu.hidden && (creationMenuTrigger.disabled || creationMenuBinding !== pickerBinding(creationMenuKind))) {
                    creationMenuClose(false);
                }
            };
            maskingCorrections.creationTypes.forEach(function (type) {
                if (type.maskType === "brush" || (type.maskType === "rangeMask" && type.maskSubtype === "color")) {
                    const separator = documentRef.createElement("div");
                    separator.className = "masking-create-separator";
                    separator.setAttribute("role", "separator");
                    creationChoices.appendChild(separator);
                }
                // Menu wording is independent of the existing creation-feedback labels.
                const label = type.maskType === "aiSelection" ? "Select " + type.label : type.label;
                const choice = createButton(documentRef, label, "masking-create-type");
                choice.dataset.maskType = type.maskType;
                choice.dataset.maskSubtype = type.maskSubtype;
                if (type.instruction) choice.title = type.instruction;
                choice.addEventListener("click", function () {
                    const menuBinding = creationMenuBinding;
                    const kind = creationMenuKind;
                    creationMenuClose(true);
                    if (!menuBinding || menuBinding !== pickerBinding(kind) || !sameContext(state, currentContext())) return;
                    persistentError = "";
                    sendOperation(kind, type);
                });
                creationChoices.appendChild(choice);
            });
            function openCreationMenu(kind, trigger) {
                if (trigger.disabled) return;
                const opening = creationMenu.hidden;
                if (!opening) { creationMenuClose(false); return; }
                creationMenuKind = kind;
                creationMenuTrigger = trigger;
                creationMenuBinding = pickerBinding(kind);
                creationTitle.textContent = kind === "create" ? "Create New Mask" : componentActionLabel(kind);
                creationMenu.setAttribute("aria-label", kind === "create" ? "Choose new mask type" : componentActionLabel(kind) + " — choose component type");
                creationMenu.hidden = !opening;
                trigger.setAttribute("aria-expanded", String(opening));
                if (typeof creationMenu.showModal === "function") creationMenu.showModal();
                creationChoices.scrollTop = 0;
                if (typeof creationClose.focus === "function") creationClose.focus({ preventScroll: true });
            }
            create.addEventListener("click", function () { openCreationMenu("create", create); });
            add.addEventListener("click", function () { openCreationMenu("add", add); });
            subtract.addEventListener("click", function () { openCreationMenu("subtract", subtract); });
            creationClose.addEventListener("click", function () { creationMenuClose(true); });
            creationMenu.addEventListener("cancel", function (event) {
                event.preventDefault();
                creationMenuClose(true);
            });
            creationMenu.addEventListener("keydown", function (event) {
                if (event.key === "Escape") {
                    if (event.preventDefault) event.preventDefault();
                    creationMenuClose(true);
                }
            });
            const outsideCreation = function (event) {
                if (creationMenu.hidden) return;
                if (event.target === creationMenu && typeof creationMenu.getBoundingClientRect === "function") {
                    const rect = creationMenu.getBoundingClientRect();
                    if (event.clientX < rect.left || event.clientX > rect.right ||
                        event.clientY < rect.top || event.clientY > rect.bottom) creationMenuClose(true);
                } else if (!creation.contains(event.target)) creationMenuClose(false);
            };
            if (typeof documentRef.addEventListener === "function") documentRef.addEventListener("pointerdown", outsideCreation);
            creationMenuClose.dispose = function () {
                if (typeof documentRef.removeEventListener === "function") documentRef.removeEventListener("pointerdown", outsideCreation);
            };
            creation.appendChild(create);
            creation.appendChild(creationMenu);
            const actionRow = documentRef.createElement("div");
            actionRow.className = "masking-action-row";
            actionRow.appendChild(creation);
            const deleteSelected = createButton(documentRef, "Delete Mask", "masking-delete-selected-button destructive");
            const deleteAll = createButton(documentRef, "Delete All Masks", "masking-delete-all-button destructive");
            actionRow.appendChild(deleteSelected);
            actionRow.appendChild(deleteAll);
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
            const componentActions = documentRef.createElement("div");
            componentActions.className = "masking-action-row masking-component-actions";
            componentActions.appendChild(add);
            componentActions.appendChild(subtract);
            componentActions.appendChild(deleteComponent);
            const componentControls = documentRef.createElement("div");
            componentControls.className = "masking-component-controls";
            const componentHeading = documentRef.createElement("h3");
            componentHeading.className = "masking-component-heading";
            componentHeading.textContent = "Selected Component";
            const invertCheckboxLabel = documentRef.createElement("label");
            invertCheckboxLabel.className = "masking-component-invert-label";
            const invertCheckbox = documentRef.createElement("input");
            invertCheckbox.type = "checkbox";
            invertCheckbox.className = "masking-component-invert-checkbox";
            invertCheckbox.setAttribute("aria-label", "Invert selected component");
            invertCheckboxLabel.appendChild(invertCheckbox);
            const invertText = documentRef.createElement("span");
            invertText.textContent = "Invert";
            invertCheckboxLabel.appendChild(invertText);
            const invertComponent = createButton(documentRef, "Invert Component", "masking-component-invert-button");
            invertComponent.setAttribute("aria-label", "Invert selected component");
            componentControls.appendChild(componentHeading);
            componentControls.appendChild(invertCheckboxLabel);
            componentControls.appendChild(invertComponent);
            const toolLimitations = documentRef.createElement("p");
            toolLimitations.className = "command-group-note masking-tool-limitations";
            toolLimitations.innerHTML = "Adjust these directly in Lightroom: <strong>Brush Size</strong>, <strong>Feather</strong>, <strong>Flow</strong>, <strong>Density</strong> and <strong>Auto Mask</strong>; <strong>Radial Gradient Feather</strong>; and <strong>Color Range Refine</strong>. The installed SDK has no documented controls for these tool settings. Mask adjustment sliders remain available below.";
            componentControls.appendChild(toolLimitations);
            const status = documentRef.createElement("div");
            status.className = "masking-status";
            status.setAttribute("aria-live", "polite");
            const corrections = documentRef.createElement("div");
            corrections.className = "masking-corrections";
            const correctionsTitle = documentRef.createElement("div");
            correctionsTitle.className = "masking-corrections-title";
            const correctionsTitleText = documentRef.createElement("span");
            correctionsTitleText.textContent = "Adjustments";
            const preset = createButton(documentRef, PRESET_BUTTON_LABEL, "masking-preset-button");
            preset.setAttribute("aria-haspopup", "dialog");
            preset.setAttribute("aria-expanded", "false");
            preset.setAttribute("aria-label", "Choose mask preset");
            preset.setAttribute("aria-describedby", "maskingPresetExplanation");
            const presetExplanation = documentRef.createElement("p");
            presetExplanation.id = "maskingPresetExplanation";
            presetExplanation.className = "masking-preset-explanation";
            presetExplanation.textContent = PRESET_EXPLANATION;
            const resetSelected = createButton(documentRef, "Reset", "masking-reset-selected-button");
            correctionsTitle.appendChild(correctionsTitleText);
            correctionsTitle.appendChild(preset);
            const presetFeedbackStatus = documentRef.createElement("div");
            presetFeedbackStatus.className = "masking-preset-feedback";
            presetFeedbackStatus.setAttribute("role", "status");
            presetFeedbackStatus.setAttribute("aria-live", "polite");
            presetFeedbackStatus.hidden = true;
            correctionsTitle.appendChild(resetSelected);
            const correctionsAvailability = documentRef.createElement("div");
            correctionsAvailability.className = "masking-corrections-status";
            correctionsAvailability.setAttribute("aria-live", "polite");
            corrections.appendChild(correctionsTitle);
            corrections.appendChild(presetExplanation);
            corrections.appendChild(presetFeedbackStatus);
            corrections.appendChild(correctionsAvailability);
            const presetDialog = documentRef.createElement("dialog");
            presetDialog.className = "develop-preset-picker masking-preset-picker";
            presetDialog.hidden = true;
            presetDialog.setAttribute("role", "dialog");
            presetDialog.setAttribute("aria-modal", "true");
            presetDialog.setAttribute("aria-labelledby", "maskingPresetPickerTitle");
            presetDialog.setAttribute("aria-describedby", "maskingPresetPickerDescription");
            const presetShell = documentRef.createElement("div");
            presetShell.className = "develop-preset-picker-shell";
            const presetHeader = documentRef.createElement("div");
            presetHeader.className = "develop-preset-picker-header";
            const presetTitle = documentRef.createElement("h3");
            presetTitle.id = "maskingPresetPickerTitle";
            presetTitle.textContent = "Apply Mask Preset";
            const presetClose = createButton(documentRef, "Close", "develop-preset-picker-close secondary");
            presetHeader.appendChild(presetTitle);
            presetHeader.appendChild(presetClose);
            const presetDescription = documentRef.createElement("p");
            presetDescription.id = "maskingPresetPickerDescription";
            presetDescription.className = "develop-preset-picker-description";
            presetDescription.textContent = PRESET_EXPLANATION;
            const presetStatus = documentRef.createElement("div");
            presetStatus.className = "masking-preset-picker-status";
            presetStatus.setAttribute("role", "status");
            presetStatus.setAttribute("aria-live", "polite");
            const presetList = documentRef.createElement("div");
            presetList.className = "develop-preset-picker-list masking-preset-picker-list";
            presetList.setAttribute("role", "group");
            presetList.setAttribute("aria-label", "Mask presets");
            presetShell.appendChild(presetHeader);
            presetShell.appendChild(presetDescription);
            presetShell.appendChild(presetStatus);
            presetShell.appendChild(presetList);
            presetDialog.appendChild(presetShell);
            corrections.appendChild(presetDialog);
            presetPicker = {
                dialog: presetDialog,
                close: presetClose,
                status: presetStatus,
                list: presetList,
                rows: [],
                open: false
            };
            presetClose.addEventListener("click", function () { closePresetPicker(true); });
            presetDialog.addEventListener("cancel", function (event) {
                if (event.preventDefault) event.preventDefault();
                closePresetPicker(true);
            });
            presetDialog.addEventListener("keydown", function (event) {
                if (event.key !== "Escape") return;
                if (event.preventDefault) event.preventDefault();
                closePresetPicker(true);
            });
            presetDialog.addEventListener("click", function (event) {
                if (event.target === presetDialog) closePresetPicker(true);
            });
            correctionControls = Object.create(null);
            correctionGroups = Object.create(null);
            function appendCorrectionGroup(groupName) {
                const group = documentRef.createElement("div");
                group.className = "masking-correction-group";
                group.dataset.maskingCorrectionGroup = groupName;
                const groupTitle = documentRef.createElement("div");
                groupTitle.className = "masking-correction-group-title";
                groupTitle.textContent = groupName;
                group.appendChild(groupTitle);
                maskingCorrections.definitions.filter(function (definition) {
                    return definition.group === groupName;
                }).forEach(function (definition) {
                    const control = createCorrectionControl(definition);
                    correctionControls[definition.parameter] = control;
                    if (definition.parameter === "local_Grain") {
                        const heading = documentRef.createElement("div");
                        heading.className = "masking-correction-group-title masking-grain-heading";
                        heading.textContent = "Grain";
                        group.appendChild(heading);
                        control.row.children[0].textContent = "Amount";
                        control.reset.setAttribute("aria-label", "Reset " + definition.label);
                    }
                    group.appendChild(control.row);
                    if (definition.parameter === "local_Hue") {
                        const note = documentRef.createElement("p");
                        note.className = "command-group-note";
                        note.innerHTML = "<strong>Use Fine Adjustment</strong> allows more precise Hue adjustments in Lightroom Classic. Enable or disable it directly in Lightroom; this option is not available in the Web Controller.";
                        group.appendChild(note);
                    }
                });
                if (groupName === "Amount") {
                    const note = documentRef.createElement("p");
                    note.className = "command-group-note";
                    note.innerHTML = "Change <strong>Reset Sliders Automatically</strong> directly in Lightroom Classic. This option is not available in the Web Controller.";
                    group.appendChild(note);
                }
                if (groupName === "Effects" && createSharedDevelopSliderControl) {
                    ["GrainSize", "GrainFrequency"].forEach(function (sliderId) {
                        const row = createSharedDevelopSliderControl(sliderId);
                        if (!row) return;
                        row.classList.add("masking-shared-grain-row");
                        row.dataset.maskingSharedGrain = sliderId;
                        const descriptiveLabel = row.children[0].textContent;
                        row.children[0].textContent = sliderId === "GrainSize" ? "Size" : "Roughness";
                        Array.from(row.children).forEach(function (element) {
                            if (element.classList.contains("reset")) element.setAttribute("aria-label", "Reset " + descriptiveLabel);
                        });
                        group.appendChild(row);
                        sharedGrainControlCount += 1;
                    });
                    if (sharedGrainControlCount > 0) {
                        const note = documentRef.createElement("div");
                        note.className = "masking-shared-grain-note";
                        note.textContent = "Size and Roughness are global settings shared across all Grain tools.";
                        group.appendChild(note);
                    }
                }
                correctionGroups[groupName] = group;
                corrections.appendChild(group);
            }
            ["Amount", "Tone", "Color"].forEach(appendCorrectionGroup);
            corrections.appendChild(createPointColorSection());
            const toneCurveGroup = documentRef.createElement("div");
            toneCurveGroup.className = "masking-correction-group masking-tone-curve";
            const toneCurveTitle = documentRef.createElement("div");
            toneCurveTitle.className = "masking-correction-group-title";
            toneCurveTitle.textContent = "Tone Curve";
            toneCurveStatus = documentRef.createElement("div");
            toneCurveStatus.className = "masking-corrections-status";
            toneCurveGroup.appendChild(toneCurveTitle);
            toneCurveGroup.appendChild(toneCurveStatus);
            if (toneCurveModule && typeof toneCurveModule.createController === "function" &&
                typeof toneCurveModule.createMaskingContextAdapter === "function" &&
                typeof documentRef.createElementNS === "function" && typeof documentRef.createTextNode === "function") {
                toneCurveController = toneCurveModule.createController({
                    document: documentRef,
                    fetch: fetchImpl,
                    contextAdapter: toneCurveModule.createMaskingContextAdapter("/api/masking/tone-curve"),
                    feedbackTimeoutMs: options.toneCurveFeedbackTimeoutMs,
                    statusElement: toneCurveStatus,
                    setStatus: function (message) { if (toneCurveStatus) toneCurveStatus.textContent = message || ""; },
                    onInteractionChange: function () { if (rootElement) render(); }
                });
                toneCurveGroup.appendChild(toneCurveController.element);
            } else {
                toneCurveStatus.textContent = "Mask-local Tone Curve is unavailable in this controller.";
            }
            corrections.appendChild(toneCurveGroup);
            ["Effects", "Detail"].forEach(appendCorrectionGroup);
            correctionStatus = correctionsAvailability;
            body.appendChild(panelRow);
            const panelHelp = documentRef.createElement("p");
            panelHelp.className = "command-group-note masking-panel-help";
            panelHelp.innerHTML = "If Masking opens in Lightroom Classic but the controls here remain unavailable, select a mask in Lightroom Classic. If that does not help, click <strong>Close Masking</strong> in this Web Controller. Then click the same button again when it shows <strong>Open Masking</strong>.";
            body.appendChild(panelHelp);
            body.appendChild(actionRow);
            body.appendChild(navigation);
            body.appendChild(position);
            body.appendChild(componentNavigation);
            body.appendChild(componentPosition);
            body.appendChild(componentActions);
            body.appendChild(componentControls);
            body.appendChild(status);
            body.appendChild(corrections);
            section.appendChild(title);
            section.appendChild(body);
            panel.addEventListener("click", function () {
                persistentError = "";
                const view = present(state, currentContext(), {});
                if (view.confirmed && !activeOperation && !navigationIntentActive &&
                    !toolNavigationIntentActive && !state.pendingOperation && !correctionBusy()) {
                    sendOperation("panel", view.confirmed.active !== true);
                }
            });
            previous.addEventListener("click", function () { requestNavigation(-1); });
            next.addEventListener("click", function () { requestNavigation(1); });
            componentPrevious.addEventListener("click", function () { requestToolNavigation(-1); });
            componentNext.addEventListener("click", function () { requestToolNavigation(1); });
            maskVisibility.addEventListener("click", function () { requestVisibility("maskVisibility"); });
            componentVisibility.addEventListener("click", function () { requestVisibility("toolVisibility"); });
            resetSelected.addEventListener("click", function () {
                if (state && state.hasSelectedMaskGroup === true && !correctionBusy()) sendOperation("resetSelected", true);
            });
            preset.addEventListener("click", openPresetPicker);
            deleteAll.addEventListener("click", function () {
                if (deleteAll.disabled || !state || state.maskGroupCount < 1 || correctionBusy()) return;
                const binding = navigationBindingKey(state);
                const count = state.maskGroupCount;
                if (confirmImpl("Delete all " + count + " mask" + (count === 1 ? "" : "s") + " from this photograph?") &&
                    binding === navigationBindingKey(state) && sameContext(state, currentContext())) {
                    sendOperation("deleteAll", true);
                }
            });
            deleteSelected.addEventListener("click", function () {
                if (deleteSelected.disabled || !state) return;
                sendOperation("deleteSelected", state.selectedMaskGroupId);
            });
            deleteComponent.addEventListener("click", function () {
                if (deleteComponent.disabled || !state) return;
                persistentError = "";
                deletionSelectionWarning = null;
                sendOperation("deleteComponent", { maskId: state.selectedMaskGroupId, toolId: state.selectedMaskToolId });
            });
            function requestComponentInversion() {
                if (invertComponent.disabled || !state) return;
                // Keep the native checkbox on its last authoritative value while the operation settles.
                invertCheckbox.checked = state.selectedMaskToolInverted === true;
                persistentError = "";
                sendOperation("invertComponent", { maskId: state.selectedMaskGroupId, toolId: state.selectedMaskToolId });
            }
            invertCheckbox.addEventListener("change", requestComponentInversion);
            invertComponent.addEventListener("click", requestComponentInversion);
            controls = { title: title, panel: panel, create: create, add: add, subtract: subtract, previous: previous, next: next, position: position,
                componentPrevious: componentPrevious, componentNext: componentNext,
                componentPosition: componentPosition, maskVisibility: maskVisibility,
                componentHeading, invertCheckboxLabel, invertCheckbox, invertComponent,
                maskVisibilityControl: maskVisibilityControl, componentVisibility: componentVisibility,
                componentVisibilityControl: componentVisibilityControl, status: status,
                resetSelected: resetSelected, preset: preset, presetFeedback: presetFeedbackStatus,
                deleteSelected: deleteSelected, deleteAll: deleteAll, deleteComponent: deleteComponent };
            return section;
        }

        function activate(host, decorate) {
            deactivate();
            rootElement = build();
            host.appendChild(rootElement);
            if (typeof decorate === "function") decorate(rootElement, controls.title);
            generation += 1;
            correctionGeneration += 1;
            abortController = typeof AbortController === "function" ? new AbortController() : null;
            context = currentContext();
            setDesiredToConfirmed(state);
            if (toneCurveController) toneCurveController.activate(toneCurveBinding(state));
            render();
            refresh();
            refreshPresets();
            interval = setIntervalImpl(refresh, POLL_MS);
            return rootElement;
        }

        function deactivate() {
            rejectedCorrectionBinding = null;
            if (creationMenuClose) { creationMenuClose(false); creationMenuClose.dispose(); }
            creationMenuClose = null;
            creationFeedback = "";
            componentFeedbackBinding = null;
            creationAwaitingInventory = null;
            generation += 1;
            correctionGeneration += 1;
            if (sharedPointColorController) sharedPointColorController.unmount();
            if (toneCurveController) toneCurveController.deactivate();
            if (interval !== null) clearIntervalImpl(interval);
            interval = null;
            if (abortController) abortController.abort();
            abortController = null;
            requestInFlight = false;
            activeOperation = null;
            deletionRemovalWarning = null;
            desiredMaskGroupIndex = null;
            navigationIntentActive = false;
            desiredBindingKey = null;
            desiredMaskToolIndex = null;
            toolNavigationIntentActive = false;
            desiredToolBindingKey = null;
            persistentError = "";
            Object.keys(correctionControls).forEach(function (parameter) {
                cancelCorrectionControl(correctionControls[parameter], false);
            });
            correctionControls = Object.create(null);
            correctionGroups = Object.create(null);
            correctionStatus = null;
            correctionRequestCount = 0;
            sharedGrainControlCount = 0;
            presets = [];
            queuedPreset = null;
            presetFeedback = null;
            presetRequestToken += 1;
            presetRequestInFlight = false;
            closePresetPicker(false);
            presetPicker = null;
            pointColorStatus = null;
            pointColorVisualizeStatus = null;
            sharedPointColorController = null;
            toneCurveController = null;
            toneCurveStatus = null;
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
                const presetContextChanged = !before || before.activeModule !== context.activeModule ||
                    before.selectedPhotoUuid !== context.selectedPhotoUuid || before.contextCounter !== context.contextCounter ||
                    before.contextChangedAt !== context.contextChangedAt;
                const compatibleGrain = !presetContextChanged && sameCorrectionContext(state, context);
                if (presetContextChanged) closePresetPicker(false);
                if (presetContextChanged) {
                    creationFeedback = "";
                    componentFeedbackBinding = null;
                    creationAwaitingInventory = null;
                    if (creationMenuClose) creationMenuClose(false);
                }
                if (presetContextChanged || presetFeedback && presetFeedback.kind === "pending") presetFeedback = null;
                queuedPreset = null;
                // A Develop revision invalidates commands, but the last confirmed display
                // can remain until the replacement snapshot arrives. Collapsing it here
                // clamps the document scroll position during shared Grain feedback.
                if (presetContextChanged) state = null;
                activeOperation = null;
                deletionRemovalWarning = null;
                desiredMaskGroupIndex = null;
                navigationIntentActive = false;
                desiredBindingKey = null;
                desiredMaskToolIndex = null;
                toolNavigationIntentActive = false;
                desiredToolBindingKey = null;
                persistentError = "";
                if (sharedPointColorController) {
                    sharedPointColorController.applyContext(null);
                    if (state && state.pointColor) sharedPointColorController.applyAuthoritative(state.pointColor, null);
                }
                if (toneCurveController) toneCurveController.applyContext(null, !presetContextChanged);
                if (!compatibleGrain) Object.keys(correctionControls).forEach(function (parameter) {
                    if (!presetContextChanged) retainInterruptedCorrection(correctionControls[parameter]);
                    else correctionControls[parameter].interrupted = null;
                    cancelCorrectionControl(correctionControls[parameter], false);
                    correctionControls[parameter].bindingKey = null;
                });
                generation += 1;
                if (!compatibleGrain) correctionGeneration += 1;
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
            getInteractionState: function () {
                return {
                    activeOperation: activeOperation && Object.assign({}, activeOperation),
                    correctionBusy: correctionBusy(),
                    correctionRequestCount: correctionRequestCount,
                    pointColor: sharedPointColorController && sharedPointColorController.getState(),
                    toneCurve: toneCurveController && toneCurveController.getState(),
                    presetRequestInFlight: presetRequestInFlight,
                    presetDisabled: Boolean(controls && controls.preset && controls.preset.disabled)
                };
            },
            isActive: function () { return rootElement !== null; }
        };
    }

    return {
        createController: createController,
        pointColorBindingQuery: pointColorBindingQuery,
        acceptState: acceptState,
        sameContext: sameContext,
        present: present,
        unavailableMessage: unavailableMessage,
        confirmedMaskIndex: confirmedMaskIndex,
        confirmedMaskToolIndex: confirmedMaskToolIndex,
        clampMaskIndex: clampMaskIndex
    };
});
