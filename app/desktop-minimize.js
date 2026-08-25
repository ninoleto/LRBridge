"use strict";

const {
    NORMAL_MINIMIZE_BEHAVIOR,
    TRAY_MINIMIZE_BEHAVIOR,
    isValidMinimizeBehavior,
    normalizeMinimizeBehavior
} = require("./desktop-settings");

function createDesktopMinimizeController(options) {
    let behavior = normalizeMinimizeBehavior(options.initialBehavior);
    let tray = null;

    function getWindow() {
        const window = options.getWindow();

        if (!window || (typeof window.isDestroyed === "function" && window.isDestroyed())) {
            return null;
        }

        return window;
    }

    function setTaskbarHidden(window, hidden) {
        if (typeof window.setSkipTaskbar === "function") {
            window.setSkipTaskbar(hidden);
        }
    }

    function restoreWindow() {
        const window = getWindow();

        if (!window) {
            return false;
        }

        setTaskbarHidden(window, false);

        if (typeof window.isMinimized === "function" && window.isMinimized()) {
            window.restore();
        }

        window.show();
        window.focus();
        return true;
    }

    function requestQuit() {
        options.requestQuit();
    }

    function ensureTray() {
        if (tray) {
            return tray;
        }

        tray = options.createTray();
        tray.setToolTip("LRBridge");
        tray.setContextMenu(options.buildMenu([
            {
                label: "Show LRBridge",
                click: restoreWindow
            },
            {
                label: "Exit LRBridge",
                click: requestQuit
            }
        ]));
        tray.on("double-click", restoreWindow);
        return tray;
    }

    function destroyTray() {
        if (!tray) {
            return false;
        }

        tray.destroy();
        tray = null;
        return true;
    }

    function hideWindowToTray() {
        ensureTray();

        const window = getWindow();

        if (!window) {
            return false;
        }

        setTaskbarHidden(window, true);
        window.hide();
        return true;
    }

    function synchronizeBehavior() {
        if (behavior === TRAY_MINIMIZE_BEHAVIOR) {
            ensureTray();
            return;
        }

        destroyTray();

        const window = getWindow();

        if (!window) {
            return;
        }

        setTaskbarHidden(window, false);

        if (typeof window.isVisible === "function" && !window.isVisible()) {
            restoreWindow();
        }
    }

    function initialize() {
        synchronizeBehavior();
        return behavior;
    }

    function setBehavior(value) {
        if (!isValidMinimizeBehavior(value)) {
            return {
                ok: false,
                behavior: behavior,
                error: "Invalid minimize behavior."
            };
        }

        if (value !== behavior && typeof options.persistBehavior === "function") {
            options.persistBehavior(value);
        }

        behavior = value;
        synchronizeBehavior();

        return {
            ok: true,
            behavior: behavior
        };
    }

    function handleNativeMinimize(event) {
        if (behavior !== TRAY_MINIMIZE_BEHAVIOR) {
            return false;
        }

        event.preventDefault();
        hideWindowToTray();
        return true;
    }

    function minimizeWindow() {
        if (behavior === TRAY_MINIMIZE_BEHAVIOR) {
            return hideWindowToTray();
        }

        const window = getWindow();

        if (!window) {
            return false;
        }

        setTaskbarHidden(window, false);
        window.minimize();
        return true;
    }

    function destroy() {
        destroyTray();
    }

    return {
        destroy,
        getBehavior: function () { return behavior; },
        getTray: function () { return tray; },
        handleNativeMinimize,
        initialize,
        minimizeWindow,
        restoreWindow,
        setBehavior
    };
}

module.exports = {
    NORMAL_MINIMIZE_BEHAVIOR,
    TRAY_MINIMIZE_BEHAVIOR,
    createDesktopMinimizeController
};
