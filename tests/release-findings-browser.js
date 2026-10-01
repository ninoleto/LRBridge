"use strict";
// Focused, isolated Controller checks for the September 29 manual findings.
// All HTTP/Lightroom feedback is simulated; never contacts a running bridge.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const browser = require("./controller-browser-lifecycle");
const grading = require("../server/color-grading");

(async () => {
    const resources = { mock: browser.createMockControllerServer({ grainOnly: true, sourceCorrectionsOnly: true }),
        browser: null, browserCdp: null, pageCdp: null, browserProfileDirectory: null };
    const fixture = resources.mock.grainFixture, remove = fixture.remove;
    const calls = [], values = { blending: 50, balance: 0 };
    let lensAmountsAvailable = false;
    const metadata = grading.getMetadata();
    const previous = fixture.handle;
    fixture.handle = (url, reply) => {
        if (url.pathname === "/api/command" && url.searchParams.get("command").startsWith("color_grading.value.")) {
            const control = url.searchParams.get("control");
            const value = url.searchParams.get("command").endsWith("reset") ? control === "blending" ? 50 : 0 : Number(url.searchParams.get("value"));
            calls.push({ control, value }); values[control] = value; reply({ ok: true }); return true;
        }
        if (url.pathname === "/api/color-grading/snapshot") {
            const parameters = Object.fromEntries(grading.getParameterIds().map(parameter => [parameter,
                { available: true, value: 0, range: /Hue/.test(parameter) ? { min: 0, max: 360 } : { min: 0, max: 100 } }]));
            for (const [control, value] of Object.entries(values)) parameters[metadata.scalarControls[control].parameter] =
                { available: true, value, range: { min: control === "balance" ? -100 : 0, max: 100 } };
            reply({ ok: true, snapshot: { id: Number(url.searchParams.get("id")), parameters, view: { available: true, value: "3-way" },
                complete: true, context: fixture.context, requestedAt: Date.now(), completedAt: Date.now() } }); return true;
        }
        if (url.pathname === "/api/lens-blur/state" && url.searchParams.get("depthOnly") === "true") {
            calls.push({ depthRead: true });
            reply({ ok: true, depthOnly: true, state: fixture.sourceCorrections.lens,
                revision: fixture.sourceCorrections.lensRevision++, context: fixture.context }); return true;
        }
        return previous(url, body => {
            if (url.pathname === "/api/feedback/snapshot") for (const id of ["LensProfileDistortionScale", "LensProfileVignettingScale"]) {
                const result = body.snapshot?.results?.[id];
                if (result) result.available = lensAmountsAvailable;
            }
            reply(body);
        });
    };
    const artifacts = process.env.LRBRIDGE_LAYOUT_ARTIFACTS || fs.mkdtempSync(path.join(require("node:os").tmpdir(), "lrbridge-findings-layout-"));
    fs.mkdirSync(artifacts, { recursive: true });
    const errors = [];
    try {
        const port = await browser.listen(resources.mock.server);
        resources.browserProfileDirectory = browser.createBrowserProfileDirectory();
        resources.browser = browser.launchBrowser(browser.findBrowserExecutable(), resources.browserProfileDirectory);
        const dev = await browser.waitForDevTools(resources.browser, resources.browserProfileDirectory);
        resources.browserCdp = await browser.connectCdp(dev.browserWebSocketUrl);
        const target = (await (await fetch(dev.debugUrl + "/json/list")).json()).find(t => t.type === "page");
        const cdp = resources.pageCdp = await browser.connectCdp(target.webSocketDebuggerUrl);
        cdp.onEvent = event => { if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails); };
        await cdp.send("Runtime.enable");
        const evaluate = async expression => {
            const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
            if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
            return result.result.value;
        };
        const waitFor = async (check, label) => {
            const end = Date.now() + 10000;
            while (!await check()) { if (Date.now() > end) throw Error("Timed out: " + label); await new Promise(r => setTimeout(r, 30)); }
        };
        const el = selector => "document.querySelector(" + JSON.stringify(selector) + ")";
        const click = selector => evaluate(el(selector) + ".click()");
        const select = async tab => { await click('[data-tab="' + tab + '"]'); await waitFor(() => evaluate("document.querySelector('.tab-button.active')?.dataset.tab === " + JSON.stringify(tab)), tab); };
        const openSections = () => evaluate("document.querySelectorAll('.collapsible-section-toggle[aria-expanded=false]').forEach(b=>b.click())");
        const capture = async (selector, name) => {
            await evaluate(el(selector) + ".scrollIntoView({block:'start'})");
            await evaluate("window.scrollBy(0,-210)"); // Clear the existing sticky Controller bars.
            await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
            assert(await evaluate(el(selector) + ".getBoundingClientRect().height>0"), "Visible capture " + selector);
            const png = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
            fs.writeFileSync(path.join(artifacts, name + ".png"), Buffer.from(png.data, "base64"));
        };
        await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" });
        await waitFor(() => evaluate("Boolean(document.querySelector('[data-tab=color-grading]'))"), "Controller loaded");
        await select("color-grading");
        const numeric = control => 'input[aria-label="' + control + ' numeric value"]';
        const enter = async (control, value) => evaluate("(()=>{const n=" + el(numeric(control)) + ";n.focus();n.value=" + JSON.stringify(String(value)) + ";n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()");
        await waitFor(() => evaluate(el(numeric("Blending")) + " && !" + el(numeric("Blending")) + ".disabled"), "Blending available");
        assert.equal(await evaluate("document.querySelector('input[type=range][aria-label=Blending]').step"), "1");
        await enter("Blending", 77.7); await waitFor(() => values.blending === 78, "numeric integer edit");
        await evaluate("(()=>{const r=document.querySelector('input[type=range][aria-label=Blending]');r.value='43';r.dispatchEvent(new Event('input'));r.dispatchEvent(new Event('change'));})()");
        await waitFor(() => values.blending === 43, "slider integer edit");
        for (const [name, control] of [["Blending", "blending"], ["Balance", "balance"]]) {
            for (const [action, delta] of [["Increase", 1], ["Decrease", -1]]) {
                const before = values[control]; await click('button[aria-label="' + action + ' ' + name + ' by 1"]');
                await waitFor(() => values[control] === before + delta, name + " step " + delta);
            }
            await enter(name, 100); await waitFor(() => values[control] === 100, name + " upper bound");
            assert.equal(await evaluate(el('button[aria-label="Increase ' + name + ' by 1"]') + ".disabled"), true);
            await enter(name, name === "Balance" ? -100 : 0);
            await waitFor(() => values[control] === (name === "Balance" ? -100 : 0), name + " lower bound");
            assert.equal(await evaluate(el('button[aria-label="Decrease ' + name + ' by 1"]') + ".disabled"), true);
            await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Reset " + name + "').click()");
            await waitFor(() => values[control] === (name === "Balance" ? 0 : 50), name + " reset route");
        }
        assert(calls.filter(c => c.control === "blending").every(c => Number.isInteger(c.value)));
        for (const width of [1280, 390, 320]) {
            await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
            assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true, "Color Grading overflow " + width);
            assert((await evaluate("Array.from(document.querySelectorAll('.cg-scalar-step')).map(b=>[b.getBoundingClientRect().width,b.getBoundingClientRect().height])")).every(([w,h])=>w>=44&&h>=44));
            await capture(".cg-scalar-actions", "grading-actions-" + width);
        }
        await select("tools"); await openSections();
        const action = name => '[data-dust-action="' + name + '"]';
        await waitFor(() => evaluate(el(action("on")) + " && !" + el(action("on")) + ".disabled"), "Dust buttons available");
        assert.equal(await evaluate("document.querySelector('[data-dust-apply]')===null"), true);
        remove.hold = true;
        remove.dust.available = false; delete remove.dust.applied; remove.revision++;
        await waitFor(() => evaluate("document.querySelector('.dust-controls').textContent.includes('Dust status unavailable. Check the Apply checkbox in Lightroom Classic.')"), "unknown Dust state");
        for (const name of ["on", "off", "reset"]) {
            await click(action(name)); await waitFor(() => remove.pending?.field === "dustApply", name + " explicit request");
            assert.equal(remove.pending.value, name === "on");
            const count = remove.calls.length; await click(action(name)); assert.equal(remove.calls.length, count);
            remove.finish(undefined, "unknown"); remove.last.detail = "Dust result unknown; check Lightroom.";
            await waitFor(() => evaluate("!removeController.isInteracting()"), "unknown releases operation");
            assert.equal(await evaluate("document.querySelector('.dust-controls').textContent.includes('Dust is On.')"), false);
        }
        assert.equal(remove.resetSpotRemovalCalls, 0);
        remove.dust.canEnable = false; remove.revision++;
        await waitFor(() => evaluate(el(action("on")) + ".disabled"), "On validation independent from Off");
        assert.equal(await evaluate(el(action("off")) + ".disabled"), false);
        remove.dust.canDisable = false; remove.revision++;
        await waitFor(() => evaluate(el(action("reset")) + ".disabled"), "Reset needs Off prerequisites");
        for (const width of [1280, 390, 320]) {
            await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
            assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true, "Tools overflow " + width);
            assert((await evaluate("Array.from(document.querySelectorAll('.dust-action-row button')).map(b=>[b.getBoundingClientRect().width,b.getBoundingClientRect().height])")).every(([w,h])=>w>=44&&h>=44));
            await capture(".dust-controls", "dust-buttons-" + width);
        }
        assert.equal(await evaluate("document.querySelector('.people-help strong').textContent"), "Cancel");
        assert.equal(await evaluate("document.querySelector('[data-masking-correction-group=Amount] .command-group-note strong').textContent"), "Reset Sliders Automatically");
        assert.equal(await evaluate("document.querySelector('[data-masking-correction=local_Hue]').nextElementSibling.querySelector('strong').textContent"), "Use Fine Adjustment");
        await select("sliders"); await openSections();
        await waitFor(() => evaluate("document.querySelector('.lens-profile-amount-row')!==null"), "Lens rows present");
        fixture.values.LensProfileEnable = 0;
        await waitFor(() => evaluate("Array.from(document.querySelectorAll('.lens-profile-amount-row')).every(r=>!r.hidden && r.querySelector('input').disabled)"), "Unavailable Lens rows stay visible");
        for (const width of [1280, 390, 320]) {
            await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
            assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true, "Develop overflow " + width);
            await capture(".lens-profile-amount-row", "lens-disabled-" + width);
        }
        fixture.values.LensProfileEnable = 1;
        lensAmountsAvailable = true;
        await evaluate("requestLiveFeedbackSnapshot(true)");
        await waitFor(() => evaluate("Array.from(document.querySelectorAll('.lens-profile-amount-row')).every(r=>!r.hidden && !r.querySelector('input').disabled)"), "Available Lens rows retain their position");
        const lens = fixture.sourceCorrections.lens;
        await waitFor(() => evaluate("!document.querySelector('input[aria-label=\"Visualize Depth\"]').disabled"), "Visualize available");
        await evaluate("document.querySelector('input[aria-label=\"Visualize Depth\"]').closest('label').click()");
        await waitFor(() => calls.some(c => c.depthRead), "targeted confirmation requested");
        assert.equal(await evaluate("document.querySelector('input[aria-label=\"Visualize Depth\"]').checked"), false);
        lens.windowsNative.visualizeDepth.value = true;
        await waitFor(() => evaluate("document.querySelector('input[aria-label=\"Visualize Depth\"]').checked"), "native read confirms Visualize");
        assert.equal(await evaluate("document.querySelector('input[aria-label=\"Auto Mask\"]').disabled"), false, "Targeted confirmation preserves unrelated controls");
        await select("tone-curve"); await openSections();
        assert.match(await evaluate("document.querySelector('.parametric-curve-note').textContent"), /Approximate preview/);
        await select("presets"); await openSections();
        await waitFor(() => evaluate("document.querySelector('.develop-preset-amount-row input[type=text]')?.disabled"), "Favorite amount unavailable");
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.develop-preset-amount-row input[type=text]')).color"), "rgb(170, 170, 170)");
        for (const width of [1280, 390, 320]) {
            await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
            assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true, "Presets overflow " + width);
            assert.equal(await evaluate("(()=>{const n=document.querySelector('.develop-preset-amount-number'),s=getComputedStyle(n),c=document.createElement('canvas').getContext('2d');c.font=s.font;return c.measureText(n.value).width<=n.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)})()"), true, "Disabled Amount remains readable at " + width);
            await capture(".develop-preset-amount-row", "favorite-disabled-" + width);
        }
        assert.deepEqual(errors, []);
        console.log("Focused Controller checks passed: integer Blending, ±1/limits/Reset, explicit Dust with unknown feedback, independent prerequisites, targeted Depth confirmation, desktop/390/320 layouts and disabled appearance (simulated). Artifacts: " + artifacts);
    } finally { await browser.cleanup(resources); }
})().catch(error => { console.error(error); process.exitCode = 1; });
