# Read-only, in-memory identification of rendered labels in the verified Selected
# group. Never capture the desktop/photo, save screenshots, or send input here.
function Initialize-SelectedLabelReader {
    if ($null -ne $script:SelectedLabelEngine) { return }
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    if (-not ('LRBridgeSelectedRender' -as [type])) {
        Add-Type -ReferencedAssemblies System.Drawing,System.Core -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
public static class LRBridgeSelectedRender {
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left,Top,Right,Bottom; }
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h,out Rect r);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int n);
    static Task<byte[]> pending;
    static string Text(IntPtr h) { var s=new StringBuilder(256);GetWindowText(h,s,s.Capacity);return s.ToString(); }
    static string Class(IntPtr h) { var s=new StringBuilder(256);GetClassName(h,s,s.Capacity);return s.ToString(); }
    static void Check(IntPtr h,int pid) {
        uint actual;GetWindowThreadProcessId(h,out actual);
        if(!IsWindow(h)||actual!=pid||!IsWindowVisible(h)||!IsWindowEnabled(h)) throw new Exception("Selected render ownership or availability changed.");
    }
    public static byte[] Capture(long handle,long group,long owner,int pid) {
        // PrintWindow is synchronous. Keep at most ONE bounded render worker;
        // a stalled Lightroom render cannot accumulate workers or block polling.
        if(pending!=null&&!pending.IsCompleted) throw new Exception("Selected label render is still waiting for Lightroom.");
        pending=Task.Run(()=> {
            var h=new IntPtr(handle);var g=new IntPtr(group);var o=new IntPtr(owner);
            Check(h,pid);Check(g,pid);Check(o,pid);
            if(GetParent(h)!=g||Text(h)!=" (Bridge View)"||!Class(h).StartsWith("AfxWnd")||Text(g)!="View"||Text(o)!="Remove"||Text(GetParent(o))!="Collapsible Section")
                throw new Exception("Selected render target is outside the verified panel.");
            var ancestor=GetParent(g);int depth=0;
            while(ancestor!=IntPtr.Zero&&ancestor!=o&&depth++<32){Check(ancestor,pid);ancestor=GetParent(ancestor);}
            if(ancestor!=o) throw new Exception("Selected render target lost manual Remove ownership.");
            Rect r;if(!GetClientRect(h,out r)||r.Left!=0||r.Top!=0||r.Right<30||r.Right>240||r.Bottom<16||r.Bottom>60)
                throw new Exception("Selected label client bounds are unavailable.");
            using(var bitmap=new Bitmap(r.Right,r.Bottom)) {
                using(var graphics=Graphics.FromImage(bitmap)) {
                    graphics.Clear(Color.Magenta);var dc=graphics.GetHdc();
                    try { if(!PrintWindow(h,dc,1)) throw new Exception("Selected label render failed."); }
                    finally { graphics.ReleaseHdc(dc); }
                }
                Check(h,pid);if(GetParent(h)!=g)throw new Exception("Selected target changed during rendering.");
                using(var output=new MemoryStream()){bitmap.Save(output,ImageFormat.Png);return output.ToArray();}
            }
        });
        if(!pending.Wait(350)) throw new Exception("Selected label render timed out waiting for Lightroom.");
        return pending.GetAwaiter().GetResult();
    }
    public static byte[] Prepare(byte[] png,int variant) {
        using(var input=new MemoryStream(png))using(var original=new Bitmap(input))using(var small=new Bitmap(original.Width,original.Height)) {
            for(int x=0;x<original.Width;x++)for(int y=0;y<original.Height;y++) {
                var c=original.GetPixel(x,y);int v=(c.R+c.G+c.B)/3;
                if(variant==1||variant==3)c=Color.FromArgb(255-v,255-v,255-v);
                if(variant==2){v=v>140?0:255;c=Color.FromArgb(v,v,v);}
                small.SetPixel(x,y,c);
            }
            // Retain the original variants (including Subtract's 4x match).
            // Add an inverted 3x view for Add's unselected appearance.
            int scale=variant==1?4:3;
            using(var large=new Bitmap(small.Width*scale+40,small.Height*scale+40)) {
                using(var g=Graphics.FromImage(large)) {
                    g.Clear(variant==0?original.GetPixel(2,2):Color.White);
                    g.InterpolationMode=InterpolationMode.NearestNeighbor;g.PixelOffsetMode=PixelOffsetMode.Half;
                    g.DrawImage(small,new Rectangle(20,20,small.Width*scale,small.Height*scale),0,0,small.Width,small.Height,GraphicsUnit.Pixel);
                }
                using(var output=new MemoryStream()){large.Save(output,ImageFormat.Png);return output.ToArray();}
            }
        }
    }
}
'@
    }
    [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
    [Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
    [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
    [Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
    [Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime] | Out-Null
    $script:SelectedLabelAwait = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    $script:SelectedLabelEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US'))
    if ($null -eq $script:SelectedLabelEngine) { throw 'Automatic Add/Subtract identification requires the installed Windows English OCR language.' }
}
function Wait-SelectedLabelOperation($operation,[Type]$type) {
    $task=$script:SelectedLabelAwait.MakeGenericMethod($type).Invoke($null,@($operation))
    $remaining=if($null -ne $script:SelectedIdentificationTimer){1500-$script:SelectedIdentificationTimer.ElapsedMilliseconds}else{350}
    if($remaining -le 0 -or -not $task.Wait([int][math]::Min(350,$remaining))){
        try{$operation.Cancel()}catch{}
        throw 'Windows OCR timed out reading a Selected control label.'
    }
    return $task.GetAwaiter().GetResult()
}
function Read-SelectedLabelVotes([byte[]]$png) {
    $votes=@()
    $script:SelectedLabelReadings=@()
    foreach($variant in @(0,1,2,3)) {
        $memory=[IO.MemoryStream]::new([LRBridgeSelectedRender]::Prepare($png,$variant))
        $stream=[System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($memory)
        try {
            $decoder=Wait-SelectedLabelOperation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
            $bitmap=Wait-SelectedLabelOperation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
            try {
                $result=Wait-SelectedLabelOperation ($script:SelectedLabelEngine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
                $words=@($result.Lines | ForEach-Object {$_.Words} | ForEach-Object {$_.Text})
                $script:SelectedLabelReadings+=@{variant=@('original-3x','inverted-4x','binary-3x','inverted-3x')[$variant];text=$result.Text.Substring(0,[math]::Min(100,$result.Text.Length))}
                $votes+=,(@($words | Where-Object {$_ -imatch '^(Add|Subtract)$'} | ForEach-Object {$_.ToLowerInvariant()} | Select-Object -Unique))
            } finally {$bitmap.Dispose()}
        } finally {$stream.Dispose();$memory.Dispose()}
    }
    return ,$votes
}
function Resolve-SelectedLabel($votes) {
    $labels=@($votes | ForEach-Object {$_} | Select-Object -Unique)
    if($labels.Count -ne 1){return $null}
    $count=@($votes | Where-Object {$_ -contains $labels[0]}).Count
    if($count -lt 2){return $null}
    return $labels[0]
}
function Get-SelectedRefinementCandidates($d) {
    $candidates=@()
    foreach($handle in [LRBridgeNative]::GetWindowTree([IntPtr]$d.Group.Handle,$d.Group.ProcessId)) {
        if([long][LRBridgeNative]::GetParent($handle) -ne $d.Group.Handle){continue}
        $w=Get-WindowSnapshot $handle $d.Group.ProcessId
        if($null -eq $w -or $w.Class -notmatch '^AfxWnd\d+u$' -or $w.Text -cne ' (Bridge View)' -or $w.ControlId -ne 65535){continue}
        $rect=New-Object LRBridgeNative+RECT
        if(-not [LRBridgeNative]::GetClientRect($handle,[ref]$rect)){throw 'Selected candidate client bounds could not be read.'}
        if($rect.Left -eq 0 -and $rect.Top -eq 0 -and $rect.Right -ge 30 -and $rect.Right -le 240 -and $rect.Bottom -ge 16 -and $rect.Bottom -le 60){$candidates+=$w}
    }
    if($candidates.Count -lt 2 -or $candidates.Count -gt 5){throw 'Selected Add/Subtract candidate controls are missing or ambiguous.'}
    return $candidates
}
function New-AutomaticRemoveRefinementBinding($d) {
    $script:SelectedIdentificationEvidence=@{at=[DateTime]::UtcNow.ToString('o');token=$d.Token;controls=@()}
    if(-not $d.Group.Visible -or -not $d.Group.Enabled -or -not $d.Owner.Visible -or -not $d.Owner.Enabled){throw 'Selected panel is not visible and enabled for automatic label identification.'}
    $script:SelectedIdentificationTimer=[Diagnostics.Stopwatch]::StartNew()
    Initialize-SelectedLabelReader
    $candidates=@(Get-SelectedRefinementCandidates $d)
    $found=@{add=@();subtract=@()}
    foreach($w in $candidates) {
        if($script:SelectedIdentificationTimer.ElapsedMilliseconds -gt 1150){throw 'Automatic Selected label identification exceeded its read deadline.'}
        # Scope/ownership is checked again in the render worker, then all targets
        # are revalidated by the caller. No coordinate-based mode assignment.
        $png=[LRBridgeSelectedRender]::Capture($w.Handle,$d.Group.Handle,$d.Owner.Handle,$d.Group.ProcessId)
        $votes=Read-SelectedLabelVotes $png
        $label=Resolve-SelectedLabel $votes
        $script:SelectedIdentificationEvidence.controls+=@{handle=$w.Handle;readings=$script:SelectedLabelReadings;votes=$votes;resolved=$label}
        if($label){$w | Add-Member -NotePropertyName renderedLabel -NotePropertyValue $(if($label -eq 'add'){'Add'}else{'Subtract'}) -Force;$found[$label]+=,$w}
    }
    if($found.add.Count -ne 1 -or $found.subtract.Count -ne 1){throw 'Automatic Selected label read needs exactly one Add and one Subtract, each recognized consistently in two image variants.'}
    return [pscustomobject]@{version=2;token=$d.Token;candidateKey=(@($candidates | ForEach-Object {$_.Handle} | Sort-Object) -join ':');processStartedAt=(Get-RemoveRefinementProcessStart $d.Group.ProcessId);
        expiresAt=[DateTime]::UtcNow.AddSeconds(15).ToString('o');add=$found.add[0];subtract=$found.subtract[0]}
}
