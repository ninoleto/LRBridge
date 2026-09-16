(function(root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LRBridgeControllerReflections = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
    "use strict";
    const amountReset = 100; // Intentional LRBridge reset target; only the amount changes.
    const contextKey = c => c && JSON.stringify([c.activeModule, c.selectedPhotoUuid, c.contextCounter, c.developCounter, c.contextChangedAt]);
    const key = s => s && contextKey(s) + ":" + s.serverEpoch;
    const whole = n => Math.max(-100, Math.min(100, Math.round(n)));
    const valid = (f, v) => f === "amount" ? typeof v === "number" && Number.isFinite(v) && v >= -100 && v <= 100 :
        f === "checkboxState" ? typeof v === "boolean" : f === "quality" && ["preview", "standard", "best"].includes(v);
    function createController(options) {
        const doc = options.document, intents = new Map();
        let section = null, controls = {}, status = null, state = null, received = 0, operation = null, transport = null;
        let pollTimer = null, sendTimer = null, polling = false, generation = 0, message = "";
        let dragging = false, editing = false, cancelled = false, original = "", displayed = null;
        const notify = () => options.onInteractionChange && options.onInteractionChange();
        const busy = () => Boolean(operation || transport || intents.size || dragging || editing || state?.pendingOperation);
        const available = () => state?.available === true && contextKey(state) === contextKey(options.getContext()) &&
            state.activeModule === "develop" && state.selectedPhotoUuid && state.isSupported && state.enabled;
        const fresh = () => state && Number.isFinite(state.ageMs) && state.ageMs + performance.now() - received < 5000;
        function enabled(field) {
            const ownAmount = field === "amount" && operation?.field === "amount" && key(state) === operation.base && performance.now() - operation.started < 125000;
            const foreign = state?.pendingOperation && (!operation || operation.id && state.pendingOperation.operationId !== operation.id);
            return Boolean(available() && valid(field, state[field]) && (fresh() || ownAmount) && !foreign &&
                !(options.isBlocked && options.isBlocked()) && (ownAmount || !operation && !transport) &&
                (field === "amount" ? ![...intents.keys()].some(f => f !== "amount") : !intents.size && !dragging && !editing));
        }
        function disable(e, value) {
            e.setAttribute("aria-disabled", String(value)); e.disabled = value && doc.activeElement !== e;
            if (e.type === "text") e.readOnly = value;
        }
        function showAmount(value) {
            displayed = typeof value === "number" ? whole(value) : null;
            if (!section) return;
            if (!editing) controls.number.value = displayed === null ? "" : String(displayed);
            if (displayed !== null) {
                controls.range.value = String(displayed);
                controls.range.style.setProperty("--slider-progress", (displayed + 100) / 2 + "%");
            }
        }
        function render() {
            if (!section) return;
            controls.apply.checked = state?.checkboxState === true; // Actual SDK checkbox, requested state is in status.
            controls.quality.value = intents.get("quality")?.value ?? state?.quality ?? "";
            disable(controls.apply, !enabled("checkboxState")); disable(controls.quality, !enabled("quality"));
            for (const e of [controls.range, controls.number, controls.minus, controls.plus, controls.reset]) disable(e, !enabled("amount"));
            if (!dragging && !editing) showAmount(intents.get("amount")?.value ?? (state?.available ? state.amount : null));
            const pending = state?.pendingOperation;
            const request = operation || pending;
            const description = request?.field === "checkboxState" ? "Apply " + (request.value ? "on" : "off") : request?.field === "quality" ? "Quality" : "Amount";
            status.textContent = request ? description + " requested. " + (pending?.callbackCompleted ? "SDK callback received; waiting for native readback…" :
                pending?.phase === "requested" && request.field !== "amount" ? "Waiting for Lightroom callback and readback…" : "Waiting for Lightroom…") :
                intents.size ? "Waiting to send Reflections adjustment…" : message || (!state?.available ? "Reflections state unavailable." :
                    !state.isSupported ? "Reflections is not supported for this photo." : !state.enabled ? "Reflections is currently unavailable in Lightroom." : "");
            section.setAttribute("aria-busy", String(busy()));
        }
        function cancelDrafts() {
            clearTimeout(sendTimer); intents.clear(); dragging = editing = false; cancelled = true;
            render(); notify();
        }
        function invalidate(detail) { generation++; cancelDrafts(); operation = null; message = detail; render(); notify(); }
        function resultFor(next, requireId) {
            const r = next?.lastResult;
            return operation && r && (!requireId || operation.id) && (!operation.id || r.operationId === operation.id) &&
                r.field === operation.field && r.value === operation.value && key(next) === operation.base ? r : null;
        }
        function reconcile() {
            const result = resultFor(state, true); if (!result) return;
            if (result.outcome === "confirmed" && state?.available && state[operation.field] === operation.value) {
                if (intents.get(operation.field)?.value === operation.value) intents.delete(operation.field);
            } else cancelDrafts();
            message = result.detail; operation = null;
            if (options.onHistoryChanged) options.onHistoryChanged();
        }
        function apply(next) {
            if (!next || next.ok !== true || contextKey(next) !== contextKey(options.getContext()) || !Number.isSafeInteger(next.revision) || typeof next.serverEpoch !== "string") return;
            if (state && state.serverEpoch === next.serverEpoch && next.revision < state.revision) { reconcile(); return; }
            const result = resultFor(next, false);
            const own = operation && key(next) === operation.base && (result || next.pendingOperation &&
                (operation.id ? next.pendingOperation.operationId === operation.id : next.pendingOperation.field === operation.field && next.pendingOperation.value === operation.value));
            if (state && key(state) !== key(next)) invalidate("Photo or Develop context changed; earlier Reflections input cancelled.");
            else if (state && !own && (next.available !== true || next.enabled !== true || next.isSupported !== true ||
                ["checkboxState", "amount", "quality"].some(f => state[f] !== next[f]))) cancelDrafts();
            state = next; received = performance.now(); reconcile(); render(); notify(); schedule(0);
        }
        async function json(url) {
            const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 4500);
            try { const response = await options.fetch(url, { signal: abort.signal, cache: "no-store" });
                if (!response.ok) throw Error("Reflections request not admitted; refresh native state before trying again.");
                return await response.json();
            } finally { clearTimeout(timer); }
        }
        function schedule(delay) {
            if (!section || !intents.size) return;
            clearTimeout(sendTimer); sendTimer = setTimeout(() => { sendTimer = null; pump(); }, delay);
        }
        async function pump() {
            if (!section || operation || transport || state?.pendingOperation || !available() || !fresh() || options.isBlocked?.()) return;
            const entry = intents.entries().next().value; if (!entry) return;
            const [field, intent] = entry;
            if (intent.base !== key(state)) { cancelDrafts(); return; }
            if (state[field] === intent.value) { intents.delete(field); render(); notify(); schedule(0); return; }
            const request = { id: null, field, value: intent.value, base: key(state), generation, started: performance.now() };
            operation = transport = request;
            const query = new URLSearchParams({ field, value: intent.value, selectedPhotoUuid: state.selectedPhotoUuid,
                contextCounter: state.contextCounter, developCounter: state.developCounter, contextChangedAt: state.contextChangedAt,
                serverEpoch: state.serverEpoch, stateRevision: state.revision });
            render(); notify(); if (options.onSubmitted) options.onSubmitted();
            try {
                const admitted = await json("/api/reflections/set?" + query);
                if (request.generation !== generation || operation !== request) return;
                const p = admitted.pendingOperation;
                if (!p || p.field !== field || p.value !== request.value || key(admitted) !== request.base) throw Error("Missing Reflections admission proof.");
                request.id = p.operationId; apply(admitted); reconcile();
            } catch (error) {
                if (operation === request) { invalidate("Reflections request failed or timed out; result unconfirmed. No retry sent."); state = null; }
            } finally {
                if (transport === request) transport = null;
                render(); notify(); schedule(0);
            }
        }
        function stage(field, value, delay) {
            if (!enabled(field) || !valid(field, value)) { render(); return; }
            intents.set(field, { value, base: key(state) }); message = "";
            if (field === "amount") showAmount(value);
            render(); notify(); schedule(delay);
        }
        function begin(kind) {
            if (!enabled("amount")) return false;
            if (kind === "editing") { if (!editing) original = displayed === null ? "" : String(displayed); editing = true; }
            else dragging = true;
            cancelled = false; notify(); return true;
        }
        function commit() {
            if (!editing || cancelled) return;
            const text = controls.number.value, normalized = text.trim().replace(",", "."); editing = false;
            if (text === original) { render(); notify(); return; }
            const value = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized) ? Number(normalized) : NaN;
            if (!Number.isFinite(value)) { message = "Amount must be a number."; render(); notify(); return; }
            stage("amount", whole(value), 0);
        }
        async function refresh() {
            if (polling || !section && !busy()) return;
            clearTimeout(pollTimer); polling = true; const current = generation;
            try {
                const next = await json("/api/reflections/state");
                if (generation === current) {
                    if (operation && performance.now() - operation.started > 125000) invalidate("Reflections timed out; result unconfirmed.");
                    apply(next);
                }
            } catch (_) { if (generation === current) { invalidate("Could not read Reflections; pending input cancelled."); state = null; render(); } }
            finally { polling = false; if (section || busy()) pollTimer = setTimeout(refresh, 300); }
        }
        function element(tag, className, text) { const e = doc.createElement(tag); e.className = className; if (text) e.textContent = text; return e; }
        function button(text, className, label, action) {
            const b = element("button", className, text); b.type = "button"; b.setAttribute("aria-label", label); b.addEventListener("click", action); return b;
        }
        return {
            activate(parent) {
                section = element("section", "reflections-controls"); section.appendChild(element("h4", "", "Reflections"));
                controls = {};
                const applyRow = element("label", "remove-preference-row"), checkbox = controls.apply = element("input", "");
                checkbox.type = "checkbox"; checkbox.setAttribute("aria-label", "Apply Reflections");
                applyRow.append(checkbox, element("span", "", "Apply")); section.appendChild(applyRow);
                checkbox.addEventListener("change", () => stage("checkboxState", checkbox.checked, 0));
                const row = element("div", "develop-slider-row remove-brush-row"); row.dataset.reflectionsField = "amount";
                controls.range = element("input", ""); Object.assign(controls.range, { type: "range", min: "-100", max: "100", step: "1" });
                controls.range.setAttribute("aria-label", "Reflections Amount");
                controls.number = element("input", ""); Object.assign(controls.number, { type: "text", inputMode: "decimal", autocomplete: "off", spellcheck: false });
                controls.number.setAttribute("aria-label", "Reflections Amount numeric value");
                const step = direction => {
                    if (!enabled("amount")) return;
                    const value = intents.get("amount")?.value ?? displayed; if (typeof value !== "number") return;
                    dragging = editing = false; cancelled = false; stage("amount", whole(whole(value) + direction), 350);
                };
                controls.minus = button("−", "develop-slider-step", "Decrease Reflections Amount", () => step(-1));
                controls.plus = button("+", "develop-slider-step", "Increase Reflections Amount", () => step(1));
                controls.reset = button("Reset", "reset", "Reset Reflections Amount to LRBridge target 100", () => {
                    if (!enabled("amount")) return; dragging = editing = false; cancelled = true; stage("amount", amountReset, 0);
                });
                controls.reset.title = "LRBridge Reset target: 100. Changes only Reflections Amount.";
                row.append(element("div", "slider-name", "Amount"), controls.range, controls.number, controls.minus, controls.plus, controls.reset); section.appendChild(row);
                controls.range.addEventListener("pointerdown", () => begin("dragging"));
                controls.range.addEventListener("input", () => { if (!cancelled && (dragging || begin("dragging"))) stage("amount", whole(Number(controls.range.value)), 100); else render(); });
                controls.range.addEventListener("change", () => { if (cancelled) { cancelled = dragging = false; render(); return; }
                    if (dragging) { dragging = false; stage("amount", whole(Number(controls.range.value)), 0); } });
                controls.range.addEventListener("pointercancel", cancelDrafts);
                controls.range.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); cancelDrafts(); }
                    else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) begin("dragging"); });
                controls.number.addEventListener("focus", () => begin("editing"));
                controls.number.addEventListener("pointerdown", () => begin("editing"));
                controls.number.addEventListener("input", () => { if (!cancelled && !editing) begin("editing"); });
                controls.number.addEventListener("blur", () => { commit(); editing = cancelled = false; render(); notify(); });
                controls.number.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); commit(); }
                    if (e.key === "Escape") { e.preventDefault(); editing = false; render(); notify(); } });
                const qualityRow = element("label", "remove-preference-row"); controls.quality = element("select", "develop-categorical-select");
                controls.quality.setAttribute("aria-label", "Reflections Quality");
                for (const [value, label] of [["", "Quality unavailable"], ["preview", "Preview"], ["standard", "Standard"], ["best", "Best"]]) {
                    const option = element("option", "", label); option.value = value; option.disabled = !value; controls.quality.appendChild(option);
                }
                qualityRow.append(element("span", "", "Quality"), controls.quality); section.appendChild(qualityRow);
                controls.quality.addEventListener("change", () => stage("quality", controls.quality.value, 0));
                section.appendChild(element("p", "remove-reset-defaults", "LRBridge Amount Reset target: 100. Apply and Quality stay unchanged."));
                status = element("div", "remove-brush-status"); status.setAttribute("role", "status"); section.appendChild(status);
                parent.appendChild(section); render(); refresh();
            },
            deactivate() { cancelDrafts(); section = null; clearTimeout(pollTimer); if (busy()) pollTimer = setTimeout(refresh, 0); },
            updateContext() { if (state && contextKey(state) !== contextKey(options.getContext())) { invalidate("Photo or Develop context changed; Reflections input cancelled."); state = null; render(); } },
            cancelGestures: cancelDrafts, isInteracting: busy, refresh
        };
    }
    return { createController, amountReset };
});
