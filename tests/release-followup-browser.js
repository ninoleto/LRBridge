"use strict";
// Focused CSS review and Parametric split-flow diagnosis with production browser
// code. All feedback is synthetic; no live bridge/Lightroom or photo edits.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const browser = require("./controller-browser-lifecycle");
const curve = require("../app/controller-tone-curve");
const keys = Object.values(curve.PARAMETRIC_CURVE_FIELDS);
const splitIds = keys.slice(4);
const helper = "If Masking opens in Lightroom Classic but the controls here remain unavailable, select a mask in Lightroom Classic. If that does not help, click Close Masking in this Web Controller. Then click the same button again when it shows Open Masking.";

(async () => {
    const resources = { mock: browser.createMockControllerServer({ grainOnly: true, sourceCorrectionsOnly: true }),
        browser: null, browserCdp: null, pageCdp: null, browserProfileDirectory: null };
    const fixture = resources.mock.grainFixture, artifacts = process.env.LRBRIDGE_FOLLOWUP_ARTIFACTS;
    const errors = [], modelCases = [], layouts = [];
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
        const waitFor = async expression => {
            const end = Date.now() + 9000;
            while (!await evaluate(expression)) { if (Date.now() > end) throw Error("Timed out: " + expression); await new Promise(r => setTimeout(r, 20)); }
        };
        const select = async tab => {
            await evaluate(`document.querySelector('[data-tab="${tab}"]').click()`);
            await waitFor(`document.querySelector('.tab-button.active')?.dataset.tab==='${tab}'`);
            await evaluate("document.querySelectorAll('.collapsible-section-toggle[aria-expanded=false]').forEach(b=>b.click())");
        };
        const viewport = async width => {
            await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
            await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: width < 760 });
            await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
            assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true, "No overflow at " + width);
        };
        const capture = async (selector, name) => {
            if (!artifacts) return;
            fs.mkdirSync(artifacts, { recursive: true });
            await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'});window.scrollBy(0,-210)`);
            await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
            const png = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
            fs.writeFileSync(path.join(artifacts, name + ".png"), Buffer.from(png.data, "base64"));
        };
        await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + port });
        await waitFor("!!document.querySelector('[data-tab=color-grading]')");
        await select("sliders");
        await waitFor("!!document.querySelector('.lens-blur-experimental-note')");
        const noticeStyle = "e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,color:s.color,border:s.borderLeftColor,borderWidth:s.borderLeftWidth,padding:s.padding,lineHeight:s.lineHeight};}";
        const expectedNotice = await evaluate(`(${noticeStyle})(document.querySelector('.lens-blur-experimental-note'))`);
        await select("tools");
        await waitFor("!!document.querySelector('.masking-panel-help')");
        assert.equal(await evaluate("document.querySelector('.masking-panel-help').textContent"), helper);
        assert.equal(await evaluate("document.querySelector('.masking-panel-help').previousElementSibling.className"), "masking-panel-row");
        assert.deepEqual(await evaluate("[...document.querySelectorAll('.masking-panel-help strong')].map(e=>({text:e.textContent,weight:getComputedStyle(e).fontWeight}))"),
            [{text:"Close Masking",weight:"700"},{text:"Open Masking",weight:"700"}]);
        for (const width of [1280, 390, 320]) {
            await viewport(width);
            const actual = await evaluate(`(${noticeStyle})(document.querySelector('.masking-panel-help'))`);
            assert.deepEqual(actual, expectedNotice, "Masking notice matches existing Focus Range notice");
            layouts.push({ width, notice: actual });
            await capture(".masking-panel-row", "masking-notice-" + width);
        }
        if (process.argv.includes("--note-only")) {
            assert.deepEqual(errors, []);
            assert.equal(fixture.mutations.length, 0);
            console.log("PASS exact Masking recovery wording, bold Close/Open labels, unchanged amber appearance and placement; 1280/390/320px without overflow or edits. Synthetic browser only.");
            return;
        }
        await select("color-grading");
        await waitFor("[...document.querySelectorAll('.cg-reset')].some(b=>b.textContent==='Reset Blending'&&!b.disabled)");
        const resetStyle = await evaluate(`(()=>{
            const rows=[...document.querySelectorAll('.cg-reset,.cg-reset-region,.cg-inline-confirm button.command-danger')];
            return rows.map(b=>{
                const enabled=b.cloneNode(true);enabled.disabled=false;b.parentNode.appendChild(enabled);
                const s=getComputedStyle(enabled);const result={label:b.textContent,bg:s.backgroundColor,border:s.borderColor};
                enabled.disabled=true;const d=getComputedStyle(enabled);
                result.disabled={bg:d.backgroundColor,border:d.borderColor,opacity:d.opacity};enabled.remove();return result;
            });
        })()`);
        assert(resetStyle.some(b => b.label === "Reset Blending") && resetStyle.some(b => b.label === "Reset Balance"));
        for (const button of resetStyle) {
            assert.equal(button.bg, button.label === "Reset Region" ? "rgb(74, 31, 36)" : "rgb(122, 79, 36)", button.label + " uses its Reset background");
            assert.equal(button.border, button.label === "Reset Region" ? "rgb(115, 52, 61)" : "rgb(155, 101, 48)");
            assert.deepEqual(button.disabled, button.label === "Reset"
                ? { bg: "rgb(116, 47, 58)", border: "rgb(154, 68, 82)", opacity: "0.45" }
                : { bg: "rgb(39, 52, 66)", border: "rgb(59, 75, 92)", opacity: "0.45" },
            "Preserve previous disabled palette/opacity for " + button.label);
        }
        for (const width of [1280, 390, 320]) {
            await viewport(width);
            await capture(".cg-scalar-section", "grading-resets-" + width);
            await capture(".cg-region-card", "grading-region-reset-" + width);
        }
        console.log("PASS notice wording/location and exact Focus Range amber treatment; all Color Grading Reset styles including Blending/Balance and confirmation, original disabled palettes; desktop/390/320 layouts.");

        // Keep four tone adjustments and the linear RGB base fixed while changing
        // only the three SDK-percentage split values through actual HTTP feedback.
        await select("tone-curve");
        await waitFor("!!parametricCurveGraphPath&&!!pointCurveController.getState().authoritative");
        for (const tones of [[60, -35, -20, -10], [100, -64, -58, -44]]) {
            for (const splits of [[25, 50, 75], [10, 20, 75], [45, 60, 85], [20, 55, 90]]) {
                const values = Object.fromEntries(keys.map((key, index) => [key, [...tones, ...splits][index]]));
                Object.assign(fixture.values, values);
                await evaluate("requestLiveFeedbackSnapshot(true)");
                await waitFor(`JSON.stringify(collectParametricCurveValues(false))===${JSON.stringify(JSON.stringify(values))}`);
                const received = await evaluate(`(()=>{
                    updateParametricCurveGraph();
                    return {values:collectParametricCurveValues(false),display:collectParametricCurveValues(true),
                        path:parametricCurveGraphPath.getAttribute('d'),rgb:authoritativeParametricPointCurve().rgbCurve,
                        markers:[...document.querySelectorAll('.parametric-curve-split-line')].map(e=>Number(e.getAttribute('x1'))),
                        tracks:${JSON.stringify(splitIds)}.map(id=>{const c=developSliderControls[id];return {id,min:c.range.min,max:c.range.max,value:c.range.value};})};
                })()`);
                assert.deepEqual(received.values, values); assert.deepEqual(received.display, values);
                assert.deepEqual(received.rgb, [0, 0, 255, 255]);
                assert.deepEqual(received.markers, splits.map(value => value * 2.55), "Percent-to-SVG conversion once, in shadow/midtone/highlight order");
                assert.deepEqual(received.tracks.map(item => [item.min, item.max, Number(item.value)]), splits.map(value => ["0", "100", value]));
                assert.equal(received.path, curve.parametricCurvePathData(values, received.rgb));
                const stale = await evaluate(`(()=>{
                    const before=collectParametricCurveValues(false),path=parametricCurveGraphPath.getAttribute('d');
                    const c=developSliderControls.ParametricMidtoneSplit;
                    applyFeedbackSnapshot({results:{ParametricMidtoneSplit:{id:c.feedbackRequestFloor.id-1,available:true,value:50,range:{min:20,max:80}}}});
                    updateParametricCurveGraph();return {values:collectParametricCurveValues(false),path:parametricCurveGraphPath.getAttribute('d'),before,previousPath:path};
                })()`);
                assert.deepEqual(stale.values, stale.before); assert.equal(stale.path, stale.previousPath, "Older feedback does not replace the current split");
                const anchors = curve.parametricResponseAnchors(curve.normalizeParametricCurveValues(values));
                const samples = curve.parametricCurveSamples(values, received.rgb);
                const decreases = samples.slice(1).filter((sample, index) => sample.y < samples[index].y - 0.001).length;
                // Preserve diagnosis, not an assertion that the approximation is
                // Lightroom's curve or that its present decreases must remain.
                modelCases.push({ tones, splits, anchors, decreasingSampleIntervals: decreases,
                    feedbackIds: await evaluate(`${JSON.stringify(splitIds)}.map(id=>developSliderControls[id].feedbackRequestFloor.id)`) });
                if (tones[0] === 60 && splits[0] <= 25) await capture(".parametric-curve-graph-shell", "parametric-splits-" + splits.join("-"));
            }
        }
        assert.equal(fixture.mutations.length, 0, "No photographic changes for these checks");
        assert(!resources.mock.requestLog.some(r => r.path === "/api/command" || r.path === "/api/set" || r.path === "/api/reset"));
        assert.deepEqual(errors, []);
        if (artifacts) fs.writeFileSync(path.join(artifacts, "findings.json"), JSON.stringify({ layouts, resetStyle, modelCases }, null, 2));
        console.log("PASS Parametric split HTTP-to-renderer flow: default/three asymmetric split sets, fixed tone vectors, absolute percentage units/order, fixed track domain, one SVG conversion, old feedback ignored. No native parity claim.");
        console.log(JSON.stringify(modelCases.map(({ tones, splits, decreasingSampleIntervals }) => ({ tones, splits, decreasingSampleIntervals }))));
    } finally { await browser.cleanup(resources); }
})().catch(error => { console.error(error); process.exitCode = 1; });
