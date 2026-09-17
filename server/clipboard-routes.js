"use strict";
const definition = require("./clipboard-state");
module.exports = function installClipboardRoutes(app, state, commands, exact, number) {
    app.use("/clipboard", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
    const numeric = ["expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt", "contextCounter", "developCounter", "contextChangedAt", "stateRevision", "selectionCount", "aiPendingCount", "aiCheckedCount"];
    const boolean = ["available", "copySupported", "pasteSupported", "invoked", "sdkResult", "updateAISettings"];
    const parse = q => Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v === "null" ? null : numeric.includes(k) ? number(v) :
        boolean.includes(k) ? v === "true" ? true : v === "false" ? false : undefined : v]));
    const commandFields = ["command", "requestId", "operationId", "expectedSelectionToken", "updateAISettings", ...definition.bindings];
    const reply = (res, body) => res.set("Cache-Control", "no-store").json(body);
    app.get("/clipboard/state", (req, res) => {
        if (!exact(req, [])) return res.status(400).json({ ok: false });
        reply(res, { ok: true, ...state.get(true) });
    });
    app.get("/clipboard/action", (req, res) => {
        if (!exact(req, ["command", ...definition.clientFields]) || !definition.actions.includes(req.query.command)) return res.status(400).json({ ok: false });
        const admitted = state.admit(req.query.command, parse(req.query));
        if (!admitted) return res.status(409).json({ ok: false, error: "Copy/paste unavailable, busy or selection changed. Refresh before making a new request." });
        if (admitted.command && commands.tryEnqueueCommand(admitted.command).status !== commands.ADMISSION_ACCEPTED) {
            state.reject(admitted.command); return res.status(409).json({ ok: false, error: "Clipboard request could not be queued." });
        }
        reply(res, { ok: true, duplicate: !!admitted.duplicate, receipt: admitted.receipt || null, ...state.get(false) });
    });
    app.get("/clipboard/claim", (req, res) => {
        if (!exact(req, commandFields) || !definition.validCommand(parse(req.query))) return res.status(400).json({ ok: false });
        reply(res, { valid: state.claim(parse(req.query)) });
    });
    app.get("/clipboard/query-result", (req, res) => {
        if (!exact(req, ["command", "requestId", ...definition.bindings, ...definition.snapshotFields])) return res.status(400).json({ ok: false });
        if (!state.acceptQuery(parse(req.query))) return res.status(409).json({ ok: false });
        reply(res, { ok: true });
    });
    app.get("/clipboard/validate", (req, res) => {
        if (!exact(req, commandFields) || !definition.validCommand(parse(req.query))) return res.status(400).json({ ok: false });
        reply(res, { valid: state.validateClaim(parse(req.query)) });
    });
    app.get("/clipboard/operation-result", (req, res) => {
        if (!exact(req, [...commandFields, "outcome", "invoked", "sdkResult", "aiPendingCount", "aiCheckedCount"])) return res.status(400).json({ ok: false });
        if (!state.acceptResult(parse(req.query))) return res.status(409).json({ ok: false });
        reply(res, { ok: true });
    });
    app.get("/clipboard/acknowledge", (req, res) => {
        if (!exact(req, ["serverEpoch", "operationId"])) return res.status(400).json({ ok: false });
        if (!state.acknowledge(parse(req.query))) return res.status(409).json({ ok: false });
        reply(res, { ok: true, ...state.get(false) });
    });
};
