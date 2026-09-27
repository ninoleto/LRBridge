"use strict";
const assert = require("node:assert/strict");
function install(fixture) {
    const c = fixture.clipboard = { calls: [], reads: 0, revision: 1, epoch: "clipboard-fixture", available: true, token: "selection-a",
        count: 2, capturedCount: 0, pending: null, last: null, hold: false, ambiguous: false, review: false, stale: null,
        copySupported: true, pasteSupported: true, failRead: false, failReview: false };
    c.state = () => ({ ok: true, ...fixture.context, serverEpoch: c.epoch, revision: c.revision, capturedAt: Date.now(), ageMs: 0,
        available: c.available, selectionToken: c.available ? c.token : null, selectionCount: c.available ? c.count : 0,
        copySupported: c.copySupported, pasteSupported: c.pasteSupported, pendingOperation: c.pending, lastResult: c.last, needsReview: c.review });
    c.finish = (outcome = "success", detail, result = {}) => {
        if (!c.pending) return;
        const paste = c.pending.command === "clipboard.paste", invoked = outcome !== "stale";
        c.last = { ...c.pending, operationId: "cb-" + c.calls.length, outcome, invoked: outcome !== "stale",
            targetCount: paste ? c.capturedCount : 1, sdkResult: outcome === "success" ? true : null,
            aiPendingCount: paste && invoked ? 1 : null, aiCheckedCount: paste && invoked ? c.capturedCount : 0,
            detail: detail || (outcome === "success" ? c.pending.command === "clipboard.copy" ? "Lightroom reported settings copied from the captured active photo." :
                "Lightroom reported paste executed for at least one of 2 captured photos; success for every photo is not confirmed. AI updates still needed for 1 of 2 photos checked." :
                "Copy/paste was not confirmed by Lightroom. Check Lightroom; no retry was sent."), ...result };
        c.pending = null; c.review = outcome === "uncertain"; c.revision++;
    };
    const previous = fixture.handle;
    fixture.handle = (url, reply) => {
        if (url.pathname === "/api/clipboard/state") {
            c.reads++; reply(c.failRead ? { ok: false } : c.stale || c.state()); c.stale = null; return true;
        }
        if (url.pathname === "/api/clipboard/action") {
            assert.equal(c.pending, null); assert.equal(c.review, false);
            assert.equal(url.searchParams.get("selectionToken"), c.token);
            assert.equal(url.searchParams.get("stateRevision"), String(c.revision));
            assert.equal(url.searchParams.get("selectedPhotoUuid"), fixture.context.selectedPhotoUuid);
            c.pending = { requestId: url.searchParams.get("requestId"), command: url.searchParams.get("command") };
            c.capturedCount = c.count;
            assert.ok(!c.calls.some(call => call.requestId === c.pending.requestId));
            c.calls.push(c.pending); c.revision++;
            if (c.ambiguous) { c.ambiguous = false; reply({ ok: false }); } else reply(c.state());
            if (!c.hold) setTimeout(() => c.finish(), 120);
            return true;
        }
        if (url.pathname === "/api/clipboard/acknowledge") {
            assert.equal(c.review, true); assert.equal(url.searchParams.get("operationId"), c.last.operationId);
            if (c.failReview) { reply({ ok: false }); return true; }
            c.review = false; c.revision++; reply(c.state()); return true;
        }
        return previous(url, reply);
    };
}
async function verify({ evaluate, waitFor, fixture, setViewport, selectTab }) {
    const c = fixture.clipboard;
    const button = name => "document.getElementById('" + name + "SettingsButton')";
    const click = name => evaluate(button(name) + ".click()");
    const ready = () => waitFor(() => evaluate(button("paste") + ".getAttribute('aria-disabled')==='false'"), "Paste ready without preceding web Copy");
    const text = () => evaluate("document.getElementById('clipboardStatus').textContent");
    const polls = async () => { const n = c.reads; await waitFor(() => c.reads >= n + 2, "Clipboard state polls"); };
    await selectTab("selection"); await ready();
    assert.equal(await evaluate("document.getElementById('clipboardCopyHelp').textContent"), "Quick Copy Settings: Copies the current photo’s settings using those choices, without opening the dialog.");
    assert.match(await evaluate("document.getElementById('clipboardPasteHelp').textContent"), /Select the destination photos, then click this button to apply the copied settings/);
    assert.equal(await evaluate("document.querySelector('#clipboardSelectionCount, #clipboardScopeHelp, .clipboard-details, #clipboardSummary')"), null);
    assert.match(await evaluate(button("copy") + ".getAttribute('aria-describedby')"), /clipboardCopyHelp/);
    assert.equal(await evaluate(button("paste") + ".getAttribute('aria-describedby')"), "clipboardPasteHelp");
    await evaluate("window.clipboardOriginalButton = document.getElementById('pasteSettingsButton')");
    for (const tab of ["sliders", "color-grading", "tone-curve", "presets", "selection", "tools", "application"]) {
        await selectTab(tab);
        if (tab === "selection") {
            await ready(); assert.equal(await evaluate("document.getElementById('pasteSettingsButton') === window.clipboardOriginalButton"), true, "persistent section elements");
        } else assert.equal(await evaluate("!!document.getElementById('clipboardSection')"), false, "Copy/Paste explanations only in Selection");
    }
    await selectTab("sliders");
    for (const width of [1280, 768, 390, 320]) {
        await setViewport(width, 900);
        const boxes = await evaluate("Array.from(document.querySelectorAll('#historyToolbar button:not([hidden])'),b=>{const r=b.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height,width:b.clientWidth,scroll:b.scrollWidth,text:b.textContent}})");
        assert.equal(boxes.length, 3);
        assert.deepEqual(boxes.map(b => b.text), ["Undo", "Redo", "Customize"]);
        assert.equal(boxes[0].top, boxes[1].top); assert.equal(boxes[1].top, boxes[2].top);
        for (const b of boxes) { assert.ok(b.height >= 44); assert.ok(b.right <= width); assert.ok(b.left >= 0); assert.ok(b.scroll <= b.width); }
        await waitFor(() => evaluate("!!document.querySelector('.slider-jump-control')"), "jump navigation");
        assert.equal(await evaluate("parseFloat(getComputedStyle(document.querySelector('.slider-jump-control')).top) === document.getElementById('historyToolbar').getBoundingClientRect().height"), true, "navigation follows toolbar height");
    }
    await selectTab("selection"); await ready();
    await evaluate("window.scrollTo(0, 0); document.getElementById('copySettingsButton').focus({preventScroll:true})");
    const scroll = await evaluate("window.scrollY"); await polls();
    assert.equal(await evaluate("document.activeElement.id"), "copySettingsButton"); assert.equal(await evaluate("window.scrollY"), scroll);
    // First action is Paste, exercising a clipboard prepared outside the web controller.
    await evaluate("document.getElementById('pasteSettingsButton').focus({preventScroll:true})");
    const geometry = () => evaluate("[window.scrollY,document.getElementById('historyToolbar').getBoundingClientRect().height]");
    const beforeAction = await geometry();
    c.hold = true; await click("paste"); await waitFor(() => c.pending, "Paste admission");
    assert.equal(await text(), "Waiting for Lightroom…", "Admission cannot report success");
    assert.equal(await evaluate("document.activeElement.id"), "pasteSettingsButton", "pending action retains keyboard focus");
    assert.deepEqual(await geometry(), beforeAction, "pending feedback preserves scrolling and layout");
    await click("copy"); await click("paste"); assert.equal(c.calls.length, 1);
    assert.equal(await evaluate("Array.from(document.querySelectorAll('[data-favorite-action]')).every(b=>b.getAttribute('aria-disabled')==='true')"), true);
    const stale = c.state(); fixture.context.developCounter++; c.finish(); await ready();
    assert.equal(await evaluate("document.activeElement.id"), "pasteSettingsButton", "result retains keyboard focus");
    assert.deepEqual(await geometry(), beforeAction, "long result preserves scrolling and layout");
    assert.match(await text(), /at least one of 2/);
    assert.match(await text(), /not confirmed for every photo/);
    assert.match(await text(), /AI edits still need updating on 1 of 2 checked photos/);
    assert.equal(await evaluate("document.getElementById('clipboardStatus').hidden"), false, "Result is visible without opening Details");
    c.stale = stale; await polls(); assert.match(await text(), /at least one of 2/);
    c.token = "selection-b"; c.count = 3; c.revision++; await polls();
    assert.equal(await evaluate("document.querySelector('#clipboardSection').textContent.includes('Paste destination:')"), false);
    await click("copy"); await waitFor(() => c.calls.length === 2, "Copy admission"); c.finish(); await ready();
    assert.match(await text(), /settings were copied/);
    c.ambiguous = true; await click("paste"); await waitFor(() => c.calls.length === 3, "ambiguous admission");
    await polls(); assert.equal(c.calls.length, 3, "transport failure never resends");
    c.finish("uncertain"); await waitFor(() => evaluate("!document.getElementById('clipboardReview').hidden"), "uncertain acknowledgement");
    assert.match(await text(), /has not confirmed/);
    assert.doesNotMatch(await text(), /settings were pasted|reported pasting/);
    assert.deepEqual(await geometry(), beforeAction, "uncertainty controls preserve scrolling and layout");
    await click("paste"); assert.equal(c.calls.length, 3);
    await evaluate("clipboardController.showFeedback()");
    assert.equal(await evaluate("document.activeElement.id"), "clipboardReview", "Feedback navigation still focuses required acknowledgement");
    c.failReview = true;
    await evaluate("document.getElementById('clipboardReview').click()");
    await waitFor(async () => (await text()).includes("Could not record your review"), "Acknowledgement failure remains visible");
    await click("paste"); assert.equal(c.calls.length, 3);
    c.failReview = false;
    await evaluate("document.getElementById('clipboardReview').click()"); await ready();
    c.available = false; c.revision++; await polls(); assert.equal(await evaluate(button("paste") + ".getAttribute('aria-disabled')"), "true");
    c.available = true; c.copySupported = false; c.revision++; await ready(); assert.equal(await evaluate(button("copy") + ".getAttribute('aria-disabled')"), "true");
    c.copySupported = true; c.revision++; await polls();
    const oldEpoch = c.state(); c.epoch = "clipboard-next"; c.revision = 1; c.count = 1; c.last = null; await polls();
    c.stale = oldEpoch; await polls(); assert.equal(await text(), "", "Retired results cannot reappear after restart");
    await ready(); await click("paste"); await waitFor(() => c.calls.length === 4, "new epoch Paste");
    c.finish("success", undefined, { aiPendingCount: 0 }); await ready();
    assert.match(await text(), /settings were pasted/);
    assert.match(await text(), /No AI updates were reported as pending on the 1 checked photo/);
    assert.doesNotMatch(await text(), /processing complete|See Details|Paste destination:/);
    c.failRead = true;
    await waitFor(async () => (await text()).includes("Could not get an update from Lightroom"), "Read error replaces previous success");
    assert.equal(await evaluate(button("paste") + ".getAttribute('aria-disabled')"), "true");
    c.failRead = false; await ready();
    await click("paste"); await waitFor(() => c.calls.length === 5, "Paste with unknown AI status");
    c.finish("success", undefined, { aiPendingCount: null, aiCheckedCount: 0 }); await ready();
    assert.match(await text(), /AI processing status is unknown/);
    await click("paste"); await waitFor(() => c.calls.length === 6, "Paste rejected before invocation");
    c.finish("stale"); await ready();
    assert.match(await text(), /did not start/);
    assert.doesNotMatch(await text(), /settings were pasted|reported pasting|SDK|dispatch/);
    return { clipboard: true, persistentToolbar: true, responsiveWidths: [1280, 768, 390, 320], nativeClipboardIndependent: true,
        noAutomaticRetry: true, partialBatchAndAIReporting: true, focusAndScrollPreserved: true };
}
module.exports = { install, verify };
