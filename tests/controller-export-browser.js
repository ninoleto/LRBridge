"use strict";
const assert = require("node:assert/strict");
function install(fixture) {
    const e = fixture.exports = { calls: [], reads: 0, revision: 1, epoch: "export-fixture", available: true, token: "selection-a",
        count: 2, pending: null, last: null, hold: false, ambiguous: false, review: false, stale: null, previousSupported: true };
    e.state = () => ({ ok: true, ...fixture.context, serverEpoch: e.epoch, revision: e.revision, capturedAt: Date.now(), ageMs: 0,
        available: e.available, selectionToken: e.available ? e.token : null, selectionCount: e.available ? e.count : 0,
        dialogSupported: true, previousSupported: e.previousSupported, pendingOperation: e.pending, lastResult: e.last, needsReview: e.review });
    e.finish = (outcome = "requested") => {
        if (!e.pending) return;
        e.last = { ...e.pending, operationId: "ex-" + e.calls.length, outcome,
            detail: outcome === "requested" ? e.pending.command === "export.dialog" ? "Export dialog requested." : "Export with Previous requested." :
                outcome === "stale" ? "Selection changed; export was not requested." : "Export request unconfirmed. Check Lightroom; no retry was sent." };
        e.pending = null; e.review = outcome === "uncertain"; e.revision++;
    };
    const previous = fixture.handle;
    fixture.handle = (url, reply) => {
        if (url.pathname === "/api/export/state") { e.reads++; reply(e.stale || e.state()); e.stale = null; return true; }
        if (url.pathname === "/api/export/action") {
            assert.equal(e.pending, null); assert.equal(e.review, false);
            assert.equal(url.searchParams.get("selectionToken"), e.token);
            assert.equal(url.searchParams.get("stateRevision"), String(e.revision));
            assert.equal(url.searchParams.get("selectedPhotoUuid"), fixture.context.selectedPhotoUuid);
            e.pending = { requestId: url.searchParams.get("requestId"), command: url.searchParams.get("command") };
            assert.ok(!e.calls.some(c => c.requestId === e.pending.requestId));
            e.calls.push(e.pending); e.revision++;
            if (e.ambiguous) { e.ambiguous = false; reply({ ok: false }); } else reply(e.state());
            if (!e.hold) setTimeout(() => e.finish(), 120);
            return true;
        }
        if (url.pathname === "/api/export/acknowledge") {
            assert.equal(e.review, true); assert.equal(url.searchParams.get("operationId"), e.last.operationId);
            e.review = false; e.revision++; reply(e.state()); return true;
        }
        return previous(url, reply);
    };
}
async function verify({ evaluate, waitFor, fixture, setViewport, selectTab }) {
    const e = fixture.exports;
    const button = c => "document.querySelector('[data-export-action=\"export." + c + "\"]')";
    const text = () => evaluate("document.querySelector('.export-status').textContent");
    const click = c => evaluate(button(c) + ".click()");
    const ready = () => waitFor(() => evaluate(button("dialog") + "&&!" + button("dialog") + ".disabled"), "Export ready");
    const polls = async () => { const n = e.reads; await waitFor(() => e.reads >= n + 2, "Export state polling"); };
    await selectTab("selection"); await ready();
    assert.match(await evaluate("document.querySelector('#exportPreviousHelp').textContent"), /last export settings and may start immediately/);
    assert.equal(await evaluate(button("previous") + ".getAttribute('aria-describedby')"), "exportPreviousHelp");
    for (const width of [1280, 768, 390, 320]) {
        await setViewport(width, 900);
        const boxes = await evaluate("Array.from(document.querySelectorAll('.export-button-row button'),b=>{const r=b.getBoundingClientRect();return {top:r.top,left:r.left,right:r.right,height:r.height,width:b.clientWidth,scroll:b.scrollWidth}})");
        assert.equal(boxes[0].top, boxes[1].top); assert.ok(boxes[0].right <= boxes[1].left);
        for (const b of boxes) { assert.ok(b.height >= 44); assert.ok(b.right <= width); assert.ok(b.scroll <= b.width); }
    }
    await evaluate(button("dialog") + ".focus()"); await polls();
    assert.equal(await evaluate("document.activeElement.dataset.exportAction"), "export.dialog", "feedback preserves focus");
    e.hold = true; await click("dialog"); await waitFor(() => e.pending, "Export admission");
    await click("dialog"); await click("previous"); assert.equal(e.calls.length, 1);
    assert.match(await text(), /Waiting/); assert.doesNotMatch(await text(), /completed/i);
    assert.equal(await evaluate("Array.from(document.querySelectorAll('[data-favorite-action]')).every(b=>b.getAttribute('aria-disabled')==='true')"), true);
    const stale = e.state(); e.finish(); await ready(); assert.equal(await text(), "Export dialog requested.");
    e.stale = stale; await polls(); assert.equal(await text(), "Export dialog requested.");
    e.token = "selection-b"; e.count = 3; e.revision++; await polls();
    assert.match(await evaluate("document.querySelector('.export-selection').textContent"), /^3 photos/);
    await click("previous"); await waitFor(() => e.calls.length === 2, "Previous admission"); e.finish("stale"); await ready();
    assert.match(await text(), /Selection changed/);
    e.ambiguous = true; await click("previous"); await waitFor(() => e.calls.length === 3, "ambiguous admission");
    await polls(); assert.equal(e.calls.length, 3, "transport failure never repeats action");
    e.finish("uncertain"); await waitFor(() => evaluate("!document.querySelector('.export-review').hidden"), "uncertain review");
    assert.equal(await evaluate(button("previous") + ".disabled"), true);
    await click("previous"); assert.equal(e.calls.length, 3);
    await evaluate("document.querySelector('.export-review').click()"); await ready();
    e.hold = false; await click("previous"); await waitFor(async () => (await text()) === "Export with Previous requested.", "Previous requested feedback");
    assert.equal(e.calls.length, 4);
    e.available = false; e.revision++; await polls(); assert.equal(await evaluate(button("dialog") + ".disabled"), true);
    e.available = true; e.previousSupported = false; e.revision++; await ready(); assert.equal(await evaluate(button("previous") + ".disabled"), true);
    e.previousSupported = true; e.revision++; await polls();
    const oldEpoch = e.state(); e.epoch = "export-fixture-next"; e.revision = 1; e.count = 1; await polls();
    e.stale = oldEpoch; await polls(); assert.match(await evaluate("document.querySelector('.export-selection').textContent"), /^1 photo/);
    fixture.context.selectedPhotoUuid = "new-export-photo"; fixture.context.contextCounter++; fixture.context.contextChangedAt++; e.token = "selection-c"; e.revision++;
    await polls(); await ready();
    await selectTab("application"); await new Promise(resolve => setTimeout(resolve, 600));
    const n = e.reads; await new Promise(resolve => setTimeout(resolve, 1100)); assert.equal(e.reads, n, "no inactive Export polling");
    await selectTab("selection"); await ready();
    return { exports: true, responsiveWidths: [1280, 768, 390, 320], singleDispatch: true, noAutomaticRetry: true, requestOnlyFeedback: true };
}
module.exports = { install, verify };
