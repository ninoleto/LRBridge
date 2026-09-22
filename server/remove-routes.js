"use strict";
const definition = require("./remove-state");
module.exports = function installRemoveRoutes(app, state, commands, exact, number) {
    const clientFields = ["selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt", "serverEpoch", "stateRevision", "mode"];
    const snapshotFields = ["available", "reason", "selectedTool", "repair"].concat(definition.preferenceFields);
    const booleanFields = ["dustApply", "available", "useGenerativeAI", "detectObjects", "visualizeSpots", "otherPreferencesPreserved", "repairRemovalConfirmed", "repairEditConfirmed", "selectionCompletionConfirmed"];
    const numericFields = ["brushSize", "brushFeather", "visualizationThreshold", ...Object.keys(definition.repairParameters), "expectedRemoveRevision",
        "expectedContextCounter", "expectedDevelopCounter", "expectedContextChangedAt", "contextCounter", "developCounter", "contextChangedAt", "stateRevision"];
    function parse(query) {
        const out = {};
        for (const [key, value] of Object.entries(query)) {
            if (key === "repair" || key === "dust") {
                try { out[key] = typeof value === "string" && value.length < 12000 ? JSON.parse(value) : null; } catch (_) { out[key] = null; }
                continue;
            }
            const typeKey = key === "value" ? query.field : key;
            out[key] = value === "null" ? null : booleanFields.includes(typeKey) ? value === "true" ? true : value === "false" ? false : undefined :
                numericFields.includes(typeKey) ? number(value) : value;
        }
        return out;
    }
    app.get("/remove/state", (req, res) => {
        // Native discovery must not delay SDK/Dust feedback or make its polls fail.
        const current = state.get(true);
        state.refreshSelection(false);
        res.json({ ok: true, ...current });
    });
    app.get("/remove/diagnostics/refinement", (req, res) => res.set("Cache-Control", "no-store").json({ ok: true, ...state.refinementDiagnostics() }));
    app.get("/remove/selection-native", async (req, res) => {
        if (!exact(req, ["operationId", "action"].concat(definition.bindingFields))) return res.status(400).json({ ok: false });
        const input = parse(req.query);
        if (!["read", "invoke"].includes(input.action) || !state.validateBinding(input)) return res.status(409).json({ ok: false });
        const sent = input.action === "invoke" ? await state.invokeSelection(input) : false;
        await state.refreshSelection();
        if (!state.validateBinding(input)) return res.status(409).json({ ok: false });
        res.json({ ok: true, sent, ...state.get(false).selection });
    });
    app.get("/remove/selection-refinement-native", (req, res) => {
        if (!exact(req, ["operationId", "action"].concat(definition.bindingFields))) return res.status(400).json({ ok: false });
        const input = parse(req.query);
        if (!["invoke", "status"].includes(input.action) || !state.refinementStatus(input)) return res.status(409).json({ ok: false });
        if (input.action === "invoke") {
            if (!state.invokeRefinement(input)) return res.status(409).json({ ok: false });
            return res.json({ ok: true, queued: true });
        }
        res.json({ ok: true, ...state.refinementStatus(input) });
    });
    app.get("/remove/selection-validate", async (req, res) => {
        if (!exact(req, ["operationId"].concat(definition.bindingFields))) return res.status(400).json({ ok: false });
        res.json({ ok: true, valid: await state.challengeSelection(parse(req.query)) });
    });
    app.get("/remove/selection-guard", (req, res) => {
        if (!exact(req, ["operationId", "phase", "valid"].concat(definition.bindingFields)) ||
            !["poll", "confirm"].includes(req.query.phase) || !["true", "false", "null"].includes(req.query.valid)) return res.status(400).json({ ok: false });
        const input = parse(req.query);
        const accepted = state.selectionGuard(input, req.query.phase, req.query.valid === "true" ? true : req.query.valid === "false" ? false : null);
        res.json({ ok: true, requested: req.query.phase === "poll" && accepted, accepted });
    });
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
        if (!exact(req, ["requestId"].concat(definition.bindingFields, snapshotFields, req.query.dust === undefined ? [] : ["dust"]))) return res.status(400).json({ ok: false });
        if (!state.acceptQuery(parse(req.query))) return res.status(409).json({ ok: false });
        res.json({ ok: true });
    });
    function admit(req, res, panel, repair, dust, selection) {
        if (!exact(req, ["field", "value"].concat(clientFields, repair ? ["repairToken"] : [], selection ? ["selectionToken"] : []))) return res.status(400).json({ ok: false });
        const input = parse(req.query);
        if ((input.field === "selectedSelection") !== Boolean(selection)) return res.status(400).json({ ok: false });
        state.traceRefinement("http_request", input, { route: req.path });
        if (["dustApply", "dustClose"].includes(input.field) !== Boolean(dust)) return res.status(400).json({ ok: false, error: "Invalid Dust route" });
        if (repair ? !(input.field === "selectedRepair" && ["refresh", "delete"].includes(input.value) ||
            input.field === "selectedRepairFill" && definition.fillChoices.includes(input.value) ||
            Object.hasOwn(definition.repairParameters,input.field) && definition.unit(input.value)) :
            (input.field === "selectedTool") !== panel || !definition.validValue(input.field, input.value))
            return res.status(400).json({ ok: false, error: "Invalid Remove request" });
        const command = state.admit(input.field, input.value, input);
        if (!command) {
            state.traceRefinement("http_rejected", input, { status: 409, reason: state.get(false).selection?.refinementReason || "Operation or photo/context/selection binding changed." });
            return res.status(409).json({ ok: false, error: "Remove tool, mode or context changed, or another operation is pending." });
        }
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
    app.get("/remove/dust", (req, res) => admit(req, res, false, false, true));
    app.get("/remove/selection", (req, res) => admit(req, res, false, false, false, true));
    app.get("/remove/operation-result", (req, res) => {
        const fields = ["operationId", "field", "value", "outcome", "detail", "otherPreferencesPreserved", "targetRepairToken", "repairRemovalConfirmed", "repairEditConfirmed"];
        if (!exact(req, fields.concat(definition.bindingFields, snapshotFields, req.query.dust === undefined ? [] : ["dust"],
            req.query.selectionCompletionConfirmed === undefined ? [] : ["selectionCompletionConfirmed"])) || typeof req.query.detail !== "string" ||
            req.query.detail.length > 300 || /[\x00-\x1f\x7f]/.test(req.query.detail)) return res.status(400).json({ ok: false });
        if (!state.acceptResult(parse(req.query))) return res.status(409).json({ ok: false });
        res.json({ ok: true });
    });
};
