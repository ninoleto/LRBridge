"use strict";
// Actual Controller events and shared feedback functions; isolated HTTP/SDK doubles only.
const assert = require("node:assert/strict");
const browser = require("./controller-browser-lifecycle");
const definitions = require("../config/sliders.json");
const captured = require("./fixtures/sdr-brightness-jump-20260928.json");
const ids = definitions.filter(d => d.group === "HDR / SDR Rendition" && d.id.startsWith("SDR")).map(d => d.id);

async function main() {
    const mock = browser.createMockControllerServer({ grainOnly: true, controllerSource: process.env.LRBRIDGE_CONTROLLER_SOURCE });
    const fixture = mock.grainFixture, previous = fixture.handle;
    const calls = [], errors = [], heldAdmissions = [];
    let holdAdmission = false, rejectNext = false;
    const capture = { active: false, reads: 0, expiredId: null, invalidated: false };
    Object.assign(fixture.values, Object.fromEntries(ids.map(id => [id, 0])), { HDREditMode: 1 });
    fixture.handle = (url, reply) => {
        if (["/api/set", "/api/reset"].includes(url.pathname)) {
            const slider = url.searchParams.get("slider"), reset = url.pathname === "/api/reset";
            assert(ids.includes(slider), "only the affected SDR controls may be edited");
            const value = reset ? 0 : Number(url.searchParams.get("value"));
            assert(Number.isInteger(value) && value >= -100 && value <= 100);
            calls.push({ slider, value, reset });
            const rejected = rejectNext; rejectNext = false;
            const finish = () => reply(rejected ? { ok: false, error: "SDK fixture rejection" } : { ok: true }, rejected ? 503 : 200);
            if (holdAdmission) heldAdmissions.push(finish); else finish();
            return true;
        }
        if (capture.active && url.pathname === "/api/feedback/request" && url.searchParams.get("slider") === captured.slider) {
            capture.reads += 1;
            return previous(url, body => {
                if (capture.reads === 2) capture.expiredId = String(body.request.id);
                reply(body);
            });
        }
        if (capture.active && url.pathname === "/api/feedback/snapshot" && url.searchParams.get("id") === capture.expiredId) {
            // Captured order: the browser still owns revision 22 when the server
            // prunes the expiry read at revision 23. Lightroom itself stays -49.
            if (!capture.invalidated) {
                fixture.context.developCounter += 1;
                fixture.context.developChangedAt = Date.now();
                fixture.values[captured.slider] = captured.latestInput;
                capture.invalidated = true;
            }
            reply({ ok: false, error: captured.snapshotError }, captured.snapshotStatus);
            return true;
        }
        return previous(url, reply);
    };
    const resources = { mock, browser: null, browserCdp: null, pageCdp: null, browserProfileDirectory: null };
    try {
        const port = await browser.listen(mock.server);
        resources.browserProfileDirectory = browser.createBrowserProfileDirectory();
        resources.browser = browser.launchBrowser(browser.findBrowserExecutable(), resources.browserProfileDirectory);
        const dev = await browser.waitForDevTools(resources.browser, resources.browserProfileDirectory);
        resources.browserCdp = await browser.connectCdp(dev.browserWebSocketUrl);
        const targets = await (await fetch(dev.debugUrl + "/json/list")).json();
        const cdp = resources.pageCdp = await browser.connectCdp(targets.find(t => t.type === "page").webSocketDebuggerUrl);
        await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
        cdp.onEvent = m => { if (m.method === "Runtime.exceptionThrown") errors.push(m.params); };
        const evaluate = async expression => {
            const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
            if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
            return result.result.value;
        };
        async function waitFor(test, message) {
            for (let i = 0; i < 120; i++) { if (await test()) return; await new Promise(r => setTimeout(r, 40)); }
            throw Error("Timed out: " + message + " " + JSON.stringify({ calls, errors }));
        }
        const control = id => "developSliderControls[" + JSON.stringify(id) + "]";
        const state = id => evaluate("(()=>{const c=" + control(id) + ";return {local:c.localValue,value:c.range.value,number:c.number.value,pending:c.confirmationPending,desired:c.desiredValue,inFlight:c.requestInFlight,disabled:c.range.disabled}})()");
        async function drag(id, values) {
            await evaluate("(()=>{const c=" + control(id) + ";c.range.setPointerCapture=()=>{};c.range.hasPointerCapture=()=>false;c.range.dispatchEvent(new PointerEvent('pointerdown',{pointerId:71,pointerType:'touch',isPrimary:true}));" +
                JSON.stringify(values) + ".forEach(v=>{c.range.value=String(v);c.range.dispatchEvent(new Event('input',{bubbles:true}))});" +
                "c.range.dispatchEvent(new PointerEvent('pointerup',{pointerId:71,pointerType:'touch',isPrimary:true}));c.range.dispatchEvent(new Event('change',{bubbles:true}));})()");
        }
        async function feedback(id, value, requestId) {
            if (requestId === undefined) fixture.values[id] = value;
            const idForRead = requestId ?? ++fixture.requestId;
            await evaluate("applyTargetedDevelopSliderFeedback(" + control(id) + "," + JSON.stringify({ available: true, value }) + "," + idForRead + ",developSliderFeedbackBinding())");
            return idForRead;
        }
        await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + port + "/#sliders" });
        await waitFor(() => evaluate("typeof developSliderControls!=='undefined' && " + JSON.stringify(ids) + ".every(id=>developSliderControls[id]&&!developSliderControls[id].range.disabled)"), "SDR feedback");
        assert.equal(await evaluate(control("SDRBlend") + ".definition.label"), "Highlight Saturation");
        // Explicit delayed results use production feedback functions; ordinary polling
        // remains responsive so the fixture cannot exhaust Chromium's HTTP connections.
        for (const id of ids) {
            const start = calls.length;
            holdAdmission = true;
            await drag(id, [8, 24, 41]);
            await waitFor(() => heldAdmissions.length === 1, "first admitted drag");
            await drag(id, [46, 65, 79]);
            await feedback(id, 41);
            assert.equal((await state(id)).local, 79, id + ": old authority cannot overwrite newer drag");
            assert.equal(calls.length, start + 1, "HTTP submissions stay serialized per slider");
            holdAdmission = false; heldAdmissions.shift()();
            await waitFor(() => calls.length === start + 2, "latest drag submitted");
            await waitFor(async () => !(await state(id)).inFlight, "latest admission completed");
            const confirmedId = await feedback(id, 79);
            assert.equal((await state(id)).pending, false);
            await feedback(id, 41, confirmedId - 1);
            assert.equal((await state(id)).local, 79, "late older feedback stays rejected");
            await feedback(id, 53);
            assert.equal((await state(id)).local, 53, "new Lightroom edits remain visible after confirmation");
            assert.deepEqual(calls.slice(start), [{ slider: id, value: 41, reset: false }, { slider: id, value: 79, reset: false }]);
        }
        // Alternate controls before either receives feedback, then deliver replies in reverse order.
        const pair = ["SDRBlend", "SDRHighlights"], startPair = calls.length;
        await drag(pair[0], [60, 88]); await drag(pair[1], [-10, -34]); await drag(pair[0], [70, 94]);
        await waitFor(() => calls.length === startPair + 3, "alternating commands");
        await waitFor(async () => (await Promise.all(pair.map(state))).every(s => !s.inFlight), "alternating admissions");
        await feedback(pair[0], 88); await feedback(pair[1], 0);
        assert.deepEqual((await Promise.all(pair.map(state))).map(s => s.local), [94, -34]);
        await feedback(pair[1], -34); await feedback(pair[0], 94);
        assert.deepEqual((await Promise.all(pair.map(state))).map(s => s.pending), [false, false]);
        // Reset after a new drag cancels its unsent value and queues behind its admitted write.
        const id = "SDRBlend", startReset = calls.length;
        holdAdmission = true; await drag(id, [62, 72]);
        await waitFor(() => heldAdmissions.length === 1, "drag before Reset");
        await drag(id, [75, 90]);
        await evaluate(control(id) + ".reset.click()");
        holdAdmission = false; heldAdmissions.shift()();
        await waitFor(() => calls.length === startReset + 2, "Reset after admitted drag");
        await waitFor(async () => !(await state(id)).inFlight, "Reset admitted");
        assert.deepEqual(calls.slice(startReset), [{ slider: id, value: 72, reset: false }, { slider: id, value: 0, reset: true }]);
        await feedback(id, 0); assert.equal((await state(id)).local, 0);
        // Rejected writes restore SDK authority and report the error without retry.
        rejectNext = true; const startReject = calls.length;
        await drag(id, [20, 36]);
        await waitFor(async () => !(await state(id)).inFlight && calls.length === startReject + 1, "rejected admission");
        assert.equal((await state(id)).local, 0);
        assert.match(await evaluate("statusBox.textContent"), /rejected/);

        // Reproduce the recorded failure through DOM input, the real confirmation
        // timer, fetch, snapshot HTTP 404 and the rendered range/number fields.
        await feedback(captured.slider, captured.cachedValue);
        await evaluate("window.__brightnessDisplays=[];window.__originalShow=showDevelopSliderLocal;showDevelopSliderLocal=function(c,v){const out=window.__originalShow(c,v);if(c.definition.id==='SDRBrightness')window.__brightnessDisplays.push({value:Number(c.range.value),number:Number(c.number.value)});return out;}");
        capture.active = true;
        const captureCommands = calls.length;
        await drag(captured.slider, [-90, 64, captured.latestInput]);
        await waitFor(() => capture.invalidated, "captured expiry read discarded before the next context poll");
        await new Promise(resolve => setTimeout(resolve, 200));
        const displays = await evaluate("window.__brightnessDisplays");
        assert(!displays.some(event => event.value === captured.cachedValue || event.number === captured.cachedValue),
            "recorded failure: expired confirmation must not render cached 0 over latest -49");
        await waitFor(async () => capture.reads >= 3 && !(await state(captured.slider)).pending, "fresh SDK read confirms the owned edit");
        assert.equal((await state(captured.slider)).local, captured.latestInput);
        assert.deepEqual(calls.slice(captureCommands), [{ slider: captured.slider, value: captured.latestInput, reset: false }],
            "read renewal must not resend the uncertain edit");
        capture.active = false;
        assert.deepEqual(errors, []); assert.deepEqual(mock.unexpectedRequests, []);
        console.log("SDR shared Controller passed: all seven IDs, repeated touch drags, held admissions, alternating sliders, old feedback rejection, legitimate new Lightroom values, ordered Reset after drag, explicit rejection, and captured revision/404 rollback through the rendered DOM. Mock SDK only.");
    } finally {
        heldAdmissions.splice(0).forEach(finish => finish());
        fixture.holdSnapshots = false; fixture.heldSnapshots.splice(0).forEach(finish => finish());
        await browser.cleanup(resources);
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
