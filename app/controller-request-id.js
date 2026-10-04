(function(root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory(root);
    else root.LRBridgeRequestId = factory(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function(root) {
    "use strict";
    function createRequestId() {
        const crypto = root.crypto;
        if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
        // randomUUID requires a secure context; getRandomValues also works on LAN HTTP.
        // Preserve UUID v4's 122 random bits and the existing server-compatible format.
        if (typeof crypto?.getRandomValues !== "function") throw Error("Secure request ID generation is unavailable.");
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
        return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
    }
    return { createRequestId };
});
