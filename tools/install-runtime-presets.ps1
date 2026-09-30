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
# Validate the entire set before writing. Only the exact earlier bundled files
# may be migrated; preserve them beside the replacement with a non-XMP suffix.
foreach ($item in $manifest.files) {
    if ($item.name -notin @('LRBridge Dust On.xmp', 'LRBridge Dust Off.xmp')) { throw 'Unexpected preset name.' }
    $bundled = Join-Path $source $item.name
    if ((Get-PresetHash $bundled) -ne $item.sha256) {
        throw ('Bundled preset checksum mismatch: ' + $item.name)
    }
    $target = Join-Path $TargetDirectory $item.name
    if (Test-Path -LiteralPath $target) {
        $existingHash = Get-PresetHash $target
        if ($existingHash -ne $item.sha256 -and $existingHash -ne $item.legacySha256) {
            throw ('A different preset already exists: ' + $item.name + '. Preserve it and resolve the conflict before installation.')
        }
        $backup = $target + '.lrbridge-legacy.bak'
        if ($existingHash -eq $item.legacySha256 -and (Test-Path -LiteralPath $backup) -and (Get-PresetHash $backup) -ne $item.legacySha256) {
            throw ('A different backup already exists: ' + $backup)
        }
    }
}
[void][System.IO.Directory]::CreateDirectory($TargetDirectory)
foreach ($item in $manifest.files) {
    $target = Join-Path $TargetDirectory $item.name
    if (-not (Test-Path -LiteralPath $target)) {
        [System.IO.File]::Copy((Join-Path $source $item.name), $target, $false)
    } elseif ((Get-PresetHash $target) -eq $item.legacySha256) {
        $backup = $target + '.lrbridge-legacy.bak'
        if (-not (Test-Path -LiteralPath $backup)) { [System.IO.File]::Copy($target, $backup, $false) }
        if ((Get-PresetHash $target) -ne $item.legacySha256 -or (Get-PresetHash $backup) -ne $item.legacySha256) {
            throw 'Preset changed during group migration; installation stopped.'
        }
        [System.IO.File]::Copy((Join-Path $source $item.name), $target, $true)
    }
    if ((Get-PresetHash $target) -ne $item.sha256) { throw 'Installed checksum mismatch.' }
    Write-Output ('Verified: ' + $item.name)
}
Write-Output 'Dust presets installed. Restart Lightroom to load them.'
