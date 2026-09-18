$ErrorActionPreference = 'Stop'
# Compatibility entry point; all staging, validation and ZIP creation use the clean builder.
& node (Join-Path $PSScriptRoot 'build-windows-candidate.js')
if ($LASTEXITCODE -ne 0) { throw 'Windows candidate build failed.' }
