"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");

const projectRoot = path.join(__dirname, "..");
const appRoot = path.join(projectRoot, "app");
const sliderDefinitions = JSON.parse(fs.readFileSync(path.join(projectRoot, "config", "sliders.json"), "utf8"));
const colorGrading = require("../server/color-grading");
const lensBlurState = require("../server/lens-blur-state");
const enhanceState = require("../server/enhance-state");
const pointColorState = require("../server/point-color-state");
const toneCurveLayoutProbe = require("./controller-tone-curve-layout-probe");
const maskingGrainBrowser = require("./masking-grain-browser");
const historyBrowser = require("./controller-history-browser");
const maskCreateBrowser = require("./controller-mask-create-browser");
const removeBrowser = require("./controller-remove-browser");
const redEyeBrowser = require("./controller-red-eye-browser");
const exportBrowser = require("./controller-export-browser");

const operationTimeoutMs = 7000;
const fixturePhotoUuid = "browser-lifecycle-photo";
const fixtureContextCounter = 12;
const fixtureDevelopCounter = 18;
const fixtureContextChangedAt = 1700000000000;

function sleep(milliseconds) {
    return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
}

function withTimeout(promise, timeoutMs, description) {
    let timer = null;
    return Promise.race([
        promise,
        new Promise(function (_resolve, reject) {
            timer = setTimeout(function () {
                reject(new Error("Timed out waiting for " + description));
            }, timeoutMs);
        })
    ]).finally(function () {
        if (timer !== null) clearTimeout(timer);
    });
}

async function fetchJson(url, options, description) {
    const abortController = new AbortController();
    const timer = setTimeout(function () { abortController.abort(); }, operationTimeoutMs);
    try {
        const response = await fetch(url, Object.assign({}, options || {}, { signal: abortController.signal }));
        if (!response.ok) throw new Error(description + " returned HTTP " + response.status);
        return await response.json();
    } catch (error) {
        if (abortController.signal.aborted) throw new Error("Timed out waiting for " + description);
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function fixtureContext() {
    return {
        ok: true,
        queueLength: 0,
        activeModule: "develop",
        selectedPhotoKey: fixturePhotoUuid,
        selectedPhotoUuid: fixturePhotoUuid,
        selectedPhotoPath: "C:\\Fixtures\\browser-lifecycle.dng",
        contextCounter: fixtureContextCounter,
        contextChangedAt: fixtureContextChangedAt,
        developCounter: fixtureDevelopCounter,
        developChangedAt: fixtureContextChangedAt + 1,
        lastHeartbeatAt: Date.now()
    };
}

function fixtureProfile() {
    function option(label, position) {
        return {
            token: "profile_" + String(position + 1).padStart(24, "0"),
            label: label,
            position: position,
            enabled: true,
            writable: true
        };
    }
    const options = [option("Adobe Color", 0), option("Adobe Landscape", 1)];
    return {
        available: true,
        updating: false,
        reason: null,
        revision: 80,
        optionSnapshotRevision: 3,
        contextCounter: fixtureContextCounter,
        photoKey: fixturePhotoUuid,
        photoUuid: fixturePhotoUuid,
        processId: 15300,
        browsePosition: 3,
        browseLabel: "Browse...",
        selectedToken: options[1].token,
        selectedLabel: options[1].label,
        source: "Look.Name",
        supportsAmount: false,
        validationGeneration: 0,
        validationFailedGeneration: 0,
        options: options
    };
}

function fixtureCategoricalState() {
    return {
        ok: true,
        revision: 4,
        state: {
            whiteBalanceAvailable: true,
            whiteBalance: "As Shot",
            processAvailable: true,
            process: "Version 6",
            vignetteStyleAvailable: true,
            vignetteStyle: 1,
            uprightModeAvailable: true,
            uprightMode: 0,
            constrainCropAvailable: true,
            constrainCrop: 0,
            selectedToolAvailable: false,
            selectedTool: null
        },
        profile: fixtureProfile()
    };
}

function fixturePresetState() {
    const uuid = "11111111-1111-4111-8111-111111111111";
    const saved = { uuid: uuid, alias: "Browser Fixture", updateAISettings: false };
    const inventory = { uuid: uuid, folder: "Fixtures", name: "Browser Fixture" };
    return {
        ok: true,
        configuration: { version: 1, presets: [saved] },
        configurationError: null,
        inventory: [inventory],
        inventoryStatus: "ready",
        inventoryError: null,
        inventoryRefreshedAt: fixtureContextChangedAt,
        inventoryRequestId: null,
        configured: [Object.assign({}, saved, inventory, { available: true, error: null })],
        availableCount: 1,
        cursorUuid: uuid,
        presetAmount: null,
        controlsEnabled: true,
        pendingApplication: false,
        lastApplication: null
    };
}

function fixturePointCurve() {
    const linear = [0, 0, 255, 255];
    return {
        available: true,
        selectedPhotoUuid: fixturePhotoUuid,
        contextCounter: fixtureContextCounter,
        developCounter: fixtureDevelopCounter,
        revision: 6,
        updatedAt: fixtureContextChangedAt + 2,
        name: "Linear",
        refineSaturation: { value: 100, min: 0, max: 100 },
        curves: { rgb: linear, red: linear, green: linear, blue: linear }
    };
}

function feedbackResult(slider, id) {
    const definition = sliderDefinitions.find(function (candidate) { return candidate.id === slider; });
    const min = definition && Number.isFinite(definition.min) ? definition.min : 0;
    const max = definition && Number.isFinite(definition.max) && definition.max > min ? definition.max : min + 1;
    let value = definition && Number.isFinite(definition.default) ? definition.default : min;
    value = Math.max(min, Math.min(max, value));
    return {
        id: id,
        slider: slider,
        value: value,
        available: true,
        range: { min: min, max: max },
        receivedAt: Date.now()
    };
}

function colorGradingSnapshot(id) {
    const metadata = colorGrading.getMetadata();
    const parameters = {};
    colorGrading.getParameterIds().forEach(function (parameter) {
        const normalized = parameter.toLowerCase();
        const range = normalized.includes("hue")
            ? { min: 0, max: 360 }
            : normalized.includes("sat") || normalized.includes("blend")
                ? { min: 0, max: 100 }
                : { min: -100, max: 100 };
        parameters[parameter] = { parameter: parameter, available: true, value: 0, range: range };
    });
    return {
        id: id,
        parameters: parameters,
        view: { available: true, value: metadata.views[0] },
        complete: true,
        context: fixtureContext(),
        requestedAt: Date.now(),
        completedAt: Date.now()
    };
}

function createMockControllerServer(options) {
    const grainFixture = options && options.grainOnly ? maskingGrainBrowser.createFixture(fixtureContext, feedbackResult) : null;
    if (options && options.historyOnly) historyBrowser.install(grainFixture);
    if (options && options.maskCreateOnly) maskCreateBrowser.install(grainFixture);
    if (options && (options.removeOnly || options.redEyeOnly || options.exportOnly)) removeBrowser.install(grainFixture);
    if (grainFixture) redEyeBrowser.install(grainFixture);
    if (grainFixture) exportBrowser.install(grainFixture);
    if (options && options.deleteConfirmationOnly) Object.assign(grainFixture.creation,
        { confirmationOnly: true, count: 4, active: true });
    const staticFiles = new Map([
        ["/", "controller.html"],
        ["/controller.html", "controller.html"],
        ["/controller-color-grading.js", "controller-color-grading.js"],
        ["/controller-denoise-state.js", "controller-denoise-state.js"],
        ["/controller-develop-categorical.js", "controller-develop-categorical.js"],
        ["/controller-lens-blur.js", "controller-lens-blur.js"],
        ["/controller-point-color.js", "controller-point-color.js"],
        ["/controller-tone-curve.js", "controller-tone-curve.js"],
        ["/controller-section-collapse.js", "controller-section-collapse.js"],
        ["/controller-develop-presets.js", "controller-develop-presets.js"],
        ["/controller-masking-corrections.js", "controller-masking-corrections.js"],
        ["/controller-masking.js", "controller-masking.js"]
        ,["/controller-remove.js", "controller-remove.js"]
        ,["/controller-reflections.js", "controller-reflections.js"]
        ,["/controller-people.js", "controller-people.js"]
        ,["/controller-red-eye.js", "controller-red-eye.js"]
        ,["/controller-export.js", "controller-export.js"]
    ]);
    const feedbackSnapshots = new Map();
    const treatmentSnapshots = new Map();
    const requestLog = [];
    const unexpectedRequests = [];
    let requestId = 0;

    function sendJson(response, body, statusCode) {
        const payload = JSON.stringify(body);
        response.writeHead(statusCode || 200, {
            "Cache-Control": "no-store",
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": Buffer.byteLength(payload)
        });
        response.end(payload);
    }

    const server = http.createServer(function (request, response) {
        const parsed = new URL(request.url, "http://127.0.0.1");
        requestLog.push({ method: request.method, path: parsed.pathname, search: parsed.search });

        if (request.method !== "GET") {
            unexpectedRequests.push(request.method + " " + request.url);
            sendJson(response, { ok: false, error: "Only GET is supported by the browser fixture" }, 405);
            return;
        }

        if (parsed.pathname === "/favicon.ico") {
            response.writeHead(204, { "Cache-Control": "no-store" });
            response.end();
            return;
        }

        const staticName = staticFiles.get(parsed.pathname);
        if (staticName) {
            const body = fs.readFileSync(path.join(appRoot, staticName));
            const contentType = path.extname(staticName) === ".html"
                ? "text/html; charset=utf-8"
                : "text/javascript; charset=utf-8";
            response.writeHead(200, {
                "Cache-Control": "no-store",
                "Content-Type": contentType,
                "Content-Length": body.length
            });
            response.end(body);
            return;
        }

        if (grainFixture && grainFixture.handle(parsed, function (body, status) { sendJson(response, body, status); })) return;

        if (parsed.pathname === "/api/export/state") {
            sendJson(response, { ok: true, ...fixtureContext(), available: false, selectionToken: null, selectionCount: 0,
                dialogSupported: false, previousSupported: false, serverEpoch: "export-unavailable", revision: 1,
                capturedAt: null, ageMs: null, pendingOperation: null, lastResult: null, needsReview: false }); return;
        }
        if (parsed.pathname === "/api/red-eye/state") {
            sendJson(response, { ok: true, ...fixtureContext(), available: false, selectedTool: null,
                serverEpoch: "eye-unavailable", revision: 1, ageMs: 0 });
            return;
        }

        if (parsed.pathname === "/api/reflections/state") {
            sendJson(response, { ok: true, ...fixtureContext(), available: false, serverEpoch: "reflections-unavailable", revision: 1, ageMs: 0 });
            return;
        }
        if (parsed.pathname === "/api/remove/state") {
            sendJson(response, { ok: true, ...fixtureContext(), available: false, serverEpoch: "remove-fixture", revision: 1,
                capturedAt: Date.now(), pendingOperation: null, lastResult: null });
            return;
        }

        if (parsed.pathname === "/api/sliders") {
            sendJson(response, { sliders: sliderDefinitions });
            return;
        }
        if (parsed.pathname === "/api/context") {
            sendJson(response, fixtureContext());
            return;
        }
        if (parsed.pathname === "/api/develop-categorical/state") {
            sendJson(response, fixtureCategoricalState());
            return;
        }
        if (parsed.pathname === "/api/develop-presets/state") {
            sendJson(response, fixturePresetState());
            return;
        }
        if (parsed.pathname === "/api/masking/state") {
            const context = fixtureContext();
            sendJson(response, {
                ok: true,
                serverEpoch: "masking-browser-fixture",
                revision: 1,
                capturedAt: Date.now(),
                selectedPhotoUuid: context.selectedPhotoUuid,
                contextCounter: context.contextCounter,
                developCounter: context.developCounter,
                contextChangedAt: context.contextChangedAt,
                pendingOperation: null,
                lastResult: null,
                available: true,
                unavailableReason: null,
                active: false,
                maskGroupCount: 2,
                hasSelectedMaskGroup: null,
                selectedMaskGroupIndex: null,
                selectedMaskGroupId: null,
                selectedMaskHidden: null,
                previousAvailable: false,
                nextAvailable: false,
                selectedMaskToolAvailable: false,
                selectedMaskToolId: null,
                selectedMaskToolHidden: null,
                selectedMaskToolCount: null,
                selectedMaskToolIndex: null,
                previousMaskToolAvailable: false,
                nextMaskToolAvailable: false
            });
            return;
        }
        if (parsed.pathname === "/api/masking/presets") {
            sendJson(response, { ok: true, presets: [] });
            return;
        }
        if (parsed.pathname === "/api/masking/tone-curve/state") {
            sendJson(response, { ok: true, pointCurve: { available: false } });
            return;
        }
        if (parsed.pathname === "/api/history/state") {
            sendJson(response, { ok: true, state: { available: true, canUndo: false, canRedo: false } });
            return;
        }
        if (parsed.pathname === "/api/enhance/state") {
            sendJson(response, enhanceState.createEnhanceState().get());
            return;
        }
        if (parsed.pathname === "/api/lens-blur/state") {
            sendJson(response, {
                ok: true,
                state: lensBlurState.unavailableState(),
                revision: 1,
                focalRangeCommitId: null,
                context: fixtureContext()
            });
            return;
        }
        if (parsed.pathname === "/api/point-color/state") {
            sendJson(response, { ok: true, state: pointColorState.createPointColorState().get() });
            return;
        }
        if (parsed.pathname === "/api/tone-curve/state") {
            sendJson(response, { ok: true, pointCurve: fixturePointCurve() });
            return;
        }
        if (parsed.pathname === "/api/color-grading/metadata") {
            sendJson(response, { ok: true, colorGrading: colorGrading.getMetadata() });
            return;
        }
        if (parsed.pathname === "/api/color-grading/request") {
            requestId += 1;
            sendJson(response, { ok: true, request: { id: requestId, requestedAt: Date.now() } });
            return;
        }
        if (parsed.pathname === "/api/color-grading/snapshot") {
            const id = Number(parsed.searchParams.get("id"));
            sendJson(response, { ok: true, snapshot: colorGradingSnapshot(id) });
            return;
        }
        if (parsed.pathname === "/api/treatment/request") {
            requestId += 1;
            treatmentSnapshots.set(String(requestId), { id: requestId, status: "available", grayscale: false });
            sendJson(response, { ok: true, request: { id: requestId } });
            return;
        }
        if (parsed.pathname === "/api/treatment/snapshot") {
            const snapshot = treatmentSnapshots.get(String(parsed.searchParams.get("id")));
            sendJson(response, snapshot || { error: "Unknown treatment fixture" }, snapshot ? 200 : 404);
            return;
        }
        if (parsed.pathname === "/api/feedback/request-many" || parsed.pathname === "/api/feedback/request") {
            const requested = parsed.pathname.endsWith("request-many")
                ? String(parsed.searchParams.get("sliders") || "").split(",").filter(Boolean)
                : [parsed.searchParams.get("slider")].filter(Boolean);
            requestId += 1;
            const results = {};
            requested.forEach(function (slider) { results[slider] = feedbackResult(slider, requestId); });
            feedbackSnapshots.set(String(requestId), {
                id: requestId,
                requestedSliders: requested,
                results: results,
                complete: true,
                requestedAt: Date.now(),
                completedAt: Date.now()
            });
            sendJson(response, {
                ok: true,
                request: { id: requestId, requestedAt: Date.now() },
                count: requested.length,
                sliders: requested
            });
            return;
        }
        if (parsed.pathname === "/api/feedback/snapshot") {
            const snapshot = feedbackSnapshots.get(String(parsed.searchParams.get("id")));
            sendJson(response, snapshot ? { ok: true, snapshot: snapshot } : { ok: false, error: "Unknown fixture" },
                snapshot ? 200 : 404);
            return;
        }

        unexpectedRequests.push(request.method + " " + request.url);
        sendJson(response, { ok: false, error: "Unexpected browser fixture request" }, 500);
    });

    return { server: server, requestLog: requestLog, unexpectedRequests: unexpectedRequests, grainFixture: grainFixture };
}

function listen(server) {
    const abortController = new AbortController();
    return new Promise(function (resolve, reject) {
        let settled = false;
        const timer = setTimeout(function () {
            abortController.abort();
            finish(new Error("Timed out waiting for the isolated Controller server to listen"));
        }, operationTimeoutMs);
        const finish = function (error, port) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            server.removeListener("error", onError);
            server.removeListener("listening", onListening);
            if (error) reject(error);
            else resolve(port);
        };
        const onError = function (error) {
            finish(error);
        };
        const onListening = function () {
            finish(null, server.address().port);
        };
        server.once("error", onError);
        server.once("listening", onListening);
        try {
            server.listen({ port: 0, host: "127.0.0.1", signal: abortController.signal });
        } catch (error) {
            finish(error);
        }
    });
}

async function closeServer(server) {
    if (!server || !server.listening) return;
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    await withTimeout(new Promise(function (resolve, reject) {
        server.close(function (error) {
            if (error) reject(error);
            else resolve();
        });
    }), 3000, "the isolated Controller server to close");
}

function findBrowserExecutable() {
    if (process.env.LRBRIDGE_CHROMIUM_PATH) {
        const configured = path.resolve(process.env.LRBRIDGE_CHROMIUM_PATH);
        if (!fs.existsSync(configured)) throw new Error("LRBRIDGE_CHROMIUM_PATH does not exist: " + configured);
        return configured;
    }
    const candidates = [
        process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"),
        process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"),
        process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
        process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
    ].filter(Boolean);
    const executable = candidates.find(function (candidate) { return fs.existsSync(candidate); });
    if (!executable) throw new Error("Microsoft Edge or Google Chrome is required for the Controller browser lifecycle test");
    return executable;
}

function createBrowserProfileDirectory() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "lrbridge-controller-browser-"));
}

function removeBrowserProfileDirectory(directory) {
    if (!directory) return;
    const resolved = path.resolve(directory);
    const temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(temporaryRoot) || !path.basename(resolved).startsWith("lrbridge-controller-browser-")) {
        throw new Error("Refusing to remove an unexpected browser profile path: " + resolved);
    }
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function launchBrowser(executable, profileDirectory) {
    const browser = childProcess.spawn(executable, [
        "--headless=new",
        "--disable-background-networking",
        "--disable-breakpad",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-extensions",
        "--disable-sync",
        "--metrics-recording-only",
        "--mute-audio",
        "--no-default-browser-check",
        "--no-first-run",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
        "--user-data-dir=" + profileDirectory,
        "--window-size=1280,900",
        "about:blank"
    ], {
        detached: false,
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true
    });
    browser.launchError = null;
    browser.stderrTail = "";
    browser.once("error", function (error) { browser.launchError = error; });
    browser.stderr.on("data", function (chunk) {
        browser.stderrTail = (browser.stderrTail + chunk.toString()).slice(-8192);
    });
    return browser;
}

async function waitForDevTools(browser, profileDirectory) {
    const portFile = path.join(profileDirectory, "DevToolsActivePort");
    const deadline = Date.now() + operationTimeoutMs;
    while (Date.now() < deadline) {
        if (browser.launchError) throw browser.launchError;
        if (browser.exitCode !== null || browser.signalCode !== null) {
            const details = browser.stderrTail.trim();
            throw new Error("The isolated Chromium process exited before its DevTools endpoint became ready" +
                (details ? ":\n" + details : ""));
        }
        if (fs.existsSync(portFile)) {
            const port = Number(fs.readFileSync(portFile, "utf8").split(/\r?\n/)[0]);
            if (Number.isSafeInteger(port) && port > 0 && port <= 65535) {
                const debugUrl = "http://127.0.0.1:" + port;
                try {
                    const version = await fetchJson(debugUrl + "/json/version", {}, "the Chromium DevTools endpoint");
                    return { debugUrl: debugUrl, browserWebSocketUrl: version.webSocketDebuggerUrl };
                } catch (error) {
                    if (Date.now() + 100 >= deadline) throw error;
                }
            }
        }
        await sleep(50);
    }
    throw new Error("Timed out waiting for the isolated Chromium DevTools endpoint");
}

function processHasExited(browser) {
    return !browser || browser.exitCode !== null || browser.signalCode !== null;
}

function waitForProcessExit(browser, timeoutMs) {
    if (processHasExited(browser)) return Promise.resolve(true);
    return new Promise(function (resolve) {
        let settled = false;
        let timer = null;
        const finish = function (exited) {
            if (settled) return;
            settled = true;
            if (timer !== null) clearTimeout(timer);
            browser.removeListener("exit", onExit);
            resolve(exited);
        };
        const onExit = function () { finish(true); };
        timer = setTimeout(function () { finish(false); }, timeoutMs);
        browser.once("exit", onExit);
    });
}

async function connectCdp(webSocketUrl) {
    assert.equal(typeof webSocketUrl, "string", "the Chromium CDP WebSocket URL must be available");
    const socket = new WebSocket(webSocketUrl);
    let onOpen = null;
    let onError = null;
    try {
        await withTimeout(new Promise(function (resolve, reject) {
            onOpen = function () {
                socket.removeListener("error", onError);
                resolve();
            };
            onError = function (error) {
                socket.removeListener("open", onOpen);
                reject(error);
            };
            socket.once("open", onOpen);
            socket.once("error", onError);
        }), operationTimeoutMs, "the Chromium CDP socket to open");
    } catch (error) {
        socket.removeListener("open", onOpen);
        socket.removeListener("error", onError);
        if (socket.readyState !== WebSocket.CLOSED) {
            socket.once("error", function () { /* Expected when terminating a connection attempt. */ });
            socket.terminate();
        }
        throw error;
    }

    let commandId = 0;
    const pending = new Map();
    const protocolErrors = [];
    const cdp = { socket: socket, send: null, closeSocket: null, protocolErrors: protocolErrors, onEvent: null };

    function rejectPending(error) {
        pending.forEach(function (request) {
            clearTimeout(request.timer);
            request.reject(error);
        });
        pending.clear();
    }

    socket.on("error", function (error) { rejectPending(error); });
    socket.on("close", function () { rejectPending(new Error("The Chromium CDP socket closed")); });
    socket.on("message", function (rawMessage) {
        let message;
        try {
            message = JSON.parse(rawMessage);
        } catch (error) {
            protocolErrors.push(error.message);
            rejectPending(error);
            return;
        }
        if (message.id !== undefined && pending.has(message.id)) {
            const request = pending.get(message.id);
            pending.delete(message.id);
            clearTimeout(request.timer);
            if (message.error) request.reject(new Error(JSON.stringify(message.error)));
            else request.resolve(message.result);
            return;
        }
        if (typeof cdp.onEvent === "function") cdp.onEvent(message);
    });

    cdp.send = function (method, parameters) {
        if (socket.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error("Cannot send CDP command after socket closure"));
        }
        return new Promise(function (resolve, reject) {
            commandId += 1;
            const id = commandId;
            const timer = setTimeout(function () {
                if (!pending.has(id)) return;
                pending.delete(id);
                reject(new Error("Timed out waiting for CDP command " + method));
            }, operationTimeoutMs);
            pending.set(id, { resolve: resolve, reject: reject, timer: timer });
            socket.send(JSON.stringify({ id: id, method: method, params: parameters || {} }), function (error) {
                if (!error || !pending.has(id)) return;
                const request = pending.get(id);
                pending.delete(id);
                clearTimeout(request.timer);
                request.reject(error);
            });
        });
    };

    cdp.closeSocket = async function () {
        if (socket.readyState === WebSocket.CLOSED) return;
        if (socket.readyState === WebSocket.OPEN) socket.close();
        const closed = await withTimeout(new Promise(function (resolve) {
            if (socket.readyState === WebSocket.CLOSED) resolve();
            else socket.once("close", resolve);
        }), 1500, "the Chromium CDP socket to close").then(function () { return true; }, function () { return false; });
        if (!closed && socket.readyState !== WebSocket.CLOSED) socket.terminate();
    };

    return cdp;
}

function installLifecycleDiagnostics() {
    const diagnostics = window.__lrbridgeLifecycleTest = {
        insertViolations: [],
        mutationObservers: 0,
        intersectionCreated: 0,
        intersectionDisconnected: 0,
        intervals: {},
        listeners: {},
        scrolls: 0,
        activeFetches: 0,
        animationFrames: { scheduled: 0, completed: 0, canceled: 0, active: 0 }
    };
    const insertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function (node, reference) {
        if (reference && reference.parentNode !== this) diagnostics.insertViolations.push((new Error()).stack);
        return insertBefore.apply(this, arguments);
    };
    const NativeMutationObserver = window.MutationObserver;
    window.MutationObserver = function (callback) {
        diagnostics.mutationObservers += 1;
        return new NativeMutationObserver(callback);
    };
    window.MutationObserver.prototype = NativeMutationObserver.prototype;
    const NativeIntersectionObserver = window.IntersectionObserver;
    window.IntersectionObserver = function (callback, options) {
        diagnostics.intersectionCreated += 1;
        const observer = new NativeIntersectionObserver(callback, options);
        const disconnect = observer.disconnect.bind(observer);
        let active = true;
        observer.disconnect = function () {
            if (active) {
                active = false;
                diagnostics.intersectionDisconnected += 1;
            }
            return disconnect();
        };
        return observer;
    };
    window.IntersectionObserver.prototype = NativeIntersectionObserver.prototype;
    const nativeSetInterval = window.setInterval;
    const nativeClearInterval = window.clearInterval;
    window.setInterval = function (_callback, delay) {
        const handle = nativeSetInterval.apply(this, arguments);
        diagnostics.intervals[Number(handle)] = delay;
        return handle;
    };
    window.clearInterval = function (handle) {
        delete diagnostics.intervals[Number(handle)];
        return nativeClearInterval.apply(this, arguments);
    };
    const nativeRequestAnimationFrame = window.requestAnimationFrame;
    const nativeCancelAnimationFrame = window.cancelAnimationFrame;
    const activeAnimationFrames = new Set();
    window.requestAnimationFrame = function (callback) {
        diagnostics.animationFrames.scheduled += 1;
        let handle = null;
        handle = nativeRequestAnimationFrame.call(this, function (timestamp) {
            if (activeAnimationFrames.delete(handle)) diagnostics.animationFrames.active -= 1;
            diagnostics.animationFrames.completed += 1;
            return callback(timestamp);
        });
        activeAnimationFrames.add(handle);
        diagnostics.animationFrames.active += 1;
        return handle;
    };
    window.cancelAnimationFrame = function (handle) {
        if (activeAnimationFrames.delete(handle)) {
            diagnostics.animationFrames.active -= 1;
            diagnostics.animationFrames.canceled += 1;
        }
        return nativeCancelAnimationFrame.call(this, handle);
    };
    const nativeFetch = window.fetch;
    window.fetch = function () {
        diagnostics.activeFetches += 1;
        return nativeFetch.apply(this, arguments).finally(function () { diagnostics.activeFetches -= 1; });
    };
    const listenerIds = new WeakMap();
    let listenerSequence = 0;
    const listenerId = function (listener) {
        if (!listenerIds.has(listener)) listenerIds.set(listener, ++listenerSequence);
        return listenerIds.get(listener);
    };
    const capture = function (options) {
        return typeof options === "boolean" ? options : !!(options && options.capture);
    };
    const addEventListener = EventTarget.prototype.addEventListener;
    const removeEventListener = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
        if ((this === document || this === window) && listener) {
            const key = (this === document ? "document" : "window") + ":" + type + ":" +
                listenerId(listener) + ":" + capture(options);
            diagnostics.listeners[key] = true;
        }
        return addEventListener.apply(this, arguments);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
        if ((this === document || this === window) && listener) {
            const key = (this === document ? "document" : "window") + ":" + type + ":" +
                listenerId(listener) + ":" + capture(options);
            delete diagnostics.listeners[key];
        }
        return removeEventListener.apply(this, arguments);
    };
    const scrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {
        diagnostics.scrolls += 1;
        if (scrollIntoView) return scrollIntoView.apply(this, arguments);
    };
}

function toneCurveRenderingProbe() {
    return (async function () {
        const points = [0, 0, 109, 93, 255, 255];
        const globalStatuses = [];
        const maskStatuses = [];
        const globalSnapshot = {
            available: true,
            selectedPhotoUuid: "tone-render-photo",
            contextCounter: 31,
            developCounter: 47,
            revision: 5,
            updatedAt: 9002,
            name: "Custom",
            refineSaturation: { value: 0, min: -100, max: 100 },
            curves: { rgb: points, red: points, green: points, blue: points }
        };
        const maskSnapshot = Object.assign({}, globalSnapshot, {
            serverEpoch: "tone-render-epoch",
            maskingRevision: 8,
            contextChangedAt: 9000,
            selectedMaskGroupId: "tone-render-mask",
            editFeedbackSequence: 0,
            lastEditResult: null
        });
        const globalBinding = {
            activeModule: "develop",
            selectedPhotoUuid: globalSnapshot.selectedPhotoUuid,
            contextCounter: globalSnapshot.contextCounter,
            developCounter: globalSnapshot.developCounter
        };
        const maskBinding = Object.assign({ activeModule: "develop" }, maskSnapshot);
        function response(snapshot) {
            return Promise.resolve({
                ok: true,
                status: 200,
                json: async function () { return { ok: true, pointCurve: snapshot }; }
            });
        }
        const probeRoot = document.createElement("div");
        probeRoot.id = "tone-curve-rendering-probe";
        probeRoot.style.cssText = "position:absolute;left:0;top:0;width:1200px;display:grid;" +
            "grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;z-index:9999;background:#111820";
        const globalHost = document.createElement("section");
        globalHost.className = "group tone-curve-group";
        const maskHost = document.createElement("div");
        maskHost.className = "masking-correction-group masking-tone-curve";
        probeRoot.append(globalHost, maskHost);
        document.body.appendChild(probeRoot);
        const globalController = LRBridgeToneCurve.createController({
            document: document,
            window: window,
            fetch: function () { return response(globalSnapshot); },
            setInterval: function () { return 1; },
            clearInterval: function () {},
            setStatus: function (message) { globalStatuses.push(message); }
        });
        const maskController = LRBridgeToneCurve.createController({
            document: document,
            window: window,
            fetch: function () { return response(maskSnapshot); },
            contextAdapter: LRBridgeToneCurve.createMaskingContextAdapter("/api/masking/tone-curve"),
            setInterval: function () { return 1; },
            clearInterval: function () {},
            setStatus: function (message) { maskStatuses.push(message); }
        });
        function inspect(host) {
            const svg = host.querySelector(".point-curve-graph");
            const path = host.querySelector(".point-curve-line");
            const handles = host.querySelector(".point-curve-handles");
            const panel = host.querySelector(".point-curve-panel");
            const pointActions = host.querySelector(".point-curve-point-actions");
            const graphShell = host.querySelector(".point-curve-graph-shell");
            const addPoint = pointActions.querySelector('[aria-label="Add point"]');
            const deletePoint = pointActions.querySelector('[aria-label="Delete point"]');
            const deleteIcon = deletePoint.querySelector(".point-curve-delete-icon path");
            const markers = Array.from(host.querySelectorAll(".point-curve-marker:not(.point-curve-preview-marker)"));
            const svgBounds = svg.getBoundingClientRect();
            const pathStyle = getComputedStyle(path);
            return {
                pathD: path.getAttribute("d"),
                pathStroke: pathStyle.stroke,
                pathOpacity: Number(pathStyle.opacity),
                pathFill: pathStyle.fill,
                pathBeforeHandles: Array.prototype.indexOf.call(svg.children, path) <
                    Array.prototype.indexOf.call(svg.children, handles),
                width: svgBounds.width,
                height: svgBounds.height,
                viewBox: svg.getAttribute("viewBox"),
                pointActions: {
                    display: getComputedStyle(pointActions).display,
                    columns: getComputedStyle(pointActions).gridTemplateColumns,
                    beforeGraph: Array.prototype.indexOf.call(panel.children, pointActions) <
                        Array.prototype.indexOf.call(panel.children, graphShell),
                    labels: [addPoint.textContent.trim(), deletePoint.textContent.trim()],
                    deleteAriaLabel: deletePoint.getAttribute("aria-label"),
                    deleteTitle: deletePoint.title,
                    deleteIconPath: deleteIcon.getAttribute("d"),
                    deleteDisabled: deletePoint.disabled
                },
                markers: markers.map(function (marker) {
                    const style = getComputedStyle(marker);
                    const bounds = marker.getBoundingClientRect();
                    return {
                        cx: Number(marker.getAttribute("cx")),
                        cy: Number(marker.getAttribute("cy")),
                        stroke: style.stroke,
                        strokeWidth: Number.parseFloat(style.strokeWidth),
                        fill: style.fill,
                        opacity: Number(style.opacity),
                        display: style.display,
                        visibility: style.visibility,
                        intersectsSvg: bounds.right >= svgBounds.left && bounds.left <= svgBounds.right &&
                            bounds.bottom >= svgBounds.top && bounds.top <= svgBounds.bottom
                    };
                })
            };
        }
        try {
            globalHost.appendChild(globalController.element);
            maskHost.appendChild(maskController.element);
            globalController.activate(globalBinding);
            maskController.activate(maskBinding);
            await new Promise(function (resolve) { setTimeout(resolve, 50); });
            globalController.applyAuthoritative(globalSnapshot);
            maskController.applyAuthoritative(maskSnapshot);
            globalHost.querySelector('.point-curve-hit-target[data-point-index="1"]').dispatchEvent(
                new MouseEvent("click", { bubbles: true })
            );
            maskHost.querySelector('.point-curve-hit-target[data-point-index="1"]').dispatchEvent(
                new MouseEvent("click", { bubbles: true })
            );
            const selected = {
                input: maskHost.querySelector('[aria-label="Selected point input"]').textContent,
                output: maskHost.querySelector('[aria-label="Selected point output"]').textContent
            };
            const expectedPath = LRBridgeToneCurve.curvePathData(points);
            const diagonalPath = LRBridgeToneCurve.curvePathData([0, 0, 255, 255]);
            const globalBefore = inspect(globalHost);
            const maskBefore = inspect(maskHost);
            maskHost.querySelector('[aria-label="Adjust Red Point Curve"]').click();
            await new Promise(function (resolve) { setTimeout(resolve, 0); });
            const maskAfterChannel = inspect(maskHost);
            const globalAfter = inspect(globalHost);
            return {
                expectedPath: expectedPath,
                diagonalPath: diagonalPath,
                selected: selected,
                globalBefore: globalBefore,
                globalAfter: globalAfter,
                maskBefore: maskBefore,
                maskAfterChannel: maskAfterChannel,
                falseWarning: globalStatuses.concat(maskStatuses).some(function (message) {
                    return /superseded|normalized/i.test(message);
                })
            };
        } finally {
            globalController.deactivate();
            maskController.deactivate();
            probeRoot.remove();
        }
    })();
}

function maskingPresetScrollProbe() {
    return (async function () {
        function response(body, status) {
            return Promise.resolve({
                ok: status === undefined || status < 400,
                status: status || 200,
                json: async function () { return JSON.parse(JSON.stringify(body)); }
            });
        }
        async function flush(milliseconds) {
            await new Promise(function (resolve) { setTimeout(resolve, milliseconds || 0); });
            await new Promise(function (resolve) { setTimeout(resolve, 0); });
        }
        let context = {
            activeModule: "develop", selectedPhotoUuid: "preset-scroll-photo", contextCounter: 4,
            developCounter: 7, contextChangedAt: 4000
        };
        let revision = 1;
        let maskId = "preset-scroll-mask-a";
        let maskName = "Mask A";
        let currentPreset = null;
        let applyRequests = 0;
        let inventoryRequests = 0;
        let pendingOperation = null;
        let lastResult = null;
        let componentId = "preset-scroll-brush";
        let delayAdmission = false;
        let releaseAdmission = null;
        const inventory = [
            ["lp-burn", "Burn (Darken)"], ["lp-dodge", "Dodge (Lighten)"]
        ].map(function (entry) {
            return { id: entry[0], name: entry[1], kind: "file", supported: true, unavailableReason: null };
        }).concat(Array.from({ length: 96 }, function (_value, index) {
            return { id: "lp-preset-scroll-" + index, name: "Saved Preset " + (index + 1), kind: "file",
                supported: true, unavailableReason: null };
        }));
        inventory.unshift(
            { id: "lp-native-tint", name: "Tint", kind: "builtin", supported: true, unavailableReason: null },
            { id: "lp-native-amount", name: "Amount", kind: "builtin", supported: true, unavailableReason: null }
        );
        function state() {
            return {
                ok: true, serverEpoch: "preset-scroll-epoch", revision: revision, capturedAt: Date.now(),
                selectedPhotoUuid: context.selectedPhotoUuid, contextCounter: context.contextCounter,
                developCounter: context.developCounter, contextChangedAt: context.contextChangedAt,
                pendingOperation: pendingOperation, lastResult: lastResult, correctionFeedbackSequence: 0,
                lastCorrectionResult: null, editFeedbackSequence: 0, lastEditResult: null,
                currentPreset: currentPreset, presetIdentityAvailable: false,
                presetIdentityReason: "unsupported_sdk", available: true, unavailableReason: null,
                active: true, maskGroupCount: 2, hasSelectedMaskGroup: true, selectedMaskGroupIndex: 1,
                selectedMaskGroupId: maskId, selectedMaskGroupName: maskName, selectedMaskHidden: false,
                previousAvailable: false, nextAvailable: true, selectedMaskToolAvailable: true,
                selectedMaskToolId: componentId, selectedMaskToolName: "Brush 1",
                selectedMaskToolType: "brush", selectedMaskToolSubtype: null, selectedMaskToolHidden: false,
                selectedMaskToolCount: 1, selectedMaskToolIndex: 1,
                previousMaskToolAvailable: false, nextMaskToolAvailable: false, corrections: [],
                pointColor: { available: false, swatchCount: 0, selectedIndex: 0, selectionTransient: false },
                curves: { available: false }
            };
        }
        function fetchImpl(requestPath) {
            const parsed = new URL(requestPath, location.origin);
            if (parsed.pathname === "/api/masking/state") return response(state());
            if (parsed.pathname === "/api/masking/presets") {
                inventoryRequests += 1;
                return response({ ok: true, presets: inventory });
            }
            if (parsed.pathname === "/api/masking/tone-curve/state") {
                return response({ ok: true, pointCurve: { available: false } });
            }
            if (parsed.pathname === "/api/masking/preset/apply") {
                applyRequests += 1;
                if (parsed.searchParams.get("selectedMaskToolId") !== componentId) throw Error("missing component binding");
                pendingOperation = { kind: "preset", presetId: parsed.searchParams.get("preset"), operationId: "mo-" + applyRequests };
                revision += 1;
                const admission = Object.assign(state(), { operationId: pendingOperation.operationId });
                if (delayAdmission) return new Promise(function (resolve) { releaseAdmission = function () { resolve(response(admission)); }; });
                return response(admission);
            }
            return response({ ok: false, error: "Unexpected preset-scroll request: " + parsed.pathname }, 404);
        }
        const host = document.createElement("div");
        host.id = "masking-preset-scroll-probe";
        host.style.cssText = "position:absolute;left:-2000px;top:0;width:900px";
        document.body.appendChild(host);
        const controller = LRBridgeControllerMasking.createController({
            document: document,
            fetch: fetchImpl,
            getContext: function () { return context; },
            confirm: function () { return true; }
        });
        try {
            controller.activate(host);
            for (let attempt = 0; attempt < 50; attempt += 1) {
                await flush(10);
                const candidate = host.querySelector(".masking-preset-button");
                if (candidate && !candidate.disabled && candidate.textContent === "Apply Mask Preset…") break;
            }
            const opener = host.querySelector(".masking-preset-button");
            opener.click();
            await flush(30);
            const dialog = host.querySelector(".masking-preset-picker");
            const list = host.querySelector(".masking-preset-picker-list");
            const rows = Array.from(host.querySelectorAll(".masking-preset-picker-option"));
            const focusedRow = rows[rows.length - 3];
            focusedRow.focus({ preventScroll: true });
            list.scrollTop = Math.max(1, list.scrollHeight - list.clientHeight - 17);
            const scrollTop = list.scrollTop;
            const firstRow = rows[0];
            for (let poll = 0; poll < 6; poll += 1) {
                currentPreset = poll % 2 === 0
                    ? { id: "lp-native-hue", name: "Hue", source: "native", authoritative: true, edited: false }
                    : { id: "lp-preset-scroll-40", name: "Saved Preset 41", source: "native",
                        authoritative: true, edited: true };
                if (poll === 3) {
                    maskId = "preset-scroll-mask-b";
                    maskName = "Mask B";
                }
                revision += 1;
                await controller.refresh();
                await flush(20);
            }
            await flush(500);
            const beforeUnavailableClick = { scrollTop: list.scrollTop, focused: document.activeElement };
            const listStyle = getComputedStyle(list);
            function check(value, message) { if (!value) throw Error(message); }
            check(Array.from(host.querySelectorAll(".masking-preset-picker-group")).map(e => e.textContent).join("|") ===
                "Installed and saved presets", "native selector-only group must be excluded");
            check(rows.every(row => !row.dataset.presetId.startsWith("lp-native-")),
                "stale server inventory exposed an emulated preset");
            const explanation = "Applies saved settings to the selected mask. Some Lightroom presets are unavailable, and Lightroom may show Custom or an edited preset name.";
            const inlineExplanation = host.querySelector(".masking-preset-explanation");
            check(inlineExplanation.textContent === explanation &&
                inlineExplanation.previousElementSibling.contains(opener), "missing explanation directly below the preset button row");
            check(dialog.querySelector("#maskingPresetPickerDescription").textContent === explanation,
                "dialog explanation differs from the accepted wording");
            const feedback = host.querySelector(".masking-preset-feedback");
            async function finish(outcome, detail) {
                lastResult = { operationId: pendingOperation.operationId, outcome: outcome, detail: detail || "" };
                pendingOperation = null;
                revision += 1;
                await controller.refresh();
                await flush();
            }
            focusedRow.click();
            focusedRow.click();
            await flush();
            check(applyRequests === 1, "duplicate preset application");
            check(feedback.textContent === "Applying Saved Preset 94…", "missing named pending feedback");
            check(!feedback.textContent.startsWith("Applied"), "admission claimed success before readback");
            await finish("confirmed");
            check(feedback.textContent === "Applied settings from Saved Preset 94.", "missing confirmed feedback");
            check(opener.textContent === "Apply Mask Preset…", "button became a current-preset label");
            focusedRow.click(); await flush();
            await finish("failed", "Some settings remain changed.");
            check(feedback.textContent === "Some settings remain changed.", "partial failure was hidden");
            focusedRow.click(); await flush();
            await finish("confirmed");
            check(applyRequests === 3 && feedback.textContent.startsWith("Applied settings from"), "failure did not recover");
            // A burst is one active operation plus the newest queued choice, using fresh bindings.
            delayAdmission = true;
            rows[0].click(); rows[1].click(); focusedRow.click(); focusedRow.click();
            await flush();
            check(feedback.textContent === "Applying Burn (Darken)…", "saved preset missing named pending feedback");
            check(applyRequests === 4, "rapid choices overlapped before admission");
            check(dialog.querySelector(".masking-preset-picker-status").textContent.includes("Next: Saved Preset 94"),
                "latest rapid choice was dropped");
            releaseAdmission(); delayAdmission = false; await flush();
            await finish("confirmed");
            check(applyRequests === 5 && pendingOperation.presetId === focusedRow.dataset.presetId,
                "newest choice was not submitted after authoritative completion");
            check(feedback.textContent === "Applying Saved Preset 94…", "old completion replaced newer feedback");
            await finish("confirmed");
            rows[0].click(); rows[1].click(); rows[0].click(); await flush();
            await finish("confirmed");
            check(applyRequests === 6, "returning to the active preset caused a duplicate");
            rows[0].click(); rows[1].click(); await flush(); await finish("failed", "Some settings remain changed.");
            check(applyRequests === 7 && feedback.textContent === "Some settings remain changed.",
                "failure automatically ran queued work or hid partial changes");
            focusedRow.click(); await flush(); await finish("confirmed");
            context = Object.assign({}, context, { developCounter: context.developCounter + 1 });
            revision += 1;
            controller.updateContext(context); await flush(); await controller.refresh(); await flush();
            check(feedback.textContent.startsWith("Applied settings from"), "ordinary Develop feedback erased the confirmed application");
            check(dialog.open && document.activeElement === focusedRow, "Develop polling closed or refocused the picker");
            componentId = "another-component"; revision += 1;
            await controller.refresh(); await flush();
            check(feedback.textContent === "", "component change retained operation feedback");
            delayAdmission = true;
            focusedRow.click(); await flush();
            rows[0].click();
            const requestsBeforeSwitch = applyRequests;
            maskId = "another-mask"; pendingOperation = null; revision += 1;
            await controller.refresh(); await flush();
            check(feedback.textContent === "", "mask change retained pending feedback");
            releaseAdmission(); await flush();
            check(feedback.textContent === "", "late admission labeled another mask");
            check(applyRequests === requestsBeforeSwitch, "queued preset crossed a mask change");
            delayAdmission = false;
            focusedRow.click(); await flush(); await finish("confirmed");
            context.selectedPhotoUuid = "another-photo"; context.contextCounter += 1; context.contextChangedAt += 1;
            revision += 1; await controller.refresh(); await flush();
            check(feedback.textContent === "", "photo change retained feedback");
            check(presetLabelAbsent(), "synthetic preset identity entered action picker");
            function presetLabelAbsent() {
                return host.querySelectorAll(".masking-preset-picker-option.current").length === 0 &&
                    !list.textContent.includes("(edited)") && !list.textContent.includes("Current");
            }
            return {
                rowCount: rows.length,
                scrollable: scrollTop > 0,
                scrollTopUnchanged: list.scrollTop === scrollTop && beforeUnavailableClick.scrollTop === scrollTop,
                focusUnchanged: document.activeElement === focusedRow && beforeUnavailableClick.focused === focusedRow,
                domUnchanged: host.querySelectorAll(".masking-preset-picker-option")[0] === firstRow,
                containedWheelAndTouch: listStyle.overflowY === "auto" &&
                    listStyle.overscrollBehaviorY === "contain" && listStyle.touchAction === "pan-y" &&
                    listStyle.overflowAnchor === "none",
                dialogStayedOpen: dialog.open && !dialog.hidden,
                markerCount: host.querySelectorAll(".masking-preset-picker-option.current").length,
                openerLabel: opener.textContent,
                applyRequests: applyRequests,
                inventoryRequests: inventoryRequests,
                applicationChecks: true
            };
        } finally {
            controller.deactivate();
            host.remove();
        }
    })();
}

function maskingIntentLifecycleProbe() {
    return (async function () {
        function response(body, status) {
            return Promise.resolve({
                ok: status === undefined || status < 400,
                status: status || 200,
                json: async function () { return JSON.parse(JSON.stringify(body)); }
            });
        }
        function deferred() {
            let resolve;
            const promise = new Promise(function (next) { resolve = next; });
            return { promise: promise, resolve: resolve };
        }
        async function flush(milliseconds) {
            await new Promise(function (resolve) { setTimeout(resolve, milliseconds || 0); });
            await new Promise(function (resolve) { setTimeout(resolve, 0); });
        }
        async function takeDeferred(queue, label, controller) {
            for (let attempt = 0; attempt < 30; attempt += 1) {
                if (queue.length > 0) return queue.shift();
                await flush(10);
            }
            throw new Error(label + " was not submitted: " + JSON.stringify({
                interaction: controller.getInteractionState(), requests: requestPaths
            }));
        }
        async function waitUntil(predicate, label, controller) {
            for (let attempt = 0; attempt < 100; attempt += 1) {
                if (predicate()) return;
                await flush(10);
            }
            throw new Error(label + " did not settle: " + JSON.stringify(controller.getInteractionState()));
        }
        let context = {
            activeModule: "develop", selectedPhotoUuid: "masking-intent-photo", contextCounter: 9,
            developCounter: 14, contextChangedAt: 9100
        };
        let maskId = "masking-intent-mask";
        let maskName = "MOJA JEBENA MASKA!";
        let maskIndex = 1;
        let maskCount = 1;
        let currentPreset = null;
        let componentId = "masking-intent-component";
        let componentName = "Brush 1";
        let componentType = "brush";
        const linear = [0, 0, 255, 255];
        let revision = 1;
        let editSequence = 0;
        let feedbackSequence = 0;
        let pendingOperation = null;
        let lastOperationResult = null;
        let lastEditResult = null;
        let hueShift = 0;
        let refineValue = 50;
        const pointAdmissions = [];
        const refineEnds = [];
        const presetInventory = deferred();
        const requestPaths = [];
        let presetRequests = 0;
        function nextSequence() { editSequence += 1; return editSequence; }
        function pointColor() {
            const range = { LowerNone: 0.1, LowerFull: 0.3, UpperFull: 0.7, UpperNone: 0.9 };
            return {
                available: true, swatchCount: 1, selectedIndex: 1, selectionTransient: false,
                HueShift: hueShift, SatScale: 0, LumScale: 0, Variance: 0, RangeAmount: 0.5,
                HueRange: Object.assign({}, range), SatRange: Object.assign({}, range),
                LumRange: Object.assign({}, range), HueRangeMarker: 0.5, SatRangeMarker: 0.5,
                LumRangeMarker: 0.5
            };
        }
        function maskingState() {
            return {
                ok: true, serverEpoch: "masking-intent-epoch", revision: revision, capturedAt: Date.now(),
                selectedPhotoUuid: context.selectedPhotoUuid, contextCounter: context.contextCounter,
                developCounter: context.developCounter, contextChangedAt: context.contextChangedAt,
                pendingOperation: pendingOperation, lastResult: lastOperationResult,
                correctionFeedbackSequence: 0, lastCorrectionResult: null,
                editFeedbackSequence: feedbackSequence, lastEditResult: lastEditResult,
                currentPreset: currentPreset,
                available: true, unavailableReason: null, active: true, maskGroupCount: maskCount,
                hasSelectedMaskGroup: true, selectedMaskGroupIndex: maskIndex, selectedMaskGroupId: maskId,
                selectedMaskGroupName: maskName,
                selectedMaskHidden: false, previousAvailable: false, nextAvailable: false,
                selectedMaskToolAvailable: true, selectedMaskToolId: componentId,
                selectedMaskToolName: componentName, selectedMaskToolType: componentType,
                selectedMaskToolSubtype: null,
                selectedMaskToolHidden: false, selectedMaskToolCount: 1, selectedMaskToolIndex: 1,
                previousMaskToolAvailable: false, nextMaskToolAvailable: false,
                corrections: [{ parameter: "local_Exposure", value: 0, min: -4, max: 4 }],
                pointColor: pointColor(),
                curves: { available: true, rgb: linear, red: linear, green: linear, blue: linear }
            };
        }
        function toneSnapshot() {
            return {
                available: true, selectedPhotoUuid: context.selectedPhotoUuid,
                contextCounter: context.contextCounter, developCounter: context.developCounter,
                contextChangedAt: context.contextChangedAt, revision: revision, updatedAt: Date.now(),
                serverEpoch: "masking-intent-epoch", maskingRevision: revision,
                selectedMaskGroupId: maskId, editFeedbackSequence: feedbackSequence,
                lastEditResult: lastEditResult, name: "Custom",
                refineSaturation: { value: refineValue, min: 0, max: 100 },
                curves: { rgb: linear, red: linear, green: linear, blue: linear }
            };
        }
        function fetchImpl(requestPath) {
            const parsed = new URL(requestPath, location.origin);
            requestPaths.push(parsed.pathname + parsed.search);
            if (parsed.pathname === "/api/masking/state") return response(maskingState());
            if (parsed.pathname === "/api/masking/presets") {
                return presetInventory.promise.then(function (data) { return response(data); });
            }
            if (parsed.pathname === "/api/masking/tone-curve/state") {
                return response({ ok: true, pointCurve: toneSnapshot() });
            }
            if (parsed.pathname === "/api/masking/point-color/value") {
                const admission = deferred();
                pointAdmissions.push(admission);
                return admission.promise;
            }
            if (parsed.pathname.endsWith("/refine-saturation/gesture/begin")) {
                return response({ ok: true, editSequence: nextSequence() });
            }
            if (parsed.pathname.endsWith("/refine-saturation/gesture/end")) {
                const admission = deferred();
                refineEnds.push(admission);
                return admission.promise;
            }
            if (parsed.pathname.endsWith("/refine-saturation/gesture/cancel")) {
                return response({ ok: true, editSequence: nextSequence() });
            }
            if (parsed.pathname === "/api/masking/preset/apply") {
                presetRequests += 1;
                return response({ ok: false, capability: "unsupported_sdk",
                    error: "Exact native local-preset selection is unavailable" }, 501);
            }
            return response({ ok: false, error: "Unexpected masking probe request: " + parsed.pathname }, 404);
        }
        const host = document.createElement("div");
        host.id = "masking-intent-lifecycle-probe";
        host.style.cssText = "position:absolute;left:-2000px;top:0;width:900px";
        document.body.appendChild(host);
        const controller = LRBridgeControllerMasking.createController({
            document: document,
            fetch: fetchImpl,
            getContext: function () { return context; },
            pointColorFeedbackTimeoutMs: 35,
            toneCurveFeedbackTimeoutMs: 250,
            confirm: function () { return true; }
        });
        try {
            controller.activate(host);
            await flush();
            const preset = host.querySelector(".masking-preset-button");
            const presetLoadingDisabled = preset && preset.disabled;
            const presetLoadingLabel = preset && preset.textContent;
            context = Object.assign({}, context, {
                contextCounter: context.contextCounter + 1,
                developCounter: context.developCounter + 1,
                contextChangedAt: context.contextChangedAt + 1
            });
            revision += 1;
            controller.updateContext(context);
            await flush();
            presetInventory.resolve({
                ok: true,
                presets: [
                    ["lp-native-temperature", "Temp"], ["lp-native-tint", "Tint"],
                    ["lp-native-exposure", "Exposure"], ["lp-native-contrast", "Contrast"],
                    ["lp-native-highlights", "Highlights"], ["lp-native-shadows", "Shadows"],
                    ["lp-native-whites", "Whites"], ["lp-native-blacks", "Blacks"],
                    ["lp-native-texture", "Texture"], ["lp-native-clarity", "Clarity"],
                    ["lp-native-dehaze", "Dehaze"], ["lp-native-amount", "Amount"],
                    ["lp-native-hue", "Hue"], ["lp-native-saturation", "Saturation"],
                    ["lp-native-sharpness", "Sharpness"], ["lp-native-noise-reduction", "Noise Reduction"],
                    ["lp-native-moire", "Moiré"], ["lp-native-defringe", "Defringe"]
                ].map(function (entry) {
                    return { id: entry[0], name: entry[1], kind: "builtin", supported: false,
                        unavailableReason: "Native selection unavailable" };
                }).concat([
                    { id: "lp-burnfixture", name: "Burn (Darken)", kind: "file", supported: true, unavailableReason: null },
                    { id: "lp-dodgefixture", name: "Dodge (Lighten)", kind: "file", supported: true, unavailableReason: null }
                ], Array.from({ length: 80 }, function (_value, index) {
                    return { id: "lp-scrollfixture" + index, name: "Saved Touch Preset " + (index + 1),
                        kind: "file", supported: true, unavailableReason: null };
                }))
            });
            await flush(60);
            const hueRow = host.querySelector('[data-point-color-field="HueShift"]');
            const hueNumber = hueRow.children[2];
            const huePlus = hueRow.children[4];
            if (!preset || !hueRow || preset.disabled) throw new Error("Masking probe did not start idle and available");
            preset.click();
            await flush();
            const presetOptions = Array.from(host.querySelectorAll(".develop-preset-picker-option-primary"))
                .map(function (option) { return option.textContent; });
            const presetDialog = host.querySelector(".masking-preset-picker");
            const presetList = host.querySelector(".masking-preset-picker-list");
            const presetRows = Array.from(host.querySelectorAll(".masking-preset-picker-option"));
            const focusedPresetRow = presetRows[presetRows.length - 4];
            focusedPresetRow.focus({ preventScroll: true });
            presetList.scrollTop = Math.max(1, presetList.scrollHeight - presetList.clientHeight - 12);
            const presetScrollBeforePolls = presetList.scrollTop;
            const firstPresetRow = presetRows[0];
            for (let poll = 0; poll < 5; poll += 1) {
                currentPreset = poll % 2 === 0
                    ? { id: "lp-native-hue", name: "Hue", source: "reconciled", edited: false }
                    : { id: "lp-burnfixture", name: "Burn (Darken)", source: "provenance", edited: true };
                revision += 1;
                await controller.refresh();
                await flush();
            }
            const presetScrollAfterPolls = presetList.scrollTop;
            const presetFocusStable = document.activeElement === focusedPresetRow;
            const presetDomStable = host.querySelectorAll(".masking-preset-picker-option")[0] === firstPresetRow;
            const pickerStayedOpen = presetDialog.open && !presetDialog.hidden;
            host.querySelector(".develop-preset-picker-close").click();

            for (let index = 0; index < 20; index += 1) huePlus.click();
            const pointIntended = hueNumber.value;
            const pointBusyDuring = preset.disabled;
            const firstPointSequence = nextSequence();
            (await takeDeferred(pointAdmissions, "first Point Color request", controller)).resolve(
                await response({ ok: true, editSequence: firstPointSequence }));
            await flush();
            hueShift = 0.01;
            revision += 1;
            lastEditResult = { sequence: firstPointSequence, kind: "masking.point_color.value.set",
                maskGroupId: maskId, outcome: "confirmed", detail: "" };
            feedbackSequence = firstPointSequence;
            await controller.refresh();
            await flush();
            const pointAfterIntermediate = hueNumber.value;
            const secondPointSequence = nextSequence();
            (await takeDeferred(pointAdmissions, "coalesced Point Color request", controller)).resolve(
                await response({ ok: true, editSequence: secondPointSequence }));
            await flush();
            hueShift = 0.2;
            revision += 1;
            lastEditResult = { sequence: secondPointSequence, kind: "masking.point_color.value.set",
                maskGroupId: maskId, outcome: "confirmed", detail: "" };
            feedbackSequence = secondPointSequence;
            await controller.refresh();
            await flush();
            const pointSettled = hueNumber.value;
            const pointPresetAfterSettlement = !preset.disabled;

            huePlus.click();
            const failedPointSequence = nextSequence();
            (await takeDeferred(pointAdmissions, "failing Point Color request", controller)).resolve(
                await response({ ok: true, editSequence: failedPointSequence }));
            await flush();
            revision += 1;
            lastEditResult = { sequence: failedPointSequence, kind: "masking.point_color.value.set",
                maskGroupId: maskId, outcome: "failed", detail: "browser fixture rejection" };
            feedbackSequence = failedPointSequence;
            await controller.refresh();
            await flush();
            const pointPresetAfterFailure = !preset.disabled;

            lastEditResult = null;
            huePlus.click();
            const timeoutPointSequence = nextSequence();
            (await takeDeferred(pointAdmissions, "timed-out Point Color request", controller)).resolve(
                await response({ ok: true, editSequence: timeoutPointSequence }));
            await flush(60);
            const pointPresetAfterTimeout = !preset.disabled;

            const refineEditor = host.querySelector('[aria-label="Edit Refine Saturation value"]');
            const refinePlus = host.querySelector('[aria-label="Increase Refine Saturation"]');
            const refineMinus = host.querySelector('[aria-label="Decrease Refine Saturation"]');
            for (let index = 0; index < 12; index += 1) {
                if (refinePlus.disabled) throw new Error("Refine plus disabled at rapid click " + index + ": " +
                    JSON.stringify(controller.getInteractionState()));
                refinePlus.click();
            }
            for (let index = 0; index < 7; index += 1) {
                if (refineMinus.disabled) throw new Error("Refine minus disabled at rapid click " + index + ": " +
                    JSON.stringify(controller.getInteractionState()));
                refineMinus.click();
            }
            const refineIntended = refineEditor.value;
            const refineBusyDuring = preset.disabled;
            await flush();
            const firstRefineSequence = nextSequence();
            (await takeDeferred(refineEnds, "first Refine request", controller)).resolve(
                await response({ ok: true, editSequence: firstRefineSequence }));
            await flush();
            refineValue = 51;
            revision += 1;
            lastEditResult = { sequence: firstRefineSequence,
                kind: "masking.tone_curve.refine_saturation.gesture.end", maskGroupId: maskId,
                outcome: "confirmed", detail: "" };
            feedbackSequence = firstRefineSequence;
            await controller.refresh();
            await flush(30);
            const refineAfterIntermediate = refineEditor.value;
            const secondRefineSequence = nextSequence();
            (await takeDeferred(refineEnds, "coalesced Refine request", controller)).resolve(
                await response({ ok: true, editSequence: secondRefineSequence }));
            await flush();
            refineValue = 55;
            revision += 1;
            lastEditResult = { sequence: secondRefineSequence,
                kind: "masking.tone_curve.refine_saturation.gesture.end", maskGroupId: maskId,
                outcome: "confirmed", detail: "" };
            feedbackSequence = secondRefineSequence;
            await controller.refresh();
            await waitUntil(function () {
                const tone = controller.getInteractionState().toneCurve;
                return tone && !tone.refineStepIntent && !tone.refineGestureActive && !tone.awaitingRefine;
            }, "final Refine intention", controller);
            const refineSettled = refineEditor.value;
            const refinePresetAfterSettlement = !preset.disabled;

            if (refinePlus.disabled) throw new Error("Refine plus remained disabled after final settlement: " +
                JSON.stringify(controller.getInteractionState()));
            refinePlus.click();
            await flush();
            const failedRefineSequence = nextSequence();
            (await takeDeferred(refineEnds, "failing Refine request", controller)).resolve(
                await response({ ok: true, editSequence: failedRefineSequence }));
            await flush();
            revision += 1;
            lastEditResult = { sequence: failedRefineSequence,
                kind: "masking.tone_curve.refine_saturation.gesture.end", maskGroupId: maskId,
                outcome: "failed", detail: "browser Refine rejection" };
            feedbackSequence = failedRefineSequence;
            await controller.refresh();
            await waitUntil(function () {
                const tone = controller.getInteractionState().toneCurve;
                return tone && !tone.refineStepIntent && !tone.refineGestureActive && !tone.awaitingRefine;
            }, "failed Refine intention", controller);
            const refinePresetAfterFailure = !preset.disabled;
            const addPointAvailable = !host.querySelector('[aria-label="Add point"]').disabled;

            currentPreset = { id: "lp-burnfixture", name: "Burn (Darken)", kind: "file",
                source: "provenance", edited: true };
            maskName = "Renamed directly in Lightroom";
            componentName = "Brush renamed directly in Lightroom";
            revision += 1;
            await controller.refresh();
            await flush();
            const presetAfterSyntheticEditedState = preset.textContent;
            const renamedMaskPosition = host.querySelector(".masking-position").textContent;
            const renamedComponentPosition = host.querySelector(".masking-component-position").textContent;

            currentPreset = { id: "lp-native-moire", name: "Moiré", kind: "builtin", source: "reconciled" };
            revision += 1;
            await controller.refresh();
            await flush();
            const presetAfterSyntheticMoiréState = preset.textContent;

            maskId = "masking-intent-mask-2";
            maskName = "Second Mask";
            maskIndex = 2;
            maskCount = 2;
            componentId = "masking-intent-component-2";
            componentName = "Background 1";
            componentType = "background";
            currentPreset = { id: "lp-custom", name: "Custom", kind: "marker", source: "reconciled" };
            revision += 1;
            await controller.refresh();
            await flush();
            const switchedMaskPreset = preset.textContent;
            const switchedMaskPosition = host.querySelector(".masking-position").textContent;
            const switchedComponentPosition = host.querySelector(".masking-component-position").textContent;

            const interaction = controller.getInteractionState();
            return {
                presetLoadingDisabled: presetLoadingDisabled,
                presetLoadingLabel: presetLoadingLabel,
                presetOptions: {
                    count: presetOptions.length,
                    first: presetOptions[0],
                    last: presetOptions[presetOptions.length - 1],
                    hasMoiré: presetOptions.includes("Moiré")
                },
                presetScrollWasScrollable: presetScrollBeforePolls > 0,
                presetScrollStable: presetScrollAfterPolls === presetScrollBeforePolls,
                presetFocusStable: presetFocusStable,
                presetDomStable: presetDomStable,
                pickerStayedOpen: pickerStayedOpen,
                pointIntended: pointIntended,
                pointAfterIntermediate: pointAfterIntermediate,
                pointSettled: pointSettled,
                pointBusyDuring: pointBusyDuring,
                pointPresetAfterSettlement: pointPresetAfterSettlement,
                pointPresetAfterFailure: pointPresetAfterFailure,
                pointPresetAfterTimeout: pointPresetAfterTimeout,
                refineIntended: refineIntended,
                refineAfterIntermediate: refineAfterIntermediate,
                refineSettled: refineSettled,
                refineBusyDuring: refineBusyDuring,
                refinePresetAfterSettlement: refinePresetAfterSettlement,
                refinePresetAfterFailure: refinePresetAfterFailure,
                addPointAvailable: addPointAvailable,
                presetAfterSyntheticEditedState: presetAfterSyntheticEditedState,
                presetAfterSyntheticMoiréState: presetAfterSyntheticMoiréState,
                switchedMaskPreset: switchedMaskPreset,
                renamedMaskPosition: renamedMaskPosition,
                renamedComponentPosition: renamedComponentPosition,
                switchedMaskPosition: switchedMaskPosition,
                switchedComponentPosition: switchedComponentPosition,
                presetRequests: presetRequests,
                presetPlaceholder: preset.textContent,
                finalBusy: interaction.correctionBusy,
                finalActiveOperation: interaction.activeOperation,
                finalPresetDisabled: interaction.presetDisabled
            };
        } finally {
            controller.deactivate();
            host.remove();
        }
    })();
}

async function runLifecycleTest(cdp, controllerUrl, mock, options) {
    const exceptions = [];
    const consoleErrors = [];
    const failedRequests = [];
    const non2xxResponses = [];
    const externalRequests = [];
    const responses = [];
    const requestUrls = new Map();

    cdp.onEvent = function (message) {
        if (message.method === "Runtime.bindingCalled" && message.params.name === "__lrbridgeLayoutTouch") {
            const input = JSON.parse(message.params.payload);
            cdp.send("Input.dispatchTouchEvent", {
                type: input.type,
                touchPoints: input.type === "touchEnd" ? [] : [{ x: input.x, y: input.y, id: 721 }]
            }).then(function () {
                return cdp.send("Runtime.evaluate", { expression: "window.__lrbridgeLayoutTouchDone()" });
            }).catch(function (error) {
                exceptions.push(error.message);
                cdp.send("Runtime.evaluate", {
                    expression: "window.__lrbridgeLayoutTouchDone(" + JSON.stringify(error.message) + ")"
                }).catch(function () {});
            });
        }
        if (message.method === "Runtime.exceptionThrown") {
            exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
        }
        if (message.method === "Runtime.consoleAPICalled" &&
            (message.params.type === "error" || message.params.type === "assert")) {
            consoleErrors.push(message.params.args.map(function (argument) {
                return argument.value ?? argument.description ?? "";
            }).join(" "));
        }
        if (message.method === "Network.requestWillBeSent") {
            const requestUrl = message.params.request.url;
            requestUrls.set(message.params.requestId, requestUrl);
            if (/^https?:/i.test(requestUrl) && !requestUrl.startsWith(controllerUrl + "/")) {
                externalRequests.push(requestUrl);
            }
        }
        if (message.method === "Network.loadingFailed") {
            const requestUrl = requestUrls.get(message.params.requestId);
            if (requestUrl && requestUrl.startsWith(controllerUrl + "/") && message.params.canceled !== true) {
                failedRequests.push({ url: requestUrl, errorText: message.params.errorText });
            }
        }
        if (message.method === "Network.responseReceived") {
            const response = message.params.response;
            if (!response.url.startsWith(controllerUrl + "/")) return;
            const entry = { url: response.url, status: response.status, mimeType: response.mimeType };
            responses.push(entry);
            if (response.status < 200 || response.status >= 300) non2xxResponses.push(entry);
        }
    };

    function evaluate(expression) {
        return cdp.send("Runtime.evaluate", {
            expression: expression,
            awaitPromise: true,
            returnByValue: true
        }).then(function (result) {
            if (result.exceptionDetails) {
                throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
            }
            return result.result.value;
        });
    }

    async function waitFor(probe, description, timeoutMs) {
        const deadline = Date.now() + (timeoutMs || operationTimeoutMs);
        let lastError = null;
        while (Date.now() < deadline) {
            try {
                if (await probe()) return;
                lastError = null;
            } catch (error) {
                lastError = error;
            }
            await sleep(50);
        }
        throw new Error("Timed out waiting for " + description + (lastError ? ": " + lastError.message : ""));
    }

    async function selectTab(tab) {
        const clicked = await evaluate("(async () => { const deadline=Date.now()+5000;" +
            "while(window.__lrbridgeLifecycleTest.activeFetches>0&&Date.now()<deadline)" +
            "await new Promise(resolve=>setTimeout(resolve,10));" +
            "const button=document.querySelector('[data-tab=\"" + tab + "\"]');" +
            "if(!button)return false;button.click();return true;})()");
        assert.equal(clicked, true, "missing Controller tab: " + tab);
        await waitFor(function () {
            return evaluate("document.querySelector('.tab-button.active')?.dataset.tab === " + JSON.stringify(tab));
        }, tab + " activation");
    }

    function tabState(tab, round) {
        return evaluate("(() => ({" +
            "round:" + round + ",tab:" + JSON.stringify(tab) + "," +
            "jumpMenus:document.querySelectorAll('.slider-jump-control').length," +
            "sentinels:document.querySelectorAll('.slider-jump-sentinel').length," +
            "presetControllers:document.querySelectorAll('.develop-presets-controller').length," +
            "toneLoading:document.getElementById('content').innerText.includes('Loading authoritative Lightroom values')," +
            "metadataError:document.getElementById('content').innerText.includes('Could not load authoritative slider metadata')" +
            "}))()");
    }

    function listenerRoles(listenerKeys) {
        return listenerKeys.map(function (key) {
            return key.replace(/:\d+:(true|false)$/, ":$1");
        }).sort();
    }

    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Page.enable");
    const newDocumentScript = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
        source: "(" + installLifecycleDiagnostics.toString() + ")();" + (options && options.maskCreateOnly ?
            "window.__deletePrompts=[];window.__deleteAccept=false;window.confirm=message=>(__deletePrompts.push(message),__deleteAccept);" : "")
    });

    try {
        const layoutOnly = options && options.toneCurveLayoutOnly === true;
        const grainOnly = options && options.grainOnly === true;
        const navigation = await cdp.send("Page.navigate", {
            url: controllerUrl + (grainOnly ? "/#tools" : layoutOnly ? "/#tone-curve" : "/#presets")
        });
        assert.equal(navigation.errorText, undefined, "the isolated Controller navigation must succeed");
        await waitFor(function () {
            return evaluate("!!window.__lrbridgeLifecycleTest && " +
                "!!document.querySelector('" + (grainOnly ? ".masking-section" : layoutOnly ? ".point-curve-panel" : ".develop-presets-controller") + "') && " +
                "!!document.querySelector('.slider-jump-control') && " +
                "document.getElementById('status').textContent !== 'ERROR: Could not load authoritative slider metadata.'");
        }, "fresh isolated Controller render");
        await waitFor(function () {
            return Promise.resolve(responses.some(function (response) {
                return response.url === controllerUrl + "/api/context" && response.status === 200;
            }));
        }, "isolated authoritative context polling");

        if (grainOnly) {
            await cdp.send("Page.bringToFront");
            await waitFor(function () { return evaluate("document.hasFocus()"); }, "isolated Grain page focus");
            const grain = await (options.exportOnly ? exportBrowser : options.redEyeOnly ? redEyeBrowser : options.removeOnly ? removeBrowser : options.historyOnly ? historyBrowser : options.maskCreateOnly ? maskCreateBrowser : maskingGrainBrowser).verify({ evaluate, waitFor, selectTab, fixture: mock.grainFixture,
                peopleOnly: options.peopleOnly, dustOnly: options.dustOnly,
                setViewport: function (width, height) {
                    return cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
                },
                touch: (type, x, y) => cdp.send("Input.dispatchTouchEvent", {
                    type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 721 }]
                }),
                key: key => cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key }),
                capture: options.maskCreateOnly && options.screenshotDirectory ? async name => {
                    const capture = await cdp.send("Page.captureScreenshot", { format: "png" });
                    const file = path.join(options.screenshotDirectory, name + ".png");
                    fs.writeFileSync(file, Buffer.from(capture.data, "base64"));
                    console.log("Mask picker visual check: " + file);
                } : null
            });
            assert.deepEqual(externalRequests, []);
            assert.deepEqual(cdp.protocolErrors, []);
            assert.deepEqual(exceptions, []);
            assert.deepEqual(consoleErrors, []);
            assert.deepEqual(failedRequests, []);
            if (mock.grainFixture.creation && mock.grainFixture.creation.confirmationOnly) {
                assert.deepEqual(non2xxResponses.map(item => ({ path: new URL(item.url).pathname, status: item.status })),
                    [{ path: "/api/masking/state", status: 503 }], "only the explicitly injected feedback failure is expected");
            } else assert.deepEqual(non2xxResponses, []);
            assert.deepEqual(mock.unexpectedRequests, []);
            return { grain: grain };
        }

        if (layoutOnly) {
            await cdp.send("Runtime.addBinding", { name: "__lrbridgeLayoutTouch" });
            await cdp.send("Page.bringToFront");
            await waitFor(function () { return evaluate("document.hasFocus()"); }, "isolated page focus before input");
            assert.equal(await evaluate("document.getElementById('status').classList.contains('point-curve-status')"),
                true, "the production Develop host must pass its existing status element");
            await selectTab("tools");
            await waitFor(function () {
                return evaluate("!!document.querySelector('.masking-tone-curve .point-curve-status')");
            }, "production Masking status integration");
            assert.equal(await evaluate("document.getElementById('status').classList.contains('point-curve-status')"),
                false, "leaving Develop must restore its shared application status area");
            const layouts = await evaluate("(" + toneCurveLayoutProbe.toString() + ")()");
            assert.equal(layouts.length, 4, "both hosts must be checked at both widths");
            assert.deepEqual(externalRequests, []);
            assert.deepEqual(cdp.protocolErrors, []);
            assert.deepEqual(exceptions, []);
            assert.deepEqual(consoleErrors, []);
            assert.deepEqual(failedRequests, []);
            assert.deepEqual(non2xxResponses, []);
            return { toneCurveLayouts: layouts };
        }

        if (options && options.presetScrollOnly === true) {
            const presetScroll = await evaluate("(" + maskingPresetScrollProbe.toString() + ")()");
            assert.deepEqual(presetScroll, {
                rowCount: 98,
                scrollable: true,
                scrollTopUnchanged: true,
                focusUnchanged: true,
                domUnchanged: true,
                containedWheelAndTouch: true,
                dialogStayedOpen: true,
                markerCount: 0,
                openerLabel: "Apply Mask Preset…",
                applyRequests: 10,
                inventoryRequests: 2,
                applicationChecks: true
            }, "Masking polls and synthetic preset-state changes must not rebuild, refocus, or scroll the dialog");
            assert.deepEqual(externalRequests, []);
            assert.deepEqual(cdp.protocolErrors, []);
            assert.deepEqual(exceptions, []);
            assert.deepEqual(consoleErrors, []);
            assert.deepEqual(failedRequests, []);
            assert.deepEqual(non2xxResponses, []);
            return { presetScrollOnly: true };
        }

        const toneCurveRendering = await evaluate("(" + toneCurveRenderingProbe.toString() + ")()");
        function assertVisibleCurve(instance, label) {
            assert.equal(instance.pathD, toneCurveRendering.expectedPath,
                label + " must render the exact supplied authoritative curve");
            assert.notEqual(instance.pathD, toneCurveRendering.diagonalPath,
                label + " must not collapse supplied control points to a diagonal");
            assert.notEqual(instance.pathStroke, "none", label + " curve stroke must be visible");
            assert.ok(instance.pathOpacity > 0, label + " curve opacity must be visible");
            assert.equal(instance.pathFill, "none", label + " curve path must not obscure the graph");
            assert.equal(instance.pathBeforeHandles, true, label + " points must stack above the curve path");
            assert.ok(instance.width > 0 && instance.height > 0, label + " SVG must mount at nonzero dimensions");
            assert.ok(Math.abs(instance.width - instance.height) < 1, label + " SVG must retain its square aspect ratio");
            assert.equal(instance.viewBox, "0 0 255 255");
            assert.equal(instance.markers.length, 3, label + " must render every supplied control point");
            instance.markers.forEach(function (marker, index) {
                assert.ok(marker.cx >= 0 && marker.cx <= 255 && marker.cy >= 0 && marker.cy <= 255,
                    label + " point " + index + " must be inside the SVG viewBox");
                assert.notEqual(marker.stroke, "none", label + " point " + index + " must have a visible stroke");
                assert.ok(marker.strokeWidth > 0 && marker.opacity > 0 && marker.display !== "none" &&
                    marker.visibility !== "hidden" && marker.intersectsSvg,
                label + " point " + index + " must render visibly inside the SVG bounds");
            });
        }
        assertVisibleCurve(toneCurveRendering.globalBefore, "global Point Curve");
        assertVisibleCurve(toneCurveRendering.maskBefore, "mask Point Curve");
        for (const [label, instance] of [["global", toneCurveRendering.globalBefore],
            ["mask", toneCurveRendering.maskBefore]]) {
            assert.equal(instance.pointActions.display, "grid", label + " Point Curve action row must render");
            assert.equal(instance.pointActions.beforeGraph, true,
                label + " Point Curve action row must precede its graph");
            assert.deepEqual(instance.pointActions.labels, ["+ Add Point", "Delete Point"]);
            assert.equal(instance.pointActions.deleteAriaLabel, "Delete point");
            assert.equal(instance.pointActions.deleteTitle, "Delete selected point");
            assert.match(instance.pointActions.deleteIconPath, /^M4 7h16/,
                label + " Point Curve must render the shared inline SVG trash icon");
            assert.equal(instance.pointActions.deleteDisabled, false,
                label + " Point Curve Delete Point must enable for the selected interior point");
        }
        assert.equal(toneCurveRendering.selected.input, "109");
        assert.equal(toneCurveRendering.selected.output, "93");
        assert.deepEqual(toneCurveRendering.globalAfter, toneCurveRendering.globalBefore,
            "mounting and changing the mask curve channel must leave the global instance unchanged");
        assert.notEqual(toneCurveRendering.maskAfterChannel.pathStroke, "none",
            "mask channel changes must retain a visible channel-colored stroke");
        assert.equal(toneCurveRendering.falseWarning, false,
            "initial loading and channel changes must not create false normalized or superseded warnings");

        const maskingIntentLifecycle = await evaluate("(" + maskingIntentLifecycleProbe.toString() + ")()");
        assert.deepEqual(maskingIntentLifecycle, {
            presetLoadingDisabled: false,
            presetLoadingLabel: "Apply Mask Preset…",
            presetOptions: { count: 82, first: "Burn (Darken)", last: "Saved Touch Preset 80", hasMoiré: false },
            presetScrollWasScrollable: true,
            presetScrollStable: true,
            presetFocusStable: true,
            presetDomStable: true,
            pickerStayedOpen: true,
            pointIntended: "20",
            pointAfterIntermediate: "20",
            pointSettled: "20",
            pointBusyDuring: true,
            pointPresetAfterSettlement: true,
            pointPresetAfterFailure: true,
            pointPresetAfterTimeout: true,
            refineIntended: "55",
            refineAfterIntermediate: "55",
            refineSettled: "55",
            refineBusyDuring: true,
            refinePresetAfterSettlement: true,
            refinePresetAfterFailure: true,
            addPointAvailable: true,
            presetAfterSyntheticEditedState: "Apply Mask Preset…",
            presetAfterSyntheticMoiréState: "Apply Mask Preset…",
            switchedMaskPreset: "Apply Mask Preset…",
            renamedMaskPosition: "Renamed directly in Lightroom — Mask 1 of 1",
            renamedComponentPosition: "Brush renamed directly in Lightroom — Component 1 of 1",
            switchedMaskPosition: "Second Mask — Mask 2 of 2",
            switchedComponentPosition: "Background 1 — Component 1 of 1",
            presetRequests: 0,
            presetPlaceholder: "Apply Mask Preset…",
            finalBusy: false,
            finalActiveOperation: null,
            finalPresetDisabled: false
        }, "real Chromium must preserve dialog scroll/focus across polls while refusing synthetic preset identity and writes");

        const initialListenerRoles = listenerRoles(
            await evaluate("Object.keys(window.__lrbridgeLifecycleTest.listeners)")
        );
        const categorical = fixtureCategoricalState();
        const context = fixtureContext();
        assert.equal(categorical.profile.available, true, "the isolated Profile fixture must be available");
        const authoritativeProfileLabel = categorical.profile.selectedLabel;

        const sequence = [
            "sliders", "presets", "tone-curve", "color-grading", "sliders",
            "presets", "selection", "application", "tools"
        ];
        const states = [];
        for (let round = 1; round <= 3; round += 1) {
            for (const tab of sequence) {
                await selectTab(tab);
                if (tab === "tone-curve") {
                    await waitFor(function () {
                        return evaluate("!document.getElementById('content').innerText.includes(" +
                            "'Loading authoritative Lightroom values')");
                    }, "isolated Tone Curve feedback");
                }
                if (tab === "sliders") {
                    await waitFor(function () {
                        return evaluate("Array.from(document.querySelectorAll('select option:checked')).some(" +
                            "option => option.textContent === " + JSON.stringify(authoritativeProfileLabel) + ")");
                    }, "isolated authoritative Profile label");
                }
                await sleep(100);
                const state = await tabState(tab, round);
                assert.equal(state.metadataError, false, tab + " must not show a false metadata failure");
                assert.ok(state.jumpMenus <= 1 && state.sentinels <= 1, tab + " accumulated Jump-to artifacts");
                assert.ok(state.presetControllers <= 1, tab + " accumulated Presets controllers");
                if (["sliders", "tone-curve", "color-grading", "presets", "tools"].includes(tab)) {
                    assert.equal(state.jumpMenus, 1, tab + " must render Jump-to");
                    assert.equal(state.sentinels, 1, tab + " must render one Jump-to sentinel");
                } else {
                    assert.equal(state.jumpMenus, 0, tab + " must not render Jump-to");
                    assert.equal(state.sentinels, 0, tab + " must not render a Jump-to sentinel");
                }
                if (tab === "presets") assert.equal(state.presetControllers, 1, "Presets must render once");
                if (tab === "tone-curve") assert.equal(state.toneLoading, false, "Tone Curve must leave loading state");
                states.push(state);
            }
        }

        async function clickJumpOption(tab, optionText, destinationTab) {
            await selectTab(tab);
            await evaluate("document.querySelector('.slider-jump-main-button').click()");
            const clicked = await evaluate("(() => { const option=Array.from(document.querySelectorAll(" +
                "'.slider-jump-option')).find(item => item.textContent === " + JSON.stringify(optionText) + ");" +
                "if(!option)return false;option.click();return true;})()");
            assert.equal(clicked, true, tab + " Jump-to option is missing: " + optionText);
            await waitFor(function () {
                return evaluate("document.querySelector('.tab-button.active')?.dataset.tab === " +
                    JSON.stringify(destinationTab));
            }, tab + " Jump-to destination");
        }

        const scrollCountBefore = await evaluate("window.__lrbridgeLifecycleTest.scrolls");
        await clickJumpOption("sliders", "White Balance", "sliders");
        assert.ok(await evaluate("window.__lrbridgeLifecycleTest.scrolls") > scrollCountBefore,
            "Develop Sliders Jump-to must scroll to its current rendered heading");
        await clickJumpOption("color-grading", "Tone Curve", "tone-curve");
        await clickJumpOption("tone-curve", "Presets", "presets");
        await clickJumpOption("presets", "Color Grading", "color-grading");

        await selectTab("sliders");
        await waitFor(function () {
            return evaluate("Array.from(document.querySelectorAll('select option:checked')).some(" +
                "option => option.textContent === " + JSON.stringify(authoritativeProfileLabel) + ")");
        }, "Profile before isolated epoch simulation");
        const profileEpochResult = await evaluate("(() => {" +
            "const healthy=" + JSON.stringify(categorical.profile) + ";" +
            "const oldUnavailable=Object.assign({},healthy,{available:false,updating:false," +
            "reason:'temporarily unavailable',revision:healthy.revision+1000,optionSnapshotRevision:healthy.optionSnapshotRevision+1000," +
            "processId:null,browsePosition:null,browseLabel:null,selectedToken:null,selectedLabel:null," +
            "source:null,supportsAmount:null,options:[]});" +
            "const oldAccepted=profileModel.apply(oldUnavailable).accepted;updateProfileControl();" +
            "const unavailableShown=profileModel.presentation().authoritativeLabel===null;" +
            "const staleRejected=profileModel.apply(healthy).accepted===false;" +
            "const previous={contextCounter:" + context.contextCounter + ",contextChangedAt:" + context.contextChangedAt +
            ",selectedPhotoKey:" + JSON.stringify(context.selectedPhotoKey) + ",selectedPhotoUuid:" +
            JSON.stringify(context.selectedPhotoUuid) + "};" +
            "const next=Object.assign({},previous,{contextChangedAt:previous.contextChangedAt+1});" +
            "const epochAccepted=profileContextBindingChanged(previous,next);" +
            "if(epochAccepted)profileModel.beginContext(healthy.contextCounter,healthy.photoKey,healthy.photoUuid);" +
            "const healthyAccepted=profileModel.apply(healthy).accepted;updateProfileControl();" +
            "return {oldAccepted,unavailableShown,staleRejected,epochAccepted,healthyAccepted," +
            "label:profileModel.presentation().authoritativeLabel};})()");
        assert.deepEqual(profileEpochResult, {
            oldAccepted: true,
            unavailableShown: true,
            staleRejected: true,
            epochAccepted: true,
            healthyAccepted: true,
            label: authoritativeProfileLabel
        }, "a newer server epoch must restore lower-revision authoritative Profile feedback");

        await waitFor(function () {
            return evaluate("window.__lrbridgeLifecycleTest.activeFetches === 0");
        }, "browser requests to settle");
        await sleep(200);
        const animationFrameCount = await evaluate("window.__lrbridgeLifecycleTest.animationFrames.scheduled");
        await sleep(250);
        const diagnostics = await evaluate("window.__lrbridgeLifecycleTest");
        assert.equal(diagnostics.animationFrames.scheduled, animationFrameCount,
            "Jump-to installation must reach a stable frame with no perpetual requestAnimationFrame retry");
        assert.equal(diagnostics.animationFrames.active, 0, "no Jump-to animation frame may remain pending");
        assert.deepEqual(diagnostics.insertViolations, [], "no render may use a detached insertBefore reference");
        assert.equal(diagnostics.mutationObservers, 1, "the Controller must install one content observer");
        assert.equal(diagnostics.intersectionCreated - diagnostics.intersectionDisconnected, 1,
            "only the current Jump-to dock observer may remain active");
        assert.deepEqual(Object.values(diagnostics.intervals).sort(function (left, right) { return left - right; }),
            [500, 500, 1000], "only the three shared polling intervals may remain on Develop Sliders");
        assert.deepEqual(listenerRoles(Object.keys(diagnostics.listeners)), initialListenerRoles,
            "document/window listener roles must not accumulate across Controller renders");
        assert.equal(await evaluate("document.querySelectorAll('.slider-jump-control').length"), 1);
        assert.equal(await evaluate("document.querySelectorAll('.slider-jump-sentinel').length"), 1);
        assert.equal(await evaluate("document.querySelectorAll('.develop-presets-controller').length"), 0);

        const sliderResponse = responses.find(function (response) { return response.url === controllerUrl + "/api/sliders"; });
        assert.ok(sliderResponse, "the fresh Controller must request /api/sliders");
        assert.equal(sliderResponse.status, 200);
        assert.equal(sliderResponse.mimeType, "application/json");
        assert.deepEqual(mock.unexpectedRequests, [], "unexpected isolated requests: " + JSON.stringify(mock.unexpectedRequests));
        assert.ok(mock.requestLog.every(function (request) { return request.method === "GET"; }),
            "the lifecycle test must never issue a mutating HTTP request");
        assert.deepEqual(externalRequests, [], "the isolated Controller must not contact external or live LRBridge origins");
        assert.deepEqual(cdp.protocolErrors, [], "CDP protocol errors: " + cdp.protocolErrors.join("\n"));
        assert.deepEqual(exceptions, [], "browser exceptions: " + exceptions.join("\n"));
        assert.deepEqual(consoleErrors, [], "browser console errors: " + consoleErrors.join("\n"));
        assert.deepEqual(failedRequests, [], "failed browser requests: " + JSON.stringify(failedRequests));
        assert.deepEqual(non2xxResponses, [], "non-2xx browser responses: " + JSON.stringify(non2xxResponses));

        return { renders: states.length, profile: authoritativeProfileLabel };
    } finally {
        if (newDocumentScript && newDocumentScript.identifier && cdp.socket.readyState === WebSocket.OPEN) {
            await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: newDocumentScript.identifier });
        }
    }
}

async function cleanup(resources) {
    const errors = [];
    const attempt = async function (action) {
        try { await action(); }
        catch (error) { errors.push(error); }
    };

    if (resources.browserCdp && resources.browserCdp.socket.readyState === WebSocket.OPEN) {
        await attempt(function () {
            return resources.browserCdp.send("Browser.close").catch(function () {
                /* Graceful closure may close the browser-level socket before its reply. */
            });
        });
    }
    let browserExited = await waitForProcessExit(resources.browser, 5000);
    if (!browserExited && resources.browser) {
        resources.browser.kill();
        browserExited = await waitForProcessExit(resources.browser, 5000);
    }
    if (!browserExited && resources.browser) errors.push(new Error("The isolated Chromium process did not exit during cleanup"));
    await attempt(function () { return resources.pageCdp ? resources.pageCdp.closeSocket() : Promise.resolve(); });
    await attempt(function () { return resources.browserCdp ? resources.browserCdp.closeSocket() : Promise.resolve(); });
    await attempt(function () { return closeServer(resources.mock.server); });
    if (!resources.preserveBrowserProfile) {
        await attempt(function () { removeBrowserProfileDirectory(resources.browserProfileDirectory); });
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Browser lifecycle cleanup failed");
}

async function main() {
    const presetScrollOnly = process.argv.includes("--masking-preset-scroll-only");
    const toneCurveLayoutOnly = process.argv.includes("--tone-curve-layout-only");
    const historyOnly = process.argv.includes("--history-only");
    const deleteConfirmationOnly = process.argv.includes("--delete-confirmation-only");
    const maskCreateOnly = process.argv.includes("--mask-create-only") || deleteConfirmationOnly;
    const peopleOnly = process.argv.includes("--people-only");
    const redEyeOnly = process.argv.includes("--red-eye-only");
    const exportOnly = process.argv.includes("--export-only");
    const dustOnly = process.argv.includes("--dust-only");
    const removeOnly = process.argv.includes("--remove-only") || peopleOnly || dustOnly;
    const grainOnly = process.argv.includes("--grain-only") || historyOnly || maskCreateOnly || removeOnly || redEyeOnly || exportOnly;
    const resources = {
        mock: createMockControllerServer({ grainOnly: grainOnly, historyOnly: historyOnly, maskCreateOnly: maskCreateOnly,
            deleteConfirmationOnly: deleteConfirmationOnly, removeOnly: removeOnly, redEyeOnly: redEyeOnly, exportOnly: exportOnly }),
        browser: null,
        browserProfileDirectory: null,
        browserCdp: null,
        pageCdp: null,
        preserveBrowserProfile: process.argv.includes("--preserve-browser-profile")
    };
    const emergencyStop = function () {
        if (!processHasExited(resources.browser)) resources.browser.kill();
        if (typeof resources.mock.server.closeAllConnections === "function") resources.mock.server.closeAllConnections();
    };
    process.once("exit", emergencyStop);

    let summary = null;
    try {
        const port = await listen(resources.mock.server);
        const controllerUrl = "http://127.0.0.1:" + port;
        resources.browserProfileDirectory = createBrowserProfileDirectory();
        resources.browser = launchBrowser(findBrowserExecutable(), resources.browserProfileDirectory);
        const devTools = await waitForDevTools(resources.browser, resources.browserProfileDirectory);
        resources.browserCdp = await connectCdp(devTools.browserWebSocketUrl);
        const targets = await fetchJson(devTools.debugUrl + "/json/list", {}, "the isolated Chromium target list");
        const target = targets.find(function (candidate) { return candidate.type === "page"; });
        assert.ok(target && target.webSocketDebuggerUrl, "the isolated Chromium page target must exist");
        resources.pageCdp = await connectCdp(target.webSocketDebuggerUrl);
        summary = await runLifecycleTest(resources.pageCdp, controllerUrl, resources.mock, {
            presetScrollOnly: presetScrollOnly,
            toneCurveLayoutOnly: toneCurveLayoutOnly,
            grainOnly: grainOnly,
            historyOnly: historyOnly,
            maskCreateOnly: maskCreateOnly,
            removeOnly: removeOnly,
            redEyeOnly: redEyeOnly,
            exportOnly: exportOnly,
            peopleOnly: peopleOnly,
            dustOnly: dustOnly,
            screenshotDirectory: process.argv.includes("--mask-create-screenshot") ? resources.browserProfileDirectory : null
        });
        if (maskCreateOnly && process.argv.includes("--mask-create-screenshot")) {
            await resources.pageCdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
            await resources.pageCdp.send("Runtime.evaluate", {
                expression: "document.querySelector('.masking-create-button').click()"
            });
            for (const position of ["top", "bottom"]) {
                const geometry = await resources.pageCdp.send("Runtime.evaluate", {
                    expression: "(() => {const m=document.querySelector('.masking-create-choices');m.scrollTop=" +
                        (position === "top" ? "0" : "m.scrollHeight") + ";const e=document.querySelector('.masking-create-menu').getBoundingClientRect();" +
                        "return {x:e.left+scrollX-8,y:e.top+scrollY-8,width:e.width+16,height:e.height+16,scale:1};})()",
                    returnByValue: true
                });
                const capture = await resources.pageCdp.send("Page.captureScreenshot", {
                    format: "png", captureBeyondViewport: true, clip: geometry.result.value
                });
                const screenshotPath = path.join(resources.browserProfileDirectory, "mask-create-" + position + ".png");
                fs.writeFileSync(screenshotPath, Buffer.from(capture.data, "base64"));
                console.log("Mask menu visual check: " + screenshotPath);
            }
        }
        if (grainOnly && process.argv.includes("--grain-screenshot")) {
            await resources.pageCdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
            const geometry = await resources.pageCdp.send("Runtime.evaluate", {
                expression: "(() => {const e=document.querySelector('[data-masking-correction-group=Effects]').getBoundingClientRect();" +
                    "const d=document.querySelector('[data-masking-correction-group=Detail]').getBoundingClientRect();" +
                    "return {x:e.left+scrollX,y:e.top+scrollY,width:e.width,height:d.bottom-e.top,scale:1};})()",
                returnByValue: true
            });
            const capture = await resources.pageCdp.send("Page.captureScreenshot", {
                format: "png", captureBeyondViewport: true, clip: geometry.result.value
            });
            const screenshotPath = path.join(resources.browserProfileDirectory, "grain-effects.png");
            fs.writeFileSync(screenshotPath, Buffer.from(capture.data, "base64"));
            console.log("Grain visual check: " + screenshotPath);
        }
    } finally {
        await cleanup(resources);
        process.removeListener("exit", emergencyStop);
    }

    if (resources.preserveBrowserProfile) console.log("Browser profile preserved: " + resources.browserProfileDirectory);
    if (summary.grain) {
        console.log((redEyeOnly ? "Isolated Red Eye browser regression passed: " : removeOnly ? "Isolated Remove brush preferences browser regression passed: " : historyOnly ? "Isolated shared Undo/Redo browser regression passed: " : maskCreateOnly ?
            "Isolated Create New Mask browser regression passed: " : "Isolated global/Masking Grain browser regression passed: ") + JSON.stringify(summary.grain));
    } else if (summary.toneCurveLayouts) {
        console.log("Isolated Chromium Tone Curve layout regression passed: " + JSON.stringify(summary.toneCurveLayouts));
    } else if (summary.presetScrollOnly) {
        console.log("Isolated Masking preset dialog scroll/focus regression passed.");
    } else {
        console.log("Isolated Controller seven-tab lifecycle regression passed (" + summary.renders +
            " renders, Profile " + summary.profile + ").");
    }
}

main().catch(function (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
});
