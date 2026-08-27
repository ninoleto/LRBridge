# LRBridge Codex Handoff

## Accepted checkpoint

- Branch: `feature/v0.6-more-sdk-and-web-controller`.
- Accepted production checkpoint: `d1e803318672fcb1901105919c8e2fe6e22ee1ee` (`Point Curve polish and explicit add mode`).
- Point Curve behavior is accepted through that commit. Git history, current production source, and current tests override stale or conflicting handoff text.

## Accepted Point Curve behavior

- Composite/RGB, Red, Green, and Blue use authoritative Lightroom SDK feedback from their four PV2012 curve fields. State remains bound to the selected-photo UUID, context counter, Develop revision, and Point Curve revision.
- The graph renders Adobe's raw natural-cubic spline behavior from authoritative coordinates. It visually clips the spline to the graph without flattening or replacing Adobe's mathematics.
- RGB includes authoritative Refine Saturation value/range feedback and Lightroom-tracked slider, editor, and reset behavior.
- Linear, Medium Contrast, and Strong Contrast presets are supported, while the Lightroom curve name remains derived authoritative feedback.
- Interior-point selection and deletion are supported. Empty graph space is inert until the explicit one-shot Add Point mode is armed; an accepted insertion can continue as the same stable drag gesture.
- Mouse and touchscreen behavior is accepted, including tap selection, intentional-movement drag admission, enlarged touch targets, synchronous local gesture preview, and authoritative final settlement.
- Gesture end/cancel recovery, navigation cancellation, focus/visibility/reconnect refresh, command-queue validation, and stale feedback/response rejection are established. Browser previews never replace authoritative Lightroom state.

## Local preservation state

- `config/settings.txt` has an intentional local modification that must remain unstaged and preserved.
- `CODEX_HANDOFF.local.md` is intentionally ignored and contains verbose historical/diagnostic evidence. Read it only in targeted sections when needed, and do not modify it casually.
- Preserve `stash@{0}` unchanged. Its current object is `76bd3118f786b886a30dd81ce3b591f4e14f49fe`, and it contains only the protected cheat-sheet work.
- Preserve both protected cheat sheets unless explicitly authorized:
  - `app/companion-cheatsheet.html` (current SHA-256 `FFE9E61A3AB6655F53762A13D07EEC0E4EA1C67FC56A22C60CD44F4866671BFC`)
  - `docs/COMPANION_HTTP_CHEATSHEET.md` (current SHA-256 `C3B4019EBC588EC4D121252D3266A2B57CC110CB5EDD118ECA314B708CE82069`)

## Verification status

- The full `npm test` command has an established, base-reproduced protected-document mismatch in `test:contract`: `Generated Companion document is missing slider LensBlurAmount`.
- This mismatch is not a Point Curve regression and must not be repaired by changing either protected cheat sheet without authorization. The remaining suites pass when run separately.
- Use the focused scripts in `package.json` first (notably `npm run test:point-curve` for Point Curve); reserve the full suite for an appropriate checkpoint.

## Next authorized scope

1. Create one unified `TONE CURVE` section.
2. Add Point Curve and Parametric Curve tabs matching the Color Mixer tab design.
3. Add an authoritative Parametric Curve graph.
4. Order Parametric controls as: graph, three coupled split sliders, divider, then Shadows, Darks, Lights, and Highlights sliders.
5. Perform combined navigation, reset, mouse, touchscreen, and regression testing.
6. Create the final Tone Curve checkpoint after manual acceptance and authorization.
7. Begin HDR only after Tone Curve is accepted.

Do not expand the next scope into HDR before Tone Curve acceptance.

## Fresh-session startup

1. Read this file, then verify branch, `HEAD`, status/index, upstream, and ahead/behind counts; report material discrepancies before editing.
2. Confirm the intentional `config/settings.txt` change, ignored local handoff, protected cheat-sheet hashes, and unchanged `stash@{0}`.
3. Inspect current Git history, production source, and focused tests for the requested scope. Treat them as authoritative over stale handoff statements.
4. Read only the relevant local-handoff section if deeper diagnostic evidence is required.
5. Preserve all existing changes, run focused tests first, and obtain manual Lightroom/UI acceptance before any checkpoint request.
