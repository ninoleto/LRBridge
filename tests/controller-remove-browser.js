"use strict";
const assert = require("node:assert/strict");
function install(fixture) {
    require("./controller-history-browser").install(fixture);
    const r = fixture.remove = { revision: 1, calls: [], writes: [], reads: 0, pending: null, last: null, hold: false,
        available: true, selectedTool: "dust", delayAdmission: false, admissions: [], stale: null, failNext: false, delay: 250,
        repair: { available: true, selected: false, count: 0 }, resetSpotRemovalCalls: 0,
        dust: { available: true, applied: true, canDisable: true, canEnable: true, canRequestClose: true, token: "a".repeat(64) },
        preferences: { newSpotType: "heal", brushSize: 25, brushFeather: 50, useGenerativeAI: true,
            detectObjects: false, toolOverlay: "selected", visualizeSpots: true, visualizationThreshold: 37 } };
    r.state = () => structuredClone({ ok: true, ...fixture.context, serverEpoch: "remove-fixture", revision: r.revision,
        capturedAt: Date.now() - 60000, ageMs: 0, selectedTool: r.selectedTool, available: r.available && r.selectedTool === "dust",
        dust: r.dust, dustApply: r.dust.available ? r.dust.applied : null,
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
        outcome = outcome || (stale ? "stale" : r.failNext ? "failed" : c.field === "dustClose" ? "requested" : "confirmed"); r.failNext = false;
        if (outcome === "confirmed") {
            if (panel) {
                r.selectedTool = c.value;
                if(c.value === "dust") { r.preferences.newSpotType = "heal_patchmatch"; if(!r.available) outcome = "failed"; }
            }
            else if (c.field === "dustApply") { assert.equal(typeof c.value, "boolean"); r.dust.applied = c.value; r.dust.token = (c.value ? "a" : "b").repeat(64); }
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
            detail: outcome === "requested" ? c.field === "dustClose" ? "Native manual Healing navigation requested; Dust panel state is not exposed." : "Refresh requested; SDK completion is not exposed." :
                outcome === "confirmed" ? "Preference confirmed." : outcome === "stale" ? "Native mode or context changed." : "Lightroom did not confirm the preference." };
        r.pending = null; r.revision++;
    };
    r.releaseAdmissions = () => { for (const send of r.admissions.splice(0)) send(); };
    const previous = fixture.handle;
    fixture.handle = function (url, reply) {
        if (url.pathname === "/api/action" && url.searchParams.get("action") === "resetSpotRemoval") r.resetSpotRemovalCalls++;
        if (url.pathname === "/api/remove/state") {
            r.reads++; const value = r.stale || r.state(); r.stale = null; reply(value); return true;
        }
        if (["/api/remove/brush", "/api/remove/panel", "/api/remove/repair", "/api/remove/dust"].includes(url.pathname)) {
            const field = url.searchParams.get("field");
            assert.equal(url.searchParams.get("selectedPhotoUuid"), fixture.context.selectedPhotoUuid);
            assert.equal(url.searchParams.get("mode"), r.selectedTool === "dust" ? r.preferences.newSpotType : "null");
            assert.equal(url.searchParams.get("stateRevision"), String(r.revision));
            if (r.pending) assert.ok(r.pending.field !== "selectedTool" && (field === "selectedTool" ||
                field === "newSpotType" && r.pending.field !== "newSpotType"), "SDK writes must be serialized");
            const raw = url.searchParams.get("value");
            const value = ["brushSize", "brushFeather", "visualizationThreshold", "selectedRepairOpacity", "selectedRepairFeather"].includes(field) ? Number(raw) :
                ["useGenerativeAI", "detectObjects", "visualizeSpots", "dustApply"].includes(field) ? raw === "true" : raw;
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
    installReflections(fixture);
    installPeople(fixture);
}
async function verify({ evaluate, waitFor, fixture, setViewport, peopleOnly, dustOnly }) {
    if (dustOnly) return verifyDust({ evaluate, waitFor, fixture, setViewport });
    await verifyPeople({ evaluate, waitFor, fixture, setViewport });
    if (peopleOnly) return { people: true };
    await verifyReflections({ evaluate, waitFor, fixture, setViewport });
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
        for (const field of ["selectedRepairOpacity", "selectedRepairFeather"]) {
            const alignment = await evaluate("(() => {const a=" + el(reset("brushSize")) + ",b=" + el(reset(field)) +
                ";const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return [x.x,y.x,x.width,y.width,x.height,y.height,getComputedStyle(b).backgroundColor]})()");
            for (let i = 0; i < 6; i += 2) assert.ok(Math.abs(alignment[i] - alignment[i + 1]) < 1, "Reset alignment and size at " + width);
            assert.equal(alignment[6], "rgb(122, 79, 36)", "selected Reset uses existing orange style");
        }
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
    const noSelectionCalls = r.calls.length;
    for (const field of ["selectedRepairOpacity", "selectedRepairFeather"]) {
        assert.equal(await evaluate(el(reset(field)) + ".getAttribute('aria-disabled')"), "true");
        await click(reset(field));
    }
    await polls(); assert.equal(r.calls.length, noSelectionCalls, "Reset requires a verified selected repair");
    r.repair={available:true,selected:true,index:1,count:2,spotType:"heal",opacity:0.756,feather:0.756,token:"1:"+"a".repeat(64)};
    r.revision++;await polls();
    // Verified percentage mapping retains the raw baseline, stable gestures and serialized latest intent.
    for (const [selectedField,selectedKey] of [["selectedRepairOpacity","opacity"],["selectedRepairFeather","feather"]]) {
    await displayed(selectedField,76);
    const resetValue = selectedKey === "opacity" ? 100 : 50;
    assert.equal(await evaluate(el(reset(selectedField)) + ".getAttribute('aria-label')"),
        "Reset Selected repair " + (selectedKey === "opacity" ? "Opacity" : "Feather") + " to LRBridge default " + resetValue);
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
    assert.equal(await evaluate(el(reset(selectedField))+".getAttribute('aria-disabled')"),"true");
    const unavailableResetCalls = r.calls.length; await click(reset(selectedField)); await polls();
    assert.equal(r.calls.length, unavailableResetCalls, "unavailable Reset cannot reuse cached selection");
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
    // Reset replaces queued intent and survives delayed admission and old feedback.
    const resetBaseline = structuredClone(r.repair), resetBrush = structuredClone(r.preferences), resetCalls = r.calls.length;
    r.delayAdmission = true;
    await click(plus(selectedField)); await pending(selectedField, 0.86);
    const beforeResetState = r.state();
    await drag(selectedField, 91, true, false); await click(reset(selectedField));
    await displayed(selectedField, resetValue); await polls(); await displayed(selectedField, resetValue);
    assert.equal(r.repair[selectedKey], 0.85, "Reset intent is separate from native feedback");
    r.finish(); await polls(); await displayed(selectedField, resetValue);
    assert.equal(r.calls.length, resetCalls + 1, "Reset waits for the existing transport");
    r.delayAdmission = false; r.releaseAdmissions(); await pending(selectedField, resetValue / 100);
    assert.equal(r.calls.at(-1).repairToken, r.repair.token, "Reset binds only the confirmed successor repair");
    r.stale = beforeResetState; await polls(); await displayed(selectedField, resetValue);
    await drag(selectedField, 93, false, true); await displayed(selectedField, resetValue);
    r.finish(); await polls(); await displayed(selectedField, resetValue);
    assert.equal(r.calls.length, resetCalls + 2, "Reset cancels the older held drag");
    assert.deepEqual(r.repair, { ...resetBaseline, [selectedKey]: resetValue / 100, token: r.repair.token }, "only Reset's parameter changes");
    assert.deepEqual(r.preferences, resetBrush, "selected Reset preserves brush preferences");
    // New steps accumulate from Reset; selection changes cancel a queued Reset.
    await click(minus(selectedField)); await pending(selectedField, (resetValue - 1) / 100);
    await click(minus(selectedField)); await displayed(selectedField, resetValue - 2);
    await click(reset(selectedField)); await displayed(selectedField, resetValue);
    const cancelledResetCalls = r.calls.length;
    const newerRepair = { ...resetBaseline, index: 2, token: "2:" + "7".repeat(64) };
    r.repair = structuredClone(newerRepair); r.revision++; await polls(); r.finish(); await polls();
    assert.equal(r.calls.length, cancelledResetCalls, "selection change discards queued Reset");
    assert.deepEqual(r.repair, newerRepair);
    // An already dispatched Reset also cannot reach a replacement selection.
    await click(reset(selectedField)); await pending(selectedField, resetValue / 100);
    r.repair = { ...resetBaseline, token: "1:" + "8".repeat(64) }; r.revision++; await polls();
    r.finish(); await polls(); assert.equal(r.repair[selectedKey], 0.85);
    // Only the unavailable parameter's slider and Reset are disabled.
    const availableRepair = structuredClone(r.repair);
    r.repair[selectedKey] = null; r.revision++; await polls();
    for (const selector of [range(selectedField), reset(selectedField)])
        assert.equal(await evaluate(el(selector) + ".getAttribute('aria-disabled')"), "true");
    const otherField = selectedKey === "opacity" ? "selectedRepairFeather" : "selectedRepairOpacity";
    assert.equal(await evaluate(el(reset(otherField)) + ".getAttribute('aria-disabled')"), "false");
    r.repair = availableRepair; r.revision++; await polls();
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
    // Both Resets share the same queue; Feather replaces only its own queued edit.
    const jointResetCalls = r.calls.length;
    await click(reset("selectedRepairOpacity")); await pending("selectedRepairOpacity", 1);
    await drag("selectedRepairFeather", 70, true, true); await click(reset("selectedRepairFeather"));
    await polls(); await displayed("selectedRepairOpacity", 100); await displayed("selectedRepairFeather", 50);
    assert.equal(r.calls.length, jointResetCalls + 1, "cross-field Reset waits for the SDK writer");
    assert.equal(r.repair.opacity, 0.4); assert.equal(r.repair.feather, 0.65);
    r.finish(); await pending("selectedRepairFeather", 0.5);
    assert.equal(r.repair.opacity, 1); assert.equal(r.repair.feather, 0.65);
    assert.equal(r.calls.at(-1).repairToken, r.repair.token);
    r.finish(); await polls();
    assert.equal(r.calls.length, jointResetCalls + 2);
    assert.equal(r.repair.opacity, 1); assert.equal(r.repair.feather, 0.5);
    assert.deepEqual(r.preferences, brushBeforeSelected);
    for (const width of [1280, 768, 390, 320]) {
        await setViewport(width, 1100);
        for (const [field, key, target] of [["selectedRepairOpacity", "opacity", 100], ["selectedRepairFeather", "feather", 50]]) {
            r.repair = { ...r.repair, [key]: 0.73, token: "1:" + "6".repeat(64) }; r.revision++; await polls();
            await evaluate("(() => {const e=" + el(reset(field)) + ";e.scrollIntoView({block:'center'});e.focus({preventScroll:true});" +
                "window.__selectedResetGeometry=[];window.__selectedResetRecord=true;const sample=()=>{if(!window.__selectedResetRecord)return;" +
                "const b=document.querySelector('.remove-selected-repair').getBoundingClientRect();" +
                "window.__selectedResetGeometry.push([scrollY,b.top,b.height]);requestAnimationFrame(sample)};sample()})()");
            await click(reset(field)); await pending(field, target / 100); await polls(); await displayed(field, target);
            r.finish(); await polls(); await displayed(field, target);
            const samples = await evaluate("window.__selectedResetRecord=false;window.__selectedResetGeometry");
            for (const sample of samples) for (let i = 0; i < 3; i++)
                assert.ok(Math.abs(sample[i] - samples[0][i]) < 1, "Reset preserves page position/geometry at " + width);
            assert.equal(await evaluate("document.activeElement===" + el(reset(field))), true, "Reset retains keyboard focus");
        }
    }
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

    assert.equal(r.resetSpotRemovalCalls, 0, "individual Resets never invoke whole-photo Reset Spot Removal");
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
function installPeople(fixture) {
    const p = fixture.people = { revision: 1, calls: [], reads: 0, pending: null, last: null, available: true,
        controllerWorkflowOpen: false, refreshRequired: false, heldState: [], heldAction: [], rejectNext: null, hangNext: null, actionAttempts: [],
        native: { toolOpen: false, count: 0, inventoryToken: "a".repeat(64), selectionReadable: false,
            selectedIndex: null, selectedToken: null, navigationSupported: true, detectSupported: true, removeSupported: true } };
    p.state = () => structuredClone({ ok: true, ...fixture.context, ...p.native, available: p.available,
        reason: p.available ? null : "Native People inventory unavailable.", serverEpoch: "people-fixture",
        revision: p.revision, ageMs: 0, pendingOperation: p.pending, lastResult: p.last,
        controllerWorkflowOpen: p.controllerWorkflowOpen, refreshRequired: p.refreshRequired,
        removalAvailable: !p.pending && !p.refreshRequired && p.native.count > 0 && p.native.toolOpen,
        removalReason: "Waiting for updated People detections from Lightroom." });
    p.publishInventory = count => { p.native.count = count; p.refreshRequired = false; p.revision++; };
    p.callback = () => { if (p.pending) { p.pending.callbackCompleted = true; p.pending.phase = "requested"; p.revision++; } };
    p.finish = (outcome) => {
        if (!p.pending) return;
        const call = p.calls.find(entry => entry.id === p.pending.operationId); if (!call) return;
        outcome ||= call.kind === "remove" ? "confirmed" : "requested";
        if (call.photo !== fixture.context.selectedPhotoUuid || call.context !== fixture.context.contextCounter ||
            call.develop !== fixture.context.developCounter) outcome = "stale";
        if (call.kind === "open" && outcome === "requested") { p.native.toolOpen = true; p.controllerWorkflowOpen = true; }
        p.last = { operationId: call.id, operationKind: call.kind, outcome,
            callbackCompleted: Boolean(p.pending.callbackCompleted), invoked: true, inventoryChanged: false,
            detail: outcome === "stale" ? "Photo or Develop context changed; earlier People request cancelled." :
                call.kind === "open" ? "People panel navigation sent. Review Lightroom; navigation-triggered detection is not documented." :
                    call.kind === "detect" ? "Detection request delivered. Review detections and exclusions in Lightroom; readiness is not exposed." :
                        "Lightroom callback received; People inventory was unchanged. Removal is unconfirmed; review Lightroom." };
        p.pending = null; p.refreshRequired = true; p.revision++;
    };
    const previous = fixture.handle;
    fixture.handle = function(url, reply) {
        if (url.pathname === "/api/people/state") {
            p.reads++; const snapshot = p.state();
            if (p.holdNextState) { p.holdNextState = false; p.heldState.push(() => reply(snapshot)); }
            else reply(snapshot);
            return true;
        }
        if (url.pathname === "/api/people/action") {
            const kind = url.searchParams.get("operationKind"); p.actionAttempts.push(kind);
            if (p.hangNext === kind) { p.hangNext = null; return true; }
            if (p.rejectNext) { const reason = p.rejectNext; p.rejectNext = null; reply({ ok: false, error: reason }); return true; }
            assert.equal(p.pending, null, "one People operation at a time");
            assert.equal(url.searchParams.get("selectedPhotoUuid"), fixture.context.selectedPhotoUuid);
            assert.equal(url.searchParams.get("contextCounter"), String(fixture.context.contextCounter));
            assert.equal(url.searchParams.get("developCounter"), String(fixture.context.developCounter));
            assert.equal(url.searchParams.get("stateRevision"), String(p.revision));
            assert.ok(["open", "detect", "remove"].includes(kind));
            const call = { id: "pp-" + (p.calls.length + 1), kind, photo: fixture.context.selectedPhotoUuid,
                context: fixture.context.contextCounter, develop: fixture.context.developCounter };
            p.calls.push(call); p.pending = { operationId: call.id, operationKind: kind, phase: "queued",
                callbackCompleted: false, invoked: false }; p.revision++;
            const respond = () => reply(p.state());
            if (p.holdNextAction === kind) { p.holdNextAction = null; p.heldAction.push(respond); }
            else respond();
            return true;
        }
        return previous(url, reply);
    };
}
async function verifyPeople({ evaluate, waitFor, fixture, setViewport }) {
    const p = fixture.people, root = ".people-controls";
    const element = label => "Array.from(document.querySelectorAll(" + JSON.stringify(root + " button") + ")).find(e=>e.textContent===" + JSON.stringify(label) + ")";
    const click = label => evaluate(element(label) + ".click()");
    const disabled = label => evaluate(element(label) + ".disabled");
    const status = () => evaluate("document.querySelector(" + JSON.stringify(root + " [role=status]") + ").textContent");
    const polls = async () => { const before = p.reads; await waitFor(() => p.reads >= before + 3, "People polls"); };
    await waitFor(async () => await evaluate("Boolean(document.querySelector(" + JSON.stringify(root) + "))"), "People controls");
    assert.equal(await evaluate("document.querySelector(" + JSON.stringify(root) + ").closest('[data-tools-section]').dataset.toolsSection"), "healing");
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.remove-distraction-removal>section>h4')).map(e=>e.textContent)"),
        ["Reflections", "People", "Dust"], "People follows Reflections inside Distraction Removal");
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.people-controls button')).map(e=>e.textContent)"),
        ["Open People Panel", "Detect People", "Remove Detected"], "People has no redundant close or substitute Cancel action");
    assert.equal(await evaluate("document.querySelectorAll('[data-remove-panel=true]').length"), 1, "overall Healing open/close control remains");
    assert.match(await evaluate("document.querySelector('[data-remove-panel=true]').textContent"), /^(Open|Close) Healing Tool$/);
    assert.equal(await disabled("Open People Panel"), false); assert.equal(await disabled("Detect People"), true);
    assert.equal(await disabled("Remove Detected"), true);
    const toggle = '[data-tools-section="healing"] .group-title button';
    await evaluate("document.querySelector(" + JSON.stringify(toggle) + ").click();document.querySelector(" + JSON.stringify(toggle) + ").click()");
    await polls(); assert.equal(p.calls.length, 0, "rendering or expanding Healing never starts People work");
    await click("Open People Panel"); await waitFor(() => p.pending?.operationKind === "open", "People open pending");
    await click("Open People Panel"); assert.equal(p.calls.length, 1, "duplicate People panel clicks are blocked");
    p.finish(); await polls(); assert.equal(await disabled("Detect People"), false); assert.match(await status(), /navigation sent/);
    await click("Detect People"); await waitFor(() => p.pending?.operationKind === "detect", "People detection pending");
    await click("Detect People"); await click("Remove Detected"); assert.equal(p.calls.length, 2, "detection cannot duplicate or chain into removal");
    p.finish(); await polls(); assert.match(await status(), /readiness is not exposed/);
    assert.equal(await disabled("Remove Detected"), true, "immediate detection return cannot enable removal");
    p.publishInventory(0); await polls(); assert.equal(await disabled("Remove Detected"), true, "fresh empty inventory remains non-actionable");
    p.publishInventory(4); await polls(); assert.equal(await disabled("Remove Detected"), false);
    assert.match(await status(), /4 People targets/, "native detection results reach the user before removal");
    p.rejectNext = "People removal was rejected because native state changed; refresh and try again.";
    await click("Remove Detected"); await waitFor(async () => /native state changed/.test(await status()), "People rejection reason");
    assert.equal(p.pending, null, "rejected People admission creates no pending operation");

    p.holdNextState = true; await waitFor(() => p.heldState.length === 1, "old People poll held");
    p.holdNextAction = "remove"; await click("Remove Detected");
    await waitFor(() => p.heldAction.length === 1, "People removal admission response held");
    assert.match(await status(), /Submitting the People removal request/, "accepted click immediately reports submission");
    p.heldAction.shift()(); await waitFor(() => p.pending?.operationKind === "remove", "People removal pending");
    p.heldState.shift()(); await new Promise(resolve => setTimeout(resolve, 50));
    assert.doesNotMatch(await status(), /navigation sent/, "lower-revision poll cannot restore old navigation feedback");
    await click("Remove Detected"); assert.equal(p.calls.length, 3, "duplicate removal is blocked");
    p.pending.phase = "requested"; p.pending.invoked = true; p.revision++; await polls();
    assert.match(await status(), /waiting for Lightroom callback/);
    assert.equal(await evaluate("document.querySelector('.slider-jump-history-button').disabled"), true,
        "People removal blocks shared history while waiting for callback");
    p.callback(); await polls(); assert.match(await status(), /waiting for Lightroom callback/,
        "callback flag alone does not fabricate completion before the terminal result");
    p.finish(); await polls(); assert.match(await status(), /inventory was unchanged.*review Lightroom/i);
    assert.doesNotMatch(await status(), /removed|percent|%/i, "People completion never invents a result count or percentage");

    p.publishInventory(4); await polls();
    const callsBeforeStale = p.calls.length;
    await click("Remove Detected"); await waitFor(() => p.pending?.operationKind === "remove", "stale People removal");
    p.finish("stale"); p.last.detail = "before: People inventory token mismatch; expected=" + "a".repeat(64) + "; got=" + "b".repeat(64);
    await polls(); assert.match(await status(), /People detections changed/); assert.doesNotMatch(await status(), /[0-9a-f]{64}/);
    assert.equal(await disabled("Remove Detected"), true);
    p.publishInventory(3); await polls(); assert.equal(await disabled("Remove Detected"), false);
    assert.equal(p.calls.length, callsBeforeStale + 1, "refresh does not retry removal");
    p.controllerWorkflowOpen = false; p.revision++; await polls();
    assert.equal(await disabled("Open People Panel"), false);
    assert.equal(await evaluate("Array.from(document.querySelectorAll(" + JSON.stringify(root + " button") + ")).some(e=>/Cancel|Return|Close/.test(e.textContent))"), false,
        "People does not offer tool closure or a substitute for native Cancel");

    p.available = false; p.revision++; await polls();
    for (const label of ["Open People Panel", "Detect People", "Remove Detected"]) assert.equal(await disabled(label), true);
    await evaluate(element("Detect People") + ".dispatchEvent(new MouseEvent('click',{bubbles:true}))");
    assert.match(await status(), /Native People inventory unavailable/, "a raced guard reports the same reason as rendered availability");
    p.available = true; p.native.toolOpen = true; p.publishInventory(3); await polls();
    p.hangNext = "detect"; const attemptsBeforeTimeout = p.actionAttempts.length;
    await click("Detect People"); assert.match(await status(), /Submitting the People detection request/);
    await waitFor(async () => /submission response timed out/.test(await status()), "bounded People request timeout", 12000);
    assert.equal(p.actionAttempts.length, attemptsBeforeTimeout + 1, "ambiguous People submission is not retried");
    const originalContext = { ...fixture.context };
    await click("Remove Detected"); await waitFor(() => p.pending?.operationKind === "remove", "photo-bound People removal");
    fixture.context.selectedPhotoUuid = "people-other-photo"; fixture.context.contextCounter++;
    await polls(); p.finish(); await polls();
    assert.equal(await evaluate("peopleController.isInteracting()"), false, "photo change clears People interaction ownership");
    Object.assign(fixture.context, originalContext); p.native.toolOpen = true; p.revision++; await polls();
    for (const width of [1280, 390, 320]) {
        await setViewport(width, 1100); await polls();
        const sizes = await evaluate("Array.from(document.querySelectorAll(" + JSON.stringify(root + " button") + ")).map(e=>[e.getBoundingClientRect().width,e.getBoundingClientRect().height])");
        assert.ok(sizes.every(([buttonWidth, height]) => buttonWidth >= 44 && height >= 44), "People touch targets at " + width);
        assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true, "People controls do not overflow at " + width);
    }
    console.log("People browser: placement, explicit navigation/detection/removal, duplicates, callback wait, photo cancellation, unavailable state and touch geometry passed.");
}
function installReflections(fixture) {
    const r = fixture.reflections = { revision: 1, calls: [], reads: 0, pending: null, last: null, available: true, stale: null,
        native: { checkboxState: false, amount: 37.4, quality: "standard", enabled: true, isSupported: true }, admissions: [], delayAdmission: false };
    r.state = () => structuredClone({ ok: true, ...fixture.context, ...r.native, available: r.available, serverEpoch: "reflections-fixture",
        revision: r.revision, ageMs: 0, pendingOperation: r.pending, lastResult: r.last });
    r.callback = () => { r.pending.callbackCompleted = true; r.pending.phase = "requested"; r.revision++; };
    r.readback = () => { const c = r.calls.at(-1); r.native[c.field] = c.value; r.revision++; };
    r.finish = (outcome = "confirmed") => {
        const c = r.calls.at(-1); if (!r.pending) return;
        if (c.photo !== fixture.context.selectedPhotoUuid || c.context !== fixture.context.contextCounter || c.develop !== fixture.context.developCounter) outcome = "stale";
        if (outcome === "confirmed") { assert.ok(c.field === "amount" || r.pending.callbackCompleted); assert.equal(r.native[c.field], c.value); }
        r.last = { operationId: c.id, field: c.field, value: c.value, outcome, callbackCompleted: r.pending.callbackCompleted,
            invoked: true, detail: outcome === "confirmed" ? "Reflections confirmed by Lightroom readback." : "Reflections result unconfirmed; no retry sent." };
        r.pending = null; r.revision++;
    };
    const previous = fixture.handle;
    fixture.handle = function(url, reply) {
        if (url.pathname === "/api/reflections/state") { r.reads++; reply(r.stale || r.state()); r.stale = null; return true; }
        if (url.pathname === "/api/reflections/set") {
            assert.equal(r.pending, null, "one Reflections writer at a time");
            assert.equal(url.searchParams.get("selectedPhotoUuid"), fixture.context.selectedPhotoUuid);
            assert.equal(url.searchParams.get("stateRevision"), String(r.revision));
            assert.equal(url.searchParams.get("contextCounter"), String(fixture.context.contextCounter));
            assert.equal(url.searchParams.get("developCounter"), String(fixture.context.developCounter));
            const field = url.searchParams.get("field"), raw = url.searchParams.get("value");
            const value = field === "amount" ? Number(raw) : field === "checkboxState" ? raw === "true" : raw;
            const c = { id: "rf-" + (r.calls.length + 1), field, value, photo: fixture.context.selectedPhotoUuid,
                context: fixture.context.contextCounter, develop: fixture.context.developCounter };
            r.calls.push(c); r.pending = { operationId: c.id, field, value, phase: "queued", callbackCompleted: false, invoked: false }; r.revision++;
            const admitted = r.state();
            if (r.delayAdmission) r.admissions.push(() => reply(admitted)); else reply(admitted);
            return true;
        }
        return previous(url, reply);
    };
}
async function verifyReflections({ evaluate, waitFor, fixture, setViewport }) {
    const r = fixture.reflections, root = '.reflections-controls', amount = '[data-reflections-field="amount"]';
    const selectors = { apply: root + ' input[type="checkbox"]', quality: root + ' select', range: amount + ' input[type="range"]',
        number: amount + ' input[type="text"]', plus: amount + ' button[aria-label^="Increase"]', minus: amount + ' button[aria-label^="Decrease"]', reset: amount + ' button.reset' };
    const el = key => "document.querySelector(" + JSON.stringify(selectors[key] || key) + ")";
    const click = key => evaluate(el(key) + ".click()");
    const disabled = key => evaluate(el(key) + ".getAttribute('aria-disabled')==='true'");
    const polls = async () => { const n = r.reads; await waitFor(() => r.reads >= n + 3, "Reflections polls"); };
    const pending = (field, value) => waitFor(() => r.pending?.field === field && r.pending.value === value, "Reflections pending " + field + "=" + value);
    const show = n => evaluate("[" + el("number") + ".value," + el("range") + ".value]").then(values => assert.deepEqual(values, [String(n), String(n)]));
    const status = () => evaluate(el(root + ' [role="status"]') + ".textContent");
    const commit = async n => evaluate("(() => {const e=" + el("number") + ";e.focus({preventScroll:true});e.dispatchEvent(new PointerEvent('pointerdown'));e.value=" +
        JSON.stringify(String(n)) + ";e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()");
    const drag = (n, start, end) => evaluate("(() => {const e=" + el("range") + ";" + (start ? "e.dispatchEvent(new PointerEvent('pointerdown'));" : "") +
        "e.value='" + n + "';e.dispatchEvent(new Event('input',{bubbles:true}));" + (end ? "e.dispatchEvent(new Event('change',{bubbles:true}));" : "") + "})()");
    async function settle() { r.readback(); if (r.pending.field !== "amount") r.callback(); r.finish(); await polls(); }
    await waitFor(async () => await evaluate("Boolean(" + el("apply") + ")") && !await disabled("apply"), "Reflections ready");
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.group[data-tools-section]')).map(e=>e.dataset.toolsSection)"),
        ["crop-straighten", "healing", "red-eye", "masking"]);
    assert.equal(await evaluate("document.querySelector('.reflections-controls').closest('[data-tools-section]').dataset.toolsSection"), "healing");
    assert.deepEqual(await evaluate("[document.querySelector('.remove-distraction-removal>h3').textContent,document.querySelector('.reflections-controls>h4').textContent]"),
        ["Distraction Removal", "Reflections"]);
    assert.deepEqual(await evaluate("Array.from(document.querySelector('.remove-brush-preferences').children).filter(e=>e.matches('.remove-brush-status,.remove-selected-repair,.remove-distraction-removal')).map(e=>e.className)"),
        ["remove-brush-status", "remove-selected-repair", "remove-distraction-removal"], "Healing status keeps its space beside brush controls without adding a second gap below Refresh/Delete");
    assert.equal(await evaluate("Array.from(document.querySelectorAll('[data-tools-section]')).some(e=>e.dataset.toolsSection==='distraction-removal')"), false);
    assert.equal(await evaluate("Array.from(document.querySelectorAll('.reflections-controls button')).some(e=>e.textContent==='Reset Reflections')"), false,
        "No broad Reflections Reset is exposed without a faithful SDK operation");
    await show(37); await commit(37); await polls(); assert.equal(r.calls.length, 0, "rounded native value never writes");
    await evaluate(el("number") + ".blur()");
    // Reuse the section's actual accessible collapse button rather than a new collapse implementation.
    const toggle = '[data-tools-section="healing"] .group-title button';
    await click(toggle); await click(toggle); await polls(); assert.equal(r.calls.length, 0, "expansion never applies or changes settings");
    for (const [field, value] of [["isSupported", false], ["enabled", false]]) {
        r.native[field] = value; r.revision++; await polls();
        for (const key of ["apply", "quality", "range", "reset"]) assert.equal(await disabled(key), true);
        await click("reset"); await click("apply"); assert.equal(r.calls.length, 0);
        r.native[field] = true; r.revision++; await polls();
    }
    r.available = false; r.revision++; await polls(); assert.equal(await disabled("apply"), true);
    r.available = true; r.revision++; await polls();
    await click("apply"); await pending("checkboxState", true);
    assert.equal(await evaluate(el("apply") + ".checked"), false, "Apply displays native state until actual readback");
    await click("apply"); assert.equal(r.calls.length, 1, "duplicate Apply cannot toggle twice");
    assert.equal(await disabled("reset"), true);
    r.callback(); await polls(); assert.match(await status(), /callback received/); assert.ok(r.pending);
    assert.equal(await evaluate("document.querySelector('.slider-jump-history-button').disabled"), true);
    await settle(); assert.equal(r.native.amount, 37.4); assert.equal(r.native.quality, "standard");
    await click("apply"); await pending("checkboxState", false);
    r.readback(); r.native.enabled = false; r.pending.phase = "requested"; r.revision++; await polls();
    assert.match(await status(), /callback/); assert.ok(r.pending, "native value alone does not finish callback operation");
    r.callback(); r.finish(); await polls();
    assert.equal(await evaluate(el("apply") + ".checked"), false, "Apply-off displays fresh native checkbox readback");
    assert.equal(await evaluate("reflectionsController.isInteracting()"), false, "Apply-off settles when only the panel UI becomes disabled");
    assert.equal(await disabled("apply"), true, "authoritative disabled panel state remains visible after settlement");
    r.native.enabled = true; r.revision++; await polls();
    // Quality uses the same callback/readback separation and remains pending across tab changes.
    await evaluate(el("quality") + ".value='best';" + el("quality") + ".dispatchEvent(new Event('change',{bubbles:true}))");
    await pending("quality", "best");
    await evaluate("document.querySelector('[data-tab=\"selection\"]').click()"); await polls();
    assert.equal(await evaluate("document.querySelector('.slider-jump-history-button').disabled"), true, "processing blocks shared history on other tabs");
    r.callback(); r.readback(); r.finish();
    await waitFor(async () => await evaluate("!reflectionsController.isInteracting()"), "background Reflections completion releases history");
    await evaluate("document.querySelector('[data-tab=\"tools\"]').click()"); await polls();
    assert.equal(await evaluate(el("quality") + ".value"), "best");
    // Slider retains desired values over polls, old acknowledgements and held-drag completions.
    const initialCalls = r.calls.length;
    await evaluate("for(let i=0;i<10;i++)" + el("plus") + ".click()"); await show(47); await pending("amount", 47);
    const old = r.state(); await drag(60, true, false); await polls(); await show(60);
    assert.equal(r.calls.length, initialCalls + 1); await settle(); await pending("amount", 60); await show(60);
    r.stale = old; await polls(); await show(60);
    await drag(65, false, true); await settle(); await pending("amount", 65); await settle(); await show(65);
    r.delayAdmission = true; await click("minus"); await pending("amount", 64);
    await click("minus"); await click("reset"); await show(100); await settle(); await show(100);
    r.delayAdmission = false; r.admissions.splice(0).forEach(release => release()); await pending("amount", 100); await settle();
    assert.equal(r.native.checkboxState, false); assert.equal(r.native.quality, "best");
    await commit("-22,6"); await pending("amount", -23); await settle();
    await commit(-140); await pending("amount", -100); await settle();
    await commit(142); await pending("amount", 100); await settle();
    // Native context replacement cancels queued intent and ignores late callback/result/admission.
    await click("minus"); await pending("amount", 99); await drag(50, true, false);
    const contextBefore = { ...fixture.context }, callsBeforePhoto = r.calls.length;
    fixture.context.selectedPhotoUuid = "reflections-new-photo"; fixture.context.contextCounter++; r.native.amount = 11; r.revision++;
    await polls(); r.finish("stale"); await polls(); await drag(70, false, true); await polls();
    assert.equal(r.calls.length, callsBeforePhoto); assert.equal(r.native.amount, 11);
    Object.assign(fixture.context, contextBefore); r.revision++; await polls();
    await click("apply"); await pending("checkboxState", true); const callsBeforeFailure = r.calls.length;
    r.finish("failed"); await polls(); assert.match(await status(), /unconfirmed/);
    await polls(); assert.equal(r.calls.length, callsBeforeFailure, "ambiguous Apply is never automatically retried");
    assert.equal(await disabled("apply"), false, "failed processing unlocks after native feedback");
    for (const width of [1280, 768, 390, 320]) {
        await setViewport(width, 1100); r.native.amount = 31; r.revision++; await polls();
        await evaluate("(() => {const e=" + el("number") + ";e.scrollIntoView({block:'center'});window.__reflectionGeometry=[];window.__reflectionRecord=true;" +
            "const sample=()=>{if(!window.__reflectionRecord)return;const b=document.querySelector('.reflections-controls').getBoundingClientRect();" +
            "window.__reflectionGeometry.push([scrollY,b.top,b.height]);requestAnimationFrame(sample)};sample()})()");
        await commit(42); await pending("amount", 42); await polls(); await settle();
        assert.equal(await evaluate("document.activeElement===" + el("number")), true);
        await click("reset"); await pending("amount", 100); await settle();
        const samples = await evaluate("window.__reflectionRecord=false;window.__reflectionGeometry");
        for (const s of samples) for (let i = 0; i < 3; i++) assert.ok(Math.abs(s[i] - samples[0][i]) < 1, "Reflections geometry at " + width);
        assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true);
        const targets = await evaluate("Array.from(document.querySelectorAll('.reflections-controls button,.reflections-controls select')).map(e=>[e.getBoundingClientRect().width,e.getBoundingClientRect().height])");
        assert.ok(targets.every(([w,h]) => w >= 44 && h >= 44));
        assert.equal(await evaluate("getComputedStyle(" + el("reset") + ").backgroundColor"), "rgb(122, 79, 36)");
    }
    await evaluate(el("number") + ".blur()");
    console.log("Reflections browser: availability, guarded Apply, callbacks/readback, queue/gestures, photo cancellation, background history and touch geometry passed.");
}
async function verifyDust({ evaluate, waitFor, fixture, setViewport }) {
    const r = fixture.remove;
    const el = selector => "document.querySelector(" + JSON.stringify(selector) + ")";
    const visualize = '.dust-controls [data-remove-preference="visualizeSpots"]';
    const threshold = '.dust-controls [data-remove-field="visualizationThreshold"]';
    const range = threshold + ' input[type="range"]', number = threshold + ' input[type="text"]';
    const polls = async () => { const reads = r.reads; await waitFor(() => r.reads > reads + 2, "Dust shared feedback"); };
    await waitFor(async () => await evaluate("Boolean(document.querySelector('.dust-controls'))") &&
        await evaluate(el(range) + ".getAttribute('aria-disabled')==='false'"), "Dust visualization ready");
    assert.equal(await evaluate("document.querySelector('.dust-controls').closest('.remove-distraction-removal').parentElement.closest('[data-tools-section]').dataset.toolsSection"), "healing");
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.remove-distraction-removal>section>h4')).map(e=>e.textContent)"), ["Reflections", "People", "Dust"]);
    assert.equal(await evaluate("document.querySelectorAll('[data-remove-preference=visualizeSpots]').length"), 1);
    assert.equal(await evaluate("document.querySelectorAll('[data-remove-field=visualizationThreshold]').length"), 1);
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.dust-action-row button')).map(b=>[b.textContent,b.disabled])"), [["Reset", false], ["Close", false]]);
    const untouched = structuredClone(r.preferences);
    r.hold = true;
    const apply = '[data-dust-apply]', size = '.dust-controls [data-remove-field="brushSize"] input[type="text"]';
    const reset = '[data-dust-action=reset]', close = '[data-dust-action=close]';
    await evaluate(el(close) + ".click()");
    await waitFor(() => r.pending?.field === "dustClose" && r.pending.value === "manualRemove", "Native Dust Close navigation request");
    const closeWrites = r.calls.length;
    await evaluate(el(close) + ".click();" + el(reset) + ".click()"); await polls();
    assert.equal(r.calls.length, closeWrites, "Close and Reset cannot duplicate or overlap requests");
    r.finish(); await polls();
    assert.equal(r.selectedTool, "dust", "Dust Close must keep Healing open");
    assert.equal(r.dust.applied, true, "Close must retain Dust treatment");
    assert.equal(await evaluate("document.querySelector('.dust-controls').getBoundingClientRect().height>0"), true, "Close cannot merely collapse the web section");
    assert.match(await evaluate("document.querySelector('.dust-status').textContent"), /panel state is not exposed/, "No fabricated Closed confirmation");
    assert.equal(await evaluate("document.querySelectorAll('[data-remove-field=brushSize]').length"), 1);
    assert.deepEqual(await evaluate("[document.querySelector('[data-dust-apply]').checked,document.querySelector('[data-dust-apply]').indeterminate]"), [true, false]);
    await evaluate(el(apply) + ".click()");
    await waitFor(() => r.pending?.field === "dustApply" && r.pending.value === false, "Dust Off request");
    assert.equal(await evaluate(el(apply) + ".checked"), true, "Apply must wait for native readback");
    const offWrites = r.calls.length;
    await evaluate(el(apply) + ".click()"); await polls();
    assert.equal(r.calls.length, offWrites, "No duplicate Dust Off dispatch");
    r.finish(); await polls();
    assert.equal(await evaluate(el(apply) + ".checked"), false);
    await evaluate(el(apply) + ".click()"); await polls();
    await waitFor(() => r.pending?.field === "dustApply" && r.pending.value === true, "Dust On uses the guarded preset route");
    assert.equal(await evaluate(el(apply) + ".checked"), false, "No optimistic Apply On checkbox");
    r.finish(); await polls();
    assert.equal(await evaluate(el(apply) + ".checked"), true);
    await evaluate(el(reset) + ".click()");
    await waitFor(() => r.pending?.field === "dustApply" && r.pending.value === false, "Reset reuses Dust Off only");
    r.finish(); await polls();
    assert.equal(r.resetSpotRemovalCalls, 0, "Never reset all Healing");
    assert.equal(r.selectedTool, "dust");
    r.dust.canEnable = false; r.revision++; await polls();
    const unavailableWrites = r.calls.length;
    await evaluate(el(apply) + ".click();" + el(reset) + ".click();" + el(close) + ".click()"); await polls();
    assert.equal(r.calls.length, unavailableWrites, "Missing On preset and absent Dust block dependent actions");
    r.dust.applied = true; r.dust.canDisable = false; r.revision++; await polls();
    assert.equal(await evaluate(el(apply) + ".checked"), true, "Native Apply on synchronizes");
    assert.equal(await evaluate(el(apply) + ".getAttribute('aria-disabled')"), "true", "Missing/changed preset blocks Off");
    r.dust = { available: false }; r.revision++; await polls();
    assert.equal(await evaluate(el(apply) + ".indeterminate"), true, "Unreadable state is unknown");
    r.preferences.brushSize = 37; r.revision++; await polls();
    assert.equal(await evaluate(el(size) + ".value"), "37", "Captured Dust Size preference synchronizes");
    await evaluate("(() => {const n=" + el(size) + ";n.focus();n.value='42';n.dispatchEvent(new Event('input'));n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));})()");
    await waitFor(() => r.pending?.field === "brushSize" && r.pending.value === 42, "Dust Size uses existing preference route");
    r.finish(); await polls(); assert.equal(r.preferences.brushSize, 42);
    await evaluate(el(visualize) + ".click()");
    await waitFor(() => r.pending?.field === "visualizeSpots" && r.pending.value === false, "Dust visualization off request");
    assert.equal(r.preferences.visualizeSpots, true, "Request is separate from SDK feedback");
    r.finish(); await polls();
    assert.equal(await evaluate(el(range) + ".getAttribute('aria-disabled')"), "true");
    r.preferences.visualizeSpots = true; r.preferences.visualizationThreshold = 58.6; r.revision++;
    await polls(); assert.equal(await evaluate(el(number) + ".value"), "59", "Native fractional threshold displays as an integer");
    await evaluate("(() => {const n=" + el(number) + ";n.focus();n.value='64';n.dispatchEvent(new Event('input'));n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));})()");
    await waitFor(() => r.pending?.field === "visualizationThreshold" && r.pending.value === 64, "Dust threshold uses existing preference route");
    r.finish(); await polls(); assert.equal(r.preferences.visualizationThreshold, 64);
    assert.equal(fixture.people.calls.length, 0); assert.equal(fixture.reflections.calls.length, 0);
    for (const key of Object.keys(untouched).filter(key => !["brushSize", "visualizeSpots", "visualizationThreshold"].includes(key))) assert.equal(r.preferences[key], untouched[key]);
    for (const width of [1280, 768, 390, 320]) {
        await setViewport(width, 1100);
        assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true, "Dust does not overflow at " + width);
        const heights = await evaluate("Array.from(document.querySelectorAll('.dust-controls .remove-preference-row,.dust-controls button,.dust-controls input[type=range]')).map(e=>e.getBoundingClientRect().height)");
        assert(heights.every(height => height >= 44), "Touch targets at " + width);
        assert.equal(await evaluate("(() => {const b=Array.from(document.querySelectorAll('.dust-action-row button')).map(e=>e.getBoundingClientRect());return b[0].top===b[1].top && b[0].right<=b[1].left;})()"), true, "Dust buttons stay side by side at " + width);
    }
    await evaluate(el(number) + ".blur()");
    const beforePhoto = r.calls.length;
    fixture.context = { ...fixture.context, selectedPhotoUuid: "dust-other-photo", contextCounter: fixture.context.contextCounter + 1 };
    r.preferences.visualizationThreshold = 21; r.revision++;
    await polls();
    assert.equal(r.calls.length, beforePhoto, "Native context changes cannot dispatch edits");
    console.log("Dust browser: shared Size/visualization, authoritative On/Off, Reset alias, native Close request without false confirmation, independent People/Reflections and touch layout passed.");
    return { dust: true };
}
module.exports = { install, verify };
