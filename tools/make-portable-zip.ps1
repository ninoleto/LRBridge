$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

$pkg = Get-Content "package.json" -Raw | ConvertFrom-Json
$version = $pkg.version

$source = Join-Path $projectRoot "dist\win-unpacked"
$name = "LRBridge-$version-win-x64-portable"
$target = Join-Path $projectRoot "dist\$name"
$zip = Join-Path $projectRoot "dist\$name.zip"

if (-not (Test-Path $source)) {
    throw "Build folder not found: $source"
}

Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $zip -Force -ErrorAction SilentlyContinue

Copy-Item $source $target -Recurse

$required = @(
    "LRBridge.exe",
    "config\settings.txt",
    "config\sliders.json",
    "lightroom\LRBridge.lrplugin\Info.lua",
    "lightroom\LRBridge.lrplugin\Help.lua",
    "lightroom\LRBridge.lrplugin\Application.lua",
    "README.md",
    "llms.txt"
)

foreach ($item in $required) {
    $path = Join-Path $target $item

    if (-not (Test-Path $path)) {
        throw "Portable package is missing required file: $item"
    }
}

Compress-Archive -Path $target -DestinationPath $zip -Force

Write-Host ""
Write-Host "Portable package created:"
Write-Host $zip
