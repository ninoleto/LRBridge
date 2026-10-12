> Historical beta.4 development record. The user accepted the later beta.4 /
> beta4.10 / Companion beta4.13 combination as RC1 on 2026-10-12. See
> [current RC1 notes](RELEASE_NOTES_0.6.0-rc.1.md); pending statements below
> describe the earlier candidate, not outstanding RC1 feature acceptance.

# 0.6.0-beta.4 private Point Color and guarded fine-button candidate

This is isolated development, not a public release or native-accepted checkpoint.
Public beta.3 is skipped. The source was copied from the accepted beta.3 worktree,
verified against the native-tested Numeric Nudge parser package. No experimental
Fast Fine/TCP code is included.

The shared global/mask Point Color interface has eight numbered positions. SDK
state determines the selected highlight and available positions. Temporary index
zero retains previous owned values and disables editing until selection settles.
Admission does not confirm selection. Context invalidation clears pending work;
missing samples cancel it; absent confirmation has a bounded timeout.

The picker has a teal background, white text and an inline pipette, keyboard focus
styling and a 44-pixel target. Its existing action and availability are preserved.
The teal presentation does not claim authoritative active-tool feedback.

Existing Point Color values/ranges, Color/HSL views, Numeric Nudge, native Adjust,
legacy Reset and identified correlated Reset remain in place.

## Optional guarded Set and isolated Companion candidate

The authorized optional POST `/set` checks the actual SDK baseline and native
photo ownership after Driver preparation. It has identified, idempotent receipts
and preserves FIFO boundaries with both Reset forms. Legacy GET Set/Adjust/Reset
remain unchanged. See [the request, result and ordering contract](GUARDED_SET.md).

The isolated advanced Companion copy includes one configurable fine action and
six down-only ±1 presets for Contrast, Clarity and Vibrance. Presses accumulate
into one absolute guarded batch, using existing feedback acquisition. Ordinary
Adjust-capable rotaries use immediate native `/adjust`; advanced SDK adapters
retain their absolute workflows. Fine feedback/receipts never block native
dispatch. These changes have automated verification only, not native acceptance.

## Native QA — requires explicit authorization

1. Keep the previous EXE/plug-in pair available. With permission, switch to this
   matching private pair and reload the Lightroom plug-in once.
2. On a disposable Develop photo with three samples, verify buttons 1–8 are
   visible, 4–8 disabled, and the actual selected sample highlighted.
3. Select 1, 3, then 2. Verify selection, values and ranges agree with Lightroom
   after feedback. HTTP admission must not highlight the requested target.
4. Change photos, including a photo without samples. Verify old selection and
   values do not leak. Add samples up to eight in Lightroom and verify selection.
5. Check picker styling, keyboard focus and touch target. Click once to verify
   the original action. Check Point Color ranges and the HSL/Color views.
6. With separate permission to load the isolated Companion QA build, read a fresh
   Contrast baseline. Press fine +1 exactly once; compare the SDK feedback and
   Lightroom display. Repeat −1, then Clarity and Vibrance. Stop on any mismatch.
7. Verify eight rapid presses produce +8 (subject to bounds), reversal at bounds,
   coarse +5 followed by fine +1, and admitted fine +1 followed by coarse +5.
   Debounced, unsubmitted fine input may rebase after intervening coarse movement.
8. Measure ordinary Adjust + confirmation and identified Reset with zero/eight
   fine presses. Compare with the historical Nudge baselines (353/2022 ms Adjust;
   200/2118 ms Reset). Software timing tests do not predict native latency.
9. Verify manual edits, Reset followed immediately by fine input, and photo
   changes during pending work. Stale/uncertain results must not overwrite a new
   owner or replay. Verify native Exposure, Clarity and Vibrance Reset followed
   immediately by encoder input, as required by the accepted Companion checkpoint.
10. Confirm existing Point Color swatches, Color Grading and other advanced
    controls remain available. Restore the initial disposable-photo values on
    successful completion; stop immediately on unexpected behavior.

No editing commands, installation, plug-in reload or service restart occurred
during preparation. See [separate public-release blockers](PUBLIC_RELEASE_BLOCKERS.md).
