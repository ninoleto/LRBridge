"use strict";
const assert = require("node:assert/strict");
const { createBridge } = require("../server/bridge");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function verify() {
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1" });
    const log = console.log;
    console.log = () => {};
    const aborters = [];
    try {
        await bridge.start();
        const server = bridge.getHttpServer(), base = "http://127.0.0.1:" + server.address().port;
        let observedWaits = 0;
        server.on("request", request => { if (request.url.includes("&wait=1")) observedWaits += 1; });
        const get = async (route, status = 200) => {
            const response = await fetch(base + route);
            assert.equal(response.status, status, route);
            return response.json();
        };
        const update = fingerprint => get("/context/update?activeModule=develop&selectedPhotoUuid=delivery-photo&developFingerprint=" + fingerprint);
        const read = async () => (await get("/feedback/request?slider=Texture&purpose=reset")).request;
        const dispatch = async id => assert.equal((await get("/feedback/next")).request.id, id);
        const post = (id, status = 200) => get("/feedback/result?id=" + id + "&slider=Texture&value=7&min=-100&max=100", status);
        const pending = id => {
            const abort = new AbortController(); aborters.push(abort);
            const started = observedWaits;
            const state = { done: false, abort, result: null };
            state.promise = fetch(base + "/feedback/snapshot?id=" + id + "&wait=1", { signal: abort.signal })
                .then(async response => ({ status: response.status, body: await response.json() }))
                .catch(error => ({ aborted: abort.signal.aborted, error: error.message }))
                .then(result => { state.done = true; state.result = result; return result; });
            state.registered = (async () => {
                for (let i = 0; observedWaits <= started && i < 100; i++) await sleep(2);
                assert(observedWaits > started, "snapshot waiter reached isolated backend");
                await new Promise(resolve => setImmediate(resolve));
            })();
            return state;
        };
        await update("before");
        const first = await read(); await dispatch(first.id);
        const waiting = pending(first.id); await waiting.registered;
        await sleep(20);
        assert.equal(waiting.done, false, "Hold a pending Reset response until SDK feedback arrives");
        // Captured race: SDK result completes, then the very next context report
        // invalidates it before a browser's next 50ms snapshot poll can see it.
        await post(first.id);
        await update("after");
        const delivered = await waiting.promise;
        assert.equal(delivered.status, 200);
        assert.equal(delivered.body.snapshot.complete, true);
        assert.equal(delivered.body.snapshot.results.Texture.value, 7);
        await get("/feedback/snapshot?id=" + first.id, 404);
        assert(delivered.body.snapshot.context.developCounter < (await get("/context")).developCounter,
            "Delivered result keeps its original dispatch revision; no rebinding after completion");

        const invalid = await read(); await dispatch(invalid.id);
        const staleWait = pending(invalid.id); await staleWait.registered;
        await update("invalid-before-result");
        assert.equal((await staleWait.promise).status, 404, "Invalidation must promptly wake a waiter without a stale value");
        await post(invalid.id, 409);

        const ordinary = (await get("/feedback/request?slider=Clarity")).request;
        const ordinaryStart = Date.now();
        assert.equal((await get("/feedback/snapshot?id=" + ordinary.id + "&wait=1")).snapshot.complete, false);
        assert(Date.now() - ordinaryStart < 500, "Ordinary feedback readers remain immediate even with wait requested");
        await dispatch(ordinary.id);

        const idle = await read(); await dispatch(idle.id);
        const bounded = pending(idle.id), began = Date.now(); await bounded.registered;
        const timeout = await bounded.promise;
        assert.equal(timeout.status, 200);
        assert.equal(timeout.body.snapshot.complete, false);
        assert(Date.now() - began >= 800 && Date.now() - began < 1600, "Each HTTP wait is bounded to about one second");

        // At most four waiting responses per read. Closing them must release all
        // slots; read demand and edit queues are unaffected by socket lifetimes.
        const sameRead = await read(); await dispatch(sameRead.id);
        const crowded = Array.from({ length: 8 }, () => pending(sameRead.id));
        await Promise.all(crowded.map(item => item.registered)); await sleep(40);
        assert.equal(crowded.filter(item => item.done).length, 4, "Per-read response waiters are bounded");
        crowded.forEach(item => item.abort.abort()); await Promise.all(crowded.map(item => item.promise)); await sleep(30);
        const again = Array.from({ length: 4 }, () => pending(sameRead.id));
        await Promise.all(again.map(item => item.registered)); await sleep(30);
        assert(again.every(item => !item.done), "Disconnected waiters release their slots");
        await post(sameRead.id);
        assert((await Promise.all(again.map(item => item.promise))).every(result => result.body.snapshot.complete));

        const sharedWaiters = [];
        for (let i = 0; i < 17; i++) {
            const shared = await read(); await dispatch(shared.id);
            const group = Array.from({ length: 4 }, () => pending(shared.id));
            sharedWaiters.push(...group);
            await Promise.all(group.map(item => item.registered));
        }
        await sleep(40);
        assert.equal(sharedWaiters.filter(item => !item.done).length, 64, "Total waiting responses across clients are bounded");
        await update("release-shared-waiters");
        const released = await Promise.all(sharedWaiters.map(item => item.promise));
        assert.equal(released.filter(result => result.status === 404).length, 64, "Context invalidation releases every pending response");

        const shutdownRead = await read(); await dispatch(shutdownRead.id);
        const shutdownWait = pending(shutdownRead.id); await shutdownWait.registered;
        await bridge.stop();
        assert.equal((await shutdownWait.promise).status, 503, "Shutdown promptly releases pending HTTP waits");
    } finally {
        aborters.forEach(abort => abort.abort());
        await bridge.stop();
        console.log = log;
    }
    console.log("Reset delivery: immediate SDK-result response, next-context race, invalidation, timeout, disconnect limits and shutdown passed (isolated).");
}
if (require.main === module) verify().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { verify };
