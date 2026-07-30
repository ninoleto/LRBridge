const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createBridge } = require("../server/bridge");
const colorGrading = require("../server/color-grading");
const ui = require("../app/controller-color-grading");

const root = path.join(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const html = read("app/controller.html");
const browser = read("app/controller-color-grading.js");
const main = read("app/main.js");

assert.equal((html.match(/<nav class="tabs"/g) || []).length, 1, "Controller must render exactly one tab navigation row");
assert.doesNotMatch(html, /data-workspace|workspace-tabs|workspace-tab-button|developWorkspace/);
assert.match(html, /id="colorGradingWorkspace"/);
assert.match(html, /const controllerTabStorageKey = "lrbridge\.controller\.activeTab"/);
assert.match(html, /const controllerTabIds = \["sliders", "color-grading", "selection", "crop", "application", "healing", "redEye", "masking"\]/);
const tabIds = JSON.parse(html.match(/const controllerTabIds = (\[[^;]+\]);/)[1]);
assert.deepEqual(tabIds, ["sliders", "color-grading", "selection", "crop", "application", "healing", "redEye", "masking"]);
const expectedTabLabels = ["Develop Sliders", "Color Grading", "Selection", "Crop", "Application", "Healing", "Red Eye", "Masking"];
const tabLabels = { sliders: "Develop Sliders", "color-grading": "Color Grading", selection: "Selection", crop: "Crop", application: "Application", healing: "Healing", redEye: "Red Eye", masking: "Masking" };
assert.deepEqual(tabIds.map(id => tabLabels[id]), expectedTabLabels, "Flattened controller tab order drifted");
assert.match(html, /id: "sliders",\s*label: "Develop Sliders"\s*},\s*{\s*id: "color-grading",\s*label: "Color Grading"/);
assert.match(html, /window\.addEventListener\("hashchange"/);
assert.match(html, /hash === "develop" \? "sliders"/);
assert.match(html, /if \(colorGradingActive\) \{\s*deactivateDevelopFeedbackPolling\(\);\s*colorGradingController\.activate\(\);\s*return;/);
assert.match(html, /colorGradingController\.deactivate\(\);[\s\S]*if \(activeTab !== "sliders"\) deactivateDevelopFeedbackPolling\(\);/);
assert.match(html, /if \(activeTab === "sliders"\) \{\s*renderSlidersTab\(\);\s*activateDevelopFeedbackPolling\(\);/);
assert.match(html, /if \(!genericFeedbackActive \|\| activeTab !== "sliders"\) return;/);
assert.doesNotMatch(browser, /setWorkspace|data\.workspace|TAB_STORAGE_KEY/);

assert.match(browser, /fetchFn\("\/api\/color-grading\/metadata"/);
assert.match(main, /requestUrl\.pathname === "\/api\/color-grading\/metadata"/);
assert.match(main, /requestUrl\.pathname === "\/api\/color-grading\/request"/);
assert.match(main, /requestUrl\.pathname === "\/api\/color-grading\/snapshot"/);
assert.doesNotMatch(browser, /color-grading\.properties/);
for (const parameter of colorGrading.getParameterIds()) {
    assert.ok(!browser.includes(parameter), "Browser duplicated Adobe parameter ID: " + parameter);
    assert.ok(!html.includes(parameter), "Controller HTML duplicated Adobe parameter ID: " + parameter);
}

assert.match(browser, /Object\.keys\(state\.metadata\.regions\)/);
assert.match(browser, /state\.metadata\.views\.forEach/);
assert.match(browser, /createScalar\("blending"/);
assert.match(browser, /createScalar\("balance"/);
assert.match(browser, /shadow_luminance/);
assert.match(browser, /midtone_luminance/);
assert.match(browser, /highlight_luminance/);
assert.match(browser, /global_luminance/);
assert.match(browser, /Reset Region/);
assert.doesNotMatch(browser + html, /Reset All Color Grading/i);
assert.match(browser, /color_grading\.region\.reset/);
assert.match(browser, /color_grading\.value\.reset/);
assert.match(browser, /color_grading\.view\.set/);
assert.match(browser, /color_grading\.wheel\.set/);

const wheelPath = ui.commandPath("color_grading.wheel.set", { region: "midtones", hue: 35, saturation: 30 });
assert.equal(wheelPath, "/api/command?command=color_grading.wheel.set&region=midtones&hue=35&saturation=30");
assert.match(wheelPath, /hue=35/);
assert.match(wheelPath, /saturation=30/);
assert.equal(ui.commandPath("color_grading.value.set", { control: "balance", value: -30 }), "/api/command?command=color_grading.value.set&control=balance&value=-30");
assert.equal(ui.commandPath("color_grading.region.reset", { region: "shadows" }), "/api/command?command=color_grading.region.reset&region=shadows");
assert.equal(ui.commandPath("color_grading.view.set", { view: "3-way" }), "/api/command?command=color_grading.view.set&view=3-way");
assert.equal(ui.normalizeNumber("12,5"), 12.5);
assert.equal(ui.normalizeNumber("bad"), null);
assert.equal(ui.clamp(120, { min: 0, max: 100 }), 100);
{
    let textWrites = 0;
    let stateWrites = 0;
    let text = "Connected";
    let state = "connected";
    const element = {
        get textContent() { return text; },
        set textContent(value) { textWrites += 1; text = value; },
        dataset: {
            get state() { return state; },
            set state(value) { stateWrites += 1; state = value; }
        }
    };
    assert.equal(ui.updateStatusElement(element, "Connected", "connected"), false);
    assert.deepEqual([textWrites, stateWrites], [0, 0], "Stable Connected status must not rewrite the DOM");
    assert.equal(ui.updateStatusElement(element, "Waiting for Lightroom", "warning"), true);
    assert.deepEqual([textWrites, stateWrites], [1, 1]);
    assert.equal(ui.updateStatusElement(element, "Connected", "connected"), true, "Recovery must restore Connected");
}
const rect = { left: 0, top: 0, width: 200, height: 200 };
assert.deepEqual(ui.wheelPoint(100, 0, rect, { min: 0, max: 360 }, { min: 0, max: 100 }), { hue: 90, saturation: 100 });
assert.deepEqual(ui.wheelPoint(200, 100, rect, { min: 0, max: 360 }, { min: 0, max: 100 }), { hue: 0, saturation: 100 });
assert.deepEqual(ui.wheelPoint(100, 200, rect, { min: 0, max: 360 }, { min: 0, max: 100 }), { hue: 270, saturation: 100 });
assert.deepEqual(ui.wheelPoint(0, 100, rect, { min: 0, max: 360 }, { min: 0, max: 100 }), { hue: 180, saturation: 100 });
assert.match(html, /conic-gradient\(from 90deg, #f00, #f0f, #00f, #0ff, #0f0, #ff0, #f00\)/);
assert.match(browser, /const angle = Math\.PI \/ 2 - hueFraction \* Math\.PI \* 2/);
assert.match(browser, /const hueDegrees = \(90 - physicalDegrees \+ 360\) % 360/);

function fakeTimers() {
    let nextId = 1;
    const pending = new Map();
    return {
        setTimeout(fn) { const id = nextId++; pending.set(id, fn); return id; },
        clearTimeout(id) { pending.delete(id); },
        flush() { const callbacks = Array.from(pending.values()); pending.clear(); callbacks.forEach(fn => fn()); },
        size() { return pending.size; }
    };
}

{
    const timers = fakeTimers();
    const sent = [];
    const dispatcher = ui.createScalarDispatcher({ delay: 125, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, send: value => sent.push(value) });
    dispatcher.rebase(50);
    dispatcher.schedule(65); // input
    assert.equal(timers.size(), 1);
    dispatcher.finalize(65); // pointerup
    dispatcher.finalize(65); // change
    timers.flush();
    assert.deepEqual(sent, [65], "input -> pointerup -> change must send one final scalar value");
}
{
    const timers = fakeTimers();
    const sent = [];
    const dispatcher = ui.createScalarDispatcher({ delay: 125, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, send: value => sent.push(value) });
    dispatcher.rebase(0);
    dispatcher.schedule(10);
    dispatcher.schedule(15);
    dispatcher.finalize(20);
    timers.flush();
    assert.deepEqual(sent, [20], "Final release must cancel throttle and immediately send the newest value once");
}
{
    const timers = fakeTimers();
    const sent = [];
    const dispatcher = ui.createScalarDispatcher({ delay: 125, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, send: value => sent.push(value) });
    dispatcher.rebase(0);
    dispatcher.finalize(15); // Enter
    dispatcher.finalize(15); // blur
    assert.deepEqual(sent, [15], "Enter followed by blur must not duplicate a numeric scalar command");
    dispatcher.resetContext();
    dispatcher.finalize(15);
    assert.deepEqual(sent, [15, 15], "The same value must be sendable after a context reset");
}

{
    const controllers = [];
    const gate = ui.createCycleGate(function () {
        const controller = { signal: { aborted: false }, abort() { this.signal.aborted = true; } };
        controllers.push(controller);
        return controller;
    });
    const first = gate.begin();
    const second = gate.begin();
    assert.equal(first.controller.signal.aborted, true, "Starting a replacement cycle must abort the old cycle");
    assert.equal(gate.isCurrent(first), false, "An aborted cycle must be stale");
    assert.equal(gate.isCurrent(second), true);
    gate.cancel(); // leave tab
    assert.equal(second.controller.signal.aborted, true);
    assert.equal(gate.hasActive(), false);
    const third = gate.begin(); // immediate re-entry
    assert.equal(gate.isCurrent(third), true);
    assert.equal(gate.isCurrent(second), false, "A stale completion cannot become current after re-entry");
}

{
    const counters = { update: 0, release: 0, finalize: 0, cancel: 0 };
    const handlers = {
        update() { counters.update += 1; }, release() { counters.release += 1; },
        finalize() { counters.finalize += 1; }, cancel() { counters.cancel += 1; }
    };
    const cancelDrag = { current: "shadows" };
    ui.finishWheelPointer("pointercancel", cancelDrag, "shadows", { clientX: 999, clientY: 999 }, handlers);
    assert.equal(cancelDrag.current, null);
    assert.deepEqual(counters, { update: 0, release: 1, finalize: 0, cancel: 1 }, "pointercancel must not calculate from cancellation coordinates");
    const lostDrag = { current: "shadows" };
    ui.finishWheelPointer("lostpointercapture", lostDrag, "shadows", {}, handlers);
    assert.equal(lostDrag.current, null, "lost pointer capture must clear dragging state");
    assert.equal(counters.update, 0);
    const upDrag = { current: "shadows" };
    ui.finishWheelPointer("pointerup", upDrag, "shadows", { clientX: 10, clientY: 20 }, handlers);
    assert.equal(upDrag.current, null);
    assert.equal(counters.update, 1);
    assert.equal(counters.finalize, 1, "pointerup must calculate and finalize exactly once");
}

assert.match(browser, /COMMAND_THROTTLE_MS = 125/);
assert.doesNotMatch(browser, /Connected · refreshing/);
const requestSnapshotBlock = browser.match(/async function requestSnapshot[\s\S]*?function contextMessage/)[0];
assert.doesNotMatch(requestSnapshotBlock, /status\([^\n]*refresh/i, "Ordinary polling must not expose a refreshing status");
assert.match(browser, /if \(!state\.hasCompleteSnapshot\) status\("Loading Lightroom values…", "pending"\)/);
assert.match(browser, /status\("Waiting for Lightroom", "warning"\)/);
assert.match(browser, /status\("Disconnected", "warning"\)/);
assert.match(browser, /status\(contextMessage\(context\), contextMessage\(context\) === "Connected" \? "connected" : "warning"\)/);
assert.match(browser, /function updateStatusElement[\s\S]*element\.textContent !== text[\s\S]*element\.dataset\.state !== nextKind/);
assert.match(browser, /sendWheel\(region, true\)/);
assert.match(browser, /state\.draggingRegion/);
assert.match(html, /touch-action: none/);
assert.match(browser, /snapshot\.complete !== true/);
assert.match(browser, /requestId !== state\.activeRequestId/);
assert.match(browser, /state\.contextKey !== null && state\.contextKey !== nextContextKey/);
assert.match(browser, /state\.requestInFlight/);
assert.match(browser, /cycleGate\.cancel\(\)/);
assert.match(browser, /signal: signal/);
assert.match(browser, /!signal\.aborted/);
assert.match(browser, /!cycleGate\.isCurrent\(cycle\) \|\| signal\.aborted \|\| sequence !== state\.requestSequence/);
assert.match(browser, /resetSentValueState\(\)/);
assert.match(browser, /input\.addEventListener\("focus"[\s\S]*card\.editingField = input/);
assert.match(browser, /control\.editing = true/);
assert.match(browser, /Boolean\(control && control\.editing\)[\s\S]*Boolean\(card && card\.editingField\)/);
assert.match(browser, /if \(!card\.editingField\)[\s\S]*element\.disabled = !ready/);
assert.match(browser, /if \(!control\.editing\)[\s\S]*element\.disabled = !ready/);
assert.match(browser, /if \(card\.hue\.value !== hueText\) card\.hue\.value = hueText/);
assert.match(browser, /if \(card\.saturation\.value !== saturationText\) card\.saturation\.value = saturationText/);
assert.match(browser, /if \(control\.number\.value !== numberText\) control\.number\.value = numberText/);
assert.match(browser, /card\.authoritativeValue = \{ hue: hue\.value, saturation: saturation\.value \}/);
assert.match(browser, /control\.authoritativeValue = result\.value/);
assert.match(browser, /delete state\.pendingSince\[region\]/);
assert.match(browser, /delete state\.pendingSince\[controlName\]/);
assert.match(browser, /event\.key === "Escape"[\s\S]*cancelWheelFieldEdit\(card\)/);
assert.match(browser, /event\.key === "Escape"[\s\S]*showScalarValue\(control, control\.authoritativeValue/);
assert.match(browser, /input\.addEventListener\("change"[\s\S]*commitWheelFields\(region\)/);
assert.match(browser, /number\.addEventListener\("change"[\s\S]*commitNumber\(\)/);
assert.doesNotMatch(browser, /(?:card\.hue|card\.saturation|number)\.addEventListener\("input"/);
assert.equal(ui.normalizeNumber("-"), null);
assert.equal(ui.normalizeNumber("."), null);
assert.equal(ui.normalizeNumber("-."), null);
assert.equal(ui.normalizeNumber("12,"), 12);
assert.match(browser, /lostpointercapture/);
assert.match(browser, /if \(!state\.visible/);
assert.match(browser, /Parameter unavailable/);
assert.doesNotMatch(browser, /api\/feedback\/request-many|api\/feedback\/snapshot/);
assert.match(browser, /api\/color-grading\/request/);
assert.match(browser, /api\/color-grading\/snapshot\?id=/);
assert.match(html, /@media \(max-width: 1100px\)[\s\S]*?\.cg-region-card \.cg-scalar-row \{ grid-template-columns: minmax\(0, 1fr\) 82px; \}/);
assert.match(html, /@media \(max-width: 760px\)[\s\S]*?\.cg-scalar-section \.cg-scalar-row/);
assert.equal(require("../config/sliders.json").length, 96);
assert.equal(require("../server/sliders").getAll().filter(definition => definition.feedbackSupported === true).length, 93);
const runtimeAudit = read("docs/LIGHTROOM_15_3_SDK_CAPABILITY_AUDIT.md");
assert.match(runtimeAudit, /Tested: 88, PASS: 87, FAIL: 1, UNVERIFIED: 0/);
assert.match(runtimeAudit, /No Color Grading command is marked PASS/);

(async function () {
    const bridge = createBridge({ httpPort: 0, wsPort: 0, httpHost: "127.0.0.1", wsHost: "127.0.0.1" });
    await bridge.start();
    try {
        const base = "http://127.0.0.1:" + bridge.getHttpServer().address().port;
        const response = await fetch(base + "/color-grading/metadata");
        assert.equal(response.status, 200);
        assert.match(response.headers.get("cache-control"), /no-store/);
        const body = await response.json();
        assert.equal(body.ok, true);
        assert.deepEqual(Object.keys(body.colorGrading.regions), ["shadows", "midtones", "highlights", "global"]);
        assert.deepEqual(Object.keys(body.colorGrading.scalarControls), ["shadow_luminance", "midtone_luminance", "highlight_luminance", "global_luminance", "blending", "balance"]);
        assert.deepEqual(body.colorGrading.views, ["3-way", "shadow", "midtone", "highlight", "global"]);
    } finally {
        await bridge.stop();
    }
    console.log("Web Controller Color Grading UI tests passed.");
})().catch(function (error) { console.error(error); process.exitCode = 1; });
