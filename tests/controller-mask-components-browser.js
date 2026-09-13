"use strict";
const assert = require("node:assert/strict");

async function verify({ evaluate, waitFor, fixture, setViewport, touch, key }) {
    const c = fixture.creation;
    const button = kind => ".masking-" + kind + "-button";
    const label = kind => kind === "add" ? "Add Component" : "Subtract from Mask";
    const click = selector => evaluate("document.querySelector(" + JSON.stringify(selector) + ").click()");
    const ready = () => waitFor(() => evaluate("!document.querySelector('.masking-add-button').disabled"), "selected-mask Add/Subtract ready");
    const opened = async kind => {
        await ready(); await click(button(kind));
        assert.equal(await evaluate("document.querySelector('.masking-create-header strong').textContent"), label(kind));
        assert.equal(await evaluate("document.querySelectorAll('.masking-create-menu').length"), 1, "all three actions reuse one picker");
    };
    const choose = async (kind, type) => {
        await opened(kind);
        await evaluate("(() => {const b=[...document.querySelectorAll('.masking-create-type')].find(b=>b.dataset.maskType===" + JSON.stringify(type) +
            ");b.click();b.click();})()");
    };
    const status = () => evaluate("document.querySelector('.masking-status').textContent");
    await ready();
    for (const [width, height] of [[1280, 900], [768, 1024], [390, 640], [320, 480]]) {
        await setViewport(width, height);
        for (const kind of ["add", "subtract"]) {
            await evaluate("document.querySelector(" + JSON.stringify(button(kind)) + ").scrollIntoView({block:'center'})");
            await new Promise(resolve => setTimeout(resolve, 100));
            await evaluate("window.__componentFrames=[];window.__componentObserve=true;requestAnimationFrame(function sample(){__componentFrames.push([document.scrollingElement.scrollTop,document.querySelector('.masking-component-actions').getBoundingClientRect().top]);if(__componentObserve)requestAnimationFrame(sample)})");
            await opened(kind);
            const p = await evaluate("(() => {const r=document.querySelector('.masking-create-close').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
            await touch("touchStart", p.x, p.y); await touch("touchEnd", p.x, p.y);
            await waitFor(() => evaluate("document.querySelector('.masking-create-menu').hidden"), "touch dismissal");
            const frames = await evaluate("(__componentObserve=false,__componentFrames)");
            assert.ok(frames.length > 1);
            frames.forEach(frame => frame.forEach((value, i) => assert.ok(Math.abs(value - frames[0][i]) < 1,
                "Add/Subtract picker must retain page geometry at " + width + ": " + JSON.stringify([frames[0], frame]))));
            assert.equal(await evaluate("document.activeElement===document.querySelector(" + JSON.stringify(button(kind)) + ")"), true);
        }
    }
    await choose("add", "aiSelection");
    await waitFor(async () => (await status()).includes("Add Component; component inventory and selection confirmed"), "Add confirmation");
    assert.equal(c.componentCalls.length, 1); assert.equal(c.count, 3);
    await waitFor(() => evaluate("document.querySelector('.masking-component-position').textContent.includes('Component 2 of 2')"), "new SDK component selection");
    for (const [index, count] of [[0, 1], [1, 2]]) {
        const h = "document.querySelectorAll('#historyToolbar button')[" + index + "]";
        await waitFor(() => evaluate("!" + h + ".disabled"), "shared history after component operation");
        await evaluate(h + ".click();" + h + ".click()");
        await waitFor(() => evaluate("document.querySelector('.masking-component-position').textContent.includes('Component " + count + " of " + count + "')"), "component Undo/Redo readback");
        assert.equal(c.count, 3, "component history leaves mask count unchanged");
    }
    await choose("subtract", "brush");
    await waitFor(async () => /Subtract from Mask.*Draw in Lightroom to finish/.test(await status()), "interactive subtract instruction");
    assert.equal(c.componentCalls.length, 2); assert.equal(c.componentCount, 3);
    assert.doesNotMatch(await status(), /confirmed/, "an interactive entry cannot prove drawing finished");
    await choose("subtract", "aiSelection");
    await waitFor(async () => (await status()).includes("Subtract from Mask; component inventory and selection confirmed"), "Subtract confirmation");
    assert.equal(c.componentCalls.length, 3);

    // A picker opened for one mask must close when native selection changes, even on the same photo.
    await opened("add"); c.count = 2; fixture.revision += 1;
    await waitFor(() => evaluate("document.querySelector('.masking-create-menu').hidden"), "mask-bound picker cancellation");
    await click(".masking-create-type"); assert.equal(c.componentCalls.length, 3);
    assert.doesNotMatch(await status(), /confirmed|requested/, "old component status belongs to the original mask");
    await opened("subtract"); await key("Escape");
    assert.equal(await evaluate("document.activeElement===document.querySelector('.masking-subtract-button')"), true);
    c.selectionUnavailable = true; fixture.revision += 1;
    await waitFor(() => evaluate("document.querySelector('.masking-add-button').disabled&&document.querySelector('.masking-subtract-button').disabled"), "missing mask disables Add/Subtract");
    c.selectionUnavailable = false; c.count = 0; fixture.revision += 1;
    await waitFor(() => evaluate("document.querySelector('.masking-position').textContent==='No masks available.'"), "empty inventory");
    assert.equal(await evaluate("document.querySelector('.masking-add-button').disabled&&document.querySelector('.masking-subtract-button').disabled&&!document.querySelector('.masking-create-button').disabled"), true);

    c.count = 2; fixture.revision += 1;
    await opened("add");
    fixture.context.selectedPhotoUuid = fixture.context.selectedPhotoKey = "components-photo-b";
    fixture.context.contextCounter += 1; fixture.revision += 1; c.last = null;
    await waitFor(() => evaluate("document.querySelector('.masking-create-menu').hidden"), "photo-bound picker cancellation");
    await click(".masking-create-type"); assert.equal(c.componentCalls.length, 3);
    c.holdComponent = true; await choose("add", "aiSelection");
    await waitFor(() => Boolean(c.releaseComponent), "held component admission");
    const oldState = { ...c.lastState, revision: fixture.revision + 2, pendingOperation: null,
        lastResult: { operationId: c.pending.operationId, outcome: "confirmed" } };
    fixture.context.selectedPhotoUuid = fixture.context.selectedPhotoKey = "components-photo-c";
    fixture.context.contextCounter += 1; fixture.revision += 1; c.pending = c.last = null;
    const reads = fixture.contextReads;
    await waitFor(() => fixture.contextReads > reads + 1, "new photo while admission in flight");
    c.releaseComponent(); await ready();
    c.staleFeedback = oldState;
    await waitFor(() => c.staleFeedback === null, "late old-photo component result consumed");
    assert.doesNotMatch(await status(), /confirmed/);
    assert.equal(c.componentCalls.length, 4, "no automatic retries or duplicated operations");
    c.holdComponent = false;
    return { sharedPicker: true, titles: true, touchPagePosition: true, authoritativeSelection: true,
        interactive: true, history: true, duplicateGuard: true, maskCancellation: true, photoCancellation: true, staleReply: true };
}
module.exports = { verify };
