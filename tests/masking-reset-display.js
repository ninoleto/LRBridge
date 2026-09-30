"use strict";

// Replay the recorded -14 -> old -28 Reset handoff against the production
// Controller/state machine. SDK completions are simulated; no live bridge calls.
const assert = require("node:assert/strict");
const { harness } = require("./masking-correction-confirmation");
const { flushAsync } = require("./masking");

function displayed(control, value, message) {
    assert.equal(control.range.value, String(value), message + " (range)");
    assert.equal(control.number.value, String(value), message + " (number)");
}

async function captured(h, parameter = "local_Grain") {
    await h.drag(-28, parameter);
    h.complete(h.last());
    await h.refresh();
    await h.drag(-14, parameter);
    h.complete(h.last()); // Written in Lightroom, but not yet received by the browser.
    const control = h.control(parameter);
    displayed(control, -14, "latest displayed user input");
    return control;
}

const cases = {
    async capturedResetHandoff(h) {
        const control = await captured(h);
        const admission = h.hold("reset");
        control.reset.click();
        displayed(control, -14, "Reset must not expose the captured older -28 parent");
        await flushAsync();
        const reset = h.last("reset");
        assert.equal(reset.command.value, undefined, "the held display is not sent as a Reset value");
        await h.clock.advance(9);
        await h.refresh(); // The recorded preceding -14 confirmation arrives.
        displayed(control, -14, "preceding edit cannot settle or replace pending Reset");
        assert.notEqual(control.status.textContent, "", "admission is not native confirmation");
        admission.resolve(); await flushAsync(20);
        assert.equal(control.status.textContent, "Resetting…");
        await h.compatibleDevelop();
        await h.clock.advance(600);
        displayed(control, -14, "delayed Reset keeps its display through compatible Grain feedback");
        assert.equal(control.status.textContent, "Resetting…");
        h.complete(reset, "confirmed", 0); await h.refresh();
        displayed(control, 0, "native Reset confirmation supplies the replacement");
        assert.equal(control.status.textContent, "");
        assert.deepEqual(h.requests.map(r => r.kind), ["begin", "end", "begin", "end", "reset"],
            "display ownership introduces no edits, retries or changed command order");
    },
    async confirmedNonzeroReset(h) {
        const control = await captured(h);
        control.reset.click(); await flushAsync(20);
        displayed(control, -14, "pending Reset does not assume zero");
        h.complete(h.last("reset"), "confirmed", 37); await h.refresh();
        displayed(control, 37, "use the SDK's actual Reset value, including nonzero");
        assert.equal(control.status.textContent, "");
    },
    async newerAdjustmentOwnsDisplay(h) {
        const control = await captured(h);
        const admission = h.hold("reset");
        control.reset.click(); await flushAsync();
        const reset = h.last("reset");
        h.start(42, "local_Grain"); await flushAsync();
        h.complete(reset, "confirmed", 0); await h.refresh();
        displayed(control, 42, "old Reset result cannot overwrite newer held input");
        admission.resolve(); await flushAsync(20);
        await h.clock.advance(3000);
        displayed(control, 42, "late Reset admission/deadline cannot reacquire ownership");
        assert.equal(control.status.textContent, "Updating…");
        await h.end("local_Grain");
        assert.equal(h.last().command.value, 42);
        assert.ok(h.last().command.correctionSequence > reset.command.correctionSequence);
        h.complete(h.last()); await h.refresh();
        displayed(control, 42, "newest edit reaches confirmation");
        assert.equal(control.status.textContent, "");
    },
    async latestSdkFailure(h) {
        const control = await captured(h);
        control.reset.click(); await flushAsync(20);
        const reset = h.last("reset");
        h.complete(reset, "failed"); await h.refresh();
        assert.match(control.status.textContent, /SDK correction failure/);
        assert.equal(control.row.classList.contains("error"), true);
        displayed(control, -14, "failed Reset returns to real feedback");
        await h.drag(18, "local_Grain"); h.complete(h.last()); await h.refresh();
        displayed(control, 18, "failure does not leave a held Reset value");
        assert.equal(control.status.textContent, "");
    },
    async latestAdmissionFailure(h) {
        const control = await captured(h);
        const admission = h.hold("reset", 500);
        control.reset.click(); await flushAsync();
        admission.resolve(); await flushAsync(20);
        assert.match(control.status.textContent, /could not receive/);
        displayed(control, -14, "HTTP failure releases the display to SDK state");
    },
    async missingConfirmationStillTimesOut(h) {
        const control = await captured(h);
        control.reset.click(); await flushAsync(20);
        const reset = h.last("reset");
        await h.clock.advance(2999);
        displayed(control, -14, "pending Reset remains held, not successful");
        assert.equal(control.status.textContent, "Resetting…");
        await h.clock.advance(1);
        assert.match(control.status.textContent, /did not confirm.*in time/);
        h.complete(reset, "confirmed", 19); await h.refresh();
        displayed(control, 19, "late genuine Reset confirmation can recover");
        assert.equal(control.status.textContent, "");
    },
    async maskChange(h) {
        const control = await captured(h, "local_Texture");
        control.reset.click(); await flushAsync(20);
        await h.changeMask("new-mask"); await h.external(72);
        displayed(control, 72, "old mask Reset cannot hold the new mask's display");
        await h.clock.advance(3000);
        assert.doesNotMatch(control.status.textContent, /in time/);
    },
    async photoChange(h) {
        const control = await captured(h, "local_Texture");
        control.reset.click(); await flushAsync(20);
        await h.changePhoto(); await h.external(73);
        displayed(control, 73, "old photo Reset cannot hold the new photo's display");
        await h.clock.advance(3000);
        assert.doesNotMatch(control.status.textContent, /in time/);
    },
    async externalDevelopChange(h) {
        const control = await captured(h, "local_Texture");
        control.reset.click(); await flushAsync(20);
        await h.advanceDevelop(); await h.catchUpContext(); await h.external(74);
        displayed(control, 74, "unproven Develop change invalidates old Reset ownership");
        await h.clock.advance(3000);
        assert.doesNotMatch(control.status.textContent, /in time/);
    },
    async unavailableControl(h) {
        const control = await captured(h);
        control.reset.click(); await flushAsync(20);
        await h.unavailable(); await h.clock.advance(3000);
        assert.equal(control.range.disabled, true);
        assert.equal(control.reset.disabled, true);
        assert.doesNotMatch(control.status.textContent, /in time/);
    }
};

async function main() {
    let failures = 0;
    for (const [name, work] of Object.entries(cases)) {
        const h = await harness();
        try { await work(h); console.log("PASS " + name); }
        catch (error) { failures++; console.error("FAIL " + name + ": " + error.message); }
        finally { h.close(); }
    }
    if (failures) throw new Error(failures + " Masking Reset display regression(s) failed");
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { cases, main };
