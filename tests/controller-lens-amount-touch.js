"use strict";
// Focused extension of the existing Lens Amount browser fixture. Real Chromium
// touch delivery, simulated HTTP/SDK only; never connects to Lightroom.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function verify({ cdp, run, wait, fixture, ids, artifacts }) {
    let phase = "setup";
    const requests = [], samples = [], previous = fixture.handle;
    fixture.handle = (url, reply) => {
        const slider = url.searchParams.get("slider");
        const kind = ["/api/set", "/api/adjust", "/api/reset"].includes(url.pathname) ? "command"
            : url.pathname.startsWith("/api/feedback/request") ? (url.searchParams.has("purpose") ? "targeted-feedback" : "background-feedback")
            : "other-read";
        requests.push({ phase, kind, at: Date.now(), path: url.pathname, search: url.search });
        if (url.pathname === "/api/set" && ids.includes(slider)) fixture.values[slider] = Number(url.searchParams.get("value"));
        return previous(url, reply);
    };
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    await run(`window.lensTouchEvents=[];window.lensTouchStarts=[];
        const originalLensBegin=beginDevelopSliderInteraction;
        beginDevelopSliderInteraction=function(control,kind){lensTouchStarts.push({id:control.definition.id,kind,at:Date.now()});return originalLensBegin(control,kind);};
        for(const type of ['pointerdown','pointerup','pointercancel','input','change'])document.addEventListener(type,event=>{
            const c=event.target.closest?.('.lens-profile-amount-row');if(c)lensTouchEvents.push({type,id:c.dataset.sliderId,
                disabled:event.target.matches(':disabled'),trusted:event.isTrusted,at:Date.now()});},true);`);
    async function snapshot() {
        return run(`(${JSON.stringify(ids)}).map(id=>{const c=developSliderControls[id],r=c.row.getBoundingClientRect();return {id,
            ownDisabled:c.range.disabled,effectiveDisabled:c.range.matches(':disabled'),values:[c.range.value,c.number.value],
            dragging:c.dragging,pointerActive:c.pointerActive,interacting:isDevelopSliderInteracting(c),
            confirmation:c.confirmationPending,layout:[r.width,r.height]};})`);
    }
    async function position(id, element = "range") {
        return run(`(()=>{const e=developSliderControls[${JSON.stringify(id)}].${element};e.scrollIntoView({block:'center'});
            const r=e.getBoundingClientRect();return {x:r.left+r.width*.4,y:r.top+r.height/2,endX:r.left+r.width*.7};})()`);
    }
    async function touch(id, drag, element = "range") {
        const point = await position(id, element);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y, id: 71 }] });
        if (drag) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.endX, y: point.y, id: 71 }] });
        const during = await snapshot();
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await pause(170); // Observe existing throttle/confirmation, without changing it.
        return during;
    }
    await position(ids[0]);
    phase = "idle-before"; await pause(1100);
    for (const id of ids) {
        for (const drag of [false, true]) {
            phase = "disabled-" + id + (drag ? "-drag" : "-tap");
            const before = await snapshot(), start = await run("lensTouchStarts.length"), eventStart = await run("lensTouchEvents.length");
            const during = await touch(id, drag);
            samples.push({ phase, before, during, after: await snapshot(),
                starts: await run("lensTouchStarts.slice(" + start + ")"), events: await run("lensTouchEvents.slice(" + eventStart + ")") });
        }
        phase = "disabled-" + id + "-reset";
        await touch(id, false, "reset");
    }
    // A custom input callback must obey effective availability as well, even if
    // a browser delivers a trailing input/change after the parent becomes disabled.
    phase = "disabled-trailing-input";
    const before = await snapshot(), start = await run("lensTouchStarts.length");
    await run(`for(const id of ${JSON.stringify(ids)}){const range=developSliderControls[id].range;
        range.dispatchEvent(new Event('input',{bubbles:true}));range.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await pause(170);
    samples.push({ phase, before, after: await snapshot(), starts: await run("lensTouchStarts.slice(" + start + ")"), syntheticTrailingInput: true });
    phase = "idle-after"; await pause(1100);

    phase = "enable"; fixture.values.LensProfileEnable = 1;
    await run("requestLiveFeedbackSnapshot(true)");
    await wait("!developSliderControls.LensProfileDistortionScale.range.matches(':disabled') && !developSliderControls.LensProfileVignettingScale.range.matches(':disabled')");
    for (const id of ids) {
        phase = "enabled-" + id;
        const before = await snapshot(), start = await run("lensTouchStarts.length"), eventStart = await run("lensTouchEvents.length");
        const during = await touch(id, true);
        await wait(`!developSliderControls[${JSON.stringify(id)}].confirmationPending && !developSliderControls[${JSON.stringify(id)}].requestInFlight`);
        samples.push({ phase, before, during, after: await snapshot(),
            starts: await run("lensTouchStarts.slice(" + start + ")"), events: await run("lensTouchEvents.slice(" + eventStart + ")") });
    }
    const counts = Object.fromEntries([...new Set(requests.map(r => r.phase))].map(name => [name,
        Object.fromEntries(["command", "targeted-feedback", "background-feedback", "other-read"].map(kind => [kind, requests.filter(r => r.phase === name && r.kind === kind).length]))]));
    const report = { scope: "Trusted Chromium touch events plus separate synthetic trailing-input case; simulated HTTP/SDK", counts, samples, requests };
    if (artifacts) fs.writeFileSync(path.join(artifacts, "touch-results.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ counts, disabledCommands: requests.filter(r => r.phase.startsWith("disabled-") && r.kind === "command") }, null, 2));
    for (const name of ["idle-before", "idle-after"]) {
        assert(counts[name]["background-feedback"] > 0, "Normal background feedback remains active " + name);
        assert.equal(counts[name].command, 0); assert.equal(counts[name]["targeted-feedback"], 0);
    }
    for (const sample of samples.filter(s => !s.syntheticTrailingInput)) {
        assert(sample.events.some(e => e.type === "pointerdown" && e.trusted), "Real touch reached " + sample.phase);
        if (!sample.phase.startsWith("disabled-")) {
            assert(sample.starts.length > 0, "Enabled drag starts interaction");
            assert(counts[sample.phase].command > 0, "Enabled drag sends Set");
            assert(counts[sample.phase]["targeted-feedback"] > 0, "Enabled drag confirms through existing feedback");
            const index = ids.findIndex(id => sample.phase.endsWith(id));
            assert.notDeepEqual(sample.after[index].values, sample.before[index].values, "Enabled drag updates displayed value");
        }
    }
    if (process.argv.includes("--observe-touch")) return; // Save complete before-fix diagnosis instead of stopping at the first assertion.
    for (const sample of samples.filter(s => s.phase.startsWith("disabled-"))) {
        assert.deepEqual(sample.starts, [], "Disabled input does not begin an interaction: " + sample.phase);
        for (const state of [sample.during, sample.after].filter(Boolean)) {
            assert.deepEqual(state.map(c => [c.interacting,c.dragging,c.pointerActive]), [[false,false,false],[false,false,false]]);
            assert.deepEqual(state.map(c => c.values), sample.before.map(c => c.values), "Disabled input preserves values");
            assert.deepEqual(state.map(c => c.layout), sample.before.map(c => c.layout), "Disabled input preserves layout");
        }
    }
    assert.deepEqual(requests.filter(r => r.phase.startsWith("disabled-") && ["command", "targeted-feedback"].includes(r.kind)), [],
        "Disabled gestures send neither edits nor touch-triggered feedback; ordinary polling continues");
    console.log("PASS disabled Lens Amount tap/drag/trailing input: no interactions, commands or targeted reads; background polling preserved; enabled drags write and confirm. Existing Reset behavior retained.");
}
module.exports = { verify };
