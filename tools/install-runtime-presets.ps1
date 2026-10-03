param([string]$TargetDirectory = (Join-Path $env:APPDATA 'Adobe\CameraRaw\Settings'))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$source = Join-Path (Split-Path $PSScriptRoot -Parent) 'resources\presets'
$manifest = Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
function Get-PresetHash([string]$File) {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($File)
    try { return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
function Test-KnownPreviousPreset([object]$Item, [string]$Hash) {
    return $Hash -eq $Item.legacySha256 -or
        ($Item.PSObject.Properties['previousGroupSha256'] -and $Hash -eq $Item.previousGroupSha256)
}
function Get-MigrationBackup([string]$Target, [object]$Item, [string]$Hash) {
    if ($Hash -eq $Item.legacySha256) { return $Target + '.lrbridge-legacy.bak' }
    return $Target + '.lrbridge-previous-group.bak'
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
        if ($existingHash -ne $item.sha256 -and -not (Test-KnownPreviousPreset $item $existingHash)) {
            throw ('A different preset already exists: ' + $item.name + '. Preserve it and resolve the conflict before installation.')
        }
        if (Test-KnownPreviousPreset $item $existingHash) {
            $backup = Get-MigrationBackup $target $item $existingHash
            if ((Test-Path -LiteralPath $backup) -and (Get-PresetHash $backup) -ne $existingHash) {
                throw ('A different backup already exists: ' + $backup)
            }
        }
    }
}
[void][System.IO.Directory]::CreateDirectory($TargetDirectory)
foreach ($item in $manifest.files) {
    $target = Join-Path $TargetDirectory $item.name
    if (-not (Test-Path -LiteralPath $target)) {
        [System.IO.File]::Copy((Join-Path $source $item.name), $target, $false)
    } else {
        $existingHash = Get-PresetHash $target
        if (Test-KnownPreviousPreset $item $existingHash) {
            $backup = Get-MigrationBackup $target $item $existingHash
            if (-not (Test-Path -LiteralPath $backup)) { [System.IO.File]::Copy($target, $backup, $false) }
            if ((Get-PresetHash $target) -ne $existingHash -or (Get-PresetHash $backup) -ne $existingHash) {
                throw 'Preset changed during group migration; installation stopped.'
            }
            [System.IO.File]::Copy((Join-Path $source $item.name), $target, $true)
        }
    }
    if ((Get-PresetHash $target) -ne $item.sha256) { throw 'Installed checksum mismatch.' }
    Write-Output ('Verified: ' + $item.name)
}
Write-Output 'Dust presets installed. Restart Lightroom to load them.'
