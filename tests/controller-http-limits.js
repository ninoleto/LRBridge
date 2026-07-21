const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const {
    CONTROLLER_HTTP_REQUEST_TIMEOUT_MS,
    CONTROLLER_HTTP_HEADERS_TIMEOUT_MS,
    CONTROLLER_HTTP_KEEP_ALIVE_TIMEOUT_MS,
    CONTROLLER_HTTP_MAX_HEADERS_COUNT,
    applyControllerHttpSettings
} = require("../app/controller-http-settings");
const {
    DEFAULT_UPSTREAM_HOST,
    DEFAULT_UPSTREAM_PORT,
    DEFAULT_TIMEOUT_MS
} = require("../app/controller-proxy");

const root = path.join(__dirname, "..");

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
    });
}

function request(port, options = {}) {
    return new Promise(function (resolve, reject) {
        const outgoing = http.request({
            hostname: "127.0.0.1",
            port,
            path: options.path || "/normal?value=a%2Fb%20c",
            method: options.method || "GET",
            headers: options.headers,
            agent: options.agent
        }, function (response) {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", function (chunk) { body += chunk; });
            response.on("end", function () {
                resolve({ statusCode: response.statusCode, headers: response.headers, body });
            });
        });
        outgoing.once("error", reject);
        if (options.body !== undefined) outgoing.write(options.body);
        outgoing.end();
    });
}

function withDeadline(promise, message, timeoutMs = 1500) {
    return Promise.race([
        promise,
        new Promise(function (_resolve, reject) {
            setTimeout(function () { reject(new Error(message)); }, timeoutMs).unref();
        })
    ]);
}

function testConstantsDefaultsAndPreservedProperties() {
    assert.equal(CONTROLLER_HTTP_REQUEST_TIMEOUT_MS, 15000);
    assert.equal(CONTROLLER_HTTP_HEADERS_TIMEOUT_MS, 10000);
    assert.equal(CONTROLLER_HTTP_KEEP_ALIVE_TIMEOUT_MS, 5000);
    assert.equal(CONTROLLER_HTTP_MAX_HEADERS_COUNT, 64);

    const server = http.createServer();
    const preserved = {
        timeout: server.timeout,
        maxRequestsPerSocket: server.maxRequestsPerSocket,
        keepAliveTimeoutBuffer: server.keepAliveTimeoutBuffer,
        connectionsCheckingInterval: server.connectionsCheckingInterval,
        maxConnections: server.maxConnections
    };

    applyControllerHttpSettings(server);
    assert.equal(server.requestTimeout, 15000);
    assert.equal(server.headersTimeout, 10000);
    assert.equal(server.keepAliveTimeout, 5000);
    assert.equal(server.maxHeadersCount, 64);
    assert.equal(server.timeout, 0);
    assert.equal(server.maxRequestsPerSocket, 0);
    assert.equal(server.keepAliveTimeoutBuffer, preserved.keepAliveTimeoutBuffer);
    assert.equal(server.connectionsCheckingInterval, preserved.connectionsCheckingInterval);
    assert.equal(server.maxConnections, preserved.maxConnections);
}

function testOverridesValidationAndAtomicity() {
    const server = http.createServer();
    applyControllerHttpSettings(server, {
        requestTimeoutMs: 2000,
        headersTimeoutMs: 1000,
        keepAliveTimeoutMs: 750,
        maxHeadersCount: 32
    });
    assert.equal(server.requestTimeout, 2000);
    assert.equal(server.headersTimeout, 1000);
    assert.equal(server.keepAliveTimeout, 750);
    assert.equal(server.maxHeadersCount, 32);

    const optionNames = ["requestTimeoutMs", "headersTimeoutMs", "keepAliveTimeoutMs", "maxHeadersCount"];
    const invalidValues = [0, -1, 1.5, Infinity, NaN, "1000"];
    for (const optionName of optionNames) {
        for (const invalidValue of invalidValues) {
            const target = http.createServer();
            const before = {
                requestTimeout: target.requestTimeout,
                headersTimeout: target.headersTimeout,
                keepAliveTimeout: target.keepAliveTimeout,
                maxHeadersCount: target.maxHeadersCount
            };
            assert.throws(function () {
                applyControllerHttpSettings(target, { [optionName]: invalidValue });
            }, /positive finite integer/);
            assert.deepEqual({
                requestTimeout: target.requestTimeout,
                headersTimeout: target.headersTimeout,
                keepAliveTimeout: target.keepAliveTimeout,
                maxHeadersCount: target.maxHeadersCount
            }, before);
        }
    }

    const atomicTarget = http.createServer();
    const atomicBefore = [
        atomicTarget.requestTimeout,
        atomicTarget.headersTimeout,
        atomicTarget.keepAliveTimeout,
        atomicTarget.maxHeadersCount
    ];
    assert.throws(function () {
        applyControllerHttpSettings(atomicTarget, {
            requestTimeoutMs: 100,
            headersTimeoutMs: 101,
            keepAliveTimeoutMs: 50,
            maxHeadersCount: 8
        });
    }, /must not exceed/);
    assert.deepEqual([
        atomicTarget.requestTimeout,
        atomicTarget.headersTimeout,
        atomicTarget.keepAliveTimeout,
        atomicTarget.maxHeadersCount
    ], atomicBefore);
}

async function testHttpCompatibilityAndVolume() {
    const seen = [];
    const server = http.createServer(function (incoming, response) {
        let body = "";
        incoming.setEncoding("utf8");
        incoming.on("data", function (chunk) { body += chunk; });
        incoming.on("end", function () {
            seen.push({ method: incoming.method, url: incoming.url, body, headers: incoming.headers });
            response.writeHead(207, {
                "Content-Type": "application/problem+json",
                "Cache-Control": "no-store"
            });
            response.end(JSON.stringify({ ok: true, method: incoming.method, url: incoming.url, body }));
        });
    });
    applyControllerHttpSettings(server);
    const port = await listen(server);
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

    try {
        let result = await request(port);
        assert.equal(result.statusCode, 207);
        assert.equal(result.headers["content-type"], "application/problem+json");
        assert.equal(result.headers["cache-control"], "no-store");
        assert.deepEqual(JSON.parse(result.body), {
            ok: true,
            method: "GET",
            url: "/normal?value=a%2Fb%20c",
            body: ""
        });

        result = await request(port, {
            path: "/method?encoded=%E2%9C%93",
            method: "POST",
            body: "unchanged body",
            agent
        });
        assert.deepEqual(JSON.parse(result.body), {
            ok: true,
            method: "POST",
            url: "/method?encoded=%E2%9C%93",
            body: "unchanged body"
        });

        for (let index = 0; index < 5; index += 1) {
            result = await request(port, { path: "/keep-alive/" + index, agent });
            assert.equal(result.statusCode, 207);
        }
        assert.equal(agent.freeSockets["127.0.0.1:" + port + ":"].length, 1);

        const browserHeaders = {
            Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            "Accept-Encoding": "gzip, deflate",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
            Referer: "http://127.0.0.1/",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            "Upgrade-Insecure-Requests": "1",
            "User-Agent": "LRBridge controller test browser"
        };
        result = await request(port, { path: "/browser", headers: browserHeaders });
        assert.equal(result.statusCode, 207);
        assert.equal(seen.at(-1).headers["sec-fetch-mode"], "navigate");

        for (let index = 0; index < 250; index += 1) {
            result = await request(port, { path: "/ordinary/" + index });
            assert.equal(result.statusCode, 207);
        }

        const closed = closeServer(server);
        await withDeadline(closed, "Server did not close with an idle keep-alive client");
    } finally {
        agent.destroy();
        if (server.listening) await closeServer(server);
    }
}

function testSourceIntegrationAndProductionCompatibility() {
    const mainSource = fs.readFileSync(path.join(root, "app", "main.js"), "utf8");
    const bridgeSource = fs.readFileSync(path.join(root, "server", "bridge.js"), "utf8");
    const proxySource = fs.readFileSync(path.join(root, "app", "controller-proxy.js"), "utf8");

    assert.match(mainSource, /require\("\.\/controller-http-settings"\)/);
    assert.match(mainSource, /applyControllerHttpSettings\(controllerServer\);/);
    assert.ok(mainSource.indexOf("applyControllerHttpSettings(controllerServer);") < mainSource.indexOf("controllerServer.listen(controllerPort, controllerListenHost"));
    assert.match(mainSource, /const controllerPort = 17892;/);
    assert.match(mainSource, /const controllerListenHost = "0\.0\.0\.0";/);
    assert.match(mainSource, /const bridgeHttpPort = 17891;/);
    assert.match(mainSource, /proxyControllerRequest\(/);
    assert.match(mainSource, /controllerServer\.close\(\);/);
    assert.match(bridgeSource, /const HTTP_PORT = 17891;/);
    assert.match(bridgeSource, /const WS_PORT = 17890;/);

    assert.equal(DEFAULT_UPSTREAM_HOST, "127.0.0.1");
    assert.equal(DEFAULT_UPSTREAM_PORT, 17891);
    assert.equal(DEFAULT_TIMEOUT_MS, 10000);
    assert.match(proxySource, /method: "GET"/);
}

async function main() {
    testConstantsDefaultsAndPreservedProperties();
    testOverridesValidationAndAtomicity();
    testSourceIntegrationAndProductionCompatibility();
    await testHttpCompatibilityAndVolume();
    console.log("Web Controller HTTP limit tests passed.");
}

main().catch(function (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
});
