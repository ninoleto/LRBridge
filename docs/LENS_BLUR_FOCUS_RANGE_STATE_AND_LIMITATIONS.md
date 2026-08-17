# Lens Blur Focus Range state and limitations

This document records the runtime evidence, reconciliation rules, and maintenance constraints for LRBridge's Lens Blur Focus Range implementation. It is intended for future programmers, fork maintainers, and AI coding agents.

## 1. Environment and scope

The behavior described here was confirmed on Windows with Lightroom Classic 15.3. Lens Blur Focus Range is implemented by Lightroom using custom native controls rather than standard SDK-exposed controls. These limitations are version-specific observations and may change in a future Lightroom release; any different behavior must be independently verified before production code is changed.

## 2. Lightroom state limitation

Lightroom does not expose a direct, reliable `SubjectActive` boolean. The raw develop setting `FocalRangeSource=1` is sticky: it can remain `1` after a manual Focus Range adjustment has visibly deactivated Subject Focus in Lightroom. Raw source `1` alone must therefore never be treated as proof that Subject Focus is currently active.

The Point / Area armed state is independent. `selectedTool === "focal_range"` is authoritative for whether Point / Area is armed; `selectedTool === "loupe"` means it is not armed.

## 3. Subject presentation reconciliation

The Web Controller uses a derived Subject presentation state while preserving Lightroom's raw `focalRangeSource` value unchanged.

- A confirmed Subject action records the complete four-value Focus Range as the current Subject signature.
- A user-authored manual Focus Range edit immediately presents Manual while preserving the last Subject signature.
- Repeated polling with raw source `1` does not reactivate Subject.
- While Manual is presented, Subject may reactivate externally when either:
  - a fresh raw-source transition from `2` to `1` occurs; or
  - the complete authoritative Focus Range returns exactly to the stored Subject signature.
- External reactivation requires three stable, fresh authoritative revisions.
- Repeated rendering of the same revision does not count toward that threshold.
- A pending, confirming, rejected, or rolling-back manual Focus Range transaction blocks external reactivation.
- When the complete authoritative range moves away from the confirmed Subject signature, presentation returns to Manual immediately.
- Existing photo/develop-context change handling resets the stored presentation provenance so it does not leak between photos.

This model is a validated inference from authoritative Lightroom values, revisions, transaction state, and commit IDs. It is not fake feedback, optimistic button state, or icon-pixel detection.

## 4. SDK investigation results

Two SDK paths were investigated and rejected for production use on Lightroom Classic 15.3:

- `LrDevelopController.selectTool("focal_range")` is rejected by Lightroom.
- From a naturally established Manual state with source `2`, `LrDevelopController.setValue("FocalRangeSource", 1)` returned success and triggered one adjustment observer callback, but caused no authoritative or visible state change. Source remained `2`, the selected tool remained `loupe`, and the complete Focus Range remained unchanged.

An adjustment-change observer is only a trigger to reread authoritative state. Its callback is not proof that Lightroom accepted or performed a state transition. Neither SDK route may be connected to production unless a future Lightroom version is independently shown to behave differently.

## 5. Native action implementation

Subject and Point / Area currently use a bounded, target-local native message path. The native target is structurally discovered and revalidated, and every message uses `SendMessageTimeout` so Lightroom cannot block the HTTP request indefinitely.

Do not replace authoritative state with UI-pixel inspection. Do not add native painting, sleeps, or blocking native work to `/lens-blur/result`. Do not add global cursor movement, `SendInput`, `SetCursorPos`, keyboard injection, or image-canvas synthesis without an explicit future product decision.

## 6. Known Point / Area limitation

The following sequence was verified:

1. Point / Area activates correctly.
2. It deactivates correctly before an area is drawn.
3. Drawing an area changes the Focus Range source to Manual and keeps the tool armed.
4. Exiting afterward authoritatively changes `selectedTool` to `loupe`.
5. The Web Controller correctly becomes inactive.
6. Lightroom may leave its own Point / Area icon visually painted active until the physical mouse hovers over it.

The last item is a Lightroom custom-control repaint defect, not incorrect Web Controller semantic state. Previous experiments with PostMessage ordering, invalidation, redraw, fixed delays, post-confirmation repaint, and synchronous repaint were unreliable. Do not repeat those approaches blindly.

## 7. Verified manual workflows

- Web Subject -> manual Web Focus Range edit -> Lightroom and the Web Controller both show Manual.
- Web Subject -> manual Web Focus Range edit -> Subject clicked directly in Lightroom -> the Web Controller returns to Subject.
- Point / Area on/off without drawing synchronizes correctly.
- Point / Area after drawing exits semantically, subject to the documented Lightroom-only stale-paint limitation.

## 8. Future maintenance guidance

- Preserve independent Subject-source presentation and Point / Area armed state.
- Preserve revision, transaction, and Focus Range commit-ID protection.
- Do not weaken confirmation logic merely to make the UI appear faster.
- Before claiming wider compatibility, test photo changes, browser refreshes, application restarts, Undo/Redo, photos without detectable subjects, Windows display scaling, other Lightroom versions, and localized Lightroom installations.
- Do not copy MIDI2LR GPL source.
