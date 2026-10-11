"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");
const runtimeRoot = process.env.LRBRIDGE_POINT_COLOR_TEST_ROOT || path.resolve(__dirname, "..");
const pluginRoot = process.env.LRBRIDGE_POINT_COLOR_PLUGIN_ROOT || path.join(runtimeRoot, "lightroom/LRBridge.lrplugin");
const controller = require(path.join(runtimeRoot, "app/controller-point-color")), masking = require(path.join(runtimeRoot, "app/controller-masking"));
const commands = require(path.join(runtimeRoot, "server/commands")), context = require(path.join(runtimeRoot, "server/context"));
const { createBridge } = require(path.join(runtimeRoot, "server/bridge"));

class Element {
    constructor(tag) {
        this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.style = {};
        this.attributes = {}; this.listeners = {}; this.className = ""; this.textContent = "";
        this.value = ""; this.disabled = false; this.classList = {
            toggle: (key, on) => { const parts = new Set(this.className.split(/\s+/));
                if (on) parts.add(key); else parts.delete(key); this.className = [...parts].join(" "); },
            add: key => this.classList.toggle(key, true)
        };
    }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    click() { if (!this.disabled) (this.listeners.click || []).forEach(fn => fn({ target: this })); }
    select() {}
}
const document = { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) };
const all = element => [element, ...element.children.flatMap(all)];
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
const range = { LowerNone: 0.1, LowerFull: 0.3, UpperFull: 0.7, UpperNone: 0.9 };
const state = (count = 8, index = 1) => ({ available: true, swatchCount: count, selectedIndex: index,
    selectionTransient: index === 0 && count > 0, HueShift: 0.27, SatScale: -0.18, LumScale: 0.11,
    Variance: 0.14, RangeAmount: 0.6, HueRange: {...range}, SatRange: {...range}, LumRange: {...range},
    HueRangeMarker: 0.5, SatRangeMarker: 0.5, LumRangeMarker: 0.5 });
const owner = { selectedPhotoUuid: "photo-a", contextCounter: 2, developCounter: 3,
    contextChangedAt: 4, serverEpoch: "epoch-a", selectedMaskGroupId: "mask-a", maskingRevision: 9 };
const key = binding => binding && [binding.serverEpoch, binding.selectedPhotoUuid, binding.contextCounter,
    binding.developCounter, binding.contextChangedAt, binding.selectedMaskGroupId].join("|");

async function ui() {
    for (const scope of ["global", "mask"]) {
        const host = new Element("div"), calls = [], timers = new Map(); let timer = 0, admit;
        const prefix = scope === "mask" ? "/api/masking/point-color" : "/api/point-color";
        const ui = controller.createController({ document, routePrefix: prefix, externalState: true,
            showSwatches: true, bindingKey: key,
            bindingQuery: scope === "mask" ? masking.pointColorBindingQuery : () => "",
            selectionBindingQuery: scope === "mask" ? masking.pointColorBindingQuery : binding =>
                new URLSearchParams(Object.fromEntries(Object.entries(binding).filter(([key]) =>
                    !["selectedMaskGroupId", "maskingRevision"].includes(key)))),
            requestCommand: url => { calls.push(url); return new Promise(resolve => { admit = resolve; }); },
            setTimeout: fn => { timers.set(++timer, fn); return timer; }, clearTimeout: id => timers.delete(id) });
        const buttons = () => all(host).filter(e => e.dataset.pointColorSample);
        const selected = () => buttons().filter(e => e.attributes["aria-pressed"] === "true").map(e => e.textContent);
        const field = () => all(host).find(e => e.dataset.pointColorField === "HueShift");
        ui.applyContext(owner); ui.applyAuthoritative(state(), owner); ui.mount(host);
        assert.deepEqual(buttons().map(e => e.textContent), ["1", "2", "3", "4", "5", "6", "7", "8"]);
        assert.deepEqual(selected(), ["1"]);
        for (const index of [8, 7, 6, 5, 4, 3, 2, 1]) {
            buttons()[index - 1].click();
            const parsed = new URL(calls.at(-1), "http://test");
            assert.equal(parsed.pathname, prefix + "/sample"); assert.equal(parsed.searchParams.get("selectedIndex"), String(index));
            assert.equal(parsed.searchParams.get("selectedPhotoUuid"), owner.selectedPhotoUuid);
            assert.equal(parsed.searchParams.get("serverEpoch"), owner.serverEpoch);
            if (scope === "mask") assert.equal(parsed.searchParams.get("selectedMaskGroupId"), "mask-a");
            assert(buttons().every(e => e.disabled));
            const previous = selected(); admit({ok: true}); await flush();
            assert.deepEqual(selected(), previous, "HTTP admission is not selection confirmation");
            ui.applyAuthoritative({available: true, swatchCount: 8, selectedIndex: 0, selectionTransient: true}, owner);
            assert.deepEqual(selected(), []); assert(field(), "Transient zero retains the previous controls");
            assert.equal(ui.getState().state.HueShift, 0.27);
            ui.applyAuthoritative(state(8, index), owner);
            assert.deepEqual(selected(), [String(index)]); assert(buttons().every(e => !e.disabled));
        }
        ui.applyAuthoritative(state(3, 2), owner);
        assert.deepEqual(buttons().map(e => e.disabled), [false, false, false, true, true, true, true, true]);
        const count = calls.length; buttons()[7].click(); assert.equal(calls.length, count);
        const picker = all(host).find(e => e.id === "pointColorPickerSelect");
        assert(picker.className.includes("point-color-picker"));
        assert.equal(picker.children[0].tagName, "SVG"); assert.equal(picker.children[0].attributes["aria-hidden"], "true");
        picker.click(); assert.equal(calls.at(-1), prefix + "/tool/select", "Picker API action remains unchanged");
        admit({ok: true}); await flush();
        buttons()[0].click(); const oldAdmission = admit;
        const newer = {...owner, selectedPhotoUuid: "photo-b", contextCounter: 3};
        ui.applyContext(newer); oldAdmission({ok: true}); await flush();
        assert.equal(ui.applyAuthoritative(state(8, 1), owner), false);
        assert(buttons().every(e => e.disabled)); assert.deepEqual(selected(), []);
        ui.applyAuthoritative(state(0, 0), newer); assert.equal(buttons().length, 8);
        assert(buttons().every(e => e.disabled));
        ui.applyAuthoritative(state(2, 1), newer); buttons()[1].click(); admit({ok: true}); await flush();
        for (const fn of [...timers.values()]) fn();
        assert.equal(ui.isBusy(), false, "Missing confirmation ends with a bounded unconfirmed outcome");
        ui.unmount();
    }
    // A refresh begun on photo A must not apply its response to photo B.
    let finish; const ui = controller.createController({document, bindingKey: key,
        requestState: () => new Promise(resolve => { finish = resolve; })});
    ui.applyContext(owner); const pending = ui.refresh();
    ui.applyContext({...owner, selectedPhotoUuid: "photo-b"}); finish(state());
    assert.equal(await pending, false); assert.equal(ui.getState().state.available, false); ui.unmount();
    console.log("PASS: global/mask 1–8, missing samples, authoritative confirmation, transient zero, picker action, photo ownership, timeout");
}

function sdk() {
    const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
    const run = source => { if (lauxlib.luaL_dostring(L, to_luastring(source)) !== lua.LUA_OK) throw Error(to_jsstring(lua.lua_tostring(L, -1))); };
    const set = (name, value) => { lua.lua_pushstring(L, to_luastring(value)); lua.lua_setglobal(L, to_luastring(name)); };
    const get = name => { lua.lua_getglobal(L, to_luastring(name)); const value = lua.lua_isnil(L, -1) ? null : to_jsstring(lua.lua_tostring(L, -1)); lua.lua_pop(L, 1); return value; };
    set("pluginRoot", pluginRoot.replaceAll("\\", "/"));
    run(fs.readFileSync(path.join(__dirname, "point-color-swatches.lua"), "utf8"));
    return {run, set, get, close: () => lua.lua_close(L)};
}
async function integration() {
    const bridge = createBridge({httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1", shutdownGraceMs: 20});
    await bridge.start(); const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port, native = sdk();
    const get = async (url, status = 200) => { const response = await fetch(base + url); const text = await response.text();
        assert.equal(response.status, status, url + " " + text); return JSON.parse(text); };
    try {
        commands.resetQueueForTests();
        await get("/context/update?activeModule=develop&selectedPhotoUuid=photo-a&developFingerprint=swatches-a");
        let publicState = await get("/point-color/state"), binding = publicState.context;
        native.set("contextJson", JSON.stringify(publicState)); native.run("publish()");
        const deliver = async () => { const url = new URL(native.get("resultUrl")); return get(url.pathname + url.search); };
        await deliver(); assert.equal((await get("/point-color/state")).contextOwned, true);
        const select = index => "/point-color/sample?" + new URLSearchParams({...binding, selectedIndex: index});
        for (const index of [8, 2, 7, 1]) {
            await get(select(index));
            const next = await get("/next"); assert.equal(next.command.command, "point_color.sample.select");
            native.set("commandJson", JSON.stringify(next)); native.run("execute(); assert(selectedIndex == " + index + ")");
            await deliver(); const result = await get("/point-color/state"); assert.equal(result.state.selectedIndex, index);
        }
        for (const index of [0, 9, "2.5", "02"]) await get(select(index), 400);
        await get(select(2) + "&selectedIndex=3", 400);
        await get(select(2) + "&unexpected=true", 400);
        await get(select(2).replace("photo-a", "other-photo"), 409);
        await get(select(2).replace(binding.serverEpoch, "old-epoch"), 409);
        // The actual /next envelope is strictly parsed, and late SDK ownership changes refuse selection.
        await get(select(3)); const queued = await get("/next"); native.set("commandJson", JSON.stringify(queued));
        for (const mode of ["photo-http", "photo-read", "epoch", "shutdown"]) {
            native.set("scenario", mode); native.run("selectedPhoto = photo; _G.LRBridgePollingLifecycle = {}; resultUrl = nil; local n = selections; execute(); assert(selections == n)");
        }
        native.set("scenario", ""); native.run("selectedPhoto = photo; _G.LRBridgePollingLifecycle = {}");
        native.set("commandJson", JSON.stringify(queued).replace('"selectedIndex":3', '"selectedIndex":3,"selectedIndex":4'));
        native.run("assert(Parser.parse(commandJson) == nil)");
        await get(select(4));
        await get("/context/update?activeModule=develop&selectedPhotoUuid=photo-b&developFingerprint=swatches-b");
        assert.equal((await get("/next")).command, null, "Queued old-photo selection is discarded");
        const oldResult = new URL(native.get("savedResultUrl")); await get(oldResult.pathname + oldResult.search, 409);
        assert.equal((await get("/point-color/state")).contextOwned, false);
        console.log("PASS: actual HTTP admission → /next → Parser → Commands → SDK → owned state; stale queue/native/result rejection");
    } finally { native.close(); await bridge.stop(); }
}
(async () => { await ui(); await integration(); })().catch(error => { console.error(error); process.exitCode = 1; });
