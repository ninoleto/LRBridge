const fs = require("fs");
const path = require("path");

const root = process.cwd();
const slidersPath = path.join(root, "config", "sliders.json");
const commandsPath = path.join(root, "server", "commands.js");
const outputPath = path.join(root, "docs", "COMPANION_HTTP_CHEATSHEET.md");

const sliders = JSON.parse(fs.readFileSync(slidersPath, "utf8"));
const commandsSource = fs.readFileSync(commandsPath, "utf8");

function extractAllowedActions(source) {
    const match = source.match(/const allowedActions = \[([\s\S]*?)\];/);
    if (!match) {
        return [];
    }

    return match[1]
        .split(/\r?\n/)
        .map((line) => line.trim())
        .map((line) => line.replace(/,$/, ""))
        .map((line) => line.replace(/^"/, "").replace(/"$/, ""))
        .filter(Boolean);
}

function groupSliders(items) {
    const groups = new Map();

    for (const item of items) {
        if (item.id === "LensProfileChromaticAberrationScale") {
            continue;
        }

        const groupName = item.group || "Other";
        if (!groups.has(groupName)) {
            groups.set(groupName, []);
        }

        groups.get(groupName).push(item);
    }

    return groups;
}

function endpoint(pathPart) {
    return pathPart;
}

function fullUrl(pathPart) {
    return "http://127.0.0.1:17891" + pathPart;
}

const actions = extractAllowedActions(commandsSource);
const groups = groupSliders(sliders);

const lines = [];

lines.push("# LRBridge Companion HTTP Cheat Sheet");
lines.push("");
lines.push("Copy/paste command sheet for Bitfocus Companion Generic HTTP Requests, browsers, curl, Stream Deck tools, scripts, or any other HTTP client.");
lines.push("");
lines.push("This file is generated from:");
lines.push("");
lines.push("```text");
lines.push("config/sliders.json");
lines.push("server/commands.js");
lines.push("```");
lines.push("");
lines.push("Use this as the practical button-building sheet.");
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Base URL");
lines.push("");
lines.push("For LRBridge running on the same PC:");
lines.push("");
lines.push("```text");
lines.push("http://127.0.0.1:17891");
lines.push("```");
lines.push("");
lines.push("For LRBridge running on another PC:");
lines.push("");
lines.push("```text");
lines.push("http://LRBRIDGE_PC_IP:17891");
lines.push("```");
lines.push("");
lines.push("Example:");
lines.push("");
lines.push("```text");
lines.push("http://192.168.1.11:17891");
lines.push("```");
lines.push("");
lines.push("In Companion Generic HTTP Requests:");
lines.push("");
lines.push("```text");
lines.push("Base URL: http://LRBRIDGE_PC_IP:17891");
lines.push("Path: /adjust?slider=Exposure&amount=1");
lines.push("Method: GET");
lines.push("```");
lines.push("");
lines.push("`127.0.0.1` is valid only when Companion and LRBridge run on the same computer. If Companion runs on another computer, use the LRBridge computer's trusted LAN address or Tailscale address. Use a stable DHCP reservation or static address for the LRBridge computer so the Companion connection remains valid.");
lines.push("");
lines.push("> **Security warning:** LRBridge has no authentication or authorization. Configuring a remote address makes the API reachable to every other device that can access that address and port. Treat it as trusted-network-only, scope Windows Firewall access to the Companion computer where practical, and permit only the Private profile. With Tailscale, use restrictive ACLs or grants and do not use Funnel. Never publicly forward ports 17890, 17891, or 17892 through a router, reverse proxy, or cloud tunnel.");
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Important notes");
lines.push("");
lines.push("- Use HTTP GET.");
lines.push("- Use only the path part in Companion if the base URL is already configured.");
lines.push("- `amount=1` means one LRBridge/Lightroom adjustment step.");
lines.push("- `amount=-1` means one step down.");
lines.push("- `amount=5` and `amount=-5` are faster jumps.");
lines.push("- Use `/reset?slider=SLIDER_ID` to reset one slider.");
lines.push("- Use `/reset-group?group=GROUP_NAME` to reset a group.");
lines.push("- Use `/reset-all` carefully.");
lines.push("- `/get`, `/last-result`, and `/set` are experimental and should not be used for normal Companion feedback.");
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Common quick buttons");
lines.push("");
lines.push("| Button | Companion path | Full local URL |");
lines.push("|---|---|---|");
lines.push("| Exposure +1 | `/adjust?slider=Exposure&amount=1` | `" + fullUrl("/adjust?slider=Exposure&amount=1") + "` |");
lines.push("| Exposure -1 | `/adjust?slider=Exposure&amount=-1` | `" + fullUrl("/adjust?slider=Exposure&amount=-1") + "` |");
lines.push("| Exposure +5 | `/adjust?slider=Exposure&amount=5` | `" + fullUrl("/adjust?slider=Exposure&amount=5") + "` |");
lines.push("| Exposure -5 | `/adjust?slider=Exposure&amount=-5` | `" + fullUrl("/adjust?slider=Exposure&amount=-5") + "` |");
lines.push("| Exposure Reset | `/reset?slider=Exposure` | `" + fullUrl("/reset?slider=Exposure") + "` |");
lines.push("| Auto Tone | `/action?action=setAutoTone` | `" + fullUrl("/action?action=setAutoTone") + "` |");
lines.push("| Auto White Balance | `/action?action=setAutoWhiteBalance` | `" + fullUrl("/action?action=setAutoWhiteBalance") + "` |");
lines.push("| Reset Basic group | `/reset-group?group=Basic` | `" + fullUrl("/reset-group?group=Basic") + "` |");
lines.push("| Reset all mapped sliders | `/reset-all` | `" + fullUrl("/reset-all") + "` |");
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Group reset commands");
lines.push("");
lines.push("| Group | Companion path | Full local URL |");
lines.push("|---|---|---|");

for (const groupName of groups.keys()) {
    const encodedGroup = encodeURIComponent(groupName);
    const pathPart = `/reset-group?group=${encodedGroup}`;
    lines.push(`| ${groupName} | \`${pathPart}\` | \`${fullUrl(pathPart)}\` |`);
}

lines.push("");
lines.push("---");
lines.push("");
lines.push("## Action commands");
lines.push("");
lines.push("| Action | Companion path | Full local URL |");
lines.push("|---|---|---|");

for (const action of actions) {
    const pathPart = `/action?action=${encodeURIComponent(action)}`;
    lines.push(`| ${action} | \`${pathPart}\` | \`${fullUrl(pathPart)}\` |`);
}

lines.push("");
lines.push("---");
lines.push("");
lines.push("## Slider commands");
lines.push("");
lines.push("Each slider includes ready-made Companion paths for:");
lines.push("");
lines.push("```text");
lines.push("-5");
lines.push("-1");
lines.push("Reset");
lines.push("+1");
lines.push("+5");
lines.push("```");
lines.push("");

for (const [groupName, items] of groups.entries()) {
    lines.push("---");
    lines.push("");
    lines.push(`## ${groupName}`);
    lines.push("");
    lines.push("| Slider label | Slider ID | Button | Companion path | Full local URL |");
    lines.push("|---|---|---|---|---|");

    for (const slider of items) {
        const id = slider.id;
        const label = slider.label || id;

        const commands = [
            ["-5", `/adjust?slider=${encodeURIComponent(id)}&amount=-5`],
            ["-1", `/adjust?slider=${encodeURIComponent(id)}&amount=-1`],
            ["Reset", `/reset?slider=${encodeURIComponent(id)}`],
            ["+1", `/adjust?slider=${encodeURIComponent(id)}&amount=1`],
            ["+5", `/adjust?slider=${encodeURIComponent(id)}&amount=5`]
        ];

        for (const [button, pathPart] of commands) {
            lines.push(`| ${label} | \`${id}\` | ${button} | \`${pathPart}\` | \`${fullUrl(pathPart)}\` |`);
        }
    }

    lines.push("");
}

lines.push("---");
lines.push("");
lines.push("## Browser/curl examples");
lines.push("");
lines.push("Browser:");
lines.push("");
lines.push("```text");
lines.push("http://127.0.0.1:17891/adjust?slider=Exposure&amount=1");
lines.push("```");
lines.push("");
lines.push("PowerShell curl:");
lines.push("");
lines.push("```powershell");
lines.push('curl.exe "http://127.0.0.1:17891/adjust?slider=Exposure&amount=1"');
lines.push('curl.exe "http://127.0.0.1:17891/reset?slider=Exposure"');
lines.push('curl.exe "http://127.0.0.1:17891/action?action=setAutoTone"');
lines.push("```");
lines.push("");
lines.push("---");
lines.push("");
lines.push("## Do not use for normal Companion buttons yet");
lines.push("");
lines.push("These endpoints exist but are experimental:");
lines.push("");
lines.push("```text");
lines.push("/get?slider=Exposure");
lines.push("/last-result");
lines.push("/set?slider=Exposure&value=1&experimental=1");
lines.push("```");
lines.push("");
lines.push("Reason:");
lines.push("");
lines.push("```text");
lines.push("LRBridge currently uses Lightroom Classic as the visible source of truth.");
lines.push("Stable feedback should be built later through a proper /state endpoint.");
lines.push("```");
lines.push("");
lines.push("---");
lines.push("");
lines.push("## For AI agents");
lines.push("");
lines.push("When building a Companion module or fork:");
lines.push("");
lines.push("1. Read `config/sliders.json` for slider IDs, labels, groups, ranges, and defaults.");
lines.push("2. Read `server/commands.js` for allowed action names.");
lines.push("3. Use `/adjust`, `/reset`, `/reset-group`, `/reset-all`, and `/action` first.");
lines.push("4. Do not build feedback on `/last-result`.");
lines.push("5. Do not treat `/set` as stable.");
lines.push("6. Keep Lightroom logic inside LRBridge, not inside the Companion module.");
lines.push("");
lines.push("Correct future Companion architecture:");
lines.push("");
lines.push("```text");
lines.push("Companion Module");
lines.push("        ↓");
lines.push("HTTP GET");
lines.push("        ↓");
lines.push("LRBridge API");
lines.push("        ↓");
lines.push("Lightroom plugin polling");
lines.push("        ↓");
lines.push("Lightroom Classic");
lines.push("```");
lines.push("");

fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
console.log("Wrote " + outputPath);
console.log("Sliders included: " + Array.from(groups.values()).reduce((sum, items) => sum + items.length, 0));
console.log("Actions included: " + actions.length);
