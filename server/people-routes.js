"use strict";
const definition = require("./people-state");

module.exports = function installPeopleRoutes(app, state, commands, exact, number) {
    const clientFields = ["selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt", "serverEpoch", "stateRevision"];
    const snapshotFields = ["available", "reason", ...definition.fields];
    const booleans = ["available", "toolOpen", "selectionReadable", "navigationSupported", "detectSupported", "removeSupported",
        "callbackCompleted", "invoked", "inventoryChanged", "manualRepairsPreserved", "removePreferencesPreserved", "reflectionsPreserved"];
    const numbers = ["count", "selectedIndex", "expectedPeopleRevision", "expectedContextCounter", "expectedDevelopCounter",
        "expectedContextChangedAt", "contextCounter", "developCounter", "contextChangedAt", "stateRevision"];
    function parse(query) {
        return Object.fromEntries(Object.entries(query).map(([key, value]) => [key,
            value === "null" ? null : booleans.includes(key) ? value === "true" ? true : value === "false" ? false : undefined :
                numbers.includes(key) ? number(value) : value]));
    }
    app.get("/people/state", (req, res) => res.json({ ok: true, ...state.get(true) }));
    app.get("/diagnostics/people", (req, res) => {
        if (!exact(req, [])) return res.status(400).json({ ok: false, error: "Invalid request" });
        res.set("Cache-Control", "no-store").json({ ok: true, ...state.diagnostics() });
    });
    app.get("/people/next", (req, res) => res.json({ request: state.takeRequest() }));
    app.get("/people/validate", (req, res) => {
        if (!exact(req, ["operationId", ...definition.bindings])) return res.status(400).json({ ok: false });
        res.json({ valid: state.validateBinding(parse(req.query)) });
    });
    app.get("/people/query-result", (req, res) => {
        if (!exact(req, ["requestId", ...definition.bindings, ...snapshotFields])) return res.status(400).json({ ok: false });
        if (!state.acceptQuery(parse(req.query))) return res.status(409).json({ ok: false });
        res.json({ ok: true });
    });
    app.get("/people/action", (req, res) => {
        if (!exact(req, ["operationKind", ...clientFields]) || !definition.actions.includes(req.query.operationKind)) return res.status(400).json({ ok: false });
        const input = parse(req.query); state.recordActionRequest(input.operationKind, input);
        const admission = state.admitDetailed(input.operationKind, input), command = admission.command;
        if (!command) return res.status(409).json({ ok: false, error: admission.error });
        if (commands.tryEnqueueCommand(command).status !== commands.ADMISSION_ACCEPTED) {
            state.reject(command, "People request could not be queued.");
            return res.status(409).json({ ok: false, error: "People request could not be queued." });
        }
        res.json({ ok: true, ...state.get(false) });
    });
    app.get("/people/operation-result", (req, res) => {
        if (!exact(req, ["operationId", "operationKind", "outcome", "detail", "callbackCompleted", "invoked", "inventoryChanged",
            "manualRepairsPreserved", "removePreferencesPreserved", "reflectionsPreserved", ...definition.bindings, ...snapshotFields]) ||
            typeof req.query.detail !== "string" || req.query.detail.length > 300 || /[\x00-\x1f\x7f]/.test(req.query.detail)) return res.status(400).json({ ok: false });
        if (!state.acceptResult(parse(req.query))) return res.status(409).json({ ok: false });
        res.json({ ok: true });
    });
};
