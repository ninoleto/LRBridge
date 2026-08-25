"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const { createDesktopQuitController, QUIT_DIALOG_OPTIONS } = require("../app/desktop-quit");
const { createDesktopShutdownCoordinator } = require("../app/desktop-shutdown");
const { stopControllerServer } = require("../app/controller-server-lifecycle");
const { createBridge } = require("../server/bridge");
const { createUnavailableWindowsBackend } = require("../server/windows-lightroom-native");

const root = path.join(__dirname, "..");

function deferred() {
    let resolve;
    const promise = new Promise(function (resolvePromise) { resolve = resolvePromise; });
    return { promise, resolve };
}

function fakeQuitEvent() {
    return {
        preventDefaultCalls: 0,
        preventDefault() { this.preventDefaultCalls += 1; }
    };
}

async function testConfirmationController() {
    const window = { id: "existing-window", visible: false };
    const dialogs = [];
    const firstDialog = deferred();
    const secondDialog = deferred();
    const queuedDialogs = [firstDialog, secondDialog];
    let restoreCalls = 0;
    let shutdownCalls = 0;
    const controller = createDesktopQuitController({
        getWindow: function () { return window; },
        restoreWindow: function () { restoreCalls += 1; window.visible = true; },
        showMessageBox: function (attachedWindow, options) {
            dialogs.push({ attachedWindow, options });
            return queuedDialogs.shift().promise;
        },
        beginShutdown: function () { shutdownCalls += 1; },
        logError: function () { assert.fail("Dialog must not fail"); }
    });

    const first = controller.requestConfirmation("close");
    const duplicate = controller.requestConfirmation("button");
    assert.strictEqual(duplicate, first, "Repeated quit requests must share one confirmation promise");
    await Promise.resolve();
    assert.equal(dialogs.length, 1, "Repeated Close/Quit requests must open exactly one dialog");
    assert.equal(restoreCalls, 1);
    assert.equal(window.visible, true, "Confirmation must restore a tray-hidden window first");
    assert.strictEqual(dialogs[0].attachedWindow, window, "The native dialog must be attached to LRBridge");
    assert.deepEqual(dialogs[0].options, QUIT_DIALOG_OPTIONS);
    assert.equal(QUIT_DIALOG_OPTIONS.title, "Quit LRBridge?");
    assert.equal(QUIT_DIALOG_OPTIONS.message, "Are you sure you want to quit LRBridge?");
    assert.equal(QUIT_DIALOG_OPTIONS.detail,
        "Lightroom Classic will remain open, but the LRBridge Web Controller, Companion controls, HTTP API, and feedback will stop working until LRBridge is started again.");
    assert.deepEqual(Array.from(QUIT_DIALOG_OPTIONS.buttons), ["Cancel", "Quit LRBridge"]);
    assert.equal(QUIT_DIALOG_OPTIONS.defaultId, 0, "Cancel must be the safe default");
    assert.equal(QUIT_DIALOG_OPTIONS.cancelId, 0, "Escape must select Cancel");

    firstDialog.resolve({ response: 0 });
    assert.deepEqual(await first, {
        ok: true,
        confirmed: false,
        shutdownStarted: false
    });
    assert.equal(shutdownCalls, 0, "Cancel must leave the process running");
    assert.equal(window.visible, true, "Cancel must leave LRBridge visible");
    assert.equal(controller.isConfirmationPending(), false);

    const confirmed = controller.requestConfirmation("tray");
    await Promise.resolve();
    assert.equal(dialogs.length, 2, "A later quit request may open a new confirmation after Cancel");
    secondDialog.resolve({ response: 1 });
    assert.deepEqual(await confirmed, {
        ok: true,
        confirmed: true,
        shutdownStarted: true
    });
    assert.equal(shutdownCalls, 1, "Confirm must enter shutdown exactly once");
    await controller.requestConfirmation("close");
    assert.equal(dialogs.length, 2);
    assert.equal(shutdownCalls, 1);
}

async function testShutdownCoordinatorOnce() {
    const bridge = { name: "bridge" };
    const controllerServer = { name: "controller" };
    const calls = [];
    let bridgeReference = bridge;
    let controllerReference = controllerServer;
    const bridgeStop = deferred();
    const controllerStop = deferred();
    const coordinator = createDesktopShutdownCoordinator({
        getBridge: function () { return bridgeReference; },
        clearBridge: function () { calls.push("clear-bridge"); bridgeReference = null; },
        stopBridge: function (value) { assert.strictEqual(value, bridge); calls.push("stop-bridge"); return bridgeStop.promise; },
        getControllerServer: function () { return controllerReference; },
        clearControllerServer: function () { calls.push("clear-controller"); controllerReference = null; },
        stopControllerServer: function (value) { assert.strictEqual(value, controllerServer); calls.push("stop-controller"); return controllerStop.promise; },
        resumeQuit: function () { calls.push("resume-quit"); },
        logShutdownError: function () { assert.fail("Shutdown must not fail"); }
    });

    const firstEvent = fakeQuitEvent();
    const secondEvent = fakeQuitEvent();
    const first = coordinator.beforeQuit(firstEvent);
    const second = coordinator.beforeQuit(secondEvent);
    assert.strictEqual(second, first, "Repeated before-quit events must share one clean shutdown");
    assert.equal(firstEvent.preventDefaultCalls, 1);
    assert.equal(secondEvent.preventDefaultCalls, 1);
    assert.deepEqual(calls, ["clear-bridge", "stop-bridge", "clear-controller", "stop-controller"]);

    bridgeStop.resolve();
    await Promise.resolve();
    assert.equal(calls.includes("resume-quit"), false,
        "Electron must not quit before every LRBridge server has stopped");
    controllerStop.resolve();
    await first;
    assert.deepEqual(calls, [
        "clear-bridge", "stop-bridge", "clear-controller", "stop-controller", "resume-quit"
    ]);
    assert.equal(coordinator.isQuitAllowed(), true);

    const resumedEvent = fakeQuitEvent();
    await coordinator.beforeQuit(resumedEvent);
    assert.equal(resumedEvent.preventDefaultCalls, 0,
        "The resumed Electron quit must pass through after clean shutdown");
    assert.equal(calls.filter(function (value) { return value === "resume-quit"; }).length, 1);
}

async function testRealServerRelease() {
    const bridge = createBridge({
        httpPort: 0,
        wsPort: 0,
        httpHost: "127.0.0.1",
        wsHost: "127.0.0.1",
        shutdownGraceMs: 40,
        windowsNativeBackend: createUnavailableWindowsBackend("Desktop shutdown test backend")
    });
    await bridge.start();

    const controllerServer = http.createServer(function (_request, response) { response.end("ok"); });
    await new Promise(function (resolve, reject) {
        controllerServer.once("error", reject);
        controllerServer.listen(0, "127.0.0.1", resolve);
    });
    let bridgeReference = bridge;
    let controllerReference = controllerServer;
    let resumed = 0;
    const coordinator = createDesktopShutdownCoordinator({
        getBridge: function () { return bridgeReference; },
        clearBridge: function () { bridgeReference = null; },
        stopBridge: function (service) { return service.stop(); },
        getControllerServer: function () { return controllerReference; },
        clearControllerServer: function () { controllerReference = null; },
        stopControllerServer,
        resumeQuit: function () { resumed += 1; },
        logShutdownError: function (_label, err) { throw err; }
    });
    const event = fakeQuitEvent();
    await coordinator.beforeQuit(event);
    assert.equal(event.preventDefaultCalls, 1);
    assert.equal(bridge.getState(), "stopped");
    assert.equal(bridge.getHttpServer(), null, "Confirmed quit must release the HTTP listener");
    assert.equal(bridge.getWebSocketServer(), null, "Confirmed quit must release the WebSocket listener");
    assert.equal(controllerServer.listening, false, "Confirmed quit must release the Web Controller listener");
    assert.equal(resumed, 1);
}

function testMainProcessIntegration() {
    const main = fs.readFileSync(path.join(root, "app", "main.js"), "utf8");
    const minimize = fs.readFileSync(path.join(root, "app", "desktop-minimize.js"), "utf8");
    const closeHandler = main.slice(
        main.indexOf('mainWindow.on("close"'),
        main.indexOf("function showWindow")
    );
    assert.match(closeHandler, /event\.preventDefault\(\)/);
    assert.match(closeHandler, /desktopQuitController\.requestConfirmation\("close"\)/);
    assert.doesNotMatch(closeHandler, /\.hide\(\)/,
        "Close/X must never hide LRBridge");
    assert.match(main, /ipcMain\.handle\("quit-app"[\s\S]*desktopQuitController\.requestConfirmation\("button"\)/,
        "The red Quit button must use the shared confirmation path");
    assert.match(main, /requestQuit: function \(\) \{[\s\S]*desktopQuitController\.requestConfirmation\("tray"\)/,
        "Tray Exit must use the shared confirmation path");
    assert.match(minimize, /label: "Exit LRBridge"[\s\S]*click: requestQuit/);

    const confirmedShutdown = main.slice(
        main.indexOf("function beginConfirmedApplicationShutdown"),
        main.indexOf("function createWindow")
    );
    const stateIndex = confirmedShutdown.indexOf("isQuitting = true");
    const trayIndex = confirmedShutdown.indexOf("desktopMinimizeController.destroy()");
    const quitIndex = confirmedShutdown.indexOf("app.quit()");
    assert.ok(stateIndex >= 0 && stateIndex < trayIndex && trayIndex < quitIndex,
        "Confirmed quit must set real quitting state, destroy the tray, then invoke Electron shutdown");
    assert.doesNotMatch(main, /process\.kill|taskkill|Stop-Process/,
        "Desktop shutdown must not force-kill the Electron process");
    assert.match(main, /stopBridge: function \(bridge\) \{ return bridge\.stop\(\); \}/);
    assert.match(main, /stopControllerServer: stopControllerServer/);
}

async function main() {
    await testConfirmationController();
    await testShutdownCoordinatorOnce();
    await testRealServerRelease();
    testMainProcessIntegration();
    console.log("Desktop quit confirmation and clean multi-server shutdown tests passed.");
}

main().catch(function (err) {
    console.error(err.stack || err.message);
    process.exitCode = 1;
});
