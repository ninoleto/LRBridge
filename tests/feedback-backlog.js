"use strict";
const assert = require("node:assert/strict");
const commands = require("../server/commands");
const context = require("../server/context");
const { createBridge } = require("../server/bridge");
const sliders = require("../server/sliders");

async function verify() {
    const realNow = Date.now, log = console.log;
    let now = realNow();
    Date.now = () => now;
    console.log = () => {};
    commands.resetQueueForTests();
    // Only an isolated HTTP bridge and simulated SDK replies; never contact the live plug-in/helper.
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1" });
    try {
        await bridge.start();
        const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
        const get = async (path, status = 200) => {
            const response = await fetch(base + path);
            assert.equal(response.status, status, path);
            return response.json();
        };
        const setContext = (photo, revision, module = "develop") => get("/context/update?" + new URLSearchParams({
            activeModule: module, selectedPhotoUuid: photo, selectedPhotoKey: photo, developFingerprint: revision
        }));
        const nextRead = async () => (await get("/feedback/next")).request;
        const drainReads = async () => {
            const requests = [];
            for (let i = 0; i < 200; i++) {
                const request = await nextRead();
                if (!request) return requests;
                requests.push(request);
            }
            assert.fail("Feedback queue did not drain within its bound");
        };
        const result = (id, slider = "Exposure", value = 1.25, status = 200) =>
            get(`/feedback/result?id=${id}&slider=${slider}&value=${value}&min=-150&max=150`, status);

        await setContext("backlog-photo", "before");
        let treatmentId, gradingId, manyId;
        // Nine simulated minutes with browser retries but BOTH SDK consumers paused.
        for (let i = 0; i < 120; i++) {
            const treatment = await get("/treatment/request");
            const grading = await get("/color-grading/request");
            const many = await get("/feedback/request-many?sliders=" + (i % 2 ? "Contrast,Exposure" : "Exposure,Contrast"));
            if (i === 0) {
                treatmentId = treatment.request.id; gradingId = grading.request.id; manyId = many.request.id;
            }
            assert.equal(treatment.request.id, treatmentId, "Queued Treatment retries share one snapshot");
            assert.equal(grading.request.id, gradingId, "Queued Color Grading retries share one snapshot");
            assert.equal(many.request.id, manyId, "Equivalent slider sets share one queued read, regardless of order");
            await get("/clipboard/state"); await get("/export/state");
            assert.equal(commands.getStatus().queueLength, 2, "Expired selection queries cannot accumulate during a pause");
            if (i < 119) now += 4500;
        }
        // Reads use a separate queue; an edit still dispatches once through its existing command path.
        await get("/set?slider=Exposure&value=1.25");
        const editCommands = [];
        for (let c; (c = (await get("/next")).command);) editCommands.push(c);
        assert.deepEqual(editCommands.map(c => c.command), ["clipboard.query", "export.query", "develop.set"]);
        assert.equal(editCommands[2].value, 1.25);
        const exposure = (await get("/feedback/request?slider=Exposure")).request;
        const resumed = await drainReads();
        assert.deepEqual(resumed.map(r => r.id), [treatmentId, gradingId, manyId, exposure.id],
            "Current Exposure needs at most four feedback polls, independent of pause length");
        await result(exposure.id);
        assert.equal((await get("/feedback/value?slider=Exposure")).result.value, 1.25);
        const afterDispatch = (await get("/feedback/request?slider=Exposure")).request;
        assert.notEqual(afterDispatch.id, exposure.id, "A new read must never join a previously dispatched snapshot");
        assert.equal((await nextRead()).id, afterDispatch.id);
        await result(afterDispatch.id, "Exposure", 2);
        await result(exposure.id, "Exposure", -1);
        assert.equal((await get("/feedback/value?slider=Exposure")).result.value, 2, "Late older replies cannot overwrite newer feedback");

        // Undemanded reads expire; a retry after expiration gets a new owner, with no phantom SDK work.
        const expired = (await get("/treatment/request")).request.id;
        const expiredGrading = (await get("/color-grading/request")).request.id;
        const expiredGeneric = (await get("/feedback/request?slider=Contrast")).request.id;
        now += 5001;
        assert.equal(await nextRead(), null);
        await get("/treatment/snapshot?id=" + expired, 404);
        await get("/color-grading/snapshot?id=" + expiredGrading, 404);
        await result(expiredGeneric, "Contrast", 1, 409);
        const retry = (await get("/treatment/request")).request.id;
        assert.notEqual(retry, expired);
        assert.equal((await nextRead()).id, retry);
        await get(`/treatment/result?id=${expired}&status=available&grayscale=true`, 404);
        assert.equal((await get("/treatment/snapshot?id=" + retry)).status, "pending");

        // All reads (including generic sliders and already-dispatched workers) retain context ownership.
        for (const change of ["revision", "photo", "module", "return"]) {
            const t = (await get("/treatment/request")).request.id;
            const g = (await get("/color-grading/request")).request.id;
            const s = (await get("/feedback/request?slider=Exposure")).request.id;
            if (change === "revision") await drainReads();
            if (change === "revision") await setContext("backlog-photo", "after");
            if (change === "photo") await setContext("other-photo", "after");
            if (change === "module") await setContext("other-photo", "after", "library");
            if (change === "return") await setContext("other-photo", "after");
            assert.equal(await nextRead(), null, "Invalid-context reads must not reach the SDK");
            await get(`/treatment/result?id=${t}&status=available&grayscale=true`, 404);
            await get(`/color-grading/view-result?id=${g}&view=3-way`, 404);
            await result(s, "Exposure", 1, 409);
        }

        // Completed and in-flight snapshots stay independent; queue and snapshot storage are bounded.
        const all = (await get("/feedback/request-all")).request;
        assert.equal((await get("/feedback/request-all")).request.id, all.id);
        await drainReads();
        let firstTreatment, firstGrading;
        for (let i = 0; i < 40; i++) {
            const t = (await get("/treatment/request")).request.id;
            const g = (await get("/color-grading/request")).request.id;
            if (i === 0) { firstTreatment = t; firstGrading = g; }
            assert.equal((await nextRead()).id, t); assert.equal((await nextRead()).id, g);
        }
        await get("/treatment/snapshot?id=" + firstTreatment, 404);
        await get("/color-grading/snapshot?id=" + firstGrading, 404);
        assert.equal(await nextRead(), null, "Evicted snapshots leave no orphaned queue entries");
        const first = (await get("/feedback/request?slider=Exposure")).request.id;
        for (const id of sliders.getIds().filter(id => id !== "Exposure").slice(0, 45)) {
            await get("/feedback/request?slider=" + id);
        }
        assert.equal((await drainReads()).length, 32, "Distinct demand also has a hard pending-read bound");
        await result(first, "Exposure", 1, 409);

        // Query cleanup never treats relative edits, native clipboard or Export as disposable reads.
        commands.resetQueueForTests();
        await setContext("order-photo", "order");
        await get("/clipboard/state"); await get("/export/state");
        await get("/adjust?slider=Exposure&amount=1");
        now += 5001;
        await get("/clipboard/state"); await get("/export/state");
        await get("/adjust?slider=Exposure&amount=2");
        const queued = [];
        for (let c; (c = commands.getNextCommand());) queued.push(c);
        assert.deepEqual(queued.map(c => c.command), ["develop.adjust", "clipboard.query", "export.query", "develop.adjust"]);
        assert.deepEqual(queued.filter(c => c.command === "develop.adjust").map(c => c.amount), [1, 2]);
        assert.equal(commands.getNextCommand(), null);

        // Real providers retain full ownership/once-only checks after superseding many read queries.
        now += 5001;
        await get("/clipboard/state");
        const cq = commands.getNextCommand();
        await get("/clipboard/query-result?" + new URLSearchParams({ ...cq, available: true, selectionToken: "selection-one",
            selectionCount: 1, copySupported: true, pasteSupported: true }));
        const clipboard = await get("/clipboard/state");
        const input = Object.fromEntries(require("../server/clipboard-state").clientFields.map(k =>
            [k, k === "requestId" ? "once-after-pause" : k === "stateRevision" ? clipboard.revision : clipboard[k]]));
        await get("/set?slider=Exposure&value=1");
        const action = "/clipboard/action?" + new URLSearchParams({ command: "clipboard.copy", ...input });
        await get(action);
        assert.equal((await get(action)).duplicate, true);
        await get("/set?slider=Exposure&value=2");
        assert.equal(commands.getNextCommand().value, 1);
        const copy = commands.getNextCommand();
        assert.equal(copy.command, "clipboard.copy");
        assert.equal(commands.tryEnqueueCommand(copy).accepted, false);
        assert.equal(commands.getNextCommand().value, 2);
        assert.equal(commands.getNextCommand(), null);
        const claim = "/clipboard/claim?" + new URLSearchParams(copy);
        assert.equal((await get(claim)).valid, true);
        assert.equal((await get(claim)).valid, false);
    } finally {
        await bridge.stop();
        commands.resetQueueForTests();
        Date.now = realNow;
        console.log = log;
    }
    console.log("Feedback backlog: pause/retry/resume, expiry, context/late replies, bounded storage, edit order and once-only claims passed.");
}

if (require.main === module) verify().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { verify };
