"use strict";
// Opt-in diagnostic sink only. No request/response or command-queue mutation.
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..", "local-checkpoints");
const routes = new Set(["/next", "/feedback/next", "/context/update", "/remove/next",
    "/remove/query-result", "/remove/operation-result", "/remove/selection-guard",
    "/remove/selection-refinement-native"]);
const sliderRoutes = new Set(["/set", "/adjust", "/reset"]);
function sliderTraceFields(req) {
    const query = req.query || {}, slider = query.slider;
    if (typeof slider !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(slider)) return {};
    const fields = { slider };
    for (const key of ["value", "amount", "id"]) {
        const raw = query[key];
        if (typeof raw === "string" && raw.length <= 40 && /^-?\d+(?:\.\d+)?$/.test(raw) && Number.isFinite(Number(raw))) fields[key] = Number(raw);
    }
    if (req.path === "/feedback/result") fields.available = query.available !== "0";
    return fields;
}
function createPollingTrace(directory = root, now = Date.now, enabled = process.env.LRBRIDGE_DEVELOPER_DIAGNOSTICS === "1") {
    if (!enabled) return {
        enabled: false,
        record() {},
        middleware(req, res, next) { next(); },
        readObserverPause() { return { paused: false }; },
        readSharedReadPause() { return { paused: false }; }
    };
    let checkedAt = -Infinity, capture = null, expires = 0, sequence = 0;
    function createPauseReader(filename) {
      let observerCheckedAt = -Infinity, observerPause = { paused: false };
      return function readPause() {
        const at = now();
        if (at - observerCheckedAt >= 500) {
            observerCheckedAt = at; observerPause = { paused: false };
            try {
                const arm = fs.readFileSync(path.join(directory, filename), "utf8").trim();
                const match = /^(\d+) ([\w-]{1,64})$/.exec(arm), until = match ? Number(match[1]) * 1000 : 0;
                if (match && until >= at && until <= at + 600000) observerPause = { paused: true, until, capture: match[2] };
            } catch (_) { /* Missing/expired diagnostic override means normal observation. */ }
        }
        if (observerPause.until < at) return { paused: false };
        return { ...observerPause };
      };
    }
    const readObserverPause = createPauseReader("sdk-move-observer-pause.arm");
    const readSharedReadPause = createPauseReader("sdk-move-native-reads-pause.arm");
    function record(event, data = {}) {
        try {
            const at = now();
            if (at - checkedAt >= 500) {
                checkedAt = at; capture = null;
                let arm;
                try { arm = fs.readFileSync(path.join(directory, "sdk-move-trace.arm"), "utf8").trim(); } catch (_) { return; }
                const match = /^(\d+) ([\w-]{1,64})$/.exec(arm);
                if (match && Number(match[1]) * 1000 >= at && Number(match[1]) * 1000 <= at + 600000) {
                    capture = match[2]; expires = Number(match[1]) * 1000;
                }
            }
            if (!capture || at > expires) return;
            fs.appendFileSync(path.join(directory, capture + "-server.jsonl"),
                JSON.stringify({ at, sequence: ++sequence, event, ...data }) + "\n");
        } catch (_) { /* Diagnostic I/O cannot change the request outcome. */ }
    }
    function middleware(req, res, next) {
        const sliderRoute = sliderRoutes.has(req.path) || req.path === "/feedback/result" && ["Exposure", "Contrast"].includes(req.query?.slider);
        if (routes.has(req.path) || sliderRoute) {
            const startedAt = now();
            const fields = sliderRoute ? sliderTraceFields(req) : {};
            record("http_enter", { path: req.path, startedAt, ...fields });
            res.once("finish", () => record("http_finish", { path: req.path, startedAt, status: res.statusCode, ...fields }));
            res.once("close", () => { if (!res.writableFinished) record("http_closed", { path: req.path, startedAt, ...fields }); });
        }
        next();
    }
    return { enabled: true, record, middleware, readObserverPause, readSharedReadPause };
}
module.exports = { createPollingTrace };
