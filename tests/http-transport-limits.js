const assert = require("node:assert/strict");
const http = require("node:http");

const commands = require("../server/commands");
const {
    createBridge,
    HTTP_PORT,
    WS_PORT,
    HTTP_REQUEST_TIMEOUT_MS,
    HTTP_HEADERS_TIMEOUT_MS,
    HTTP_KEEP_ALIVE_TIMEOUT_MS,
    HTTP_MAX_HEADERS_COUNT
} = require("../server/bridge");

function makeBridge(extraOptions) {
    return createBridge(Object.assign({
        httpPort: 0,
        wsPort: 0,
        httpHost: "127.0.0.1",
        wsHost: "127.0.0.1",
        shutdownGraceMs: 40
    }, extraOptions));
}

function requestJson(port, path, agent) {
    return new Promise(function (resolve, reject) {
        const request = http.get({
            hostname: "127.0.0.1",
            port: port,
            path: path,
            agent: agent
        }, function (response) {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", function (chunk) { body += chunk; });
            response.on("end", function () {
                try {
                    resolve({
                        statusCode: response.statusCode,
                        headers: response.headers,
                        body: JSON.parse(body)
                    });
                } catch (err) {
                    reject(err);
                }
            });
        });
        request.once("error", reject);
    });
}

function drainQueue() {
    const queued = [];
    let command;
    while ((command = commands.getNextCommand()) !== null) queued.push(command);
    return queued;
}

function testConstantsAndValidation() {
    assert.equal(HTTP_REQUEST_TIMEOUT_MS, 60000);
    assert.equal(HTTP_HEADERS_TIMEOUT_MS, 15000);
    assert.equal(HTTP_KEEP_ALIVE_TIMEOUT_MS, 5000);
    assert.equal(HTTP_MAX_HEADERS_COUNT, 64);
    assert.equal(HTTP_PORT, 17891);
    assert.equal(WS_PORT, 17890);

    const optionNames = [
        "httpRequestTimeoutMs",
        "httpHeadersTimeoutMs",
        "httpKeepAliveTimeoutMs",
        "httpMaxHeadersCount"
    ];
    const invalidValues = [0, -1, 1.5, Infinity, NaN, "1000"];

    for (const optionName of optionNames) {
        for (const invalidValue of invalidValues) {
            assert.throws(function () {
                createBridge({ [optionName]: invalidValue });
            }, /positive finite integer/, optionName + " accepted " + String(invalidValue));
        }
    }

    assert.throws(function () {
        createBridge({ httpRequestTimeoutMs: 100, httpHeadersTimeoutMs: 101 });
    }, /must not exceed/);
}

async function testPropertiesAndRepresentativeRoutes(bridge) {
    await bridge.start();
    const server = bridge.getHttpServer();
    const port = server.address().port;

    assert.equal(server.requestTimeout, 60000);
    assert.equal(server.headersTimeout, 15000);
    assert.equal(server.keepAliveTimeout, 5000);
    assert.equal(server.maxHeadersCount, 64);
    assert.equal(server.timeout, 0);
    assert.equal(server.maxRequestsPerSocket, 0);
    assert.equal(server.address().address, "127.0.0.1");
    assert.equal(bridge.getWebSocketServer().address().address, "127.0.0.1");

    let response = await requestJson(port, "/status");
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);

    response = await requestJson(port, "/diagnostics/queue");
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.body.queue.length, 0);

    response = await requestJson(port, "/adjust?slider=Exposure&amount=2");
    assert.deepEqual(response.body, {
        ok: true,
        queued: { command: "develop.adjust", slider: "Exposure", amount: 2 }
    });
    assert.deepEqual(drainQueue(), [
        { command: "develop.adjust", slider: "Exposure", amount: 2 }
    ]);

    response = await requestJson(port, "/action?action=setAutoTone");
    assert.deepEqual(response.body, {
        ok: true,
        queued: { command: "develop.action", action: "setAutoTone" }
    });
    assert.deepEqual(drainQueue(), [
        { command: "develop.action", action: "setAutoTone" }
    ]);

    response = await requestJson(port, "/command?command=develop.action&action=setAutoTone");
    assert.deepEqual(response.body, {
        ok: true,
        queued: { command: "develop.action", action: "setAutoTone" }
    });
    assert.deepEqual(drainQueue(), [
        { command: "develop.action", action: "setAutoTone" }
    ]);

    response = await requestJson(port, "/command?command=selection.label.set&label=none");
    assert.deepEqual(response.body, {
        ok: true,
        queued: { command: "selection.label.set", label: "none" }
    });
    assert.deepEqual(drainQueue(), [
        { command: "selection.label.set", label: "none" }
    ]);

    response = await requestJson(port, "/feedback/value?slider=Exposure");
    assert.deepEqual(response.body, { ok: true, result: null });

    response = await requestJson(
        port,
        "/context/update?activeModule=develop&selectedPhotoKey=photo-1&developFingerprint=abc"
    );
    assert.equal(response.statusCode, 200);
    assert.deepEqual(drainQueue(), [
        { command: "application.module", module: "library" }
    ]);

    response = await requestJson(port, "/wake-lightroom");
    assert.deepEqual(response.body, {
        ok: true,
        queued: { command: "application.module", module: "library" },
        deprecated: true,
        replacement: "/command?command=application.module&module=library"
    });
    assert.deepEqual(drainQueue(), [
        { command: "application.module", module: "library" }
    ]);

    response = await requestJson(port, "/wake-lightroom");
    assert.equal(response.statusCode, 200);
    assert.deepEqual(drainQueue(), [
        { command: "application.module", module: "library" }
    ]);
}

async function testValidOverrides() {
    const bridge = makeBridge({
        httpRequestTimeoutMs: 2000,
        httpHeadersTimeoutMs: 1000,
        httpKeepAliveTimeoutMs: 750,
        httpMaxHeadersCount: 32
    });

    try {
        await bridge.start();
        const server = bridge.getHttpServer();
        assert.equal(server.requestTimeout, 2000);
        assert.equal(server.headersTimeout, 1000);
        assert.equal(server.keepAliveTimeout, 750);
        assert.equal(server.maxHeadersCount, 32);
        assert.equal(server.timeout, 0);
        assert.equal(server.maxRequestsPerSocket, 0);
    } finally {
        await bridge.stop();
    }
}

async function testRapidPolling(bridge) {
    const port = bridge.getHttpServer().address().port;
    const sentinel = { command: "develop.reset", slider: "Exposure" };
    commands.enqueueCommand(sentinel);

    let response = await requestJson(port, "/feedback/request?slider=Contrast");
    const feedbackRequest = response.body.request;

    for (let index = 0; index < 250; index += 1) {
        const path = index % 2 === 0 ? "/next" : "/feedback/next";
        response = await requestJson(port, path);
        assert.equal(response.statusCode, 200);

        if (index === 0) {
            assert.deepEqual(response.body, { command: sentinel });
        } else if (index === 1) {
            assert.deepEqual(response.body, { ok: true, request: feedbackRequest });
        } else if (path === "/next") {
            assert.deepEqual(response.body, { command: null });
        } else {
            assert.deepEqual(response.body, { ok: true, request: null });
        }
    }
}

async function testCompanionBurst(bridge) {
    const port = bridge.getHttpServer().address().port;

    for (let index = 0; index < 20; index += 1) {
        const response = await requestJson(port, "/adjust?slider=Exposure&amount=1");
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.body, {
            ok: true,
            queued: { command: "develop.adjust", slider: "Exposure", amount: 1 }
        });
    }

    assert.deepEqual(drainQueue(), [
        { command: "develop.adjust", slider: "Exposure", amount: 20 }
    ]);
}

async function testKeepAliveAndStop(bridge) {
    const port = bridge.getHttpServer().address().port;
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

    try {
        for (let index = 0; index < 5; index += 1) {
            const response = await requestJson(port, "/status", agent);
            assert.equal(response.statusCode, 200);
            assert.equal(response.body.ok, true);
        }

        assert.equal(agent.sockets["127.0.0.1:" + port + ":"], undefined);
        assert.equal(agent.freeSockets["127.0.0.1:" + port + ":"].length, 1);
        await bridge.stop();
        assert.equal(bridge.getState(), "stopped");
        assert.equal(bridge.getHttpServer(), null);
        assert.equal(bridge.getWebSocketServer(), null);
    } finally {
        agent.destroy();
    }
}

async function main() {
    testConstantsAndValidation();
    await testValidOverrides();
    commands.resetQueueForTests();
    const bridge = makeBridge();

    try {
        await testPropertiesAndRepresentativeRoutes(bridge);
        await testRapidPolling(bridge);
        await testCompanionBurst(bridge);
        await testKeepAliveAndStop(bridge);
    } finally {
        await bridge.stop();
        commands.resetQueueForTests();
    }

    console.log("LRBridge HTTP transport limit tests passed.");
}

main().catch(function (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
});
