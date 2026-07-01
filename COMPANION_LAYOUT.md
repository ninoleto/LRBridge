# Companion Layout Plan

This file documents a recommended Bitfocus Companion layout for controlling Lightroom Classic through LRBridge.

Current control mode:

```text
One-way control only.
Lightroom visible sliders are the source of truth.
No fake controller-side feedback.
```

## Base URL

When LRBridge runs on ANTEC:

```text
http://192.168.1.11:17891
```

Local test URL on the Lightroom PC:

```text
http://127.0.0.1:17891
```

Useful browser check:

```text
http://192.168.1.11:17891/help
```

## Companion module

Use:

```text
Generic HTTP Requests
```

Recommended action type:

```text
GET request
```

Only use these endpoints for normal layout buttons:

```text
/adjust
/reset
/reset-group
/reset-all
```

Do not use these for normal Companion control:

```text
/get
/last-result
/set
```

## Encoder behavior

Recommended encoder setup:

```text
Clockwise turn:
GET /adjust?slider=Exposure&amount=1

Counter-clockwise turn:
GET /adjust?slider=Exposure&amount=-1

Encoder press:
GET /reset?slider=Exposure
```

Important:

```text
amount = number of Lightroom increment steps
```

Recommended safe amounts:

```text
Normal: amount=1
Fast:   amount=2 or amount=3
```

Avoid large amounts for normal encoder use.

## Page 1 — Basic

Recommended for main Lightroom correction work.

### Encoders

```text
Encoder 1: Exposure
CW:      /adjust?slider=Exposure&amount=1
CCW:     /adjust?slider=Exposure&amount=-1
Press:   /reset?slider=Exposure

Encoder 2: Contrast
CW:      /adjust?slider=Contrast&amount=1
CCW:     /adjust?slider=Contrast&amount=-1
Press:   /reset?slider=Contrast

Encoder 3: Highlights
CW:      /adjust?slider=Highlights&amount=1
CCW:     /adjust?slider=Highlights&amount=-1
Press:   /reset?slider=Highlights

Encoder 4: Shadows
CW:      /adjust?slider=Shadows&amount=1
CCW:     /adjust?slider=Shadows&amount=-1
Press:   /reset?slider=Shadows

Encoder 5: Whites
CW:      /adjust?slider=Whites&amount=1
CCW:     /adjust?slider=Whites&amount=-1
Press:   /reset?slider=Whites

Encoder 6: Blacks
CW:      /adjust?slider=Blacks&amount=1
CCW:     /adjust?slider=Blacks&amount=-1
Press:   /reset?slider=Blacks
```

### Buttons

```text
Reset Basic:
GET /reset-group?group=Basic

Reset All:
GET /reset-all

Open Help:
GET /help
```

## Page 2 — Color

### Encoders

```text
Encoder 1: Temperature
CW:      /adjust?slider=Temperature&amount=1
CCW:     /adjust?slider=Temperature&amount=-1
Press:   /reset?slider=Temperature

Encoder 2: Tint
CW:      /adjust?slider=Tint&amount=1
CCW:     /adjust?slider=Tint&amount=-1
Press:   /reset?slider=Tint

Encoder 3: Vibrance
CW:      /adjust?slider=Vibrance&amount=1
CCW:     /adjust?slider=Vibrance&amount=-1
Press:   /reset?slider=Vibrance

Encoder 4: Saturation
CW:      /adjust?slider=Saturation&amount=1
CCW:     /adjust?slider=Saturation&amount=-1
Press:   /reset?slider=Saturation
```

### Buttons

```text
Reset Color:
GET /reset-group?group=Color

Reset Presence:
GET /reset-group?group=Presence

Reset All:
GET /reset-all
```

## Page 3 — Presence

### Encoders

```text
Encoder 1: Texture
CW:      /adjust?slider=Texture&amount=1
CCW:     /adjust?slider=Texture&amount=-1
Press:   /reset?slider=Texture

Encoder 2: Clarity
CW:      /adjust?slider=Clarity&amount=1
CCW:     /adjust?slider=Clarity&amount=-1
Press:   /reset?slider=Clarity

Encoder 3: Dehaze
CW:      /adjust?slider=Dehaze&amount=1
CCW:     /adjust?slider=Dehaze&amount=-1
Press:   /reset?slider=Dehaze

Encoder 4: Vibrance
CW:      /adjust?slider=Vibrance&amount=1
CCW:     /adjust?slider=Vibrance&amount=-1
Press:   /reset?slider=Vibrance

Encoder 5: Saturation
CW:      /adjust?slider=Saturation&amount=1
CCW:     /adjust?slider=Saturation&amount=-1
Press:   /reset?slider=Saturation
```

### Buttons

```text
Reset Presence:
GET /reset-group?group=Presence

Reset All:
GET /reset-all
```

## Page 4 — Detail

### Encoders

```text
Encoder 1: Sharpness
CW:      /adjust?slider=Sharpness&amount=1
CCW:     /adjust?slider=Sharpness&amount=-1
Press:   /reset?slider=Sharpness

Encoder 2: Luminance Noise Reduction
CW:      /adjust?slider=LuminanceNR&amount=1
CCW:     /adjust?slider=LuminanceNR&amount=-1
Press:   /reset?slider=LuminanceNR

Encoder 3: Color Noise Reduction
CW:      /adjust?slider=ColorNR&amount=1
CCW:     /adjust?slider=ColorNR&amount=-1
Press:   /reset?slider=ColorNR
```

### Buttons

```text
Reset Detail:
GET /reset-group?group=Detail

Reset All:
GET /reset-all
```

## Suggested button labels

Short labels for small screens:

```text
EXP
CON
HI
SH
WH
BLK

TEMP
TINT
TEX
CLA
DEH
VIB
SAT

SHARP
LUM NR
COL NR

RST BASIC
RST COLOR
RST PRES
RST DETAIL
RST ALL
HELP
```

## Suggested encoder labels

```text
Exposure
Contrast
Highlights
Shadows
Whites
Blacks
Temp
Tint
Texture
Clarity
Dehaze
Vibrance
Saturation
Sharpness
Lum NR
Color NR
```

## Loupedeck / Razer Stream Controller notes

For encoder pages:

```text
Turn clockwise     = positive amount
Turn counterclockwise = negative amount
Press encoder      = reset current slider
```

For touch buttons:

```text
Use reset buttons, page navigation, and help/status checks.
```

For vertical strips:

```text
Use strip sections as labels only if possible.
Do not display fake values.
Acceptable strip text examples:
- Exposure
- Contrast
- Basic
- Detail
- Reset
```

Avoid fake value display such as:

```text
Exposure +0.7
Contrast -10
```

unless LRBridge later gets real Lightroom readback.

## Safe testing checklist

Before using in real editing:

```powershell
npm test
```

Then test visually in Lightroom:

```powershell
curl.exe "http://localhost:17891/adjust?slider=Exposure&amount=1"
curl.exe "http://localhost:17891/reset?slider=Exposure"
curl.exe "http://localhost:17891/reset-group?group=Basic"
```

Expected result:

```text
Lightroom sliders visibly move or reset.
```

## Future native Companion module notes

A future native Companion module should expose actions like:

```text
Adjust slider
Reset slider
Reset group
Reset all
Open/help/status check
```

The module should not expose fake feedback variables until real Lightroom readback is reliable.

Possible future action fields:

```text
slider: Exposure / Contrast / Highlights / ...
amount: -3 to +3
group: Basic / Color / Presence / Detail
```

Possible future presets:

```text
Exposure encoder
Contrast encoder
Basic reset button
Detail reset button
Reset all button
```