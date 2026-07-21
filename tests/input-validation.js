const assert = require("node:assert/strict");
const http = require("node:http");
const WebSocket = require("ws");

const commands = require("../server/commands");
const { createBridge } = require("../server/bridge");

function getJson(port, path) {
    return new Promise(function (resolve, reject) {
        const request = http.get({ hostname: "127.0.0.1", port, path }, function (response) {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", function (chunk) { body += chunk; });
            response.on("end", function () {
                try {
                    resolve({ statusCode: response.statusCode, body: JSON.parse(body) });
                } catch (err) {
                    reject(err);
                }
            });
        });
        request.once("error", reject);
    });
}

function openWebSocket(port) {
    return new Promise(function (resolve, reject) {
        const socket = new WebSocket("ws://127.0.0.1:" + port);
        socket.once("open", function () { resolve(socket); });
        socket.once("error", reject);
    });
}

function closeWebSocket(socket) {
    return new Promise(function (resolve) {
        socket.once("close", resolve);
        socket.close();
    });
}

async function waitForQueueLength(length) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (commands.getStatus().queueLength === length) return;
        await new Promise(function (resolve) { setTimeout(resolve, 5); });
    }
    assert.equal(commands.getStatus().queueLength, length, "Timed out waiting for queue length " + length);
}

async function main() {
    while (commands.getNextCommand() !== null) {}

    const bridge = createBridge({
        httpPort: 0,
        wsPort: 0,
        httpHost: "127.0.0.1",
        wsHost: "127.0.0.1",
        startLightroomWatcher: false,
        shutdownGraceMs: 40
    });

    const originalLog = console.log;
    console.log = function () {};

    try {
        await bridge.start();
        const httpPort = bridge.getHttpServer().address().port;
        const wsPort = bridge.getWebSocketServer().address().port;
        let result;

        const adjustCases = [
            ["0", 0], ["1", 1], ["-1", -1], ["25", 25], ["-25", -25],
            // Safe exponent notation is accepted after HTTP numeric normalization.
            ["1e3", 1000]
        ];
        for (const [raw, expected] of adjustCases) {
            const result = await getJson(httpPort, "/adjust?slider=Exposure&amount=" + encodeURIComponent(raw));
            const queued = { command: "develop.adjust", slider: "Exposure", amount: expected };
            assert.deepEqual(result, { statusCode: 200, body: { ok: true, queued } });
            assert.deepEqual(commands.getNextCommand(), queued);
        }

        for (const path of [
            "/adjust?slider=Exposure",
            "/adjust?slider=Exposure&amount=",
            "/adjust?slider=Exposure&amount=%20%20",
            "/adjust?slider=Exposure&amount=NaN",
            "/adjust?slider=Exposure&amount=Infinity",
            "/adjust?slider=Exposure&amount=-Infinity",
            "/adjust?slider=Exposure&amount=1e309",
            "/adjust?slider=Exposure&amount=1.25",
            "/adjust?slider=Exposure&amount=-2.5",
            "/adjust?slider=Exposure&amount=1e308",
            "/adjust?slider=Exposure&amount=9007199254740992",
            "/adjust?slider=Exposure&amount=-9007199254740992"
        ]) {
            const before = commands.getStatus().queueLength;
            const result = await getJson(httpPort, path);
            assert.equal(result.statusCode, 400, path);
            assert.equal(commands.getStatus().queueLength, before, path + " changed queue length");
        }

        result = await getJson(httpPort, "/adjust?slider=BadSlider&amount=1");
        assert.equal(result.statusCode, 400);
        assert.equal(commands.getStatus().queueLength, 0);

        for (const [raw, expected] of [["0.25", 0.25], ["-1.5", -1.5], ["6500.5", 6500.5]]) {
            result = await getJson(httpPort, "/set?slider=Exposure&experimental=1&value=" + encodeURIComponent(raw));
            const queued = { command: "develop.set", slider: "Exposure", value: expected };
            assert.deepEqual(result, { statusCode: 200, body: { ok: true, queued, experimental: true } });
            assert.deepEqual(commands.getNextCommand(), queued);
        }

        for (const suffix of ["", "&value=", "&value=%20%20", "&value=NaN", "&value=Infinity", "&value=-Infinity", "&value=1e309"]) {
            const before = commands.getStatus().queueLength;
            result = await getJson(httpPort, "/set?slider=Exposure&experimental=1" + suffix);
            assert.equal(result.statusCode, 400);
            assert.equal(commands.getStatus().queueLength, before);
        }

        result = await getJson(httpPort, "/command?command=develop.adjust&slider=Exposure&amount=%20");
        assert.equal(result.statusCode, 400);
        assert.equal(commands.getStatus().queueLength, 0);

        for (const [raw, expected] of [["1.25", 1.25], ["0", 0], ["-2", -2]]) {
            result = await getJson(httpPort, "/result?command=develop.get.result&slider=Exposure&value=" + raw);
            assert.deepEqual(result, { statusCode: 200, body: { ok: true } });
            result = await getJson(httpPort, "/last-result");
            assert.deepEqual(result.body, { result: { command: "develop.get.result", slider: "Exposure", value: expected } });
        }
        for (const suffix of ["", "&value=NaN", "&value=Infinity", "&value=-Infinity", "&value=1e309", "&value=", "&value=%20"]) {
            result = await getJson(httpPort, "/result?slider=Exposure" + suffix);
            assert.equal(result.statusCode, 400);
        }

        result = await getJson(httpPort, "/feedback/request?slider=Exposure");
        const feedbackId = result.body.request.id;
        result = await getJson(httpPort, "/feedback/result?id=" + feedbackId + "&slider=Exposure&value=-0.5");
        assert.equal(result.statusCode, 200);
        assert.deepEqual(result.body.result.id, feedbackId);
        assert.equal(result.body.result.value, -0.5);
        result = await getJson(httpPort, "/feedback/result?id=0&slider=Exposure&value=0");
        assert.equal(result.statusCode, 200);
        assert.equal(result.body.result.id, 0);
        assert.equal(result.body.result.value, 0);
        for (const suffix of ["", "&value=NaN", "&value=Infinity", "&value=-Infinity", "&value=1e309", "&value=", "&value=%20"]) {
            result = await getJson(httpPort, "/feedback/result?id=" + feedbackId + "&slider=Exposure" + suffix);
            assert.equal(result.statusCode, 400);
        }
        for (const suffix of ["", "?id=1.5", "?id=NaN", "?id=Infinity", "?id=-Infinity", "?id=", "?id=%20"]) {
            const separator = suffix.length === 0 ? "?" : "&";
            result = await getJson(httpPort, "/feedback/result" + suffix + separator + "slider=Exposure&value=1");
            assert.equal(result.statusCode, 400);
        }

        const socket = await openWebSocket(wsPort);
        for (const command of [
            { command: "develop.adjust", slider: "Exposure", amount: 0 },
            { command: "develop.adjust", slider: "Exposure", amount: -25 },
            // JSON.parse normalizes numeric 1e3 to the safe integer 1000.
            { command: "develop.adjust", slider: "Exposure", amount: 1e3 },
            { command: "develop.set", slider: "Exposure", value: -1.5 }
        ]) {
            socket.send(JSON.stringify(command));
            await waitForQueueLength(1);
            assert.deepEqual(commands.getNextCommand(), command);
        }
        for (const command of [
            { command: "develop.adjust", slider: "Exposure" },
            { command: "develop.adjust", slider: "Exposure", amount: "1" },
            { command: "develop.adjust", slider: "Exposure", amount: 1.25 },
            { command: "develop.adjust", slider: "Exposure", amount: -2.5 },
            { command: "develop.adjust", slider: "Exposure", amount: 1e308 },
            { command: "develop.adjust", slider: "Exposure", amount: Number.MAX_SAFE_INTEGER + 1 },
            { command: "develop.adjust", slider: "Exposure", amount: Number.MIN_SAFE_INTEGER - 1 },
            { command: "develop.set", slider: "Exposure" }
        ]) {
            const sentinel = { command: "develop.reset", slider: "Exposure" };
            socket.send(JSON.stringify(command));
            socket.send(JSON.stringify(sentinel));
            await waitForQueueLength(1);
            assert.deepEqual(commands.getNextCommand(), sentinel);
        }
        const sentinel = { command: "develop.reset", slider: "Exposure" };
        socket.send("not json");
        socket.send(JSON.stringify(sentinel));
        await waitForQueueLength(1);
        assert.deepEqual(commands.getNextCommand(), sentinel);
        socket.send("null");
        socket.send(JSON.stringify(sentinel));
        await waitForQueueLength(1);
        assert.deepEqual(commands.getNextCommand(), sentinel);
        await closeWebSocket(socket);

        for (const amount of [0, 1, -1, 25, -25, 1e3, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
            const command = { command: "develop.adjust", slider: "Exposure", amount };
            assert.equal(commands.validateCommand(command), true);
            assert.equal(commands.enqueueCommand(command), true);
            assert.deepEqual(commands.getNextCommand(), command);
        }

        for (const amount of [1.25, -2.5, 1e308, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1]) {
            const command = { command: "develop.adjust", slider: "Exposure", amount };
            const before = commands.getQueueDiagnostics();
            assert.equal(commands.validateCommand(command), false);
            assert.equal(commands.enqueueCommand(command), false);
            assert.equal(commands.getStatus().queueLength, before.queue.length);
            assert.equal(commands.getQueueDiagnostics().counters.coalescedCommands, before.counters.coalescedCommands);
        }

        for (const nonFinite of [NaN, Infinity, -Infinity]) {
            for (const command of [
                { command: "develop.adjust", slider: "Exposure", amount: nonFinite },
                { command: "develop.set", slider: "Exposure", value: nonFinite }
            ]) {
                const before = commands.getStatus().queueLength;
                assert.equal(commands.validateCommand(command), false);
                assert.equal(commands.enqueueCommand(command), false);
                assert.equal(commands.getStatus().queueLength, before);
            }
        }

        commands.enqueueCommand({ command: "develop.adjust", slider: "Exposure", amount: 2 });
        const coalesced = commands.tryEnqueueCommand({ command: "develop.adjust", slider: "Exposure", amount: 3 });
        assert.equal(coalesced.status, commands.ADMISSION_COALESCED);
        assert.deepEqual(commands.getNextCommand(), { command: "develop.adjust", slider: "Exposure", amount: 5 });

        commands.enqueueCommand({
            command: "develop.adjust", slider: "Exposure", amount: Number.MAX_SAFE_INTEGER
        });
        const safeOverflow = commands.tryEnqueueCommand({
            command: "develop.adjust", slider: "Exposure", amount: 1
        });
        assert.equal(safeOverflow.status, commands.ADMISSION_ACCEPTED);
        assert.equal(safeOverflow.coalesced, false);
        assert.deepEqual(commands.getNextCommand(), {
            command: "develop.adjust", slider: "Exposure", amount: Number.MAX_SAFE_INTEGER
        });
        assert.deepEqual(commands.getNextCommand(), {
            command: "develop.adjust", slider: "Exposure", amount: 1
        });
    } finally {
        await bridge.stop();
        console.log = originalLog;
    }

    console.log("Finite numeric input validation passed.");
}

main().catch(function (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
});
