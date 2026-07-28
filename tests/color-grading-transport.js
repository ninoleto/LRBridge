const assert = require("node:assert/strict");
const commands = require("../server/commands");
const { createBridge } = require("../server/bridge");
(async function () {
    commands.resetQueueForTests();
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1" });
    await bridge.start(); const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
    try {
        let response = await fetch(base + "/command?command=color_grading.wheel.set&region=shadows&hue=220&saturation=35"); assert.equal(response.status, 200); let body = await response.json(); assert.deepEqual(body.queued, {command:"color_grading.wheel.set",region:"shadows",hue:220,saturation:35});
        response = await fetch(base + "/next"); body = await response.json(); assert.deepEqual(body.command, {command:"color_grading.wheel.set",region:"shadows",hue:220,saturation:35});
        response = await fetch(base + "/command?command=color_grading.value.set&control=balance&value=-12.5"); assert.equal(response.status, 200); response = await fetch(base + "/next"); body = await response.json(); assert.deepEqual(body.command, {command:"color_grading.value.set",control:"balance",value:-12.5});
        for (const path of ["/command?command=color_grading.wheel.set&region=shadows&hue=1&hue=2&saturation=3","/command?command=color_grading.wheel.set&region=shadows&hue=%201&saturation=3","/command?command=color_grading.value.set&control=balance&value=Infinity","/command?command=color_grading.view.set&view=global&extra=1"]) { response = await fetch(base + path); assert.equal(response.status, 400, path); }
        response = await fetch(base + "/color-grading/request"); body = await response.json(); response = await fetch(base + "/feedback/next"); const pending = await response.json(); assert.equal(pending.request.colorGrading, true); assert.equal(pending.request.id, body.request.id);
        response = await fetch(base + "/color-grading/snapshot?id=" + body.request.id); let snapshot = await response.json(); assert.equal(snapshot.snapshot.complete, false); assert.deepEqual(snapshot.snapshot.parameters, {}); assert.equal(snapshot.snapshot.view, null);
        const ids = require("../server/color-grading").getParameterIds();
        for (const parameter of ids) { response = await fetch(base + "/color-grading/result?id=" + body.request.id + "&parameter=" + encodeURIComponent(parameter) + "&value=1&min=0&max=10"); assert.equal(response.status, 200); }
        response = await fetch(base + "/color-grading/view-result?id=" + body.request.id + "&view=3-way"); assert.equal(response.status, 200);
        response = await fetch(base + "/color-grading/snapshot?id=" + body.request.id); snapshot = await response.json(); assert.equal(snapshot.snapshot.complete, true); assert.equal(Object.keys(snapshot.snapshot.parameters).length, 14); assert.deepEqual(snapshot.snapshot.view, {available:true,value:"3-way"});
        response = await fetch(base + "/color-grading/request"); const fresh = await response.json(); response = await fetch(base + "/color-grading/snapshot?id=" + fresh.request.id); snapshot = await response.json(); assert.equal(snapshot.snapshot.complete, false); assert.deepEqual(snapshot.snapshot.parameters, {});
    } finally { await bridge.stop(); }
    console.log("Color Grading HTTP-to-queue transport tests passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
