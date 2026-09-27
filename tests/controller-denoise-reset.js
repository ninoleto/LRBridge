"use strict";

const assert = require("node:assert/strict");
const browser = require("./controller-browser-lifecycle");
const { DEFAULT_AMOUNT } = require("../app/controller-denoise-state");

async function main() {
    const mock = browser.createMockControllerServer({});
    const baseHandler = mock.server.listeners("request")[0];
    const initial = {
        available: true, denoiseState: true, denoiseEnabled: true, denoiseAmount: 73,
        rawDetailsState: true, rawDetailsEnabled: false, superResState: false,
        superResEnabled: false, enhanceNeedsUpdate: false, operation: "ready"
    };
    let state = Object.assign({}, initial, { available: false, denoiseAmount: null });
    let rejectNext = false;
    const amountRequests = [], unexpected = [], errors = [];
    mock.server.removeListener("request", baseHandler);
    mock.server.on("request", (request, response) => {
        const url = new URL(request.url, "http://fixture");
        if (!url.pathname.startsWith("/api/enhance/")) return baseHandler(request, response);
        response.setHeader("Content-Type", "application/json");
        if (url.pathname === "/api/enhance/state") return response.end(JSON.stringify(state));
        if (url.pathname === "/api/enhance/denoise/amount") {
            amountRequests.push(request.url);
            if (rejectNext) {
                rejectNext = false;
                response.writeHead(503);
                return response.end(JSON.stringify({ ok: false, error: "fixture unavailable" }));
            }
            state = Object.assign({}, state, { amountOperation: "processing", requestedAmount: Number(url.searchParams.get("amount")) });
            return response.end(JSON.stringify({ ok: true, queued: { command: "enhance.denoise.amount.set", amount: state.requestedAmount } }));
        }
        unexpected.push(request.url);
        response.writeHead(400);
        response.end(JSON.stringify({ ok: false }));
    });
    const resources = { mock, browser: null, browserCdp: null, pageCdp: null, browserProfileDirectory: null };
    try {
        const port = await browser.listen(mock.server);
        resources.browserProfileDirectory = browser.createBrowserProfileDirectory();
        resources.browser = browser.launchBrowser(browser.findBrowserExecutable(), resources.browserProfileDirectory);
        const dev = await browser.waitForDevTools(resources.browser, resources.browserProfileDirectory);
        resources.browserCdp = await browser.connectCdp(dev.browserWebSocketUrl);
        const targets = await (await fetch(dev.debugUrl + "/json/list")).json();
        const cdp = resources.pageCdp = await browser.connectCdp(targets.find(t => t.type === "page").webSocketDebuggerUrl);
        await cdp.send("Runtime.enable");
        await cdp.send("Page.enable");
        cdp.onEvent = message => { if (message.method === "Runtime.exceptionThrown") errors.push(message.params); };
        async function evaluate(expression) {
            const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
            if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
            return result.result.value;
        }
        async function waitFor(expression) {
            for (let n = 0; n < 100; n++) {
                if (await evaluate(expression)) return;
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            throw Error("Timed out: " + expression);
        }
        const reset = 'document.querySelector(".denoise-reset")';
        const value = 'document.querySelector("[aria-label=\\"Denoise amount value\\"]").value';
        async function feedback(overrides) {
            state = Object.assign({}, initial, overrides);
            await evaluate("requestEnhanceState()");
            await waitFor("enhanceState && enhanceState.denoiseAmount === " + JSON.stringify(state.denoiseAmount) +
                " && enhanceState.available === " + state.available + " && enhanceState.denoiseState === " + state.denoiseState +
                " && enhanceState.operation === " + JSON.stringify(state.operation) +
                " && enhanceState.amountOperation === " + (state.amountOperation ? JSON.stringify(state.amountOperation) : "undefined"));
        }
        await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + port + "/#sliders" });
        await waitFor(reset + ' && lastControllerActiveModule === "develop"');
        assert.equal(await evaluate(reset + ".disabled"), true, "Reset must be unavailable before Lightroom values arrive");
        if (process.argv.includes("--availability-only")) {
            const controls = () => evaluate(`(()=>({
                amount:[enhanceAmountRange,enhanceAmountInput,enhanceMinusButton,enhancePlusButton].map(input=>input.disabled),
                value:enhanceAmountInput.value,reset:enhanceResetButton.disabled,
                checkbox:{checked:enhanceCheckbox.checked,disabled:enhanceCheckbox.disabled},
                related:[rawDetailsCheckbox,superResolutionCheckbox].map(input=>({checked:input.checked,disabled:input.disabled}))
            }))()`);
            assert.deepEqual((await controls()).amount, [true,true,true,true], "Loading must disable all Amount controls");
            for (const scenario of [
                { name:"on at 50", state:{}, disabled:false, checkbox:false },
                { name:"off but switch available", state:{denoiseState:false}, disabled:true, checkbox:false },
                { name:"off and switch unavailable", state:{denoiseState:false,denoiseEnabled:false}, disabled:true, checkbox:true },
                { name:"on again at 50", state:{}, disabled:false, checkbox:false },
                { name:"unavailable", state:{available:false}, disabled:true, checkbox:true },
                { name:"unknown Denoise state", state:{denoiseState:null}, disabled:true, checkbox:true },
                { name:"confirmed recovery", state:{}, disabled:false, checkbox:false },
                { name:"starting Enhance", state:{operation:"starting"}, disabled:true, checkbox:true },
                { name:"processing Enhance", state:{operation:"processing"}, disabled:true, checkbox:true },
                { name:"starting Amount", state:{amountOperation:"starting",requestedAmount:80}, disabled:false, checkbox:true },
                { name:"processing Amount", state:{amountOperation:"processing",requestedAmount:80}, disabled:false, checkbox:true },
                { name:"already on with Apply unavailable", state:{denoiseEnabled:false}, disabled:false, checkbox:false },
                { name:"ready again", state:{}, disabled:false, checkbox:false }
            ]) {
                await feedback({ denoiseAmount:DEFAULT_AMOUNT, ...scenario.state });
                const current = await controls();
                assert.deepEqual(current.amount, Array(4).fill(scenario.disabled), scenario.name);
                assert.equal(current.value, String(DEFAULT_AMOUNT), scenario.name+": preserve displayed Amount");
                assert.equal(current.reset, true, scenario.name+": Reset stays disabled at 50");
                assert.equal(current.checkbox.disabled, scenario.checkbox, scenario.name+": independent checkbox availability");
                assert.deepEqual(current.related, [{checked:scenario.state.available !== false,disabled:true},{checked:false,disabled:true}],
                    scenario.name+": Raw Details and Super Resolution unchanged");
                if (scenario.disabled) await evaluate("enhanceMinusButton.click();enhancePlusButton.click()");
            }
            assert.deepEqual(amountRequests, [], "Availability feedback and disabled buttons must send nothing");

            // Start a separate Amount-73 fixture for the existing Reset confirmation guard.
            await evaluate("enhanceAmountModel.reset()");
            await feedback({});
            await evaluate(reset+".click()");
            await waitFor("enhanceAmountModel.waitingForFeedback && enhanceState.amountOperation === 'processing'");
            assert.deepEqual((await controls()).amount, [true,true,true,true], "Reset confirmation blocks all Amount controls");
            assert.equal((await controls()).value, "73", "Reset preserves displayed Amount until confirmation");
            await feedback({ denoiseAmount:DEFAULT_AMOUNT, amountOperation:"applied", requestedAmount:DEFAULT_AMOUNT });
            assert.deepEqual((await controls()).amount, [false,false,false,false], "Confirmed Reset to 50 leaves Amount adjustable");
            assert.equal((await controls()).reset, true);
            assert.deepEqual(amountRequests, ["/api/enhance/denoise/amount?amount="+DEFAULT_AMOUNT]);
            assert.deepEqual(unexpected, []); assert.deepEqual(mock.unexpectedRequests, []); assert.deepEqual(errors, []);
            console.log("Denoise Amount availability passed: off/on/unknown/unavailable recovery, independent checkbox, Amount 50, existing pending and Reset guards, unchanged Raw Details/Super Resolution. Mock Lightroom only.");
            return;
        }
        await feedback({});
        await waitFor("!" + reset + ".disabled");
        await evaluate(reset + ".click();" + reset + ".click();");
        await waitFor("enhanceAmountModel.inFlight && enhanceState.amountOperation === 'processing'");
        assert.deepEqual(amountRequests, ["/api/enhance/denoise/amount?amount=" + DEFAULT_AMOUNT]);
        assert.equal(await evaluate(value), "73", "HTTP acceptance must not replace Lightroom's displayed value");
        assert.equal(await evaluate(reset + ".disabled"), true);
        assert.equal(await evaluate('document.querySelector("[aria-label=\\"Denoise amount\\"]").disabled'), true);
        await feedback({ denoiseAmount: DEFAULT_AMOUNT, amountOperation: "applied", requestedAmount: DEFAULT_AMOUNT });
        await waitFor("!enhanceAmountModel.inFlight");
        assert.equal(await evaluate(value), String(DEFAULT_AMOUNT));
        assert.equal(await evaluate(reset + ".disabled"), true, "No reset is needed at the default");
        assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("[data-detail-control=raw-details] input, [data-detail-control=super-resolution] input")).map(input=>({checked:input.checked,disabled:input.disabled}))'),
            [{ checked: true, disabled: true }, { checked: false, disabled: true }], "Amount Reset must preserve Raw Details and Super Resolution");

        for (const outcome of ["failed", "uncertain", "rejected"]) {
            await feedback({});
            await waitFor("!" + reset + ".disabled");
            const count = amountRequests.length;
            rejectNext = outcome === "rejected";
            await evaluate(reset + ".click()");
            if (outcome !== "rejected") {
                await waitFor("enhanceAmountModel.inFlight && enhanceState.amountOperation === 'processing'");
                await feedback({ denoiseAmount: 68, amountOperation: outcome, requestedAmount: DEFAULT_AMOUNT });
            }
            await waitFor("!enhanceAmountModel.inFlight && !enhanceAmountModel.waitingForFeedback");
            assert.equal(await evaluate(value), outcome === "rejected" ? "73" : "68");
            await evaluate("requestEnhanceState()");
            assert.equal(amountRequests.length, count + 1, outcome + ": no automatic retry");
            assert.equal(await evaluate("enhanceAmountModel.desired"), null);
        }
        const count = amountRequests.length;
        for (const unavailable of [
            { available: false }, { denoiseState: false }, { denoiseAmount: null },
            { operation: "processing" }, { amountOperation: "processing", requestedAmount: 80 }
        ]) {
            await feedback(unavailable);
            assert.equal(await evaluate(reset + ".disabled"), true, JSON.stringify(unavailable));
            await evaluate(reset + ".click()");
        }
        assert.equal(amountRequests.length, count, "Unavailable controls must send nothing");
        await feedback({ denoiseEnabled: false });
        await waitFor("!" + reset + ".disabled");
        assert.equal(await evaluate(value), "73", "Checkbox availability is separate from an already-on Amount");

        for (const width of [1280, 390, 320]) {
            // Test the controller's responsive CSS at explicit window widths.
            // Its existing page has no mobile viewport meta tag.
            await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
            const layout = await evaluate(`(()=>{
                const button=document.querySelector(".denoise-reset"),row=button.closest(".denoise-slider-row"),other=document.querySelector(".develop-slider-row:not(.denoise-slider-row) .reset");
                const rect=button.getBoundingClientRect(),parent=row.getBoundingClientRect(),style=getComputedStyle(button),reference=getComputedStyle(other);
                return {width:innerWidth,scroll:document.documentElement.scrollWidth,visible:rect.width>0&&rect.height>0,
                    afterPlus:button.previousElementSibling.classList.contains("denoise-plus"),
                    fits:rect.left>=parent.left&&rect.right<=parent.right&&rect.right<=innerWidth,
                    style:[style.backgroundColor,style.color,style.borderRadius],reference:[reference.backgroundColor,reference.color,reference.borderRadius]};
            })()`);
            assert(layout.visible && layout.afterPlus && layout.fits, JSON.stringify({ width, layout }));
            assert.deepEqual(layout.style, layout.reference, "Reset must use the standard slider button appearance");
            assert.equal(layout.width, width);
            assert(layout.scroll <= width + 1, "Denoise row must not cause horizontal overflow at " + width);
        }
        assert.deepEqual(unexpected, []);
        assert.deepEqual(mock.unexpectedRequests, []);
        assert.deepEqual(errors, []);
        console.log("Denoise Amount Reset browser checks passed: amount-only request, confirmed feedback, duplicate/pending/failure/unavailable cases, preserved Raw Details/Super Resolution and 1280/390/320px CSS viewport layout. Mock Lightroom only.");
    } finally { await browser.cleanup(resources); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
