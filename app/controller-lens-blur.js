(function (root, factory) {
    "use strict";
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.LRBridgeLensBlur = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const bokehOptions = Object.freeze([
        Object.freeze({ value: "Circle", label: "Circle" }),
        Object.freeze({ value: "SoapBubble", label: "Bubble" }),
        Object.freeze({ value: "Blade", label: "5-Blade" }),
        Object.freeze({ value: "Ring", label: "Ring" }),
        Object.freeze({ value: "Anamorphic", label: "Anamorphic" })
    ]);
    const bokehValues = new Set(bokehOptions.map(function (option) { return option.value; }));
    const focalComponents = Object.freeze(["nearOuter", "nearInner", "farInner", "farOuter"]);
    const focalLimit = 1000000;
    const focalDepthMinimum = 0;
    const focalDepthMaximum = 100;

    function numericValuesEqual(left, right, precision) {
        if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
        return Math.abs(left - right) <= Math.max(1e-9, Math.pow(10, -precision) / 4);
    }

    function createStepInteraction(options) {
        options = options || {};
        const step = options.step;
        const precision = options.precision;
        if (!Number.isFinite(step) || step <= 0 || !Number.isSafeInteger(precision) || precision < 0 || precision > 10) {
            throw new TypeError("Invalid step interaction options");
        }
        let active = false;
        let pendingTarget = null;
        let authoritative = null;
        let queuedTarget = null;
        let inFlight = null;
        let idleElapsed = false;
        let finalTarget = null;
        let requestId = 0;

        function equal(left, right) {
            return Number.isFinite(left) && Number.isFinite(right) &&
                Math.abs(left - right) <= Math.max(1e-9, Math.pow(10, -precision) / 4);
        }

        function normalize(value, minimum, maximum) {
            if (typeof value !== "number" || !Number.isFinite(value) || typeof minimum !== "number" ||
                !Number.isFinite(minimum) || typeof maximum !== "number" || !Number.isFinite(maximum) || minimum > maximum) return null;
            return Number(Math.min(maximum, Math.max(minimum, value)).toFixed(precision));
        }

        function clearInteraction() {
            active = false;
            pendingTarget = null;
            queuedTarget = null;
            inFlight = null;
            idleElapsed = false;
            finalTarget = null;
        }

        function maybeFinish() {
            if (active && idleElapsed && inFlight === null && queuedTarget === null &&
                equal(finalTarget, pendingTarget) && equal(authoritative, pendingTarget)) clearInteraction();
        }

        function snapshot() {
            return {
                active: active,
                pendingTarget: pendingTarget,
                authoritative: authoritative,
                queuedTarget: queuedTarget,
                inFlight: inFlight === null ? null : Object.assign({}, inFlight),
                idleElapsed: idleElapsed,
                finalTarget: finalTarget
            };
        }

        return Object.freeze({
            get: snapshot,
            applyAuthoritative: function (value) {
                if (typeof value === "number" && Number.isFinite(value)) authoritative = value;
                maybeFinish();
                return snapshot();
            },
            click: function (direction, displayedValue, minimum, maximum) {
                if (direction !== -1 && direction !== 1) return { accepted: false, state: snapshot() };
                const base = active
                    ? pendingTarget
                    : (typeof displayedValue === "number" && Number.isFinite(displayedValue) ? displayedValue : authoritative);
                if (typeof base !== "number" || !Number.isFinite(base)) return { accepted: false, state: snapshot() };
                const target = normalize(base + direction * step, minimum, maximum);
                if (target === null || equal(target, base)) return { accepted: false, state: snapshot() };
                if (!active) active = true;
                pendingTarget = target;
                queuedTarget = target;
                idleElapsed = false;
                finalTarget = null;
                return { accepted: true, target: target, state: snapshot() };
            },
            markIdle: function () {
                if (active) {
                    idleElapsed = true;
                    queuedTarget = pendingTarget;
                }
                return snapshot();
            },
            takeNextRequest: function () {
                if (!active || inFlight !== null || typeof queuedTarget !== "number" || !Number.isFinite(queuedTarget)) return null;
                const target = queuedTarget;
                queuedTarget = null;
                const request = { id: ++requestId, target: target, final: idleElapsed && equal(target, pendingTarget) };
                inFlight = request;
                return Object.assign({}, request);
            },
            completeRequest: function (request, accepted, authoritativeValue) {
                if (!request || inFlight === null || request.id !== inFlight.id) {
                    throw new Error("Step interaction response does not match the in-flight request");
                }
                if (typeof authoritativeValue === "number" && Number.isFinite(authoritativeValue)) authoritative = authoritativeValue;
                inFlight = null;
                if (accepted !== true) {
                    clearInteraction();
                    return { accepted: false, rollback: authoritative, state: snapshot() };
                }
                if (request.final) finalTarget = request.target;
                if (queuedTarget !== null && equal(queuedTarget, request.target) &&
                    (!idleElapsed || request.final)) queuedTarget = null;
                if (active && idleElapsed && !equal(finalTarget, pendingTarget)) queuedTarget = pendingTarget;
                maybeFinish();
                return { accepted: true, rollback: null, state: snapshot() };
            },
            cancel: function () {
                clearInteraction();
                return snapshot();
            }
        });
    }

    function createNumericEditor(options) {
        options = options || {};
        const integer = options.integer === true;
        const precision = integer ? 0 : (Number.isSafeInteger(options.precision) && options.precision >= 0 ? options.precision : 0);
        let minimum = Number.isFinite(options.min) ? options.min : -Infinity;
        let maximum = Number.isFinite(options.max) ? options.max : Infinity;
        let available = false;
        let authoritative = null;
        let text = "";
        let editing = false;
        let dirty = false;
        let pending = false;
        let submitting = false;
        let requested = null;
        let error = null;

        function format(value) {
            return integer ? String(value) : Number(value).toFixed(precision);
        }

        function parse(value) {
            if (typeof value !== "string") return null;
            const trimmed = value.trim();
            const pattern = integer ? /^[+-]?\d+$/ : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
            if (!pattern.test(trimmed)) return null;
            const parsed = Number(trimmed);
            if (!Number.isFinite(parsed) || (integer && !Number.isSafeInteger(parsed)) || parsed < minimum || parsed > maximum) return null;
            return parsed;
        }

        function snapshot() {
            return {
                available: available,
                authoritative: authoritative,
                text: text,
                editing: editing,
                dirty: dirty,
                pending: pending,
                submitting: submitting,
                requested: requested,
                error: error,
                min: minimum,
                max: maximum
            };
        }

        function confirm(value) {
            pending = false;
            submitting = false;
            dirty = false;
            requested = null;
            error = null;
            if (!editing) text = format(value);
        }

        function restore(message) {
            editing = false;
            dirty = false;
            pending = false;
            submitting = false;
            requested = null;
            error = message || null;
            text = available && authoritative !== null ? format(authoritative) : "";
            return snapshot();
        }

        return Object.freeze({
            get: snapshot,
            parse: parse,
            applyAuthoritative: function (value, isAvailable, liveMinimum, liveMaximum) {
                if (Number.isFinite(liveMinimum)) minimum = liveMinimum;
                if (Number.isFinite(liveMaximum)) maximum = liveMaximum;
                available = isAvailable === true && Number.isFinite(value) && value >= minimum && value <= maximum &&
                    (!integer || Number.isSafeInteger(value));
                if (!available) return snapshot();
                authoritative = value;
                if (pending && numericValuesEqual(value, requested, precision)) {
                    confirm(value);
                } else if (pending && !submitting) {
                    restore("Lightroom returned a different value");
                } else if (!editing && !pending) {
                    text = format(value);
                }
                return snapshot();
            },
            begin: function (currentText) {
                if (!available || pending) return snapshot();
                editing = true;
                dirty = false;
                error = null;
                if (typeof currentText === "string") text = currentText;
                return snapshot();
            },
            change: function (nextText) {
                if (!editing) return snapshot();
                text = String(nextText);
                dirty = true;
                return snapshot();
            },
            prepareCommit: function (currentText) {
                if (!editing) return { ok: false, submit: false, state: snapshot(), error: "Editor is not active" };
                text = String(currentText);
                const value = parse(text);
                if (value === null) return { ok: false, submit: false, state: snapshot(), error: "Invalid numeric value" };
                editing = false;
                if (authoritative !== null && numericValuesEqual(value, authoritative, precision)) {
                    confirm(authoritative);
                    return { ok: true, submit: false, value: value, state: snapshot() };
                }
                dirty = true;
                pending = true;
                submitting = true;
                requested = value;
                error = null;
                return { ok: true, submit: true, value: value, state: snapshot() };
            },
            acceptSubmission: function () {
                if (!pending) return snapshot();
                submitting = false;
                if (available && numericValuesEqual(authoritative, requested, precision)) confirm(authoritative);
                return snapshot();
            },
            rejectSubmission: function (message) { return restore(message || "Lightroom rejected the value"); },
            cancel: function () { return restore(null); }
        });
    }

    function focalRangeDeltaBounds(input, part) {
        const range = normalizeFocalRange(input);
        if (range === null || !["whole", "near", "far"].includes(part)) return null;
        if (part === "whole") return {
            min: focalDepthMinimum - range.nearInner,
            max: focalDepthMaximum - range.farInner
        };
        if (part === "near") return {
            min: focalDepthMinimum - range.nearInner,
            max: range.farInner - range.nearInner
        };
        return {
            min: range.nearInner - range.farInner,
            max: focalDepthMaximum - range.farInner
        };
    }

    function translateFocalRange(input, part, delta) {
        const range = normalizeFocalRange(input);
        const bounds = focalRangeDeltaBounds(range, part);
        if (range === null || bounds === null || !Number.isSafeInteger(delta) || delta < bounds.min || delta > bounds.max) return null;
        const translated = Object.assign({}, range);
        if (part === "whole" || part === "near") {
            translated.nearOuter += delta;
            translated.nearInner += delta;
        }
        if (part === "whole" || part === "far") {
            translated.farInner += delta;
            translated.farOuter += delta;
        }
        return normalizeFocalRange(translated);
    }

    function focalRangesEqual(left, right) {
        const normalizedLeft = normalizeFocalRange(left);
        const normalizedRight = normalizeFocalRange(right);
        return normalizedLeft !== null && normalizedRight !== null && focalComponents.every(function (component) {
            return normalizedLeft[component] === normalizedRight[component];
        });
    }

    // See docs/LENS_BLUR_FOCUS_RANGE_STATE_AND_LIMITATIONS.md for the reconciliation invariants.
    function createSubjectFocusPresentation() {
        let mode = "unknown";
        let subjectSignature = null;
        let manualEditRollback = null;
        let manualEditPending = false;
        let sourceAvailable = false;
        let rawSource = null;
        let lastRevision = null;
        let lastCommitId = null;
        let lastFreshRawSource = null;
        let externalTransitionArmed = false;
        let externalCandidateRange = null;
        let externalCandidateCount = 0;
        let externalCandidateRevision = null;

        function copyRange(range) { return range === null ? null : Object.assign({}, range); }
        function clearExternalCandidate() {
            externalTransitionArmed = false;
            externalCandidateRange = null;
            externalCandidateCount = 0;
            externalCandidateRevision = null;
        }
        function countExternalCandidate(range, revision) {
            if (!Number.isSafeInteger(revision) || (Number.isSafeInteger(externalCandidateRevision) &&
                revision <= externalCandidateRevision)) return false;
            if (focalRangesEqual(range, externalCandidateRange)) {
                externalCandidateCount += 1;
            } else {
                externalCandidateRange = copyRange(range);
                externalCandidateCount = 1;
            }
            externalCandidateRevision = revision;
            if (externalCandidateCount < 3) return false;
            mode = "subject";
            subjectSignature = copyRange(range);
            clearExternalCandidate();
            return true;
        }
        function snapshot() {
            return {
                available: sourceAvailable,
                active: sourceAvailable && mode === "subject" && rawSource === 1,
                mode: mode,
                rawSource: rawSource,
                subjectSignature: copyRange(subjectSignature),
                manualEditPending: manualEditPending,
                lastRevision: lastRevision,
                lastCommitId: lastCommitId,
                externalCandidateRange: copyRange(externalCandidateRange),
                externalCandidateCount: externalCandidateCount,
                externalCandidateRevision: externalCandidateRevision
            };
        }

        function rememberMetadata(metadata) {
            metadata = metadata || {};
            const revision = Number.isSafeInteger(metadata.revision) ? metadata.revision : null;
            const fresh = revision === null || lastRevision === null || revision > lastRevision;
            if (revision !== null && (lastRevision === null || revision > lastRevision)) lastRevision = revision;
            if (typeof metadata.focalRangeCommitId === "string") lastCommitId = metadata.focalRangeCommitId;
            else if (metadata.focalRangeCommitId === null) lastCommitId = null;
            return fresh;
        }

        function reset() {
            mode = "unknown";
            subjectSignature = null;
            manualEditRollback = null;
            manualEditPending = false;
            sourceAvailable = false;
            rawSource = null;
            lastRevision = null;
            lastCommitId = null;
            lastFreshRawSource = null;
            clearExternalCandidate();
            return snapshot();
        }

        return Object.freeze({
            get: snapshot,
            reset: reset,
            applyAuthoritative: function (input, metadata) {
                const normalized = normalizeState(input);
                const range = normalized.focalRangeAvailable ? normalized.focalRange : null;
                const fresh = rememberMetadata(metadata);
                const previousFreshRawSource = lastFreshRawSource;
                sourceAvailable = normalized.focalRangeSourceAvailable;
                rawSource = sourceAvailable ? normalized.focalRangeSource : null;
                if (fresh && sourceAvailable) lastFreshRawSource = rawSource;

                const subjectActionPending = !!(metadata && metadata.subjectActionPending === true);
                const manualTransactionBlocked = manualEditPending ||
                    !!(metadata && metadata.manualTransactionBlocked === true);
                const sourceTransitionedToSubject = fresh && previousFreshRawSource === 2 && rawSource === 1;
                if (sourceTransitionedToSubject && mode === "manual" && !subjectActionPending && !manualTransactionBlocked) {
                    externalTransitionArmed = true;
                }

                if (sourceAvailable && rawSource !== 1) {
                    mode = "manual";
                    clearExternalCandidate();
                } else if (sourceAvailable && rawSource === 1 && range !== null) {
                    if (mode === "unknown" && !subjectActionPending) {
                        mode = "manual";
                    } else if (mode === "subject" && subjectSignature === null) {
                        subjectSignature = copyRange(range);
                    } else if (mode === "subject" && fresh && !subjectActionPending && !manualEditPending &&
                        !focalRangesEqual(range, subjectSignature)) {
                        mode = "manual";
                    }

                    if (mode === "manual" && fresh) {
                        if (subjectActionPending || manualTransactionBlocked) {
                            clearExternalCandidate();
                        } else {
                            const matchesSignature = subjectSignature !== null && focalRangesEqual(range, subjectSignature);
                            if (externalTransitionArmed || matchesSignature) {
                                countExternalCandidate(range, metadata.revision);
                            } else {
                                clearExternalCandidate();
                            }
                        }
                    } else if (mode === "subject") {
                        clearExternalCandidate();
                    }
                }
                return snapshot();
            },
            beginManualEdit: function () {
                if (!manualEditPending) {
                    manualEditRollback = {
                        mode: mode,
                        subjectSignature: copyRange(subjectSignature)
                    };
                }
                manualEditPending = true;
                mode = "manual";
                clearExternalCandidate();
                return snapshot();
            },
            confirmManualEdit: function () {
                manualEditPending = false;
                manualEditRollback = null;
                mode = "manual";
                clearExternalCandidate();
                return snapshot();
            },
            rollbackManualEdit: function () {
                if (manualEditPending && manualEditRollback) {
                    mode = manualEditRollback.mode;
                    subjectSignature = copyRange(manualEditRollback.subjectSignature);
                }
                manualEditPending = false;
                manualEditRollback = null;
                clearExternalCandidate();
                return snapshot();
            },
            canConfirmSubjectAction: function (input, actionContext, metadata) {
                const normalized = normalizeState(input);
                const range = normalized.focalRangeAvailable ? normalized.focalRange : null;
                if (!actionContext || normalized.focalRangeSourceAvailable !== true ||
                    normalized.focalRangeSource !== 1 || range === null) return false;
                const revision = metadata && Number.isSafeInteger(metadata.revision) ? metadata.revision : null;
                if (revision === null || (Number.isSafeInteger(actionContext.subjectCandidateRevision) &&
                    revision <= actionContext.subjectCandidateRevision)) return false;
                if (focalRangesEqual(range, actionContext.subjectCandidateRange)) {
                    actionContext.subjectCandidateCount += 1;
                } else {
                    actionContext.subjectCandidateRange = copyRange(range);
                    actionContext.subjectCandidateCount = 1;
                }
                actionContext.subjectCandidateRevision = revision;
                return actionContext.subjectCandidateCount >= 3;
            },
            confirmSubjectAction: function (input, metadata) {
                const normalized = normalizeState(input);
                const range = normalized.focalRangeAvailable ? normalized.focalRange : null;
                if (normalized.focalRangeSourceAvailable !== true || normalized.focalRangeSource !== 1 || range === null) {
                    return false;
                }
                rememberMetadata(metadata);
                sourceAvailable = true;
                rawSource = 1;
                mode = "subject";
                subjectSignature = copyRange(range);
                manualEditPending = false;
                manualEditRollback = null;
                clearExternalCandidate();
                return true;
            }
        });
    }

    function createFocalRangeTransaction() {
        let authoritative = null;
        let draft = null;
        let pending = null;
        let dragBase = null;
        let dragPart = null;
        let error = null;

        function copy(range) { return range === null ? null : Object.assign({}, range); }
        function snapshot() {
            return {
                authoritative: copy(authoritative),
                draft: copy(draft),
                pending: copy(pending),
                displayed: copy(draft || pending || authoritative),
                dragging: draft !== null,
                error: error
            };
        }

        return Object.freeze({
            get: snapshot,
            applyAuthoritative: function (input) {
                const normalized = normalizeFocalRange(input);
                if (normalized !== null) authoritative = normalized;
                return snapshot();
            },
            clearAuthoritative: function () {
                if (draft === null && pending === null) authoritative = null;
                return snapshot();
            },
            begin: function (part, input) {
                const normalized = normalizeFocalRange(input || authoritative);
                if (pending !== null || normalized === null || !["whole", "near", "far"].includes(part)) return false;
                dragBase = normalized;
                draft = copy(normalized);
                dragPart = part;
                error = null;
                return true;
            },
            move: function (delta) {
                if (draft === null || dragBase === null) return snapshot();
                const translated = translateFocalRange(dragBase, dragPart, delta);
                if (translated !== null) draft = translated;
                return snapshot();
            },
            cancel: function () {
                draft = null;
                dragBase = null;
                dragPart = null;
                return snapshot();
            },
            finish: function () {
                if (draft === null || dragBase === null) return { submit: false, state: snapshot() };
                const requested = copy(draft);
                const expected = copy(dragBase);
                draft = null;
                dragBase = null;
                dragPart = null;
                if (focalRangesEqual(requested, expected)) return { submit: false, state: snapshot() };
                pending = requested;
                error = null;
                return { submit: true, range: copy(requested), expected: expected, state: snapshot() };
            },
            confirm: function (input) {
                const normalized = normalizeFocalRange(input);
                if (pending === null || normalized === null || !focalRangesEqual(pending, normalized)) return false;
                authoritative = normalized;
                pending = null;
                error = null;
                return true;
            },
            reject: function (message, input) {
                const normalized = normalizeFocalRange(input);
                if (normalized !== null) authoritative = normalized;
                draft = null;
                pending = null;
                dragBase = null;
                dragPart = null;
                error = message || "Lightroom rejected the Focus Range";
                return snapshot();
            }
        });
    }

    function unavailableNativeControl() {
        return { available: false, value: null, min: null, max: null };
    }

    function unavailableNativeCheckbox() {
        return { available: false, value: null };
    }

    function unavailableNativeAction() {
        return { available: false, enabled: false };
    }

    function unavailableWindowsNative() {
        return {
            available: false,
            reason: "unavailable",
            brush: {
                amount: unavailableNativeControl(),
                size: unavailableNativeControl(),
                feather: unavailableNativeControl(),
                flow: unavailableNativeControl()
            },
            visualizeDepth: unavailableNativeCheckbox(),
            autoMask: unavailableNativeCheckbox(),
            refinementMode: "unknown",
            refinementModeTargetsAvailable: false,
            refinementDisclosure: unavailableNativeCheckbox(),
            refinementReset: unavailableNativeAction(),
            focusActions: {
                subject: unavailableNativeAction(),
                pointArea: unavailableNativeAction()
            }
        };
    }

    function unavailableState() {
        return {
            activeAvailable: false,
            active: null,
            bokehAvailable: false,
            bokeh: null,
            selectedToolAvailable: false,
            selectedTool: null,
            focalRangeSourceAvailable: false,
            focalRangeSource: null,
            focalRangeAvailable: false,
            focalRange: null,
            windowsNative: unavailableWindowsNative()
        };
    }

    function normalizeFocalRange(input) {
        if (!input || typeof input !== "object" || Array.isArray(input)) return null;
        const range = {};
        for (const component of focalComponents) {
            if (!Number.isSafeInteger(input[component]) || Math.abs(input[component]) > focalLimit) return null;
            range[component] = input[component];
        }
        return range.nearOuter <= range.nearInner && range.nearInner <= range.farInner && range.farInner <= range.farOuter
            ? range
            : null;
    }

    function formatFocalRange(input) {
        const range = normalizeFocalRange(input);
        return range === null ? null : focalComponents.map(function (component) { return range[component]; }).join(" ");
    }

    function normalizeNativeControl(input) {
        if (!input || input.available !== true || !Number.isFinite(input.value) || !Number.isFinite(input.min) ||
            !Number.isFinite(input.max) || input.min > input.max || input.value < input.min || input.value > input.max) {
            return unavailableNativeControl();
        }
        return { available: true, value: input.value, min: input.min, max: input.max };
    }

    function normalizeNativeCheckbox(input) {
        return input && input.available === true && typeof input.value === "boolean"
            ? { available: true, value: input.value }
            : unavailableNativeCheckbox();
    }

    function normalizeNativeAction(input) {
        return input && input.available === true && typeof input.enabled === "boolean"
            ? { available: true, enabled: input.enabled }
            : unavailableNativeAction();
    }

    function normalizeWindowsNative(input) {
        const nativeState = unavailableWindowsNative();
        if (!input || typeof input !== "object" || input.available !== true || !input.brush) {
            if (input && typeof input.reason === "string") nativeState.reason = input.reason;
            return nativeState;
        }
        nativeState.available = true;
        nativeState.reason = null;
        Object.keys(nativeState.brush).forEach(function (control) {
            nativeState.brush[control] = normalizeNativeControl(input.brush[control]);
        });
        nativeState.visualizeDepth = normalizeNativeCheckbox(input.visualizeDepth);
        nativeState.autoMask = normalizeNativeCheckbox(input.autoMask);
        nativeState.refinementMode = input.refinementMode === "focus" || input.refinementMode === "blur"
            ? input.refinementMode
            : "unknown";
        nativeState.refinementModeTargetsAvailable = input.refinementModeTargetsAvailable === true;
        nativeState.refinementDisclosure = normalizeNativeCheckbox(input.refinementDisclosure);
        nativeState.refinementReset = normalizeNativeAction(input.refinementReset);
        const focusActions = input.focusActions && typeof input.focusActions === "object" ? input.focusActions : {};
        nativeState.focusActions.subject = normalizeNativeAction(focusActions.subject);
        nativeState.focusActions.pointArea = normalizeNativeAction(focusActions.pointArea);
        return nativeState;
    }

    function cloneState(state) {
        const clone = Object.assign({}, state);
        clone.focalRange = state.focalRange === null ? null : Object.assign({}, state.focalRange);
        clone.windowsNative = normalizeWindowsNative(state.windowsNative);
        return clone;
    }

    function normalizeState(input) {
        const state = unavailableState();
        if (!input || typeof input !== "object" || Array.isArray(input)) return state;
        if (input.activeAvailable === true && typeof input.active === "boolean") {
            state.activeAvailable = true;
            state.active = input.active;
        }
        if (input.bokehAvailable === true && bokehValues.has(input.bokeh)) {
            state.bokehAvailable = true;
            state.bokeh = input.bokeh;
        }
        if (input.selectedToolAvailable === true && typeof input.selectedTool === "string" && input.selectedTool.length > 0) {
            state.selectedToolAvailable = true;
            state.selectedTool = input.selectedTool;
        }
        if (input.focalRangeSourceAvailable === true && Number.isSafeInteger(input.focalRangeSource) &&
            input.focalRangeSource >= 1 && input.focalRangeSource <= 3) {
            state.focalRangeSourceAvailable = true;
            state.focalRangeSource = input.focalRangeSource;
        }
        const focalRange = normalizeFocalRange(input.focalRange);
        if (input.focalRangeAvailable === true && focalRange !== null) {
            state.focalRangeAvailable = true;
            state.focalRange = focalRange;
        }
        state.windowsNative = normalizeWindowsNative(input.windowsNative);
        return state;
    }

    function createModel() {
        let state = unavailableState();
        return {
            get: function () { return cloneState(state); },
            applyAuthoritative: function (input) {
                state = normalizeState(input);
                return this.get();
            },
            applyWindowsNative: function (input) {
                state.windowsNative = normalizeWindowsNative(input);
                return this.get();
            }
        };
    }

    function presentationFor(state) {
        const normalized = normalizeState(state);
        return {
            applyAvailable: normalized.activeAvailable,
            applyOffSelected: normalized.activeAvailable && normalized.active === false,
            applyOnSelected: normalized.activeAvailable && normalized.active === true,
            bokehAvailable: normalized.bokehAvailable,
            selectedBokeh: normalized.bokehAvailable ? normalized.bokeh : null,
            refinementActive: normalized.selectedToolAvailable && normalized.selectedTool === "depth_refinement",
            selectedToolAvailable: normalized.selectedToolAvailable,
            selectedTool: normalized.selectedTool,
            focalRangeSourceAvailable: normalized.focalRangeSourceAvailable,
            focalRangeSource: normalized.focalRangeSource,
            focalRangeAvailable: normalized.focalRangeAvailable,
            focalRange: normalized.focalRange,
            windowsNativeAvailable: normalized.windowsNative.available,
            brush: normalized.windowsNative.brush,
            visualizeDepth: normalized.windowsNative.visualizeDepth,
            autoMask: normalized.windowsNative.autoMask,
            refinementMode: normalized.windowsNative.refinementMode,
            refinementModeTargetsAvailable: normalized.windowsNative.refinementModeTargetsAvailable,
            refinementDisclosure: normalized.windowsNative.refinementDisclosure,
            refinementReset: normalized.windowsNative.refinementReset,
            focusActions: normalized.windowsNative.focusActions
        };
    }

    function focusActionActiveStates(state, subjectPresentation) {
        const pointActive = !!(state && state.selectedToolAvailable === true && state.selectedTool === "focal_range");
        const subjectActive = !!(subjectPresentation && subjectPresentation.available === true &&
            subjectPresentation.active === true);
        return { subject: subjectActive, pointArea: pointActive };
    }

    function focusSourceText(subjectPresentation) {
        if (!subjectPresentation || subjectPresentation.available !== true) return "Focus source: Unavailable";
        return subjectPresentation.active === true ? "Focus source: Subject" : "Focus source: Manual";
    }

    function pointAreaToggleIntent(state) {
        if (!state || state.selectedToolAvailable !== true || typeof state.selectedTool !== "string") return null;
        return state.selectedTool !== "focal_range";
    }

    function pointAreaToggleConfirmed(state, expectedActive) {
        if (typeof expectedActive !== "boolean" || !state || state.selectedToolAvailable !== true ||
            typeof state.selectedTool !== "string") return false;
        const actualActive = state.selectedTool === "focal_range";
        return actualActive === expectedActive;
    }

    return Object.freeze({
        bokehOptions: bokehOptions,
        focalComponents: focalComponents,
        focalLimit: focalLimit,
        focalDepthMinimum: focalDepthMinimum,
        focalDepthMaximum: focalDepthMaximum,
        normalizeFocalRange: normalizeFocalRange,
        formatFocalRange: formatFocalRange,
        focalRangesEqual: focalRangesEqual,
        focalRangeDeltaBounds: focalRangeDeltaBounds,
        translateFocalRange: translateFocalRange,
        createSubjectFocusPresentation: createSubjectFocusPresentation,
        createFocalRangeTransaction: createFocalRangeTransaction,
        createStepInteraction: createStepInteraction,
        createNumericEditor: createNumericEditor,
        normalizeWindowsNative: normalizeWindowsNative,
        normalizeState: normalizeState,
        createModel: createModel,
        presentationFor: presentationFor,
        focusActionActiveStates: focusActionActiveStates,
        focusSourceText: focusSourceText,
        pointAreaToggleIntent: pointAreaToggleIntent,
        pointAreaToggleConfirmed: pointAreaToggleConfirmed
    });
});
