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