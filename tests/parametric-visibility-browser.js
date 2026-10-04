"use strict";

// Real Controller and viewport; synthetic read-only HTTP feedback, no Lightroom.
// Deliberately uses automatic production polling, never a forced read or redraw.
const assert = require("node:assert/strict");
const browser = require("./controller-browser-lifecycle");
const curve = require("../app/controller-tone-curve");
const fields = Object.values(curve.PARAMETRIC_CURVE_FIELDS);
const tones = fields.slice(0, 4);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async function () {
    const resources = { mock: browser.createMockControllerServer({ grainOnly: true, sourceCorrectionsOnly: true,
        controllerSource: process.env.LRBRIDGE_VISIBILITY_CONTROLLER }),
        browser: null, browserCdp: null, pageCdp: null, browserProfileDirectory: null };
    const fixture = resources.mock.grainFixture;
    const errors = [];
    let pointFixture = null;
    const originalHandle = fixture.handle;
    fixture.handle = function (parsed, send) {
        if (pointFixture && parsed.pathname === "/api/tone-curve/state") {
            send({ ok: true, pointCurve: { ...pointFixture, ...fixture.context, updatedAt: Date.now() } });
            return true;
        }
        return originalHandle(parsed, send);
    };
    function values(shadows, darks, lights, highlights, splits = [25, 50, 75]) {
        return Object.fromEntries(fields.map((field, index) => [field, [shadows, darks, lights, highlights, ...splits][index]]));
    }
    Object.assign(fixture.values, values(0, 0, 0, 0));
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
        const waitFor = async (expression, description) => {
            const deadline = Date.now() + 6000;
            while (!await evaluate(expression)) {
                if (Date.now() > deadline) throw Error("Timed out: " + (description || expression));
                await pause(30);
            }
        };
        const expectGraph = async expected => {
            const path = curve.parametricCurvePathData(expected, [0, 0, 255, 255]);
            await waitFor("parametricCurveGraphPath.getAttribute('d')===" + JSON.stringify(path), "automatic graph update");
            assert.deepEqual(await evaluate("collectParametricCurveValues(false)"), expected);
        };
        const rawRowFilter = `Object.keys(sliderFeedbackElements).filter(id=>{
            const e=sliderFeedbackElements[id];if(!e||!e.isConnected||!e.getBoundingClientRect)return false;
            if(e.closest('.collapsible-section-body[hidden]'))return true;
            const r=e.getBoundingClientRect();return r.bottom>=-160&&r.top<=innerHeight+160&&r.right>=-160&&r.left<=innerWidth+160;
        })`;
        const graphView = async () => {
            await evaluate("document.querySelector('.parametric-curve-graph-shell').scrollIntoView({block:'start'});window.scrollBy(0,-140)");
            const geometry = await evaluate(`(()=>{const r=parametricCurveGraphElement.getBoundingClientRect();return {
                graphVisible:r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight,
                offscreen:${JSON.stringify(tones)}.every(id=>sliderFeedbackElements[id].getBoundingClientRect().top>innerHeight+160),
                rows:${JSON.stringify(tones)}.map(id=>({id,top:sliderFeedbackElements[id].getBoundingClientRect().top})),height:innerHeight,
                raw:${rawRowFilter},requested:getVisibleFeedbackSliders()};})()`);
            assert.equal(geometry.graphVisible, true, JSON.stringify(geometry));
            assert.equal(geometry.offscreen, true, JSON.stringify(geometry));
            // The only permitted additions are the visible graph's seven dependencies.
            assert(geometry.requested.filter(id => !geometry.raw.includes(id)).every(id => fields.includes(id)));
            return geometry;
        };
        const toneView = async () => {
            await evaluate("developSliderControls.ParametricShadows.row.scrollIntoView({block:'start'});window.scrollBy(0,-140)");
            assert.equal(await evaluate(`${JSON.stringify(tones)}.every(id=>getVisibleFeedbackSliders().includes(id))`), true);
            // An offscreen graph must leave the existing row-only optimization intact.
            assert.deepEqual(await evaluate("getVisibleFeedbackSliders()"), await evaluate(rawRowFilter));
        };
        await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + port });
        await waitFor("!!document.querySelector('[data-tab=tone-curve]')");
        await evaluate("document.querySelector('[data-tab=tone-curve]').click();document.querySelectorAll('.collapsible-section-toggle[aria-expanded=false]').forEach(b=>b.click())");
        await waitFor("!!parametricCurveGraphPath&&!!pointCurveController.getState().authoritative&&!!collectParametricCurveValues(false)");
        pointFixture = await evaluate("pointCurveController.getState().authoritative");
        await waitFor("!liveFeedbackSnapshotInFlight&&!pendingFullFeedbackSnapshot");

        for (const width of [1280, 390]) {
            await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: width === 1280 ? 650 : 480, deviceScaleFactor: 1, mobile: false });
            // The previously working case, followed by the captured visibility failure.
            await toneView();
            const visibleSplits = await evaluate(`${JSON.stringify(fields.slice(4))}.map(id=>developSliderControls[id].authoritativeValue)`);
            const visibleValues = values(width === 1280 ? 12 : 18, -10, 15, -5, visibleSplits);
            Object.assign(fixture.values, visibleValues);
            await expectGraph(visibleValues);
            await waitFor("!liveFeedbackSnapshotInFlight&&!pendingFullFeedbackSnapshot");
            const geometry = await graphView();
            const requestStart = resources.mock.requestLog.length;
            const remoteValues = values(width === 1280 ? 60 : 45, -35, -20, -10, [10, 20, 75]);
            Object.assign(fixture.values, remoteValues);
            // Allow normal polling to deliver external values, not a forced all-control refresh.
            await pause(1600);
            const batches = resources.mock.requestLog.slice(requestStart).filter(r => r.path === "/api/feedback/request-many")
                .map(r => new URLSearchParams(r.search).get("sliders").split(","));
            const actual = await evaluate("({values:collectParametricCurveValues(false),path:parametricCurveGraphPath.getAttribute('d')})");
            console.log(JSON.stringify({ width, geometry, batches, expected: remoteValues,
                actual: { values: actual.values, pathMatchesExpected: actual.path === curve.parametricCurvePathData(remoteValues, [0, 0, 255, 255]) } }));
            assert(batches.some(batch => fields.every(id => batch.includes(id))), "Visible graph poll omitted offscreen Parametric dependencies");
            await expectGraph(remoteValues);

            await toneView();
            const returnedSplits = await evaluate(`${JSON.stringify(fields.slice(4))}.map(id=>developSliderControls[id].authoritativeValue)`);
            const returnedValues = values(-30, 25, -12, 34, returnedSplits);
            Object.assign(fixture.values, returnedValues);
            await expectGraph(returnedValues);
            await graphView();
            const nextValues = values(22, -18, 32, -24, [20, 60, 80]);
            Object.assign(fixture.values, nextValues);
            await expectGraph(nextValues);

            // Focused local input stays owned while another field gets fresh feedback.
            await evaluate("(()=>{const n=developSliderControls.ParametricShadows.number;n.focus({preventScroll:true});n.value='77';n.dispatchEvent(new Event('input',{bubbles:true}));})()");
            const editingValues = { ...nextValues, ParametricDarks: 41 };
            Object.assign(fixture.values, editingValues);
            await waitFor("developSliderControls.ParametricDarks.authoritativeValue===41");
            assert.equal(await evaluate("developSliderControls.ParametricShadows.number.value"), "77");
            await evaluate("developSliderControls.ParametricShadows.number.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
        }

        // A delayed old-photo snapshot cannot confirm values on the new photo.
        await waitFor("!liveFeedbackSnapshotInFlight");
        fixture.holdSnapshots = true;
        const heldDeadline = Date.now() + 6000;
        while (!fixture.heldSnapshots.length) { if (Date.now() > heldDeadline) throw Error("No held feedback snapshot"); await pause(30); }
        const oldValues = { ...await evaluate("collectParametricCurveValues(false)") };
        Object.assign(fixture.context, { selectedPhotoUuid: "parametric-visibility-photo-b", selectedPhotoKey: "parametric-visibility-photo-b",
            contextCounter: fixture.context.contextCounter + 1, contextChangedAt: Date.now() });
        const newValues = values(-42, 36, -28, 16);
        Object.assign(fixture.values, newValues);
        await waitFor("lastControllerSelectedPhotoUuid==='parametric-visibility-photo-b'");
        fixture.holdSnapshots = false;
        fixture.heldSnapshots.splice(0).forEach(release => release());
        await expectGraph(newValues);
        assert.notDeepEqual(await evaluate("collectParametricCurveValues(false)"), oldValues);
        assert.equal(fixture.mutations.length, 0);
        assert(!resources.mock.requestLog.some(r => ["/api/command", "/api/set", "/api/reset", "/api/tone-curve/set"].includes(r.path)));
        assert.deepEqual(errors, []);
        console.log("PASS automatic Parametric graph feedback: visible/offscreen tone rows, return visibility, desktop/narrow, seven dependencies only, local numeric ownership and stale-photo response rejection. Synthetic browser evidence only; no native edits.");
    } finally {
        fixture.holdSnapshots = false;
        fixture.heldSnapshots.splice(0).forEach(release => release());
        await browser.cleanup(resources);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
