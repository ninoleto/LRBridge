param([Parameter(Mandatory=$true)][string]$ZipPath)
$ErrorActionPreference = 'Stop'
[void][Reflection.Assembly]::LoadWithPartialName('System.IO.Compression')
[void][Reflection.Assembly]::LoadWithPartialName('System.IO.Compression.FileSystem')
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ZipPath).Path)
try {
    $entry = $archive.GetEntry('release-manifest.json')
    if (-not $entry) { throw 'Release manifest missing from ZIP.' }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    $seen = @{}
    foreach ($file in $manifest.files) {
        if ($file.file -match '(^/|(^|/)\.\.(/|$)|:)') { throw 'Unsafe manifest path.' }
        if ($seen.ContainsKey($file.file)) { throw 'Duplicate manifest path.' }
        $seen[$file.file] = $true
        $item = $archive.GetEntry($file.file)
        if (-not $item -or $item.Length -ne $file.bytes) { throw ('Missing or wrong-sized ZIP entry: ' + $file.file) }
        $hash = [Security.Cryptography.SHA256]::Create(); $stream = $item.Open()
        try { $actual = ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
        finally { $stream.Dispose(); $hash.Dispose() }
        if ($actual -ne $file.sha256) { throw ('ZIP checksum mismatch: ' + $file.file) }
    }
    $fileEntries = @($archive.Entries | Where-Object { -not $_.FullName.EndsWith('/') })
    if ($fileEntries.Count -ne $manifest.files.Count + 1) { throw 'ZIP contains unmanifested or duplicate files.' }
    Write-Output ('Verified ZIP manifest and SHA-256 contents: ' + $manifest.files.Count + ' files plus manifest.')
} finally { $archive.Dispose() }
