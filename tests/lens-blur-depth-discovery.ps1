param([string]$SourcePath = (Join-Path $PSScriptRoot '../server/windows-lightroom-native.ps1'))
$ErrorActionPreference = 'Stop'
# Production PowerShell functions with in-memory Win32/process doubles only.
# No helper process, real windows, UI automation, Lightroom reads or edits.
$source = Get-Content -LiteralPath $SourcePath -Raw
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$functions = @('Throw-Unavailable', 'Get-WindowSnapshot', 'Get-LightroomWindows', 'Find-WindowByHandle',
    'Test-AfxParent', 'Test-IsDescendantOfSnapshot', 'Find-LensBlurRoot', 'Find-UniqueButtonInRoot',
    'Add-AnchorIdentity', 'Assert-AnchorIdentity', 'Assert-ButtonIdentity', 'Read-Checkbox',
    'Try-ReadCheckbox', 'Public-CheckboxState', 'Get-DepthVisualizationState')
if ($source.Contains('function Get-LightroomWindowsForDepth')) { $functions += 'Get-LightroomWindowsForDepth' }
foreach ($name in $functions) {
    $node = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if ($null -eq $node) { throw "Missing production function: $name" }
    $definition = $node.Extent.Text
    if ($name -in @('Get-LightroomWindows', 'Get-LightroomWindowsForDepth')) {
        $processCall = '[System.Diagnostics.Process]::GetProcessesByName("Lightroom")'
        if (-not $definition.Contains($processCall)) { throw 'Process-enumeration fixture seam changed' }
        $definition = $definition.Replace($processCall, '[LRBridgeNative]::FixtureProcesses()')
    }
    . ([scriptblock]::Create($definition))
}
$null = Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
public class DepthTestWindow {
    public long Parent; public int ProcessId=50; public string Class; public string Text;
    public int ControlId=100; public int Style=2; public bool Visible=true; public bool Enabled=true;
}
public class DepthTestProcess { public int Id=50; }
public static class LRBridgeNative {
    public struct RECT { public int Left,Top,Right,Bottom; }
    public static Dictionary<long,DepthTestWindow> Windows=new Dictionary<long,DepthTestWindow>();
    public static int TrackReads, CheckReads, Discoveries, UnrelatedSnapshots;
    public static bool Checked, AccessibleChecked;
    public static DepthTestProcess[] FixtureProcesses() { return new [] { new DepthTestProcess() }; }
    public static IntPtr[] GetProcessWindows(int pid) {
        Discoveries++; var handles=new List<IntPtr>();
        foreach(var item in Windows) if(item.Value.ProcessId==pid) handles.Add(new IntPtr(item.Key));
        return handles.ToArray();
    }
    public static bool IsWindow(IntPtr h) { return Windows.ContainsKey(h.ToInt64()); }
    public static int ProcessId(IntPtr h) { return Windows[h.ToInt64()].ProcessId; }
    public static bool GetWindowRect(IntPtr h,ref RECT rect) {
        if (Windows[h.ToInt64()].Class=="msctls_trackbar32") UnrelatedSnapshots++;
        rect.Right=500;rect.Bottom=500;return true;
    }
    public static string ClassName(IntPtr h) { return Windows[h.ToInt64()].Class; }
    public static string WindowText(IntPtr h) { return Windows[h.ToInt64()].Text; }
    public static IntPtr GetParent(IntPtr h) { return new IntPtr(Windows[h.ToInt64()].Parent); }
    public static int GetDlgCtrlID(IntPtr h) { return Windows[h.ToInt64()].ControlId; }
    public static int GetWindowLong(IntPtr h,int index) { return Windows[h.ToInt64()].Style; }
    public static bool EffectivelyVisible(IntPtr h) { return Windows[h.ToInt64()].Visible; }
    public static bool IsWindowEnabled(IntPtr h) { return Windows[h.ToInt64()].Enabled; }
    public static bool IsDescendantOf(IntPtr handle,IntPtr root) {
        var h=handle.ToInt64();
        for(int i=0;i<20 && Windows.ContainsKey(h);i++) { h=Windows[h].Parent;if(h==root.ToInt64()) return true; }
        return false;
    }
    public static long SendMessage(IntPtr h,int message,IntPtr w,IntPtr l) {
        if(message==0x00f0) { CheckReads++;return Checked?1:0; }
        if(message==0x0401||message==0x0400||message==0x0402) { TrackReads++;return message==0x0402?100:0; }
        throw new Exception("Unexpected native operation; fixture allows reads only");
    }
    public static int AccessibleState(IntPtr h) { return AccessibleChecked?0x10:0; }
}
'@
$TBM_GETPOS=0x0400; $TBM_GETRANGEMIN=0x0401; $TBM_GETRANGEMAX=0x0402
$BM_GETCHECK=0x00F0; $BST_UNCHECKED=0; $BST_CHECKED=1; $STATE_SYSTEM_CHECKED=0x10; $GWL_STYLE=-16
function Assert($condition, $message) { if (-not $condition) { throw $message } }
function Add-Window([long]$handle,[long]$parent,[string]$class,[string]$text) {
    $window = [DepthTestWindow]::new(); $window.Parent=$parent; $window.Class=$class; $window.Text=$text
    [LRBridgeNative]::Windows.Add($handle,$window)
}
Add-Window 1 0 'AfxWnd140u' 'Develop_LensBlurView'
Add-Window 2 1 'AfxWnd140u' 'LensBlurContents'
Add-Window 3 2 'Button' 'Visualize Depth'
foreach ($handle in 100..119) { Add-Window $handle 2 'msctls_trackbar32' '' }
$off = Get-DepthVisualizationState
Assert ($off.available -and $off.value -eq $false) 'Fresh Off checkbox must remain readable'
Write-Output "Focused depth discovery: $([LRBridgeNative]::TrackReads) unrelated track reads; $([LRBridgeNative]::CheckReads) checkbox read."
Assert ([LRBridgeNative]::TrackReads -eq 0) 'Focused Visualize Depth read must not synchronously query unrelated slider ranges/positions'
Assert ([LRBridgeNative]::CheckReads -eq 1) 'One native checkbox read, with accessibility agreement'
Assert ([LRBridgeNative]::UnrelatedSnapshots -eq 0) 'Depth must not build full identity/geometry snapshots of unrelated slider windows'
[LRBridgeNative]::Checked=$true; [LRBridgeNative]::AccessibleChecked=$true
$on = Get-DepthVisualizationState
Assert ($on.available -and $on.value -eq $true -and [LRBridgeNative]::Discoveries -eq 2) 'Each read must freshly discover and confirm the new state'
[LRBridgeNative]::AccessibleChecked=$false
Assert (-not (Get-DepthVisualizationState).available) 'Native/accessibility disagreement must remain unavailable'
[LRBridgeNative]::AccessibleChecked=$true
foreach ($property in @('Visible','Enabled')) {
    [LRBridgeNative]::Windows[3].$property=$false
    Assert (-not (Get-DepthVisualizationState).available) "Unavailable checkbox: $property"
    [LRBridgeNative]::Windows[3].$property=$true
}
[LRBridgeNative]::Windows[2].Text='Other panel'
Assert (-not (Get-DepthVisualizationState).available) 'Changed Lens Blur anchor must fail closed'
[LRBridgeNative]::Windows[2].Text='LensBlurContents'
Add-Window 4 2 'Button' 'Visualize Depth'
Assert (-not (Get-DepthVisualizationState).available) 'Ambiguous matching buttons must fail closed'
[void][LRBridgeNative]::Windows.Remove(4)
Add-Window 5 1 'AfxWnd140u' 'LensBlurContents'
Assert (-not (Get-DepthVisualizationState).available) 'Duplicate panel roots must fail closed'
[void][LRBridgeNative]::Windows.Remove(5)
[LRBridgeNative]::Windows[3].ProcessId=51
Assert (-not (Get-DepthVisualizationState).available) 'A checkbox from another process must fail closed'
[LRBridgeNative]::Windows[3].ProcessId=50
[LRBridgeNative]::Windows[3].Parent=1
Assert (-not (Get-DepthVisualizationState).available) 'Reparented checkbox outside Lens Blur must fail closed'
[LRBridgeNative]::Windows[3].Parent=2
[LRBridgeNative]::TrackReads=0
$full = Get-LightroomWindows
Assert ([LRBridgeNative]::TrackReads -eq 60) 'Ordinary discovery must preserve three reads for each of the twenty fixture sliders'
Assert (($full | Where-Object Class -eq 'msctls_trackbar32').Count -eq 20) 'Ordinary track snapshots remain present'
Assert (($full | Where-Object Handle -eq 100).NativeMax -eq 100) 'Ordinary native range remains unchanged'
Write-Output 'PASS focused read: no unrelated track queries; fresh On/Off, disagreement, visibility/enablement, owner/duplicate safeguards; ordinary full discovery unchanged. In-memory fixtures only.'
