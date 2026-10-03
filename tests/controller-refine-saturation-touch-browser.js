"use strict";

// Native Chromium touch events against the production Point Curve controller.
// HTTP admissions and SDK snapshots are fixture data, never Lightroom writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const browser = require("./controller-browser-lifecycle");

const modulePath = process.env.LRBRIDGE_TONE_CURVE_SOURCE || path.join(__dirname, "../app/controller-tone-curve.js");
const productionHtml = fs.readFileSync(path.join(__dirname, "../app/controller.html"), "utf8");
const productionStyles = [...productionHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]).join("\n");
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function fixtureScript() {
    window.makeRefineFixture = async function (masked) {
        if (window.refineFixture) window.refineFixture.controller.deactivate();
        document.getElementById("fixture").replaceChildren();
        const linear = [0, 0, 255, 255];
        let time = 1000, sequence = 0;
        let snapshot = { available: true, selectedPhotoUuid: "refine-touch-photo-a", contextCounter: 4,
            developCounter: 7, revision: 1, updatedAt: time, name: "Custom",
            refineSaturation: { value: 50, min: 0, max: 100 },
            curves: Object.fromEntries(["rgb", "red", "green", "blue"].map(name => [name, linear.slice()])) };
        if (masked) Object.assign(snapshot, { serverEpoch: "refine-touch-fixture", maskingRevision: 1,
            contextChangedAt: 100, selectedMaskGroupId: "refine-touch-mask-a", editFeedbackSequence: 0,
            lastEditResult: null });
        const requests = [], events = [], statuses = [];
        const binding = value => ({ activeModule: "develop", ...value });
        const reply = body => ({ ok: true, status: 200, json: async () => body });
        const controller = LRBridgeToneCurve.createController({ document, window,
            contextAdapter: masked ? LRBridgeToneCurve.createMaskingContextAdapter() : undefined,
            now: () => time, setInterval: () => 1, clearInterval() {}, setStatus: message => statuses.push(message),
            fetch: async requestPath => {
                if (requestPath.endsWith("/state")) return reply({ ok: true, pointCurve: snapshot });
                const url = new URL(requestPath, location.origin);
                const request = { phase: url.pathname.split("/").at(-1), path: requestPath,
                    value: url.searchParams.has("value") ? Number(url.searchParams.get("value")) : null,
                    sequence: masked ? ++sequence : null };
                requests.push(request);
                return reply(masked ? { ok: true, editSequence: request.sequence } : { ok: true });
            }
        });
        document.getElementById("fixture").appendChild(controller.element);
        const range = controller.element.querySelector('input[aria-label="Refine Saturation"]');
        const number = controller.element.querySelector('input[aria-label="Edit Refine Saturation value"]');
        const reset = [...range.parentElement.querySelectorAll("button")].find(button => button.textContent === "Reset");
        for (const type of ["pointerdown", "pointerup", "pointercancel", "input", "change"]) {
            range.addEventListener(type, event => events.push({ type, pointerId: event.pointerId,
                disabled: range.disabled, value: range.value, owner: controller.getState().refineGestureActive }), true);
        }
        const publish = changes => {
            snapshot = { ...snapshot, ...changes };
            controller.applyContext(binding(snapshot));
            if (!controller.applyAuthoritative(snapshot)) throw Error("Fixture snapshot rejected");
        };
        const confirm = (value, request) => {
            const revision = snapshot.revision + 1;
            publish({ revision, updatedAt: ++time, refineSaturation: { value, min: 0, max: 100 },
                ...(masked ? { maskingRevision: revision, editFeedbackSequence: request.sequence,
                    lastEditResult: { sequence: request.sequence, kind: "masking.tone_curve.refine_saturation.gesture." + request.phase,
                        maskGroupId: snapshot.selectedMaskGroupId, outcome: "confirmed", detail: "" } } : {}) });
        };
        const idle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
        window.refineFixture = { masked, controller, range, number, reset, requests, events, statuses, publish, confirm,
            pending: async value => { number.dispatchEvent(new FocusEvent("focus")); number.value = String(value);
                number.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await idle(); },
            confirmLast: value => confirm(value, [...requests].reverse().find(request => request.phase !== "cancel")),
            navigate: value => publish({ selectedPhotoUuid: "refine-touch-photo-b", contextCounter: 5,
                developCounter: 8, revision: snapshot.revision + 1, updatedAt: ++time,
                refineSaturation: { value, min: 0, max: 100 },
                ...(masked ? { selectedMaskGroupId: "refine-touch-mask-b", contextChangedAt: 200,
                    maskingRevision: snapshot.maskingRevision + 1, lastEditResult: null } : {}) }),
            read: () => ({ disabled: range.matches(":disabled"), value: Number(range.value), number: Number(number.value),
                opacity: getComputedStyle(range).opacity, cursor: getComputedStyle(range).cursor,
                owner: controller.getState().refineGestureActive, awaiting: !!controller.getState().awaitingRefine,
                requests: requests.slice(), events: events.slice(), statuses: statuses.slice(),
                bounds: (() => { const b = range.getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height }; })() })
        };
        controller.activate(binding(snapshot));
        await idle();
        range.scrollIntoView({ block: "center" });
        return window.refineFixture.read();
    };
}

async function main() {
    const source = fs.readFileSync(modulePath, "utf8");
    const html = `<!doctype html><meta charset="utf-8"><title>Refine touch regression</title>
        <style>${productionStyles}\nbody{padding:20px}#fixture{width:620px;max-width:100%;margin:auto}
        .point-curve-graph-shell{max-width:270px}.point-curve-graph{max-height:270px}
        </style><main id="fixture"></main><script src="/curve.js"></script>
        <script>(${fixtureScript.toString()})();</script>`;
    const server = http.createServer((request, response) => {
        response.setHeader("Content-Type", request.url === "/curve.js" ? "application/javascript" : "text/html");
        response.end(request.url === "/curve.js" ? source : html);
    });
    const resources = { mock: { server }, browser: null, browserProfileDirectory: null, browserCdp: null, pageCdp: null };
    const errors = [], results = [];
    try {
        const base = "http://127.0.0.1:" + await browser.listen(server);
        resources.browserProfileDirectory = browser.createBrowserProfileDirectory();
        resources.browser = browser.launchBrowser(browser.findBrowserExecutable(), resources.browserProfileDirectory);
        const dev = await browser.waitForDevTools(resources.browser, resources.browserProfileDirectory);
        resources.browserCdp = await browser.connectCdp(dev.browserWebSocketUrl);
        const targets = await (await fetch(dev.debugUrl + "/json/list")).json();
        const cdp = resources.pageCdp = await browser.connectCdp(targets.find(target => target.type === "page").webSocketDebuggerUrl);
        await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
        await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
        cdp.onEvent = event => { if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails); };
        const run = async expression => {
            const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
            if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
            return result.result.value;
        };
        const wait = async expression => {
            const deadline = Date.now() + 6000;
            while (!await run(expression)) { if (Date.now() >= deadline) throw Error("Timed out: " + expression +
                "\n" + JSON.stringify(await run("refineFixture?.read()"))); await pause(15); }
        };
        const touch = (type, point) => cdp.send("Input.dispatchTouchEvent", {
            type, touchPoints: point ? [{ id: 0, x: point.x, y: point.y, radiusX: 2, radiusY: 2, force: 1 }] : []
        });
        const point = (bounds, value) => ({ x: bounds.left + 14 + (bounds.width - 28) * value / 100,
            y: bounds.top + bounds.height / 2 });
        await cdp.send("Page.navigate", { url: base });
        await wait("typeof makeRefineFixture==='function'");
        const modes = process.argv.includes("--masking-only") ? [true]
            : (process.argv.includes("--normal-only") ? [false] : [false, true]);
        for (const masked of modes) {
            const label = masked ? "Masking" : "normal";
            let state = await run(`makeRefineFixture(${masked})`);
            assert.equal(state.disabled, false);
            await run("refineFixture.pending(17)");
            await wait("refineFixture.read().awaiting");
            state = await run("refineFixture.read()");
            assert.equal(state.disabled, true);
            const count = state.requests.filter(request => request.phase !== "cancel").length;
            const cleanupCount = state.requests.filter(request => request.phase === "cancel").length;
            await touch("touchStart", point(state.bounds, 17));
            await run("refineFixture.confirmLast(17)");
            await touch("touchMove", point(state.bounds, 88));
            state = await run("refineFixture.read()");
            console.log(JSON.stringify({ case: label + " captured disabled touch", disabled: state.disabled,
                opacity: state.opacity, cursor: state.cursor,
                displayed: state.value, confirmed: state.number,
                newEditRequests: state.requests.filter(request => request.phase !== "cancel").length - count,
                terminalCleanupRequests: state.requests.filter(request => request.phase === "cancel").length - cleanupCount,
                pointerdownObserved: state.events.some(event => event.type === "pointerdown") }));
            assert.equal(state.disabled, true, label + ": confirmation must not enable the range under an ignored held touch");
            assert.equal(state.opacity, "0.5", label + ": the blocked contact must remain visibly dimmed");
            assert.equal(state.cursor, "not-allowed", label + ": the blocked contact must keep its disabled cursor");
            assert.equal(state.value, 17, label + ": the blocked touch must not silently move the thumb toward 88");
            assert.equal(state.requests.filter(request => request.phase !== "cancel").length, count,
                label + ": ignored touch must submit no edit; prior terminal cleanup is independent");
            assert(state.events.some(event => event.type === "pointerdown" && event.disabled), "native disabled pointerdown must be observed");
            // The contact finishes outside the slider. It must release the guard.
            await touch("touchMove", { x: state.bounds.left - 50, y: state.bounds.top - 30 });
            assert.equal((await run("refineFixture.read()")).disabled, true,
                label + ": moving outside while contact is held must not release the block");
            await touch("touchEnd");
            await wait("!refineFixture.read().disabled");
            state = await run("refineFixture.read()");
            assert.equal(state.opacity, "1", label + ": outside release restores the ordinary slider appearance");
            assert.notEqual(state.cursor, "not-allowed");

            // A subsequent real touch starts a registered gesture and delivers its
            // final intent with production update/end confirmation handling.
            state = await run("refineFixture.read()");
            const validStart = state.requests.length;
            await touch("touchStart", point(state.bounds, 17));
            await touch("touchMove", point(state.bounds, 64));
            await wait("refineFixture.requests.slice(" + validStart + ").some(request=>request.phase==='update')");
            state = await run("refineFixture.read()");
            assert.equal(state.owner, true, label + ": new drag must own its browser input");
            const update = state.requests.slice(validStart).find(request => request.phase === "update");
            await run("refineFixture.confirmLast(" + update.value + ")");
            await touch("touchEnd");
            await wait("refineFixture.requests.slice(" + validStart + ").some(request=>request.phase==='end')");
            state = await run("refineFixture.read()");
            const end = state.requests.slice(validStart).find(request => request.phase === "end");
            await run("refineFixture.confirmLast(" + end.value + ")");
            await wait("!refineFixture.read().awaiting&&!refineFixture.read().disabled");
            assert.equal((await run("refineFixture.read()")).value, end.value);
            assert(state.requests.slice(validStart).some(request => request.phase === "begin"));

            // Pointer cancellation also releases a rejected contact without edits.
            await run("refineFixture.pending(23)"); await wait("refineFixture.read().awaiting");
            state = await run("refineFixture.read()");
            await touch("touchStart", point(state.bounds, 23));
            await run("refineFixture.confirmLast(23)");
            await touch("touchCancel");
            await wait("!refineFixture.read().disabled");
            assert.equal((await run("refineFixture.read()")).value, 23);

            // A real photo/mask change must not let the old held contact edit the
            // new authority. Releasing it must restore that context's availability.
            await run("refineFixture.pending(41)"); await wait("refineFixture.read().awaiting");
            state = await run("refineFixture.read()");
            await touch("touchStart", point(state.bounds, 41));
            await run("refineFixture.navigate(62)");
            await touch("touchMove", point(state.bounds, 88));
            state = await run("refineFixture.read()");
            assert.equal(state.disabled, true, label + ": old held contact remains blocked across actual navigation");
            assert.equal(state.value, 62);
            await touch("touchCancel");
            await wait("!refineFixture.read().disabled");

            // Refine Reset keeps its SDK-confirmed default, which is 100 here.
            await run("refineFixture.reset.click()");
            await wait("refineFixture.controller.getState().awaitingRefineReset!==null");
            await run("refineFixture.confirmLast(100)");
            await wait("refineFixture.controller.getState().awaitingRefineReset===null");
            state = await run("refineFixture.read()");
            assert.equal(state.value, 100); assert.equal(state.number, 100); assert.equal(state.disabled, false);
            results.push({ mode: label, blockedValue: 17, validFinal: end.value, outsideRelease: true,
                nativeCancellation: true, actualNavigation: true, confirmedReset: 100 });
        }
        assert.deepEqual(errors, [], "isolated fixture browser errors");
        assert.deepEqual(cdp.protocolErrors, [], "isolated fixture CDP errors");
        console.log(JSON.stringify({ ok: true, nativeChromiumTouch: true, syntheticHttpAndSdk: true,
            source: path.resolve(modulePath), cases: results }, null, 2));
    } finally { await browser.cleanup(resources); }
}

main().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
