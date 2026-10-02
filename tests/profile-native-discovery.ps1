param([string]$HelperSourcePath)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
if (-not $HelperSourcePath) { $HelperSourcePath = Join-Path $projectRoot 'server/windows-lightroom-native.ps1' }
$source = [IO.File]::ReadAllText($HelperSourcePath)
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Production helper has PowerShell syntax errors.' }
$discovery = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-ProfileDiscovery' }, $true).Extent.Text
if ($discovery -match 'RootElement|\.FindFirst\(|\.FindAll\(') { throw 'Profile discovery must not traverse desktop accessibility providers.' }
if ($discovery -match 'IsOffscreen|EffectivelyVisible|IsWindowVisible') { throw 'Profile inventory must include collapsed/offscreen items.' }
$processCall = '[System.Diagnostics.Process]::GetProcessesByName("Lightroom")'
if (($discovery.Split(@($processCall), [StringSplitOptions]::None).Count - 1) -ne 1) { throw 'Fixture process seam changed.' }
# Run the production definitions and discovery body, substituting only the
# process source. All HWND, UIA, pattern, sibling and identity reads are real;
# every native fixture write below belongs to this test process, never Lightroom.
$library = $source.Substring(0, $source.IndexOf('while ($null -ne ($line = [Console]::In.ReadLine()))'))
$library = $library.Replace(". (Join-Path `$PSScriptRoot 'windows-remove-selected-identification.ps1')", '')
Invoke-Expression $library
Invoke-Expression ($discovery.Replace($processCall, '(Get-FixtureProcess)'))

$null = Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ProfileDiscoveryFixtureWindows {
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    public static extern IntPtr CreateWindowEx(int exStyle, string className, string title,
        int style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool EnableWindow(IntPtr hwnd, bool enabled);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SendMessageW")]
    public static extern IntPtr AddString(IntPtr hwnd, uint message, IntPtr unused, string text);
}
'@
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function New-FixtureCombo([string[]]$Labels, [int]$Selected = 0) {
    $combo = [ProfileDiscoveryFixtureWindows]::CreateWindowEx(0, 'ComboBox', '', 0x40000203,
        0, 0, 180, 100, $script:fixtureMain, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero)
    Assert ($combo -ne [IntPtr]::Zero) 'Could not create fixture ComboBox.'
    foreach ($label in $Labels) { $null = [ProfileDiscoveryFixtureWindows]::AddString($combo, 0x143, [IntPtr]::Zero, $label) }
    $null = [LRBridgeNative]::SendMessage($combo, 0x14E, [IntPtr]$Selected, [IntPtr]::Zero)
    return $combo
}
function Get-FixtureProcess { return $script:fixtureProcess }
function Assert-Unavailable([string]$Case) {
    try { $null = Get-ProfileDiscovery; throw ('Unexpectedly accepted ' + $Case) }
    catch { Assert ($_.Exception.Message.StartsWith('UNAVAILABLE: ')) ('Expected unavailable discovery for ' + $Case + ': ' + $_.Exception.Message) }
}

$script:fixtureMain = [ProfileDiscoveryFixtureWindows]::CreateWindowEx(0, 'Static', 'LRBridge isolated Profile fixture',
    0, 0, 0, 200, 120, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero)
Assert ($script:fixtureMain -ne [IntPtr]::Zero) 'Could not create fixture window.'
$currentProcess = [Diagnostics.Process]::GetCurrentProcess()
$script:fixtureProcess = [PSCustomObject]@{
    Id=$currentProcess.Id; MainWindowHandle=$script:fixtureMain; StartTime=$currentProcess.StartTime; ChangeOnRefresh=$null
}
$script:fixtureProcess | Add-Member ScriptMethod Refresh {
    switch ($this.ChangeOnRefresh) {
        'window' { $this.MainWindowHandle = [IntPtr]1 }
        'process' { $this.StartTime = $this.StartTime.AddSeconds(1) }
        'combo' { $null = [ProfileDiscoveryFixtureWindows]::DestroyWindow($script:profileCombo) }
    }
}
try {
    $null = New-FixtureCombo @('Unrelated A', 'Unrelated B')
    $names = @(1..48 | ForEach-Object { 'Fixture Profile ' + $_.ToString('00') })
    $script:profileCombo = New-FixtureCombo ($names + @('------', 'Browse...')) 45
    $disabled = New-FixtureCombo @('Disabled Profile', 'Browse...')
    $null = [ProfileDiscoveryFixtureWindows]::EnableWindow($disabled, $false)

    $cold = Get-ProfileDiscovery
    Assert ($cold.ComboHwnd -eq [Int64]$script:profileCombo) 'Cold discovery selected the wrong control.'
    Assert ($cold.Items.Count -eq 48) 'Cold discovery lost virtual/offscreen inventory.'
    Assert (($cold.Items.Label -join '|') -eq ($names -join '|')) 'Inventory labels/order changed.'
    Assert ($cold.Selected.Label -eq $names[45]) 'Selected virtual item did not match native selection.'
    Assert ($cold.Expanded -eq $false) 'Fixture must exercise collapsed inventory.'
    $combo = [System.Windows.Automation.AutomationElement]::FromHandle($script:profileCombo)
    Assert $combo.Current.IsOffscreen 'Fixture must exercise offscreen inventory.'
    $method = [LRBridgeProfileUiaProviders].GetMethod('Register')
    Assert (($method.GetMethodImplementationFlags() -band [Reflection.MethodImplAttributes]::NoInlining) -ne 0) 'Provider bootstrap must retain its declared frame.'

    $null = [LRBridgeNative]::SendMessage($script:profileCombo, 0x14E, [IntPtr]7, [IntPtr]::Zero)
    $warm = Get-ProfileDiscovery
    $label = Get-ProfileDiscovery $true
    Assert ($warm.Selected.Label -eq $names[7] -and $label.SelectedLabel -eq $names[7]) 'Repeated reads reused stale selection.'
    Assert ($warm.Items.Count -eq 48) 'Repeated discovery lost inventory.'
    $extra = New-FixtureCombo @('Other Profile', ('Browse' + [char]0x2026))
    Assert-Unavailable 'ambiguous inventory'
    $null = [ProfileDiscoveryFixtureWindows]::DestroyWindow($extra)

    $script:fixtureProcess.ChangeOnRefresh = 'window'
    Assert-Unavailable 'changed main window'
    $script:fixtureProcess.MainWindowHandle = $script:fixtureMain
    $script:fixtureProcess.ChangeOnRefresh = 'process'
    Assert-Unavailable 'reused process identity'
    $script:fixtureProcess.StartTime = $currentProcess.StartTime
    $script:fixtureProcess.ChangeOnRefresh = 'combo'
    Assert-Unavailable 'destroyed ComboBox'
    $script:fixtureProcess.ChangeOnRefresh = $null
    $script:profileCombo = New-FixtureCombo ($names + @('------', 'Browse...')) 46
    Assert ((Get-ProfileDiscovery).Selected.Label -eq $names[46]) 'Fresh replacement control did not recover.'
    $null = [ProfileDiscoveryFixtureWindows]::EnableWindow($script:profileCombo, $false)
    Assert-Unavailable 'disabled control'
    $null = [ProfileDiscoveryFixtureWindows]::EnableWindow($script:profileCombo, $true)
    Assert ((Get-ProfileDiscovery).Items.Count -eq 48) 'Re-enabled control did not recover.'
    Write-Output 'Profile discovery: real isolated Windows controls; cold providers, 48 collapsed/offscreen items, fresh selection, ambiguity, process/window/control changes and enabled recovery passed. Not Lightroom verification.'
} finally {
    $null = [ProfileDiscoveryFixtureWindows]::DestroyWindow($script:fixtureMain)
}
