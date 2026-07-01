const { app, BrowserWindow, Tray, Menu, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");

const projectRoot = path.join(__dirname, "..");
const bridgePath = path.join(projectRoot, "bridge.js");
const settingsPath = path.join(projectRoot, "config", "settings.txt");
const trayIconPath = path.join(__dirname, "tray.png");

const defaultPollingMs = 50;
const minPollingMs = 10;
const maxPollingMs = 1000;

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

function readPollingMs() {
    try {
        const content = fs.readFileSync(settingsPath, "utf8");
        const match = content.match(/poll_interval_ms\s*=\s*(\d+)/);

        if (match) {
            return clampPollingMs(Number(match[1]));
        }
    } catch (err) {
        return defaultPollingMs;
    }

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
    console.log("Polling interval:", readPollingMs() + " ms");
    console.log("Loading bridge:", bridgePath);

    try {
        require(bridgePath);
        console.log("LRBridge is active.");
        console.log("You can use Lightroom Classic with Companion.");
        console.log("If controls feel slow, edit polling settings in this app. Changes apply automatically.");
    } catch (err) {
        console.error("Failed to start LRBridge:", err.message);
    }
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
    await shell.openExternal("http://127.0.0.1:17891/help");

    return {
        ok: true
    };
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 940,
        height: 680,
        minWidth: 760,
        minHeight: 540,
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
            label: "Open Help",
            click: function () {
                openHelp();
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
        createWindow();
        createTray();
        startBridge();
    });

    app.on("window-all-closed", function () {
        // Keep running in tray.
    });

    app.on("before-quit", function () {
        isQuitting = true;
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

