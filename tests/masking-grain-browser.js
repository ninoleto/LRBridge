"use strict";

const assert = require("node:assert/strict");
const { unavailableSnapshot } = require("../server/masking-state");

// Fixture-only backend for the production browser renderer. No Lightroom access.
function createFixture(contextFactory, feedbackResult) {
    const fixture = {
        context: contextFactory(), values: { GrainSize: 25, GrainFrequency: 50 },
        maskIndex: 1, revision: 1, mutations: [], snapshots: new Map(), requestId: 9000, contextReads: 0,
        holdSnapshots: false, heldSnapshots: [], bumpDevelopOnWrite: false, pointColor: null,
        toneReads: 0, toneDelayMs: 240, maskReadyAt: 0, transientStates: 0,
        curves: { rgb: [0, 0, 80, 65, 180, 197, 255, 255], red: [0, 0, 255, 255],
            green: [0, 0, 255, 255], blue: [0, 0, 110, 132, 255, 255] }
    };
    fixture.handle = function (url, reply) {
        if (url.pathname === "/api/context") {
            fixture.contextReads += 1;
            reply(Object.assign({}, fixture.context, { lastHeartbeatAt: Date.now() }));
        } else if (url.pathname === "/api/masking/state") {
            const body = Object.assign({}, fixture.context, {
                serverEpoch: "grain-fixture", revision: fixture.revision, capturedAt: Date.now(),
                available: true, active: true, pendingOperation: null, lastResult: null,
                maskGroupCount: 2, hasSelectedMaskGroup: true,
                selectedMaskGroupIndex: fixture.maskIndex, selectedMaskGroupId: "grain-mask-" + fixture.maskIndex,
                selectedMaskGroupName: "Grain mask " + fixture.maskIndex, selectedMaskHidden: false,
                previousAvailable: fixture.maskIndex > 1, nextAvailable: fixture.maskIndex < 2,
                selectedMaskToolAvailable: true, selectedMaskToolId: "grain-tool-" + fixture.maskIndex,
                selectedMaskToolHidden: false, selectedMaskToolCount: 1, selectedMaskToolIndex: 1,
                previousMaskToolAvailable: false, nextMaskToolAvailable: false,
                corrections: ["local_Texture", "local_Clarity", "local_Dehaze", "local_Sharpness"].map(parameter =>
                    ({ parameter, value: 0, min: -100, max: 100 })).concat([
                    { parameter: "local_Grain", value: fixture.maskIndex === 1 ? 27 : 4, min: -100, max: 100 }]),
                pointColor: fixture.pointColor || { available: false, swatchCount: 0, selectedIndex: 0, selectionTransient: false }
            });
            // Production syncContext publishes this empty context_changed snapshot
            // immediately, before the asynchronous SDK masking query completes.
            if (Date.now() < fixture.maskReadyAt) {
                Object.assign(body, unavailableSnapshot("context_changed"), { capturedAt: null });
                fixture.transientStates += 1;
            }
            if (fixture.bumpDevelopOnWrite) setTimeout(function () { reply(body); }, 180);
            else reply(body);
        } else if (url.pathname === "/api/masking/tone-curve/state") {
            fixture.toneReads += 1;
            const pointCurve = Object.assign({}, fixture.context, {
                available: true, revision: fixture.revision, updatedAt: Date.now(),
                serverEpoch: "grain-fixture", maskingRevision: fixture.revision,
                selectedMaskGroupId: "grain-mask-" + fixture.maskIndex,
                name: "Custom", refineSaturation: { value: 100, min: 0, max: 100 },
                curves: JSON.parse(JSON.stringify(fixture.curves))
            });
            const body = Date.now() < fixture.maskReadyAt ? { available: false } : pointCurve;
            setTimeout(() => reply({ ok: true, pointCurve: body }), fixture.toneDelayMs);
        } else if (["/api/set", "/api/reset"].includes(url.pathname)) {
            const slider = url.searchParams.get("slider");
            assert.ok(Object.hasOwn(fixture.values, slider), "only the two global Grain values may be written");
            const value = url.pathname === "/api/reset" ? (slider === "GrainSize" ? 25 : 50)
                : Number(url.searchParams.get("value"));
            assert.ok(Number.isInteger(value) && value >= 0 && value <= 100);
            const preserveMaskingPanel = url.searchParams.get("preserveMaskingPanel") === "true";
            if (preserveMaskingPanel) {
                assert.equal(url.searchParams.get("selectedPhotoUuid"), fixture.context.selectedPhotoUuid);
                assert.equal(url.searchParams.get("contextCounter"), String(fixture.context.contextCounter));
            }
            fixture.mutations.push({ path: url.pathname, slider, value, photo: fixture.context.selectedPhotoUuid, preserveMaskingPanel });
            fixture.values[slider] = value;
            if (fixture.bumpDevelopOnWrite) {
                fixture.context.developCounter += 1;
                fixture.context.developChangedAt = Date.now();
                fixture.revision += 1;
                fixture.maskReadyAt = Date.now() + 900;
            }
            reply({ ok: true });
        } else if (["/api/feedback/request", "/api/feedback/request-many"].includes(url.pathname)) {
            const sliders = (url.searchParams.get("sliders") || url.searchParams.get("slider") || "").split(",");
            const id = ++fixture.requestId;
            const results = Object.fromEntries(sliders.map(function (slider) {
                const result = feedbackResult(slider, id);
                if (Object.hasOwn(fixture.values, slider)) result.value = fixture.values[slider];
                return [slider, result];
            }));
            fixture.snapshots.set(String(id), { id, results, complete: true, requestedAt: Date.now(), completedAt: Date.now() });
            reply({ ok: true, request: { id, requestedAt: Date.now() } });
        } else if (url.pathname === "/api/feedback/snapshot") {
            const body = { ok: true, snapshot: fixture.snapshots.get(url.searchParams.get("id")) };
            if (fixture.holdSnapshots) fixture.heldSnapshots.push(function () { reply(body); });
            else reply(body);
        } else return false;
        return true;
    };
    return fixture;
}

async function verify({ evaluate, waitFor, selectTab, fixture, setViewport }) {
    const selector = id => '.develop-slider-row[data-slider-id="' + id + '"]';
    const row = id => "document.querySelector(" + JSON.stringify(selector(id)) + ")";
    async function values(size, roughness) {
        await waitFor(async function () {
            return evaluate("['GrainSize','GrainFrequency'].map(id => {const r=document.querySelector(" +
                "'.develop-slider-row[data-slider-id=\"'+id+'\"]'); return r && !r.querySelector('input').disabled ? " +
                "Number(r.querySelector('input[type=text]').value):null;}).join(',') === " + JSON.stringify(size + "," + roughness));
        }, "authoritative global Grain values " + size + "," + roughness);
    }
    async function reveal() {
        await evaluate("(() => {const r=" + row("GrainSize") + "; const b=r.closest('.collapsible-section-body');" +
            "if(b && b.hidden)b.parentElement.querySelector('[aria-expanded=false]').click();r.scrollIntoView({block:'center'});})()");
    }
    async function edit(id, value, kind) {
        const count = fixture.mutations.length;
        if (kind === "numeric") {
            await evaluate("(() => {const n=" + row(id) + ".querySelector('input[type=text]');n.focus();n.value=" +
                JSON.stringify(String(value)) + ";n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()");
        } else if (kind === "range") {
            await evaluate("(() => {const r=" + row(id) + ".querySelector('input[type=range]');r.value=" +
                JSON.stringify(String(value)) + ";r.dispatchEvent(new Event('input',{bubbles:true}));" +
                "r.dispatchEvent(new Event('change',{bubbles:true}));})()");
        } else {
            const button = kind === "reset" ? "button.reset" : "button[aria-label^='" +
                (kind === "plus" ? "Increase" : "Decrease") + "']";
            await evaluate(row(id) + ".querySelector(" + JSON.stringify(button) + ").click()");
        }
        await waitFor(async () => fixture.mutations.length > count && fixture.values[id] === value, kind + " " + id);
        assert.equal(fixture.mutations.at(-1).path, kind === "reset" ? "/api/reset" : "/api/set");
        assert.equal(fixture.mutations.at(-1).preserveMaskingPanel,
            await evaluate(row(id) + ".classList.contains('masking-shared-grain-row')"));
        await values(fixture.values.GrainSize, fixture.values.GrainFrequency);
    }
    await selectTab("tools");
    await waitFor(() => evaluate("!!document.querySelector('.masking-shared-grain-row')"), "Masking Grain rows");
    await reveal();
    await values(25, 50);
    const presentation = await evaluate("(() => {const h=document.querySelector('.masking-corrections'); return {" +
        "note:h.querySelector('.masking-shared-grain-note').textContent," +
        "rows:[...h.querySelectorAll('.masking-shared-grain-row')].map(r=>({id:r.dataset.sliderId," +
        "visible:r.getClientRects().length>0,min:r.querySelector('input').min,max:r.querySelector('input').max," +
        "step:r.querySelector('input').step,number:!!r.querySelector('input[type=text]'),buttons:[...r.querySelectorAll('button')].map(b=>b.textContent)}))," +
        "local:Number(h.querySelector('[data-masking-correction=local_Grain] input[type=text]').value)}})()");
    assert.match(presentation.note, /global settings shared across all Grain tools/);
    assert.equal(presentation.local, 27);
    assert.deepEqual(presentation.rows.map(r => [r.id, r.visible, r.min, r.max, r.step, r.number, r.buttons]), [
        ["GrainSize", true, "0", "100", "1", true, ["−", "+", "Reset"]],
        ["GrainFrequency", true, "0", "100", "1", true, ["−", "+", "Reset"]]
    ]);
    for (const id of ["GrainSize", "GrainFrequency"]) {
        await edit(id, 61, "numeric");
        await edit(id, 62, "plus");
        await edit(id, 61, "minus");
        await edit(id, 100, "range");
        await edit(id, id === "GrainSize" ? 25 : 50, "reset");
    }
    fixture.values.GrainSize = 44;
    fixture.values.GrainFrequency = 68;
    await values(44, 68);
    await selectTab("sliders");
    await reveal();
    await values(44, 68);
    await edit("GrainSize", 33, "numeric");
    await selectTab("tools");
    await reveal();
    await values(33, 68);
    await evaluate("window.__grainRowsBeforeSwitch=[...document.querySelectorAll('.masking-shared-grain-row')]");
    fixture.maskIndex = 2;
    fixture.revision += 1;
    await waitFor(() => evaluate("document.querySelector('[data-masking-correction=local_Grain] input[type=text]').value==='4'"),
        "new mask-local Grain Amount");
    await values(33, 68);
    assert.equal(await evaluate("[...document.querySelectorAll('.masking-shared-grain-row')].every((r,i)=>r===window.__grainRowsBeforeSwitch[i])"), true);
    // A numeric edit begun on the previous photo must be cancelled at navigation.
    await evaluate("(() => {const n=" + row("GrainSize") + ".querySelector('input[type=text]');n.focus();n.value='92';})()");
    const countBeforePhoto = fixture.mutations.length;
    const contextReadsBeforePhoto = fixture.contextReads;
    Object.assign(fixture.context, {
        selectedPhotoUuid: "grain-photo-b", selectedPhotoKey: "grain-photo-b",
        contextCounter: fixture.context.contextCounter + 1, contextChangedAt: Date.now()
    });
    fixture.revision += 1;
    fixture.values.GrainSize = 12;
    fixture.values.GrainFrequency = 76;
    // Wait for the production context poll to invalidate the active edit.
    await waitFor(async () => fixture.contextReads >= contextReadsBeforePhoto + 2, "new photo context polls");
    await evaluate(row("GrainSize") + ".querySelector('input[type=text]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
    await values(12, 76);
    assert.equal(fixture.mutations.length, countBeforePhoto, "old-photo input must never be submitted to the new photo");
    await reveal();
    // Hold a changed old-photo read across navigation, then hold the new-photo read
    // so a stale intermediate value cannot hide behind the following good response.
    fixture.values.GrainSize = 91;
    fixture.values.GrainFrequency = 92;
    fixture.holdSnapshots = true;
    await waitFor(async () => fixture.heldSnapshots.length > 0, "delayed old-photo Grain feedback");
    const readsBeforeNextPhoto = fixture.contextReads;
    Object.assign(fixture.context, {
        selectedPhotoUuid: "grain-photo-c", selectedPhotoKey: "grain-photo-c",
        contextCounter: fixture.context.contextCounter + 1, contextChangedAt: Date.now()
    });
    fixture.revision += 1;
    fixture.values.GrainSize = 19;
    fixture.values.GrainFrequency = 81;
    await waitFor(async () => fixture.contextReads >= readsBeforeNextPhoto + 2, "next photo context polls");
    await reveal();
    fixture.heldSnapshots.shift()();
    await waitFor(async () => fixture.heldSnapshots.length > 0, "new-photo Grain feedback request");
    assert.notEqual(await evaluate(row("GrainSize") + ".querySelector('input[type=text]').value"), "91",
        "delayed feedback from the previous photo must not overwrite the current Grain control");
    fixture.holdSnapshots = false;
    fixture.heldSnapshots.splice(0).forEach(release => release());
    await values(19, 81);
    const scrollChecks = [];
    // A selected Point Color sample contributes substantial layout above Grain.
    // This fixture supplies state only: no Point Color/Visualize commands are sent.
    const pcRange = { LowerNone: 0.1, LowerFull: 0.3, UpperFull: 0.7, UpperNone: 0.9 };
    fixture.pointColor = { available: true, swatchCount: 1, selectedIndex: 1, selectionTransient: false,
        HueShift: 0, SatScale: 0, LumScale: 0, Variance: 0, RangeAmount: 0.5,
        HueRange: pcRange, SatRange: pcRange, LumRange: pcRange,
        HueRangeMarker: 0.5, SatRangeMarker: 0.5, LumRangeMarker: 0.5 };
    fixture.revision += 1;
    await waitFor(() => evaluate("!!document.querySelector('.masking-point-color-shared [data-point-color-field]')"),
        "selected Point Color display fixture");
    fixture.bumpDevelopOnWrite = true;
    await waitFor(() => evaluate("(() => {const p=document.querySelector('.masking-tone-curve .point-curve-line');" +
        "return p && p.getAttribute('d') && document.querySelector('.masking-tone-curve .point-curve-updating').hidden;})()"),
        "active Masking Tone Curve before observing Grain feedback");
    for (const width of [1280, 390]) {
        await setViewport(width, 900);
        await reveal();
        for (const id of ["GrainSize", "GrainFrequency"]) {
        const channel = id === "GrainSize" ? "rgb" : "blue";
        await evaluate("document.querySelector('.masking-tone-curve .point-curve-channel-" + channel + "').click()");
        for (const kind of ["numeric", "plus", "minus", "range", "reset", "draft"]) {
            // Setup ends before observation starts. No scrolling is forced during the operation.
            await evaluate("(() => {const r=" + row(id) + ";" +
                "document.scrollingElement.scrollTop=document.scrollingElement.scrollHeight;" +
                "r.querySelector('input[type=text]').focus({preventScroll:true});})()");
            await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
            await evaluate("(() => {const r=" + row(id) + ";const n=r.querySelector('input[type=text]');" +
                "const s=document.scrollingElement;const status=document.getElementById('status');" +
                "const tone=document.querySelector('.masking-tone-curve');const graph=tone.querySelector('.point-curve-graph-shell');" +
                "const toneStatus=tone.querySelector('.point-curve-status');const overlay=tone.querySelector('.point-curve-updating');" +
                "const samples=[];let raf;function sample(){const b=r.getBoundingClientRect();samples.push({" +
                "scrollTop:s.scrollTop,rowTop:b.top,rowHeight:b.height,documentHeight:s.scrollHeight," +
                "toneHeight:tone.getBoundingClientRect().height,graphHeight:graph.getBoundingClientRect().height," +
                "graphWidth:graph.getBoundingClientRect().width,graphTop:graph.getBoundingClientRect().top," +
                "toneStatusHeight:toneStatus.getBoundingClientRect().height,toneStatus:toneStatus.textContent," +
                "overlay:overlay.hidden?'':overlay.textContent,curvePath:tone.querySelector('.point-curve-line').getAttribute('d')," +
                "toneFocused:tone.contains(document.activeElement)," +
                "statusHeight:status.getBoundingClientRect().height,status:status.textContent," +
                "rowRetained:r.isConnected && r.querySelector('input[type=text]')===n});}" +
                "function frame(){sample();raf=requestAnimationFrame(frame);}sample();raf=requestAnimationFrame(frame);" +
                "const observer=new MutationObserver(sample);observer.observe(status,{childList:true,subtree:true});" +
                "observer.observe(tone,{attributes:true,childList:true,subtree:true,characterData:true});" +
                "window.__grainScrollResult=()=>{sample();cancelAnimationFrame(raf);observer.disconnect();" +
                "return {container:s.tagName,baseline:samples[0],samples};};})()");
            const target = kind === "plus" ? fixture.values[id] + 1
                : kind === "minus" ? fixture.values[id] - 1
                : kind === "reset" ? (id === "GrainSize" ? 25 : 50) : kind === "range" ? 74 : 61;
            if (kind === "draft") {
                await evaluate(row(id) + ".querySelector('input[type=text]').value='83'");
                fixture.context.developCounter += 1;
                fixture.context.developChangedAt = Date.now();
                fixture.revision += 1;
                fixture.maskReadyAt = Date.now() + 900;
                const reads = fixture.contextReads;
                await waitFor(() => fixture.contextReads >= reads + 2, "Develop revision during active numeric draft");
            } else await edit(id, target, kind);
            await waitFor(() => Date.now() >= fixture.maskReadyAt, "simulated SDK query completion");
            await waitFor(() => evaluate("(() => {const t=maskingController.getInteractionState().toneCurve;return " +
                "t.authoritative && t.authoritative.developCounter===" + fixture.context.developCounter +
                " && t.expectedBinding && t.expectedBinding.developCounter===" + fixture.context.developCounter + ";})()"),
                "new authoritative Tone Curve after the complete Grain feedback transition");
            await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
            const geometry = await evaluate("window.__grainScrollResult()");
            assert.equal(geometry.container, "HTML", "test must measure the actual document scrolling element");
            const moved = geometry.samples.find(sample => Math.abs(sample.scrollTop - geometry.baseline.scrollTop) > 0.5 ||
                Math.abs(sample.rowTop - geometry.baseline.rowTop) > 0.5 ||
                Math.abs(sample.rowHeight - geometry.baseline.rowHeight) > 0.5 || !sample.rowRetained);
            assert.equal(moved, undefined, id + " " + kind + " at " + width + "px moved the viewport: " +
                JSON.stringify({ baseline: geometry.baseline, moved }));
            const disturbed = geometry.samples.find(sample => sample.overlay !== "" || !sample.curvePath || sample.toneFocused ||
                Math.abs(sample.toneHeight - geometry.baseline.toneHeight) > 0.5 ||
                Math.abs(sample.graphHeight - geometry.baseline.graphHeight) > 0.5 ||
                Math.abs(sample.graphWidth - geometry.baseline.graphWidth) > 0.5 ||
                Math.abs(sample.graphTop - geometry.baseline.graphTop) > 0.5 ||
                Math.abs(sample.toneStatusHeight - geometry.baseline.toneStatusHeight) > 0.5);
            assert.equal(disturbed, undefined, "Routine Tone Curve feedback disturbed its display: " + JSON.stringify(disturbed));
            if (kind === "draft") {
                assert.equal(await evaluate("document.activeElement === " + row(id) + ".querySelector('input[type=text]') && document.activeElement.value === '83'"), true,
                    "same-photo revision must preserve active numeric draft and focus");
                await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
            }
            scrollChecks.push({ width, id, channel, kind, samples: geometry.samples.length });
        }
        }
    }
    // While the curve itself is visible, incoming Lightroom feedback updates the
    // existing SVG/handles without detaching the focused keyboard target.
    await evaluate("(() => {const t=document.querySelector('.masking-tone-curve');t.scrollIntoView({block:'start'});" +
        "const p=t.querySelector('.point-curve-hit-target');p.focus({preventScroll:true});" +
        "window.__grainVisibleTone={p,svg:t.querySelector('svg'),path:t.querySelector('.point-curve-line')," +
        "d:t.querySelector('.point-curve-line').getAttribute('d'),scroll:document.scrollingElement.scrollTop};})()");
    fixture.curves.blue[3] += 3;
    fixture.revision += 1;
    await waitFor(() => evaluate("window.__grainVisibleTone.path.getAttribute('d')!==window.__grainVisibleTone.d"),
        "visible Tone Curve receives Lightroom feedback in place");
    assert.equal(await evaluate("(() => {const b=window.__grainVisibleTone;return b.p.isConnected && document.activeElement===b.p && " +
        "document.querySelector('.masking-tone-curve svg')===b.svg && Math.abs(document.scrollingElement.scrollTop-b.scroll)<=0.5;})()"), true,
        "visible curve feedback must retain focused handle, SVG and viewport");
    assert.ok(fixture.transientStates > 0, "regression must traverse production's temporary context_changed state");
    assert.equal(fixture.mutations.some(m => m.slider === "local_Grain" || m.path.includes("/masking/")), false);
    return { hosts: 2, sliders: 2, writes: fixture.mutations.length, maskAmountPreserved: true,
        photoEditCancelled: true, stalePhotoFeedbackRejected: true, transientStates: fixture.transientStates,
        visibleCurveUpdatedInPlace: true, scrollChecks };
}

module.exports = { createFixture, verify };
