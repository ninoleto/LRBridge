"use strict";

function createDesktopShutdownCoordinator(options) {
    let shutdownPromise = null;
    let allowQuit = false;
    let resumeScheduled = false;

    function startStopOperation(service, clearService, stopService, label) {
        if (service === null || service === undefined) {
            return null;
        }

        clearService();

        try {
            return Promise.resolve(stopService(service)).catch(function (err) {
                options.logShutdownError(label, err);
            });
        } catch (err) {
            options.logShutdownError(label, err);
            return Promise.resolve();
        }
    }

    function beforeQuit(event) {
        if (allowQuit) {
            return shutdownPromise;
        }

        event.preventDefault();

        if (shutdownPromise) {
            return shutdownPromise;
        }

        const operations = [];
        const bridgeOperation = startStopOperation(
            options.getBridge(),
            options.clearBridge,
            options.stopBridge,
            "LRBridge HTTP/WebSocket"
        );
        const controllerOperation = startStopOperation(
            options.getControllerServer(),
            options.clearControllerServer,
            options.stopControllerServer,
            "Web Controller"
        );

        if (bridgeOperation) operations.push(bridgeOperation);
        if (controllerOperation) operations.push(controllerOperation);

        shutdownPromise = Promise.all(operations).then(function () {
            allowQuit = true;

            if (!resumeScheduled) {
                resumeScheduled = true;
                options.resumeQuit();
            }
        });

        return shutdownPromise;
    }

    return {
        beforeQuit,
        isQuitAllowed: function () { return allowQuit; }
    };
}

module.exports = {
    createDesktopShutdownCoordinator
};
