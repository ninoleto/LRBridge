const { execFile } = require("child_process");

let watcherStarted = false;
let watcherBusy = false;
let lastWokenPid = null;

function isSupported() {
    return process.platform === "win32";
}

function runPowerShell(command, timeoutMs) {
    return new Promise(function (resolve) {
        execFile(
            "powershell.exe",
            [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                command
            ],
            {
                windowsHide: true,
                timeout: timeoutMs || 15000
            },
            function (error, stdout, stderr) {
                resolve({
                    ok: !error,
                    code: error ? error.code : 0,
                    error: error ? error.message : null,
                    stdout: stdout ? stdout.trim() : "",
                    stderr: stderr ? stderr.trim() : ""
                });
            }
        );
    });
}

async function getLightroomPid() {
    if (!isSupported()) {
        return null;
    }

    const command = `
$p = Get-Process | Where-Object {
    $_.ProcessName -like "*Lightroom*" -and $_.MainWindowHandle -ne 0
} | Select-Object -First 1

if ($null -eq $p) {
    exit 2
}

Write-Output $p.Id
`;

    const result = await runPowerShell(command, 5000);

    if (!result.ok || result.stdout.length === 0) {
        return null;
    }

    const lines = result.stdout.split(/\r?\n/);
    const pid = Number(lines[lines.length - 1]);

    if (Number.isNaN(pid)) {
        return null;
    }

    return pid;
}

async function wakeLightroom(pid) {
    if (!isSupported()) {
        return {
            ok: false,
            error: "Lightroom wake is only supported on Windows."
        };
    }

    const lightroomPid = pid || await getLightroomPid();

    if (lightroomPid === null) {
        return {
            ok: false,
            error: "Lightroom Classic window not found."
        };
    }

    const command = `
Add-Type -AssemblyName System.Windows.Forms

$wshell = New-Object -ComObject WScript.Shell
$activated = $wshell.AppActivate(${lightroomPid})

Write-Output "Activated: $activated"

if ($activated -ne $true) {
    exit 3
}

Start-Sleep -Milliseconds 700

Write-Output "Switching to Library"
[System.Windows.Forms.SendKeys]::SendWait("^%1")

Start-Sleep -Milliseconds 700

Write-Output "Wake complete"
`;

    const result = await runPowerShell(command, 12000);

    return {
        ok: result.ok,
        pid: lightroomPid,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.ok ? null : result.error
    };
}

async function checkAndWake() {
    if (watcherBusy) {
        return;
    }

    watcherBusy = true;

    try {
        const pid = await getLightroomPid();

        if (pid === null) {
            lastWokenPid = null;
            return;
        }

        if (pid === lastWokenPid) {
            return;
        }

        lastWokenPid = pid;

        console.log("Detected Lightroom Classic window. Waking Lightroom UI, PID:", pid);

        setTimeout(async function () {
            const result = await wakeLightroom(pid);

            if (result.ok) {
                console.log("Lightroom wake complete.");
            } else {
                console.log("Lightroom wake failed:", result.error || result.stderr);
            }
        }, 4000);
    } finally {
        watcherBusy = false;
    }
}

function startWatcher() {
    if (!isSupported()) {
        console.log("Lightroom wake watcher disabled: not Windows.");
        return;
    }

    if (watcherStarted) {
        return;
    }

    watcherStarted = true;

    console.log("Lightroom wake watcher started.");

    setTimeout(checkAndWake, 2000);
    setInterval(checkAndWake, 5000);
}

module.exports = {
    isSupported,
    wakeLightroom,
    startWatcher
};
