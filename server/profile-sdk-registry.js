"use strict";

const supportedProfiles = Object.freeze([
    "Adobe Color",
    "Adobe Landscape",
    "Adobe Portrait",
    "Adobe Standard",
    "Adobe Vivid",
    "Adobe Monochrome",
    "Artistic 01"
]);

// Lightroom continues to report these targets authoritatively, but the Web Controller must not write them.
const authoritativeReadOnlyProfiles = Object.freeze([
    "Adaptive Color",
    "Adaptive B&W"
]);

const supportedProfileSet = new Set(supportedProfiles);

function isSupportedProfile(label) {
    return typeof label === "string" && supportedProfileSet.has(label);
}

function confirmationTimeoutMs(label, ordinaryTimeoutMs) {
    return ordinaryTimeoutMs;
}

module.exports = Object.freeze({
    supportedProfiles,
    authoritativeReadOnlyProfiles,
    isSupportedProfile,
    confirmationTimeoutMs
});
