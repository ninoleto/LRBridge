"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { lua, lauxlib, lualib, to_luastring } = require("fengari");
const native = require("../server/windows-lightroom-native");
const ui = require("../app/controller-lens-blur");
const { createBridge } = require("../server/bridge");

// Execute the actual Lua sender, then its real HTTP receiver and controller model. SDK/native values are mocks.
function sdkUrls() {
    const source = fs.readFileSync(path.join(__dirname, "../lightroom/LRBridge.lrplugin/LensBlur.lua"), "utf8");
    const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
    try {
        const code = `
local urls, value, fail = {}, nil, false
local imports = {
    LrDevelopController = {
        getValue = function(name) if name == "LensBlurActive" then if fail then error("SDK unavailable") end; return value end end,
        getSelectedLensBlurBokeh = function() return nil end,
        getSelectedTool = function() return "loupe" end
    },
    LrApplication = { activeCatalog = function() return { getTargetPhoto = function() return nil end } end },
    LrTasks = { pcall = pcall },
    LrHttp = { get = function(url) urls[#urls+1] = url; return "ok" end }
}
import = function(name) return imports[name] or {} end
local lens = assert(load(${JSON.stringify(source)}))()
for _, current in ipairs({false, true, 0, 1, "false"}) do value=current; lens.sendCurrentState() end
value=nil; lens.sendCurrentState()
fail=true; lens.sendCurrentState()
return table.concat(urls, "\\n")`;
        if (lauxlib.luaL_dostring(L, to_luastring(code)) !== lua.LUA_OK) throw Error(lua.lua_tojsstring(L, -1));
        return lua.lua_tojsstring(L, -1).split("\n");
    } finally { lua.lua_close(L); }
}

async function run() {
    let nativeState = { ...native.unavailableNativeState(), available: true, reason: null };
    let holdRead = null;
    const backend = { ...native.createUnavailableWindowsBackend(), readState: async () => {
        if (holdRead) await holdRead();
        return nativeState;
    } };
    const bridge = createBridge({ httpPort: 0, wsPort: 0, windowsNativeBackend: backend });
    await bridge.start();
    const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    const urls = sdkUrls();
    async function read(sdkIndex, checkbox) {
        nativeState = { ...nativeState, apply: checkbox };
        const url = new URL(urls[sdkIndex]);
        const reply = await fetch(base + url.pathname + url.search);
        assert.equal(reply.status, 200);
        const data = await (await fetch(base + "/lens-blur/state")).json();
        const model = ui.createModel(); model.applyAuthoritative(data.state);
        return { data, model, shown: ui.presentationFor(model.get()) };
    }
    try {
        for (const [index, value] of [[0, false], [1, true]]) {
            const { data, shown } = await read(index, { available: true, value: !value });
            assert.equal(data.state.activeAvailable, true);
            assert.equal(data.state.active, value, "Lua -> HTTP -> server must preserve boolean false and true");
            assert.equal(shown.applyOffSelected, !value);
            assert.equal(shown.applyOnSelected, value, "SDK booleans take precedence over native fallback");
        }
        for (const index of [2, 3, 4, 5, 6]) {
            for (const value of [false, true]) {
                const { data, shown, model } = await read(index, { available: true, value });
                assert.equal(data.state.activeAvailable, false);
                assert.equal(data.state.active, null, "Missing/malformed SDK data must stay missing");
                assert.equal(shown.applyAvailable, true);
                assert.equal(shown.applyOffSelected, !value);
                assert.equal(shown.applyOnSelected, value);
                model.applyWindowsNative({ ...nativeState, apply: { available: true, value: !value } });
                assert.equal(ui.presentationFor(model.get()).applyOnSelected, value,
                    "A command response cannot overwrite Apply from its context-bound poll");
            }
            for (const checkbox of [undefined, null, {}, { available: false, value: false },
                { available: true, value: null }, { available: true, value: 0 }, { available: true, value: "false" }]) {
                const { shown } = await read(index, checkbox);
                assert.equal(shown.applyAvailable, false);
                assert.equal(shown.applyOffSelected, false, "Unknown is never confirmed Off");
                assert.equal(shown.applyOnSelected, false);
            }
        }
        for (const change of ["photo", "develop"]) {
            await fetch(base + "/context/update?activeModule=develop&selectedPhotoKey=photo-a&selectedPhotoUuid=photo-a&developFingerprint=first");
            nativeState.apply = { available: true, value: false };
            let release, entered;
            const started = new Promise(resolve => { entered = resolve; });
            holdRead = () => { entered(); return new Promise(resolve => { release = resolve; }); };
            const response = fetch(base + "/lens-blur/state");
            await started;
            const photo = change === "photo" ? "photo-b" : "photo-a";
            await fetch(base + "/context/update?activeModule=develop&selectedPhotoKey=" + photo + "&selectedPhotoUuid=" + photo + "&developFingerprint=changed");
            holdRead = null; release();
            const data = await (await response).json();
            assert.equal(data.state.windowsNative.apply.available, false, "Native Apply read from an old " + change + " context is discarded");
            assert.equal(ui.presentationFor(data.state).applyAvailable, false);
        }
        assert.deepEqual(native.CHECKBOX_CONTROLS, ["visualizeDepth", "autoMask"], "Apply gains no native writer");
        console.log("Lens Blur Apply feedback: production Lua/HTTP false and true, verified native fallback, unknown and command-response guards passed (simulated).");
    } finally { await bridge.stop(); }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
