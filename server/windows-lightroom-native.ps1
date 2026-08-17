$ErrorActionPreference = "Stop"

$nativeSource = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

public static class LRBridgeNative
{
    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder text, int maximum);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowTextLength(IntPtr hwnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int maximum);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rectangle);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out RECT rectangle);
    [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr SendMessageTimeout(
        IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool InvalidateRect(IntPtr hwnd, IntPtr rectangle, bool erase);
    [DllImport("user32.dll")] public static extern bool RedrawWindow(IntPtr hwnd, IntPtr rectangle, IntPtr region, uint flags);
    [DllImport("oleacc.dll")] private static extern int AccessibleObjectFromWindow(
        IntPtr hwnd, uint objectId, ref Guid interfaceId, [MarshalAs(UnmanagedType.Interface)] out object accessible);

    public static IntPtr[] GetProcessWindows(int processId)
    {
        HashSet<IntPtr> handles = new HashSet<IntPtr>();
        EnumWindowsProc topCallback = delegate(IntPtr hwnd, IntPtr unused) {
            uint owner;
            GetWindowThreadProcessId(hwnd, out owner);
            if (owner != (uint)processId) return true;
            handles.Add(hwnd);
            EnumWindowsProc childCallback = delegate(IntPtr child, IntPtr childUnused) {
                uint childOwner;
                GetWindowThreadProcessId(child, out childOwner);
                if (childOwner == (uint)processId) handles.Add(child);
                return true;
            };
            EnumChildWindows(hwnd, childCallback, IntPtr.Zero);
            return true;
        };
        EnumWindows(topCallback, IntPtr.Zero);
        IntPtr[] result = new IntPtr[handles.Count];
        handles.CopyTo(result);
        return result;
    }

    public static IntPtr[] GetWindowTree(IntPtr root, int processId)
    {
        if (root == IntPtr.Zero || !IsWindow(root) || ProcessId(root) != processId) return new IntPtr[0];
        HashSet<IntPtr> handles = new HashSet<IntPtr>();
        handles.Add(root);
        EnumWindowsProc callback = delegate(IntPtr child, IntPtr unused) {
            if (ProcessId(child) == processId) handles.Add(child);
            return true;
        };
        EnumChildWindows(root, callback, IntPtr.Zero);
        IntPtr[] result = new IntPtr[handles.Count];
        handles.CopyTo(result);
        return result;
    }

    public static int ProcessId(IntPtr hwnd)
    {
        uint processId;
        GetWindowThreadProcessId(hwnd, out processId);
        return (int)processId;
    }

    public static string ClassName(IntPtr hwnd)
    {
        StringBuilder text = new StringBuilder(256);
        int length = GetClassName(hwnd, text, text.Capacity);
        return length > 0 ? text.ToString(0, length) : String.Empty;
    }

    public static string WindowText(IntPtr hwnd)
    {
        int length = GetWindowTextLength(hwnd);
        StringBuilder text = new StringBuilder(Math.Max(2, length + 1));
        int actual = GetWindowText(hwnd, text, text.Capacity);
        return actual > 0 ? text.ToString(0, actual) : String.Empty;
    }

    public static bool EffectivelyVisible(IntPtr hwnd)
    {
        HashSet<IntPtr> visited = new HashSet<IntPtr>();
        IntPtr current = hwnd;
        while (current != IntPtr.Zero && visited.Add(current)) {
            if (!IsWindowVisible(current)) return false;
            current = GetParent(current);
        }
        return true;
    }

    public static bool IsDescendantOf(IntPtr hwnd, IntPtr ancestor)
    {
        if (hwnd == IntPtr.Zero || ancestor == IntPtr.Zero || hwnd == ancestor) return false;
        HashSet<IntPtr> visited = new HashSet<IntPtr>();
        IntPtr current = GetParent(hwnd);
        while (current != IntPtr.Zero && visited.Add(current)) {
            if (current == ancestor) return true;
            current = GetParent(current);
        }
        return false;
    }

    private static object AccessibleProperty(IntPtr hwnd, string property)
    {
        object accessible = null;
        try {
            Guid iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
            int result = AccessibleObjectFromWindow(hwnd, 0xFFFFFFFC, ref iid, out accessible);
            if (result < 0 || accessible == null) return null;
            return accessible.GetType().InvokeMember(property, BindingFlags.GetProperty, null, accessible,
                new object[] { 0 }, CultureInfo.InvariantCulture);
        }
        catch { return null; }
        finally {
            if (accessible != null && Marshal.IsComObject(accessible)) {
                try { Marshal.FinalReleaseComObject(accessible); } catch {}
            }
        }
    }

    public static string AccessibleValue(IntPtr hwnd)
    {
        object value = AccessibleProperty(hwnd, "accValue");
        return value == null ? null : Convert.ToString(value, CultureInfo.InvariantCulture);
    }

    public static int AccessibleState(IntPtr hwnd)
    {
        object value = AccessibleProperty(hwnd, "accState");
        if (value == null) return Int32.MinValue;
        try { return Convert.ToInt32(value, CultureInfo.InvariantCulture); }
        catch { return Int32.MinValue; }
    }

}
'@

$null = Add-Type -TypeDefinition $nativeSource -Language CSharp

$TBM_GETPOS = 0x0400
$TBM_GETRANGEMIN = 0x0401
$TBM_GETRANGEMAX = 0x0402
$TBM_SETPOS = 0x0405
$TBM_GETTHUMBLENGTH = 0x041C
$WM_HSCROLL = 0x0114
$TB_THUMBPOSITION = 4
$TB_THUMBTRACK = 5
$TB_ENDTRACK = 8
$BM_GETCHECK = 0x00F0
$BM_CLICK = 0x00F5
$BST_UNCHECKED = 0
$BST_CHECKED = 1
$STATE_SYSTEM_CHECKED = 0x10
$GWL_STYLE = -16
$SS_NOTIFY = 0x0100
$WM_LBUTTONDOWN = 0x0201
$WM_LBUTTONUP = 0x0202
$WM_LBUTTONDBLCLK = 0x0203
$WM_MOUSEMOVE = 0x0200
$WM_MOUSELEAVE = 0x02A3
$SMTO_BLOCK = 0x0001
$SMTO_ABORTIFHUNG = 0x0002
$FOCUS_ACTION_MESSAGE_TIMEOUT_MS = 250
$MK_LBUTTON = 0x0001
$RDW_TRACKBAR_REFRESH = 0x0001 -bor 0x0004 -bor 0x0100 -bor 0x0400
$TRACK_TRANSACTION_IDLE_MS = 5000
$RECENT_DISCOVERY_MS = 1500

$script:LatestFullDiscovery = $null
$script:LatestFullDiscoveryAt = 0L
$script:ActiveTrackTransaction = $null

function Throw-Unavailable([string]$Message) {
    throw [System.InvalidOperationException]::new("UNAVAILABLE: " + $Message)
}

function Get-WindowSnapshot([IntPtr]$Handle, [int]$ProcessId) {
    if (-not [LRBridgeNative]::IsWindow($Handle)) { return $null }
    if ([LRBridgeNative]::ProcessId($Handle) -ne $ProcessId) { return $null }
    $rectangle = New-Object LRBridgeNative+RECT
    if (-not [LRBridgeNative]::GetWindowRect($Handle, [ref]$rectangle)) { return $null }
    $className = [LRBridgeNative]::ClassName($Handle)
    $snapshot = [ordered]@{
        Handle = [Int64]$Handle
        ProcessId = $ProcessId
        Class = $className
        Text = [LRBridgeNative]::WindowText($Handle)
        Parent = [Int64][LRBridgeNative]::GetParent($Handle)
        ControlId = [LRBridgeNative]::GetDlgCtrlID($Handle)
        Style = [LRBridgeNative]::GetWindowLong($Handle, $GWL_STYLE)
        Visible = [LRBridgeNative]::EffectivelyVisible($Handle)
        Enabled = [LRBridgeNative]::IsWindowEnabled($Handle)
        Left = $rectangle.Left
        Top = $rectangle.Top
        Right = $rectangle.Right
        Bottom = $rectangle.Bottom
        CenterX = ($rectangle.Left + $rectangle.Right) / 2.0
        CenterY = ($rectangle.Top + $rectangle.Bottom) / 2.0
    }
    if ($className -eq "msctls_trackbar32") {
        $trackParent = [LRBridgeNative]::GetParent($Handle)
        if ([LRBridgeNative]::GetDlgCtrlID($Handle) -ne 100 -or $trackParent -eq [IntPtr]::Zero -or
            -not [LRBridgeNative]::IsWindow($trackParent) -or [LRBridgeNative]::ProcessId($trackParent) -ne $ProcessId -or
            [LRBridgeNative]::ClassName($trackParent) -notmatch '^AfxWnd\d+u$') { return [PSCustomObject]$snapshot }
        $snapshot.NativeMin = [Int64][LRBridgeNative]::SendMessage($Handle, $TBM_GETRANGEMIN, [IntPtr]::Zero, [IntPtr]::Zero)
        $snapshot.NativeMax = [Int64][LRBridgeNative]::SendMessage($Handle, $TBM_GETRANGEMAX, [IntPtr]::Zero, [IntPtr]::Zero)
        $snapshot.NativePosition = [Int64][LRBridgeNative]::SendMessage($Handle, $TBM_GETPOS, [IntPtr]::Zero, [IntPtr]::Zero)
    }
    return [PSCustomObject]$snapshot
}

function Get-LightroomWindows {
    $processes = @([System.Diagnostics.Process]::GetProcessesByName("Lightroom"))
    if ($processes.Count -eq 0) { Throw-Unavailable "Lightroom is not running" }
    $windows = New-Object System.Collections.Generic.List[object]
    foreach ($process in $processes) {
        foreach ($handle in [LRBridgeNative]::GetProcessWindows($process.Id)) {
            $snapshot = Get-WindowSnapshot $handle $process.Id
            if ($null -ne $snapshot) { $windows.Add($snapshot) }
        }
    }
    if ($windows.Count -eq 0) { Throw-Unavailable "No Lightroom windows were found" }
    return $windows.ToArray()
}

function Test-AfxParent([object]$Window, [object[]]$Windows) {
    $parents = @($Windows | Where-Object { $_.Handle -eq $Window.Parent })
    return $parents.Count -eq 1 -and $parents[0].Class -match '^AfxWnd\d+u$'
}

function Parse-DisplayedNumber([string]$Value) {
    if ($null -eq $Value) { return $null }
    $normalized = $Value.Trim().Replace([string][char]0x00A0, "").Replace(" ", "").Replace(",", ".")
    if ($normalized -notmatch '^[+-]?\d+(?:\.\d+)?$') { return $null }
    $number = 0.0
    if (-not [double]::TryParse($normalized, [System.Globalization.NumberStyles]::AllowLeadingSign -bor [System.Globalization.NumberStyles]::AllowDecimalPoint,
        [System.Globalization.CultureInfo]::InvariantCulture, [ref]$number)) { return $null }
    if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) { return $null }
    return $number
}

function Find-WindowByHandle([object[]]$Windows, [Int64]$Handle) {
    $matches = @($Windows | Where-Object { $_.Handle -eq $Handle })
    if ($matches.Count -ne 1) { return $null }
    return $matches[0]
}

function Test-IsDescendantOfSnapshot([object]$Window, [object]$Ancestor, [object[]]$Windows) {
    if ($null -eq $Window -or $null -eq $Ancestor -or $Window.ProcessId -ne $Ancestor.ProcessId -or $Window.Handle -eq $Ancestor.Handle) {
        return $false
    }
    return [LRBridgeNative]::IsDescendantOf([IntPtr]$Window.Handle, [IntPtr]$Ancestor.Handle)
}

function Find-LensBlurRoot([object[]]$Windows) {
    $rootCandidates = @()
    foreach ($candidate in @($Windows | Where-Object { $_.Class -match '^AfxWnd\d+u$' -and $_.Text -eq "LensBlurContents" })) {
        $parent = Find-WindowByHandle $Windows $candidate.Parent
        if ($null -ne $parent -and $parent.ProcessId -eq $candidate.ProcessId -and
            $parent.Class -match '^AfxWnd\d+u$' -and $parent.Text -eq "Develop_LensBlurView") {
            $rootCandidates += $candidate
        }
    }
    if ($rootCandidates.Count -ne 1) { return $null }
    return $rootCandidates[0]
}

function Find-FocusRangeActionTargets([object[]]$Windows, [object]$LensRoot) {
    if ($null -eq $LensRoot) { return $null }
    $labels = @($Windows | Where-Object {
        $_.ProcessId -eq $LensRoot.ProcessId -and $_.Class -eq "Static" -and $_.Text -eq "Focus Range" -and
        $_.Parent -eq $LensRoot.Handle -and $_.Visible -and $_.Enabled -and $_.Left -ge $LensRoot.Left -and
        $_.Right -le $LensRoot.Right -and $_.Top -ge $LensRoot.Top -and $_.Bottom -le $LensRoot.Bottom
    })
    if ($labels.Count -ne 1) { return $null }
    $label = $labels[0]
    $rootWidth = $LensRoot.Right - $LensRoot.Left
    $tracks = @($Windows | Where-Object {
        $width = $_.Right - $_.Left
        $height = $_.Bottom - $_.Top
        $_.ProcessId -eq $LensRoot.ProcessId -and $_.Class -match '^AfxWnd\d+u$' -and $_.Text -eq " (Bridge View)" -and
        $_.Visible -and $_.Enabled -and (Test-IsDescendantOfSnapshot $_ $LensRoot $Windows) -and
        $width -ge [math]::Max(240, $rootWidth * 0.72) -and $width -le ($rootWidth + 4) -and
        $height -ge 28 -and $height -le 52 -and $_.Top -ge $label.Bottom -and $_.Top -le ($label.Bottom + 16) -and
        $_.Left -ge ($LensRoot.Left - 2) -and $_.Right -le ($LensRoot.Right + 2)
    })
    if ($tracks.Count -ne 1) { return $null }
    $track = $tracks[0]
    $icons = @($Windows | Where-Object {
        $width = $_.Right - $_.Left
        $height = $_.Bottom - $_.Top
        $_.ProcessId -eq $LensRoot.ProcessId -and $_.Class -match '^AfxWnd\d+u$' -and $_.Text -eq " (Bridge View)" -and
        $_.Parent -eq $LensRoot.Handle -and $_.ControlId -eq 65535 -and $_.Visible -and $_.Enabled -and
        $width -ge 16 -and $width -le 30 -and $height -ge 14 -and $height -le 26 -and
        [math]::Abs($_.CenterY - $label.CenterY) -le 8 -and $_.Left -gt $label.Right -and
        $_.Right -le $LensRoot.Right
    } | Sort-Object Left)
    if ($icons.Count -ne 2) { return $null }
    $subject = $icons[0]
    $pointArea = $icons[1]
    $horizontalGap = $pointArea.Left - $subject.Right
    if ($horizontalGap -lt 0 -or $horizontalGap -gt 14 -or
        [math]::Abs(($subject.Right-$subject.Left)-($pointArea.Right-$pointArea.Left)) -gt 3 -or
        [math]::Abs(($subject.Bottom-$subject.Top)-($pointArea.Bottom-$pointArea.Top)) -gt 3 -or
        [math]::Abs($subject.CenterY-$pointArea.CenterY) -gt 3 -or
        ($LensRoot.Right-$pointArea.Right) -lt 0 -or ($LensRoot.Right-$pointArea.Right) -gt 32 -or
        $track.Top -lt $label.Bottom) { return $null }
    foreach ($entry in @(
        [PSCustomObject]@{Target=$subject;Action="subject";Pair=$pointArea},
        [PSCustomObject]@{Target=$pointArea;Action="point-area";Pair=$subject}
    )) {
        $entry.Target | Add-Member -NotePropertyName FocusAction -NotePropertyValue $entry.Action
        $entry.Target | Add-Member -NotePropertyName LabelHandle -NotePropertyValue $label.Handle
        $entry.Target | Add-Member -NotePropertyName TrackHandle -NotePropertyValue $track.Handle
        $entry.Target | Add-Member -NotePropertyName PairHandle -NotePropertyValue $entry.Pair.Handle
        $entry.Target | Add-Member -NotePropertyName AnchorHandle -NotePropertyValue $LensRoot.Handle
        $entry.Target | Add-Member -NotePropertyName AnchorClass -NotePropertyValue $LensRoot.Class
        $entry.Target | Add-Member -NotePropertyName AnchorText -NotePropertyValue $LensRoot.Text
    }
    return [PSCustomObject]@{ Label=$label; Track=$track; Subject=$subject; PointArea=$pointArea }
}

function Find-RefinementRoot([object[]]$Windows, [object]$LensRoot) {
    if ($null -eq $LensRoot) { return $null }
    $matches = @($Windows | Where-Object {
        $_.ProcessId -eq $LensRoot.ProcessId -and $_.Class -match '^AfxWnd\d+u$' -and $_.Text -eq "LensBlurRefinement" -and
        (Test-IsDescendantOfSnapshot $_ $LensRoot $Windows)
    })
    if ($matches.Count -ne 1) { return $null }
    return $matches[0]
}

function Find-RefinementHeaderLabel([object[]]$Windows, [object]$LensRoot) {
    if ($null -eq $LensRoot) { return $null }
    $matches = @($Windows | Where-Object {
        $_.ProcessId -eq $LensRoot.ProcessId -and $_.Class -eq "Static" -and $_.Text -eq "Brush Refinement" -and
        $_.Parent -eq $LensRoot.Handle -and $_.Visible -and $_.Enabled -and $_.Left -ge $LensRoot.Left -and
        $_.Right -le $LensRoot.Right -and $_.Top -ge $LensRoot.Top -and $_.Bottom -le $LensRoot.Bottom
    })
    if ($matches.Count -ne 1) { return $null }
    return $matches[0]
}

function Find-RefinementDisclosure([object[]]$Windows, [object]$LensRoot) {
    $label = Find-RefinementHeaderLabel $Windows $LensRoot
    if ($null -eq $label) { return $null }
    $matches = @($Windows | Where-Object {
        $width = $_.Right - $_.Left
        $height = $_.Bottom - $_.Top
        $_.ProcessId -eq $LensRoot.ProcessId -and $_.Class -match '^AfxWnd\d+u$' -and
        $_.Parent -eq $LensRoot.Handle -and $_.ControlId -eq 65535 -and $_.Visible -and $_.Enabled -and
        $width -ge 12 -and $width -le 22 -and $height -ge 12 -and $height -le 22 -and
        [math]::Abs($_.CenterY - $label.CenterY) -le 10 -and $_.Left -gt $label.Right -and
        ($LensRoot.Right - $_.Right) -ge 0 -and ($LensRoot.Right - $_.Right) -le 24
    })
    if ($matches.Count -ne 1) { return $null }
    $target = $matches[0]
    $target | Add-Member -NotePropertyName LabelHandle -NotePropertyValue $label.Handle
    $target | Add-Member -NotePropertyName AnchorHandle -NotePropertyValue $LensRoot.Handle
    $target | Add-Member -NotePropertyName AnchorClass -NotePropertyValue $LensRoot.Class
    $target | Add-Member -NotePropertyName AnchorText -NotePropertyValue $LensRoot.Text
    return $target
}

function Find-RefinementResetTarget([object[]]$Windows, [object]$RefinementRoot) {
    if ($null -eq $RefinementRoot) { return $null }
    $rootWidth = $RefinementRoot.Right - $RefinementRoot.Left
    $matches = @($Windows | Where-Object {
        $width = $_.Right - $_.Left
        $height = $_.Bottom - $_.Top
        $_.ProcessId -eq $RefinementRoot.ProcessId -and $_.Class -eq "Static" -and $_.Text -eq "Reset" -and
        $_.Parent -eq $RefinementRoot.Handle -and $_.Visible -and (($_.Style -band $SS_NOTIFY) -eq $SS_NOTIFY) -and
        $width -ge 20 -and $width -le 120 -and $height -ge 12 -and $height -le 40 -and
        $_.Top -ge $RefinementRoot.Top -and $_.Bottom -le ($RefinementRoot.Top + 42) -and
        $_.Left -gt ($RefinementRoot.Left + ($rootWidth / 2.0)) -and $_.Right -le $RefinementRoot.Right -and
        ($RefinementRoot.Right - $_.Right) -ge 0 -and ($RefinementRoot.Right - $_.Right) -le 24
    })
    if ($matches.Count -ne 1) { return $null }
    return $matches[0]
}

function Find-UniqueTrackInRoot([object[]]$Windows, [object]$Root, [int]$NativeMin, [int]$NativeMax, [bool]$RequireVisible) {
    if ($null -eq $Root) { return $null }
    $matches = @($Windows | Where-Object {
        $_.ProcessId -eq $Root.ProcessId -and $_.Class -eq "msctls_trackbar32" -and $_.Enabled -and
        (-not $RequireVisible -or $_.Visible) -and $_.ControlId -eq 100 -and $_.NativeMin -eq $NativeMin -and
        $_.NativeMax -eq $NativeMax -and (Test-IsDescendantOfSnapshot $_ $Root $Windows) -and (Test-AfxParent $_ $Windows)
    })
    if ($matches.Count -ne 1) { return $null }
    return $matches[0]
}

function Find-LabelForTrack([object[]]$Windows, [object]$Root, [object]$Track, [string]$Text) {
    if ($null -eq $Root -or $null -eq $Track) { return $null }
    $matches = @($Windows | Where-Object {
        $_.ProcessId -eq $Root.ProcessId -and $_.Class -eq "Static" -and $_.Text -eq $Text -and $_.Visible -and $_.Enabled -and
        (Test-IsDescendantOfSnapshot $_ $Root $Windows) -and [math]::Abs($_.CenterY - $Track.CenterY) -le 18 -and
        $_.Left -le $Track.Left -and ($Track.Left - $_.Right) -lt 650
    })
    if ($matches.Count -ne 1) { return $null }
    return $matches[0]
}

function Find-LabeledTrackInRoot([object[]]$Windows, [object]$Root, [string]$Text, [int]$NativeMin, [int]$NativeMax) {
    $track = Find-UniqueTrackInRoot $Windows $Root $NativeMin $NativeMax $true
    if ($null -eq $track -or $null -eq (Find-LabelForTrack $Windows $Root $track $Text)) { return $null }
    return $track
}

function Find-EditForTrack([object[]]$Windows, [object]$Root, [object]$Track) {
    $edits = @($Windows | Where-Object {
        $_.ProcessId -eq $Track.ProcessId -and $_.Class -eq "Edit" -and $_.Visible -and $_.Enabled -and
        [math]::Abs($_.CenterY - $Track.CenterY) -le 18 -and $_.Left -ge ($Track.Right - 24) -and
        ($_.Left - $Track.Right) -lt 240 -and (Test-IsDescendantOfSnapshot $_ $Root $Windows)
    })
    $edits = @($edits | Sort-Object { [math]::Abs($_.Left - $Track.Right) })
    if ($edits.Count -eq 0) { return $null }
    if ($edits.Count -gt 1 -and [math]::Abs($edits[0].Left - $Track.Right) -eq [math]::Abs($edits[1].Left - $Track.Right)) { return $null }
    return $edits[0]
}

function Read-TrackControl([object[]]$Windows, [object]$Root, [object]$Track, [string]$Label, [double]$Scale, [double]$Step) {
    if ($null -eq $Root -or $null -eq $Track -or $null -eq (Find-LabelForTrack $Windows $Root $Track $Label)) { return $null }
    Assert-TrackSnapshot $Track $Root
    $edit = Find-EditForTrack $Windows $Root $Track
    if ($null -eq $edit) { return $null }
    Assert-EditIdentity $edit $Track
    $displayed = Parse-DisplayedNumber ([LRBridgeNative]::AccessibleValue([IntPtr]$edit.Handle))
    if ($null -eq $displayed) { return $null }
    $nativePosition = [Int64][LRBridgeNative]::SendMessage([IntPtr]$Track.Handle, $TBM_GETPOS, [IntPtr]::Zero, [IntPtr]::Zero)
    $nativeValue = $nativePosition / $Scale
    $tolerance = [math]::Max(0.000001, $Step / 4.0)
    if ([math]::Abs($displayed - $nativeValue) -gt $tolerance) { return $null }
    return [PSCustomObject]@{
        available = $true
        value = [double]$nativeValue
        min = [double]($Track.NativeMin / $Scale)
        max = [double]($Track.NativeMax / $Scale)
        Handle = $Track.Handle
        Parent = $Track.Parent
        ProcessId = $Track.ProcessId
        NativeMin = $Track.NativeMin
        NativeMax = $Track.NativeMax
        AnchorHandle = $Root.Handle
        AnchorClass = $Root.Class
        AnchorText = $Root.Text
        Scale = $Scale
        Step = $Step
    }
}

function Find-UniqueButtonInRoot([object[]]$Windows, [object]$Root, [string]$Text) {
    if ($null -eq $Root) { return $null }
    $matches = @($Windows | Where-Object {
        $_.ProcessId -eq $Root.ProcessId -and $_.Class -eq "Button" -and $_.Text -eq $Text -and $_.Visible -and $_.Enabled -and
        $_.ControlId -eq 100 -and (($_.Style -band 0xF) -eq 2) -and (Test-IsDescendantOfSnapshot $_ $Root $Windows) -and
        (Test-AfxParent $_ $Windows)
    })
    if ($matches.Count -ne 1) { return $null }
    return $matches[0]
}

function Read-Checkbox([object]$Button) {
    Assert-ButtonIdentity $Button
    $check = [Int64][LRBridgeNative]::SendMessage([IntPtr]$Button.Handle, $BM_GETCHECK, [IntPtr]::Zero, [IntPtr]::Zero)
    if ($check -ne $BST_UNCHECKED -and $check -ne $BST_CHECKED) { return $null }
    $accessibleState = [LRBridgeNative]::AccessibleState([IntPtr]$Button.Handle)
    if ($accessibleState -eq [int]::MinValue) { return $null }
    $accessibleChecked = ($accessibleState -band $STATE_SYSTEM_CHECKED) -ne 0
    $nativeChecked = $check -eq $BST_CHECKED
    if ($accessibleChecked -ne $nativeChecked) { return $null }
    return [PSCustomObject]@{
        available = $true
        value = $nativeChecked
        Handle = $Button.Handle
        Parent = $Button.Parent
        ProcessId = $Button.ProcessId
        Text = $Button.Text
        AnchorHandle = $Button.AnchorHandle
        AnchorClass = $Button.AnchorClass
        AnchorText = $Button.AnchorText
    }
}
function Add-AnchorIdentity([object]$Control, [object]$Root) {
    if ($null -eq $Control -or $null -eq $Root) { return $null }
    $Control | Add-Member -NotePropertyName AnchorHandle -NotePropertyValue $Root.Handle
    $Control | Add-Member -NotePropertyName AnchorClass -NotePropertyValue $Root.Class
    $Control | Add-Member -NotePropertyName AnchorText -NotePropertyValue $Root.Text
    return $Control
}

function Discover-NativeControls {
    $windows = Get-LightroomWindows
    $lensRoot = Find-LensBlurRoot $windows
    $refinementRoot = Find-RefinementRoot $windows $lensRoot
    $refinementDisclosure = Find-RefinementDisclosure $windows $lensRoot
    $refinementReset = Find-RefinementResetTarget $windows $refinementRoot
    $focusRangeActions = Find-FocusRangeActionTargets $windows $lensRoot
    $visualizeButton = Add-AnchorIdentity (Find-UniqueButtonInRoot $windows $lensRoot "Visualize Depth") $lensRoot
    $autoMaskButton = Add-AnchorIdentity (Find-UniqueButtonInRoot $windows $refinementRoot "Auto Mask") $refinementRoot
    $sizeTrack = Find-LabeledTrackInRoot $windows $refinementRoot "Size" 1 1000
    $featherTrack = Find-LabeledTrackInRoot $windows $refinementRoot "Feather" 0 1000
    $flowTrack = Find-LabeledTrackInRoot $windows $refinementRoot "Flow" 10 1000
    $focusTrack = Find-UniqueTrackInRoot $windows $refinementRoot 0 100000 $false
    $blurTrack = Find-UniqueTrackInRoot $windows $refinementRoot 0 200000 $false
    $result = [PSCustomObject]@{
        Windows = $windows
        LensRoot = $lensRoot
        RefinementRoot = $refinementRoot
        RefinementDisclosure = $refinementDisclosure
        RefinementReset = $refinementReset
        FocusRangeActions = $focusRangeActions
        VisualizeButton = $visualizeButton
        AutoMaskButton = $autoMaskButton
        SizeTrack = $sizeTrack
        FeatherTrack = $featherTrack
        FlowTrack = $flowTrack
        FocusTrack = $focusTrack
        BlurTrack = $blurTrack
    }
    $script:LatestFullDiscovery = $result
    $script:LatestFullDiscoveryAt = [Environment]::TickCount64
    return $result
}

function Public-TrackState([object]$Control) {
    if ($null -eq $Control) { return [PSCustomObject]@{ available = $false; value = $null; min = $null; max = $null } }
    return [PSCustomObject]@{ available = $true; value = $Control.value; min = $Control.min; max = $Control.max }
}

function Public-CheckboxState([object]$Control) {
    if ($null -eq $Control) { return [PSCustomObject]@{ available = $false; value = $null } }
    return [PSCustomObject]@{ available = $true; value = $Control.value }
}

function Public-RefinementResetState([object]$Discovery) {
    if ($null -eq $Discovery -or $null -eq $Discovery.RefinementRoot -or $null -eq $Discovery.RefinementReset) {
        return [PSCustomObject]@{ available=$false; enabled=$false }
    }
    try {
        Assert-RefinementResetIdentity $Discovery.RefinementReset $Discovery.RefinementRoot $false | Out-Null
        return [PSCustomObject]@{
            available=$true
            enabled=[LRBridgeNative]::IsWindowEnabled([IntPtr]$Discovery.RefinementReset.Handle)
        }
    } catch {
        return [PSCustomObject]@{ available=$false; enabled=$false }
    }
}

function Public-FocusRangeActionState([object]$Discovery, [string]$Action) {
    if ($null -eq $Discovery -or $null -eq $Discovery.FocusRangeActions -or
        @("subject", "point-area") -notcontains $Action) {
        return [PSCustomObject]@{ available=$false; enabled=$false }
    }
    $target = if($Action -eq "subject"){$Discovery.FocusRangeActions.Subject}else{$Discovery.FocusRangeActions.PointArea}
    if ($null -eq $target -or -not [LRBridgeNative]::IsWindow([IntPtr]$target.Handle) -or
        -not [LRBridgeNative]::EffectivelyVisible([IntPtr]$target.Handle) -or
        -not [LRBridgeNative]::IsWindowEnabled([IntPtr]$target.Handle)) {
        return [PSCustomObject]@{ available=$false; enabled=$false }
    }
    return [PSCustomObject]@{ available=$true; enabled=$true }
}

function Read-RefinementDisclosureState([object]$Discovery) {
    if ($null -eq $Discovery -or $null -eq $Discovery.RefinementDisclosure -or $null -eq $Discovery.RefinementRoot) {
        return [PSCustomObject]@{ available=$false; value=$null }
    }
    $rootVisible = [LRBridgeNative]::IsWindow([IntPtr]$Discovery.RefinementRoot.Handle) -and
        [LRBridgeNative]::EffectivelyVisible([IntPtr]$Discovery.RefinementRoot.Handle)
    $sizeVisible = Test-TrackVisible $Discovery.SizeTrack
    $featherVisible = Test-TrackVisible $Discovery.FeatherTrack
    $flowVisible = Test-TrackVisible $Discovery.FlowTrack
    $focusVisible = Test-TrackVisible $Discovery.FocusTrack
    $blurVisible = Test-TrackVisible $Discovery.BlurTrack
    $amountVisible = $focusVisible -xor $blurVisible
    $modeTargetsAvailable = Read-RefinementModeTargetsAvailable $Discovery
    if ($rootVisible -and $modeTargetsAvailable) {
        return [PSCustomObject]@{ available=$true; value=$true }
    }
    if ($rootVisible -and $sizeVisible -and $featherVisible -and $flowVisible -and $amountVisible) {
        return [PSCustomObject]@{ available=$true; value=$true }
    }
    if (-not $rootVisible -and -not $modeTargetsAvailable -and
        -not $sizeVisible -and -not $featherVisible -and -not $flowVisible -and
        -not $focusVisible -and -not $blurVisible) {
        return [PSCustomObject]@{ available=$true; value=$false }
    }
    return [PSCustomObject]@{ available=$false; value=$null }
}

function Test-TrackVisible([object]$Track) {
    return $null -ne $Track -and [LRBridgeNative]::IsWindow([IntPtr]$Track.Handle) -and
        [LRBridgeNative]::EffectivelyVisible([IntPtr]$Track.Handle)
}

function Read-RefinementModeTargetsAvailable([object]$Discovery) {
    if ($null -eq $Discovery -or $null -eq $Discovery.RefinementRoot) { return $false }
    try {
        $focus = Find-ModeActivationTarget $Discovery "focus"
        $blur = Find-ModeActivationTarget $Discovery "blur"
        if ($null -eq $focus -or $null -eq $blur) { return $false }
        Assert-ModeActivationTarget $focus $Discovery.RefinementRoot "focus" | Out-Null
        Assert-ModeActivationTarget $blur $Discovery.RefinementRoot "blur" | Out-Null
        return $true
    } catch { return $false }
}

function Try-ReadTrackControl([object]$Discovery, [object]$Track, [string]$Label, [double]$Scale, [double]$Step) {
    if ($null -eq $Discovery.RefinementRoot -or $null -eq $Track) { return $null }
    try { return Read-TrackControl $Discovery.Windows $Discovery.RefinementRoot $Track $Label $Scale $Step }
    catch { return $null }
}

function Try-ReadCheckbox([object]$Button) {
    if ($null -eq $Button) { return $null }
    try { return Read-Checkbox $Button }
    catch { return $null }
}

function Get-NativeStateFromDiscovery([object]$Discovery) {
    if ($null -eq $Discovery) { Throw-Unavailable "Native control discovery is unavailable" }
    $discovery = $Discovery
    $size = Try-ReadTrackControl $discovery $discovery.SizeTrack "Size" 10.0 0.1
    $feather = Try-ReadTrackControl $discovery $discovery.FeatherTrack "Feather" 10.0 1.0
    $flow = Try-ReadTrackControl $discovery $discovery.FlowTrack "Flow" 10.0 1.0

    $focusVisible = Test-TrackVisible $discovery.FocusTrack
    $blurVisible = Test-TrackVisible $discovery.BlurTrack
    $mode = "unknown"
    $amount = $null
    if ($focusVisible -and -not $blurVisible) {
        if ($null -ne $discovery.BlurTrack) { $mode = "focus" }
        $amount = Try-ReadTrackControl $discovery $discovery.FocusTrack "Amount" 1000.0 1.0
    } elseif ($blurVisible -and -not $focusVisible) {
        if ($null -ne $discovery.FocusTrack) { $mode = "blur" }
        $amount = Try-ReadTrackControl $discovery $discovery.BlurTrack "Amount" 1000.0 1.0
    }
    $visualize = Try-ReadCheckbox $discovery.VisualizeButton
    $autoMask = Try-ReadCheckbox $discovery.AutoMaskButton
    return [PSCustomObject]@{
        available = $true
        reason = $null
        brush = [PSCustomObject]@{
            amount = Public-TrackState $amount
            size = Public-TrackState $size
            feather = Public-TrackState $feather
            flow = Public-TrackState $flow
        }
        visualizeDepth = Public-CheckboxState $visualize
        autoMask = Public-CheckboxState $autoMask
        refinementMode = $mode
        refinementModeTargetsAvailable = Read-RefinementModeTargetsAvailable $discovery
        refinementDisclosure = Read-RefinementDisclosureState $discovery
        refinementReset = Public-RefinementResetState $discovery
        focusActions = [PSCustomObject]@{
            subject = Public-FocusRangeActionState $discovery "subject"
            pointArea = Public-FocusRangeActionState $discovery "point-area"
        }
    }
}

function Get-NativeState {
    return Get-NativeStateFromDiscovery (Discover-NativeControls)
}

function Get-PrivateTrack([object]$Discovery, [string]$Control) {
    if ($Control -eq "size") { return Try-ReadTrackControl $Discovery $Discovery.SizeTrack "Size" 10.0 0.1 }
    if ($Control -eq "feather") { return Try-ReadTrackControl $Discovery $Discovery.FeatherTrack "Feather" 10.0 1.0 }
    if ($Control -eq "flow") { return Try-ReadTrackControl $Discovery $Discovery.FlowTrack "Flow" 10.0 1.0 }
    if ($Control -eq "amount") {
        $focusVisible = Test-TrackVisible $Discovery.FocusTrack
        $blurVisible = Test-TrackVisible $Discovery.BlurTrack
        if ($focusVisible -and -not $blurVisible) { return Try-ReadTrackControl $Discovery $Discovery.FocusTrack "Amount" 1000.0 1.0 }
        if ($blurVisible -and -not $focusVisible) { return Try-ReadTrackControl $Discovery $Discovery.BlurTrack "Amount" 1000.0 1.0 }
    }
    return $null
}

function Assert-RefinementRootIdentity([object]$Root) {
    if ($null -eq $Root) { Throw-Unavailable "Brush Refinement root is unavailable" }
    $handle = [IntPtr]$Root.Handle
    if (-not [LRBridgeNative]::IsWindow($handle) -or [LRBridgeNative]::ProcessId($handle) -ne $Root.ProcessId -or
        [LRBridgeNative]::ClassName($handle) -ne $Root.Class -or [LRBridgeNative]::WindowText($handle) -ne "LensBlurRefinement" -or
        -not [LRBridgeNative]::EffectivelyVisible($handle) -or -not [LRBridgeNative]::IsWindowEnabled($handle)) {
        Throw-Unavailable "Brush Refinement hierarchy changed during the interaction"
    }
}

function Refresh-RefinementDiscovery([object]$BaseDiscovery) {
    if ($null -eq $BaseDiscovery) { Throw-Unavailable "Native control discovery is unavailable" }
    Assert-RefinementRootIdentity $BaseDiscovery.RefinementRoot
    $rootHandle = [IntPtr]$BaseDiscovery.RefinementRoot.Handle
    $processId = $BaseDiscovery.RefinementRoot.ProcessId
    $windows = New-Object System.Collections.Generic.List[object]
    foreach ($handle in [LRBridgeNative]::GetWindowTree($rootHandle, $processId)) {
        $snapshot = Get-WindowSnapshot $handle $processId
        if ($null -ne $snapshot) { $windows.Add($snapshot) }
    }
    $currentWindows = $windows.ToArray()
    $root = Find-WindowByHandle $currentWindows $BaseDiscovery.RefinementRoot.Handle
    if ($null -eq $root -or $root.Class -ne $BaseDiscovery.RefinementRoot.Class -or $root.Text -ne "LensBlurRefinement") {
        Throw-Unavailable "Brush Refinement hierarchy changed during the interaction"
    }
    return [PSCustomObject]@{
        Windows = $currentWindows
        LensRoot = $BaseDiscovery.LensRoot
        RefinementRoot = $root
        RefinementDisclosure = $BaseDiscovery.RefinementDisclosure
        RefinementReset = Find-RefinementResetTarget $currentWindows $root
        VisualizeButton = $BaseDiscovery.VisualizeButton
        AutoMaskButton = Add-AnchorIdentity (Find-UniqueButtonInRoot $currentWindows $root "Auto Mask") $root
        SizeTrack = Find-LabeledTrackInRoot $currentWindows $root "Size" 1 1000
        FeatherTrack = Find-LabeledTrackInRoot $currentWindows $root "Feather" 0 1000
        FlowTrack = Find-LabeledTrackInRoot $currentWindows $root "Flow" 10 1000
        FocusTrack = Find-UniqueTrackInRoot $currentWindows $root 0 100000 $false
        BlurTrack = Find-UniqueTrackInRoot $currentWindows $root 0 200000 $false
    }
}

function Get-TrackbarWriteDiscovery([string]$ControlName, [string]$InteractionId) {
    if ([string]::IsNullOrEmpty($InteractionId)) { return Discover-NativeControls }
    if ($InteractionId -notmatch '^[A-Za-z0-9_-]{1,64}$') { throw "Invalid Brush Refinement interaction id" }
    $now = [Environment]::TickCount64
    $active = $script:ActiveTrackTransaction
    if ($null -ne $active -and $active.Id -eq $InteractionId -and $active.Control -eq $ControlName -and
        ($now - $active.LastUse) -le $TRACK_TRANSACTION_IDLE_MS) {
        try {
            $refreshed = Refresh-RefinementDiscovery $active.Discovery
            $active.Discovery = $refreshed
            $active.LastUse = $now
            return $refreshed
        } catch {
            $script:ActiveTrackTransaction = $null
            throw
        }
    }
    $script:ActiveTrackTransaction = $null
    $base = $null
    if ($null -ne $script:LatestFullDiscovery -and ($now - $script:LatestFullDiscoveryAt) -le $RECENT_DISCOVERY_MS) {
        try { $base = Refresh-RefinementDiscovery $script:LatestFullDiscovery } catch { $base = $null }
    }
    if ($null -eq $base) { $base = Discover-NativeControls }
    $refreshed = Refresh-RefinementDiscovery $base
    if ($null -eq (Get-PrivateTrack $refreshed $ControlName)) {
        Throw-Unavailable "Requested Brush Refinement trackbar is unavailable"
    }
    $script:ActiveTrackTransaction = [PSCustomObject]@{
        Id = $InteractionId
        Control = $ControlName
        Discovery = $refreshed
        LastUse = [Environment]::TickCount64
    }
    return $refreshed
}

function Complete-TrackbarInteraction([string]$InteractionId) {
    if ([string]::IsNullOrEmpty($InteractionId) -or $null -eq $script:ActiveTrackTransaction) { return }
    if ($script:ActiveTrackTransaction.Id -eq $InteractionId) { $script:ActiveTrackTransaction = $null }
}

function Assert-AnchorIdentity([object]$Control) {
    if ($null -eq $Control.AnchorHandle -or $null -eq $Control.AnchorClass -or $null -eq $Control.AnchorText) {
        Throw-Unavailable "Native control anchor is missing"
    }
    $anchor = [IntPtr]$Control.AnchorHandle
    if (-not [LRBridgeNative]::IsWindow($anchor) -or [LRBridgeNative]::ProcessId($anchor) -ne $Control.ProcessId -or
        [LRBridgeNative]::ClassName($anchor) -ne $Control.AnchorClass -or [LRBridgeNative]::WindowText($anchor) -ne $Control.AnchorText -or
        -not [LRBridgeNative]::EffectivelyVisible($anchor)) { Throw-Unavailable "Native control anchor changed before use" }
    if (-not [LRBridgeNative]::IsDescendantOf([IntPtr]$Control.Handle, $anchor)) {
        Throw-Unavailable "Native control left its validated Lens Blur subtree"
    }
}

function Assert-TrackIdentity([object]$Control) {
    $handle = [IntPtr]$Control.Handle
    if (-not [LRBridgeNative]::IsWindow($handle) -or [LRBridgeNative]::ProcessId($handle) -ne $Control.ProcessId -or
        [LRBridgeNative]::ClassName($handle) -ne "msctls_trackbar32" -or -not [LRBridgeNative]::EffectivelyVisible($handle) -or
        -not [LRBridgeNative]::IsWindowEnabled($handle) -or [LRBridgeNative]::GetDlgCtrlID($handle) -ne 100 -or
        [Int64][LRBridgeNative]::GetParent($handle) -ne $Control.Parent) { Throw-Unavailable "Trackbar identity changed before use" }
    Assert-AnchorIdentity $Control
    $minimum = [Int64][LRBridgeNative]::SendMessage($handle, $TBM_GETRANGEMIN, [IntPtr]::Zero, [IntPtr]::Zero)
    $maximum = [Int64][LRBridgeNative]::SendMessage($handle, $TBM_GETRANGEMAX, [IntPtr]::Zero, [IntPtr]::Zero)
    if ($minimum -ne $Control.NativeMin -or $maximum -ne $Control.NativeMax) { Throw-Unavailable "Trackbar range changed before use" }
    $parent = [IntPtr]$Control.Parent
    if (-not [LRBridgeNative]::IsWindow($parent) -or [LRBridgeNative]::ProcessId($parent) -ne $Control.ProcessId -or
        [LRBridgeNative]::ClassName($parent) -notmatch '^AfxWnd\d+u$') { Throw-Unavailable "Trackbar parent changed before use" }
}

function Assert-TrackSnapshot([object]$Track, [object]$Root) {
    Assert-TrackIdentity ([PSCustomObject]@{
        Handle = $Track.Handle
        Parent = $Track.Parent
        ProcessId = $Track.ProcessId
        NativeMin = $Track.NativeMin
        NativeMax = $Track.NativeMax
        AnchorHandle = $Root.Handle
        AnchorClass = $Root.Class
        AnchorText = $Root.Text
    })
}

function Assert-EditIdentity([object]$Edit, [object]$Track) {
    $handle = [IntPtr]$Edit.Handle
    if (-not [LRBridgeNative]::IsWindow($handle) -or [LRBridgeNative]::ProcessId($handle) -ne $Track.ProcessId -or
        [LRBridgeNative]::ClassName($handle) -ne "Edit" -or -not [LRBridgeNative]::EffectivelyVisible($handle) -or
        -not [LRBridgeNative]::IsWindowEnabled($handle)) { Throw-Unavailable "Displayed value identity changed before use" }
    $rectangle = New-Object LRBridgeNative+RECT
    if (-not [LRBridgeNative]::GetWindowRect($handle, [ref]$rectangle)) { Throw-Unavailable "Displayed value geometry became unavailable" }
    $centerY = ($rectangle.Top + $rectangle.Bottom) / 2.0
    if ([math]::Abs($centerY - $Track.CenterY) -gt 18 -or $rectangle.Left -lt ($Track.Right - 24) -or
        ($rectangle.Left - $Track.Right) -ge 240) { Throw-Unavailable "Displayed value no longer matches the trackbar geometry" }
}

function Refresh-TrackbarPaint([object]$Control) {
    Assert-TrackIdentity $Control
    $handle = [IntPtr]$Control.Handle
    $client = New-Object LRBridgeNative+RECT
    if (-not [LRBridgeNative]::GetClientRect($handle, [ref]$client) -or $client.Left -ne 0 -or $client.Top -ne 0 -or
        $client.Right -lt 40 -or $client.Right -gt 2000 -or $client.Bottom -lt 8 -or $client.Bottom -gt 100) {
        Throw-Unavailable "Lightroom trackbar repaint geometry is unavailable"
    }
    $x = [int][math]::Floor($client.Right / 2.0)
    $y = [int][math]::Floor($client.Bottom / 2.0)
    $coordinates = (($y -band 0xFFFF) * 0x10000) + ($x -band 0xFFFF)
    $null = [LRBridgeNative]::SendMessage($handle, $WM_MOUSEMOVE, [IntPtr]::Zero, [IntPtr][Int64]$coordinates)
    Assert-TrackIdentity $Control
    if (-not [LRBridgeNative]::RedrawWindow($handle, [IntPtr]::Zero, [IntPtr]::Zero, $RDW_TRACKBAR_REFRESH)) {
        Throw-Unavailable "Lightroom trackbar could not be repainted after the native write"
    }
}

function Set-DiscoveredTrackbar([object]$Discovery, [string]$ControlName, [double]$Target) {
    if ($null -eq $Discovery) { Throw-Unavailable "Native control discovery is unavailable" }
    $discovery = $Discovery
    $control = Get-PrivateTrack $discovery $ControlName
    if ($null -eq $control) { Throw-Unavailable "Requested Brush Refinement trackbar is unavailable" }
    if ([double]::IsNaN($Target) -or [double]::IsInfinity($Target) -or $Target -lt $control.min -or $Target -gt $control.max) {
        throw "Requested Brush Refinement value is outside the live native range"
    }
    $position = [int][math]::Round($Target * $control.Scale)
    if ([math]::Abs(($position / $control.Scale) - $Target) -gt 0.000001 -or
        ($control.Step -ge 1.0 -and $Target -ne [math]::Round($Target))) {
        throw "Requested Brush Refinement value is not representable by the live native control"
    }

    Assert-TrackIdentity $control
    $null = [LRBridgeNative]::SendMessage([IntPtr]$control.Handle, $TBM_SETPOS, [IntPtr]1, [IntPtr]$position)
    foreach ($notification in @($TB_THUMBTRACK, $TB_THUMBPOSITION)) {
        Assert-TrackIdentity $control
        $word = (($position -band 0xFFFF) * 0x10000) + $notification
        $null = [LRBridgeNative]::SendMessage([IntPtr]$control.Parent, $WM_HSCROLL, [IntPtr][Int64]$word, [IntPtr]$control.Handle)
    }
    Assert-TrackIdentity $control
    $null = [LRBridgeNative]::SendMessage([IntPtr]$control.Parent, $WM_HSCROLL, [IntPtr]$TB_ENDTRACK, [IntPtr]$control.Handle)
    Refresh-TrackbarPaint $control
    $state = Get-NativeStateFromDiscovery $discovery
    $written = $state.brush.$ControlName
    if ($written.available -ne $true -or [math]::Abs([double]$written.value - $Target) -gt 0.000001) {
        Throw-Unavailable "Lightroom did not accept the native trackbar value"
    }
    return $state
}

function Set-Trackbar([string]$ControlName, [double]$Target, [string]$InteractionId, [bool]$Final) {
    try {
        return Set-DiscoveredTrackbar (Get-TrackbarWriteDiscovery $ControlName $InteractionId) $ControlName $Target
    } finally {
        if ($Final) { Complete-TrackbarInteraction $InteractionId }
    }
}

function Get-TrackbarClientPosition([object]$Control) {
    Assert-TrackIdentity $Control
    $handle = [IntPtr]$Control.Handle
    $client = New-Object LRBridgeNative+RECT
    if (-not [LRBridgeNative]::GetClientRect($handle,[ref]$client) -or $client.Left -ne 0 -or $client.Top -ne 0 -or
        $client.Right -lt 40 -or $client.Right -gt 2000 -or $client.Bottom -lt 8 -or $client.Bottom -gt 100) {
        Throw-Unavailable "Lightroom trackbar reset geometry is unavailable"
    }
    $thumbLength = [int][Int64][LRBridgeNative]::SendMessage($handle,$TBM_GETTHUMBLENGTH,[IntPtr]::Zero,[IntPtr]::Zero)
    $position = [int][Int64][LRBridgeNative]::SendMessage($handle,$TBM_GETPOS,[IntPtr]::Zero,[IntPtr]::Zero)
    $span = [double]($Control.NativeMax-$Control.NativeMin)
    if ($thumbLength -lt 1 -or $thumbLength -ge $client.Right -or $span -le 0 -or
        $position -lt $Control.NativeMin -or $position -gt $Control.NativeMax) {
        Throw-Unavailable "Lightroom trackbar reset position is unavailable"
    }
    $halfThumb = $thumbLength/2.0
    $ratio = ($position-$Control.NativeMin)/$span
    $x = [int][math]::Round($halfThumb + $ratio*($client.Right-$thumbLength))
    $x = [math]::Max(1,[math]::Min($client.Right-2,$x))
    $y = [int][math]::Floor($client.Bottom/2.0)
    return [PSCustomObject]@{ X=$x; Y=$y }
}

function Post-TrackbarClientDoubleClick([object]$Control, [object]$Point) {
    $coordinates = (($Point.Y -band 0xFFFF)*0x10000)+($Point.X -band 0xFFFF)
    foreach ($entry in @(
        [PSCustomObject]@{message=$WM_MOUSEMOVE;wParam=0},
        [PSCustomObject]@{message=$WM_LBUTTONDOWN;wParam=$MK_LBUTTON},
        [PSCustomObject]@{message=$WM_LBUTTONUP;wParam=0},
        [PSCustomObject]@{message=$WM_LBUTTONDBLCLK;wParam=$MK_LBUTTON},
        [PSCustomObject]@{message=$WM_LBUTTONUP;wParam=0}
    )) {
        Assert-TrackIdentity $Control
        if (-not [LRBridgeNative]::PostMessage([IntPtr]$Control.Handle,[uint32]$entry.message,[IntPtr]$entry.wParam,[IntPtr][Int64]$coordinates)) {
            throw "Target-local trackbar reset message could not be posted"
        }
    }
}

function Get-ResetTrackbarContext([string]$ControlName) {
    $now = [Environment]::TickCount64
    if ($null -ne $script:LatestFullDiscovery -and ($now-$script:LatestFullDiscoveryAt) -le $RECENT_DISCOVERY_MS) {
        try {
            $recent = Refresh-RefinementDiscovery $script:LatestFullDiscovery
            $recentControl = Get-PrivateTrack $recent $ControlName
            if ($null -ne $recentControl) {
                return [PSCustomObject]@{ Discovery=$recent; Control=$recentControl }
            }
        } catch {}
    }
    $discovery = Discover-NativeControls
    $control = Get-PrivateTrack $discovery $ControlName
    if ($null -eq $control) { Throw-Unavailable "Requested Brush Refinement trackbar is unavailable" }
    return [PSCustomObject]@{ Discovery=$discovery; Control=$control }
}

function Reset-Trackbar([string]$ControlName) {
    $context = Get-ResetTrackbarContext $ControlName
    $discovery = $context.Discovery
    $control = $context.Control
    $point = Get-TrackbarClientPosition $control
    Post-TrackbarClientDoubleClick $control $point
    Start-Sleep -Milliseconds 30
    $after = Refresh-RefinementDiscovery $discovery
    $afterControl = Get-PrivateTrack $after $ControlName
    if ($null -eq $afterControl) {
        Start-Sleep -Milliseconds 90
        $after = Refresh-RefinementDiscovery $after
        $afterControl = Get-PrivateTrack $after $ControlName
    }
    if ($null -eq $afterControl) { Throw-Unavailable "Lightroom did not return authoritative reset readback" }
    Refresh-TrackbarPaint $afterControl
    return [PSCustomObject]@{
        control=$ControlName
        affected=Public-TrackState $afterControl
    }
}

function Assert-ButtonIdentity([object]$Control) {
    $handle = [IntPtr]$Control.Handle
    if (-not [LRBridgeNative]::IsWindow($handle) -or [LRBridgeNative]::ProcessId($handle) -ne $Control.ProcessId -or
        [LRBridgeNative]::ClassName($handle) -ne "Button" -or [LRBridgeNative]::WindowText($handle) -ne $Control.Text -or
        -not [LRBridgeNative]::EffectivelyVisible($handle) -or -not [LRBridgeNative]::IsWindowEnabled($handle) -or
        [LRBridgeNative]::GetDlgCtrlID($handle) -ne 100 -or ([LRBridgeNative]::GetWindowLong($handle, $GWL_STYLE) -band 0xF) -ne 2 -or
        [Int64][LRBridgeNative]::GetParent($handle) -ne $Control.Parent) { Throw-Unavailable "Checkbox identity changed before use" }
    Assert-AnchorIdentity $Control
    $parent = [IntPtr]$Control.Parent
    if (-not [LRBridgeNative]::IsWindow($parent) -or [LRBridgeNative]::ProcessId($parent) -ne $Control.ProcessId -or
        [LRBridgeNative]::ClassName($parent) -notmatch '^AfxWnd\d+u$') { Throw-Unavailable "Checkbox parent changed before use" }
}

function Set-Checkbox([string]$ControlName, [bool]$Enabled) {
    $discovery = Discover-NativeControls
    $button = if ($ControlName -eq "visualizeDepth") { $discovery.VisualizeButton } elseif ($ControlName -eq "autoMask") { $discovery.AutoMaskButton } else { $null }
    if ($null -eq $button) { throw "Unknown Lens Blur checkbox" }
    $current = Read-Checkbox $button
    if ($null -eq $current) { Throw-Unavailable "Requested Lens Blur checkbox is unavailable" }
    if ($current.value -ne $Enabled) {
        Assert-ButtonIdentity $current
        $null = [LRBridgeNative]::SendMessage([IntPtr]$current.Handle, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 120
    }
    $state = Get-NativeState
    $written = $state.$ControlName
    if ($written.available -ne $true -or $written.value -ne $Enabled) {
        Throw-Unavailable "Lightroom did not accept the native checkbox target"
    }
    return $state
}

function Read-FiniteRequestNumber([object]$Value, [string]$Name) {
    if ($Value -isnot [byte] -and $Value -isnot [int16] -and $Value -isnot [int32] -and $Value -isnot [int64] -and
        $Value -isnot [single] -and $Value -isnot [double] -and $Value -isnot [decimal]) { throw "$Name must be numeric" }
    $number = [double]$Value
    if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) { throw "$Name must be finite" }
    return $number
}

function Assert-RefinementDisclosureIdentity([object]$Target, [object]$LensRoot) {
    if ($null -eq $Target -or $null -eq $LensRoot -or $null -eq $Target.LabelHandle) {
        Throw-Unavailable "Brush Refinement disclosure is unavailable"
    }
    $handle = [IntPtr]$Target.Handle
    $rootHandle = [IntPtr]$LensRoot.Handle
    $labelHandle = [IntPtr]$Target.LabelHandle
    if (-not [LRBridgeNative]::IsWindow($handle) -or -not [LRBridgeNative]::IsWindow($rootHandle) -or
        -not [LRBridgeNative]::IsWindow($labelHandle) -or [LRBridgeNative]::ProcessId($handle) -ne $Target.ProcessId -or
        [LRBridgeNative]::ProcessId($rootHandle) -ne $Target.ProcessId -or [LRBridgeNative]::ProcessId($labelHandle) -ne $Target.ProcessId -or
        [LRBridgeNative]::ClassName($handle) -notmatch '^AfxWnd\d+u$' -or [LRBridgeNative]::GetParent($handle) -ne $rootHandle -or
        [LRBridgeNative]::GetDlgCtrlID($handle) -ne 65535 -or -not [LRBridgeNative]::EffectivelyVisible($handle) -or
        -not [LRBridgeNative]::IsWindowEnabled($handle) -or [LRBridgeNative]::ClassName($rootHandle) -notmatch '^AfxWnd\d+u$' -or
        [LRBridgeNative]::WindowText($rootHandle) -ne "LensBlurContents" -or [LRBridgeNative]::ClassName($labelHandle) -ne "Static" -or
        [LRBridgeNative]::WindowText($labelHandle) -ne "Brush Refinement" -or [LRBridgeNative]::GetParent($labelHandle) -ne $rootHandle -or
        -not [LRBridgeNative]::EffectivelyVisible($labelHandle)) {
        Throw-Unavailable "Brush Refinement disclosure identity changed before use"
    }
    $targetRect = New-Object LRBridgeNative+RECT
    $labelRect = New-Object LRBridgeNative+RECT
    $rootRect = New-Object LRBridgeNative+RECT
    $client = New-Object LRBridgeNative+RECT
    if (-not [LRBridgeNative]::GetWindowRect($handle,[ref]$targetRect) -or -not [LRBridgeNative]::GetWindowRect($labelHandle,[ref]$labelRect) -or
        -not [LRBridgeNative]::GetWindowRect($rootHandle,[ref]$rootRect) -or -not [LRBridgeNative]::GetClientRect($handle,[ref]$client)) {
        Throw-Unavailable "Brush Refinement disclosure geometry is unavailable"
    }
    $width = $targetRect.Right - $targetRect.Left
    $height = $targetRect.Bottom - $targetRect.Top
    $targetCenterY = ($targetRect.Top + $targetRect.Bottom) / 2.0
    $labelCenterY = ($labelRect.Top + $labelRect.Bottom) / 2.0
    if ($width -lt 12 -or $width -gt 22 -or $height -lt 12 -or $height -gt 22 -or
        [math]::Abs($targetCenterY-$labelCenterY) -gt 10 -or $targetRect.Left -le $labelRect.Right -or
        ($rootRect.Right-$targetRect.Right) -lt 0 -or ($rootRect.Right-$targetRect.Right) -gt 24 -or
        $client.Left -ne 0 -or $client.Top -ne 0 -or $client.Right -ne $width -or $client.Bottom -ne $height) {
        Throw-Unavailable "Brush Refinement disclosure geometry changed before use"
    }
    return $client
}

function Post-VerifiedClientClick([object]$Target, [object]$Client, [scriptblock]$Validate) {
    $x = [int][math]::Floor(($Client.Right-$Client.Left)/2.0)
    $y = [int][math]::Floor(($Client.Bottom-$Client.Top)/2.0)
    $coordinates = (($y -band 0xFFFF)*0x10000)+($x -band 0xFFFF)
    foreach ($entry in @(
        [PSCustomObject]@{message=$WM_LBUTTONDOWN;wParam=$MK_LBUTTON},
        [PSCustomObject]@{message=$WM_LBUTTONUP;wParam=0}
    )) {
        & $Validate | Out-Null
        if (-not [LRBridgeNative]::PostMessage([IntPtr]$Target.Handle,[uint32]$entry.message,[IntPtr]$entry.wParam,[IntPtr][Int64]$coordinates)) {
            throw "Target-local native activation message could not be posted"
        }
    }
}

function Assert-FocusRangeActionIdentity([object]$Target, [string]$Action) {
    if ($null -eq $Target -or @("subject", "point-area") -notcontains $Action -or $Target.FocusAction -ne $Action) {
        Throw-Unavailable "Focus Range action target is unavailable"
    }
    $windows = Get-LightroomWindows
    $root = Find-LensBlurRoot $windows
    $actions = Find-FocusRangeActionTargets $windows $root
    if ($null -eq $root -or $null -eq $actions) { Throw-Unavailable "Focus Range action discovery became ambiguous" }
    $current = if($Action -eq "subject"){$actions.Subject}else{$actions.PointArea}
    if ($null -eq $current -or $current.Handle -ne $Target.Handle -or $current.LabelHandle -ne $Target.LabelHandle -or
        $current.TrackHandle -ne $Target.TrackHandle -or $current.PairHandle -ne $Target.PairHandle -or
        $current.AnchorHandle -ne $Target.AnchorHandle) {
        Throw-Unavailable "Focus Range action identity changed before use"
    }
    $handle = [IntPtr]$Target.Handle
    $client = New-Object LRBridgeNative+RECT
    if (-not [LRBridgeNative]::IsWindow($handle) -or [LRBridgeNative]::ProcessId($handle) -ne $Target.ProcessId -or
        [LRBridgeNative]::ClassName($handle) -notmatch '^AfxWnd\d+u$' -or
        [LRBridgeNative]::WindowText($handle) -ne " (Bridge View)" -or
        [LRBridgeNative]::GetParent($handle) -ne [IntPtr]$root.Handle -or
        [LRBridgeNative]::GetDlgCtrlID($handle) -ne 65535 -or -not [LRBridgeNative]::EffectivelyVisible($handle) -or
        -not [LRBridgeNative]::IsWindowEnabled($handle) -or -not [LRBridgeNative]::GetClientRect($handle,[ref]$client)) {
        Throw-Unavailable "Focus Range action target changed before use"
    }
    $width = $Target.Right - $Target.Left
    $height = $Target.Bottom - $Target.Top
    if ($client.Left -ne 0 -or $client.Top -ne 0 -or $client.Right -ne $width -or $client.Bottom -ne $height -or
        $width -lt 16 -or $width -gt 30 -or $height -lt 14 -or $height -gt 26) {
        Throw-Unavailable "Focus Range action geometry changed before use"
    }
    return $client
}

function Post-VerifiedFocusRangeActionSequence([object]$Target, [scriptblock]$Validate) {
    $client = & $Validate
    $x = [int][math]::Floor(($client.Right-$client.Left)/2.0)
    $y = [int][math]::Floor(($client.Bottom-$client.Top)/2.0)
    $coordinates = (($y -band 0xFFFF)*0x10000)+($x -band 0xFFFF)
    $handle = [IntPtr]$Target.Handle
    foreach ($entry in @(
        [PSCustomObject]@{message=$WM_MOUSEMOVE;wParam=0;lParam=$coordinates},
        [PSCustomObject]@{message=$WM_LBUTTONDOWN;wParam=$MK_LBUTTON;lParam=$coordinates},
        [PSCustomObject]@{message=$WM_LBUTTONUP;wParam=0;lParam=$coordinates},
        [PSCustomObject]@{message=$WM_MOUSELEAVE;wParam=0;lParam=0}
    )) {
        $messageResult = [IntPtr]::Zero
        $delivered = [LRBridgeNative]::SendMessageTimeout(
            $handle,
            [uint32]$entry.message,
            [IntPtr]$entry.wParam,
            [IntPtr][Int64]$entry.lParam,
            [uint32]($SMTO_BLOCK -bor $SMTO_ABORTIFHUNG),
            [uint32]$FOCUS_ACTION_MESSAGE_TIMEOUT_MS,
            [ref]$messageResult)
        if ($delivered -eq [IntPtr]::Zero) {
            Throw-Unavailable "Lightroom Focus Range action message timed out or failed"
        }
    }
    & $Validate | Out-Null
}

function Invoke-FocusRangeAction([string]$Action) {
    if (@("subject", "point-area") -notcontains $Action) { throw "Unknown Focus Range action" }
    $discovery = Discover-NativeControls
    $public = Public-FocusRangeActionState $discovery $Action
    if ($public.available -ne $true -or $public.enabled -ne $true) {
        Throw-Unavailable "Focus Range action target is unavailable or ambiguous"
    }
    $target = if($Action -eq "subject"){$discovery.FocusRangeActions.Subject}else{$discovery.FocusRangeActions.PointArea}
    $validator = { Assert-FocusRangeActionIdentity $target $Action }
    Post-VerifiedFocusRangeActionSequence $target $validator
    return Get-NativeState
}

function Assert-RefinementResetIdentity([object]$Target, [object]$Root, [bool]$RequireEnabled) {
    if ($null -eq $Target -or $null -eq $Root) { Throw-Unavailable "Reset Depth Refinement target is unavailable" }
    Assert-RefinementRootIdentity $Root
    $handle = [IntPtr]$Target.Handle
    $rootHandle = [IntPtr]$Root.Handle
    if (-not [LRBridgeNative]::IsWindow($handle) -or [LRBridgeNative]::ProcessId($handle) -ne $Target.ProcessId -or
        [LRBridgeNative]::ClassName($handle) -ne "Static" -or [LRBridgeNative]::WindowText($handle) -ne "Reset" -or
        [LRBridgeNative]::GetParent($handle) -ne $rootHandle -or [LRBridgeNative]::GetDlgCtrlID($handle) -ne $Target.ControlId -or
        -not [LRBridgeNative]::EffectivelyVisible($handle) -or
        (([LRBridgeNative]::GetWindowLong($handle, $GWL_STYLE) -band $SS_NOTIFY) -ne $SS_NOTIFY) -or
        ($RequireEnabled -and -not [LRBridgeNative]::IsWindowEnabled($handle))) {
        Throw-Unavailable "Reset Depth Refinement target identity changed before use"
    }
    $targetRect = New-Object LRBridgeNative+RECT
    $rootRect = New-Object LRBridgeNative+RECT
    $client = New-Object LRBridgeNative+RECT
    if (-not [LRBridgeNative]::GetWindowRect($handle,[ref]$targetRect) -or
        -not [LRBridgeNative]::GetWindowRect($rootHandle,[ref]$rootRect) -or
        -not [LRBridgeNative]::GetClientRect($handle,[ref]$client)) {
        Throw-Unavailable "Reset Depth Refinement geometry is unavailable"
    }
    $width = $targetRect.Right - $targetRect.Left
    $height = $targetRect.Bottom - $targetRect.Top
    $rootWidth = $rootRect.Right - $rootRect.Left
    if ($width -lt 20 -or $width -gt 120 -or $height -lt 12 -or $height -gt 40 -or
        $targetRect.Top -lt $rootRect.Top -or $targetRect.Bottom -gt ($rootRect.Top + 42) -or
        $targetRect.Left -le ($rootRect.Left + ($rootWidth / 2.0)) -or $targetRect.Right -gt $rootRect.Right -or
        ($rootRect.Right-$targetRect.Right) -lt 0 -or ($rootRect.Right-$targetRect.Right) -gt 24 -or
        $client.Left -ne 0 -or $client.Top -ne 0 -or $client.Right -ne $width -or $client.Bottom -ne $height) {
        Throw-Unavailable "Reset Depth Refinement geometry changed before use"
    }
    return $client
}

function Invoke-RefinementReset {
    $discovery = Discover-NativeControls
    $resetState = Public-RefinementResetState $discovery
    if ($resetState.available -ne $true) { Throw-Unavailable "Reset Depth Refinement target is unavailable" }
    if ($resetState.enabled -ne $true) { Throw-Unavailable "Reset Depth Refinement is disabled" }
    $target = $discovery.RefinementReset
    $validator = { Assert-RefinementResetIdentity $target $discovery.RefinementRoot $true }
    $client = & $validator
    Post-VerifiedClientClick $target $client $validator

    $state = $null
    foreach ($delay in @(30,90,180)) {
        Start-Sleep -Milliseconds $delay
        $after = Discover-NativeControls
        $state = Get-NativeStateFromDiscovery $after
        if ($state.refinementReset.available -eq $true -and $state.refinementReset.enabled -eq $false) {
            return $state
        }
    }
    Throw-Unavailable "Lightroom did not confirm that Reset Depth Refinement became disabled"
}

function Set-RefinementDisclosure([bool]$Open) {
    $discovery = Discover-NativeControls
    $current = Read-RefinementDisclosureState $discovery
    if ($current.available -ne $true) { Throw-Unavailable "Authoritative Brush Refinement disclosure state is unavailable" }
    if ($current.value -eq $Open) { return Get-NativeStateFromDiscovery $discovery }
    $target = $discovery.RefinementDisclosure
    $validator = { Assert-RefinementDisclosureIdentity $target $discovery.LensRoot }
    $client = & $validator
    Post-VerifiedClientClick $target $client $validator
    Start-Sleep -Milliseconds 30
    $after = Discover-NativeControls
    $state = Get-NativeStateFromDiscovery $after
    if ($state.refinementDisclosure.available -ne $true -or $state.refinementDisclosure.value -ne $Open) {
        Start-Sleep -Milliseconds 90
        $after = Discover-NativeControls
        $state = Get-NativeStateFromDiscovery $after
    }
    if ($state.refinementDisclosure.available -ne $true -or $state.refinementDisclosure.value -ne $Open) {
        Throw-Unavailable "Lightroom did not confirm the requested Brush Refinement disclosure state"
    }
    return $state
}

function Find-ModeActivationTarget([object]$Discovery, [string]$Mode) {
    if ($null -eq $Discovery.RefinementRoot -or @("focus", "blur") -notcontains $Mode) { return $null }
    $root = $Discovery.RefinementRoot
    $expectedText = if($Mode -eq "focus"){"Focus (Bridge View)"}else{"Blur (Bridge View)"}
    $matches = @($Discovery.Windows | Where-Object {
        $_.ProcessId -eq $root.ProcessId -and $_.Class -match '^AfxWnd\d+u$' -and $_.Text -eq $expectedText -and
        $_.Parent -eq $root.Handle -and $_.ControlId -eq 65535 -and $_.Visible -and $_.Enabled -and
        $_.Top -ge $root.Top -and $_.Bottom -le ($root.Top + 30) -and $_.Left -ge $root.Left -and $_.Right -le $root.Right
    })
    if ($matches.Count -ne 1) { return $null }
    return $matches[0]
}

function Assert-ModeActivationTarget([object]$Target, [object]$Root, [string]$Mode) {
    if ($null -eq $Target -or $null -eq $Root) { Throw-Unavailable "Mode activation target is unavailable" }
    $handle = [IntPtr]$Target.Handle
    $rootHandle = [IntPtr]$Root.Handle
    $expectedText = if($Mode -eq "focus"){"Focus (Bridge View)"}else{"Blur (Bridge View)"}
    if (-not [LRBridgeNative]::IsWindow($handle) -or -not [LRBridgeNative]::IsWindow($rootHandle) -or
        [LRBridgeNative]::ProcessId($handle) -ne $Target.ProcessId -or [LRBridgeNative]::ProcessId($rootHandle) -ne $Target.ProcessId -or
        [LRBridgeNative]::ClassName($handle) -notmatch '^AfxWnd\d+u$' -or [LRBridgeNative]::WindowText($handle) -ne $expectedText -or
        [LRBridgeNative]::GetParent($handle) -ne $rootHandle -or [LRBridgeNative]::GetDlgCtrlID($handle) -ne 65535 -or
        -not [LRBridgeNative]::EffectivelyVisible($handle) -or -not [LRBridgeNative]::IsWindowEnabled($handle) -or
        [LRBridgeNative]::ClassName($rootHandle) -notmatch '^AfxWnd\d+u$' -or [LRBridgeNative]::WindowText($rootHandle) -ne "LensBlurRefinement") {
        Throw-Unavailable "Mode activation target identity changed before use"
    }
    $client = New-Object LRBridgeNative+RECT
    if (-not [LRBridgeNative]::GetClientRect($handle, [ref]$client) -or $client.Left -ne 0 -or $client.Top -ne 0 -or
        $client.Right -lt 20 -or $client.Right -gt 100 -or $client.Bottom -lt 12 -or $client.Bottom -gt 40) {
        Throw-Unavailable "Mode activation target client geometry is invalid"
    }
    return $client
}

function Post-ModeClientActivation([object]$Discovery, [string]$Mode) {
    $target = Find-ModeActivationTarget $Discovery $Mode
    $client = Assert-ModeActivationTarget $target $Discovery.RefinementRoot $Mode
    $x = [int][math]::Floor(($client.Right - $client.Left) / 2.0)
    $y = [int][math]::Floor(($client.Bottom - $client.Top) / 2.0)
    $coordinates = (($y -band 0xFFFF) * 0x10000) + ($x -band 0xFFFF)
    foreach ($entry in @(
        [PSCustomObject]@{message=$WM_LBUTTONDOWN;wParam=$MK_LBUTTON},
        [PSCustomObject]@{message=$WM_LBUTTONUP;wParam=0}
    )) {
        Assert-ModeActivationTarget $target $Discovery.RefinementRoot $Mode | Out-Null
        $posted = [LRBridgeNative]::PostMessage([IntPtr]$target.Handle, [uint32]$entry.message, [IntPtr]$entry.wParam, [IntPtr][Int64]$coordinates)
        if (-not $posted) { throw "Target-local mode activation message could not be posted" }
    }
}

function Set-RefinementMode([string]$Mode) {
    if (@("focus", "blur") -notcontains $Mode) { throw "Unknown Brush Refinement mode" }
    $discovery = Discover-NativeControls
    $state = Get-NativeStateFromDiscovery $discovery
    if ($state.refinementMode -eq $Mode) { return $state }
    if ($state.refinementModeTargetsAvailable -ne $true) {
        Throw-Unavailable "Verified Brush Refinement mode targets are unavailable"
    }
    Post-ModeClientActivation $discovery $Mode
    Start-Sleep -Milliseconds 30
    $currentDiscovery = Refresh-RefinementDiscovery $discovery
    $state = Get-NativeStateFromDiscovery $currentDiscovery
    if ($state.refinementMode -ne $Mode) {
        Start-Sleep -Milliseconds 90
        $currentDiscovery = Refresh-RefinementDiscovery $currentDiscovery
        $state = Get-NativeStateFromDiscovery $currentDiscovery
    }
    if ($state.refinementMode -ne $Mode) {
        Throw-Unavailable "Lightroom did not confirm the requested Brush Refinement mode"
    }
    return $state
}

function Invoke-Request([object]$Request) {
    if ($null -eq $Request -or $Request.id -isnot [int64] -and $Request.id -isnot [int32]) { throw "Invalid request id" }
    if ($Request.operation -eq "readState") { return Get-NativeState }
    if ($Request.operation -eq "setTrackbar") {
        if (@("amount", "size", "feather", "flow") -notcontains $Request.control) { throw "Unknown Brush Refinement control" }
        if ($null -ne $Request.interaction -and $Request.interaction -isnot [string]) { throw "Invalid Brush Refinement interaction id" }
        if ($Request.final -isnot [bool]) { throw "Invalid Brush Refinement final flag" }
        return Set-Trackbar $Request.control (Read-FiniteRequestNumber $Request.value "value") $Request.interaction $Request.final
    }
    if ($Request.operation -eq "resetTrackbar") {
        if (@("amount", "size", "feather", "flow") -notcontains $Request.control) { throw "Unknown Brush Refinement control" }
        return Reset-Trackbar $Request.control
    }
    if ($Request.operation -eq "adjustTrackbar") {
        if (@("amount", "size", "feather", "flow") -notcontains $Request.control) { throw "Unknown Brush Refinement control" }
        $discovery = Discover-NativeControls
        $current = Get-PrivateTrack $discovery $Request.control
        if ($null -eq $current) { Throw-Unavailable "Requested Brush Refinement trackbar is unavailable" }
        $amount = Read-FiniteRequestNumber $Request.amount "amount"
        return Set-DiscoveredTrackbar $discovery $Request.control ([double]$current.value + $amount)
    }
    if ($Request.operation -eq "setCheckbox") {
        if (@("visualizeDepth", "autoMask") -notcontains $Request.control -or $Request.enabled -isnot [bool]) { throw "Invalid checkbox request" }
        return Set-Checkbox $Request.control $Request.enabled
    }
    if ($Request.operation -eq "setRefinementMode") {
        if ($Request.mode -isnot [string]) { throw "Invalid Brush Refinement mode request" }
        return Set-RefinementMode $Request.mode
    }
    if ($Request.operation -eq "setRefinementDisclosure") {
        if ($Request.open -isnot [bool]) { throw "Invalid Brush Refinement disclosure request" }
        return Set-RefinementDisclosure $Request.open
    }
    if ($Request.operation -eq "resetRefinement") {
        return Invoke-RefinementReset
    }
    if ($Request.operation -eq "activateFocusRangeAction") {
        if ($Request.action -isnot [string]) { throw "Invalid Focus Range action request" }
        return Invoke-FocusRangeAction $Request.action
    }
    throw "Unknown native operation"
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $request = $null
    try {
        $request = ConvertFrom-Json -InputObject $line
        $result = Invoke-Request $request
        [PSCustomObject]@{ id = $request.id; ok = $true; result = $result } | ConvertTo-Json -Depth 8 -Compress
    } catch {
        $message = $_.Exception.Message
        $unavailable = $message.StartsWith("UNAVAILABLE: ")
        if ($unavailable) { $message = $message.Substring(13) }
        [PSCustomObject]@{ id = if ($null -ne $request) { $request.id } else { $null }; ok = $false; unavailable = $unavailable; error = $message } |
            ConvertTo-Json -Depth 4 -Compress
    }
    [Console]::Out.Flush()
}
