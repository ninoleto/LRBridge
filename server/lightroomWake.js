const { execFile } = require("child_process");

let watcherStarted = false;
let watcherBusy = false;
let lastWokenPid = null;
let watcherOwners = 0;
let initialTimer = null;
let watcherInterval = null;
const retryTimers = new Set();
let watcherGeneration = 0;

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

async function checkAndWake(generation) {
    if (!watcherStarted || generation !== watcherGeneration || watcherBusy) {
        return;
    }

    watcherBusy = true;

    try {
        const pid = await getLightroomPid();

        if (!watcherStarted || generation !== watcherGeneration) return;

        if (pid === null) {
            lastWokenPid = null;
            return;
        }

        if (pid === lastWokenPid) {
            return;
        }

        lastWokenPid = pid;

        console.log("Detected Lightroom Classic window. Waking Lightroom UI, PID:", pid);

        const retryTimer = setTimeout(async function () {
            retryTimers.delete(retryTimer);
            if (!watcherStarted || generation !== watcherGeneration) return;
            const result = await wakeLightroom(pid);

            if (!watcherStarted || generation !== watcherGeneration) return;

            if (result.ok) {
                console.log("Lightroom wake complete.");
            } else {
                console.log("Lightroom wake failed:", result.error || result.stderr);
            }
        }, 4000);
        retryTimers.add(retryTimer);
    } finally {
        watcherBusy = false;
    }
}

function startWatcher() {
    watcherOwners += 1;

    if (!isSupported()) {
        console.log("Lightroom wake watcher disabled: not Windows.");
        return;
    }

    if (watcherStarted) {
        return;
    }

    watcherStarted = true;
    watcherGeneration += 1;
    const generation = watcherGeneration;

    console.log("Lightroom wake watcher started.");

    initialTimer = setTimeout(function () {
        initialTimer = null;
        checkAndWake(generation);
    }, 2000);
    watcherInterval = setInterval(function () { checkAndWake(generation); }, 5000);
}

function stopWatcher() {
    if (watcherOwners > 0) watcherOwners -= 1;
    if (watcherOwners > 0 || !watcherStarted) return;

    watcherStarted = false;
    watcherGeneration += 1;
    watcherBusy = false;
    lastWokenPid = null;

    if (initialTimer !== null) {
        clearTimeout(initialTimer);
        initialTimer = null;
    }
    if (watcherInterval !== null) {
        clearInterval(watcherInterval);
        watcherInterval = null;
    }
    for (const timer of retryTimers) clearTimeout(timer);
    retryTimers.clear();
}

module.exports = {
    isSupported,
    wakeLightroom,
    startWatcher,
    stopWatcher
};
