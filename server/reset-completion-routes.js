"use strict";
const express = require("express");
module.exports = function register(app, state) {
    const exact = (q, fields) => Object.keys(q).length === fields.length && fields.every(k => typeof q[k] === "string");
    const key = ["serverEpoch", "requestId", "operationId"];
    const reply = (res, data) => res.set("Cache-Control", "no-store").json(data);
    app.get("/reset/capabilities", (req, res) => {
        if (!exact(req.query, [])) return res.status(400).json({ ok: false });
        reply(res, state.capabilities());
    });
    app.post("/reset", express.json({ limit: "2kb", strict: true }), (req, res) => {
        if (!exact(req.query, [])) return res.status(400).json({ ok: false });
        const result = state.admit(req.body);
        reply(res.status(result.status), { ok: result.status < 300, ...result });
    });
    app.get("/reset/result", (req, res) => {
        if (!exact(req.query, ["serverEpoch", "requestId"])) return res.status(400).json({ ok: false });
        const receipt = state.get(req.query);
        reply(res.status(receipt ? 200 : 404), { ok: !!receipt, receipt });
    });
    app.get("/reset/claim", (req, res) => {
        if (!exact(req.query, key)) return res.status(400).json({ ok: false });
        reply(res, { valid: state.claim(req.query) });
    });
    app.get("/reset/validate", (req, res) => {
        if (!exact(req.query, key)) return res.status(400).json({ ok: false });
        reply(res, state.validate(req.query));
    });
    app.get("/reset/operation-result", (req, res) => {
        const required = [...key, "slider", "selectedPhotoUuid", "contextCounter", "contextChangedAt", "outcome", "invoked", "resetSucceeded", "executionDevelopCounter"];
        if (!required.every(k => typeof req.query[k] === "string") ||
            Object.keys(req.query).some(k => ![...required, "sdkValue"].includes(k) || typeof req.query[k] !== "string") ||
            !["true", "false"].includes(req.query.invoked) || !["true", "false"].includes(req.query.resetSucceeded)) return res.status(400).json({ ok: false });
        const input = { ...req.query, invoked: req.query.invoked === "true", resetSucceeded: req.query.resetSucceeded === "true" };
        for (const k of ["contextCounter", "contextChangedAt", "executionDevelopCounter", "sdkValue"]) if (input[k] !== undefined) {
            if (!/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(input[k])) return res.status(400).json({ ok: false });
            input[k] = Number(input[k]);
        }
        const ok = state.acceptResult(input); reply(res.status(ok ? 200 : 409), { ok });
    });
    app.use("/reset", (err, _req, res, next) => {
        if (err.type === "entity.too.large" || err.type === "entity.parse.failed") return reply(res.status(err.type === "entity.too.large" ? 413 : 400), { ok: false, error: "Invalid or oversized Reset JSON" });
        next(err);
    });
};
