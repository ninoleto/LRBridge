"use strict";
// Production Controller, isolated HTTP/Lightroom fixtures. No live bridge or edits.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const browser = require("./controller-browser-lifecycle");

(async () => {
    const resources = { mock: browser.createMockControllerServer({ grainOnly: true, sourceCorrectionsOnly: true,
        controllerSource: process.env.LRBRIDGE_CONTROLLER_SOURCE }),
        browser: null, browserCdp: null, pageCdp: null, browserProfileDirectory: null };
    const fixture = resources.mock.grainFixture, ids = ["LensProfileDistortionScale", "LensProfileVignettingScale"];
    Object.assign(fixture.values, { LensProfileEnable: 0, LensProfileDistortionScale: 76, LensProfileVignettingScale: 64 });
    let available = [true, true], switchAvailable = true;
    const previous = fixture.handle, writes = [], errors = [], states = [];
    fixture.handle = (url, reply) => {
        if (["/api/set", "/api/adjust", "/api/reset", "/api/command"].includes(url.pathname)) {
            writes.push(url.pathname + url.search); reply({ ok: true }); return true;
        }
        return previous(url, body => {
            if (url.pathname === "/api/feedback/snapshot") {
                ids.forEach((id, index) => { if (body.snapshot?.results?.[id]) body.snapshot.results[id].available = available[index]; });
                if (body.snapshot?.results?.LensProfileEnable) body.snapshot.results.LensProfileEnable.available = switchAvailable;
            }
            reply(body);
        });
    };
    const artifacts = process.env.LRBRIDGE_LAYOUT_ARTIFACTS;
    if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
    try {
        const base = "http://127.0.0.1:" + await browser.listen(resources.mock.server);
        resources.browserProfileDirectory = browser.createBrowserProfileDirectory();
        resources.browser = browser.launchBrowser(browser.findBrowserExecutable(), resources.browserProfileDirectory);
        const dev = await browser.waitForDevTools(resources.browser, resources.browserProfileDirectory);
        resources.browserCdp = await browser.connectCdp(dev.browserWebSocketUrl);
        const targets = await (await fetch(dev.debugUrl + "/json/list")).json();
        const cdp = resources.pageCdp = await browser.connectCdp(targets.find(t => t.type === "page").webSocketDebuggerUrl);
        await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
        cdp.onEvent = event => { if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails); };
        async function run(expression) {
            const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
            assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value;
        }
        async function wait(expression) {
            const end = Date.now() + 8000;
            while (!await run(expression)) { assert(Date.now() < end, "Timed out: " + expression); await new Promise(r => setTimeout(r, 25)); }
        }
        async function refresh() { await run("requestLiveFeedbackSnapshot(true)"); }
        async function read() {
            return run(`(()=>({checkbox:document.querySelector('input[aria-label="Enable Profile Corrections"]').checked,
                rows:${JSON.stringify(ids)}.map(id=>{const c=developSliderControls[id];return {id,hidden:c.row.hidden,
                    values:[c.range.value,c.number.value],available:c.feedbackState,
                    controls:[c.range,c.number,c.decrement,c.increment,c.reset].map(e=>({disabled:e.matches(':disabled'),
                        background:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color,
                        width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))};})}))()`);
        }
        async function assertRows(disabled, label) {
            const state = await read();
            state.rows.forEach((row, index) => {
                assert.equal(row.hidden, false, label + " keeps " + row.id + " visible");
                assert.deepEqual(row.controls.map(c => c.disabled), Array(5).fill(disabled[index]), label + " guards every " + row.id + " control");
                if (disabled[index]) {
                    assert.equal(row.controls[1].background, "rgb(36, 36, 36)");
                    assert.equal(row.controls[1].color, "rgb(170, 170, 170)");
                    row.controls.slice(2).forEach(button => assert.equal(button.background, "rgb(68, 68, 68)", "Disabled action is gray"));
                }
            });
            states.push({ label, ...state }); return state;
        }
        async function capture(name, selector) {
            await run(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'});window.scrollBy(0,-210)`);
            await run("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
            assert(await run("document.documentElement.scrollWidth<=innerWidth"), name + " fits viewport");
            if (artifacts) {
                const png = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
                fs.writeFileSync(path.join(artifacts, name + ".png"), Buffer.from(png.data, "base64"));
            }
        }
        await cdp.send("Page.navigate", { url: base + "/#sliders" });
        await wait("typeof developSliderControls!=='undefined' && !!developSliderControls.LensProfileDistortionScale");
        await run("document.querySelectorAll('.collapsible-section-toggle[aria-expanded=false]').forEach(b=>b.click())");
        await wait("developSliderControls.LensProfileDistortionScale.authoritativeValue===76 && developSliderControls.LensProfileVignettingScale.authoritativeValue===64");
        if (process.argv.includes("--touch-only")) {
            await require("./controller-lens-amount-touch").verify({ cdp, run, wait, fixture, ids, artifacts });
            assert.deepEqual(errors, []);
            return;
        }
        // An available amount snapshot must not override the confirmed Off switch.
        await assertRows([true, true], "Off with available amount feedback");
        for (const width of [1280, 390, 320]) {
            await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
            await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: width < 760 });
            for (const enabled of [0, 1, 0]) {
                fixture.values.LensProfileEnable = enabled; await refresh();
                await wait(`document.querySelector('input[aria-label="Enable Profile Corrections"]').checked===${enabled === 1}`);
                await wait(`developSliderControls.LensProfileDistortionScale.range.matches(':disabled')===${enabled === 0}`);
                // Exercise a later individual feedback return, separate from switch feedback.
                await run("requestDevelopSliderStepFeedback(developSliderControls.LensProfileDistortionScale,false)");
                const state = await assertRows([!enabled, !enabled], (enabled ? "On available " : "Off late feedback ") + width);
                assert.deepEqual(state.rows.map(r => r.values), [["76", "76"], ["64", "64"]], "Switch gate preserves values");
                await capture("lens-" + (enabled ? "on" : "off") + "-" + width, "#lens-corrections-profile-panel");
            }
            // Includes touch pointer handlers: a disabled Reset cannot bypass the gate.
            await run(`(()=>{for(const id of ${JSON.stringify(ids)}){const c=developSliderControls[id];
                for(const button of [c.decrement,c.increment,c.reset]) button.click();
                const b=c.reset,r=b.getBoundingClientRect();
                for(const type of ['pointerdown','pointerup']) b.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,
                    pointerId:17,pointerType:'touch',isPrimary:true,button:0,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));
                c.number.focus();if(document.activeElement===c.number)throw Error('Disabled value field accepted focus');
            }})()`);
            assert.deepEqual(writes, [], "Disabled controls send no commands");
            fixture.values.LensProfileEnable = 1; available = [false, false]; await refresh();
            await wait("developSliderControls.LensProfileDistortionScale.feedbackState==='unavailable' && developSliderControls.LensProfileVignettingScale.feedbackState==='unavailable'");
            await assertRows([true, true], "On unavailable " + width);
            await capture("lens-on-unavailable-" + width, "#lens-corrections-profile-panel");
            available = [true, false]; await refresh();
            await wait("developSliderControls.LensProfileDistortionScale.feedbackState==='available'");
            await assertRows([false, true], "Individual Lightroom availability " + width);
            available = [true, true]; await refresh();
            await wait("developSliderControls.LensProfileVignettingScale.feedbackState==='available'");
        }
        switchAvailable = false; await refresh();
        await wait("document.querySelector('input[aria-label=" + JSON.stringify("Enable Profile Corrections") + "]').indeterminate");
        await assertRows([true, true], "Unknown switch retains availability guard");
        switchAvailable = true; await refresh();
        await wait("!developSliderControls.LensProfileDistortionScale.range.matches(':disabled')");
        // Keep an independent Reset capability guard when the parent becomes enabled.
        await run("developSliderControls.LensProfileDistortionScale.definition.resetSupported=false;developSliderControls.LensProfileDistortionScale.reset.disabled=true");
        fixture.values.LensProfileEnable = 0; await refresh();
        await wait("!document.querySelector('input[aria-label=" + JSON.stringify("Enable Profile Corrections") + "]').checked");
        fixture.values.LensProfileEnable = 1; await refresh();
        await wait("document.querySelector('input[aria-label=" + JSON.stringify("Enable Profile Corrections") + "]').checked");
        assert(await run("developSliderControls.LensProfileDistortionScale.reset.matches(':disabled')"), "Existing Reset guard survives parent Off/On");

        await run("document.querySelector('[data-tab=color-grading]').click()");
        await wait("!!document.querySelector('.cg-reset-region')");
        const grading = await run(`(()=>[...document.querySelectorAll('.cg-reset-region,.cg-reset')].map(b=>{
            const c=b.cloneNode(true);c.disabled=false;b.parentElement.append(c);const s=getComputedStyle(c);
            const result={label:c.textContent,bg:s.backgroundColor,color:s.color};c.disabled=true;
            result.disabled={bg:getComputedStyle(c).backgroundColor,opacity:getComputedStyle(c).opacity};c.remove();return result; }))()`);
        assert(grading.some(b => b.label === "Reset Luminance"));
        grading.forEach(b => {
            assert.equal(b.bg, b.label === "Reset Region" ? "rgb(74, 31, 36)" : "rgb(122, 79, 36)", b.label);
            assert.equal(b.color, "rgb(255, 255, 255)");
            assert.deepEqual(b.disabled, { bg: "rgb(39, 52, 66)", opacity: "0.45" }, "Existing disabled Reset style");
        });
        for (const width of [1280, 390, 320]) {
            await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
            await capture("grading-resets-" + width, ".cg-region-card");
        }
        assert.deepEqual(errors, []); assert.deepEqual(writes, []);
        if (artifacts) fs.writeFileSync(path.join(artifacts, "results.json"), JSON.stringify({ states, grading, noCommands: true }, null, 2));
        console.log("PASS Lens Amount Off/On/unavailable, late feedback, individual and Reset guards, retained values, disabled mouse/touch; dark-red Reset Region/orange Reset Luminance; 1280/390/320px. Simulated feedback only, no live Lightroom edits.");
    } finally { await browser.cleanup(resources); }
})().catch(error => { console.error(error); process.exitCode = 1; });
