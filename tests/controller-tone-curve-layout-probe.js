"use strict";

// Executed inside the isolated Chromium page with production Controller scripts/CSS.
// Feedback is synthetic; this test never connects to Lightroom or the running bridge.
module.exports = async function toneCurveLayoutProbe() {
    function check(condition, message) {
        if (!condition) throw new Error(message);
    }
    async function settle() {
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
        await new Promise(function (resolve) { requestAnimationFrame(resolve); });
    }
    function touch(type, x, y) {
        return new Promise(function (resolve, reject) {
            window.__lrbridgeLayoutTouchDone = function (error) {
                if (error) reject(new Error(error));
                else resolve();
            };
            window.__lrbridgeLayoutTouch(JSON.stringify({ type: type, x: x, y: y }));
        });
    }
    const results = [];
    for (const hostName of ["Develop", "Masking"]) {
        for (const width of [600, 340]) {
            const masked = hostName === "Masking";
            const root = document.createElement("div");
            root.style.cssText = "position:fixed;left:0;top:0;bottom:0;overflow:auto;z-index:9999;" +
                "background:#111820;width:" + width + "px";
            const host = document.createElement(masked ? "div" : "section");
            host.className = masked ? "masking-correction-group masking-tone-curve" : "group tone-curve-group";
            const status = document.createElement("div");
            status.className = masked ? "masking-corrections-status" : "status";
            if (masked) host.appendChild(status);
            else root.appendChild(status);
            root.appendChild(host);
            document.body.appendChild(root);
            const baseline = [0, 0, 109, 93, 255, 255];
            let snapshot = {
                available: true, selectedPhotoUuid: "curve-layout-photo", contextCounter: 31,
                developCounter: 47, revision: 5, updatedAt: Date.now(), name: "Custom",
                refineSaturation: { value: 0, min: -100, max: 100 },
                curves: { rgb: baseline.slice(), red: baseline.slice(), green: baseline.slice(), blue: baseline.slice() }
            };
            if (masked) Object.assign(snapshot, {
                serverEpoch: "curve-layout-epoch", maskingRevision: 8, contextChangedAt: 9000,
                selectedMaskGroupId: "curve-layout-mask-a", editFeedbackSequence: 0, lastEditResult: null
            });
            let editSequence = 0;
            let submittedPoints = null;
            let failNext = false;
            const announcements = [];
            function showStatus(message) {
                announcements.push(message);
                status.textContent = message;
            }
            const controller = LRBridgeToneCurve.createController({
                document: document, window: window, statusElement: status, setStatus: showStatus,
                contextAdapter: masked ? LRBridgeToneCurve.createMaskingContextAdapter("/api/masking/tone-curve") : null,
                setInterval: function () { return 1; }, clearInterval: function () {},
                fetch: async function (url) {
                    let body = { ok: true };
                    let code = 200;
                    if (url.endsWith("/state")) body.pointCurve = snapshot;
                    else if (failNext) {
                        failNext = false;
                        code = 409;
                        body = { ok: false, error: "Synthetic layout regression error: " + "feedback unavailable; ".repeat(40) };
                    } else if (/\/gesture\/(end|update)\?/.test(url)) {
                        submittedPoints = new URL(url, location.href).searchParams.get("points").split(",").map(Number);
                        editSequence += 1;
                        if (masked) body.editSequence = editSequence;
                    }
                    return { ok: code === 200, status: code, json: async function () {
                        return JSON.parse(JSON.stringify(body));
                    } };
                }
            });
            host.appendChild(controller.element);
            const stages = [];
            let reference;
            function measure(stage) {
                const rect = host.querySelector(".point-curve-graph").getBoundingClientRect();
                const bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                if (!reference) reference = bounds;
                for (const key of Object.keys(bounds)) {
                    check(Math.abs(bounds[key] - reference[key]) < 0.1,
                        hostName + " " + width + " " + stage + " changed graph " + key +
                        ": " + reference[key] + " -> " + bounds[key]);
                }
                stages.push(stage);
            }
            async function confirmPending(operation) {
                const pending = controller.getState().awaitingTarget;
                check(pending && pending.operation === operation, hostName + " " + width + " " + operation +
                    " must await feedback: " + JSON.stringify(controller.getState()));
                snapshot = Object.assign({}, snapshot, {
                    revision: snapshot.revision + 1, updatedAt: Date.now(),
                    curves: Object.assign({}, snapshot.curves, { [pending.channel]: pending.points.slice() })
                });
                if (masked) Object.assign(snapshot, {
                    editFeedbackSequence: editSequence,
                    lastEditResult: { sequence: editSequence, kind: "toneCurve", outcome: "confirmed" }
                });
                check(controller.applyAuthoritative(snapshot), "fresh feedback must be accepted");
                await settle();
                check(!controller.getState().awaitingTarget, operation + " must settle");
                check(status.textContent.includes("confirmed by Lightroom"), operation + " confirmation missing");
                measure(operation + " confirmed");
            }
            try {
                controller.activate(Object.assign({ activeModule: "develop" }, snapshot));
                await settle();
                const add = host.querySelector('[aria-label="Add point"]');
                const remove = host.querySelector('[aria-label="Delete point"]');
                const svg = host.querySelector(".point-curve-graph");
                const reset = host.querySelector(".point-curve-actions button");
                check(reference === undefined && !add.disabled, "fixture must be ready");
                measure("ready");
                check(reference.width > 200 && Math.abs(reference.width - reference.height) < 1,
                    "graph must be visible and square");
                check(host.querySelector(".point-curve-point-actions").getBoundingClientRect().bottom <=
                    svg.getBoundingClientRect().top, "Add/Delete must remain above the graph");
                check(reset.getBoundingClientRect().top >= svg.getBoundingClientRect().bottom,
                    "Reset must remain below the graph");
                const priorAnnouncements = announcements.length;
                add.click();
                await settle();
                measure("add armed");
                check(add.classList.contains("active") && add.getAttribute("aria-pressed") === "true",
                    "Add mode must remain highlighted and exposed as pressed");
                check(status.textContent === "Tap graph to add point", "instruction must use the host status");
                check(root.textContent.split("Tap graph to add point").length === 2,
                    "instruction must appear exactly once");
                check(announcements.slice(priorAnnouncements).filter(function (text) {
                    return text === "Tap graph to add point";
                }).length === 1, "instruction must be announced once");
                check(status.getAttribute("role") === "status" && status.getAttribute("aria-atomic") === "true",
                    "host status must expose polite, atomic announcements");
                check(!host.querySelector(".point-curve-add-instruction"), "duplicate instruction must be absent");
                add.click();
                await settle();
                check(!controller.getState().addPointArmed, "button must cancel Add mode");
                measure("button cancellation");
                add.click();
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
                await settle();
                check(!controller.getState().addPointArmed, "Escape must cancel Add mode");
                measure("keyboard cancellation");
                add.click();
                const rect = svg.getBoundingClientRect();
                const touchX = rect.x + rect.width * 64 / 255;
                const touchY = rect.y + rect.height * (255 - 90) / 255;
                const touchTarget = document.elementFromPoint(touchX, touchY);
                const touchEvents = [];
                ["pointerdown", "pointercancel", "touchstart"].forEach(function (type) {
                    root.addEventListener(type, function (event) {
                        touchEvents.push({ type: type, target: event.target.tagName,
                            pointerType: event.pointerType, pointerId: event.pointerId });
                    }, { capture: true });
                });
                await touch("touchStart", touchX, touchY);
                await settle();
                check(submittedPoints && controller.getState().gestureActive, hostName + " " + width +
                    " real touch must submit an insertion: " + JSON.stringify({
                        touchTarget: touchTarget && touchTarget.outerHTML.slice(0, 200), touchEvents: touchEvents,
                        state: controller.getState(), status: status.textContent
                    }));
                snapshot = Object.assign({}, snapshot, {
                    revision: snapshot.revision + 1, updatedAt: Date.now(),
                    curves: Object.assign({}, snapshot.curves, { rgb: submittedPoints.slice() })
                });
                if (masked) Object.assign(snapshot, {
                    editFeedbackSequence: editSequence,
                    lastEditResult: { sequence: editSequence, kind: "toneCurve", outcome: "confirmed" }
                });
                controller.applyAuthoritative(snapshot);
                measure("touch held");
                await touch("touchEnd");
                await settle();
                measure("touch add pending");
                check(add.disabled && remove.disabled && reset.disabled, "pending edits must protect busy controls");
                await confirmPending("add");
                check(snapshot.curves.rgb.length === baseline.length + 2 && !remove.disabled,
                    "touch addition must select the new interior point");
                remove.click();
                await settle();
                measure("delete pending");
                check(add.disabled && remove.disabled, "deletion must protect busy controls");
                await confirmPending("delete");
                check(JSON.stringify(snapshot.curves.rgb) === JSON.stringify(baseline), "deletion must restore baseline");
                host.querySelector('.point-curve-hit-target[data-point-index="0"]').dispatchEvent(
                    new MouseEvent("click", { bubbles: true }));
                check(remove.disabled, "endpoint deletion must remain protected");
                measure("endpoint selected");
                failNext = true;
                reset.click();
                await settle();
                check(status.textContent.startsWith("ERROR:"), "rejected request must display its error");
                measure("long request error");
                check(status.scrollHeight > status.clientHeight && getComputedStyle(status).overflowY === "auto" &&
                    status.getAttribute("tabindex") === "0", "long errors must remain scrollable and keyboard reachable");
                for (const message of ["", "Short confirmation", "Three\nstatus\nlines", "LongToken".repeat(150)]) {
                    showStatus(message);
                    await settle();
                    measure("status length " + message.length);
                }
                add.click();
                const oldSnapshot = snapshot;
                snapshot = Object.assign({}, snapshot, masked
                    ? { selectedMaskGroupId: "curve-layout-mask-b", maskingRevision: snapshot.maskingRevision + 1 }
                    : { selectedPhotoUuid: "curve-layout-photo-b", contextCounter: snapshot.contextCounter + 1 });
                controller.applyContext(Object.assign({ activeModule: "develop" }, snapshot));
                check(!controller.getState().addPointArmed, "context change must cancel Add mode");
                check(!controller.applyAuthoritative(oldSnapshot), "old context feedback must remain rejected");
                controller.applyAuthoritative(snapshot);
                await settle();
                measure("context cancellation");
                results.push({ host: hostName, width: width, graph: reference, stableStages: stages.length });
            } finally {
                controller.deactivate();
                check(!status.classList.contains("point-curve-status") && !status.hasAttribute("role") &&
                    !status.hasAttribute("tabindex"), "deactivation must restore the host status attributes");
                root.remove();
            }
        }
    }
    return results;
};
