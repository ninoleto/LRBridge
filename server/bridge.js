const express = require("express");
const WebSocket = require("ws");

const commands = require("./commands");
const sliders = require("./sliders");
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
const shutdownGraceMs = options.shutdownGraceMs === undefined ? 250 : options.shutdownGraceMs;
const app = express();

const feedbackRequests = [];
const feedbackValues = {};
const feedbackSnapshots = {};
let feedbackRequestId = 0;
let startupLibraryQueued = false;
const dedicatedFeedbackParameters = new Set(["CropAngle"]);

function isFeedbackParameter(value) {
    return sliders.exists(value) || dedicatedFeedbackParameters.has(value);
}

function createFeedbackSnapshot(id, requestedSliders) {
    feedbackSnapshots[id] = {
        id: id,
        requestedSliders: requestedSliders.slice(),
        results: {},
        complete: false,
        requestedAt: Date.now(),
        completedAt: null
    };

    const ids = Object.keys(feedbackSnapshots).map(Number).sort(function (a, b) { return a - b; });
    while (ids.length > 32) {
        const expiredId = ids.shift();
        delete feedbackSnapshots[expiredId];
        for (let i = feedbackRequests.length - 1; i >= 0; i -= 1) {
            if (feedbackRequests[i].id === expiredId) {
                feedbackRequests.splice(i, 1);
            }
        }
    }
}

function queueCommand(command) {
    return commands.tryEnqueueCommand(command);
}

function isValidContextHeartbeat(query) {
    return typeof query.activeModule === "string" &&
        typeof query.selectedPhotoKey === "string" &&
        typeof query.developFingerprint === "string";
}

function queueStartupLibraryOnce() {
    if (startupLibraryQueued) return;

    const admission = queueCommand({
        command: "application.module",
        module: "library"
    });

    if (admission.accepted) {
        startupLibraryQueued = true;
        console.log("Queued startup Library module command.");
    }
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
            set: "/set?slider=Exposure&value=1.25",
            adjust: "/adjust?slider=Exposure&amount=1",
            reset: "/reset?slider=Exposure",
            navigateSelection: "/command?command=selection.navigate&direction=next",
            extendSelection: "/command?command=selection.extend&direction=right&amount=1",
            rotatePhoto: "/command?command=photo.rotate&direction=right",
            setPhotoTreatment: "/command?command=photo.treatment&value=grayscale",
            setPhotoCropAspect: "/command?command=photo.crop_aspect&mode=1x1",
            setPhotoCropAspect16x10: "/command?command=photo.crop_aspect&mode=16x10",
            setCustomPhotoCropAspect: "/command?command=photo.crop_aspect&mode=custom&w=16&h=10",
            setPhotoCropAngle: "/command?command=photo.crop_angle.set&value=-2.5",
            resetPhotoCropAngle: "/command?command=photo.crop_angle.reset",
            revealPhoto: "/command?command=photo.reveal&scope=active",
            openCropTool: "/command?command=develop.action&action=selectCropTool",
            resetCrop: "/command?command=develop.action&action=resetCrop",
            setFlag: "/command?command=selection.flag&flag=pick",
            setRating: "/command?command=selection.rating.set&rating=5",
            adjustRating: "/command?command=selection.rating.adjust&direction=increase",
            setColorLabel: "/command?command=selection.label.set&label=red",
            toggleColorLabel: "/command?command=selection.label.toggle&label=red",
            selectionOperation: "/command?command=selection.operation&operation=select_all",
            switchModule: "/command?command=application.module&module=library",
            showView: "/command?command=application.view&view=grid",
            applicationAction: "/command?command=application.action&action=toggle_zoom",
            secondaryView: "/command?command=application.secondary_view&view=loupe",
            deprecatedWakeEndpoint: "/wake-lightroom",
            libraryModuleCommand: "/command?command=application.module&module=library"
        },
        experimentalEndpoints: {
            get: "/get?slider=Exposure",
            lastResult: "/last-result"
        },
        notes: [
            "Use /set for absolute Web Controller values; /adjust remains available for Companion encoders.",
            "Do not depend on /get for feedback.",
            "Rapid pending absolute values coalesce independently per slider.",
            "amount means number of Lightroom increment steps.",
            "Accepted commands are queued; execution by Lightroom is not confirmed.",
            "Selection commands act on Lightroom's current selection and do not switch modules.",
            "First/last selection works in all modules in Lightroom Classic 13 or later; older versions may require Library.",
            "Color label metadata strings depend on Lightroom's active Color Label Set.",
            "Selection commands use the Lightroom SDK and do not depend on keyboard shortcuts or AutoHotkey.",
            "Application commands use LrApplicationView and only switch modules when application.module is requested.",
            "Selection operations and application controls are ordinary FIFO queue commands; they do not consume the protected reset/action reserve.",
            "After the first valid Lightroom context heartbeat, LRBridge queues one SDK-native switch to Library.",
            "/wake-lightroom is deprecated; use /command?command=application.module&module=library."
        ]
    });
});

app.get("/wake-lightroom", function (req, res) {
    queueOrReject(res, {
        command: "application.module",
        module: "library"
    }, {
        deprecated: true,
        replacement: "/command?command=application.module&module=library"
    });
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
    const previousContextCounter = context.getContextFields().contextCounter;
    const updated = context.updateContext({
        activeModule: req.query.activeModule,
        selectedPhotoKey: req.query.selectedPhotoKey,
        developFingerprint: req.query.developFingerprint
    });

    if (updated.contextCounter !== previousContextCounter) {
        Object.keys(feedbackValues).forEach(function (slider) {
            delete feedbackValues[slider];
        });
    }

    if (isValidContextHeartbeat(req.query)) {
        queueStartupLibraryOnce();
    }

    const status = commands.getStatus();

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

    const command = { command: commandName };

    for (const field of ["slider", "action", "direction", "flag", "label", "operation", "module", "view", "mode", "scope"]) {
        if (req.query[field] !== undefined) command[field] = req.query[field];
    }

    if (commandName === "photo.crop_aspect") {
        const allowedQueryFields = new Set(["command", "mode", "w", "h"]);
        if (Object.keys(req.query).some(function (field) {
            return !allowedQueryFields.has(field);
        })) {
            command.invalidQueryField = true;
        }

        for (const field of ["w", "h"]) {
            if (req.query[field] !== undefined) {
                const raw = req.query[field];
                command[field] = typeof raw === "string" && /^\d+$/.test(raw)
                    ? Number(raw)
                    : raw;
            }
        }
    }

    if (commandName === "photo.crop_angle.set" || commandName === "photo.crop_angle.reset") {
        const allowedQueryFields = commandName === "photo.crop_angle.set"
            ? new Set(["command", "value"])
            : new Set(["command"]);

        if (Object.keys(req.query).some(function (field) {
            return !allowedQueryFields.has(field);
        })) {
            command.invalidQueryField = true;
        }
    }

    if (commandName === "develop.reset") {
        const allowedQueryFields = new Set(["command", "slider"]);
        if (Object.keys(req.query).some(function (field) {
            return !allowedQueryFields.has(field);
        })) {
            command.invalidQueryField = true;
        }
    }

    if (req.query.amount !== undefined) {
        command.amount = numbers.parseFiniteNumber(req.query.amount);
    }

    if (req.query.value !== undefined) {
        if (commandName === "photo.treatment") {
            command.value = req.query.value;
        } else if (commandName === "photo.crop_angle.set") {
            const rawValue = req.query.value;
            command.value = typeof rawValue === "string" &&
                /^-?\d+(?:\.\d{1,2})?$/.test(rawValue)
                ? Number(rawValue)
                : rawValue;
        } else if (commandName === "develop.set") {
            const allowedQueryFields = new Set(["command", "slider", "value"]);
            command.value = Object.keys(req.query).some(function (field) {
                return !allowedQueryFields.has(field);
            }) ? req.query.value : sliders.parseAbsoluteValue(req.query.slider, req.query.value);
        } else {
            command.value = numbers.parseFiniteNumber(req.query.value);
        }
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
    const slider = req.query.slider;
    const allowedFields = new Set(["slider", "value"]);
    const hasExtraField = Object.keys(req.query).some(function (field) {
        return !allowedFields.has(field);
    });
    const value = hasExtraField ? null : sliders.parseAbsoluteValue(slider, req.query.value);

    if (value === null) {
        res.status(400).json({
            ok: false,
            error: "Missing or invalid value",
            slider: slider
        });
        return;
    }

    const command = {
        command: "develop.set",
        slider: slider,
        value: value
    };

    queueOrReject(res, command);
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

    if (Object.keys(req.query).length !== 1 || !sliders.exists(slider)) {
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

    if (!isFeedbackParameter(slider)) {
        res.status(400).json({
            ok: false,
            error: "Unknown slider",
            slider: slider
        });
        return;
    }

    feedbackRequestId += 1;

    const request = {
        id: feedbackRequestId,
        slider: slider,
        requestedAt: Date.now()
    };

    feedbackRequests.push(request);
    createFeedbackSnapshot(request.id, [slider]);

    res.json({
        ok: true,
        request: request
    });
});

app.get("/feedback/request-all", function (req, res) {
    feedbackRequestId += 1;

    const request = {
        id: feedbackRequestId,
        slider: "__all__",
        requestedAt: Date.now()
    };

    feedbackRequests.push(request);
    createFeedbackSnapshot(request.id, sliders.getAll()
        .filter(function (slider) { return slider.feedbackSupported === true; })
        .map(function (slider) { return slider.id; })
        .concat(["CropAngle"]));

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
        if (isFeedbackParameter(slider) && !validSliders.includes(slider)) {
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

    feedbackRequestId += 1;

    const request = {
        id: feedbackRequestId,
        slider: "__many__:" + validSliders.join(","),
        requestedAt: Date.now()
    };

    feedbackRequests.push(request);
    createFeedbackSnapshot(request.id, validSliders);

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
    const unavailable = req.query.available === "0" && rawValue === undefined;
    const allowedFields = unavailable
        ? new Set(["id", "slider", "available"])
        : new Set(["id", "slider", "value", "min", "max"]);
    const hasExtraField = Object.keys(req.query).some(function (field) {
        return !allowedFields.has(field);
    });
    const numericValue = numbers.parseFiniteNumber(rawValue);
    const rangeMin = numbers.parseFiniteNumber(req.query.min);
    const rangeMax = numbers.parseFiniteNumber(req.query.max);
    const requestId = numbers.parseFiniteInteger(req.query.id);

    if (!isFeedbackParameter(slider)) {
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

    if (
        hasExtraField ||
        (!unavailable && (
            numericValue === null ||
            rangeMin === null ||
            rangeMax === null ||
            rangeMin >= rangeMax
        ))
    ) {
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
        value: unavailable ? null : numericValue,
        available: !unavailable,
        range: unavailable ? null : { min: rangeMin, max: rangeMax },
        receivedAt: Date.now()
    };

    if (!unavailable) {
        sliders.setRuntimeRange(slider, rangeMin, rangeMax);
    }

    feedbackValues[slider] = result;

    const snapshot = feedbackSnapshots[requestId];
    if (snapshot && snapshot.requestedSliders.includes(slider)) {
        snapshot.results[slider] = result;
        snapshot.complete = snapshot.requestedSliders.every(function (requestedSlider) {
            return snapshot.results[requestedSlider] !== undefined;
        });
        if (snapshot.complete && snapshot.completedAt === null) {
            snapshot.completedAt = Date.now();
        }
    }

    res.json({
        ok: true,
        result: result
    });
});

app.get("/feedback/value", function (req, res) {
    const slider = req.query.slider;

    if (!isFeedbackParameter(slider)) {
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

app.get("/feedback/snapshot", function (req, res) {
    const requestId = numbers.parseFiniteInteger(req.query.id);
    const hasExtraField = Object.keys(req.query).some(function (field) {
        return field !== "id";
    });

    if (requestId === null || hasExtraField) {
        res.status(400).set("Cache-Control", "no-store").json({
            ok: false,
            error: "Missing or invalid id"
        });
        return;
    }

    const snapshot = feedbackSnapshots[requestId];

    if (!snapshot) {
        res.status(404).set("Cache-Control", "no-store").json({
            ok: false,
            error: "Unknown feedback snapshot"
        });
        return;
    }

    res.set("Cache-Control", "no-store").json({
        ok: true,
        snapshot: snapshot
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
    startupLibraryQueued = false;
    startPromise = (async function () {
        try {
            const results = await Promise.allSettled([listenHttp(), listenWebSocket()]);
            const failed = results.find(function (result) { return result.status === "rejected"; });
            if (failed) throw failed.reason;
            lifecycleState = "running";
            return api;
        } catch (err) {
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
