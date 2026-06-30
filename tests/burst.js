const WebSocket = require("ws");

const slider = process.argv[2];
const amount = Number(process.argv[3]);
const count = Number(process.argv[4]);

if (!slider || Number.isNaN(amount) || Number.isNaN(count)) {
    console.log("Usage:");
    console.log("node tests/burst.js Exposure 1 10");
    process.exit(1);
}

const ws = new WebSocket("ws://localhost:17890");

ws.on("open", () => {
    console.log(`Sending ${count} commands: ${slider} ${amount}`);

    for (let i = 0; i < count; i++) {
        const command = {
            command: "develop.adjust",
            slider: slider,
            amount: amount
        };

        ws.send(JSON.stringify(command));
    }

    ws.close();
});