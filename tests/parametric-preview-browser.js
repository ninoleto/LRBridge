"use strict";
// Actual Controller/SVG, synthetic HTTP only. Native graph agreement is tested
// independently in parametric-preview.js and parametric-native-reference.js.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const browser = require("./controller-browser-lifecycle");
const fields = Object.values(require("../app/controller-tone-curve").PARAMETRIC_CURVE_FIELDS);
(async () => {
    const resources = { mock: browser.createMockControllerServer({ grainOnly: true, sourceCorrectionsOnly: true }),
        browser: null, browserCdp: null, pageCdp: null, browserProfileDirectory: null };
    const directory = process.env.LRBRIDGE_PARAMETRIC_ARTIFACTS;
    const errors = [];
    let pointFixture = null;
    const originalHandle = resources.mock.grainFixture.handle;
    resources.mock.grainFixture.handle = function (parsed, send) {
        if (pointFixture && parsed.pathname === "/api/tone-curve/state") {
            send({ ok: true, pointCurve: pointFixture }); return true;
        }
        return originalHandle(parsed, send);
    };
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
            const end = Date.now() + 8000;
            while (!await evaluate(expression)) { if (Date.now() > end) throw Error("Timed out: " + expression); await new Promise(r => setTimeout(r, 30)); }
        };
        const capture = async name => {
            if (!directory) return;
            fs.mkdirSync(directory, { recursive: true });
            const png = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
            fs.writeFileSync(path.join(directory, name + ".png"), Buffer.from(png.data, "base64"));
        };
        await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + port });
        await waitFor("!!document.querySelector('[data-tab=tone-curve]')");
        await evaluate("document.querySelector('[data-tab=tone-curve]').click();document.querySelectorAll('.collapsible-section-toggle[aria-expanded=false]').forEach(b=>b.click())");
        await waitFor("!!parametricCurveGraphPath&&!!pointCurveController.getState().authoritative");
        for (const width of [1280,390]) for (const splits of [[25,50,75],[10,20,75]]) {
            await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
            await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: width === 390 });
            const values = Object.fromEntries(fields.map((key,i) => [key,[60,-35,-20,-10,...splits][i]]));
            Object.assign(resources.mock.grainFixture.values, values);
            await evaluate("requestLiveFeedbackSnapshot(true)");
            await waitFor(`JSON.stringify(collectParametricCurveValues(false))===${JSON.stringify(JSON.stringify(values))}`);
            const rendered = await evaluate(`(()=>{
                updateParametricCurveGraph();const p=parametricCurveGraphPath,total=p.getTotalLength();let previous=p.getPointAtLength(0),backward=0;
                for(let i=1;i<=1500;i++){const current=p.getPointAtLength(total*i/1500);if(current.y>previous.y+.001||current.x<previous.x-.001)backward++;previous=current;}
                document.querySelector('.parametric-curve-graph-shell').scrollIntoView({block:'start'});window.scrollBy(0,-210);
                return {backward,overflow:document.documentElement.scrollWidth>innerWidth,values:collectParametricCurveValues(true),
                    markers:[...document.querySelectorAll('.parametric-curve-split-line')].map(e=>Number(e.getAttribute('x1')))};
            })()`);
            assert.equal(rendered.backward,0,"Rendered SVG must not reverse for this Parametric-only case");
            assert.equal(rendered.overflow,false);assert.deepEqual(rendered.values,values);
            assert.deepEqual(rendered.markers,splits.map(v=>v*2.55));
            await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
            await capture("controller-"+width+"-"+splits.join("-"));
        }
        // Supply the captured non-linear RGB fixtures through the real HTTP
        // feedback handler. The selected Parametric graph must stay independent;
        // the Point Curve renderer must continue to retain the actual RGB data.
        const references = require("./fixtures/parametric-lightroom-native-20261001.json").cases;
        const curve = require("../app/controller-tone-curve");
        let revision = 100;
        for (const width of [1280,390]) for (const id of ["rgb-neutral","rgb-combined","rgb-turning"]) {
            const reference = references.find(r => r.id === id);
            const authoritative = await evaluate("pointCurveController.getState().authoritative");
            pointFixture = { ...authoritative, revision: revision++, updatedAt: Date.now(), name: "Custom",
                curves: { ...authoritative.curves, rgb: reference.rgbCurve.slice() } };
            Object.assign(resources.mock.grainFixture.values, reference.values);
            await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
            await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: width === 390 });
            await evaluate("pointCurveController.refresh()");
            await evaluate("requestLiveFeedbackSnapshot(true)");
            await waitFor(`JSON.stringify(collectParametricCurveValues(false))===${JSON.stringify(JSON.stringify(reference.values))}`);
            await waitFor(`JSON.stringify(pointCurveController.getState().authoritative.curves.rgb)===${JSON.stringify(JSON.stringify(reference.rgbCurve))}`);
            const rendered = await evaluate(`(()=>{updateParametricCurveGraph();return {
                path:parametricCurveGraphPath.getAttribute('d'),overflow:document.documentElement.scrollWidth>innerWidth,
                pointPath:document.querySelector('.point-curve-line').getAttribute('d'),
                rgb:pointCurveController.getState().authoritative.curves.rgb};})()`);
            assert.equal(rendered.path, curve.parametricCurvePathData(reference.values,[0,0,255,255]));
            assert.equal(rendered.overflow, false);
            assert.deepEqual(rendered.rgb, reference.rgbCurve);
            assert.equal(rendered.pointPath, curve.curvePathData(reference.rgbCurve));
            await evaluate("document.querySelector('.parametric-curve-graph-shell').scrollIntoView({block:'start'});window.scrollBy(0,-210);new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
            await capture("controller-"+width+"-"+id);
            if (id === "rgb-turning") {
                await evaluate("document.querySelector('[aria-controls=tone-curve-point-panel]').click();document.querySelector('#tone-curve-point-panel').scrollIntoView({block:'start'});window.scrollBy(0,-210);new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
                await capture("point-curve-"+width+"-turning");
                await evaluate("document.querySelector('[aria-controls=tone-curve-parametric-panel]').click()");
            }
        }
        assert.equal(resources.mock.grainFixture.mutations.length,0);
        assert(!resources.mock.requestLog.some(r=>["/api/command","/api/set","/api/reset"].includes(r.path)));
        assert.deepEqual(errors,[]);
        for (const name of ["before-after","native-before-after"]) if (directory && fs.existsSync(path.join(directory,"../comparison/"+name+".svg"))) {
            await cdp.send("Page.navigate", { url:"file:///"+path.resolve(directory,"../comparison/"+name+".svg").replaceAll("\\","/") });
            await waitFor("!!document.querySelector('svg')");
            const size = await evaluate("(()=>{const s=document.querySelector('svg');return {width:Number(s.getAttribute('width')),height:Number(s.getAttribute('height'))};})()");
            await cdp.send("Emulation.setDeviceMetricsOverride", { ...size,deviceScaleFactor:1,mobile:false });
            await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
            await capture(name);
        }
        console.log("PASS actual Controller/SVG: default/narrow splits, independent Parametric/RGB display including intentional Point Curve turns, HTTP feedback-to-graph, 1280/390px, no overflow/edits/runtime errors. Synthetic browser only.");
    } finally { await browser.cleanup(resources); }
})().catch(e=>{console.error(e);process.exitCode=1;});
