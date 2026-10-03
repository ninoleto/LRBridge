"use strict";
// One preset case, using production Controller recovery and validators. No Lightroom edits.
const assert = require("node:assert/strict");
const presets = require("../app/controller-develop-presets");
const profile = require("../app/controller-develop-categorical");
const curves = require("../app/controller-tone-curve");
const serverCurve = require("../server/point-curve-state");
const browser = require("./controller-browser-lifecycle");
const path = require("node:path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");
const deepBlue = [2, 34, 73, 119, 139, 177, 171, 200, 255, 223];
assert.equal(serverCurve.validCurveArray(deepBlue), true,
    "Native Deep Blue coordinates must remain valid without inventing an endpoint");
assert.equal(curves.validCurveArray(deepBlue), true);
// Execute the production Lua reader with just this preset's actual curve values.
const state = lauxlib.luaL_newstate();
lualib.luaL_openlibs(state);
const script = `
local calls = {}
local sdk = { getValue = function(field)
    calls[field] = true
    if field == "ToneCurvePV2012Blue" then return { ${deepBlue.join(",")} } end
    if field == "ToneCurveName2012" then return "Custom" end
    if field == "CurveRefineSaturation" then return 100 end
    return {0,0,255,255}
end, getRange = function() return 0,100 end }
import = function(name) if name == "LrDevelopController" then return sdk end
    if name == "LrTasks" then return {pcall=pcall} end return {} end
local curve = dofile(${JSON.stringify(path.resolve(__dirname, "../lightroom/LRBridge.lrplugin/ToneCurve.lua").replace(/\\/g, "/"))})
local snapshot=curve.readSnapshot()
assert(snapshot and snapshot.name=='Custom' and snapshot.refineSaturation==100)
assert(snapshot.blueSerialized=='${deepBlue.join(",")}')
assert(calls.ToneCurvePV2012Blue and calls.ToneCurveName2012 and calls.CurveRefineSaturation,
    "Native Blue feedback must include Curve Name and Refine without endpoint rewriting")
`;
if (lauxlib.luaL_dostring(state, to_luastring(script)) !== lua.LUA_OK) {
    throw Error(to_jsstring(lua.lua_tostring(state, -1)));
}
lua.lua_close(state);
assert.equal(typeof presets.createFeedbackRecovery, "function", "Completed presets need bounded feedback recovery");

async function renderedCase() {
    const resources = { mock: browser.createMockControllerServer({ grainOnly: true,
        controllerSource: process.env.LRBRIDGE_RECOVERY_BASELINE || undefined }), browser: null,
        browserCdp: null, pageCdp: null, browserProfileDirectory: null };
    const reads = { profile: 0, pointCurve: 0 }, writes = [], errors = [];
    try {
        const port = await browser.listen(resources.mock.server), base = "http://127.0.0.1:" + port;
        const [context, categorical, curveData, presetState] = await Promise.all([
            "/api/context", "/api/develop-categorical/state", "/api/tone-curve/state", "/api/develop-presets/state"
        ].map(async route => (await fetch(base + route)).json()));
        const initialProfile = structuredClone(categorical.profile), initialCurve = structuredClone(curveData.pointCurve);
        Object.assign(presetState, { serverEpoch: "deep-blue-fixture", stateRevision: 1,
            amountFeedback: { available: false, id: null, value: null, range: null } });
        const configured = presetState.configured[0];
        Object.assign(configured, { uuid: "DB018993744D036CF59708F295EF89D3", name: "Deep Blue", folder: "Style: Film-Inspired" });
        presetState.configuration.presets[0].uuid = configured.uuid;
        presetState.cursorUuid = configured.uuid;
        const original = resources.mock.server.listeners("request")[0];
        resources.mock.server.removeListener("request", original);
        resources.mock.server.on("request", (req, res) => {
            const route = new URL(req.url, base).pathname;
            let body;
            if (route === "/api/develop-categorical/state") { reads.profile++; body = categorical; }
            else if (route === "/api/tone-curve/state") { reads.pointCurve++; body = curveData; }
            else if (route === "/api/develop-presets/state") body = presetState;
            if (/\/(?:apply|reset|command|gesture|preset)(?:\/|$)/.test(route)) writes.push(req.url);
            if (body) { res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); }
            else original(req, res);
        });
        resources.browserProfileDirectory = browser.createBrowserProfileDirectory();
        resources.browser = browser.launchBrowser(browser.findBrowserExecutable(), resources.browserProfileDirectory);
        const dev = await browser.waitForDevTools(resources.browser, resources.browserProfileDirectory);
        resources.browserCdp = await browser.connectCdp(dev.browserWebSocketUrl);
        const targets = await (await fetch(dev.debugUrl + "/json/list")).json();
        const cdp = resources.pageCdp = await browser.connectCdp(targets.find(t => t.type === "page").webSocketDebuggerUrl);
        await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
        cdp.onEvent = event => { if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.text); };
        async function run(expression) {
            const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
            if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
            return result.result.value;
        }
        async function wait(expression) {
            for (let n = 0; n < 100; n++) { if (await run(expression)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
            throw Error("Timed out: " + expression);
        }
        await cdp.send("Page.navigate", { url: base });
        await wait("typeof developSliderDefinitions !== 'undefined' && developSliderDefinitions.length > 0");
        await run("activeTab='sliders'; render();");
        await wait("profileModel.presentation().authoritativeLabel === " + JSON.stringify(initialProfile.selectedLabel));
        await wait("!developCategoricalRequestInFlight");
        await run("activeTab='tone-curve'; render();");
        await wait("pointCurveController.getState().authoritative?.available === true");
        const confirmedPath = await run("document.querySelector('.point-curve-line').getAttribute('d')");
        await run("activeTab='presets'; render();");
        await wait("developPresetController.getState()?.serverEpoch === 'deep-blue-fixture'");
        const before = { ...reads };
        categorical.profile = Object.assign(profile.unavailableProfileState(context.contextCounter, true,
            context.selectedPhotoKey, context.selectedPhotoUuid), { revision: initialProfile.revision + 1 });
        curveData.pointCurve = { available: false, selectedPhotoUuid: context.selectedPhotoUuid,
            contextCounter: context.contextCounter, developCounter: context.developCounter,
            revision: initialCurve.revision, name: null, refineSaturation: null, curves: null };
        const completedAt = Date.now();
        // Normal Profile polling can clear its live authority before the preset
        // completion arrives. Its separately retained display must still survive.
        await run("profileModel.apply(" + JSON.stringify(categorical.profile) + "); updateProfileControl();");
        presetState.lastApplication = { operationId: "deep-blue-browser", operationKind: "preset", uuid: configured.uuid,
            expectedServerEpoch: presetState.serverEpoch, expectedActiveModule: "develop",
            expectedSelectedPhotoUuid: context.selectedPhotoUuid, expectedContextCounter: context.contextCounter,
            settledSelectedPhotoUuid: context.selectedPhotoUuid, settledContextCounter: context.contextCounter,
            completedAt, outcome: "SDK call completed and covered effect observed" };
        presetState.stateRevision++;
        await run("developPresetController.refresh()");
        await new Promise(resolve => setTimeout(resolve, Math.max(0, completedAt + 8200 - Date.now())));
        const message = "Preset applied; Lightroom feedback is unavailable.";
        assert.equal(await run("document.querySelector('.develop-presets-controller-status').textContent"), message,
            "A successful preset must not conceal indefinitely missing Profile/Point Curve feedback");
        assert.deepEqual(reads, { profile: before.profile + 1, pointCurve: before.pointCurve + 1 },
            "Only one extra recovery read per source, independent of normal polling");
        await run("activeTab='sliders'; render();");
        await wait("document.querySelector('[data-develop-categorical=profile] .develop-categorical-status')?.textContent === " + JSON.stringify(message));
        assert.equal(await run("document.querySelector('[data-develop-categorical=profile] select').selectedOptions[0].textContent"), initialProfile.selectedLabel,
            "Missing feedback must retain the last authoritative Profile label, visibly unavailable");
        assert.equal(await run("profileModel.presentation().available"), false,
            "The retained label cannot become a fresh confirmation or enable writes");
        await run("activeTab='tone-curve'; render();");
        await wait("document.querySelector('.point-curve-updating')?.textContent === " + JSON.stringify(message));
        assert.equal(await run("pointCurveController.getState().authoritative"), null, "Missing curve feedback must not manufacture points");
        assert.equal(await run("document.querySelector('.point-curve-line').getAttribute('d')"), confirmedPath,
            "Tab changes must preserve the last confirmed same-photo drawing as unavailable");
        assert.equal(await run("document.querySelector('.point-curve-refine-row input[type=range]').disabled"), true,
            "Retained display must not enable an edit without current curve authority");
        assert.equal(await run("document.querySelector('.point-curve-preset-select').value"), initialCurve.name,
            "Retain the last confirmed curve name as well as its drawing and Refine value");
        // A later genuinely available SDK snapshot can recover the presentation.
        curveData.pointCurve = { ...initialCurve, updatedAt: Date.now(), revision: initialCurve.revision + 1 };
        categorical.profile = { ...initialProfile, revision: initialProfile.revision + 2 };
        await wait("document.querySelector('.point-curve-updating')?.hidden === true");
        await run("activeTab='sliders'; render();");
        await wait("document.querySelector('[data-develop-categorical=profile] .develop-categorical-status')?.textContent === " + JSON.stringify(initialProfile.selectedLabel));
        assert.deepEqual(writes, [], "Recovery must not apply, reset or edit the photo");
        assert.deepEqual(errors, []);
        console.log("Deep Blue rendered recovery: completed preset notification, one refresh, bounded Profile/Curve notice, retained authority and late readback passed (isolated Chromium fixture).");
    } finally { await browser.cleanup(resources); }
}

(async () => {
    let time = 1000, context = { activeModule: "develop", selectedPhotoUuid: "disposable", selectedPhotoKey: "disposable", contextCounter: 7, developCounter: 12 };
    const pendingTimers = new Map(), reads = [], changes = [], confirmed = [];
    let timerId = 0;
    const oldProfile = profile.unavailableProfileState(7, true, "disposable", "disposable");
    const staleCurve = { available: true, selectedPhotoUuid: "disposable", contextCounter: 7, developCounter: 12,
        updatedAt: 999, revision: 3, name: "Linear", refineSaturation: { value: 100, min: 0, max: 100 },
        curves: { rgb: [0, 0, 255, 255], red: [0, 0, 255, 255], green: [0, 0, 255, 255], blue: [0, 0, 255, 255] } };
    const recovery = presets.createFeedbackRecovery({
        getContext: () => context, now: () => time,
        setTimeout: (fn, ms) => { pendingTimers.set(++timerId, { fn, at: time + ms }); return timerId; },
        clearTimeout: id => pendingTimers.delete(id), getProfileRevision: () => 80,
        validProfile: profile.validProfileState, validCurve: curves.normalizeSnapshot,
        fetch: async url => { reads.push(url); return { ok: true, json: async () =>
            url.includes("categorical") ? { profile: oldProfile } : { pointCurve: staleCurve } }; },
        onChanged: () => changes.push(time), onConfirmed: (part, state) => confirmed.push({ part, state })
    });
    const operation = { operationId: "deep-blue-1", operationKind: "preset", uuid: "DB018993744D036CF59708F295EF89D3",
        expectedServerEpoch: "fixture", expectedActiveModule: "develop", expectedSelectedPhotoUuid: "disposable",
        expectedContextCounter: 7, settledSelectedPhotoUuid: "disposable", settledContextCounter: 7,
        completedAt: time, outcome: "SDK call completed and covered effect observed" };
    assert.equal(recovery.begin(operation), true);
    assert.equal(recovery.begin(operation), false, "Repeated operation snapshots must not refresh or extend the deadline");
    await recovery.whenRefreshed();
    assert.deepEqual(reads, ["/api/develop-categorical/state", "/api/tone-curve/state"]);
    assert.equal(recovery.message("profile"), null);
    assert.equal(recovery.message("pointCurve"), null);
    assert.deepEqual(confirmed, [], "Cached earlier curve data and unavailable Profile are not fresh confirmation");
    time = 9000;
    for (const [id, timer] of pendingTimers) if (timer.at <= time) { pendingTimers.delete(id); timer.fn(); }
    const message = "Preset applied; Lightroom feedback is unavailable.";
    assert.equal(recovery.message("profile"), message);
    assert.equal(recovery.message("pointCurve"), message);
    assert.deepEqual(reads, ["/api/develop-categorical/state", "/api/tone-curve/state"], "Timeout must not retry writes or loop extra reads");
    assert.deepEqual(staleCurve.curves.blue, [0, 0, 255, 255], "Recovery must not mutate last authoritative values");
    const freshCurve = { ...staleCurve, updatedAt: 9001 };
    assert.equal(recovery.observe("pointCurve", { ...freshCurve, developCounter: 11 }), false,
        "Older Develop feedback cannot confirm current curve state");
    assert.equal(recovery.observe("pointCurve", { ...freshCurve, curves: { ...freshCurve.curves, blue: [2,34,2,119,255,223] } }), false,
        "Malformed native feedback cannot become guessed confirmation");
    assert.equal(recovery.observe("pointCurve", { ...freshCurve, curves: { ...freshCurve.curves, blue: deepBlue } }), true,
        "Fresh native Deep Blue feedback settles recovery without endpoint rewriting");
    assert.equal(recovery.message("pointCurve"), null);
    assert.equal(recovery.message("profile"), message, "Each feedback source settles independently");
    const freshProfile = { available: true, updating: false, reason: null, revision: 81, optionSnapshotRevision: 4,
        contextCounter: 7, photoKey: "disposable", photoUuid: "disposable", processId: 1,
        browsePosition: 2, browseLabel: "Browse...", selectedToken: "profile_000000000000000000000001",
        selectedLabel: "Vintage 02", source: "Look.Name", supportsAmount: true,
        validationGeneration: 0, validationFailedGeneration: 0,
        options: [{ token: "profile_000000000000000000000001", label: "Vintage 02", position: 0, enabled: true, writable: false }] };
    assert.equal(recovery.observe("profile", { ...freshProfile, revision: 80 }), false,
        "An unchanged cached Profile revision is not proof of a new native read");
    assert.equal(recovery.observe("profile", freshProfile), true);
    assert.equal(recovery.message(), null);
    assert.equal(pendingTimers.size, 0);
    assert.deepEqual(confirmed.map(c => c.part), ["pointCurve", "profile"]);
    time = 10000;
    assert.equal(recovery.begin({ ...operation, operationId: "failed", completedAt: time, outcome: "failed" }), false);
    assert.equal(recovery.begin({ ...operation, operationId: "wrong-photo", expectedSelectedPhotoUuid: "elsewhere" }), false);
    assert.equal(reads.length, 2);
    assert.equal(recovery.begin({ ...operation, operationId: "deep-blue-2", completedAt: time }), true);
    context = { ...context, selectedPhotoUuid: "new-photo", selectedPhotoKey: "new-photo", contextCounter: 8 };
    recovery.updateContext();
    await recovery.whenRefreshed();
    assert.equal(recovery.message(), null);
    assert.equal(recovery.observe("pointCurve", freshCurve), false, "Late previous-photo feedback cannot complete the new context");
    assert.equal(pendingTimers.size, 0, "Navigation must clean the deadline");
    assert.deepEqual(confirmed.map(c => c.part), ["pointCurve", "profile"]);
    assert(changes.length >= 3);
    console.log("Deep Blue recovery: one read per source, bounded unavailable notice, no guessed values/retries, independent late confirmation and photo-context cancellation passed (simulated).");
    if (!process.argv.includes("--model-only")) await renderedCase();
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
