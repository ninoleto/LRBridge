# Changelog

## v0.1.0-one-way

Stable one-way Lightroom slider control.

Tagged version:

```text
v0.1.0-one-way
```

### Working

- Node.js HTTP bridge
- Lightroom Classic polling plugin
- Companion-friendly HTTP control
- `/status`
- `/sliders`
- `/groups`
- `/adjust`
- `/reset`
- `/reset-group`
- `/reset-all`
- command queue
- repeated adjust command coalescing
- configurable polling interval
- duplicate polling protection
- Lightroom panel reveal before slider movement
- Windows start script
- npm scripts:
  - `npm start`
  - `npm run smoke`
  - `npm test`

### Reliable use path

```text
Companion / HTTP client
        ↓
LRBridge
        ↓
Lightroom plugin polling
        ↓
LrDevelopController increment/reset
        ↓
Lightroom slider visibly moves
```

### Important decision

LRBridge is currently a one-way controller.

Use Lightroom itself as the visible source of truth.

Do not use controller feedback yet.

### Experimental / not trusted

- `/get`
- `/last-result`
- `/set`
- two-way feedback/readback
- absolute value setting

### Known amount behavior

```text
Exposure amount=1 ≈ 0.1 Exposure
Contrast amount=1 ≈ about 5 points
Highlights amount=1 ≈ about 5 points
Shadows amount=1 ≈ about 5 points
Whites amount=1 ≈ about 5 points
Blacks amount=1 ≈ about 5 points
```

### Current mapped sliders

```text
Exposure
Contrast
Highlights
Shadows
Whites
Blacks
Temperature
Tint
Texture
Clarity
Dehaze
Vibrance
Saturation
Sharpness
LuminanceNR
ColorNR
```

### Important mapping note

```text
LuminanceNR → LuminanceSmoothing
```

Do not change it back to:

```text
LuminanceNoiseReduction
```

### Smoke test

```powershell
npm test
```

Expected result:

```text
Smoke test passed.
```