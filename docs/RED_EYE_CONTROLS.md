# Red Eye controller

**Manually accepted 2026-09-17:** the user confirms that Open Red Eye, Open Pet Eye, Reset and Close all work in Lightroom Classic 15.4.1. This is acceptance of the four-button workflow. Implementation uses the installed SDK 15.3 documentation and remains SDK-only, without Windows UI automation or simulated keystrokes.

The Tools section provides two compact rows: Open Red Eye / Open Pet Eye, then Reset Red Eye / Close. The existing section navigation, collapse and shared Undo/Redo remain in use.

- Open explicitly calls `LrDevelopController.goToEyeCorrection("red_eye" | "pet_eye")`. Only overall `getSelectedTool() == "redeye"` is confirmed. The SDK has no documented eye-mode getter, so both buttons remain momentary and feedback describes the mode as requested.
- Close calls `selectTool("loupe")` only after the original active tool and photo have been revalidated immediately before the write. Another active tool is never closed by this command.
- Reset calls `resetRedeye()` once on the bound current photo and reports **Reset requested** after SDK dispatch. User acceptance does not establish SDK completion readback, exhaustive Pet Eye reset scope or preservation alongside populated Healing, Dust and other edits. Those broader cases remain unverified.
- Every operation requires a selected still image in Develop, a fresh SDK snapshot and capability availability. Requests use the existing command queue with photo UUID, context/Develop counters, context timestamp, server epoch, semantic state revision, one-operation ownership, execution revalidation and duplicate rejection. Timed-out operations are not retried.
- Pupil Size, Darken, catchlights and individual correction selection/geometry/deletion remain in Lightroom. The optional `EnableRedEye` settings write is deferred.

Focused checks: `npm run test:red-eye` (requires the existing external `LRBRIDGE_LUA_TEST_RUNTIME`) and `npm run test:controller-red-eye` (isolated Chromium and mock HTTP service, no Lightroom connection).

Both explicit mode buttons and overall tool feedback have native user acceptance. Mode buttons remain momentary because the SDK cannot read which eye mode is active. No undocumented `RedEyeInfo` write or removal confirmation is implemented. Placing corrections and adjusting individual eyes remains in Lightroom.

The bounded `CaptureRedEye.lua` / `RedEyeDiagnostics.lua` diagnostic is retained as a development utility, without a normal File > Plug-in Extras registration. It saves one SDK snapshot to a uniquely named temporary file and reads eye-related Develop settings, selection getters, public SDK function names and candidate values/ranges without changing the photo or tool. Probe checks: `node tests/red-eye-diagnostics.js` with the same external Lua runtime.

The native check on Lightroom 15.4.1 found stored per-correction `pupilSize`, `pupilDarkenAmount` and `showPetEyeHighlight` fields in `RedEyeInfo`, but no selection identity. The Remove selection getters reject Red Eye context, and generic `getValue` calls returned nil for all tested candidates, including the actual field names. Generic range returns therefore do not establish either mode's slider ranges. Stored correction entries are not selected-correction readback or a new-correction-defaults interface. No safe selected-eye read/write route was established; sliders and Add Catchlight are stopped at this boundary, with no photo writes attempted. Detailed native evidence is retained in the ignored local handoff and the temporary capture.

Menu cleanup removes the six temporary Dust entries and the eye-capture entry while preserving LRBridge Help and Start LRBridge Polling. The diagnostic scripts remain in the plug-in directory for isolated development use; they are not loaded by normal startup. Shared Dust helper modules remain runtime dependencies, and the required native presets and [Healing backup](HEALING_CHECKPOINT.md) are unchanged. To clear the old menu, open File > Plug-in Manager, select LRBridge, expand Plug-in Author Tools and click Reload Plug-in once, then close the manager and reopen File > Plug-in Extras. No bridge restart or controller refresh is required for this menu-only cleanup.

Remaining work: Export is the next task. The optional `EnableRedEye` switch is deferred; selected-eye sliders/catchlights require new verified SDK targeting evidence before implementation. Broader reset-preservation validation remains outside the accepted four-button claim.
