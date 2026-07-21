const assert = require("assert").strict;
const fs = require("fs");
const http = require("http");
const path = require("path");
const { EventEmitter } = require("events");

const {
    DEFAULT_UPSTREAM_HOST,
    DEFAULT_UPSTREAM_PORT,
    DEFAULT_TIMEOUT_MS,
    proxyControllerRequest
} = require("../app/controller-proxy");

const root = path.join(__dirname, "..");

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise(function (promiseResolve, promiseReject) {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
}

function withDeadline(promise, message, timeoutMs = 1500) {
    return new Promise(function (resolve, reject) {
        const timer = setTimeout(function () {
            reject(new Error(message));
        }, timeoutMs);
        promise.then(function (value) {
            clearTimeout(timer);
            resolve(value);
        }, function (err) {
            clearTimeout(timer);
            reject(err);
        });
    });
}

function listen(server) {
    return new Promise(function (resolve, reject) {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", function () {
            server.removeListener("error", reject);
            resolve(server.address().port);
        });
    });
}

function closeServer(server) {
    return new Promise(function (resolve, reject) {
        server.close(function (err) {
            if (err) reject(err);
            else resolve();
        });
        if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    });
}

function createProxyServer(upstreamPort, options = {}) {
    const stats = { writeHead: 0, end: 0 };
    const server = http.createServer(function (request, response) {
        const originalWriteHead = response.writeHead;
        const originalEnd = response.end;
        response.writeHead = function (...args) {
            stats.writeHead += 1;
            return originalWriteHead.apply(this, args);
        };
        response.end = function (...args) {
            stats.end += 1;
            return originalEnd.apply(this, args);
        };
        const operation = proxyControllerRequest(request, response, request.url, {
            upstreamHost: "127.0.0.1",
            upstreamPort,
            timeoutMs: options.timeoutMs || 1000,
            httpRequest: options.httpRequest
        });
        if (options.onProxyOperation) options.onProxyOperation(operation);
    });
    return { server, stats };
}

async function testPrematureUpstreamCloseSettles() {
    const operationSeen = deferred();
    const upstreamClosed = deferred();
    let upstreamCount = 0;
    await withServers(function (_request, response) {
        upstreamCount += 1;
        if (upstreamCount > 1) {
            response.end('{"ok":true}');
            return;
        }
        response.writeHead(200, {
            "Content-Type": "application/json",
            "Content-Length": "32"
        });
        response.write('{"ok":false', function () {
            response.socket.destroy();
        });
        response.once("close", upstreamClosed.resolve);
    }, async function ({ proxyPort, stats }) {
        const downstreamTerminated = new Promise(function (resolve) {
            const outgoing = http.request({ hostname: "127.0.0.1", port: proxyPort, path: "/truncated" });
            outgoing.once("error", function (error) { resolve({ event: "error", error }); });
            outgoing.once("response", function (response) {
                let body = "";
                response.setEncoding("utf8");
                response.on("data", function (chunk) { body += chunk; });
                response.once("end", function () {
                    resolve({ event: "end", statusCode: response.statusCode, body });
                });
                response.once("aborted", function () { resolve({ event: "aborted" }); });
            });
            outgoing.end();
        });

        await withDeadline(upstreamClosed.promise, "Upstream connection did not close");
        const { operation } = await withDeadline(operationSeen.promise, "Proxy operation was not captured");
        let settlements = 0;
        operation.then(function () { settlements += 1; });
        await withDeadline(operation, "Proxy promise remained pending after premature upstream close", 250);
        const terminated = await withDeadline(downstreamTerminated, "Downstream response remained pending after premature upstream close", 250);
        assert.deepEqual(terminated, {
            event: "end",
            statusCode: 500,
            body: '{"ok":false,"error":"Upstream response failed"}'
        });
        await new Promise(function (resolve) { setImmediate(resolve); });
        assert.equal(settlements, 1);
        assert.deepEqual(stats, { writeHead: 1, end: 1 });

        const recovered = await withDeadline(request(proxyPort, "/valid"), "Later valid proxy request did not complete", 250);
        assert.equal(recovered.statusCode, 200);
        assert.equal(recovered.body, '{"ok":true}');
        assert.equal(upstreamCount, 2);
        assert.deepEqual(stats, { writeHead: 2, end: 2 });
    }, {
        timeoutMs: 5000,
        onProxyOperation(operation) { operationSeen.resolve({ operation }); }
    });
}

async function testRepeatedUpstreamFailureAfterHeadersDestroysOnce() {
    const incoming = new EventEmitter();
    incoming.aborted = false;
    const downstream = new EventEmitter();
    downstream.destroyed = false;
    downstream.writableEnded = false;
    downstream.headersSent = true;
    let writeHeadCount = 0;
    let endCount = 0;
    let downstreamDestroyCount = 0;
    downstream.writeHead = function () { writeHeadCount += 1; };
    downstream.end = function () { endCount += 1; };
    downstream.destroy = function () {
        downstreamDestroyCount += 1;
        downstream.destroyed = true;
    };

    const response = new EventEmitter();
    response.destroyed = false;
    response.complete = false;
    response.readableEnded = false;
    response.setEncoding = function () {};
    let responseDestroyCount = 0;
    response.destroy = function () {
        responseDestroyCount += 1;
        response.destroyed = true;
    };

    const outgoing = new EventEmitter();
    outgoing.destroyed = false;
    outgoing.end = function () {};
    let requestDestroyCount = 0;
    outgoing.destroy = function () {
        requestDestroyCount += 1;
        outgoing.destroyed = true;
    };

    const operation = proxyControllerRequest(incoming, downstream, "/partial-downstream", {
        timeoutMs: 1000,
        httpRequest(_options, onResponse) {
            setImmediate(function () { onResponse(response); });
            return outgoing;
        }
    });
    let settlements = 0;
    operation.then(function () { settlements += 1; });
    await new Promise(function (resolve) { setImmediate(resolve); });
    response.emit("aborted");
    response.emit("error", new Error("repeated response error"));
    response.emit("close");
    await withDeadline(operation, "Header-sent response failure did not settle");
    await new Promise(function (resolve) { setImmediate(resolve); });
    assert.equal(settlements, 1);
    assert.equal(writeHeadCount, 0);
    assert.equal(endCount, 0);
    assert.equal(downstreamDestroyCount, 1);
    assert.equal(responseDestroyCount, 1);
    assert.equal(requestDestroyCount, 1);
}

function request(port, requestPath, options = {}) {
    return new Promise(function (resolve, reject) {
        const outgoing = http.request({
            hostname: "127.0.0.1",
            port,
            path: requestPath,
            method: options.method || "GET"
        }, function (response) {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", function (chunk) { body += chunk; });
            response.on("end", function () {
                resolve({ statusCode: response.statusCode, headers: response.headers, body });
            });
        });
        outgoing.once("error", reject);
        outgoing.end();
    });
}

async function withServers(upstreamHandler, test, proxyOptions = {}) {
    const upstream = http.createServer(upstreamHandler);
    const upstreamPort = await listen(upstream);
    const proxy = createProxyServer(upstreamPort, proxyOptions);
    const proxyPort = await listen(proxy.server);
    try {
        await test({ upstream, upstreamPort, proxy: proxy.server, proxyPort, stats: proxy.stats });
    } finally {
        await closeServer(proxy.server);
        await closeServer(upstream);
    }
}

function abortClient(port, requestPath, trigger) {
    return new Promise(function (resolve, reject) {
        const outgoing = http.request({ hostname: "127.0.0.1", port, path: requestPath });
        outgoing.on("error", function () {});
        outgoing.on("close", resolve);
        outgoing.end();
        trigger.promise.then(function () { outgoing.destroy(); }, reject);
    });
}

function testDefaultsAndValidation() {
    assert.equal(DEFAULT_UPSTREAM_HOST, "127.0.0.1");
    assert.equal(DEFAULT_UPSTREAM_PORT, 17891);
    assert.equal(DEFAULT_TIMEOUT_MS, 10000);

    for (const invalid of [0, -1, 1.5, Infinity, NaN, "1000"]) {
        let sent = 0;
        assert.throws(function () {
            proxyControllerRequest({}, {}, "/status", {
                timeoutMs: invalid,
                httpRequest() { sent += 1; }
            });
        }, /positive finite integer/);
        assert.equal(sent, 0);
    }
}

async function testNormalForwarding() {
    let receivedMethod;
    let receivedUrl;
    await withServers(function (request, response) {
        receivedMethod = request.method;
        receivedUrl = request.url;
        response.writeHead(207, { "Content-Type": "application/problem+json", "X-Upstream": "ignored" });
        response.end('{"ok":true,"value":7}');
    }, async function ({ proxyPort, stats }) {
        const result = await request(proxyPort, "/encoded%20path?value=a%2Fb%20c", { method: "POST" });
        assert.equal(receivedMethod, "GET");
        assert.equal(receivedUrl, "/encoded%20path?value=a%2Fb%20c");
        assert.equal(result.statusCode, 207);
        assert.equal(result.headers["content-type"], "application/json; charset=utf-8");
        assert.equal(result.headers["cache-control"], "no-store");
        assert.equal(result.headers["x-upstream"], undefined);
        assert.equal(result.body, '{"ok":true,"value":7}');
        assert.deepEqual(stats, { writeHead: 1, end: 1 });
    });
}

async function testDisconnectBeforeUpstreamResponse() {
    const upstreamSeen = deferred();
    const upstreamAborted = deferred();
    let upstreamCount = 0;
    await withServers(function (request) {
        upstreamCount += 1;
        request.once("aborted", upstreamAborted.resolve);
        upstreamSeen.resolve();
    }, async function ({ proxyPort, stats }) {
        await withDeadline(abortClient(proxyPort, "/slow", upstreamSeen), "Client did not close promptly");
        await withDeadline(upstreamAborted.promise, "Outbound request was not cancelled promptly");
        assert.equal(upstreamCount, 1);
        assert.deepEqual(stats, { writeHead: 0, end: 0 });
    }, { timeoutMs: 5000 });
}

async function testDisconnectAfterUpstreamHeaders() {
    const headersSent = deferred();
    const upstreamResponseClosed = deferred();
    await withServers(function (_request, response) {
        response.once("close", upstreamResponseClosed.resolve);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.write('{"partial":');
        headersSent.resolve();
    }, async function ({ proxyPort, stats }) {
        await withDeadline(abortClient(proxyPort, "/partial", headersSent), "Client did not close after upstream headers");
        await withDeadline(upstreamResponseClosed.promise, "Upstream response was not destroyed");
        assert.deepEqual(stats, { writeHead: 0, end: 0 });
    });
}

async function testUpstreamErrorsAndTimeout() {
    await withServers(function (request) {
        request.socket.destroy();
    }, async function ({ proxyPort, stats }) {
        const result = await request(proxyPort, "/error");
        assert.equal(result.statusCode, 500);
        assert.equal(result.headers["content-type"], "application/json; charset=utf-8");
        const body = JSON.parse(result.body);
        assert.equal(body.ok, false);
        assert.equal(typeof body.error, "string");
        assert.deepEqual(stats, { writeHead: 1, end: 1 });
    });

    await withServers(function () {}, async function ({ proxyPort, stats }) {
        const result = await withDeadline(request(proxyPort, "/timeout"), "Proxy timeout response was not returned");
        assert.equal(result.statusCode, 500);
        assert.deepEqual(JSON.parse(result.body), { ok: false, error: "Request timed out" });
        assert.deepEqual(stats, { writeHead: 1, end: 1 });
    }, { timeoutMs: 40 });
}

async function testErrorAndTimeoutAfterDisconnect() {
    for (const mode of ["error", "timeout"]) {
        const upstreamSeen = deferred();
        let socket;
        await withServers(function (request) {
            socket = request.socket;
            upstreamSeen.resolve();
        }, async function ({ proxyPort, stats }) {
            await withDeadline(abortClient(proxyPort, "/abandoned", upstreamSeen), "Abandoned client did not close");
            if (mode === "error" && socket && !socket.destroyed) socket.destroy(new Error("late upstream error"));
            await new Promise(function (resolve) { setImmediate(resolve); });
            assert.deepEqual(stats, { writeHead: 0, end: 0 });
        }, { timeoutMs: 40 });
    }
}

async function testNormalCloseDoesNotCancelAndProxyRecovers() {
    let count = 0;
    let successfulRequestAborted = false;
    const firstUpstreamSeen = deferred();
    await withServers(function (request, response) {
        count += 1;
        if (count === 1) {
            request.once("aborted", function () {});
            firstUpstreamSeen.resolve();
            return;
        }
        request.once("aborted", function () { successfulRequestAborted = true; });
        response.end('{"ok":true}');
    }, async function ({ proxyPort }) {
        const client = http.request({ hostname: "127.0.0.1", port: proxyPort, path: "/aborted" });
        client.on("error", function () {});
        client.end();
        await withDeadline(firstUpstreamSeen.promise, "First upstream request was not received");
        client.destroy();
        const result = await request(proxyPort, "/fresh");
        assert.equal(result.body, '{"ok":true}');
        await new Promise(function (resolve) { setImmediate(resolve); });
        assert.equal(successfulRequestAborted, false);
        assert.equal(count, 2);
    });
}

async function testLateErrorAndTimeoutAreIgnored() {
    const incoming = new EventEmitter();
    const downstream = new EventEmitter();
    downstream.destroyed = false;
    downstream.writableEnded = false;
    downstream.headersSent = false;
    let writes = 0;
    downstream.writeHead = function () { writes += 1; };
    downstream.end = function () { writes += 1; };

    const outgoing = new EventEmitter();
    outgoing.destroyed = false;
    let destroyCount = 0;
    outgoing.destroy = function () {
        destroyCount += 1;
        outgoing.destroyed = true;
    };
    outgoing.end = function () {};

    const completed = proxyControllerRequest(incoming, downstream, "/late", {
        timeoutMs: 25,
        httpRequest() { return outgoing; }
    });
    incoming.emit("aborted");
    await completed;
    outgoing.emit("timeout");
    outgoing.emit("error", new Error("late error"));
    assert.equal(destroyCount, 1);
    assert.equal(writes, 0);
}

async function testSimultaneousAbortsAndSingleUpstreamRequest() {
    const seen = [];
    let upstreamCount = 0;
    await withServers(function (request) {
        upstreamCount += 1;
        const signal = deferred();
        seen.push(signal);
        signal.resolve();
        request.on("aborted", function () {});
    }, async function ({ proxyPort, stats }) {
        const clients = [];
        for (let index = 0; index < 8; index += 1) {
            const trigger = deferred();
            clients.push(abortClient(proxyPort, "/many?i=" + index, trigger));
            while (seen.length <= index) await new Promise(function (resolve) { setImmediate(resolve); });
            trigger.resolve();
        }
        await withDeadline(Promise.all(clients), "Simultaneous clients did not close");
        assert.equal(upstreamCount, 8);
        assert.deepEqual(stats, { writeHead: 0, end: 0 });
    });
}

function testProductionConfiguration() {
    const mainSource = fs.readFileSync(path.join(root, "app", "main.js"), "utf8");
    const bridgeSource = fs.readFileSync(path.join(root, "server", "bridge.js"), "utf8");
    assert.match(mainSource, /const bridgeHttpPort = 17891;/);
    assert.match(mainSource, /const controllerPort = 17892;/);
    assert.match(mainSource, /const controllerListenHost = "0\.0\.0\.0";/);
    assert.match(mainSource, /controllerServer\.listen\(controllerPort, controllerListenHost/);
    assert.match(bridgeSource, /const WS_PORT = 17890;/);
    assert.match(bridgeSource, /const HTTP_PORT = 17891;/);
}

async function main() {
    const unhandled = [];
    const uncaught = [];
    function onUnhandled(reason) { unhandled.push(reason); }
    function onUncaught(error) { uncaught.push(error); }
    process.on("unhandledRejection", onUnhandled);
    process.on("uncaughtException", onUncaught);
    try {
        testDefaultsAndValidation();
        testProductionConfiguration();
        await testPrematureUpstreamCloseSettles();
        await testRepeatedUpstreamFailureAfterHeadersDestroysOnce();
        await testNormalForwarding();
        await testDisconnectBeforeUpstreamResponse();
        await testDisconnectAfterUpstreamHeaders();
        await testUpstreamErrorsAndTimeout();
        await testErrorAndTimeoutAfterDisconnect();
        await testNormalCloseDoesNotCancelAndProxyRecovers();
        await testLateErrorAndTimeoutAreIgnored();
        await testSimultaneousAbortsAndSingleUpstreamRequest();
        await new Promise(function (resolve) { setImmediate(resolve); });
        assert.deepEqual(unhandled, []);
        assert.deepEqual(uncaught, []);
    } finally {
        process.removeListener("unhandledRejection", onUnhandled);
        process.removeListener("uncaughtException", onUncaught);
    }
    console.log("Web Controller proxy abort and response safety tests passed.");
}

main().catch(function (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
});
