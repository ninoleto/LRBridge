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

function silenceLogs(work) {
    const originalLog = console.log;
    console.log = function () {};
    try {
        return work();
    } finally {
        console.log = originalLog;
    }
}

function fillTo(length) {
    silenceLogs(function () {
        while (commands.getStatus().queueLength < length) {
            const index = commands.getStatus().queueLength;
            const command = index < commands.ORDINARY_ADMISSION_CEILING
                ? ordinary(index)
                : reset(index);
            assert.equal(commands.enqueueCommand(command), true);
        }
    });
}

function drain() {
    const result = [];
    let command;
    while ((command = commands.getNextCommand()) !== null) result.push(command);
    return result;
}

function snapshot() {
    const queued = drain();
    silenceLogs(function () {
        for (const command of queued) commands.enqueueCommand(command);
    });
    return JSON.parse(JSON.stringify(queued));
}

function assertOverload(response, queueLength) {
    assert.equal(response.status, 503);
    assert.equal(response.retryAfter, "1");
    assert.deepEqual(response.body, {
        ok: false,
        error: "Command queue full",
        queueLength: queueLength,
        queueLimit: commands.HARD_QUEUE_CAPACITY,
        retryable: true
    });
}

async function withCleanQueue(test) {
    commands.resetQueueForTests();
    try {
        await test();
    } finally {
        commands.resetQueueForTests();
    }
}

function fakeWake() {
    return { startWatcher() {}, stopWatcher() {}, async wakeLightroom() { return { ok: true }; } };
}

async function withBridge(test) {
    const bridge = createBridge({
        httpPort: 0,
        wsPort: 0,
        httpHost: "127.0.0.1",
        wsHost: "127.0.0.1",
        startLightroomWatcher: false,
        lightroomWake: fakeWake()
    });
    try {
        await bridge.start();
        await test(bridge);
    } finally {
        await bridge.stop();
    }
}

async function get(bridge, path) {
    const port = bridge.getHttpServer().address().port;
    const response = await fetch("http://127.0.0.1:" + port + path);
    return {
        status: response.status,
        retryAfter: response.headers.get("retry-after"),
        body: await response.json()
    };
}

function openSocket(bridge) {
    return new Promise(function (resolve, reject) {
        const port = bridge.getWebSocketServer().address().port;
        const socket = new WebSocket("ws://127.0.0.1:" + port);
        socket.once("open", function () { resolve(socket); });
        socket.once("error", reject);
    });
}

function nextMessage(socket, timeoutMs = 250) {
    return new Promise(function (resolve, reject) {
        const timer = setTimeout(function () { reject(new Error("Timed out waiting for WebSocket frame")); }, timeoutMs);
        socket.once("message", function (message) {
            clearTimeout(timer);
            resolve(JSON.parse(message.toString()));
        });
    });
}

function expectSilence(socket, timeoutMs = 75) {
    return new Promise(function (resolve, reject) {
        const timer = setTimeout(resolve, timeoutMs);
        socket.once("message", function (message) {
            clearTimeout(timer);
            reject(new Error("Unexpected WebSocket frame: " + message));
        });
    });
}

async function testCoreQueue() {
    await withCleanQueue(async function () {
        const allTypes = [
            { command: "develop.adjust", slider: "Exposure", amount: 1 },
            { command: "develop.set", slider: "Contrast", value: 2 },
            { command: "develop.get", slider: "Highlights" },
            { command: "develop.reset", slider: "Shadows" },
            { command: "develop.action", action: "setAutoTone" },
            { command: "selection.navigate", direction: "next" },
            { command: "selection.flag", flag: "pick" },
            { command: "selection.rating.set", rating: 5 },
            { command: "selection.rating.adjust", direction: "decrease" },
            { command: "selection.label.set", label: "red" },
            { command: "selection.label.toggle", label: "blue" },
            { command: "selection.operation", operation: "select_all" },
            { command: "application.module", module: "library" },
            { command: "application.view", view: "grid" },
            { command: "application.action", action: "toggle_zoom" },
            { command: "application.secondary_view", view: "loupe" }
        ];
        allTypes.forEach((command) => assert.equal(commands.enqueueCommand(command), true));
        assert.deepEqual(drain(), allTypes, "all command types must retain FIFO order");

        commands.enqueueCommand({ command: "develop.adjust", slider: "Exposure", amount: 2 });
        const coalesced = commands.tryEnqueueCommand({ command: "develop.adjust", slider: "Exposure", amount: 3 });
        assert.equal(coalesced.coalesced, true);
        assert.deepEqual(drain(), [{ command: "develop.adjust", slider: "Exposure", amount: 5 }]);

        const acrossSlider = [
            { command: "develop.adjust", slider: "Exposure", amount: 1 },
            { command: "develop.adjust", slider: "Contrast", amount: 2 },
            { command: "develop.adjust", slider: "Exposure", amount: 3 }
        ];
        acrossSlider.forEach(commands.enqueueCommand);
        assert.deepEqual(drain(), acrossSlider);

        const acrossType = [
            { command: "develop.adjust", slider: "Exposure", amount: 1 },
            { command: "develop.get", slider: "Exposure" },
            { command: "develop.adjust", slider: "Exposure", amount: 2 }
        ];
        acrossType.forEach(commands.enqueueCommand);
        assert.deepEqual(drain(), acrossType);

        const selectionBarriers = [
            { command: "develop.adjust", slider: "Exposure", amount: 1 },
            { command: "selection.navigate", direction: "previous" },
            { command: "develop.adjust", slider: "Exposure", amount: 2 },
            { command: "selection.flag", flag: "reject" },
            { command: "selection.rating.set", rating: 3 },
            { command: "selection.rating.adjust", direction: "increase" },
            { command: "selection.label.set", label: "none" },
            { command: "selection.label.toggle", label: "purple" }
        ];
        selectionBarriers.forEach(commands.enqueueCommand);
        assert.deepEqual(drain(), selectionBarriers, "selection commands must remain FIFO and never coalesce");

        const beforeUnsafeAdjustments = snapshot();
        assert.equal(commands.enqueueCommand({
            command: "develop.adjust", slider: "Exposure", amount: Number.MAX_SAFE_INTEGER + 1
        }), false);
        assert.equal(commands.enqueueCommand({
            command: "develop.adjust", slider: "Exposure", amount: Number.MIN_SAFE_INTEGER - 1
        }), false);
        assert.deepEqual(snapshot(), beforeUnsafeAdjustments, "unsafe adjustments must not mutate queue state or counters");

        commands.enqueueCommand({
            command: "develop.adjust", slider: "Exposure", amount: Number.MAX_SAFE_INTEGER
        });
        const unsafeCombinedAmount = commands.tryEnqueueCommand({
            command: "develop.adjust", slider: "Exposure", amount: 1
        });
        assert.equal(unsafeCombinedAmount.status, commands.ADMISSION_ACCEPTED);
        assert.equal(unsafeCombinedAmount.coalesced, false);
        assert.deepEqual(drain(), [
            { command: "develop.adjust", slider: "Exposure", amount: Number.MAX_SAFE_INTEGER },
            { command: "develop.adjust", slider: "Exposure", amount: 1 }
        ]);
        assert.equal(commands.enqueueCommand({ command: "develop.adjust", slider: "Exposure", amount: NaN }), false);
        assert.equal(commands.enqueueCommand({ command: "develop.set", slider: "Exposure", value: "1" }), false);
        assert.equal(commands.getStatus().queueLength, 0);

        fillTo(commands.ORDINARY_ADMISSION_CEILING - 1);
        commands.enqueueCommand({ command: "develop.adjust", slider: "Exposure", amount: 1 });
        assert.equal(commands.getStatus().queueLength, commands.ORDINARY_ADMISSION_CEILING);
        const atCapacity = commands.tryEnqueueCommand({ command: "develop.adjust", slider: "Exposure", amount: 2 });
        assert.equal(atCapacity.coalesced, true);
        assert.equal(commands.getStatus().queueLength, commands.ORDINARY_ADMISSION_CEILING);
        assert.equal(commands.tryEnqueueCommand(ordinary(9999)).status, commands.ADMISSION_QUEUE_FULL);
        assert.equal(commands.tryEnqueueCommand({
            command: "selection.navigate", direction: "next"
        }).status, commands.ADMISSION_QUEUE_FULL, "selection commands must not consume protected reserve");
        for (const command of [
            { command: "selection.operation", operation: "select_all" },
            { command: "application.module", module: "develop" },
            { command: "application.view", view: "grid" },
            { command: "application.action", action: "toggle_zoom" },
            { command: "application.secondary_view", view: "loupe" }
        ]) {
            assert.equal(
                commands.tryEnqueueCommand(command).status,
                commands.ADMISSION_QUEUE_FULL,
                command.command + " must not consume protected reserve"
            );
        }

        const beforeRejection = snapshot();
        assert.equal(commands.tryEnqueueCommand(ordinary(10000)).status, commands.ADMISSION_QUEUE_FULL);
        assert.deepEqual(snapshot(), beforeRejection, "ordinary rejection must not mutate the queue");

        silenceLogs(function () {
            while (commands.getStatus().queueLength < commands.HARD_QUEUE_CAPACITY) {
                assert.equal(commands.enqueueCommand(reset(commands.getStatus().queueLength)), true);
            }
        });
        assert.equal(commands.getStatus().queueLength, commands.HARD_QUEUE_CAPACITY);
        const hardSnapshot = snapshot();
        assert.equal(commands.tryEnqueueCommand(reset(0)).status, commands.ADMISSION_QUEUE_FULL);
        assert.equal(commands.tryEnqueueCommand({ command: "develop.action", action: "setAutoTone" }).status, commands.ADMISSION_QUEUE_FULL);
        assert.equal(commands.getStatus().queueLength, commands.HARD_QUEUE_CAPACITY);
        assert.deepEqual(snapshot(), hardSnapshot, "protected rejection must not mutate the queue");

        commands.getNextCommand();
        assert.equal(commands.enqueueCommand({ command: "develop.action", action: "setAutoTone" }), true);
        assert.equal(commands.getStatus().queueLength, commands.HARD_QUEUE_CAPACITY);
    });
}

async function testHttpAndBatches() {
    await withCleanQueue(async function () {
        await withBridge(async function (bridge) {
            let response = await get(bridge, "/adjust?slider=Exposure&amount=2");
            assert.deepEqual(response.body, {
                ok: true,
                queued: { command: "develop.adjust", slider: "Exposure", amount: 2 }
            });
            commands.getNextCommand();

            fillTo(commands.ORDINARY_ADMISSION_CEILING);
            commands.setLatestResult({ command: "develop.get.result", slider: "Exposure", value: 7 });
            response = await get(bridge, "/adjust?slider=Contrast&amount=1");
            assertOverload(response, 896);
            response = await get(bridge, "/adjust?slider=BadSlider&amount=1");
            assert.equal(response.status, 400);
            assert.equal(response.body.error, "Invalid command");
            response = await get(bridge, "/get?slider=Exposure");
            assert.equal(response.status, 503);
            assert.deepEqual(commands.getLatestResult(), {
                command: "develop.get.result", slider: "Exposure", value: 7
            });

            commands.resetQueueForTests();
            const groupSize = sliders.getAll().filter((slider) => slider.group === "Basic").length;
            fillTo(commands.HARD_QUEUE_CAPACITY - groupSize + 1);
            const beforeGroup = snapshot();
            response = await get(bridge, "/reset-group?group=Basic");
            assertOverload(response, commands.HARD_QUEUE_CAPACITY - groupSize + 1);
            assert.deepEqual(snapshot(), beforeGroup);

            commands.resetQueueForTests();
            const allSize = sliders.getIds().length;
            fillTo(commands.HARD_QUEUE_CAPACITY - allSize + 1);
            const beforeAll = snapshot();
            response = await get(bridge, "/reset-all");
            assertOverload(response, commands.HARD_QUEUE_CAPACITY - allSize + 1);
            assert.deepEqual(snapshot(), beforeAll);

            commands.resetQueueForTests();
            fillTo(commands.HARD_QUEUE_CAPACITY - groupSize);
            response = await get(bridge, "/reset-group?group=Basic");
            assert.equal(response.status, 200);
            assert.equal(commands.getStatus().queueLength, commands.HARD_QUEUE_CAPACITY);

            commands.resetQueueForTests();
            fillTo(commands.HARD_QUEUE_CAPACITY - allSize);
            response = await get(bridge, "/reset-all");
            assert.equal(response.status, 200);
            assert.equal(response.body.queuedCount, allSize);
            assert.equal(commands.getStatus().queueLength, commands.HARD_QUEUE_CAPACITY);
        });
    });
}

async function testWebSocketsAndLifecycle() {
    await withCleanQueue(async function () {
        await withBridge(async function (bridge) {
            const first = await openSocket(bridge);
            const second = await openSocket(bridge);
            try {
                first.send(JSON.stringify({ command: "develop.adjust", slider: "Exposure", amount: 1 }));
                await expectSilence(first);
                assert.equal(commands.getStatus().queueLength, 1);

                first.send("not json");
                first.send(JSON.stringify({ command: "invalid" }));
                await new Promise((resolve) => setTimeout(resolve, 25));
                assert.equal(commands.getStatus().queueLength, 1);

                commands.resetQueueForTests();
                fillTo(commands.ORDINARY_ADMISSION_CEILING);
                const expected = {
                    type: "error", code: "COMMAND_QUEUE_FULL", error: "Command queue full",
                    queueLength: 896, queueLimit: 1024, retryable: true
                };
                const firstFrame = nextMessage(first);
                first.send(JSON.stringify(ordinary(9000)));
                assert.deepEqual(await firstFrame, expected);
                await expectSilence(first);
                const secondFrame = nextMessage(second);
                second.send(JSON.stringify(ordinary(9001)));
                assert.deepEqual(await secondFrame, expected);
                assert.equal(commands.getStatus().queueLength, commands.ORDINARY_ADMISSION_CEILING);
            } finally {
                first.close();
                second.close();
            }

            commands.resetQueueForTests();
            commands.enqueueCommand({ command: "develop.reset", slider: "Exposure" });
            await bridge.stop();
            assert.equal(commands.getStatus().queueLength, 1, "lifecycle stop must retain the process-global queue");
            await bridge.start();
            assert.deepEqual(commands.getNextCommand(), { command: "develop.reset", slider: "Exposure" });
        });
    });
}

async function main() {
    assert.equal(commands.HARD_QUEUE_CAPACITY, 1024);
    assert.equal(commands.ORDINARY_ADMISSION_CEILING, 896);
    assert.equal(commands.PROTECTED_QUEUE_RESERVE, 128);
    await testCoreQueue();
    await testHttpAndBatches();
    await testWebSocketsAndLifecycle();
    console.log("LRBridge queue resilience tests passed.");
}

main().catch(function (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
});
