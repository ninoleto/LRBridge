"use strict";
const assert = require("node:assert/strict");
const { createBridge } = require("../server/bridge");
const commands = require("../server/commands");
const context = require("../server/context");

async function verify() {
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1" });
    const log = console.log, clock = Date.now;
    let now = clock();
    Date.now = () => now;
    console.log = () => {};
    commands.resetQueueForTests();
    try {
        await bridge.start();
        const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
        const get = async (path, status = 200) => {
            const response = await fetch(base + path);
            assert.equal(response.status, status, path);
            return response.json();
        };
        const update = (revision, photo = "reset-photo", module = "develop") => get("/context/update?" +
            new URLSearchParams({ activeModule: module, selectedPhotoUuid: photo, developFingerprint: String(revision) }));
        const next = async () => (await get("/feedback/next")).request;
        const read = async sliders => (await get("/feedback/request-many?purpose=reset&sliders=" + sliders)).request;
        const post = (id, slider, status = 200) => get(`/feedback/result?id=${id}&slider=${slider}&value=0&min=-100&max=100`, status);

        await update(1);
        // Reproduce live Clarity demand waiting across a Texture revision, then
        // Dehaze demand crossing another revision, ahead of routine SDK reads.
        await get("/reset?slider=Texture");
        await get("/reset?slider=Clarity");
        const clarity = await read("Clarity");
        const ordinary = (await get("/feedback/request?slider=Exposure")).request;
        now += 150;
        await update(2);
        const treatment = (await get("/treatment/request")).request;
        await get("/reset?slider=Dehaze");
        const dehaze = await read("Dehaze");
        now += 350;
        await update(3);
        await get("/feedback/snapshot?id=" + ordinary.id, 404);
        assert.equal((await next())?.id, clarity.id,
            "Undispatched Reset demand must retain FIFO position across same-photo revisions");
        await post(clarity.id, "Clarity");
        const completed = (await get("/feedback/snapshot?id=" + clarity.id)).snapshot;
        assert.equal(completed.context.developCounter, context.getContextFields().developCounter,
            "Result ownership is the full context captured at SDK dispatch");
        assert.equal(completed.context.selectedPhotoUuid, "reset-photo");
        assert.equal(completed.complete, true);
        assert.equal((await next()).id, dehaze.id, "The second pending Reset also survives the same-photo revision");
        await post(dehaze.id, "Dehaze");
        assert.equal(await next(), null);
        await get("/treatment/snapshot?id=" + treatment.id, 404);
        const edits = [];
        for (let command; (command = (await get("/next")).command);) edits.push(command);
        assert.deepEqual(edits.map(command => [command.command, command.slider]),
            [["develop.reset", "Texture"], ["develop.reset", "Clarity"], ["develop.reset", "Dehaze"]],
            "Retain every Reset command, exactly once and in order");

        // Replay the captured read opportunities/revision boundaries with a virtual
        // clock. The old queue removed Clarity and Dehaze before these SDK polls.
        await update("replay-start");
        const replayStart = now, replay = [];
        const at = offset => { now = replayStart + offset; };
        const ordinaryRead = slider => get("/feedback/request?slider=" + slider);
        const publish = async (request, slider, click) => {
            await post(request.id, slider);
            const snapshot = (await get("/feedback/snapshot?id=" + request.id)).snapshot;
            assert.equal(snapshot.context.developCounter, context.getContextFields().developCounter);
            assert.equal(snapshot.results[slider].value, 0);
            replay.push({ slider, clickToResultMs: now - replayStart - click });
        };
        at(20); const textureRead = await read("Texture");
        at(69); assert.equal((await next()).id, textureRead.id);
        at(406); const clarityRead = await read("Clarity");
        at(430); await publish(textureRead, "Texture", 0);
        at(527); await update("replay-texture"); await ordinaryRead("PresetAmount");
        at(706); const dehazeRead = await read("Dehaze");
        at(824); assert.equal((await next()).id, clarityRead.id, "Clarity keeps its read opportunity across the first revision");
        at(940); await publish(clarityRead, "Clarity", 398);
        at(1042); await update("replay-clarity"); await ordinaryRead("PresetAmount");
        at(1173); assert.equal((await next()).id, dehazeRead.id, "Dehaze keeps its read opportunity across the next revision");
        at(1390); await publish(dehazeRead, "Dehaze", 698);
        at(1451); await update("replay-dehaze");
        assert.equal(await next(), null);
        assert(replay.every(row => row.clickToResultMs < 750), "The recorded SDK opportunities suffice without browser read retries");
        log("Captured Reset queue replay (simulated SDK timing): " + JSON.stringify(replay));

        // Once dispatched, revision ownership is immutable. Never rebind a result.
        const dispatched = await read("Clarity,Dehaze");
        assert.equal((await next()).id, dispatched.id);
        await post(dispatched.id, "Clarity");
        await update(4);
        await post(dispatched.id, "Dehaze", 409);
        await get("/feedback/snapshot?id=" + dispatched.id, 404);

        // Sharing is limited to compatible, undispatched demand; ordinary readers
        // cannot accidentally opt into this context-following Reset behavior.
        const a = await read("Clarity,Dehaze");
        assert.equal((await read("Dehaze,Clarity")).id, a.id);
        const fixed = (await get("/feedback/request-many?sliders=Clarity,Dehaze")).request;
        assert.notEqual(fixed.id, a.id);
        await post(a.id, "Clarity", 409); // no SDK dispatch has happened
        await update(5);
        assert.equal((await next()).id, a.id);
        assert.equal(await next(), null);
        await post(a.id, "Clarity"); await post(a.id, "Dehaze");

        for (const boundary of ["photo", "module", "epoch", "uuid"]) {
            await update("before-" + boundary);
            const pending = await read("Clarity");
            if (boundary === "photo") await update("after", "other-photo");
            if (boundary === "module") await update("after", "reset-photo", "library");
            if (boundary === "epoch") {
                now += 1;
                await update("after", "reset-photo", "library");
                await update("after", "reset-photo", "develop");
            }
            if (boundary === "uuid") await get("/context/update?activeModule=develop&selectedPhotoKey=reset-photo&developFingerprint=after");
            assert.equal(await next(), null, "Pending Reset must not follow a " + boundary + " boundary");
            await get("/feedback/snapshot?id=" + pending.id, 404);
        }
        await update("expiry");
        const expired = await read("Texture");
        now += 5001;
        await update("expiry-next");
        assert.equal(await next(), null, "Revision changes must not renew the five-second demand lifetime");
        await post(expired.id, "Texture", 409);
    } finally {
        await bridge.stop();
        commands.resetQueueForTests();
        Date.now = clock;
        console.log = log;
    }
    console.log("Reset feedback queue: pending revision changes, fixed dispatch ownership, FIFO, expiry, navigation, and all edit actions passed (isolated).");
}
if (require.main === module) verify().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { verify };
