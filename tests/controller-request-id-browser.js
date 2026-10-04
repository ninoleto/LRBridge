"use strict";

// Real Chromium + shipped Controller scripts on loopback and insecure LAN HTTP.
// API receipts are synthetic: these checks do not establish Lightroom execution.
const assert = require("node:assert/strict");
const os = require("node:os");
const browser = require("./controller-browser-lifecycle");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const actions = [
    { command: "export.dialog", selector: '[data-export-action="export.dialog"]', status: ".export-status", owner: "exportController" },
    { command: "export.previous", selector: '[data-export-action="export.previous"]', status: ".export-status", owner: "exportController" },
    { command: "clipboard.copy", selector: "#copySettingsButton", status: "#clipboardStatus", owner: "clipboardController" },
    { command: "clipboard.paste", selector: "#pasteSettingsButton", status: "#clipboardStatus", owner: "clipboardController" }
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

(async function () {
    const lan = process.env.LRBRIDGE_TEST_LAN_IP || Object.values(os.networkInterfaces()).flat()
        .find(n => n.family === "IPv4" && !n.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address))?.address;
    assert(lan, "Set LRBRIDGE_TEST_LAN_IP to this computer's LAN IPv4 address; an insecure origin is required");
    const resources = { mock: browser.createMockControllerServer({ grainOnly: true, clipboardOnly: true,
        appRoot: process.env.LRBRIDGE_REQUEST_ID_APP_ROOT }), browser: null, browserCdp: null, pageCdp: null, browserProfileDirectory: null };
    const fixture = resources.mock.grainFixture;
    const errors = [], missing = [], receipts = [];
    try {
        await new Promise((resolve, reject) => {
            resources.mock.server.once("error", reject);
            resources.mock.server.listen(0, "0.0.0.0", resolve);
        });
        const port = resources.mock.server.address().port;
        resources.browserProfileDirectory = browser.createBrowserProfileDirectory();
        resources.browser = browser.launchBrowser(browser.findBrowserExecutable(), resources.browserProfileDirectory);
        const dev = await browser.waitForDevTools(resources.browser, resources.browserProfileDirectory);
        resources.browserCdp = await browser.connectCdp(dev.browserWebSocketUrl);
        const target = (await (await fetch(dev.debugUrl + "/json/list")).json()).find(t => t.type === "page");
        const cdp = resources.pageCdp = await browser.connectCdp(target.webSocketDebuggerUrl);
        cdp.onEvent = event => { if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails); };
        await cdp.send("Runtime.enable");
        await cdp.send("Page.enable");
        await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `
            window.requestIdProbe = { uuid: 0, bytes: 0, fail: false, nativeUUID: typeof crypto.randomUUID };
            const originalBytes = crypto.getRandomValues;
            crypto.getRandomValues = function(array) {
                requestIdProbe.bytes++;
                if (requestIdProbe.fail) throw Error('Synthetic secure entropy failure');
                return originalBytes.call(this, array);
            };
            if (typeof crypto.randomUUID === 'function') {
                const originalUUID = crypto.randomUUID;
                crypto.randomUUID = function() { requestIdProbe.uuid++; return originalUUID.call(this); };
            }
        ` });
        const evaluate = async expression => {
            const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
            if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
            return result.result.value;
        };
        const waitFor = async (expression, label) => {
            const deadline = Date.now() + 7000;
            while (!await evaluate(expression)) {
                if (Date.now() > deadline) throw Error("Timed out: " + (label || expression));
                await pause(30);
            }
        };
        const calls = () => resources.mock.requestLog.filter(r => /\/api\/(export|clipboard)\/action$/.test(r.path));
        const node = selector => "document.querySelector(" + JSON.stringify(selector) + ")";
        const ready = action => waitFor(action.owner + ".actionAvailable(" + JSON.stringify(action.command) + ")", action.command + " ready");
        for (const host of ["127.0.0.1", lan]) {
            await cdp.send("Page.navigate", { url: "http://" + host + ":" + port + "/" });
            await waitFor("!!document.querySelector('[data-tab=selection]')");
            await evaluate("document.querySelector('[data-tab=selection]').click()");
            await ready(actions[0]);
            const secure = host === "127.0.0.1";
            const origin = await evaluate("({origin:location.origin,secure:isSecureContext,randomUUID:requestIdProbe.nativeUUID})");
            assert.equal(origin.secure, secure);
            assert.equal(origin.randomUUID, secure ? "function" : "undefined", "Use actual browser security policy, not a mocked missing API");
            for (const action of actions) {
                await ready(action);
                const before = calls().length;
                await evaluate(node(action.selector) + ".click()");
                await pause(1000);
                const submitted = calls().slice(before);
                if (submitted.length !== 1) { missing.push({ origin, command: action.command, dispatches: submitted.length }); continue; }
                const request = submitted[0], params = new URLSearchParams(request.search);
                assert.equal(params.get("command"), action.command);
                assert.match(params.get("requestId"), uuid);
                assert.equal(params.get("selectedPhotoUuid"), fixture.context.selectedPhotoUuid);
                assert.equal(params.get("contextCounter"), String(fixture.context.contextCounter));
                assert.equal(params.get("developCounter"), String(fixture.context.developCounter));
                receipts.push({ origin: origin.origin, command: action.command, path: request.path, requestId: params.get("requestId") });
                await ready(action);
            }
            const probe = await evaluate("requestIdProbe");
            console.log(JSON.stringify({ ...origin, probe, actions: receipts.filter(r => r.origin === origin.origin) }));
            if (!missing.length) {
                assert.equal(probe.uuid, secure ? 4 : 0);
                assert.equal(probe.bytes, secure ? 0 : 4);
            }
        }
        assert.deepEqual(missing, [], "Every enabled action must dispatch once without randomUUID on LAN HTTP");
        assert.equal(new Set(receipts.map(r => r.requestId)).size, 8);

        // Failure before dispatch stays visible across polling, even with an old success receipt.
        await evaluate("requestIdProbe.fail = true");
        for (const action of actions) {
            await ready(action);
            const before = calls().length;
            await evaluate(node(action.selector) + ".click()");
            await pause(1000);
            assert.equal(calls().length, before, "Entropy failure must not dispatch or retry");
            assert.match(await evaluate(node(action.status) + ".textContent"), /command was not sent/i);
            const result = await evaluate(action.owner + ".getFeedback()");
            assert.equal(result.kind, "error");
            assert.equal(result.short, "Not sent");
            assert.equal(result.busy, false);
            assert.equal(result.needsReview, false, "No ambiguous request was made");
        }
        await evaluate("requestIdProbe.fail = false");
        const before = calls().length;
        await pause(1000);
        assert.equal(calls().length, before, "Restored entropy does not retry a command");
        await evaluate(node(actions[0].selector) + ".click()");
        await pause(1000);
        assert.equal(calls().length, before + 1, "A new explicit tap can dispatch after recovery");
        // Existing injected request IDs must bypass the helper, even when entropy fails.
        await ready(actions[0]);
        await evaluate("requestIdProbe.fail = true");
        for (const family of ["Export", "Clipboard"]) {
            const command = family === "Export" ? "export.dialog" : "clipboard.copy";
            const expectedId = "override-" + family.toLowerCase();
            await evaluate(`window.overrideController = LRBridgeController${family}.createController({document,
                fetch: window.fetch.bind(window), getContext: () => (${JSON.stringify(fixture.context)}),
                requestId: () => ${JSON.stringify(expectedId)} });
                ${family === "Export" ? "overrideController.activate(document.createElement('div'))" : "overrideController.initialize()"}`);
            await waitFor("overrideController.actionAvailable(" + JSON.stringify(command) + ")");
            const previousCalls = calls().length;
            await evaluate("overrideController.runAction(" + JSON.stringify(command) + ")");
            await pause(1000);
            assert.equal(calls().length, previousCalls + 1);
            assert.equal(new URLSearchParams(calls().at(-1).search).get("requestId"), expectedId);
            await evaluate("overrideController.deactivate()");
        }
        assert.deepEqual(errors, []);
        console.log("PASS all four actions: localhost native UUID, insecure LAN fallback, unique IDs, one /api dispatch each, visible not-sent errors, no retries. Browser/mock-API evidence only; native Lightroom remains untested.");
    } finally {
        if (missing.length) console.log(JSON.stringify({ missing, browserErrors: errors.map(e => e.exception?.description || e.text) }));
        await browser.cleanup(resources);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
