"use strict";
const express = require("express");
module.exports = function register(app, state) {
    const exact = (q, fields) => Object.keys(q).length === fields.length && fields.every(k => typeof q[k] === "string");
    const key = ["serverEpoch", "requestId", "operationId"];
    const reply = (res, data) => res.set("Cache-Control", "no-store").json(data);
    app.get("/nudge/capabilities", (req, res) => {
        if (!exact(req.query, [])) return res.status(400).json({ ok: false });
        reply(res, state.capabilities());
    });
    app.post("/nudge", express.json({ limit: "4kb", strict: true }), (req, res) => {
        if (!exact(req.query, [])) return res.status(400).json({ ok: false });
        const result = state.admit(req.body);
        reply(res.status(result.status), { ok: result.status < 300, ...result });
    });
    app.get("/nudge/result", (req, res) => {
        if (!exact(req.query, ["serverEpoch", "requestId"])) return res.status(400).json({ ok: false });
        const receipt = state.get(req.query);
        reply(res.status(receipt ? 200 : 404), { ok: !!receipt, receipt });
    });
    app.get("/nudge/claim", (req, res) => {
        if (!exact(req.query, key)) return res.status(400).json({ ok: false });
        reply(res, { valid: state.claim(req.query) });
    });
    app.get("/nudge/validate", (req, res) => {
        if (!exact(req.query, key)) return res.status(400).json({ ok: false });
        reply(res, state.validate(req.query));
    });
    app.get("/nudge/operation-result", (req, res) => {
        const required = [...key, "outcome", "invoked", "executionDevelopCounter"];
        const numeric = ["executionDevelopCounter", "baselineValue", "requestedValue", "sdkValue", "min", "max"];
        const allowed = [...required, ...numeric];
        if (!required.every(k => typeof req.query[k] === "string") || Object.keys(req.query).some(k => !allowed.includes(k) || typeof req.query[k] !== "string") ||
            !["true", "false"].includes(req.query.invoked)) return res.status(400).json({ ok: false });
        const input = { ...req.query, invoked: req.query.invoked === "true" };
        for (const k of numeric) if (input[k] !== undefined) {
            if (!/^-?\d+(?:\.\d+)?$/.test(input[k])) return res.status(400).json({ ok: false });
            input[k] = Number(input[k]);
        }
        const ok = state.acceptResult(input); reply(res.status(ok ? 200 : 409), { ok });
    });
    app.use("/nudge", (err, _req, res, next) => {
        if (err.type === "entity.too.large" || err.type === "entity.parse.failed") {
            return reply(res.status(err.type === "entity.too.large" ? 413 : 400), { ok: false, error: "Invalid or oversized nudge JSON" });
        }
        next(err);
    });
};
