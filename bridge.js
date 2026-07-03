const express = require("express");
const WebSocket = require("ws");

const commands = require("./server/commands");
const sliders = require("./server/sliders");
const lightroomWake = require("./server/lightroomWake");

const HTTP_PORT = 17891;
const WS_PORT = 17890;

const app = express();

function queueCommand(command) {
    return commands.setLatestCommand(JSON.stringify(command));
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

function rejectInvalidCommand(res, command) {
    res.status(400).json({
        ok: false,
        error: "Invalid command",
        rejected: command
    });
}

function queueOrReject(res, command, responseExtra) {
    const queued = queueCommand(command);

    if (!queued) {
        rejectInvalidCommand(res, command);
        return;
    }

    res.json(Object.assign({
        ok: true,
        queued: command
    }, responseExtra || {}));
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
        httpPort: HTTP_PORT,
        wsPort: WS_PORT,
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
    res.json(commands.getStatus());
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
    const slider = req.query.slider;

    if (commandName === "develop.set" && !isExperimentalEnabled(req)) {
        rejectExperimentalSet(res);
        return;
    }

    const command = {
        command: commandName,
        slider: slider
    };

    if (req.query.amount !== undefined) {
        command.amount = Number(req.query.amount);
    }

    if (req.query.value !== undefined) {
        command.value = Number(req.query.value);
    }

    if (command.command === "develop.get") {
        commands.clearLatestResult();
    }

    queueOrReject(res, command);
});

app.get("/adjust", function (req, res) {
    const slider = req.query.slider;
    const amount = Number(req.query.amount);

    if (req.query.amount === undefined || Number.isNaN(amount)) {
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
    const value = Number(req.query.value);

    if (req.query.value === undefined || Number.isNaN(value)) {
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
    const queued = [];

    if (groupSliders.length === 0) {
        res.status(400).json({
            ok: false,
            error: "Unknown or empty group",
            group: group
        });
        return;
    }

    for (const slider of groupSliders) {
        const command = {
            command: "develop.reset",
            slider: slider.id
        };

        const wasQueued = queueCommand(command);

        if (wasQueued) {
            queued.push(command);
        }
    }

    res.json({
        ok: true,
        group: group,
        queuedCount: queued.length,
        queued: queued
    });
});

app.get("/reset-all", function (req, res) {
    const sliderIds = sliders.getIds();
    const queued = [];

    for (const slider of sliderIds) {
        const command = {
            command: "develop.reset",
            slider: slider
        };

        const wasQueued = queueCommand(command);

        if (wasQueued) {
            queued.push(command);
        }
    }

    res.json({
        ok: true,
        queuedCount: queued.length,
        queued: queued
    });
});

app.get("/get", function (req, res) {
    commands.clearLatestResult();

    const command = {
        command: "develop.get",
        slider: req.query.slider
    };

    queueOrReject(res, command);
});

app.get("/result", function (req, res) {
    const rawValue = req.query.value;
    const numericValue = Number(rawValue);

    const result = {
        command: req.query.command || "develop.get.result",
        slider: req.query.slider || null,
        value: Number.isNaN(numericValue) ? rawValue : numericValue
    };

    commands.setLatestResult(result);

    res.json({ ok: true });
});

app.get("/last-result", function (req, res) {
    const result = commands.getLatestResult();
    res.json({ result: result });
});

app.listen(HTTP_PORT, function () {
    console.log("LRBridge HTTP server listening on http://localhost:" + HTTP_PORT);
    lightroomWake.startWatcher();
});

const wsServer = new WebSocket.Server({ port: WS_PORT });

console.log("LRBridge WebSocket server listening on ws://localhost:" + WS_PORT);

wsServer.on("connection", function (socket) {
    console.log("Client connected.");

    socket.on("message", function (message) {
        commands.setLatestCommand(message.toString());
    });

    socket.on("close", function () {
        console.log("Client disconnected.");
    });
});