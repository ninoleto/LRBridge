"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const commands = require("../server/commands");
const { createEnhanceState } = require("../server/enhance-state");
const { createBridge } = require("../server/bridge");

const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const lua = read("lightroom/LRBridge.lrplugin/Enhance.lua");
const productionLua = fs.readdirSync(path.join(root, "lightroom/LRBridge.lrplugin"))
    .filter((name) => name.endsWith(".lua")).map((name) => read("lightroom/LRBridge.lrplugin/" + name)).join("\n");
const productionJs = ["server/bridge.js", "server/commands.js", "server/enhance-state.js", "app/controller.html"]
    .map(read).join("\n");
const parserLua = read("lightroom/LRBridge.lrplugin/Parser.lua");
const commandsLua = read("lightroom/LRBridge.lrplugin/Commands.lua");
const denoiseUi = require("../app/controller-denoise-state");

assert.equal((lua.match(/getEnhancePanelState\s*\(/g) || []).length, 1,
    "Enhance state must use only the authoritative SDK read");
assert.match(lua, /LrTasks\.startAsyncTask\(function\(\)[\s\S]*LrDevelopController\.setEnhance\("denoise", enabled, amount\)/,
    "Denoise must run setEnhance in an asynchronous task");
assert.doesNotMatch(productionLua, /toggleEnhance/);
assert.equal((productionLua.match(/LrDevelopController\.changeDenoiseAmount\(/g) || []).length, 1);
assert.match(lua, /function Enhance\.setDenoiseAmount\(amount\)[\s\S]*LrTasks\.startAsyncTask[\s\S]*changeDenoiseAmount\(amount\)/);
assert.doesNotMatch(lua.match(/function Enhance\.setDenoiseAmount[\s\S]*?\nend\n/)[0], /setEnhance/,
    "Amount-only changes must never call setEnhance");
assert.match(lua, /function Enhance\.setRawDetails\(enabled\)[\s\S]*LrTasks\.startAsyncTask[\s\S]*setEnhance\("rawDetails", enabled\)/);
assert.match(lua, /function Enhance\.setSuperResolution\(enabled\)[\s\S]*LrTasks\.startAsyncTask[\s\S]*setEnhance\("superRes", enabled\)/);
const superResolutionLua = lua.match(/function Enhance\.setSuperResolution\(enabled\)[\s\S]*?\nend\n/)[0];
assert.equal((superResolutionLua.match(/setEnhance\("superRes", enabled\)/g) || []).length, 1);
assert.doesNotMatch(superResolutionLua, /setEnhance\("superRes", enabled\s*,|setEnhance\("(?:denoise|rawDetails)"|changeDenoiseAmount|toggleEnhance/);
assert.match(superResolutionLua, /confirmed\.superResState == enabled/);
assert.match(superResolutionLua, /"uncertain", "confirmation_timeout"/);
assert.doesNotMatch(superResolutionLua, /enabled == true[\s\S]*rawDetailsState/,
    "Independent Raw Details must not block Super Resolution On");
assert.equal((productionLua.match(/LrDevelopController\.setEnhance\(/g) || []).length, 3);
assert.match(commandsLua, /Enhance\.setDenoise\(command\.enabled, command\.amount\)/,
    "Commands.lua must dispatch either Boolean unchanged");
assert.match(commandsLua, /Enhance\.setRawDetails\(command\.enabled\)/);
assert.match(commandsLua, /Enhance\.setSuperResolution\(command\.enabled\)/);

function executeLuaBooleanFieldContract(json, fieldName) {
    const key = new RegExp('"' + fieldName + '"\\s*:', "g");
    const matches = json.match(key) || [];
    if (matches.length !== 1) return null;
    if (new RegExp('"' + fieldName + '"\\s*:\\s*true\\s*[,}]').test(json)) return true;
    if (new RegExp('"' + fieldName + '"\\s*:\\s*false\\s*[,}]').test(json)) return false;
    return null;
}

assert.match(parserLua, /local function parseBooleanField/);
for (const enabled of [true, false]) {
    const nextJson = JSON.stringify({ command: { command: "enhance.denoise.set", enabled, amount: 50 } });
    assert.equal(executeLuaBooleanFieldContract(nextJson, "enabled"), enabled,
        "The exact /next JSON Boolean must survive the Lua parser contract");
    assert.equal(JSON.parse(nextJson).command.amount, 50, "Integer amount transport changed");
}
for (const enabled of [true, false]) {
    const nextJson = JSON.stringify({ command: { command: "enhance.raw_details.set", enabled } });
    assert.equal(executeLuaBooleanFieldContract(nextJson, "enabled"), enabled);
    assert.equal(commands.validateCommand({ command: "enhance.raw_details.set", enabled }), true);
}
for (const enabled of [0, 1, "true", null, undefined]) assert.equal(commands.validateCommand({ command: "enhance.raw_details.set", enabled }), false);
assert.equal(commands.validateCommand({ command: "enhance.raw_details.set", enabled: true, amount: 50 }), false);
for (const enabled of [true, false]) {
    const nextJson = JSON.stringify({ command: { command: "enhance.super_resolution.set", enabled } });
    assert.equal(executeLuaBooleanFieldContract(nextJson, "enabled"), enabled);
    assert.equal(commands.validateCommand({ command: "enhance.super_resolution.set", enabled }), true);
}
for (const enabled of [0, 1, "true", null, undefined]) assert.equal(commands.validateCommand({ command: "enhance.super_resolution.set", enabled }), false);
assert.equal(commands.validateCommand({ command: "enhance.super_resolution.set", enabled: true, extra: false }), false);
for (const invalidJson of [
    '{"command":"enhance.denoise.set","amount":50}',
    '{"command":"enhance.denoise.set","enabled":"true","amount":50}',
    '{"command":"enhance.denoise.set","enabled":"false","amount":50}',
    '{"command":"enhance.denoise.set","enabled":1,"amount":50}',
    '{"command":"enhance.denoise.set","enabled":0,"amount":50}',
    '{"command":"enhance.denoise.set","enabled":tru,"amount":50}',
    '{"command":"enhance.denoise.set","enabled":true,"enabled":false,"amount":50}'
]) assert.equal(executeLuaBooleanFieldContract(invalidJson, "enabled"), null);
assert.match(lua, /activeModule\(\) ~= "develop"/);
assert.match(lua, /targetPhoto\(\) == nil/);
assert.match(lua, /initial\.denoiseEnabled ~= true/);
assert.match(lua, /initial\.denoiseState == enabled/);
assert.match(lua, /operationPending == true/);
assert.match(lua, /function Enhance\.sendCurrentState\(\)[\s\S]*operationPending == true[\s\S]*sendState\(state, "processing"\)[\s\S]*return/,
    "Passive refreshes must remain processing while the worker owns the operation");
assert.doesNotMatch(lua.match(/function Enhance\.sendCurrentState\(\)[\s\S]*?\nend\n/)[0], /"applied"|"failed"|"uncertain"/,
    "Passive Enhance feedback must never report a terminal operation state");
assert.match(lua, /callOk ~= true[\s\S]*"failed"/);
assert.match(lua, /callOk[\s\S]*confirmed\.denoiseState == enabled[\s\S]*"applied"/);
assert.match(lua, /for attempt = 1, 10 do[\s\S]*"uncertain", "confirmation_timeout"/);
assert.doesNotMatch(productionJs, /progress(?:Percent|Percentage)|<progress/i);
assert.doesNotMatch(productionLua + productionJs, /RuntimeDiagnostics|runtime-diagnostics/);

for (const enabled of [true, false]) for (const amount of [1, 2, 50, 99, 100]) {
    assert.equal(commands.validateCommand({ command: "enhance.denoise.set", enabled, amount }), true);
}
for (const amount of [0, 101, 1.5, "50", NaN, Infinity, null]) {
    assert.equal(commands.validateCommand({ command: "enhance.denoise.set", enabled: true, amount }), false);
}
for (const enabled of [0, 1, "true", null, undefined]) assert.equal(commands.validateCommand({ command: "enhance.denoise.set", enabled, amount: 50 }), false);
assert.equal(commands.validateCommand({ command: "enhance.denoise.set", enabled: true, amount: 50, rawDetails: true }), false);
for (const amount of [1, 35, 100]) assert.equal(commands.validateCommand({ command: "enhance.denoise.amount.set", amount }), true);
for (const amount of [0, 101, 1.5, "35"]) assert.equal(commands.validateCommand({ command: "enhance.denoise.amount.set", amount }), false);
assert.doesNotMatch(productionJs, /["']enhance\.denoise["']/);
assert.doesNotMatch(productionJs, /\/enhance\/denoise\?amount=/);
assert.doesNotMatch(productionJs, /Apply Denoise|applyDenoise|enhanceApplyButton/);
assert.doesNotMatch(productionJs, /title\.textContent = "Enhance"|className = "enhance-controls"/,
    "The standalone Enhance section must be absent");
assert.match(productionJs, /includesDetailControls[\s\S]*controls\.appendChild\(renderEnhanceSection\(\)\);\s*controls\.appendChild\(renderRawDetailsControl\(\)\)/,
    "Denoise must be owned by the Detail section");
assert.match(productionJs, /className = "develop-slider-row denoise-slider-row"/);
assert.match(productionJs, /dataset\.detailControl = "denoise"/);
assert.match(productionJs, /label\.className = "slider-name";\s*label\.textContent = "Denoise"/);
assert.match(productionJs, /controls\.appendChild\(label\); controls\.appendChild\(enhanceOffButton\); controls\.appendChild\(enhanceOnButton\);\s*controls\.appendChild\(enhanceAmountRange\); controls\.appendChild\(enhanceAmountInput\);\s*controls\.appendChild\(enhanceMinusButton\); controls\.appendChild\(enhancePlusButton\); controls\.appendChild\(enhanceStatus\)/,
    "Every Denoise element must belong to one Detail control block");
assert.match(productionJs, /enhanceAmountInput\.type = "text"; enhanceAmountInput\.inputMode = "numeric"/);
assert.doesNotMatch(productionJs, /enhanceAmountInput\.type = "number"|\.denoise-slider-row input\[type="number"\]/,
    "Denoise must not retain a native number spinner");
assert.match(productionJs, /\.develop-slider-row input\[type="text"\][\s\S]*border: 1px solid #405263/,
    "Denoise value must inherit the standard Develop value style");
assert.match(productionJs, /makeButton\("−", "develop-slider-step denoise-minus"/);
assert.match(productionJs, /makeButton\("\+", "develop-slider-step denoise-plus"/);
assert.doesNotMatch(productionJs, /makeButton\("Reset Denoise"|denoise-reset/);
assert.match(productionJs, /const leadingControls = createSectionControls\(section, "leading"\);\s*if \(leadingControls\) groupElement\.appendChild\(leadingControls\);[\s\S]*let currentSubheading = null;\s*section\.items\.forEach/,
    "Denoise must precede Detail's Sharpening controls");
assert.doesNotMatch(productionJs, /content\.appendChild\([^)]*(?:enhance|Enhance)/,
    "Denoise must not be an external content sibling");
assert.match(productionJs, /label\.className = "slider-name"; label\.textContent = "Raw Details"/);
assert.match(productionJs, /label\.className = "slider-name"; label\.textContent = "Super Resolution"/);
assert.match(productionJs, /detailControl = "super-resolution"/);
assert.doesNotMatch(productionJs.match(/function renderSuperResolutionControl\(\)[\s\S]*?return controls;\s*}/)[0], /type = "range"|Apply|Reset/);
assert.match(productionJs, /Raw Details enabled by Super Resolution/);
assert.doesNotMatch(productionJs.match(/superResolutionOnButton\.disabled[^;]+;/)[0], /rawDetailsState/);
assert.doesNotMatch(productionJs.match(/function renderRawDetailsControl\(\)[\s\S]*?return controls;\s*}/)[0], /type = "range"/);
assert.match(productionJs, /Raw Details enabled by Denoise/);
assert.match(productionJs, /Applying Raw Details…/);
assert.match(productionJs, /Removing Raw Details…/);
assert.match(productionJs, /\.denoise-slider-row \{\s*grid-template-columns: minmax\(140px, 210px\) 64px 64px minmax\(180px, 1fr\) 92px 44px 44px/);
assert.match(productionJs, /@media \(max-width: 760px\)[\s\S]*\.denoise-slider-row \{\s*grid-template-columns: minmax\(92px, 1fr\) 64px 64px/);
assert.match(productionJs, /\.denoise-slider-row input\[type="range"\],[\s\S]*\.denoise-slider-row \.enhance-status[\s\S]*grid-column: 1 \/ -1/,
    "Narrow wrapping must keep controls inside the Denoise row");

const state = createEnhanceState();
state.syncContext(1);
assert.equal(state.update({
    available: true, denoiseState: true, denoiseEnabled: true, denoiseAmount: 42,
    rawDetailsState: true, rawDetailsEnabled: true, superResState: false,
    superResEnabled: true, enhanceNeedsUpdate: false, operation: "applied"
}), true);
state.syncContext(2);
assert.equal(state.get().operation, "unavailable", "Photo/module context changes must clear stale applied state");
assert.equal(state.get().denoiseAmount, null);

assert.match(productionJs, /enhanceAmountRange\.disabled = pending \|\| unavailable/,
    "Amount editing must remain interactive during amount processing");
assert.match(productionJs, /const enhanceAmountModel = LRBridgeDenoiseState\.create\(\)/);
assert.match(productionJs, /const amount = enabled \? enhanceAmountModel\.displayedAmount/,
    "Turning On must send the local draft");
assert.match(productionJs, /classification === "navigation"[\s\S]*enhanceAmountModel\.reset\(\)/,
    "Photo/context navigation must clear the old draft");
assert.match(productionJs, /const result = enhanceAmountModel\.commit\(\)[\s\S]*enhanceAmountInput\.value = String\(result\.amount\)/,
    "Invalid committed text must restore the model's latest valid value");
assert.match(productionJs, /function stepDenoiseAmount\(delta\)[\s\S]*enhanceAmountModel\.step\(delta\)/,
    "Step buttons must enforce boundaries 1 and 100");
assert.match(productionJs, /if \(isOn\) scheduleDenoiseAmount\(next\);\s*else updateEnhanceControls\(\);/,
    "Off steps must remain local while On steps use the amount command path");
assert.match(productionJs, /enhanceMinusButton\.disabled = enhanceAmountRange\.disabled[\s\S]*displayedAmount <= 1/);
assert.match(productionJs, /enhancePlusButton\.disabled = enhanceAmountRange\.disabled[\s\S]*displayedAmount >= 100/);
assert.match(productionJs, /setTimeout\(function \(\) \{[\s\S]*sendDenoiseAmount\(enhanceAmountModel\.desired\);[\s\S]*}, 200\)/,
    "On-state range changes must be debounced");
assert.match(productionJs, /enhance\/denoise\/amount\?amount=/);
assert.doesNotMatch(productionJs, /setDenoise\(true\).*amount/i);

{
    const model = denoiseUi.create();
    model.feedback(34, true);
    model.focus("34");
    model.input("");
    model.feedback(34, true);
    assert.equal(model.displayedText, "", "Focused empty edit buffer must survive passive feedback");
    model.input("5");
    model.feedback(34, true);
    assert.equal(model.displayedText, "5", "Partial valid text must survive stale feedback");
    model.input("50");
    model.feedback(34, true);
    assert.equal(model.displayedText, "50", "Completed text must survive stale feedback before commit");
    const committed = model.commit();
    assert.deepEqual(committed, { valid: true, amount: 50 });
    assert.equal(model.desired, 50);
}
{
    const model = denoiseUi.create();
    model.feedback(34, true);
    model.focus("34"); model.input("bad");
    assert.equal(model.displayedText, "bad", "Invalid text must remain visible while editing");
    assert.deepEqual(model.commit(), { valid: false, amount: 34 });
    model.focus("34"); model.input("50");
    assert.equal(model.cancel(), 34, "Escape must restore the value present when editing began");
}
{
    const model = denoiseUi.create();
    model.feedback(30, true);
    assert.equal(model.step(1), 31);
    assert.equal(model.markSent(31), true);
    assert.equal(model.markSent(31), false, "Only one amount command may be in flight");
    for (let index = 0; index < 4; index += 1) model.step(1);
    assert.equal(model.displayedAmount, 35, "Repeated plus clicks must update optimistically");
    model.feedback(30, true, "processing");
    assert.equal(model.displayedAmount, 35, "Stale feedback must not move optimistic UI backward");
    const completion = model.feedback(31, true, "applied");
    assert.equal(completion.shouldSend, true, "Newest queued target must follow first confirmation");
    assert.equal(model.desired, 35, "Intermediate targets must be discarded");
    assert.equal(model.markSent(35), true);
    model.feedback(35, true, "applied");
    assert.equal(model.inFlight, false);
    assert.equal(model.desired, null);
    model.feedback(40, true);
    assert.equal(model.displayedAmount, 40, "Direct Lightroom changes must display when no local target exists");
    model.setDesired(2); model.step(-1); model.step(-1);
    assert.equal(model.displayedAmount, 1);
    model.setDesired(99); model.step(1); model.step(1);
    assert.equal(model.displayedAmount, 100);
}
{
    const model = denoiseUi.create();
    model.feedback(50, false);
    model.step(-1);
    assert.equal(model.displayedAmount, 49);
    assert.equal(model.inFlight, false, "Off-state steps must remain local");
}
assert.match(productionJs, /!hasPhoto \|\| !inDevelop \|\| unavailable/,
    "Web Controller must disable Apply outside a valid Develop/photo context");
assert.match(productionJs, /Denoise On — Amount:/);
assert.match(productionJs, /Denoise Off/);
assert.match(productionJs, /Denoise unavailable for this photo/);
assert.match(productionJs, /Applying Denoise…/);
assert.match(productionJs, /Denoise result uncertain — check Lightroom/);
assert.match(productionJs, /setInterval\(function \(\) \{[\s\S]*requestEnhanceState\(\)[\s\S]*\}, 1000\)/);
assert.match(productionJs, /requestLiveFeedbackSnapshot\(false\)/,
    "Normal slider feedback polling must remain operational");

async function httpJson(port, target) {
    const response = await fetch("http://127.0.0.1:" + port + target);
    return { status: response.status, body: await response.json() };
}

(async function () {
    commands.resetQueueForTests();
    const bridge = createBridge({ httpPort: 0, wsPort: 0 });
    await bridge.start();
    const port = bridge.getHttpServer().address().port;
    const passiveReady = "/enhance/result?available=true&denoiseState=false&denoiseEnabled=true&denoiseAmount=50" +
        "&rawDetailsState=false&rawDetailsEnabled=true&superResState=false&superResEnabled=true" +
        "&enhanceNeedsUpdate=false&operation=ready";
    const terminalResult = function (operation, denoiseState, errorCategory) {
        return "/enhance/result?available=true&denoiseState=" + String(denoiseState) +
            "&denoiseEnabled=true&denoiseAmount=50&rawDetailsState=" + String(denoiseState) +
            "&rawDetailsEnabled=true&superResState=false&superResEnabled=true" +
            "&enhanceNeedsUpdate=false&operation=" + operation +
            (errorCategory ? "&errorCategory=" + errorCategory : "");
    };
    const amountResult = function (amountOperation, amount) {
        return "/enhance/amount-result?available=true&denoiseState=true&denoiseEnabled=true&denoiseAmount=" + amount +
            "&rawDetailsState=true&rawDetailsEnabled=false&superResState=false&superResEnabled=false" +
            "&enhanceNeedsUpdate=false&amountOperation=" + amountOperation + "&requestedAmount=" + amount;
    };
    const rawTerminal = function (operation, enabled, errorCategory) {
        return "/enhance/result?available=true&denoiseState=false&denoiseEnabled=true&denoiseAmount=50" +
            "&rawDetailsState=" + String(enabled) + "&rawDetailsEnabled=true&superResState=false&superResEnabled=true" +
            "&enhanceNeedsUpdate=false&operation=" + operation + "&operationTarget=rawDetails&requestedEnabled=" + String(enabled) +
            (errorCategory ? "&errorCategory=" + errorCategory : "");
    };
    async function acceptAndConsume(enabled, amount) {
        assert.equal((await httpJson(port, "/enhance/denoise/set?enabled=" + enabled + "&amount=" + amount)).status, 200);
        const nextResponse = await fetch("http://127.0.0.1:" + port + "/next");
        const nextJson = await nextResponse.text();
        const next = JSON.parse(nextJson);
        assert.deepEqual(next.command, { command: "enhance.denoise.set", enabled, amount });
        assert.equal(executeLuaBooleanFieldContract(nextJson, "enabled"), enabled,
            "Exact /next JSON must preserve enabled=" + enabled + " for Parser.lua");
    }
    async function assertDuplicateLocked(message) {
        assert.equal((await httpJson(port, "/enhance/denoise/set?enabled=true&amount=51")).status, 409, message);
    }
    try {
        await httpJson(port, "/context/update?activeModule=develop&selectedPhotoKey=photo-a&developFingerprint=one");
        assert.deepEqual((await httpJson(port, "/next")).body, { command: null },
            "context heartbeat must not enqueue startup Library");
        for (const invalidTarget of [
            "/enhance/denoise/set?amount=50",
            "/enhance/denoise/set?enabled=%22true%22&amount=50",
            "/enhance/denoise/set?enabled=%22false%22&amount=50",
            "/enhance/denoise/set?enabled=1&amount=50",
            "/enhance/denoise/set?enabled=0&amount=50",
            "/enhance/denoise/set?enabled=tru&amount=50",
            "/enhance/denoise/set?enabled=true&amount=50&extra=1"
        ]) assert.equal((await httpJson(port, invalidTarget)).status, 400, invalidTarget);
        for (const invalidTarget of [
            "/enhance/super-resolution/set",
            "/enhance/super-resolution/set?enabled=1",
            "/enhance/super-resolution/set?enabled=%22false%22",
            "/enhance/super-resolution/set?enabled=true&extra=1"
        ]) assert.equal((await httpJson(port, invalidTarget)).status, 400, invalidTarget);
        const independentRawReady = "/enhance/result?available=true&denoiseState=false&denoiseEnabled=true&denoiseAmount=50" +
            "&rawDetailsState=true&rawDetailsEnabled=true&superResState=false&superResEnabled=true" +
            "&enhanceNeedsUpdate=false&operation=ready";
        assert.equal((await httpJson(port, independentRawReady)).status, 200);
        assert.equal((await httpJson(port, "/enhance/super-resolution/set?enabled=true")).status, 200,
            "Independent Raw Details must permit Super Resolution On");
        let independentRawNext = await httpJson(port, "/next");
        assert.deepEqual(independentRawNext.body.command, { command: "enhance.super_resolution.set", enabled: true });
        const independentRawApplied = "/enhance/result?available=true&denoiseState=false&denoiseEnabled=false&denoiseAmount=50" +
            "&rawDetailsState=true&rawDetailsEnabled=false&superResState=true&superResEnabled=true" +
            "&enhanceNeedsUpdate=false&operation=applied&operationTarget=superResolution&requestedEnabled=true";
        assert.equal((await httpJson(port, independentRawApplied)).status, 200);
        const denoiseOwnedRaw = "/enhance/result?available=true&denoiseState=true&denoiseEnabled=true&denoiseAmount=50" +
            "&rawDetailsState=true&rawDetailsEnabled=false&superResState=false&superResEnabled=false" +
            "&enhanceNeedsUpdate=false&operation=ready";
        assert.equal((await httpJson(port, denoiseOwnedRaw)).status, 200);
        assert.equal((await httpJson(port, "/enhance/super-resolution/set?enabled=true")).status, 409,
            "Denoise-owned Raw Details must block Super Resolution On");
        assert.equal((await httpJson(port, passiveReady)).status, 200);
        for (const invalidTarget of [
            "/enhance/raw-details/set",
            "/enhance/raw-details/set?enabled=1",
            "/enhance/raw-details/set?enabled=%22true%22",
            "/enhance/raw-details/set?enabled=true&extra=1"
        ]) assert.equal((await httpJson(port, invalidTarget)).status, 400, invalidTarget);
        assert.equal((await httpJson(port, "/enhance/denoise/amount?amount=35")).status, 200);
        let amountNext = await httpJson(port, "/next");
        assert.deepEqual(amountNext.body.command, { command: "enhance.denoise.amount.set", amount: 35 });
        assert.equal((await httpJson(port, "/enhance/denoise/amount?amount=36")).status, 409,
            "Only one amount update may be pending");
        assert.equal((await httpJson(port, "/enhance/raw-details/set?enabled=true")).status, 409,
            "A pending Denoise amount change must block Raw Details");
        assert.equal((await httpJson(port, "/enhance/super-resolution/set?enabled=true")).status, 409,
            "A pending Denoise amount change must block Super Resolution");
        assert.equal((await httpJson(port, amountResult("processing", 35))).status, 200);
        assert.equal((await httpJson(port, passiveReady)).status, 200);
        let amountState = await httpJson(port, "/enhance/state");
        assert.equal(amountState.body.amountOperation, "processing", "Passive feedback must preserve amount pending state");
        assert.equal((await httpJson(port, amountResult("applied", 35))).status, 200);
        assert.equal((await httpJson(port, "/enhance/denoise/amount?amount=36")).status, 200,
            "Confirmed amount result must release only the amount lock");
        amountNext = await httpJson(port, "/next");
        assert.deepEqual(amountNext.body.command, { command: "enhance.denoise.amount.set", amount: 36 });
        assert.equal((await httpJson(port, amountResult("failed", 36) + "&errorCategory=sdk_error")).status, 200);
        await acceptAndConsume(true, 50);
        assert.equal((await httpJson(port, passiveReady)).status, 200);
        assert.equal((await httpJson(port, passiveReady)).status, 200);
        const processing = await httpJson(port, "/enhance/state");
        assert.equal(processing.body.operation, "processing",
            "Passive ready feedback must remain processing for the Web Controller");
        assert.equal(processing.body.denoiseState, false);
        assert.equal(processing.body.requestedEnabled, true, "Pending target must survive passive feedback");
        await assertDuplicateLocked("Passive ready feedback must not release duplicate protection");
        assert.equal((await httpJson(port, "/enhance/raw-details/set?enabled=true")).status, 409,
            "Denoise pending must block Raw Details");
        assert.equal((await httpJson(port, "/enhance/super-resolution/set?enabled=true")).status, 409,
            "Denoise pending must block Super Resolution");

        await httpJson(port, "/context/update?activeModule=develop&selectedPhotoKey=photo-b&developFingerprint=two");
        const afterContextChange = await httpJson(port, "/enhance/state");
        assert.equal(afterContextChange.body.operation, "processing",
            "Context changes must retain the Web Controller processing state");
        await assertDuplicateLocked("Context changes must not release duplicate protection");

        assert.equal((await httpJson(port, "/enhance/denoise/set?enabled=true&amount=50&rawDetails=true")).status, 400);
        assert.equal((await httpJson(port, terminalResult("applied", true))).status, 200);
        await acceptAndConsume(false, 1);
        assert.equal((await httpJson(port, passiveReady)).status, 200);
        await assertDuplicateLocked("The second operation must remain locked through passive feedback");

        assert.equal((await httpJson(port, terminalResult("failed", false, "sdk_error"))).status, 200);
        await acceptAndConsume(true, 2);
        assert.equal((await httpJson(port, passiveReady)).status, 200);
        await assertDuplicateLocked("Failed must release only the preceding operation, not the next one");

        assert.equal((await httpJson(port, terminalResult("uncertain", false, "confirmation_timeout"))).status, 200);
        await acceptAndConsume(false, 3);
        assert.equal((await httpJson(port, terminalResult("failed", false, "rejected"))).status, 200);
        assert.equal((await httpJson(port, "/enhance/denoise/set?enabled=true&amount=4")).status, 200,
            "Applied, failed, and uncertain terminal results must each release the lock");
        await httpJson(port, "/next");
        assert.equal((await httpJson(port, terminalResult("applied", true))).status, 200);
        assert.equal((await httpJson(port, "/enhance/raw-details/set?enabled=true")).status, 200);
        const rawNext = await httpJson(port, "/next");
        assert.deepEqual(rawNext.body.command, { command: "enhance.raw_details.set", enabled: true });
        assert.equal((await httpJson(port, "/enhance/raw-details/set?enabled=false")).status, 409,
            "Raw Details pending must block another Raw Details request");
        assert.equal((await httpJson(port, "/enhance/denoise/set?enabled=true&amount=50")).status, 409,
            "Raw Details pending must block Denoise");
        assert.equal((await httpJson(port, passiveReady)).status, 200);
        assert.equal((await httpJson(port, "/enhance/state")).body.operationTarget, "rawDetails",
            "Passive feedback must preserve the pending operation target");
        await httpJson(port, "/context/update?activeModule=develop&selectedPhotoKey=photo-c&developFingerprint=three");
        assert.equal((await httpJson(port, "/enhance/raw-details/set?enabled=false")).status, 409,
            "Context changes must not release Raw Details locking");
        assert.equal((await httpJson(port, rawTerminal("uncertain", true, "confirmation_timeout"))).status, 200);
        assert.equal((await httpJson(port, "/enhance/raw-details/set?enabled=false")).status, 200,
            "Uncertain must release the Raw Details lock");
        await httpJson(port, "/next");
        assert.equal((await httpJson(port, rawTerminal("applied", false))).status, 200);
        assert.equal((await httpJson(port, "/enhance/super-resolution/set?enabled=true")).status, 200);
        const superNext = await httpJson(port, "/next");
        assert.deepEqual(superNext.body.command, { command: "enhance.super_resolution.set", enabled: true });
        assert.equal((await httpJson(port, "/enhance/denoise/set?enabled=true&amount=50")).status, 409);
        assert.equal((await httpJson(port, "/enhance/raw-details/set?enabled=true")).status, 409);
        assert.equal((await httpJson(port, "/enhance/super-resolution/set?enabled=false")).status, 409);
        assert.equal((await httpJson(port, "/enhance/denoise/amount?amount=35")).status, 409);
        assert.equal((await httpJson(port, passiveReady)).status, 200);
        assert.equal((await httpJson(port, "/enhance/state")).body.operationTarget, "superResolution");
        await httpJson(port, "/context/update?activeModule=develop&selectedPhotoKey=photo-d&developFingerprint=four");
        assert.equal((await httpJson(port, "/enhance/super-resolution/set?enabled=false")).status, 409);
        const superApplied = "/enhance/result?available=true&denoiseState=false&denoiseEnabled=false&denoiseAmount=50" +
            "&rawDetailsState=true&rawDetailsEnabled=false&superResState=true&superResEnabled=true" +
            "&enhanceNeedsUpdate=false&operation=applied&operationTarget=superResolution&requestedEnabled=true";
        assert.equal((await httpJson(port, superApplied)).status, 200);
    } finally {
        await bridge.stop();
        commands.resetQueueForTests();
    }
    console.log("Enhance Denoise production contract validated.");
})().catch(function (err) {
    console.error(err);
    process.exitCode = 1;
});
