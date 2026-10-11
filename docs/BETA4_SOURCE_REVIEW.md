# LRBridge 0.6.0-beta.4 source review

This branch is published for Claude's code inspection, not as an official release.
It is one review commit based on accepted commit
`57cab790e8d4b8797ca3598e8f46a5a517b1a51b`.

The selected source is the final `beta4-guarded-set-20261010T161853Z/development`
candidate, verified against its private Windows package and all 45 matching
Lightroom plug-in runtime files before publication. The copied functionality is
unchanged. Only this guide and the publication note in CODEX_HANDOFF were added.
The separate Companion module is not copied into the LRBridge repository.

## Review entry points

- [Guarded Set contract](GUARDED_SET.md): optional POST /set with an expected
  actual SDK baseline, execution-time owner checks, idempotent receipts and FIFO
  boundaries with Reset. Implementation: server/guarded-set*.js and
  lightroom/LRBridge.lrplugin/GuardedSet.lua; regression: tests/guarded-set.js/.lua.
- [Point Color/native QA scope](BETA4_PRIVATE_QA.md): eight authoritative swatches
  and picker presentation, preserving transient-selection and context handling.
  Review app/controller-point-color.js, controller.html, controller-masking.js,
  PointColor.lua and tests/point-color-swatches*.
- [Accepted correlated Reset](RESET_COMPLETION.md) and [Numeric Nudge](NUMERIC_NUDGE.md):
  retained beta.3 work, including the wrapped-command Nudge parser correction.
- [Public-release blockers](PUBLIC_RELEASE_BLOCKERS.md): security findings and
  six known historical beta.2 regression failures, kept separate from this task.

## Verification and limits

The final candidate passed ten focused Windows server/plugin/packaging checks
and four checks against its packaged runtime: guarded Set, Reset, Numeric Nudge
and Point Color. Unchanged Point Color desktop/touch browser evidence was reused.
The separately developed Companion candidate passed 534 focused tests and four
bundle smoke checks; those module sources/builds are outside this publication.

For a local source checkout, install the lockfile's dependencies, then run:

```text
node tests/guarded-set.js
node tests/reset-completion.js
node tests/numeric-nudge.js
node tests/point-color-swatches.js
```

These are offline SDK doubles and isolated HTTP tests. Do not infer native
Lightroom acceptance or run editing helpers without the user's permission.
Applied guarded receipts mean successful SDK invocation, not observed SDK
feedback. Native timing remains unverified, and SDK comparison is not a
documented atomic compare-and-set primitive. FIFO is bridge admission order;
debounced, unsubmitted fine intent can rebase after intervening coarse edits.

No credentials, private settings, logs, backup/checkpoint directories,
node_modules, EXEs or generated build outputs are included. The inherited
config/settings.txt contains only the already-public poll_interval_ms=100 default.
The build/ directory contains required source icon assets, not build output.
No source functionality, existing branch, running installation or active
Companion module was changed for publication. No release, tag or pull request
is part of this review branch.
