"use strict";

const QUIT_DIALOG_OPTIONS = Object.freeze({
    type: "question",
    title: "Quit LRBridge?",
    message: "Are you sure you want to quit LRBridge?",
    detail: "Lightroom Classic will remain open, but the LRBridge Web Controller, Companion controls, HTTP API, and feedback will stop working until LRBridge is started again.",
    buttons: Object.freeze(["Cancel", "Quit LRBridge"]),
    defaultId: 0,
    cancelId: 0,
    noLink: true
});

function createDesktopQuitController(options) {
    let confirmationPromise = null;
    let shutdownStarted = false;

    function requestConfirmation() {
        if (shutdownStarted) {
            return Promise.resolve({
                ok: true,
                confirmed: true,
                shutdownStarted: true
            });
        }

        if (confirmationPromise) {
            return confirmationPromise;
        }

        options.restoreWindow();
        const window = options.getWindow();

        confirmationPromise = Promise.resolve()
            .then(function () {
                return options.showMessageBox(window, QUIT_DIALOG_OPTIONS);
            })
            .then(function (result) {
                if (!result || result.response !== 1) {
                    return {
                        ok: true,
                        confirmed: false,
                        shutdownStarted: false
                    };
                }

                if (!shutdownStarted) {
                    shutdownStarted = true;
                    options.beginShutdown();
                }

                return {
                    ok: true,
                    confirmed: true,
                    shutdownStarted: true
                };
            }, function (err) {
                if (typeof options.logError === "function") {
                    options.logError(err);
                }

                return {
                    ok: false,
                    confirmed: false,
                    shutdownStarted: false,
                    error: err && err.message ? err.message : "Unable to show quit confirmation."
                };
            })
            .finally(function () {
                confirmationPromise = null;
            });

        return confirmationPromise;
    }

    return {
        isConfirmationPending: function () { return confirmationPromise !== null; },
        isShutdownStarted: function () { return shutdownStarted; },
        requestConfirmation
    };
}

module.exports = {
    QUIT_DIALOG_OPTIONS,
    createDesktopQuitController
};
