# LRBridge Companion Setup

This document contains ready-to-use Bitfocus Companion actions for LRBridge.

LRBridge is currently used as one-way Lightroom control:

```text
Companion button / encoder
        ↓
HTTP request
        ↓
LRBridge
        ↓
Lightroom slider moves
```

Do not use feedback/readback for now. Lightroom itself is the visible source of truth.

## Base URL

If LRBridge runs on ANTEC:

```text
http://192.168.1.11:17891
```

If testing locally on the Windows PC:

```text
http://127.0.0.1:17891
```

## Companion module

Use:

```text
Generic HTTP Requests
```

## Important: amount means Lightroom increments

In LRBridge:

```text
amount = number of Lightroom increment steps
```

It does not always mean exact slider points.

Known behavior:

```text
Exposure amount=1 ≈ 0.1 Exposure
Contrast amount=1 ≈ 5 points
Highlights amount=1 ≈ 5 points
Shadows amount=1 ≈ 5 points
Whites amount=1 ≈ 5 points
Blacks amount=1 ≈ 5 points
```

So for normal encoder movement:

```text
Exposure: use amount=1
Most other sliders: use amount=1
```

For faster movement:

```text
amount=2
amount=3
```

Avoid large values unless you want big jumps.

## Basic test actions

### Check bridge status

```text
/status
```

### List supported sliders

```text
/sliders
```

## Exposure

Exposure moves in Lightroom 0.1 steps.

### Exposure up small

```text
/adjust?slider=Exposure&amount=1
```

### Exposure down small

```text
/adjust?slider=Exposure&amount=-1
```

### Exposure up larger

```text
/adjust?slider=Exposure&amount=10
```

### Exposure down larger

```text
/adjust?slider=Exposure&amount=-10
```

### Reset Exposure

```text
/reset?slider=Exposure
```

## Basic panel sliders

These usually move in larger Lightroom increments, around 5 slider points per amount step.

### Contrast

```text
/adjust?slider=Contrast&amount=1
/adjust?slider=Contrast&amount=-1
/reset?slider=Contrast
```

### Highlights

```text
/adjust?slider=Highlights&amount=1
/adjust?slider=Highlights&amount=-1
/reset?slider=Highlights
```

### Shadows

```text
/adjust?slider=Shadows&amount=1
/adjust?slider=Shadows&amount=-1
/reset?slider=Shadows
```

### Whites

```text
/adjust?slider=Whites&amount=1
/adjust?slider=Whites&amount=-1
/reset?slider=Whites
```

### Blacks

```text
/adjust?slider=Blacks&amount=1
/adjust?slider=Blacks&amount=-1
/reset?slider=Blacks
```

## Color

### Temperature

```text
/adjust?slider=Temperature&amount=1
/adjust?slider=Temperature&amount=-1
/reset?slider=Temperature
```

### Tint

```text
/adjust?slider=Tint&amount=1
/adjust?slider=Tint&amount=-1
/reset?slider=Tint
```

## Presence

### Texture

```text
/adjust?slider=Texture&amount=1
/adjust?slider=Texture&amount=-1
/reset?slider=Texture
```

### Clarity

```text
/adjust?slider=Clarity&amount=1
/adjust?slider=Clarity&amount=-1
/reset?slider=Clarity
```

### Dehaze

```text
/adjust?slider=Dehaze&amount=1
/adjust?slider=Dehaze&amount=-1
/reset?slider=Dehaze
```

### Vibrance

```text
/adjust?slider=Vibrance&amount=1
/adjust?slider=Vibrance&amount=-1
/reset?slider=Vibrance
```

### Saturation

```text
/adjust?slider=Saturation&amount=1
/adjust?slider=Saturation&amount=-1
/reset?slider=Saturation
```

## Detail

### Sharpness

Lightroom location:

```text
Develop → Detail → Sharpening → Amount
```

```text
/adjust?slider=Sharpness&amount=1
/adjust?slider=Sharpness&amount=-1
/reset?slider=Sharpness
```

### Luminance Noise Reduction

Lightroom location:

```text
Develop → Detail → Noise Reduction → Luminance
```

```text
/adjust?slider=LuminanceNR&amount=1
/adjust?slider=LuminanceNR&amount=-1
/reset?slider=LuminanceNR
```

### Color Noise Reduction

Lightroom location:

```text
Develop → Detail → Noise Reduction → Color
```

```text
/adjust?slider=ColorNR&amount=1
/adjust?slider=ColorNR&amount=-1
/reset?slider=ColorNR
```

## Suggested encoder setup

For each encoder:

```text
Turn right:
/adjust?slider=Exposure&amount=1

Turn left:
/adjust?slider=Exposure&amount=-1

Press:
/reset?slider=Exposure
```

For Exposure, use:

```text
amount=1
```

For most other sliders, start with:

```text
amount=1
```

For faster movement, try:

```text
amount=2
amount=3
```

## Do not use for now

Do not use these for Companion feedback yet:

```text
/get
/last-result
```

Do not use this for normal control:

```text
/set
```

Use only:

```text
/adjust
/reset
/status
/sliders
```