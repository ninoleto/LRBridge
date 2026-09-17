"use strict";
const assert = require("node:assert/strict");
function install(fixture) {
    const r = fixture.redEye = { revision: 1, selectedTool: "loupe", available: true, calls: [], pending: null, last: null,
        reads: 0, hold: false, admissions: [], delayAdmission: false, stale: null, reject: false, epoch: "eye-fixture", ambiguous: false, failState: false };
    r.state = () => structuredClone({ ok: true, ...fixture.context, serverEpoch: r.epoch, revision: r.revision,
        capturedAt: Date.now(), ageMs: 0, available: r.available, selectedTool: r.available ? r.selectedTool : null,
        openSupported: true, closeSupported: true, resetSupported: true, pendingOperation: r.pending, lastResult: r.last });
    r.finish = () => {
        const c = r.pending; if (!c) return;
        const stale = c.photo !== fixture.context.selectedPhotoUuid || c.tool !== r.selectedTool;
        const outcome = stale ? "stale" : c.operationKind === "reset" ? "requested" : "confirmed";
        if (!stale && c.operationKind !== "reset") r.selectedTool = c.operationKind === "close" ? "loupe" : "redeye";
        r.last = { operationId: c.operationId, operationKind: c.operationKind, outcome,
            detail: stale ? "Photo or active tool changed." : outcome === "requested" ? "Reset requested" :
                c.operationKind === "close" ? "Tool closed." : (c.operationKind === "pet_eye" ? "Pet Eye" : "Red Eye") + " mode requested; tool open." };
        r.pending = null; r.revision++;
    };
    const previous = fixture.handle;
    fixture.handle = (url, reply) => {
        if (url.pathname === "/api/red-eye/state") { r.reads++; reply(r.failState ? { ok: false } : r.stale || r.state()); r.stale = null; return true; }
        if (url.pathname === "/api/red-eye/action") {
            if (r.reject) { r.reject = false; reply({ ok: false, error: "Context changed." }); return true; }
            assert.equal(url.searchParams.get("selectedPhotoUuid"), fixture.context.selectedPhotoUuid);
            assert.equal(url.searchParams.get("stateRevision"), String(r.revision));
            assert.equal(r.pending, null, "one command at a time");
            const c = { operationId: "re-" + (r.calls.length + 1), operationKind: url.searchParams.get("operationKind"),
                photo: fixture.context.selectedPhotoUuid, tool: r.selectedTool };
            if (c.operationKind === "close") assert.equal(r.selectedTool, "redeye");
            r.calls.push(c); r.pending = c; r.revision++;
            const admitted = r.state();
            if (r.ambiguous) { r.ambiguous = false; reply({ ok: false }); }
            else if (r.delayAdmission) r.admissions.push(() => reply(admitted)); else reply(admitted);
            if (!r.hold) setTimeout(r.finish, 180);
            return true;
        }
        return previous(url, reply);
    };
}
async function verify({ evaluate, waitFor, fixture, setViewport, selectTab }) {
    const r = fixture.redEye;
    const button = kind => "document.querySelector('[data-red-eye-action=" + kind + "]')";
    const text = () => evaluate("document.querySelector('.red-eye-action-status').textContent");
    const tool = () => evaluate("document.querySelector('.red-eye-tool-status').textContent");
    const click = kind => evaluate(button(kind) + ".click()");
    const ready = () => waitFor(() => evaluate(button("red_eye") + "&&!" + button("red_eye") + ".disabled"), "Red Eye available");
    const polls = async () => { const n = r.reads; await waitFor(() => r.reads >= n + 3, "Red Eye polling"); };
    await ready(); assert.equal(await tool(), "Tool closed");
    assert.equal(await evaluate(button("close") + ".disabled"), true);
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.red-eye-button-row'),r=>Array.from(r.children,b=>b.textContent))"),
        [["Open Red Eye", "Open Pet Eye"], ["Reset Red Eye", "Close"]]);
    for (const width of [1280, 768, 390, 320]) {
        await setViewport(width, 900);
        const geometry = await evaluate("Array.from(document.querySelectorAll('.red-eye-button-row'),r=>Array.from(r.children,b=>{const g=b.getBoundingClientRect();return {top:g.top,left:g.left,right:g.right,height:g.height,scroll:b.scrollWidth,width:b.clientWidth}}))");
        for (const row of geometry) {
            assert.equal(row[0].top, row[1].top); assert.ok(row[0].right < row[1].left);
            for (const b of row) { assert.ok(b.height >= 44); assert.ok(b.right <= width); assert.ok(b.scroll <= b.width); }
        }
    }
    r.hold = true; await click("red_eye"); await waitFor(() => r.pending, "Red Eye admitted");
    assert.equal(await tool(), "Tool closed", "submission does not invent open state");
    assert.equal(await evaluate("Array.from(document.querySelectorAll('#historyToolbar button')).every(b=>b.disabled)"), true);
    await click("pet_eye"); assert.equal(r.calls.length, 1, "pending disables repeat input");
    r.finish(); await ready(); assert.equal(await tool(), "Tool open");
    assert.match(await text(), /mode requested/);
    assert.equal(await evaluate("document.querySelectorAll('.red-eye-controls [aria-pressed],.red-eye-controls [aria-selected]').length"), 0);
    r.hold = false; await click("pet_eye"); await waitFor(async () => !r.pending && (await text()).includes("Pet Eye mode requested"), "Pet Eye explicit request");
    const old = r.state(); await click("close"); await waitFor(async () => !r.pending && await tool() === "Tool closed", "closed feedback");
    r.stale = old; await polls(); assert.equal(await tool(), "Tool closed", "old response cannot reopen tool");
    const oldEpoch = r.state(); r.epoch = "eye-fixture-new"; r.revision = 1; r.selectedTool = "redeye";
    await polls(); assert.equal(await tool(), "Tool open");
    r.stale = oldEpoch; await polls(); assert.equal(await tool(), "Tool open", "retired server epoch cannot replace fresh state");
    r.selectedTool = "redeye"; r.revision++; await polls(); assert.equal(await evaluate(button("close") + ".disabled"), false);
    r.selectedTool = "crop"; r.revision++; await polls(); assert.equal(await evaluate(button("close") + ".disabled"), true);
    const n = r.calls.length; await click("close"); assert.equal(r.calls.length, n);
    r.selectedTool = "redeye"; r.revision++; await polls();
    r.hold = true; await click("close"); await waitFor(() => r.pending, "Close admitted");
    r.selectedTool = "masking"; r.finish(); await ready(); assert.equal(r.selectedTool, "masking"); assert.match(await text(), /changed/);
    r.hold = false; await click("reset"); await waitFor(async () => !r.pending && await text() === "Reset requested", "request-only Reset");
    await polls(); assert.equal(await text(), "Reset requested");
    const beforeAmbiguous = r.state();
    r.ambiguous = true; r.hold = true; await click("reset"); await waitFor(() => r.pending, "ambiguous submission retained by server");
    await polls(); assert.equal(await evaluate("Array.from(document.querySelectorAll('#historyToolbar button')).every(b=>b.disabled)"), true);
    r.failState = true; await waitFor(async () => await tool() === "Tool status unavailable", "failed feedback");
    assert.equal(await evaluate("Array.from(document.querySelectorAll('#historyToolbar button')).every(b=>b.disabled)"), true,
        "unavailable feedback must not release pending operation ownership");
    r.stale = beforeAmbiguous; r.failState = false;
    await waitFor(() => r.stale === null, "old response after feedback failure");
    assert.equal(await evaluate("Array.from(document.querySelectorAll('#historyToolbar button')).every(b=>b.disabled)"), true,
        "an old response cannot release ownership after feedback fails");
    r.finish(); r.hold = false; await ready(); assert.equal(await text(), "Reset requested");
    r.available = false; r.revision++; await polls(); assert.equal(await tool(), "Tool status unavailable");
    assert.equal(await evaluate("Array.from(document.querySelectorAll('.red-eye-controls button')).every(b=>b.disabled)"), true);
    r.available = true; r.revision++; await ready();
    r.reject = true; await click("red_eye"); await waitFor(async () => (await text()).includes("unconfirmed"), "failed admission"); await ready();
    r.delayAdmission = true; r.hold = true; await click("pet_eye"); await waitFor(() => r.admissions.length, "delayed admission");
    fixture.context.selectedPhotoUuid = "new-eye-photo"; fixture.context.contextCounter++; fixture.context.contextChangedAt++;
    r.finish(); r.last = null; r.selectedTool = "crop"; r.revision++;
    await polls(); r.admissions.splice(0).forEach(send => send()); r.delayAdmission = false; r.hold = false;
    await ready(); assert.equal(await tool(), "Tool closed"); assert.doesNotMatch(await text(), /Pet Eye mode requested/);
    const toggle = "document.querySelector('[data-tools-section=red-eye] .collapsible-section-toggle')";
    await evaluate(toggle + ".click()"); assert.equal(await evaluate(toggle + ".getAttribute('aria-expanded')"), "false");
    await evaluate(toggle + ".click()"); assert.equal(await evaluate(toggle + ".getAttribute('aria-expanded')"), "true");
    await selectTab("selection"); await new Promise(resolve => setTimeout(resolve, 400));
    const reads = r.reads; await new Promise(resolve => setTimeout(resolve, 650)); assert.equal(r.reads, reads, "no inactive panel polling");
    await selectTab("tools"); await ready();
    return { redEye: true, widths: [1280, 768, 390, 320], authoritativeToolState: true, resetRequestOnly: true, staleGuards: true };
}
module.exports = { install, verify };
