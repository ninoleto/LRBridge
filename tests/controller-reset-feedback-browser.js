"use strict";
const assert = require("node:assert/strict");

// Isolated browser fixture only. Reset defaults deliberately differ from zero to catch optimistic UI.
function install(fixture) {
    Object.assign(fixture.values, { Exposure: 2, Contrast: 31, Highlights: 44, DefringePurpleHueLo: 10, DefringePurpleHueHi: 90 });
    const state = fixture.resetFeedback = { active: false, holdBroad: false, held: [], requests: [], responses: [], resets: [],
        defaults: { Exposure: 0.25, Contrast: 7, Highlights: 11, DefringePurpleHueLo: 30, DefringePurpleHueHi: 70 },
        targetDelay: 100, holdTargets: false, heldTargets: [], invalidateTargets: 0, invalidated: [],
        serializedTargets: false, targetReadyAt: 0, sdkSerial: false, sdkReadyAt: 0,
        rebindQueuedTargets: 0, invalidateDispatchedTargets: 0, staleDispatchIds: [],
        nextDeliveryRace: false, deliveryRaces: new Map(), resetExecutionDelay: 0, executedResets: [], resetExecutorReadyAt: 0 };
    const previous = fixture.handle;
    fixture.handle = (url, reply) => {
        const route = url.pathname;
        if (route === "/api/reset" && Object.hasOwn(state.defaults, url.searchParams.get("slider"))) {
            const slider = url.searchParams.get("slider"), at = Date.now();
            state.resets.push({ slider, at });
            const execute = () => {
                fixture.values[slider] = state.defaults[slider];
                state.executedResets.push({ slider, at: Date.now() });
            };
            if (state.resetExecutionDelay) {
                state.resetExecutorReadyAt = Math.max(Date.now(), state.resetExecutorReadyAt) + state.resetExecutionDelay;
                setTimeout(execute, state.resetExecutorReadyAt - Date.now());
            } else execute();
            reply({ ok: true });
            return true;
        }
        if (["/api/feedback/request", "/api/feedback/request-many"].includes(route)) {
            return previous(url, body => {
                const sliders = (url.searchParams.get("sliders") || url.searchParams.get("slider")).split(",");
                if (state.active) state.requests.push({ id: body.request.id, sliders, at: Date.now(),
                    developCounter: fixture.context.developCounter });
                if (state.nextDeliveryRace && sliders.length === 1) {
                    state.nextDeliveryRace = false;
                    const snapshot = fixture.snapshots.get(String(body.request.id));
                    const results = snapshot.results;
                    snapshot.context = { ...fixture.context };
                    snapshot.results = {};
                    snapshot.complete = false;
                    const race = { snapshot, expired: false, waiter: null };
                    state.deliveryRaces.set(String(snapshot.id), race);
                    setTimeout(() => {
                        snapshot.results = results;
                        snapshot.complete = true;
                        snapshot.completedAt = Date.now();
                        if (race.waiter) race.waiter({ ok: true, snapshot });
                        // Captured completion-to-invalidation interval was 15ms.
                        setTimeout(() => {
                            race.expired = true;
                            fixture.context.developCounter += 1;
                            fixture.context.developChangedAt = Date.now();
                        }, 15);
                    }, 25);
                }
                if (state.sdkSerial) {
                    // Model FIFO SDK reads, including a slow normal full-panel read.
                    // A later click must be admitted while an earlier result is pending.
                    const snapshot = fixture.snapshots.get(String(body.request.id));
                    const captured = snapshot.results;
                    snapshot.results = {};
                    snapshot.complete = false;
                    state.sdkReadyAt = Math.max(Date.now(), state.sdkReadyAt) + (sliders.length > 5 ? 750 : 350);
                    setTimeout(() => {
                        snapshot.results = captured;
                        snapshot.complete = true;
                        snapshot.completedAt = Date.now();
                        state.responses.push({ id: snapshot.id, at: Date.now() });
                    }, state.sdkReadyAt - Date.now());
                }
                reply(body);
            });
        }
        if (route === "/api/feedback/snapshot") {
            const race = state.deliveryRaces.get(url.searchParams.get("id"));
            if (race) {
                if (race.expired) {
                    state.invalidated.push(race.snapshot.id);
                    reply({ ok: false, error: "Unknown feedback snapshot" }, 404);
                } else if (!race.snapshot.complete && url.searchParams.get("wait") === "1") race.waiter = reply;
                else reply({ ok: true, snapshot: race.snapshot });
                return true;
            }
            const snapshot = fixture.snapshots.get(url.searchParams.get("id"));
            if (state.sdkSerial) { reply({ ok: true, snapshot }); return true; }
            const broad = snapshot && Object.keys(snapshot.results).length > 5;
            if (state.active && broad && state.holdBroad) {
                state.held.push(() => reply({ ok: true, snapshot }));
                return true;
            }
            if (state.active && !broad) {
                if (state.invalidateTargets > 0) {
                    state.invalidateTargets -= 1;
                    state.invalidated.push(snapshot.id);
                    fixture.context.developCounter += 1;
                    fixture.context.developChangedAt = Date.now();
                    setTimeout(() => reply({ ok: false, error: "Unknown feedback snapshot" }, 404), 30);
                    return true;
                }
                if (state.holdTargets) {
                    state.heldTargets.push({ id: snapshot.id, release: invalid => {
                        if (invalid) {
                            state.invalidated.push(snapshot.id);
                            reply({ ok: false, error: "Unknown feedback snapshot" }, 404);
                        } else reply({ ok: true, snapshot });
                    } });
                    return true;
                }
                const responseDelay = state.serializedTargets
                    ? (state.targetReadyAt = Math.max(Date.now(), state.targetReadyAt) + 250) - Date.now()
                    : state.targetDelay;
                setTimeout(() => {
                    if (state.rebindQueuedTargets > 0 || state.invalidateDispatchedTargets > 0) {
                        if (state.rebindQueuedTargets > 0) {
                            state.rebindQueuedTargets -= 1;
                            fixture.context.developCounter += 1;
                            fixture.context.developChangedAt = Date.now();
                        }
                        snapshot.context = { ...fixture.context };
                        if (state.invalidateDispatchedTargets > 0) {
                            state.invalidateDispatchedTargets -= 1;
                            state.staleDispatchIds.push(snapshot.id);
                            fixture.context.developCounter += 1;
                            fixture.context.developChangedAt = Date.now();
                        }
                    }
                    state.responses.push({ id: snapshot.id, at: Date.now() });
                    reply({ ok: true, snapshot });
                }, responseDelay);
                return true;
            }
        }
        return previous(url, reply);
    };
}

async function verify({ evaluate, waitFor, selectTab, fixture }) {
    const state = fixture.resetFeedback, ids = ["Exposure", "Contrast", "Highlights"];
    const defaults = Object.fromEntries(ids.map(id => [id, state.defaults[id]]));
    const values = () => evaluate(`Object.fromEntries(${JSON.stringify(ids)}.map(id=>[id,Number(document.querySelector('[data-slider-id="'+id+'"] input[type=text]').value)]))`);
    await selectTab("sliders");
    await waitFor(async () => (await values()).Exposure === 2, "initial authoritative Tone values");
    await evaluate(`window.__resetEvents=[];
        const originalApply=applyDevelopSliderFeedbackIfChanged;
        applyDevelopSliderFeedbackIfChanged=function(control,result){
            originalApply(control,result);
            if(${JSON.stringify(ids)}.includes(control.definition.id)) window.__resetEvents.push({at:Date.now(),slider:control.definition.id,id:result.id,value:control.localValue});
        };`);
    state.active = true;
    // Actual failed live sequence: staggered clicks, not simultaneous clicks inside
    // one mocked read. Keep the normal poll running and observe the browser DOM.
    state.sdkSerial = true;
    const staggeredStart = Date.now();
    await evaluate(`(async()=>{
        const reset=id=>document.querySelector('[data-slider-id="'+id+'"] button.reset').click();
        reset('Exposure');
        setTimeout(()=>requestLiveFeedbackSnapshot(false), 200);
        await sleep(284); reset('Contrast');
        await sleep(267); reset('Highlights');
    })()`);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, staggeredStart + 1500 - Date.now())));
    const staggeredEvents = await evaluate("window.__resetEvents");
    const staggeredTimings = state.resets.map(reset => {
        const read = state.requests.find(r => r.at >= reset.at && r.sliders.length <= 3 && r.sliders.includes(reset.slider));
        const applied = staggeredEvents.find(e => e.at >= reset.at && e.slider === reset.slider && e.value === state.defaults[reset.slider]);
        return { slider: reset.slider, requestMs: read ? read.at - reset.at : null,
            renderMs: applied ? applied.at - reset.at : null };
    });
    console.log("Staggered FIFO Reset reproduction: " + JSON.stringify(staggeredTimings));
    for (const timing of staggeredTimings) {
        assert(timing.requestMs !== null && timing.requestMs < 150, "A later Reset must not wait for an earlier read: " + timing.slider);
        assert(timing.renderMs !== null && timing.renderMs < 800, "No accumulated full-panel wait for " + timing.slider);
    }
    assert.deepEqual(state.resets.map(reset => reset.slider), ids, "Keep all three staggered Reset edits");
    const staggeredResponses = state.responses.slice();
    for (const event of staggeredEvents.filter(event => event.value === defaults[event.slider])) {
        const result = staggeredResponses.find(response => response.id === event.id);
        assert(result && event.at >= result.at, "The simulated SDK must return each Reset value before it is displayed");
    }
    state.sdkSerial = false;
    Object.assign(fixture.values, { Exposure: 2, Contrast: 31, Highlights: 44 });
    await evaluate("void requestLiveFeedbackSnapshot(true)");
    await waitFor(async () => (await values()).Exposure === 2 && (await values()).Highlights === 44, "restore isolated fixture values");
    state.requests.length = state.responses.length = state.resets.length = 0;
    await evaluate("window.__resetEvents=[]");
    state.holdBroad = true;
    await evaluate("void requestLiveFeedbackSnapshot(true)");
    await waitFor(() => state.held.length > 0, "one normal broad snapshot already in flight");
    const started = Date.now();
    await evaluate(`(async()=>{for(const id of ${JSON.stringify(ids)}){
        document.querySelector('[data-slider-id="'+id+'"] button.reset').click();
        await new Promise(resolve=>setTimeout(resolve,40));
    }})()`);
    assert.deepEqual(state.resets.map(r => r.slider), ids, "Every rapid Reset is submitted once, in click order");
    // Release the old full snapshot after a slow read. A reset-specific request can bypass this browser wait.
    const remaining = Math.max(0, started + 750 - Date.now());
    await new Promise(resolve => setTimeout(resolve, remaining));
    const beforeRelease = await values();
    state.holdBroad = false;
    state.held.splice(0).forEach(release => release());
    await waitFor(async () => JSON.stringify(await values()) === JSON.stringify(defaults), "authoritative reset results");
    const events = await evaluate("window.__resetEvents");
    const timings = state.resets.map(reset => {
        const read = state.requests.find(r => r.at >= reset.at && r.sliders.includes(reset.slider));
        const rendered = events.find(e => e.at >= reset.at && e.slider === reset.slider && e.value === state.defaults[reset.slider]);
        return { slider: reset.slider, requestDelayMs: read.at - reset.at, requestToRenderMs: rendered.at - read.at,
            resetToRenderMs: rendered.at - reset.at, requestedSliders: read.sliders.length };
    });
    console.log("Reset timing fixture: " + JSON.stringify(timings));
    if (process.env.LRBRIDGE_RESET_BASELINE === "1") return { resetFeedbackBaseline: true, timings };
    assert.deepEqual(beforeRelease, defaults, "Reset values must arrive without waiting for the full-panel snapshot");
    for (const timing of timings) {
        assert(timing.requestDelayMs < 200, "No fixed 300ms delay or normal-poll wait for " + timing.slider);
        assert(timing.requestedSliders <= ids.length, "Read only pending reset sliders");
        const resetRead = state.requests.find(r => r.at >= state.resets.find(reset => reset.slider === timing.slider).at && r.sliders.includes(timing.slider));
        assert(resetRead.sliders.every(slider => ids.includes(slider)), "Do not request the full panel for a Reset");
        assert(timing.resetToRenderMs < 500, "Prompt authoritative reset feedback for " + timing.slider);
        const response = state.responses.find(r => r.id === events.find(e => e.slider === timing.slider && e.value === state.defaults[timing.slider]).id);
        assert(response, "Reset display must come from a returned SDK result");
        assert(events.filter(e => e.slider === timing.slider && e.at < response.at)
            .every(e => e.value !== state.defaults[timing.slider]), "Never display an unconfirmed reset default");
        const first = events.findIndex(e => e.slider === timing.slider && e.value === state.defaults[timing.slider]);
        assert(events.slice(first).filter(e => e.slider === timing.slider).every(e => e.value === state.defaults[timing.slider]),
            "An older broad snapshot must not roll back reset feedback");
    }
    assert.equal(state.resets.length, 3, "Readback must never replay any Reset command");
    await evaluate(`document.querySelector('[data-slider-id="Exposure"] button.reset').click();
        document.querySelector('[data-slider-id="Exposure"] button.reset').click();`);
    await waitFor(() => state.resets.length === 5, "both repeated Reset actions retained");
    assert.deepEqual(state.resets.map(r => r.slider), ids.concat(["Exposure", "Exposure"]));
    await evaluate(`document.querySelector('[aria-label="Reset both Purple Hue endpoints"]').click()`);
    await waitFor(() => state.resets.length === 7, "both compound Reset actions retained");
    assert.deepEqual(state.resets.slice(-2).map(r => r.slider), ["DefringePurpleHueLo", "DefringePurpleHueHi"]);
    await waitFor(() => evaluate("developSliderControls.DefringePurpleHueLo.localValue === 30 && developSliderControls.DefringePurpleHueHi.localValue === 70"),
        "authoritative compound reset results");
    for (const reset of state.resets.slice(-2)) {
        const read = state.requests.find(r => r.at >= reset.at && r.sliders.length <= 3 && r.sliders.includes(reset.slider));
        assert(read && read.at - reset.at < 200, "Prompt targeted feedback for both compound endpoints");
    }
    // Cross a complete photo/context boundary while a targeted result is delayed.
    fixture.values.Exposure = 8;
    state.holdTargets = true;
    const requestsBeforeNavigation = state.requests.length;
    await evaluate("void requestDevelopSliderResetFeedback(developSliderControls.Exposure)");
    await waitFor(() => state.requests.slice(requestsBeforeNavigation).some(request =>
        request.sliders.includes("Exposure") && state.heldTargets.some(held => held.id === request.id)),
    "this delayed targeted old-photo feedback, not a previous Reset's remaining read");
    Object.assign(fixture.context, { selectedPhotoUuid: "reset-photo-b", selectedPhotoKey: "reset-photo-b",
        contextCounter: fixture.context.contextCounter + 1, contextChangedAt: Date.now() });
    fixture.values.Exposure = 0.75;
    fixture.requestId = 10; // The old floor must not block a new context with lower request IDs.
    await waitFor(() => evaluate("lastControllerSelectedPhotoUuid === 'reset-photo-b'"), "new photo context");
    state.holdTargets = false;
    const staleIds = state.heldTargets.map(held => held.id);
    state.heldTargets.splice(0).forEach(held => held.release());
    await waitFor(async () => (await values()).Exposure === 0.75, "new photo authoritative feedback");
    assert.equal(await evaluate(`window.__resetEvents.some(event => ${JSON.stringify(staleIds)}.includes(event.id))`), false,
        "Late targeted feedback must be rejected after photo/context changes");
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(state.requests.slice(requestsBeforeNavigation).filter(r => r.sliders.length === 1 && r.sliders[0] === "Exposure").length, 1,
        "Do not carry old-photo Reset read retries into a new photo/context");
    assert.equal(state.resets.length, 7, "Feedback/context recovery must not replay Reset commands");
    // The real failure also retried with an old browser revision while the server
    // had already advanced. Observe the binding at the actual read request.
    await evaluate(`window.__resetBindings=[];
        const resetFetch=window.fetch;
        window.fetch=function(input,options){
            if(String(input).startsWith('/api/feedback/request')) window.__resetBindings.push({
                url:String(input), at:Date.now(), developCounter:lastControllerDevelopCounter});
            return resetFetch.apply(this,arguments);
        };`);
    await evaluate("pollControllerContext()");
    fixture.context.developCounter += 1;
    fixture.context.developChangedAt = Date.now();
    const freshRevision = fixture.context.developCounter;
    const contextReadStart = state.requests.length;
    await evaluate("void requestDevelopSliderResetFeedback(developSliderControls.Exposure)");
    await waitFor(() => state.requests.slice(contextReadStart).some(r => r.sliders.length === 1 && r.sliders[0] === 'Exposure'),
        "reset read after authoritative revision advances");
    const freshBinding = (await evaluate("window.__resetBindings")).find(r => r.url === '/api/feedback/request?slider=Exposure&purpose=reset');
    assert.equal(freshBinding.developCounter, freshRevision,
        "A new Reset read must capture the current server revision before requesting feedback");
    await new Promise(resolve => setTimeout(resolve, 150));
    // Real rapid resets advance Develop revisions and invalidate queued reads. Keep
    // the normal full-panel poll busy so only renewed targeted demand can recover.
    state.holdBroad = true;
    await evaluate("void requestLiveFeedbackSnapshot(true)");
    await waitFor(() => state.held.length > 0, "normal poll held during revision invalidation");
    state.invalidateTargets = 2;
    const retryStarted = Date.now(), requestsBeforeRetry = state.requests.length;
    await evaluate(`document.querySelector('[data-slider-id="Exposure"] button.reset').click()`);
    await new Promise(resolve => setTimeout(resolve, 900));
    assert.equal((await values()).Exposure, state.defaults.Exposure,
        "Reset readback invalidated by Develop revisions must renew without waiting for the full-panel poll");
    assert.equal(state.invalidated.length, 2, "Exercise two successive invalidated reads");
    const renewed = state.requests.slice(requestsBeforeRetry).filter(r => r.sliders.length === 1 && r.sliders[0] === "Exposure");
    assert(renewed.length >= 3 && renewed.length <= 4, "Bounded targeted read recovery");
    assert.equal(state.resets.length, 8, "Only feedback reads may retry; never replay the Reset edit");
    assert.equal(await evaluate(`window.__resetEvents.some(event => ${JSON.stringify(state.invalidated)}.includes(event.id))`), false,
        "Invalidated results must never be applied");
    const revisionRender = (await evaluate("window.__resetEvents")).find(event => event.at >= retryStarted && event.slider === "Exposure" && event.value === state.defaults.Exposure);
    console.log("Reset revision recovery: " + JSON.stringify({ reads: renewed.length, resetToRenderMs: revisionRender.at - retryStarted }));
    const requestsBeforeExpiry = state.requests.length;
    state.invalidateTargets = 99;
    await evaluate(`document.querySelector('[data-slider-id="Exposure"] button.reset').click()`);
    await new Promise(resolve => setTimeout(resolve, 900));
    assert.equal(state.requests.slice(requestsBeforeExpiry).filter(r => r.sliders.length === 1 && r.sliders[0] === "Exposure").length, 4,
        "Continually invalidated Reset reads must stop after four attempts");
    assert.equal(state.resets.length, 9, "Retry exhaustion must preserve exactly one Reset edit");
    state.invalidateTargets = 0;
    state.holdBroad = false;
    state.held.splice(0).forEach(release => release());
    // The SDK consumes read requests serially. Invalidating a rapid group must not
    // turn its retry demand into three separate waits behind each other.
    Object.assign(fixture.values, { Exposure: 2, Contrast: 31, Highlights: 44 });
    await evaluate("pollControllerContext()");
    await evaluate("void requestLiveFeedbackSnapshot(true)");
    await waitFor(async () => (await values()).Exposure === 2, "nonzero values before serialized-read test");
    state.holdBroad = true;
    state.holdTargets = true;
    await evaluate("void requestLiveFeedbackSnapshot(true)");
    await waitFor(() => state.held.length > 0, "normal poll held during serial SDK reads");
    await evaluate(`(async()=>{for(const id of ${JSON.stringify(ids)}){
        document.querySelector('[data-slider-id="'+id+'"] button.reset').click();
        await new Promise(resolve=>setTimeout(resolve,40));
    }})()`);
    await waitFor(() => state.heldTargets.length > 0, "in-flight reset read before revision change");
    fixture.context.developCounter += 1;
    fixture.context.developChangedAt = Date.now();
    await evaluate("pollControllerContext()");
    state.holdTargets = false;
    state.serializedTargets = true;
    const serialStarted = Date.now(), serialRequestStart = state.requests.length;
    state.heldTargets.splice(0).forEach(held => held.release(true));
    await new Promise(resolve => setTimeout(resolve, 650));
    assert.deepEqual(await values(), defaults,
        "All pending resets must recover promptly when the SDK serves reads one at a time");
    const recoveryReads = state.requests.slice(serialRequestStart).filter(r => r.sliders.length <= 5);
    assert(recoveryReads.length <= 2, "Bound overlapping reads while combining superseded demand");
    assert.deepEqual(recoveryReads.flatMap(read => read.sliders).sort(), ids.slice().sort(),
        "Read each pending slider once during combined recovery");
    assert.equal(state.resets.length, 12, "Read batching must never discard or replay Reset edits");
    const serialEvents = (await evaluate("window.__resetEvents")).filter(event => event.at >= serialStarted && event.value === defaults[event.slider]);
    console.log("Serialized reset recovery: " + JSON.stringify({ reads: recoveryReads.length,
        lastValueMs: Math.max(...serialEvents.map(event => event.at)) - serialStarted }));
    state.serializedTargets = false;
    state.holdBroad = false;
    state.held.splice(0).forEach(release => release());
    // A Reset demand waiting through a same-photo revision is read under the SDK
    // dispatch context. Use that full context, refresh it, and apply without a retry.
    state.holdBroad = true;
    await evaluate("void requestLiveFeedbackSnapshot(true)");
    await waitFor(() => state.held.length > 0, "normal poll held for dispatch-context feedback");
    fixture.values.Exposure = 1.5;
    state.rebindQueuedTargets = 1;
    const reboundStart = Date.now(), reboundReadStart = state.requests.length;
    await evaluate("void requestDevelopSliderResetFeedback(developSliderControls.Exposure)");
    await waitFor(async () => (await values()).Exposure === 1.5, "latest SDK-dispatch revision applied");
    assert.equal(state.requests.slice(reboundReadStart).filter(read => read.sliders.length === 1 && read.sliders[0] === 'Exposure').length, 1,
        "Do not discard a fresh result merely because queued demand began in the previous revision");
    assert(Date.now() - reboundStart < 500, "Prompt adoption of the authoritative dispatch-bound result");
    fixture.values.Exposure = 1.75;
    state.invalidateDispatchedTargets = 1;
    const staleReadStart = state.requests.length;
    await evaluate("void requestDevelopSliderResetFeedback(developSliderControls.Exposure)");
    await waitFor(async () => (await values()).Exposure === 1.75, "fresh retry after a post-dispatch revision change");
    assert.equal(state.requests.slice(staleReadStart).filter(read => read.sliders.length === 1 && read.sliders[0] === 'Exposure').length, 2,
        "A context change AFTER SDK dispatch still requires a new read");
    assert.equal(await evaluate(`window.__resetEvents.some(event => ${JSON.stringify(state.staleDispatchIds)}.includes(event.id))`), false,
        "Never apply a result from an obsolete SDK-dispatch revision");
    // Do not miss a valid result between completion and the next context update.
    // Keep the production context refresh/check in the path to actual DOM apply.
    fixture.values.Exposure = 1.9;
    state.nextDeliveryRace = true;
    const deliveryReadStart = state.requests.length;
    await evaluate("void requestDevelopSliderResetFeedback(developSliderControls.Exposure)");
    await waitFor(async () => (await values()).Exposure === 1.9, "SDK result reaches DOM within its valid revision");
    assert.equal(state.requests.slice(deliveryReadStart).filter(read => read.sliders.length === 1 && read.sliders[0] === 'Exposure').length, 1,
        "Immediate delivery avoids a redundant retry when completion precedes invalidation by 15ms");
    await new Promise(resolve => setTimeout(resolve, 50));
    await evaluate("pollControllerContext()");
    // Two invalidations can arrive on different snapshot-poll ticks. Dispatching
    // the first ready retry must preserve the timer for the second ready retry.
    state.holdTargets = true;
    await evaluate("requestDevelopSliderResetFeedback(developSliderControls.Exposure); requestDevelopSliderResetFeedback(developSliderControls.Contrast)");
    await waitFor(() => state.heldTargets.length >= 1, "held combined demand before staggered retry test");
    // Start separate reads so their invalidation replies arrive independently.
    state.holdTargets = false;
    state.heldTargets.splice(0).forEach(held => held.release());
    await new Promise(resolve => setTimeout(resolve, 150));
    state.holdTargets = true;
    await evaluate("requestDevelopSliderResetFeedback(developSliderControls.Exposure)");
    await waitFor(() => state.heldTargets.length === 1, "first independently held read");
    await evaluate("requestDevelopSliderResetFeedback(developSliderControls.Contrast)");
    await waitFor(() => state.heldTargets.length === 2, "second independently held read");
    state.holdTargets = false;
    state.targetDelay = 350;
    // Model a real discarded snapshot: Lightroom advanced after these reads.
    // A plain 404 with no ownership change is an error, not a retry signal.
    fixture.context.developCounter += 1;
    fixture.context.developChangedAt = Date.now();
    const heldRetries = state.heldTargets.splice(0), retryReadStart = state.requests.length, retryAt = Date.now();
    heldRetries[0].release(true);
    await new Promise(resolve => setTimeout(resolve, 50));
    heldRetries[1].release(true);
    await new Promise(resolve => setTimeout(resolve, 220));
    const timelyRetries = state.requests.slice(retryReadStart).filter(read => read.sliders.length <= 2);
    assert.equal(timelyRetries.length, 2, "Both due retry reads must start before either earlier result returns");
    assert(timelyRetries.every(read => read.at - retryAt < 250), "Do not lose the next retry timer when dispatching a partial batch");
    await new Promise(resolve => setTimeout(resolve, 350));
    state.targetDelay = 100;
    state.holdBroad = false;
    state.held.splice(0).forEach(release => release());
    // Captured live failure: feedback arrives BEFORE its accepted Reset executes.
    // Keep normal polling unavailable; it must not be needed to finish readback.
    Object.assign(fixture.values, { Exposure: 2, Contrast: 31, Highlights: 44 });
    await evaluate("void requestLiveFeedbackSnapshot(true)");
    await waitFor(async () => (await values()).Exposure === 2 && (await values()).Highlights === 44, "values before early-read reproduction");
    state.holdBroad = true;
    await evaluate("void requestLiveFeedbackSnapshot(true)");
    await waitFor(() => state.held.length > 0, "normal poll held during pre-execution reads");
    state.resetExecutionDelay = 350;
    state.resetExecutorReadyAt = 0;
    const earlyReadStart = state.requests.length, earlyEditStart = state.resets.length, earlyExecutionStart = state.executedResets.length;
    const earlyAt = Date.now();
    await evaluate(`(async()=>{for(const id of ${JSON.stringify(ids)}){
        document.querySelector('[data-slider-id="'+id+'"] button.reset').click();
        await sleep(300);
    }})()`);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, earlyAt + 1600 - Date.now())));
    assert.deepEqual(await values(), defaults, "Pre-execution values must not retire Reset feedback demand and leave normal polling to recover");
    assert.deepEqual(state.resets.slice(earlyEditStart).map(edit => edit.slider), ids, "Keep all accepted Reset edits in order");
    assert.deepEqual(state.executedResets.slice(earlyExecutionStart).map(edit => edit.slider), ids, "Execute each accepted edit once");
    const earlyEvents = (await evaluate("window.__resetEvents")).filter(event => event.at >= earlyAt);
    const earlyTimings = ids.map(slider => {
        const edit = state.resets.slice(earlyEditStart).find(edit => edit.slider === slider);
        const execution = state.executedResets.slice(earlyExecutionStart).find(edit => edit.slider === slider);
        const applied = earlyEvents.find(event => event.slider === slider && event.value === defaults[slider]);
        assert(applied && applied.at >= execution.at, "Never display a fabricated Reset default before SDK execution");
        const reads = state.requests.slice(earlyReadStart).filter(read => read.sliders.length <= 3 && read.sliders.includes(slider));
        assert(reads.length >= 2 && reads.length <= 4, "Bound renewal of early same-value feedback");
        assert(applied.at - execution.at < 350, "Prompt readback after the SDK executes " + slider);
        return { slider, dispatchToExecutionMs: execution.at - edit.at,
            resetToDomMs: applied.at - edit.at, executionToDomMs: applied.at - execution.at, reads: reads.length };
    });
    console.log("Early Reset read recovery: " + JSON.stringify(earlyTimings));
    state.resetExecutionDelay = 0;
    const noopEditStart = state.resets.length, noopReadStart = state.requests.length;
    await evaluate(`document.querySelector('[data-slider-id="Exposure"] button.reset').click()`);
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(state.resets.length - noopEditStart, 1, "No-op Reset still executes once");
    assert.equal(state.requests.slice(noopReadStart).filter(read => read.sliders.length <= 3 && read.sliders.includes('Exposure')).length, 4,
        "An unchanged default stops at the existing four-read bound");
    assert.equal(await evaluate("pendingDevelopSliderResetFeedback.size"), 0, "No-op Reset releases demand without endless reads");
    state.holdBroad = false;
    state.held.splice(0).forEach(release => release());
    return { resetFeedback: true, simulated: true, timings };
}

module.exports = { install, verify };
