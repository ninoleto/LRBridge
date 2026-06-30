const WebSocket = require("ws");
const http = require("http");

const slider = process.argv[2];

if (!slider) {
    console.log("Usage:");
    console.log("node tests/get.js Exposure");
    process.exit(1);
}

function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = "";

            res.on("data", (chunk) => {
                data += chunk;
            });

            res.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                } catch (err) {
                    reject(err);
                }
            });
        }).on("error", reject);
    });
}

async function main() {
    await getJson("http://localhost:17891/last-result");

    const ws = new WebSocket("ws://localhost:17890");

    ws.on("open", async () => {
        const command = {
            command: "develop.get",
            slider: slider
        };

        console.log("Sending:");
        console.log(command);

        ws.send(JSON.stringify(command));
        ws.close();

        for (let i = 0; i < 20; i++) {
            await new Promise((resolve) => setTimeout(resolve, 200));

            const response = await getJson("http://localhost:17891/last-result");

            if (response.result) {
                console.log("Result:");
                console.log(response.result);
                return;
            }
        }

        console.log("No result received.");
    });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});