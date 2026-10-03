"use strict";

// Focused production-Controller event/render regression, using the same small
// DOM-double pattern as point-curve.js. Returned SDK snapshots and HTTP
// admissions are controlled here; this is not actual Lightroom verification.
const assert = require("node:assert/strict");
const path = require("node:path");
const curve = require(process.env.LRBRIDGE_TONE_CURVE_SOURCE || path.join(__dirname, "../app/controller-tone-curve"));

class ClassList {
    constructor() { this.values = new Set(); }
    add(...values) { values.forEach(value => this.values.add(value)); }
    contains(value) { return this.values.has(value); }
    toggle(value, enabled) {
        const present = enabled === undefined ? !this.contains(value) : enabled;
        if (present) this.values.add(value); else this.values.delete(value);
        return present;
    }
}
class Element {
    constructor(tagName) {
        Object.assign(this, { tagName, children: [], attributes: {}, listeners: {}, classList: new ClassList(),
            className: "", textContent: "", hidden: false, disabled: false, value: "", ownerDocument: null,
            style: { setProperty() {} } });
    }
    setAttribute(name, value) {
        this.attributes[name] = String(value);
        if (name === "class") {
            this.className = String(value);
            String(value).split(/\s+/).filter(Boolean).forEach(name => this.classList.add(name));
        }
    }
    getAttribute(name) { return this.attributes[name]; }
    matches(selector) {
        if (selector === ":disabled") return this.disabled || Boolean(this.parentNode && this.parentNode.matches(selector));
        return false;
    }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    replaceChildren(...children) { this.children = children; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    removeEventListener(type, listener) { this.listeners[type] = (this.listeners[type] || []).filter(item => item !== listener); }
    dispatch(type, properties = {}) {
        const event = { type, target: this, preventDefault() {}, stopPropagation() {}, ...properties };
        (this.listeners[type] || []).forEach(listener => listener(event));
    }
    getBoundingClientRect() { return { left: 0, top: 0, width: 255, height: 255 }; }
    setPointerCapture() {}
    releasePointerCapture() {}
    setSelectionRange(start, end, direction) { Object.assign(this, { selectionStart: start, selectionEnd: end, selectionDirection: direction }); }
    focus() { this.ownerDocument.activeElement = this; this.dispatch("focus"); }
    blur() { this.ownerDocument.activeElement = null; this.dispatch("blur"); }
}
function createDocument() {
    const document = new Element("document");
    document.visibilityState = "visible";
    document.createElement = name => Object.assign(new Element(name), { ownerDocument: document });
    document.createElementNS = (_namespace, name) => document.createElement(name);
    document.createTextNode = text => Object.assign(document.createElement("#text"), { textContent: text });
    return document;
}
function find(element, predicate) {
    if (predicate(element)) return element;
    for (const child of element.children) { const found = find(child, predicate); if (found) return found; }
    return null;
}
const flush = async () => { for (let index = 0; index < 6; index++) await new Promise(resolve => setImmediate(resolve)); };
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const linear = [0, 0, 255, 255];

async function fixture(masked) {
    let time = 1000, sequence = 0;
    let snapshot = { available: true, selectedPhotoUuid: "refine-photo-a", contextCounter: 4, developCounter: 7,
        revision: 1, updatedAt: time, name: "Custom", refineSaturation: { value: 50, min: 0, max: 100 },
        curves: Object.fromEntries(["rgb", "red", "green", "blue"].map(name => [name, linear.slice()])) };
    if (masked) Object.assign(snapshot, { serverEpoch: "refine-fixture", maskingRevision: 1, contextChangedAt: 100,
        selectedMaskGroupId: "refine-mask-a", editFeedbackSequence: 0, lastEditResult: null });
    const requests = [], heldEnds = [], statuses = [];
    const document = createDocument(), window = new Element("window");
    const controller = curve.createController({ document, window,
        contextAdapter: masked ? curve.createMaskingContextAdapter() : undefined,
        now: () => time, feedbackTimeoutMs: 50,
        setStatus: message => statuses.push(message), setInterval: () => 1, clearInterval() {},
        fetch: async requestPath => {
            if (requestPath.endsWith("/state")) return response({ ok: true, pointCurve: snapshot });
            const parsed = new URL(requestPath, "http://fixture.invalid");
            const admission = masked ? { ok: true, editSequence: ++sequence } : { ok: true };
            const request = { path: requestPath, phase: parsed.pathname.split("/").at(-1),
                value: parsed.searchParams.has("value") ? Number(parsed.searchParams.get("value")) : null,
                baseline: parsed.searchParams.has("baseline") ? Number(parsed.searchParams.get("baseline")) : null,
                sequence: masked ? sequence : null, admission };
            requests.push(request);
            if (request.phase === "end") return new Promise(resolve => heldEnds.push({ request, resolve }));
            return response(admission);
        }
    });
    const binding = value => ({ activeModule: "develop", ...value });
    controller.activate(binding(snapshot));
    await flush();
    const control = label => find(controller.element, element => element.getAttribute("aria-label") === label);
    const range = control("Refine Saturation"), number = control("Edit Refine Saturation value");
    assert.ok(range && number, "production Refine controls must be mounted");
    const publish = changes => {
        snapshot = { ...snapshot, ...changes };
        controller.applyContext(binding(snapshot));
        assert.equal(controller.applyAuthoritative(snapshot), true, "fixture feedback must have the current photo/mask binding");
    };
    const confirm = (value, request, overrides = {}) => {
        const nextRevision = snapshot.revision + 1;
        publish({ revision: nextRevision, updatedAt: ++time,
            refineSaturation: { value, min: 0, max: 100 },
            ...(masked ? { maskingRevision: nextRevision, editFeedbackSequence: request.sequence,
                lastEditResult: { sequence: request.sequence,
                    kind: "masking.tone_curve.refine_saturation.gesture." + request.phase,
                    maskGroupId: snapshot.selectedMaskGroupId, outcome: "confirmed", detail: "" } } : {}),
            ...overrides });
    };
    const admitEnd = async (status = 200, detail = "fixture Refine admission rejected") => {
        assert.equal(heldEnds.length, 1, "there must be exactly one held terminal admission");
        const held = heldEnds.shift();
        held.resolve(response(status < 400 ? held.request.admission : { ok: false, error: detail }, status));
        await flush();
        return held.request;
    };
    const oneShot = async value => {
        range.value = String(value);
        range.dispatch("change");
        await flush();
        assert.equal(heldEnds.length, 1);
    };
    const dispose = async () => { controller.deactivate(); await flush(); };
    return { masked, controller, document, window, range, number, requests, heldEnds, statuses, publish, confirm, admitEnd, oneShot, dispose,
        snapshot: () => snapshot, advance: elapsed => { time += elapsed; }, time: () => time,
        context: changes => controller.applyContext(binding({ ...snapshot, ...changes })) };
}

// Native pointer events traverse the document before their range target. This
// DOM double does not bubble, so explicitly deliver the capture and target
// phases used by the production blocked-touch lifecycle.
function pointerDown(f, pointerId) {
    const properties = { pointerId, pointerType: "touch", target: f.range };
    f.window.dispatch("pointerdown", properties);
    f.document.dispatch("pointerdown", properties);
    f.range.dispatch("pointerdown", properties);
}
function pointerEnd(f, type, pointerId, outside = false) {
    const properties = { pointerId, pointerType: "touch", target: outside ? f.document : f.range };
    f.window.dispatch(type, properties);
    f.document.dispatch(type, properties);
    if (!outside) f.range.dispatch(type, properties);
}

async function acceptedDrag(f, pointerId, value, outside = false) {
    const firstRequest = f.requests.length;
    pointerDown(f, pointerId);
    f.range.value = String(value); f.range.dispatch("input");
    await flush();
    const update = f.requests.slice(firstRequest).find(request => request.phase === "update");
    assert.ok(update, "the subsequent valid drag must submit its input to Lightroom");
    assert.equal(update.value, value);
    f.confirm(value, update); await flush();
    pointerEnd(f, "pointerup", pointerId, outside); await flush();
    const end = await f.admitEnd();
    assert.equal(end.value, value);
    f.confirm(value, end); await flush();
    assert.equal(f.range.value, String(value));
    assert.equal(f.number.value, String(value));
    assert.equal(f.controller.getState().awaitingRefine, null);
    assert.equal(f.requests.slice(firstRequest).filter(request => request.phase === "end").length, 1,
        "release must submit exactly one terminal value, including release outside the slider");
}

async function disabledTouch(masked) {
    for (const release of ["pointerup", "pointercancel"]) {
        const f = await fixture(masked);
        try {
            await f.oneShot(17);
            const end = await f.admitEnd();
            assert.equal(f.range.disabled, true);
            const priorRequests = f.requests.length;
            pointerDown(f, 99);
            pointerDown(f, 99); // duplicate delivery must not create extra owners
            f.confirm(17, end); await flush();
            const disabledAfterConfirmation = f.range.disabled;
            assert.equal(f.controller.getState().refineGestureActive, false);
            f.range.value = "88"; f.range.dispatch("input");
            const afterInput = f.range.value;
            f.publish({ ...f.snapshot() });
            console.log(JSON.stringify({ case: "captured ignored-touch88/SDK17", masked, release,
                disabledAfterConfirmation, afterInput, afterRender: f.range.value,
                newEditRequests: f.requests.slice(priorRequests).filter(request => request.phase !== "cancel").length }));
            assert.equal(disabledAfterConfirmation, true,
                "captured failure: terminal17 confirmation must not enable Refine beneath the already ignored finger99");
            assert.equal(afterInput, "17", "unowned native thumb88 must be rejected immediately, not survive until feedback restores17");
            f.range.dispatch("change"); await flush();
            assert.equal(f.requests.slice(priorRequests).filter(request => request.phase !== "cancel").length, 0,
                "an ignored touch/change must never submit a different edit; confirmed prior gesture cleanup may cancel its session");
            pointerEnd(f, "pointerup", 100, true);
            assert.equal(f.range.disabled, true, "an unrelated pointer release must not unlock finger99");
            f.publish({ updatedAt: f.time() + 1 });
            assert.equal(f.range.disabled, true, "SDK polling cannot retire the physical ignored-touch latch");
            pointerEnd(f, release, 99, true); await flush();
            assert.equal(f.range.disabled, false, `${release} outside the range must restore confirmed availability`);
            await acceptedDrag(f, 101, 63, true);
            const reset = f.range.parentNode.children.find(element => element.tagName === "button" && element.textContent === "Reset");
            reset.dispatch("click"); await flush();
            const resetRequest = f.requests.at(-1);
            assert.equal(resetRequest.phase, "reset");
            assert.ok(f.controller.getState().awaitingRefineReset);
            f.confirm(93, resetRequest); await flush();
            assert.equal(f.controller.getState().awaitingRefineReset, null);
            assert.equal(f.range.value, "93", "Reset must use the actual returned Lightroom result, not an assumed value");
            assert.equal(f.number.value, "93");
            // Keyboard/native change-only input has no pointer gesture. It
            // remains legitimate after the physical latch has been released.
            f.range.dispatch("keydown", { key: "ArrowLeft" });
            f.range.value = "31"; f.range.dispatch("input");
            assert.equal(f.range.value, "31", "the touch guard must not erase enabled keyboard range input before change");
            f.range.dispatch("change"); await flush();
            const keyboardEnd = await f.admitEnd();
            assert.equal(keyboardEnd.value, 31);
            f.confirm(31, keyboardEnd); await flush();
            assert.equal(f.number.value, "31");
        } finally { await f.dispose(); }
    }

    // A real photo/mask replacement retires old SDK/edit ownership, but must
    // not reinterpret the still-held ignored finger as input on the new owner.
    for (const contextKind of masked ? ["photo", "mask"] : ["photo"]) {
        const f = await fixture(masked);
        try {
            await f.oneShot(17); const end = await f.admitEnd();
            pointerDown(f, 99);
            const priorRequests = f.requests.length;
            const replacement = { revision: f.snapshot().revision + 1, updatedAt: f.time() + 1,
                refineSaturation: { value: 42, min: 0, max: 100 },
                ...(contextKind === "photo" ? { selectedPhotoUuid: "refine-photo-b", contextCounter: 5, developCounter: 8 }
                    : { selectedMaskGroupId: "refine-mask-b", contextChangedAt: 101 }),
                ...(masked ? { maskingRevision: f.snapshot().maskingRevision + 1, lastEditResult: null, editFeedbackSequence: 0 } : {}) };
            f.publish(replacement); await flush();
            assert.equal(f.controller.getState().awaitingRefine, null, "navigation must retire the previous pending result");
            assert.equal(f.range.disabled, true, `new ${contextKind} feedback must not activate the old held finger`);
            f.range.value = "88"; f.range.dispatch("input"); f.range.dispatch("change"); await flush();
            assert.equal(f.range.value, "42", "ignored physical movement cannot mutate the new context's displayed value");
            assert.equal(f.requests.slice(priorRequests).filter(request => ["begin", "update", "end"].includes(request.phase)).length, 0,
                "physical context carryover must never issue edits against the replacement photo/mask");
            pointerEnd(f, "pointercancel", 99, true); await flush();
            assert.equal(f.range.disabled, false);
            await acceptedDrag(f, 101, 37);
            assert.equal(f.controller.getState().authoritative.selectedPhotoUuid, f.snapshot().selectedPhotoUuid);
            assert.notEqual(end.value, 37, "fixture must exercise a fresh intention after discarding old ownership");
        } finally { await f.dispose(); }
    }

    // Navigation during an already registered, still-held gesture must also
    // prevent its physical contact becoming unowned input on the next photo.
    let f = await fixture(masked);
    try {
        pointerDown(f, 11);
        f.range.value = "75"; f.range.dispatch("input"); await flush();
        const update = f.requests.find(request => request.phase === "update");
        f.confirm(75, update); await flush();
        f.publish({ selectedPhotoUuid: "refine-photo-b", contextCounter: 5, developCounter: 8,
            revision: f.snapshot().revision + 1, updatedAt: f.time() + 1,
            refineSaturation: { value: 42, min: 0, max: 100 },
            ...(masked ? { maskingRevision: f.snapshot().maskingRevision + 1, lastEditResult: null } : {}) });
        await flush();
        assert.equal(f.controller.getState().refineGestureActive, false);
        assert.equal(f.range.disabled, true, "a retired held gesture stays blocked on replacement-photo feedback");
        const requestCount = f.requests.length;
        f.range.value = "88"; f.range.dispatch("input");
        assert.equal(f.range.value, "42");
        pointerEnd(f, "pointerup", 11, true); await flush();
        assert.equal(f.requests.length, requestCount, "release of the old context cannot submit a new terminal edit");
        await acceptedDrag(f, 12, 34);
    } finally { await f.dispose(); }

    // Leaving/re-entering the view with the rejected finger still down keeps
    // the latch; release or browser blur still cleans it up without a timer.
    for (const ending of ["pointerup", "blur"]) {
        f = await fixture(masked);
        try {
            await f.oneShot(17); const end = await f.admitEnd();
            pointerDown(f, 99); f.confirm(17, end); await flush();
            f.controller.deactivate(); await flush();
            f.controller.activate({ activeModule: "develop", ...f.snapshot() }); await flush();
            assert.equal(f.range.disabled, true, "reactivation cannot unlock a held ignored contact");
            if (ending === "blur") f.window.dispatch("blur");
            else pointerEnd(f, "pointerup", 99, true);
            assert.equal(f.range.disabled, false, `${ending} cleans up the rejected physical interaction`);
            await acceptedDrag(f, 101, 63);
        } finally { await f.dispose(); }
    }
}

async function handoff(masked) {
    const f = await fixture(masked);
    try {
        f.range.dispatch("pointerdown", { pointerId: 11 });
        f.range.value = "75"; f.range.dispatch("input");
        await flush();
        const update = f.requests.find(request => request.phase === "update");
        assert.equal(update.value, 75);
        f.range.value = "25"; f.range.dispatch("input");
        f.range.dispatch("pointerup", { pointerId: 11 });
        await flush();
        assert.equal(f.heldEnds.length, 0, "terminal write must await the earlier update's SDK baseline");
        assert.equal(f.range.value, "25", "newest pointer intention must remain visible during the older update");
        f.confirm(75, update);
        await flush();
        assert.equal(f.heldEnds[0].request.value, 25);
        assert.equal(f.heldEnds[0].request.baseline, 75);
        const end = await f.admitEnd();
        assert.equal(f.controller.getState().awaitingRefine.value, 25);
        assert.equal(f.range.value, "25",
            `${masked ? "Masking" : "normal"} terminal admission must retain newest thumb25, not restore older feedback75`);
        assert.equal(f.number.value, "75", "numeric feedback must remain confirmed Lightroom75 while thumb25 is pending");
        f.publish({ ...f.snapshot() });
        await flush();
        assert.equal(f.range.value, "25", "unchanged prior feedback must not replace the terminal pending thumb");
        assert.ok(f.controller.getState().awaitingRefine);
        f.confirm(25, end);
        await flush();
        assert.equal(f.range.value, "25"); assert.equal(f.number.value, "25");
        assert.equal(f.controller.getState().awaitingRefine, null);
        assert.deepEqual(f.requests.filter(request => request.value !== null).map(request => request.value), [75, 25],
            "the UI regression must retain exactly the ordered intermediate and final request targets");
    } finally { await f.dispose(); }
}

async function heartbeat(masked) {
    const f = await fixture(masked);
    try {
        await f.oneShot(75);
        const end = await f.admitEnd();
        assert.ok(f.controller.getState().awaitingRefine);
        f.publish({ updatedAt: f.time() + 1 });
        await flush();
        assert.ok(f.controller.getState().awaitingRefine,
            `${masked ? "older-sequence Masking" : "timestamp-only normal"} heartbeat must not resolve the unexecuted terminal scalar`);
        assert.equal(f.requests.filter(request => request.phase === "cancel").length, 0,
            "a heartbeat must not cancel admitted terminal work before SDK execution");
        f.confirm(75, end);
        assert.equal(f.controller.getState().awaitingRefine, null);
        assert.equal(f.number.value, "75");
    } finally { await f.dispose(); }
}

async function endingInput(masked) {
    const f = await fixture(masked);
    try {
        await f.oneShot(25);
        assert.equal(f.controller.getState().refineGesture.desired, 25);
        f.range.dispatch("pointerdown", { pointerId: 99 });
        f.range.value = "80"; f.range.dispatch("input");
        f.range.dispatch("pointerup", { pointerId: 99 });
        assert.equal(f.controller.getState().refineGesture.desired, 25,
            "unowned input during a held terminal request must not mutate that request's committed intention");
        const end = await f.admitEnd();
        assert.equal(end.value, 25);
        assert.equal(f.controller.getState().awaitingRefine.value, 25,
            "the terminal confirmation target must equal the submitted request, never an unowned later input");
        f.confirm(25, end);
        assert.equal(f.number.value, "25"); assert.equal(f.range.value, "25");
    } finally { await f.dispose(); }
}

async function lifecycle(masked) {
    // A genuine later SDK value, explicit rejection, timeout and real navigation
    // must still retire ownership; retaining the pending thumb is not stale authority.
    let f = await fixture(masked);
    try {
        await f.oneShot(100); const end = await f.admitEnd(); f.confirm(100, end);
        const reset = f.range.parentNode.children.find(element => element.tagName === "button" && element.textContent === "Reset");
        reset.dispatch("click"); await flush();
        assert.ok(f.controller.getState().awaitingRefineReset);
        const request = f.requests.at(-1);
        if (masked) f.confirm(100, request);
        else { f.advance(1); f.publish({ updatedAt: f.time() }); }
        assert.equal(f.controller.getState().awaitingRefineReset, null,
            "the gesture-baseline rule must preserve existing Reset feedback, including an unchanged default");
        assert.equal(f.range.disabled, false);
    } finally { await f.dispose(); }
    f = await fixture(masked);
    try {
        await f.oneShot(75); const end = await f.admitEnd();
        f.confirm(65, end);
        assert.equal(f.controller.getState().awaitingRefine, null);
        assert.equal(f.range.value, "65"); assert.equal(f.number.value, "65");
        assert.match(f.statuses.at(-1), /superseded|normalized/);
    } finally { await f.dispose(); }
    f = await fixture(masked);
    try {
        await f.oneShot(75); await f.admitEnd(409);
        assert.equal(f.controller.getState().awaitingRefine, null);
        assert.equal(f.controller.getState().refineGestureActive, false);
        assert.equal(f.range.value, "50"); assert.equal(f.number.value, "50");
        assert.match(f.statuses.at(-1), /ERROR:.*fixture Refine admission rejected/);
        assert.equal(f.range.disabled, false, "known request rejection must restore available controls");
    } finally { await f.dispose(); }
    f = await fixture(masked);
    try {
        await f.oneShot(75); await f.admitEnd();
        f.advance(51); await f.controller.refresh(); await flush();
        assert.equal(f.controller.getState().awaitingRefine, null);
        assert.equal(f.range.value, "50"); assert.equal(f.number.value, "50");
        assert.match(f.statuses.at(-1), /timed out/);
    } finally { await f.dispose(); }
    if (masked) {
        f = await fixture(true);
        try {
            await f.oneShot(75); const end = await f.admitEnd();
            f.confirm(50, end, { lastEditResult: { sequence: end.sequence, kind: "masking.tone_curve.refine_saturation.gesture.end",
                maskGroupId: f.snapshot().selectedMaskGroupId, outcome: "failed", detail: "fixture SDK rejected Refine" } });
            assert.equal(f.controller.getState().awaitingRefine, null);
            assert.match(f.statuses.at(-1), /ERROR:.*fixture SDK rejected Refine/);
            assert.equal(f.range.value, "50");
        } finally { await f.dispose(); }
    }
    for (const pendingAdmission of [false, true]) {
        f = await fixture(masked);
        try {
            await f.oneShot(75);
            if (!pendingAdmission) await f.admitEnd();
            f.context(masked ? { selectedMaskGroupId: "refine-mask-b", maskingRevision: 2 }
                : { selectedPhotoUuid: "refine-photo-b", contextCounter: 5 });
            await flush();
            if (pendingAdmission) await f.admitEnd();
            assert.equal(f.controller.getState().refineGestureActive, false);
            assert.equal(f.controller.getState().awaitingRefine, null, "late admission must not resurrect the previous photo/mask intention");
            assert.equal(f.controller.getState().authoritative, null);
            assert.equal(f.range.disabled, true);
            assert.equal(f.controller.applyAuthoritative(f.snapshot()), false, "obsolete photo/mask feedback must be rejected");
        } finally { await f.dispose(); }
    }
}

async function main() {
    const selected = process.argv.includes("--disabled-touch-only") ? [disabledTouch]
        : process.argv.includes("--handoff-only") ? [handoff]
        : process.argv.includes("--heartbeat-only") ? [heartbeat]
            : process.argv.includes("--ending-input-only") ? [endingInput]
                : process.argv.includes("--lifecycle-only") ? [lifecycle] : [handoff, heartbeat, endingInput, lifecycle, disabledTouch];
    const contexts = process.argv.includes("--masking-only") ? [true]
        : process.argv.includes("--normal-only") ? [false] : [false, true];
    for (const test of selected) for (const masked of contexts) {
        await test(masked);
        console.log(`PASS ${test.name}: ${masked ? "Masking" : "normal"} Refine Saturation production Controller (simulated HTTP/SDK feedback)`);
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
