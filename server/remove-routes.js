"use strict";
const definition = require("./remove-state");
module.exports = function installRemoveRoutes(app, state, commands, exact, number) {
    const clientFields = ["selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt", "serverEpoch", "stateRevision", "mode"];
    const snapshotFields = ["available", "reason", "selectedTool", "repair"].concat(definition.preferenceFields);
    const booleanFields = ["available", "useGenerativeAI", "detectObjects", "visualizeSpots", "otherPreferencesPreserved", "repairRemovalConfirmed", "repairEditConfirmed"];
    const numericFields = ["brushSize", "brushFeather", "visualizationThreshold", ...Object.keys(definition.repairParameters), "expectedRemoveRevision",
        "expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt", "contextCounter", "developCounter", "contextChangedAt", "stateRevision"];
    function parse(query) {
        const out = {};
        for (const [key, value] of Object.entries(query)) {
            if (key === "repair") {
                try { out.repair = typeof value === "string" && value.length < 12000 ? JSON.parse(value) : null; } catch (_) { out.repair = null; }
                continue;
            }
            const typeKey = key === "value" ? query.field : key;
            out[key] = value === "null" ? null : booleanFields.includes(typeKey) ? value === "true" ? true : value === "false" ? false : undefined :
                numericFields.includes(typeKey) ? number(value) : value;
        }
        return out;
    }
    app.get("/remove/state", (req, res) => res.json({ ok: true, ...state.get(true) }));
    app.get("/remove/diagnostics/selected-repair", (req, res) => {
        const snapshot = state.get(true);
        res.json({ ok: true, sdkOnly: true, capturedAt: snapshot.capturedAt, ageMs: snapshot.ageMs,
            expectedReader: "healing-focus-1", activeModule: snapshot.activeModule, newSpotType: snapshot.newSpotType || null,
            preferencesAvailable: snapshot.available, contextCounter: snapshot.contextCounter, developCounter: snapshot.developCounter,
            selectedPhotoUuid: snapshot.selectedPhotoUuid, selectedTool: snapshot.selectedTool,
            revision: snapshot.revision, pendingOperation: snapshot.pendingOperation, lastResult: snapshot.lastResult,
            repair: snapshot.repair || null });
    });
    app.get("/remove/next", (req, res) => res.json({ ok: true, request: state.takeRequest() }));
    app.get("/remove/validate", (req, res) => {
        if (!exact(req, ["operationId"].concat(definition.bindingFields))) return res.status(400).json({ ok: false });
        res.json({ ok: true, valid: state.validateBinding(parse(req.query)) });
    });
    app.get("/remove/query-result", (req, res) => {
        if (!exact(req, ["requestId"].concat(definition.bindingFields, snapshotFields))) return res.status(400).json({ ok: false });
        if (!state.acceptQuery(parse(req.query))) return res.status(409).json({ ok: false });
        res.json({ ok: true });
    });
    function admit(req, res, panel, repair) {
        if (!exact(req, ["field", "value"].concat(clientFields, repair ? ["repairToken"] : []))) return res.status(400).json({ ok: false });
        const input = parse(req.query);
        if (repair ? !(input.field === "selectedRepair" && ["refresh", "delete"].includes(input.value) ||
            input.field === "selectedRepairFill" && definition.fillChoices.includes(input.value) ||
            Object.hasOwn(definition.repairParameters,input.field) && definition.unit(input.value)) :
            (input.field === "selectedTool") !== panel || !definition.validValue(input.field, input.value))
            return res.status(400).json({ ok: false, error: "Invalid Remove request" });
        const command = state.admit(input.field, input.value, input);
        if (!command) return res.status(409).json({ ok: false, error: "Remove tool, mode or context changed, or another operation is pending." });
        const result = commands.tryEnqueueCommand(command);
        if (result.status !== commands.ADMISSION_ACCEPTED) {
            state.reject(command, "The Remove operation could not be queued.");
            return res.status(409).json({ ok: false, error: "The Remove operation could not be queued." });
        }
        res.json({ ok: true, ...state.get(false) });
    }
    app.get("/remove/brush", (req, res) => admit(req, res, false));
    app.get("/remove/panel", (req, res) => admit(req, res, true));
    app.get("/remove/repair", (req, res) => admit(req, res, false, true));
    app.get("/remove/operation-result", (req, res) => {
        const fields = ["operationId", "field", "value", "outcome", "detail", "otherPreferencesPreserved", "targetRepairToken", "repairRemovalConfirmed", "repairEditConfirmed"];
        if (!exact(req, fields.concat(definition.bindingFields, snapshotFields)) || typeof req.query.detail !== "string" ||
            req.query.detail.length > 300 || /[\x00-\x1f\x7f]/.test(req.query.detail)) return res.status(400).json({ ok: false });
        if (!state.acceptResult(parse(req.query))) return res.status(409).json({ ok: false });
        res.json({ ok: true });
    });
};
