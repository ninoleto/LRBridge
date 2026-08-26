const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, shell, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const os = require("os");
const { proxyControllerRequest } = require("./controller-proxy");
const { applyControllerHttpSettings } = require("./controller-http-settings");
const { stopControllerServer } = require("./controller-server-lifecycle");
const {
    MINIMIZE_BEHAVIOR_SETTING,
    NORMAL_MINIMIZE_BEHAVIOR,
    isValidMinimizeBehavior,
    readMinimizeBehaviorFromText,
    updateSettingText
} = require("./desktop-settings");
const { createDesktopMinimizeController } = require("./desktop-minimize");
const { createDesktopQuitController } = require("./desktop-quit");
const { createDesktopShutdownCoordinator } = require("./desktop-shutdown");

const projectRoot = path.join(__dirname, "..");
const portableRoot = app.isPackaged ? path.dirname(process.execPath) : projectRoot;
const bridgePath = path.join(projectRoot, "bridge.js");
const settingsPath = path.join(portableRoot, "config", "settings.txt");
const trayIconPath = path.join(__dirname, "tray.png");
const controllerPath = path.join(__dirname, "controller.html");
const controllerColorGradingPath = path.join(__dirname, "controller-color-grading.js");
const controllerLensBlurPath = path.join(__dirname, "controller-lens-blur.js");
const controllerDenoiseStatePath = path.join(__dirname, "controller-denoise-state.js");
const controllerDevelopCategoricalPath = path.join(__dirname, "controller-develop-categorical.js");
const controllerToneCurvePath = path.join(__dirname, "controller-tone-curve.js");
const controllerHelpPath = path.join(__dirname, "controller-help.html");
const companionCheatsheetHtmlPath = path.join(__dirname, "companion-cheatsheet.html");

const defaultPollingMs = 100;
const minPollingMs = 10;
const maxPollingMs = 1000;

const bridgeHttpPort = 17891;
const controllerPort = 17892;
const controllerListenHost = "0.0.0.0";
const controllerLocalUrl = "http://127.0.0.1:" + controllerPort + "/";

function isLikelyLanAddress(address) {
    if (address.startsWith("192.168.")) {
        return true;
    }

    if (address.startsWith("10.")) {
        return true;
    }

    const match = address.match(/^172\.(\d+)\./);

    if (match) {
        const second = Number(match[1]);
        return second >= 16 && second <= 31;
    }

    return false;
}

function getLanAddresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];

    for (const interfaceName of Object.keys(interfaces)) {
        for (const item of interfaces[interfaceName]) {
            if (item.family === "IPv4" && !item.internal && isLikelyLanAddress(item.address)) {
                addresses.push(item.address);
            }
        }
    }

    return addresses;
}

const controllerLanUrls = getLanAddresses().map(function (address) {
    return "http://" + address + ":" + controllerPort + "/";
});

const controllerUrl = controllerLocalUrl;

const defaultLightroomPath = path.join(
    process.env.ProgramFiles || "C:\\Program Files",
    "Adobe",
    "Adobe Lightroom Classic",
    "Lightroom.exe"
);

let mainWindow = null;
let desktopMinimizeController = null;
let desktopQuitController = null;
let isQuitting = false;
let bridgeStarted = false;
let bridgeRuntime = null;
let controllerServerStarted = false;
let controllerServer = null;

const desktopShutdownCoordinator = createDesktopShutdownCoordinator({
    getBridge: function () { return bridgeRuntime; },
    clearBridge: function () { bridgeRuntime = null; },
    stopBridge: function (bridge) { return bridge.stop(); },
    getControllerServer: function () { return controllerServer; },
    clearControllerServer: function () { controllerServer = null; },
    stopControllerServer: stopControllerServer,
    resumeQuit: function () { app.quit(); },
    logShutdownError: function (label, err) {
        console.error(label + " shutdown failed:", err && err.message ? err.message : err);
    }
});

const logLines = [];

function formatLogPart(part) {
    if (typeof part === "string") {
        return part;
    }

    try {
        return JSON.stringify(part);
    } catch (err) {
        return String(part);
    }
}

function addLog(source, parts) {
    const timestamp = new Date().toLocaleTimeString();
    const message = parts.map(formatLogPart).join(" ");
    const line = "[" + timestamp + "] " + source + ": " + message;

    logLines.push(line);

    if (logLines.length > 1000) {
        logLines.shift();
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("bridge-log", line);
    }
}

function patchConsole() {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = function (...parts) {
        addLog("LOG", parts);
        originalLog.apply(console, parts);
    };

    console.warn = function (...parts) {
        addLog("WARN", parts);
        originalWarn.apply(console, parts);
    };

    console.error = function (...parts) {
        addLog("ERROR", parts);
        originalError.apply(console, parts);
    };
}

function clampPollingMs(value) {
    const numericValue = Number(value);

    if (Number.isNaN(numericValue)) {
        return defaultPollingMs;
    }

    if (numericValue < minPollingMs) {
        return minPollingMs;
    }

    if (numericValue > maxPollingMs) {
        return maxPollingMs;
    }

    return Math.round(numericValue);
}

function ensureSettingsFile() {
    const settingsDir = path.dirname(settingsPath);

    if (!fs.existsSync(settingsDir)) {
        fs.mkdirSync(settingsDir, {
            recursive: true
        });
    }

    if (!fs.existsSync(settingsPath)) {
        fs.writeFileSync(settingsPath, "poll_interval_ms=" + defaultPollingMs + "\n", "utf8");
        console.log("Created missing settings file:", settingsPath);
    }
}

function readSettingsText() {
    ensureSettingsFile();

    try {
        return fs.readFileSync(settingsPath, "utf8");
    } catch (err) {
        return "";
    }
}

function writeSettingValue(key, value) {
    const content = updateSettingText(readSettingsText(), key, value);
    fs.writeFileSync(settingsPath, content, "utf8");
}

function readPollingMs() {
    try {
        const content = readSettingsText();
        const match = content.match(/poll_interval_ms\s*=\s*(\d+)/);

        if (match) {
            return clampPollingMs(Number(match[1]));
        }
    } catch (err) {
        return defaultPollingMs;
    }

    writePollingMs(defaultPollingMs);
    return defaultPollingMs;
}

function writePollingMs(value) {
    const pollingMs = clampPollingMs(value);
    writeSettingValue("poll_interval_ms", pollingMs);

    console.log("Saved polling interval:", pollingMs + " ms");
    console.log("Lightroom polling will apply this change automatically within about 1 second.");

    return pollingMs;
}

function readMinimizeBehavior() {
    return readMinimizeBehaviorFromText(readSettingsText());
}

function writeMinimizeBehavior(value) {
    if (!isValidMinimizeBehavior(value)) {
        throw new Error("Invalid minimize behavior.");
    }

    writeSettingValue(MINIMIZE_BEHAVIOR_SETTING, value);
    console.log("Saved minimize behavior:", value);
    return value;
}

function resetSettings() {
    const pollingMs = writePollingMs(defaultPollingMs);

    console.log("Restored default settings.");

    return {
        ok: true,
        pollingMs: pollingMs,
        settingsPath: settingsPath
    };
}

async function startBridge() {
    if (bridgeStarted) {
        return;
    }

    bridgeStarted = true;

    console.log("Starting LRBridge app...");
    console.log("Project root:", projectRoot);
    console.log("Portable root:", portableRoot);
    console.log("Polling interval:", readPollingMs() + " ms");
    console.log("Loading bridge:", bridgePath);

    try {
        const bridge = require(bridgePath);
        bridgeRuntime = bridge.defaultBridge;
        await bridge.startPromise;
        console.log("LRBridge is active.");
        console.log("You can use Lightroom Classic through the LRBridge HTTP API.");
        console.log("If controls feel slow, edit polling settings in this app. Changes apply automatically.");
    } catch (err) {
        bridgeStarted = false;
        console.error("Failed to start LRBridge:", err.message);
        throw err;
    }
}

function sendControllerResponse(response, statusCode, contentType, body) {
    response.writeHead(statusCode, {
        "Content-Type": contentType,
        "Cache-Control": "no-store"
    });

    response.end(body);
}

function handleControllerRequestError(response) {
    try {
        if (response.destroyed || response.writableEnded) {
            return;
        }

        if (response.headersSent) {
            response.destroy();
            return;
        }

        sendControllerResponse(response, 400, "text/plain; charset=utf-8", "Bad Request");
    } catch (err) {
        if (!response.destroyed) {
            try {
                response.destroy();
            } catch (destroyErr) {
                // The client connection is already unusable.
            }
        }
    }
}

async function handleControllerRequest(request, response) {
    const requestUrl = new URL(request.url, controllerUrl);

    if (requestUrl.pathname === "/" || requestUrl.pathname === "/controller") {
        try {
            const html = fs.readFileSync(controllerPath, "utf8");
            sendControllerResponse(response, 200, "text/html; charset=utf-8", html);
        } catch (err) {
            sendControllerResponse(response, 500, "text/plain; charset=utf-8", err.message);
        }

        return;
    }

    if (requestUrl.pathname === "/controller-color-grading.js") {
        try {
            const source = fs.readFileSync(controllerColorGradingPath, "utf8");
            sendControllerResponse(response, 200, "text/javascript; charset=utf-8", source);
        } catch (err) {
            sendControllerResponse(response, 500, "text/plain; charset=utf-8", err.message);
        }
        return;
    }

    if (requestUrl.pathname === "/controller-lens-blur.js") {
        try {
            const source = fs.readFileSync(controllerLensBlurPath, "utf8");
            sendControllerResponse(response, 200, "text/javascript; charset=utf-8", source);
        } catch (err) {
            sendControllerResponse(response, 500, "text/plain; charset=utf-8", err.message);
        }
        return;
    }

    if (requestUrl.pathname === "/controller-denoise-state.js") {
        const script = fs.readFileSync(controllerDenoiseStatePath, "utf8");
        sendControllerResponse(response, 200, "application/javascript; charset=utf-8", script);
        return;
    }

    if (requestUrl.pathname === "/controller-develop-categorical.js") {
        const script = fs.readFileSync(controllerDevelopCategoricalPath, "utf8");
        sendControllerResponse(response, 200, "application/javascript; charset=utf-8", script);
        return;
    }

    if (requestUrl.pathname === "/controller-tone-curve.js") {
        const script = fs.readFileSync(controllerToneCurvePath, "utf8");
        sendControllerResponse(response, 200, "application/javascript; charset=utf-8", script);
        return;
    }

    if (requestUrl.pathname === "/help" || requestUrl.pathname === "/controller-help") {
        try {
            const html = fs.readFileSync(controllerHelpPath, "utf8");
            sendControllerResponse(response, 200, "text/html; charset=utf-8", html);
        } catch (err) {
            sendControllerResponse(response, 500, "text/plain; charset=utf-8", err.message);
        }

        return;
    }

    if (
        requestUrl.pathname === "/bitfocus-companion-cheatsheet" ||
        requestUrl.pathname === "/companion-cheatsheet"
    ) {
        try {
            const html = fs.readFileSync(companionCheatsheetHtmlPath, "utf8");
            sendControllerResponse(response, 200, "text/html; charset=utf-8", html);
        } catch (err) {
            sendControllerResponse(response, 500, "text/plain; charset=utf-8", err.message);
        }

        return;
    }

    if (requestUrl.pathname === "/api/help") {
        await proxyControllerRequest(request, response, "/help");
        return;
    }

    if (requestUrl.pathname === "/api/sliders") {
        await proxyControllerRequest(request, response, "/sliders");
        return;
    }

    if (requestUrl.pathname === "/api/color-grading/metadata") {
        await proxyControllerRequest(request, response, "/color-grading/metadata");
        return;
    }

    if (requestUrl.pathname === "/api/color-grading/request") {
        await proxyControllerRequest(request, response, "/color-grading/request");
        return;
    }

    if (requestUrl.pathname === "/api/color-grading/snapshot") {
        await proxyControllerRequest(request, response, "/color-grading/snapshot" + requestUrl.search);
        return;
    }

    if (requestUrl.pathname === "/api/treatment/request") {
        await proxyControllerRequest(request, response, "/treatment/request");
        return;
    }

    if (requestUrl.pathname === "/api/treatment/snapshot") {
        await proxyControllerRequest(request, response, "/treatment/snapshot" + requestUrl.search);
        return;
    }

    if (requestUrl.pathname === "/api/groups") {
        await proxyControllerRequest(request, response, "/groups");
        return;
    }

    if (requestUrl.pathname === "/api/feedback/snapshot") {
        if (request.method !== "GET") {
            response.setHeader("Allow", "GET");
            sendControllerResponse(
                response,
                405,
                "application/json; charset=utf-8",
                JSON.stringify({ ok: false, error: "Method not allowed" })
            );
            return;
        }
        await proxyControllerRequest(
            request,
            response,
            "/feedback/snapshot" + requestUrl.search
        );
        return;
    }

    if (requestUrl.pathname === "/api/adjust") {
        const slider = requestUrl.searchParams.get("slider") || "";
        const amount = requestUrl.searchParams.get("amount") || "";

        await proxyControllerRequest(
            request,
            response,
            "/adjust?slider=" + encodeURIComponent(slider) + "&amount=" + encodeURIComponent(amount)
        );

        return;
    }

    if (requestUrl.pathname === "/api/action") {
        const action = requestUrl.searchParams.get("action") || "";

        await proxyControllerRequest(
            request,
            response,
            "/action?action=" + encodeURIComponent(action)
        );

        return;
    }

    if (requestUrl.pathname === "/api/reset") {
        const slider = requestUrl.searchParams.get("slider") || "";

        await proxyControllerRequest(
            request,
            response,
            "/reset?slider=" + encodeURIComponent(slider)
        );

        return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
        const bridgePathAndQuery = requestUrl.pathname.slice(4) + requestUrl.search;
        await proxyControllerRequest(request, response, bridgePathAndQuery);
        return;
    }

    sendControllerResponse(
        response,
        404,
        "application/json; charset=utf-8",
        JSON.stringify({
            ok: false,
            error: "Not found"
        })
    );
}

function startControllerServer() {
    if (controllerServerStarted) {
        return;
    }

    controllerServerStarted = true;

    controllerServer = http.createServer(function (request, response) {
        handleControllerRequest(request, response).catch(function () {
            handleControllerRequestError(response);
        });
    });

    stopControllerServer.register(controllerServer);

    applyControllerHttpSettings(controllerServer);

    controllerServer.on("error", function (err) {
        console.error("Web controller server failed:", err.message);
    });

    controllerServer.listen(controllerPort, controllerListenHost, function () {
        console.log("LRBridge web controller listening on LAN.");
        console.log("Local web controller: " + controllerLocalUrl);

        if (controllerLanUrls.length === 0) {
            console.log("LAN web controller: no LAN IP detected");
        } else {
            for (const url of controllerLanUrls) {
                console.log("LAN web controller: " + url);
            }
        }
    });
}

async function startLightroom() {
    if (!fs.existsSync(defaultLightroomPath)) {
        console.error("Lightroom Classic was not found:", defaultLightroomPath);
        return {
            ok: false,
            error: "Lightroom Classic was not found.",
            path: defaultLightroomPath
        };
    }

    console.log("Starting Lightroom Classic:", defaultLightroomPath);

    const result = await shell.openPath(defaultLightroomPath);

    if (result) {
        console.error("Failed to start Lightroom Classic:", result);
        return {
            ok: false,
            error: result,
            path: defaultLightroomPath
        };
    }

    return {
        ok: true,
        path: defaultLightroomPath
    };
}

async function openHelp() {
    console.log("Opening help endpoint.");
    await shell.openExternal("http://127.0.0.1:17892/help");

    return {
        ok: true
    };
}

async function openKoFi() {
    const url = "https://ko-fi.com/ninoleto";

    console.log("Opening Ko-fi support page:", url);
    await shell.openExternal(url);

    return {
        ok: true,
        url: url
    };
}

async function openWebController() {
    startControllerServer();

    console.log("Opening web controller:", controllerUrl);
    await shell.openExternal(controllerUrl);

    return {
        ok: true,
        url: controllerUrl
    };
}

async function openHttpBuilder() {
    startControllerServer();

    const url = controllerLocalUrl.replace(/\/$/, "") + "/bitfocus-companion-cheatsheet";

    console.log("Opening HTTP Builder:", url);
    await shell.openExternal(url);

    return {
        ok: true,
        url: url
    };
}

function beginConfirmedApplicationShutdown() {
    if (isQuitting) {
        return false;
    }

    isQuitting = true;

    if (desktopMinimizeController) {
        desktopMinimizeController.destroy();
    }

    app.quit();
    return true;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 940,
        height: 700,
        minWidth: 760,
        minHeight: 560,
        title: "LRBridge",
        icon: trayIconPath,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, "index.html"));

    mainWindow.webContents.setWindowOpenHandler(function (details) {
        shell.openExternal(details.url);
        return { action: "deny" };
    });

    mainWindow.on("minimize", function (event) {
        if (desktopMinimizeController) {
            desktopMinimizeController.handleNativeMinimize(event);
        }
    });

    mainWindow.on("close", function (event) {
        if (!isQuitting) {
            event.preventDefault();
            if (desktopQuitController) {
                desktopQuitController.requestConfirmation("close");
            }
        }
    });
}

function showWindow() {
    if (desktopMinimizeController && desktopMinimizeController.restoreWindow()) {
        return;
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
    }

    mainWindow.show();
    mainWindow.focus();
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
    app.quit();
} else {
    app.on("second-instance", function () {
        showWindow();
    });

    patchConsole();

    app.whenReady().then(async function () {
        Menu.setApplicationMenu(null);
        desktopMinimizeController = createDesktopMinimizeController({
            initialBehavior: readMinimizeBehavior(),
            getWindow: function () { return mainWindow; },
            createTray: function () { return new Tray(trayIconPath); },
            buildMenu: function (template) { return Menu.buildFromTemplate(template); },
            persistBehavior: writeMinimizeBehavior,
            requestQuit: function () {
                return desktopQuitController.requestConfirmation("tray");
            }
        });
        desktopQuitController = createDesktopQuitController({
            getWindow: function () { return mainWindow; },
            restoreWindow: function () { return desktopMinimizeController.restoreWindow(); },
            showMessageBox: function (window, options) {
                return dialog.showMessageBox(window, options);
            },
            beginShutdown: beginConfirmedApplicationShutdown,
            logError: function (err) {
                console.error("Quit confirmation failed:", err && err.message ? err.message : err);
            }
        });
        createWindow();
        desktopMinimizeController.initialize();
        await startBridge();
        startControllerServer();
    }).catch(function (err) {
        console.error("LRBridge app startup failed:", err.message);
        app.quit();
    });

    app.on("window-all-closed", function () {
        // Preserve the existing process lifecycle; Close/X behavior is handled by the window.
    });

    app.on("before-quit", function (event) {
        isQuitting = true;
        if (desktopMinimizeController) {
            desktopMinimizeController.destroy();
        }
        // HTTP, WebSocket, native-backend, and Web Controller shutdown use their bounded lifecycle helpers.
        desktopShutdownCoordinator.beforeQuit(event);
    });
}

ipcMain.handle("get-initial-state", function () {
    return {
        projectRoot: projectRoot,
        pollingMs: readPollingMs(),
        defaultPollingMs: defaultPollingMs,
        minPollingMs: minPollingMs,
        maxPollingMs: maxPollingMs,
        minimizeBehavior: desktopMinimizeController
            ? desktopMinimizeController.getBehavior()
            : NORMAL_MINIMIZE_BEHAVIOR,
        settingsPath: settingsPath,
        lightroomPath: defaultLightroomPath,
        controllerUrl: controllerLocalUrl,
        controllerLanUrls: controllerLanUrls,
        logs: logLines
    };
});

ipcMain.handle("start-lightroom", function () {
    return startLightroom();
});

ipcMain.handle("save-settings", function (_event, settings) {
    const pollingMs = writePollingMs(settings.pollingMs);

    return {
        ok: true,
        pollingMs: pollingMs,
        settingsPath: settingsPath
    };
});

ipcMain.handle("reset-settings", function () {
    return resetSettings();
});

ipcMain.handle("set-minimize-behavior", function (_event, behavior) {
    if (!desktopMinimizeController || !isValidMinimizeBehavior(behavior)) {
        return {
            ok: false,
            behavior: desktopMinimizeController
                ? desktopMinimizeController.getBehavior()
                : NORMAL_MINIMIZE_BEHAVIOR,
            error: "Invalid minimize behavior."
        };
    }

    try {
        return desktopMinimizeController.setBehavior(behavior);
    } catch (err) {
        return {
            ok: false,
            behavior: desktopMinimizeController.getBehavior(),
            error: err.message
        };
    }
});

ipcMain.handle("minimize-window", function () {
    return {
        ok: Boolean(desktopMinimizeController && desktopMinimizeController.minimizeWindow()),
        behavior: desktopMinimizeController
            ? desktopMinimizeController.getBehavior()
            : NORMAL_MINIMIZE_BEHAVIOR
    };
});

ipcMain.handle("open-help", function () {
    return openHelp();
});

ipcMain.handle("open-kofi", function () {
    return openKoFi();
});

ipcMain.handle("open-web-controller", function () {
    return openWebController();
});

ipcMain.handle("open-http-builder", function () {
    return openHttpBuilder();
});

ipcMain.handle("copy-text", function (_event, text) {
    clipboard.writeText(String(text));

    return {
        ok: true
    };
});

ipcMain.handle("quit-app", function () {
    if (!desktopQuitController) {
        return {
            ok: false,
            confirmed: false,
            error: "Quit confirmation is unavailable."
        };
    }

    return desktopQuitController.requestConfirmation("button");
});
