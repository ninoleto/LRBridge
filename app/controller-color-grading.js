(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.LRBridgeColorGrading = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const ACTIVE_INTERVAL_MS = 400;
    const COMMAND_THROTTLE_MS = 125;
    const SNAPSHOT_TIMEOUT_MS = 4000;

    function normalizeNumber(value) {
        const text = String(value).replace(",", ".").trim();
        if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return null;
        const number = Number(text);
        return Number.isFinite(number) ? number : null;
    }

    function clamp(value, range) {
        return Math.min(range.max, Math.max(range.min, value));
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
            pendingSince: Object.create(null),
            snapshotRequestedAt: 0,
            throttle: Object.create(null)
        };
        const cycleGate = createCycleGate(function () { return new window.AbortController(); });

        function resetSentValueState() {
            Object.keys(state.controls).forEach(function (key) {
                const control = state.controls[key];
                if (control.dispatcher) control.dispatcher.resetContext();
            });
        }

        function activate() {
            state.visible = true;
            if (state.metadata) scheduleSnapshot(0, true);
        }

        function deactivate() {
            state.visible = false;
            stopPolling();
        }

        function status(text, kind) {
            elements.cgStatus.textContent = text;
            elements.cgStatus.dataset.state = kind || "connected";
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
            state.parameters = Object.create(null);
            state.activeView = null;
            resetSentValueState();
            Object.keys(state.controls).forEach(function (key) { setControlPending(state.controls[key]); });
            status(message || "Feedback pending", "pending");
        }

        async function requestSnapshot(force) {
            if (!state.visible || state.requestInFlight) return;
            state.requestInFlight = true;
            const sequence = ++state.requestSequence;
            const cycle = cycleGate.begin();
            const signal = cycle.controller.signal;
            status(force ? "Feedback pending" : "Connected · refreshing", "pending");
            try {
                const requestResponse = await fetchFn("/api/color-grading/request", { cache: "no-store", signal: signal });
                const requestBody = await requestResponse.json();
                const requestId = requestBody && requestBody.request && requestBody.request.id;
                if (!requestResponse.ok || requestId === undefined) throw new Error("Color Grading feedback request failed");
                if (!cycleGate.isCurrent(cycle) || signal.aborted || sequence !== state.requestSequence) return;
                state.activeRequestId = requestId;
                const started = Date.now();
                while (state.visible && sequence === state.requestSequence && Date.now() - started < SNAPSHOT_TIMEOUT_MS) {
                    const response = await fetchFn("/api/color-grading/snapshot?id=" + encodeURIComponent(requestId), { cache: "no-store", signal: signal });
                    const body = await response.json();
                    if (!response.ok || !body.snapshot) throw new Error("Color Grading snapshot failed");
                    if (!cycleGate.isCurrent(cycle) || requestId !== state.activeRequestId || sequence !== state.requestSequence) return;
                    if (body.snapshot.complete === true) {
                        applySnapshot(body.snapshot, requestId);
                        return;
                    }
                    await new Promise(function (resolve) { window.setTimeout(resolve, 50); });
                }
                if (sequence === state.requestSequence) status("Waiting for Lightroom", "warning");
            } catch (err) {
                if (!signal.aborted && cycleGate.isCurrent(cycle) && sequence === state.requestSequence) status("Waiting for Lightroom", "warning");
            } finally {
                if (cycleGate.isCurrent(cycle) && sequence === state.requestSequence) {
                    cycleGate.retire(cycle);
                    state.requestInFlight = false;
                    state.activeRequestId = null;
                    scheduleSnapshot(ACTIVE_INTERVAL_MS, false);
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
            const nextContextKey = [context.contextCounter, context.selectedPhotoKey, context.developCounter].join("|");
            if (state.contextKey !== null && state.contextKey !== nextContextKey) invalidateFeedback("Feedback pending");
            state.contextKey = nextContextKey;
            state.snapshotRequestedAt = snapshot.requestedAt || 0;
            state.parameters = snapshot.parameters || Object.create(null);
            state.activeView = snapshot.view && snapshot.view.available === true ? snapshot.view.value : null;
            renderAuthoritativeState();
            status(contextMessage(context), contextMessage(context) === "Connected" ? "connected" : "warning");
            return true;
        }

        function setControlPending(control) {
            if (!control) return;
            control.available = false;
            [control.range, control.number, control.reset].filter(Boolean).forEach(function (element) { element.disabled = true; });
            if (control.state) control.state.textContent = "Feedback pending";
        }

        function parameterResult(parameter) {
            return state.parameters[parameter] || null;
        }

        function isLocallyActive(key) {
            const pendingAt = state.pendingSince[key];
            return state.draggingRegion === key || Boolean(pendingAt && (state.snapshotRequestedAt <= pendingAt || Date.now() - pendingAt < 900));
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
                if (hue && saturation && hue.available && saturation.available && !isLocallyActive(region)) {
                    showWheelValue(card, hue.value, saturation.value, hue.range, saturation.range);
                }
                if (luminance && luminance.available && !isLocallyActive(card.luminance.control)) {
                    showScalarValue(card.luminance, luminance.value, luminance.range);
                }
            });
            ["blending", "balance"].forEach(function (controlName) {
                const control = state.controls[controlName];
                const result = parameterResult(state.metadata.scalarControls[controlName].parameter);
                updateScalarAvailability(control, result);
                if (result && result.available && !isLocallyActive(controlName)) showScalarValue(control, result.value, result.range);
            });
        }

        function updateWheelAvailability(card, hue, saturation) {
            const ready = hue && saturation && hue.available === true && saturation.available === true;
            const pending = !hue || !saturation;
            card.available = ready;
            [card.wheel, card.hue, card.saturation, card.resetRegion].forEach(function (element) { element.disabled = !ready; });
            card.state.textContent = ready ? "Available" : pending ? "Feedback pending" : "Parameter unavailable";
            card.root.classList.toggle("unavailable", !ready);
        }

        function updateScalarAvailability(control, result) {
            const ready = result && result.available === true;
            const pending = !result;
            control.available = ready;
            [control.range, control.number, control.reset].forEach(function (element) { element.disabled = !ready; });
            if (control.state) control.state.textContent = ready ? "Available" : pending ? "Feedback pending" : "Parameter unavailable";
        }

        function showWheelValue(card, hue, saturation, hueRange, saturationRange) {
            card.value = { hue: hue, saturation: saturation };
            card.ranges = { hue: hueRange, saturation: saturationRange };
            card.hue.value = formatNumber(hue);
            card.saturation.value = formatNumber(saturation);
            const hueFraction = (hue - hueRange.min) / (hueRange.max - hueRange.min);
            const angle = Math.PI / 2 - hueFraction * Math.PI * 2;
            const radial = (saturation - saturationRange.min) / (saturationRange.max - saturationRange.min) * 50;
            card.pointer.style.left = (50 + Math.sin(angle) * radial) + "%";
            card.pointer.style.top = (50 - Math.cos(angle) * radial) + "%";
            card.wheel.setAttribute("aria-valuetext", "Hue " + formatNumber(hue) + ", Saturation " + formatNumber(saturation));
            card.rangeText.textContent = "H " + formatNumber(hueRange.min) + "–" + formatNumber(hueRange.max) + " · S " + formatNumber(saturationRange.min) + "–" + formatNumber(saturationRange.max);
        }

        function showScalarValue(control, value, range, rebaseSentValue) {
            control.value = value;
            control.runtimeRange = range;
            control.range.min = range.min;
            control.range.max = range.max;
            control.range.step = range.max - range.min > 100 ? "1" : "0.1";
            control.range.value = value;
            control.number.min = range.min;
            control.number.max = range.max;
            control.number.value = formatNumber(value);
            control.rangeText.textContent = formatNumber(range.min) + "–" + formatNumber(range.max);
            if (rebaseSentValue !== false && control.dispatcher && !isLocallyActive(control.control)) control.dispatcher.rebase(value);
        }

        function formatNumber(value) {
            return String(Math.round(Number(value) * 100) / 100);
        }

        async function send(path) {
            const response = await fetchFn(path, { cache: "no-store" });
            if (!response.ok) {
                setGlobalStatus("ERROR: Color Grading command failed.");
                return false;
            }
            setGlobalStatus("OK: Color Grading command accepted");
            scheduleSnapshot(160, true);
            return true;
        }

        function markPending(key) {
            state.localRevision[key] = (state.localRevision[key] || 0) + 1;
            state.pendingSince[key] = Date.now();
        }

        function sendWheel(region, final) {
            const card = state.regionControls[region];
            if (!card.available || !card.value) return;
            const path = commandPath("color_grading.wheel.set", { region: region, hue: card.value.hue, saturation: card.value.saturation });
            markPending(region);
            if (final) {
                if (state.throttle[region]) window.clearTimeout(state.throttle[region]);
                state.throttle[region] = null;
                send(path);
                return;
            }
            if (state.throttle[region]) return;
            state.throttle[region] = window.setTimeout(function () {
                state.throttle[region] = null;
                send(commandPath("color_grading.wheel.set", { region: region, hue: card.value.hue, saturation: card.value.saturation }));
            }, COMMAND_THROTTLE_MS);
        }

        function updateWheelFromPointer(region, event) {
            const card = state.regionControls[region];
            const value = wheelPoint(event.clientX, event.clientY, card.wheel.getBoundingClientRect(), card.ranges.hue, card.ranges.saturation);
            showWheelValue(card, Math.round(value.hue * 10) / 10, Math.round(value.saturation * 10) / 10, card.ranges.hue, card.ranges.saturation);
        }

        function commitWheelFields(region) {
            const card = state.regionControls[region];
            if (!card.available || !card.ranges) return false;
            const hue = normalizeNumber(card.hue.value);
            const saturation = normalizeNumber(card.saturation.value);
            if (hue === null || saturation === null || hue < card.ranges.hue.min || hue > card.ranges.hue.max || saturation < card.ranges.saturation.min || saturation > card.ranges.saturation.max) {
                card.hue.setAttribute("aria-invalid", String(hue === null));
                card.saturation.setAttribute("aria-invalid", String(saturation === null));
                return false;
            }
            if (card.value && hue === card.value.hue && saturation === card.value.saturation) return false;
            showWheelValue(card, hue, saturation, card.ranges.hue, card.ranges.saturation);
            sendWheel(region, true);
            return true;
        }

        function sendScalar(control, value, final) {
            if (!control.available || !control.runtimeRange) return;
            const normalized = clamp(value, control.runtimeRange);
            if (normalized === control.value && !final) return;
            showScalarValue(control, normalized, control.runtimeRange, false);
            if (final) control.dispatcher.finalize(normalized);
            else control.dispatcher.schedule(normalized);
        }

        function makeButton(label, className) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            if (className) button.className = className;
            return button;
        }

        function makeNumber(label, className) {
            const wrapper = document.createElement("label");
            wrapper.className = "cg-number-label";
            const text = document.createElement("span");
            text.textContent = label;
            const input = document.createElement("input");
            input.type = "text";
            input.inputMode = "decimal";
            input.className = className;
            wrapper.append(text, input);
            return { wrapper: wrapper, input: input };
        }

        function createScalar(controlName, label, stateHost) {
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
            const reset = makeButton("Reset " + label, "cg-reset");
            row.append(name, range, number, rangeText, reset);
            const control = { control: controlName, row: row, range: range, number: number, rangeText: rangeText, reset: reset, state: stateHost || null, value: null, runtimeRange: null, dispatcher: null };
            control.dispatcher = createScalarDispatcher({
                delay: COMMAND_THROTTLE_MS,
                setTimeout: window.setTimeout.bind(window),
                clearTimeout: window.clearTimeout.bind(window),
                send: function (value) {
                    markPending(control.control);
                    send(commandPath("color_grading.value.set", { control: control.control, value: value }));
                }
            });
            range.addEventListener("input", function () { sendScalar(control, Number(range.value), false); });
            range.addEventListener("pointerup", function () { sendScalar(control, Number(range.value), true); });
            range.addEventListener("change", function () { sendScalar(control, Number(range.value), true); });
            function commitNumber() {
                const value = normalizeNumber(number.value);
                if (value === null || !control.runtimeRange || value < control.runtimeRange.min || value > control.runtimeRange.max || value === control.value) {
                    number.setAttribute("aria-invalid", String(value === null || !control.runtimeRange || value < control.runtimeRange.min || value > control.runtimeRange.max));
                    return;
                }
                number.setAttribute("aria-invalid", "false");
                sendScalar(control, value, true);
            }
            number.addEventListener("blur", commitNumber);
            number.addEventListener("keydown", function (event) { if (event.key === "Enter") commitNumber(); });
            reset.addEventListener("click", function () {
                markPending(controlName);
                send(commandPath("color_grading.value.reset", { control: controlName }));
            });
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
            const fields = document.createElement("div");
            fields.className = "cg-wheel-fields";
            const hue = makeNumber("Hue", "cg-hue-input");
            const saturation = makeNumber("Saturation", "cg-saturation-input");
            const rangeText = document.createElement("span");
            rangeText.className = "cg-range-text";
            fields.append(hue.wrapper, saturation.wrapper, rangeText);
            const luminanceControls = { shadows: "shadow_luminance", midtones: "midtone_luminance", highlights: "highlight_luminance", global: "global_luminance" };
            const luminance = createScalar(luminanceControls[region], "Luminance", stateText);
            const resetRegion = makeButton("Reset Region", "cg-reset-region");
            const confirmation = document.createElement("div");
            confirmation.className = "cg-inline-confirm";
            confirmation.hidden = true;
            const prompt = document.createElement("span");
            prompt.textContent = "Reset " + definition.label + " Hue, Saturation, and Luminance?";
            const confirm = makeButton("Reset", "command-danger");
            const cancel = makeButton("Cancel", "command-neutral");
            confirmation.append(prompt, confirm, cancel);
            cardRoot.append(heading, stateText, wheel, fields, luminance.row, resetRegion, confirmation);
            const card = { root: cardRoot, wheel: wheel, pointer: pointer, hue: hue.input, saturation: saturation.input, rangeText: rangeText, luminance: luminance, resetRegion: resetRegion, state: stateText, value: null, ranges: null, available: false };
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
                        if (state.throttle[region]) window.clearTimeout(state.throttle[region]);
                        state.throttle[region] = null;
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
                showWheelValue(card, clamp(hueValue, card.ranges.hue), clamp(saturationValue, card.ranges.saturation), card.ranges.hue, card.ranges.saturation);
                sendWheel(region, true);
            });
            [card.hue, card.saturation].forEach(function (input) {
                input.addEventListener("blur", function () { commitWheelFields(region); });
                input.addEventListener("keydown", function (event) { if (event.key === "Enter") commitWheelFields(region); });
            });
            resetRegion.addEventListener("click", function () { confirmation.hidden = false; confirm.focus(); });
            cancel.addEventListener("click", function () { confirmation.hidden = true; resetRegion.focus(); });
            confirm.addEventListener("click", function () {
                confirmation.hidden = true;
                markPending(region);
                send(commandPath("color_grading.region.reset", { region: region }));
            });
            state.regionControls[region] = card;
            updateWheelAvailability(card, null, null);
            return cardRoot;
        }

        function renderWorkspace() {
            resetSentValueState();
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

    return { ACTIVE_INTERVAL_MS: ACTIVE_INTERVAL_MS, COMMAND_THROTTLE_MS: COMMAND_THROTTLE_MS, normalizeNumber: normalizeNumber, clamp: clamp, wheelPoint: wheelPoint, commandPath: commandPath, createScalarDispatcher: createScalarDispatcher, createCycleGate: createCycleGate, finishWheelPointer: finishWheelPointer, createController: createController };
}));
