"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), "utf8"); }

const controller = read("app/controller.html");
const categoricalLua = read("lightroom/LRBridge.lrplugin/DevelopCategorical.lua");
const categoricalServer = read("server/develop-categorical-state.js") + read("server/bridge.js") + read("server/commands.js");

assert.doesNotMatch(controller + categoricalServer, /develop-categorical\/(?:profile|white-balance)/i,
    "The Web Controller must not expose a Profile or WB selector without an authoritative current-photo option-list API");
assert.doesNotMatch(categoricalLua, /CameraProfile|quickDevelopSetWhiteBalance|applyDevelopSettings\s*\(\s*\{[^}]*WhiteBalance/is,
    "Production Lua must not contain speculative Profile or WB preset writes");
assert.doesNotMatch(controller, /Adobe Color|Camera Matching|Artistic|Vintage/,
    "Profile choices must never be hard-coded as a universal list");
assert.match(controller, /const autoActionCooldownActions = new Set\(\["setAutoTone", "setAutoWhiteBalance"\]\)/,
    "The existing Auto White Balance cooldown protection must remain intact");
assert.match(controller, /isAutoActionCooldownActiveFor\(autoTone\.action\)/,
    "Auto White Balance must continue to use the guarded action path");

console.log("Profile and White Balance fail-closed capability boundary tests passed.");
