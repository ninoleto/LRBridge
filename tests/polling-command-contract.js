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
    { command: "photo.reveal", scope: "active" },
    { command: "photo.rotate", direction: "left" },
    { command: "selection.extend", direction: "right", amount: 3 },
    { command: "develop.action", action: "setAutoTone" },
    { command: "selection.rating.set", rating: 5 }
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
}
assert.equal(commands.getNextCommand(), null);

const stringFields = ["action", "direction", "mode", "scope"];
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
