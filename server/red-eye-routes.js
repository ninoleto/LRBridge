"use strict";
const definition = require("./red-eye-state");
module.exports = function installRedEyeRoutes(app, state, commands, exact, number) {
    const clients = ["selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt", "serverEpoch", "stateRevision"];
    const booleans = ["available", "openSupported", "closeSupported", "resetSupported", "invoked"];
    const numbers = ["expectedRedEyeRevision", "expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt",
        "contextCounter", "developCounter", "contextChangedAt", "stateRevision"];
    const parse = q => Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v === "null" ? null : booleans.includes(k) ?
        v === "true" ? true : v === "false" ? false : undefined : numbers.includes(k) ? number(v) : v]));
    app.get("/red-eye/state", (req, res) => res.set("Cache-Control", "no-store").json({ ok: true, ...state.get(true) }));
    app.get("/red-eye/next", (req, res) => res.json({ request: state.takeRequest() }));
    app.get("/red-eye/validate", (req, res) => {
        if (!exact(req, ["operationId", ...definition.bindings])) return res.status(400).json({ ok: false });
        res.json({ valid: state.validateBinding(parse(req.query)) });
    });
    app.get("/red-eye/query-result", (req, res) => {
        if (!exact(req, ["requestId", ...definition.bindings, ...definition.snapshotFields])) return res.status(400).json({ ok: false });
        if (!state.acceptQuery(parse(req.query))) return res.status(409).json({ ok: false });
        res.json({ ok: true });
    });
    app.get("/red-eye/action", (req, res) => {
        if (!exact(req, ["operationKind", ...clients]) || !definition.kinds.includes(req.query.operationKind)) return res.status(400).json({ ok: false });
        const input = parse(req.query), command = state.admit(input.operationKind, input);
        if (!command) return res.status(409).json({ ok: false, error: "Red Eye unavailable, busy or context changed." });
        if (commands.tryEnqueueCommand(command).status !== commands.ADMISSION_ACCEPTED) {
            state.reject(command, "Red Eye request could not be queued."); return res.status(409).json({ ok: false });
        }
        res.json({ ok: true, ...state.get(false) });
    });
    app.get("/red-eye/operation-result", (req, res) => {
        if (!exact(req, ["operationId", "operationKind", "outcome", "detail", "invoked", ...definition.bindings, ...definition.snapshotFields]) ||
            typeof req.query.detail !== "string" || req.query.detail.length > 300 || /[\x00-\x1f\x7f]/.test(req.query.detail)) return res.status(400).json({ ok: false });
        if (!state.acceptResult(parse(req.query))) return res.status(409).json({ ok: false });
        res.json({ ok: true });
    });
};
