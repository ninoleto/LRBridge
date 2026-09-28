"use strict";
// The capture shows Reset confirmation queued behind obsolete/broad feedback.
const assert = require("node:assert/strict"), { createBridge } = require("../server/bridge");
const commands = require("../server/commands");
async function verify() {
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1" });
    const log = console.log; console.log = () => {}; commands.resetQueueForTests();
    try {
        await bridge.start();
        const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
        const get = async route => { const r = await fetch(base + route); assert.equal(r.status, 200, route); return r.json(); };
        const read = async (slider, purpose = "") => (await get("/feedback/request?slider=" + slider + (purpose ? "&purpose=" + purpose : ""))).request;
        const next = async () => (await get("/feedback/next")).request;
        await get("/context/update?activeModule=develop&selectedPhotoUuid=priority-photo&developFingerprint=before");
        const ordinary = await read("Exposure");
        const edit = await read("Contrast", "edit");
        const reset = await read("Texture", "reset");
        const dispatchedEdit = await next(), dispatchedReset = await next(), dispatchedOrdinary = await next();
        assert.equal(dispatchedEdit.id, edit.id, "latest edit confirmation must get the next SDK read opportunity ahead of background backlog");
        assert.equal(dispatchedReset.id, reset.id, "Reset uses the same priority confirmation path");
        assert.equal(dispatchedOrdinary.id, ordinary.id, "legitimate background feedback remains queued");
        assert.equal(dispatchedEdit.confirmation, true, "SDK may drain another ready confirmation in this cycle");
        assert.equal(dispatchedReset.confirmation, true);
        assert.equal(dispatchedOrdinary.confirmation, undefined, "ordinary feedback yields to other families");
        assert.equal(edit.confirmation, undefined, "the hint is added at SDK dispatch, not command admission");
        const previousSet = await read("Clarity", "edit");
        const laterReset = await read("Clarity", "reset");
        assert.equal(previousSet.id, laterReset.id, "Set-to-Reset shares only still-undispatched compatible SDK read work");
        assert.equal((await next()).id, laterReset.id);
        const many = (await get("/feedback/request-many?sliders=SDRWhites,SDRBlend&purpose=reset")).request;
        const dispatchedMany = await next();
        assert.equal(dispatchedMany.id, many.id);
        assert.equal(dispatchedMany.confirmation, true, "coalesced Reset confirmation snapshots also drain promptly");
        const background = await read("Exposure");
        for (const slider of ["Contrast", "Texture", "Clarity", "Dehaze", "Highlights", "Shadows"]) await read(slider, "edit");
        const order = []; for (let i = 0; i < 7; i++) order.push((await next()).id);
        assert(order.indexOf(background.id) <= 4, "confirmation bursts cannot starve external Lightroom feedback");
        assert.equal(await next(), null);
        assert.equal(commands.getStatus().queueLength, 0, "feedback never creates Lightroom writes");

        const revisionRead = await read("Texture", "edit");
        const revisionBefore = (await get("/context")).developCounter;
        await get("/context/update?activeModule=develop&selectedPhotoUuid=priority-photo&developFingerprint=after");
        assert.equal((await next()).id, revisionRead.id, "only undispatched same-photo demand may follow a revision");
        assert((await get("/feedback/snapshot?id=" + revisionRead.id)).snapshot.context.developCounter > revisionBefore);
        await get("/context/update?activeModule=develop&selectedPhotoUuid=priority-photo&developFingerprint=later");
        assert.equal((await fetch(base + "/feedback/snapshot?id=" + revisionRead.id)).status, 404,
            "a dispatched edit read still expires at a later revision");

        // Companion's existing public routes and admission bodies remain usable
        // without edit tokens. Only the isolated queue is consumed here, not SDK.
        for (const [route, expected] of [
            ["/set?slider=Contrast&value=20", { command: "develop.set", slider: "Contrast", value: 20 }],
            ["/adjust?slider=Contrast&amount=3", { command: "develop.adjust", slider: "Contrast", amount: 3 }],
            ["/reset?slider=Contrast", { command: "develop.reset", slider: "Contrast" }]
        ]) {
            assert.deepEqual(await get(route), { ok: true, queued: expected });
            await read("Contrast", "edit");
            assert.deepEqual((await get("/next")).command, expected, "feedback scheduling cannot reorder writes");
        }
        await get("/set?slider=Contrast&value=65");
        await get("/reset?slider=Contrast");
        assert.equal((await get("/next")).command.command, "develop.reset", "Reset supersedes an undispatched Set");
        assert.equal((await get("/next")).command, null, "no older write can follow that Reset");
        for (const route of ["/set?slider=Contrast&value=bad", "/adjust?slider=SDRBrightness&amount=1", "/reset?slider=MissingSlider"]) {
            assert.equal((await fetch(base + route)).status, 400, "preserve validation: " + route);
        }
        assert.equal(commands.getStatus().queueLength, 0);
    } finally { await bridge.stop(); console.log = log; }
    console.log("Shared confirmation priority passed: Set/Reset, compatible coalescing, bounded fairness, dispatch revision guards, Companion Set/Adjust/Reset compatibility and validation (isolated server; no Lightroom).");
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
