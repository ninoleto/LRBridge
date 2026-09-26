"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const browser = require("./controller-browser-lifecycle");
(async () => {
    const resources = { mock: browser.createMockControllerServer({ grainOnly: true }), browser: null,
        browserCdp: null, pageCdp: null, browserProfileDirectory: null };
    const errors = [];
    try {
        const port = await browser.listen(resources.mock.server);
        resources.browserProfileDirectory = browser.createBrowserProfileDirectory();
        resources.browser = browser.launchBrowser(browser.findBrowserExecutable(), resources.browserProfileDirectory);
        const dev = await browser.waitForDevTools(resources.browser, resources.browserProfileDirectory);
        resources.browserCdp = await browser.connectCdp(dev.browserWebSocketUrl);
        const targets = await (await fetch(dev.debugUrl + "/json/list")).json();
        const cdp = resources.pageCdp = await browser.connectCdp(targets.find(t => t.type === "page").webSocketDebuggerUrl);
        await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
        cdp.onEvent = m => { if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text); };
        async function run(expression) {
            const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
            if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
            return r.result.value;
        }
        async function wait(expression) {
            for (let i = 0; i < 100; i++) { if (await run(expression)) return; await new Promise(r => setTimeout(r, 50)); }
            throw Error("Timed out: " + expression);
        }
        for (const width of [1280, 390, 320]) {
            await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
            await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + port });
            await wait("typeof developSliderDefinitions !== 'undefined' && developSliderDefinitions.length > 0");
            await run("activeTab='sliders'; render();");
            await wait("!!document.querySelector('[data-develop-section=detail] .develop-subheading')");
            assert.deepEqual(await run("Array.from(document.querySelectorAll('[data-develop-section=detail] .develop-subheading')).map(e=>e.textContent)"),
                ["Enhancement", "Sharpening", "Manual Noise Reduction", "Luminance", "Color"]);
            assert.deepEqual(await run("Array.from(document.querySelectorAll('[data-develop-section=effects] .develop-subheading')).map(e=>e.textContent)"), ["Post-Crop Vignetting", "Grain"]);
            assert.equal(await run("document.querySelector('.hdr-visualize-note strong').textContent"), "Visualize HDR");
            assert.match(await run("document.querySelector('.develop-treatment-button').nextElementSibling.textContent"), /B&W|Color|Black|Treatment|Awaiting/);
            for (const id of ["detail", "effects", "hdr-sdr-rendition", "lens-blur"]) {
                const bounds = await run(`(()=>{const e=document.querySelector('[data-develop-section=${id}]');e.scrollIntoView();return Array.from(e.querySelectorAll('input,button,.develop-subheading,.command-group-note,.lens-blur-experimental-note')).filter(n=>n.getClientRects().length&&!n.closest('[hidden]')).map(n=>({text:n.textContent.slice(0,60),left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right}));})()`);
                for (const b of bounds) assert(b.left >= -1 && b.right <= width + 1, JSON.stringify({ width, id, ...b }));
                if (process.env.LRBRIDGE_LAYOUT_ARTIFACTS && ["detail", "effects"].includes(id)) {
                    fs.mkdirSync(process.env.LRBRIDGE_LAYOUT_ARTIFACTS, { recursive: true });
                    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
                    fs.writeFileSync(path.join(process.env.LRBRIDGE_LAYOUT_ARTIFACTS, `${id}-${width}.png`), Buffer.from(shot.data, "base64"));
                }
            }
            await run("activeTab='tone-curve'; render();");
            assert.deepEqual(await run("Array.from(document.querySelectorAll('[data-slider-id]')).map(e=>e.dataset.sliderId).filter(id=>/^Parametric(Highlights|Lights|Darks|Shadows)$/.test(id))"),
                ["ParametricHighlights", "ParametricLights", "ParametricDarks", "ParametricShadows"]);
            await run("activeTab='tools'; render();");
            await wait("!!document.querySelector('.masking-tool-limitations')");
            assert.match(await run("document.querySelector('.masking-tool-limitations').textContent"), /Radial Gradient Feather; and Color Range Refine/);
            assert.equal(await run("document.querySelector('.masking-tool-limitations').previousElementSibling.classList.contains('masking-component-invert-button')"), true);
            assert.match(await run("document.querySelector('.red-eye-help').textContent"), /Pupil Size and Darken/);
            assert(await run("document.documentElement.scrollWidth <= innerWidth"), "Tools overflow at " + width);
            await run("activeTab='selection'; render();");
            assert.match(await run("document.querySelector('#clipboardCopyHelp').textContent"), /Quick Copy is not required/);
            assert.match(await run("document.querySelector('#clipboardPasteHelp').textContent"), /process AI edits/);
            assert(await run("document.documentElement.scrollWidth <= innerWidth"), "Selection overflow at " + width);
        }
        assert.deepEqual(errors, []);
        console.log("Release presentation checks passed at 1280/390/320px: Detail/Effects groups, Tone Curve order, HDR emphasis, B&W label, Copy/Paste, Red Eye and Masking notices; no overflow or browser exceptions (mock).");
    } finally { await browser.cleanup(resources); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
