const assert = require("node:assert/strict");
const http = require("node:http");
const WebSocket = require("ws");

const commands = require("../server/commands");
const contract = require("./contract-fixture.json");
const { createBridge } = require("../server/bridge");

function getJson(port, path) {
    return new Promise(function (resolve, reject) {
        const request = http.get({ hostname: "127.0.0.1", port, path }, function (response) {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", function (chunk) { body += chunk; });
            response.on("end", function () {
                try {
                    resolve({ statusCode: response.statusCode, body: JSON.parse(body) });
                } catch (err) {
                    reject(err);
                }
            });
        });
        request.once("error", reject);
    });
}

function openWebSocket(port) {
    return new Promise(function (resolve, reject) {
        const socket = new WebSocket("ws://127.0.0.1:" + port);
        socket.once("open", function () { resolve(socket); });
        socket.once("error", reject);
    });
}

function closeWebSocket(socket) {
    return new Promise(function (resolve) {
        socket.once("close", resolve);
        socket.close();
    });
}

async function waitForQueueLength(length) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (commands.getStatus().queueLength === length) return;
        await new Promise(function (resolve) { setTimeout(resolve, 5); });
    }
    assert.equal(commands.getStatus().queueLength, length, "Timed out waiting for queue length " + length);
}

async function main() {
    while (commands.getNextCommand() !== null) {}

    const bridge = createBridge({
        httpPort: 0,
        wsPort: 0,
        httpHost: "127.0.0.1",
        wsHost: "127.0.0.1",
        shutdownGraceMs: 40
    });

    const originalLog = console.log;
    console.log = function () {};

    try {
        await bridge.start();
        const httpPort = bridge.getHttpServer().address().port;
        const wsPort = bridge.getWebSocketServer().address().port;
        let result;

        const commandCases = [
            ...["left", "right"].map((direction) => ({
                command: "photo.rotate", direction
            })),
            ...["grayscale", "color"].map((value) => ({
                command: "photo.treatment", value
            })),
            ...contract.photoCropAspects.map((mode) => ({
                command: "photo.crop_aspect", mode
            })),
            { command: "photo.crop_aspect", mode: "custom", w: 16, h: 10 },
            { command: "photo.crop_aspect", mode: "custom", w: 3, h: 2 },
            { command: "photo.crop_aspect", mode: "custom", w: 1, h: 1 },
            { command: "photo.crop_aspect", mode: "custom", w: 10000, h: 10000 },
            ...[-45, 45, 0, -2.5, 12.25].map((value) => ({
                command: "photo.crop_angle.set", value
            })),
            { command: "photo.crop_angle.reset" },
            { command: "photo.reveal", scope: "active" },
            ...["next", "previous", "first", "last"].map((direction) => ({
                command: "selection.navigate", direction
            })),
            ...["left", "right"].map((direction) => ({
                command: "selection.extend", direction, amount: 1
            })),
            ...["pick", "reject", "none"].map((flag) => ({
                command: "selection.flag", flag
            })),
            ...[0, 1, 2, 3, 4, 5].map((rating) => ({
                command: "selection.rating.set", rating
            })),
            ...["increase", "decrease"].map((direction) => ({
                command: "selection.rating.adjust", direction
            })),
            ...["red", "yellow", "green", "blue", "purple", "none"].map((label) => ({
                command: "selection.label.set", label
            })),
            ...["red", "yellow", "green", "blue", "purple"].map((label) => ({
                command: "selection.label.toggle", label
            })),
            ...contract.selectionOperations.map((operation) => ({
                command: "selection.operation", operation
            })),
            ...contract.applicationModules.map((module) => ({
                command: "application.module", module
            })),
            ...contract.applicationViews.map((view) => ({
                command: "application.view", view
            })),
            ...contract.applicationActions.map((action) => ({
                command: "application.action", action
            })),
            ...contract.secondaryViews.map((view) => ({
                command: "application.secondary_view", view
            }))
        ];

        for (const command of commandCases) {
            const path = "/command?" + Object.entries(command).map(([key, value]) =>
                encodeURIComponent(key) + "=" + encodeURIComponent(value)
            ).join("&");
            result = await getJson(httpPort, path);
            assert.deepEqual(result, { statusCode: 200, body: { ok: true, queued: command } });
            assert.deepEqual(commands.getNextCommand(), command);
            assert.equal(commands.validateCommand(command), true);
        }

        for (const path of [
            "/command?command=selection.navigate",
            "/command?command=selection.navigate&direction=Next",
            "/command?command=selection.navigate&direction=unknown",
            "/command?command=selection.navigate&direction=next&direction=previous",
            "/command?command=selection.extend",
            "/command?command=selection.extend&direction=left",
            "/command?command=selection.extend&direction=up&amount=1",
            "/command?command=selection.extend&direction=left&amount=0",
            "/command?command=selection.extend&direction=left&amount=-1",
            "/command?command=selection.extend&direction=left&amount=1.5",
            "/command?command=selection.extend&direction=left&amount=101",
            "/command?command=photo.rotate",
            "/command?command=photo.rotate&direction=up",
            "/command?command=photo.treatment",
            "/command?command=photo.treatment&value=Grayscale",
            "/command?command=photo.treatment&value=grayscale&value=color",
            "/command?command=photo.crop_aspect",
            "/command?command=photo.crop_aspect&mode=",
            "/command?command=photo.crop_aspect&mode=Original",
            "/command?command=photo.crop_aspect&mode=3x2",
            "/command?command=photo.crop_aspect&mode=1",
            "/command?command=photo.crop_aspect&mode=original&mode=1x1",
            "/command?command=photo.crop_aspect&mode=1x1&w=1&h=1",
            "/command?command=photo.crop_aspect&mode=custom",
            "/command?command=photo.crop_aspect&mode=custom&w=16",
            "/command?command=photo.crop_aspect&mode=custom&h=10",
            "/command?command=photo.crop_aspect&mode=custom&w=0&h=10",
            "/command?command=photo.crop_aspect&mode=custom&w=-1&h=10",
            "/command?command=photo.crop_aspect&mode=custom&w=1.5&h=10",
            "/command?command=photo.crop_aspect&mode=custom&w=%2016&h=10",
            "/command?command=photo.crop_aspect&mode=custom&w=16%20&h=10",
            "/command?command=photo.crop_aspect&mode=custom&w=10001&h=10",
            "/command?command=photo.crop_aspect&mode=custom&w=16&w=3&h=10",
            "/command?command=photo.crop_aspect&mode=custom&w=16&h=10&h=9",
            "/command?command=photo.crop_aspect&mode=custom&w=16&h=10&extra=1",
            "/command?command=photo.crop_angle.set",
            "/command?command=photo.crop_angle.set&value=",
            "/command?command=photo.crop_angle.set&value=%20",
            "/command?command=photo.crop_angle.set&value=-45.01",
            "/command?command=photo.crop_angle.set&value=45.01",
            "/command?command=photo.crop_angle.set&value=1.234",
            "/command?command=photo.crop_angle.set&value=NaN",
            "/command?command=photo.crop_angle.set&value=Infinity",
            "/command?command=photo.crop_angle.set&value=1&value=2",
            "/command?command=photo.crop_angle.set&value=1&mode=original",
            "/command?command=photo.crop_angle.reset&value=0",
            "/command?command=photo.crop_angle.reset&mode=original",
            "/command?command=photo.reveal",
            "/command?command=photo.reveal&scope=Active",
            "/command?command=photo.reveal&scope=active&scope=active",
            "/command?command=photo.reveal&scope=active&direction=left",
            "/command?command=selection.flag",
            "/command?command=selection.flag&flag=Pick",
            "/command?command=selection.rating.set",
            "/command?command=selection.rating.set&rating=-1",
            "/command?command=selection.rating.set&rating=6",
            "/command?command=selection.rating.set&rating=1.5",
            "/command?command=selection.rating.set&rating=NaN",
            "/command?command=selection.rating.adjust&direction=Increase",
            "/command?command=selection.label.set&label=Red",
            "/command?command=selection.label.toggle&label=none",
            "/command?command=selection.label.toggle&label=",
            "/command?command=selection.operation",
            "/command?command=selection.operation&operation=Select_all",
            "/command?command=selection.operation&operation=select_all&operation=select_none",
            "/command?command=application.module",
            "/command?command=application.module&module=Library",
            "/command?command=application.module&module=unknown",
            "/command?command=application.module&module=library&module=develop",
            "/command?command=application.view",
            "/command?command=application.view&view=Grid",
            "/command?command=application.view&view=unknown",
            "/command?command=application.view&view=grid&view=loupe",
            "/command?command=application.action",
            "/command?command=application.action&action=toggleZoom",
            "/command?command=application.action&action=unknown",
            "/command?command=application.action&action=zoom_in&action=zoom_out",
            "/command?command=application.secondary_view",
            "/command?command=application.secondary_view&view=Live_loupe",
            "/command?command=application.secondary_view&view=unknown",
            "/command?command=application.secondary_view&view=loupe&view=grid",
            "/command?command=develop.action",
            "/command?command=develop.action&action=selectCropTool&target=",
            "/command?command=develop.action&action=selectCropTool&target=upright",
            "/command?command=develop.action&action=selectCropTool&target=crop&target=loupe",
            "/command?command=develop.action&action=selectCropTool&target=crop&extra=true",
            "/command?command=develop.action&action=resetCrop&target=loupe",
            "/command?command=selection.navigate&direction=next&target=crop"
        ]) {
            const before = commands.getStatus().queueLength;
            result = await getJson(httpPort, path);
            assert.deepEqual(result.body, { ok: false, error: "Invalid command" }, path);
            assert.equal(result.statusCode, 400, path);
            assert.equal(commands.getStatus().queueLength, before, path);
        }

        result = await getJson(httpPort, "/command?command=develop.action&action=setAutoTone");
        assert.deepEqual(result, {
            statusCode: 200,
            body: { ok: true, queued: { command: "develop.action", action: "setAutoTone" } }
        });
        assert.deepEqual(commands.getNextCommand(), { command: "develop.action", action: "setAutoTone" });

        result = await getJson(httpPort, "/command?command=develop.action&action=resetAllDevelopAdjustments");
        assert.deepEqual(result, {
            statusCode: 200,
            body: { ok: true, queued: { command: "develop.action", action: "resetAllDevelopAdjustments" } }
        });
        assert.deepEqual(commands.getNextCommand(), {
            command: "develop.action",
            action: "resetAllDevelopAdjustments"
        });

        for (const target of [undefined, "crop", "loupe"]) {
            const suffix = target === undefined ? "" : "&target=" + target;
            const queued = Object.assign(
                { command: "develop.action", action: "selectCropTool" },
                target === undefined ? {} : { target: target }
            );
            result = await getJson(httpPort,
                "/command?command=develop.action&action=selectCropTool" + suffix);
            assert.deepEqual(result, { statusCode: 200, body: { ok: true, queued: queued } });
            assert.deepEqual(commands.getNextCommand(), queued);
        }

        const adjustCases = [
            ["0", 0], ["1", 1], ["-1", -1], ["25", 25], ["-25", -25],
            // Safe exponent notation is accepted after HTTP numeric normalization.
            ["1e3", 1000]
        ];
        for (const [raw, expected] of adjustCases) {
            const result = await getJson(httpPort, "/adjust?slider=Exposure&amount=" + encodeURIComponent(raw));
            const queued = { command: "develop.adjust", slider: "Exposure", amount: expected };
            assert.deepEqual(result, { statusCode: 200, body: { ok: true, queued } });
            assert.deepEqual(commands.getNextCommand(), queued);
        }

        for (const path of [
            "/adjust?slider=Exposure",
            "/adjust?slider=Exposure&amount=",
            "/adjust?slider=Exposure&amount=%20%20",
            "/adjust?slider=Exposure&amount=NaN",
            "/adjust?slider=Exposure&amount=Infinity",
            "/adjust?slider=Exposure&amount=-Infinity",
            "/adjust?slider=Exposure&amount=1e309",
            "/adjust?slider=Exposure&amount=1.25",
            "/adjust?slider=Exposure&amount=-2.5",
            "/adjust?slider=Exposure&amount=1e308",
            "/adjust?slider=Exposure&amount=9007199254740992",
            "/adjust?slider=Exposure&amount=-9007199254740992"
        ]) {
            const before = commands.getStatus().queueLength;
            const result = await getJson(httpPort, path);
            assert.equal(result.statusCode, 400, path);
            assert.equal(commands.getStatus().queueLength, before, path + " changed queue length");
        }

        result = await getJson(httpPort, "/adjust?slider=BadSlider&amount=1");
        assert.equal(result.statusCode, 400);
        assert.equal(commands.getStatus().queueLength, 0);

        for (const [raw, expected] of [["0.25", 0.25], ["-1.5", -1.5], ["5", 5]]) {
            result = await getJson(httpPort, "/set?slider=Exposure&value=" + encodeURIComponent(raw));
            const queued = { command: "develop.set", slider: "Exposure", value: expected };
            assert.deepEqual(result, { statusCode: 200, body: { ok: true, queued } });
            assert.deepEqual(commands.getNextCommand(), queued);
        }

        for (const [slider, raw, expected] of [
            ["Exposure", "-5", -5],
            ["Exposure", "5", 5],
            ["Contrast", "-100", -100],
            ["Contrast", "100", 100],
            ["Temperature", "-100", -100],
            ["Temperature", "100", 100],
            ["SharpenRadius", "0.5", 0.5],
            ["SharpenRadius", "3", 3]
        ]) {
            result = await getJson(httpPort, "/set?slider=" + slider + "&value=" + raw);
            assert.equal(result.statusCode, 200);
            assert.deepEqual(commands.getNextCommand(), {
                command: "develop.set", slider: slider, value: expected
            });
        }

        for (const suffix of ["", "&value=", "&value=%20%20", "&value=NaN", "&value=Infinity", "&value=-Infinity", "&value=1e309", "&value=5.01", "&value=-5.01", "&value=1.234", "&value=1&extra=true", "&value=1&value=2"]) {
            const before = commands.getStatus().queueLength;
            result = await getJson(httpPort, "/set?slider=Exposure" + suffix);
            assert.equal(result.statusCode, 400);
            assert.equal(commands.getStatus().queueLength, before);
        }

        result = await getJson(httpPort, "/command?command=develop.adjust&slider=Exposure&amount=%20");
        assert.equal(result.statusCode, 400);
        assert.equal(commands.getStatus().queueLength, 0);

        for (const [raw, expected] of [["1.25", 1.25], ["0", 0], ["-2", -2]]) {
            result = await getJson(httpPort, "/result?command=develop.get.result&slider=Exposure&value=" + raw);
            assert.deepEqual(result, { statusCode: 200, body: { ok: true } });
            result = await getJson(httpPort, "/last-result");
            assert.deepEqual(result.body, { result: { command: "develop.get.result", slider: "Exposure", value: expected } });
        }
        for (const suffix of ["", "&value=NaN", "&value=Infinity", "&value=-Infinity", "&value=1e309", "&value=", "&value=%20"]) {
            result = await getJson(httpPort, "/result?slider=Exposure" + suffix);
            assert.equal(result.statusCode, 400);
        }

        result = await getJson(httpPort, "/feedback/request?slider=Exposure");
        const feedbackId = result.body.request.id;
        result = await getJson(httpPort, "/feedback/result?id=" + feedbackId + "&slider=Exposure&value=-0.5&min=-5&max=5");
        assert.equal(result.statusCode, 200);
        assert.deepEqual(result.body.result.id, feedbackId);

        result = await getJson(httpPort, "/feedback/request?slider=CropAngle");
        const cropAngleFeedbackId = result.body.request.id;
        result = await getJson(
            httpPort,
            "/feedback/result?id=" + cropAngleFeedbackId + "&slider=CropAngle&value=-2.5&min=-45&max=45"
        );
        assert.equal(result.statusCode, 200);
        result = await getJson(httpPort, "/feedback/value?slider=CropAngle");
        assert.equal(result.body.result.value, -2.5);
        result = await getJson(httpPort, "/feedback/value?slider=Exposure");
        assert.equal(result.body.result.value, -0.5);
        result = await getJson(
            httpPort,
            "/feedback/result?id=" + feedbackId + "&slider=Exposure&available=0"
        );
        assert.equal(result.statusCode, 200);
        assert.equal(result.body.result.available, false);
        assert.equal(result.body.result.value, null);
        result = await getJson(
            httpPort,
            "/feedback/result?id=" + feedbackId + "&slider=Exposure&available=0&extra=true"
        );
        assert.equal(result.statusCode, 400);

        result = await getJson(httpPort, "/feedback/request-many?sliders=Exposure,Tint");
        const snapshotId = result.body.request.id;
        result = await getJson(
            httpPort,
            "/feedback/result?id=" + snapshotId + "&slider=Exposure&value=1.25&min=-5&max=5"
        );
        assert.equal(result.statusCode, 200);
        result = await getJson(httpPort, "/feedback/snapshot?id=" + snapshotId);
        assert.equal(result.body.snapshot.complete, false);
        assert.deepEqual(Object.keys(result.body.snapshot.results), ["Exposure"]);
        result = await getJson(
            httpPort,
            "/feedback/result?id=" + snapshotId + "&slider=Tint&value=18&min=-150&max=150"
        );
        assert.equal(result.statusCode, 200);
        result = await getJson(httpPort, "/feedback/snapshot?id=" + snapshotId);
        assert.equal(result.body.snapshot.complete, true);
        assert.equal(result.body.snapshot.results.Exposure.value, 1.25);
        assert.equal(result.body.snapshot.results.Tint.value, 18);
        assert.deepEqual(result.body.snapshot.results.Tint.range, { min: -150, max: 150 });
        assert.deepEqual(require("../server/sliders").getEffectiveRange("Tint"), { min: -150, max: 150 });

        // A new browser/request lifecycle must receive a complete snapshot even
        // when Lightroom's values have not changed since the prior request.
        result = await getJson(httpPort, "/feedback/request-many?sliders=Exposure,Tint");
        const reloadSnapshotId = result.body.request.id;
        await getJson(
            httpPort,
            "/feedback/result?id=" + reloadSnapshotId + "&slider=Exposure&value=1.25&min=-5&max=5"
        );
        await getJson(
            httpPort,
            "/feedback/result?id=" + reloadSnapshotId + "&slider=Tint&value=18&min=-150&max=150"
        );
        result = await getJson(httpPort, "/feedback/snapshot?id=" + reloadSnapshotId);
        assert.equal(result.body.snapshot.complete, true);
        assert.deepEqual(Object.keys(result.body.snapshot.results).sort(), ["Exposure", "Tint"]);

        // Explicit unavailable completes the snapshot; a missing result does not.
        result = await getJson(httpPort, "/feedback/request-many?sliders=Exposure,Tint");
        const mixedSnapshotId = result.body.request.id;
        await getJson(
            httpPort,
            "/feedback/result?id=" + mixedSnapshotId + "&slider=Exposure&value=0.5&min=-5&max=5"
        );
        result = await getJson(httpPort, "/feedback/snapshot?id=" + mixedSnapshotId);
        assert.equal(result.body.snapshot.complete, false);
        assert.equal(result.body.snapshot.results.Tint, undefined);
        await getJson(
            httpPort,
            "/feedback/result?id=" + mixedSnapshotId + "&slider=Tint&available=0"
        );
        result = await getJson(httpPort, "/feedback/snapshot?id=" + mixedSnapshotId);
        assert.equal(result.body.snapshot.complete, true);
        assert.equal(result.body.snapshot.results.Exposure.available, true);
        assert.equal(result.body.snapshot.results.Tint.available, false);
        assert.equal(result.body.snapshot.results.Tint.value, null);

        result = await getJson(httpPort, "/feedback/result?id=0&slider=Exposure&value=0&min=-5&max=5");
        assert.equal(result.statusCode, 200);
        assert.equal(result.body.result.id, 0);
        assert.equal(result.body.result.value, 0);
        for (const suffix of ["", "&value=NaN", "&value=Infinity", "&value=-Infinity", "&value=1e309", "&value=", "&value=%20"]) {
            result = await getJson(httpPort, "/feedback/result?id=" + feedbackId + "&slider=Exposure" + suffix);
            assert.equal(result.statusCode, 400);
        }
        for (const suffix of ["", "?id=1.5", "?id=NaN", "?id=Infinity", "?id=-Infinity", "?id=", "?id=%20"]) {
            const separator = suffix.length === 0 ? "?" : "&";
            result = await getJson(httpPort, "/feedback/result" + suffix + separator + "slider=Exposure&value=1");
            assert.equal(result.statusCode, 400);
        }

        const socket = await openWebSocket(wsPort);
        for (const command of commandCases) {
            socket.send(JSON.stringify(command));
            await waitForQueueLength(1);
            assert.deepEqual(commands.getNextCommand(), command);
        }

        const invalidStrings = [undefined, null, true, [], {}, 1, "", "Next", "unknown"];
        const invalidSelectionCommands = [];
        for (const direction of invalidStrings) {
            invalidSelectionCommands.push({ command: "selection.navigate", direction });
            invalidSelectionCommands.push({ command: "photo.rotate", direction });
            invalidSelectionCommands.push({ command: "selection.extend", direction, amount: 1 });
        }
        for (const value of [undefined, null, true, 1, "", [], {}, "Grayscale"]) {
            invalidSelectionCommands.push({ command: "photo.treatment", value });
        }
        for (const mode of [undefined, null, true, 1, "", [], {}, "Original", "3x2", "1:1"]) {
            invalidSelectionCommands.push({ command: "photo.crop_aspect", mode });
        }
        for (const scope of [undefined, null, true, 1, "", [], {}, "Active"]) {
            invalidSelectionCommands.push({ command: "photo.reveal", scope });
        }
        invalidSelectionCommands.push(
            { command: "photo.treatment", value: "color", mode: "original" },
            { command: "photo.crop_aspect", mode: "1x1", w: 1, h: 1 },
            { command: "photo.crop_aspect", mode: "original", scope: "active" },
            { command: "photo.crop_angle.reset", value: 0 },
            { command: "photo.crop_angle.reset", extra: true },
            { command: "photo.reveal", scope: "active", direction: "left" }
        );
        for (const invalidDimension of [
            undefined, null, true, [], {}, "", "16", 0, -1, 1.5, 10001, Infinity, NaN
        ]) {
            invalidSelectionCommands.push({
                command: "photo.crop_aspect", mode: "custom", w: invalidDimension, h: 10
            });
            invalidSelectionCommands.push({
                command: "photo.crop_aspect", mode: "custom", w: 16, h: invalidDimension
            });
        }
        invalidSelectionCommands.push(
            { command: "photo.crop_aspect", mode: "custom", w: 16 },
            { command: "photo.crop_aspect", mode: "custom", h: 10 },
            { command: "photo.crop_aspect", mode: "custom", w: 16, h: 10, extra: true }
        );
        for (const value of [
            undefined, null, true, [], {}, "", "0", NaN, Infinity, -Infinity,
            -45.01, 45.01, 1.234
        ]) {
            invalidSelectionCommands.push({ command: "photo.crop_angle.set", value });
        }
        for (const amount of [undefined, null, true, "", "1", 0, -1, 1.5, 101, Infinity]) {
            invalidSelectionCommands.push({ command: "selection.extend", direction: "left", amount });
        }
        for (const flag of invalidStrings) {
            invalidSelectionCommands.push({ command: "selection.flag", flag });
        }
        for (const direction of invalidStrings) {
            invalidSelectionCommands.push({ command: "selection.rating.adjust", direction });
        }
        for (const label of invalidStrings) {
            invalidSelectionCommands.push({ command: "selection.label.set", label });
            invalidSelectionCommands.push({ command: "selection.label.toggle", label });
        }
        for (const value of invalidStrings) {
            invalidSelectionCommands.push({ command: "selection.operation", operation: value });
            invalidSelectionCommands.push({ command: "application.module", module: value });
            invalidSelectionCommands.push({ command: "application.view", view: value });
            invalidSelectionCommands.push({ command: "application.action", action: value });
            invalidSelectionCommands.push({ command: "application.secondary_view", view: value });
        }
        invalidSelectionCommands.push({ command: "selection.label.toggle", label: "none" });
        for (const rating of [
            undefined, null, true, [], {}, "", "5", "Five", "unknown",
            -1, 6, 1.5, Number.MAX_SAFE_INTEGER + 1
        ]) {
            invalidSelectionCommands.push({ command: "selection.rating.set", rating });
        }
        for (const command of invalidSelectionCommands) {
            const before = commands.getStatus().queueLength;
            socket.send(JSON.stringify(command));
            await new Promise((resolve) => setTimeout(resolve, 2));
            assert.equal(commands.getStatus().queueLength, before, JSON.stringify(command));
            assert.equal(commands.validateCommand(command), false);
        }
        for (const command of [
            { command: "develop.adjust", slider: "Exposure", amount: 0 },
            { command: "develop.adjust", slider: "Exposure", amount: -25 },
            // JSON.parse normalizes numeric 1e3 to the safe integer 1000.
            { command: "develop.adjust", slider: "Exposure", amount: 1e3 },
            { command: "develop.set", slider: "Exposure", value: -1.5 }
        ]) {
            socket.send(JSON.stringify(command));
            await waitForQueueLength(1);
            assert.deepEqual(commands.getNextCommand(), command);
        }
        for (const command of [
            { command: "develop.adjust", slider: "Exposure" },
            { command: "develop.adjust", slider: "Exposure", amount: "1" },
            { command: "develop.adjust", slider: "Exposure", amount: 1.25 },
            { command: "develop.adjust", slider: "Exposure", amount: -2.5 },
            { command: "develop.adjust", slider: "Exposure", amount: 1e308 },
            { command: "develop.adjust", slider: "Exposure", amount: Number.MAX_SAFE_INTEGER + 1 },
            { command: "develop.adjust", slider: "Exposure", amount: Number.MIN_SAFE_INTEGER - 1 },
            { command: "develop.set", slider: "Exposure" }
        ]) {
            const sentinel = { command: "develop.reset", slider: "Exposure" };
            socket.send(JSON.stringify(command));
            socket.send(JSON.stringify(sentinel));
            await waitForQueueLength(1);
            assert.deepEqual(commands.getNextCommand(), sentinel);
        }
        const sentinel = { command: "develop.reset", slider: "Exposure" };
        socket.send("not json");
        socket.send(JSON.stringify(sentinel));
        await waitForQueueLength(1);
        assert.deepEqual(commands.getNextCommand(), sentinel);
        socket.send("null");
        socket.send(JSON.stringify(sentinel));
        await waitForQueueLength(1);
        assert.deepEqual(commands.getNextCommand(), sentinel);
        await closeWebSocket(socket);

        for (const amount of [0, 1, -1, 25, -25, 1e3, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
            const command = { command: "develop.adjust", slider: "Exposure", amount };
            assert.equal(commands.validateCommand(command), true);
            assert.equal(commands.enqueueCommand(command), true);
            assert.deepEqual(commands.getNextCommand(), command);
        }

        for (const amount of [1.25, -2.5, 1e308, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1]) {
            const command = { command: "develop.adjust", slider: "Exposure", amount };
            const before = commands.getQueueDiagnostics();
            assert.equal(commands.validateCommand(command), false);
            assert.equal(commands.enqueueCommand(command), false);
            assert.equal(commands.getStatus().queueLength, before.queue.length);
            assert.equal(commands.getQueueDiagnostics().counters.coalescedCommands, before.counters.coalescedCommands);
        }

        for (const nonFinite of [NaN, Infinity, -Infinity]) {
            for (const command of [
                { command: "develop.adjust", slider: "Exposure", amount: nonFinite },
                { command: "develop.set", slider: "Exposure", value: nonFinite },
                { command: "selection.rating.set", rating: nonFinite }
            ]) {
                const before = commands.getStatus().queueLength;
                assert.equal(commands.validateCommand(command), false);
                assert.equal(commands.enqueueCommand(command), false);
                assert.equal(commands.getStatus().queueLength, before);
            }
        }

        commands.enqueueCommand({ command: "develop.adjust", slider: "Exposure", amount: 2 });
        const coalesced = commands.tryEnqueueCommand({ command: "develop.adjust", slider: "Exposure", amount: 3 });
        assert.equal(coalesced.status, commands.ADMISSION_COALESCED);
        assert.deepEqual(commands.getNextCommand(), { command: "develop.adjust", slider: "Exposure", amount: 5 });

        commands.enqueueCommand({
            command: "develop.adjust", slider: "Exposure", amount: Number.MAX_SAFE_INTEGER
        });
        const safeOverflow = commands.tryEnqueueCommand({
            command: "develop.adjust", slider: "Exposure", amount: 1
        });
        assert.equal(safeOverflow.status, commands.ADMISSION_ACCEPTED);
        assert.equal(safeOverflow.coalesced, false);
        assert.deepEqual(commands.getNextCommand(), {
            command: "develop.adjust", slider: "Exposure", amount: Number.MAX_SAFE_INTEGER
        });
        assert.deepEqual(commands.getNextCommand(), {
            command: "develop.adjust", slider: "Exposure", amount: 1
        });
    } finally {
        await bridge.stop();
        console.log = originalLog;
    }

    console.log("Finite numeric input validation passed.");
}

main().catch(function (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
});
