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
        if (part === "whole") return { min: -focalLimit - range.nearOuter, max: focalLimit - range.farOuter };
        if (part === "near") return { min: -focalLimit - range.nearOuter, max: range.farInner - range.nearInner };
        return { min: range.nearInner - range.farInner, max: focalLimit - range.farOuter };
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
            refinementReset: unavailableNativeAction()
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
            focalRangeAvailable: normalized.focalRangeAvailable,
            focalRange: normalized.focalRange,
            windowsNativeAvailable: normalized.windowsNative.available,
            brush: normalized.windowsNative.brush,
            visualizeDepth: normalized.windowsNative.visualizeDepth,
            autoMask: normalized.windowsNative.autoMask,
            refinementMode: normalized.windowsNative.refinementMode,
            refinementModeTargetsAvailable: normalized.windowsNative.refinementModeTargetsAvailable,
            refinementDisclosure: normalized.windowsNative.refinementDisclosure,
            refinementReset: normalized.windowsNative.refinementReset
        };
    }

    return Object.freeze({
        bokehOptions: bokehOptions,
        focalComponents: focalComponents,
        focalLimit: focalLimit,
        normalizeFocalRange: normalizeFocalRange,
        formatFocalRange: formatFocalRange,
        focalRangeDeltaBounds: focalRangeDeltaBounds,
        translateFocalRange: translateFocalRange,
        createStepInteraction: createStepInteraction,
        createNumericEditor: createNumericEditor,
        normalizeWindowsNative: normalizeWindowsNative,
        normalizeState: normalizeState,
        createModel: createModel,
        presentationFor: presentationFor
    });
});
