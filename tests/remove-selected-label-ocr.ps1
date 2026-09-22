$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../server/windows-remove-selected-identification.ps1')
Initialize-SelectedLabelReader
$fixtures=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'fixtures/remove-selected-labels.json') -Raw | ConvertFrom-Json
foreach($fixture in $fixtures.images) {
    $label=Resolve-SelectedLabel (Read-SelectedLabelVotes ([Convert]::FromBase64String($fixture.png)))
    if($label -cne $fixture.expected){throw "Rendered label recognition failed: $($fixture.name), got '$label'."}
}
'Windows OCR recognized both authorized Selected label crops and rejected the swatch/blank image. Offline images only; no Lightroom input or native acceptance.'
