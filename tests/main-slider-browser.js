"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const browser = require("./controller-browser-lifecycle");

// Production DOM/events against a disposable HTTP fixture. Never contacts Lightroom.
(async () => {
    const resources = { mock: browser.createMockControllerServer({ grainOnly: true }), browser: null,
        browserProfileDirectory: null, pageCdp: null, browserCdp: null };
    const writes = [], errors = [];
    try {
        const fixture = resources.mock.grainFixture;
        Object.assign(fixture.values, { Contrast: 0, Exposure: 0, SaturationAdjustmentGreen: 0,
            SaturationAdjustmentAqua: 0, GrainAmount: 0, PostCropVignetteAmount: 0 });
        const previous = fixture.handle;
        fixture.handle = (url, reply) => {
            if (url.pathname === "/api/set") {
                writes.push({ slider: url.searchParams.get("slider"), value: Number(url.searchParams.get("value")) });
                reply({ ok: true }); // Admission only; retain the pre-edit SDK values until explicitly applied below.
                return true;
            }
            return previous(url, reply);
        };
        if (process.env.LRBRIDGE_CONTROLLER_SOURCE) {
            const handler = resources.mock.server.listeners("request")[0];
            resources.mock.server.removeListener("request", handler);
            resources.mock.server.on("request", (req, res) => {
                if (req.url === "/") { res.setHeader("Content-Type", "text/html"); res.end(fs.readFileSync(process.env.LRBRIDGE_CONTROLLER_SOURCE)); }
                else handler(req, res);
            });
        }
        const base = "http://127.0.0.1:" + await browser.listen(resources.mock.server);
        resources.browserProfileDirectory = browser.createBrowserProfileDirectory();
        resources.browser = browser.launchBrowser(browser.findBrowserExecutable(), resources.browserProfileDirectory);
        const dev = await browser.waitForDevTools(resources.browser, resources.browserProfileDirectory);
        resources.browserCdp = await browser.connectCdp(dev.browserWebSocketUrl);
        const targets = await (await fetch(dev.debugUrl + "/json/list")).json();
        const cdp = resources.pageCdp = await browser.connectCdp(targets.find(t => t.type === "page").webSocketDebuggerUrl);
        await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
        cdp.onEvent = m => { if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text); };
        async function run(expression) {
            const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
            if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
            return result.result.value;
        }
        async function wait(expression) {
            for (let n = 0; n < 100; n++) {
                if (await run(expression)) return;
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw Error("Timed out: " + expression);
        }
        await cdp.send("Page.navigate", { url: base });
        await wait("typeof developSliderDefinitions !== 'undefined' && developSliderDefinitions.length > 0");
        await run("activeTab='sliders'; render();");
        await wait("developSliderControls.Contrast?.authoritativeValue === 0");
        for (const pair of [[["Contrast", 29], ["Exposure", 1]],
            [["SaturationAdjustmentGreen", 35], ["SaturationAdjustmentAqua", 17]],
            [["PostCropVignetteAmount", -24], ["GrainAmount", 18]]]) {
            const before = writes.length;
            for (const [id, value] of pair) {
                await run(`(async()=>{const c=developSliderControls[${JSON.stringify(id)}];
                    await requestDevelopSliderStepFeedback(c,false);
                    c.number.focus(); c.number.value=${JSON.stringify(String(value))};
                    c.number.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
                await wait(`!developSliderControls[${JSON.stringify(id)}].requestInFlight`);
                // Revisiting the numeric field without changing it must not cancel the pending edit.
                await run(`(()=>{const n=developSliderControls[${JSON.stringify(id)}].number;
                    n.dispatchEvent(new FocusEvent('focus')); n.dispatchEvent(new FocusEvent('blur'));})()`);
                await run(`requestDevelopSliderStepFeedback(developSliderControls[${JSON.stringify(id)}],false)`);
                assert.deepEqual(await run(`(()=>{const c=developSliderControls[${JSON.stringify(id)}];return [c.localValue,c.confirmationPending];})()`),
                    [value, true], "a no-op numeric blur and later pre-edit read must retain the pending value: " + id);
            }
            assert.deepEqual(writes.slice(before), pair.map(([slider, value]) => ({ slider, value })), "exactly one write per deliberate edit");
            for (const [id, value] of pair) fixture.values[id] = value;
            for (const [id, value] of pair) {
                await run(`requestDevelopSliderStepFeedback(developSliderControls[${JSON.stringify(id)}],false)`);
                assert.deepEqual(await run(`(()=>{const c=developSliderControls[${JSON.stringify(id)}];return [c.localValue,c.confirmationPending];})()`), [value, false]);
            }
        }
        for (const width of [1280, 390, 320]) {
            await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
            await run(`(()=>{const state=developCategoricalModel.getState();state.selectedToolAvailable=true;state.selectedTool='upright';
                developCategoricalModel.apply(state,developCategoricalModel.getRevision()+1);updateDevelopCategoricalControls();})()`);
            const ui = await run(`(()=>{const b=developCategoricalControls.uprightTool.button, style=getComputedStyle(b);
                const notes=Array.from(document.querySelectorAll('.lens-blur-experimental-note'));
                return {text:b.textContent,bg:style.backgroundColor,color:style.color,pressed:b.getAttribute('aria-pressed'),
                    notes:notes.map(n=>({html:n.innerHTML,previous:n.previousElementSibling.textContent.trim(),
                        fits:n.getBoundingClientRect().width <= innerWidth})),
                    overflow:document.documentElement.scrollWidth>innerWidth};})()`);
            assert.equal(ui.text, "Close Upright Tool"); assert.equal(ui.pressed, "true");
            assert.equal(ui.bg, "rgb(116, 47, 58)"); assert.equal(ui.color, "rgb(255, 255, 255)");
            assert.equal(ui.overflow, false, "page fits at " + width);
            assert.equal(ui.notes.length, 2);
            assert(ui.notes.every(n => n.fits));
            assert.match(ui.notes[0].html, /^<strong>Experimental:<\/strong> Subject Focus and Point \/ Area Focus use Windows automation\./);
            assert.match(ui.notes[1].html, /<strong>Experimental:<\/strong> Brush Refinement/);
            assert.match(ui.notes[1].html, /<strong>\+ New Refinement<\/strong>/);
            assert.match(ui.notes[1].previous, /(?:Open|Close) Brush Refinement/);
            await run(`(()=>{const state=developCategoricalModel.getState();state.selectedTool='loupe';
                developCategoricalModel.apply(state,developCategoricalModel.getRevision()+1);updateDevelopCategoricalControls();})()`);
            assert.deepEqual(await run("[developCategoricalControls.uprightTool.button.textContent,developCategoricalControls.uprightTool.button.classList.contains('command-danger')]"), ["Open Upright Tool", false]);
            console.log("Upright red/white Close and Lens Blur notes fit at " + width + "px (mock browser).");
        }
        assert.deepEqual(errors, []);
        console.log("Basic, Green/Aqua and Effects pending edits survive no-op blur and newer pre-edit polls; exact writes and SDK-only confirmation passed (mock browser).");
    } finally { await browser.cleanup(resources); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
