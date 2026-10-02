"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");
if (process.platform !== "win32") {
    console.log("Profile discovery Windows fixture skipped on " + process.platform + "; macOS remains unverified.");
} else {
    const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", path.join(__dirname, "profile-native-discovery.ps1"), ...process.argv.slice(2)], { windowsHide: true, encoding: "utf8", timeout: 20000 });
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    if (result.error) throw result.error;
    process.exitCode = result.status;
}
