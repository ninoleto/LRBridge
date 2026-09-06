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

function createMockControllerServer() {
    const staticFiles = new Map([
        ["/", "controller.html"],
        ["/controller.html", "controller.html"],
        ["/controller-color-grading.js", "controller-color-grading.js"],
        ["/controller-denoise-state.js", "controller-denoise-state.js"],
        ["/controller-develop-categorical.js", "controller-develop-categorical.js"],
        ["/controller-lens-blur.js", "controller-lens-blur.js"],
        ["/controller-tone-curve.js", "controller-tone-curve.js"],
        ["/controller-section-collapse.js", "controller-section-collapse.js"],
        ["/controller-develop-presets.js", "controller-develop-presets.js"],
        ["/controller-masking.js", "controller-masking.js"]
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
                previousAvailable: false,
                nextAvailable: false,
                selectedMaskToolAvailable: false,
                selectedMaskToolId: null
            });
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

    return { server: server, requestLog: requestLog, unexpectedRequests: unexpectedRequests };
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

async function runLifecycleTest(cdp, controllerUrl, mock) {
    const exceptions = [];
    const consoleErrors = [];
    const failedRequests = [];
    const non2xxResponses = [];
    const externalRequests = [];
    const responses = [];
    const requestUrls = new Map();

    cdp.onEvent = function (message) {
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
        source: "(" + installLifecycleDiagnostics.toString() + ")();"
    });

    try {
        const navigation = await cdp.send("Page.navigate", { url: controllerUrl + "/#presets" });
        assert.equal(navigation.errorText, undefined, "the isolated Controller navigation must succeed");
        await waitFor(function () {
            return evaluate("!!window.__lrbridgeLifecycleTest && " +
                "!!document.querySelector('.develop-presets-controller') && " +
                "!!document.querySelector('.slider-jump-control') && " +
                "document.getElementById('status').textContent !== 'ERROR: Could not load authoritative slider metadata.'");
        }, "fresh isolated Presets render");
        await waitFor(function () {
            return Promise.resolve(responses.some(function (response) {
                return response.url === controllerUrl + "/api/context" && response.status === 200;
            }));
        }, "isolated authoritative context polling");

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
    await attempt(function () { removeBrowserProfileDirectory(resources.browserProfileDirectory); });

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Browser lifecycle cleanup failed");
}

async function main() {
    const resources = {
        mock: createMockControllerServer(),
        browser: null,
        browserProfileDirectory: null,
        browserCdp: null,
        pageCdp: null
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
        summary = await runLifecycleTest(resources.pageCdp, controllerUrl, resources.mock);
    } finally {
        await cleanup(resources);
        process.removeListener("exit", emergencyStop);
    }

    console.log("Isolated Controller seven-tab lifecycle regression passed (" + summary.renders +
        " renders, Profile " + summary.profile + ").");
}

main().catch(function (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
});
