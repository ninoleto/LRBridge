"use strict";
// Actual Controller DOM and production command queue; isolated Lightroom fixture.
// No requests reach a running LRBridge instance or Lightroom.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const browser = require("./controller-browser-lifecycle");
const grading = require("../server/color-grading");
const commands = require("../server/commands");
const root = path.join(__dirname, "..");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    const metadata = grading.metadata;
    const controls = Object.keys(metadata.scalarControls);
    const resetDefault = control => control === "blending" ? 50 : 0;
    const values = Object.fromEntries(grading.getParameterIds().map(id => [id, 0]));
    let photo = "disposable-fixture-photo", snapshotId = 0, holdReset = false, holdSet = false, rejectReset = false, holdSnapshots = false;
    const heldResets = [], heldSets = [], requests = [], writes = [], snapshots = new Map(), errors = [], unavailable = new Set();
    function reply(res, body, code = 200) {
        res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(body));
    }
    function snapshot(id) {
        return { id, complete: !holdSnapshots, context: { activeModule: "develop", selectedPhotoKey: photo },
            parameters: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, {
                available: !unavailable.has(id), value, range: { min: /Hue$/.test(id) ? 0 : -100, max: /Hue$/.test(id) ? 360 : 100 }
            }])), view: { available: true, value: "3-way" } };
    }
    const style = fs.readFileSync(path.join(root, "app/controller.html"), "utf8").match(/<style>([\s\S]*?)<\/style>/)[1];
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, "http://127.0.0.1");
        if (url.pathname === "/") {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            return res.end(`<!doctype html><style>${style}</style><div id="status"></div><div id="content"></div>
                <script src="/controller-color-grading.js"></script><script>
                window.controller=LRBridgeColorGrading.createController({document,window,fetch:(url,options)=>{
                    if(window.blockNextScalarFetch && url.includes('color_grading.value.set')){
                        window.blockNextScalarFetch=false;window.blockedFetchCount=(window.blockedFetchCount||0)+1;
                        return new Promise((resolve,reject)=>setTimeout(()=>reject(Error('Uncertain admission fixture')),40));
                    }return fetch(url,options);},
                    setStatus:text=>window.lastStatus=text,
                    elements:{cgStatus:document.getElementById('status'),cgContent:document.getElementById('content'),viewButtons:[]}});
                // Keep legacy engine-ordering cases independent of the new UI
                // cooldown; its real interaction coverage lives in the guard test.
                window.clearResetGuardsForEngineFixture=()=>Object.values(controller.state.resetInteractionGuards||{}).forEach(g=>g.cancel());
                controller.initialize();controller.activate();</script>`);
        }
        if (url.pathname === "/controller-color-grading.js") {
            res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
            return res.end(fs.readFileSync(process.env.LRBRIDGE_COLOR_GRADING_SOURCE || path.join(root, "app/controller-color-grading.js")));
        }
        if (url.pathname === "/api/color-grading/metadata") return reply(res, { ok: true, colorGrading: metadata });
        if (url.pathname === "/api/color-grading/request") {
            const id = ++snapshotId; snapshots.set(String(id), snapshot(id));
            return reply(res, { ok: true, request: { id, requestedAt: Date.now() } });
        }
        if (url.pathname === "/api/color-grading/snapshot") return reply(res, { ok: true, snapshot: snapshots.get(url.searchParams.get("id")) });
        if (url.pathname === "/api/command") {
            const command = Object.fromEntries(url.searchParams);
            for (const key of ["value", "hue", "saturation"]) if (command[key] !== undefined) command[key] = Number(command[key]);
            requests.push(command);
            if (!commands.validateCommand(command)) return reply(res, { error: "Actual Controller command did not validate", command }, 400);
            if (command.command.endsWith("reset") && rejectReset) return reply(res, { ok: false }, 409);
            const admit = () => { commands.enqueueCommand(command); reply(res, { ok: true }); };
            if (command.command === "color_grading.value.set" && holdSet) { heldSets.push(admit); return; }
            commands.enqueueCommand(command);
            if (command.command.endsWith("reset") && holdReset) { heldResets.push(() => reply(res, { ok: true })); return; }
            return reply(res, { ok: true });
        }
        reply(res, { error: "Not found" }, 404);
    });
    const resources = { mock: { server }, browser: null, browserCdp: null, pageCdp: null, browserProfileDirectory: null };
    function drain() {
        for (let command; (command = commands.getNextCommand());) {
            if (command.command === "color_grading.wheel.set") {
                for (const property of ["hue", "saturation"]) {
                    const parameter = metadata.regions[command.region][property]; values[parameter] = command[property];
                    writes.push({ ...command, parameter, resultingValue: values[parameter] });
                }
                continue;
            }
            if (command.command === "color_grading.region.reset") {
                Object.entries(metadata.regions[command.region]).filter(([key]) => key !== "label").forEach(([, parameter]) => {
                    values[parameter] = 0; writes.push({ ...command, parameter, resultingValue: 0 });
                });
                continue;
            }
            const parameter = metadata.scalarControls[command.control].parameter;
            // SDK fixture: exact metadata mapping, one reset, no Hue/Saturation writes.
            values[parameter] = command.command === "color_grading.value.reset" ? resetDefault(command.control) : command.value;
            writes.push({ ...command, parameter, resultingValue: values[parameter] });
        }
    }
    try {
        const base = "http://127.0.0.1:" + await browser.listen(server);
        resources.browserProfileDirectory = browser.createBrowserProfileDirectory();
        resources.browser = browser.launchBrowser(browser.findBrowserExecutable(), resources.browserProfileDirectory);
        const dev = await browser.waitForDevTools(resources.browser, resources.browserProfileDirectory);
        resources.browserCdp = await browser.connectCdp(dev.browserWebSocketUrl);
        const targets = await (await fetch(dev.debugUrl + "/json/list")).json();
        const cdp = resources.pageCdp = await browser.connectCdp(targets.find(t => t.type === "page").webSocketDebuggerUrl);
        cdp.onEvent = event => { if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails); };
        await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
        async function run(expression) {
            const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
            assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value;
        }
        async function wait(expression) {
            const end = Date.now() + 7000;
            while (!await run(expression)) { assert(Date.now() < end, "Timed out: " + expression); await pause(20); }
        }
        async function refresh() { await run("controller.requestSnapshot(true)"); }
        async function display(control) { return run(`Number(controller.state.controls[${JSON.stringify(control)}].number.value)`); }
        async function resetAppearance(control, resetting) {
            const appearance = await run(`(()=>{const b=controller.state.controls[${JSON.stringify(control)}].reset;
                return {disabled:b.disabled,label:b.textContent,busy:b.getAttribute('aria-busy')}})()`);
            assert.equal(appearance.disabled, resetting, "Reset availability must reflect its existing owned intent");
            assert.equal(appearance.busy === "true", resetting);
            assert.match(appearance.label, resetting ? /^Resetting…$/ :
                control === "blending" || control === "balance" ? /^Reset$/ : /^Reset /);
        }
        async function clear(control, value = 37) {
            commands.resetQueueForTests(); requests.length = writes.length = 0;
            values[metadata.scalarControls[control].parameter] = value;
            await run("controller.deactivate();controller.activate()"); await refresh();
            await wait(`controller.state.controls[${JSON.stringify(control)}].value===${value}`);
        }
        async function tap(control) {
            const point = await run(`(()=>{const b=controller.state.controls[${JSON.stringify(control)}].reset;
                b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
            await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
            await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
            await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
            await pause(30);
        }
        await cdp.send("Page.navigate", { url: base });
        await wait("!!window.controller && controller.state.hasCompleteSnapshot");
        for (const control of controls) {
            await clear(control); await resetAppearance(control, false); await tap(control);
            await resetAppearance(control, true); drain(); await refresh();
            await wait(`Number(controller.state.controls[${JSON.stringify(control)}].number.value)===${resetDefault(control)}`);
            assert.equal(requests.filter(c => c.command.endsWith("reset")).length, 1, control + " one idle tap submits one Reset");
            assert.equal(writes[0].parameter, metadata.scalarControls[control].parameter, "Reset targets its own region");
            assert.equal(await display(control), resetDefault(control), "Only SDK fixture feedback supplies the Reset value: " + await run("JSON.stringify({status:lastStatus,confirmations:controller.state.resetConfirmations,revision:controller.state.localRevision,pending:controller.state.pendingSince})"));
            await resetAppearance(control, false);
        }
        const control = "shadow_luminance", key = JSON.stringify(control);
        await clear(control);
        holdSnapshots = true;
        await tap(control);
        await resetAppearance(control, true);
        await wait("controller.state.requestInFlight && controller.state.activeRequestId!==null");
        const originalConfirmation = await run("controller.state.activeRequestId");
        await tap(control); await tap(control); await tap(control);
        assert.equal(requests.filter(c => c.command.endsWith("reset")).length, 1,
            "Repeated taps must retain the first owned Reset instead of queuing redundant resets and replacing confirmation");
        assert.equal(await display(control), 37, "Pending Reset still displays the SDK-confirmed value, not assumed zero");
        assert.equal(await run("controller.state.activeRequestId"), originalConfirmation,
            "Repeated taps must not abort the snapshot containing the first Reset result");
        drain(); holdSnapshots = false;
        snapshots.set(String(originalConfirmation), snapshot(originalConfirmation));
        await wait(`Number(controller.state.controls[${key}].number.value)===0`);

        await clear(control); holdReset = true;
        await tap(control); await resetAppearance(control, true); await tap(control);
        assert.equal(requests.filter(c => c.command.endsWith("reset")).length, 1,
            "Repeated tap during HTTP admission must keep the original Reset");
        holdReset = false; heldResets.splice(0).forEach(release => release());
        drain(); await pause(40); await refresh(); assert.equal(await display(control), 0);
        await resetAppearance(control, false);

        // Render the same existing pending state at desktop and touch widths.
        await clear(control); holdReset = true; await tap(control);
        for (const width of [1280, 390]) {
            await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
            const rendered = await run(`(()=>{const b=controller.state.controls[${key}].reset;b.scrollIntoView({block:'center'});
                const r=b.getBoundingClientRect(),s=getComputedStyle(b);
                return {height:r.height,left:r.left,right:r.right,width:innerWidth,overflow:document.documentElement.scrollWidth,
                    opacity:Number(s.opacity),background:s.backgroundColor}})()`);
            await resetAppearance(control, true);
            assert(rendered.height >= 44 && rendered.left >= 0 && rendered.right <= width, "Reset stays a visible touch target");
            assert(rendered.overflow <= width, "Pending Reset must not cause horizontal overflow");
            assert.equal(rendered.background, "rgb(68, 68, 68)", "Disabled Reset uses explicit grey styling");
            assert.notEqual(rendered.background, "rgb(122, 79, 36)", "Pending Reset cannot keep enabled orange styling");
            if (process.env.LRBRIDGE_RESET_RENDER_DIR) {
                fs.mkdirSync(process.env.LRBRIDGE_RESET_RENDER_DIR, { recursive: true });
                const picture = await cdp.send("Page.captureScreenshot", { format: "png" });
                fs.writeFileSync(path.join(process.env.LRBRIDGE_RESET_RENDER_DIR, "reset-pending-" + width + ".png"), Buffer.from(picture.data, "base64"));
            }
        }
        holdReset = false; heldResets.splice(0).forEach(release => release()); drain(); await refresh();
        await wait(`!controller.state.controls[${key}].reset.disabled`);
        await resetAppearance(control, false);

        await clear(control);
        await run(`controller.state.controls[${key}].number.focus()`);
        unavailable.add(metadata.scalarControls[control].parameter); await refresh();
        assert.equal(await run(`controller.state.controls[${key}].reset.disabled`), true,
            "Unavailable SDK feedback must disable Reset even during numeric editing");
        await tap(control); assert.equal(requests.length, 0, "Disabled unavailable touch sends no command");
        unavailable.clear(); await refresh(); await run("clearResetGuardsForEngineFixture()"); await resetAppearance(control, false);
        await run(`controller.state.controls[${key}].number.blur()`);

        await clear(control); await tap(control);
        await run(`(()=>{const c=controller.state.controls[${key}];c.range.value=51;c.range.dispatchEvent(new Event('change'));clearResetGuardsForEngineFixture();c.reset.click()})()`);
        await pause(60); drain(); await refresh();
        assert.equal(requests.filter(c => c.command.endsWith("reset")).length, 2,
            "A newer genuine adjustment retires deduplication and permits another explicit Reset");
        assert.equal(await display(control), 0);
        await clear(control);
        holdReset = true;
        await run(`(()=>{const c=controller.state.controls[${key}];c.range.value=64;c.range.dispatchEvent(new Event('input'));clearResetGuardsForEngineFixture();c.reset.click()})()`);
        await pause(180); drain();
        assert.equal(values[metadata.scalarControls[control].parameter], 0,
            "An older unsent slider timer must not execute after Reset admission");
        holdReset = false; heldResets.splice(0).forEach(release => release()); await pause(40); await refresh();
        assert.equal(await display(control), 0);

        await clear(control); holdReset = true;
        values[metadata.regions.shadows.hue] = 84; values[metadata.regions.shadows.saturation] = 26; await refresh();
        await run("(()=>{const card=controller.state.regionControls.shadows;card.resetRegion.click();card.root.querySelector('.cg-inline-confirm button').click()})()");
        await pause(40); drain();
        await run(`(()=>{const c=controller.state.controls[${key}];c.range.value=72;c.range.dispatchEvent(new Event('input'))})()`);
        holdReset = false; heldResets.splice(0).forEach(release => release()); await pause(190); drain(); await refresh();
        assert.equal(await display(control), 72, "New luminance survives a delayed Region acceptance");
        assert.equal(await run("controller.state.regionControls.shadows.value.hue"), 0, "Unsuperseded wheel receives confirmed Region Reset feedback");
        assert.equal(await run("!!controller.state.pendingSince.shadows"), false);

        await clear(control); holdSet = true;
        await run(`(()=>{const c=controller.state.controls[${key}];c.range.value=31;c.range.dispatchEvent(new Event('change'));
            const card=controller.state.regionControls.shadows;clearResetGuardsForEngineFixture();card.resetRegion.click();card.root.querySelector('.cg-inline-confirm button').click();
            card.hueRange.value=92;card.hueRange.dispatchEvent(new Event('change'))})()`);
        await pause(40); holdSet = false; heldSets.splice(0).forEach(release => release()); await pause(100); drain(); await refresh();
        assert.equal(values[metadata.regions.shadows.hue], 92, "New wheel edit reaches SDK fixture after Region Reset admission");
        assert.equal(await display(control), 0, "Unsuperseded luminance still settles after newer wheel input");

        await clear(control); holdSet = true;
        await run(`(()=>{const c=controller.state.controls[${key}];c.range.value=51;c.range.dispatchEvent(new Event('change'));clearResetGuardsForEngineFixture();c.reset.click()})()`);
        await pause(50); holdSet = false; heldSets.splice(0).forEach(release => release());
        await pause(60); drain(); await refresh();
        assert.equal(values[metadata.scalarControls[control].parameter], 0, "Reset follows an already submitted Set, even when Set admission is slow");
        assert.equal(await display(control), 0);

        await clear(control); holdReset = true;
        await run(`controller.state.controls[${key}].reset.click()`); await pause(30); drain();
        await run(`(()=>{const c=controller.state.controls[${key}];c.range.value=72;c.range.dispatchEvent(new Event('input'))})()`);
        holdReset = false; heldResets.splice(0).forEach(release => release());
        await pause(190); drain(); await refresh();
        assert.equal(values[metadata.scalarControls[control].parameter], 72, "Late Reset acceptance cannot cancel a newer adjustment timer");
        assert.equal(await display(control), 72, "Late Reset confirmation cannot replace the newer value");

        await clear(control);
        await tap(control);
        // No SDK execution yet: returned older values cannot act as Reset confirmation.
        values[metadata.scalarControls[control].parameter] = 15; await refresh();
        assert.equal(await display(control), 37, "Keep the displayed value while Reset awaits its correct parameter feedback");
        assert(await run(`!!controller.state.resetConfirmations[${key}]`), "Stale feedback leaves Reset pending");
        drain(); await refresh(); assert.equal(await display(control), 0);

        await clear(control); rejectReset = true; await tap(control); rejectReset = false;
        drain(); await refresh(); assert.equal(writes.length, 0, "Rejected Reset makes no fixture SDK write");
        await resetAppearance(control, false);
        assert.equal(await display(control), 37, "Rejection cannot display optimistic zero");
        assert.match(await run("window.lastStatus"), /ERROR/);
        await tap(control); drain(); await refresh();
        assert.equal(await display(control), 0, "A failed admission releases the owned Reset so a later explicit tap can work");

        await clear(control); rejectReset = true;
        await run(`(()=>{const c=controller.state.controls[${key}];c.range.value=64;c.range.dispatchEvent(new Event('input'));clearResetGuardsForEngineFixture();c.reset.click()})()`);
        await pause(180); rejectReset = false; drain(); await refresh();
        assert.equal(writes.length, 0, "Rejected Reset cancels the unsent edit without sending another command");
        assert.equal(await display(control), 37, "Rejected Reset releases its unsent display intent to fresh SDK state");

        await clear(control); holdSet = true;
        await run(`(()=>{const c=controller.state.controls[${key}];c.range.value=41;c.range.dispatchEvent(new Event('change'));
            c.range.value=52;c.range.dispatchEvent(new Event('change'));const card=controller.state.regionControls.shadows;
            clearResetGuardsForEngineFixture();card.resetRegion.click();card.root.querySelector('.cg-inline-confirm button').click()})()`);
        await pause(40); holdSet = false; heldSets.splice(0).forEach(release => release()); await pause(100);
        drain(); await refresh();
        assert.equal(values[metadata.scalarControls[control].parameter], 0, "Reset Region stays after pending luminance writes");
        assert.equal(writes.at(-1).command, "color_grading.region.reset");
        assert.equal(await display(control), 0);

        await clear(control); holdReset = true; await tap(control); drain();
        photo = "another-fixture-photo"; values[metadata.scalarControls[control].parameter] = -26; await refresh();
        holdReset = false; heldResets.splice(0).forEach(release => release()); await pause(40); await refresh();
        assert.equal(await display(control), -26, "Late Reset response cannot confirm or replace another photo's value");
        assert.equal(await run("Object.keys(controller.state.resetConfirmations).length"), 0);

        await clear(control);
        await run(`(()=>{window.blockNextScalarFetch=true;const c=controller.state.controls[${key}];c.range.value=44;c.range.dispatchEvent(new Event('change'));clearResetGuardsForEngineFixture();c.reset.click()})()`);
        await pause(100);
        assert.equal(await run("window.blockedFetchCount"), 1, "One uncertain admission attempt");
        assert.deepEqual(requests, [], "Uncertain Set admission does not send Reset past the unknown outcome or retry the Set");
        assert.match(await run("window.lastStatus"), /acceptance could not be confirmed/);
        assert.deepEqual(errors, []);
        console.log("Color Grading scalar Reset browser/production queue regression passed: one touch/four luminance regions + Blending/Balance, unsent/in-flight Sets, newer adjustment, stale feedback, rejected pending intent, Reset Region ordering, changed photo, uncertain admission/no retry.");
    } finally {
        heldSets.splice(0).forEach(release => release()); heldResets.splice(0).forEach(release => release());
        await browser.cleanup(resources); commands.resetQueueForTests();
    }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
