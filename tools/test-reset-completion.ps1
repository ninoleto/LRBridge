param(
    [ValidateSet('Exposure','Contrast','Vibrance','Temperature','ProfileAmount')][string]$Slider = 'Exposure',
    [Nullable[double]]$SetValue,
    [switch]$Run,
    [string]$BaseUrl = 'http://127.0.0.1:17891'
)
$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')
$cap = Invoke-RestMethod -Uri ($base + '/reset/capabilities') -TimeoutSec 5
$current = Invoke-RestMethod -Uri ($base + '/context') -TimeoutSec 5
if (-not $Run) {
    [pscustomobject]@{ mode = 'Read-only preflight; -Run sends editing commands after user readiness'; slider = $Slider;
        serverEpoch = $cap.serverEpoch; selectedPhotoUuid = $cap.context.selectedPhotoUuid;
        contextCounter = $cap.context.contextCounter; contextChangedAt = $cap.context.contextChangedAt;
        activeModule = $current.activeModule; queueLength = $current.queueLength } | ConvertTo-Json
    return
}
if ($current.activeModule -ne 'develop' -or -not $cap.context.selectedPhotoUuid -or
    $current.selectedPhotoUuid -ne $cap.context.selectedPhotoUuid -or $current.contextCounter -ne $cap.context.contextCounter -or
    $current.contextChangedAt -ne $cap.context.contextChangedAt) { throw 'Select a disposable Develop photo with stable current context first.' }
$payload = [ordered]@{
    requestId = [Guid]::NewGuid().ToString(); serverEpoch = $cap.serverEpoch; slider = $Slider
    selectedPhotoUuid = $cap.context.selectedPhotoUuid; contextCounter = $cap.context.contextCounter; contextChangedAt = $cap.context.contextChangedAt
}
$json = $payload | ConvertTo-Json -Compress
Write-Output ('Retain original body if transport fails; no new-ID retry: ' + $json)
if ($null -ne $SetValue) {
    $value = ([double]$SetValue).ToString('R', [Globalization.CultureInfo]::InvariantCulture)
    $set = Invoke-RestMethod -Uri ($base + '/set?slider=' + $Slider + '&value=' + [Uri]::EscapeDataString($value)) -TimeoutSec 5
    if (-not $set.ok) { throw 'Preceding Set was not admitted.' }
}
$admission = Invoke-RestMethod -Method Post -Uri ($base + '/reset') -ContentType 'application/json' -Body $json -TimeoutSec 5
if (-not $admission.ok) { throw 'Identified Reset was not admitted.' }
$retry = Invoke-RestMethod -Method Post -Uri ($base + '/reset') -ContentType 'application/json' -Body $json -TimeoutSec 5
if (-not $retry.duplicate -or $retry.receipt.operationId -ne $admission.receipt.operationId) { throw 'Identical retry did not preserve the exact Reset operation.' }
$route = $base + '/reset/result?serverEpoch=' + [Uri]::EscapeDataString($payload.serverEpoch) + '&requestId=' + $payload.requestId
$deadline = [DateTime]::UtcNow.AddSeconds(65)
do {
    $reply = Invoke-RestMethod -Uri $route -TimeoutSec 5
    if ($reply.receipt.phase -eq 'complete') {
        $reply.receipt | ConvertTo-Json -Depth 8
        if ($reply.receipt.result.outcome -eq 'observed') {
            Write-Output 'Compare the immediate SDK value to Lightroom yourself; observed is not native timing acceptance.'
        } else {
            Write-Output ('Reset outcome: ' + $reply.receipt.result.outcome + '; no confirmed SDK baseline. Inspect Lightroom before sending another operation.')
        }
        return
    }
    Start-Sleep -Milliseconds 200
} while ([DateTime]::UtcNow -lt $deadline)
throw ('No completion received. Inspect Lightroom and retain request ID ' + $payload.requestId + '; no new operation was sent.')
