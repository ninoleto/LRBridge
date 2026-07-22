const assert = require("node:assert/strict");
const WebSocket = require("ws");

const commands = require("../server/commands");
const {
    createBridge,
    HTTP_PORT,
    WS_PORT,
    WS_MAX_PAYLOAD_BYTES
} = require("../server/bridge");

const TEST_MAX_PAYLOAD_BYTES = 256;

function fakeWake() {
    return { startWatcher() {}, stopWatcher() {}, async wakeLightroom() { return { ok: true }; } };
}

function makeBridge(extraOptions) {
    return createBridge(Object.assign({
        httpPort: 0,
        wsPort: 0,
        httpHost: "127.0.0.1",
        wsHost: "127.0.0.1",
        wsMaxPayloadBytes: TEST_MAX_PAYLOAD_BYTES,
        startLightroomWatcher: false,
        lightroomWake: fakeWake(),
        shutdownGraceMs: 40
    }, extraOptions));
}

function drainQueue() {
    const queued = [];
    let command;
    while ((command = commands.getNextCommand()) !== null) queued.push(command);
    return queued;
}

function openSocket(bridge) {
    return new Promise(function (resolve, reject) {
        const socket = new WebSocket("ws://127.0.0.1:" + bridge.getWebSocketServer().address().port);
        socket.once("open", function () { resolve(socket); });
        socket.once("error", reject);
    });
}

function closeSocket(socket) {
    return new Promise(function (resolve) {
        if (socket.readyState === WebSocket.CLOSED) return resolve();
        socket.once("close", resolve);
        socket.close();
    });
}

function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function expectSilence(socket, timeoutMs = 60) {
    return new Promise(function (resolve, reject) {
        const timer = setTimeout(resolve, timeoutMs);
        socket.once("message", function (message) {
            clearTimeout(timer);
            reject(new Error("Unexpected WebSocket frame: " + message));
        });
    });
}

function nextMessage(socket) {
    return new Promise(function (resolve, reject) {
        const timer = setTimeout(function () { reject(new Error("Timed out waiting for WebSocket frame")); }, 500);
        socket.once("message", function (message) {
            clearTimeout(timer);
            resolve(JSON.parse(message.toString()));
        });
    });
}

function sendOversized(socket, payload) {
    return new Promise(function (resolve, reject) {
        let clientError = null;
        const timer = setTimeout(function () {
            socket.terminate();
            reject(new Error("Timed out waiting for oversized WebSocket close"));
        }, 1000);
        socket.on("error", function (err) { clientError = err; });
        socket.once("close", function (code) {
            clearTimeout(timer);
            resolve({ code: code, error: clientError });
        });
        socket.send(payload);
    });
}

function fillOrdinaryQueue() {
    const originalLog = console.log;
    console.log = function () {};
    try {
        while (commands.getStatus().queueLength < commands.ORDINARY_ADMISSION_CEILING) {
            const index = commands.getStatus().queueLength;
            commands.enqueueCommand({ command: "develop.set", slider: "Exposure", value: index });
        }
    } finally {
        console.log = originalLog;
    }
}

function assertDiagnosticsConsistent(diagnostics) {
    const pending = diagnostics.queue.pending;
    const byCommandTotal = Object.values(pending.byCommand).reduce(function (sum, count) { return sum + count; }, 0);
    assert.equal(pending.ordinary + pending.protected, diagnostics.queue.length);
    assert.equal(byCommandTotal, diagnostics.queue.length);
    assert.equal(diagnostics.queue.totalCapacityAvailable, diagnostics.queue.hardCapacity - diagnostics.queue.length);
}

async function testNormalCompatibility(bridge) {
    const socket = await openSocket(bridge);
    const expected = [
        { command: "develop.adjust", slider: "Exposure", amount: 1 },
        { command: "develop.set", slider: "Contrast", value: 2 },
        { command: "develop.get", slider: "Highlights" },
        { command: "develop.reset", slider: "Shadows" },
        { command: "develop.action", action: "setAutoTone" },
        { command: "selection.navigate", direction: "next" },
        { command: "selection.flag", flag: "pick" },
        { command: "selection.rating.set", rating: 5 },
        { command: "selection.rating.adjust", direction: "increase" },
        { command: "selection.label.set", label: "red" },
        { command: "selection.label.toggle", label: "blue" }
    ];
    try {
        for (const command of expected) socket.send(JSON.stringify(command));
        await expectSilence(socket);
        assert.deepEqual(drainQueue(), expected);

        socket.send("not json");
        await delay(25);
        assert.equal(commands.getStatus().queueLength, 0);

        const belowLimitInvalid = "x".repeat(TEST_MAX_PAYLOAD_BYTES - 1);
        socket.send(belowLimitInvalid);
        await delay(25);
        assert.equal(commands.getStatus().queueLength, 0, "below-limit payload must reach validation without queue use");
    } finally {
        await closeSocket(socket);
    }
}

async function testQueueFullFrame(bridge) {
    fillOrdinaryQueue();
    const socket = await openSocket(bridge);
    try {
        const frame = nextMessage(socket);
        socket.send(JSON.stringify({ command: "develop.set", slider: "Contrast", value: 9999 }));
        assert.deepEqual(await frame, {
            type: "error",
            code: "COMMAND_QUEUE_FULL",
            error: "Command queue full",
            queueLength: 896,
            queueLimit: 1024,
            retryable: true
        });
    } finally {
        await closeSocket(socket);
        commands.resetQueueForTests();
    }
}

async function testOversizedClients(bridge) {
    const sentinel = { command: "develop.reset", slider: "Exposure" };
    commands.enqueueCommand(sentinel);
    const before = commands.getQueueDiagnostics();
    const payload = JSON.stringify({
        command: "develop.adjust",
        slider: "Exposure",
        amount: 99,
        padding: "x".repeat(TEST_MAX_PAYLOAD_BYTES)
    });

    for (let index = 0; index < 3; index += 1) {
        const socket = await openSocket(bridge);
        const result = await sendOversized(socket, payload);
        assert.equal(result.code, 1009, "oversized client must close with 1009");
        assert.equal(commands.getStatus().queueLength, 1, "oversized message must not mutate queue length");
    }

    const after = commands.getQueueDiagnostics();
    assert.equal(after.queue.length, before.queue.length);
    assert.equal(after.counters.enqueuedEntries, before.counters.enqueuedEntries);
    assert.equal(after.counters.coalescedCommands, before.counters.coalescedCommands);
    assert.equal(after.counters.dequeuedEntries, before.counters.dequeuedEntries);
    assert.equal(after.counters.queueFullRejections, before.counters.queueFullRejections);
    assertDiagnosticsConsistent(after);

    const fresh = await openSocket(bridge);
    try {
        const valid = { command: "develop.adjust", slider: "Contrast", amount: 2 };
        fresh.send(JSON.stringify(valid));
        await expectSilence(fresh);
        assert.deepEqual(drainQueue(), [sentinel, valid]);
    } finally {
        await closeSocket(fresh);
    }
}

async function testHttpUnchanged(bridge) {
    const port = bridge.getHttpServer().address().port;
    const response = await fetch("http://127.0.0.1:" + port + "/adjust?slider=Exposure&amount=3");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        ok: true,
        queued: { command: "develop.adjust", slider: "Exposure", amount: 3 }
    });
    assert.deepEqual(drainQueue(), [{ command: "develop.adjust", slider: "Exposure", amount: 3 }]);

    const selectionResponse = await fetch(
        "http://127.0.0.1:" + port + "/command?command=selection.rating.set&rating=5"
    );
    assert.equal(selectionResponse.status, 200);
    assert.deepEqual(await selectionResponse.json(), {
        ok: true,
        queued: { command: "selection.rating.set", rating: 5 }
    });
    assert.deepEqual(drainQueue(), [{ command: "selection.rating.set", rating: 5 }]);
}

async function main() {
    assert.equal(WS_MAX_PAYLOAD_BYTES, 65536);
    assert.equal(HTTP_PORT, 17891);
    assert.equal(WS_PORT, 17890);
    assert.throws(function () { createBridge({ wsMaxPayloadBytes: 0 }); }, /positive finite integer/);
    assert.throws(function () { createBridge({ wsMaxPayloadBytes: 1.5 }); }, /positive finite integer/);
    assert.throws(function () { createBridge({ wsMaxPayloadBytes: Infinity }); }, /positive finite integer/);

    commands.resetQueueForTests();
    const defaultLimitBridge = makeBridge({ wsMaxPayloadBytes: undefined });
    try {
        await defaultLimitBridge.start();
        assert.equal(defaultLimitBridge.getWebSocketServer().options.maxPayload, 65536);
    } finally {
        await defaultLimitBridge.stop();
    }

    const bridge = makeBridge();
    try {
        await bridge.start();
        assert.equal(bridge.getWebSocketServer().options.maxPayload, TEST_MAX_PAYLOAD_BYTES);
        assert.equal(bridge.getHttpServer().address().address, "127.0.0.1");
        assert.equal(bridge.getWebSocketServer().address().address, "127.0.0.1");
        await testNormalCompatibility(bridge);
        await testQueueFullFrame(bridge);
        await testOversizedClients(bridge);
        await testHttpUnchanged(bridge);
    } finally {
        await bridge.stop();
        commands.resetQueueForTests();
    }
    assert.equal(bridge.getState(), "stopped");
    assert.equal(bridge.getHttpServer(), null);
    assert.equal(bridge.getWebSocketServer(), null);
    console.log("LRBridge transport limit tests passed.");
}

main().catch(function (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
});
