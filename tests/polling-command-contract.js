const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const commands = require("../server/commands");

const root = path.join(__dirname, "..");
const parser = fs.readFileSync(
    path.join(root, "lightroom/LRBridge.lrplugin/Parser.lua"),
    "utf8"
);
const polling = fs.readFileSync(
    path.join(root, "lightroom/LRBridge.lrplugin/AutoStartPolling.lua"),
    "utf8"
);

function executeLuaCommitIdParserContract(json) {
    const match = json.match(/"commitId":"([^"]+)"/);
    let commitId = match ? match[1] : null;
    if (commitId !== null && (commitId.length > 64 || !/^[A-Za-z0-9_-]+$/.test(commitId))) commitId = null;
    return {
        command: json.match(/"command":"([^"]+)"/)[1],
        value: json.match(/"value":"([^"]+)"/)[1],
        commitId: commitId
    };
}

const acceptedCommands = [
    { command: "photo.treatment", value: "grayscale" },
    { command: "photo.treatment", value: "color" },
    { command: "photo.crop_aspect", mode: "original" },
    { command: "photo.crop_aspect", mode: "asshot" },
    { command: "photo.crop_aspect", mode: "1x1" },
    { command: "photo.crop_aspect", mode: "2x3" },
    { command: "photo.crop_aspect", mode: "4x5" },
    { command: "photo.crop_aspect", mode: "5x7" },
    { command: "photo.crop_aspect", mode: "16x9" },
    { command: "photo.crop_aspect", mode: "16x10" },
    { command: "photo.crop_aspect", mode: "custom", w: 16, h: 10 },
    { command: "photo.crop_aspect", mode: "custom", w: 21, h: 9 },
    { command: "photo.crop_angle.set", value: -2.5 },
    { command: "photo.crop_angle.set", value: 12.25 },
    { command: "photo.crop_angle.reset" },
    { command: "develop.set", slider: "Tint", value: -25 },
    { command: "develop_categorical.white_balance.set", value: "Daylight" },
    { command: "develop_categorical.profile.set", profile: "Artistic 01", expectedContextCounter: 0, profileGeneration: 1 },
    { command: "lightroom.undo" },
    { command: "lightroom.redo" },
    { command: "photo.reveal", scope: "active" },
    { command: "photo.rotate", direction: "left" },
    { command: "selection.extend", direction: "right", amount: 3 },
    { command: "develop.action", action: "setAutoTone" },
    { command: "selection.rating.set", rating: 5 },
    { command: "enhance.denoise.set", enabled: true, amount: 50 },
    { command: "enhance.denoise.set", enabled: false, amount: 50 }
];

commands.resetQueueForTests();
for (const command of acceptedCommands) {
    assert.equal(commands.enqueueCommand(command), true);
    const pollingResponse = JSON.stringify({ command: commands.getNextCommand() });
    assert.deepEqual(
        JSON.parse(pollingResponse).command,
        command,
        "Polling JSON changed an accepted command"
    );
    if (command.command === "enhance.denoise.set") commands.finishEnhanceOperation();
}
assert.equal(commands.getNextCommand(), null);

const focalRangeTransportCommand = {
    command: "lens_blur.focal_range.set",
    value: "-50 30 85 165",
    commitId: "focus-range-37"
};
commands.resetQueueForTests();
assert.equal(commands.tryEnqueueCommand(focalRangeTransportCommand).accepted, true);
const focalRangePollingJson = JSON.stringify({ command: commands.getNextCommand() });
assert.deepEqual(executeLuaCommitIdParserContract(focalRangePollingJson), focalRangeTransportCommand,
    "Serialized Focus Range polling JSON must preserve commitId through the Lua parser contract");
assert.equal(executeLuaCommitIdParserContract(focalRangePollingJson.replace("focus-range-37", "bad value")).commitId, null);
assert.equal(executeLuaCommitIdParserContract(focalRangePollingJson.replace("focus-range-37", "a".repeat(65))).commitId, null);

const stringFields = ["action", "direction", "mode", "scope", "profile"];
for (const field of stringFields) {
    assert.match(
        parser,
        new RegExp("local " + field + " = string\\.match\\(json, \\[\\[\"" + field + "\":\"\\(\\[\\^\"\\]\\+\\)\"\\]\\]\\)")
    );
    assert.match(parser, new RegExp("\\b" + field + " = " + field + "\\b"));
}

assert.match(parser, /local value = string\.match\(json, \[\["value":"\(\[\^"\]\+\)"\]\]\)/);
assert.ok(parser.includes('"value":([%-]?%d+%.?%d*)'));
assert.match(parser, /if value == nil then[\s\S]*value = tonumber\(value\)/);
assert.match(parser, /\bvalue = value\b/);
assert.match(parser, /local amount = string\.match[\s\S]*amount = tonumber\(amount\)[\s\S]*\bamount = amount\b/);
assert.match(parser, /local function parseBooleanField\(json, fieldName\)/);
assert.match(parser, /for _ in string\.gmatch\(json, keyPattern\)[\s\S]*count = count \+ 1/);
assert.match(parser, /if count ~= 1 then\s*return nil/);
assert.match(parser, /keyPattern \.\. '%s\*true%s\*\[,}]'[\s\S]*return true/);
assert.match(parser, /keyPattern \.\. '%s\*false%s\*\[,}]'[\s\S]*return false/);
assert.match(parser, /local enabled = parseBooleanField\(json, "enabled"\)/);
assert.match(parser, /\benabled = enabled\b/);
assert.match(parser, /local commitId = string\.match\(json, \[\["commitId":"\(\[\^"\]\+\)"\]\]\)/);
assert.match(parser, /string\.len\(commitId\) > 64[\s\S]*string\.match\(commitId, "\^\[A-Za-z0-9_-\]\+\$"\) == nil[\s\S]*commitId = nil/);
assert.match(parser, /\bcommitId = commitId\b/);
assert.match(parser, /local rating = string\.match[\s\S]*rating = tonumber\(rating\)[\s\S]*\brating = rating\b/);
for (const field of ["w", "h"]) {
    assert.match(parser, new RegExp("local " + field + " = string\\.match"));
    assert.match(parser, new RegExp("if " + field + " then\\s*" + field + " = tonumber\\(" + field + "\\)"));
    assert.match(parser, new RegExp("\\b" + field + " = " + field + "\\b"));
}

for (const [command, field] of [
    ["photo.treatment", "value"],
    ["photo.crop_aspect", "mode"],
    ["photo.reveal", "scope"]
]) {
    assert.match(
        polling,
        new RegExp("command\\.command == \"" + command.replaceAll(".", "\\.") +
            "\"[\\s\\S]*?return command\\." + field)
    );
}
assert.match(
    polling,
    /command\.mode == "custom"[\s\S]*command\.mode \.\. " " \.\. tostring\(command\.w\) \.\. "x" \.\. tostring\(command\.h\)/
);
assert.match(polling, /command\.command == "photo\.crop_angle\.set"[\s\S]*return command\.value/);
assert.match(polling, /command\.command == "photo\.crop_angle\.reset"[\s\S]*return nil/);
assert.match(polling, /if parameter ~= nil then[\s\S]*diagnostic = diagnostic \.\. " " \.\. tostring\(parameter\)/);

console.log("Polling command serialization and Lua parser field contract tests passed.");
