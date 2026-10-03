"use strict";
// Isolated Chromium rendering/handlers. Never connects to the running bridge.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const browser = require("./controller-browser-lifecycle");
const fixture = require("./fixtures/deep-blue-native-curve.json");
const root = path.join(__dirname, ".."), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
    const style = fs.readFileSync(path.join(root, "app/controller.html"), "utf8").match(/<style>([\s\S]*?)<\/style>/)[1];
    const server = http.createServer((req, res) => {
        if (req.url === "/controller-tone-curve.js") {
            res.writeHead(200, { "Content-Type": "application/javascript" });
            return res.end(fs.readFileSync(process.env.LRBRIDGE_TONE_CURVE_SOURCE || path.join(root, "app/controller-tone-curve.js")));
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<!doctype html><style>${style}</style><div id="status"></div><main class="content"><div id="content"></div></main><script src="/controller-tone-curve.js"></script>`);
    });
    const resources = { mock: { server }, browser: null, browserCdp: null, pageCdp: null, browserProfileDirectory: null };
    try {
        const base = "http://127.0.0.1:" + await browser.listen(server);
        resources.browserProfileDirectory = browser.createBrowserProfileDirectory();
        resources.browser = browser.launchBrowser(browser.findBrowserExecutable(), resources.browserProfileDirectory);
        const dev = await browser.waitForDevTools(resources.browser, resources.browserProfileDirectory);
        resources.browserCdp = await browser.connectCdp(dev.browserWebSocketUrl);
        const targets = await (await fetch(dev.debugUrl + "/json/list")).json();
        const cdp = resources.pageCdp = await browser.connectCdp(targets.find(target => target.type === "page").webSocketDebuggerUrl);
        const exceptions = []; cdp.onEvent = event => { if (event.method === "Runtime.exceptionThrown") exceptions.push(event.params.exceptionDetails); };
        await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
        async function run(expression) {
            const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
            assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value;
        }
        async function wait(expression) {
            const until = Date.now() + 5000;
            while (!await run(expression)) { assert(Date.now() < until, "Timed out: " + expression); await pause(20); }
        }
        await cdp.send("Page.navigate", { url: base }); await wait("!!window.LRBridgeToneCurve");
        for (const masked of [false, true]) {
            const snapshot = { available: true, ...fixture, selectedPhotoUuid: "isolated-native-curve", contextCounter: 7,
                developCounter: 40, revision: 1, updatedAt: Date.now(), refineSaturation: { value: 62, min: 0, max: 100 } };
            if (masked) Object.assign(snapshot, { serverEpoch: "native-fixture-epoch", maskingRevision: 8,
                contextChangedAt: 1, selectedMaskGroupId: "native-fixture-mask", editFeedbackSequence: 0, lastEditResult: null });
            await run(`(()=>{
                window.controller?.deactivate();document.getElementById('content').replaceChildren();window.requests=[];
                document.getElementById('content').className=${JSON.stringify(masked ? "masking-correction-group masking-tone-curve" : "group tone-curve-group")};
                window.snapshot=${JSON.stringify(snapshot)};
                window.controller=LRBridgeToneCurve.createController({document,window,
                    contextAdapter:${masked ? 'LRBridgeToneCurve.createMaskingContextAdapter("/api/masking/tone-curve")' : 'null'},
                    setInterval:()=>1,clearInterval:()=>{},setStatus:text=>document.getElementById('status').textContent=text,
                    fetch:async url=>{requests.push(url);return {ok:true,json:async()=>url.endsWith('/state')?
                        {ok:true,pointCurve:snapshot,toneCurve:snapshot}:{ok:true,queued:{}}};}});
                document.getElementById('content').append(controller.element);
                controller.activate({activeModule:'develop',...snapshot});
            })()`);
            await wait("!!controller.getState().authoritative");
            await run("document.querySelector('.point-curve-channel-blue').click()");
            const read = await run(`(()=>({
                points:controller.getState().authoritative.curves.blue,
                path:document.querySelector('.point-curve-line').getAttribute('d'),
                handles:[...document.querySelectorAll('.point-curve-hit-target')].map(p=>[Number(p.getAttribute('cx')),255-Number(p.getAttribute('cy'))]),
                name:document.querySelector('.point-curve-preset-select').value,
                noticeHidden:!document.querySelector('.point-curve-native-notice'),
                addDisabled:document.querySelector('.point-curve-add-button').disabled,
                deleteDisabled:document.querySelector('.point-curve-delete-button').disabled,
                resetDisabled:[...document.querySelectorAll('button')].find(b=>b.textContent==='Reset selected channel').disabled
            }))()`);
            assert.deepEqual(read.points, fixture.curves.blue); assert.match(read.path, /^M 2 221 C /);
            assert.deepEqual(read.handles, [[2,34],[73,119],[139,177],[171,200],[255,223]]);
            assert.equal(read.name, "Custom"); assert.equal(read.noticeHidden, true);
            assert(!read.addDisabled && read.deleteDisabled && !read.resetDisabled);
            for (const pointIndex of [0, 1, 4]) {
                await run("document.querySelectorAll('.point-curve-hit-target')["+pointIndex+"].dispatchEvent(new MouseEvent('click',{bubbles:true}))");
                const values = await run("[...document.querySelectorAll('.point-curve-value-number')].map(e=>e.textContent)");
                assert.deepEqual(values, fixture.curves.blue.slice(pointIndex * 2, pointIndex * 2 + 2).map(String));
                assert.equal(await run("document.querySelector('.point-curve-delete-button').disabled"), pointIndex!==1,
                    'Only first and last native points are protected from deletion');
            }
            await run("controller.refresh()"); await wait("!controller.getState().requestInFlight");
            assert.deepEqual(await run("[...document.querySelectorAll('.point-curve-value-number')].map(e=>e.textContent)"), ["255","223"]);
            await run("document.querySelector('.point-curve-channel-rgb').click()");
            const supported = await run(`(()=>({
                noticeHidden:!document.querySelector('.point-curve-native-notice'),
                addDisabled:document.querySelector('.point-curve-add-button').disabled,
                resetDisabled:[...document.querySelectorAll('button')].find(b=>b.textContent==='Reset selected channel').disabled,
                refine:document.querySelector('.point-curve-refine-row input[type=range]')?.value,
                refineDisabled:document.querySelector('.point-curve-refine-row input[type=range]')?.disabled,
                presetDisabled:document.querySelector('.point-curve-preset-select').disabled
            }))()`);
            assert(supported.noticeHidden && !supported.addDisabled && !supported.resetDisabled && !supported.presetDisabled);
            assert.equal(supported.refine, "62"); assert.equal(supported.refineDisabled, false);
            // Inset RGB baselines retain preset/reset/Refine availability.
            await run("snapshot={...snapshot,revision:2,updatedAt:Date.now(),curves:{...snapshot.curves,rgb:snapshot.curves.blue}};controller.applyAuthoritative(snapshot)");
            assert.equal(await run("document.querySelector('.point-curve-preset-select').disabled"), false);
            assert.equal(await run("document.querySelector('.point-curve-refine-row input[type=range]').disabled"), false);
            assert.equal(await run("[...document.querySelectorAll('button')].find(b=>b.textContent==='Reset selected channel').disabled"), false);
            assert.deepEqual(await run("requests.filter(url=>!url.endsWith('/state'))"), []);
            for (const width of [390, 1280]) {
                await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
                await run("document.querySelector('.point-curve-channel-blue').click()");
                assert.equal(await run("document.documentElement.scrollWidth<=window.innerWidth"), true,
                    JSON.stringify(await run("[window.innerWidth,document.documentElement.scrollWidth,[...document.querySelectorAll('#content *')].filter(e=>e.getBoundingClientRect().right>window.innerWidth).map(e=>[e.className?.baseVal||e.className,e.getBoundingClientRect().right])]")));
            }
            await run("controller.applyContext({activeModule:'develop',selectedPhotoUuid:'other-photo',contextCounter:8,developCounter:0})");
            assert.equal(await run("document.querySelector('.point-curve-add-button').disabled"), true);
        }
        assert.deepEqual(exceptions, []);
        console.log("Native Curve rendered checks passed: normal/Masking exact native coordinates and drawing, editing/reset availability, endpoint deletion protection, RGB/Refine availability, refreshed selection, context cleanup and narrow/desktop layout (isolated only).");
    } finally { await browser.cleanup(resources); }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
