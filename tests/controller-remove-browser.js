"use strict";
const assert = require("node:assert/strict");
function install(fixture) {
    require("./controller-history-browser").install(fixture);
    const r = fixture.remove = { revision: 1, calls: [], writes: [], reads: 0, pending: null, last: null, hold: false,
        available: true, selectedTool: "dust", delayAdmission: false, admissions: [], stale: null, failNext: false, delay: 250,
        repair: { available: true, selected: false, count: 0 },
        preferences: { newSpotType: "heal", brushSize: 25, brushFeather: 50, useGenerativeAI: true,
            detectObjects: false, toolOverlay: "selected", visualizeSpots: true, visualizationThreshold: 37 } };
    r.state = () => structuredClone({ ok: true, ...fixture.context, serverEpoch: "remove-fixture", revision: r.revision,
        capturedAt: Date.now() - 60000, ageMs: 0, selectedTool: r.selectedTool, available: r.available && r.selectedTool === "dust",
        ...(r.selectedTool === "dust" ? r.preferences : {}), repair: r.repair,
        selectedRepairFill: r.repair.available && r.repair.selected ? r.repair.spotType === "heal_patchmatch" ?
            typeof r.repair.useGenAI === "boolean" ? r.repair.useGenAI ? "generative_remove" : "remove" : null : r.repair.spotType : null,
        selectedRepairOpacity: r.repair.available && r.repair.selected ? r.repair.opacity ?? null : null,
        selectedRepairFeather: r.repair.available && r.repair.selected ? r.repair.feather ?? null : null,
        pendingOperation: r.pending, lastResult: r.last });
    r.finish = (id = r.pending && r.pending.operationId, outcome) => {
        const c = r.calls.find(c => c.operationId === id);
        if (!c || !r.pending || id !== r.pending.operationId) return;
        const panel = c.field === "selectedTool";
        const repair = c.field === "selectedRepair" || c.field === "selectedRepairFill" || ["selectedRepairOpacity","selectedRepairFeather"].includes(c.field);
        const stale = c.tool !== r.selectedTool || c.photo !== fixture.context.selectedPhotoUuid ||
            repair && c.repairToken !== r.repair.token ||
            !panel && (!r.available || c.mode !== r.preferences.newSpotType);
        outcome = outcome || (stale ? "stale" : r.failNext ? "failed" : "confirmed"); r.failNext = false;
        if (outcome === "confirmed") {
            if (panel) {
                r.selectedTool = c.value;
                if(c.value === "dust") { r.preferences.newSpotType = "heal_patchmatch"; if(!r.available) outcome = "failed"; }
            }
            else if (repair) {
                if(["selectedRepairOpacity","selectedRepairFeather"].includes(c.field)) {
                    r.repair[c.field==="selectedRepairOpacity"?"opacity":"feather"]=c.value;r.repair.token=r.repair.index+":"+(r.calls.length%10).toString().repeat(64);
                } else if(c.field === "selectedRepairFill") {
                    r.repair.spotType = ["remove","generative_remove"].includes(c.value) ? "heal_patchmatch" : c.value;
                    r.repair.useGenAI = c.value === "generative_remove";r.repair.token = r.repair.index+":"+(r.calls.length%10).toString().repeat(64);
                } else if (c.value === "delete") r.repair = { available: true, selected: false, count: r.repair.count - 1 };
                else outcome = "requested";
            } else r.preferences[c.field] = c.value;
            r.writes.push({ field: c.field, value: c.value });
        }
        r.last = { operationId: id, field: c.field, value: c.value, outcome, targetRepairToken: c.repairToken || null,
            resultRepairToken: outcome === "confirmed" && ["selectedRepairFill","selectedRepairOpacity","selectedRepairFeather"].includes(c.field) ? r.repair.token : null,
            detail: outcome === "requested" ? "Refresh requested; SDK completion is not exposed." :
                outcome === "confirmed" ? "Preference confirmed." : outcome === "stale" ? "Native mode or context changed." : "Lightroom did not confirm the preference." };
        r.pending = null; r.revision++;
    };
    r.releaseAdmissions = () => { for (const send of r.admissions.splice(0)) send(); };
    const previous = fixture.handle;
    fixture.handle = function (url, reply) {
        if (url.pathname === "/api/remove/state") {
            r.reads++; const value = r.stale || r.state(); r.stale = null; reply(value); return true;
        }
        if (["/api/remove/brush", "/api/remove/panel", "/api/remove/repair"].includes(url.pathname)) {
            const field = url.searchParams.get("field");
            assert.equal(url.searchParams.get("selectedPhotoUuid"), fixture.context.selectedPhotoUuid);
            assert.equal(url.searchParams.get("mode"), r.selectedTool === "dust" ? r.preferences.newSpotType : "null");
            assert.equal(url.searchParams.get("stateRevision"), String(r.revision));
            if (r.pending) assert.ok(r.pending.field !== "selectedTool" && (field === "selectedTool" ||
                field === "newSpotType" && r.pending.field !== "newSpotType"), "SDK writes must be serialized");
            const raw = url.searchParams.get("value");
            const value = ["brushSize", "brushFeather", "visualizationThreshold", "selectedRepairOpacity", "selectedRepairFeather"].includes(field) ? Number(raw) :
                ["useGenerativeAI", "detectObjects", "visualizeSpots"].includes(field) ? raw === "true" : raw;
            const c = { operationId: "rb-" + (r.calls.length + 1), field, value,
                repairToken: url.searchParams.get("repairToken"),
                mode: r.selectedTool === "dust" ? r.preferences.newSpotType : null, tool: r.selectedTool, photo: fixture.context.selectedPhotoUuid };
            if (field === "selectedRepair" || field === "selectedRepairFill" || ["selectedRepairOpacity","selectedRepairFeather"].includes(field)) assert.equal(c.repairToken, r.repair.token);
            r.calls.push(c); r.pending = { operationId: c.operationId, field, value, targetRepairToken: c.repairToken || null }; r.revision++;
            const admitted = r.state();
            if (field === "selectedRepair" && r.corruptRepairAdmission) {
                admitted.pendingOperation.targetRepairToken = null; r.corruptRepairAdmission = false;
            }
            if (r.delayAdmission) r.admissions.push(() => reply(admitted)); else reply(admitted);
            if (!r.hold) setTimeout(() => r.finish(c.operationId), r.delay);
            return true;
        }
        return previous(url, reply);
    };
}
async function verify({ evaluate, waitFor, fixture, setViewport }) {
    const r = fixture.remove;
    const row = field => '[data-remove-field="' + field + '"]';
    const numeric = field => row(field) + ' input[type="text"]';
    const range = field => row(field) + ' input[type="range"]';
    const plus = field => row(field) + ' button[aria-label^="Increase"]';
    const minus = field => row(field) + ' button[aria-label^="Decrease"]';
    const reset = field => row(field) + " button.reset";
    const mode = value => '[data-remove-mode="' + value + '"]';
    const el = selector => "document.querySelector(" + JSON.stringify(selector) + ")";
    const value = field => evaluate(el(numeric(field)) + ".value");
    const click = selector => evaluate(el(selector) + ".click()");
    async function polls(count = 3) { const before = r.reads; await waitFor(() => r.reads > before + count, "Remove feedback polls"); }
    async function displayed(field, expected, message) {
        assert.deepEqual(await evaluate("[" + el(numeric(field)) + ".value," + el(range(field)) + ".value]"),
            [String(expected), String(expected)], message || "numeric and thumb retain requested " + expected);
    }
    async function settled(field, expected) {
        await waitFor(async () => r.preferences[field] === expected && !r.pending &&
            (await evaluate("document.querySelector('.remove-brush-status').textContent")) === "" &&
            (!["brushSize", "brushFeather", "visualizationThreshold"].includes(field) || await value(field) === String(expected)),
            "confirmed " + field + "=" + expected);
    }
    async function pending(field, expected) {
        await waitFor(() => r.pending && r.pending.field === field && r.pending.value === expected, "pending " + field + "=" + expected);
    }
    async function native(values) {
        Object.assign(r.preferences, values); r.revision++; await polls();
    }
    async function edit(field, number, event = "commit") {
        await evaluate("(() => {const n=" + el(numeric(field)) + ";n.focus({preventScroll:true});n.dispatchEvent(new PointerEvent('pointerdown'));" +
            "n.value=" + JSON.stringify(String(number)) + ";n.dispatchEvent(new Event('input',{bubbles:true}));" +
            (event === "commit" ? "n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));" : "n.setSelectionRange(1,1);") + "})()");
    }
    async function drag(field, n, start, finish) {
        await evaluate("(() => {const n=" + el(range(field)) + ";" + (start ? "n.dispatchEvent(new PointerEvent('pointerdown'));" : "") +
            "n.value='" + n + "';n.dispatchEvent(new Event('input',{bubbles:true}));" +
            (finish ? "n.dispatchEvent(new Event('change',{bubbles:true}));" : "") + "})()");
    }
    async function repeated(selector, n) {
        return evaluate("(() => {const out=[];for(let i=0;i<" + n + ";i++){" + el(selector) +
            ".click();out.push(" + el(numeric("brushSize")) + ".value);}return out;})()");
    }
    async function checkbox(field) { await click('[data-remove-preference="' + field + '"]'); }

    await waitFor(async () => await value("brushSize") === "25", "Remove controls ready");
    await evaluate("window.__removePanel=document.querySelector('.remove-brush-preferences');window.__removeHistory=document.querySelector('.slider-jump-history-button');");
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.remove-mode-tabs button')).map(b=>b.textContent)"), ["Remove", "Heal", "Clone"]);


    // Fractional SDK feedback stays raw, while all three controls present integers without writes.
    const fractional = { brushSize: 25.49, brushFeather: 50.5, visualizationThreshold: 37.4 };
    await native(fractional); const fractionalCalls = r.calls.length;
    for (const [field, raw] of Object.entries(fractional)) {
        await displayed(field, Math.round(raw));
        assert.equal(await evaluate(el(range(field)) + ".step"), "1");
        await evaluate("(() => {const n=" + el(numeric(field)) + ";n.focus({preventScroll:true});n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));n.blur();})()");
    }
    await polls(); assert.equal(r.calls.length, fractionalCalls, "rounding/focus/unchanged commits do not write");
    assert.deepEqual(Object.fromEntries(Object.keys(fractional).map(f=>[f,r.preferences[f]])), fractional);
    r.hold = true;
    assert.deepEqual(await repeated(plus("brushSize"), 10), Array.from({length:10},(_,i)=>String(26+i)));
    await pending("brushSize", 35); await polls(); await displayed("brushSize",35);
    assert.equal(r.preferences.brushSize,25.49); r.finish(); r.hold=false; await settled("brushSize",35);
    assert.equal(r.preferences.brushFeather,50.5); assert.equal(r.preferences.visualizationThreshold,37.4);
    await edit("brushSize","120.7"); await settled("brushSize",100);
    await edit("brushSize","-4.6"); await settled("brushSize",1);
    await edit("brushFeather",".4"); await settled("brushFeather",0);
    await edit("visualizationThreshold","49,5"); await settled("visualizationThreshold",50);

    for (const width of [1280, 768, 390, 320]) {
        await native({ newSpotType: "heal", brushSize: 25, brushFeather: 50 }); await setViewport(width, 1100);
        await evaluate("(() => {const e=document.querySelector('.remove-brush-preferences');window.scrollTo(0,e.getBoundingClientRect().top+scrollY-70);" +
            "window.__removeGeometry=[];window.__removeRecord=true;const sample=()=>{if(!window.__removeRecord)return;const b=e.getBoundingClientRect();" +
            "window.__removeGeometry.push([scrollY,b.top,b.height]);requestAnimationFrame(sample)};sample();})()");
        r.hold = true;
        // Regression: submission and every subsequent poll must retain the displayed request.
        await edit("brushSize", "42,5"); await pending("brushSize", 43);
        await displayed("brushSize", 43); assert.equal(r.preferences.brushSize, 25);
        await polls(); await displayed("brushSize", 43);
        assert.equal(await evaluate("document.activeElement===" + el(numeric("brushSize"))), true);
        r.finish(); r.hold = false; await settled("brushSize", 43);
        await edit("brushFeather", 63.5); await settled("brushFeather", 64);
        await click(reset("brushFeather")); await displayed("brushFeather", 50); await settled("brushFeather", 50);
        const geometry = await evaluate("window.__removeRecord=false;window.__removeGeometry");
        for (const sample of geometry) for (let i = 0; i < 3; i++) assert.ok(Math.abs(sample[i] - geometry[0][i]) < 1, "feedback changed geometry at " + width);
        assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true, "no horizontal overflow at " + width);
        const targets = await evaluate("Array.from(document.querySelectorAll('.remove-brush-row button')).filter(b=>b.getBoundingClientRect().height).map(b=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height}))");
        assert.ok(targets.every(t => t.w >= 44 && t.h >= 44), "standard touch targets at " + width);
        assert.equal(await evaluate("getComputedStyle(" + el(reset("brushSize")) + ").backgroundColor"), "rgb(122, 79, 36)", "orange Reset style");
        assert.equal(await evaluate("document.querySelector('.remove-brush-preferences').textContent.includes('Lightroom:')"), false);
    }

    await native({ brushSize: 25 }); r.hold = true;
    const count = r.calls.length;
    assert.deepEqual(await repeated(plus("brushSize"), 10), Array.from({ length: 10 }, (_, i) => String(26 + i)), "all ten intentional clicks accumulate");
    await pending("brushSize", 35); await displayed("brushSize", 35); await polls(); await displayed("brushSize", 35);
    assert.equal(r.calls.length, count + 1, "rapid intermediate targets coalesce");
    r.finish(); await settled("brushSize", 35); assert.equal(r.preferences.brushSize, 35);

    await repeated(plus("brushSize"), 3); await pending("brushSize", 38);
    await repeated(plus("brushSize"), 5); await repeated(minus("brushSize"), 8); await displayed("brushSize", 35);
    await polls(); await displayed("brushSize", 35);
    r.finish(); await pending("brushSize", 35); await displayed("brushSize", 35);
    assert.equal(r.preferences.brushSize, 38, "earlier confirmed write is separate from latest displayed intent");
    r.finish(); await settled("brushSize", 35); r.hold = false;

    // Multiple feedback polls and an earlier write confirmation during a held drag.
    await native({ brushSize: 25 }); r.hold = true;
    await drag("brushSize", 40, true, false); await pending("brushSize", 40);
    await drag("brushSize", 48, false, false); await polls(); await displayed("brushSize", 48);
    r.finish(); await pending("brushSize", 48); await polls(); await displayed("brushSize", 48);
    await drag("brushSize", 50, false, true); r.finish();
    await pending("brushSize", 50); await displayed("brushSize", 50);
    r.finish(); await settled("brushSize", 50); r.hold = false;

    // A delayed HTTP acknowledgement can arrive after its SDK result and newer input.
    await native({ brushSize: 25 }); r.hold = r.delayAdmission = true;
    await edit("brushSize", 30); await pending("brushSize", 30);
    await repeated(plus("brushSize"), 10); await displayed("brushSize", 40);
    r.finish(); await polls(); await displayed("brushSize", 40);
    const oldReply = r.state(); r.delayAdmission = false; r.releaseAdmissions();
    await pending("brushSize", 40); r.stale = oldReply; await polls(); await displayed("brushSize", 40);
    r.finish(); r.hold = false; await settled("brushSize", 40);

    // Reset replaces the queued target, without allowing an earlier write to snap the display back.
    r.hold = true; await click(plus("brushSize")); await pending("brushSize", 41);
    await click(reset("brushSize")); await displayed("brushSize", 25);
    r.finish(); await pending("brushSize", 25); await polls(); await displayed("brushSize", 25);
    r.finish(); r.hold = false; await settled("brushSize", 25);

    await edit("brushSize", "45.5", "draft"); await polls();
    assert.deepEqual(await evaluate("[" + el(numeric("brushSize")) + ".value," + el(numeric("brushSize")) + ".selectionStart,document.activeElement===" + el(numeric("brushSize")) + "]"),
        ["45.5", 1, true], "polling preserves numeric draft and caret");
    await evaluate(el(numeric("brushSize")) + ".dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
    await displayed("brushSize", 25);
    await evaluate("(() => {const n=" + el(numeric("brushSize")) + ";n.value='26,5';n.dispatchEvent(new Event('input'));n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));})()");
    await settled("brushSize", 27);

    // Native mode changes cancel an unfinished numeric edit and late drag events.
    await edit("brushSize", 99, "draft"); const oldCalls = r.calls.length;
    await native({ newSpotType: "clone", brushSize: 27 });
    await evaluate(el(numeric("brushSize")) + ".dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))");
    assert.equal(r.calls.length, oldCalls); await displayed("brushSize", 27);
    for (const cancel of ["Escape", "pointercancel"]) {
        await drag("brushSize", 70, true, false);
        await evaluate(el(range("brushSize")) + ".dispatchEvent(" + (cancel === "Escape" ? "new KeyboardEvent('keydown',{key:'Escape'})" : "new PointerEvent('pointercancel')") + ")");
        const before = r.calls.length;
        await drag("brushSize", 80, false, true); await polls();
        assert.equal(r.calls.length, before, "cancelled gesture cannot restart from a late input/change");
    }
    await evaluate(el(range("brushSize")) + ".dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}))");
    await drag("brushSize", 28, false, true); await settled("brushSize", 28);

    // Mode intent revokes a pending brush write and discards its coalesced follow-up.
    await native({ newSpotType: "heal", brushSize: 25 }); r.hold = true;
    await click(plus("brushSize")); await pending("brushSize", 26); const obsolete = r.pending.operationId;
    await drag("brushSize", 80, true, false);
    await click(mode("heal_patchmatch")); await pending("newSpotType", "heal_patchmatch");
    r.finish(obsolete); assert.equal(r.preferences.brushSize, 25);
    r.finish(); r.hold = false; await settled("newSpotType", "heal_patchmatch");
    await drag("brushSize", 90, false, true); await polls(); await displayed("brushSize", 25);
    assert.equal(await evaluate(el(row("brushFeather")) + ".hidden"), true);
    assert.equal(await evaluate(el('[data-remove-preference="useGenerativeAI"]') + ".getBoundingClientRect().height>0"), true);
    await checkbox("useGenerativeAI"); await settled("useGenerativeAI", false);
    await checkbox("detectObjects"); await settled("detectObjects", true);
    for (const overlay of ["always", "auto", "selected", "never"]) {
        await evaluate("(() => {const s=" + el('[data-remove-preference="toolOverlay"]') + ";s.value='" + overlay + "';s.dispatchEvent(new Event('change'));})()");
        await settled("toolOverlay", overlay);
    }
    await checkbox("visualizeSpots"); await settled("visualizeSpots", false);
    assert.equal(await evaluate(el(range("visualizationThreshold")) + ".disabled"), true);
    await checkbox("visualizeSpots"); await settled("visualizeSpots", true);
    await edit("visualizationThreshold", 61.5); await settled("visualizationThreshold", 62);
    await click(reset("visualizationThreshold")); await settled("visualizationThreshold", 50);

    r.hold = true; await click(mode("heal")); await pending("newSpotType", "heal");
    await click(mode("clone")); r.finish(); await pending("newSpotType", "clone"); r.finish(); r.hold = false;
    await settled("newSpotType", "clone");
    assert.equal(await evaluate(el(row("brushFeather")) + ".hidden"), false);
    assert.equal(await evaluate(el('[data-remove-preference="useGenerativeAI"]') + ".getBoundingClientRect().height"), 0);
    assert.equal(r.preferences.useGenerativeAI, false); assert.equal(r.preferences.detectObjects, true);
    for (const nativeMode of ["heal", "heal_patchmatch", "clone"]) {
        await native({ newSpotType: nativeMode });
        assert.equal(await evaluate(el(mode(nativeMode)) + ".getAttribute('aria-selected')"), "true");
    }
    for (const width of [1280, 768, 390, 320]) {
        await setViewport(width, 1100);
        const geometry = [];
        for (const nativeMode of ["heal", "heal_patchmatch", "clone"]) {
            await native({ newSpotType: nativeMode });
            geometry.push(await evaluate("(() => {const b=document.querySelector('.remove-brush-preferences').getBoundingClientRect();return [scrollY,b.top,b.height]})()"));
        }
        for (const sample of geometry) for (let i = 0; i < 3; i++) assert.ok(Math.abs(sample[i] - geometry[0][i]) < 1, "native mode feedback changed page geometry at " + width);
    }

    for (const change of ["photo", "tool"]) {
        await native({ brushSize: 25 }); r.hold = true;
        await click(plus("brushSize")); await pending("brushSize", 26);
        await repeated(plus("brushSize"), 4); await displayed("brushSize", 30);
        const stale = r.state();
        if (change === "photo") { fixture.context.selectedPhotoUuid = fixture.context.selectedPhotoKey = "remove-new-photo"; fixture.context.contextCounter++; }
        else { r.available = false; r.revision++; }
        await polls(); r.finish(); r.stale = stale; await polls();
        r.hold = false; r.available = true; r.revision++; await polls(); await displayed("brushSize", 25);
    }

    r.hold = true; await click(plus("brushSize")); await pending("brushSize", 26);
    await repeated(plus("brushSize"), 4); r.finish(undefined, "failed"); r.hold = false; await polls();
    await displayed("brushSize", 25);
    assert.match(await evaluate("document.querySelector('.remove-brush-status').textContent"), /not confirm/);
    await click(plus("brushSize")); await settled("brushSize", 26);

    r.hold = r.delayAdmission = true;
    await click(plus("brushSize")); await pending("brushSize", 27); await displayed("brushSize", 27);
    await waitFor(async () => /timed out/.test(await evaluate("document.querySelector('.remove-brush-status').textContent")), "HTTP timeout is unconfirmed");
    await displayed("brushSize", 26);
    r.finish(undefined, "failed"); r.hold = r.delayAdmission = false; r.releaseAdmissions(); await polls();
    await displayed("brushSize", 26);


    const panelSelector = '[data-remove-panel="true"]';
    const panelLabel = () => evaluate(el(panelSelector) + ".textContent");
    assert.equal(await panelLabel(), "Close Healing Tool");
    assert.equal(await evaluate("Array.from(document.querySelectorAll('[data-tools-section=healing] button')).filter(b=>b.textContent==='Reset Spot Removal').length"), 1);
    assert.equal(await evaluate("Array.from(document.querySelectorAll('[data-tools-section=healing] .slider-name')).some(e=>e.textContent==='Healing Tool')"), false);
    for (const width of [1280,768,390,320]) {
        await native({newSpotType: "heal_patchmatch"});
        await setViewport(width,1100);
        const actionGeometry = await evaluate("(()=>{const row=document.querySelector('.remove-brush-preferences > .remove-action-row');return {width:row.getBoundingClientRect().width,buttons:Array.from(row.children).map(e=>{const b=e.getBoundingClientRect();return {width:b.width,height:b.height,x:b.x,y:b.y}})}})()");
        assert.equal(actionGeometry.buttons.length,2,"exactly two adjacent Healing actions");
        assert.ok(actionGeometry.buttons.every(b=>b.height>=44 && b.width>=44));
        const [openButton,resetButton]=actionGeometry.buttons;
        if(openButton.width+resetButton.width+8<=actionGeometry.width) {
            assert.ok(Math.abs(openButton.y-resetButton.y)<1,"actions share a row when space permits");
            assert.ok(Math.abs(resetButton.x-openButton.x-openButton.width-8)<1,"compact 8px action gap");
            assert.ok(openButton.width<actionGeometry.width && resetButton.width<actionGeometry.width,"content-based button widths");
        } else assert.ok(resetButton.y>=openButton.y+openButton.height+7,"wrap only when required");
        const geometry = await evaluate("(() => {const e=" + el(panelSelector) + ";e.focus({preventScroll:true});const b=document.querySelector('.remove-brush-preferences').getBoundingClientRect();return [scrollY,b.top,b.height]})()");
        await evaluate("window.__removePanelFrames=[];window.__removePanelRecording=true;requestAnimationFrame(function sample(){if(!window.__removePanelRecording)return;const b=document.querySelector('.remove-brush-preferences').getBoundingClientRect();window.__removePanelFrames.push([scrollY,b.top,b.height]);requestAnimationFrame(sample)})");
        r.hold=true; const beforeClose=r.calls.length;
        await repeated(panelSelector,10); await pending("selectedTool","loupe");
        assert.equal(r.calls.length,beforeClose+1,"duplicate Close clicks suppressed");
        await polls(); assert.equal(await panelLabel(),"Close Healing Tool","admission does not change authoritative label");
        assert.equal(await evaluate(el(range("brushSize")) + ".getAttribute('aria-disabled')"),"true");
        r.finish(); await polls(); assert.equal(await panelLabel(),"Open Healing Tool");
        assert.equal(await evaluate("document.activeElement==="+el(panelSelector)),true);
        await click(panelSelector); await pending("selectedTool","dust");
        assert.equal(await panelLabel(),"Open Healing Tool"); r.finish(); r.hold=false; await polls();
        assert.equal(await panelLabel(),"Close Healing Tool");
        const after = await evaluate("(() => {const b=document.querySelector('.remove-brush-preferences').getBoundingClientRect();return [scrollY,b.top,b.height]})()");
        for(let i=0;i<3;i++) assert.ok(Math.abs(after[i]-geometry[i])<1,"Open/Close preserves page geometry at "+width);
        const frames = await evaluate("window.__removePanelRecording=false;window.__removePanelFrames");
        for(const frame of frames) for(let i=0;i<3;i++) assert.ok(Math.abs(frame[i]-geometry[i])<1,"Open/Close intermediate geometry at "+width);
        assert.equal(await evaluate(el(panelSelector)+".getBoundingClientRect().height>=44"),true);
    }
    // Actual closed feedback may precede the HTTP admission response, without losing ownership.
    r.selectedTool="loupe";r.preferences.newSpotType="clone";r.revision++;await polls();
    const openingPreferences=structuredClone(r.preferences);
    r.available=false;r.hold=true;await click(panelSelector);await pending("selectedTool","dust");r.finish();await polls();
    assert.equal(await panelLabel(),"Close Healing Tool","tool readback is separate from preference availability");
    assert.equal(await evaluate(el(range("brushSize"))+".getAttribute('aria-disabled')"),"true");
    assert.match(await evaluate("document.querySelector('.remove-brush-status').textContent"),/not confirm/);
    r.available=true;r.revision++;await polls();
    await click(panelSelector);await pending("selectedTool","loupe");r.finish();await polls();
    r.failNext=true;await click(panelSelector);await pending("selectedTool","dust");r.finish();await polls();
    assert.equal(await panelLabel(),"Open Healing Tool","failed opener cannot fabricate native tool selection");
    await click(panelSelector);await pending("selectedTool","dust");r.finish();r.hold=false;await polls();
    assert.equal(r.preferences.newSpotType,"heal_patchmatch","opening explicitly selects the first new-stroke mode");
    for(const field of Object.keys(openingPreferences)) if(field!=="newSpotType") assert.equal(r.preferences[field],openingPreferences[field]);

    r.hold=r.delayAdmission=true;
    await click(panelSelector); await pending("selectedTool","loupe"); r.finish(); await polls();
    assert.equal(await panelLabel(),"Open Healing Tool");
    const delayedCloseCalls=r.calls.length; await click(panelSelector);
    assert.equal(r.calls.length,delayedCloseCalls,"pending acknowledgement still suppresses a second tool operation");
    r.delayAdmission=false; r.releaseAdmissions(); await polls();
    await click(panelSelector); await pending("selectedTool","dust"); r.finish(); r.hold=false; await polls();
    assert.equal(await panelLabel(),"Close Healing Tool");
    // Closing supersedes both a dispatched brush request and the newer drag target.
    await native({brushSize:25}); r.hold=true;
    await click(plus("brushSize")); await pending("brushSize",26); const oldBrush=r.pending.operationId;
    await drag("brushSize",80,true,false); await displayed("brushSize",80);
    await click(panelSelector); await pending("selectedTool","loupe");
    r.finish(oldBrush); r.finish(); await polls(); assert.equal(await panelLabel(),"Open Healing Tool");
    r.selectedTool="dust"; r.revision++; r.hold=false; await polls();
    await drag("brushSize",90,false,true); await polls(); await displayed("brushSize",25);
    assert.equal(r.preferences.brushSize,25,"Close discards obsolete brush intent");
    // Native tool changes follow back, preserving a newer tool even during a pending Open.
    r.selectedTool="masking"; r.revision++; await polls(); assert.equal(await panelLabel(),"Open Healing Tool");
    r.hold=true; await click(panelSelector); await pending("selectedTool","dust");
    r.selectedTool="crop"; r.revision++; await polls(); r.finish(); await polls();
    assert.equal(r.selectedTool,"crop"); assert.equal(await panelLabel(),"Open Healing Tool");
    r.selectedTool="dust"; r.revision++; r.hold=false; await polls(); assert.equal(await panelLabel(),"Close Healing Tool");
    await edit("brushSize",26); await settled("brushSize",26);


    const repairAction = action => '[data-remove-repair="'+action+'"]';
    assert.equal(await evaluate("document.querySelector('.remove-repair-selection').textContent"),"No repair selected");
    assert.equal(await evaluate(el(repairAction("delete"))+".getAttribute('aria-disabled')"),"true");
    r.repair={available:true,selected:true,index:1,count:2,spotType:"heal",opacity:0.756,feather:0.756,token:"1:"+"a".repeat(64)};
    r.revision++;await polls();
    // Verified percentage mapping retains the raw baseline, stable gestures and serialized latest intent.
    for (const [selectedField,selectedKey] of [["selectedRepairOpacity","opacity"],["selectedRepairFeather","feather"]]) {
    await displayed(selectedField,76);
    assert.equal(await evaluate("Boolean("+el(reset(selectedField))+")"),false,"no invented selected-repair Reset");
    const uneditedCount=r.calls.length;
    await edit(selectedField,76);await polls();assert.equal(r.calls.length,uneditedCount,"rounding native .756 does not write");
    r.hold=true;
    await click(plus(selectedField));await pending(selectedField,0.77);
    const firstOpacity=r.pending.operationId, oldOpacityState=r.state();
    await drag(selectedField,82,true,false);await polls();await displayed(selectedField,82);
    assert.equal(r.calls.length,uneditedCount+1,"held drag targets do not build an SDK backlog");
    r.finish(firstOpacity);await pending(selectedField,0.82);await displayed(selectedField,82);
    assert.equal(r.calls.at(-1).repairToken,r.repair.token,"next write uses only the confirmed successor identity");
    r.stale=oldOpacityState;await polls();await displayed(selectedField,82);
    await drag(selectedField,84,false,false);r.finish();await pending(selectedField,0.84);await displayed(selectedField,84);
    await drag(selectedField,84,false,true);r.finish();await polls();await displayed(selectedField,84);
    const steps=await evaluate("(()=>{const out=[];for(let i=0;i<10;i++){"+el(plus(selectedField))+".click();out.push("+el(numeric(selectedField))+".value);}return out})()");
    assert.deepEqual(steps,Array.from({length:10},(_,i)=>String(85+i)),"each intentional + accumulates from requested percent");
    await pending(selectedField,0.94);await click(minus(selectedField));await click(minus(selectedField));await displayed(selectedField,92);
    r.finish();await pending(selectedField,0.92);r.finish();await polls();await displayed(selectedField,92);
    assert.equal(r.repair[selectedKey],0.92,"SDK target is raw 0..1");
    // A newer request survives an SDK result delivered before its HTTP acknowledgement.
    r.delayAdmission=true;await click(plus(selectedField));await pending(selectedField,0.93);
    await click(plus(selectedField));r.finish();await polls();await displayed(selectedField,94);
    r.delayAdmission=false;r.releaseAdmissions();await pending(selectedField,0.94);r.finish();await polls();
    assert.equal(r.repair[selectedKey],0.94);
    await edit(selectedField,"85,4");await pending(selectedField,0.85);await displayed(selectedField,85);r.finish();await polls();
    const currentRepair=structuredClone(r.repair), selectionCalls=r.calls.length;
    await drag(selectedField,86,true,false);await pending(selectedField,0.86);
    await drag(selectedField,88,false,false);
    r.repair={...r.repair,index:2,[selectedKey]:0.4,token:"2:"+"d".repeat(64)};r.revision++;await polls();
    r.finish();await drag(selectedField,90,false,true);await polls();await displayed(selectedField,40);
    assert.equal(r.calls.length,selectionCalls+1,"selection change cancels queued targets and held gesture");
    r.repair=currentRepair;r.revision++;await polls();
    await drag(selectedField,89,true,false);await pending(selectedField,0.89);
    r.repair={available:false,count:2};r.revision++;await polls();r.finish();await polls();
    assert.equal(await evaluate(el(range(selectedField))+".getAttribute('aria-disabled')"),"true");
    r.repair=currentRepair;r.revision++;await polls();await displayed(selectedField,85);
    await drag(selectedField,91,false,true);await polls();assert.equal(r.repair[selectedKey],0.85,"unavailable recovery never revives a gesture");
    // Native identity changes also cancel a numeric draft before it has produced an intent.
    await edit(selectedField,"64,5","draft");
    r.repair={...currentRepair,token:"1:"+"c".repeat(64)};r.revision++;await polls();
    await evaluate(el(numeric(selectedField))+".dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
    await polls();assert.equal(r.repair[selectedKey],0.85);
    await evaluate(el(numeric(selectedField))+".blur()");
    // The result belongs to its exact confirmed successor, even if a newer native repair has the same value.
    r.delayAdmission=true;await click(plus(selectedField));await pending(selectedField,0.86);
    await click(plus(selectedField));r.finish();await polls();
    const replacementCalls=r.calls.length;
    r.repair={...r.repair,index:2,[selectedKey]:0.86,token:"2:"+"f".repeat(64)};r.revision++;await polls();
    r.delayAdmission=false;r.releaseAdmissions();await polls();
    assert.equal(r.calls.length,replacementCalls,"an old result cannot rebind a queued edit to a newer repair with matching opacity");
    await displayed(selectedField,86);
    r.repair={...currentRepair,token:"1:"+"c".repeat(64)};r.revision++;await polls();
    // Mode supersession cancels an outstanding selected-parameter write and the newer target.
    await click(plus(selectedField));await pending(selectedField,0.86);await click(plus(selectedField));
    await click(mode("clone"));await pending("newSpotType","clone");r.finish();await polls();
    assert.equal(r.repair[selectedKey],0.85);await displayed(selectedField,85);
    await click(mode("heal"));await pending("newSpotType","heal");r.finish();await polls();
    }
    // Edits to both selected fields share one serial SDK writer and advance only through native proof.
    r.repair={...r.repair,opacity:0.5,feather:0.33,token:"1:"+"9".repeat(64)};r.revision++;await polls();
    const jointCalls=r.calls.length, brushBeforeSelected=structuredClone(r.preferences);
    await drag("selectedRepairOpacity",40,true,true);await pending("selectedRepairOpacity",0.4);
    await drag("selectedRepairFeather",60,true,false);await polls();
    await displayed("selectedRepairOpacity",40);await displayed("selectedRepairFeather",60);
    assert.equal(r.calls.length,jointCalls+1,"second parameter waits without adding an SDK backlog");
    assert.equal(r.repair.feather,0.33,"requested Feather is not native feedback");
    assert.equal(await evaluate("document.querySelector('.slider-jump-history-button').disabled"),true);
    r.finish();await pending("selectedRepairFeather",0.6);
    assert.equal(r.calls.at(-1).repairToken,r.repair.token,"queued Feather binds the confirmed Opacity successor");
    await displayed("selectedRepairFeather",60);await drag("selectedRepairFeather",65,false,true);
    r.finish();await pending("selectedRepairFeather",0.65);r.finish();await polls();
    assert.equal(r.repair.opacity,0.4);assert.equal(r.repair.feather,0.65);assert.deepEqual(r.preferences,brushBeforeSelected);
    const fillSelector='[data-remove-preference="selectedRepairFill"]';
    assert.deepEqual(await evaluate("Array.from("+el(fillSelector)+".options).filter(o=>!o.disabled).map(o=>o.textContent)"),["Remove","Heal","Clone","Generative Remove"]);
    const brushBeforeFill=structuredClone(r.preferences);r.hold=true;
    for(const choice of ["clone","remove","generative_remove","heal"]) {
        await evaluate(el(fillSelector)+".value='"+choice+"';"+el(fillSelector)+".dispatchEvent(new Event('change',{bubbles:true}))");
        await pending("selectedRepairFill",choice);await polls();
        assert.equal(await evaluate(el(fillSelector)+".value"),choice,"pending Fill choice stays displayed");
        assert.equal(await evaluate(el(fillSelector)+".getAttribute('aria-disabled')"),"true");
        assert.equal(await evaluate("document.querySelector('.slider-jump-history-button').disabled"),true);
        r.finish();await polls();assert.equal(await evaluate(el(fillSelector)+".value"),choice);
        assert.deepEqual(r.preferences,brushBeforeFill,"selected Fill does not change new-stroke preferences");
    }
    const fillOriginal=structuredClone(r.repair);
    await evaluate(el(fillSelector)+".value='clone';"+el(fillSelector)+".dispatchEvent(new Event('change',{bubbles:true}))");
    await pending("selectedRepairFill","clone");
    r.repair={...r.repair,index:2,spotType:"heal_patchmatch",useGenAI:false,token:"2:"+"e".repeat(64)};
    r.revision++;await polls();r.finish();await polls();
    assert.equal(r.repair.spotType,"heal_patchmatch","pending Fill cannot edit a newer native selection");
    assert.equal(await evaluate(el(fillSelector)+".value"),"remove");
    r.repair=fillOriginal;r.revision++;await polls();
    r.hold=false;
    const repairGeometry=await evaluate("(()=>{const b=document.querySelector('.remove-selected-repair').getBoundingClientRect();return [scrollY,b.top,b.height]})()");
    const beforeRepair=r.calls.length;r.hold=true;
    await click(repairAction("refresh"));await pending("selectedRepair","refresh");
    await click(repairAction("refresh"));assert.equal(r.calls.length,beforeRepair+1);
    r.finish();await polls();assert.match(await evaluate("document.querySelector('.remove-repair-status').textContent"),/Refresh requested/);
    const selectedBeforeUnavailable=structuredClone(r.repair), callsBeforeUnavailable=r.calls.length;
    await click(repairAction("delete"));await pending("selectedRepair","delete");
    r.repair={available:false,count:2,reason:"Selected index getter unavailable"};r.revision++;await polls();
    assert.equal(await evaluate("document.querySelector('.remove-repair-selection').textContent"),"Selected repair unavailable");
    await click(repairAction("delete"));assert.equal(r.calls.length,callsBeforeUnavailable+1,"unavailable selection cannot reuse the cached repair target");
    r.finish();r.repair=selectedBeforeUnavailable;r.revision++;await polls();
    assert.equal(await evaluate("document.querySelector('.remove-repair-selection').textContent"),"Heal repair selected");
    assert.equal(r.calls.length,callsBeforeUnavailable+1,"readback recovery never opens a tool or restores selection");
    r.corruptRepairAdmission=true;
    await click(repairAction("refresh"));await pending("selectedRepair","refresh");await polls();
    assert.match(await evaluate("document.querySelector('.remove-brush-status').textContent"),/did not acknowledge/,
        "admission without the original repair target must not be accepted");
    r.finish(undefined,"stale");await polls();
    await click(repairAction("delete"));await pending("selectedRepair","delete");
    r.repair={...r.repair,index:2,token:"2:"+"b".repeat(64),spotType:"clone"};r.revision++;await polls();r.finish();await polls();
    assert.equal(r.repair.count,2,"a newer native repair selection is not deleted");
    assert.equal(await evaluate("document.querySelector('.remove-repair-selection').textContent"),"Clone repair selected");
    await click(repairAction("delete"));await pending("selectedRepair","delete");r.finish();r.hold=false;await polls();
    assert.equal(r.repair.count,1);assert.equal(await evaluate("document.querySelector('.remove-repair-selection').textContent"),"No repair selected");
    const afterRepairGeometry=await evaluate("(()=>{const b=document.querySelector('.remove-selected-repair').getBoundingClientRect();return [scrollY,b.top,b.height]})()");
    for(let i=0;i<3;i++) assert.ok(Math.abs(repairGeometry[i]-afterRepairGeometry[i])<1,"selected repair updates preserve geometry");

    // The standalone whole-spot Reset keeps its legacy action, independently of preference Reset.
    const originalHandle=fixture.handle; const resetRequests=[];
    fixture.handle=(url,reply)=>{
        if(url.pathname==="/api/action" && url.searchParams.get("action")==="resetSpotRemoval") {
            resetRequests.push(url.search); reply({ok:true}); return true;
        }
        return originalHandle(url,reply);
    };
    const savedPreferences=structuredClone(r.preferences);
    const resetGeometry=await evaluate("(() => {const b=document.querySelector('.remove-brush-preferences').getBoundingClientRect();return [scrollY,b.top,b.height]})()");
    await evaluate("Array.from(document.querySelectorAll('[data-tools-section=healing] button')).find(b=>b.textContent==='Reset Spot Removal').click()");
    await waitFor(()=>resetRequests.length===1,"legacy Reset Spot Removal admission"); await polls();
    assert.deepEqual(r.preferences,savedPreferences,"whole reset is separate from brush defaults");
    const afterResetGeometry=await evaluate("(() => {const b=document.querySelector('.remove-brush-preferences').getBoundingClientRect();return [scrollY,b.top,b.height]})()");
    for(let i=0;i<3;i++) assert.ok(Math.abs(resetGeometry[i]-afterResetGeometry[i])<1,"Reset request feedback preserves geometry");
    fixture.handle=originalHandle;

    assert.equal(fixture.history.entries.length, 0, "brush preferences must not fabricate image-history entries");
    fixture.nativeEdit(12); await polls();
    await waitFor(() => fixture.history.reads > 0, "shared history feedback");
    await waitFor(async () => await evaluate("!document.querySelector('.slider-jump-history-button').disabled"), "shared Undo ready");
    await click(".slider-jump-history-button");
    await waitFor(() => fixture.history.index === 0, "shared Undo works for image edits");
    await waitFor(async () => await evaluate("!document.querySelectorAll('.slider-jump-history-button')[1].disabled"), "shared Redo ready");
    await evaluate("document.querySelectorAll('.slider-jump-history-button')[1].click()");
    await waitFor(() => fixture.history.index === 1, "shared Redo works for image edits");
    assert.deepEqual(fixture.history.commands, ["lightroom.undo", "lightroom.redo"]);
    assert.equal(r.preferences.brushSize, 26, "image history does not fabricate brush-preference history");
    assert.equal(await evaluate("window.__removePanel===document.querySelector('.remove-brush-preferences')&&window.__removeHistory===document.querySelector('.slider-jump-history-button')"), true);
    return { delayedAndOutOfOrder: true, intermediateDisplay: true, tenClicks: true, reversal: true, heldDrag: true,
        selectedRepairActions: true, integerPresentation: true, openClose: true, closeCancellation: true, pendingReset: true, modeSupersession: true, preferences: 8, lrbridgeDefaults: require("../app/controller-remove").defaults,
        touchWidths: [1280, 768, 390, 320], focusCaretGeometry: true, nativeChangesAndFailures: true, sharedHistory: true };
}
module.exports = { install, verify };
