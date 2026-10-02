"use strict";
// Production Controller in isolated Chromium; HTTP/SDK feedback is synthetic.
// Never connects to Lightroom or exercises other accepted slider families.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const browser = require("./controller-browser-lifecycle");
const definitions = require("../config/sliders.json").filter(d => d.group === "Transform");
const ids = definitions.map(d => d.id);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    const resources = { mock: browser.createMockControllerServer({ grainOnly: true }), browser: null,
        browserProfileDirectory: null, pageCdp: null, browserCdp: null };
    const fixture = resources.mock.grainFixture, requests = [], held = [], errors = [], layouts = [];
    let mode = "hold";
    for (const d of definitions) fixture.values[d.id] = d.default;
    fixture.values.Contrast = 20;
    const previous = fixture.handle;
    fixture.handle = (url, reply) => {
        if (url.pathname === "/api/action" && url.searchParams.get("action") === "resetTransforms") {
            requests.push({ path: url.pathname, action: "resetTransforms" });
            const finish = fail => reply(fail ? { ok: false, error: "Transform fixture failure" } : { ok: true }, fail ? 500 : 200);
            if (mode === "hold") held.push(finish); else finish(mode === "fail");
            return true;
        }
        if (["/api/set", "/api/adjust", "/api/reset"].includes(url.pathname)) {
            requests.push({ path: url.pathname, slider: url.searchParams.get("slider") });
            fixture.values[url.searchParams.get("slider")] = Number(url.searchParams.get("value") || 0);
            reply({ ok: true }); return true;
        }
        return previous(url, reply);
    };
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
        const run = async expression => {
            const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
            if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
            return r.result.value;
        };
        const wait = async expression => {
            const deadline = Date.now() + 6000;
            while (!await run(expression)) { if (Date.now() > deadline) throw Error("Timed out: " + expression); await pause(20); }
        };
        await cdp.send("Page.navigate", { url: base });
        await wait("typeof developSliderDefinitions!=='undefined'&&developSliderDefinitions.length>0");
        await run("activeTab='sliders';render()");
        await wait("developSliderControls.PerspectiveVertical?.authoritativeValue!==null&&developSliderControls.Contrast?.authoritativeValue===20");
        await run(`window.transformIds=${JSON.stringify(ids)};
            window.transformButton=()=>[...document.querySelectorAll('.action-row')].find(row=>row.querySelector('.slider-name')?.textContent==='Reset Transform').querySelector('button');
            window.transformState=()=>transformIds.map(id=>{const c=developSliderControls[id];return {id,fieldset:c.row.tagName,
                guarded:c.row.disabled,disabled:[c.range,c.number,c.decrement,c.increment,c.reset].map(e=>e.matches(':disabled')),
                value:c.number.value,interacting:isDevelopSliderInteracting(c)};});
            // Deterministic clock only for the new UI timer. Existing polling,
            // slider queues and feedback timers continue using the real clock.
            window.guardClock={now:0,next:2000000000,timers:new Map()};
            const realTimeout=window.setTimeout,realClear=window.clearTimeout;
            window.setTimeout=function(callback,ms,...args){
                if(ms===1000&&new Error().stack.includes('startTransformResetGuard')){
                    const id=++guardClock.next;guardClock.timers.set(id,{at:guardClock.now+ms,callback:()=>callback(...args)});return id;
                }return realTimeout(callback,ms,...args);
            };
            window.clearTimeout=function(id){if(!guardClock.timers.delete(id))realClear(id);};
            window.advanceGuard=ms=>{guardClock.now+=ms;for(const [id,timer] of [...guardClock.timers])if(timer.at<=guardClock.now){guardClock.timers.delete(id);timer.callback();}};
            window.feedbackTransform=()=>transformIds.forEach(id=>{const c=developSliderControls[id];applyDevelopSliderFeedback(c,c.definition.default,false);});
            feedbackTransform();`);
        const enabled = await run("transformState()");
        assert.equal(ids.length, 7);
        assert(enabled.every(s => s.fieldset === "FIELDSET" && s.disabled.every(d => !d)));
        // Disabled global Reset cannot start a guard, including custom delivery.
        await run("transformButton().disabled=true;transformButton().dispatchEvent(new MouseEvent('click'));transformButton().disabled=false");
        assert.equal(await run("transformResetGuard===null"), true);
        assert.equal(requests.length, 0);
        await run("transformButton().click()");
        await wait("transformResetGuard!==null");
        assert((await run("transformState()")).every(s => s.guarded && s.disabled.every(Boolean)));
        assert.equal(await run("developSliderControls.Contrast.range.matches(':disabled')"), false);
        await pause(40); assert.equal(held.length, 1);
        // Effective-disabled custom callbacks cannot start interactions or edits.
        await run(`for(const id of transformIds){const c=developSliderControls[id];
            c.range.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:8}));
            c.range.dispatchEvent(new Event('input',{bubbles:true}));
            c.number.dispatchEvent(new Event('focus'));c.number.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
            c.number.dispatchEvent(new Event('change'));c.number.dispatchEvent(new Event('blur'));
            for(const b of [c.decrement,c.increment,c.reset])b.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        }feedbackTransform();`);
        assert((await run("transformState()")).every(s => !s.interacting && s.disabled.every(Boolean)));
        await pause(380);
        assert.deepEqual(requests, [{ path: "/api/action", action: "resetTransforms" }]);
        // Develop feedback is not a new photo/context and cannot lift the guard.
        fixture.context.developCounter++;
        await run("readControllerContext()");
        await run("advanceGuard(999)");
        assert((await run("transformState()")).every(s => s.disabled.every(Boolean)));
        await run("feedbackTransform();markDevelopSliderUnavailable(developSliderControls.PerspectiveY,true);advanceGuard(1)");
        assert.equal(await run("transformResetGuard===null"), true, "expires from tap even while HTTP is held");
        const restored = await run("transformState()");
        assert(restored.filter(s => s.id !== "PerspectiveY").every(s => s.disabled.every(d => !d)));
        assert(restored.find(s => s.id === "PerspectiveY").disabled.every(Boolean), "current SDK unavailability survives expiry");
        held.shift()(false);
        await pause(40);

        // Failure clears the matching guard without losing the real error.
        mode = "fail";
        await run("feedbackTransform();transformButton().click()");
        await wait("transformResetGuard===null&&document.getElementById('status').textContent.includes('Transform fixture failure')");
        assert((await run("transformState()")).every(s => s.disabled.every(d => !d)));
        // An obsolete failure cannot clear a newer tap's one-second window.
        mode = "hold";
        await run("transformButton().click();advanceGuard(200);transformButton().click()");
        await pause(40); assert.equal(held.length, 2);
        held.shift()(true); await pause(40);
        assert.equal(await run("transformResetGuard!==null"), true);
        await run("advanceGuard(999);feedbackTransform()");
        assert.equal(await run("transformResetGuard!==null"), true);
        await run("advanceGuard(1)");
        assert.equal(await run("transformResetGuard===null"), true);
        held.shift()(false); await pause(40);
        // Real changes clear safely through the actual /api/context consumer.
        for (const [key, value] of [["selectedPhotoUuid", "second-photo"], ["contextCounter", 13],
            ["activeModule", "library"], ["selectedPhotoKey", "second-photo-key"], ["contextChangedAt", 1700000000010]]) {
            await run("feedbackTransform();transformButton().click()");
            fixture.context[key] = value;
            await run("readControllerContext()");
            assert.equal(await run("transformResetGuard===null"), true, key + " cleanup");
            await pause(40); held.shift()(false);
        }
        // Render both grey and enabled layouts with actual production CSS.
        fixture.context.activeModule = "develop";
        await run("readControllerContext();feedbackTransform()");
        for (const width of [1280, 390, 320]) {
            await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
            await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: width < 760 });
            await run("transformButton().click()");
            await pause(40); held.shift()(false);
            for (const guarded of [true, false]) {
                if (!guarded) await run("advanceGuard(1000)");
                const layout = await run(`(()=>{const c=developSliderControls.PerspectiveVertical;c.row.scrollIntoView({block:'center'});
                    const field=getComputedStyle(c.number),button=getComputedStyle(c.reset),r=c.row.getBoundingClientRect();
                    return {width:innerWidth,guarded:${guarded},overflow:document.documentElement.scrollWidth>innerWidth,
                        rowWidth:r.width,field:{background:field.backgroundColor,color:field.color},
                        button:{background:button.backgroundColor,color:button.color},
                        controls:[c.range,c.number,c.decrement,c.increment,c.reset].map(e=>({disabled:e.matches(':disabled'),height:e.getBoundingClientRect().height}))};})()`);
                assert.equal(layout.width, width, "Use the actual narrow CSS viewport");
                assert.equal(layout.overflow, false, "Transform layout at " + width);
                assert(layout.controls.every(c => c.disabled === guarded));
                assert(layout.controls.slice(1).every(c => c.height >= 44));
                assert.equal(layout.field.background, guarded ? "rgb(36, 36, 36)" : "rgb(8, 12, 16)");
                if (guarded) {
                    assert.equal(layout.field.color, "rgb(170, 170, 170)");
                    assert.equal(layout.button.background, "rgb(68, 68, 68)");
                    assert.equal(layout.button.color, "rgb(187, 187, 187)");
                }
                layouts.push(layout);
                if (process.env.LRBRIDGE_UI_ARTIFACTS) {
                    const folder = process.env.LRBRIDGE_UI_ARTIFACTS; fs.mkdirSync(folder, { recursive: true });
                    await run("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
                    const png = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
                    fs.writeFileSync(path.join(folder, "transform-" + (guarded ? "guarded-" : "enabled-") + width + ".png"), Buffer.from(png.data, "base64"));
                }
            }
        }
        // Enabled controls still use the unchanged command handlers.
        mode = "ok";
        const before = requests.length;
        await run("const c=developSliderControls.PerspectiveVertical;c.number.focus();c.number.value='7';c.number.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
        await wait("developSliderControls.PerspectiveVertical.authoritativeValue===7");
        assert.equal(requests[before].path, "/api/set");
        assert.equal(requests[before].slider, "PerspectiveVertical");
        assert.deepEqual(errors, []);
        if (process.env.LRBRIDGE_UI_ARTIFACTS) fs.writeFileSync(path.join(process.env.LRBRIDGE_UI_ARTIFACTS, "transform-results.json"), JSON.stringify({ layouts, requests }, null, 2));
        console.log("PASS Transform-only 1000 ms tap-owned guard, all seven rows/controls, feedback and availability precedence, disabled input rejection, failure/context cleanup and stale ownership; enabled edit unchanged; 1280/390/320 grey/enabled layouts. Simulated Lightroom only.");
    } finally {
        for (const finish of held) finish(true);
        await browser.cleanup(resources);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
