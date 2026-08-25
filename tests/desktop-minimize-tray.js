"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    MINIMIZE_BEHAVIOR_SETTING,
    NORMAL_MINIMIZE_BEHAVIOR,
    TRAY_MINIMIZE_BEHAVIOR,
    readMinimizeBehaviorFromText,
    updateSettingText
} = require("../app/desktop-settings");
const { createDesktopMinimizeController } = require("../app/desktop-minimize");

const root = path.join(__dirname, "..");

function createHarness(initialBehavior) {
    const calls = {
        focus: 0,
        hide: 0,
        minimize: 0,
        persist: [],
        quit: 0,
        restore: 0,
        show: 0,
        skipTaskbar: [],
        trays: []
    };
    const window = {
        destroyed: false,
        minimized: false,
        visible: true,
        focus() { calls.focus += 1; },
        hide() { calls.hide += 1; this.visible = false; },
        isDestroyed() { return this.destroyed; },
        isMinimized() { return this.minimized; },
        isVisible() { return this.visible; },
        minimize() { calls.minimize += 1; this.minimized = true; },
        restore() { calls.restore += 1; this.minimized = false; },
        setSkipTaskbar(value) { calls.skipTaskbar.push(value); },
        show() { calls.show += 1; this.visible = true; }
    };

    function createTray() {
        const tray = {
            destroyed: false,
            handlers: {},
            menu: null,
            tooltip: null,
            destroy() { this.destroyed = true; },
            on(name, callback) { this.handlers[name] = callback; },
            setContextMenu(menu) { this.menu = menu; },
            setToolTip(value) { this.tooltip = value; }
        };
        calls.trays.push(tray);
        return tray;
    }

    const controller = createDesktopMinimizeController({
        initialBehavior,
        getWindow: function () { return window; },
        createTray,
        buildMenu: function (template) { return template; },
        persistBehavior: function (value) { calls.persist.push(value); },
        requestQuit: function () { calls.quit += 1; }
    });

    return { calls, controller, window };
}

function nativeEvent() {
    return {
        prevented: 0,
        preventDefault() { this.prevented += 1; }
    };
}

{
    const harness = createHarness(undefined);
    assert.equal(harness.controller.initialize(), NORMAL_MINIMIZE_BEHAVIOR,
        "The absent setting must default to Normal");
    assert.equal(harness.calls.trays.length, 0, "Normal mode must not create a tray icon");

    const event = nativeEvent();
    assert.equal(harness.controller.handleNativeMinimize(event), false);
    assert.equal(event.prevented, 0, "Normal native minimize must remain with Electron/Windows");
    assert.equal(harness.calls.hide, 0);

    assert.equal(harness.controller.minimizeWindow(), true);
    assert.equal(harness.calls.minimize, 1, "The desktop button must use BrowserWindow.minimize in Normal mode");
    assert.equal(harness.calls.hide, 0, "Normal button minimize must not hide the window");
    assert.equal(harness.calls.skipTaskbar.at(-1), false);
}

{
    const harness = createHarness(NORMAL_MINIMIZE_BEHAVIOR);
    harness.controller.initialize();
    assert.deepEqual(harness.controller.setBehavior(TRAY_MINIMIZE_BEHAVIOR), {
        ok: true,
        behavior: TRAY_MINIMIZE_BEHAVIOR
    });
    assert.deepEqual(harness.calls.persist, [TRAY_MINIMIZE_BEHAVIOR]);
    assert.equal(harness.calls.trays.length, 1, "Changing to System tray must create the tray immediately");

    const tray = harness.calls.trays[0];
    assert.equal(tray.tooltip, "LRBridge");
    assert.deepEqual(tray.menu.map(function (item) { return item.label; }), [
        "Show LRBridge",
        "Exit LRBridge"
    ]);
    assert.equal(typeof tray.handlers["double-click"], "function");

    const event = nativeEvent();
    assert.equal(harness.controller.handleNativeMinimize(event), true);
    assert.equal(event.prevented, 1);
    assert.equal(harness.calls.hide, 1);
    assert.equal(harness.calls.skipTaskbar.at(-1), true,
        "A tray-hidden window must be removed from the taskbar");

    harness.controller.restoreWindow();
    assert.equal(harness.controller.minimizeWindow(), true);
    assert.equal(harness.calls.hide, 2, "The desktop button must hide in System tray mode");
    assert.equal(harness.calls.minimize, 0);

    harness.controller.initialize();
    harness.controller.setBehavior(TRAY_MINIMIZE_BEHAVIOR);
    harness.controller.minimizeWindow();
    assert.equal(harness.calls.trays.length, 1, "Repeated tray preparation must reuse one Tray instance");

    harness.window.visible = false;
    harness.window.minimized = true;
    tray.menu[0].click();
    assert.equal(harness.calls.restore, 1);
    assert.equal(harness.calls.show >= 1, true);
    assert.equal(harness.calls.focus >= 1, true);
    assert.equal(harness.calls.skipTaskbar.at(-1), false);

    harness.window.visible = false;
    tray.handlers["double-click"]();
    assert.equal(harness.window.visible, true);
    assert.equal(harness.calls.focus >= 2, true,
        "Tray double-click must focus the same existing window");
    assert.equal(harness.calls.trays.length, 1);

    tray.menu[1].click();
    assert.equal(harness.calls.quit, 1, "Exit LRBridge must request a real application quit");

    harness.window.visible = false;
    assert.deepEqual(harness.controller.setBehavior(NORMAL_MINIMIZE_BEHAVIOR), {
        ok: true,
        behavior: NORMAL_MINIMIZE_BEHAVIOR
    });
    assert.equal(tray.destroyed, true, "Changing back to Normal must destroy the tray icon");
    assert.equal(harness.controller.getTray(), null);
    assert.equal(harness.window.visible, true, "Changing to Normal must not strand a tray-hidden window");
    assert.equal(harness.calls.skipTaskbar.at(-1), false);
}

{
    const harness = createHarness(NORMAL_MINIMIZE_BEHAVIOR);
    harness.controller.initialize();
    assert.deepEqual(harness.controller.setBehavior("tray"), {
        ok: false,
        behavior: NORMAL_MINIMIZE_BEHAVIOR,
        error: "Invalid minimize behavior."
    });
    assert.equal(harness.calls.persist.length, 0);
    assert.equal(harness.calls.trays.length, 0);
}

{
    const original = "poll_interval_ms=75\nfuture_setting=preserved\n";
    const persisted = updateSettingText(
        original,
        MINIMIZE_BEHAVIOR_SETTING,
        TRAY_MINIMIZE_BEHAVIOR
    );
    assert.match(persisted, /^poll_interval_ms=75$/m,
        "Desktop persistence must preserve the existing Lightroom polling setting");
    assert.match(persisted, /^future_setting=preserved$/m);
    assert.equal(readMinimizeBehaviorFromText(persisted), TRAY_MINIMIZE_BEHAVIOR,
        "The persisted choice must survive a complete settings reload");
    assert.equal(
        readMinimizeBehaviorFromText(updateSettingText(persisted, "poll_interval_ms", "100")),
        TRAY_MINIMIZE_BEHAVIOR,
        "Saving polling settings must preserve the minimize choice"
    );

    for (const malformed of [
        "",
        "minimize_behavior=tray\n",
        "minimize_behavior=SYSTEM-TRAY\n",
        "minimize_behavior=true\n",
        "minimize_behavior=\n"
    ]) {
        assert.equal(readMinimizeBehaviorFromText(malformed), NORMAL_MINIMIZE_BEHAVIOR,
            "Malformed persisted values must fall back safely to Normal");
    }
}

{
    const mainSource = fs.readFileSync(path.join(root, "app", "main.js"), "utf8").replace(/\r\n/g, "\n");
    const closeHandler = mainSource.match(/mainWindow\.on\("close", function \(event\) \{[\s\S]*?^    \}\);/m);
    assert.ok(closeHandler, "Missing confirmed Close/X handler");
    assert.match(closeHandler[0], /desktopQuitController\.requestConfirmation\("close"\)/);
    assert.doesNotMatch(closeHandler[0], /mainWindow\.hide\(\)/,
        "Close/X must not use the minimize-to-tray hide behavior");
    assert.match(mainSource, /const settingsPath = path\.join\(portableRoot, "config", "settings\.txt"\);/,
        "Minimize behavior must use the existing LRBridge settings file");
    assert.match(mainSource, /createTray: function \(\) \{ return new Tray\(trayIconPath\); \}/,
        "System tray mode must reuse the existing application icon");
    assert.match(mainSource, /requestQuit: function \(\) \{[\s\S]*desktopQuitController\.requestConfirmation\("tray"\)/,
        "Tray Exit must enter the shared confirmation path");
    const readyBlock = mainSource.slice(
        mainSource.indexOf("app.whenReady().then"),
        mainSource.indexOf('app.on("window-all-closed"')
    );
    assert.doesNotMatch(readyBlock, /^\s*createTray\(\);/m,
        "Normal startup must not unconditionally create a tray icon");
}

console.log("Desktop minimize behavior, tray lifecycle, and settings persistence tests passed.");
