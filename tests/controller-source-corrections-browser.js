"use strict";
const assert = require("node:assert/strict");
const enhance = require("../server/enhance-state");
const lens = require("../server/lens-blur-state");
const captured = require("./fixtures/profile-sdk-vivid-18.4.json");

// Isolated HTTP/SDK fixtures. This module never connects to Lightroom.
function install(fixture, categorical) {
    const nativeCheckbox = value => ({ available: true, value });
    Object.assign(fixture.values, { HDREditMode: 0, LensProfileEnable: 0, AutoLateralCA: 0 });
    const state = fixture.sourceCorrections = {
        calls: [], categorical, lensRevision: 1,
        enhance: Object.assign(enhance.createEnhanceState().get(), { available: true,
            denoiseState: false, denoiseEnabled: true, denoiseAmount: 50,
            rawDetailsState: false, rawDetailsEnabled: true, superResState: false, superResEnabled: true }),
        lens: Object.assign(lens.unavailableState(), { activeAvailable: true, active: true,
            bokehAvailable: true, bokeh: "Circle", selectedToolAvailable: true, selectedTool: "depth_refinement",
            windowsNative: { available: true, reason: null,
                brush: Object.fromEntries(["amount", "size", "feather", "flow"].map(k => [k, { available: true, value: 50, min: 0, max: 100 }])),
                visualizeDepth: nativeCheckbox(false), autoMask: nativeCheckbox(false), refinementMode: "focus",
                refinementModeTargetsAvailable: true, refinementDisclosure: nativeCheckbox(true),
                refinementReset: { available: true, enabled: true },
                focusActions: { subject: { available: true, enabled: true }, pointArea: { available: true, enabled: true } }
            } })
    };
    const previous = fixture.handle;
    fixture.handle = (url, reply) => {
        const path = url.pathname;
        if (path === "/api/point-color/state") {
            const range = { LowerNone: 0.1, LowerFull: 0.3, UpperFull: 0.7, UpperNone: 0.9 };
            reply({ ok: true, state: { available: true, swatchCount: 1, selectedIndex: 1, selectionTransient: false,
                HueShift: 0, SatScale: 0, LumScale: 0, Variance: 0, RangeAmount: 0.5,
                HueRange: range, SatRange: range, LumRange: range } });
        } else if (path === "/api/point-color/range-visualization/toggle") {
            state.calls.push({ target: "pointColorVisualize" }); reply({ ok: true });
        } else if (path === "/api/enhance/state") reply(state.enhance);
        else if (path === "/api/lens-blur/state") reply({ ok: true, state: state.lens, revision: state.lensRevision++, context: fixture.context });
        else if (path === "/api/develop-categorical/state") reply(state.categorical);
        else if (/^\/api\/enhance\/(denoise|raw-details|super-resolution)\/set$/.test(path)) {
            const target = path.includes("raw-details") ? "rawDetails" : path.includes("super-resolution") ? "superResolution" : "denoise";
            state.calls.push({ target, enabled: url.searchParams.get("enabled") === "true" });
            Object.assign(state.enhance, { operation: "processing", operationTarget: target,
                requestedEnabled: url.searchParams.get("enabled") === "true" });
            reply({ ok: true });
        } else if (path === "/api/develop-categorical/constrain-crop") {
            state.calls.push({ target: "constrainCrop", value: Number(url.searchParams.get("value")) });
            reply({ ok: true, confirmationAfterRevision: state.categorical.revision });
        } else if (path === "/api/set" && ["HDREditMode", "LensProfileEnable", "AutoLateralCA"].includes(url.searchParams.get("slider"))) {
            state.calls.push({ target: url.searchParams.get("slider"), value: Number(url.searchParams.get("value")) });
            reply({ ok: true });
        } else if (["/api/lens-blur/visualize-depth", "/api/lens-blur/auto-mask", "/api/lens-blur/apply"].includes(path)) {
            state.calls.push({ target: path.split("/").pop(), enabled: url.searchParams.get("enabled") === "true" });
            if (path === "/api/lens-blur/auto-mask") state.nativeReply = () => reply({ ok: true, windowsNative: state.lens.windowsNative });
            else if (path === "/api/lens-blur/visualize-depth") reply({ ok: true, changed: true, windowsNative: state.lens.windowsNative });
            else reply({ ok: true, context: fixture.context });
        } else return previous(url, reply);
        return true;
    };
}

async function verify({ evaluate, waitFor, selectTab, fixture, setViewport, capture }) {
    const state = fixture.sourceCorrections;
    const selector = label => 'input[type="checkbox"][aria-label="' + label + '"]';
    const element = query => "document.querySelector(" + JSON.stringify(query) + ")";
    const checkbox = label => element(selector(label));
    const read = label => evaluate("[" + checkbox(label) + ".checked," + checkbox(label) + ".indeterminate," + checkbox(label) + ".disabled]");
    const click = label => evaluate(checkbox(label) + ".closest('label').click()");
    await selectTab("sliders");
    await waitFor(async () => (await read("Denoise"))[2] === false, "Enhance checkbox readback");
    assert.equal(await evaluate("document.querySelector('.color-mixer-view-button[aria-selected=true]').textContent"), "Color");
    const groups = await evaluate("Array.from(document.querySelectorAll('.color-mixer-view-content .color-mixer-group-heading')).map(e=>e.textContent)");
    assert.deepEqual(groups, ["Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta"]);
    await evaluate("window.__originalRedHue = document.querySelector('[data-slider-id=HueAdjustmentRed]');Array.from(document.querySelectorAll('.color-mixer-view-button')).find(e=>e.textContent==='HSL').click()");
    assert.equal(await evaluate("Boolean(window.__originalRedHue)"), true);
    await evaluate("Array.from(document.querySelectorAll('.color-mixer-view-button')).find(e=>e.textContent==='Color').click()");
    assert.equal(await evaluate("window.__originalRedHue===document.querySelector('[data-slider-id=HueAdjustmentRed]')"), true, "Color/HSL reuse slider bindings");

    for (const [label, target, field] of [["Denoise", "denoise", "denoiseState"], ["Raw Details", "rawDetails", "rawDetailsState"], ["Super Resolution", "superResolution", "superResState"]]) {
        await waitFor(async () => (await read(label))[2] === false, label + " enabled");
        const count = state.calls.length;
        await click(label); await waitFor(() => state.calls.length === count + 1, label + " request");
        assert.deepEqual(state.calls.at(-1), { target, enabled: true });
        assert.deepEqual(await read(label), [false, false, true], label + " waits for SDK readback");
        await click(label); assert.equal(state.calls.length, count + 1, "pending click cannot duplicate dispatch");
        Object.assign(state.enhance, { [field]: true, operation: "idle", operationTarget: null });
        await waitFor(async () => (await read(label))[0] === true, label + " confirmed");
        await click(label); await waitFor(() => state.calls.length === count + 2, label + " Off request");
        Object.assign(state.enhance, { [field]: false, operation: "idle", operationTarget: null });
        await waitFor(async () => (await read(label))[0] === false && !(await read(label))[2], label + " Off confirmed");
    }
    state.enhance.available = false;
    await waitFor(async () => (await read("Denoise"))[1], "Unavailable Enhance is indeterminate");
    for (const label of ["Denoise", "Raw Details", "Super Resolution"]) assert.deepEqual(await read(label), [false, true, true]);
    state.enhance.available = true;
    Object.assign(state.enhance, { denoiseState: null, rawDetailsState: null, superResState: null });
    await waitFor(async () => (await read("Denoise"))[1], "Unknown Enhance remains indeterminate");
    assert.doesNotMatch(await evaluate("Array.from(document.querySelectorAll('.enhance-status')).map(e=>e.textContent).join(' ')"), /\bOff\b/);
    Object.assign(state.enhance, { denoiseState: false, rawDetailsState: false, superResState: false });

    for (const [label, slider] of [["HDR Edit Mode", "HDREditMode"], ["Remove Chromatic Aberration", "AutoLateralCA"], ["Enable Profile Corrections", "LensProfileEnable"]]) {
        await waitFor(async () => !(await read(label))[2], label + " available");
        const count = state.calls.length;
        await click(label); await waitFor(() => state.calls.length === count + 1, label + " exact set command");
        assert.deepEqual(state.calls.at(-1), { target: slider, value: 1 });
        assert.deepEqual(await read(label), [false, false, true], label + " waits for readback");
        await click(label); assert.equal(state.calls.length, count + 1);
        fixture.values[slider] = 1;
        await waitFor(async () => (await read(label))[0] && !(await read(label))[2], label + " confirmed");
    }

    await click("Constrain Crop");
    await waitFor(() => state.calls.at(-1)?.target === "constrainCrop", "Constrain Crop request");
    assert.deepEqual(await read("Constrain Crop"), [false, false, true]);
    state.categorical.state.constrainCrop = 1; state.categorical.revision++;
    await waitFor(async () => (await read("Constrain Crop"))[0], "Constrain Crop confirmed");
    await evaluate("Array.from(document.querySelectorAll('.lens-corrections-tabs button')).find(e=>e.textContent==='Manual')?.click()");
    assert.equal(await evaluate("Array.from(document.querySelectorAll('input[aria-label=\"Constrain Crop\"]')).every(e=>e.checked && !e.indeterminate)"), true, "Both Constrain Crop locations synchronize");
    for (const label of ["Visualize Depth", "Auto Mask"]) {
        await waitFor(async () => !(await read(label))[2], label + " native availability");
        const count = state.calls.length; await click(label);
        await waitFor(() => state.calls.length > count, label + " request");
        assert.equal((await read(label))[0], false, label + " is not optimistic");
        assert.equal((await read(label))[2], true, label + " blocks pending duplicates");
        await click(label); assert.equal(state.calls.length, count + 1);
        state.lens.windowsNative[label === "Auto Mask" ? "autoMask" : "visualizeDepth"].value = true;
        if (label === "Auto Mask") { state.nativeReply(); state.nativeReply = null; }
        await waitFor(async () => (await read(label))[0], label + " native confirmation");
    }
    state.lens.windowsNative.brush.size.available = false;
    state.lens.windowsNative.autoMask = { available: false, value: null };
    await waitFor(async () => (await read("Auto Mask"))[1], "Native disabled state respected");
    state.lens.windowsNative.autoMask = { available: true, value: true };
    state.lens.windowsNative.brush.size.available = true;
    state.lens.activeAvailable = false; state.lens.active = null;
    await waitFor(async () => (await read("Lens Blur Apply"))[1], "Unknown Apply is not confirmed Off");
    await waitFor(async () => !(await read("Auto Mask"))[2], "Native availability remains authoritative when SDK Apply is unknown");
    state.lens.activeAvailable = true; state.lens.active = true;

    state.lens.active = false;
    await waitFor(async () => JSON.stringify(await read("Lens Blur Apply")) === "[false,false,false]", "Explicit SDK Off renders unchecked, never indeterminate");
    state.lens.active = true;
    await waitFor(async () => (await read("Lens Blur Apply"))[0], "Explicit SDK On renders checked");
    state.lens.activeAvailable = false; state.lens.active = null;
    for (const value of [false, true]) {
        state.lens.windowsNative.apply = { available: true, value };
        await waitFor(async () => JSON.stringify(await read("Lens Blur Apply")) === JSON.stringify([value, false, false]), "Verified native Apply readback " + value);
    }
    state.lens.windowsNative.apply = { available: false, value: null };
    await waitFor(async () => (await read("Lens Blur Apply"))[1], "Missing SDK and native Apply readback remains unknown");
    state.lens.activeAvailable = true; state.lens.active = true;

    // Replay actual read-only SDK/helper availability, then simulated brush activation.
    const activeRefinement = structuredClone(state.lens);
    Object.assign(fixture.values, { LensBlurAmount: captured.lensBlur.amount,
        LensBlurCatEye: captured.lensBlur.catEye, LensBlurHighlightsBoost: captured.lensBlur.highlightsBoost });
    Object.assign(state.lens, { active: captured.lensBlur.active, selectedTool: captured.lensBlur.selectedTool,
        focalRangeAvailable: true, focalRangeSourceAvailable: true, focalRangeSource: captured.lensBlur.focalRangeSource,
        focalRange: Object.fromEntries(["nearOuter", "nearInner", "farInner", "farOuter"].map((key, i) =>
            [key, Number(captured.lensBlur.focalRange.split(" ")[i])])),
        windowsNative: structuredClone(captured.nativeReadback.windowsNative) });
    await waitFor(async () => (await read("Auto Mask"))[1] && await evaluate("document.querySelector('.lens-blur-mode-row .switch-status').textContent==='Choose Focus or Blur'"), "Captured inactive refinement readback");
    assert.deepEqual(await read("Lens Blur Apply"), [true, false, false], "Captured Apply remains available and checked");
    assert.deepEqual(await read("Visualize Depth"), [false, false, false], "Native depth checkbox is available");
    assert.deepEqual(await read("Auto Mask"), [false, true, true], "Unavailable Auto Mask is unknown, not confirmed Off");
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.lens-blur-mode-row button')).map(e=>({label:e.textContent,disabled:e.disabled}))"),
        [{ label: "Focus", disabled: false }, { label: "Blur", disabled: false }, { label: "Reset Refinement", disabled: true }],
        "Available native mode targets remain enabled without readable brush values");
    assert.equal(await evaluate("Array.from(document.querySelectorAll('.lens-blur-native-row input')).every(e=>e.disabled)"), true);
    for (const width of [1280, 390]) {
        await setViewport(width, 950);
        await evaluate("document.querySelector('.lens-blur-mode-row').scrollIntoView({block:'start'}); scrollBy(0,-145)");
        if (capture) await capture("lens-blur-captured-" + width);
    }
    state.lens = activeRefinement;
    await waitFor(async () => !(await read("Auto Mask"))[2] && await evaluate("Array.from(document.querySelectorAll('.lens-blur-native-row input')).every(e=>!e.disabled)"), "Simulated native brush activation enables refinement controls");

    for (const width of [1280, 390]) {
        await setViewport(width, 950);
        await evaluate("Array.from(document.querySelectorAll('.lens-corrections-tabs button')).find(e=>e.textContent==='Profile').click(); document.querySelector('.lens-corrections-note').scrollIntoView({block:'center'})");
        assert.equal(await evaluate("document.querySelector('.lens-corrections-note').textContent"), "Choose and configure the lens profile in Lightroom Classic.");
        if (capture) await capture("lens-corrections-note-" + width);
        await evaluate("Array.from(document.querySelectorAll('.color-mixer-view-button')).find(e=>e.textContent==='Point Color').click()");
        await waitFor(() => evaluate("document.querySelector('#pointColorVisualizeRange')?.tagName==='BUTTON'"), "Point Color momentary button restored");
        await evaluate("document.querySelector('#pointColorVisualizeRange').scrollIntoView({block:'center'})");
        assert.equal(await evaluate("document.querySelector('#pointColorVisualizeRange').textContent"), "Toggle Visualize Range");
        assert.equal(await evaluate("(()=>{const r=document.querySelector('#pointColorVisualizeRange').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.height>=36;})()"), true, "Restored toggle button fits the viewport");
        if (capture) await capture("point-color-toggle-" + width);
        await evaluate("document.querySelector('#pointColorVisualizeRange').click()");
        await waitFor(() => state.calls.at(-1)?.target === "pointColorVisualize", "Existing Point Color toggle route");
        await evaluate("Array.from(document.querySelectorAll('.color-mixer-view-button')).find(e=>e.textContent==='Color').click()");
    }

    for (const width of [1280, 390]) {
        await setViewport(width, 950);
        assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "Develop fits width " + width);
        const targets = await evaluate("Array.from(document.querySelectorAll('.native-checkbox-label')).filter(e=>e.getBoundingClientRect().height>0).map(e=>({height:e.getBoundingClientRect().height,box:e.querySelector('input').getBoundingClientRect().width}))");
        assert(targets.every(t => t.height >= 44 && t.box === 18), "Compact checkboxes have large labels at " + width);
        for (const section of ["detail", "color-mixer", "lens-blur"]) {
            await evaluate("document.querySelector('[data-develop-section=" + section + "]').scrollIntoView({block:'start'}); scrollBy(0,-145)");
            if (capture) await capture(section + "-" + width);
        }
        await evaluate(checkbox("Auto Mask") + ".scrollIntoView({block:'end'}); scrollBy(0,50)");
        if (capture) await capture("lens-blur-refinement-" + width);
    }
    await selectTab("tools");
    const r = fixture.remove;
    r.selectedTool = "dust"; r.available = true; r.preferences.newSpotType = "heal_patchmatch";
    r.repair = { available: true, selected: false, count: 0 }; r.revision++;
    const sizes = '[data-remove-field="brushSize"] input[type="text"]';
    await waitFor(() => evaluate("document.querySelector('[data-remove-mode=heal_patchmatch]').getAttribute('aria-selected')==='true'"), "Remove mode readback");
    await waitFor(() => evaluate("Array.from(document.querySelectorAll(" + JSON.stringify(sizes) + ")).length===2 && Array.from(document.querySelectorAll(" + JSON.stringify(sizes) + ")).every(e=>!e.disabled)"), "Size available in Healing and Dust without a repair");
    const before = r.calls.length;
    await evaluate("document.querySelector('[data-remove-field=brushSize] button[aria-label^=Increase]').click()");
    await waitFor(() => r.calls.length === before + 1 && !r.pending, "Shared Size single command");
    await waitFor(() => evaluate("Array.from(document.querySelectorAll(" + JSON.stringify(sizes) + ")).every(e=>e.value===" + JSON.stringify(String(r.preferences.brushSize)) + ")"), "Both Size views synchronize");
    const sharedValue = r.preferences.brushSize;
    await evaluate("document.querySelector('.dust-controls [data-remove-field=brushSize] button[aria-label^=Increase]').click()");
    await waitFor(() => r.preferences.brushSize === sharedValue + 1 && !r.pending, "Dust Size uses the same command path");
    await waitFor(() => evaluate("Array.from(document.querySelectorAll(" + JSON.stringify(sizes) + ")).every(e=>e.value===" + JSON.stringify(String(sharedValue + 1)) + ")"), "Dust edits synchronize back to Healing");
    const beforeReset = r.calls.length;
    await evaluate("const size=document.querySelector('[data-remove-field=brushSize] input[type=text]'); size.focus(); size.value='83'; size.dispatchEvent(new Event('input')); document.querySelector('.dust-controls [data-remove-field=brushSize] button.reset').click(); size.blur()");
    await waitFor(() => r.calls.length === beforeReset + 1 && r.preferences.brushSize === 25 && !r.pending, "Reset in Dust cancels an unfinished Healing editor");
    assert.equal(await evaluate("document.querySelector('[data-remove-field=brushFeather]').hidden"), true);
    r.preferences.newSpotType = "heal"; r.revision++;
    await waitFor(() => evaluate("!document.querySelector('[data-remove-field=brushFeather]').hidden"), "Heal exposes Feather");
    for (const width of [1280, 390]) {
        await setViewport(width, 950);
        await evaluate("document.querySelector('.remove-brush-preferences').scrollIntoView({block:'start'}); scrollBy(0,-145)");
        assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true);
        const sizeLabel = await evaluate("(()=>{const row=document.querySelector('.remove-brush-preferences [data-remove-field=brushSize]'), label=row.querySelector('.slider-name'); return {text:label.textContent,height:label.getBoundingClientRect().height,top:label.getBoundingClientRect().top,rowTop:row.getBoundingClientRect().top};})()");
        assert.equal(sizeLabel.text, "Size"); assert(sizeLabel.height > 0 && sizeLabel.top >= sizeLabel.rowTop, "Healing Size label stays visible at " + width);
        const labelHit = await evaluate("(()=>{const label=document.querySelector('.remove-brush-preferences [data-remove-field=brushSize] .slider-name'), rect=label.getBoundingClientRect();return {visible:document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)===label,rect:rect.toJSON(),hit:document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.outerHTML.slice(0,200)};})()");
        assert.equal(labelHit.visible, true, JSON.stringify(labelHit));
        if (capture) await capture("healing-" + width);
    }
    r.preferences.newSpotType = "clone"; r.revision++;
    await waitFor(() => evaluate("document.querySelector('[data-remove-mode=clone]').getAttribute('aria-selected')==='true'"), "Clone readback");
    assert.equal(await evaluate("!document.querySelector('[data-remove-field=brushFeather]').hidden && Array.from(document.querySelectorAll(" + JSON.stringify(sizes) + ")).every(e=>!e.disabled)"), true, "Clone keeps new-brush Size and Feather without a repair");
    return { sourceCorrections: true, simulated: true };
}
module.exports = { install, verify };
