"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const source = fs.readFileSync(path.join(__dirname, "../app/controller-request-id.js"), "utf8");
function load(crypto) {
    const sandbox = { crypto };
    vm.runInNewContext(source, sandbox);
    return sandbox.LRBridgeRequestId.createRequestId;
}
const expected = "00112233-4455-4677-8899-aabbccddeeff";
const native = { randomUUID() { assert.equal(this, native); return expected; },
    getRandomValues() { throw Error("Native randomUUID should take precedence"); } };
assert.equal(load(native)(), expected);
let calls = 0;
const fallback = { getRandomValues(bytes) {
    assert.equal(this, fallback); assert.equal(bytes.length, 16); calls++;
    bytes.set(Buffer.from("00112233445566778899aabbccddeeff", "hex"));
    return bytes;
} };
const generated = load(fallback)();
assert.equal(generated, "00112233-4455-4677-8899-aabbccddeeff", "Only the UUID version and variant bits may be fixed");
assert.equal(calls, 1);
// Exercise real secure entropy too; this cannot fall back to Math.random.
const secure = load({ getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
const ids = Array.from({ length: 512 }, secure);
assert.equal(new Set(ids).size, ids.length);
assert(ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)));
assert.doesNotMatch(source, /Math\.random/);
for (const missing of [undefined, null, {}]) assert.throws(load(missing), /Secure request ID/);
assert.throws(load({ getRandomValues() { throw Error("entropy failed"); } }), /entropy failed/);
assert.throws(load({ randomUUID() { throw Error("UUID failed"); } }), /UUID failed/);
for (const family of ["export", "clipboard"]) {
    const definition = require("../server/" + family + "-state");
    const command = { command: family === "export" ? "export.dialog" : "clipboard.copy", requestId: generated,
        expectedServerEpoch: "test", expectedActiveModule: "develop", expectedSelectedPhotoUuid: "test-photo",
        expectedContextCounter: 1, expectedDevelopCounter: 2, expectedContextChangedAt: 3,
        operationId: family === "export" ? "ex-1" : "cb-1", expectedSelectionToken: "test-selection" };
    if (family === "clipboard") command.updateAISettings = false;
    assert.equal(definition.validCommand(command), true, family + " server accepts the fallback ID");
}
console.log("PASS secure UUID preference/fallback, 122 random bits, receiver binding, failure propagation and unchanged server ID validation.");
