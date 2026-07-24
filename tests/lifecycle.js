const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const Module = require("node:module");
const path = require("node:path");
const WebSocket = require("ws");

const bridgeModule = require("../server/bridge");
const commands = require("../server/commands");
const { createBridge, HTTP_PORT, WS_PORT } = bridgeModule;

function listen(server, port) {
    return new Promise(function (resolve, reject) {
        function onError(err) {
            server.removeListener("listening", onListening);
            reject(err);
        }
        function onListening() {
            server.removeListener("error", onError);
            resolve(server);
        }
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, "127.0.0.1");
    });
}

function close(server) {
    return new Promise(function (resolve) {
        if (!server || !server.listening) return resolve();
        server.close(function () { resolve(); });
    });
}

async function unusedPort() {
    const server = await listen(net.createServer(), 0);
    const port = server.address().port;
    await close(server);
    return port;
}

function getJson(port, requestPath) {
    return new Promise(function (resolve, reject) {
        const request = http.get({ hostname: "127.0.0.1", port, path: requestPath }, function (response) {
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

function isolatedBridge(options) {
    return createBridge(Object.assign({
        httpPort: 0,
        wsPort: 0,
        httpHost: "127.0.0.1",
        wsHost: "127.0.0.1",
        shutdownGraceMs: 40
    }, options));
}

async function withBridge(options, test) {
    const bridge = isolatedBridge(options);
    try {
        await test(bridge);
    } finally {
        await bridge.stop();
    }
}

async function testConstructionDoesNotListen() {
    await withBridge({}, async function (bridge) {
        assert.equal(bridge.getState(), "stopped");
        assert.equal(bridge.getHttpServer(), null);
        assert.equal(bridge.getWebSocketServer(), null);
    });
}

function testProductionDefaults() {
    assert.equal(HTTP_PORT, 17891);
    assert.equal(WS_PORT, 17890);
}

async function testStartupAndPortRelease() {
    let httpPort;
    let wsPort;
    await withBridge({}, async function (bridge) {
        await bridge.start();
        const httpAddress = bridge.getHttpServer().address();
        const wsAddress = bridge.getWebSocketServer().address();
        httpPort = httpAddress.port;
        wsPort = wsAddress.port;
        const result = await getJson(httpPort, "/");
        assert.equal(result.statusCode, 200);
        assert.deepEqual(result.body, {
            name: "LRBridge", ok: true, httpPort: httpAddress.port,
            wsPort: wsAddress.port, help: "/help"
        });
        await bridge.stop();
        assert.equal(bridge.getState(), "stopped");
        assert.equal(bridge.getHttpServer(), null);
        assert.equal(bridge.getWebSocketServer(), null);
        let httpProbe = null;
        let wsProbe = null;
        try {
            httpProbe = await listen(http.createServer(), httpPort);
            wsProbe = await listen(net.createServer(), wsPort);
            assert.equal(httpProbe.address().port, httpPort);
            assert.equal(wsProbe.address().port, wsPort);
        } finally {
            await Promise.all([close(httpProbe), close(wsProbe)]);
        }
    });
}

function drainCommands() {
    const drained = [];
    let command;
    while ((command = commands.getNextCommand()) !== null) drained.push(command);
    return drained;
}

async function testStartupLibraryLifecycle() {
    const bridge = isolatedBridge();
    try {
        commands.resetQueueForTests();
        await bridge.start();
        const port = bridge.getHttpServer().address().port;
        assert.deepEqual(drainCommands(), []);

        await getJson(port, "/context/update?activeModule=develop&selectedPhotoKey=photo-1");
        assert.deepEqual(drainCommands(), [], "invalid heartbeat queued startup Library");

        const heartbeat = "/context/update?activeModule=develop&selectedPhotoKey=photo-1&developFingerprint=abc";
        await getJson(port, heartbeat);
        await getJson(port, heartbeat);
        assert.deepEqual(drainCommands(), [
            { command: "application.module", module: "library" }
        ], "repeated heartbeat queued startup Library more than once");

        await bridge.stop();
        await bridge.start();
        const restartedPort = bridge.getHttpServer().address().port;

        for (let index = 0; index < commands.ORDINARY_ADMISSION_CEILING; index += 1) {
            assert.equal(commands.enqueueCommand({
                command: "application.module",
                module: "develop"
            }), true);
        }
        await getJson(restartedPort, heartbeat);
        assert.equal(commands.getStatus().queueLength, commands.ORDINARY_ADMISSION_CEILING);
        assert.deepEqual(commands.getNextCommand(), {
            command: "application.module",
            module: "develop"
        });
        await getJson(restartedPort, heartbeat);

        const queued = drainCommands();
        assert.equal(queued.length, commands.ORDINARY_ADMISSION_CEILING);
        assert.deepEqual(queued[queued.length - 1], {
            command: "application.module",
            module: "library"
        }, "later heartbeat did not retry startup Library admission");

        await bridge.stop();
        await bridge.start();
        await getJson(bridge.getHttpServer().address().port, heartbeat);
        assert.deepEqual(drainCommands(), [
            { command: "application.module", module: "library" }
        ], "new bridge lifecycle did not reset startup Library guard");
    } finally {
        await bridge.stop();
        commands.resetQueueForTests();
    }
}

async function testConcurrentTransitions() {
    await withBridge({}, async function (bridge) {
        const firstStart = bridge.start();
        const secondStart = bridge.start();
        assert.equal(firstStart, secondStart);
        await firstStart;

        const firstStop = bridge.stop();
        const secondStop = bridge.stop();
        assert.equal(firstStop, secondStop);
        const restart = bridge.start();
        await firstStop;
        await restart;
        assert.equal(bridge.getState(), "running");

        const stopping = bridge.stop();
        const cancelledRestart = bridge.start();
        const finalStop = bridge.stop();
        assert.equal(stopping, finalStop);
        await Promise.all([stopping, cancelledRestart]);
        assert.equal(bridge.getState(), "stopped");
        await bridge.start();
        assert.equal(bridge.getState(), "running");
    });

    await withBridge({}, async function (bridge) {
        const pendingStart = bridge.start();
        const stopDuringStart = bridge.stop();
        await Promise.all([pendingStart, stopDuringStart]);
        assert.equal(bridge.getState(), "stopped");
    });
}

async function testOccupiedPort(kind) {
    const occupied = await listen(net.createServer(), 0);
    let bridge = null;
    try {
        const oppositePort = await unusedPort();
        const occupiedPort = occupied.address().port;
        const options = kind === "http"
            ? { httpPort: occupiedPort, wsPort: oppositePort }
            : { httpPort: oppositePort, wsPort: occupiedPort };
        bridge = isolatedBridge(options);
        const pattern = kind === "http" ? /HTTP server failed to listen.*EADDRINUSE/ : /WebSocket server failed to listen.*EADDRINUSE/;
        await assert.rejects(bridge.start(), pattern);
        assert.equal(bridge.getState(), "stopped");
        assert.equal(bridge.getHttpServer(), null);
        assert.equal(bridge.getWebSocketServer(), null);

        const oppositeProbe = await listen(net.createServer(), oppositePort);
        try {
            assert.equal(oppositeProbe.address().port, oppositePort);
        } finally {
            await close(oppositeProbe);
        }

        await close(occupied);
        await bridge.start();
        assert.equal(bridge.getState(), "running");
    } finally {
        if (bridge) await bridge.stop();
        await close(occupied);
    }
}

async function openWebSocket(port) {
    return new Promise(function (resolve, reject) {
        const socket = new WebSocket("ws://127.0.0.1:" + port);
        socket.once("open", function () { resolve(socket); });
        socket.once("error", reject);
    });
}

async function testActiveWebSocketShutdown() {
    await withBridge({}, async function (bridge) {
        await bridge.start();
        const socket = await openWebSocket(bridge.getWebSocketServer().address().port);
        try {
            const closed = new Promise(function (resolve) { socket.once("close", resolve); });
            await bridge.stop();
            await closed;
            assert.equal(socket.readyState, WebSocket.CLOSED);
        } finally {
            if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
        }
    });
}

async function testBoundedIncompleteHttpShutdown() {
    await withBridge({ shutdownGraceMs: 30 }, async function (bridge) {
        await bridge.start();
        const socket = net.createConnection({
            host: "127.0.0.1",
            port: bridge.getHttpServer().address().port
        });
        try {
            await new Promise(function (resolve, reject) {
                socket.once("connect", resolve);
                socket.once("error", reject);
            });
            socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n");
            const closed = new Promise(function (resolve) { socket.once("close", resolve); });
            const startedAt = Date.now();
            await bridge.stop();
            await closed;
            assert.ok(Date.now() - startedAt < 1000, "shutdown exceeded its bounded grace period");
            assert.equal(socket.destroyed, true);
        } finally {
            socket.destroy();
        }
    });
}

async function testRootWrapperPromise() {
    const rootBridgePath = path.join(__dirname, "..", "bridge.js");
    const implementationPath = path.join(__dirname, "..", "server", "bridge.js");
    const originalLoad = Module._load;
    let starts = 0;
    const expectedReady = Promise.resolve("ready");
    const fakeBridge = {
        start() { starts += 1; return expectedReady; },
        async stop() {}
    };
    Module._load = function (request, parent, isMain) {
        if (parent && parent.filename === rootBridgePath && request === "./server/bridge") {
            return { createBridge() { return fakeBridge; }, HTTP_PORT, WS_PORT };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[require.resolve(rootBridgePath)];
        const wrapper = require(rootBridgePath);
        assert.equal(starts, 1);
        assert.equal(wrapper.startPromise, expectedReady);
        assert.equal(wrapper.ready, expectedReady);
        assert.equal(wrapper.defaultBridge, fakeBridge);
        await wrapper.startPromise;
    } finally {
        Module._load = originalLoad;
        delete require.cache[require.resolve(rootBridgePath)];
        assert.equal(require.cache[require.resolve(implementationPath)].exports, bridgeModule);
    }
}

async function main() {
    testProductionDefaults();
    await testConstructionDoesNotListen();
    await testStartupAndPortRelease();
    await testStartupLibraryLifecycle();
    await testConcurrentTransitions();
    await testOccupiedPort("http");
    await testOccupiedPort("websocket");
    await testActiveWebSocketShutdown();
    await testBoundedIncompleteHttpShutdown();
    await testRootWrapperPromise();
    console.log("LRBridge lifecycle tests passed.");
}

main().catch(function (err) {
    console.error(err.stack || err);
    process.exitCode = 1;
});
