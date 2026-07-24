const assert = require("node:assert/strict");
const WebSocket = require("ws");

const commands = require("../server/commands");
const sliders = require("../server/sliders");
const { createBridge } = require("../server/bridge");

const ordinary = (index) => ({
    command: "develop.set",
    slider: index % 2 === 0 ? "Exposure" : "Contrast",
    value: index
});
const reset = (index) => ({
    command: "develop.reset",
    slider: sliders.getIds()[index % sliders.getIds().length]
});

function emptyDiagnostics() {
    return {
        ok: true,
        scope: "process",
        queue: {
            length: 0,
            ordinaryAdmissionCeiling: 896,
            protectedReserve: 128,
            hardCapacity: 1024,
            ordinaryCapacityAvailable: 896,
            protectedReserveAvailable: 128,
            totalCapacityAvailable: 1024,
            ordinarySaturated: false,
            hardSaturated: false,
            highWaterMark: 0,
            oldestCommandAgeMs: null,
            pending: {
                ordinary: 0,
                protected: 0,
                byCommand: {
                    "develop.adjust": 0,
                    "develop.set": 0,
                    "develop.get": 0,
                    "develop.reset": 0,
                    "develop.action": 0,
                    "selection.navigate": 0,
                    "selection.flag": 0,
                    "selection.rating.set": 0,
                    "selection.rating.adjust": 0,
                    "selection.label.set": 0,
                    "selection.label.toggle": 0,
                    "selection.operation": 0,
                    "application.module": 0,
                    "application.view": 0,
                    "application.action": 0,
                    "application.secondary_view": 0
                }
            }
        },
        counters: {
            enqueuedEntries: 0,
            coalescedCommands: 0,
            dequeuedEntries: 0,
            queueFullRejections: 0
        },
        timestamps: {
            lastEnqueuedAt: null,
            lastCoalescedAt: null,
            lastDequeuedAt: null,
            lastQueueFullRejectionAt: null
        }
    };
}

function silenceLogs(work) {
    const originalLog = console.log;
    console.log = function () {};
    try { return work(); } finally { console.log = originalLog; }
}

function fillTo(length) {
    silenceLogs(function () {
        while (commands.getStatus().queueLength < length) {
            const index = commands.getStatus().queueLength;
            commands.enqueueCommand(index < 896 ? ordinary(index) : reset(index));
        }
    });
}

function makeBridge() {
    return createBridge({
        httpPort: 0,
        wsPort: 0,
        httpHost: "127.0.0.1",
        wsHost: "127.0.0.1",
        shutdownGraceMs: 40
    });
}

async function get(bridge, path) {
    const port = bridge.getHttpServer().address().port;
    const response = await fetch("http://127.0.0.1:" + port + path);
    return { status: response.status, headers: response.headers, body: await response.json() };
}

function openSocket(bridge) {
    return new Promise(function (resolve, reject) {
        const socket = new WebSocket("ws://127.0.0.1:" + bridge.getWebSocketServer().address().port);
        socket.once("open", function () { resolve(socket); });
        socket.once("error", reject);
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

function testCoreMetrics() {
    commands.resetQueueForTests();
    assert.deepEqual(commands.getQueueDiagnostics(), emptyDiagnostics());

    const before = Date.now();
    commands.enqueueCommand({ command: "develop.adjust", slider: "Exposure", amount: 1 });
    let diagnostics = commands.getQueueDiagnostics(before + 25);
    assert.equal(diagnostics.queue.length, 1);
    assert.equal(diagnostics.queue.pending.ordinary, 1);
    assert.equal(diagnostics.queue.pending.byCommand["develop.adjust"], 1);
    assert.equal(diagnostics.counters.enqueuedEntries, 1);
    assert.equal(diagnostics.queue.highWaterMark, 1);
    assert.ok(diagnostics.timestamps.lastEnqueuedAt >= before);
    assert.ok(diagnostics.queue.oldestCommandAgeMs >= 0);

    const originalAge = diagnostics.queue.oldestCommandAgeMs;
    commands.tryEnqueueCommand({ command: "develop.adjust", slider: "Exposure", amount: 2 });
    diagnostics = commands.getQueueDiagnostics(before + 25);
    assert.equal(diagnostics.queue.length, 1);
    assert.equal(diagnostics.counters.enqueuedEntries, 1);
    assert.equal(diagnostics.counters.coalescedCommands, 1);
    assert.ok(diagnostics.timestamps.lastCoalescedAt >= before);
    assert.equal(diagnostics.queue.oldestCommandAgeMs, originalAge);

    commands.enqueueCommand({ command: "develop.reset", slider: "Contrast" });
    commands.enqueueCommand({ command: "develop.set", slider: "Highlights", value: 1 });
    commands.enqueueCommand({ command: "develop.get", slider: "Shadows" });
    commands.enqueueCommand({ command: "develop.action", action: "setAutoTone" });
    commands.enqueueCommand({ command: "selection.navigate", direction: "first" });
    commands.enqueueCommand({ command: "selection.flag", flag: "reject" });
    commands.enqueueCommand({ command: "selection.rating.set", rating: 4 });
    commands.enqueueCommand({ command: "selection.rating.adjust", direction: "decrease" });
    commands.enqueueCommand({ command: "selection.label.set", label: "yellow" });
    commands.enqueueCommand({ command: "selection.label.toggle", label: "green" });
    commands.enqueueCommand({ command: "selection.operation", operation: "select_inverse" });
    commands.enqueueCommand({ command: "application.module", module: "library" });
    commands.enqueueCommand({ command: "application.view", view: "grid" });
    commands.enqueueCommand({ command: "application.action", action: "toggle_zoom" });
    commands.enqueueCommand({ command: "application.secondary_view", view: "loupe" });
    diagnostics = commands.getQueueDiagnostics();
    assert.deepEqual(diagnostics.queue.pending.byCommand, {
        "develop.adjust": 1, "develop.set": 1, "develop.get": 1,
        "develop.reset": 1, "develop.action": 1,
        "selection.navigate": 1, "selection.flag": 1,
        "selection.rating.set": 1, "selection.rating.adjust": 1,
        "selection.label.set": 1, "selection.label.toggle": 1,
        "selection.operation": 1, "application.module": 1,
        "application.view": 1, "application.action": 1,
        "application.secondary_view": 1
    });
    assert.equal(diagnostics.queue.pending.ordinary, 14);
    assert.equal(diagnostics.queue.pending.protected, 2);

    commands.resetQueueForTests();
    const batch = [reset(0), reset(1), { command: "develop.action", action: "setAutoTone" }];
    commands.tryEnqueueBatch(batch);
    assert.equal(commands.getQueueDiagnostics().counters.enqueuedEntries, 3);

    const copyCheckTime = Date.now();
    const first = commands.getQueueDiagnostics(copyCheckTime);
    const second = commands.getQueueDiagnostics(copyCheckTime);
    assert.notEqual(first, second);
    assert.notEqual(first.queue, second.queue);
    first.queue.length = 999;
    first.queue.pending.byCommand["develop.reset"] = 999;
    first.counters.enqueuedEntries = 999;
    assert.deepEqual(commands.getQueueDiagnostics(copyCheckTime), second);
    assert.deepEqual(commands.getNextCommand(), batch[0]);
    diagnostics = commands.getQueueDiagnostics();
    assert.equal(diagnostics.counters.dequeuedEntries, 1);
    assert.ok(diagnostics.timestamps.lastDequeuedAt !== null);
    assert.equal(diagnostics.queue.highWaterMark, 3);
    commands.getNextCommand();
    commands.getNextCommand();
    const dequeueTimestamp = commands.getQueueDiagnostics().timestamps.lastDequeuedAt;
    assert.equal(commands.getNextCommand(), null);
    diagnostics = commands.getQueueDiagnostics();
    assert.equal(diagnostics.counters.dequeuedEntries, 3);
    assert.equal(diagnostics.timestamps.lastDequeuedAt, dequeueTimestamp);
    assert.equal(diagnostics.queue.oldestCommandAgeMs, null);
    assert.equal(diagnostics.queue.highWaterMark, 3);
}

function assertQueueMetadataIsSynchronized(expectedLength, observedAt) {
    const diagnostics = commands.getQueueDiagnostics(observedAt);
    assert.equal(diagnostics.queue.length, expectedLength);
    assert.equal(
        diagnostics.queue.oldestCommandAgeMs !== null,
        expectedLength > 0,
        "queue-position metadata must exist exactly when a queued entry exists"
    );
}

function testQueuePositionMetadata() {
    commands.resetQueueForTests();
    assertQueueMetadataIsSynchronized(0);

    const repeated = { command: "develop.reset", slider: "Exposure" };
    const originalKeys = Object.keys(repeated);
    const beforeSingles = Date.now();
    assert.equal(commands.tryEnqueueCommand(repeated).status, commands.ADMISSION_ACCEPTED);
    assertQueueMetadataIsSynchronized(1, beforeSingles + 25);
    assert.equal(commands.tryEnqueueCommand(repeated).status, commands.ADMISSION_ACCEPTED);
    assertQueueMetadataIsSynchronized(2, beforeSingles + 25);
    assert.deepEqual(Object.keys(repeated), originalKeys);

    assert.equal(commands.getNextCommand(), repeated);
    assertQueueMetadataIsSynchronized(1, beforeSingles + 25);
    assert.equal(commands.getNextCommand(), repeated);
    assertQueueMetadataIsSynchronized(0, beforeSingles + 25);

    commands.resetQueueForTests();
    const beforeBatch = Date.now();
    assert.equal(commands.tryEnqueueBatch([repeated, repeated]).status, commands.ADMISSION_ACCEPTED);
    assertQueueMetadataIsSynchronized(2, beforeBatch + 25);
    assert.equal(commands.getNextCommand(), repeated);
    assertQueueMetadataIsSynchronized(1, beforeBatch + 25);
    assert.equal(commands.getNextCommand(), repeated);
    assertQueueMetadataIsSynchronized(0, beforeBatch + 25);
    assert.deepEqual(Object.keys(repeated), originalKeys);

    commands.resetQueueForTests();
    assert.equal(commands.tryEnqueueCommand({ command: "develop.adjust", slider: "Exposure", amount: 1 }).status, commands.ADMISSION_ACCEPTED);
    assertQueueMetadataIsSynchronized(1);
    assert.equal(commands.tryEnqueueCommand({ command: "develop.adjust", slider: "Exposure", amount: 2 }).status, commands.ADMISSION_COALESCED);
    assertQueueMetadataIsSynchronized(1);
    assert.equal(commands.tryEnqueueCommand({ command: "bad" }).status, commands.ADMISSION_INVALID);
    assertQueueMetadataIsSynchronized(1);
    commands.getNextCommand();
    assertQueueMetadataIsSynchronized(0);
    commands.resetQueueForTests();
    assertQueueMetadataIsSynchronized(0);
}

function testRejectionsAndCapacity() {
    commands.resetQueueForTests();
    fillTo(896);
    let diagnostics = commands.getQueueDiagnostics();
    assert.equal(diagnostics.queue.ordinaryCapacityAvailable, 0);
    assert.equal(diagnostics.queue.protectedReserveAvailable, 128);
    assert.equal(diagnostics.queue.totalCapacityAvailable, 128);
    assert.equal(diagnostics.queue.ordinarySaturated, true);
    const beforeLength = diagnostics.queue.length;
    assert.equal(commands.tryEnqueueCommand(ordinary(9999)).status, commands.ADMISSION_QUEUE_FULL);
    assert.equal(commands.tryEnqueueCommand({ command: "bad" }).status, commands.ADMISSION_INVALID);
    assertQueueMetadataIsSynchronized(beforeLength);
    diagnostics = commands.getQueueDiagnostics();
    assert.equal(diagnostics.queue.length, beforeLength);
    assert.equal(diagnostics.counters.queueFullRejections, 1);
    assert.ok(diagnostics.timestamps.lastQueueFullRejectionAt !== null);

    fillTo(1024);
    diagnostics = commands.getQueueDiagnostics();
    assert.equal(diagnostics.queue.protectedReserveAvailable, 0);
    assert.equal(diagnostics.queue.totalCapacityAvailable, 0);
    assert.equal(diagnostics.queue.hardSaturated, true);
    assert.equal(diagnostics.queue.highWaterMark, 1024);
    assert.equal(commands.tryEnqueueCommand(reset(0)).status, commands.ADMISSION_QUEUE_FULL);
    assert.equal(commands.tryEnqueueBatch([reset(1), reset(2)]).status, commands.ADMISSION_QUEUE_FULL);
    assertQueueMetadataIsSynchronized(1024);
    diagnostics = commands.getQueueDiagnostics();
    assert.equal(diagnostics.counters.queueFullRejections, 3);
    assert.ok(diagnostics.queue.highWaterMark <= 1024);
}

async function testEndpointAndLifecycle() {
    commands.resetQueueForTests();
    const bridge = makeBridge();
    try {
        await bridge.start();
        const statusBefore = await get(bridge, "/status");
        const contextBefore = await get(bridge, "/context");
        let response = await get(bridge, "/diagnostics/queue");
        assert.equal(response.status, 200);
        assert.match(response.headers.get("cache-control"), /no-store/);
        assert.deepEqual(response.body, emptyDiagnostics());
        assert.deepEqual((await get(bridge, "/status")).body, statusBefore.body);
        assert.deepEqual((await get(bridge, "/context")).body, contextBefore.body);

        commands.enqueueCommand({
            command: "develop.adjust", slider: "SecretSliderName", amount: 123456789,
            photoPath: "C:\\private\\photo.jpg", clientAddress: "192.0.2.1"
        });
        assert.equal(commands.getStatus().queueLength, 0, "invalid privacy sentinel must not enter queue");
        commands.enqueueCommand({ command: "develop.adjust", slider: "Exposure", amount: 123456789 });
        commands.enqueueCommand({ command: "selection.navigate", direction: "last" });
        commands.enqueueCommand({ command: "selection.flag", flag: "pick" });
        commands.enqueueCommand({ command: "selection.rating.set", rating: 5 });
        commands.enqueueCommand({ command: "selection.label.set", label: "purple" });
        response = await get(bridge, "/diagnostics/queue");
        const serialized = JSON.stringify(response.body);
        for (const secret of [
            "Exposure", "123456789", "photo.jpg", "192.0.2.1", "setAutoTone",
            ':"last"', ':"pick"', ':"purple"', '"rating":5'
        ]) {
            assert.equal(serialized.includes(secret), false, "diagnostics exposed " + secret);
        }
        const preserved = response.body;
        await bridge.stop();
        await bridge.start();
        response = await get(bridge, "/diagnostics/queue");
        assert.equal(response.body.queue.length, preserved.queue.length);
        assert.equal(response.body.counters.enqueuedEntries, preserved.counters.enqueuedEntries);
        assert.equal(response.body.timestamps.lastEnqueuedAt, preserved.timestamps.lastEnqueuedAt);
    } finally {
        await bridge.stop();
        commands.resetQueueForTests();
    }
}

async function testTransportRejectionCounters() {
    commands.resetQueueForTests();
    const bridge = makeBridge();
    try {
        await bridge.start();
        fillTo(896);
        let response = await get(bridge, "/adjust?slider=Contrast&amount=1");
        assert.equal(response.status, 503);
        assert.equal(commands.getQueueDiagnostics().counters.queueFullRejections, 1);

        const socket = await openSocket(bridge);
        try {
            const frame = nextMessage(socket);
            socket.send(JSON.stringify(ordinary(9999)));
            assert.equal((await frame).code, "COMMAND_QUEUE_FULL");
            assert.equal(commands.getQueueDiagnostics().counters.queueFullRejections, 2);
        } finally {
            socket.close();
        }
    } finally {
        await bridge.stop();
        commands.resetQueueForTests();
    }
}

async function main() {
    testCoreMetrics();
    testQueuePositionMetadata();
    testRejectionsAndCapacity();
    await testEndpointAndLifecycle();
    await testTransportRejectionCounters();
    commands.resetQueueForTests();
    assert.deepEqual(commands.getQueueDiagnostics(), emptyDiagnostics());
    console.log("LRBridge queue diagnostics tests passed.");
}

main().catch(function (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
});
