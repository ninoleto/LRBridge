"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { cases, FIELDS, assertContext, splitPlan, createCollector } = require("../scripts/capture-parametric-reference");
const freshContext = () => ({ activeModule: "develop", selectedPhotoUuid: "disposable", contextCounter: 3,
    contextChangedAt: 100, developCounter: 4, lastHeartbeatAt: Date.now() });
assert.doesNotThrow(() => assertContext(freshContext(), freshContext()));
for (const change of [{ activeModule: "library" }, { selectedPhotoUuid: "other" }, { contextCounter: 5 }, { contextChangedAt: 101 }, { lastHeartbeatAt: 0 }])
    assert.throws(() => assertContext({ ...freshContext(), ...change }, freshContext()));
for (const start of [[25, 50, 75], [10, 20, 30], [70, 80, 90], [10, 80, 90]]) for (const end of cases.map(c => c.splits)) {
    const current = start.slice();
    for (const edit of splitPlan(start, end)) {
        current[FIELDS.indexOf(edit.field) - 4] = edit.value;
        assert(current[0] >= 10 && current[2] <= 90 && current[1] - current[0] >= 10 && current[2] - current[1] >= 10);
    }
    assert.deepEqual(current, end);
}
(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lrbridge-parametric-reference-test-"));
    let calls = [], changedPhoto = false, failWrite = false;
    const values = { ...cases[0].values }, points = cases[0].rgb.slice();
    const fetchImpl = async url => {
        const u = new URL(url); calls.push(u.pathname);
        const context = freshContext(); if (changedPhoto) context.selectedPhotoUuid = "other";
        let data;
        if (u.pathname === "/context") data = context;
        else if (u.pathname === "/feedback/request-many") data = { request: { id: 1 } };
        else if (u.pathname === "/feedback/snapshot") data = { snapshot: { complete: true, context,
            results: Object.fromEntries(FIELDS.map(f => [f, { available: true, value: values[f] }])) } };
        else if (u.pathname === "/tone-curve/state") data = { pointCurve: { ...context, available: true, curves: { rgb: points } } };
        else if (u.pathname === "/set") { if (failWrite) throw Error("Uncertain transport response"); values[u.searchParams.get("slider")] = Number(u.searchParams.get("value")); data = { ok: true }; }
        else throw Error("Unexpected operation " + u.pathname);
        return { ok: true, status: 200, json: async () => data };
    };
    const collector = createCollector({ directory, fetchImpl });
    assert.equal(calls.length, 0, "Starting collector must not read or edit Lightroom");
    await assert.rejects(collector.apply()); await assert.rejects(collector.arm("missing-consent"));
    await collector.arm("one-disposable-photo");
    assert(!calls.includes("/set"), "Arming only reads; no edit before explicit Apply");
    changedPhoto = true;
    await assert.rejects(collector.apply(), /context changed/);
    assert.equal(collector.state().stopped, true); assert(!calls.includes("/set"));

    changedPhoto = false; calls = []; values.ParametricShadows = 10;
    const second = createCollector({ directory, fetchImpl });
    await second.arm("one-disposable-photo"); failWrite = true;
    await assert.rejects(second.apply(), /Uncertain transport/);
    assert.equal(calls.filter(x => x === "/set").length, 1, "Never retry an uncertain edit");
    await assert.rejects(second.apply());
    assert.equal(calls.filter(x => x === "/set").length, 1, "Stopped session cannot repeat the case");

    const successfulDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "lrbridge-parametric-six-cases-"));
    let revision = 10, rgbPoints = [0, 0, 255, 255], reads = 0, discardOneRead = false;
    const nativeValues = { ...cases[0].values }, writes = [];
    const fetchSuccess = async url => {
        const u = new URL(url), ctx = { ...freshContext(), developCounter: revision };
        let data;
        if (u.pathname === "/context") data = ctx;
        else if (u.pathname === "/feedback/request-many") data = { request: { id: ++reads } };
        else if (u.pathname === "/feedback/snapshot") {
            if (discardOneRead) { discardOneRead = false; return { ok: false, status: 404, json: async () => ({ error: "Read discarded after revision change" }) }; }
            data = { snapshot: { complete: true, context: ctx, results: Object.fromEntries(FIELDS.map(f => [f, { available: true, value: nativeValues[f] }])) } };
        } else if (u.pathname === "/tone-curve/state") data = { pointCurve: { ...ctx, available: true, curves: { rgb: rgbPoints } } };
        else if (u.pathname.startsWith("/tone-curve/gesture/")) {
            assert.equal(u.searchParams.get("selectedPhotoUuid"), ctx.selectedPhotoUuid);
            assert.equal(Number(u.searchParams.get("developCounter")), revision);
            assert.equal(u.searchParams.get("baseline"), rgbPoints.join(","));
            if (u.pathname.endsWith("/end")) { rgbPoints = u.searchParams.get("points").split(",").map(Number); revision++; writes.push(["rgb", rgbPoints]); }
            data = { ok: true };
        } else if (u.pathname === "/set") {
            const field = u.searchParams.get("slider"), value = Number(u.searchParams.get("value"));
            nativeValues[field] = value; writes.push([field, value]); revision++; discardOneRead = true; data = { ok: true };
        } else throw Error("Unexpected operation " + u.pathname);
        return { ok: true, status: 200, json: async () => data };
    };
    const successful = createCollector({ directory: successfulDirectory, fetchImpl: fetchSuccess });
    await successful.arm("one-disposable-photo");
    for (const testCase of cases) {
        await successful.apply();
        assert.deepEqual(nativeValues, testCase.values); assert.deepEqual(rgbPoints, testCase.rgb);
        assert.equal(successful.state().ready.id, testCase.id);
        const count = writes.length;
        // Fixture bytes only; this test never claims a native image reference.
        await successful.saveImage(Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]));
        assert.equal(writes.length, count, "Image preservation never dispatches the next case");
        const saved = JSON.parse(fs.readFileSync(path.join(successfulDirectory, testCase.id + ".json")));
        assert.deepEqual(saved.confirmed.values, testCase.values);
        assert.deepEqual(saved.capturedAfter.pointCurve.curves.rgb, testCase.rgb);
    }
    assert.equal(successful.state().completed.length, 6);
    console.log("PASS reference-tool guards: explicit arming/apply, legal split ordering, photo/module/context/stale-heartbeat checks, stop on context change, no uncertain edit retry. In-memory HTTP only.");
    console.log("PASS all six case applications, bound RGB gesture requests, confirmed values/image association, discarded read reacquisition without edit retry, no automatic case advance. Synthetic SDK/PNG fixtures only.");
})().catch(e => { console.error(e); process.exitCode = 1; });
