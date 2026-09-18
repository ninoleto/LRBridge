param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$ZipPath)
$ErrorActionPreference = 'Stop'
[void][Reflection.Assembly]::LoadWithPartialName('System.IO.Compression')
[void][Reflection.Assembly]::LoadWithPartialName('System.IO.Compression.FileSystem')
$sourceRoot = (Resolve-Path -LiteralPath $Source).Path.TrimEnd('\', '/')
if (Test-Path -LiteralPath $ZipPath) { throw 'Refusing to replace an existing candidate ZIP.' }
$archive = [IO.Compression.ZipFile]::Open($ZipPath, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in [IO.Directory]::EnumerateFiles($sourceRoot, '*', [IO.SearchOption]::AllDirectories)) {
        $relative = $file.Substring($sourceRoot.Length + 1).Replace('\', '/')
        [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file, $relative, [IO.Compression.CompressionLevel]::Optimal)
    }
} finally { $archive.Dispose() }
