# Native Tone Curve feedback and point editing

Lightroom can return Tone Curves whose first or last input coordinate is inside
0–255. Three unchanged-photo samples from both LrPhoto:getDevelopSettings() and
LrDevelopController.getValue() returned this Blue array after Deep Blue:

```text
[2,34,73,119,139,177,171,200,255,223]
```

Requiring the first input to be 0 discarded the complete snapshot before Curve
Name and Refine Saturation were read. Native display/feedback now accepts this
array exactly. Fresh native source feedback subsequently confirmed **Custom**
and **Refine Saturation 100**, range **0–100**, after the user's editing test.
Blue's drawing, RGB/Red/Green Add/Delete and Masking editing were manually
accepted in that run. The subsequent Blue read-only restriction was **not
accepted** and is superseded by the editing correction below.

## Editing contract

Browser operations, HTTP parsing/admission, queued-command validation and Lua
execution accept structurally valid native arrays. Validation still requires
dense integer input/output pairs, 2–256 points, coordinates in 0–255 and strictly
increasing inputs. Photo identity, context/Develop counters, selected mask and
exact SDK baseline checks remain required; accepting an array does not authorize
a write to a different or stale context.

- **Add Point** inserts one interior pair strictly between the actual first and
  last inputs, rejects duplicate inputs and retains every existing pair.
- **Delete Point** removes only the selected interior pair. First and last points
  cannot be deleted, including inset endpoints.
- **Drag** changes only the selected pair. Interior inputs stay between their
  neighbors. Endpoint outputs can move, while each endpoint's existing input
  stays fixed: Input 2 remains 2 rather than being forced to 0.
- No boundary point is inserted, no curve is regenerated and untouched channels
  are not written. Serialization and confirmation compare exact coordinates.
- **Reset selected channel** still calls the existing SDK default-reset operation
  (or the existing local Masking reset path); the Controller does not assume a
  default array or fabricate confirmation. Built-in named presets retain their
  exact predefined target-array validation.

The [MIDI2LR reference](https://github.com/rsjaffe/MIDI2LR/blob/e7f181cbaab5d9a0a1fd9de2e8c576f88a3f19cc/src/plugin/ClientUtilities.lua#L530-L608)
also preserves existing native input coordinates when writing through the SDK.
Its operation adjusts several outputs and is not used as LRBridge's graph-edit
algorithm. It does not establish native acceptance of LRBridge Add/Delete.

Source: [ToneCurve.lua](../lightroom/LRBridge.lrplugin/ToneCurve.lua),
[Masking.lua](../lightroom/LRBridge.lrplugin/Masking.lua),
[point-curve-state.js](../server/point-curve-state.js),
[command validation](../server/commands.js), [HTTP routes](../server/bridge.js)
and the [shared Controller](../app/controller-tone-curve.js).

## Focused verification

```powershell
node tests/native-curve-editing.js
node tests/mask-native-curve-editing.js
node tests/native-curve-compatibility.js
node tests/controller-native-curve-browser.js
node tests/controller-point-curve-add-browser.js
```

The [sanitized actual fixture](../tests/fixtures/deep-blue-native-curve.json)
drives Add/Delete/drag regressions for first-, last- and both-inset endpoints.
The browser regression exercises real touch handlers through production HTTP,
queue and Lua code with SDK doubles; unchanged heartbeats cannot erase pending
points. Separate Masking handler checks verify exact local writes and confirmed
numeric/string-pair readback. Standard channels, untouched pairs/channels,
malformed data, stale baselines and genuine photo/mask/context changes are
covered. SDK Reset uses a deliberately non-linear inset default in the fixture
to guard against an assumed-zero or assumed-boundary result.

These automated checks pass, including a regression that failed before the
editing correction. They are **not real Lightroom write verification**.
The user subsequently reported that current Curve editing appears to work.
Fresh source feedback on the edited photo confirms Curve Name **Custom** and
Refine Saturation **100**, with advancing native receipt timestamps and an idle
queue. Existing worker logs show Blue gestures were consumed, but the prepared
diagnostic write log was not available. Exact attempted-array, SDK error and
per-write readback correlation therefore remains unverified; the current Linear
Blue snapshot does not prove the earlier inset edit targets. A focused packaged
Curve check remains necessary. Any future SDK rejection must retain the exact
attempted array, SDK error and readback before being classified as a platform
limitation. The production plug-in has no temporary logging or diagnostic
virtual-copy-only restriction.

Accepted Refine gesture/terminal-confirmation and touch safeguards, preset
feedback recovery, natural-spline drawing, Parametric mathematics and Reset
defaults remain unchanged. This correction does not resolve every intermittent
Tone Curve feedback report. No automatic photo reset is a recovery action.
