"use strict";
const assert = require("node:assert/strict");
async function verify({ evaluate, waitFor, fixture, setViewport, touch }) {
    const c = fixture.creation;
    c.componentDeletes = [];
    const selector = ".masking-delete-component-button";
    const status = () => evaluate("document.querySelector('.masking-status').textContent");
    const ready = () => waitFor(() => evaluate("!document.querySelector('" + selector + "').disabled"), "Delete Component available");
    const setup = async (maskCount = 3, ids = ["a", "b", "c"], selected = ids[1] || ids[0]) => {
        c.count = maskCount; c.componentIds = ids; c.componentCount = ids.length; c.componentSelectedId = selected;
        c.pending = c.last = null; fixture.revision += 1;
        await waitFor(() => c.lastState && c.lastState.revision === fixture.revision && c.lastState.selectedMaskToolId === selected, "native fixture selection");
        if (selected) await ready();
    };
    const click = async () => {
        await ready();
        await evaluate("document.querySelector('" + selector + "').click();document.querySelector('" + selector + "').click()");
    };
    const waitConfirmed = () => waitFor(async () => (await status()).includes("Component deleted; inventory and selection confirmed"), "component removal confirmation");
    const history = async (index, maskCount, toolId) => {
        const h = "document.querySelectorAll('#historyToolbar button')[" + index + "]";
        await waitFor(() => evaluate("!" + h + ".disabled"), "component deletion history available");
        await evaluate(h + ".click();" + h + ".click()");
        await waitFor(() => c.lastState && c.lastState.maskGroupCount === maskCount && c.lastState.selectedMaskToolId === toolId, "history inventory readback");
    };
    for (const [width, height] of [[1280, 900], [768, 1024], [390, 640], [320, 480]]) {
        await setup(); await setViewport(width, height);
        assert.deepEqual(await evaluate("[...document.querySelectorAll('.masking-component-actions button')].map(b=>b.textContent)"),
            ["Add", "Subtract", "Delete Component"]);
        assert.deepEqual(await evaluate("[...document.querySelectorAll('.masking-component-actions button')].map(b=>b.getAttribute('aria-label')||b.textContent)"),
            ["Add Component", "Subtract from Mask", "Delete Component"]);
        assert.equal(await evaluate("document.querySelector('" + selector + "').classList.contains('destructive')"), true);
        await evaluate("document.querySelector('" + selector + "').scrollIntoView({block:'center'})");
        await new Promise(resolve => setTimeout(resolve, 100));
        const p = await evaluate("(() => {const r=document.querySelector('" + selector + "').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,height:r.height};})()");
        assert.ok(p.height >= 52);
        await evaluate("window.__deleteComponentFrames=[];window.__deleteComponentObserve=true;requestAnimationFrame(function sample(){__deleteComponentFrames.push([document.scrollingElement.scrollTop,document.querySelector('.masking-component-actions').getBoundingClientRect().top]);if(__deleteComponentObserve)requestAnimationFrame(sample)})");
        const before = c.componentDeletes.length;
        await touch("touchStart", p.x, p.y); await touch("touchEnd", p.x, p.y);
        await evaluate("document.querySelector('" + selector + "').click()");
        await waitConfirmed();
        assert.equal(c.componentDeletes.length, before + 1);
        assert.deepEqual(c.componentIds, ["a", "c"]); assert.equal(c.componentSelectedId, "c"); assert.equal(c.count, 3);
        const frames = await evaluate("(__deleteComponentObserve=false,__deleteComponentFrames)");
        assert.ok(frames.length > 2);
        frames.forEach(frame => frame.forEach((v, i) => assert.ok(Math.abs(v - frames[0][i]) < 1, "deletion page position " + width)));
    }
    const historyBefore = c.historyCommands.length;
    await history(0, 3, "b"); await history(1, 3, "c"); assert.equal(c.historyCommands.length, historyBefore + 2);
    await setup(3, ["last"]); await click();
    await waitFor(async () => (await status()).includes("Component and parent mask deleted"), "native parent removal");
    assert.equal(c.count, 2); await history(0, 3, "last");
    await setup(1, ["only"]); await click();
    await waitFor(async () => (await status()).includes("No masks remain"), "empty photograph after final component");
    assert.equal(await evaluate("document.querySelector('" + selector + "').disabled&&!document.querySelector('.masking-create-button').disabled"), true);
    await history(0, 1, "only");
    c.retainEmptyParent = true; await click();
    await waitFor(async () => (await status()).includes("retained the empty parent mask"), "retained empty parent outcome");
    assert.equal(await evaluate("document.querySelector('.masking-component-position').textContent"), "No components in this mask.");
    assert.equal(await evaluate("document.querySelector('" + selector + "').disabled"), true);
    c.retainEmptyParent = false; await history(0, 1, "only");

    c.componentDeleteSelectionFails = true; await setup(); await click();
    await waitFor(async () => (await status()).includes("Component deleted, but"), "separate removal and selection outcomes");
    const deletionCount = c.componentDeletes.length;
    assert.equal(await evaluate("document.querySelector('" + selector + "').disabled"), true);
    c.componentDeleteSelectionFails = false; c.componentSelectedId = "a"; fixture.revision += 1;
    await ready(); assert.equal(c.componentDeletes.length, deletionCount, "recovery never retries deletion");
    c.wrongComponentResultTarget = true; await setup(); await click();
    await waitFor(async () => (await status()).includes("could not confirm component removal"), "reject mismatched result target");
    c.wrongComponentResultTarget = false;
    for (const changed of ["mask", "component", "photo"]) {
        await setup(); c.holdComponentDelete = true; c.releaseComponentDelete = null;
        await click(); await waitFor(() => Boolean(c.releaseComponentDelete), "held delete admission");
        const target = c.componentDeletes[c.componentDeletes.length - 1];
        const old = { ...c.lastState, revision: fixture.revision + 2, pendingOperation: null,
            lastResult: { operationId: c.pending.operationId, outcome: "confirmed", ...target } };
        if (changed === "photo") {
            fixture.context.selectedPhotoUuid = fixture.context.selectedPhotoKey = "delete-component-new-photo";
            fixture.context.contextCounter += 1; c.pending = c.last = null;
        } else if (changed === "mask") c.count = 2;
        else c.componentSelectedId = "a";
        fixture.revision += 1;
        const reads = fixture.contextReads;
        await waitFor(() => fixture.contextReads > reads + 1, "changed native selection");
        if (changed === "photo") {
            c.releaseComponentDelete(); c.staleFeedback = old;
            await waitFor(() => c.staleFeedback === null, "old-photo result discarded");
            assert.doesNotMatch(await status(), /inventory and selection confirmed/);
        } else {
            c.holdComponentDelete = false; c.componentDeleteOutcome = "stale"; c.releaseComponentDelete();
            await waitFor(async () => (await status()).includes("changed during Delete Component"), "stale target cancellation");
            assert.deepEqual(c.componentIds, ["a", "b", "c"]);
            c.componentDeleteOutcome = null;
        }
        c.holdComponentDelete = false;
    }
    return { touchWidths: [1280, 768, 390, 320], pagePosition: true, ordinary: true, nextComponent: true,
        parentRemoval: true, retainedEmptyParent: true, emptyPhoto: true, history: true, partialSelection: true,
        targetIds: true, duplicateGuard: true, photoMaskComponentCancellation: true };
}
module.exports = { verify };
