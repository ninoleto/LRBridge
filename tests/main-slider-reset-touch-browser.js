"use strict";
// Real production DOM/HTTP handlers, synthetic events and SDK doubles in an isolated browser.
// Captured missing-click events are replayed; physical touchscreen acceptance is separate.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const browser = require("./controller-browser-lifecycle");
const captured = require("./fixtures/reset-touch-missed-click-20260926.json");
const tick = () => new Promise(resolve => setTimeout(resolve, 25));
(async () => {
    const resources = { mock: browser.createMockControllerServer({ grainOnly: true }), browser: null,
        browserProfileDirectory: null, pageCdp: null, browserCdp: null };
    const writes = [], errors = [], heldSets = [];
    let holdSets = false;
    try {
        const fixture = resources.mock.grainFixture;
        Object.assign(fixture.values, { Contrast: 31, Highlights: 22, Shadows: 15, Whites: 20,
            HueAdjustmentGreen: -2, SaturationAdjustmentGreen: 35, LuminanceAdjustmentGreen: 12,
            SaturationAdjustmentAqua: 17, DefringePurpleHueLo: 10, DefringePurpleHueHi: 90 });
        const defaults = { DefringePurpleHueLo: 30, DefringePurpleHueHi: 70 };
        const previous = fixture.handle;
        fixture.handle = (url, reply) => {
            if (["/api/set", "/api/reset"].includes(url.pathname)) {
                const slider = url.searchParams.get("slider"), reset = url.pathname === "/api/reset";
                const value = reset ? (defaults[slider] ?? 0) : Number(url.searchParams.get("value"));
                writes.push({ path: url.pathname, slider, value });
                const finish = () => { fixture.values[slider] = value; reply({ ok: true }); };
                if (!reset && holdSets) heldSets.push(finish); else finish();
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
        cdp.onEvent = message => { if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text); };
        async function run(expression) {
            const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
            if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
            return result.result.value;
        }
        async function waitFor(check, label) {
            for (let n = 0; n < 120; n++) { if (await check()) return; await tick(); }
            throw Error("Timed out: " + label);
        }
        await cdp.send("Page.navigate", { url: base });
        await waitFor(() => run("typeof developSliderDefinitions !== 'undefined' && developSliderDefinitions.length > 0"), "Controller init");
        await run("activeTab='sliders'; render();");
        await waitFor(() => run("developSliderControls.Contrast?.authoritativeValue === 31"), "SDK fixture");
        await run(`window.resetTouchCalls=[];
            const originalReset=resetDevelopSlider;
            resetDevelopSlider=function(control){resetTouchCalls.push(control.definition.id);return originalReset(control);};
            window.resetTouchEvent=function(button,type,id,extra={}){
                const rect=button.getBoundingClientRect();
                return button.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,
                    pointerType:'touch',isPrimary:true,button:0,buttons:type==='pointerdown'?1:0,
                    clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2,...extra}));
            };`);
        for (const sample of captured.cases) {
            const before = writes.length;
            const callbackCount = await run(`(()=>{const b=developSliderControls[${JSON.stringify(sample.slider)}].reset;
                const before=resetTouchCalls.length, events=${JSON.stringify(sample.events)};
                for(const e of events) resetTouchEvent(b,e.type,e.pointerId,{isPrimary:e.isPrimary,button:e.button,buttons:e.buttons});
                return resetTouchCalls.length-before;})()`);
            assert.equal(callbackCount, 1, "captured enabled touch without click must activate once: " + sample.capture);
            await waitFor(() => writes.length === before + 1, "captured tap HTTP");
            assert.deepEqual(writes[before], { path: "/api/reset", slider: sample.slider, value: 0 });
            await run(`resetTouchEvent(developSliderControls[${JSON.stringify(sample.slider)}].reset,'click',${sample.events[0].pointerId},{detail:1})`);
            await tick(); assert.equal(writes.length, before + 1, "compatibility click cannot repeat the captured Reset");
        }
        const four = ["Contrast", "Highlights", "Shadows", "Whites"];
        const fourBefore = writes.length;
        assert.deepEqual(await run(`(()=>{const before=resetTouchCalls.length;
            ${JSON.stringify(four)}.forEach((id,i)=>{const b=developSliderControls[id].reset;
                resetTouchEvent(b,'pointerdown',100+i);resetTouchEvent(b,'pointerup',100+i);});
            ${JSON.stringify(four)}.forEach((id,i)=>resetTouchEvent(developSliderControls[id].reset,'click',100+i,{detail:1}));
            return resetTouchCalls.slice(before);})()`), four);
        await waitFor(() => writes.length === fourBefore + 4, "four fast Reset requests");
        assert.deepEqual(writes.slice(fourBefore).map(w => w.slider).sort(), [...four].sort());

        // Cancellation stays local to the tap; a subsequent touch click must not resurrect it.
        const invalidBefore = writes.length;
        const rejected = await run(`(()=>{const b=developSliderControls.Contrast.reset, before=resetTouchCalls.length;
            const cancel = action => {resetTouchEvent(b,'pointerdown',200);action();
                resetTouchEvent(b,'pointerup',200);resetTouchEvent(b,'click',200,{detail:1});};
            cancel(()=>{const r=b.getBoundingClientRect();resetTouchEvent(b,'pointermove',200,{clientX:r.left+r.width/2+20});});
            cancel(()=>resetTouchEvent(b,'pointercancel',200));
            cancel(()=>resetTouchEvent(b,'lostpointercapture',200));
            cancel(()=>b.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})));
            cancel(()=>document.dispatchEvent(new Event('scroll')));
            cancel(()=>window.dispatchEvent(new Event('blur')));
            cancel(()=>document.dispatchEvent(new PointerEvent('pointerdown',{pointerId:201,pointerType:'touch',isPrimary:false,bubbles:true})));
            resetTouchEvent(b,'pointerdown',200);b.disabled=true;resetTouchEvent(b,'pointerup',200);b.disabled=false;
            resetTouchEvent(b,'click',200,{detail:1});
            const oldContext=lastControllerContextCounter;
            cancel(()=>{lastControllerContextCounter++;});lastControllerContextCounter=oldContext;
            const oldPhoto=lastControllerSelectedPhotoUuid;
            cancel(()=>{lastControllerSelectedPhotoUuid='changed-photo';});lastControllerSelectedPhotoUuid=oldPhoto;
            const oldGeneration=genericFeedbackGeneration;
            cancel(()=>{genericFeedbackGeneration++;});genericFeedbackGeneration=oldGeneration;
            resetTouchEvent(b,'pointerdown',200);const parent=b.parentNode;b.remove();
            resetTouchEvent(b,'pointerup',200);parent.appendChild(b);resetTouchEvent(b,'click',200,{detail:1});
            return resetTouchCalls.length-before;})()`);
        assert.equal(rejected, 0, "scroll/move/cancel/capture loss/multitouch/disabled/navigation cannot activate Reset");
        await tick(); assert.equal(writes.length, invalidBefore);
        const revisionBefore = writes.length;
        assert.equal(await run(`(()=>{const b=developSliderControls.Contrast.reset, before=resetTouchCalls.length;
            resetTouchEvent(b,'pointerdown',250);const revision=lastControllerDevelopCounter;
            lastControllerDevelopCounter++;resetTouchEvent(b,'pointerup',250);lastControllerDevelopCounter=revision;
            resetTouchEvent(b,'click',250,{detail:1});return resetTouchCalls.length-before;})()`), 1,
            "the preceding slider's Develop revision change must not cancel the completed Reset tap");
        await waitFor(() => writes.length === revisionBefore + 1, "Reset during preceding edit revision");
        // Model both legacy touch-generated MouseEvent clicks and normal mouse/keyboard clicks.
        const ordinaryBefore = writes.length;
        assert.equal(await run(`(()=>{const b=developSliderControls.Contrast.reset, before=resetTouchCalls.length;
            resetTouchEvent(b,'pointerdown',300);resetTouchEvent(b,'pointerup',300);
            b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
            b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse',pointerId:1,button:0}));
            b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
            b.click(); // Native button activation's detail=0 path (keyboard/programmatic).
            return resetTouchCalls.length-before;})()`), 3);
        await waitFor(() => writes.length === ordinaryBefore + 3, "touch, mouse and detail-zero activations");
        const compoundBefore = writes.length;
        await waitFor(() => run("!document.querySelector('[aria-label=\"Reset both Purple Hue endpoints\"]').disabled"), "compound Reset available");
        assert.deepEqual(await run(`(()=>{const b=document.querySelector('[aria-label="Reset both Purple Hue endpoints"]'),before=resetTouchCalls.length;
            resetTouchEvent(b,'pointerdown',350);resetTouchEvent(b,'pointerup',350);resetTouchEvent(b,'click',350,{detail:1});
            return resetTouchCalls.slice(before);})()`), ["DefringePurpleHueLo", "DefringePurpleHueHi"]);
        await waitFor(() => writes.length === compoundBefore + 2, "one touch resets each compound endpoint once");

        // The previous drag is in flight; its final unsent value must not follow Reset.
        holdSets = true;
        await waitFor(() => run("!developSliderControls.Contrast.requestInFlight"), "earlier resets admitted");
        const orderingBefore = writes.length;
        await run(`(()=>{const c=developSliderControls.Contrast;
            // Synthetic pointers have no native capture; replay its recorded lifecycle explicitly.
            c.range.setPointerCapture=()=>{};c.range.hasPointerCapture=()=>false;
            resetTouchEvent(c.range,'pointerdown',400);c.range.value='31';
            c.range.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        await waitFor(() => heldSets.length === 1, "first drag request held at HTTP admission");
        const queued = await run(`(()=>{const c=developSliderControls.Contrast,b=c.reset,before=resetTouchCalls.length;
            c.range.value='55';c.range.dispatchEvent(new Event('input',{bubbles:true}));
            resetTouchEvent(c.range,'pointerup',400);
            resetTouchEvent(b,'pointerdown',401);resetTouchEvent(b,'pointerup',401);
            resetTouchEvent(c.range,'lostpointercapture',400);c.range.dispatchEvent(new Event('change',{bubbles:true}));
            resetTouchEvent(b,'click',401,{detail:1});
            return {calls:resetTouchCalls.length-before,pending:c.pendingResets.length,
                value:c.pendingValue,interacting:isDevelopSliderInteracting(c)};})()`);
        assert.deepEqual(queued, { calls: 1, pending: 1, value: null, interacting: false });
        assert.equal(writes.length, orderingBefore + 1);
        holdSets = false; heldSets.splice(0).forEach(finish => finish());
        await waitFor(() => writes.length === orderingBefore + 2, "Reset after earlier write admission");
        await new Promise(resolve => setTimeout(resolve, 140));
        assert.deepEqual(writes.slice(orderingBefore), [
            { path: "/api/set", slider: "Contrast", value: 31 },
            { path: "/api/reset", slider: "Contrast", value: 0 }
        ], "older final drag and compatibility click must not follow Reset");
        assert.deepEqual(errors, []);
        console.log("Captured touch Reset taps, four fast buttons, cancellation, click deduplication and drag/HTTP ordering passed (isolated browser; physical acceptance recorded separately).");
    } finally {
        heldSets.splice(0).forEach(finish => finish());
        await browser.cleanup(resources);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
