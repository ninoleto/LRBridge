"use strict";
const assert = require("node:assert/strict");

// Extends the existing isolated Grain fixture; never connects to Lightroom.
function install(fixture) {
    const handle = fixture.handle;
    fixture.bumpDevelopOnWrite = true;
    fixture.history = { reads: 0, commands: [], entries: [], index: 0, dehaze: 0, sequence: 0 };
    const history = fixture.history;
    const snapshot = () => ({ values: { ...fixture.values }, dehaze: history.dehaze, maskIndex: fixture.maskIndex });
    const changed = () => { fixture.context.developCounter += 1; fixture.revision += 1; fixture.maskReadyAt = Date.now() + 900; };
    const remember = before => {
        history.entries.splice(history.index);
        history.entries.push({ before, after: snapshot() }); history.index += 1;
    };
    fixture.nativeEdit = value => { const before = snapshot(); history.dehaze = value; remember(before); changed(); };
    fixture.handle = function (url, reply) {
        if (url.pathname === "/api/history/state") {
            history.reads += 1;
            reply({ ok: true, state: { available: true, canUndo: history.index > 0, canRedo: history.index < history.entries.length } });
            return true;
        }
        if (url.pathname === "/api/command" && /^lightroom\.(undo|redo)$/.test(url.searchParams.get("command"))) {
            const command = url.searchParams.get("command"); history.commands.push(command);
            const next = command === "lightroom.undo" ? history.entries[--history.index].before : history.entries[history.index++].after;
            Object.assign(fixture.values, next.values); history.dehaze = next.dehaze; fixture.maskIndex = next.maskIndex;
            changed(); setTimeout(() => reply({ ok: true }), 200); return true;
        }
        if (url.pathname.startsWith("/api/masking/correction/gesture/")) {
            assert.equal(url.searchParams.get("parameter"), "local_Dehaze");
            assert.equal(url.searchParams.get("selectedPhotoUuid"), fixture.context.selectedPhotoUuid);
            const sequence = ++history.sequence;
            if (url.pathname.endsWith("/end")) {
                const before = snapshot(); history.dehaze = Number(url.searchParams.get("value")); remember(before);
                history.lastCorrectionResult = { parameter: "local_Dehaze", maskGroupId: "grain-mask-" + fixture.maskIndex,
                    sequence, outcome: "confirmed" };
                fixture.revision += 1;
            }
            reply({ ok: true, correctionSequence: sequence }); return true;
        }
        const before = snapshot();
        return handle(url, body => {
            if (url.pathname === "/api/masking/state") {
                body.corrections?.forEach(c => { if (c.parameter === "local_Dehaze") c.value = history.dehaze; });
                body.lastCorrectionResult = history.lastCorrectionResult || null;
            }
            if (["/api/set", "/api/reset"].includes(url.pathname)) { remember(before); changed(); }
            reply(body);
        });
    };
}

async function verify({ evaluate, waitFor, selectTab, fixture, setViewport }) {
    await setViewport(1280, 900);
    const history = fixture.history;
    const row = id => 'document.querySelector(\'[data-' + (id === "local_Dehaze" ? 'masking-correction' : 'slider-id') + '="' + id + '"]\')';
    const button = index => "document.querySelectorAll('[data-favorite-action]')[" + index + "]";
    async function available(undo, redo) {
        await waitFor(() => evaluate(button(0) + ".getAttribute('aria-disabled')==='" + !undo + "'&&" + button(1) + ".getAttribute('aria-disabled')==='" + !redo + "'"), "global history availability");
    }
    async function value(id, expected) {
        await waitFor(() => evaluate("(() => {const r=" + row(id) + ";return r&&!r.querySelector('input').disabled&&" +
            "Number(r.querySelector('input[type=text]').value)===" + expected + ";})()"), "authoritative " + id + "=" + expected);
    }
    async function observe(id) {
        await evaluate("(() => {const r=" + row(id) + ";r.scrollIntoView({block:'center'});" +
            "window.__historyGeometry=[];window.__historyObserving=true;const sample=()=>{const g=r.getBoundingClientRect();" +
            "__historyGeometry.push([document.scrollingElement.scrollTop,g.top,g.height,document.querySelector('#historyToolbar').getBoundingClientRect().height," +
            "document.scrollingElement.scrollHeight,document.querySelector('.masking-tone-curve').getBoundingClientRect().height,document.activeElement.outerHTML.slice(0,160)]);" +
            "if(__historyObserving)requestAnimationFrame(sample);};sample();})()");
    }
    async function stable() {
        const samples = await evaluate("(__historyObserving=false,__historyGeometry)");
        assert.ok(samples.length > 10);
        samples.forEach((sample, n) => sample.slice(0, 4).forEach((v, i) => assert.ok(Math.abs(v - samples[0][i]) < 0.5,
            "history geometry changed: " + JSON.stringify({ n, i, first: samples[0], sample, last: samples.at(-1) }))));
    }
    async function edit(id, next) {
        await evaluate("(() => {const n=" + row(id) + ".querySelector('input[type=text]');n.focus();n.value='" + next +
            "';n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()");
        await value(id, next); await available(true, false);
    }
    async function click(index, id, expected) {
        const count = history.commands.length;
        await evaluate(button(index) + ".click();" + button(index) + ".click()");
        await waitFor(async () => history.commands.length > count, "one native history command");
        await value(id, expected); await available(index === 0 ? history.index > 0 : true, index === 0);
        assert.equal(history.commands.length, count + 1, "duplicate clicks must submit exactly one command");
    }
    await value("local_Dehaze", 0);
    await observe("local_Dehaze");
    await edit("local_Dehaze", 18); await stable();
    await evaluate("window.__historyButtons=[...document.querySelectorAll('[data-favorite-action]')]");
    await observe("local_Dehaze");
    await click(0, "local_Dehaze", 0); await click(1, "local_Dehaze", 18); await stable();
    await observe("GrainSize");
    await edit("GrainSize", 38); await click(0, "GrainSize", 25); await click(1, "GrainSize", 38); await stable();
    for (const tab of ["sliders", "tone-curve", "color-grading", "presets", "selection", "application", "tools"]) {
        const reads = history.reads;
        await selectTab(tab);
        await waitFor(async () => history.reads > reads, "history poll on " + tab);
        await available(true, false);
        assert.equal(await evaluate("document.querySelectorAll('[data-favorite-action]').length===2&&" +
            "[...document.querySelectorAll('[data-favorite-action]')].every((b,i)=>b===__historyButtons[i])"), true);
    }
    await value("GrainSize", 38);
    // Native changes also update the one shared pair while another page is open.
    await selectTab("application"); fixture.nativeEdit(29); await available(true, false);
    await evaluate(button(0) + ".click()");
    await available(true, true); await selectTab("tools"); await value("local_Dehaze", 18);
    return { maskLocal: true, sharedGrain: true, tabs: 7, commands: history.commands.length, stableGeometry: true };
}
module.exports = { install, verify };
