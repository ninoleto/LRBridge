"use strict";
const express = require("express");
module.exports = function register(app, state) {
    const exact = (q, fields) => Object.keys(q).length === fields.length && fields.every(k => typeof q[k] === "string");
    const key = ["serverEpoch", "requestId", "operationId"];
    const reply = (res, data) => res.set("Cache-Control", "no-store").json(data);
    app.get("/set/capabilities", (req, res) => {
        if (!exact(req.query, [])) return res.status(400).json({ ok: false });
        reply(res, state.capabilities());
    });
    app.post("/set", express.json({ limit: "2kb", strict: true }), (req, res) => {
        if (!exact(req.query, [])) return res.status(400).json({ ok: false });
        const result = state.admit(req.body);
        reply(res.status(result.status), { ok: result.status < 300, ...result });
    });
    app.get("/set/result", (req, res) => {
        if (!exact(req.query, ["serverEpoch", "requestId"])) return res.status(400).json({ ok: false });
        const receipt = state.get(req.query); reply(res.status(receipt ? 200 : 404), { ok: !!receipt, receipt });
    });
    app.get("/set/claim", (req, res) => {
        if (!exact(req.query, key)) return res.status(400).json({ ok: false });
        reply(res, { valid: state.claim(req.query) });
    });
    app.get("/set/validate", (req, res) => {
        if (!exact(req.query, key)) return res.status(400).json({ ok: false });
        reply(res, state.validate(req.query));
    });
    app.get("/set/operation-result", (req, res) => {
        if (!exact(req.query, [...key, "slider", "selectedPhotoUuid", "contextCounter", "contextChangedAt", "outcome", "reason", "invoked"]) ||
            !["true", "false"].includes(req.query.invoked)) return res.status(400).json({ ok: false });
        const input = { ...req.query, invoked: req.query.invoked === "true" };
        for (const k of ["contextCounter", "contextChangedAt"]) {
            if (!/^\d+$/.test(input[k])) return res.status(400).json({ ok: false });
            input[k] = Number(input[k]); if (!Number.isSafeInteger(input[k])) return res.status(400).json({ ok: false });
        }
        const ok = state.acceptResult(input); reply(res.status(ok ? 200 : 409), { ok });
    });
    app.use("/set", (err, _req, res, next) => {
        if (err.type === "entity.too.large" || err.type === "entity.parse.failed") return reply(res.status(err.type === "entity.too.large" ? 413 : 400), { ok: false, error: "Invalid guarded Set JSON" });
        next(err);
    });
};
