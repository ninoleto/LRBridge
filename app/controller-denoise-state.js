(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LRBridgeDenoiseState = factory();
}(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // Adobe Lightroom Classic 15.3 SDK reference, LrDevelopController.setEnhance:
    // denoiseAmount has a documented default of 50. Reset uses changeDenoiseAmount
    // through the existing amount command; it never toggles Enhance.
    const DEFAULT_AMOUNT = 50;

    function valid(value) { return Number.isInteger(value) && value >= 1 && value <= 100; }
    function parse(text) {
        if (typeof text !== "string" || !/^\d{1,3}$/.test(text)) return null;
        const value = Number(text);
        return valid(value) ? value : null;
    }

    function create(initialAmount) {
        let authoritative = valid(initialAmount) ? initialAmount : null;
        let desired = null;
        let editBuffer = null;
        let editing = false;
        let editStartAmount = null;
        let debouncePending = false;
        let inFlight = false;
        let inFlightAmount = null;
        let waitingForFeedback = false;
        let isOn = false;

        function displayedAmount() {
            if (waitingForFeedback && valid(authoritative)) return authoritative;
            if (valid(desired)) return desired;
            if (valid(authoritative)) return authoritative;
            return 50;
        }

        function feedback(amount, nextIsOn, operation) {
            const previousOn = isOn;
            isOn = nextIsOn === true;
            if (valid(amount)) authoritative = amount;
            let completed = false;
            let failed = false;
            if (inFlight && authoritative === inFlightAmount) completed = true;
            if (inFlight && (operation === "failed" || operation === "uncertain")) { completed = true; failed = true; }
            if (completed) {
                const completedAmount = inFlightAmount;
                inFlight = false;
                inFlightAmount = null;
                waitingForFeedback = false;
                if (!failed && desired === completedAmount && authoritative === completedAmount) desired = null;
                if (failed && desired === completedAmount) desired = null;
            }
            if (previousOn && !isOn && desired === null && valid(authoritative)) desired = authoritative;
            if (!isOn && desired === null && valid(authoritative)) desired = authoritative;
            return { completed: completed, shouldSend: isOn && !inFlight && valid(desired) && desired !== authoritative };
        }

        function focus(currentText) {
            editing = true;
            editBuffer = String(currentText);
            editStartAmount = displayedAmount();
        }

        function input(text) {
            editBuffer = String(text);
            const value = parse(editBuffer);
            if (value !== null) desired = value;
            return value;
        }

        function commit() {
            const value = parse(editBuffer);
            editing = false;
            if (value === null) {
                const restored = displayedAmount();
                editBuffer = String(restored);
                return { valid: false, amount: restored };
            }
            desired = value;
            editBuffer = String(value);
            return { valid: true, amount: value };
        }

        function cancel() {
            editing = false;
            desired = editStartAmount;
            editBuffer = String(editStartAmount);
            return editStartAmount;
        }

        function setDesired(value) {
            if (!valid(value)) return false;
            desired = value;
            if (!editing) editBuffer = String(value);
            return true;
        }

        function step(delta) {
            const next = Math.max(1, Math.min(100, displayedAmount() + delta));
            setDesired(next);
            return next;
        }

        function markSent(amount, waitForFeedback) {
            if (inFlight || !valid(amount)) return false;
            if (waitForFeedback && (!isOn || !valid(authoritative))) return false;
            inFlight = true;
            inFlightAmount = amount;
            waitingForFeedback = waitForFeedback === true;
            return true;
        }

        function sendFailed() {
            if (waitingForFeedback) desired = null;
            inFlight = false; inFlightAmount = null; waitingForFeedback = false;
        }
        function cancelLocal() {
            editing = false;
            editBuffer = null;
            editStartAmount = null;
            debouncePending = false;
            if (!inFlight) desired = null;
            return displayedAmount();
        }
        function reset() {
            authoritative = null; desired = null; editBuffer = null; editing = false;
            editStartAmount = null; debouncePending = false; inFlight = false; inFlightAmount = null; isOn = false;
            waitingForFeedback = false;
        }

        return {
            valid, parse, feedback, focus, input, commit, cancel, setDesired, step, markSent, sendFailed, cancelLocal, reset,
            setDebouncePending: function (value) { debouncePending = value === true; },
            get authoritative() { return authoritative; },
            get desired() { return desired; },
            get editBuffer() { return editBuffer; },
            get editing() { return editing; },
            get debouncePending() { return debouncePending; },
            get inFlight() { return inFlight; },
            get inFlightAmount() { return inFlightAmount; },
            get waitingForFeedback() { return waitingForFeedback; },
            get isOn() { return isOn; },
            get displayedAmount() { return displayedAmount(); },
            get displayedText() { return editing ? editBuffer : String(displayedAmount()); }
        };
    }

    return { create: create, valid: valid, parse: parse, DEFAULT_AMOUNT: DEFAULT_AMOUNT };
}));
