const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const fixture = readJson("tests/contract-fixture.json");
const packageJson = readJson("package.json");
const sliders = readJson("config/sliders.json");

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
    return JSON.parse(read(relativePath));
}

function hash(value) {
    return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sorted(value) {
    return Array.from(value).sort();
}

function keys(value) {
    return Object.keys(value).sort();
}

function extractLuaMap(source, declaration, closingMarker) {
    const start = source.indexOf(declaration);
    const end = source.indexOf(closingMarker, start);
    assert.notEqual(start, -1, "Missing Lua declaration: " + declaration);
    assert.notEqual(end, -1, "Missing Lua closing marker after: " + declaration);
    const block = source.slice(start, end);
    return Array.from(block.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*)\s*=\s*"/gm), (match) => match[1]);
}

function extractLuaList(source, declaration, closingMarker) {
    const start = source.indexOf(declaration);
    const end = source.indexOf(closingMarker, start);
    assert.notEqual(start, -1, "Missing Lua list: " + declaration);
    assert.notEqual(end, -1, "Missing Lua list closing marker after: " + declaration);
    return Array.from(source.slice(start, end).matchAll(/^\s{4}"([^"]+)"/gm), (match) => match[1]);
}

function extractNodeStringArray(source, declaration) {
    const start = source.indexOf(declaration);
    const end = source.indexOf("];", start);
    assert.notEqual(start, -1, "Missing Node array: " + declaration);
    assert.notEqual(end, -1, "Missing Node array closing marker: " + declaration);
    return Array.from(source.slice(start, end).matchAll(/"([^"]+)"/g), (match) => match[1]);
}

function extractJavaScriptValue(source, declaration) {
    const start = source.indexOf(declaration);
    const end = source.indexOf(";", start);
    assert.notEqual(start, -1, "Missing JavaScript declaration: " + declaration);
    assert.notEqual(end, -1, "Missing JavaScript declaration terminator: " + declaration);
    const expression = source.slice(start + declaration.length, end).trim();
    return vm.runInNewContext("(" + expression + ")");
}

function validateStaticContract() {
    assert.equal(packageJson.version, fixture.version, "Application version drifted");

    const ids = sliders.map((slider) => slider.id);
    const groups = Array.from(new Set(sliders.map((slider) => slider.group)));

    assert.equal(sliders.length, fixture.sliderCount, "Slider count drifted");
    assert.equal(new Set(ids).size, ids.length, "Slider IDs must be unique");
    assert.equal(hash(ids), fixture.sliderIdsSha256, "Public slider IDs or their order drifted");
    assert.deepEqual(groups, fixture.groups, "Slider group names or order drifted");
    assert.equal(hash(groups), fixture.groupsSha256, "Slider groups drifted");

    for (const slider of sliders) {
        assert.equal(typeof slider.id, "string", "Slider ID must be a string");
        assert.ok(slider.id.length > 0, "Slider ID must not be empty");
        assert.equal(typeof slider.label, "string", slider.id + " must have a label");
        assert.ok(fixture.groups.includes(slider.group), slider.id + " has an invalid group");
        assert.equal(typeof slider.min, "number", slider.id + " min must be numeric");
        assert.equal(typeof slider.max, "number", slider.id + " max must be numeric");
        assert.equal(typeof slider.default, "number", slider.id + " default must be numeric");
        assert.ok(Number.isFinite(slider.min), slider.id + " min must be finite");
        assert.ok(Number.isFinite(slider.max), slider.id + " max must be finite");
        assert.ok(Number.isFinite(slider.default), slider.id + " default must be finite");
        assert.ok(slider.min <= slider.max, slider.id + " has an inverted range");
        assert.ok(slider.default >= slider.min && slider.default <= slider.max, slider.id + " default is outside its range");
    }

    const commandsSource = read("server/commands.js");
    assert.deepEqual(
        extractNodeStringArray(commandsSource, "const allowedActions = ["),
        fixture.actions,
        "Node action names drifted"
    );
    assert.deepEqual(
        extractNodeStringArray(commandsSource, "const allowedCommands = ["),
        fixture.commands,
        "WebSocket/queue command names drifted"
    );

    const driverSource = read("lightroom/LRBridge.lrplugin/Driver.lua");
    const querySource = read("lightroom/LRBridge.lrplugin/Query.lua");
    const feedbackSource = read("lightroom/LRBridge.lrplugin/FeedbackPolling.lua");
    const driverIds = extractLuaMap(driverSource, "local sliderMap = {", "}\n\nlocal function prepareDevelopSlider");
    const queryIds = extractLuaMap(querySource, "local developControllerMap = {", "}\n\nfunction Query.getDevelopValue");
    const feedbackIds = extractLuaList(feedbackSource, "local watchedSliders = {", "}\n\nlocal lastSentValues");
    const readableIds = ids.filter((id) => !fixture.nonReadableSliders.includes(id));

    assert.deepEqual(driverIds, ids, "Lua Driver slider map drifted from sliders.json");
    assert.deepEqual(sorted(queryIds), sorted(readableIds), "Lua Query readable slider set drifted from the baseline");
    assert.deepEqual(feedbackIds, queryIds, "Lua feedback slider order or definitions drifted from Lua Query");

    const luaActions = Array.from(driverSource.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*)\s*=\s*function\(\)/gm), (match) => match[1]);
    assert.deepEqual(luaActions, fixture.actions, "Lua Driver actions drifted from Node actions");

    const controllerSource = read("app/controller.html");
    const generatedDoc = read("docs/COMPANION_HTTP_CHEATSHEET.md");
    const generatorSource = read("tools/generate-companion-cheatsheet.js");
    const companionBuilderSource = read("app/companion-cheatsheet.html");
    const controllerSliderGroups = extractJavaScriptValue(controllerSource, "const sliderGroups =");
    const controllerActionGroups = extractJavaScriptValue(controllerSource, "const sliderActionGroups =");
    const controllerSwitchGroups = extractJavaScriptValue(controllerSource, "const switchGroups =");
    const controllerToolTabs = extractJavaScriptValue(controllerSource, "const toolTabs =");
    const controllerSliderReferences = controllerSliderGroups.flatMap((group) => group.sliders)
        .concat(controllerSwitchGroups.flatMap((group) => group.switches.map((item) => item.slider)));
    const controllerActionReferences = controllerActionGroups.flatMap((group) => group.actions.map((item) => item.action))
        .concat(controllerToolTabs.flatMap((tab) => tab.actions.map((item) => item.action)));
    for (const id of controllerSliderReferences) {
        assert.ok(ids.includes(id), "Web Controller references unknown slider " + id);
    }
    for (const action of controllerActionReferences) {
        assert.ok(fixture.actions.includes(action), "Web Controller references unknown action " + action);
    }
    const expectedControllerSliders = ids.filter((id) => !fixture.webControllerExcludedSliders.includes(id));
    assert.equal(new Set(controllerSliderReferences).size, controllerSliderReferences.length, "Web Controller slider definitions must be unique");
    assert.deepEqual(sorted(controllerSliderReferences), sorted(expectedControllerSliders), "Web Controller slider definitions drifted");
    assert.equal(new Set(controllerActionReferences).size, controllerActionReferences.length, "Web Controller action definitions must be unique");
    assert.deepEqual(sorted(controllerActionReferences), sorted(fixture.actions), "Web Controller action definitions drifted");
    for (const id of expectedControllerSliders) {
        assert.ok(generatedDoc.includes("slider=" + id), "Generated Companion document is missing slider " + id);
    }
    for (const id of fixture.webControllerExcludedSliders) {
        assert.ok(!controllerSliderReferences.includes(id), "Web Controller exclusion changed for " + id);
        assert.ok(!generatedDoc.includes("slider=" + id), "Generated Companion document exclusion changed for " + id);
        assert.ok(generatorSource.includes('item.id === "' + id + '"'), "Companion generator exclusion is missing for " + id);
        assert.ok(companionBuilderSource.includes('slider.id !== "' + id + '"'), "HTML Companion builder exclusion is missing for " + id);
    }
    for (const action of fixture.actions) {
        assert.ok(controllerSource.includes('"' + action + '"'), "Web Controller is missing action " + action);
        assert.ok(generatedDoc.includes("action=" + action), "Generated Companion document is missing action " + action);
    }

    const mainSource = read("app/main.js");
    const settingsSource = read("lightroom/LRBridge.lrplugin/Settings.lua");
    const settingsText = read("config/settings.txt").trim();
    assert.ok(mainSource.includes("const bridgeHttpPort = " + fixture.ports.http + ";"));
    assert.ok(mainSource.includes("const controllerPort = " + fixture.ports.webController + ";"));
    assert.ok(mainSource.includes("const defaultPollingMs = " + fixture.settings.defaultMs + ";"));
    assert.ok(mainSource.includes("const minPollingMs = " + fixture.settings.minimumMs + ";"));
    assert.ok(mainSource.includes("const maxPollingMs = " + fixture.settings.maximumMs + ";"));
    assert.equal(settingsText, fixture.settings.field + "=" + fixture.settings.defaultMs);
    assert.ok(settingsSource.includes("local defaultPollIntervalMs = " + fixture.settings.defaultMs));
    assert.ok(settingsSource.includes("local minPollIntervalMs = " + fixture.settings.minimumMs));
    assert.ok(settingsSource.includes("local maxPollIntervalMs = " + fixture.settings.maximumMs));

    const builder = read("electron-builder.yml");
    const portableScript = read("tools/make-portable-zip.ps1");
    assert.ok(builder.includes("target: dir"), "Windows build must remain a directory target");
    assert.ok(builder.includes("- x64"), "Windows build must retain x64 architecture");
    assert.ok(portableScript.includes('dist\\win-unpacked'), "Portable source path drifted");
    assert.ok(portableScript.includes('LRBridge-$version-win-x64-portable'), "Portable name drifted");
    for (const requiredPath of fixture.portable.required) {
        assert.ok(portableScript.includes('"' + requiredPath + '"'), "Portable validation is missing " + requiredPath);
    }
}

async function captureBridge() {
    const routes = new Map();
    let websocketServer = null;
    let httpListenPort = null;

    const fakeApp = {
        get(route, handler) {
            routes.set(route, handler);
        },
        listen(port, callback) {
            httpListenPort = port;
            const server = new (require("events").EventEmitter)();
            server.address = function () { return { port: port }; };
            server.close = function (closeCallback) { if (closeCallback) closeCallback(); };
            queueMicrotask(function () {
                server.emit("listening");
                if (callback) callback();
            });
            return server;
        }
    };

    function expressMock() {
        return fakeApp;
    }

    class FakeWebSocketServer extends (require("events").EventEmitter) {
        constructor(options) {
            super();
            this.options = options;
            websocketServer = this;
            this.clients = new Set();
            queueMicrotask(() => this.emit("listening"));
        }

        on(event, handler) {
            return super.on(event, handler);
        }

        address() { return { port: this.options.port }; }
        close(callback) { if (callback) callback(); }
    }

    const originalLoad = Module._load;
    const originalLog = console.log;
    Module._load = function (request, parent, isMain) {
        if (parent && parent.filename === path.join(root, "server/bridge.js")) {
            if (request === "express") return expressMock;
            if (request === "ws") return { Server: FakeWebSocketServer };
            if (request === "./lightroomWake") {
                return {
                    startWatcher() {},
                    stopWatcher() {},
                    async wakeLightroom() {
                        return { ok: true, pid: 1234, stdout: "Wake complete", stderr: "", error: null };
                    }
                };
            }
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    console.log = function () {};

    try {
        delete require.cache[require.resolve(path.join(root, "server/bridge.js"))];
        delete require.cache[require.resolve(path.join(root, "server/commands.js"))];
        delete require.cache[require.resolve(path.join(root, "server/context.js"))];
        const bridgeModule = require(path.join(root, "server/bridge.js"));
        const bridge = bridgeModule.createBridge();
        await bridge.start();
    } finally {
        Module._load = originalLoad;
        console.log = originalLog;
    }

    websocketServer.handlers = {};
    for (const event of websocketServer.eventNames()) {
        const listeners = websocketServer.listeners(event);
        if (listeners.length > 0) websocketServer.handlers[event] = listeners[listeners.length - 1];
    }
    return { routes, websocketServer, httpListenPort };
}

function fakeResponse() {
    return {
        statusCode: 200,
        body: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

async function request(captured, route, query) {
    const response = fakeResponse();
    const handler = captured.routes.get(route);
    assert.ok(handler, "Missing captured route " + route);
    const originalLog = console.log;
    console.log = function () {};
    try {
        await handler({ query: query || {} }, response);
    } finally {
        console.log = originalLog;
    }
    assert.notEqual(response.body, undefined, route + " did not return JSON");
    return response;
}

async function drainCommands(captured, expectedCount) {
    const commands = [];
    for (let index = 0; index < expectedCount; index += 1) {
        commands.push((await request(captured, "/next")).body.command);
    }
    assert.deepEqual((await request(captured, "/next")).body, { command: null }, "Mocked command queue was not fully drained");
    return commands;
}

async function validateHttpAndWebSocketContract() {
    const captured = await captureBridge();
    assert.equal(captured.httpListenPort, fixture.ports.http, "HTTP default port drifted");
    assert.equal(captured.websocketServer.options.port, fixture.ports.webSocket, "WebSocket default port drifted");
    assert.deepEqual(Array.from(captured.routes.keys()), fixture.routes, "HTTP route set or order drifted");

    let result = await request(captured, "/");
    assert.deepEqual(result.body, { name: "LRBridge", ok: true, httpPort: 17891, wsPort: 17890, help: "/help" });

    result = await request(captured, "/help");
    assert.deepEqual(keys(result.body), ["experimentalEndpoints", "mode", "name", "notes", "reliableEndpoints", "sourceOfTruth"]);

    result = await request(captured, "/status");
    assert.deepEqual(keys(result.body), ["activeModule", "contextChangedAt", "contextCounter", "developChangedAt", "developCounter", "hasLatestResult", "lastHeartbeatAt", "ok", "queueLength", "selectedPhotoKey", "supportedSliders"]);
    assert.deepEqual(result.body.supportedSliders, sliders.map((slider) => slider.id));

    result = await request(captured, "/context");
    assert.deepEqual(keys(result.body), ["activeModule", "contextChangedAt", "contextCounter", "developChangedAt", "developCounter", "lastHeartbeatAt", "ok", "queueLength", "selectedPhotoKey"]);

    result = await request(captured, "/sliders");
    assert.deepEqual(keys(result.body), ["sliders"]);
    assert.deepEqual(result.body.sliders, sliders);

    result = await request(captured, "/groups");
    assert.deepEqual(result.body, { groups: fixture.groups });

    result = await request(captured, "/adjust", { slider: "Exposure", amount: "2" });
    assert.deepEqual(result.body, { ok: true, queued: { command: "develop.adjust", slider: "Exposure", amount: 2 } });
    result = await request(captured, "/next");
    assert.deepEqual(result.body, { command: { command: "develop.adjust", slider: "Exposure", amount: 2 } });

    result = await request(captured, "/reset", { slider: "Exposure" });
    assert.deepEqual(result.body, { ok: true, queued: { command: "develop.reset", slider: "Exposure" } });
    assert.deepEqual((await request(captured, "/next")).body.command, { command: "develop.reset", slider: "Exposure" });

    result = await request(captured, "/action", { action: "setAutoTone" });
    assert.deepEqual(result.body, { ok: true, queued: { command: "develop.action", action: "setAutoTone" } });
    assert.deepEqual((await request(captured, "/next")).body.command, { command: "develop.action", action: "setAutoTone" });

    result = await request(captured, "/get", { slider: "Exposure" });
    assert.deepEqual(result.body, { ok: true, queued: { command: "develop.get", slider: "Exposure" } });
    await request(captured, "/next");

    result = await request(captured, "/set", { slider: "Exposure", value: "1" });
    assert.equal(result.statusCode, 400);
    assert.deepEqual(keys(result.body), ["error", "hint", "ok"]);

    result = await request(captured, "/set", { slider: "Exposure", value: "1", experimental: "1" });
    assert.deepEqual(result.body, { ok: true, queued: { command: "develop.set", slider: "Exposure", value: 1 }, experimental: true });
    await request(captured, "/next");

    result = await request(captured, "/adjust", { slider: "BadSlider", amount: "1" });
    assert.equal(result.statusCode, 400);
    assert.deepEqual(keys(result.body), ["error", "ok", "rejected"]);

    result = await request(captured, "/command", { command: "develop.adjust", slider: "Exposure", amount: "3" });
    assert.deepEqual(result.body, { ok: true, queued: { command: "develop.adjust", slider: "Exposure", amount: 3 } });
    await request(captured, "/next");

    result = await request(captured, "/reset-group", { group: "Basic" });
    const expectedGroupResets = sliders
        .filter((slider) => slider.group === "Basic")
        .map((slider) => ({ command: "develop.reset", slider: slider.id }));
    assert.deepEqual(keys(result.body), ["group", "ok", "queued", "queuedCount"]);
    assert.equal(result.body.group, "Basic");
    assert.equal(result.body.queuedCount, expectedGroupResets.length);
    assert.deepEqual(result.body.queued, expectedGroupResets);
    assert.deepEqual(await drainCommands(captured, expectedGroupResets.length), expectedGroupResets);

    result = await request(captured, "/reset-all");
    const expectedAllResets = sliders.map((slider) => ({ command: "develop.reset", slider: slider.id }));
    assert.deepEqual(keys(result.body), ["ok", "queued", "queuedCount"]);
    assert.equal(result.body.queuedCount, expectedAllResets.length);
    assert.deepEqual(result.body.queued, expectedAllResets);
    assert.deepEqual(await drainCommands(captured, expectedAllResets.length), expectedAllResets);

    result = await request(captured, "/context/update", { activeModule: "develop", selectedPhotoKey: "photo-1", developFingerprint: "abc" });
    assert.deepEqual(keys(result.body), ["activeModule", "contextChangedAt", "contextCounter", "developChangedAt", "developCounter", "lastHeartbeatAt", "ok", "queueLength", "selectedPhotoKey"]);

    result = await request(captured, "/result", { command: "develop.get.result", slider: "Exposure", value: "1.25" });
    assert.deepEqual(result.body, { ok: true });
    result = await request(captured, "/last-result");
    assert.deepEqual(result.body, { result: { command: "develop.get.result", slider: "Exposure", value: 1.25 } });

    result = await request(captured, "/feedback/request", { slider: "Exposure" });
    assert.deepEqual(keys(result.body), ["ok", "request"]);
    assert.deepEqual(keys(result.body.request), ["id", "requestedAt", "slider"]);
    const feedbackId = result.body.request.id;
    result = await request(captured, "/feedback/next");
    assert.equal(result.body.request.id, feedbackId);
    result = await request(captured, "/feedback/result", { id: String(feedbackId), slider: "Exposure", value: "0.5" });
    assert.deepEqual(keys(result.body), ["ok", "result"]);
    result = await request(captured, "/feedback/value", { slider: "Exposure" });
    assert.equal(result.body.result.value, 0.5);
    result = await request(captured, "/feedback/all");
    assert.deepEqual(keys(result.body), ["ok", "values"]);

    result = await request(captured, "/feedback/request-all");
    assert.deepEqual(keys(result.body), ["ok", "request"]);
    assert.equal((await request(captured, "/feedback/next")).body.request.slider, "__all__");
    result = await request(captured, "/feedback/request-many", { sliders: "Exposure,Contrast,BadSlider" });
    assert.deepEqual(keys(result.body), ["count", "ok", "request", "sliders"]);
    assert.deepEqual(result.body.sliders, ["Exposure", "Contrast"]);
    assert.equal((await request(captured, "/feedback/next")).body.request.slider, "__many__:Exposure,Contrast");

    result = await request(captured, "/wake-lightroom");
    assert.deepEqual(keys(result.body), ["error", "ok", "pid", "stderr", "stdout"]);

    const connectionHandler = captured.websocketServer.handlers.connection;
    assert.equal(typeof connectionHandler, "function", "WebSocket connection handler is missing");
    for (const command of [
        { command: "develop.adjust", slider: "Exposure", amount: 1 },
        { command: "develop.get", slider: "Exposure" },
        { command: "develop.set", slider: "Exposure", value: 1 },
        { command: "develop.reset", slider: "Exposure" },
        { command: "develop.action", action: "setAutoTone" }
    ]) {
        const socket = {
            handlers: {},
            on(event, handler) { this.handlers[event] = handler; }
        };
        connectionHandler(socket);
        socket.handlers.message(Buffer.from(JSON.stringify(command)));
        assert.deepEqual((await request(captured, "/next")).body.command, command);
    }
}

async function main() {
    validateStaticContract();
    await validateHttpAndWebSocketContract();
    console.log("LRBridge v0.5.1 contract baseline passed.");
    console.log("Validated 26 HTTP routes, 5 command formats, 11 actions, 11 groups, and 96 sliders.");
}

main().catch(function (error) {
    console.error(error.stack || error);
    process.exit(1);
});
