(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LRBridgeDenoiseState = factory();
}(typeof self !== "undefined" ? self : this, function () {
    "use strict";

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
        let isOn = false;

        function displayedAmount() {
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

        function markSent(amount) {
            if (inFlight || !valid(amount)) return false;
            inFlight = true;
            inFlightAmount = amount;
            return true;
        }

        function sendFailed() { inFlight = false; inFlightAmount = null; }
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
            get isOn() { return isOn; },
            get displayedAmount() { return displayedAmount(); },
            get displayedText() { return editing ? editBuffer : String(displayedAmount()); }
        };
    }

    return { create: create, valid: valid, parse: parse };
}));
