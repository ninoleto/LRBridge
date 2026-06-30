const express = require("express");
const WebSocket = require("ws");

const commands = require("./server/commands");
const sliders = require("./server/sliders");

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
        wsPort: WS_PORT
    });
});

app.get("/status", function (req, res) {
    res.json(commands.getStatus());
});

app.get("/sliders", function (req, res) {
    res.json({
        sliders: commands.getSliderMetadata()
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