# LRBridge Project State

This file is the current handoff/state document for humans and AI assistants continuing LRBridge development.

## Current stable direction

LRBridge is currently a **one-way Lightroom controller**.

Working reliable path:

```text
Companion / HTTP request
        ↓
LRBridge Node server
        ↓
Lightroom plugin polling
        ↓
LrDevelopController increment/reset
        ↓
Lightroom slider visibly moves
```

The user sees the real slider value directly inside Lightroom Classic.

## Do not chase feedback right now

The following are experimental and should not be used for normal Companion control:

```text
/get
/last-result
/set
```

Reason:

- Lightroom slider movement via `LrDevelopController.increment()` works.
- Lightroom reset via `LrDevelopController.resetToDefault()` works.
- Direct readback via `photo:getDevelopSettings()` was inconsistent during testing.
- `LrDevelopController.setValue()` was unreliable for normal slider control.

Current decision:

```text
Real Lightroom readback or no feedback.
No fake/controller-side state.
For now: no feedback.
```

Do not implement fake state unless the user explicitly changes this decision.

## Reliable endpoints

Use these:

```text
/status
/sliders
/groups
/adjust
/reset
/reset-group
/reset-all
```

Do not use these for production Companion buttons:

```text
/get
/last-result
/set
```

## Working examples

### Adjust Exposure

```text
/adjust?slider=Exposure&amount=1
```

Exposure amount behavior:

```text
amount=1 ≈ 0.1 Exposure
amount=10 ≈ 1.0 Exposure
```

### Reset Exposure

```text
/reset?slider=Exposure
```

### Reset Basic group

```text
/reset-group?group=Basic
```

### Reset all mapped sliders

```text
/reset-all
```

## Amount meaning

In LRBridge:

```text
amount = number of Lightroom increment steps
```

It does not always mean exact slider points.

Observed behavior:

```text
Exposure amount=1 ≈ 0.1 Exposure
Contrast amount=1 ≈ about 5 points
Highlights amount=1 ≈ about 5 points
Shadows amount=1 ≈ about 5 points
Whites amount=1 ≈ about 5 points
Blacks amount=1 ≈ about 5 points
```

For normal encoders:

```text
Exposure: amount=1
Most other sliders: amount=1
Fast movement: amount=2 or amount=3
```

Avoid large values unless big jumps are intended.

## Current slider mappings

The Lightroom driver is:

```text
lightroom/LRBridge.lrplugin/Driver.lua
```

Current mappings:

```text
Exposure    → Exposure
Contrast    → Contrast
Highlights  → Highlights
Shadows     → Shadows
Whites      → Whites
Blacks      → Blacks

Temperature → Temperature
Tint        → Tint

Texture     → Texture
Clarity     → Clarity
Dehaze      → Dehaze

Vibrance    → Vibrance
Saturation  → Saturation

Sharpness   → Sharpness
LuminanceNR → LuminanceSmoothing
ColorNR     → ColorNoiseReduction
```

Important:

```text
LuminanceNR must use LuminanceSmoothing.
Do not change it back to LuminanceNoiseReduction.
```

## Slider groups

Defined in:

```text
config/sliders.json
```

Current groups:

```text
Basic
Color
Presence
Detail
```

Group reset endpoint:

```text
/reset-group?group=Basic
/reset-group?group=Color
/reset-group?group=Presence
/reset-group?group=Detail
```

## Lightroom panels

LRBridge calls:

```text
LrDevelopController.revealPanel(...)
```

before moving or resetting a slider.

Detail sliders are here:

```text
Sharpness   → Develop → Detail → Sharpening → Amount
LuminanceNR → Develop → Detail → Noise Reduction → Luminance
ColorNR     → Develop → Detail → Noise Reduction → Color
```

## Starting LRBridge

Recommended:

```powershell
npm start
```

Alternative:

```powershell
node bridge.js
```

Windows batch file:

```powershell
.\start-bridge.bat
```

## Smoke test

With LRBridge running:

```powershell
npm run smoke
```

Expected result:

```text
Smoke test passed.
```

## Polling

Lightroom polling is started manually:

```text
Library → Plug-in Extras → Start LRBridge Polling
```

Duplicate polling protection exists.

If polling is already running, Lightroom should show:

```text
Polling is already running.
```

## Companion setup

Main guide:

```text
COMPANION.md
```

Recommended Companion actions:

```text
/adjust?slider=Exposure&amount=1
/adjust?slider=Exposure&amount=-1
/reset?slider=Exposure
/reset-group?group=Basic
/reset-all
```

Base URL when LRBridge runs on ANTEC:

```text
http://192.168.1.11:17891
```

## Testing rule

For normal development, test visually in Lightroom.

Recommended visual tests:

```powershell
curl.exe "http://localhost:17891/adjust?slider=Exposure&amount=10"
curl.exe "http://localhost:17891/reset?slider=Exposure"
curl.exe "http://localhost:17891/reset-group?group=Basic"
curl.exe "http://localhost:17891/reset-all"
npm run smoke
```

Do not use `/get` as proof that slider movement works.

## Development rule

When a Lightroom slider name or mapping is suspicious:

```text
Check Lightroom SDK documentation first.
Then change files.
Then test visually.
Then commit.
```

No guessing mappings.

## Git workflow

After a working change:

```powershell
git add .
git commit -m "Short description"
git push
```

Keep commits small and stable.

## Current priority

Next useful work should focus on:

```text
1. Companion-friendly actions/layout
2. More reliable one-way slider control
3. Better docs
4. Later: native Companion module
```

Not current priority:

```text
1. Feedback/readback
2. Absolute /set values
3. Fake controller-side state
```