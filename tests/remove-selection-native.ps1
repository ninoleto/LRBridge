$ErrorActionPreference = 'Stop'
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../server/windows-lightroom-native.ps1') -Raw
$tokens = $null; $parseErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$start = $source.IndexOf('function Find-RemoveSelection(')
$end = $source.IndexOf('function Invoke-RemoveSelection(')
. ([scriptblock]::Create($source.Substring($start,$end-$start)))
. (Join-Path $PSScriptRoot '../server/windows-remove-selected-identification.ps1')
function New-AutomaticRemoveRefinementBinding { $script:blockedLabelReads++; throw 'Label recognition is unavailable in this fixture yet.' }
function Find-WindowByHandle($Windows,$Handle) { return $Windows | Where-Object { $_.Handle -eq $Handle } }
function Test-IsDescendantOfSnapshot($Window,$Ancestor,$Windows) {
    if ($Window.ProcessId -ne $Ancestor.ProcessId) { return $false }
    $w = $Window
    for($i=0;$i -lt 20;$i++) {
        if ($w.Parent -eq $Ancestor.Handle) { return $true }
        $w = Find-WindowByHandle $Windows $w.Parent
        if ($null -eq $w) { return $false }
    }
    return $false
}
function Assert($Condition,$Message) { if (-not $Condition) { throw $Message } }
function Window($Handle,$Parent,$Class,$Text,$Id=100) {
    return [pscustomobject]@{Handle=$Handle;Parent=$Parent;ProcessId=50;Class=$Class;Text=$Text;ControlId=$Id;
        Style=1442840576;Visible=$true;Enabled=$true;NativeMin=1000;NativeMax=100000}
}
$windows = @(
    (Window 1 0 'AfxWnd140u' 'Collapsible Section'),
    (Window 2 1 'AfxWnd140u' 'Remove'),
    (Window 3 2 'AfxWnd140u' 'View'),
    (Window 4 3 'Static' 'Mask:'),
    (Window 5 3 'Static' 'Size'),
    (Window 6 3 'msctls_trackbar32' ''),
    (Window 7 3 'Button' 'Cancel' 65535),
    (Window 8 3 'AfxWnd140u' 'Remove (Bridge View)' 65535),
    # People lookalikes must never be selected.
    (Window 9 1 'AfxWnd140u' 'View'),
    (Window 10 9 'Button' 'Cancel' 65535),
    (Window 11 9 'AfxWnd140u' 'Remove (Bridge View)' 65535)
)
$d = Find-RemoveSelection $windows
Assert ($d.Group.Handle -eq 3 -and $d.Cancel.Handle -eq 7 -and $d.Submit.Handle -eq 8) 'Manual group identity'
$state = Get-RemoveSelectionState $d
Assert ($state.available -and $state.active -and $state.canCancel -and $state.canRemove -and $state.sizeAvailable) 'Active state'
Assert (-not $state.canSetMode -and $null -eq $state.mode) 'No fabricated Add/Subtract mode'
$windows[7].Enabled = $false
Assert (-not (Get-RemoveSelectionState (Find-RemoveSelection $windows)).canRemove) 'Native disabled Remove'
$windows[7].Enabled = $true
$windows[5].Visible = $false
Assert (-not (Get-RemoveSelectionState (Find-RemoveSelection $windows)).available) 'Mixed visibility is unknown'
foreach($w in $windows) { $w.Visible=$false }
$state = Get-RemoveSelectionState (Find-RemoveSelection $windows)
Assert ($state.available -and -not $state.active -and -not $state.canCancel -and -not $state.canRemove -and -not $state.sizeAvailable) 'Inactive lifecycle'
Assert ($null -eq (Find-RemoveSelection @($windows | Where-Object {$_.Handle -ne 4}))) 'Missing Mask anchor fails closed'
Assert ($null -eq (Find-RemoveSelection ($windows + (Window 12 3 'Button' 'Cancel' 65535)))) 'Duplicate Cancel fails closed'
$windows[5].NativeMax = 200000
Assert ($null -eq (Find-RemoveSelection $windows)) 'Wrong track range fails closed'
$windows[5].NativeMax = 100000
$windows[1].Text = 'People'
Assert ($null -eq (Find-RemoveSelection $windows)) 'Wrong owner fails closed'
$windows[1].Text = 'Remove'
foreach($w in $windows) { $w.Visible=$true }
# Exercise the production activation function against in-memory Win32 doubles.
# No native imports, processes, keyboard/mouse input or Lightroom actions.
$null = Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
public class LRBridgeTestWindow {
    public long Parent; public int ProcessId; public string Class; public string Text;
    public int ControlId; public int Style; public bool Visible; public bool Enabled;
}
public static class LRBridgeNative {
    public struct RECT { public int Left,Top,Right,Bottom; }
    public static Dictionary<long,LRBridgeTestWindow> Windows = new Dictionary<long,LRBridgeTestWindow>();
    public static List<long> Posted = new List<long>();
    public static bool FailSecondPost;
    public static IntPtr[] GetProcessWindows(int pid) {
        var list=new List<IntPtr>(); foreach(var w in Windows) if(w.Value.ProcessId==pid) list.Add(new IntPtr(w.Key)); return list.ToArray();
    }
    public static IntPtr[] GetWindowTree(IntPtr root,int pid) {
        var list=new List<IntPtr>();
        foreach(var w in Windows) {
            long h=w.Key;
            for(int i=0;i<32 && Windows.ContainsKey(h);i++) {
                if(h==root.ToInt64()) { list.Add(new IntPtr(w.Key)); break; } h=Windows[h].Parent;
            }
        }
        return list.ToArray();
    }
    public static bool IsWindow(IntPtr h) { return Windows.ContainsKey(h.ToInt64()); }
    public static int ProcessId(IntPtr h) { return Windows[h.ToInt64()].ProcessId; }
    public static IntPtr GetParent(IntPtr h) { return new IntPtr(Windows[h.ToInt64()].Parent); }
    public static string ClassName(IntPtr h) { return Windows[h.ToInt64()].Class; }
    public static string WindowText(IntPtr h) { return Windows[h.ToInt64()].Text; }
    public static int GetDlgCtrlID(IntPtr h) { return Windows[h.ToInt64()].ControlId; }
    public static int GetWindowLong(IntPtr h,int index) { return Windows[h.ToInt64()].Style; }
    public static bool EffectivelyVisible(IntPtr h) { return Windows[h.ToInt64()].Visible; }
    public static bool IsWindowEnabled(IntPtr h) { return Windows[h.ToInt64()].Enabled; }
    public static bool GetClientRect(IntPtr h,ref RECT rect) { rect.Right=70;rect.Bottom=24;return true; }
    public static bool IsDescendantOf(IntPtr h,IntPtr owner) {
        for(int i=0;i<32 && Windows.ContainsKey(h.ToInt64());i++) { h=GetParent(h); if(h==owner)return true; } return false;
    }
    public static bool PostMessage(IntPtr h,uint message,IntPtr wParam,IntPtr lParam) { Posted.Add(h.ToInt64());return !(FailSecondPost && Posted.Count==2); }
}
'@
$BM_CLICK=0xF5;$GWL_STYLE=-16;$WM_LBUTTONDOWN=0x201;$WM_LBUTTONUP=0x202;$MK_LBUTTON=1
function Get-LightroomWindows { return $windows }
function Invoke-RestMethod($Uri,$TimeoutSec) {
    Assert ($Uri -match '^http://127\.0\.0\.1:17891/remove/selection-validate\?') 'Only SDK challenge URL'
    if ($script:changeTarget) { [LRBridgeNative]::Windows[7].Text='Unrelated' }
    return @{valid=$script:guardAllowed}
}
function Reset-Double {
    [LRBridgeNative]::Windows.Clear();[LRBridgeNative]::Posted.Clear()
    foreach($w in $windows) {
        $record = New-Object LRBridgeTestWindow
        foreach($key in @('Parent','ProcessId','Class','Text','ControlId','Style','Visible','Enabled')) { $record.$key=$w.$key }
        [LRBridgeNative]::Windows[$w.Handle]=$record
    }
    $script:guardAllowed=$true;$script:changeTarget=$false
}
$start=$source.IndexOf('function Get-RemoveSelectionDiscovery(');$end=$source.IndexOf('function Find-RemoveSelection(')
. ([scriptblock]::Create($source.Substring($start,$end-$start)))
$script:snapshots=0
function Get-WindowSnapshot($Handle,$ProcessId) {
    $script:snapshots++
    return $script:windows | Where-Object { $_.Handle -eq [long]$Handle -and $_.ProcessId -eq $ProcessId }
}
Reset-Double
$scoped=Get-RemoveSelectionDiscovery @([pscustomobject]@{Id=50})
Assert ($scoped.Token -eq (Find-RemoveSelection $windows).Token) 'Scoped discovery retains the full manual identity'
Assert ($script:snapshots -eq 8) 'Only the manual section and its parent are snapshotted; unrelated People controls are excluded'
$windows[6].Enabled=$false
Assert (-not (Get-RemoveSelectionState (Get-RemoveSelectionDiscovery @([pscustomobject]@{Id=50}))).canCancel) 'Every scoped poll reads current enabled state'
$windows[6].Enabled=$true
$windows[5].Visible=$false
Assert (-not (Get-RemoveSelectionState (Get-RemoveSelectionDiscovery @([pscustomobject]@{Id=50}))).available) 'Failed/mixed scoped reads cannot retain cached success'
$windows[5].Visible=$true
Assert ($null -eq (Get-RemoveSelectionDiscovery @())) 'Missing process invalidates discovery'
$start=$source.IndexOf('function Post-VerifiedClientClick(');$end=$source.IndexOf('function Assert-FocusRangeActionIdentity(')
. ([scriptblock]::Create($source.Substring($start,$end-$start)))
$start=$source.IndexOf('function Invoke-RemoveSelection(');$end=$source.IndexOf('function Invoke-Request(')
. ([scriptblock]::Create($source.Substring($start,$end-$start)))
foreach($action in @('cancel','remove')) {
    Reset-Double
    $labelReadCount=$script:blockedLabelReads
    $request=[pscustomobject]@{action=$action;token=(Find-RemoveSelection $windows).Token;validationUrl='http://127.0.0.1:17891/remove/selection-validate?operationId=rb-1'}
    $beforeState=Get-RemoveSelectionState (Find-RemoveSelection $windows) -SelectionOnly
    Assert ($beforeState.active -and $beforeState.canCancel -and $beforeState.canRemove -and $beforeState.sizeAvailable) 'Cancel/Remove lifecycle has no label-reader dependency'
    $sent=Invoke-RemoveSelection $request
    Assert ($script:blockedLabelReads -eq $labelReadCount) 'Cancel/Remove activation never invokes OCR'
    Assert ($sent.sent -eq $true) 'Target activation posted'
    $expected=if($action -eq 'cancel') {7} else {8}
    $count=if($action -eq 'cancel') {1} else {2}
    Assert ([LRBridgeNative]::Posted.Count -eq $count -and @([LRBridgeNative]::Posted | Where-Object {$_ -ne $expected}).Count -eq 0) 'Only the identified manual target receives messages'
    foreach($failure in @('guard','identity','token')) {
        Reset-Double
        if($failure -eq 'guard') {$script:guardAllowed=$false}
        if($failure -eq 'identity') {$script:changeTarget=$true}
        if($failure -eq 'token') {$request.token='9:8:7:6:5:4:3:2'}
        $rejected=$false
        try { $null=Invoke-RemoveSelection $request } catch { $rejected=$true }
        Assert ($rejected -and [LRBridgeNative]::Posted.Count -eq 0) 'Stale SDK context/control identity must prevent any activation'
    }
}
'Selected native discovery/activation: manual/People separation, active/inactive/unknown, duplicate identity, target-only messages and live SDK guard rejection passed (synthetic windows; no native actions).'

# Command-only refinement consumes automatically recognized labels, never pane order.
$windows += (Window 12 3 'AfxWnd140u' ' (Bridge View)' 65535), (Window 13 3 'AfxWnd140u' ' (Bridge View)' 65535)
$windows[-2] | Add-Member -NotePropertyName renderedLabel -NotePropertyValue Add
$windows[-1] | Add-Member -NotePropertyName renderedLabel -NotePropertyValue Subtract
function Get-RemoveSelectionDiscovery { return Find-RemoveSelection $script:windows }
function Get-RemoveRefinementProcessStart($processId) { return '2026-09-20T00:00:00.0000000Z' }
function New-AutomaticRemoveRefinementBinding { $script:labelReads++; return $script:refinementBinding }
foreach($action in @('add','subtract')) {
    foreach($failure in @('none','guard','identity','token','process','expiry','label','partial')) {
        Reset-Double; [LRBridgeNative]::FailSecondPost=$false; $script:RemoveRefinementBinding=$null; $script:labelReads=0
        $d=Find-RemoveSelection $windows
        $script:refinementBinding=[pscustomobject]@{version=2;token=$d.Token;candidateKey='12:13';processStartedAt='2026-09-20T00:00:00.0000000Z';
            expiresAt=[DateTime]::UtcNow.AddHours(1).ToString('o');add=$windows[-2];subtract=$windows[-1]}
        $request=@{action=$action;token=$d.Token+':12:13';validationUrl='http://127.0.0.1:17891/remove/selection-validate?operationId=test'}
        if($failure -eq 'guard'){$script:guardAllowed=$false}
        if($failure -eq 'identity'){$script:changeTarget=$true}
        if($failure -eq 'token'){$request.token=$d.Token+':13:12'}
        if($failure -eq 'process'){$script:refinementBinding.processStartedAt='wrong-process'}
        if($failure -eq 'expiry'){$script:refinementBinding.expiresAt=[DateTime]::UtcNow.AddHours(-1).ToString('o')}
        if($failure -eq 'label'){$windows[-2].renderedLabel='Subtract'}
        if($failure -eq 'partial'){[LRBridgeNative]::FailSecondPost=$true}
        if($failure -eq 'none'){
            $state=Get-RemoveSelectionState $d
            Assert ($state.canAdd -and $state.canSubtract -and -not $state.canSetMode -and $null -eq $state.mode) 'Proven command capability does not invent mode readback'
        }
        $result=Invoke-RemoveSelectionRefinement $request
        if($failure -eq 'none'){
            $target=if($action -eq 'add'){12}else{13}
            Assert ($result.sent -and -not $result.modeConfirmed -and [LRBridgeNative]::Posted.Count -eq 2 -and @([LRBridgeNative]::Posted | Where-Object {$_ -ne $target}).Count -eq 0) 'Exactly the requested verified target gets one press/release'
            Assert ($result.diagnostics.target -eq $target -and $result.diagnostics.sdkGuard -eq $true -and $result.diagnostics.posts.Count -eq 2) 'Diagnostics identify the selected target and successful SDK guard'
            Assert ($result.diagnostics.posts[0].message -eq 0x201 -and $result.diagnostics.posts[0].posted -and $result.diagnostics.posts[1].message -eq 0x202 -and $result.diagnostics.posts[1].posted) 'Diagnostics establish both posted messages without claiming mode acceptance'
        }elseif($failure -eq 'partial'){
            Assert (-not $result.sent -and $result.inputStatus -eq 'unknown' -and [LRBridgeNative]::Posted.Count -eq 2) 'Partial delivery remains uncertain and is never retried'
            Assert ($result.diagnostics.posts[0].posted -and -not $result.diagnostics.posts[1].posted) 'Partial delivery remains distinguishable from rejection before input'
        }else{
            Assert (-not $result.sent -and $result.inputStatus -eq 'not_sent' -and [LRBridgeNative]::Posted.Count -eq 0) 'Failed identity/SDK guard sends no input'
            Assert ($result.diagnostics.posts.Count -eq 0) 'Rejected validation has an empty delivery trace'
        }
        $windows[-2].renderedLabel='Add'
    }
}
# Recognition consistency rejects missing, conflicting and single-variant labels.
Assert ((Resolve-SelectedLabel @(@('add'),@(),@('add'))) -eq 'add') 'Two agreeing rendered label variants identify Add'
Assert ((Resolve-SelectedLabel @(@('subtract'),@('subtract'),@())) -eq 'subtract') 'Two agreeing rendered label variants identify Subtract'
Assert ($null -eq (Resolve-SelectedLabel @(@('add'),@(),@()))) 'One OCR match is insufficient'
Assert ($null -eq (Resolve-SelectedLabel @(@('add'),@('subtract'),@('add')))) 'Conflicting labels are ambiguous'
Assert ($null -eq (Resolve-SelectedLabel @(@(),@(),@()))) 'Blank/swatches cannot become a mode'
Reset-Double; [LRBridgeNative]::FailSecondPost=$false; $script:RemoveRefinementBinding=$null; $script:labelReads=0
$d=Find-RemoveSelection $windows
$script:refinementBinding=[pscustomobject]@{version=2;token=$d.Token;candidateKey='12:13';processStartedAt='2026-09-20T00:00:00.0000000Z';
    expiresAt=[DateTime]::UtcNow.AddSeconds(15).ToString('o');add=$windows[-2];subtract=$windows[-1]}
Assert ((Get-RemoveRefinementBinding $d).available) 'First read discovers current labels'
Assert ((Get-RemoveRefinementBinding $d).available -and $script:labelReads -eq 1) 'Validated live identities reuse bounded memory'
foreach($invalidator in @('expiry','process','candidate')) {
    $old=$script:refinementBinding.PSObject.Copy()
    if($invalidator -eq 'expiry'){$old.expiresAt=[DateTime]::UtcNow.AddSeconds(-1).ToString('o')}
    if($invalidator -eq 'process'){$old.processStartedAt='old-lightroom-process'}
    if($invalidator -eq 'candidate'){$old.candidateKey='old-controls'}
    $script:RemoveRefinementBinding=$old;$before=$script:labelReads
    Assert ((Get-RemoveRefinementBinding $d).available -and $script:labelReads -eq $before+1) 'Expired/process/recreated identities rediscover automatically in the same read'
}
$before=$script:labelReads
Assert ((Get-RemoveRefinementBinding $d -Fresh).available -and $script:labelReads -eq $before+1) 'Action-time identification always re-reads labels'
$originalWindows=$windows
$windows=@($windows[0..($windows.Count-3)])+(Window 22 3 'AfxWnd140u' ' (Bridge View)' 65535)+(Window 23 3 'AfxWnd140u' ' (Bridge View)' 65535)
$windows[-2] | Add-Member -NotePropertyName renderedLabel -NotePropertyValue Add
$windows[-1] | Add-Member -NotePropertyName renderedLabel -NotePropertyValue Subtract
Reset-Double
$script:refinementBinding=$script:refinementBinding.PSObject.Copy()
$script:refinementBinding.add=$windows[-2];$script:refinementBinding.subtract=$windows[-1];$script:refinementBinding.candidateKey='22:23'
$recreated=Get-RemoveRefinementBinding (Find-RemoveSelection $windows)
Assert ($recreated.available -and $recreated.token.EndsWith(':22:23')) 'Recreated controls are recognized without saved IDs'
$oldRequest=@{action='add';token=$d.Token+':12:13';validationUrl='http://127.0.0.1:17891/remove/selection-validate?operationId=old'}
$rejected=Invoke-RemoveSelectionRefinement $oldRequest
Assert (-not $rejected.sent -and $rejected.inputStatus -eq 'not_sent' -and [LRBridgeNative]::Posted.Count -eq 0) 'An old admitted request never follows replacement controls'
$windows=$originalWindows;Reset-Double;$script:RemoveRefinementBinding=$null
function New-AutomaticRemoveRefinementBinding { throw 'Current OCR read failed' }
$result=Get-RemoveRefinementBinding $d -Fresh
Assert (-not $result.available -and $result.reason -match 'Current OCR read failed' -and $null -eq $script:RemoveRefinementBinding) 'Failed reads invalidate old success and expose the actual failure'
Assert ((Get-RemoveSelectionState $d).canCancel -and (Get-RemoveSelectionState $d).canRemove -and (Get-RemoveSelectionState $d).sizeAvailable) 'Label failures preserve Size/Cancel/Remove'
'Selected Add/Subtract: automatic renewal, OCR ambiguity/failure, fresh action read, process/ownership/expiry, SDK rejection, exact target and uncertain partial delivery passed (Win32 doubles only).'
