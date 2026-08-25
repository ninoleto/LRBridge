const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");

const { createBridge } = require("../server/bridge");
const realProxy = require("../app/controller-proxy");
const sliders = require("../server/sliders");

const root = path.join(__dirname, "..");

function request(port, requestPath) {
    return new Promise(function (resolve, reject) {
        const outgoing = http.get({ hostname: "127.0.0.1", port, path: requestPath }, function (response) {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", function (chunk) { body += chunk; });
            response.on("end", function () {
                resolve({ statusCode: response.statusCode, headers: response.headers, body });
            });
        });
        outgoing.once("error", reject);
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

function loadControllerServer(backendPort) {
    let source = fs.readFileSync(path.join(root, "app", "main.js"), "utf8");
    source = source.slice(0, source.indexOf("const gotLock = app.requestSingleInstanceLock();"));
    source = source.replace("const controllerPort = 17892;", "const controllerPort = 0;");
    source += "\nmodule.exports = { startControllerServer, getControllerServer: function () { return controllerServer; } };\n";

    const moduleForTest = { exports: {} };
    const context = vm.createContext({
        Buffer,
        URL,
        clearTimeout,
        console,
        module: moduleForTest,
        exports: moduleForTest.exports,
        __dirname: path.join(root, "app"),
        process,
        require(requestName) {
            if (requestName === "electron") {
                return {
                    app: { isPackaged: false, quit() {} },
                    BrowserWindow: function () {},
                    Tray: function () {},
                    Menu: {},
                    ipcMain: {},
                    shell: {},
                    clipboard: {}
                };
            }
            if (requestName === "./controller-proxy") {
                return {
                    proxyControllerRequest(incoming, outgoing, pathAndQuery) {
                        return realProxy.proxyControllerRequest(incoming, outgoing, pathAndQuery, {
                            upstreamPort: backendPort
                        });
                    }
                };
            }
            if (requestName.startsWith("./")) return require(path.join(root, "app", requestName));
            return require(requestName);
        },
        setImmediate,
        setTimeout
    });
    vm.runInContext(source, context, { filename: path.join(root, "app", "main.js") });
    return moduleForTest.exports;
}

async function supplyResult(backendPort, id, slider, definition, unavailable) {
    const photoIdentity = slider === "ProfileAmount"
        ? "&selectedPhotoKey=feedback-proxy-photo&selectedPhotoUuid=feedback-proxy-photo"
        : "";
    const resultPath = (unavailable
        ? "/feedback/result?id=" + id + "&slider=" + encodeURIComponent(slider) + "&available=0"
        : "/feedback/result?id=" + id + "&slider=" + encodeURIComponent(slider) +
            "&value=" + encodeURIComponent(String(definition.min)) +
            "&min=" + encodeURIComponent(String(definition.min)) +
            "&max=" + encodeURIComponent(String(definition.max))) + photoIdentity;
    assert.equal((await request(backendPort, resultPath)).statusCode, 200);
}

async function main() {
    const bridge = createBridge({
        httpPort: 0,
        wsPort: 0,
        httpHost: "127.0.0.1",
        wsHost: "127.0.0.1"
    });
    await bridge.start();
    const backendPort = bridge.getHttpServer().address().port;
    const controller = loadControllerServer(backendPort);
    controller.startControllerServer();
    const controllerServer = controller.getControllerServer();
    if (!controllerServer.listening) {
        await new Promise(function (resolve) { controllerServer.once("listening", resolve); });
    }
    const controllerPort = controllerServer.address().port;

    try {
        let response = await request(controllerPort, "/api/color-grading/metadata");
        assert.equal(response.statusCode, 200);
        const colorMetadata = JSON.parse(response.body).colorGrading;
        assert.deepEqual(Object.keys(colorMetadata.regions), ["shadows", "midtones", "highlights", "global"]);
        assert.deepEqual(colorMetadata.views, ["3-way", "shadow", "midtone", "highlight", "global"]);
        response = await request(controllerPort, "/api/color-grading/request");
        assert.equal(response.statusCode, 200);
        const colorRequestId = JSON.parse(response.body).request.id;
        response = await request(controllerPort, "/api/color-grading/snapshot?id=" + colorRequestId);
        assert.equal(response.statusCode, 200);
        assert.equal(JSON.parse(response.body).snapshot.complete, false);

        response = await request(controllerPort, "/api/treatment/request");
        assert.equal(response.statusCode, 200);
        const treatmentRequestId = JSON.parse(response.body).request.id;
        response = await request(controllerPort, "/api/treatment/snapshot?id=" + treatmentRequestId);
        assert.deepEqual(JSON.parse(response.body), { id: treatmentRequestId, status: "pending", grayscale: null });
        response = await request(backendPort,
            "/treatment/result?id=" + treatmentRequestId + "&status=available&grayscale=true");
        assert.equal(response.statusCode, 200);
        assert.deepEqual(JSON.parse(response.body), { id: treatmentRequestId, status: "available", grayscale: true });
        response = await request(controllerPort, "/api/treatment/snapshot?id=" + treatmentRequestId);
        assert.deepEqual(JSON.parse(response.body), { id: treatmentRequestId, status: "available", grayscale: true });
        assert.equal((await request(backendPort,
            "/treatment/result?id=" + treatmentRequestId + "&status=available&grayscale=maybe")).statusCode, 400);
        response = await request(backendPort,
            "/treatment/result?id=" + treatmentRequestId + "&status=available&grayscale=false");
        assert.deepEqual(JSON.parse(response.body), { id: treatmentRequestId, status: "available", grayscale: false });

        response = await request(controllerPort, "/api/feedback/request-many?sliders=Exposure,Contrast");
        assert.equal(response.statusCode, 200);
        const requestId = JSON.parse(response.body).request.id;
        await supplyResult(backendPort, requestId, "Exposure", { min: -5, max: 5 }, false);
        await supplyResult(backendPort, requestId, "Contrast", null, true);

        const direct = await request(backendPort, "/feedback/snapshot?id=" + requestId);
        const proxied = await request(controllerPort, "/api/feedback/snapshot?id=" + requestId);
        assert.equal(direct.statusCode, 200);
        assert.equal(proxied.statusCode, 200);
        assert.match(proxied.headers["content-type"], /^application\/json/);
        assert.equal(direct.headers["cache-control"], "no-store");
        assert.equal(proxied.headers["cache-control"], "no-store");
        assert.deepEqual(JSON.parse(proxied.body), JSON.parse(direct.body));
        const smallSnapshot = JSON.parse(proxied.body).snapshot;
        assert.equal(smallSnapshot.complete, true);
        assert.equal(smallSnapshot.results.Exposure.value, -5);
        assert.equal(smallSnapshot.results.Contrast.available, false);

        response = await request(controllerPort, "/api/feedback/snapshot?id=999999");
        assert.equal(response.statusCode, 404);
        assert.deepEqual(JSON.parse(response.body), {
            ok: false,
            error: "Unknown feedback snapshot"
        });
        for (const badPath of [
            "/api/feedback/snapshot",
            "/api/feedback/snapshot?id=",
            "/api/feedback/snapshot?id=bad",
            "/api/feedback/snapshot?id=1.5",
            "/api/feedback/snapshot?id=1&id=2",
            "/api/feedback/snapshot?id=1&extra=true"
        ]) {
            response = await request(controllerPort, badPath);
            assert.equal(response.statusCode, 400);
            assert.deepEqual(JSON.parse(response.body), {
                ok: false,
                error: "Missing or invalid id"
            });
        }

        const definitions = sliders.getAll().filter(function (definition) {
            return definition.feedbackSupported === true;
        });
        response = await request(backendPort,
            "/context/update?activeModule=develop&selectedPhotoKey=feedback-proxy-photo" +
            "&selectedPhotoUuid=feedback-proxy-photo&selectedPhotoPath=feedback-proxy-photo.dng" +
            "&developFingerprint=feedback-proxy-revision");
        assert.equal(response.statusCode, 200);
        const startedAt = Date.now();
        response = await request(
            controllerPort,
            "/api/feedback/request-many?sliders=" +
                encodeURIComponent(definitions.map(function (definition) { return definition.id; }).join(","))
        );
        assert.equal(response.statusCode, 200);
        const fullRequest = JSON.parse(response.body).request;
        for (const definition of definitions) {
            await supplyResult(backendPort, fullRequest.id, definition.id, definition, false);
        }
        response = await request(controllerPort, "/api/feedback/snapshot?id=" + fullRequest.id);
        assert.equal(response.statusCode, 200);
        const fullSnapshot = JSON.parse(response.body).snapshot;
        const returned = Object.keys(fullSnapshot.results);
        const missing = definitions
            .map(function (definition) { return definition.id; })
            .filter(function (id) { return !returned.includes(id); });
        assert.equal(fullSnapshot.complete, true);
        assert.equal(returned.length, definitions.length);
        assert.deepEqual(missing, []);

        console.log("Controller feedback snapshot proxy test passed.");
        console.log(
            "Direct backend: http://127.0.0.1:" + backendPort + "/feedback/snapshot?id=" + requestId +
            " -> " + direct.statusCode + " " + direct.headers["content-type"] +
            ", Cache-Control=" + direct.headers["cache-control"] + ", body=" + direct.body
        );
        console.log(
            "Controller proxy: http://127.0.0.1:" + controllerPort + "/api/feedback/snapshot?id=" + requestId +
            " -> " + proxied.statusCode + " " + proxied.headers["content-type"] +
            ", Cache-Control=" + proxied.headers["cache-control"] + ", body=" + proxied.body
        );
        console.log(
            "Small snapshot: requested 2, returned " + Object.keys(smallSnapshot.results).length +
            "; full snapshot: requested " + definitions.length +
            ", returned " + returned.length +
            ", complete " + fullSnapshot.complete +
            ", missing " + JSON.stringify(missing) +
            ", elapsed " + (Date.now() - startedAt) + " ms."
        );
    } finally {
        if (controllerServer.listening) await closeServer(controllerServer);
        await bridge.stop();
    }
}

main().catch(function (err) {
    console.error(err);
    process.exitCode = 1;
});
