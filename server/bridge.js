const express = require("express");
const WebSocket = require("ws");

const commands = require("./commands");
const sliders = require("./sliders");
const defaultLightroomWake = require("./lightroomWake");
const context = require("./context");
const numbers = require("./numbers");

const HTTP_PORT = 17891;
const WS_PORT = 17890;
const WS_MAX_PAYLOAD_BYTES = 64 * 1024;
const HTTP_REQUEST_TIMEOUT_MS = 60_000;
const HTTP_HEADERS_TIMEOUT_MS = 15_000;
const HTTP_KEEP_ALIVE_TIMEOUT_MS = 5_000;
const HTTP_MAX_HEADERS_COUNT = 64;

function positiveFiniteIntegerOption(options, name, defaultValue) {
    const value = options[name] === undefined ? defaultValue : options[name];

    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
        throw new TypeError(name + " must be a positive finite integer");
    }

    return value;
}

function createBridge(options) {
options = options || {};
const httpPort = options.httpPort === undefined ? HTTP_PORT : options.httpPort;
const wsPort = options.wsPort === undefined ? WS_PORT : options.wsPort;
const httpHost = options.httpHost;
const wsHost = options.wsHost;
const wsMaxPayloadBytes = options.wsMaxPayloadBytes === undefined
    ? WS_MAX_PAYLOAD_BYTES
    : options.wsMaxPayloadBytes;
if (!Number.isFinite(wsMaxPayloadBytes) || !Number.isInteger(wsMaxPayloadBytes) || wsMaxPayloadBytes <= 0) {
    throw new TypeError("wsMaxPayloadBytes must be a positive finite integer");
}
const httpRequestTimeoutMs = positiveFiniteIntegerOption(
    options, "httpRequestTimeoutMs", HTTP_REQUEST_TIMEOUT_MS
);
const httpHeadersTimeoutMs = positiveFiniteIntegerOption(
    options, "httpHeadersTimeoutMs", HTTP_HEADERS_TIMEOUT_MS
);
const httpKeepAliveTimeoutMs = positiveFiniteIntegerOption(
    options, "httpKeepAliveTimeoutMs", HTTP_KEEP_ALIVE_TIMEOUT_MS
);
const httpMaxHeadersCount = positiveFiniteIntegerOption(
    options, "httpMaxHeadersCount", HTTP_MAX_HEADERS_COUNT
);
if (httpHeadersTimeoutMs > httpRequestTimeoutMs) {
    throw new RangeError("httpHeadersTimeoutMs must not exceed httpRequestTimeoutMs");
}
const startLightroomWatcher = options.startLightroomWatcher !== false;
const lightroomWake = options.lightroomWake || defaultLightroomWake;
const shutdownGraceMs = options.shutdownGraceMs === undefined ? 250 : options.shutdownGraceMs;
const app = express();

const feedbackRequests = [];
const feedbackValues = {};
let feedbackRequestId = 0;

function queueCommand(command) {
    return commands.tryEnqueueCommand(command);
}

function isExperimentalEnabled(req) {
    return req.query.experimental === "1";
}

function rejectExperimentalSet(res) {
    res.status(400).json({
        ok: false,
        error: "develop.set is experimental and currently unreliable in Lightroom.",
        hint: "Use /adjust or /reset for normal control. Add experimental=1 only when testing."
    });
}

function rejectInvalidCommand(res) {
    res.status(400).json({
        ok: false,
        error: "Invalid command"
    });
}

function queueOrReject(res, command, responseExtra, onAccepted) {
    const admission = queueCommand(command);

    if (admission.status === commands.ADMISSION_QUEUE_FULL) {
        rejectQueueFull(res, admission.queueLength);
        return;
    }

    if (!admission.accepted) {
        rejectInvalidCommand(res, command);
        return;
    }

    if (onAccepted) onAccepted();

    res.json(Object.assign({
        ok: true,
        queued: command
    }, responseExtra || {}));
}

function rejectQueueFull(res, queueLength) {
    res.set("Retry-After", "1").status(503).json({
        ok: false,
        error: "Command queue full",
        queueLength: queueLength,
        queueLimit: commands.HARD_QUEUE_CAPACITY,
        retryable: true
    });
}

function queueBatchOrReject(res, batch, successBody) {
    const admission = commands.tryEnqueueBatch(batch);

    if (admission.status === commands.ADMISSION_QUEUE_FULL) {
        rejectQueueFull(res, admission.queueLength);
        return;
    }

    if (!admission.accepted) {
        rejectInvalidCommand(res, batch);
        return;
    }

    res.json(successBody);
}

function getSlidersByGroup(groupName) {
    return sliders.getAll().filter(function (slider) {
        return slider.group === groupName;
    });
}

app.get("/", function (req, res) {
    res.json({
        name: "LRBridge",
        ok: true,
        httpPort: httpServer && httpServer.address() ? httpServer.address().port : httpPort,
        wsPort: wsServer && wsServer.address() ? wsServer.address().port : wsPort,
        help: "/help"
    });
});

app.get("/help", function (req, res) {
    res.json({
        name: "LRBridge",
        mode: "one-way-lightroom-control",
        sourceOfTruth: "Lightroom visible UI",
        reliableEndpoints: {
            help: "/help",
            status: "/status",
            sliders: "/sliders",
            groups: "/groups",
            adjust: "/adjust?slider=Exposure&amount=1",
            reset: "/reset?slider=Exposure",
            resetGroup: "/reset-group?group=Basic",
            resetAll: "/reset-all",
            navigateSelection: "/command?command=selection.navigate&direction=next",
            setFlag: "/command?command=selection.flag&flag=pick",
            setRating: "/command?command=selection.rating.set&rating=5",
            adjustRating: "/command?command=selection.rating.adjust&direction=increase",
            setColorLabel: "/command?command=selection.label.set&label=red",
            toggleColorLabel: "/command?command=selection.label.toggle&label=red",
            wakeLightroom: "/wake-lightroom"
        },
        experimentalEndpoints: {
            get: "/get?slider=Exposure",
            lastResult: "/last-result",
            set: "/set?slider=Exposure&value=1&experimental=1"
        },
        notes: [
            "Use /adjust and /reset for Companion control.",
            "Do not depend on /get for feedback.",
            "Do not use /set for normal control.",
            "amount means number of Lightroom increment steps.",
            "Accepted commands are queued; execution by Lightroom is not confirmed.",
            "Selection commands act on Lightroom's current selection and do not switch modules.",
            "First/last selection works in all modules in Lightroom Classic 13 or later; older versions may require Library.",
            "Color label metadata strings depend on Lightroom's active Color Label Set.",
            "Selection commands use the Lightroom SDK and do not depend on keyboard shortcuts or AutoHotkey.",
            "On Windows, LRBridge wakes Lightroom to Library on startup. Slider commands switch Lightroom to Develop."
        ]
    });
});

app.get("/wake-lightroom", async function (req, res) {
    const result = await lightroomWake.wakeLightroom();

    if (!result.ok) {
        res.status(400).json(result);
        return;
    }

    res.json(result);
});

app.get("/status", function (req, res) {
    res.json(Object.assign(commands.getStatus(), context.getContextFields()));
});

app.get("/diagnostics/queue", function (req, res) {
    res.set("Cache-Control", "no-store").json(commands.getQueueDiagnostics());
});

app.get("/context", function (req, res) {
    const status = commands.getStatus();

    res.json(context.getContext(status.queueLength));
});

app.get("/context/update", function (req, res) {
    const status = commands.getStatus();

    const updated = context.updateContext({
        activeModule: req.query.activeModule,
        selectedPhotoKey: req.query.selectedPhotoKey,
        developFingerprint: req.query.developFingerprint
    });

    res.json(Object.assign({
        ok: true,
        queueLength: status.queueLength
    }, updated));
});

app.get("/sliders", function (req, res) {
    res.json({
        sliders: commands.getSliderMetadata()
    });
});

app.get("/groups", function (req, res) {
    res.json({
        groups: sliders.getGroups()
    });
});

app.get("/next", function (req, res) {
    const command = commands.getNextCommand();
    res.json({ command: command });
});

app.get("/command", function (req, res) {
    const commandName = req.query.command;

    if (commandName === "develop.set" && !isExperimentalEnabled(req)) {
        rejectExperimentalSet(res);
        return;
    }

    const command = { command: commandName };

    for (const field of ["slider", "action", "direction", "flag", "label"]) {
        if (req.query[field] !== undefined) command[field] = req.query[field];
    }

    if (req.query.amount !== undefined) {
        command.amount = numbers.parseFiniteNumber(req.query.amount);
    }

    if (req.query.value !== undefined) {
        command.value = numbers.parseFiniteNumber(req.query.value);
    }

    if (req.query.rating !== undefined) {
        command.rating = numbers.parseFiniteNumber(req.query.rating);
    }

    queueOrReject(res, command, null, command.command === "develop.get"
        ? commands.clearLatestResult
        : null);
});

app.get("/adjust", function (req, res) {
    const slider = req.query.slider;
    const amount = numbers.parseFiniteNumber(req.query.amount);

    if (amount === null) {
        res.status(400).json({
            ok: false,
            error: "Missing or invalid amount",
            slider: slider
        });
        return;
    }

    const command = {
        command: "develop.adjust",
        slider: slider,
        amount: amount
    };

    queueOrReject(res, command);
});

app.get("/set", function (req, res) {
    if (!isExperimentalEnabled(req)) {
        rejectExperimentalSet(res);
        return;
    }

    const slider = req.query.slider;
    const value = numbers.parseFiniteNumber(req.query.value);

    if (value === null) {
        res.status(400).json({
            ok: false,
            error: "Missing or invalid value",
            slider: slider,
            experimental: true
        });
        return;
    }

    const command = {
        command: "develop.set",
        slider: slider,
        value: value
    };

    queueOrReject(res, command, {
        experimental: true
    });
});

app.get("/action", function (req, res) {
    const action = req.query.action;

    const command = {
        command: "develop.action",
        action: action
    };

    queueOrReject(res, command);
});

app.get("/reset", function (req, res) {
    const slider = req.query.slider;

    if (!sliders.exists(slider)) {
        res.status(400).json({
            ok: false,
            error: "Unknown slider",
            slider: slider
        });
        return;
    }

    const command = {
        command: "develop.reset",
        slider: slider
    };

    queueOrReject(res, command);
});

app.get("/reset-group", function (req, res) {
    const group = req.query.group;
    const groupSliders = getSlidersByGroup(group);

    if (groupSliders.length === 0) {
        res.status(400).json({
            ok: false,
            error: "Unknown or empty group",
            group: group
        });
        return;
    }

    const queued = groupSliders.map(function (slider) {
        return {
            command: "develop.reset",
            slider: slider.id
        };
    });

    queueBatchOrReject(res, queued, {
        ok: true,
        group: group,
        queuedCount: queued.length,
        queued: queued
    });
});

app.get("/reset-all", function (req, res) {
    const sliderIds = sliders.getIds();
    const queued = sliderIds.map(function (slider) {
        return {
            command: "develop.reset",
            slider: slider
        };
    });

    queueBatchOrReject(res, queued, {
        ok: true,
        queuedCount: queued.length,
        queued: queued
    });
});

app.get("/get", function (req, res) {
    const command = {
        command: "develop.get",
        slider: req.query.slider
    };

    queueOrReject(res, command, null, commands.clearLatestResult);
});

app.get("/result", function (req, res) {
    const rawValue = req.query.value;
    const numericValue = numbers.parseFiniteNumber(rawValue);

    if (numericValue === null) {
        res.status(400).json({
            ok: false,
            error: "Missing or invalid value",
            slider: req.query.slider || null
        });
        return;
    }

    const result = {
        command: req.query.command || "develop.get.result",
        slider: req.query.slider || null,
        value: numericValue
    };

    commands.setLatestResult(result);

    res.json({ ok: true });
});

app.get("/last-result", function (req, res) {
    const result = commands.getLatestResult();
    res.json({ result: result });
});


app.get("/feedback/request", function (req, res) {
    const slider = req.query.slider;

    if (!sliders.exists(slider)) {
        res.status(400).json({
            ok: false,
            error: "Unknown slider",
            slider: slider
        });
        return;
    }

    for (let i = feedbackRequests.length - 1; i >= 0; i -= 1) {
        if (feedbackRequests[i].slider === slider) {
            feedbackRequests.splice(i, 1);
        }
    }

    feedbackRequestId += 1;

    const request = {
        id: feedbackRequestId,
        slider: slider,
        requestedAt: Date.now()
    };

    feedbackRequests.push(request);

    res.json({
        ok: true,
        request: request
    });
});

app.get("/feedback/request-all", function (req, res) {
    for (let i = feedbackRequests.length - 1; i >= 0; i -= 1) {
        if (feedbackRequests[i].slider === "__all__") {
            feedbackRequests.splice(i, 1);
        }
    }

    feedbackRequestId += 1;

    const request = {
        id: feedbackRequestId,
        slider: "__all__",
        requestedAt: Date.now()
    };

    feedbackRequests.push(request);

    res.json({
        ok: true,
        request: request
    });
});

app.get("/feedback/request-many", function (req, res) {
    const rawSliders = String(req.query.sliders || "");

    const requestedSliders = rawSliders
        .split(",")
        .map(function (slider) {
            return slider.trim();
        })
        .filter(function (slider) {
            return slider.length > 0;
        });

    const validSliders = [];

    requestedSliders.forEach(function (slider) {
        if (sliders.exists(slider) && !validSliders.includes(slider)) {
            validSliders.push(slider);
        }
    });

    if (validSliders.length === 0) {
        res.status(400).json({
            ok: false,
            error: "No valid sliders",
            sliders: requestedSliders
        });
        return;
    }

    for (let i = feedbackRequests.length - 1; i >= 0; i -= 1) {
        if (String(feedbackRequests[i].slider || "").startsWith("__many__:")) {
            feedbackRequests.splice(i, 1);
        }
    }

    feedbackRequestId += 1;

    const request = {
        id: feedbackRequestId,
        slider: "__many__:" + validSliders.join(","),
        requestedAt: Date.now()
    };

    feedbackRequests.push(request);

    res.json({
        ok: true,
        request: request,
        count: validSliders.length,
        sliders: validSliders
    });
});

app.get("/feedback/next", function (req, res) {
    const request = feedbackRequests.shift() || null;

    res.json({
        ok: true,
        request: request
    });
});

app.get("/feedback/result", function (req, res) {
    const slider = req.query.slider;
    const rawValue = req.query.value;
    const numericValue = numbers.parseFiniteNumber(rawValue);
    const requestId = numbers.parseFiniteInteger(req.query.id);

    if (!sliders.exists(slider)) {
        res.status(400).json({
            ok: false,
            error: "Unknown slider",
            slider: slider
        });
        return;
    }

    if (requestId === null) {
        res.status(400).json({
            ok: false,
            error: "Missing or invalid id",
            slider: slider
        });
        return;
    }

    if (numericValue === null) {
        res.status(400).json({
            ok: false,
            error: "Missing or invalid value",
            slider: slider
        });
        return;
    }

    const result = {
        id: requestId,
        slider: slider,
        value: numericValue,
        receivedAt: Date.now()
    };

    feedbackValues[slider] = result;

    res.json({
        ok: true,
        result: result
    });
});

app.get("/feedback/value", function (req, res) {
    const slider = req.query.slider;

    if (!sliders.exists(slider)) {
        res.status(400).json({
            ok: false,
            error: "Unknown slider",
            slider: slider
        });
        return;
    }

    res.json({
        ok: true,
        result: feedbackValues[slider] || null
    });
});

app.get("/feedback/all", function (req, res) {
    res.json({
        ok: true,
        values: feedbackValues
    });
});

let httpServer = null;
let wsServer = null;
let lifecycleState = "stopped";
let startPromise = null;
let stopPromise = null;
let restartPromise = null;
let restartRequested = false;
let stopRequested = false;
let watcherOwned = false;
const httpSockets = new Set();

function attachWebSocketHandlers(server) {
server.on("connection", function (socket) {
    console.log("Client connected.");

    socket.on("message", function (message) {
        let command;

        try {
            command = JSON.parse(message.toString());
        } catch (err) {
            console.log("Invalid JSON");
            return;
        }

        const admission = commands.tryEnqueueCommand(command);
        if (admission.status === commands.ADMISSION_QUEUE_FULL) {
            socket.send(JSON.stringify({
                type: "error",
                code: "COMMAND_QUEUE_FULL",
                error: "Command queue full",
                queueLength: admission.queueLength,
                queueLimit: commands.HARD_QUEUE_CAPACITY,
                retryable: true
            }));
        }
    });

    socket.on("close", function () {
        console.log("Client disconnected.");
    });

    socket.on("error", function (err) {
        console.log("WebSocket client error: " + err.message);
    });
});
}

function closeWebSocketServer(server) {
    return new Promise(function (resolve) {
        if (!server) return resolve();

        // Lifecycle shutdown is intentionally forceful: connected clients are
        // terminated so WebSocketServer.close() cannot wait on them indefinitely.
        if (server.clients) {
            for (const client of server.clients) client.terminate();
        }

        try {
            server.close(function () { resolve(); });
        } catch (err) {
            resolve();
        }
    });
}

function closeHttpServer(server) {
    return new Promise(function (resolve) {
        if (!server) return resolve();
        let settled = false;
        let forceTimer = null;

        function finish() {
            if (settled) return;
            settled = true;
            if (forceTimer !== null) clearTimeout(forceTimer);
            resolve();
        }

        try {
            server.close(function () { finish(); });
        } catch (err) {
            finish();
            return;
        }

        if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
        forceTimer = setTimeout(function () {
            if (typeof server.closeAllConnections === "function") {
                server.closeAllConnections();
            } else {
                for (const socket of httpSockets) socket.destroy();
            }
            setTimeout(finish, 50);
        }, shutdownGraceMs);
    });
}

function listenHttp() {
    return new Promise(function (resolve, reject) {
        const server = httpHost === undefined
            ? app.listen(httpPort)
            : app.listen(httpPort, httpHost);
        server.requestTimeout = httpRequestTimeoutMs;
        server.headersTimeout = httpHeadersTimeoutMs;
        server.keepAliveTimeout = httpKeepAliveTimeoutMs;
        server.maxHeadersCount = httpMaxHeadersCount;
        httpServer = server;
        server.on("connection", function (socket) {
            httpSockets.add(socket);
            socket.once("close", function () { httpSockets.delete(socket); });
        });

        function onError(err) {
            server.removeListener("listening", onListening);
            reject(new Error("LRBridge HTTP server failed to listen on port " + httpPort + ": " + err.message));
        }

        function onListening() {
            server.removeListener("error", onError);
            console.log("LRBridge HTTP server listening on http://localhost:" + server.address().port);
            resolve();
        }

        server.once("error", onError);
        server.once("listening", onListening);
    });
}

function listenWebSocket() {
    return new Promise(function (resolve, reject) {
        const wsOptions = { port: wsPort, maxPayload: wsMaxPayloadBytes };
        if (wsHost !== undefined) wsOptions.host = wsHost;
        const server = new WebSocket.Server(wsOptions);
        wsServer = server;

        function onError(err) {
            server.removeListener("listening", onListening);
            reject(new Error("LRBridge WebSocket server failed to listen on port " + wsPort + ": " + err.message));
        }

        function onListening() {
            server.removeListener("error", onError);
            attachWebSocketHandlers(server);
            console.log("LRBridge WebSocket server listening on ws://localhost:" + server.address().port);
            resolve();
        }

        server.once("error", onError);
        server.once("listening", onListening);
    });
}

async function closeListeners() {
    const closingHttpServer = httpServer;
    const closingWebSocketServer = wsServer;
    await Promise.all([
        closeHttpServer(closingHttpServer),
        closeWebSocketServer(closingWebSocketServer)
    ]);
    if (httpServer === closingHttpServer) httpServer = null;
    if (wsServer === closingWebSocketServer) wsServer = null;
    httpSockets.clear();
}

function start() {
    if (stopPromise) {
        restartRequested = true;
        if (!restartPromise) {
            restartPromise = stopPromise.then(function () {
                restartPromise = null;
                if (restartRequested) return start();
                return api;
            });
        }
        return restartPromise;
    }
    if (lifecycleState === "running") return Promise.resolve(api);
    if (startPromise) return startPromise;

    lifecycleState = "starting";
    stopRequested = false;
    startPromise = (async function () {
        try {
            const results = await Promise.allSettled([listenHttp(), listenWebSocket()]);
            const failed = results.find(function (result) { return result.status === "rejected"; });
            if (failed) throw failed.reason;
            if (startLightroomWatcher && !stopRequested) {
                lightroomWake.startWatcher();
                watcherOwned = true;
            }
            lifecycleState = "running";
            return api;
        } catch (err) {
            if (watcherOwned) {
                lightroomWake.stopWatcher();
                watcherOwned = false;
            }
            await closeListeners();
            lifecycleState = "stopped";
            throw err;
        } finally {
            startPromise = null;
        }
    })();
    return startPromise;
}

function stop() {
    stopRequested = true;
    restartRequested = false;
    if (stopPromise) return stopPromise;
    if (lifecycleState === "stopped" && !startPromise) return Promise.resolve(api);

    stopPromise = (async function () {
        if (startPromise) {
            try { await startPromise; } catch (err) {}
        }
        lifecycleState = "stopping";
        if (watcherOwned) {
            lightroomWake.stopWatcher();
            watcherOwned = false;
        }
        await closeListeners();
        lifecycleState = "stopped";
        return api;
    })().finally(function () {
        stopPromise = null;
        stopRequested = false;
    });
    return stopPromise;
}

const api = {
    app: app,
    start: start,
    stop: stop,
    getState: function () { return lifecycleState; },
    getHttpServer: function () { return httpServer; },
    getWebSocketServer: function () { return wsServer; }
};

return api;
}

module.exports = {
    createBridge,
    HTTP_PORT,
    WS_PORT,
    WS_MAX_PAYLOAD_BYTES,
    HTTP_REQUEST_TIMEOUT_MS,
    HTTP_HEADERS_TIMEOUT_MS,
    HTTP_KEEP_ALIVE_TIMEOUT_MS,
    HTTP_MAX_HEADERS_COUNT
};
