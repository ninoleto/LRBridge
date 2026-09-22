(function (root, factory) {
    "use strict";
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.LRBridgePointColor = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const DEFINITIONS = Object.freeze([
        Object.freeze({ field: "HueShift", label: "Hue Shift", min: -100, max: 100, reset: 0 }),
        Object.freeze({ field: "SatScale", label: "Saturation Shift", min: -100, max: 100, reset: 0 }),
        Object.freeze({ field: "LumScale", label: "Luminance Shift", min: -100, max: 100, reset: 0 }),
        Object.freeze({ field: "Variance", label: "Variance", min: -100, max: 100, reset: 0 }),
        Object.freeze({ field: "RangeAmount", label: "Range", min: 0, max: 100, reset: 50 })
    ]);
    const RANGE_DEFINITIONS = Object.freeze([
        Object.freeze({ name: "HueRange", label: "Hue Range" }),
        Object.freeze({ name: "SatRange", label: "Saturation Range" }),
        Object.freeze({ name: "LumRange", label: "Luminance Range" })
    ]);
    const RANGE_BOUNDARIES = Object.freeze(["LowerNone", "LowerFull", "UpperFull", "UpperNone"]);
    const MARKER_FIELDS = Object.freeze({
        HueRange: "HueRangeMarker", SatRange: "SatRangeMarker", LumRange: "LumRangeMarker"
    });
    const MARKER_EPSILON = 1e-8;
    const MINIMUM_FULL_RANGE_UI = 1;

    function sdkToUi(value) { return Math.round(Number(value) * 100); }
    function uiToSdk(value) { return Number(value) / 100; }

    function markerIntegerLimits(markerSdkExact) {
        if (typeof markerSdkExact !== "number" || !Number.isFinite(markerSdkExact)) {
            return { markerUiExact: null, lowerFullMaxUi: null, upperFullMinUi: null };
        }
        const markerUiExact = markerSdkExact * 100;
        return {
            markerUiExact: markerUiExact,
            lowerFullMaxUi: Math.floor(markerUiExact + MARKER_EPSILON),
            upperFullMinUi: Math.ceil(markerUiExact - MARKER_EPSILON)
        };
    }

    function getRangeMarker(rangeName, swatch) {
        const value = swatch && swatch[MARKER_FIELDS[rangeName]];
        return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
    }

    function validRange(value) {
        return value && typeof value === "object" && !Array.isArray(value) &&
            RANGE_BOUNDARIES.every(function (boundary) {
                return typeof value[boundary] === "number" && Number.isFinite(value[boundary]) &&
                    value[boundary] >= 0 && value[boundary] <= 1;
            }) && Object.keys(value).length === RANGE_BOUNDARIES.length &&
            value.LowerNone <= value.LowerFull && value.LowerFull <= value.UpperFull &&
            value.UpperFull <= value.UpperNone;
    }

    function validState(value) {
        if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.available !== "boolean" ||
            !Number.isSafeInteger(value.swatchCount) || value.swatchCount < 0 || value.swatchCount > 8 ||
            !Number.isSafeInteger(value.selectedIndex) || value.selectedIndex < 0 || value.selectedIndex > 8 ||
            typeof value.selectionTransient !== "boolean") return false;
        if (!value.available) return value.swatchCount === 0 && value.selectedIndex === 0 && !value.selectionTransient;
        if (value.swatchCount === 0) return value.selectedIndex === 0 && !value.selectionTransient;
        if (value.selectedIndex === 0) return value.selectionTransient === true;
        if (value.selectionTransient || value.selectedIndex > value.swatchCount) return false;
        return DEFINITIONS.every(function (definition) {
            const scalar = value[definition.field];
            return typeof scalar === "number" && Number.isFinite(scalar) &&
                scalar >= definition.min / 100 && scalar <= definition.max / 100;
        }) && RANGE_DEFINITIONS.every(function (definition) { return validRange(value[definition.name]); });
    }

    function unavailableState() {
        return { available: false, swatchCount: 0, selectedIndex: 0, selectionTransient: false };
    }

    function defaultButton(documentObject, label, className, action) {
        const button = documentObject.createElement("button");
        button.type = "button";
        button.textContent = label;
        if (className) button.className = className;
        if (typeof action === "function") button.addEventListener("click", action);
        return button;
    }

    function createController(options) {
        options = options || {};
        const documentObject = options.document || (typeof document !== "undefined" ? document : null);
        const fetchImpl = options.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
        if (!documentObject) throw new TypeError("Point Color controller requires a document");
        const routePrefix = typeof options.routePrefix === "string" ? options.routePrefix : "/api/point-color";
        const makeButton = typeof options.makeButton === "function" ? options.makeButton : function (label, className, action) {
            return defaultButton(documentObject, label, className, action);
        };
        const requestCommand = typeof options.requestCommand === "function" ? options.requestCommand : async function (path) {
            if (!fetchImpl) throw new Error("Point Color transport is unavailable");
            const response = await fetchImpl(path, { cache: "no-store" });
            const body = await response.json();
            if (!response.ok || !body || body.ok !== true) throw new Error(body && body.error || "Point Color request failed");
            return body;
        };
        const requestState = typeof options.requestState === "function" ? options.requestState : async function () {
            if (!fetchImpl) throw new Error("Point Color transport is unavailable");
            const response = await fetchImpl(routePrefix + "/state", { cache: "no-store" });
            const body = await response.json();
            if (!response.ok || !body || !body.state) throw new Error(body && body.error || "Point Color feedback failed");
            return body.state;
        };
        const bindingKey = typeof options.bindingKey === "function" ? options.bindingKey : function () { return "global"; };
        const bindingQuery = typeof options.bindingQuery === "function" ? options.bindingQuery : function () { return ""; };
        const resultForBinding = typeof options.resultForBinding === "function"
            ? options.resultForBinding : function () { return null; };
        const onInteractionChange = typeof options.onInteractionChange === "function"
            ? options.onInteractionChange : function () {};
        const onStatus = typeof options.setStatus === "function" ? options.setStatus : function () {};
        const onRefreshRequested = typeof options.onRefreshRequested === "function"
            ? options.onRefreshRequested : function () {};
        const setTimeoutImpl = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
        const clearTimeoutImpl = typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
        const commandTimeoutMs = Number.isFinite(options.commandTimeoutMs) && options.commandTimeoutMs > 0
            ? options.commandTimeoutMs : 10000;
        const feedbackTimeoutMs = Number.isFinite(options.feedbackTimeoutMs) && options.feedbackTimeoutMs > 0
            ? options.feedbackTimeoutMs : 15000;
        const showHeading = options.showHeading !== false;
        const showVisualize = options.showVisualize !== false;
        const includeSelectedIndexQuery = options.includeSelectedIndexQuery === true;
        const externalState = options.externalState === true;
        const pickerAction = options.pickerAction === false ? null :
            (typeof options.pickerAction === "function" ? options.pickerAction : function () {
                return requestCommand(routePrefix + "/tool/select");
            });
        const visualizeAction = typeof options.visualizeAction === "function" ? options.visualizeAction : function () {
            return requestCommand(routePrefix + "/range-visualization/toggle");
        };

        let host = null;
        let state = unavailableState();
        let binding = null;
        let identityKey = null;
        let controls = Object.create(null);
        let rangeControls = Object.create(null);
        let pendingWrites = [];
        let writeInFlight = null;
        let awaitingWrites = new Map();
        let intentRevision = 0;
        let settledFeedbackSequence = 0;
        let generation = 0;
        let requestInFlight = false;
        let externallyBlocked = false;
        let visualizeRequest = null;
        let visualizeControl = null;

        function notifyBusy() { onInteractionChange(isBusy()); }

        function writesAllowed() {
            return externallyBlocked !== true && state.available === true && state.swatchCount > 0 && state.selectedIndex > 0 &&
                state.selectionTransient !== true && identityKey !== null;
        }

        function editMatchesState(edit, nextState) {
            if (!edit || !validState(nextState) || nextState.selectedIndex !== edit.selectedIndex) return false;
            if (edit.type === "scalar") return sdkToUi(nextState[edit.field]) === edit.uiValue;
            if (edit.type === "range") return sdkToUi(nextState[edit.rangeName][edit.boundary]) === edit.uiValue;
            return RANGE_BOUNDARIES.every(function (boundary) {
                return sdkToUi(nextState[edit.rangeName][boundary]) === edit.uiRange[boundary];
            });
        }

        function hasNewerCoalescedEdit(edit) {
            return pendingWrites.some(function (candidate) {
                return coalesces(candidate, edit) && candidate.intentRevision > edit.intentRevision;
            }) || Boolean(writeInFlight && writeInFlight !== edit && coalesces(writeInFlight, edit) &&
                writeInFlight.intentRevision > edit.intentRevision);
        }

        function clearEditPresentation(edit, preserveNewer) {
            const control = edit.type === "scalar" ? controls[edit.field] : rangeControls[edit.rangeName];
            if (!control) return;
            if (preserveNewer || hasNewerCoalescedEdit(edit)) return;
            if (edit.type === "scalar") {
                if (control.intentRevision > edit.intentRevision) return;
                control.dirty = false;
                control.intended = null;
                if (Number.isSafeInteger(edit.editSequence)) {
                    control.settledFeedbackSequence = Math.max(control.settledFeedbackSequence, edit.editSequence);
                }
            }
            else if (edit.type === "range") delete control.dirtyBoundaries[edit.boundary];
            else RANGE_BOUNDARIES.forEach(function (boundary) { delete control.dirtyBoundaries[boundary]; });
        }

        function clearEditTimer(edit, name) {
            if (!edit || edit[name] === null || edit[name] === undefined) return;
            clearTimeoutImpl(edit[name]);
            edit[name] = null;
        }

        function rebasePresentations() {
            Object.keys(controls).forEach(function (field) {
                const control = controls[field];
                control.dirty = false;
                control.intended = null;
                const authoritative = state && state[field];
                if (typeof authoritative === "number" && Number.isFinite(authoritative)) {
                    const ui = sdkToUi(authoritative);
                    control.authoritative = ui;
                    control.range.value = String(ui);
                    control.number.value = String(ui);
                }
            });
            Object.keys(rangeControls).forEach(function (rangeName) {
                const control = rangeControls[rangeName];
                RANGE_BOUNDARIES.forEach(function (boundary) { delete control.dirtyBoundaries[boundary]; });
                const range = state && state[rangeName];
                if (range) control.applyAuthoritative(range, getRangeMarker(rangeName, state));
            });
        }

        function clearWritePipeline(message, requestRefresh) {
            if (writeInFlight) clearEditTimer(writeInFlight, "commandTimer");
            awaitingWrites.forEach(function (edit) { clearEditTimer(edit, "feedbackTimer"); });
            pendingWrites = [];
            awaitingWrites.clear();
            writeInFlight = null;
            rebasePresentations();
            if (message) onStatus(message);
            if (requestRefresh !== false) {
                onRefreshRequested();
                if (!externalState) refresh();
            }
            notifyBusy();
        }

        function settleAuthoritative(nextState, nextBinding) {
            const result = resultForBinding(nextBinding || binding);
            const iterator = awaitingWrites.entries().next();
            if (iterator.done) return;
            const key = iterator.value[0];
            const edit = iterator.value[1];
            const matched = editMatchesState(edit, nextState);
            const resultSequence = result && Number.isSafeInteger(result.sequence) ? result.sequence : null;
            let resolution = matched ? "matched" : null;
            if (Number.isSafeInteger(edit.editSequence) && resultSequence !== null &&
                resultSequence >= edit.editSequence) {
                if (resultSequence === edit.editSequence && result.outcome !== "confirmed") {
                    resolution = result.outcome === "stale" ? "stale" : "failed";
                } else if (!resolution) {
                    resolution = "normalized";
                }
            }
            if (!resolution) return;
            awaitingWrites.delete(key);
            clearEditTimer(edit, "feedbackTimer");
            if (resultSequence !== null) settledFeedbackSequence = Math.max(settledFeedbackSequence, resultSequence);
            const newerPending = hasNewerCoalescedEdit(edit);
            if (resolution === "failed" || resolution === "stale") {
                const message = resolution === "stale"
                    ? "Point Color edit was cancelled because the mask or Lightroom context changed"
                    : "ERROR: " + (result && result.detail || "Lightroom did not confirm the Point Color edit");
                clearWritePipeline(message);
                return;
            }
            clearEditPresentation(edit, newerPending);
            if (newerPending) {
                onStatus("Point Color feedback received; applying the newest queued value");
            } else if (resolution === "matched") {
                onStatus("Point Color change confirmed by Lightroom");
            } else {
                onStatus(result && result.detail ||
                    "Point Color request was superseded or normalized; Lightroom's authoritative value was adopted");
            }
            processWrites();
            notifyBusy();
        }

        function cancelLocalGestures() {
            let cancelled = false;
            Object.keys(controls).forEach(function (field) {
                const control = controls[field];
                if (control.timer !== null) { clearTimeout(control.timer); control.timer = null; cancelled = true; }
                if (control.editing || control.dirty) cancelled = true;
                control.editing = false;
                control.dirty = false;
                const authoritative = state && state[field];
                if (typeof authoritative === "number" && Number.isFinite(authoritative)) {
                    const ui = sdkToUi(authoritative);
                    control.authoritative = ui;
                    control.intended = null;
                    control.range.value = String(ui);
                    control.number.value = String(ui);
                }
            });
            Object.keys(rangeControls).forEach(function (rangeName) {
                const control = rangeControls[rangeName];
                if (control.cancel()) cancelled = true;
                const range = state && state[rangeName];
                if (range) control.applyAuthoritative(range, getRangeMarker(rangeName, state));
            });
            if (cancelled) notifyBusy();
            return cancelled;
        }

        function resetContext(nextBinding) {
            cancelLocalGestures();
            generation += 1;
            visualizeRequest = null;
            clearWritePipeline(null, false);
            state = unavailableState();
            binding = nextBinding || null;
            identityKey = nextBinding ? bindingKey(nextBinding) : null;
            onStatus("");
            if (host) render();
            notifyBusy();
        }

        function applyContext(nextBinding) {
            const nextKey = nextBinding ? bindingKey(nextBinding) : null;
            if (nextKey !== identityKey) resetContext(nextBinding);
            else binding = nextBinding || null;
        }

        function applyAuthoritative(nextState, nextBinding) {
            if (nextBinding !== undefined) {
                const nextKey = nextBinding ? bindingKey(nextBinding) : null;
                if (nextKey !== identityKey) return false;
                binding = nextBinding;
            }
            if (!validState(nextState)) return false;
            const previousIndex = state.selectedIndex;
            const selectionChanged = previousIndex !== nextState.selectedIndex || state.available !== nextState.available ||
                state.swatchCount !== nextState.swatchCount;
            state = nextState;
            settleAuthoritative(nextState, binding);
            if (selectionChanged) {
                generation += 1;
                clearWritePipeline(null, false);
                if (host) render();
                notifyBusy();
                return true;
            }
            if (!nextState.available || nextState.selectedIndex <= 0) return true;
            DEFINITIONS.forEach(function (definition) {
                const control = controls[definition.field];
                if (!control || control.editing) return;
                const ui = sdkToUi(nextState[definition.field]);
                control.authoritative = ui;
                if (control.intended !== null) {
                    control.range.value = String(control.intended);
                    control.number.value = String(control.intended);
                    return;
                }
                control.dirty = false;
                control.range.value = String(ui);
                control.number.value = String(ui);
            });
            RANGE_DEFINITIONS.forEach(function (definition) {
                const control = rangeControls[definition.name];
                if (control) control.applyAuthoritative(nextState[definition.name], getRangeMarker(definition.name, nextState));
            });
            notifyBusy();
            return true;
        }

        async function refresh() {
            if (externalState || requestInFlight || identityKey === null) return false;
            requestInFlight = true;
            try {
                const next = await requestState(binding);
                return applyAuthoritative(next, binding);
            } catch (_error) {
                return false;
            } finally {
                requestInFlight = false;
            }
        }

        function editPath(edit) {
            let path;
            if (edit.type === "scalar") {
                path = routePrefix + "/value?field=" + encodeURIComponent(edit.field) +
                    "&value=" + encodeURIComponent(String(uiToSdk(edit.uiValue)));
            } else if (edit.type === "range") {
                path = routePrefix + "/range?range=" + encodeURIComponent(edit.rangeName) +
                    "&boundary=" + encodeURIComponent(edit.boundary) +
                    "&value=" + encodeURIComponent(String(uiToSdk(edit.uiValue)));
            } else {
                path = routePrefix + "/range/translate?range=" + encodeURIComponent(edit.rangeName) +
                    RANGE_BOUNDARIES.map(function (boundary) {
                        return "&" + boundary + "=" + encodeURIComponent(String(uiToSdk(edit.uiRange[boundary])));
                    }).join("");
            }
            if (includeSelectedIndexQuery) {
                path += "&selectedIndex=" + encodeURIComponent(String(edit.selectedIndex));
            }
            const query = bindingQuery(edit.binding);
            if (query) path += "&" + query;
            return path;
        }

        function coalesces(left, right) {
            if (left.type !== right.type || left.selectedIndex !== right.selectedIndex ||
                left.generation !== right.generation || left.identityKey !== right.identityKey) return false;
            if (left.type === "scalar") return left.field === right.field;
            if (left.type === "range") return left.rangeName === right.rangeName && left.boundary === right.boundary;
            return left.rangeName === right.rangeName;
        }

        function enqueue(edit) {
            if (!writesAllowed()) return false;
            edit.selectedIndex = state.selectedIndex;
            edit.generation = generation;
            edit.identityKey = identityKey;
            edit.binding = binding && Object.assign({}, binding);
            intentRevision += 1;
            edit.intentRevision = intentRevision;
            edit.commandTimer = null;
            edit.feedbackTimer = null;
            edit.editSequence = null;
            if (edit.type === "scalar" && controls[edit.field]) {
                controls[edit.field].intended = edit.uiValue;
                controls[edit.field].intentRevision = edit.intentRevision;
                controls[edit.field].dirty = true;
            }
            for (let index = pendingWrites.length - 1; index >= 0; index -= 1) {
                if (coalesces(pendingWrites[index], edit)) {
                    pendingWrites[index] = edit;
                    processWrites();
                    notifyBusy();
                    return true;
                }
            }
            pendingWrites.push(edit);
            processWrites();
            notifyBusy();
            return true;
        }

        async function processWrites() {
            if (writeInFlight || awaitingWrites.size > 0 || pendingWrites.length === 0) return;
            const edit = pendingWrites.shift();
            if (!writesAllowed() || edit.generation !== generation || edit.identityKey !== identityKey ||
                edit.selectedIndex !== state.selectedIndex) {
                processWrites();
                notifyBusy();
                return;
            }
            writeInFlight = edit;
            edit.commandTimer = setTimeoutImpl(function () {
                if (writeInFlight !== edit) return;
                writeInFlight = null;
                clearWritePipeline("ERROR: Point Color request timed out; pending input was cancelled");
            }, commandTimeoutMs);
            notifyBusy();
            try {
                const response = await requestCommand(editPath(edit), edit);
                if (writeInFlight !== edit || edit.generation !== generation || edit.identityKey !== identityKey) return;
                clearEditTimer(edit, "commandTimer");
                if (response && Number.isSafeInteger(response.editSequence)) edit.editSequence = response.editSequence;
                awaitingWrites.set(edit.intentRevision, edit);
                edit.feedbackTimer = setTimeoutImpl(function () {
                    if (awaitingWrites.get(edit.intentRevision) !== edit) return;
                    awaitingWrites.delete(edit.intentRevision);
                    clearWritePipeline("ERROR: Point Color feedback timed out; pending input was cancelled");
                }, feedbackTimeoutMs);
                writeInFlight = null;
                settleAuthoritative(state, binding);
            } catch (error) {
                if (writeInFlight === edit) {
                    clearEditTimer(edit, "commandTimer");
                    writeInFlight = null;
                    clearWritePipeline("ERROR: " + (error && error.message ? error.message : "Point Color request failed"));
                }
            } finally {
                if (writeInFlight === edit) {
                    clearEditTimer(edit, "commandTimer");
                    writeInFlight = null;
                }
                onRefreshRequested();
                if (!externalState) refresh();
                processWrites();
                notifyBusy();
            }
        }

        function createRangeControl(rangeName, label, sdkRange, sdkMarker) {
            const root = documentObject.createElement("section");
            root.className = "point-color-detail-range";
            root.dataset.pointColorRange = rangeName;
            const heading = documentObject.createElement("div");
            heading.className = "color-mixer-group-heading";
            heading.textContent = label;
            root.appendChild(heading);
            const layout = documentObject.createElement("div");
            layout.className = "point-color-range-layout";
            const leftPair = documentObject.createElement("div");
            leftPair.className = "point-color-range-pair";
            const rightPair = documentObject.createElement("div");
            rightPair.className = "point-color-range-pair";
            const track = documentObject.createElement("div");
            track.className = "point-color-range-track";
            const rail = documentObject.createElement("div"); rail.className = "point-color-range-rail";
            const leftTransition = documentObject.createElement("div"); leftTransition.className = "point-color-range-transition";
            const rightTransition = documentObject.createElement("div"); rightTransition.className = "point-color-range-transition";
            const fullBox = documentObject.createElement("button");
            fullBox.type = "button"; fullBox.className = "point-color-range-full-box";
            fullBox.setAttribute("role", "slider"); fullBox.setAttribute("aria-label", label + " full range translation");
            const markerElement = documentObject.createElement("div"); markerElement.className = "point-color-range-marker";
            const values = {}; const handles = {}; const timers = {}; const active = {}; const pointerIds = {};
            let markerSdkExact = sdkMarker; let markerLimits = markerIntegerLimits(markerSdkExact);
            let markerUiExact = markerLimits.markerUiExact; let lowerFullMaxUi = markerLimits.lowerFullMaxUi;
            let upperFullMinUi = markerLimits.upperFullMinUi;
            const dirtyBoundaries = {};
            let groupActive = false; let groupPointerId = null; let groupStartX = 0; let groupStartValues = null;
            RANGE_BOUNDARIES.forEach(function (boundary) {
                values[boundary] = sdkToUi(sdkRange[boundary]); timers[boundary] = null; active[boundary] = false;
            });
            function clampBoundary(boundary, value) {
                value = Math.max(0, Math.min(100, Math.round(value)));
                if (boundary === "LowerNone") return Math.min(value, values.LowerFull);
                if (boundary === "LowerFull") return Math.max(values.LowerNone, Math.min(value,
                    values.UpperFull - MINIMUM_FULL_RANGE_UI,
                    lowerFullMaxUi === null ? values.UpperFull - MINIMUM_FULL_RANGE_UI : lowerFullMaxUi));
                if (boundary === "UpperFull") return Math.max(values.LowerFull + MINIMUM_FULL_RANGE_UI,
                    upperFullMinUi === null ? values.LowerFull + MINIMUM_FULL_RANGE_UI : upperFullMinUi,
                    Math.min(value, values.UpperNone));
                return Math.max(values.UpperFull, value);
            }
            function translatedRange(start, delta) {
                delta = Math.round(delta);
                if (markerUiExact !== null) {
                    const minimumDelta = Math.ceil(markerUiExact - start.UpperFull - MARKER_EPSILON);
                    const maximumDelta = Math.floor(markerUiExact - start.LowerFull + MARKER_EPSILON);
                    delta = Math.max(minimumDelta, Math.min(delta, maximumDelta));
                }
                const next = {};
                RANGE_BOUNDARIES.forEach(function (boundary) {
                    next[boundary] = Math.max(0, Math.min(100, start[boundary] + delta));
                });
                return next;
            }
            function paint() {
                leftPair.textContent = values.LowerNone + " / " + values.LowerFull;
                rightPair.textContent = values.UpperFull + " / " + values.UpperNone;
                leftTransition.style.left = values.LowerNone + "%";
                leftTransition.style.width = (values.LowerFull - values.LowerNone) + "%";
                fullBox.style.left = values.LowerFull + "%";
                fullBox.style.width = (values.UpperFull - values.LowerFull) + "%";
                rightTransition.style.left = values.UpperFull + "%";
                rightTransition.style.width = (values.UpperNone - values.UpperFull) + "%";
                RANGE_BOUNDARIES.forEach(function (boundary) {
                    if (boundary === "LowerNone" || boundary === "UpperNone") handles[boundary].style.left = values[boundary] + "%";
                    handles[boundary].setAttribute("aria-valuenow", String(values[boundary]));
                });
                markerElement.hidden = markerUiExact === null;
                if (markerUiExact !== null) markerElement.style.left = markerUiExact + "%";
                fullBox.disabled = markerUiExact === null || !writesAllowed();
                handles.LowerFull.disabled = markerUiExact === null || !writesAllowed();
                handles.UpperFull.disabled = markerUiExact === null || !writesAllowed();
                handles.LowerNone.disabled = !writesAllowed(); handles.UpperNone.disabled = !writesAllowed();
                fullBox.setAttribute("aria-valuenow", String(Math.round((values.LowerFull + values.UpperFull) / 2)));
            }
            function queue(boundary, value, immediate) {
                values[boundary] = clampBoundary(boundary, value); dirtyBoundaries[boundary] = true; paint();
                if (timers[boundary] !== null) clearTimeout(timers[boundary]);
                if (immediate) enqueue({ type: "range", rangeName: rangeName, boundary: boundary, uiValue: values[boundary] });
                else timers[boundary] = setTimeout(function () {
                    timers[boundary] = null;
                    enqueue({ type: "range", rangeName: rangeName, boundary: boundary, uiValue: values[boundary] });
                }, 225);
                notifyBusy();
            }
            RANGE_BOUNDARIES.forEach(function (boundary) {
                const handle = documentObject.createElement("button"); handle.type = "button";
                handle.className = boundary === "LowerNone" || boundary === "UpperNone" ?
                    "point-color-range-outer" : "point-color-range-inner-edge " + (boundary === "LowerFull" ? "lower" : "upper");
                handle.setAttribute("role", "slider"); handle.setAttribute("aria-valuemin", "0");
                handle.setAttribute("aria-valuemax", "100");
                handle.setAttribute("aria-label", label + " " + boundary.replace(/([A-Z])/g, " $1").trim());
                handles[boundary] = handle;
                if (boundary === "LowerFull" || boundary === "UpperFull") fullBox.appendChild(handle); else track.appendChild(handle);
                handle.addEventListener("pointerdown", function (event) {
                    active[boundary] = true; pointerIds[boundary] = event.pointerId;
                    if (handle.setPointerCapture) handle.setPointerCapture(event.pointerId);
                    event.preventDefault(); notifyBusy();
                });
                handle.addEventListener("pointermove", function (event) {
                    if (!active[boundary]) return;
                    const rect = track.getBoundingClientRect();
                    queue(boundary, ((event.clientX - rect.left) / rect.width) * 100, false);
                });
                function finish(event, commit) {
                    if (!active[boundary]) return;
                    active[boundary] = false; pointerIds[boundary] = null;
                    if (handle.hasPointerCapture && handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
                    if (commit) queue(boundary, values[boundary], true); else notifyBusy();
                }
                handle.addEventListener("pointerup", function (event) { finish(event, true); });
                handle.addEventListener("pointercancel", function (event) { finish(event, true); });
                handle.addEventListener("lostpointercapture", function (event) { finish(event, true); });
                handle.addEventListener("keydown", function (event) {
                    let delta = 0;
                    if (event.key === "ArrowLeft" || event.key === "ArrowDown") delta = -1;
                    if (event.key === "ArrowRight" || event.key === "ArrowUp") delta = 1;
                    if (delta !== 0) { event.preventDefault(); queue(boundary, values[boundary] + delta, true); }
                });
            });
            fullBox.addEventListener("pointerdown", function (event) {
                if (event.target !== fullBox) return;
                groupActive = true; groupPointerId = event.pointerId; groupStartX = event.clientX;
                groupStartValues = Object.assign({}, values);
                if (fullBox.setPointerCapture) fullBox.setPointerCapture(event.pointerId);
                event.preventDefault(); notifyBusy();
            });
            fullBox.addEventListener("pointermove", function (event) {
                if (!groupActive) return;
                const rect = track.getBoundingClientRect();
                const next = translatedRange(groupStartValues, Math.round(((event.clientX - groupStartX) / rect.width) * 100));
                Object.assign(values, next);
                RANGE_BOUNDARIES.forEach(function (boundary) { dirtyBoundaries[boundary] = true; });
                paint();
            });
            function finishGroup(event, commit) {
                if (!groupActive) return;
                groupActive = false; groupPointerId = null;
                if (fullBox.hasPointerCapture && fullBox.hasPointerCapture(event.pointerId)) fullBox.releasePointerCapture(event.pointerId);
                if (commit) enqueue({ type: "range-translate", rangeName: rangeName, uiRange: Object.assign({}, values) });
                notifyBusy();
            }
            fullBox.addEventListener("pointerup", function (event) { finishGroup(event, true); });
            fullBox.addEventListener("pointercancel", function (event) { finishGroup(event, false); });
            fullBox.addEventListener("keydown", function (event) {
                let delta = 0;
                if (event.key === "ArrowLeft" || event.key === "ArrowDown") delta = -1;
                if (event.key === "ArrowRight" || event.key === "ArrowUp") delta = 1;
                if (!delta) return;
                event.preventDefault();
                Object.assign(values, translatedRange(values, delta));
                RANGE_BOUNDARIES.forEach(function (boundary) { dirtyBoundaries[boundary] = true; });
                paint();
                enqueue({ type: "range-translate", rangeName: rangeName, uiRange: Object.assign({}, values) });
            });
            track.append(rail, leftTransition, fullBox, rightTransition, markerElement);
            paint(); layout.append(leftPair, track, rightPair); root.appendChild(layout);
            return {
                root: root, values: values, handles: handles, dirtyBoundaries: dirtyBoundaries,
                applyAuthoritative: function (nextRange, nextMarker) {
                    markerSdkExact = nextMarker; markerLimits = markerIntegerLimits(markerSdkExact);
                    markerUiExact = markerLimits.markerUiExact; lowerFullMaxUi = markerLimits.lowerFullMaxUi;
                    upperFullMinUi = markerLimits.upperFullMinUi;
                    RANGE_BOUNDARIES.forEach(function (boundary) {
                        const ui = sdkToUi(nextRange[boundary]);
                        if (active[boundary] || groupActive) return;
                        if (dirtyBoundaries[boundary] && ui !== values[boundary]) return;
                        delete dirtyBoundaries[boundary]; values[boundary] = ui;
                    });
                    paint();
                },
                markerSdkExact: function () { return markerSdkExact; },
                markerUiExact: function () { return markerUiExact; },
                translatedRange: translatedRange,
                cancel: function () {
                    const wasActive = groupActive || RANGE_BOUNDARIES.some(function (boundary) {
                        return active[boundary] || timers[boundary] !== null;
                    });
                    if (groupActive && groupPointerId !== null && fullBox.hasPointerCapture && fullBox.hasPointerCapture(groupPointerId)) {
                        fullBox.releasePointerCapture(groupPointerId);
                    }
                    groupActive = false; groupPointerId = null;
                    RANGE_BOUNDARIES.forEach(function (boundary) {
                        const pointerId = pointerIds[boundary];
                        if (active[boundary] && pointerId !== null && pointerId !== undefined &&
                            handles[boundary].hasPointerCapture && handles[boundary].hasPointerCapture(pointerId)) {
                            handles[boundary].releasePointerCapture(pointerId);
                        }
                        pointerIds[boundary] = null;
                        if (timers[boundary] !== null) clearTimeout(timers[boundary]);
                        timers[boundary] = null; active[boundary] = false;
                    });
                    return wasActive;
                }
            };
        }

        function render() {
            if (!host) return;
            if (typeof host.replaceChildren === "function") host.replaceChildren();
            else if (Array.isArray(host.children)) host.children.length = 0;
            else while (host.firstChild) host.removeChild(host.firstChild);
            controls = Object.create(null); rangeControls = Object.create(null);
            visualizeControl = null;
            if (showHeading) {
                const heading = documentObject.createElement("div");
                heading.className = "color-mixer-group-heading"; heading.textContent = "POINT COLOR";
                host.appendChild(heading);
            }
            const leadingControls = documentObject.createElement("div");
            leadingControls.className = "develop-section-leading-controls";
            const picker = makeButton("Select Color Picker", "command-neutral", function () {
                if (!pickerAction) return;
                Promise.resolve(pickerAction(binding)).catch(function (error) {
                    onStatus("ERROR: " + (error && error.message ? error.message : "Color Picker request failed"));
                });
            });
            picker.id = options.pickerId || "pointColorPickerSelect";
            picker.disabled = externallyBlocked || !pickerAction || identityKey === null;
            if (!pickerAction) picker.title = "Lightroom does not expose a safe mask-local Color Picker operation.";
            leadingControls.appendChild(picker); host.appendChild(leadingControls);
            if (!state.available) {
                const message = documentObject.createElement("p");
                message.textContent = "Point Color is unavailable in the current Lightroom context.";
                host.appendChild(message); return;
            }
            if (state.swatchCount === 0) {
                const message = documentObject.createElement("p");
                message.textContent = "Create or select a Point Color sample in Lightroom.";
                host.appendChild(message); return;
            }
            if (state.selectionTransient && !state.displaySelectedIndex) {
                const message = documentObject.createElement("p");
                message.textContent = "Point Color sample selection in progress...";
                host.appendChild(message); return;
            }
            if (state.selectionTransient) {
                const status = documentObject.createElement("p");
                status.className = "point-color-selection-status";
                status.textContent = "Selecting Point Color sample...";
                host.appendChild(status);
            }
            DEFINITIONS.forEach(function (definition) {
                const row = documentObject.createElement("div");
                row.className = "develop-slider-row point-color-slider-row";
                row.dataset.pointColorField = definition.field;
                const label = documentObject.createElement("div"); label.className = "slider-name"; label.textContent = definition.label;
                const range = documentObject.createElement("input"); range.type = "range";
                range.min = String(definition.min); range.max = String(definition.max); range.step = "1";
                const number = documentObject.createElement("input"); number.type = "text"; number.inputMode = "numeric";
                number.setAttribute("aria-label", definition.label + " numeric value");
                let ui = sdkToUi(state[definition.field]); range.value = String(ui); number.value = String(ui);
                const control = { range: range, number: number, editing: false, dirty: false, timer: null,
                    authoritative: ui, intended: null, intentRevision: 0, settledFeedbackSequence: 0 };
                function show(value) { range.value = String(value); number.value = String(value); }
                function submit(value, debounce) {
                    value = Math.round(Number(value));
                    const current = control.intended !== null ? control.intended : control.authoritative;
                    if (!Number.isFinite(value) || value < definition.min || value > definition.max) { show(current); return; }
                    if (value === current && control.timer === null) return;
                    show(value);
                    if (control.timer !== null) clearTimeout(control.timer);
                    if (debounce) control.timer = setTimeout(function () {
                        control.timer = null; enqueue({ type: "scalar", field: definition.field, uiValue: value });
                    }, 225);
                    else enqueue({ type: "scalar", field: definition.field, uiValue: value });
                    notifyBusy();
                }
                range.addEventListener("input", function () { submit(range.value, true); });
                range.addEventListener("change", function () { submit(range.value, false); });
                number.addEventListener("focus", function () { control.editing = true; number.select(); notifyBusy(); });
                number.addEventListener("blur", function () { control.editing = false; submit(number.value, false); });
                number.addEventListener("keydown", function (event) {
                    if (event.key === "Enter") number.blur();
                    else if (event.key === "Escape") { show(sdkToUi(state[definition.field])); number.blur(); }
                });
                const minus = makeButton("−", "develop-slider-step", function () {
                    submit((control.intended !== null ? control.intended : control.authoritative) - 1, false);
                });
                const plus = makeButton("+", "develop-slider-step", function () {
                    submit((control.intended !== null ? control.intended : control.authoritative) + 1, false);
                });
                const reset = makeButton("Reset", "reset", function () { submit(definition.reset, false); });
                const disabled = !writesAllowed();
                range.disabled = disabled; number.disabled = disabled; minus.disabled = disabled; plus.disabled = disabled; reset.disabled = disabled;
                row.append(label, range, number, minus, plus, reset); host.appendChild(row); controls[definition.field] = control;
            });
            RANGE_DEFINITIONS.forEach(function (definition) {
                const control = createRangeControl(definition.name, definition.label, state[definition.name],
                    getRangeMarker(definition.name, state));
                rangeControls[definition.name] = control; host.appendChild(control.root);
            });
            if (showVisualize) {
                const toggle = makeButton("Toggle Visualize Range", "command-neutral", async function () {
                    if (toggle.disabled || visualizeRequest || externallyBlocked || identityKey === null) return;
                    const request = { generation: generation }; visualizeRequest = request;
                    toggle.disabled = true; toggle.setAttribute("aria-busy", "true"); notifyBusy();
                    try { await visualizeAction(binding); }
                    catch (error) {
                        if (request.generation === generation) onStatus("ERROR: " + (error && error.message ? error.message : "Visualize Range request failed"));
                    } finally {
                        if (visualizeRequest === request) {
                            visualizeRequest = null;
                            // Only settle the button: its host may now contain another Color Mixer view.
                            if (visualizeControl) {
                                visualizeControl.disabled = externallyBlocked || identityKey === null;
                                visualizeControl.setAttribute("aria-busy", "false");
                            }
                            notifyBusy();
                        }
                    }
                });
                toggle.id = options.visualizeId || "pointColorVisualizeRange";
                toggle.disabled = externallyBlocked || identityKey === null || !!visualizeRequest;
                toggle.setAttribute("aria-busy", String(!!visualizeRequest));
                visualizeControl = toggle;
                host.appendChild(toggle);
                const visualizeHelp = documentObject.createElement("p");
                visualizeHelp.className = "command-group-note";
                visualizeHelp.style.marginTop = "8px";
                visualizeHelp.textContent = "Button feedback is not yet supported. Please check Lightroom Classic to see whether Visualize Range is on or off.";
                host.appendChild(visualizeHelp);
            }
        }

        function isBusy() {
            return !!visualizeRequest || !!writeInFlight || pendingWrites.length > 0 || awaitingWrites.size > 0 ||
                Object.keys(controls).some(function (field) {
                    const control = controls[field];
                    return control.timer !== null || control.editing || control.dirty;
                }) || Object.keys(rangeControls).some(function (rangeName) {
                    const control = rangeControls[rangeName];
                    return RANGE_BOUNDARIES.some(function (boundary) { return control.dirtyBoundaries[boundary]; });
                });
        }

        return Object.freeze({
            mount: function (nextHost) { host = nextHost; render(); return host; },
            unmount: function () { resetContext(null); host = null; },
            render: render,
            refresh: refresh,
            applyContext: applyContext,
            applyAuthoritative: applyAuthoritative,
            setBlocked: function (value) {
                const next = value === true;
                if (next === externallyBlocked) return false;
                externallyBlocked = next;
                if (host) render();
                return true;
            },
            cancelLocalGestures: cancelLocalGestures,
            invalidate: function () { resetContext(binding || {}); },
            isBusy: isBusy,
            getState: function () {
                const scalarIntents = {};
                Object.keys(controls).forEach(function (field) {
                    scalarIntents[field] = {
                        authoritative: controls[field].authoritative,
                        intended: controls[field].intended,
                        intentRevision: controls[field].intentRevision,
                        settledFeedbackSequence: controls[field].settledFeedbackSequence
                    };
                });
                return {
                    state: Object.assign({}, state), identityKey: identityKey,
                    generation: generation, pendingCount: pendingWrites.length,
                    writeInFlight: !!writeInFlight, awaitingCount: awaitingWrites.size,
                    intentRevision: intentRevision, settledFeedbackSequence: settledFeedbackSequence,
                    scalarIntents: scalarIntents
                };
            }
        });
    }

    return Object.freeze({
        DEFINITIONS, RANGE_DEFINITIONS, RANGE_BOUNDARIES, MARKER_FIELDS,
        MARKER_EPSILON, MINIMUM_FULL_RANGE_UI, sdkToUi, uiToSdk,
        markerIntegerLimits, getRangeMarker, validRange, validState, createController
    });
});
