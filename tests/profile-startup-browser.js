"use strict";
const assert = require("node:assert/strict");
const browser = require("./controller-browser-lifecycle");

// Isolated HTTP/browser fixture. Never connects to Lightroom or the live bridge.
(async () => {
    const resources = { mock: browser.createMockControllerServer({ grainOnly: true }), browser: null,
        browserCdp: null, pageCdp: null, browserProfileDirectory: null };
    const writes = [], errors = [];
    let profileReads = 0;
    try {
        const port = await browser.listen(resources.mock.server);
        const base = "http://127.0.0.1:" + port;
        const categorical = await (await fetch(base + "/api/develop-categorical/state")).json();
        const profile = categorical.profile;
        profile.options[1].label = profile.selectedLabel = "Adobe Vivid";
        profile.validationGeneration = 4;
        profile.validationFailedGeneration = 5;
        const original = resources.mock.server.listeners("request")[0];
        resources.mock.server.removeListener("request", original);
        resources.mock.server.on("request", (req, res) => {
            const url = new URL(req.url, base);
            if (url.pathname === "/api/develop-categorical/state") {
                profileReads++;
                res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
                res.end(JSON.stringify(categorical));
            } else if (url.pathname === "/api/develop-categorical/profile") {
                writes.push(req.url);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, generation: 6, confirmationAfterRevision: profile.revision }));
            } else {
                if (/\/(?:command|reset|action)(?:\/|$)/.test(url.pathname)) writes.push(req.url);
                original(req, res);
            }
        });
        resources.browserProfileDirectory = browser.createBrowserProfileDirectory();
        resources.browser = browser.launchBrowser(browser.findBrowserExecutable(), resources.browserProfileDirectory);
        const dev = await browser.waitForDevTools(resources.browser, resources.browserProfileDirectory);
        resources.browserCdp = await browser.connectCdp(dev.browserWebSocketUrl);
        const targets = await (await fetch(dev.debugUrl + "/json/list")).json();
        const cdp = resources.pageCdp = await browser.connectCdp(targets.find(t => t.type === "page").webSocketDebuggerUrl);
        await cdp.send("Runtime.enable");
        await cdp.send("Page.enable");
        cdp.onEvent = m => { if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text); };
        async function run(expression) {
            const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
            if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
            return result.result.value;
        }
        async function wait(expression) {
            for (let i = 0; i < 100; i++) {
                if (await run(expression)) return;
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            throw Error("Timed out: " + expression);
        }
        const row = "document.querySelector('[data-develop-categorical=profile]')";
        async function open() {
            await cdp.send("Page.navigate", { url: base });
            await wait("typeof developSliderDefinitions !== 'undefined' && developSliderDefinitions.length > 0");
            await run("activeTab='sliders'; render();");
            await wait(row + "?.querySelector('select').selectedOptions[0]?.textContent === 'Adobe Vivid'");
            await run("requestDevelopCategoricalState()");
            await wait("!developCategoricalRequestInFlight");
        }
        await open();
        assert(profileReads >= 2);
        assert.deepEqual(writes, [], "startup must not select a Profile, reset the photo or run Auto");
        assert.equal(await run("profileModel.getPending()"), null);
        assert.equal(await run(row + ".querySelector('.develop-categorical-status').textContent"), "Adobe Vivid",
            "a previous server failure is not a failed startup read");
        assert.equal(await run("Object.hasOwn(developCategoricalErrors, 'profile')"), false);

        // A matching label still cannot confirm a newly requested Profile operation.
        await run(row + ".querySelector('select').dispatchEvent(new Event('change', {bubbles:true}))");
        await wait("profileModel.getPending()?.serverGeneration === 6");
        assert.equal(writes.length, 1);
        profile.revision++;
        await run("requestDevelopCategoricalState()");
        await wait("!developCategoricalRequestInFlight");
        assert.equal(await run("profileModel.getPending()?.serverGeneration"), 6,
            "matching Adobe Vivid display names are insufficient confirmation");
        profile.validationFailedGeneration = 6;
        profile.revision++;
        await run("requestDevelopCategoricalState()");
        await wait("Object.hasOwn(developCategoricalErrors, 'profile')");
        assert.match(await run(row + ".querySelector('.develop-categorical-status').textContent"),
            /previous Profile change failed validation.*profile name does not confirm/i,
            "the failure must identify an earlier operation, not describe a failed startup read");
        assert.equal(writes.length, 1, "failed validation cannot automatically retry the write");
        await open();
        assert.equal(await run("Object.hasOwn(developCategoricalErrors, 'profile')"), false);
        assert.equal(writes.length, 1, "reopening only reads the existing Adobe Vivid state");
        assert.deepEqual(errors, []);
        console.log("Profile startup: existing Adobe Vivid, retained server failure, zero automatic writes, strict operation confirmation and reload passed (mock browser).");
    } finally { await browser.cleanup(resources); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
