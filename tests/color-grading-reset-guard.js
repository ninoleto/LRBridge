"use strict";
// UI guard coverage only. Real Controller/touch events and production queue use
// isolated ports and SDK-state fixtures; nothing reaches Lightroom or LRBridge.
const assert = require("node:assert/strict");
const fs = require("node:fs"), http = require("node:http"), path = require("node:path");
const ui = require("../app/controller-color-grading");
const grading = require("../server/color-grading"), commands = require("../server/commands");
const browser = require("./controller-browser-lifecycle");
const root = path.resolve(__dirname, "..");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function deterministicGuardChecks() {
    assert.equal(ui.RESET_INTERACTION_DELAY_MS, 500);
    let now = 1000, nextId = 0, changes = 0;
    const timers = new Map();
    const guard = ui.createResetInteractionGuard({
        setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; },
        clearTimeout(id) { timers.delete(id); }, onChange() { changes += 1; }
    });
    function advance(ms) {
        const until = now + ms;
        for (;;) {
            const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            now = next[1].at; timers.delete(next[0]); next[1].fn();
        }
        now = until;
    }
    guard.input(); advance(499); assert(guard.isBlocked(), "499 ms still blocks Reset");
    advance(1); assert(!guard.isBlocked(), "500 ms releases the input guard");
    guard.begin("pointer:1"); guard.input(); advance(2000);
    assert(guard.isBlocked(), "A held contact stays blocked through a pause exceeding 500 ms");
    assert.equal(timers.size, 0, "Held input has no expiry timer");
    guard.begin("pointer:2"); guard.end("pointer:1"); advance(1000);
    assert(guard.isBlocked(), "One contact ending cannot release another contact");
    guard.end("pointer:2"); advance(499); assert(guard.isBlocked());
    guard.end("pointer:2"); advance(1);
    assert(!guard.isBlocked(), "Duplicate pointerup/lost-capture cannot restart cooldown");
    guard.input(); advance(400); guard.input(); advance(499); assert(guard.isBlocked());
    advance(1); assert(!guard.isBlocked(), "Actual new input restarts only this guard");
    guard.begin("field"); guard.begin("pointer:3"); guard.releaseAll(); advance(499);
    assert(guard.isBlocked(), "Window blur ends contacts, then preserves the cooldown");
    advance(1); assert(!guard.isBlocked());
    guard.input(); guard.cancel(); const before = changes; advance(1000);
    assert(!guard.isBlocked()); assert.equal(changes, before, "Cancelled context timer cannot update a later context");
    guard.begin("old-context"); guard.cancel(); guard.begin("new-context"); advance(2000);
    assert(guard.isBlocked()); guard.end("new-context"); advance(500); assert(!guard.isBlocked());
}

async function renderedChecks() {
    const renderOnly = process.argv.includes("--render-only");
    const metadata = grading.metadata, scalarIds = Object.keys(metadata.scalarControls);
    const hueIds = new Set(Object.values(metadata.regions).map(region => region.hue));
    const saturationIds = new Set(Object.values(metadata.regions).map(region => region.saturation));
    const values = Object.fromEntries(grading.getParameterIds().map(id => [id, hueIds.has(id) ? 120 : saturationIds.has(id) ? 35 : 37]));
    const unavailable = new Set(), requests = [], errors = [], snapshots = new Map(), checks = [];
    let photo = "guard-fixture-0", snapshotId = 0, holdSnapshots = false;
    const evidencePointer = path.join(root, "local-checkpoints/color-grading-reset-guard-current.txt");
    const evidenceRoot = fs.existsSync(evidencePointer) ? fs.readFileSync(evidencePointer, "utf8").trim() : null;
    const renderRoot = evidenceRoot ? path.join(evidenceRoot, "rendered-guard", new Date().toISOString().replace(/[-:.]/g, "")) : null;
    if (renderRoot) fs.mkdirSync(renderRoot, { recursive: true });
    function result(id) {
        return { id, complete: !holdSnapshots, context: { activeModule: "develop", selectedPhotoKey: photo, lastHeartbeatAt: Date.now() },
            parameters: Object.fromEntries(Object.entries(values).map(([parameter, value]) => [parameter, {
                available: !unavailable.has(parameter), value,
                range: { min: hueIds.has(parameter) || saturationIds.has(parameter) || parameter === metadata.scalarControls.blending.parameter ? 0 : -100,
                    max: hueIds.has(parameter) ? 360 : 100 }
            }])), view: { available: true, value: "3-way" } };
    }
    function reply(res, data, status = 200) { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); }
    const css = fs.readFileSync(path.join(root, "app/controller.html"), "utf8").match(/<style>([\s\S]*?)<\/style>/)[1];
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, "http://fixture");
        if (url.pathname === "/") {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            return res.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>
              <div id="status"></div><div id="content"></div><script src="/controller-color-grading.js"></script><script>
              window.controller=LRBridgeColorGrading.createController({document,window,fetch:window.fetch.bind(window),
                setStatus:message=>window.commandStatus=message,
                elements:{cgStatus:document.getElementById('status'),cgContent:document.getElementById('content'),viewButtons:[]}});
              controller.initialize();controller.activate();</script>`);
        }
        if (url.pathname === "/controller-color-grading.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end(fs.readFileSync(path.join(root, "app/controller-color-grading.js"))); }
        if (url.pathname === "/api/color-grading/metadata") return reply(res, { ok: true, colorGrading: metadata });
        if (url.pathname === "/api/color-grading/request") { const id = ++snapshotId; snapshots.set(String(id), result(id)); return reply(res, { ok: true, request: { id, requestedAt: Date.now() } }); }
        if (url.pathname === "/api/color-grading/snapshot") return reply(res, { ok: true, snapshot: snapshots.get(url.searchParams.get("id")) });
        if (url.pathname === "/api/command") {
            const command = Object.fromEntries(url.searchParams);
            for (const key of ["value", "hue", "saturation"]) if (command[key] !== undefined) command[key] = Number(command[key]);
            requests.push(command);
            if (!commands.validateCommand(command)) return reply(res, { ok: false, error: "Invalid fixture command", command }, 400);
            commands.enqueueCommand(command); return reply(res, { ok: true });
        }
        reply(res, { error: "Not found" }, 404);
    });
    const resources = { mock: { server }, browser: null, browserCdp: null, pageCdp: null, browserProfileDirectory: null };
    try {
        const url = "http://127.0.0.1:" + await browser.listen(server);
        resources.browserProfileDirectory = browser.createBrowserProfileDirectory();
        resources.browser = browser.launchBrowser(browser.findBrowserExecutable(), resources.browserProfileDirectory);
        const dev = await browser.waitForDevTools(resources.browser, resources.browserProfileDirectory);
        resources.browserCdp = await browser.connectCdp(dev.browserWebSocketUrl);
        const targets = await (await fetch(dev.debugUrl + "/json/list")).json();
        const cdp = resources.pageCdp = await browser.connectCdp(targets.find(target => target.type === "page").webSocketDebuggerUrl);
        cdp.onEvent = event => { if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails); };
        await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
        await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
        async function run(expression) {
            const reply = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
            assert(!reply.exceptionDetails, JSON.stringify(reply.exceptionDetails)); return reply.result.value;
        }
        async function wait(expression, label = expression) {
            const deadline = Date.now() + 5000;
            while (!await run(expression)) { assert(Date.now() < deadline, "Timed out: " + label); await pause(20); }
        }
        async function refresh() { await run("controller.requestSnapshot(true)"); }
        const scalar = name => `controller.state.controls[${JSON.stringify(name)}]`;
        const region = name => `controller.state.regionControls[${JSON.stringify(name)}]`;
        async function appearance(expression) {
            return run(`(()=>{const button=${expression},style=getComputedStyle(button);return{
              disabled:button.disabled,label:button.textContent,aria:button.getAttribute('aria-label'),busy:button.getAttribute('aria-busy'),
              background:style.backgroundColor,border:style.borderTopColor,color:style.color,opacity:Number(style.opacity)}})()`);
        }
        async function fresh() {
            await run("document.activeElement?.blur();controller.deactivate()"); await pause(35);
            holdSnapshots = false; unavailable.clear(); photo = "guard-fixture-" + (snapshotId + 1);
            Object.keys(values).forEach(parameter => { values[parameter] = hueIds.has(parameter) ? 120 : saturationIds.has(parameter) ? 35 : 37; });
            values[metadata.scalarControls.blending.parameter] = 50; values[metadata.scalarControls.balance.parameter] = 0;
            await run("window.commandStatus='';controller.activate()"); await refresh();
            await wait("Object.values(controller.state.controls).every(c=>c.available)");
            commands.resetQueueForTests(); requests.length = 0;
        }
        async function point(expression) {
            await cdp.send("Page.bringToFront");
            return run(`(()=>{const node=${expression};node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        }
        async function startTouch(expression) { const at = await point(expression); await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] }); return at; }
        async function finishTouch() { await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
        async function tap(expression) { await startTouch(expression); await finishTouch(); await pause(25); }
        async function regionDisabled(name, expected) {
            const state = await run(`(()=>{const card=${region(name)};return {luminance:card.luminance.reset.disabled,region:card.resetRegion.disabled,confirm:card.confirmReset.disabled}})()`);
            assert.deepEqual(state, { luminance: expected, region: expected, confirm: expected }, name + " scoped guard");
        }
        function resetRequests() { return requests.filter(command => command.command.endsWith("reset")); }
        await cdp.send("Page.navigate", { url }); await wait("!!window.controller && controller.state.hasCompleteSnapshot");
        await cdp.send("Page.bringToFront");

        if (!renderOnly) {
        // Held real touch must remain blocked during a long pause; outside release
        // ends the UI contact without adding a new SDK gesture or Reset command.
        await fresh(); await startTouch(scalar("shadow_luminance") + ".range"); await pause(650);
        await regionDisabled("shadows", true); await regionDisabled("midtones", false);
        assert.equal((await appearance(scalar("blending") + ".reset")).disabled, false);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 8, y: 8 }] }); await finishTouch();
        await pause(180); await regionDisabled("shadows", true); await pause(380); await regionDisabled("shadows", false);
        assert.equal(resetRequests().length, 0, "Cooldown expiry cannot submit or queue a Reset"); checks.push("real held scalar touch, outside release and independent region");

        await fresh(); await startTouch(scalar("shadow_luminance") + ".range");
        await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] }); await pause(180);
        await regionDisabled("shadows", true); await pause(380); await regionDisabled("shadows", false);
        await run(`(()=>{const input=${scalar("shadow_luminance")}.range;
          input.dispatchEvent(new PointerEvent('pointerdown',{pointerId:91,bubbles:true}));
          input.dispatchEvent(new PointerEvent('lostpointercapture',{pointerId:91,bubbles:true}))})()`);
        await regionDisabled("shadows", true); await pause(550); await regionDisabled("shadows", false);
        checks.push("touch cancellation and lost pointer capture");

        for (const name of Object.keys(metadata.regions)) {
            await fresh(); await startTouch(region(name) + ".wheel"); await pause(600);
            await regionDisabled(name, true); await finishTouch(); await pause(550); await regionDisabled(name, false);
            for (const property of ["hueRange", "saturationRange", "luminance.range"]) {
                await tap(region(name) + "." + property); await regionDisabled(name, true);
                await refresh(); await pause(560); await regionDisabled(name, false);
            }
        }
        checks.push("wheel and Hue/Saturation/Luminance ranges in all four regions");

        // Numeric focus owns its guard until editing ends, even with no keystroke.
        for (const [expression, name, end] of [
            [scalar("shadow_luminance") + ".number", "shadows", "Enter"],
            [region("shadows") + ".hue", "shadows", "Escape"],
            [region("shadows") + ".saturation", "shadows", "blur"]
        ]) {
            await fresh(); await run(`${expression}.focus()`); await pause(620); await regionDisabled(name, true);
            if (end === "blur") await run(`${expression}.blur()`);
            else {
                const keyCode = end === "Enter" ? 13 : 27;
                await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: end, code: end, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
                await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: end, code: end, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
            }
            await pause(160); await regionDisabled(name, true); await pause(400); await regionDisabled(name, false);
        }
        checks.push("numeric focus, Enter, Escape and blur");

        for (const name of ["blending", "balance"]) {
            await fresh(); await tap(scalar(name) + ".plus");
            assert.equal((await appearance(scalar(name) + ".reset")).disabled, true);
            assert.equal((await appearance(scalar(name === "blending" ? "balance" : "blending") + ".reset")).disabled, false);
            await regionDisabled("shadows", false); await pause(550);
            assert.equal((await appearance(scalar(name) + ".reset")).disabled, false);
            await run(`${scalar(name)}.number.focus()`); await pause(600);
            assert.equal((await appearance(scalar(name) + ".reset")).disabled, true);
            await run(`${scalar(name)}.number.blur()`); await pause(550);
            const reset = await appearance(scalar(name) + ".reset");
            assert.equal(reset.label, "Reset"); assert.equal(reset.aria, "Reset " + metadata.scalarControls[name].label);
        }
        checks.push("independent Blending/Balance buttons, numeric focus and accessible short labels");

        await fresh(); await tap(region("shadows") + ".resetRegion");
        assert.equal(await run(`${region("shadows")}.root.querySelector('.cg-inline-confirm').hidden`), false);
        await tap(region("shadows") + ".hueRange"); await tap(region("shadows") + ".confirmReset");
        assert.equal(resetRequests().length, 0, "Pre-opened confirmation cannot bypass the input cooldown");
        await pause(560); await tap(region("shadows") + ".confirmReset");
        await wait("!!window.commandStatus"); await pause(30);
        assert.equal(resetRequests().length, 1, "A later explicit Region confirmation submits once");
        assert.equal(resetRequests()[0].command, "color_grading.region.reset"); checks.push("pre-opened Region confirmation");

        // Feedback is deliberately incomplete so background reads cannot reset or
        // clear a guard, and guard expiry must not restart the active read cycle.
        await fresh(); holdSnapshots = true; await run("void controller.requestSnapshot(true)");
        await wait("controller.state.requestInFlight && controller.state.activeRequestId!==null");
        const cycle = await run("controller.state.activeRequestId"); await tap(scalar("shadow_luminance") + ".range");
        await regionDisabled("shadows", true); await tap(scalar("shadow_luminance") + ".reset"); await pause(560);
        await regionDisabled("shadows", false); assert.equal(await run("controller.state.activeRequestId"), cycle);
        assert.equal(resetRequests().length, 0, "A blocked click must not be queued or retried");
        holdSnapshots = false; snapshots.set(String(cycle), result(cycle)); await wait("!controller.state.requestInFlight");
        checks.push("active feedback cycle preserved and cooldown expiry sends no Reset");

        await fresh(); await tap(scalar("shadow_luminance") + ".range");
        unavailable.add(metadata.scalarControls.shadow_luminance.parameter); await refresh(); await pause(560);
        assert.equal((await appearance(scalar("shadow_luminance") + ".reset")).disabled, true, "SDK unavailability wins after cooldown");
        await tap(scalar("shadow_luminance") + ".reset"); assert.equal(resetRequests().length, 0);
        unavailable.clear(); await refresh(); assert.equal((await appearance(scalar("shadow_luminance") + ".reset")).disabled, false);

        await fresh(); unavailable.add(metadata.regions.shadows.hue); await refresh();
        await tap(region("shadows") + ".wheel");
        assert.equal(await run(`${region("shadows")}.resetGuard.isBlocked()`), false, "Unavailable wheel DIV does not start a UI interaction");
        assert.equal(requests.length, 0, "Unavailable wheel touch sends no edit or Reset");
        unavailable.clear(); await refresh(); await regionDisabled("shadows", false);

        await fresh(); holdSnapshots = true; await tap(scalar("shadow_luminance") + ".reset");
        await wait("!!controller.state.scalarResetIntents.shadow_luminance"); await pause(620);
        const pending = await appearance(scalar("shadow_luminance") + ".reset");
        assert.equal(pending.disabled, true); assert.equal(pending.busy, "true"); assert.equal(pending.label, "Resetting…");
        assert.equal(await run(`${scalar("shadow_luminance")}.number.value`), "37", "UI guard cannot assume the native Reset result");
        await tap(scalar("shadow_luminance") + ".reset"); assert.equal(resetRequests().length, 1);
        checks.push("SDK availability and existing owned Reset confirmation take precedence");

        await fresh(); await run(`${scalar("shadow_luminance")}.number.focus()`); await regionDisabled("shadows", true);
        photo = "new-guard-context"; await refresh(); await regionDisabled("shadows", false);
        await run(`${scalar("shadow_luminance")}.number.blur()`); await pause(550); await regionDisabled("shadows", false);
        await run(`(()=>{const input=${scalar("shadow_luminance")}.range;
          input.dispatchEvent(new PointerEvent('pointerdown',{pointerId:92,bubbles:true}));window.dispatchEvent(new Event('blur'))})()`);
        await regionDisabled("shadows", true); await pause(550); await regionDisabled("shadows", false);
        await run(`(()=>{const input=${scalar("shadow_luminance")}.range;
          input.dispatchEvent(new PointerEvent('pointerdown',{pointerId:93,bubbles:true}));controller.deactivate()})()`);
        assert.equal(await run("Object.values(controller.state.resetInteractionGuards).some(g=>g.isBlocked())"), false);
        await run("controller.activate()"); await refresh(); await pause(550); await regionDisabled("shadows", false);
        checks.push("photo context, window blur and deactivation release old UI owners");
        if (renderRoot) fs.writeFileSync(path.join(renderRoot, "functional-checks.json"), JSON.stringify({
            automatedOnly: true, nativeLightroomTest: false, scope: "UI guard interactions", checks
        }, null, 2) + "\n");
        }

        // Screenshot only this isolated Web Controller, never Lightroom/windows.
        for (const width of [1280, 390]) {
            await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
            await fresh(); await run(`${scalar("shadow_luminance")}.number.focus()`);
            const disabled = await appearance(scalar("shadow_luminance") + ".reset");
            const disabledRegion = await appearance(region("shadows") + ".resetRegion");
            assert.equal(disabled.label, "Reset Luminance"); assert.equal(disabled.busy, "false");
            assert.equal(disabled.disabled, true); assert.equal(disabledRegion.disabled, true);
            assert.equal(disabled.background, "rgb(68, 68, 68)"); assert.equal(disabledRegion.background, "rgb(68, 68, 68)");
            assert.equal(disabled.color, "rgb(187, 187, 187)"); assert.equal(disabledRegion.color, "rgb(187, 187, 187)");
            assert.equal(disabled.border, "rgb(102, 102, 102)"); assert.equal(disabledRegion.border, "rgb(102, 102, 102)");
            assert.equal(disabled.opacity, 1); assert.equal(disabledRegion.opacity, 1);
            const dimensions = await run(`(()=>{const card=${region("shadows")};card.root.scrollIntoView({block:'center'});
              return {width:innerWidth,overflow:document.documentElement.scrollWidth,
                buttons:[card.luminance.reset,card.resetRegion].map(b=>{const r=b.getBoundingClientRect();return{left:r.left,right:r.right,height:r.height}})}})()`);
            assert(dimensions.overflow <= width, "No horizontal overflow at " + width);
            assert(dimensions.buttons.every(button => button.left >= 0 && button.right <= width && button.height >= 44));
            if (renderRoot) { const picture = await cdp.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(renderRoot, "disabled-" + width + ".png"), Buffer.from(picture.data, "base64")); }
            await run(`${scalar("shadow_luminance")}.number.blur()`); await pause(560);
            const enabled = await appearance(scalar("shadow_luminance") + ".reset"), enabledRegion = await appearance(region("shadows") + ".resetRegion");
            assert.equal(enabled.disabled, false); assert(["rgb(122, 79, 36)", "rgb(138, 90, 42)"].includes(enabled.background), "Existing orange normal/hover palette restores");
            assert.equal(enabledRegion.disabled, false); assert(["rgb(74, 31, 36)", "rgb(97, 41, 50)"].includes(enabledRegion.background), "Existing dark red normal/hover palette restores");
            assert.equal(enabledRegion.color, "rgb(255, 255, 255)");
            for (const name of ["blending", "balance"]) { const short = await appearance(scalar(name) + ".reset"); assert.equal(short.label, "Reset"); assert.equal(short.aria, "Reset " + metadata.scalarControls[name].label); }
            if (renderRoot) { const picture = await cdp.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(renderRoot, "enabled-" + width + ".png"), Buffer.from(picture.data, "base64")); }
        }
        checks.push("desktop/narrow touch targets, grey disabled and restored orange/dark red styling");
        assert.deepEqual(errors, []);
        const evidence = { automatedOnly: true, nativeLightroomTest: false, pointCurveTestsRun: false, renderOnly, pureGuardDelayMs: 500, checks, widths: [1280, 390] };
        if (renderRoot) fs.writeFileSync(path.join(renderRoot, "checks.json"), JSON.stringify(evidence, null, 2) + "\n");
        console.log(renderOnly
            ? "Color Grading UI Reset guard rendering passed: deterministic 499/500 ms, desktop/narrow disabled grey, restored orange/dark red and accessible short labels."
            : "Color Grading UI Reset guard passed: deterministic 499/500 ms, actual touch/edit lifecycle, independent scopes, truthful SDK availability/confirmation and desktop/narrow appearance.");
    } finally { await browser.cleanup(resources); commands.resetQueueForTests(); }
}

deterministicGuardChecks();
renderedChecks().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
