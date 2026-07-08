const { app, BrowserWindow, Tray, Menu, ipcMain, shell, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const os = require("os");

const projectRoot = path.join(__dirname, "..");
const portableRoot = app.isPackaged ? path.dirname(process.execPath) : projectRoot;
const bridgePath = path.join(projectRoot, "bridge.js");
const settingsPath = path.join(portableRoot, "config", "settings.txt");
const trayIconPath = path.join(__dirname, "tray.png");
const controllerPath = path.join(__dirname, "controller.html");
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
let tray = null;
let isQuitting = false;
let bridgeStarted = false;
let controllerServerStarted = false;
let controllerServer = null;

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

function readPollingMs() {
    ensureSettingsFile();

    try {
        const content = fs.readFileSync(settingsPath, "utf8");
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

    const content =
        "poll_interval_ms=" + pollingMs + "\n";

    fs.writeFileSync(settingsPath, content, "utf8");

    console.log("Saved polling interval:", pollingMs + " ms");
    console.log("Lightroom polling will apply this change automatically within about 1 second.");

    return pollingMs;
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

function startBridge() {
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
        require(bridgePath);
        console.log("LRBridge is active.");
        console.log("You can use Lightroom Classic through the LRBridge HTTP API.");
        console.log("If controls feel slow, edit polling settings in this app. Changes apply automatically.");
    } catch (err) {
        console.error("Failed to start LRBridge:", err.message);
    }
}

function bridgeGet(pathAndQuery) {
    return new Promise(function (resolve) {
        const request = http.request(
            {
                hostname: "127.0.0.1",
                port: bridgeHttpPort,
                path: pathAndQuery,
                method: "GET",
                timeout: 10000
            },
            function (response) {
                let body = "";

                response.setEncoding("utf8");

                response.on("data", function (chunk) {
                    body += chunk;
                });

                response.on("end", function () {
                    resolve({
                        ok: response.statusCode >= 200 && response.statusCode < 300,
                        statusCode: response.statusCode,
                        body: body
                    });
                });
            }
        );

        request.on("error", function (err) {
            resolve({
                ok: false,
                statusCode: 500,
                body: JSON.stringify({
                    ok: false,
                    error: err.message
                })
            });
        });

        request.on("timeout", function () {
            request.destroy(new Error("Request timed out"));
        });

        request.end();
    });
}

function sendControllerResponse(response, statusCode, contentType, body) {
    response.writeHead(statusCode, {
        "Content-Type": contentType,
        "Cache-Control": "no-store"
    });

    response.end(body);
}

async function proxyBridgeRequest(response, bridgePathAndQuery) {
    const result = await bridgeGet(bridgePathAndQuery);

    sendControllerResponse(
        response,
        result.statusCode || 500,
        "application/json; charset=utf-8",
        result.body || "{}"
    );
}

function startControllerServer() {
    if (controllerServerStarted) {
        return;
    }

    controllerServerStarted = true;

    controllerServer = http.createServer(async function (request, response) {
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
            await proxyBridgeRequest(response, "/help");
            return;
        }

        if (requestUrl.pathname === "/api/sliders") {
            await proxyBridgeRequest(response, "/sliders");
            return;
        }

        if (requestUrl.pathname === "/api/groups") {
            await proxyBridgeRequest(response, "/groups");
            return;
        }

        if (requestUrl.pathname === "/api/adjust") {
            const slider = requestUrl.searchParams.get("slider") || "";
            const amount = requestUrl.searchParams.get("amount") || "";

            await proxyBridgeRequest(
                response,
                "/adjust?slider=" + encodeURIComponent(slider) + "&amount=" + encodeURIComponent(amount)
            );

            return;
        }

        if (requestUrl.pathname === "/api/action") {
            const action = requestUrl.searchParams.get("action") || "";

            await proxyBridgeRequest(
                response,
                "/action?action=" + encodeURIComponent(action)
            );

            return;
        }

        if (requestUrl.pathname === "/api/reset") {
            const slider = requestUrl.searchParams.get("slider") || "";

            await proxyBridgeRequest(
                response,
                "/reset?slider=" + encodeURIComponent(slider)
            );

            return;
        }

        if (requestUrl.pathname === "/api/reset-group") {
            const group = requestUrl.searchParams.get("group") || "";

            await proxyBridgeRequest(
                response,
                "/reset-group?group=" + encodeURIComponent(group)
            );

            return;
        }

        if (requestUrl.pathname === "/api/reset-all") {
            await proxyBridgeRequest(response, "/reset-all");
            return;
        }

        if (requestUrl.pathname.startsWith("/api/")) {
            const bridgePathAndQuery = requestUrl.pathname.slice(4) + requestUrl.search;
            await proxyBridgeRequest(response, bridgePathAndQuery);
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
    });

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
        event.preventDefault();
        mainWindow.hide();
    });

    mainWindow.on("close", function (event) {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
}

function createTray() {
    tray = new Tray(trayIconPath);
    tray.setToolTip("LRBridge");

    const menu = Menu.buildFromTemplate([
        {
            label: "Show LRBridge",
            click: function () {
                showWindow();
            }
        },
        {
            label: "Start Lightroom Classic",
            click: function () {
                startLightroom();
            }
        },
        {
            label: "Open Web Controller",
            click: function () {
                openWebController();
            }
        },
        {
            label: "Open Help",
            click: function () {
                openHelp();
            }
        },
        {
            label: "Open HTTP Builder",
            click: function () {
                openHttpBuilder();
            }
        },
        { type: "separator" },
        {
            label: "Quit",
            click: function () {
                isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(menu);

    tray.on("click", function () {
        showWindow();
    });
}

function showWindow() {
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

    app.whenReady().then(function () {
        Menu.setApplicationMenu(null);
        createWindow();
        createTray();
        startBridge();
        startControllerServer();
    });

    app.on("window-all-closed", function () {
        // Keep running in tray.
    });

    app.on("before-quit", function () {
        isQuitting = true;

        if (controllerServer !== null) {
            controllerServer.close();
        }
    });
}

ipcMain.handle("get-initial-state", function () {
    return {
        projectRoot: projectRoot,
        pollingMs: readPollingMs(),
        defaultPollingMs: defaultPollingMs,
        minPollingMs: minPollingMs,
        maxPollingMs: maxPollingMs,
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
    isQuitting = true;
    app.quit();

    return {
        ok: true
    };
});


