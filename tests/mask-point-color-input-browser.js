"use strict";
// Real Chromium + production masked controls; isolated synthetic feedback only.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const browser = require("./controller-browser-lifecycle");
const { snapshot } = require("./mask-point-color-confirmation");
const context = {activeModule: "develop", selectedPhotoUuid: "photo-a", contextCounter: 4, developCounter: 7, contextChangedAt: 10};
const initial = {ok: true, ...snapshot(), ...context, serverEpoch: "epoch-a", revision: 1, editFeedbackSequence: 0, lastEditResult: null};
const sourceFiles = new Set(["controller-masking-corrections.js", "controller-tone-curve.js", "controller-point-color.js", "controller-masking.js"]);
const observer = process.env.LRBRIDGE_POINT_COLOR_OBSERVER;
const visualizeOnly = process.argv.includes("--visualize-after-input-only");
const events = [];
const page = `<!doctype html><meta charset="utf-8"><div id="host"></div>
${[...sourceFiles].map(name => '<script src="/' + name + '"></script>').join("\n")}
<script>
const fixture = {state:${JSON.stringify(initial)}, context:${JSON.stringify(context)}, commands:[], visualizeRequests:[]};
const network = window.fetch.bind(window);
window.fetch = async (request, options) => {
 const url = new URL(request, location.href);
 if (url.pathname.startsWith('/__trace/')) return network(request, options);
 let data;
 if (url.pathname === '/api/masking/state') data = fixture.state;
 else if (url.pathname === '/api/masking/presets') data = {ok:true,presets:[]};
 else if (url.pathname === '/api/masking/point-color/value') {
  fixture.commands.push(Object.fromEntries(url.searchParams)); data={ok:true,editSequence:fixture.commands.length};
 } else if (url.pathname === '/api/masking/point-color/range-visualization/toggle') {
  fixture.visualizeRequests.push(url.pathname+url.search);
  return {ok:false,status:409,json:async()=>({ok:false,error:'fixture visualization rejection'}),clone(){return this;}};
 } else throw Error('Unexpected isolated request: '+url.pathname);
 return {ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(data)),clone(){return this;}};
};
const maskingController = LRBridgeControllerMasking.createController({document,getContext:()=>fixture.context,
 fetch:(...args)=>window.fetch(...args),setInterval:()=>1,clearInterval:()=>{}});
maskingController.activate(document.getElementById('host'));
// The observer must also work on plain HTTP LAN origins without randomUUID.
Object.defineProperty(crypto, 'randomUUID', {value:undefined,configurable:true});
</script>
${observer ? '<script src="/__trace/observer.js?token=isolated-test"></script>' : ''}`;

const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://isolated.test");
    res.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); return res.end(page); }
    if (sourceFiles.has(url.pathname.slice(1))) {
        res.setHeader("Content-Type", "application/javascript");
        const file = url.pathname === "/controller-point-color.js" && process.env.LRBRIDGE_POINT_COLOR_TEST_SOURCE || path.join(__dirname, "../app", url.pathname.slice(1));
        return res.end(fs.readFileSync(file));
    }
    if (observer && url.pathname === "/__trace/observer.js") { res.setHeader("Content-Type", "application/javascript"); return res.end(fs.readFileSync(observer)); }
    if (req.method === "POST" && url.pathname.startsWith("/__trace/")) {
        let body = ""; req.on("data", chunk => {body += chunk;}); req.on("end", () => {
            if (url.pathname.endsWith("/events")) events.push(...JSON.parse(body));
            res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({deadline:Date.now()+540000,saved:true}));
        }); return;
    }
    res.statusCode = 404; res.end();
});

(async () => {
    const resources = {mock:{server}, browser:null,browserCdp:null,pageCdp:null,browserProfileDirectory:null};
    const errors = [];
    try {
        const port = await browser.listen(server);
        resources.browserProfileDirectory = browser.createBrowserProfileDirectory();
        resources.browser = browser.launchBrowser(browser.findBrowserExecutable(), resources.browserProfileDirectory);
        const dev = await browser.waitForDevTools(resources.browser, resources.browserProfileDirectory);
        resources.browserCdp = await browser.connectCdp(dev.browserWebSocketUrl);
        const target = (await (await fetch(dev.debugUrl + "/json/list")).json()).find(t => t.type === "page");
        const cdp = resources.pageCdp = await browser.connectCdp(target.webSocketDebuggerUrl);
        cdp.onEvent = event => { if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails); };
        await cdp.send("Runtime.enable");
        const evaluate = async expression => {
            const result = await cdp.send("Runtime.evaluate", {expression,returnByValue:true,awaitPromise:true});
            if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
            return result.result.value;
        };
        const waitFor = async expression => {
            const end = Date.now() + 8000;
            while (!await evaluate(expression)) { if (Date.now() > end) throw Error("Timed out: " + expression); await new Promise(r => setTimeout(r, 20)); }
        };
        await cdp.send("Page.navigate", {url:"http://127.0.0.1:" + port});
        await waitFor("!!document.querySelector('[data-point-color-field=HueShift] input')");
        if (observer) {
            await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Start trace').click()");
            await waitFor("document.body.textContent.includes('Live trace recording')");
        }
        const visualizeResults = [];
        for (const field of visualizeOnly ? ["HueShift", "SatScale", "LumScale"] : ["HueShift", "SatScale", "LumScale", "Variance", "RangeAmount"]) {
            const commandCount = await evaluate("fixture.commands.length");
            const value = await evaluate(`(async()=>{
                const slider=document.querySelector('[data-point-color-field=${field}] input[type=range]');
                slider.value='65'; slider.dispatchEvent(new Event('input',{bubbles:true}));
                await maskingController.refresh();
                return slider.value;
            })()`);
            if (!visualizeOnly) assert.equal(value, "65", field + " actual browser input must survive an older parent snapshot");
            await evaluate(`document.querySelector('[data-point-color-field=${field}] input[type=range]').dispatchEvent(new Event('change',{bubbles:true}))`);
            await waitFor("fixture.commands.length===" + (commandCount + 1) + "&&!maskingController.getInteractionState().pointColor.writeInFlight");
            if (!visualizeOnly) assert.equal(await evaluate("fixture.commands.at(-1).value"), "0.65");
            await evaluate(`(async()=>{
                fixture.state.pointColor.${field}=Number(fixture.commands.at(-1).value); fixture.state.revision++;
                fixture.state.editFeedbackSequence=fixture.commands.length;
                fixture.state.lastEditResult={sequence:fixture.commands.length,kind:'masking.point_color.value.set',maskGroupId:'mask-a',outcome:'confirmed'};
                await maskingController.refresh();
            })()`);
            if (!visualizeOnly) assert.equal(await evaluate("maskingController.getInteractionState().correctionBusy"), false);
            else {
                // Proceed even after the old display rollback so this separately
                // proves the subsequent silent browser-side Visualize rejection.
                const result = await evaluate(`(async()=>{
                    const before=fixture.visualizeRequests.length;
                    const busyBefore=maskingController.getInteractionState().correctionBusy;
                    const toggle=[...document.querySelectorAll('button')].find(b=>b.textContent==='Toggle Visualize Range');
                    const disabledBefore=toggle.disabled; toggle.click();
                    await new Promise(r=>setTimeout(r,0)); await new Promise(r=>setTimeout(r,0));
                    return {field:'${field}',input:65,displayAfterSnapshot:${JSON.stringify(value)},busyBefore,disabledBefore,
                        submittedValue:Number(fixture.commands.at(-1).value),
                        requestsSent:fixture.visualizeRequests.length-before,
                        status:document.querySelector('.masking-status').textContent,
                        confirmedToggleState:toggle.getAttribute('aria-pressed')};
                })()`);
                visualizeResults.push(result);
                // Independent cases: remove the previous scalar's stuck timer.
                await evaluate("maskingController.deactivate();maskingController.activate(document.getElementById('host'))");
                await waitFor("!!document.querySelector('[data-point-color-field=HueShift] input')");
            }
        }
        if (observer) {
            await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Finish trace').click()");
            await waitFor("document.body.textContent.includes('Trace saved')");
            assert.ok(events.some(e => e.event === "input-event" && e.target.field === "HueShift"));
            assert.ok(events.some(e => e.event === "display-assignment" && e.target.field === "HueShift" && e.after === "65"));
            assert.ok(events.some(e => e.event === "fetch-result" && e.body?.pointColor));
            if (visualizeOnly) {
                assert.equal(events.filter(e => e.event === "input-event" && e.type === "click" && e.target.label === "Toggle Visualize Range").length, 3,
                    "the unchanged prepared observer records every toggle click, including browser-blocked requests");
                const sent = visualizeResults.reduce((sum, result) => sum + result.requestsSent, 0);
                assert.equal(events.filter(e => e.event === "fetch-start" && e.url.includes('/range-visualization/toggle')).length, sent);
                assert.equal(events.filter(e => e.event === "fetch-result" && e.url.includes('/range-visualization/toggle') && e.status === 409 &&
                    e.body.error === 'fixture visualization rejection').length, sent,
                    "the observer distinguishes request dispatch and the actual failure response");
                console.log("PASS unchanged capture observer: click, no-request vs request/409 evidence distinguished.");
            }
        }
        assert.deepEqual(errors, []);
        if (visualizeOnly) {
            console.log(JSON.stringify(visualizeResults));
            for (const result of visualizeResults) {
                assert.equal(result.requestsSent, 1, result.field + ": a completed drag must release the Visualize admission guard");
                assert.equal(result.busyBefore, false);
                assert.equal(result.confirmedToggleState, null, "no invented native toggle state");
                assert.match(result.status, /Visualize Range is no longer available/, "a real request failure stays visible");
            }
            console.log("PASS all three masked shifts: input/release/confirmed feedback -> one Visualize request; explicit failure visible. Simulated Lightroom only.");
            return;
        }
        console.log("PASS real Chromium: all five masked scalar input → stale parent refresh → release → confirmed feedback;" +
            (observer ? " isolated recorder start/events/finish and plain-HTTP fallback verified." : " synthetic Lightroom only."));
    } finally { await browser.cleanup(resources); }
})().catch(error => {console.error(error); process.exitCode=1;});
