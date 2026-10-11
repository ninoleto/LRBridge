param(
    [ValidateSet('Exposure','Temperature','ProfileAmount')][string]$Slider = 'Exposure',
    [string]$Steps = '1,1,-1',
    [switch]$SkipReset,
    [string]$BaseUrl = 'http://127.0.0.1:17891'
)
$ErrorActionPreference = 'Stop'
$counts = @($Steps.Split(',') | ForEach-Object {
    if ($_ -notmatch '^-?\d+$') { throw 'Steps must be comma-separated integer numeric-step counts.' }
    [int]$_
})
$base = $BaseUrl.TrimEnd('/')
$cap = Invoke-RestMethod -Uri ($base + '/nudge/capabilities') -TimeoutSec 5
$payload = [ordered]@{
    requestId = [Guid]::NewGuid().ToString()
    serverEpoch = $cap.serverEpoch
    slider = $Slider
    steps = $counts
    selectedPhotoUuid = $cap.context.selectedPhotoUuid
    contextCounter = $cap.context.contextCounter
    contextChangedAt = $cap.context.contextChangedAt
}
if (-not $payload.selectedPhotoUuid) { throw 'Select a disposable photo in Lightroom Develop first.' }
if (-not $SkipReset) {
    $reset = Invoke-RestMethod -Uri ($base + '/reset?slider=' + $Slider) -TimeoutSec 5
    if (-not $reset.ok) { throw 'Reset was not admitted.' }
}
# No baseline read or delay between Reset admission and relative-command admission.
Write-Output ('Nudge request ID (retain if transport fails): ' + $payload.requestId)
$admission = Invoke-RestMethod -Method Post -Uri ($base + '/nudge') -ContentType 'application/json' -Body ($payload | ConvertTo-Json -Compress) -TimeoutSec 5
$route = $base + '/nudge/result?serverEpoch=' + [Uri]::EscapeDataString($payload.serverEpoch) + '&requestId=' + $payload.requestId
$deadline = [DateTime]::UtcNow.AddSeconds(65)
do {
    $reply = Invoke-RestMethod -Uri $route -TimeoutSec 5
    if ($reply.receipt.phase -eq 'complete') { $reply.receipt | ConvertTo-Json -Depth 8; return }
    Start-Sleep -Milliseconds 50
} while ([DateTime]::UtcNow -lt $deadline)
throw ('No completion received. Inspect Lightroom and retain request ID ' + $payload.requestId + '; no retry was sent.')
