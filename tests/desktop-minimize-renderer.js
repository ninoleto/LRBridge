"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "app", "index.html"), "utf8");
const renderer = fs.readFileSync(path.join(root, "app", "renderer.js"), "utf8");
const main = fs.readFileSync(path.join(root, "app", "main.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "app", "preload.js"), "utf8");

assert.match(html, /<div class="label" id="minimizeBehaviorTitle">Minimize behavior<\/div>/);
assert.match(html, /name="minimizeBehavior" value="normal" checked/,
    "Normal must be the visibly selected desktop default");
assert.match(html, /name="minimizeBehavior" value="system-tray"/);
assert.equal((html.match(/name="minimizeBehavior"/g) || []).length, 2,
    "The desktop must expose exactly two mutually exclusive choices");
assert.match(html, /<button id="minimizeLrbridge" class="secondary">Minimize LRBridge<\/button>/);
assert.match(html, /\.minimize-choice\s*\{[\s\S]*?min-height:\s*44px;/,
    "Minimize behavior choices must remain touch-friendly");
assert.match(html, /#minimizeLrbridge\s*\{[\s\S]*?min-height:\s*44px;/);
assert.match(html, /\.minimize-choice\.selected\s*\{[\s\S]*?background:[\s\S]*?border-color:/,
    "The selected minimize behavior must have a clear dedicated style");
const bridgeLogIndex = html.indexOf('<div class="terminal-title">Bridge log</div>');
const minimizePanelIndex = html.indexOf('<section class="minimize-footer"');
const keepRunningIndex = html.indexOf('<section class="keep-running-info"');
const openSourceFooterIndex = html.indexOf('<footer class="footer" id="openSourceFooter">');
const scriptIndex = html.indexOf('<script src="renderer.js"></script>');
assert.ok(
    bridgeLogIndex >= 0 &&
    bridgeLogIndex < minimizePanelIndex &&
    minimizePanelIndex < keepRunningIndex &&
    keepRunningIndex < openSourceFooterIndex &&
    openSourceFooterIndex < scriptIndex,
    "Desktop order must be Bridge Log < Minimize Behavior < Keep Running information < Open-source footer"
);
assert.equal(html.lastIndexOf("<footer"), openSourceFooterIndex,
    "Open-source support must remain the final footer content");
assert.match(html, /\.minimize-footer\s*\{[\s\S]*?background:\s*#090d11;[\s\S]*?border:\s*1px solid #222b34;/,
    "The compact Minimize footer must have its own distinctly darker styling");
assert.match(html, /\.minimize-controls\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*wrap;/,
    "All minimize controls must share one compact wrapping row");
assert.match(html, /\.keep-running-info\s*\{[\s\S]*?background:\s*#261316;[\s\S]*?border:\s*1px solid #5c3037;[\s\S]*?border-left:\s*4px solid #b54f5d;[\s\S]*?color:\s*#d8bcc1;[\s\S]*?\.keep-running-primary\s*\{[\s\S]*?color:\s*#f3e2e5;/,
    "Keep Running information must use its own restrained dark-red operational-notice presentation");
assert.doesNotMatch(html, /KEEP LRBRIDGE RUNNING/,
    "The teal information box must not repeat its first sentence as a heading");
assert.match(html, /\.keep-running-primary\s*\{[\s\S]*?font-weight:\s*600;/,
    "The first Keep Running sentence must be slightly bolder than the second");
assert.match(html, /<p class="keep-running-primary">Keep LRBridge running while controlling Lightroom Classic\.<\/p>/);
assert.equal((html.match(/Keep LRBridge running while controlling Lightroom Classic\./g) || []).length, 1);
assert.equal((html.match(/You can control it from Bitfocus Companion or any device\/app that can send HTTP requests\./g) || []).length, 1);
assert.equal((html.match(/LRBridge is open source\. Support development:/g) || []).length, 1);

assert.match(renderer, /setMinimizeBehaviorDisplay\(state\.minimizeBehavior\)/);
assert.match(renderer, /window\.lrbridge\.setMinimizeBehavior\(input\.value\)/);
assert.match(renderer, /window\.lrbridge\.minimizeWindow\(\)/);
assert.match(renderer, /input\.parentElement\.classList\.toggle\("selected", selected\)/);
assert.match(renderer, /setMinimizeBehaviorDisplay\(previousBehavior\)/,
    "A rejected setting change must restore the last accepted renderer state");
assert.doesNotMatch(renderer, /Minimize behavior saved:/,
    "Successful mode changes must not leave a persistent success message");
assert.match(renderer, /setMinimizeBehaviorDisplay\(result\.behavior\);\s*minimizeMessage\.textContent = "";/,
    "Successful changes must clear any prior status text");
assert.match(renderer, /quitAppButton\.addEventListener\("click"[\s\S]*window\.lrbridge\.quitApp\(\)/,
    "The red Quit button must invoke the desktop quit IPC");

const calls = [];
let desktopApi = null;
const context = vm.createContext({
    require(requestName) {
        assert.equal(requestName, "electron");
        return {
            contextBridge: {
                exposeInMainWorld(name, value) {
                    assert.equal(name, "lrbridge");
                    desktopApi = value;
                }
            },
            ipcRenderer: {
                invoke(...args) {
                    calls.push(args);
                    return Promise.resolve({ ok: true });
                },
                on() {}
            }
        };
    }
});
vm.runInContext(preload, context, { filename: path.join(root, "app", "preload.js") });
assert.ok(desktopApi);

async function run() {
    await desktopApi.setMinimizeBehavior("system-tray");
    await desktopApi.minimizeWindow();
    await desktopApi.quitApp();
    assert.deepEqual(calls, [
        ["set-minimize-behavior", "system-tray"],
        ["minimize-window"],
        ["quit-app"]
    ], "Preload must expose only narrow minimize IPC calls");

    assert.match(main, /ipcMain\.handle\("set-minimize-behavior"[\s\S]*?isValidMinimizeBehavior\(behavior\)/,
        "Main-process IPC must validate the minimize behavior enum");
    assert.match(main, /ipcMain\.handle\("minimize-window"[\s\S]*?desktopMinimizeController\.minimizeWindow\(\)/);
    assert.match(main, /contextIsolation:\s*true/);
    assert.match(main, /nodeIntegration:\s*false/);
    assert.doesNotMatch(preload, /ipcRenderer\s*:\s*ipcRenderer|invoke:\s*ipcRenderer\.invoke/,
        "Preload must not expose broad renderer IPC or Node access");

    console.log("Desktop minimize presentation and narrow IPC tests passed.");
}

run().catch(function (err) {
    console.error(err.stack || err.message);
    process.exitCode = 1;
});
