"use strict";

const NORMAL_MINIMIZE_BEHAVIOR = "normal";
const TRAY_MINIMIZE_BEHAVIOR = "system-tray";
const MINIMIZE_BEHAVIOR_SETTING = "minimize_behavior";

function isValidMinimizeBehavior(value) {
    return value === NORMAL_MINIMIZE_BEHAVIOR || value === TRAY_MINIMIZE_BEHAVIOR;
}

function normalizeMinimizeBehavior(value) {
    return isValidMinimizeBehavior(value) ? value : NORMAL_MINIMIZE_BEHAVIOR;
}

function readSettingValue(content, key) {
    const lines = String(content || "").split(/\r?\n/);

    for (const line of lines) {
        const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);

        if (match && match[1] === key) {
            return match[2];
        }
    }

    return null;
}

function readMinimizeBehaviorFromText(content) {
    return normalizeMinimizeBehavior(readSettingValue(content, MINIMIZE_BEHAVIOR_SETTING));
}

function updateSettingText(content, key, value) {
    const lines = String(content || "").split(/\r?\n/);
    const output = [];
    let replaced = false;

    for (const line of lines) {
        const match = line.match(/^\s*([^#=]+?)\s*=/);

        if (match && match[1] === key) {
            if (!replaced) {
                output.push(key + "=" + value);
                replaced = true;
            }
            continue;
        }

        output.push(line);
    }

    while (output.length > 0 && output[output.length - 1] === "") {
        output.pop();
    }

    if (!replaced) {
        output.push(key + "=" + value);
    }

    return output.join("\n") + "\n";
}

module.exports = {
    MINIMIZE_BEHAVIOR_SETTING,
    NORMAL_MINIMIZE_BEHAVIOR,
    TRAY_MINIMIZE_BEHAVIOR,
    isValidMinimizeBehavior,
    normalizeMinimizeBehavior,
    readMinimizeBehaviorFromText,
    updateSettingText
};
