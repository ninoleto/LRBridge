const CONTROLLER_SHUTDOWN_GRACE_MS = 250;

const shutdownOperations = new WeakMap();
const trackedSockets = new WeakMap();

function validateShutdownGraceMs(value) {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
        throw new TypeError("shutdownGraceMs must be a non-negative finite integer");
    }
}

function registerControllerServer(server) {
    if (!server || trackedSockets.has(server)) return server;

    const sockets = new Set();
    trackedSockets.set(server, sockets);
    server.on("connection", function (socket) {
        sockets.add(socket);
        socket.once("close", function () { sockets.delete(socket); });
    });
    return server;
}

function stopControllerServer(server, options = {}) {
    const shutdownGraceMs = options.shutdownGraceMs === undefined
        ? CONTROLLER_SHUTDOWN_GRACE_MS
        : options.shutdownGraceMs;
    validateShutdownGraceMs(shutdownGraceMs);

    if (server === null || server === undefined) return Promise.resolve();

    const existingOperation = shutdownOperations.get(server);
    if (existingOperation) return existingOperation;

    const operation = new Promise(function (resolve) {
        let settled = false;
        let forceTimer = null;

        function finish() {
            if (settled) return;
            settled = true;
            if (forceTimer !== null) clearTimeout(forceTimer);
            resolve();
        }

        server.once("close", finish);

        try {
            server.close(function () { finish(); });
        } catch (err) {
            finish();
            return;
        }

        try {
            if (typeof server.closeIdleConnections === "function") {
                server.closeIdleConnections();
            }
        } catch (err) {
            // Continue to the bounded forced-close path.
        }

        forceTimer = setTimeout(function () {
            try {
                if (typeof server.closeAllConnections === "function") {
                    server.closeAllConnections();
                } else {
                    const sockets = trackedSockets.get(server);
                    if (sockets) {
                        for (const socket of sockets) socket.destroy();
                    }
                }
            } catch (err) {
                const sockets = trackedSockets.get(server);
                if (sockets) {
                    for (const socket of sockets) socket.destroy();
                }
            }
        }, shutdownGraceMs);
    });

    shutdownOperations.set(server, operation);
    return operation;
}

stopControllerServer.register = registerControllerServer;

function createControllerQuitCoordinator(options) {
    const getControllerServer = options.getControllerServer;
    const clearControllerServer = options.clearControllerServer;
    const stopServer = options.stopControllerServer;
    const resumeQuit = options.resumeQuit;
    const logShutdownError = options.logShutdownError;
    let shutdownPromise = null;
    let allowQuit = false;
    let resumeScheduled = false;

    function beforeQuit(event) {
        if (allowQuit) return;

        if (shutdownPromise !== null) {
            event.preventDefault();
            return shutdownPromise;
        }

        const server = getControllerServer();
        if (server === null || server === undefined) return;

        event.preventDefault();
        clearControllerServer();

        let settleShutdown;
        shutdownPromise = new Promise(function (resolve) {
            settleShutdown = resolve;
        });

        let stopResult;
        try {
            stopResult = stopServer(server);
        } catch (err) {
            stopResult = Promise.reject(err);
        }

        function finishShutdown() {
            allowQuit = true;
            settleShutdown();
            if (!resumeScheduled) {
                resumeScheduled = true;
                resumeQuit();
            }
        }

        Promise.resolve(stopResult).then(finishShutdown, function () {
            try {
                logShutdownError();
            } finally {
                finishShutdown();
            }
        });

        return shutdownPromise;
    }

    return { beforeQuit };
}

module.exports = {
    CONTROLLER_SHUTDOWN_GRACE_MS,
    createControllerQuitCoordinator,
    stopControllerServer
};
