"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require(process.env.LRBRIDGE_LUA_TEST_RUNTIME || "fengari");
const maskingModel = require("../server/masking-state");
const maskingUi = require("../app/controller-masking");

function luaValue(value) {
    if (typeof value !== "object") return JSON.stringify(value);
    return "{" + Object.entries(value).map(([key, child]) => "[" + JSON.stringify(key) + "]=" + luaValue(child)).join(",") + "}";
}
function runSdk(command, options = {}) {
    const runtime = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(runtime);
    const events = [];
    lua.lua_pushjsfunction(runtime, state => {
        const event = [];
        for (let index = 1; index <= lua.lua_gettop(state); index++) {
            const type = lua.lua_type(state, index);
            event.push(type === lua.LUA_TBOOLEAN ? lua.lua_toboolean(state, index) :
                type === lua.LUA_TNUMBER ? lua.lua_tonumber(state, index) : to_jsstring(lua.lua_tostring(state, index)));
        }
        events.push(event);
        return 0;
    });
    lua.lua_setglobal(runtime, to_luastring("capture"));
    // Optional immutable recovery source proves the same regression against the pre-fix code.
    const maskingSource = process.env.LRBRIDGE_MASKING_TEST_SOURCE;
    const override = maskingSource ? "package.preload.Masking = function()\n" +
        fs.readFileSync(maskingSource, "utf8") + "\nend\n" : "";
    const source = "command=" + luaValue(command) + "\nscenario=" + luaValue({ delay: 0, ...options }) + "\n" +
        override + fs.readFileSync(path.join(__dirname, "mask-point-color-confirmation.lua"), "utf8");
    try {
        if (lauxlib.luaL_dostring(runtime, to_luastring(source)) !== lua.LUA_OK) {
            throw Error(to_jsstring(lua.lua_tostring(runtime, -1)));
        }
    } finally { lua.lua_close(runtime); }
    const results = events.filter(event => event[0] === "result");
    assert.equal(results.length, 1, "one terminal result per command");
    const query = new URL(results[0][2]).searchParams;
    return { events, query, outcome: query.get("outcome"), elapsed: results[0][1],
        writes: events.filter(event => event[0] === "write"), reads: events.filter(event => event[0] === "read") };
}

// Minimal DOM double. All input, pending-value settlement, rendering and parent
// refresh handling execute the production controllers, not a behavioral model.
class Element {
    constructor(tag) {
        this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.style = {};
        this.attributes = {}; this.listeners = {}; this.className = ""; this.textContent = ""; this.value = "";
        this.classList = {add: name => { this.className += " " + name; }, toggle: () => {}};
    }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    dispatch(type) { for (const callback of this.listeners[type] || []) callback({type, target: this}); }
    setAttribute(key, value) { this.attributes[key] = String(value); }
}
function find(root, predicate) {
    if (predicate(root)) return root;
    for (const child of root.children) { const found = find(child, predicate); if (found) return found; }
    return null;
}
const flush = async () => { for (let index = 0; index < 6; index++) await new Promise(resolve => setImmediate(resolve)); };
function pointState(overrides = {}) {
    const range = {LowerNone: 0.1, LowerFull: 0.3, UpperFull: 0.7, UpperNone: 0.9};
    return {available: true, swatchCount: 2, selectedIndex: 1, selectionTransient: false,
        HueShift: 0.1, SatScale: 0.2, LumScale: -0.1, Variance: 0, RangeAmount: 0.5,
        HueRange: {...range}, SatRange: {...range}, LumRange: {...range},
        HueRangeMarker: 0.5, SatRangeMarker: 0.5, LumRangeMarker: 0.5, ...overrides};
}
function snapshot(overrides = {}) {
    return {available: true, unavailableReason: null, active: true, maskGroupCount: 2,
        hasSelectedMaskGroup: true, selectedMaskGroupIndex: 1, selectedMaskGroupId: "mask-a",
        selectedMaskHidden: false, previousAvailable: false, nextAvailable: true,
        selectedMaskToolAvailable: true, selectedMaskToolId: "tool-mask-a", selectedMaskToolHidden: false,
        selectedMaskToolCount: 1, selectedMaskToolIndex: 1, previousMaskToolAvailable: false,
        nextMaskToolAvailable: false, corrections: [], pointColor: pointState(), curves: {available: false}, ...overrides};
}
function decodedPointColor(query) {
    const values = query.get("pointColor").split(",");
    const result = {available: values[0] === "true", swatchCount: +values[1],
        selectedIndex: +values[2], selectionTransient: values[3] === "true"};
    if (values.length === 4) return result;
    assert.equal(values.length, 24);
    let offset = 4;
    for (const field of ["HueShift", "SatScale", "LumScale", "Variance", "RangeAmount"]) result[field] = +values[offset++];
    for (const field of ["HueRange", "SatRange", "LumRange"]) {
        result[field] = {};
        for (const key of ["LowerNone", "LowerFull", "UpperFull", "UpperNone"]) result[field][key] = +values[offset++];
    }
    for (const field of ["HueRangeMarker", "SatRangeMarker", "LumRangeMarker"]) result[field] = +values[offset++];
    return result;
}
async function harness(options = {}) {
    let context = {activeModule: "develop", selectedPhotoUuid: "photo-a", contextCounter: 4,
        developCounter: 7, contextChangedAt: 10};
    const model = maskingModel.createMaskingState({serverEpoch: "epoch-a"});
    const commands = [];
    let stateResponse = null;
    const host = new Element("div");
    function publish(next) {
        assert.equal(model.requestRefresh(context, true), true);
        assert.equal(model.acceptQueryResult({...model.takeRequest(), snapshot: next}, context), true);
    }
    publish(snapshot());
    const document = {createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag)};
    const controller = maskingUi.createController({document, getContext: () => context,
        pointColorCommandTimeoutMs: options.commandTimeoutMs,
        pointColorFeedbackTimeoutMs: options.feedbackTimeoutMs,
        setInterval: () => 1, clearInterval: () => {}, fetch: async request => {
            const url = new URL(request, "http://controller.test");
            let body;
            if (url.pathname === "/api/masking/state") {
                body = stateResponse || {ok: true, ...model.getPublicState()}; stateResponse = null;
            }
            else if (url.pathname === "/api/masking/presets") body = {ok: true, presets: []};
            else {
                assert.equal(url.pathname, "/api/masking/point-color/value");
                const command = model.beginEdit({kind: "pointValue", field: url.searchParams.get("field"),
                    value: +url.searchParams.get("value"), selectedIndex: +url.searchParams.get("selectedIndex"),
                    selectedMaskGroupId: url.searchParams.get("selectedMaskGroupId")}, model.getPublicState(), context);
                assert.ok(command, "production server admission");
                commands.push(command); body = {ok: true, editSequence: command.editSequence};
                if (options.admission) await options.admission(command);
            }
            return {ok: true, json: async () => body};
        }});
    controller.activate(host); await flush();
    const row = field => find(host, element => element.dataset.pointColorField === field);
    return {model, controller, commands, publish, row,
        input(field, ui) { const slider = row(field).children[1]; slider.value = String(ui); slider.dispatch("input"); },
        async release(field) { row(field).children[1].dispatch("change"); await flush(); },
        async edit(field, ui) { const slider = row(field).children[1]; slider.value = String(ui); slider.dispatch("change"); await flush(); },
        value: field => row(field).children[1].value,
        intent: field => controller.getInteractionState().pointColor.scalarIntents[field],
        status: () => find(host, element => element.className === "masking-correction-group masking-point-color").children[1].textContent,
        async refresh(next) { if (next) publish(next); await controller.refresh(); await flush(); },
        async oldResponse(value) { stateResponse = value; await controller.refresh(); await flush(); },
        async changeContext(next, nextSnapshot) {
            context = {...context, ...next}; publish(nextSnapshot);
            controller.updateContext(context); await flush();
            await controller.refresh(); await flush();
        },
        async result(command, sdk) {
            const accepted = model.acceptEditResult({...command, kind: command.command, outcome: sdk.outcome,
                detail: sdk.query.get("detail"), snapshot: snapshot({pointColor: decodedPointColor(sdk.query)})}, context);
            await controller.refresh(); await flush(); return accepted;
        },
        close: () => controller.deactivate()};
}

async function mismatch(demonstrate) {
    const h = await harness();
    try {
        await h.edit("HueShift", 30);
        const command = h.commands[0];
        const sdk = runSdk(command, {delay: 1});
        assert.equal(sdk.writes.length, 1, JSON.stringify({command, events: sdk.events}));
        assert.equal(sdk.reads.length, 12);
        assert.ok(Math.abs(sdk.elapsed - 0.6) < 1e-9, "keep the existing bounded check budget");
        assert.ok(sdk.reads.every(event => event[2] === 0.1));
        await h.refresh(snapshot());
        assert.equal(h.value("HueShift"), "30", "stale parent refresh must retain the pending request");
        assert.deepEqual([h.intent("HueShift").authoritative, h.intent("HueShift").intended], [10, 30]);
        assert.equal(sdk.outcome, demonstrate ? "confirmed" : "failed",
            "SDK-call success cannot confirm 0.30 when all 12 actual readbacks are 0.10");
        assert.equal(await h.result(command, sdk), true);
        assert.equal(h.value("HueShift"), "10");
        assert.equal(h.intent("HueShift").intended, null);
        assert.match(h.status(), demonstrate ? /superseded or normalized/ : /ERROR: Lightroom did not confirm/);
        await h.refresh(snapshot({pointColor: pointState({HueShift: 0.3})}));
        assert.equal(h.value("HueShift"), "30");
        assert.equal(h.commands.length, 1, "rendering late feedback must never resend or undo a write");
        console.log(demonstrate ?
            "PRE-FIX reproduced: one SDK write 0.30; 12 readbacks 0.10; confirmed at simulated 600 ms; production server/parent/browser display 30 -> 10 -> 30." :
            "Persistent mismatch: pending display retained until bounded failure; late authority adopted; one write, no retry.");
    } finally { h.close(); }
}
async function run() {
    const demonstrate = process.argv.includes("--demonstrate-weakness");
    await mismatch(demonstrate);
    if (demonstrate) return;
    for (const [field, ui] of [["HueShift", 30], ["HueShift", -30], ["SatScale", -25], ["LumScale", 35], ["Variance", 25], ["RangeAmount", 60]]) {
        const h = await harness();
        try {
            await h.edit(field, ui);
            const command = h.commands[0];
            const sdk = runSdk(command, {delay: 0.2});
            assert.equal(sdk.outcome, "confirmed");
            assert.equal(sdk.writes.length, 1);
            assert.equal(sdk.reads.length, 5);
            assert.equal(sdk.reads.at(-1)[2], ui / 100);
            await h.refresh(snapshot());
            assert.equal(h.value(field), String(ui));
            assert.equal(h.intent(field).intended, ui);
            assert.equal(await h.result(command, sdk), true);
            assert.equal(h.value(field), String(ui));
            assert.equal(h.intent(field).intended, null);
            assert.equal(h.commands.length, 1);
        } finally { h.close(); }
    }
    console.log("Delayed authoritative matching passed for all five mask-local scalars, including both Hue directions; unrelated swatch fields preserved.");
    {
        const h = await harness();
        try {
            await h.edit("HueShift", 30);
            const command = h.commands[0];
            const lastCheck = runSdk(command, {delay: 0.55});
            assert.equal(lastCheck.outcome, "confirmed", "a match at the existing final check must still succeed");
            assert.equal(lastCheck.reads.length, 12);
            assert.equal(lastCheck.writes.length, 1);
            for (const offset of [0.0000005, -0.0000005, 0.000002, -0.000002]) {
                const sdk = runSdk(command, {offset});
                assert.equal(sdk.outcome, Math.abs(offset) < 0.000001 ? "confirmed" : "failed");
                assert.equal(sdk.writes.length, 1);
                assert.equal(sdk.reads.length, Math.abs(offset) < 0.000001 ? 1 : 12);
            }
            for (const failure of ["sdkFailure", "sdkError"]) {
                const sdk = runSdk(command, {[failure]: true});
                assert.equal(sdk.outcome, "failed");
                assert.equal(sdk.writes.length, 1, "SDK failure must not trigger a retry");
            }
            for (const change of ["photo", "mask", "swatch"]) {
                const before = runSdk(command, {switch: change, switchBefore: true});
                assert.equal(before.outcome, "stale", change + " changed before execution");
                assert.equal(before.writes.length, 0);
                const during = runSdk(command, {delay: 0.2, switch: change});
                assert.equal(during.outcome, "failed", change + " changed while awaiting readback");
                assert.equal(during.writes.length, 1, "context change must not redirect or repeat the original write");
            }
        } finally { h.close(); }
    }
    console.log("Numeric tolerance, out-of-tolerance rejection, SDK failures and photo/mask/swatch guards passed.");
    {
        const h = await harness();
        try {
            await h.edit("HueShift", 30); await h.edit("HueShift", 40); await h.edit("HueShift", 50);
            assert.equal(h.commands.length, 1);
            const first = h.commands[0];
            const firstResult = runSdk(first, {delay: 0.2});
            await h.refresh(snapshot());
            assert.equal(h.value("HueShift"), "50", "old refresh cannot overwrite a newer intent");
            assert.equal(await h.result(first, firstResult), true);
            assert.deepEqual(h.commands.map(command => command.value), [0.3, 0.5]);
            assert.equal(h.value("HueShift"), "50");
            assert.equal(h.intent("HueShift").intended, 50);
            const oldState = {ok: true, ...h.model.getPublicState()};
            assert.equal(await h.result(first, firstResult), false, "duplicate/older results must be rejected");
            assert.equal(h.value("HueShift"), "50");
            const secondResult = runSdk(h.commands[1], {delay: 0.2, initial: {HueShift: 0.3}});
            assert.equal(await h.result(h.commands[1], secondResult), true);
            await h.oldResponse(oldState);
            assert.equal(h.value("HueShift"), "50", "parent must reject an older completed fetch");
            assert.equal(h.intent("HueShift").intended, null);
            assert.deepEqual([...firstResult.writes, ...secondResult.writes].map(event => event[2]), [0.3, 0.5],
                "exactly one SDK write for each submitted target, no duplicate/backward write");
            assert.equal(h.commands.length, 2);
        } finally { h.close(); }
    }
    for (const change of ["photo", "develop", "mask", "swatch"]) {
        const h = await harness();
        try {
            await h.edit("HueShift", 30); await h.edit("HueShift", 40);
            const oldState = {ok: true, ...h.model.getPublicState()};
            const pc = pointState({HueShift: -0.2, selectedIndex: change === "swatch" ? 2 : 1});
            const next = snapshot({pointColor: pc, ...(change === "mask" ? {
                selectedMaskGroupId: "mask-b", selectedMaskGroupIndex: 2, previousAvailable: true,
                nextAvailable: false, selectedMaskToolId: "tool-mask-b"} : {})});
            if (change === "photo" || change === "develop") {
                await h.changeContext(change === "photo" ? {selectedPhotoUuid: "photo-b", contextCounter: 5,
                    contextChangedAt: 11} : {developCounter: 8}, next);
            } else await h.refresh(next);
            assert.equal(h.value("HueShift"), "-20", change + " must adopt its own authoritative state");
            assert.equal(h.intent("HueShift").intended, null);
            assert.equal(h.controller.getInteractionState().pointColor.awaitingCount, 0);
            await h.oldResponse(oldState);
            assert.equal(h.value("HueShift"), "-20", "old parent response must not revive the previous selection");
            assert.equal(h.commands.length, 1, "queued old-context edit must not execute");
        } finally { h.close(); }
    }
    console.log("Newer edits, coalescing, stale parent responses and photo/Develop/mask/swatch invalidation passed. Automated SDK/DOM doubles only; no native acceptance implied.");
}
module.exports = { harness, runSdk, snapshot, pointState, flush };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
