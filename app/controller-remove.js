(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LRBridgeControllerRemove = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const modes = { heal_patchmatch: "Remove", heal: "Heal", clone: "Clone" };
    const fills = { remove: "Remove", heal: "Heal", clone: "Clone", generative_remove: "Generative Remove" };
    const repairParameter = field => field === "selectedRepairOpacity" || field === "selectedRepairFeather";
    const repairField = field => field === "selectedRepair" || field === "selectedRepairFill" || repairParameter(field);
    // LRBridge product defaults, not Lightroom factory defaults. The SDK has no brush-preference reset API.
    const defaults = Object.freeze({ brushSize: 25, brushFeather: 50, visualizationThreshold: 50 });
    const sliders = { brushSize: { label: "Size", min: 1 }, brushFeather: { label: "Feather", min: 0 },
        visualizationThreshold: { label: "Threshold", min: 0 }, selectedRepairOpacity: { label: "Opacity", min: 0, scale: 100 },
        selectedRepairFeather: { label: "Feather", min: 0, scale: 100 } };
    const contextKey = c => c && JSON.stringify([c.activeModule, c.selectedPhotoUuid, c.contextCounter, c.developCounter, c.contextChangedAt]);
    const baseKey = s => s && contextKey(s) + ":" + s.serverEpoch;
    const targetKey = s => s && baseKey(s) + ":" + s.newSpotType;
    const equal = (a, b) => typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 0.000001 : a === b;
    const whole = (value, minimum) => Math.max(minimum, Math.min(100, Math.round(value)));
    function valid(field, value) {
        if (field === "selectedRepairFill") return Object.hasOwn(fills, value);
        if (sliders[field]) return typeof value === "number" && Number.isFinite(value) && value >= sliders[field].min && value <= 100 / (sliders[field].scale || 1);
        if (field === "newSpotType") return Object.hasOwn(modes, value);
        if (field === "toolOverlay") return ["always", "auto", "selected", "never"].includes(value);
        return ["useGenerativeAI", "detectObjects", "visualizeSpots"].includes(field) && typeof value === "boolean";
    }
    function createController(options) {
        const doc = options.document, controls = {}, tabs = {}, intents = new Map();
        let state = null, section = null, status = null, modeControls = null, removeOptions = null, panelButton = null;
        let operation = null, transport = null, generation = 0, sequence = 0, receivedAt = 0;
        let polling = false, pollTimer = null, sendTimer = null, error = "";
        let repairSelection = null, repairStatus = null, repairButtons = {}, repairFeedback = "";
        const notify = () => { if (options.onInteractionChange) options.onInteractionChange(); };
        const localValue = field => intents.has(field) ? intents.get(field).value : state && state[field];
        const busy = () => Boolean(operation || transport || intents.size || state && state.pendingOperation ||
            Object.values(controls).some(c => c.dragging || c.editing));
        function available() {
            return state && state.available === true && modes[state.newSpotType] && contextKey(state) === contextKey(options.getContext());
        }
        function panelAvailable() {
            return state && contextKey(state) === contextKey(options.getContext()) && state.activeModule === "develop" &&
                state.selectedPhotoUuid && typeof state.selectedTool === "string";
        }
        function fresh() { return panelAvailable() && Number.isFinite(state.ageMs) && state.ageMs + performance.now() - receivedAt < 5000; }
        function supported(field) {
            if (field === "selectedTool") return panelAvailable();
            if (repairField(field)) return panelAvailable() && state.selectedTool === "dust" &&
                state.repair && state.repair.available && state.repair.selected && typeof state.repair.token === "string" &&
                (field === "selectedRepair" || available() && valid(field, state[field]));
            if (!available()) return false;
            if (field === "brushFeather") return state.newSpotType !== "heal_patchmatch";
            if (field === "useGenerativeAI" || field === "detectObjects") return state.newSpotType === "heal_patchmatch";
            if (field === "visualizationThreshold") return state.visualizeSpots === true && localValue("visualizeSpots") === true;
            return true;
        }
        function enabled(field) {
            const own = operation && baseKey(state) === operation.base && performance.now() - operation.startedAt < 10000;
            const foreign = state && state.pendingOperation && (!operation ||
                operation.id && state.pendingOperation.operationId !== operation.id);
            if (field === "selectedTool") return Boolean(panelAvailable() && (fresh() || own) && !foreign &&
                !(options.isBlocked && options.isBlocked()) && !intents.has(field) && !(operation && operation.field === field));
            if (repairField(field) && !repairParameter(field)) return Boolean(supported(field) && fresh() && !busy() &&
                !(options.isBlocked && options.isBlocked()));
            const repairConflict = repairParameter(field) && (operation && repairField(operation.field) && !repairParameter(operation.field) ||
                [...intents.keys()].some(f => repairField(f) && !repairParameter(f)));
            return Boolean(!repairConflict && supported(field) && valid(field, state[field]) && (fresh() || own) && !foreign &&
                !intents.has("selectedTool") && !(operation && operation.field === "selectedTool") &&
                !(options.isBlocked && options.isBlocked()) && (field === "newSpotType" || !intents.has("newSpotType")));
        }
        function setDisabled(element, disabled) {
            element.setAttribute("aria-disabled", String(disabled));
            // Preserve focus when a pending write or native-context change locks an editor.
            element.disabled = disabled && doc.activeElement !== element;
            if (element.type === "text") element.readOnly = disabled;
        }
        function showSlider(c, value) {
            // Presentation only: state and c.confirmed retain the exact native baseline.
            if (typeof value === "number") value = whole(value * c.scale, Number(c.range.min));
            c.displayed = value;
            if (!c.editing) {
                const text = typeof value === "number" ? String(value) : "";
                if (c.number.value !== text) c.number.value = text;
            }
            if (typeof value === "number") {
                if (!equal(Number(c.range.value), value)) c.range.value = String(value);
                c.range.style.setProperty("--slider-progress", (value - Number(c.range.min)) / (100 - Number(c.range.min)) * 100 + "%");
            }
        }
        function render() {
            if (!section) return;
            panelButton.firstChild.textContent = panelAvailable() && state.selectedTool === "dust" ? "Close Healing Tool" : "Open Healing Tool";
            panelButton.setAttribute("aria-label", panelButton.textContent);
            panelButton.setAttribute("aria-busy", String(intents.has("selectedTool") || operation && operation.field === "selectedTool"));
            setDisabled(panelButton, !enabled("selectedTool"));
            const nativeMode = available() ? state.newSpotType : null;
            for (const [mode, button] of Object.entries(tabs)) {
                button.classList.toggle("active", mode === nativeMode);
                button.setAttribute("aria-selected", String(mode === nativeMode));
                button.setAttribute("aria-busy", String(intents.has("newSpotType") && localValue("newSpotType") === mode));
                setDisabled(button, !enabled("newSpotType"));
            }
            controls.brushFeather.row.hidden = nativeMode === "heal_patchmatch";
            removeOptions.hidden = nativeMode !== "heal_patchmatch";
            modeControls.setAttribute("aria-label", (modes[nativeMode] || "Remove") + " brush options");
            const repair = panelAvailable() && state.selectedTool === "dust" && state.repair;
            repairSelection.textContent = repair && repair.available ? repair.selected ?
                (fills[state.selectedRepairFill] || modes[repair.spotType] || "") + " repair selected" : "No repair selected" : "Selected repair unavailable";
            for (const button of Object.values(repairButtons)) setDisabled(button, !enabled("selectedRepair"));
            repairStatus.textContent = operation && repairField(operation.field) || [...intents.keys()].some(repairField) ?
                "Waiting for Lightroom…" : repairFeedback;
            for (const [field, c] of Object.entries(controls)) {
                const canEdit = enabled(field);
                c.row.setAttribute("aria-busy", String(intents.has(field) || operation && operation.field === field));
                c.elements.forEach(element => setDisabled(element, !canEdit));
                if (sliders[field]) {
                    if (!c.dragging && !c.editing) showSlider(c, intents.has(field) ? localValue(field) :
                        available() && valid(field, state[field]) ? state[field] : null);
                } else if (field === "selectedRepairFill" && !localValue(field)) c.input.value = "";
                else if (c.input.type === "checkbox") c.input.checked = localValue(field) === true;
                else if (typeof localValue(field) === "string" && c.input.value !== localValue(field)) c.input.value = localValue(field);
            }
            status.textContent = error || (intents.has("selectedTool") ? "Waiting for Lightroom to " + (localValue("selectedTool") === "dust" ? "open" : "close") + " Remove…" :
                intents.has("newSpotType") ? "Switching to " + modes[localValue("newSpotType")] + "…" :
                operation || transport || intents.size ? "Waiting for Lightroom to confirm…" :
                available() ? "" : panelAvailable() ? state.selectedTool === "dust" ?
                    "Lightroom brush preferences are unavailable." : "Remove is closed in Lightroom." : "Select a photo in Lightroom Develop.");
        }
        function cancelField(field, blockContinuation) {
            const c = controls[field];
            intents.delete(field);
            if (c && sliders[field]) {
                if (blockContinuation && (c.dragging || c.editing)) c.cancelled = true;
                c.dragging = c.editing = false;
                showSlider(c, available() ? state[field] : null);
            }
        }
        function cancelEdits(message) {
            clearTimeout(sendTimer); sendTimer = null;
            for (const field of Object.keys(controls)) cancelField(field, true);
            intents.clear();
            if (message) error = message;
        }
        function invalidate(message) {
            const hadWork = busy();
            cancelEdits(hadWork ? message : "");
            operation = null;
        }
        function resultFor(request, next, requireId) {
            const result = next && next.lastResult;
            return request && result && (!requireId || request.id) &&
                (!request.id || result.operationId === request.id) && result.field === request.field &&
                equal(result.value, request.value) && baseKey(next) === request.base &&
                (!repairField(request.field) || result.targetRepairToken === request.repairToken) ? result : null;
        }
        function reconcile() {
            const result = resultFor(operation, state, true);
            if (!result) return;
            const request = operation;
            const expectedMode = request.field === "newSpotType" ? request.value : request.mode;
            const panel = request.field === "selectedTool";
            if (request.field === "selectedRepair") {
                repairFeedback = result.detail || "Selected repair result received.";
                if (!["confirmed", "requested"].includes(result.outcome)) error = repairFeedback;
                intents.delete("selectedRepair"); operation = null; return;
            }
            if (repairField(request.field)) repairFeedback = result.detail || "Selected repair result received.";
            if (result.outcome !== "confirmed" || !equal(state[request.field], request.value) ||
                repairField(request.field) && result.resultRepairToken !== state.repair?.token ||
                panel && request.value === "dust" && (!available() || state.newSpotType !== "heal_patchmatch") ||
                !panel && (!available() || state.newSpotType !== expectedMode)) {
                // A mode intent may deliberately supersede an obsolete brush write.
                const modeIntent = intents.get("newSpotType");
                const panelIntent = intents.get("selectedTool");
                cancelEdits(result.detail || "Lightroom did not confirm the preference.");
                if (panelIntent && !panel && panelAvailable() && state.selectedTool === "dust") {
                    intents.set("selectedTool", panelIntent); error = "";
                } else if (modeIntent && request.field !== "newSpotType" && available() && state.newSpotType === request.mode) {
                    intents.set("newSpotType", modeIntent); error = "";
                }
            } else {
                const latest = intents.get(request.field);
                if (repairParameter(request.field) && state.repair && state.repair.selected) {
                    // Only the exact SDK-confirmed edit may advance queued intents to its new native identity.
                    for (const [field, intent] of intents) if (repairParameter(field) && intent.repairToken === request.repairToken) intent.repairToken = state.repair.token;
                }
                if (latest && equal(latest.value, request.value)) intents.delete(request.field);
            }
            operation = null;
        }
        function apply(next) {
            if (!next || next.ok !== true || contextKey(next) !== contextKey(options.getContext()) ||
                !Number.isSafeInteger(next.revision) || typeof next.serverEpoch !== "string") return;
            if (state && next.serverEpoch === state.serverEpoch && next.revision < state.revision) { reconcile(); return; }
            const old = state, result = resultFor(operation, next, false);
            const ownRepair = result && repairField(operation.field) &&
                (operation.id || ["confirmed", "requested"].includes(result.outcome)) &&
                (result.outcome !== "confirmed" || operation.field === "selectedRepair" || result.resultRepairToken === next.repair?.token);
            const ownChange = ownRepair || result && result.outcome === "confirmed" && equal(next[operation.field], operation.value);
            const ownMode = ownChange && operation.field === "newSpotType" && baseKey(next) === operation.base;
            const ownPanel = result && operation.field === "selectedTool" && next.selectedTool === operation.value && baseKey(next) === operation.base;
            if (old && (baseKey(old) !== baseKey(next) || !ownPanel &&
                (old.selectedTool !== next.selectedTool || next.available !== true && old.available === true ||
                old.newSpotType !== next.newSpotType && !ownMode))) {
                invalidate("Photo, mode or tool changed; the earlier edit was cancelled.");
            } else if (old && next.available) {
                for (const field of Object.keys(controls)) {
                    const c = controls[field];
                    if (old[field] !== next[field] && (intents.has(field) || c.dragging || c.editing) &&
                        !(ownChange && operation.field === field)) {
                        cancelField(field, true); error = "A Lightroom preference changed; the earlier edit was cancelled.";
                    }
                }
                if (!next.visualizeSpots) cancelField("visualizationThreshold", true);
            }
            if (old && (old.repair && old.repair.token) !== (next.repair && next.repair.token) && !ownRepair) {
                const hadRepairWork = operation && repairField(operation.field) || [...intents.keys()].some(repairField) ||
                    Object.entries(controls).some(([f,c]) => repairField(f) && (c.dragging || c.editing));
                for (const field of Object.keys(controls).filter(repairField)) cancelField(field, true);
                intents.delete("selectedRepair");
                if (operation && repairField(operation.field)) operation = null;
                repairFeedback = hadRepairWork ? "Selected repair changed; the earlier action was cancelled." : "";
            }
            state = next; receivedAt = performance.now();
            for (const [field, c] of Object.entries(controls)) c.confirmed = next.available ? next[field] : null;
            reconcile(); render(); notify(); schedule(0);
        }
        async function json(url) {
            const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 4500);
            try {
                const response = await options.fetch(url, { signal: abort.signal, cache: "no-store" });
                if (!response.ok) throw Error(response.status === 409 ? "Lightroom context changed; the request was not admitted." :
                    "Could not reach Lightroom preferences.");
                return await response.json();
            } catch (failure) {
                if (failure.name === "AbortError") throw Error("Request timed out; Lightroom confirmation is unknown.");
                throw failure;
            } finally { clearTimeout(timeout); }
        }
        function schedule(delay) {
            if (!section || !intents.size) return;
            clearTimeout(sendTimer); sendTimer = setTimeout(() => { sendTimer = null; pump(); }, delay);
        }
        async function pump() {
            if (!section || transport || !panelAvailable() || options.isBlocked && options.isBlocked()) return;
            const panelIntent = intents.get("selectedTool"), modeIntent = intents.get("newSpotType");
            // Mode changes and Close revoke obsolete preference work; value writes await exact SDK settlement.
            const replace = operation && operation.field !== "selectedTool" &&
                (panelIntent || modeIntent && operation.field !== "newSpotType") && operation.id &&
                state.pendingOperation && state.pendingOperation.operationId === operation.id;
            if (operation && !replace || state.pendingOperation && !replace) return;
            if (!fresh() && !replace) return;
            const entry = panelIntent ? ["selectedTool", panelIntent] : modeIntent ? ["newSpotType", modeIntent] : intents.entries().next().value;
            if (!entry) return;
            const [field, intent] = entry;
            if (intent.target !== targetKey(state) && !["newSpotType", "selectedTool"].includes(field) || intent.base !== baseKey(state) || !supported(field)) {
                cancelField(field, true); render(); notify(); schedule(0); return;
            }
            if (repairField(field) && intent.repairToken !== state.repair.token) {
                intents.delete(field); render(); notify(); return;
            }
            if (!replace && equal(state[field], intent.value)) {
                intents.delete(field); render(); notify(); schedule(0); return;
            }
            const request = { id: null, field, value: intent.value, sequence: intent.sequence, base: baseKey(state),
                mode: state.newSpotType || null, repairToken: intent.repairToken, startedAt: performance.now(), generation };
            operation = transport = request;
            const query = new URLSearchParams({ field, value: request.value, mode: request.mode,
                selectedPhotoUuid: state.selectedPhotoUuid, contextCounter: state.contextCounter, developCounter: state.developCounter,
                contextChangedAt: state.contextChangedAt, serverEpoch: state.serverEpoch, stateRevision: state.revision });
            if (repairField(field)) query.set("repairToken", intent.repairToken);
            render(); notify();
            try {
                const admitted = await json("/api/remove/" + (repairField(field) ? "repair" : field === "selectedTool" ? "panel" : "brush") + "?" + query);
                if (request.generation !== generation || operation !== request) return;
                const p = admitted.pendingOperation;
                if (!p || p.field !== field || !equal(p.value, request.value) || baseKey(admitted) !== request.base ||
                    repairField(field) && p.targetRepairToken !== request.repairToken ||
                    (admitted.newSpotType || null) !== request.mode) throw Error("Lightroom did not acknowledge this Remove request.");
                request.id = p.operationId;
                apply(admitted); reconcile();
            } catch (failure) {
                if (request.generation === generation && operation === request) {
                    invalidate(failure.message); error = failure.message;
                }
            } finally {
                if (transport === request) transport = null;
                if (request.generation === generation) { render(); notify(); schedule(0); }
            }
        }
        function stage(field, value, delay) {
            if (!enabled(field) || !(field === "selectedRepair" ? ["refresh", "delete"].includes(value) :
                field === "selectedTool" ? ["dust", "loupe"].includes(value) : valid(field, value))) return false;
            intents.set(field, { value, sequence: ++sequence, base: baseKey(state), target: targetKey(state),
                repairToken: repairField(field) ? state.repair.token : null });
            if (repairField(field)) repairFeedback = "";
            if (sliders[field]) showSlider(controls[field], value);
            error = ""; render(); notify(); schedule(delay || 0); return true;
        }
        function chooseMode(mode) {
            if (!enabled("newSpotType")) return;
            if (mode === localValue("newSpotType") && (intents.has("newSpotType") || !operation)) return;
            cancelEdits("");
            stage("newSpotType", mode, 0);
        }
        function togglePanel() {
            if (!enabled("selectedTool")) return;
            const target = state.selectedTool === "dust" ? "loupe" : "dust";
            cancelEdits("");
            stage("selectedTool", target, 0);
        }
        function begin(field, kind) {
            if (!enabled(field)) return false;
            const c = controls[field];
            if (kind === "editing" && !c.editing) c.editOriginal = c.displayed === null ? "" : String(c.displayed);
            c.cancelled = false; c[kind] = true; c.editTarget = targetKey(state);
            notify(); return true;
        }
        function sliderRow(field) {
            const definition = sliders[field], c = controls[field] = { scale: definition.scale || 1, confirmed: null, displayed: null, dragging: false, editing: false, cancelled: false };
            c.row = doc.createElement("div"); c.row.className = "develop-slider-row remove-brush-row"; c.row.dataset.removeField = field;
            const name = doc.createElement("div"); name.className = "slider-name"; name.textContent = definition.label;
            c.range = doc.createElement("input"); c.range.type = "range"; c.range.min = String(definition.min); c.range.max = "100"; c.range.step = "1";
            const accessible = (repairParameter(field) ? "Selected repair " : "") + definition.label;
            c.range.setAttribute("aria-label", accessible);
            c.number = doc.createElement("input"); c.number.type = "text"; c.number.inputMode = "decimal"; c.number.autocomplete = "off"; c.number.spellcheck = false;
            c.number.setAttribute("aria-label", accessible + " numeric value");
            function button(text, className, action, label) {
                const b = doc.createElement("button"); b.type = "button"; b.textContent = text; b.className = className;
                b.setAttribute("aria-label", label); b.addEventListener("click", action); return b;
            }
            function step(direction) {
                if (!enabled(field)) return;
                c.editing = c.dragging = false; c.cancelled = false;
                const base = intents.has(field) ? localValue(field) * c.scale : c.displayed !== null ? c.displayed : c.confirmed * c.scale;
                if (typeof base !== "number") return;
                stage(field, whole(whole(base, definition.min) + direction, definition.min) / c.scale, 350);
            }
            c.minus = button("−", "develop-slider-step", () => step(-1), "Decrease " + accessible);
            c.plus = button("+", "develop-slider-step", () => step(1), "Increase " + accessible);
            if (Object.hasOwn(defaults, field)) {
            c.reset = button("Reset", "reset", () => {
                if (!enabled(field)) return;
                c.editing = c.dragging = false; c.cancelled = true;
                stage(field, defaults[field], 0);
            }, "Reset " + definition.label + " to LRBridge default " + defaults[field]);
            c.reset.title = "LRBridge default: " + defaults[field] + ". Resets only this preference.";
            }
            c.elements = [c.range, c.number, c.minus, c.plus, ...(c.reset ? [c.reset] : [])];
            [name, ...c.elements].forEach(e => c.row.appendChild(e));
            c.range.addEventListener("pointerdown", () => begin(field, "dragging"));
            c.range.addEventListener("input", () => {
                if (c.cancelled || !enabled(field) || !c.dragging && !begin(field, "dragging")) { render(); return; }
                stage(field, Number(c.range.value) / c.scale, 100);
            });
            c.range.addEventListener("change", () => {
                if (c.cancelled) { c.cancelled = false; c.dragging = false; render(); return; }
                if (!c.dragging || c.editTarget !== targetKey(state)) return;
                const value = Number(c.range.value) / c.scale; c.dragging = false; stage(field, value, 0); render(); notify();
            });
            function cancelGesture() { cancelField(field, true); render(); notify(); }
            c.range.addEventListener("pointercancel", cancelGesture);
            c.range.addEventListener("keydown", e => {
                if (e.key === "Escape") { e.preventDefault(); cancelGesture(); }
                else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) begin(field, "dragging");
            });
            c.number.addEventListener("focus", () => begin(field, "editing"));
            c.number.addEventListener("pointerdown", () => begin(field, "editing"));
            c.number.addEventListener("input", () => { if (!c.cancelled && !c.editing) begin(field, "editing"); });
            function commit() {
                if (!c.editing || c.cancelled || c.editTarget !== targetKey(state)) return;
                const text = c.number.value.trim().replace(",", ".");
                const value = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) ? Number(text) : NaN;
                c.editing = false;
                // Merely focusing/committing a rounded native display must not round the SDK preference.
                if (c.number.value === c.editOriginal) { render(); notify(); return; }
                if (!Number.isFinite(value)) { error = definition.label + " must be a number."; render(); notify(); return; }
                stage(field, whole(value, definition.min) / c.scale, 0);
            }
            c.number.addEventListener("blur", () => { commit(); c.cancelled = false; c.editing = false; render(); notify(); });
            c.number.addEventListener("keydown", e => {
                if (e.key === "Enter") { e.preventDefault(); commit(); }
                if (e.key === "Escape") { e.preventDefault(); c.editing = false; c.cancelled = false; render(); notify(); }
            });
            return c.row;
        }
        function preference(field, label, choices) {
            const c = controls[field] = {}, row = c.row = doc.createElement("label");
            row.className = "remove-preference-row"; row.dataset.removeField = field;
            const text = doc.createElement("span"); text.textContent = label;
            const input = c.input = doc.createElement(choices ? "select" : "input");
            if (!choices) input.type = "checkbox";
            else {
                input.className = "develop-categorical-select";
                for (const [value, label] of choices) {
                    const option = doc.createElement("option"); option.value = value; option.textContent = label; input.appendChild(option);
                }
            }
            input.setAttribute("aria-label", label); input.dataset.removePreference = field;
            c.elements = [input];
            if (choices) { row.appendChild(text); row.appendChild(input); }
            else { row.appendChild(input); row.appendChild(text); }
            input.addEventListener("change", () => {
                const value = choices ? input.value : input.checked;
                if (field === "visualizeSpots" && value === false) cancelField("visualizationThreshold", true);
                stage(field, value, 0); render();
            });
            return row;
        }
        async function refresh() {
            if (!section || polling) return;
            polling = true; const current = generation;
            try {
                const next = await json("/api/remove/state");
                if (current === generation) {
                    if (operation && performance.now() - operation.startedAt > 12000) invalidate("Lightroom confirmation timed out; the Remove operation is unconfirmed.");
                    apply(next);
                }
            } catch (_) {
                if (current === generation) { invalidate("Could not read Lightroom preferences; pending edits were cancelled."); state = null; render(); notify(); }
            } finally { if (current === generation) { polling = false; pollTimer = setTimeout(refresh, 300); } }
        }
        return {
            activate(parent, appendActions) {
                section = doc.createElement("div"); section.className = "remove-brush-preferences";
                const panelRow = doc.createElement("div"); panelRow.className = "remove-action-row";
                panelButton = doc.createElement("button"); panelButton.type = "button";
                panelButton.className = "positive masking-panel-button"; panelButton.dataset.removePanel = "true";
                panelButton.appendChild(doc.createElement("span"));
                panelButton.addEventListener("click", togglePanel); panelRow.appendChild(panelButton); section.appendChild(panelRow);
                if (appendActions) appendActions(panelRow);
                const strip = doc.createElement("div"); strip.className = "color-mixer-view-tabs remove-mode-tabs"; strip.setAttribute("role", "tablist");
                strip.setAttribute("aria-label", "Remove tool mode");
                for (const [mode, label] of Object.entries(modes)) {
                    const button = tabs[mode] = doc.createElement("button");
                    button.type = "button"; button.className = "color-mixer-view-button"; button.textContent = label; button.dataset.removeMode = mode;
                    button.setAttribute("role", "tab"); button.addEventListener("click", () => chooseMode(mode)); strip.appendChild(button);
                }
                section.appendChild(strip);
                const description = doc.createElement("p"); description.textContent = "Preferences for new brush strokes. Existing spot adjustments are separate.";
                section.appendChild(description); section.appendChild(sliderRow("brushSize"));
                modeControls = doc.createElement("div"); modeControls.className = "remove-mode-controls";
                modeControls.appendChild(sliderRow("brushFeather"));
                removeOptions = doc.createElement("div");
                removeOptions.appendChild(preference("useGenerativeAI", "Use generative AI"));
                removeOptions.appendChild(preference("detectObjects", "Detect objects"));
                modeControls.appendChild(removeOptions); section.appendChild(modeControls);
                section.appendChild(preference("toolOverlay", "Tool Overlay", [["always", "Always"], ["auto", "Auto"], ["selected", "Selected"], ["never", "Never"]]));
                section.appendChild(preference("visualizeSpots", "Visualize Spots"));
                section.appendChild(sliderRow("visualizationThreshold"));
                const note = doc.createElement("p"); note.className = "remove-reset-defaults";
                note.textContent = "LRBridge Reset defaults: Size 25 · Feather 50 · Threshold 50.";
                section.appendChild(note);
                const selected = doc.createElement("section"); selected.className = "remove-selected-repair";
                const heading = doc.createElement("h3"); heading.textContent = "Selected Repair"; selected.appendChild(heading);
                repairSelection = doc.createElement("div"); repairSelection.className = "remove-repair-selection"; selected.appendChild(repairSelection);
                selected.appendChild(preference("selectedRepairFill", "Fill", [["", "Fill unavailable"], ...Object.entries(fills)]));
                controls.selectedRepairFill.input.setAttribute("aria-label", "Selected repair Fill");
                controls.selectedRepairFill.input.options[0].disabled = true;
                selected.appendChild(sliderRow("selectedRepairOpacity"));
                selected.appendChild(sliderRow("selectedRepairFeather"));
                const actions = doc.createElement("div"); actions.className = "remove-action-row";
                repairButtons = {};
                for (const [value, label] of [["refresh", "Refresh"], ["delete", "Delete"]]) {
                    const button = repairButtons[value] = doc.createElement("button"); button.type = "button";
                    button.className = value === "delete" ? "negative" : "positive"; button.textContent = label;
                    button.setAttribute("aria-label", label + " selected repair"); button.dataset.removeRepair = value;
                    button.addEventListener("click", () => { if (enabled("selectedRepair")) { repairFeedback = ""; stage("selectedRepair", value, 0); } });
                    actions.appendChild(button);
                }
                selected.appendChild(actions);
                repairStatus = doc.createElement("div"); repairStatus.className = "remove-repair-status"; repairStatus.setAttribute("role", "status");
                selected.appendChild(repairStatus); section.appendChild(selected);
                status = doc.createElement("div"); status.className = "remove-brush-status"; status.setAttribute("role", "status");
                section.appendChild(status); parent.appendChild(section); render(); refresh();
            },
            deactivate() {
                generation++; clearTimeout(pollTimer); clearTimeout(sendTimer);
                section = null; state = null; operation = transport = null; intents.clear(); polling = false; error = ""; repairFeedback = "";
                for (const c of Object.values(controls)) c.dragging = c.editing = false;
                notify();
            },
            updateContext() {
                if (state && contextKey(state) !== contextKey(options.getContext())) {
                    invalidate("Photo or Develop context changed; the earlier edit was cancelled."); state = null;
                }
                render(); notify();
            },
            isInteracting: busy,
            refresh
        };
    }
    return { createController, defaults };
});
