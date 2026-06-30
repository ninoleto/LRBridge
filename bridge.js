const express = require("express");
const WebSocket = require("ws");

const commands = require("./server/commands");

const HTTP_PORT = 17891;
const WS_PORT = 17890;

const app = express();

app.get("/next", function (req, res) {
    const command = commands.getNextCommand();
    res.json({ command: command });
});

app.get("/command", function (req, res) {
    const commandName = req.query.command;
    const slider = req.query.slider;

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

    commands.setLatestCommand(JSON.stringify(command));

    res.json({
        ok: true,
        queued: command
    });
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