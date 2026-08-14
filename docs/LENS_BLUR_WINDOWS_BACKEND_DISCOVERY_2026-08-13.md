# Lens Blur Windows Backend Discovery — Lightroom Classic 15.3

This document is the permanent handoff for the second-pass Windows-native Lens Blur investigation completed on 2026-08-13. It supplements `LENS_BLUR_RUNTIME_DISCOVERY_2026-08-13.md`, whose first pass established the public Lightroom SDK surface and its gaps.

The second pass proved that several controls omitted from the public SDK are standard or structurally identifiable Win32 controls. All tests used native window messages. No keyboard input, mouse automation, screen coordinates, canvas clicks, or Lightroom preference-file writes were used.

## Core safety rule: HWNDs are ephemeral

Every recorded HWND was a runtime instance only. Lightroom rebuilds parts of its native window tree, and an HWND observed in one probe can already be invalid in a later operation.

A production backend must therefore:

- rediscover controls for every read or write operation;
- validate the Lightroom process ownership, class, parent relationship, visible/enabled state, label/geometry relationship, native range, and other control-specific evidence immediately before use;
- reject ambiguous or incomplete matches;
- never store a discovered HWND as a permanent control identity;
- fail closed and report unavailable rather than guessing.

The HWND values below are evidence from one live session, not production identifiers.

## Proven native trackbar contract

The Brush Refinement numeric controls are native controls of class:

```text
msctls_trackbar32
```

The end-to-end write sequence proven first on Focus Amount and then independently on Size, Feather, and Flow is:

```text
TBM_SETPOS(TRUE, position)
parent WM_HSCROLL / TB_THUMBTRACK
parent WM_HSCROLL / TB_THUMBPOSITION
parent WM_HSCROLL / TB_ENDTRACK
```

For `TB_THUMBTRACK` and `TB_THUMBPOSITION`, the notification code occupies the low word of `wParam` and the target native position occupies the high word. The trackbar HWND is passed as `lParam`. `TB_ENDTRACK` carries no position.

Successful writes were followed by all available live readbacks:

- `TBM_GETPOS` on the rediscovered native trackbar;
- the displayed Lightroom `Edit` value associated by label and geometry;
- MSAA value;
- Lightroom responsiveness and visible-error checks.

Preference persistence lagged behind the live controls. Preference keys are supplemental diagnostic evidence only and must not be used as authoritative state.

## Brush Refinement Amount

Focus Amount was proven end-to-end:

```text
100 -> 73 -> 100
```

The live control was a native `msctls_trackbar32`. The Focus Amount branch used native range `0..100000`, with displayed `100` represented by native position `100000`. Native position, displayed edit value, and MSAA followed both writes, and Lightroom remained responsive without an error.

The Blur mode has a separate mutually exclusive Amount branch. Its native range was observed as `0..200000`. That separate range is deterministic evidence used for branch identity; it must not be collapsed into the Focus branch's range.

## Brush Refinement Size

Size was proven end-to-end:

```text
displayed 42.0 -> 31.0 -> 42.0
native     420  -> 310  -> 420
range      1..1000
```

One observed runtime identity was `HWND 0x3123E`, class `msctls_trackbar32`, control ID `100`, parent class `AfxWnd140u`. The displayed edit used the active locale (`42,0` and `31,0`), while the human-unit meaning remained `42.0` and `31.0`.

Native position, displayed value, and MSAA changed in both directions. The user visually confirmed both the test value and exact restoration, with no Lightroom error.

## Brush Refinement Feather

Feather was proven end-to-end:

```text
displayed 100 -> 63 -> 100
native    1000 -> 630 -> 1000
range     0..1000
```

One observed runtime identity was `HWND 0x3131E`, class `msctls_trackbar32`, control ID `100`, parent class `AfxWnd140u`.

Native position, displayed value, and MSAA matched in both directions. The user visually confirmed the test value and restoration, with no Lightroom error.

## Brush Refinement Flow

Flow was proven end-to-end:

```text
displayed 100 -> 47 -> 100
native    1000 -> 470 -> 1000
range     10..1000
```

One observed runtime identity was `HWND 0x312B8`, class `msctls_trackbar32`, control ID `100`, parent class `AfxWnd140u`.

Native position and displayed value matched in both directions. At native position `470`, MSAA reported `46` because the standard trackbar accessibility provider normalized across the nonzero `10..1000` native range. `TBM_GETPOS` plus the displayed Lightroom edit are therefore the authoritative human-value evidence for Flow; its normalized MSAA percentage must not replace them.

The user visually confirmed the test value and restoration, with no Lightroom error.

## Visualize Depth

Visualize Depth was identified as a native `Button` with:

```text
control ID: 100
style type: BS_CHECKBOX
MSAA role: checkbox
```

One observed runtime identity was `HWND 0x31258`, parent class `AfxWnd140u`.

Authoritative readback is:

```text
BM_GETCHECK = 0  => OFF
BM_GETCHECK = 1  => ON
```

MSAA independently reflected unchecked/checked state and exposed the corresponding `Check`/`Uncheck` default action.

The correct write path is one `BM_CLICK`, but only when the requested target differs from the authoritative `BM_GETCHECK` result. `BM_SETCHECK` is not sufficient because it can alter presentation without proving that Lightroom application logic processed the action.

The following was proven and visually confirmed:

```text
OFF -> ON -> OFF
```

On the ON transition:

- `BM_GETCHECK` changed to `1`;
- MSAA changed to checked;
- the native checkbox visibly changed;
- the actual depth visualization appeared in the image.

On restoration, the checkbox returned to OFF and the image visualization disappeared. Lightroom remained responsive and showed no error.

This supersedes the first-pass SDK-only `ACTION-ONLY` limitation for the Windows backend. The public SDK still has no state getter, but Windows has authoritative live state.

## Auto Mask

Brush Refinement Auto Mask was identified as a native `Button` with:

```text
control ID: 100
style type: BS_CHECKBOX
MSAA role: checkbox
```

One observed runtime identity was `HWND 0x312BE`, parent class `AfxWnd140u`.

Authoritative readback is `BM_GETCHECK`, corroborated by MSAA. The correct write path is one `BM_CLICK` only when the requested target differs from the current authoritative state.

The following was proven and visually confirmed:

```text
OFF -> ON -> OFF
```

Both transitions changed `BM_GETCHECK`, MSAA, and the visible native checkbox. Lightroom remained responsive and showed no error. Preference-file immediacy is not authoritative.

## Focus / Blur mode

The two visible mode controls are custom `AfxWnd140u` siblings rather than standard button HWNDs:

```text
Focus (Bridge View)
Blur (Bridge View)
```

Both exposed the same direct native and accessibility state:

- control ID `65535`;
- `BM_GETCHECK = 0`;
- `BM_GETSTATE = 0`;
- `WM_GETDLGCODE = 0`;
- MSAA client role with no selection bit or default action.

Authoritative readback was instead proven through the two mutually exclusive Amount branches:

```text
Focus mode:
  Focus Amount branch visible, range 0..100000
  Blur Amount branch hidden,  range 0..200000

Blur mode:
  Focus Amount branch hidden,  range 0..100000
  Blur Amount branch visible, range 0..200000
```

The user manually performed `Focus -> Blur -> Focus`. Both transitions produced the exact inverse visibility relationship while `getSelectedTool()` remained `depth_refinement`.

One native write experiment sent the Blur HWND to its shared parent through `WM_COMMAND`, notification code `0`, and actual control ID `65535`. Lightroom ignored it: Focus remained selected, branch visibility did not change, and no error occurred.

The original classification at the end of the 2026-08-13 pass was:

```text
READBACK PROVEN THROUGH BRANCH VISIBILITY
WRITE NOT PROVEN
```

The rejected `WM_COMMAND` approach must not be repeated.

### 2026-08-14 target-local writer proof

A later controlled experiment dynamically rediscovered one unambiguous pair of direct `LensBlurRefinement` children:

```text
Focus (Bridge View): AfxWnd140u, client 53 x 19
Blur (Bridge View):  AfxWnd140u, client 45 x 19
```

Starting in authoritative Focus mode, one target-local client-message activation was posted to the verified Blur HWND at its client-relative center `(22, 9)`:

```text
WM_LBUTTONDOWN, wParam=MK_LBUTTON
WM_LBUTTONUP,   wParam=0
```

No global mouse input, cursor movement, screen coordinate, `SendInput`, or fixed HWND was used. Authoritative branch visibility changed to Blur. The exact same dynamically rediscovered path targeted Focus at client-relative `(26, 9)` and restored authoritative Focus mode. Lightroom remained responsive and no error window appeared.

The production writer must remain target-aware, no-op when already in the requested mode, validate class/text/parent/control ID/client geometry immediately before both messages, and accept success exclusively from refreshed mutually exclusive Amount-branch visibility.

Updated classification:

```text
READBACK PROVEN THROUGH BRANCH VISIBILITY
TARGET-LOCAL NATIVE WRITER PROVEN
```

## Focus Range representation and writer

The authoritative `LensBlurFocalRange` representation remains the four-number Lua string:

```text
nearOuter nearInner farInner farOuter
```

Do not interpret `getRange("LensBlurFocalRange") == -100..100` as the compound geometry domain. Valid observed components exceeded `100`.

The previously experimental writer was tested using:

```lua
LrDevelopController.setValue(
    "LensBlurFocalRange",
    "-80 0 55 135"
)
```

The controlled runtime transition was:

```text
-43 37 57 137
->
-80 0 55 135
```

Results:

- the setter was called exactly once per controlled experiment;
- `pcall` returned success and the setter returned no value;
- `LrDevelopController.getValue("LensBlurFocalRange")` changed immediately;
- `photo:getDevelopSettings().LensBlur.FocalRange` initially lagged but settled to the same target string;
- `FocalRangeSource` remained `2` in this state;
- the user watched the native Focus Range strip and confirmed that the Near/left edge moved dramatically left while the Far/right edge moved only slightly;
- Lightroom remained responsive and showed no error.

Exact restoration was then proven:

```text
-80 0 55 135
->
-43 37 57 137
```

Both controller and settled Develop-settings readbacks returned to the exact original string.

The writer is therefore:

```text
RUNTIME-PROVEN EXPERIMENTAL
```

It remains undocumented because Adobe documents the generic `setValue` argument as numeric. Production admission must be strict: exactly four finite numeric tokens, strict ordering, no scalar `getRange()` inference, and authoritative Lightroom readback after every write. The observed transition width of `80` is evidence from tested states, not a universal constraint.

## `selectTool("focal_range")`

The undocumented tool writer was tested exactly once:

```lua
LrDevelopController.selectTool("focal_range")
```

Lightroom rejected it synchronously. `pcall` returned false with this validator message:

```text
selectTool: tool must be one of: loupe, crop, dust, redeye, masking,
upright, point_color, local_point_color, depth_refinement
```

The allowed list excludes `focal_range`. The selected tool remained `depth_refinement`; the Focus Range string and `FocalRangeSource` remained unchanged. The user confirmed Lightroom did not enter Point / Area Focus mode.

Do not use or retry this path in production.

## Production support boundary

Runtime-proven Windows backend candidates:

- Brush Refinement Amount, Size, Feather, and Flow through native trackbars;
- Visualize Depth authoritative state and target-aware activation;
- Auto Mask authoritative state and target-aware activation;
- Focus/Blur feedback through mutually exclusive Amount-branch visibility and target-aware activation through verified custom controls;
- structured Focus Range read/write with strict validation and Lightroom readback, explicitly classified as runtime-proven experimental.
- Brush Refinement disclosure readback from the actual subtree's effective visibility; the structurally identified disclosure writer awaits the requested manual Open/Close proof.
- `Reset Depth Refinement` enabled-state readback from Lightroom's native Reset target, exposed fail-closed as the separately confirmed `Reset Refinement` action; destructive activation awaits a disposable-photo proof.

Still unsupported:

- Subject Focus browser action;
- Point / Area Focus browser action;
- `selectTool("focal_range")`;
- canvas-coordinate input;
- mouse or keyboard automation.

## 2026-08-14 Size paint-state diagnostic

A production Size write exposed a distinction between Lightroom's model/readback and the native trackbar's painted thumb. A controlled write dynamically discovered exactly one visible labeled Size trackbar:

```text
HWND:       0x714BC (runtime instance only)
parent:     0x71352, AfxWnd140u / LensBlurRefinement
rectangle:  1572,649 .. 1834,665
range:      1..1000
before:     native 278, displayed 27.8
after:      native 400, displayed 40.0
```

The HWND, parent, and rectangle remained unchanged through fresh rediscovery 750 ms later. This ruled out a duplicate target, HWND recreation, and a stale parent. The exact notification timings relative to diagnostic start were:

```text
TBM_SETPOS(TRUE, 400)             824634.2 .. 827969.7 us
WM_HSCROLL / TB_THUMBTRACK        832457.5 .. 835700.6 us
WM_HSCROLL / TB_THUMBPOSITION     840886.6 .. 840961.6 us
WM_HSCROLL / TB_ENDTRACK          844563.4 .. 844631.9 us
```

`TBM_SETPOS` changed `TBM_GETPOS` immediately; `TB_THUMBTRACK` changed Lightroom's displayed edit/model. Neither later notification recreated the hierarchy. The standard trackbar MSAA value reported `39`, its normalized percentage for native position `400` in range `1..1000`, rather than Lightroom's human Size value.

A redraw-only probe against the same freshly validated HWND used `RedrawWindow` with `RDW_INVALIDATE | RDW_ERASE | RDW_UPDATENOW | RDW_FRAME`. It completed successfully in about 2.6 ms without changing native position or the displayed value, but later visual testing proved that the displayed thumb still remained frozen. Full `InvalidateRect` / `UpdateWindow` cycles on both the trackbar and `LensBlurRefinement`, plus `RedrawWindow(...RDW_ALLCHILDREN)` on the parent, were accepted and consumed their complete update regions. Size's immediate parent was the refinement root, and both used `WS_CLIPCHILDREN`; the standard trackbar is self-painted rather than parent-painted.

Physical hover over the Lightroom trackbar immediately repainted its thumb at the already-correct native position. The remaining production repaint candidate therefore sends one target-local `WM_MOUSEMOVE` directly to the freshly validated trackbar at the center of its verified client rectangle, followed by immediate trackbar redraw. This does not move the real cursor and uses no global input or screen coordinate.

`TBM_GETTHUMBRECT` must not be queried directly across the process boundary: its `lParam` is a pointer-bearing `WM_USER` message that Windows does not marshal. A diagnostic attempt caused Lightroom to exit and was removed immediately. Production derives the safe hover point only from `GetClientRect`, which is called by the helper against the HWND and does not pass a helper-process pointer through the Lightroom window procedure.

`TBM_GETPOS` and Lightroom's associated displayed edit remain the authoritative numeric acceptance checks.

For drag responsiveness, production may retain a Brush Refinement root only for a short interaction transaction. It must enumerate and structurally validate that root's current subtree before every coalesced write and expire the transaction promptly. This avoids full Lightroom process-tree enumeration on every drag update while still detecting ambiguity, destroyed controls, recreated HWNDs, or hierarchy changes before sending a message.

## 2026-08-14 Brush Refinement disclosure and individual slider Reset

Read-only inspection found the real `Brush Refinement` disclosure row as an exact `Static` label directly under `LensBlurContents`, paired with one unique enabled square `AfxWnd140u` target at the far right of the same row. Production rediscovers the label and target on every disclosure request, validates class, parent, control ID, label alignment, client rectangle, and right-edge relationship, and sends target-local client-relative button messages only when the requested state differs. Success is accepted only after fresh discovery reports the Brush controls effectively visible for Open or hidden for Closed. No selected-tool transition is part of this path.

Read-only inspection also found Lightroom's global `Reset Depth Refinement` target. It is distinct from every per-slider Reset and clears painted Focus/Blur refinement strokes. Production exposes it separately as `Reset Refinement`, mirrors the target's native enabled state, and remains fail-closed when the target is absent or disabled. Activation requires an explicit destructive confirmation and is accepted only if fresh native readback finds the Reset target disabled afterward. No destructive runtime proof was performed on the working photo.

Lightroom's per-slider reset behavior was instead runtime-proven by sending a target-local double-click to one freshly discovered native trackbar. The click point is calculated from `GetClientRect`, scalar `TBM_GETTHUMBLENGTH`, `TBM_GETPOS`, and the live range. `TBM_GETTHUMBRECT` is never used. The standard double-click sequence is posted only to the revalidated trackbar, followed by fresh discovery, authoritative numeric readback, and the proven native thumb repaint.

Controlled Size proof:

```text
captured original: 60.9
Lightroom reset result: 15.0
restored original: 60.9
```

The observed `15.0` is evidence from this runtime instance, not a production default constant. Production asks Lightroom to perform each reset and accepts Lightroom's authoritative result.

The first production form performed two complete Lightroom window-tree discoveries and returned in about `2106 ms`. The optimized path reuses only a recent, revalidated refinement root, rediscovers its subtree, activates the exact trackbar immediately, reads and repaints only that trackbar, and returns the affected authoritative value before refreshing the remaining native state in the background. A second controlled Size proof captured `0.7`, reset to `15.0`, and restored `0.7`; the reset response fell to about `769 ms`. The Web Reset button acknowledges immediately without disabling the rest of its row.

Rapid Brush `+/-` uses a separate finite step accumulator. The first click starts one absolute write; further clicks update one `pendingTarget` and retain only the newest queued absolute target. Polling continues to update authoritative state but cannot replace the active local target. The interaction closes only after its idle period, no in-flight/queued work, a final native write, and matching authoritative feedback. This replaced an earlier timer race in which a cleared `desiredValue` could reach `Number(null)` and become zero.

After a disclosure reopen, Lightroom can temporarily report mode `unknown` while both verified Focus/Blur activation targets already exist. Target availability is therefore exposed independently of selected mode. Both buttons remain enabled when both targets validate; neither appears selected until branch visibility establishes the authoritative mode. Every activation starts with fresh discovery, and only an already-authoritative match is a no-op.

## 2026-08-14 accepted Brush responsiveness result

An apples-to-apples browser-path diagnostic used small reversible Brush Size operations and restored the original value. The accepted results were:

```text
local Brush Web update:             approximately 0.2 ms
request dispatch:                   approximately 0.25 ms
individual Brush Reset reconciliation: approximately 664 ms
```

There were no freezes, zero jumps, stale rollbacks, or incorrect final values. The user accepted the current Brush responsiveness and explicitly ended further responsiveness benchmarking or optimization. No additional Exposure benchmark was authorized after that decision.

## Cleanup and final safety state

- All tested numeric controls were restored to their original values.
- Visualize Depth was restored to OFF.
- Auto Mask was restored to OFF.
- Focus mode remained selected after the rejected `WM_COMMAND` experiment and was restored after the later successful target-local writer proof.
- Focus Range was restored exactly to `-43 37 57 137`.
- The rejected `focal_range` tool call left `depth_refinement` selected.
- Lightroom remained responsive and showed no native error dialog.
- Temporary diagnostic Lua and result files were removed.
- `Help.lua` was restored byte-for-byte to SHA-256 `0f6fa4f08c031a1a246300edcce3a6d145ee5e5c60ebf983b4fe46d381e15077`.
- The temporary source LRBridge server used for selected-tool polling was stopped.
- `config/settings.txt` was not changed.
- `DEBUG_DEVELOP_REFRESH = true` remained enabled.
- No commit, push, tag, Lightroom restart, keyboard input, mouse automation, screen-coordinate automation, canvas click, or preference-file edit occurred.
