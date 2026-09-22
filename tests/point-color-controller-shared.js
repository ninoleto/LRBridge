"use strict";

const assert = require("node:assert/strict");
const pointColor = require("../app/controller-point-color");
const masking = require("../app/controller-masking");

class FakeClassList {
    constructor(element) { this.element = element; }
    add(name) {
        const values = new Set(String(this.element.className || "").split(/\s+/).filter(Boolean));
        values.add(name); this.element.className = Array.from(values).join(" ");
    }
    toggle(name, force) {
        const values = new Set(String(this.element.className || "").split(/\s+/).filter(Boolean));
        if (force === undefined ? !values.has(name) : force) values.add(name); else values.delete(name);
        this.element.className = Array.from(values).join(" ");
    }
}

class FakeElement {
    constructor(tagName) {
        this.tagName = String(tagName).toUpperCase(); this.children = []; this.dataset = {};
        this.style = {}; this.attributes = {}; this.listeners = {}; this.className = "";
        this.textContent = ""; this.value = ""; this.disabled = false; this.hidden = false;
        this.classList = new FakeClassList(this); this.captures = new Set();
    }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    append() { Array.from(arguments).forEach((child) => this.appendChild(child)); }
    replaceChildren() { this.children = []; Array.from(arguments).forEach((child) => this.appendChild(child)); }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    dispatch(type, values) {
        const event = Object.assign({ type: type, target: this, key: "", pointerId: 1, clientX: 0,
            preventDefault: function () {} }, values || {});
        (this.listeners[type] || []).forEach((listener) => listener(event));
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    select() {}
    blur() { this.dispatch("blur"); }
    getBoundingClientRect() { return { left: 0, width: 100 }; }
    setPointerCapture(pointerId) { this.captures.add(pointerId); }
    hasPointerCapture(pointerId) { return this.captures.has(pointerId); }
    releasePointerCapture(pointerId) { this.captures.delete(pointerId); }
}

const documentRef = {
    createElement: function (tagName) { return new FakeElement(tagName); },
    createElementNS: function (_namespace, tagName) { return new FakeElement(tagName); }
};
const rangeValue = { LowerNone: 0.1, LowerFull: 0.3, UpperFull: 0.7, UpperNone: 0.9 };
function state(hue) {
    return {
        available: true, swatchCount: 1, selectedIndex: 1, selectionTransient: false,
        HueShift: hue, SatScale: 0, LumScale: 0, Variance: 0, RangeAmount: 0.5,
        HueRange: Object.assign({}, rangeValue), SatRange: Object.assign({}, rangeValue),
        LumRange: Object.assign({}, rangeValue), HueRangeMarker: 0.5, SatRangeMarker: 0.5,
        LumRangeMarker: 0.5
    };
}
function binding(mask, revision, result) {
    return {
        serverEpoch: "epoch-a", selectedPhotoUuid: "photo-a", contextCounter: 4, developCounter: 7,
        contextChangedAt: 10, selectedMaskGroupId: mask, maskingRevision: revision,
        lastEditResult: result || null
    };
}
function find(element, predicate) {
    if (predicate(element)) return element;
    for (const child of element.children) { const result = find(child, predicate); if (result) return result; }
    return null;
}
function tick() { return new Promise(function (resolve) { setImmediate(resolve); }); }
function deferred() { let resolve; const promise = new Promise(function (next) { resolve = next; }); return { promise, resolve }; }
function sleep(milliseconds) { return new Promise(function (resolve) { setTimeout(resolve, milliseconds); }); }
function jsonResponse(body, status) {
    return { ok: status === undefined || status < 400, status: status || 200,
        json: async function () { return body; } };
}

const MASK_BINDING_QUERY_FIELDS = ["selectedPhotoUuid", "contextCounter", "developCounter", "contextChangedAt",
    "serverEpoch", "stateRevision", "selectedMaskGroupId"];
function assertRequestShape(path, pathname, operationFields) {
    const parsed = new URL(path, "http://controller.test");
    assert.equal(parsed.pathname, pathname);
    assert.deepEqual(Array.from(parsed.searchParams.keys()).sort(), operationFields.concat(MASK_BINDING_QUERY_FIELDS).sort(),
        pathname + " must carry its exact operation fields and the complete authoritative mask binding");
    assert.equal(parsed.searchParams.get("selectedPhotoUuid"), "photo-a");
    assert.equal(parsed.searchParams.get("contextCounter"), "4");
    assert.equal(parsed.searchParams.get("developCounter"), "7");
    assert.equal(parsed.searchParams.get("contextChangedAt"), "10");
    assert.equal(parsed.searchParams.get("serverEpoch"), "epoch-a");
    assert.equal(parsed.searchParams.get("selectedMaskGroupId"), "mask-a");
}

(async function run() {
    const requests = [];
    const pending = [];
    const statuses = [];
    const host = new FakeElement("div");
    let pickerSelections = 0;
    let visualizeRequests = 0;
    let currentBinding = binding("mask-a", 1);
    const maskController = pointColor.createController({
        document: documentRef, routePrefix: "/api/masking/point-color", externalState: true,
        includeSelectedIndexQuery: true, showHeading: false, showVisualize: true,
        pickerAction: function () { pickerSelections += 1; return Promise.resolve(true); },
        visualizeAction: function () { visualizeRequests += 1; return Promise.resolve(true); },
        bindingKey: function (value) {
            return value && [value.serverEpoch, value.selectedPhotoUuid, value.contextCounter,
                value.developCounter, value.contextChangedAt, value.selectedMaskGroupId].join("|");
        },
        bindingQuery: masking.pointColorBindingQuery,
        resultForBinding: function (value) { return value && value.lastEditResult; },
        requestCommand: function (path) {
            requests.push(path); const next = deferred(); pending.push(next); return next.promise;
        },
        setStatus: function (message) { statuses.push(message); }
    });
    maskController.applyContext(currentBinding);
    maskController.applyAuthoritative(state(0), currentBinding);
    maskController.mount(host);
    assert.equal(statuses.some(function (message) { return /superseded|normalized/.test(message); }), false,
        "initial authoritative loading must not create a warning");
    const picker = find(host, function (element) { return element.textContent === "Select Color Picker"; });
    assert.ok(picker);
    assert.equal(picker.disabled, false);
    picker.dispatch("click");
    await tick();
    assert.equal(pickerSelections, 1, "mask and global Point Color must share the picker presentation and action hook");
    const visualize = find(host, function (element) { return element.textContent === "Toggle Visualize Range"; });
    assert.ok(visualize);
    assert.equal(visualize.type, "button");
    visualize.dispatch("click");
    assert.equal(visualize.disabled, true, "The momentary button blocks duplicate pending requests");
    visualize.dispatch("click");
    assert.equal(find(host, function (element) { return element.textContent === "State unknown"; }), null);
    await tick();
    assert.equal(visualizeRequests, 1,
        "mask and global Point Color must share the documented momentary visualization action hook");
    assert.ok(find(host, function (element) { return element.dataset.pointColorRange === "HueRange"; }));
    const row = find(host, function (element) { return element.dataset.pointColorField === "HueShift"; });
    const slider = row.children[1];
    slider.value = "10"; slider.dispatch("change");
    slider.value = "20"; slider.dispatch("change");
    slider.value = "30"; slider.dispatch("change");
    assert.equal(requests.length, 1);
    assertRequestShape(requests[0], "/api/masking/point-color/value", ["field", "value", "selectedIndex"]);
    pending[0].resolve({ ok: true, editSequence: 1 });
    await tick(); await tick();
    assert.equal(requests.length, 1,
        "the coalesced target must wait for authoritative settlement of the active request");
    currentBinding = binding("mask-a", 2, { sequence: 1, maskGroupId: "mask-a",
        kind: "masking.point_color.value.set", outcome: "confirmed", detail: "" });
    maskController.applyContext(currentBinding);
    maskController.applyAuthoritative(state(0.1), currentBinding);
    assert.equal(slider.value, "30", "intermediate feedback must preserve the newest queued value");
    await tick(); await tick();
    assert.equal(requests.length, 2, "rapid same-control input must serialize and coalesce after settlement");
    assert.match(requests[1], /value=0\.3/);
    assert.match(requests[1], /selectedMaskGroupId=mask-a/);
    pending[1].resolve({ ok: true, editSequence: 2 });
    await tick(); await tick();

    currentBinding = binding("mask-a", 3, { sequence: 2, maskGroupId: "mask-a",
        kind: "masking.point_color.value.set", outcome: "confirmed", detail: "" });
    maskController.applyContext(currentBinding);
    maskController.applyAuthoritative(state(0.29), currentBinding);
    assert.match(statuses.at(-1), /superseded or normalized/,
        "a confirmed but normalized user edit must warn only after its edit sequence settles");

    slider.value = "40"; slider.dispatch("change");
    assert.equal(requests.length, 3);
    pending[2].resolve({ ok: true, editSequence: 3 });
    await tick(); await tick();
    currentBinding = binding("mask-a", 4, { sequence: 3, maskGroupId: "mask-a",
        kind: "masking.point_color.value.set", outcome: "confirmed", detail: "" });
    maskController.applyContext(currentBinding);
    maskController.applyAuthoritative(state(0.4), currentBinding);
    assert.match(statuses.at(-1), /confirmed by Lightroom/);
    assert.doesNotMatch(statuses.at(-1), /superseded|normalized/);

    row.children[5].dispatch("click");
    assert.equal(requests.length, 4, "Reset must use the shared scalar write path");
    assertRequestShape(requests[3], "/api/masking/point-color/value", ["field", "value", "selectedIndex"]);
    assert.equal(new URL(requests[3], "http://controller.test").searchParams.get("value"), "0");
    pending[3].resolve({ ok: true, editSequence: 4 });
    await tick(); await tick();
    currentBinding = binding("mask-a", 5, { sequence: 4, maskGroupId: "mask-a",
        kind: "masking.point_color.value.set", outcome: "confirmed", detail: "" });
    maskController.applyContext(currentBinding);
    maskController.applyAuthoritative(state(0), currentBinding);

    const lowerNone = find(host, function (element) {
        return element.attributes["aria-label"] === "Hue Range Lower None";
    });
    assert.ok(lowerNone);
    lowerNone.dispatch("keydown", { key: "ArrowRight" });
    assert.equal(requests.length, 5);
    assertRequestShape(requests[4], "/api/masking/point-color/range",
        ["range", "boundary", "value", "selectedIndex"]);
    pending[4].resolve({ ok: true, editSequence: 5 });
    await tick(); await tick();
    const boundaryState = state(0);
    boundaryState.HueRange.LowerNone = 0.11;
    currentBinding = binding("mask-a", 6, { sequence: 5, maskGroupId: "mask-a",
        kind: "masking.point_color.range.set", outcome: "confirmed", detail: "" });
    maskController.applyContext(currentBinding);
    maskController.applyAuthoritative(boundaryState, currentBinding);

    const fullRange = find(host, function (element) {
        return element.attributes["aria-label"] === "Hue Range full range translation";
    });
    assert.ok(fullRange);
    fullRange.dispatch("keydown", { key: "ArrowRight" });
    assert.equal(requests.length, 6);
    assertRequestShape(requests[5], "/api/masking/point-color/range/translate",
        ["range", "LowerNone", "LowerFull", "UpperFull", "UpperNone", "selectedIndex"]);
    pending[5].resolve({ ok: true, editSequence: 6 });
    await tick(); await tick();
    const translatedState = state(0);
    translatedState.HueRange = { LowerNone: 0.12, LowerFull: 0.31, UpperFull: 0.71, UpperNone: 0.91 };
    currentBinding = binding("mask-a", 7, { sequence: 6, maskGroupId: "mask-a",
        kind: "masking.point_color.range.translate", outcome: "confirmed", detail: "" });
    maskController.applyContext(currentBinding);
    maskController.applyAuthoritative(translatedState, currentBinding);

    maskController.applyContext(binding("mask-b", 8));
    assert.equal(maskController.getState().state.available, false,
        "mask switching must discard the old mask's Point Color state immediately");
    maskController.applyAuthoritative(state(-0.5), binding("mask-b", 8));
    assert.equal(maskController.getState().state.HueShift, -0.5);
    assert.equal(maskController.getState().awaitingCount, 0);
    const maskBRow = find(host, function (element) { return element.dataset.pointColorField === "HueShift"; });
    maskBRow.children[1].value = "-40";
    maskBRow.children[1].dispatch("change");
    assert.equal(requests.length, 7);
    const maskBPending = pending.at(-1);
    maskController.applyContext(binding("mask-c", 9));
    maskBPending.resolve({ ok: true, editSequence: 7 });
    await tick(); await tick();
    assert.equal(maskController.getState().awaitingCount, 0,
        "an out-of-order admission response from the old mask must be rejected");
    assert.equal(maskController.applyAuthoritative(state(-0.4), binding("mask-b", 8)), false,
        "late authoritative Point Color feedback from the old mask must be rejected");

    const globalHost = new FakeElement("div");
    const globalRequests = [];
    const globalVisualize = deferred();
    const globalController = pointColor.createController({
        document: documentRef, routePrefix: "/api/point-color", externalState: true,
        visualizeAction: function () { return globalVisualize.promise; },
        requestCommand: async function (path) { globalRequests.push(path); return { ok: true }; }
    });
    globalController.applyContext({ scope: "global" });
    globalController.applyAuthoritative(state(0.1));
    globalController.mount(globalHost);
    assert.equal(find(globalHost, function (element) { return element.dataset.pointColorField === "HueShift"; }).children.length,
        row.children.length, "global and mask Point Color must render through the same scalar-row machinery");
    assert.ok(find(globalHost, function (element) { return element.textContent === "Toggle Visualize Range"; }));
    const globalRow = find(globalHost, function (element) { return element.dataset.pointColorField === "HueShift"; });
    globalRow.children[1].value = "20";
    globalRow.children[1].dispatch("change");
    await tick(); await tick();
    const globalRequest = new URL(globalRequests[0], "http://controller.test");
    assert.equal(globalRequest.pathname, "/api/point-color/value");
    assert.deepEqual(Array.from(globalRequest.searchParams.keys()).sort(), ["field", "value"],
        "global Point Color must retain its unchanged global route and public request shape");
    find(globalHost, element => element.textContent === "Toggle Visualize Range").dispatch("click");
    globalController.render();
    const rebuiltToggle = find(globalHost, element => element.textContent === "Toggle Visualize Range");
    assert.equal(rebuiltToggle.disabled, true, "A render during the request preserves pending state");
    const colorView = new FakeElement("div");
    globalHost.replaceChildren(colorView);
    globalVisualize.resolve({ ok: true });
    await tick();
    assert.equal(rebuiltToggle.disabled, false, "Completion settles the current button");
    assert.deepEqual(globalHost.children, [colorView], "A completed toggle cannot redraw over another Color Mixer view");
    globalController.unmount();

    async function rapidScalarIntentTest(scope) {
        const rapidHost = new FakeElement("div");
        const rapidRequests = [];
        const rapidPending = [];
        let rapidBinding = scope === "mask" ? binding("mask-a", 20) : { scope: "global" };
        const rapidController = pointColor.createController({
            document: documentRef,
            routePrefix: scope === "mask" ? "/api/masking/point-color" : "/api/point-color",
            externalState: true,
            includeSelectedIndexQuery: scope === "mask",
            bindingKey: scope === "mask" ? function (value) {
                return value && [value.serverEpoch, value.selectedPhotoUuid, value.contextCounter,
                    value.developCounter, value.contextChangedAt, value.selectedMaskGroupId].join("|");
            } : undefined,
            bindingQuery: scope === "mask" ? masking.pointColorBindingQuery : undefined,
            resultForBinding: scope === "mask" ? function (value) { return value && value.lastEditResult; } : undefined,
            requestCommand: function (path) {
                rapidRequests.push(path);
                const next = deferred();
                rapidPending.push(next);
                return next.promise;
            }
        });
        rapidController.applyContext(rapidBinding);
        rapidController.applyAuthoritative(state(0), rapidBinding);
        rapidController.mount(rapidHost);
        const rapidRow = find(rapidHost, function (element) { return element.dataset.pointColorField === "HueShift"; });
        const rapidNumber = rapidRow.children[2];
        const rapidPlus = rapidRow.children[4];
        for (let index = 0; index < 20; index += 1) rapidPlus.dispatch("click");
        assert.equal(rapidNumber.value, "20", scope + " rapid clicks must display the newest intended value");
        assert.equal(rapidRequests.length, 1, scope + " rapid clicks must keep one active submitted request");

        rapidController.applyAuthoritative(state(0), rapidBinding);
        assert.equal(rapidNumber.value, "20",
            scope + " delayed pre-settlement feedback must not overwrite the newest intention");
        rapidPending[0].resolve(scope === "mask" ? { ok: true, editSequence: 1 } : { ok: true });
        await tick(); await tick();

        rapidBinding = scope === "mask" ? binding("mask-a", 21, {
            sequence: 1, maskGroupId: "mask-a", kind: "masking.point_color.value.set",
            outcome: "confirmed", detail: ""
        }) : rapidBinding;
        rapidController.applyContext(rapidBinding);
        rapidController.applyAuthoritative(state(0.01), rapidBinding);
        assert.equal(rapidNumber.value, "20",
            scope + " intermediate confirmed feedback must never snap over a newer queued target");
        await tick(); await tick();
        assert.equal(rapidRequests.length, 2,
            scope + " must submit exactly the newest coalesced target immediately after active settlement");
        assert.equal(new URL(rapidRequests[1], "http://controller.test").searchParams.get("value"), "0.2");

        rapidPending[1].resolve(scope === "mask" ? { ok: true, editSequence: 2 } : { ok: true });
        await tick(); await tick();
        rapidBinding = scope === "mask" ? binding("mask-a", 22, {
            sequence: 2, maskGroupId: "mask-a", kind: "masking.point_color.value.set",
            outcome: "confirmed", detail: ""
        }) : rapidBinding;
        rapidController.applyContext(rapidBinding);
        rapidController.applyAuthoritative(state(0.2), rapidBinding);
        assert.equal(rapidNumber.value, "20", scope + " final displayed value must equal the complete click intention");
        assert.equal(rapidController.isBusy(), false, scope + " final settlement must release the Point Color pipeline");
        rapidController.unmount();
    }

    await rapidScalarIntentTest("mask");
    await rapidScalarIntentTest("global");

    const timeoutHost = new FakeElement("div");
    const timeoutStatuses = [];
    const timeoutController = pointColor.createController({
        document: documentRef, routePrefix: "/api/masking/point-color", externalState: true,
        includeSelectedIndexQuery: true, feedbackTimeoutMs: 20,
        bindingKey: function (value) { return value && value.selectedMaskGroupId; },
        bindingQuery: masking.pointColorBindingQuery,
        resultForBinding: function (value) { return value && value.lastEditResult; },
        requestCommand: async function () { return { ok: true, editSequence: 50 }; },
        setStatus: function (message) { timeoutStatuses.push(message); }
    });
    const timeoutBinding = binding("mask-timeout", 30);
    timeoutController.applyContext(timeoutBinding);
    timeoutController.applyAuthoritative(state(0), timeoutBinding);
    timeoutController.mount(timeoutHost);
    const timeoutRow = find(timeoutHost, function (element) { return element.dataset.pointColorField === "HueShift"; });
    timeoutRow.children[4].dispatch("click");
    await tick(); await tick();
    assert.equal(timeoutController.isBusy(), true);
    await sleep(40);
    assert.equal(timeoutController.isBusy(), false, "Point Color feedback timeout must release every busy flag");
    assert.match(timeoutStatuses.at(-1), /timed out/i, "Point Color feedback timeout must report the real failure");
    timeoutController.unmount();

    const wrapperHost = new FakeElement("div");
    const wrapperPending = [];
    let wrapperRevision = 1;
    let wrapperEditSequence = 0;
    let wrapperPointColor = state(0);
    let wrapperLastEditResult = null;
    const wrapperContext = {
        activeModule: "develop", selectedPhotoUuid: "photo-a", contextCounter: 4,
        developCounter: 7, contextChangedAt: 10
    };
    function wrapperState() {
        return {
            ok: true, serverEpoch: "epoch-a", revision: wrapperRevision, capturedAt: Date.now(),
            selectedPhotoUuid: "photo-a", contextCounter: 4, developCounter: 7, contextChangedAt: 10,
            pendingOperation: null, lastResult: null, correctionFeedbackSequence: 0,
            lastCorrectionResult: null, editFeedbackSequence: wrapperEditSequence,
            lastEditResult: wrapperLastEditResult, available: true, unavailableReason: null, active: true,
            maskGroupCount: 1, hasSelectedMaskGroup: true, selectedMaskGroupIndex: 1,
            selectedMaskGroupId: "mask-a", selectedMaskHidden: false, previousAvailable: false,
            nextAvailable: false, selectedMaskToolAvailable: true, selectedMaskToolId: "component-a",
            selectedMaskToolHidden: false, selectedMaskToolCount: 1, selectedMaskToolIndex: 1,
            previousMaskToolAvailable: false, nextMaskToolAvailable: false, corrections: [],
            pointColor: wrapperPointColor, curves: { available: false }
        };
    }
    const wrapper = masking.createController({
        document: documentRef,
        getContext: function () { return wrapperContext; },
        pointColorFeedbackTimeoutMs: 20,
        setInterval: function () { return 1; },
        clearInterval: function () {},
        fetch: function (requestPath) {
            const pathname = new URL(requestPath, "http://controller.test").pathname;
            if (pathname === "/api/masking/state") return Promise.resolve(jsonResponse(wrapperState()));
            if (pathname === "/api/masking/presets") {
                return Promise.resolve(jsonResponse({ ok: true, presets: [
                    { id: "lp-custom", name: "Custom", kind: "marker", supported: false,
                        unavailableReason: "Current-state marker" },
                    { id: "lp-burn", name: "Burn (Darken)", kind: "file", supported: true,
                        unavailableReason: null }
                ] }));
            }
            if (pathname === "/api/masking/point-color/value") {
                const next = deferred(); wrapperPending.push(next); return next.promise;
            }
            return Promise.resolve(jsonResponse({ ok: false, error: "unexpected " + pathname }, 404));
        }
    });
    wrapper.activate(wrapperHost);
    for (let index = 0; index < 6; index += 1) await tick();
    const applyPreset = find(wrapperHost, function (element) {
        return element.className === "masking-preset-button";
    });
    const wrapperHueRow = find(wrapperHost, function (element) { return element.dataset.pointColorField === "HueShift"; });
    assert.ok(applyPreset, "current preset picker button must exist");
    assert.ok(wrapperHueRow, "selected mask Point Color hue row must exist: " + JSON.stringify(wrapper.getInteractionState()));
    assert.equal(applyPreset.disabled, false, "the real preset action must start usable when Masking is idle: " +
        JSON.stringify(wrapper.getInteractionState()));

    wrapperHueRow.children[4].dispatch("click");
    assert.equal(applyPreset.disabled, true, "a genuine active Point Color edit may temporarily disable presets");
    assert.equal(wrapper.getInteractionState().activeOperation, null);
    assert.equal(wrapper.getInteractionState().correctionBusy, true);
    assert.equal(wrapper.getInteractionState().pointColor.writeInFlight, true,
        "the exact preset blocker must be the active Point Color pipeline, not a Masking operation");
    wrapperPending.shift().resolve(jsonResponse({ ok: true, editSequence: 1 }));
    await tick(); await tick();
    wrapperEditSequence = 1; wrapperRevision += 1; wrapperPointColor = state(0.01);
    wrapperLastEditResult = { sequence: 1, maskGroupId: "mask-a", kind: "masking.point_color.value.set",
        outcome: "confirmed", detail: "" };
    await wrapper.refresh(); await tick();
    assert.equal(applyPreset.disabled, false, "preset action must re-enable immediately after final Point Color settlement");
    assert.equal(wrapper.getInteractionState().correctionBusy, false);

    wrapperHueRow.children[4].dispatch("click");
    wrapperPending.shift().resolve(jsonResponse({ ok: true, editSequence: 2 }));
    await tick(); await tick();
    wrapperEditSequence = 2; wrapperRevision += 1;
    wrapperLastEditResult = { sequence: 2, maskGroupId: "mask-a", kind: "masking.point_color.value.set",
        outcome: "failed", detail: "fixture rejection" };
    await wrapper.refresh(); await tick();
    assert.equal(applyPreset.disabled, false, "an explicit Point Color failure must restore preset availability");
    assert.equal(wrapper.getInteractionState().pointColor.awaitingCount, 0);

    wrapperLastEditResult = null;
    wrapperHueRow.children[4].dispatch("click");
    wrapperPending.shift().resolve(jsonResponse({ ok: true, editSequence: 3 }));
    await tick(); await tick();
    assert.equal(applyPreset.disabled, true);
    await sleep(40);
    assert.equal(applyPreset.disabled, false, "a Point Color feedback timeout must restore preset availability");
    assert.equal(wrapper.getInteractionState().correctionBusy, false);
    wrapper.deactivate();

    console.log("Shared global/mask Point Color controller behavior passed.");
})().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
