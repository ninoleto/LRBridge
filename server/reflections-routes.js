"use strict";
const definition = require("./reflections-state");
module.exports = function installReflectionsRoutes(app, state, commands, exact, number) {
    const clientFields = ["selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt", "serverEpoch", "stateRevision"];
    const snapshots = ["available", "reason", ...definition.fields];
    const booleans = ["available", "checkboxState", "enabled", "isSupported", "callbackCompleted", "invoked", "preserved"];
    const numbers = ["amount", "expectedReflectionsRevision", "expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt",
        "contextCounter", "developCounter", "contextChangedAt", "stateRevision"];
    function parse(q) {
        return Object.fromEntries(Object.entries(q).map(([k, v]) => {
            const type = k === "value" ? q.field : k;
            return [k, v === "null" ? null : booleans.includes(type) ? v === "true" ? true : v === "false" ? false : undefined : numbers.includes(type) ? number(v) : v];
        }));
    }
    app.get("/reflections/state", (req, res) => res.json({ ok: true, ...state.get(true) }));
    app.get("/reflections/next", (req, res) => res.json({ request: state.takeRequest() }));
    app.get("/reflections/validate", (req, res) => {
        if (!exact(req, ["operationId", ...definition.bindings])) return res.status(400).json({ ok: false });
        res.json({ valid: state.validateBinding(parse(req.query)) });
    });
    app.get("/reflections/query-result", (req, res) => {
        if (!exact(req, ["requestId", ...definition.bindings, ...snapshots])) return res.status(400).json({ ok: false });
        if (!state.acceptQuery(parse(req.query))) return res.status(409).json({ ok: false });
        res.json({ ok: true });
    });
    app.get("/reflections/set", (req, res) => {
        if (!exact(req, ["field", "value", ...clientFields])) return res.status(400).json({ ok: false });
        const input = parse(req.query);
        if (!definition.valid(input.field, input.value)) return res.status(400).json({ ok: false });
        const command = state.admit(input.field, input.value, input);
        if (!command) return res.status(409).json({ ok: false, error: "Reflections unavailable, busy or context changed." });
        if (commands.tryEnqueueCommand(command).status !== commands.ADMISSION_ACCEPTED) {
            state.reject(command, "Reflections could not be queued."); return res.status(409).json({ ok: false });
        }
        res.json({ ok: true, ...state.get(false) });
    });
    app.get("/reflections/operation-result", (req, res) => {
        if (!exact(req, ["operationId", "field", "value", "outcome", "detail", "callbackCompleted", "invoked", "preserved", ...definition.bindings, ...snapshots]) ||
            typeof req.query.detail !== "string" || req.query.detail.length > 300 || /[\x00-\x1f\x7f]/.test(req.query.detail)) return res.status(400).json({ ok: false });
        if (!state.acceptResult(parse(req.query))) return res.status(409).json({ ok: false });
        res.json({ ok: true });
    });
};
