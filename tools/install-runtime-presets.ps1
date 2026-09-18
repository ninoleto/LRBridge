param([string]$TargetDirectory = (Join-Path $env:APPDATA 'Adobe\CameraRaw\Settings'))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$source = Join-Path (Split-Path $PSScriptRoot -Parent) 'resources\presets'
$manifest = Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw | ConvertFrom-Json
function Get-PresetHash([string]$File) {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($File)
    try { return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
# Validate the entire set before creating or copying anything. Never replace a user's preset.
foreach ($item in $manifest.files) {
    if ($item.name -notin @('LRBridge Dust On.xmp', 'LRBridge Dust Off.xmp')) { throw 'Unexpected preset name.' }
    $bundled = Join-Path $source $item.name
    if ((Get-PresetHash $bundled) -ne $item.sha256) {
        throw ('Bundled preset checksum mismatch: ' + $item.name)
    }
    $target = Join-Path $TargetDirectory $item.name
    if ((Test-Path -LiteralPath $target) -and (Get-PresetHash $target) -ne $item.sha256) {
        throw ('A different preset already exists: ' + $item.name + '. Preserve it and resolve the conflict before installation.')
    }
}
[void][System.IO.Directory]::CreateDirectory($TargetDirectory)
foreach ($item in $manifest.files) {
    $target = Join-Path $TargetDirectory $item.name
    if (-not (Test-Path -LiteralPath $target)) {
        [System.IO.File]::Copy((Join-Path $source $item.name), $target, $false)
    }
    if ((Get-PresetHash $target) -ne $item.sha256) { throw 'Installed checksum mismatch.' }
    Write-Output ('Verified: ' + $item.name)
}
Write-Output 'Dust presets installed. Restart Lightroom to load them.'
