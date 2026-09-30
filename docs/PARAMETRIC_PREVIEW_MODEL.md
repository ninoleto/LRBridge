# Parametric Curve preview correction

October 1, 2026: implemented and compared against nine preserved Lightroom
references and six newly captured native cases. The new cases were not used to
fit the model. The user manually accepts the correction for this release after
their latest comparison looked closely matched, including changed split
positions. Preserve the implementation, references and regressions; no further
tuning or repeat capture unless a new problem appears. The approximation limits
below remain. Only preview mathematics changes. Slider input, feedback ownership,
photo/context checks, SDK commands and HTTP routes are intact.

## Established defect

The previous model moved four tonal-region centers with the split percentages,
then added empirically weighted offsets whose size did not depend on region width.
With Shadows/Darks/Lights/Highlights at `60/-35/-20/-10`, linear RGB and splits
`10/20/75`, successive model anchors were `12.7` and `7.12`. The reversal was
already present before interpolation. PCHIP faithfully preserved that wrong
reversal. The residual tables also warped their input coordinates when splits
changed without corresponding vertical scaling.

The complete old path was:

1. Natural cubic RGB point curve `R(x)`.
2. Shifted region centers, fixed weighted offsets, PCHIP and empirical residuals
   producing the parametric function `P(x)`.
3. Clipped addition `R(x) + P(x) - x`.
4. Regularized B-spline display fit, with endpoints forced to black and white.

The last step could also displace real RGB endpoints or smooth its intentional
turning points in this assumed combination. The new native references establish
a separate, larger defect: Lightroom's **Parametric tab displays `P(x)` alone**,
not a composition with RGB. Neutral parametric values remain diagonal with a
non-linear RGB curve; identical asymmetric parametric values produce identical
graphs before/after changing only RGB. The Point Curve tab independently retains
the RGB edits, including deliberate turns and lifted endpoints. The old combined
preview was therefore inappropriate for this tab regardless of its interpolation.
This finding concerns the displayed graph, not Lightroom's photographic pipeline.

Split units/order and feedback freshness already passed the earlier focused
investigation; their implementation is unchanged.

## Implemented construction

Adobe's [US8487931B2, Dynamic feedback and interaction for parametric curves](https://patents.google.com/patent/US8487931B2/en)
describes a slope-controlled cubic cascade and invertible split-coordinate
warps. This is a public mathematical basis, **not evidence that current Lightroom
uses precisely this equation, slider scale, pass count or RGB composition**.

On the unit interval, the building blocks are:

```text
F(x; a, b) = x ((1-x) (a + x (3-b-a)) + x²)
W(x; s)   = x (1-s) / (s + x (1-2s))
W⁻¹(x; s) = W(x; 1-s)
```

`F` fixes both endpoints and controls their derivatives with `a` and `b`. The
response uses two cubic passes. `W` maps the selected split to the midpoint;
applying its inverse after the adjustment restores the actual region width.
The middle split controls the broad Darks/Lights adjustment. The Shadow and
Highlight splits control corresponding lower/upper subregions in that warped
coordinate system. Unlike displaced fixed-offset anchors, this construction
scales the entire response with the available tonal region.

The candidate transforms graph coordinates and splits with sRGB decoding before
these operations, then encodes back to display coordinates. For a signed slider
amount `t` in `[-1, 1]`, the shared slope mapping is:

```text
t >= 0: exp(0.71 t)
t <  0: (1+t)^1.2
```

Shadows/Darks use the positive slider sign; Lights/Highlights use the opposite
sign for the upper-end derivative. These two constants apply to every region
and split position. There are no per-screenshot correction tables. One/two/three
passes, linear/1.8/2.2/sRGB coordinate spaces and linear/exponential rising-slope
maps were compared using only the six isolated-control references C–H. Two
passes, sRGB and the exponential rising map gave the selected calibration fit.
A/B/stress were excluded from coefficient fitting.

PCHIP now represents dense samples of the evaluated response; it does not create
the response from assumed anchors. Sampling includes the splits, with local
refinement where the represented curve diverges. There is no monotonic projection
or clipping to conceal wrong anchors. Neutral parametric adjustments display the
diagonal. The ordinary Point Curve spline is unchanged and retains its actual
RGB endpoints and deliberate downward sections. This removes the old regularized
display fit and the unsupported RGB addition, without changing any photo settings.

The initial candidate retained the additive combination pending these native
references. `tests/parametric-native-reference.js` fails against that candidate
and passes after removing the RGB contribution. The existing function signatures
and valid-RGB availability/context prerequisites remain for callers; the RGB
argument no longer contributes to the Parametric graph's coordinates. The entire
Point Curve implementation and the interaction/feedback portion of the module
remain byte-identical to the pre-investigation source.

## Evidence and limits

`tests/fixtures/parametric-lightroom-graphs.json` preserves the existing observed
Lightroom sample coordinates from `tests/tone-curve-splits.js`; their original
±2.5 output-unit tolerance is unchanged. They were read from earlier screenshots,
not generated from either model, and are approximate graph measurements rather
than SDK samples of a transfer function. Original image pixels were not recovered
in this investigation.

Maximum absolute error of the final displayed path, on the 0–100 output scale:

| Recorded case | Use | Previous | Candidate |
| --- | --- | ---: | ---: |
| A | Validation, mixed controls | 0.943 | 1.707 |
| B | Validation, mixed controls | 2.300 | 0.582 |
| C | Calibration, Lights +81 | 0.279 | 1.443 |
| D | Calibration, Lights +40 | 0.148 | 1.599 |
| E | Calibration, Lights -40 | 0.188 | 1.121 |
| F | Calibration, Darks +44 | 0.220 | 0.922 |
| G | Calibration, Shadows -49 | 0.308 | 0.702 |
| H | Calibration, Highlights -26 | 0.190 | 0.667 |
| Stress | Validation, combined extremes | 1.548 | 2.444 |

All nine remain within the original tolerance. The candidate does not improve
every old reference's error: the previous implementation contained fits to those
observations. The useful result is the replacement's general split geometry,
removal of the demonstrated false reversal, and agreement with the reserved
mixed-control samples without their fitted residual tables. Those nine references
alone were insufficient to establish narrow-split or non-linear RGB accuracy;
the separate new native cases below supply that evidence.

The false-reversal regression fails against the preserved old module and passes
with the candidate. Further mathematical checks cover extreme values, narrow
regions, RGB turning points/endpoints and SVG representation error. The actual
Controller was rendered at 1280 and 390 px with simulated feedback; no reversal,
overflow, runtime errors or photographic command requests occurred. Those are
automated rendering checks, not new native Lightroom comparisons.

## Completed matched native references

All six cases were completed on the same selected photo/context. The page was
prepared for a disposable photo/virtual copy; the evidence proves consistent photo
identity, not whether the selected item was a virtual copy. Each explicitly
requested case waited for fresh SDK values before accepting the user's graph
crop. All six image hashes, requested amounts/splits/RGB values, photo identities,
context counters and before/after Develop revisions match. No command failure,
cancelled case or context change occurred. No automatic Lightroom UI capture or
control was used. No additional live edits were sent during analysis.

| Case | Shadows/Darks/Lights/Highlights | Splits | RGB |
| --- | --- | --- | --- |
| Neutral RGB reference | 0/0/0/0 | 25/50/75 | Non-linear |
| Default | 60/-35/-20/-10 | 25/50/75 | Linear |
| Narrow, same adjustments | 60/-35/-20/-10 | 10/20/75 | Linear |
| Independent asymmetric | -40/25/45/-30 | 20/65/90 | Linear |
| Combined RGB | -40/25/45/-30 | 20/65/90 | Same non-linear curve |
| Intentional RGB turn | 10/-20/25/-15 | 30/55/80 | Turning curve, lifted endpoints |

These six cases were fixed before receiving their native graphs. Their measured
curves were compared with the **unchanged** slope model coefficients. The RGB
cases selected the correct displayed function, not a new empirical fit.

| New native case | Previous maximum error | Corrected maximum error | Corrected RMS error |
| --- | ---: | ---: | ---: |
| Neutral RGB | 17.97 | 0.39 | 0.20 |
| Default splits | 9.62 | 1.12 | 0.65 |
| Narrow splits | 8.18 | 0.89 | 0.48 |
| Asymmetric splits | 6.04 | 1.55 | 0.80 |
| Same asymmetric, non-linear RGB | 22.85 | 1.55 | 0.80 |
| Intentional RGB turn | 29.02 | 0.43 | 0.19 |

These numbers compare the final SVG paths with 205 measured columns per native
graph. Graph frames were identified in the supplied PNGs; the bright grey curve
was located independently of either formula and normalized to 0–100 axes. This
is a visual measurement, not an SDK read of the transfer function. The graphs
are about 210 pixels high, so one pixel is about 0.48 output units. Antialiasing,
frame selection and the remaining model approximation limit precision. The new
curves agree within the existing ±2.5-unit tolerance; the largest measured
difference is 1.55 units (about 3.3 pixels). Do not describe this as exact
pixel-for-pixel Lightroom equivalence across all possible settings.

`tests/fixtures/parametric-lightroom-native-20261001.json` retains every fifth
measured column plus the final one, image hashes and sanitized confirmed settings.
Full measurements and original crops are preserved privately. No value is
generated from the expected formula. The old fixed-offset reversal regression
and new native RGB-isolation regression both fail before their respective fixes.
Browser checks use the actual Controller with mock feedback, verify both tab
paths at 1280/390 px, and send no photographic commands. They are distinct from
the user's native collection.

The original capture is indexed by `local-checkpoints/parametric-preview-current.txt`;
analysis, recovery backup/readback, native before/after SVG/PNG, full measured
errors and before/after regression evidence by
`local-checkpoints/parametric-native-analysis-current.txt`. No repeat native
collection is needed for this accepted correction. User visual review is complete;
no application restart or plug-in reload is needed.

## Focused checks and tools

```powershell
node tests/parametric-preview.js
node tests/parametric-native-reference.js
node tests/tone-curve-splits.js
node tests/parametric-preview-browser.js
node tests/parametric-reference-collector.js
node scripts/compare-parametric-preview.js <preserved-before-module> <output-dir>
node scripts/compare-parametric-native.js <preserved-before-module> <native-capture-dir> <output-dir> [full-measurements-json]
```

The collector test uses simulated HTTP responses only. Its checks include explicit
arming, photo/context and freshness guards, coupled split order, one attempt per
edit, uncertain failures, read-only reacquisition after stale feedback, and saving
matched values with each image. The collector's scalar writes use the existing
public `/set` path and recheck context before dispatch; keep the disposable copy
selected throughout rather than relying on a new atomic binding that this public
route does not provide.

Run `node scripts/capture-parametric-reference.js <private-evidence-dir>` only
when a fresh receiver is needed. Preserve an existing receiver and its recordings
first. The process prints its local link and writes `native-current.json` under
that evidence directory. The current six-case recording is complete; do not
restart it as part of ordinary visual review. A browser refresh loads the new
preview; no server/Lua changes, commit, package or publication accompany this fix.
