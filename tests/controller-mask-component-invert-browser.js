"use strict";
const assert = require("node:assert/strict");
const types = require("../app/controller-masking-corrections").creationTypes;

async function verify({ evaluate, waitFor, fixture, setViewport, touch }) {
    const c = fixture.creation, handle = fixture.handle;
    c.inversionCalls = [];
    c.inversionStateReads = 0;
    fixture.handle = function(url, reply) {
        if (url.pathname === "/api/masking/component/invert") {
            const targetMaskId = "created-" + c.count, targetToolId = c.componentSelectedId;
            assert.equal(url.searchParams.get("selectedMaskGroupId"), targetMaskId);
            assert.equal(url.searchParams.get("selectedMaskToolId"), targetToolId);
            assert.equal(url.searchParams.get("selectedPhotoUuid"), fixture.context.selectedPhotoUuid);
            assert.equal(url.searchParams.get("stateRevision"), String(fixture.revision),
                "inversion admission: " + JSON.stringify({ stage: c.inversionStage, calls: c.inversionCalls.length, pending: c.pending }));
            assert.equal(c.pending, null);
            const before = c.inverted, photo = fixture.context.selectedPhotoUuid;
            c.inversionCalls.push({ targetMaskId, targetToolId }); fixture.revision += 1;
            c.pending = { operationId: "mo-" + (400 + c.inversionCalls.length), kind: "invertComponent",
                beforeSelectedMaskId: targetMaskId, beforeSelectedMaskToolId: targetToolId };
            const admission = { ok: true, serverEpoch: "grain-fixture", revision: fixture.revision,
                operationId: c.pending.operationId, pendingOperation: { ...c.pending } };
            const finish = () => {
                if (photo !== fixture.context.selectedPhotoUuid) return;
                const stale = c.count !== Number(targetMaskId.split("-")[1]) || targetToolId !== c.componentSelectedId;
                if (!stale && typeof before === "boolean") {
                    c.inverted = !before;
                    c.history.splice(c.historyIndex);
                    c.history.push({ before: c.count, after: c.count, invertedBefore: before, invertedAfter: c.inverted });
                    c.historyIndex += 1;
                }
                c.last = { operationId: admission.operationId, targetMaskId, targetToolId,
                    outcome: stale ? "stale" : typeof before === "boolean" ? "confirmed" : "requested" };
                if (c.badInversionTarget) c.last.targetToolId = "wrong-target";
                c.pending = null; fixture.revision += 1;
            };
            const admit = () => { reply(admission); if (c.holdInversion) c.releaseInversion = finish; else setTimeout(finish, 300); };
            if (c.holdInversionAdmission) c.releaseInversionAdmission = admit; else admit();
            return true;
        }
        if (url.pathname === "/api/command" && /^lightroom\.(undo|redo)$/.test(url.searchParams.get("command"))) {
            const undo = url.searchParams.get("command") === "lightroom.undo";
            const entry = c.history[undo ? c.historyIndex - 1 : c.historyIndex];
            if (entry && typeof entry.invertedBefore === "boolean") c.inverted = undo ? entry.invertedBefore : entry.invertedAfter;
        }
        return handle(url, body => {
            if (url.pathname === "/api/masking/state") {
                c.inversionStateReads += 1;
                Object.assign(body, { selectedMaskToolType: body.selectedMaskToolAvailable ? c.inversionType : null,
                    selectedMaskToolSubtype: body.selectedMaskToolAvailable ? c.inversionSubtype : null,
                    selectedMaskToolInverted: body.selectedMaskToolAvailable ? c.inverted : null });
                c.lastState = JSON.parse(JSON.stringify(body));
            }
            reply(body);
        });
    };
    const checkbox = ".masking-component-invert-checkbox", button = ".masking-component-invert-button";
    const status = () => evaluate("document.querySelector('.masking-status').textContent");
    const ready = () => waitFor(() => evaluate("!document.querySelector('" + button + "').disabled"), "component inversion available");
    const checked = value => waitFor(() => evaluate("document.querySelector('" + checkbox + "').checked===" + value), "authoritative inversion " + value);
    const setup = async (value = false) => {
        const reads = c.inversionStateReads;
        c.active = true; c.count = 2; c.componentIds = ["a", "b"]; c.componentSelectedId = "a"; c.componentCount = 2;
        c.inverted = value; c.inversionType = "brush"; c.inversionSubtype = null; c.pending = c.last = null;
        c.selectionUnavailable = false; fixture.revision += 1;
        await waitFor(() => c.inversionStateReads > reads + 1 && c.lastState && c.lastState.revision === fixture.revision,
            "fresh component inversion state consumed by the controller"); await ready();
        await waitFor(() => evaluate("document.querySelector('.masking-component-invert-label').hidden===" + (value === null)), "inversion control reflects native readability");
        if (typeof value === "boolean") await checked(value);
    };
    await setup();
    assert.equal(await evaluate("document.querySelector('.masking-component-heading').textContent"), "Brush");
    assert.equal(await evaluate("(() => {const p=document.querySelector('.masking-component-controls');return p.previousElementSibling.classList.contains('masking-component-actions') && Boolean(p.compareDocumentPosition(document.querySelector('.masking-corrections'))&Node.DOCUMENT_POSITION_FOLLOWING);})()"), true);
    await evaluate("window.__inversionPanel=document.querySelector('.masking-component-controls');window.__inversionCheckbox=document.querySelector('" + checkbox + "')");
    for (const [width, height] of [[1280, 900], [768, 1024], [390, 640], [320, 480]]) {
        c.inversionStage = "touch-" + width;
        await setup(); await setViewport(width, height);
        await evaluate("document.querySelector('.masking-component-controls').scrollIntoView({block:'center'})");
        await new Promise(resolve => setTimeout(resolve, 100));
        const p = await evaluate("(() => {const r=document.querySelector('.masking-component-invert-label').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,height:r.height};})()");
        assert.ok(p.height >= 56);
        c.holdInversion = true; c.releaseInversion = null;
        await evaluate("window.__inversionFrames=[];window.__inversionObserve=true;requestAnimationFrame(function sample(){__inversionFrames.push([document.scrollingElement.scrollTop,document.querySelector('.masking-component-controls').getBoundingClientRect().top]);if(__inversionObserve)requestAnimationFrame(sample)})");
        const calls = c.inversionCalls.length;
        await touch("touchStart", p.x, p.y); await touch("touchEnd", p.x, p.y);
        await waitFor(() => Boolean(c.releaseInversion), "held inversion result");
        await evaluate("document.querySelector('" + checkbox + "').click()");
        assert.equal(await evaluate("document.querySelector('" + checkbox + "').checked"), false, "pending checkbox is never optimistic");
        assert.equal(c.inversionCalls.length, calls + 1, "duplicate click is suppressed");
        c.releaseInversion(); await checked(true); await ready(); c.holdInversion = false;
        await waitFor(async () => (await status()).includes("Component inversion confirmed by Lightroom"), "confirmed inversion");
        const frames = await evaluate("(__inversionObserve=false,__inversionFrames)");
        frames.forEach(frame => frame.forEach((value, i) => assert.ok(Math.abs(value - frames[0][i]) < 1, "inversion retains page position at " + width)));
        for (const [index, value] of [[0, false], [1, true]]) {
            const h = "document.querySelectorAll('#historyToolbar button')[" + index + "]";
            await waitFor(() => evaluate("!" + h + ".disabled"), "shared history available after inversion");
            await evaluate(h + ".click();" + h + ".click()"); await checked(value);
        }
    }
    for (const type of types) {
        c.inversionType = type.maskType; c.inversionSubtype = type.maskSubtype; fixture.revision += 1;
        const label = (type.maskType === "aiSelection" ? "Select " : "") + type.label;
        await waitFor(() => evaluate("document.querySelector('.masking-component-heading').textContent===" + JSON.stringify(label)), "inventory component heading " + label);
    }
    c.componentSelectedId = "b"; c.inverted = false; fixture.revision += 1; await checked(false);
    assert.doesNotMatch(await status(), /inversion confirmed/, "old-component confirmation is cleared");
    assert.equal(await evaluate("__inversionPanel===document.querySelector('.masking-component-controls')&&__inversionCheckbox===document.querySelector('" + checkbox + "')"), true, "selection feedback updates the same elements");
    await setup(null);
    assert.equal(await evaluate("document.querySelector('.masking-component-invert-label').hidden&&!document.querySelector('" + button + "').hidden"), true);
    await evaluate("document.querySelector('" + button + "').click();document.querySelector('" + button + "').click()");
    await waitFor(async () => (await status()).includes("Inversion requested; Lightroom did not supply a readable prior inversion state"), "honest action-only outcome");
    assert.doesNotMatch(await status(), /confirmed/);
    c.inversionType = "futureTool"; fixture.revision += 1;
    await waitFor(() => evaluate("document.querySelector('.masking-component-heading').textContent==='Selected Component'"), "unknown type has no invented heading");
    c.componentSelectedId = null; fixture.revision += 1;
    await waitFor(() => evaluate("document.querySelector('" + button + "').disabled"), "no component disables inversion");
    for (const changed of ["photo", "mask", "component"]) {
        c.inversionStage = "context-" + changed;
        await setup(); c.holdInversionAdmission = true; c.holdInversion = true; c.releaseInversionAdmission = null;
        await evaluate("document.querySelector('" + checkbox + "').click()");
        await waitFor(() => Boolean(c.releaseInversionAdmission), "held original component admission");
        const old = { ...c.lastState, revision: fixture.revision + 2, pendingOperation: null,
            selectedMaskToolInverted: true, lastResult: { operationId: c.pending.operationId, outcome: "confirmed",
                targetMaskId: "created-2", targetToolId: "a" } };
        if (changed === "photo") {
            fixture.context.selectedPhotoUuid = fixture.context.selectedPhotoKey = "inversion-other-photo";
            fixture.context.contextCounter += 1; c.pending = c.last = null;
        } else if (changed === "mask") c.count = 3; else c.componentSelectedId = "b";
        fixture.revision += 1;
        const reads = fixture.contextReads;
        await waitFor(() => fixture.contextReads > reads + 1, "changed inversion context");
        c.releaseInversionAdmission(); c.releaseInversion();
        if (changed === "photo") {
            c.staleFeedback = old; await waitFor(() => c.staleFeedback === null, "old-photo inversion result discarded");
            assert.doesNotMatch(await status(), /inversion confirmed/);
        } else await waitFor(async () => (await status()).includes("changed during inversion"), "inversion target became stale");
        await checked(false); c.holdInversion = c.holdInversionAdmission = false;
    }
    await setup(); c.badInversionTarget = true;
    c.inversionStage = "bad-result-target";
    await evaluate("document.querySelector('" + checkbox + "').click()");
    await waitFor(async () => (await status()).includes("could not confirm component inversion"), "wrong result IDs cannot confirm inversion");
    c.badInversionTarget = false;
    return { headings: 12, authoritativeCheckbox: true, actionFallback: true, history: true, touchPagePosition: true,
        duplicateGuard: true, selectionInPlace: true, photoMaskComponentCancellation: true, resultTargets: true };
}
module.exports = { verify };
