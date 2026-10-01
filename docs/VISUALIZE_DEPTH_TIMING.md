# Visualize Depth timing and focused correction

October 1, 2026. Baseline: source `992a30b` (runtime matching the September 30
private candidate), Electron 43.1.1, Lightroom Classic 15.4.1 on Windows. Verified
source app/helper paths and one diagnostic SDK worker; the packaged EXE was not
running. The existing package remains unchanged.

**Manual acceptance:** the user reports that Visualize Depth now feels fast and
accepts its responsiveness for this release. Preserve the measured evidence and
the implementation; no further source capture or tuning is required. The next
private package still needs its normal Visualize Depth integration check.

## Actual Lightroom evidence

The user's finished baseline contains two On/Off pairs. The follow-up contains
two On/Off pairs driven through the actual Controller by automated browser pointer
clicks: first-use timing and a final warm-reader check after an unavailable-feedback
regression was corrected. Both use the same photo and diagnostic plug-in, with no photo/context
changes or HTTP/native/SDK errors. The plug-in only adds bounded timing around
the unchanged SDK operation. No Lightroom UI injection or screenshots were used.

All times below are milliseconds. SDK execution means the SDK call returned;
it does **not** measure when the rendered overlay finishes drawing.

| Stage | Baseline On 1 | Off 1 | On 2 | Off 2 | Corrected On (cold reader) | Corrected Off |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Pointer release → HTTP request | 3 | 3 | 3 | 3 | 2 | 0 |
| Admission: native queue/start dispatch | 1194 | 435 | 283 | 478 | 2 | 0 |
| Admission: helper execution, including startup if cold | 509 | 578 | 438 | 521 | 489 | 27 |
| Admission reply → SDK call | 112 | 127 | 28 | 61 | 81 | 319 |
| SDK call duration | 1.5 | 1.6 | 3.0 | 1.5 | 1.6 | 1.5 |
| SDK return → confirmed Controller display | 407 | 612 | 1600 | 797 | 480 | 142 |
| **Release → confirmed display** | **2228** | **1757** | **2356** | **1862** | **1056** | **491** |

The final-source warm-reader pair measured:

| Stage | On | Off |
| --- | ---: | ---: |
| Pointer release → HTTP request | 2 | 1 |
| Admission helper queue | 0 | 0 |
| Fresh admission helper read | 29 | 51 |
| Admission reply → SDK call | 65 | 102 |
| SDK call duration | 3.0 | 1.5 |
| SDK return → confirmed Controller display | 69 | 269 |
| **Release → confirmed display** | **168** | **425** |

The SDK stage includes normal polling, transport and current-photo/context
revalidation before the call. These are not all SDK execution costs. Confirmation
requests can overlap admission, so their queue waits must not be added a second
time. The browser displayed each corrected confirmed native result in 2–4 ms after
the helper response. Every toggle executed exactly once; each pair ended at confirmed Off.

The first corrected helper read includes process/PowerShell startup and first-use
costs: about 365 ms outside its measured read-function phases; discovery itself
took 73 ms cold. Subsequent targeted reads took 19–73 ms overall, with discovery
15–69 ms. Baseline admission discovery alone took 369–415 ms. Original native and
accessibility checkbox agreement remains required.

The first corrected click preceded the server trace sink's 500 ms arm-file cache.
Its HTTP finish record retains the actual arrival timestamp and its helper reply
retains enqueue/dispatch timestamps, so the timing chain is reconstructible.
Initial standalone enter/enqueue events are missing. Cross-process wall timestamps
differ by up to 1 ms here; sub-millisecond phase timings use Stopwatch. Preserve
that evidence limitation; do not silently fabricate missing events. The final
receiver waited for both observation sinks to acknowledge the recording window;
both final actions have complete arrival/enqueue/dispatch/response events.

## Demonstrated cause and correction

1. The admission read waited behind Profile/full native discovery in the shared
   action queue. Depth now has an independent **read-only** helper, following the
   existing independent Selected observer pattern. All native writes retain the
   original queue. Parent shutdown stops the depth helper; diagnostic read pauses
   still apply. No checkbox value is cached or assumed.
2. Even the previous `SkipTrackValues` optimization built full identity/geometry
   snapshots for every Lightroom window. Fresh enumeration now snapshots only
   candidate Lens Blur anchors, Visualize Depth buttons and their parents. The
   existing uniqueness, process, ancestry, visibility, enabled-state and fresh
   identity checks still apply. General native discovery is unchanged.
3. The Controller's full-state in-flight guard delayed targeted confirmation.
   A pending depth read can now run alongside that full read. Depth read ordering
   and an edit boundary prevent an older full response from undoing a newer depth
   confirmation. Other full-state fields still update; later external Lightroom
   changes remain visible. An older request cannot clear a newer operation.
   A fresh independent depth result can still confirm when general discovery is
   unavailable; the other failed controls remain unavailable. The regression for
   this partial-failure case also failed before its correction.

No HTTP route/parameters, SDK toggle, Lua execution, photo/context checks, timeout,
slider timing, or accepted Apply/Bokeh/Point Color behavior were changed. Requests
are still admissions, never success by themselves; unavailable/failed reads and
unconfirmed operations retain their existing failure paths. No automatic edit retry.

## Focused verification and remaining uncertainty

- `node tests/lens-blur-depth-latency.js`: production transport and Controller
  functions, delayed full reads, fresh confirmation, old-feedback rejection,
  external changes, old-photo feedback, admission failure, timeout and no retry.
- `powershell -NoProfile -ExecutionPolicy Bypass -File tests/lens-blur-depth-discovery.ps1`:
  production discovery functions with Win32 fixtures; no unrelated snapshots,
  fresh On/Off, native/accessibility disagreement, unavailable/reparented/wrong-owner
  controls, duplicate buttons/roots and unchanged general discovery.
- Existing targeted Lens Blur HTTP/proxy/context and feedback-ordering fixtures
  remain applicable and pass. Diagnostic observations were checked against the
  production SDK guards and helper behavior. These fixture results are simulated,
  distinct from the actual Lightroom timing table above.

The queue-blocking, unnecessary-snapshot and full-read confirmation regressions
fail on the preserved pre-change production code and pass with the correction.
Evidence, source hashes, frozen baseline/follow-up logs and recovery verification
are indexed locally by `local-checkpoints/visualize-depth-analysis-current.txt`.

This measured improvement is now also manually accepted within the tested scope,
not a claim of instant response. Remaining time includes cold helper startup, SDK polling/context work
and the existing Controller polling cadence when an initial read precedes SDK
execution. No poll interval was retuned. The small sample does not establish all
machine/photo workloads or overlay-paint latency. The source responsiveness check
is complete. Next verify Visualize Depth in the new private package alongside its
remaining integration checks; no repeat source capture is required.
