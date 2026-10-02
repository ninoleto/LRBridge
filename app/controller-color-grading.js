(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.LRBridgeColorGrading = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const ACTIVE_INTERVAL_MS = 400;
    const COMMAND_THROTTLE_MS = 125;
    const SNAPSHOT_TIMEOUT_MS = 4000;
    const RESET_RETRY_MS = 180;
    const RESET_MAX_ATTEMPTS = 6;
    const RESET_INTERACTION_DELAY_MS = 500;
    const RESET_DEFAULTS = Object.freeze({
        shadow_luminance: 0, midtone_luminance: 0, highlight_luminance: 0, global_luminance: 0,
        blending: 50, balance: 0
    });

    function normalizeNumber(value) {
        const text = String(value).replace(",", ".").trim();
        if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return null;
        const number = Number(text);
        return Number.isFinite(number) ? number : null;
    }

    function clamp(value, range) {
        return Math.min(range.max, Math.max(range.min, value));
    }

    function updateWheelPair(pair, property, value) {
        return {
            hue: property === "hue" ? value : pair.hue,
            saturation: property === "saturation" ? value : pair.saturation
        };
    }

    function createWheelPairDispatcher(options) {
        let timer = null;
        let pendingPair = null;
        let lastSentPair = null;
        function equal(left, right) {
            return left && right && Number(left.hue) === Number(right.hue) && Number(left.saturation) === Number(right.saturation);
        }
        function deliver(pair) {
            if (equal(pair, lastSentPair)) return false;
            lastSentPair = { hue: pair.hue, saturation: pair.saturation };
            options.send(lastSentPair);
            return true;
        }
        return {
            schedule(pair) {
                pendingPair = { hue: pair.hue, saturation: pair.saturation };
                if (timer !== null) return false;
                timer = options.setTimeout(function () {
                    timer = null;
                    const latest = pendingPair;
                    pendingPair = null;
                    deliver(latest);
                }, options.delay);
                return true;
            },
            finalize(pair) {
                if (timer !== null) options.clearTimeout(timer);
                timer = null;
                pendingPair = null;
                return deliver(pair);
            },
            rebase(pair) {
                if (timer !== null) options.clearTimeout(timer);
                timer = null;
                pendingPair = null;
                lastSentPair = { hue: pair.hue, saturation: pair.saturation };
            },
            cancel() {
                if (timer !== null) options.clearTimeout(timer);
                timer = null;
                pendingPair = null;
            },
            resetContext() { this.cancel(); lastSentPair = null; }
        };
    }

    function resetSnapshotMatches(parameters, expected) {
        return Object.keys(expected).every(function (parameter) {
            const result = parameters && parameters[parameter];
            return result && result.available === true && typeof result.value === "number" &&
                Number(result.value) === Number(expected[parameter]);
        });
    }

    function createResetConfirmation(expected, generation, contextKey, maxAttempts) {
        let attempts = 0;
        let active = true;
        return {
            observe(parameters, observedGeneration, observedContextKey) {
                if (!active) return "retired";
                if (observedGeneration !== generation || observedContextKey !== contextKey) { active = false; return "obsolete"; }
                if (resetSnapshotMatches(parameters, expected)) { active = false; return "confirmed"; }
                attempts += 1;
                if (attempts >= maxAttempts) { active = false; return "failed"; }
                return "pending";
            },
            cancel() { active = false; },
            isActive() { return active; },
            getAttempts() { return attempts; }
        };
    }

    // Presentation only. Contacts hold the guard; only real input/release can
    // start its cooldown. Authoritative feedback never changes this clock.
    function createResetInteractionGuard(options) {
        const contacts = new Set();
        let timer = null, blocked = false;
        function clearTimer() {
            if (timer !== null) options.clearTimeout(timer);
            timer = null;
        }
        function setBlocked(value) {
            if (blocked === value) return;
            blocked = value;
            options.onChange();
        }
        function cooldown() {
            clearTimer();
            if (contacts.size) return;
            timer = options.setTimeout(function () {
                timer = null;
                setBlocked(false);
            }, RESET_INTERACTION_DELAY_MS);
        }
        return {
            begin(contact) { contacts.add(contact); clearTimer(); setBlocked(true); },
            input() { clearTimer(); setBlocked(true); cooldown(); },
            end(contact) { if (contacts.delete(contact)) cooldown(); },
            releaseAll() { if (contacts.size) { contacts.clear(); cooldown(); } },
            cancel() { clearTimer(); contacts.clear(); setBlocked(false); },
            isBlocked() { return blocked; }
        };
    }

    function updateStatusElement(element, text, kind) {
        const nextKind = kind || "connected";
        let changed = false;
        if (element.textContent !== text) { element.textContent = text; changed = true; }
        if (element.dataset.state !== nextKind) { element.dataset.state = nextKind; changed = true; }
        return changed;
    }

    function wheelPoint(clientX, clientY, rect, hueRange, saturationRange) {
        const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
        const dx = clientX - (rect.left + rect.width / 2);
        const dy = clientY - (rect.top + rect.height / 2);
        const distance = Math.min(radius, Math.sqrt(dx * dx + dy * dy));
        let physicalDegrees = Math.atan2(dx, -dy) * 180 / Math.PI;
        if (physicalDegrees < 0) physicalDegrees += 360;
        const hueDegrees = (90 - physicalDegrees + 360) % 360;
        return {
            hue: clamp(hueRange.min + hueDegrees / 360 * (hueRange.max - hueRange.min), hueRange),
            saturation: clamp(saturationRange.min + distance / radius * (saturationRange.max - saturationRange.min), saturationRange)
        };
    }

    function commandPath(command, fields) {
        const params = new URLSearchParams({ command: command });
        Object.keys(fields).forEach(function (key) { params.set(key, String(fields[key])); });
        return "/api/command?" + params.toString();
    }

    function createScalarDispatcher(options) {
        let timer = null;
        let pendingValue = null;
        let lastSentValue = null;

        function cancelTimer() {
            if (timer !== null) options.clearTimeout(timer);
            timer = null;
        }

        function deliver(value) {
            if (value === lastSentValue) return false;
            lastSentValue = value;
            options.send(value);
            return true;
        }

        return {
            schedule(value) {
                pendingValue = value;
                if (timer !== null) return false;
                timer = options.setTimeout(function () {
                    timer = null;
                    const latest = pendingValue;
                    pendingValue = null;
                    deliver(latest);
                }, options.delay);
                return true;
            },
            finalize(value) {
                cancelTimer();
                pendingValue = null;
                return deliver(value);
            },
            rebase(value) {
                cancelTimer();
                pendingValue = null;
                lastSentValue = value;
            },
            resetContext() {
                cancelTimer();
                pendingValue = null;
                lastSentValue = null;
            },
            getLastSentValue() { return lastSentValue; },
            hasTimer() { return timer !== null; }
        };
    }

    function createCycleGate(createAbortController) {
        let generation = 0;
        let active = null;
        return {
            begin() {
                if (active) active.controller.abort();
                active = { generation: ++generation, controller: createAbortController() };
                return active;
            },
            cancel() {
                generation += 1;
                if (active) active.controller.abort();
                active = null;
            },
            isCurrent(cycle) { return active === cycle && cycle.generation === generation; },
            retire(cycle) { if (active === cycle) active = null; },
            hasActive() { return active !== null; }
        };
    }

    function finishWheelPointer(kind, dragState, region, event, handlers) {
        if (dragState.current !== region) return false;
        if (kind === "pointerup") handlers.update(event);
        dragState.current = null;
        handlers.release(event);
        if (kind === "pointerup") handlers.finalize();
        else handlers.cancel();
        return true;
    }

    function createController(options) {
        const document = options.document;
        const window = options.window;
        const fetchFn = options.fetch;
        const setGlobalStatus = options.setStatus || function () {};
        const elements = options.elements;
        const state = {
            metadata: null,
            parameters: Object.create(null),
            activeView: null,
            contextKey: null,
            requestSequence: 0,
            activeRequestId: null,
            requestInFlight: false,
            pollTimer: null,
            visible: false,
            controls: Object.create(null),
            regionControls: Object.create(null),
            draggingRegion: null,
            localRevision: Object.create(null),
            scalarCommandTails: Object.create(null),
            scalarResetIntents: Object.create(null),
            regionResetAdmissions: Object.create(null),
            pendingSince: Object.create(null),
            snapshotRequestedAt: 0,
            hasCompleteSnapshot: false,
            pollingGeneration: 0,
            resetConfirmations: Object.create(null),
            resetInteractionGuards: Object.create(null),
            resetWarning: null,
            wheelDispatchers: Object.create(null)
        };
        const cycleGate = createCycleGate(function () { return new window.AbortController(); });

        function resetSentValueState() {
            Object.values(state.wheelDispatchers).forEach(function (dispatcher) { dispatcher.resetContext(); });
            Object.keys(state.controls).forEach(function (key) {
                const control = state.controls[key];
                if (control.dispatcher) control.dispatcher.resetContext();
            });
        }

        function activate() {
            state.visible = true;
            state.pollingGeneration += 1;
            window.addEventListener("pointerup", endResetPointer, true);
            window.addEventListener("pointercancel", endResetPointer, true);
            window.addEventListener("blur", releaseResetContacts);
            if (!state.hasCompleteSnapshot) status("Loading Lightroom values…", "pending");
            if (state.metadata) scheduleSnapshot(0, true);
        }

        function deactivate() {
            state.visible = false;
            state.pollingGeneration += 1;
            window.removeEventListener("pointerup", endResetPointer, true);
            window.removeEventListener("pointercancel", endResetPointer, true);
            window.removeEventListener("blur", releaseResetContacts);
            cancelResetInteractionGuards();
            cancelResetConfirmations();
            stopPolling();
        }

        function status(text, kind) {
            updateStatusElement(elements.cgStatus, text, kind);
        }

        function stopPolling() {
            if (state.pollTimer !== null) window.clearTimeout(state.pollTimer);
            state.pollTimer = null;
            state.requestSequence += 1;
            state.activeRequestId = null;
            state.requestInFlight = false;
            cycleGate.cancel();
        }

        function scheduleSnapshot(delay, immediate) {
            if (!state.visible || state.requestInFlight) return;
            if (state.pollTimer !== null) window.clearTimeout(state.pollTimer);
            state.pollTimer = window.setTimeout(function () {
                state.pollTimer = null;
                requestSnapshot(immediate === true);
            }, delay);
        }

        function invalidateFeedback(message) {
            resetSentValueState();
            cancelResetInteractionGuards();
            state.pendingSince = Object.create(null);
            cancelResetConfirmations();
            if (!state.hasCompleteSnapshot) status(message || "Loading Lightroom values…", "pending");
        }

        async function requestSnapshot(force) {
            if (!state.visible) return;
            if (state.requestInFlight && force !== true) return;
            if (state.requestInFlight) {
                state.requestSequence += 1;
                state.activeRequestId = null;
                state.requestInFlight = false;
                cycleGate.cancel();
            }
            state.requestInFlight = true;
            const sequence = ++state.requestSequence;
            const pollingGeneration = state.pollingGeneration;
            const cycle = cycleGate.begin();
            const signal = cycle.controller.signal;
            try {
                const requestResponse = await fetchFn("/api/color-grading/request", { cache: "no-store", signal: signal });
                const requestBody = await requestResponse.json();
                const requestId = requestBody && requestBody.request && requestBody.request.id;
                if (!requestResponse.ok || requestId === undefined) throw new Error("Color Grading feedback request failed");
                if (!cycleGate.isCurrent(cycle) || signal.aborted || sequence !== state.requestSequence || pollingGeneration !== state.pollingGeneration) return;
                state.activeRequestId = requestId;
                const started = Date.now();
                while (state.visible && sequence === state.requestSequence && Date.now() - started < SNAPSHOT_TIMEOUT_MS) {
                    const response = await fetchFn("/api/color-grading/snapshot?id=" + encodeURIComponent(requestId), { cache: "no-store", signal: signal });
                    const body = await response.json();
                    if (!response.ok || !body.snapshot) throw new Error("Color Grading snapshot failed");
                    if (!cycleGate.isCurrent(cycle) || requestId !== state.activeRequestId || sequence !== state.requestSequence || pollingGeneration !== state.pollingGeneration) return;
                    if (body.snapshot.complete === true) {
                        applySnapshot(body.snapshot, requestId);
                        return;
                    }
                    await new Promise(function (resolve) { window.setTimeout(resolve, 50); });
                }
                if (sequence === state.requestSequence) status("Waiting for Lightroom", "warning");
            } catch (err) {
                if (!signal.aborted && cycleGate.isCurrent(cycle) && sequence === state.requestSequence) status("Disconnected", "warning");
            } finally {
                if (cycleGate.isCurrent(cycle) && sequence === state.requestSequence) {
                    cycleGate.retire(cycle);
                    state.requestInFlight = false;
                    state.activeRequestId = null;
                    scheduleSnapshot(hasResetConfirmations() ? RESET_RETRY_MS : ACTIVE_INTERVAL_MS, false);
                }
            }
        }

        function contextMessage(context) {
            if (!context || !context.lastHeartbeatAt || Date.now() - context.lastHeartbeatAt > 2500) return "Waiting for Lightroom";
            if (context.activeModule !== "develop") return "Develop required";
            if (!context.selectedPhotoKey) return "No active photo";
            return "Connected";
        }

        function applySnapshot(snapshot, requestId) {
            if (requestId !== state.activeRequestId || snapshot.complete !== true) return false;
            const context = snapshot.context || {};
            const nextContextKey = [context.activeModule, context.selectedPhotoKey].join("|");
            if (state.contextKey !== null && state.contextKey !== nextContextKey) invalidateFeedback("Feedback pending");
            state.contextKey = nextContextKey;
            state.snapshotRequestedAt = snapshot.requestedAt || 0;
            state.parameters = snapshot.parameters || Object.create(null);
            state.activeView = snapshot.view && snapshot.view.available === true ? snapshot.view.value : null;
            evaluateResetConfirmations(snapshot, nextContextKey);
            renderAuthoritativeState();
            state.hasCompleteSnapshot = true;
            if (state.resetWarning) status(state.resetWarning, "warning");
            else if (hasResetConfirmations()) status(resetStatusText(), "pending");
            else status(contextMessage(context), contextMessage(context) === "Connected" ? "connected" : "warning");
            return true;
        }

        function hasResetConfirmations() {
            return Object.keys(state.resetConfirmations).length > 0;
        }

        function cancelResetConfirmations() {
            Object.values(state.resetConfirmations).forEach(function (confirmation) {
                confirmation.tracker.cancel();
                confirmation.pendingKeys.forEach(function (pendingKey) { delete state.pendingSince[pendingKey]; });
            });
            state.resetConfirmations = Object.create(null);
            state.scalarResetIntents = Object.create(null);
            state.resetWarning = null;
            Object.values(state.controls).forEach(updateScalarResetAppearance);
        }

        function resetStatusText() {
            const confirmations = Object.values(state.resetConfirmations);
            return confirmations.length ? confirmations[0].label : "Confirming Color Grading reset…";
        }

        function evaluateResetConfirmations(snapshot, contextKey) {
            Object.keys(state.resetConfirmations).forEach(function (key) {
                const confirmation = state.resetConfirmations[key];
                const result = confirmation.tracker.observe(snapshot.parameters, state.pollingGeneration, contextKey);
                if (result === "obsolete") {
                    delete state.resetConfirmations[key];
                    delete state.scalarResetIntents[key];
                    confirmation.pendingKeys.forEach(function (pendingKey) { delete state.pendingSince[pendingKey]; });
                    return;
                }
                if (result === "confirmed") {
                    confirmation.pendingKeys.forEach(function (pendingKey) { delete state.pendingSince[pendingKey]; });
                    delete state.resetConfirmations[key];
                    delete state.scalarResetIntents[key];
                    return;
                }
                if (result === "failed") {
                    confirmation.pendingKeys.forEach(function (pendingKey) { delete state.pendingSince[pendingKey]; });
                    delete state.resetConfirmations[key];
                    delete state.scalarResetIntents[key];
                    state.resetWarning = "Color Grading reset confirmation unavailable";
                }
            });
        }

        function beginResetConfirmation(key, kind, expected, pendingKeys, label) {
            state.resetWarning = null;
            pendingKeys.forEach(function (pendingKey) { state.pendingSince[pendingKey] = Date.now(); });
            state.resetConfirmations[key] = {
                kind: kind, label: label, expected: expected, pendingKeys: pendingKeys,
                revisions: Object.fromEntries(pendingKeys.map(function (pendingKey) { return [pendingKey, state.localRevision[pendingKey]]; })),
                tracker: createResetConfirmation(expected, state.pollingGeneration, state.contextKey, RESET_MAX_ATTEMPTS)
            };
            status(label, "pending");
            requestSnapshot(true);
        }

        function setControlPending(control) {
            if (!control) return;
            control.available = false;
            [control.range, control.number, control.reset, control.minus, control.plus].filter(Boolean).forEach(function (element) { element.disabled = true; });
            if (control.state) control.state.textContent = "Feedback pending";
        }

        function parameterResult(parameter) {
            return state.parameters[parameter] || null;
        }

        function isLocallyActive(key) {
            const pendingAt = state.pendingSince[key];
            const control = state.controls[key];
            const card = state.regionControls[key];
            const resetting = Object.values(state.resetConfirmations).some(function (confirmation) { return confirmation.pendingKeys.indexOf(key) >= 0; });
            return state.draggingRegion === key || Boolean(control && control.editing) || Boolean(card && card.editingField) || Boolean(pendingAt) || resetting;
        }

        function renderAuthoritativeState() {
            const viewAvailable = state.activeView !== null;
            elements.viewButtons.forEach(function (button) {
                const selected = button.dataset.view === state.activeView;
                button.classList.toggle("active", selected);
                button.setAttribute("aria-pressed", String(selected));
                button.disabled = !viewAvailable;
            });
            Object.keys(state.regionControls).forEach(function (region) {
                const card = state.regionControls[region];
                const definition = state.metadata.regions[region];
                const hue = parameterResult(definition.hue);
                const saturation = parameterResult(definition.saturation);
                const luminance = parameterResult(definition.luminance);
                updateWheelAvailability(card, hue, saturation);
                updateScalarAvailability(card.luminance, luminance);
                if (hue && saturation && hue.available && saturation.available) {
                    card.authoritativeValue = { hue: hue.value, saturation: saturation.value };
                    card.ranges = { hue: hue.range, saturation: saturation.range };
                    if (state.pendingSince[region] && card.value && Number(hue.value) === Number(card.value.hue) && Number(saturation.value) === Number(card.value.saturation)) {
                        delete state.pendingSince[region];
                    }
                    if (!isLocallyActive(region)) showWheelValue(card, hue.value, saturation.value, hue.range, saturation.range);
                }
                if (luminance && luminance.available) {
                    card.luminance.authoritativeValue = luminance.value;
                    card.luminance.runtimeRange = luminance.range;
                    if (state.pendingSince[card.luminance.control] && Number(luminance.value) === Number(card.luminance.value)) delete state.pendingSince[card.luminance.control];
                    if (!isLocallyActive(card.luminance.control)) showScalarValue(card.luminance, luminance.value, luminance.range);
                }
            });
            ["blending", "balance"].forEach(function (controlName) {
                const control = state.controls[controlName];
                const result = parameterResult(state.metadata.scalarControls[controlName].parameter);
                updateScalarAvailability(control, result);
                if (result && result.available) {
                    control.authoritativeValue = result.value;
                    control.runtimeRange = result.range;
                    if (state.pendingSince[controlName] && Number(result.value) === Number(control.value)) delete state.pendingSince[controlName];
                    if (!isLocallyActive(controlName)) showScalarValue(control, result.value, result.range);
                }
            });
        }

        function updateWheelAvailability(card, hue, saturation) {
            const ready = hue && saturation && hue.available === true && saturation.available === true;
            const pending = !hue || !saturation;
            card.available = ready;
            if (!card.editingField) [card.wheel, card.hueRange, card.hue, card.saturationRange, card.saturation].forEach(function (element) { element.disabled = !ready; });
            updateRegionResetAppearance(card);
            card.state.textContent = ready ? "Available" : pending ? "Feedback pending" : "Parameter unavailable";
            card.root.classList.toggle("unavailable", !ready);
        }

        function updateScalarAvailability(control, result) {
            const ready = result && result.available === true;
            const pending = !result;
            control.available = ready;
            if (!control.editing) [control.range, control.number].forEach(function (element) { element.disabled = !ready; });
            updateScalarResetAppearance(control);
            updateScalarStepButtons(control);
            if (control.state) control.state.textContent = ready ? "Available" : pending ? "Feedback pending" : "Parameter unavailable";
        }

        function scalarResetPending(control) {
            const intent = state.scalarResetIntents[control.control];
            return Boolean(intent && intent.generation === state.pollingGeneration &&
                intent.contextKey === state.contextKey && intent.revision === state.localRevision[control.control]);
        }

        function updateScalarResetAppearance(control) {
            const resetting = scalarResetPending(control);
            control.reset.disabled = !control.available || resetting || control.resetGuard.isBlocked();
            control.reset.textContent = resetting ? "Resetting…" : control.resetLabel;
            control.reset.setAttribute("aria-busy", String(resetting));
            control.reset.title = resetting ? "Waiting for Lightroom to confirm this reset." : "";
        }

        function updateRegionResetAppearance(card) {
            const disabled = !card.available || card.resetGuard.isBlocked();
            card.resetRegion.disabled = disabled;
            card.confirmReset.disabled = disabled;
        }

        function resetInteractionGuard(key) {
            if (!state.resetInteractionGuards[key]) state.resetInteractionGuards[key] = createResetInteractionGuard({
                setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
                onChange: function () {
                    Object.values(state.controls).forEach(updateScalarResetAppearance);
                    Object.values(state.regionControls).forEach(updateRegionResetAppearance);
                }
            });
            return state.resetInteractionGuards[key];
        }

        function endResetPointer(event) {
            Object.values(state.resetInteractionGuards).forEach(function (guard) { guard.end("pointer:" + event.pointerId); });
        }

        function releaseResetContacts() {
            Object.values(state.resetInteractionGuards).forEach(function (guard) { guard.releaseAll(); });
        }

        function cancelResetInteractionGuards() {
            Object.values(state.resetInteractionGuards).forEach(function (guard) { guard.cancel(); });
        }

        function bindResetInteraction(element, guard, numeric) {
            function usable() { return state.visible && element.disabled !== true && !element.matches(":disabled"); }
            element.addEventListener("pointerdown", function (event) {
                if (usable()) guard.begin("pointer:" + event.pointerId);
            }, true);
            element.addEventListener("lostpointercapture", endResetPointer, true);
            element.addEventListener("input", function () {
                if (!usable()) return;
                if (numeric && document.activeElement === element) guard.begin(element);
                guard.input();
            }, true);
            if (numeric) {
                // Editing ends on Enter/Escape/blur. Do not let blur's command
                // delivery turn an apparently enabled Reset into a missed click.
                element.addEventListener("focus", function () { if (usable()) guard.begin(element); }, true);
                element.addEventListener("blur", function () { guard.end(element); }, true);
            } else {
                element.addEventListener(element.tagName === "BUTTON" ? "click" : "change", function () {
                    if (usable()) guard.input();
                }, true);
                element.addEventListener("keydown", function (event) {
                    if (usable() && /^(Arrow|Home$|End$|Page)/.test(event.key)) guard.input();
                }, true);
            }
        }

        function showWheelValue(card, hue, saturation, hueRange, saturationRange, rebaseSentPair) {
            card.value = { hue: hue, saturation: saturation };
            card.ranges = { hue: hueRange, saturation: saturationRange };
            const hueText = formatNumber(hue);
            const saturationText = formatNumber(saturation);
            if (card.hue.value !== hueText) card.hue.value = hueText;
            if (card.saturation.value !== saturationText) card.saturation.value = saturationText;
            card.hueRange.min = hueRange.min;
            card.hueRange.max = hueRange.max;
            card.hueRange.step = "1";
            card.saturationRange.min = saturationRange.min;
            card.saturationRange.max = saturationRange.max;
            card.saturationRange.step = "1";
            if (String(card.hueRange.value) !== String(hue)) card.hueRange.value = hue;
            if (String(card.saturationRange.value) !== String(saturation)) card.saturationRange.value = saturation;
            card.hueRangeText.textContent = formatNumber(hueRange.min) + "–" + formatNumber(hueRange.max);
            card.saturationRangeText.textContent = formatNumber(saturationRange.min) + "–" + formatNumber(saturationRange.max);
            const hueFraction = (hue - hueRange.min) / (hueRange.max - hueRange.min);
            const angle = Math.PI / 2 - hueFraction * Math.PI * 2;
            const radial = (saturation - saturationRange.min) / (saturationRange.max - saturationRange.min) * 50;
            card.pointer.style.left = (50 + Math.sin(angle) * radial) + "%";
            card.pointer.style.top = (50 - Math.cos(angle) * radial) + "%";
            card.wheel.setAttribute("aria-valuetext", "Hue " + formatNumber(hue) + ", Saturation " + formatNumber(saturation));
            if (rebaseSentPair !== false && !isLocallyActive(card.region) && state.wheelDispatchers[card.region]) {
                state.wheelDispatchers[card.region].rebase({ hue: hue, saturation: saturation });
            }
        }

        function showScalarValue(control, value, range, rebaseSentValue) {
            control.value = value;
            control.runtimeRange = range;
            control.range.min = range.min;
            control.range.max = range.max;
            control.range.step = control.control === "blending" || range.max - range.min > 100 ? "1" : "0.1";
            if (String(control.range.value) !== String(value)) control.range.value = value;
            control.number.min = range.min;
            control.number.max = range.max;
            const numberText = formatNumber(control.control === "blending" ? Math.round(value) : value);
            if (control.number.value !== numberText) control.number.value = numberText;
            control.rangeText.textContent = formatNumber(range.min) + "–" + formatNumber(range.max);
            updateScalarStepButtons(control);
            if (rebaseSentValue !== false && control.dispatcher && !isLocallyActive(control.control)) control.dispatcher.rebase(value);
        }

        function formatNumber(value) {
            return String(Math.round(Number(value) * 100) / 100);
        }

        async function send(path, onAccepted) {
            const response = await fetchFn(path, { cache: "no-store" });
            if (!response.ok) {
                setGlobalStatus("ERROR: Color Grading command failed.");
                return false;
            }
            setGlobalStatus("OK: Color Grading command accepted");
            if (onAccepted) onAccepted();
            else scheduleSnapshot(160, true);
            return true;
        }

        function markPending(key) {
            state.localRevision[key] = (state.localRevision[key] || 0) + 1;
            state.pendingSince[key] = Date.now();
        }

        // Order scalar HTTP admission, not SDK execution or feedback. Reset must
        // follow already submitted Sets; a later edit must follow Reset admission.
        function sendScalarCommand(controlName, path, onAccepted, pendingKeys) {
            const generation = state.pollingGeneration, contextKey = state.contextKey;
            const keys = pendingKeys || [controlName];
            const revisions = Object.fromEntries(keys.map(function (key) { return [key, state.localRevision[key]]; }));
            const currentContext = function () { return state.visible && generation === state.pollingGeneration && contextKey === state.contextKey; };
            async function dispatch() {
                if (!currentContext()) return false;
                try {
                    return await send(path, function () {
                        if (!currentContext()) return;
                        if (onAccepted) onAccepted();
                        else scheduleSnapshot(160, true);
                    });
                } catch (_) {
                    setGlobalStatus("ERROR: Color Grading command acceptance could not be confirmed. No automatic retry was sent.");
                    return null; // Uncertain admission: do not send queued edits past it.
                }
            }
            const previous = state.scalarCommandTails[controlName];
            const operation = previous ? previous.then(function (result) { return result === null ? null : dispatch(); }) : dispatch();
            state.scalarCommandTails[controlName] = operation;
            operation.then(function (result) {
                if (state.scalarCommandTails[controlName] === operation) delete state.scalarCommandTails[controlName];
                if (result !== true && currentContext()) {
                    keys.forEach(function (key) { if (revisions[key] === state.localRevision[key]) delete state.pendingSince[key]; });
                    requestSnapshot(true); // Resolve failed/uncertain intent from fresh SDK feedback.
                }
            });
            return operation;
        }

        function retireScalarReset(controlName) {
            delete state.scalarResetIntents[controlName];
            Object.keys(state.resetConfirmations).forEach(function (key) {
                const confirmation = state.resetConfirmations[key];
                if (confirmation.pendingKeys.indexOf(controlName) < 0) return;
                confirmation.tracker.cancel();
                confirmation.pendingKeys.forEach(function (pendingKey) {
                    if (confirmation.revisions[pendingKey] === state.localRevision[pendingKey]) delete state.pendingSince[pendingKey];
                });
                delete state.resetConfirmations[key];
            });
            const control = state.controls[controlName];
            if (control) updateScalarResetAppearance(control);
        }

        function sendWheel(region, final) {
            const card = state.regionControls[region];
            if (!card.available || !card.value) return;
            retireScalarReset(region);
            markPending(region);
            const pair = { hue: card.value.hue, saturation: card.value.saturation };
            if (final) return state.wheelDispatchers[region].finalize(pair);
            return state.wheelDispatchers[region].schedule(pair);
        }

        function updateWheelFromRange(region, property, final) {
            const card = state.regionControls[region];
            if (!card.available || !card.value || !card.ranges) return;
            const range = property === "hue" ? card.hueRange : card.saturationRange;
            const next = updateWheelPair(card.value, property, clamp(Number(range.value), card.ranges[property]));
            showWheelValue(card, next.hue, next.saturation, card.ranges.hue, card.ranges.saturation, false);
            sendWheel(region, final);
        }

        function updateWheelFromPointer(region, event) {
            const card = state.regionControls[region];
            const value = wheelPoint(event.clientX, event.clientY, card.wheel.getBoundingClientRect(), card.ranges.hue, card.ranges.saturation);
            showWheelValue(card, Math.round(value.hue * 10) / 10, Math.round(value.saturation * 10) / 10, card.ranges.hue, card.ranges.saturation, false);
        }

        function commitWheelFields(region) {
            const card = state.regionControls[region];
            if (!card.available || !card.ranges) return false;
            let hue = normalizeNumber(card.hue.value);
            let saturation = normalizeNumber(card.saturation.value);
            if (hue === null || saturation === null) {
                card.hue.setAttribute("aria-invalid", String(hue === null));
                card.saturation.setAttribute("aria-invalid", String(saturation === null));
                card.editingField = null;
                restoreWheelAuthoritative(card);
                return false;
            }
            hue = clamp(hue, card.ranges.hue);
            saturation = clamp(saturation, card.ranges.saturation);
            card.hue.setAttribute("aria-invalid", "false");
            card.saturation.setAttribute("aria-invalid", "false");
            card.editingField = null;
            if (card.value && hue === card.value.hue && saturation === card.value.saturation) return false;
            showWheelValue(card, hue, saturation, card.ranges.hue, card.ranges.saturation, false);
            sendWheel(region, true);
            return true;
        }

        function restoreWheelAuthoritative(card) {
            if (!card.authoritativeValue || !card.ranges) return;
            showWheelValue(card, card.authoritativeValue.hue, card.authoritativeValue.saturation, card.ranges.hue, card.ranges.saturation);
        }

        function cancelWheelFieldEdit(card) {
            card.cancelNextBlur = true;
            card.editingField = null;
            restoreWheelAuthoritative(card);
        }

        function sendScalar(control, value, final) {
            if (!control.available || !control.runtimeRange) return;
            const normalized = scalarInputValue(control, value);
            if (normalized === control.value && !final) return;
            retireScalarReset(control.control);
            markPending(control.control);
            showScalarValue(control, normalized, control.runtimeRange, false);
            if (final) control.dispatcher.finalize(normalized);
            else control.dispatcher.schedule(normalized);
        }

        function scalarInputValue(control, value) {
            return clamp(control.control === "blending" ? Math.round(value) : value, control.runtimeRange);
        }

        function updateScalarStepButtons(control) {
            if (!control.minus || !control.plus) return;
            const ready = control.available && control.runtimeRange && Number.isFinite(control.value);
            control.minus.disabled = !ready || control.value <= control.runtimeRange.min;
            control.plus.disabled = !ready || control.value >= control.runtimeRange.max;
        }

        function makeButton(label, className) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            if (className) button.className = className;
            return button;
        }

        function makeWheelScalarRow(regionLabel, property, className) {
            const row = document.createElement("div");
            row.className = "cg-scalar-row cg-wheel-scalar-row";
            const label = document.createElement("label");
            label.textContent = property === "hue" ? "Hue" : "Saturation";
            const range = document.createElement("input");
            range.type = "range";
            range.setAttribute("aria-label", regionLabel + " " + label.textContent);
            const number = document.createElement("input");
            number.type = "text";
            number.inputMode = "decimal";
            number.className = className;
            number.setAttribute("aria-label", regionLabel + " " + label.textContent + " numeric value");
            const rangeText = document.createElement("span");
            rangeText.className = "cg-range-text";
            row.append(label, range, number, rangeText);
            return { row: row, range: range, number: number, rangeText: rangeText };
        }

        function createScalar(controlName, label, stateHost, regionGuard) {
            const row = document.createElement("div");
            row.className = "cg-scalar-row";
            const name = document.createElement("label");
            name.textContent = label;
            const range = document.createElement("input");
            range.type = "range";
            range.setAttribute("aria-label", label);
            const number = document.createElement("input");
            number.type = "text";
            number.inputMode = "decimal";
            number.setAttribute("aria-label", label + " numeric value");
            const rangeText = document.createElement("span");
            rangeText.className = "cg-range-text";
            const resetLabel = controlName === "blending" || controlName === "balance" ? "Reset" : "Reset " + label;
            const reset = makeButton(resetLabel, "cg-reset");
            if (controlName === "blending" || controlName === "balance") reset.setAttribute("aria-label", "Reset " + label);
            const resetGuard = regionGuard || resetInteractionGuard("scalar:" + controlName);
            const control = { control: controlName, row: row, range: range, number: number, rangeText: rangeText, reset: reset, resetLabel: resetLabel, resetGuard: resetGuard, state: stateHost || null, value: null, authoritativeValue: null, runtimeRange: null, dispatcher: null, editing: false, cancelNextBlur: false };
            if (controlName === "blending" || controlName === "balance") {
                if (controlName === "blending") number.inputMode = "numeric";
                const actions = document.createElement("div");
                actions.className = "cg-scalar-actions";
                function step(delta) {
                    if (!control.available || !control.runtimeRange || !Number.isFinite(control.value)) return;
                    const current = controlName === "blending" ? Math.round(control.value) : control.value;
                    sendScalar(control, current + delta, true);
                }
                control.minus = makeButton("−", "cg-scalar-step");
                control.plus = makeButton("+", "cg-scalar-step");
                control.minus.setAttribute("aria-label", "Decrease " + label + " by 1");
                control.plus.setAttribute("aria-label", "Increase " + label + " by 1");
                control.minus.addEventListener("click", function () { if (!control.minus.disabled) step(-1); });
                control.plus.addEventListener("click", function () { if (!control.plus.disabled) step(1); });
                bindResetInteraction(control.minus, resetGuard, false);
                bindResetInteraction(control.plus, resetGuard, false);
                actions.append(control.minus, control.plus, reset);
                row.append(name, range, number, rangeText, actions);
            } else row.append(name, range, number, rangeText, reset);
            control.dispatcher = createScalarDispatcher({
                delay: COMMAND_THROTTLE_MS,
                setTimeout: window.setTimeout.bind(window),
                clearTimeout: window.clearTimeout.bind(window),
                send: function (value) {
                    sendScalarCommand(control.control, commandPath("color_grading.value.set", { control: control.control, value: value }));
                }
            });
            range.addEventListener("input", function () { sendScalar(control, Number(range.value), false); });
            range.addEventListener("pointerup", function () { sendScalar(control, Number(range.value), true); });
            range.addEventListener("change", function () { sendScalar(control, Number(range.value), true); });
            function commitNumber() {
                let value = normalizeNumber(number.value);
                if (value === null || !control.runtimeRange) {
                    number.setAttribute("aria-invalid", "true");
                    control.editing = false;
                    if (control.authoritativeValue !== null) showScalarValue(control, control.authoritativeValue, control.runtimeRange, false);
                    return false;
                }
                value = scalarInputValue(control, value);
                number.setAttribute("aria-invalid", "false");
                control.editing = false;
                if (value === control.value) return false;
                sendScalar(control, value, true);
                return true;
            }
            number.addEventListener("focus", function () { control.editing = true; control.cancelNextBlur = false; });
            number.addEventListener("change", function () { if (control.editing) commitNumber(); });
            number.addEventListener("blur", function () {
                if (control.cancelNextBlur) { control.cancelNextBlur = false; return; }
                if (control.editing) commitNumber();
            });
            number.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    commitNumber();
                    number.blur();
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    control.cancelNextBlur = true;
                    control.editing = false;
                    if (control.authoritativeValue !== null && control.runtimeRange) showScalarValue(control, control.authoritativeValue, control.runtimeRange, false);
                    number.blur();
                }
            });
            reset.addEventListener("click", function () {
                if (!control.available || reset.disabled) return;
                // Another tap on the same owned Reset must not replace its SDK
                // confirmation cycle or enqueue another native Reset. A genuine
                // new adjustment retires this intent through retireScalarReset.
                if (scalarResetPending(control)) return;
                control.editing = false;
                control.dispatcher.resetContext();
                retireScalarReset(controlName);
                markPending(controlName);
                const revision = state.localRevision[controlName];
                const intent = { revision: revision, generation: state.pollingGeneration, contextKey: state.contextKey };
                state.scalarResetIntents[controlName] = intent;
                updateScalarResetAppearance(control);
                sendScalarCommand(controlName, commandPath("color_grading.value.reset", { control: controlName }), function () {
                    if (revision !== state.localRevision[controlName]) return;
                    const parameter = state.metadata.scalarControls[controlName].parameter;
                    const expected = {}; expected[parameter] = RESET_DEFAULTS[controlName];
                    const label = controlName.indexOf("luminance") >= 0 ? "Resetting Luminance…" : "Resetting " + state.metadata.scalarControls[controlName].label + "…";
                    beginResetConfirmation(controlName, controlName.indexOf("luminance") >= 0 ? "luminance" : "scalar", expected, [controlName], label);
                }).then(function (accepted) {
                    if (accepted !== true && state.scalarResetIntents[controlName] === intent) {
                        delete state.scalarResetIntents[controlName];
                        updateScalarResetAppearance(control);
                    }
                });
            });
            bindResetInteraction(range, resetGuard, false);
            bindResetInteraction(number, resetGuard, true);
            state.controls[controlName] = control;
            setControlPending(control);
            return control;
        }

        function createRegionCard(region, definition) {
            const cardRoot = document.createElement("section");
            cardRoot.className = "cg-region-card";
            cardRoot.dataset.region = region;
            const heading = document.createElement("h3");
            heading.textContent = definition.label;
            const stateText = document.createElement("span");
            stateText.className = "cg-availability";
            stateText.setAttribute("aria-live", "polite");
            const wheel = document.createElement("div");
            wheel.className = "cg-wheel";
            wheel.tabIndex = 0;
            wheel.setAttribute("role", "slider");
            wheel.setAttribute("aria-label", definition.label + " Hue and Saturation wheel");
            const pointer = document.createElement("span");
            pointer.className = "cg-wheel-pointer";
            wheel.appendChild(pointer);
            const hue = makeWheelScalarRow(definition.label, "hue", "cg-hue-input");
            const saturation = makeWheelScalarRow(definition.label, "saturation", "cg-saturation-input");
            const luminanceControls = { shadows: "shadow_luminance", midtones: "midtone_luminance", highlights: "highlight_luminance", global: "global_luminance" };
            const resetGuard = resetInteractionGuard("region:" + region);
            const luminance = createScalar(luminanceControls[region], "Luminance", stateText, resetGuard);
            const resetRegion = makeButton("Reset Region", "cg-reset-region");
            const confirmation = document.createElement("div");
            confirmation.className = "cg-inline-confirm";
            confirmation.hidden = true;
            const prompt = document.createElement("span");
            prompt.textContent = "Reset " + definition.label + " Hue, Saturation, and Luminance?";
            const confirm = makeButton("Reset", "command-danger");
            const cancel = makeButton("Cancel", "command-neutral");
            confirmation.append(prompt, confirm, cancel);
            cardRoot.append(heading, stateText, wheel, hue.row, saturation.row, luminance.row, resetRegion, confirmation);
            const card = { region: region, root: cardRoot, wheel: wheel, pointer: pointer, hueRange: hue.range, hue: hue.number, hueRangeText: hue.rangeText, saturationRange: saturation.range, saturation: saturation.number, saturationRangeText: saturation.rangeText, luminance: luminance, resetRegion: resetRegion, confirmReset: confirm, resetGuard: resetGuard, state: stateText, value: null, authoritativeValue: null, ranges: null, available: false, editingField: null, cancelNextBlur: false };
            [wheel, card.hueRange, card.saturationRange].forEach(function (input) { bindResetInteraction(input, resetGuard, false); });
            [card.hue, card.saturation].forEach(function (input) { bindResetInteraction(input, resetGuard, true); });
            state.wheelDispatchers[region] = createWheelPairDispatcher({
                delay: COMMAND_THROTTLE_MS,
                setTimeout: window.setTimeout.bind(window),
                clearTimeout: window.clearTimeout.bind(window),
                send: function (pair) {
                    const path = commandPath("color_grading.wheel.set", { region: region, hue: pair.hue, saturation: pair.saturation });
                    if (state.regionResetAdmissions[region]) sendScalarCommand(card.luminance.control, path, null, [region]);
                    else send(path);
                }
            });
            [
                { property: "hue", range: card.hueRange },
                { property: "saturation", range: card.saturationRange }
            ].forEach(function (editor) {
                editor.range.addEventListener("input", function () { updateWheelFromRange(region, editor.property, false); });
                editor.range.addEventListener("pointerup", function () { updateWheelFromRange(region, editor.property, true); });
                editor.range.addEventListener("change", function () { updateWheelFromRange(region, editor.property, true); });
            });
            wheel.addEventListener("pointerdown", function (event) {
                if (!card.available) return;
                event.preventDefault();
                wheel.setPointerCapture(event.pointerId);
                state.draggingRegion = region;
                updateWheelFromPointer(region, event);
                sendWheel(region, false);
            });
            wheel.addEventListener("pointermove", function (event) {
                if (state.draggingRegion !== region) return;
                event.preventDefault();
                updateWheelFromPointer(region, event);
                sendWheel(region, false);
            });
            function terminatePointer(kind, event) {
                event.preventDefault();
                finishWheelPointer(kind, { get current() { return state.draggingRegion; }, set current(value) { state.draggingRegion = value; } }, region, event, {
                    update: function (finalEvent) { updateWheelFromPointer(region, finalEvent); },
                    release: function (finalEvent) {
                        if (wheel.hasPointerCapture && wheel.hasPointerCapture(finalEvent.pointerId)) wheel.releasePointerCapture(finalEvent.pointerId);
                    },
                    finalize: function () { sendWheel(region, true); },
                    cancel: function () {
                        state.wheelDispatchers[region].cancel();
                        delete state.pendingSince[region];
                    }
                });
            }
            wheel.addEventListener("pointerup", function (event) { terminatePointer("pointerup", event); });
            wheel.addEventListener("pointercancel", function (event) { terminatePointer("pointercancel", event); });
            wheel.addEventListener("lostpointercapture", function (event) { terminatePointer("lostpointercapture", event); });
            wheel.addEventListener("keydown", function (event) {
                if (!card.available || !card.value) return;
                let hueValue = card.value.hue;
                let saturationValue = card.value.saturation;
                if (event.key === "ArrowLeft") hueValue -= 1;
                else if (event.key === "ArrowRight") hueValue += 1;
                else if (event.key === "ArrowDown") saturationValue -= 1;
                else if (event.key === "ArrowUp") saturationValue += 1;
                else return;
                event.preventDefault();
                showWheelValue(card, clamp(hueValue, card.ranges.hue), clamp(saturationValue, card.ranges.saturation), card.ranges.hue, card.ranges.saturation, false);
                sendWheel(region, true);
            });
            [card.hue, card.saturation].forEach(function (input) {
                input.addEventListener("focus", function () { card.editingField = input; card.cancelNextBlur = false; });
                input.addEventListener("change", function () { if (card.editingField) commitWheelFields(region); });
                input.addEventListener("blur", function () {
                    if (card.cancelNextBlur) { card.cancelNextBlur = false; return; }
                    if (card.editingField) commitWheelFields(region);
                });
                input.addEventListener("keydown", function (event) {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        commitWheelFields(region);
                        input.blur();
                    } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelWheelFieldEdit(card);
                        input.blur();
                    }
                });
            });
            resetRegion.addEventListener("click", function () { if (!resetRegion.disabled) { confirmation.hidden = false; confirm.focus(); } });
            cancel.addEventListener("click", function () { confirmation.hidden = true; resetRegion.focus(); });
            confirm.addEventListener("click", function () {
                if (confirm.disabled) return;
                confirmation.hidden = true;
                card.editingField = null;
                state.wheelDispatchers[region].cancel();
                card.luminance.dispatcher.resetContext();
                retireScalarReset(region);
                retireScalarReset(card.luminance.control);
                markPending(region);
                markPending(card.luminance.control);
                const regionRevision = state.localRevision[region], luminanceRevision = state.localRevision[card.luminance.control];
                const admission = sendScalarCommand(card.luminance.control, commandPath("color_grading.region.reset", { region: region }), function () {
                    if (regionRevision !== state.localRevision[region] || luminanceRevision !== state.localRevision[card.luminance.control]) {
                        if (regionRevision === state.localRevision[region]) delete state.pendingSince[region];
                        if (luminanceRevision === state.localRevision[card.luminance.control]) delete state.pendingSince[card.luminance.control];
                        requestSnapshot(true);
                        return;
                    }
                    const expected = {};
                    expected[definition.hue] = 0;
                    expected[definition.saturation] = 0;
                    expected[definition.luminance] = 0;
                    beginResetConfirmation(region, "region", expected, [region, card.luminance.control], "Resetting Region…");
                }, [region, card.luminance.control]);
                state.regionResetAdmissions[region] = admission;
                admission.then(function () { if (state.regionResetAdmissions[region] === admission) delete state.regionResetAdmissions[region]; });
            });
            state.regionControls[region] = card;
            updateWheelAvailability(card, null, null);
            return cardRoot;
        }

        function renderWorkspace() {
            resetSentValueState();
            cancelResetInteractionGuards();
            state.resetInteractionGuards = Object.create(null);
            state.controls = Object.create(null);
            state.regionControls = Object.create(null);
            elements.viewButtons.length = 0;
            elements.cgContent.innerHTML = "";
            const views = document.createElement("section");
            views.className = "cg-view-selector";
            const viewTitle = document.createElement("h2");
            viewTitle.textContent = "Lightroom panel view";
            const buttons = document.createElement("div");
            buttons.className = "cg-view-buttons";
            const labels = { "3-way": "3-Way", shadow: "Shadows", midtone: "Midtones", highlight: "Highlights", global: "Global" };
            state.metadata.views.forEach(function (view) {
                const button = makeButton(labels[view] || view, "cg-view-button");
                button.dataset.view = view;
                button.setAttribute("aria-pressed", "false");
                button.disabled = true;
                button.addEventListener("click", function () {
                    send(commandPath("color_grading.view.set", { view: view }));
                });
                buttons.appendChild(button);
                elements.viewButtons.push(button);
            });
            views.append(viewTitle, buttons);
            const grid = document.createElement("div");
            grid.className = "cg-region-grid";
            Object.keys(state.metadata.regions).forEach(function (region) { grid.appendChild(createRegionCard(region, state.metadata.regions[region])); });
            const scalarSection = document.createElement("section");
            scalarSection.className = "cg-scalar-section";
            const scalarTitle = document.createElement("h2");
            scalarTitle.textContent = "Blending and Balance";
            scalarSection.append(scalarTitle, createScalar("blending", state.metadata.scalarControls.blending.label).row, createScalar("balance", state.metadata.scalarControls.balance.label).row);
            elements.cgContent.append(views, grid, scalarSection);
        }

        async function loadMetadata() {
            const response = await fetchFn("/api/color-grading/metadata", { cache: "no-store" });
            const body = await response.json();
            if (!response.ok || !body.colorGrading) throw new Error("Color Grading metadata request failed");
            state.metadata = body.colorGrading;
            renderWorkspace();
        }

        function initialize() {
            loadMetadata().then(function () {
                if (state.visible) scheduleSnapshot(0, true);
            }).catch(function () { status("Metadata unavailable", "warning"); });
        }

        return { state: state, initialize: initialize, activate: activate, deactivate: deactivate, applySnapshot: applySnapshot, requestSnapshot: requestSnapshot };
    }

    return { ACTIVE_INTERVAL_MS: ACTIVE_INTERVAL_MS, COMMAND_THROTTLE_MS: COMMAND_THROTTLE_MS, RESET_DEFAULTS: RESET_DEFAULTS, RESET_INTERACTION_DELAY_MS: RESET_INTERACTION_DELAY_MS, createResetInteractionGuard: createResetInteractionGuard, normalizeNumber: normalizeNumber, clamp: clamp, updateWheelPair: updateWheelPair, createWheelPairDispatcher: createWheelPairDispatcher, resetSnapshotMatches: resetSnapshotMatches, createResetConfirmation: createResetConfirmation, updateStatusElement: updateStatusElement, wheelPoint: wheelPoint, commandPath: commandPath, createScalarDispatcher: createScalarDispatcher, createCycleGate: createCycleGate, finishWheelPointer: finishWheelPointer, createController: createController };
}));
