const assert = require("node:assert/strict");
const http = require("node:http");

const metadata = require("../config/sliders.json");
const commands = require("../server/commands");
const sliders = require("../server/sliders");
const { createBridge } = require("../server/bridge");

const hueCases = [
    { id: "DefringePurpleHueLo", runtime: { min: 0, max: 55 }, acceptedValue: 78 },
    { id: "DefringePurpleHueHi", runtime: { min: 44, max: 100 }, acceptedValue: 20 },
    { id: "DefringeGreenHueLo", runtime: { min: 0, max: 55 }, acceptedValue: 78 },
    { id: "DefringeGreenHueHi", runtime: { min: 44, max: 100 }, acceptedValue: 20 }
];
const hueIds = hueCases.map(function (testCase) { return testCase.id; });

function getJson(port, requestPath) {
    return new Promise(function (resolve, reject) {
        const request = http.get({ hostname: "127.0.0.1", port, path: requestPath }, function (response) {
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

function drainQueue() {
    while (commands.getNextCommand() !== null) {}
}

async function main() {
    drainQueue();
    assert.deepEqual(
        metadata.filter(function (item) { return item.useRuntimeRangeForAdmission === false; })
            .map(function (item) { return item.id; }),
        hueIds,
        "Static-domain admission must remain limited to the four Defringe Hue endpoints"
    );
    for (const testCase of hueCases) {
        const definition = metadata.find(function (item) { return item.id === testCase.id; });
        assert.ok(definition, "Missing metadata for " + testCase.id);
        assert.deepEqual(
            { min: definition.min, max: definition.max, useRuntimeRangeForAdmission: definition.useRuntimeRangeForAdmission },
            { min: 0, max: 100, useRuntimeRangeForAdmission: false }
        );
        assert.equal(sliders.setRuntimeRange(testCase.id, testCase.runtime.min, testCase.runtime.max), true);
        assert.deepEqual(sliders.getEffectiveRange(testCase.id), testCase.runtime,
            testCase.id + " must retain its transient Lightroom range");
        const reported = sliders.getAll().find(function (item) { return item.id === testCase.id; });
        assert.deepEqual({ min: reported.min, max: reported.max }, testCase.runtime,
            testCase.id + " must continue reporting its transient Lightroom range");
        assert.deepEqual(sliders.getAdmissionRange(testCase.id), { min: 0, max: 100 },
            testCase.id + " must use its permanent domain for admission");
        assert.equal(sliders.parseAbsoluteValue(testCase.id, String(testCase.acceptedValue)), testCase.acceptedValue);
        assert.equal(commands.validateCommand({
            command: "develop.set", slider: testCase.id, value: testCase.acceptedValue
        }), true);
        for (const invalidValue of [-1, 101, NaN, Infinity, -Infinity]) {
            assert.equal(sliders.isValidAbsoluteValue(testCase.id, invalidValue), false,
                testCase.id + " must reject " + invalidValue);
        }
        for (const invalidText of ["-1", "101", "NaN", "Infinity", "not-a-number"]) {
            assert.equal(sliders.parseAbsoluteValue(testCase.id, invalidText), null,
                testCase.id + " must reject " + invalidText);
        }
    }

    assert.equal(sliders.setRuntimeRange("Exposure", -1, 1), true);
    assert.deepEqual(sliders.getEffectiveRange("Exposure"), { min: -1, max: 1 });
    assert.deepEqual(sliders.getAdmissionRange("Exposure"), { min: -1, max: 1 },
        "Normal Develop sliders must retain runtime-range admission");
    assert.equal(sliders.parseAbsoluteValue("Exposure", "2"), null);

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
        const port = bridge.getHttpServer().address().port;

        for (const testCase of hueCases) {
            drainQueue();
            const accepted = await getJson(
                port,
                "/set?slider=" + encodeURIComponent(testCase.id) + "&value=" + testCase.acceptedValue
            );
            assert.equal(accepted.statusCode, 200, testCase.id + " stale-range write must be accepted");
            assert.equal(accepted.body.ok, true);
            assert.deepEqual(commands.getNextCommand(), {
                command: "develop.set",
                slider: testCase.id,
                value: testCase.acceptedValue
            }, testCase.id + " stale-range write must enter the queue");
            if (testCase.id === "DefringePurpleHueLo") {
                assert.equal(sliders.setRuntimeRange(testCase.id, 0, 85), true);
                assert.deepEqual(sliders.getEffectiveRange(testCase.id), { min: 0, max: 85 },
                    "The later Lightroom range update must remain independent of prior admission");
                assert.deepEqual(sliders.getAdmissionRange(testCase.id), { min: 0, max: 100 });
            }

            for (const invalidText of ["-1", "101", "NaN", "Infinity", "not-a-number"]) {
                drainQueue();
                const rejected = await getJson(
                    port,
                    "/set?slider=" + encodeURIComponent(testCase.id) + "&value=" + encodeURIComponent(invalidText)
                );
                assert.equal(rejected.statusCode, 400, testCase.id + " must reject " + invalidText);
                assert.equal(commands.getNextCommand(), null);
            }
        }

        drainQueue();
        const normalRejected = await getJson(port, "/set?slider=Exposure&value=2");
        assert.equal(normalRejected.statusCode, 400,
            "Normal Develop sliders must still reject values outside their runtime range");
        assert.equal(commands.getNextCommand(), null);
        const normalAccepted = await getJson(port, "/set?slider=Exposure&value=1");
        assert.equal(normalAccepted.statusCode, 200);
        assert.deepEqual(commands.getNextCommand(), {
            command: "develop.set", slider: "Exposure", value: 1
        });
    } finally {
        console.log = originalLog;
        await bridge.stop();
        drainQueue();
    }

    console.log("Lens Corrections static-domain server admission tests passed.");
}

main().catch(function (err) {
    console.error(err);
    process.exitCode = 1;
});
