const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const {
    CONTROLLER_SHUTDOWN_GRACE_MS,
    createControllerQuitCoordinator,
    stopControllerServer
} = require("../app/controller-server-lifecycle");

const root = path.join(__dirname, "..");
const TEST_GRACE_MS = 30;

function listen(server) {
    stopControllerServer.register(server);
    return new Promise(function (resolve, reject) {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", function () {
            server.removeListener("error", reject);
            resolve(server.address().port);
        });
    });
}

function connect(port) {
    return new Promise(function (resolve, reject) {
        const socket = net.connect(port, "127.0.0.1");
        socket.once("connect", function () { setImmediate(function () { resolve(socket); }); });
        socket.once("error", reject);
    });
}

function closed(socket) {
    if (socket.destroyed) return Promise.resolve();
    return new Promise(function (resolve) {
        socket.once("close", resolve);
    });
}

function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function fakeQuitEvent() {
    return {
        preventDefaultCalls: 0,
        preventDefault() { this.preventDefaultCalls += 1; }
    };
}

async function testQuitCoordinatorSuccessAndReentry() {
    const server = {};
    let controllerServer = server;
    let clearCalls = 0;
    let stopCalls = 0;
    let resumeCalls = 0;
    let settleStop;
    const stopped = new Promise(function (resolve) { settleStop = resolve; });
    const coordinator = createControllerQuitCoordinator({
        getControllerServer: function () { return controllerServer; },
        clearControllerServer: function () { clearCalls += 1; controllerServer = null; },
        stopControllerServer: function (captured) {
            stopCalls += 1;
            assert.strictEqual(captured, server);
            return stopped;
        },
        resumeQuit: function () { resumeCalls += 1; },
        logShutdownError: function () { assert.fail("successful shutdown must not log"); }
    });

    const first = fakeQuitEvent();
    const pending = coordinator.beforeQuit(first);
    assert.equal(first.preventDefaultCalls, 1);
    assert.equal(clearCalls, 1);
    assert.equal(controllerServer, null);
    assert.equal(stopCalls, 1);

    const repeated = fakeQuitEvent();
    assert.strictEqual(coordinator.beforeQuit(repeated), pending);
    assert.equal(repeated.preventDefaultCalls, 1);
    assert.equal(clearCalls, 1);
    assert.equal(stopCalls, 1);
    assert.equal(resumeCalls, 0);

    settleStop();
    await pending;
    assert.equal(resumeCalls, 1);

    const reentry = fakeQuitEvent();
    assert.equal(coordinator.beforeQuit(reentry), undefined);
    assert.equal(reentry.preventDefaultCalls, 0);
    assert.equal(clearCalls, 1);
    assert.equal(stopCalls, 1);
    assert.equal(resumeCalls, 1);
}

async function testQuitCoordinatorRejectionAndNoServer() {
    const sensitive = "https://secret.invalid/path?token=private headers body command slider photo";
    let controllerServer = {};
    let stopCalls = 0;
    let resumeCalls = 0;
    const logs = [];
    const coordinator = createControllerQuitCoordinator({
        getControllerServer: function () { return controllerServer; },
        clearControllerServer: function () { controllerServer = null; },
        stopControllerServer: function () { stopCalls += 1; return Promise.reject(new Error(sensitive)); },
        resumeQuit: function () { resumeCalls += 1; },
        logShutdownError: function () { logs.push("Web controller shutdown failed."); }
    });
    const event = fakeQuitEvent();
    await coordinator.beforeQuit(event);
    assert.equal(event.preventDefaultCalls, 1);
    assert.equal(stopCalls, 1);
    assert.equal(resumeCalls, 1);
    assert.deepEqual(logs, ["Web controller shutdown failed."]);
    assert.doesNotMatch(logs.join(" "), /secret|token|headers|body|command|slider|photo/i);

    let noServerClears = 0;
    const noServerCoordinator = createControllerQuitCoordinator({
        getControllerServer: function () { return null; },
        clearControllerServer: function () { noServerClears += 1; },
        stopControllerServer: function () { assert.fail("no server must not stop"); },
        resumeQuit: function () { assert.fail("no server must not resume"); },
        logShutdownError: function () { assert.fail("no server must not log"); }
    });
    const noServerEvent = fakeQuitEvent();
    noServerCoordinator.beforeQuit(noServerEvent);
    assert.equal(noServerEvent.preventDefaultCalls, 0);
    assert.equal(noServerClears, 0);
}

async function testValidationAndSafeStates() {
    assert.equal(CONTROLLER_SHUTDOWN_GRACE_MS, 250);
    for (const value of [-1, 1.5, Infinity, NaN, "20"]) {
        let closeCalls = 0;
        const server = { close() { closeCalls += 1; } };
        assert.throws(function () {
            stopControllerServer(server, { shutdownGraceMs: value });
        }, /non-negative finite integer/);
        assert.equal(closeCalls, 0);
    }

    await stopControllerServer(null);
    await stopControllerServer(http.createServer(), { shutdownGraceMs: 0 });

    const closedServer = http.createServer();
    await listen(closedServer);
    await new Promise(function (resolve) { closedServer.close(resolve); });
    await stopControllerServer(closedServer, { shutdownGraceMs: 0 });

    const stopping = http.createServer();
    await listen(stopping);
    const firstClose = new Promise(function (resolve) { stopping.close(resolve); });
    await stopControllerServer(stopping, { shutdownGraceMs: 0 });
    await firstClose;
}

async function testNormalAndRepeatedShutdown() {
    const server = http.createServer(function (request, response) { response.end("ok"); });
    const port = await listen(server);
    let closeCalls = 0;
    const originalClose = server.close;
    server.close = function (...args) {
        closeCalls += 1;
        return originalClose.apply(this, args);
    };
    const first = stopControllerServer(server, { shutdownGraceMs: TEST_GRACE_MS });
    const second = stopControllerServer(server, { shutdownGraceMs: TEST_GRACE_MS });
    assert.strictEqual(first, second);
    await Promise.all([first, second]);
    assert.equal(closeCalls, 1);
    assert.equal(server.listening, false);
    await assert.rejects(connect(port));
}

async function testIdleAndIncompleteConnections() {
    const server = http.createServer(function (request, response) { response.end("ok"); });
    const port = await listen(server);
    const idle = await connect(port);
    idle.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");
    await new Promise(function (resolve) { idle.once("data", resolve); });
    const started = Date.now();
    await stopControllerServer(server, { shutdownGraceMs: 200 });
    await closed(idle);
    assert.ok(Date.now() - started < 180, "idle connection should close promptly");

    const incompleteServer = http.createServer();
    const incompletePort = await listen(incompleteServer);
    const incomplete = await connect(incompletePort);
    incomplete.write("GET / HTTP/1.1\r\nHost: localhost");
    const incompleteStarted = Date.now();
    await stopControllerServer(incompleteServer, { shutdownGraceMs: TEST_GRACE_MS });
    await closed(incomplete);
    assert.ok(Date.now() - incompleteStarted < TEST_GRACE_MS + 150);
}

async function testActiveRequests() {
    let requestSeen;
    const seen = new Promise(function (resolve) { requestSeen = resolve; });
    const stalled = http.createServer(function () { requestSeen(); });
    const stalledPort = await listen(stalled);
    const stalledSocket = await connect(stalledPort);
    stalledSocket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await seen;
    const started = Date.now();
    await stopControllerServer(stalled, { shutdownGraceMs: TEST_GRACE_MS });
    await closed(stalledSocket);
    assert.ok(Date.now() - started >= TEST_GRACE_MS - 5);

    let finishResponse;
    const completing = http.createServer(function (request, response) {
        finishResponse = function () { response.end("finished"); };
    });
    const completingPort = await listen(completing);
    const body = new Promise(async function (resolve, reject) {
        const socket = await connect(completingPort);
        let data = "";
        socket.on("data", function (chunk) { data += chunk; });
        socket.on("end", function () { resolve(data); });
        socket.on("error", reject);
        socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    });
    while (!finishResponse) await delay(1);
    const shutdown = stopControllerServer(completing, { shutdownGraceMs: 100 });
    setTimeout(finishResponse, 15);
    assert.match(await body, /finished/);
    await shutdown;
}

async function testNativeOrderingAndFallback() {
    const events = [];
    let closeCallback;
    const fake = {
        once() {},
        close(callback) { events.push("close"); closeCallback = callback; },
        closeIdleConnections() { events.push("idle"); },
        closeAllConnections() { events.push("all"); closeCallback(); }
    };
    const operation = stopControllerServer(fake, { shutdownGraceMs: 20 });
    assert.deepEqual(events, ["close", "idle"]);
    await delay(5);
    assert.deepEqual(events, ["close", "idle"]);
    await operation;
    assert.deepEqual(events, ["close", "idle", "all"]);

    const fallbackServer = http.createServer(function () {});
    const fallback = new EventEmitter();
    fallback.close = function (callback) { fallbackServer.close(callback); };
    fallbackServer.on("connection", function (socket) { fallback.emit("connection", socket); });
    stopControllerServer.register(fallback);
    const port = await new Promise(function (resolve) {
        fallbackServer.listen(0, "127.0.0.1", function () { resolve(fallbackServer.address().port); });
    });
    const socket = await connect(port);
    socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await stopControllerServer(fallback, { shutdownGraceMs: TEST_GRACE_MS });
    await Promise.race([
        closed(socket),
        delay(200).then(function () { socket.destroy(); assert.fail("fallback did not close socket"); })
    ]);
}

async function testMixedConnectionsAndRaces() {
    const server = http.createServer(function (request, response) {
        if (request.url === "/idle") response.end("idle");
    });
    const port = await listen(server);
    const sockets = await Promise.all([connect(port), connect(port), connect(port), connect(port), connect(port), connect(port)]);
    sockets[0].write("GET /idle HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");
    sockets[1].write("GET /idle HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");
    await Promise.all(sockets.slice(0, 2).map(function (socket) {
        return new Promise(function (resolve) { socket.once("data", resolve); });
    }));
    sockets[2].write("GET / HTTP/1.1\r\nHost:");
    sockets[3].write("GET / HTTP/1.1\r\nHost:");
    sockets[4].write("GET /active HTTP/1.1\r\nHost: localhost\r\n\r\n");
    sockets[5].write("GET /active HTTP/1.1\r\nHost: localhost\r\n\r\n");
    setTimeout(function () { sockets[3].destroy(); }, 10);
    await stopControllerServer(server, { shutdownGraceMs: TEST_GRACE_MS });
    await Promise.all(sockets.map(closed));
}

function testSourceIntegration() {
    const main = fs.readFileSync(path.join(root, "app", "main.js"), "utf8");
    const settings = require("../app/controller-http-settings");
    const proxy = require("../app/controller-proxy");
    assert.match(main, /require\("\.\/controller-server-lifecycle"\)/);
    assert.match(main, /createControllerQuitCoordinator\(\{/);
    assert.match(main, /stopControllerServer: stopControllerServer/);
    assert.equal((main.match(/controllerServer = null;/g) || []).length, 2);
    const beforeQuit = main.slice(main.indexOf('app.on("before-quit"'), main.indexOf('ipcMain.handle("get-initial-state"'));
    assert.equal((beforeQuit.match(/controllerServer = null;/g) || []).length, 0);
    assert.match(beforeQuit, /isQuitting = true;[\s\S]*controllerQuitCoordinator\.beforeQuit\(event\)/);
    assert.doesNotMatch(beforeQuit, /controllerServer = null|stopControllerServer\(|app\.quit\(/);
    const lifecycle = fs.readFileSync(path.join(root, "app", "controller-server-lifecycle.js"), "utf8");
    const coordinatorSource = lifecycle.slice(lifecycle.indexOf("function createControllerQuitCoordinator"));
    assert.match(coordinatorSource, /event\.preventDefault\(\)/);
    assert.match(coordinatorSource, /allowQuit = true;[\s\S]*resumeQuit\(\)/);
    assert.equal((coordinatorSource.match(/resumeQuit\(\)/g) || []).length, 1);
    assert.match(main, /const controllerPort = 17892;/);
    assert.match(main, /const controllerListenHost = "0\.0\.0\.0";/);
    assert.match(main, /controllerServer\.listen\(controllerPort, controllerListenHost/);
    assert.equal(settings.CONTROLLER_HTTP_REQUEST_TIMEOUT_MS, 15000);
    assert.equal(settings.CONTROLLER_HTTP_HEADERS_TIMEOUT_MS, 10000);
    assert.equal(settings.CONTROLLER_HTTP_KEEP_ALIVE_TIMEOUT_MS, 5000);
    assert.equal(settings.CONTROLLER_HTTP_MAX_HEADERS_COUNT, 64);
    assert.equal(proxy.DEFAULT_UPSTREAM_HOST, "127.0.0.1");
    assert.equal(proxy.DEFAULT_UPSTREAM_PORT, 17891);
    assert.equal(proxy.DEFAULT_TIMEOUT_MS, 10000);
    assert.match(fs.readFileSync(path.join(root, "app", "controller-proxy.js"), "utf8"), /method: "GET"/);
}

async function main() {
    const unhandled = [];
    const uncaught = [];
    process.on("unhandledRejection", function (err) { unhandled.push(err); });
    process.on("uncaughtException", function (err) { uncaught.push(err); });
    await testValidationAndSafeStates();
    await testQuitCoordinatorSuccessAndReentry();
    await testQuitCoordinatorRejectionAndNoServer();
    await testNormalAndRepeatedShutdown();
    await testIdleAndIncompleteConnections();
    await testActiveRequests();
    await testNativeOrderingAndFallback();
    await testMixedConnectionsAndRaces();
    testSourceIntegration();
    await delay(10);
    assert.deepEqual(unhandled, []);
    assert.deepEqual(uncaught, []);
    console.log("Controller shutdown tests passed.");
}

main().catch(function (err) {
    console.error(err);
    process.exitCode = 1;
});
