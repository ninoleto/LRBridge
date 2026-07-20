# LRBridge Companion HTTP Cheat Sheet

Copy/paste command sheet for Bitfocus Companion Generic HTTP Requests, browsers, curl, Stream Deck tools, scripts, or any other HTTP client.

This file is generated from:

```text
config/sliders.json
server/commands.js
```

Use this as the practical button-building sheet.

---

## Base URL

For LRBridge running on the same PC:

```text
http://127.0.0.1:17891
```

For LRBridge running on another PC:

```text
http://LRBRIDGE_PC_IP:17891
```

Example:

```text
http://192.168.1.11:17891
```

In Companion Generic HTTP Requests:

```text
Base URL: http://LRBRIDGE_PC_IP:17891
Path: /adjust?slider=Exposure&amount=1
Method: GET
```

`127.0.0.1` is valid only when Companion and LRBridge run on the same computer. If Companion runs on another computer, use the LRBridge computer's trusted LAN address or Tailscale address. Use a stable DHCP reservation or static address for the LRBridge computer so the Companion connection remains valid.

> **Security warning:** LRBridge has no authentication or authorization. Configuring a remote address makes the API reachable to every other device that can access that address and port. Treat it as trusted-network-only, scope Windows Firewall access to the Companion computer where practical, and permit only the Private profile. With Tailscale, use restrictive ACLs or grants and do not use Funnel. Never publicly forward ports 17890, 17891, or 17892 through a router, reverse proxy, or cloud tunnel.

---

## Important notes

- Use HTTP GET.
- Use only the path part in Companion if the base URL is already configured.
- `amount=1` means one LRBridge/Lightroom adjustment step.
- `amount=-1` means one step down.
- `amount=5` and `amount=-5` are faster jumps.
- Use `/reset?slider=SLIDER_ID` to reset one slider.
- Use `/reset-group?group=GROUP_NAME` to reset a group.
- Use `/reset-all` carefully.
- `/get`, `/last-result`, and `/set` are experimental and should not be used for normal Companion feedback.

---

## Common quick buttons

| Button | Companion path | Full local URL |
|---|---|---|
| Exposure +1 | `/adjust?slider=Exposure&amount=1` | `http://127.0.0.1:17891/adjust?slider=Exposure&amount=1` |
| Exposure -1 | `/adjust?slider=Exposure&amount=-1` | `http://127.0.0.1:17891/adjust?slider=Exposure&amount=-1` |
| Exposure +5 | `/adjust?slider=Exposure&amount=5` | `http://127.0.0.1:17891/adjust?slider=Exposure&amount=5` |
| Exposure -5 | `/adjust?slider=Exposure&amount=-5` | `http://127.0.0.1:17891/adjust?slider=Exposure&amount=-5` |
| Exposure Reset | `/reset?slider=Exposure` | `http://127.0.0.1:17891/reset?slider=Exposure` |
| Auto Tone | `/action?action=setAutoTone` | `http://127.0.0.1:17891/action?action=setAutoTone` |
| Auto White Balance | `/action?action=setAutoWhiteBalance` | `http://127.0.0.1:17891/action?action=setAutoWhiteBalance` |
| Reset Basic group | `/reset-group?group=Basic` | `http://127.0.0.1:17891/reset-group?group=Basic` |
| Reset all mapped sliders | `/reset-all` | `http://127.0.0.1:17891/reset-all` |

---

## Group reset commands

| Group | Companion path | Full local URL |
|---|---|---|
| Basic | `/reset-group?group=Basic` | `http://127.0.0.1:17891/reset-group?group=Basic` |
| Color | `/reset-group?group=Color` | `http://127.0.0.1:17891/reset-group?group=Color` |
| Presence | `/reset-group?group=Presence` | `http://127.0.0.1:17891/reset-group?group=Presence` |
| Detail | `/reset-group?group=Detail` | `http://127.0.0.1:17891/reset-group?group=Detail` |
| Color Mixer / HSL | `/reset-group?group=Color%20Mixer%20%2F%20HSL` | `http://127.0.0.1:17891/reset-group?group=Color%20Mixer%20%2F%20HSL` |
| B&W Mixer | `/reset-group?group=B%26W%20Mixer` | `http://127.0.0.1:17891/reset-group?group=B%26W%20Mixer` |
| Effects | `/reset-group?group=Effects` | `http://127.0.0.1:17891/reset-group?group=Effects` |
| Calibration | `/reset-group?group=Calibration` | `http://127.0.0.1:17891/reset-group?group=Calibration` |
| Lens / Defringe | `/reset-group?group=Lens%20%2F%20Defringe` | `http://127.0.0.1:17891/reset-group?group=Lens%20%2F%20Defringe` |
| Transform | `/reset-group?group=Transform` | `http://127.0.0.1:17891/reset-group?group=Transform` |
| Tone Curve | `/reset-group?group=Tone%20Curve` | `http://127.0.0.1:17891/reset-group?group=Tone%20Curve` |

---

## Action commands

| Action | Companion path | Full local URL |
|---|---|---|
| resetCrop | `/action?action=resetCrop` | `http://127.0.0.1:17891/action?action=resetCrop` |
| resetTransforms | `/action?action=resetTransforms` | `http://127.0.0.1:17891/action?action=resetTransforms` |
| setAutoTone | `/action?action=setAutoTone` | `http://127.0.0.1:17891/action?action=setAutoTone` |
| setAutoWhiteBalance | `/action?action=setAutoWhiteBalance` | `http://127.0.0.1:17891/action?action=setAutoWhiteBalance` |
| resetSpotRemoval | `/action?action=resetSpotRemoval` | `http://127.0.0.1:17891/action?action=resetSpotRemoval` |
| resetRedeye | `/action?action=resetRedeye` | `http://127.0.0.1:17891/action?action=resetRedeye` |
| selectCropTool | `/action?action=selectCropTool` | `http://127.0.0.1:17891/action?action=selectCropTool` |
| selectHealingTool | `/action?action=selectHealingTool` | `http://127.0.0.1:17891/action?action=selectHealingTool` |
| selectRedEyeTool | `/action?action=selectRedEyeTool` | `http://127.0.0.1:17891/action?action=selectRedEyeTool` |
| selectUprightTool | `/action?action=selectUprightTool` | `http://127.0.0.1:17891/action?action=selectUprightTool` |
| selectMaskingTool | `/action?action=selectMaskingTool` | `http://127.0.0.1:17891/action?action=selectMaskingTool` |

---

## Slider commands

Each slider includes ready-made Companion paths for:

```text
-5
-1
Reset
+1
+5
```

---

## Basic

| Slider label | Slider ID | Button | Companion path | Full local URL |
|---|---|---|---|---|
| Exposure | `Exposure` | -5 | `/adjust?slider=Exposure&amount=-5` | `http://127.0.0.1:17891/adjust?slider=Exposure&amount=-5` |
| Exposure | `Exposure` | -1 | `/adjust?slider=Exposure&amount=-1` | `http://127.0.0.1:17891/adjust?slider=Exposure&amount=-1` |
| Exposure | `Exposure` | Reset | `/reset?slider=Exposure` | `http://127.0.0.1:17891/reset?slider=Exposure` |
| Exposure | `Exposure` | +1 | `/adjust?slider=Exposure&amount=1` | `http://127.0.0.1:17891/adjust?slider=Exposure&amount=1` |
| Exposure | `Exposure` | +5 | `/adjust?slider=Exposure&amount=5` | `http://127.0.0.1:17891/adjust?slider=Exposure&amount=5` |
| Contrast | `Contrast` | -5 | `/adjust?slider=Contrast&amount=-5` | `http://127.0.0.1:17891/adjust?slider=Contrast&amount=-5` |
| Contrast | `Contrast` | -1 | `/adjust?slider=Contrast&amount=-1` | `http://127.0.0.1:17891/adjust?slider=Contrast&amount=-1` |
| Contrast | `Contrast` | Reset | `/reset?slider=Contrast` | `http://127.0.0.1:17891/reset?slider=Contrast` |
| Contrast | `Contrast` | +1 | `/adjust?slider=Contrast&amount=1` | `http://127.0.0.1:17891/adjust?slider=Contrast&amount=1` |
| Contrast | `Contrast` | +5 | `/adjust?slider=Contrast&amount=5` | `http://127.0.0.1:17891/adjust?slider=Contrast&amount=5` |
| Highlights | `Highlights` | -5 | `/adjust?slider=Highlights&amount=-5` | `http://127.0.0.1:17891/adjust?slider=Highlights&amount=-5` |
| Highlights | `Highlights` | -1 | `/adjust?slider=Highlights&amount=-1` | `http://127.0.0.1:17891/adjust?slider=Highlights&amount=-1` |
| Highlights | `Highlights` | Reset | `/reset?slider=Highlights` | `http://127.0.0.1:17891/reset?slider=Highlights` |
| Highlights | `Highlights` | +1 | `/adjust?slider=Highlights&amount=1` | `http://127.0.0.1:17891/adjust?slider=Highlights&amount=1` |
| Highlights | `Highlights` | +5 | `/adjust?slider=Highlights&amount=5` | `http://127.0.0.1:17891/adjust?slider=Highlights&amount=5` |
| Shadows | `Shadows` | -5 | `/adjust?slider=Shadows&amount=-5` | `http://127.0.0.1:17891/adjust?slider=Shadows&amount=-5` |
| Shadows | `Shadows` | -1 | `/adjust?slider=Shadows&amount=-1` | `http://127.0.0.1:17891/adjust?slider=Shadows&amount=-1` |
| Shadows | `Shadows` | Reset | `/reset?slider=Shadows` | `http://127.0.0.1:17891/reset?slider=Shadows` |
| Shadows | `Shadows` | +1 | `/adjust?slider=Shadows&amount=1` | `http://127.0.0.1:17891/adjust?slider=Shadows&amount=1` |
| Shadows | `Shadows` | +5 | `/adjust?slider=Shadows&amount=5` | `http://127.0.0.1:17891/adjust?slider=Shadows&amount=5` |
| Whites | `Whites` | -5 | `/adjust?slider=Whites&amount=-5` | `http://127.0.0.1:17891/adjust?slider=Whites&amount=-5` |
| Whites | `Whites` | -1 | `/adjust?slider=Whites&amount=-1` | `http://127.0.0.1:17891/adjust?slider=Whites&amount=-1` |
| Whites | `Whites` | Reset | `/reset?slider=Whites` | `http://127.0.0.1:17891/reset?slider=Whites` |
| Whites | `Whites` | +1 | `/adjust?slider=Whites&amount=1` | `http://127.0.0.1:17891/adjust?slider=Whites&amount=1` |
| Whites | `Whites` | +5 | `/adjust?slider=Whites&amount=5` | `http://127.0.0.1:17891/adjust?slider=Whites&amount=5` |
| Blacks | `Blacks` | -5 | `/adjust?slider=Blacks&amount=-5` | `http://127.0.0.1:17891/adjust?slider=Blacks&amount=-5` |
| Blacks | `Blacks` | -1 | `/adjust?slider=Blacks&amount=-1` | `http://127.0.0.1:17891/adjust?slider=Blacks&amount=-1` |
| Blacks | `Blacks` | Reset | `/reset?slider=Blacks` | `http://127.0.0.1:17891/reset?slider=Blacks` |
| Blacks | `Blacks` | +1 | `/adjust?slider=Blacks&amount=1` | `http://127.0.0.1:17891/adjust?slider=Blacks&amount=1` |
| Blacks | `Blacks` | +5 | `/adjust?slider=Blacks&amount=5` | `http://127.0.0.1:17891/adjust?slider=Blacks&amount=5` |

---

## Color

| Slider label | Slider ID | Button | Companion path | Full local URL |
|---|---|---|---|---|
| Temperature | `Temperature` | -5 | `/adjust?slider=Temperature&amount=-5` | `http://127.0.0.1:17891/adjust?slider=Temperature&amount=-5` |
| Temperature | `Temperature` | -1 | `/adjust?slider=Temperature&amount=-1` | `http://127.0.0.1:17891/adjust?slider=Temperature&amount=-1` |
| Temperature | `Temperature` | Reset | `/reset?slider=Temperature` | `http://127.0.0.1:17891/reset?slider=Temperature` |
| Temperature | `Temperature` | +1 | `/adjust?slider=Temperature&amount=1` | `http://127.0.0.1:17891/adjust?slider=Temperature&amount=1` |
| Temperature | `Temperature` | +5 | `/adjust?slider=Temperature&amount=5` | `http://127.0.0.1:17891/adjust?slider=Temperature&amount=5` |
| Tint | `Tint` | -5 | `/adjust?slider=Tint&amount=-5` | `http://127.0.0.1:17891/adjust?slider=Tint&amount=-5` |
| Tint | `Tint` | -1 | `/adjust?slider=Tint&amount=-1` | `http://127.0.0.1:17891/adjust?slider=Tint&amount=-1` |
| Tint | `Tint` | Reset | `/reset?slider=Tint` | `http://127.0.0.1:17891/reset?slider=Tint` |
| Tint | `Tint` | +1 | `/adjust?slider=Tint&amount=1` | `http://127.0.0.1:17891/adjust?slider=Tint&amount=1` |
| Tint | `Tint` | +5 | `/adjust?slider=Tint&amount=5` | `http://127.0.0.1:17891/adjust?slider=Tint&amount=5` |
| Vibrance | `Vibrance` | -5 | `/adjust?slider=Vibrance&amount=-5` | `http://127.0.0.1:17891/adjust?slider=Vibrance&amount=-5` |
| Vibrance | `Vibrance` | -1 | `/adjust?slider=Vibrance&amount=-1` | `http://127.0.0.1:17891/adjust?slider=Vibrance&amount=-1` |
| Vibrance | `Vibrance` | Reset | `/reset?slider=Vibrance` | `http://127.0.0.1:17891/reset?slider=Vibrance` |
| Vibrance | `Vibrance` | +1 | `/adjust?slider=Vibrance&amount=1` | `http://127.0.0.1:17891/adjust?slider=Vibrance&amount=1` |
| Vibrance | `Vibrance` | +5 | `/adjust?slider=Vibrance&amount=5` | `http://127.0.0.1:17891/adjust?slider=Vibrance&amount=5` |
| Saturation | `Saturation` | -5 | `/adjust?slider=Saturation&amount=-5` | `http://127.0.0.1:17891/adjust?slider=Saturation&amount=-5` |
| Saturation | `Saturation` | -1 | `/adjust?slider=Saturation&amount=-1` | `http://127.0.0.1:17891/adjust?slider=Saturation&amount=-1` |
| Saturation | `Saturation` | Reset | `/reset?slider=Saturation` | `http://127.0.0.1:17891/reset?slider=Saturation` |
| Saturation | `Saturation` | +1 | `/adjust?slider=Saturation&amount=1` | `http://127.0.0.1:17891/adjust?slider=Saturation&amount=1` |
| Saturation | `Saturation` | +5 | `/adjust?slider=Saturation&amount=5` | `http://127.0.0.1:17891/adjust?slider=Saturation&amount=5` |

---

## Presence

| Slider label | Slider ID | Button | Companion path | Full local URL |
|---|---|---|---|---|
| Texture | `Texture` | -5 | `/adjust?slider=Texture&amount=-5` | `http://127.0.0.1:17891/adjust?slider=Texture&amount=-5` |
| Texture | `Texture` | -1 | `/adjust?slider=Texture&amount=-1` | `http://127.0.0.1:17891/adjust?slider=Texture&amount=-1` |
| Texture | `Texture` | Reset | `/reset?slider=Texture` | `http://127.0.0.1:17891/reset?slider=Texture` |
| Texture | `Texture` | +1 | `/adjust?slider=Texture&amount=1` | `http://127.0.0.1:17891/adjust?slider=Texture&amount=1` |
| Texture | `Texture` | +5 | `/adjust?slider=Texture&amount=5` | `http://127.0.0.1:17891/adjust?slider=Texture&amount=5` |
| Clarity | `Clarity` | -5 | `/adjust?slider=Clarity&amount=-5` | `http://127.0.0.1:17891/adjust?slider=Clarity&amount=-5` |
| Clarity | `Clarity` | -1 | `/adjust?slider=Clarity&amount=-1` | `http://127.0.0.1:17891/adjust?slider=Clarity&amount=-1` |
| Clarity | `Clarity` | Reset | `/reset?slider=Clarity` | `http://127.0.0.1:17891/reset?slider=Clarity` |
| Clarity | `Clarity` | +1 | `/adjust?slider=Clarity&amount=1` | `http://127.0.0.1:17891/adjust?slider=Clarity&amount=1` |
| Clarity | `Clarity` | +5 | `/adjust?slider=Clarity&amount=5` | `http://127.0.0.1:17891/adjust?slider=Clarity&amount=5` |
| Dehaze | `Dehaze` | -5 | `/adjust?slider=Dehaze&amount=-5` | `http://127.0.0.1:17891/adjust?slider=Dehaze&amount=-5` |
| Dehaze | `Dehaze` | -1 | `/adjust?slider=Dehaze&amount=-1` | `http://127.0.0.1:17891/adjust?slider=Dehaze&amount=-1` |
| Dehaze | `Dehaze` | Reset | `/reset?slider=Dehaze` | `http://127.0.0.1:17891/reset?slider=Dehaze` |
| Dehaze | `Dehaze` | +1 | `/adjust?slider=Dehaze&amount=1` | `http://127.0.0.1:17891/adjust?slider=Dehaze&amount=1` |
| Dehaze | `Dehaze` | +5 | `/adjust?slider=Dehaze&amount=5` | `http://127.0.0.1:17891/adjust?slider=Dehaze&amount=5` |

---

## Detail

| Slider label | Slider ID | Button | Companion path | Full local URL |
|---|---|---|---|---|
| Sharpness | `Sharpness` | -5 | `/adjust?slider=Sharpness&amount=-5` | `http://127.0.0.1:17891/adjust?slider=Sharpness&amount=-5` |
| Sharpness | `Sharpness` | -1 | `/adjust?slider=Sharpness&amount=-1` | `http://127.0.0.1:17891/adjust?slider=Sharpness&amount=-1` |
| Sharpness | `Sharpness` | Reset | `/reset?slider=Sharpness` | `http://127.0.0.1:17891/reset?slider=Sharpness` |
| Sharpness | `Sharpness` | +1 | `/adjust?slider=Sharpness&amount=1` | `http://127.0.0.1:17891/adjust?slider=Sharpness&amount=1` |
| Sharpness | `Sharpness` | +5 | `/adjust?slider=Sharpness&amount=5` | `http://127.0.0.1:17891/adjust?slider=Sharpness&amount=5` |
| Sharpen Radius | `SharpenRadius` | -5 | `/adjust?slider=SharpenRadius&amount=-5` | `http://127.0.0.1:17891/adjust?slider=SharpenRadius&amount=-5` |
| Sharpen Radius | `SharpenRadius` | -1 | `/adjust?slider=SharpenRadius&amount=-1` | `http://127.0.0.1:17891/adjust?slider=SharpenRadius&amount=-1` |
| Sharpen Radius | `SharpenRadius` | Reset | `/reset?slider=SharpenRadius` | `http://127.0.0.1:17891/reset?slider=SharpenRadius` |
| Sharpen Radius | `SharpenRadius` | +1 | `/adjust?slider=SharpenRadius&amount=1` | `http://127.0.0.1:17891/adjust?slider=SharpenRadius&amount=1` |
| Sharpen Radius | `SharpenRadius` | +5 | `/adjust?slider=SharpenRadius&amount=5` | `http://127.0.0.1:17891/adjust?slider=SharpenRadius&amount=5` |
| Sharpen Detail | `SharpenDetail` | -5 | `/adjust?slider=SharpenDetail&amount=-5` | `http://127.0.0.1:17891/adjust?slider=SharpenDetail&amount=-5` |
| Sharpen Detail | `SharpenDetail` | -1 | `/adjust?slider=SharpenDetail&amount=-1` | `http://127.0.0.1:17891/adjust?slider=SharpenDetail&amount=-1` |
| Sharpen Detail | `SharpenDetail` | Reset | `/reset?slider=SharpenDetail` | `http://127.0.0.1:17891/reset?slider=SharpenDetail` |
| Sharpen Detail | `SharpenDetail` | +1 | `/adjust?slider=SharpenDetail&amount=1` | `http://127.0.0.1:17891/adjust?slider=SharpenDetail&amount=1` |
| Sharpen Detail | `SharpenDetail` | +5 | `/adjust?slider=SharpenDetail&amount=5` | `http://127.0.0.1:17891/adjust?slider=SharpenDetail&amount=5` |
| Sharpen Masking | `SharpenEdgeMasking` | -5 | `/adjust?slider=SharpenEdgeMasking&amount=-5` | `http://127.0.0.1:17891/adjust?slider=SharpenEdgeMasking&amount=-5` |
| Sharpen Masking | `SharpenEdgeMasking` | -1 | `/adjust?slider=SharpenEdgeMasking&amount=-1` | `http://127.0.0.1:17891/adjust?slider=SharpenEdgeMasking&amount=-1` |
| Sharpen Masking | `SharpenEdgeMasking` | Reset | `/reset?slider=SharpenEdgeMasking` | `http://127.0.0.1:17891/reset?slider=SharpenEdgeMasking` |
| Sharpen Masking | `SharpenEdgeMasking` | +1 | `/adjust?slider=SharpenEdgeMasking&amount=1` | `http://127.0.0.1:17891/adjust?slider=SharpenEdgeMasking&amount=1` |
| Sharpen Masking | `SharpenEdgeMasking` | +5 | `/adjust?slider=SharpenEdgeMasking&amount=5` | `http://127.0.0.1:17891/adjust?slider=SharpenEdgeMasking&amount=5` |
| Luminance Noise Reduction | `LuminanceNR` | -5 | `/adjust?slider=LuminanceNR&amount=-5` | `http://127.0.0.1:17891/adjust?slider=LuminanceNR&amount=-5` |
| Luminance Noise Reduction | `LuminanceNR` | -1 | `/adjust?slider=LuminanceNR&amount=-1` | `http://127.0.0.1:17891/adjust?slider=LuminanceNR&amount=-1` |
| Luminance Noise Reduction | `LuminanceNR` | Reset | `/reset?slider=LuminanceNR` | `http://127.0.0.1:17891/reset?slider=LuminanceNR` |
| Luminance Noise Reduction | `LuminanceNR` | +1 | `/adjust?slider=LuminanceNR&amount=1` | `http://127.0.0.1:17891/adjust?slider=LuminanceNR&amount=1` |
| Luminance Noise Reduction | `LuminanceNR` | +5 | `/adjust?slider=LuminanceNR&amount=5` | `http://127.0.0.1:17891/adjust?slider=LuminanceNR&amount=5` |
| Luminance NR Detail | `LuminanceNoiseReductionDetail` | -5 | `/adjust?slider=LuminanceNoiseReductionDetail&amount=-5` | `http://127.0.0.1:17891/adjust?slider=LuminanceNoiseReductionDetail&amount=-5` |
| Luminance NR Detail | `LuminanceNoiseReductionDetail` | -1 | `/adjust?slider=LuminanceNoiseReductionDetail&amount=-1` | `http://127.0.0.1:17891/adjust?slider=LuminanceNoiseReductionDetail&amount=-1` |
| Luminance NR Detail | `LuminanceNoiseReductionDetail` | Reset | `/reset?slider=LuminanceNoiseReductionDetail` | `http://127.0.0.1:17891/reset?slider=LuminanceNoiseReductionDetail` |
| Luminance NR Detail | `LuminanceNoiseReductionDetail` | +1 | `/adjust?slider=LuminanceNoiseReductionDetail&amount=1` | `http://127.0.0.1:17891/adjust?slider=LuminanceNoiseReductionDetail&amount=1` |
| Luminance NR Detail | `LuminanceNoiseReductionDetail` | +5 | `/adjust?slider=LuminanceNoiseReductionDetail&amount=5` | `http://127.0.0.1:17891/adjust?slider=LuminanceNoiseReductionDetail&amount=5` |
| Luminance NR Contrast | `LuminanceNoiseReductionContrast` | -5 | `/adjust?slider=LuminanceNoiseReductionContrast&amount=-5` | `http://127.0.0.1:17891/adjust?slider=LuminanceNoiseReductionContrast&amount=-5` |
| Luminance NR Contrast | `LuminanceNoiseReductionContrast` | -1 | `/adjust?slider=LuminanceNoiseReductionContrast&amount=-1` | `http://127.0.0.1:17891/adjust?slider=LuminanceNoiseReductionContrast&amount=-1` |
| Luminance NR Contrast | `LuminanceNoiseReductionContrast` | Reset | `/reset?slider=LuminanceNoiseReductionContrast` | `http://127.0.0.1:17891/reset?slider=LuminanceNoiseReductionContrast` |
| Luminance NR Contrast | `LuminanceNoiseReductionContrast` | +1 | `/adjust?slider=LuminanceNoiseReductionContrast&amount=1` | `http://127.0.0.1:17891/adjust?slider=LuminanceNoiseReductionContrast&amount=1` |
| Luminance NR Contrast | `LuminanceNoiseReductionContrast` | +5 | `/adjust?slider=LuminanceNoiseReductionContrast&amount=5` | `http://127.0.0.1:17891/adjust?slider=LuminanceNoiseReductionContrast&amount=5` |
| Color Noise Reduction | `ColorNR` | -5 | `/adjust?slider=ColorNR&amount=-5` | `http://127.0.0.1:17891/adjust?slider=ColorNR&amount=-5` |
| Color Noise Reduction | `ColorNR` | -1 | `/adjust?slider=ColorNR&amount=-1` | `http://127.0.0.1:17891/adjust?slider=ColorNR&amount=-1` |
| Color Noise Reduction | `ColorNR` | Reset | `/reset?slider=ColorNR` | `http://127.0.0.1:17891/reset?slider=ColorNR` |
| Color Noise Reduction | `ColorNR` | +1 | `/adjust?slider=ColorNR&amount=1` | `http://127.0.0.1:17891/adjust?slider=ColorNR&amount=1` |
| Color Noise Reduction | `ColorNR` | +5 | `/adjust?slider=ColorNR&amount=5` | `http://127.0.0.1:17891/adjust?slider=ColorNR&amount=5` |
| Color NR Detail | `ColorNoiseReductionDetail` | -5 | `/adjust?slider=ColorNoiseReductionDetail&amount=-5` | `http://127.0.0.1:17891/adjust?slider=ColorNoiseReductionDetail&amount=-5` |
| Color NR Detail | `ColorNoiseReductionDetail` | -1 | `/adjust?slider=ColorNoiseReductionDetail&amount=-1` | `http://127.0.0.1:17891/adjust?slider=ColorNoiseReductionDetail&amount=-1` |
| Color NR Detail | `ColorNoiseReductionDetail` | Reset | `/reset?slider=ColorNoiseReductionDetail` | `http://127.0.0.1:17891/reset?slider=ColorNoiseReductionDetail` |
| Color NR Detail | `ColorNoiseReductionDetail` | +1 | `/adjust?slider=ColorNoiseReductionDetail&amount=1` | `http://127.0.0.1:17891/adjust?slider=ColorNoiseReductionDetail&amount=1` |
| Color NR Detail | `ColorNoiseReductionDetail` | +5 | `/adjust?slider=ColorNoiseReductionDetail&amount=5` | `http://127.0.0.1:17891/adjust?slider=ColorNoiseReductionDetail&amount=5` |
| Color NR Smoothness | `ColorNoiseReductionSmoothness` | -5 | `/adjust?slider=ColorNoiseReductionSmoothness&amount=-5` | `http://127.0.0.1:17891/adjust?slider=ColorNoiseReductionSmoothness&amount=-5` |
| Color NR Smoothness | `ColorNoiseReductionSmoothness` | -1 | `/adjust?slider=ColorNoiseReductionSmoothness&amount=-1` | `http://127.0.0.1:17891/adjust?slider=ColorNoiseReductionSmoothness&amount=-1` |
| Color NR Smoothness | `ColorNoiseReductionSmoothness` | Reset | `/reset?slider=ColorNoiseReductionSmoothness` | `http://127.0.0.1:17891/reset?slider=ColorNoiseReductionSmoothness` |
| Color NR Smoothness | `ColorNoiseReductionSmoothness` | +1 | `/adjust?slider=ColorNoiseReductionSmoothness&amount=1` | `http://127.0.0.1:17891/adjust?slider=ColorNoiseReductionSmoothness&amount=1` |
| Color NR Smoothness | `ColorNoiseReductionSmoothness` | +5 | `/adjust?slider=ColorNoiseReductionSmoothness&amount=5` | `http://127.0.0.1:17891/adjust?slider=ColorNoiseReductionSmoothness&amount=5` |

---

## Color Mixer / HSL

| Slider label | Slider ID | Button | Companion path | Full local URL |
|---|---|---|---|---|
| Hue Red | `HueAdjustmentRed` | -5 | `/adjust?slider=HueAdjustmentRed&amount=-5` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentRed&amount=-5` |
| Hue Red | `HueAdjustmentRed` | -1 | `/adjust?slider=HueAdjustmentRed&amount=-1` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentRed&amount=-1` |
| Hue Red | `HueAdjustmentRed` | Reset | `/reset?slider=HueAdjustmentRed` | `http://127.0.0.1:17891/reset?slider=HueAdjustmentRed` |
| Hue Red | `HueAdjustmentRed` | +1 | `/adjust?slider=HueAdjustmentRed&amount=1` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentRed&amount=1` |
| Hue Red | `HueAdjustmentRed` | +5 | `/adjust?slider=HueAdjustmentRed&amount=5` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentRed&amount=5` |
| Hue Orange | `HueAdjustmentOrange` | -5 | `/adjust?slider=HueAdjustmentOrange&amount=-5` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentOrange&amount=-5` |
| Hue Orange | `HueAdjustmentOrange` | -1 | `/adjust?slider=HueAdjustmentOrange&amount=-1` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentOrange&amount=-1` |
| Hue Orange | `HueAdjustmentOrange` | Reset | `/reset?slider=HueAdjustmentOrange` | `http://127.0.0.1:17891/reset?slider=HueAdjustmentOrange` |
| Hue Orange | `HueAdjustmentOrange` | +1 | `/adjust?slider=HueAdjustmentOrange&amount=1` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentOrange&amount=1` |
| Hue Orange | `HueAdjustmentOrange` | +5 | `/adjust?slider=HueAdjustmentOrange&amount=5` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentOrange&amount=5` |
| Hue Yellow | `HueAdjustmentYellow` | -5 | `/adjust?slider=HueAdjustmentYellow&amount=-5` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentYellow&amount=-5` |
| Hue Yellow | `HueAdjustmentYellow` | -1 | `/adjust?slider=HueAdjustmentYellow&amount=-1` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentYellow&amount=-1` |
| Hue Yellow | `HueAdjustmentYellow` | Reset | `/reset?slider=HueAdjustmentYellow` | `http://127.0.0.1:17891/reset?slider=HueAdjustmentYellow` |
| Hue Yellow | `HueAdjustmentYellow` | +1 | `/adjust?slider=HueAdjustmentYellow&amount=1` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentYellow&amount=1` |
| Hue Yellow | `HueAdjustmentYellow` | +5 | `/adjust?slider=HueAdjustmentYellow&amount=5` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentYellow&amount=5` |
| Hue Green | `HueAdjustmentGreen` | -5 | `/adjust?slider=HueAdjustmentGreen&amount=-5` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentGreen&amount=-5` |
| Hue Green | `HueAdjustmentGreen` | -1 | `/adjust?slider=HueAdjustmentGreen&amount=-1` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentGreen&amount=-1` |
| Hue Green | `HueAdjustmentGreen` | Reset | `/reset?slider=HueAdjustmentGreen` | `http://127.0.0.1:17891/reset?slider=HueAdjustmentGreen` |
| Hue Green | `HueAdjustmentGreen` | +1 | `/adjust?slider=HueAdjustmentGreen&amount=1` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentGreen&amount=1` |
| Hue Green | `HueAdjustmentGreen` | +5 | `/adjust?slider=HueAdjustmentGreen&amount=5` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentGreen&amount=5` |
| Hue Aqua | `HueAdjustmentAqua` | -5 | `/adjust?slider=HueAdjustmentAqua&amount=-5` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentAqua&amount=-5` |
| Hue Aqua | `HueAdjustmentAqua` | -1 | `/adjust?slider=HueAdjustmentAqua&amount=-1` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentAqua&amount=-1` |
| Hue Aqua | `HueAdjustmentAqua` | Reset | `/reset?slider=HueAdjustmentAqua` | `http://127.0.0.1:17891/reset?slider=HueAdjustmentAqua` |
| Hue Aqua | `HueAdjustmentAqua` | +1 | `/adjust?slider=HueAdjustmentAqua&amount=1` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentAqua&amount=1` |
| Hue Aqua | `HueAdjustmentAqua` | +5 | `/adjust?slider=HueAdjustmentAqua&amount=5` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentAqua&amount=5` |
| Hue Blue | `HueAdjustmentBlue` | -5 | `/adjust?slider=HueAdjustmentBlue&amount=-5` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentBlue&amount=-5` |
| Hue Blue | `HueAdjustmentBlue` | -1 | `/adjust?slider=HueAdjustmentBlue&amount=-1` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentBlue&amount=-1` |
| Hue Blue | `HueAdjustmentBlue` | Reset | `/reset?slider=HueAdjustmentBlue` | `http://127.0.0.1:17891/reset?slider=HueAdjustmentBlue` |
| Hue Blue | `HueAdjustmentBlue` | +1 | `/adjust?slider=HueAdjustmentBlue&amount=1` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentBlue&amount=1` |
| Hue Blue | `HueAdjustmentBlue` | +5 | `/adjust?slider=HueAdjustmentBlue&amount=5` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentBlue&amount=5` |
| Hue Purple | `HueAdjustmentPurple` | -5 | `/adjust?slider=HueAdjustmentPurple&amount=-5` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentPurple&amount=-5` |
| Hue Purple | `HueAdjustmentPurple` | -1 | `/adjust?slider=HueAdjustmentPurple&amount=-1` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentPurple&amount=-1` |
| Hue Purple | `HueAdjustmentPurple` | Reset | `/reset?slider=HueAdjustmentPurple` | `http://127.0.0.1:17891/reset?slider=HueAdjustmentPurple` |
| Hue Purple | `HueAdjustmentPurple` | +1 | `/adjust?slider=HueAdjustmentPurple&amount=1` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentPurple&amount=1` |
| Hue Purple | `HueAdjustmentPurple` | +5 | `/adjust?slider=HueAdjustmentPurple&amount=5` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentPurple&amount=5` |
| Hue Magenta | `HueAdjustmentMagenta` | -5 | `/adjust?slider=HueAdjustmentMagenta&amount=-5` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentMagenta&amount=-5` |
| Hue Magenta | `HueAdjustmentMagenta` | -1 | `/adjust?slider=HueAdjustmentMagenta&amount=-1` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentMagenta&amount=-1` |
| Hue Magenta | `HueAdjustmentMagenta` | Reset | `/reset?slider=HueAdjustmentMagenta` | `http://127.0.0.1:17891/reset?slider=HueAdjustmentMagenta` |
| Hue Magenta | `HueAdjustmentMagenta` | +1 | `/adjust?slider=HueAdjustmentMagenta&amount=1` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentMagenta&amount=1` |
| Hue Magenta | `HueAdjustmentMagenta` | +5 | `/adjust?slider=HueAdjustmentMagenta&amount=5` | `http://127.0.0.1:17891/adjust?slider=HueAdjustmentMagenta&amount=5` |
| Saturation Red | `SaturationAdjustmentRed` | -5 | `/adjust?slider=SaturationAdjustmentRed&amount=-5` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentRed&amount=-5` |
| Saturation Red | `SaturationAdjustmentRed` | -1 | `/adjust?slider=SaturationAdjustmentRed&amount=-1` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentRed&amount=-1` |
| Saturation Red | `SaturationAdjustmentRed` | Reset | `/reset?slider=SaturationAdjustmentRed` | `http://127.0.0.1:17891/reset?slider=SaturationAdjustmentRed` |
| Saturation Red | `SaturationAdjustmentRed` | +1 | `/adjust?slider=SaturationAdjustmentRed&amount=1` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentRed&amount=1` |
| Saturation Red | `SaturationAdjustmentRed` | +5 | `/adjust?slider=SaturationAdjustmentRed&amount=5` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentRed&amount=5` |
| Saturation Orange | `SaturationAdjustmentOrange` | -5 | `/adjust?slider=SaturationAdjustmentOrange&amount=-5` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentOrange&amount=-5` |
| Saturation Orange | `SaturationAdjustmentOrange` | -1 | `/adjust?slider=SaturationAdjustmentOrange&amount=-1` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentOrange&amount=-1` |
| Saturation Orange | `SaturationAdjustmentOrange` | Reset | `/reset?slider=SaturationAdjustmentOrange` | `http://127.0.0.1:17891/reset?slider=SaturationAdjustmentOrange` |
| Saturation Orange | `SaturationAdjustmentOrange` | +1 | `/adjust?slider=SaturationAdjustmentOrange&amount=1` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentOrange&amount=1` |
| Saturation Orange | `SaturationAdjustmentOrange` | +5 | `/adjust?slider=SaturationAdjustmentOrange&amount=5` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentOrange&amount=5` |
| Saturation Yellow | `SaturationAdjustmentYellow` | -5 | `/adjust?slider=SaturationAdjustmentYellow&amount=-5` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentYellow&amount=-5` |
| Saturation Yellow | `SaturationAdjustmentYellow` | -1 | `/adjust?slider=SaturationAdjustmentYellow&amount=-1` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentYellow&amount=-1` |
| Saturation Yellow | `SaturationAdjustmentYellow` | Reset | `/reset?slider=SaturationAdjustmentYellow` | `http://127.0.0.1:17891/reset?slider=SaturationAdjustmentYellow` |
| Saturation Yellow | `SaturationAdjustmentYellow` | +1 | `/adjust?slider=SaturationAdjustmentYellow&amount=1` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentYellow&amount=1` |
| Saturation Yellow | `SaturationAdjustmentYellow` | +5 | `/adjust?slider=SaturationAdjustmentYellow&amount=5` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentYellow&amount=5` |
| Saturation Green | `SaturationAdjustmentGreen` | -5 | `/adjust?slider=SaturationAdjustmentGreen&amount=-5` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentGreen&amount=-5` |
| Saturation Green | `SaturationAdjustmentGreen` | -1 | `/adjust?slider=SaturationAdjustmentGreen&amount=-1` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentGreen&amount=-1` |
| Saturation Green | `SaturationAdjustmentGreen` | Reset | `/reset?slider=SaturationAdjustmentGreen` | `http://127.0.0.1:17891/reset?slider=SaturationAdjustmentGreen` |
| Saturation Green | `SaturationAdjustmentGreen` | +1 | `/adjust?slider=SaturationAdjustmentGreen&amount=1` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentGreen&amount=1` |
| Saturation Green | `SaturationAdjustmentGreen` | +5 | `/adjust?slider=SaturationAdjustmentGreen&amount=5` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentGreen&amount=5` |
| Saturation Aqua | `SaturationAdjustmentAqua` | -5 | `/adjust?slider=SaturationAdjustmentAqua&amount=-5` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentAqua&amount=-5` |
| Saturation Aqua | `SaturationAdjustmentAqua` | -1 | `/adjust?slider=SaturationAdjustmentAqua&amount=-1` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentAqua&amount=-1` |
| Saturation Aqua | `SaturationAdjustmentAqua` | Reset | `/reset?slider=SaturationAdjustmentAqua` | `http://127.0.0.1:17891/reset?slider=SaturationAdjustmentAqua` |
| Saturation Aqua | `SaturationAdjustmentAqua` | +1 | `/adjust?slider=SaturationAdjustmentAqua&amount=1` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentAqua&amount=1` |
| Saturation Aqua | `SaturationAdjustmentAqua` | +5 | `/adjust?slider=SaturationAdjustmentAqua&amount=5` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentAqua&amount=5` |
| Saturation Blue | `SaturationAdjustmentBlue` | -5 | `/adjust?slider=SaturationAdjustmentBlue&amount=-5` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentBlue&amount=-5` |
| Saturation Blue | `SaturationAdjustmentBlue` | -1 | `/adjust?slider=SaturationAdjustmentBlue&amount=-1` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentBlue&amount=-1` |
| Saturation Blue | `SaturationAdjustmentBlue` | Reset | `/reset?slider=SaturationAdjustmentBlue` | `http://127.0.0.1:17891/reset?slider=SaturationAdjustmentBlue` |
| Saturation Blue | `SaturationAdjustmentBlue` | +1 | `/adjust?slider=SaturationAdjustmentBlue&amount=1` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentBlue&amount=1` |
| Saturation Blue | `SaturationAdjustmentBlue` | +5 | `/adjust?slider=SaturationAdjustmentBlue&amount=5` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentBlue&amount=5` |
| Saturation Purple | `SaturationAdjustmentPurple` | -5 | `/adjust?slider=SaturationAdjustmentPurple&amount=-5` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentPurple&amount=-5` |
| Saturation Purple | `SaturationAdjustmentPurple` | -1 | `/adjust?slider=SaturationAdjustmentPurple&amount=-1` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentPurple&amount=-1` |
| Saturation Purple | `SaturationAdjustmentPurple` | Reset | `/reset?slider=SaturationAdjustmentPurple` | `http://127.0.0.1:17891/reset?slider=SaturationAdjustmentPurple` |
| Saturation Purple | `SaturationAdjustmentPurple` | +1 | `/adjust?slider=SaturationAdjustmentPurple&amount=1` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentPurple&amount=1` |
| Saturation Purple | `SaturationAdjustmentPurple` | +5 | `/adjust?slider=SaturationAdjustmentPurple&amount=5` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentPurple&amount=5` |
| Saturation Magenta | `SaturationAdjustmentMagenta` | -5 | `/adjust?slider=SaturationAdjustmentMagenta&amount=-5` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentMagenta&amount=-5` |
| Saturation Magenta | `SaturationAdjustmentMagenta` | -1 | `/adjust?slider=SaturationAdjustmentMagenta&amount=-1` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentMagenta&amount=-1` |
| Saturation Magenta | `SaturationAdjustmentMagenta` | Reset | `/reset?slider=SaturationAdjustmentMagenta` | `http://127.0.0.1:17891/reset?slider=SaturationAdjustmentMagenta` |
| Saturation Magenta | `SaturationAdjustmentMagenta` | +1 | `/adjust?slider=SaturationAdjustmentMagenta&amount=1` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentMagenta&amount=1` |
| Saturation Magenta | `SaturationAdjustmentMagenta` | +5 | `/adjust?slider=SaturationAdjustmentMagenta&amount=5` | `http://127.0.0.1:17891/adjust?slider=SaturationAdjustmentMagenta&amount=5` |
| Luminance Red | `LuminanceAdjustmentRed` | -5 | `/adjust?slider=LuminanceAdjustmentRed&amount=-5` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentRed&amount=-5` |
| Luminance Red | `LuminanceAdjustmentRed` | -1 | `/adjust?slider=LuminanceAdjustmentRed&amount=-1` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentRed&amount=-1` |
| Luminance Red | `LuminanceAdjustmentRed` | Reset | `/reset?slider=LuminanceAdjustmentRed` | `http://127.0.0.1:17891/reset?slider=LuminanceAdjustmentRed` |
| Luminance Red | `LuminanceAdjustmentRed` | +1 | `/adjust?slider=LuminanceAdjustmentRed&amount=1` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentRed&amount=1` |
| Luminance Red | `LuminanceAdjustmentRed` | +5 | `/adjust?slider=LuminanceAdjustmentRed&amount=5` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentRed&amount=5` |
| Luminance Orange | `LuminanceAdjustmentOrange` | -5 | `/adjust?slider=LuminanceAdjustmentOrange&amount=-5` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentOrange&amount=-5` |
| Luminance Orange | `LuminanceAdjustmentOrange` | -1 | `/adjust?slider=LuminanceAdjustmentOrange&amount=-1` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentOrange&amount=-1` |
| Luminance Orange | `LuminanceAdjustmentOrange` | Reset | `/reset?slider=LuminanceAdjustmentOrange` | `http://127.0.0.1:17891/reset?slider=LuminanceAdjustmentOrange` |
| Luminance Orange | `LuminanceAdjustmentOrange` | +1 | `/adjust?slider=LuminanceAdjustmentOrange&amount=1` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentOrange&amount=1` |
| Luminance Orange | `LuminanceAdjustmentOrange` | +5 | `/adjust?slider=LuminanceAdjustmentOrange&amount=5` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentOrange&amount=5` |
| Luminance Yellow | `LuminanceAdjustmentYellow` | -5 | `/adjust?slider=LuminanceAdjustmentYellow&amount=-5` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentYellow&amount=-5` |
| Luminance Yellow | `LuminanceAdjustmentYellow` | -1 | `/adjust?slider=LuminanceAdjustmentYellow&amount=-1` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentYellow&amount=-1` |
| Luminance Yellow | `LuminanceAdjustmentYellow` | Reset | `/reset?slider=LuminanceAdjustmentYellow` | `http://127.0.0.1:17891/reset?slider=LuminanceAdjustmentYellow` |
| Luminance Yellow | `LuminanceAdjustmentYellow` | +1 | `/adjust?slider=LuminanceAdjustmentYellow&amount=1` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentYellow&amount=1` |
| Luminance Yellow | `LuminanceAdjustmentYellow` | +5 | `/adjust?slider=LuminanceAdjustmentYellow&amount=5` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentYellow&amount=5` |
| Luminance Green | `LuminanceAdjustmentGreen` | -5 | `/adjust?slider=LuminanceAdjustmentGreen&amount=-5` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentGreen&amount=-5` |
| Luminance Green | `LuminanceAdjustmentGreen` | -1 | `/adjust?slider=LuminanceAdjustmentGreen&amount=-1` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentGreen&amount=-1` |
| Luminance Green | `LuminanceAdjustmentGreen` | Reset | `/reset?slider=LuminanceAdjustmentGreen` | `http://127.0.0.1:17891/reset?slider=LuminanceAdjustmentGreen` |
| Luminance Green | `LuminanceAdjustmentGreen` | +1 | `/adjust?slider=LuminanceAdjustmentGreen&amount=1` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentGreen&amount=1` |
| Luminance Green | `LuminanceAdjustmentGreen` | +5 | `/adjust?slider=LuminanceAdjustmentGreen&amount=5` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentGreen&amount=5` |
| Luminance Aqua | `LuminanceAdjustmentAqua` | -5 | `/adjust?slider=LuminanceAdjustmentAqua&amount=-5` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentAqua&amount=-5` |
| Luminance Aqua | `LuminanceAdjustmentAqua` | -1 | `/adjust?slider=LuminanceAdjustmentAqua&amount=-1` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentAqua&amount=-1` |
| Luminance Aqua | `LuminanceAdjustmentAqua` | Reset | `/reset?slider=LuminanceAdjustmentAqua` | `http://127.0.0.1:17891/reset?slider=LuminanceAdjustmentAqua` |
| Luminance Aqua | `LuminanceAdjustmentAqua` | +1 | `/adjust?slider=LuminanceAdjustmentAqua&amount=1` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentAqua&amount=1` |
| Luminance Aqua | `LuminanceAdjustmentAqua` | +5 | `/adjust?slider=LuminanceAdjustmentAqua&amount=5` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentAqua&amount=5` |
| Luminance Blue | `LuminanceAdjustmentBlue` | -5 | `/adjust?slider=LuminanceAdjustmentBlue&amount=-5` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentBlue&amount=-5` |
| Luminance Blue | `LuminanceAdjustmentBlue` | -1 | `/adjust?slider=LuminanceAdjustmentBlue&amount=-1` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentBlue&amount=-1` |
| Luminance Blue | `LuminanceAdjustmentBlue` | Reset | `/reset?slider=LuminanceAdjustmentBlue` | `http://127.0.0.1:17891/reset?slider=LuminanceAdjustmentBlue` |
| Luminance Blue | `LuminanceAdjustmentBlue` | +1 | `/adjust?slider=LuminanceAdjustmentBlue&amount=1` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentBlue&amount=1` |
| Luminance Blue | `LuminanceAdjustmentBlue` | +5 | `/adjust?slider=LuminanceAdjustmentBlue&amount=5` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentBlue&amount=5` |
| Luminance Purple | `LuminanceAdjustmentPurple` | -5 | `/adjust?slider=LuminanceAdjustmentPurple&amount=-5` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentPurple&amount=-5` |
| Luminance Purple | `LuminanceAdjustmentPurple` | -1 | `/adjust?slider=LuminanceAdjustmentPurple&amount=-1` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentPurple&amount=-1` |
| Luminance Purple | `LuminanceAdjustmentPurple` | Reset | `/reset?slider=LuminanceAdjustmentPurple` | `http://127.0.0.1:17891/reset?slider=LuminanceAdjustmentPurple` |
| Luminance Purple | `LuminanceAdjustmentPurple` | +1 | `/adjust?slider=LuminanceAdjustmentPurple&amount=1` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentPurple&amount=1` |
| Luminance Purple | `LuminanceAdjustmentPurple` | +5 | `/adjust?slider=LuminanceAdjustmentPurple&amount=5` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentPurple&amount=5` |
| Luminance Magenta | `LuminanceAdjustmentMagenta` | -5 | `/adjust?slider=LuminanceAdjustmentMagenta&amount=-5` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentMagenta&amount=-5` |
| Luminance Magenta | `LuminanceAdjustmentMagenta` | -1 | `/adjust?slider=LuminanceAdjustmentMagenta&amount=-1` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentMagenta&amount=-1` |
| Luminance Magenta | `LuminanceAdjustmentMagenta` | Reset | `/reset?slider=LuminanceAdjustmentMagenta` | `http://127.0.0.1:17891/reset?slider=LuminanceAdjustmentMagenta` |
| Luminance Magenta | `LuminanceAdjustmentMagenta` | +1 | `/adjust?slider=LuminanceAdjustmentMagenta&amount=1` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentMagenta&amount=1` |
| Luminance Magenta | `LuminanceAdjustmentMagenta` | +5 | `/adjust?slider=LuminanceAdjustmentMagenta&amount=5` | `http://127.0.0.1:17891/adjust?slider=LuminanceAdjustmentMagenta&amount=5` |

---

## B&W Mixer

| Slider label | Slider ID | Button | Companion path | Full local URL |
|---|---|---|---|---|
| B&W Red | `GrayMixerRed` | -5 | `/adjust?slider=GrayMixerRed&amount=-5` | `http://127.0.0.1:17891/adjust?slider=GrayMixerRed&amount=-5` |
| B&W Red | `GrayMixerRed` | -1 | `/adjust?slider=GrayMixerRed&amount=-1` | `http://127.0.0.1:17891/adjust?slider=GrayMixerRed&amount=-1` |
| B&W Red | `GrayMixerRed` | Reset | `/reset?slider=GrayMixerRed` | `http://127.0.0.1:17891/reset?slider=GrayMixerRed` |
| B&W Red | `GrayMixerRed` | +1 | `/adjust?slider=GrayMixerRed&amount=1` | `http://127.0.0.1:17891/adjust?slider=GrayMixerRed&amount=1` |
| B&W Red | `GrayMixerRed` | +5 | `/adjust?slider=GrayMixerRed&amount=5` | `http://127.0.0.1:17891/adjust?slider=GrayMixerRed&amount=5` |
| B&W Orange | `GrayMixerOrange` | -5 | `/adjust?slider=GrayMixerOrange&amount=-5` | `http://127.0.0.1:17891/adjust?slider=GrayMixerOrange&amount=-5` |
| B&W Orange | `GrayMixerOrange` | -1 | `/adjust?slider=GrayMixerOrange&amount=-1` | `http://127.0.0.1:17891/adjust?slider=GrayMixerOrange&amount=-1` |
| B&W Orange | `GrayMixerOrange` | Reset | `/reset?slider=GrayMixerOrange` | `http://127.0.0.1:17891/reset?slider=GrayMixerOrange` |
| B&W Orange | `GrayMixerOrange` | +1 | `/adjust?slider=GrayMixerOrange&amount=1` | `http://127.0.0.1:17891/adjust?slider=GrayMixerOrange&amount=1` |
| B&W Orange | `GrayMixerOrange` | +5 | `/adjust?slider=GrayMixerOrange&amount=5` | `http://127.0.0.1:17891/adjust?slider=GrayMixerOrange&amount=5` |
| B&W Yellow | `GrayMixerYellow` | -5 | `/adjust?slider=GrayMixerYellow&amount=-5` | `http://127.0.0.1:17891/adjust?slider=GrayMixerYellow&amount=-5` |
| B&W Yellow | `GrayMixerYellow` | -1 | `/adjust?slider=GrayMixerYellow&amount=-1` | `http://127.0.0.1:17891/adjust?slider=GrayMixerYellow&amount=-1` |
| B&W Yellow | `GrayMixerYellow` | Reset | `/reset?slider=GrayMixerYellow` | `http://127.0.0.1:17891/reset?slider=GrayMixerYellow` |
| B&W Yellow | `GrayMixerYellow` | +1 | `/adjust?slider=GrayMixerYellow&amount=1` | `http://127.0.0.1:17891/adjust?slider=GrayMixerYellow&amount=1` |
| B&W Yellow | `GrayMixerYellow` | +5 | `/adjust?slider=GrayMixerYellow&amount=5` | `http://127.0.0.1:17891/adjust?slider=GrayMixerYellow&amount=5` |
| B&W Green | `GrayMixerGreen` | -5 | `/adjust?slider=GrayMixerGreen&amount=-5` | `http://127.0.0.1:17891/adjust?slider=GrayMixerGreen&amount=-5` |
| B&W Green | `GrayMixerGreen` | -1 | `/adjust?slider=GrayMixerGreen&amount=-1` | `http://127.0.0.1:17891/adjust?slider=GrayMixerGreen&amount=-1` |
| B&W Green | `GrayMixerGreen` | Reset | `/reset?slider=GrayMixerGreen` | `http://127.0.0.1:17891/reset?slider=GrayMixerGreen` |
| B&W Green | `GrayMixerGreen` | +1 | `/adjust?slider=GrayMixerGreen&amount=1` | `http://127.0.0.1:17891/adjust?slider=GrayMixerGreen&amount=1` |
| B&W Green | `GrayMixerGreen` | +5 | `/adjust?slider=GrayMixerGreen&amount=5` | `http://127.0.0.1:17891/adjust?slider=GrayMixerGreen&amount=5` |
| B&W Aqua | `GrayMixerAqua` | -5 | `/adjust?slider=GrayMixerAqua&amount=-5` | `http://127.0.0.1:17891/adjust?slider=GrayMixerAqua&amount=-5` |
| B&W Aqua | `GrayMixerAqua` | -1 | `/adjust?slider=GrayMixerAqua&amount=-1` | `http://127.0.0.1:17891/adjust?slider=GrayMixerAqua&amount=-1` |
| B&W Aqua | `GrayMixerAqua` | Reset | `/reset?slider=GrayMixerAqua` | `http://127.0.0.1:17891/reset?slider=GrayMixerAqua` |
| B&W Aqua | `GrayMixerAqua` | +1 | `/adjust?slider=GrayMixerAqua&amount=1` | `http://127.0.0.1:17891/adjust?slider=GrayMixerAqua&amount=1` |
| B&W Aqua | `GrayMixerAqua` | +5 | `/adjust?slider=GrayMixerAqua&amount=5` | `http://127.0.0.1:17891/adjust?slider=GrayMixerAqua&amount=5` |
| B&W Blue | `GrayMixerBlue` | -5 | `/adjust?slider=GrayMixerBlue&amount=-5` | `http://127.0.0.1:17891/adjust?slider=GrayMixerBlue&amount=-5` |
| B&W Blue | `GrayMixerBlue` | -1 | `/adjust?slider=GrayMixerBlue&amount=-1` | `http://127.0.0.1:17891/adjust?slider=GrayMixerBlue&amount=-1` |
| B&W Blue | `GrayMixerBlue` | Reset | `/reset?slider=GrayMixerBlue` | `http://127.0.0.1:17891/reset?slider=GrayMixerBlue` |
| B&W Blue | `GrayMixerBlue` | +1 | `/adjust?slider=GrayMixerBlue&amount=1` | `http://127.0.0.1:17891/adjust?slider=GrayMixerBlue&amount=1` |
| B&W Blue | `GrayMixerBlue` | +5 | `/adjust?slider=GrayMixerBlue&amount=5` | `http://127.0.0.1:17891/adjust?slider=GrayMixerBlue&amount=5` |
| B&W Purple | `GrayMixerPurple` | -5 | `/adjust?slider=GrayMixerPurple&amount=-5` | `http://127.0.0.1:17891/adjust?slider=GrayMixerPurple&amount=-5` |
| B&W Purple | `GrayMixerPurple` | -1 | `/adjust?slider=GrayMixerPurple&amount=-1` | `http://127.0.0.1:17891/adjust?slider=GrayMixerPurple&amount=-1` |
| B&W Purple | `GrayMixerPurple` | Reset | `/reset?slider=GrayMixerPurple` | `http://127.0.0.1:17891/reset?slider=GrayMixerPurple` |
| B&W Purple | `GrayMixerPurple` | +1 | `/adjust?slider=GrayMixerPurple&amount=1` | `http://127.0.0.1:17891/adjust?slider=GrayMixerPurple&amount=1` |
| B&W Purple | `GrayMixerPurple` | +5 | `/adjust?slider=GrayMixerPurple&amount=5` | `http://127.0.0.1:17891/adjust?slider=GrayMixerPurple&amount=5` |
| B&W Magenta | `GrayMixerMagenta` | -5 | `/adjust?slider=GrayMixerMagenta&amount=-5` | `http://127.0.0.1:17891/adjust?slider=GrayMixerMagenta&amount=-5` |
| B&W Magenta | `GrayMixerMagenta` | -1 | `/adjust?slider=GrayMixerMagenta&amount=-1` | `http://127.0.0.1:17891/adjust?slider=GrayMixerMagenta&amount=-1` |
| B&W Magenta | `GrayMixerMagenta` | Reset | `/reset?slider=GrayMixerMagenta` | `http://127.0.0.1:17891/reset?slider=GrayMixerMagenta` |
| B&W Magenta | `GrayMixerMagenta` | +1 | `/adjust?slider=GrayMixerMagenta&amount=1` | `http://127.0.0.1:17891/adjust?slider=GrayMixerMagenta&amount=1` |
| B&W Magenta | `GrayMixerMagenta` | +5 | `/adjust?slider=GrayMixerMagenta&amount=5` | `http://127.0.0.1:17891/adjust?slider=GrayMixerMagenta&amount=5` |

---

## Effects

| Slider label | Slider ID | Button | Companion path | Full local URL |
|---|---|---|---|---|
| Vignette Amount | `PostCropVignetteAmount` | -5 | `/adjust?slider=PostCropVignetteAmount&amount=-5` | `http://127.0.0.1:17891/adjust?slider=PostCropVignetteAmount&amount=-5` |
| Vignette Amount | `PostCropVignetteAmount` | -1 | `/adjust?slider=PostCropVignetteAmount&amount=-1` | `http://127.0.0.1:17891/adjust?slider=PostCropVignetteAmount&amount=-1` |
| Vignette Amount | `PostCropVignetteAmount` | Reset | `/reset?slider=PostCropVignetteAmount` | `http://127.0.0.1:17891/reset?slider=PostCropVignetteAmount` |
| Vignette Amount | `PostCropVignetteAmount` | +1 | `/adjust?slider=PostCropVignetteAmount&amount=1` | `http://127.0.0.1:17891/adjust?slider=PostCropVignetteAmount&amount=1` |
| Vignette Amount | `PostCropVignetteAmount` | +5 | `/adjust?slider=PostCropVignetteAmount&amount=5` | `http://127.0.0.1:17891/adjust?slider=PostCropVignetteAmount&amount=5` |
| Vignette Midpoint | `PostCropVignetteMidpoint` | -5 | `/adjust?slider=PostCropVignetteMidpoint&amount=-5` | `http://127.0.0.1:17891/adjust?slider=PostCropVignetteMidpoint&amount=-5` |
| Vignette Midpoint | `PostCropVignetteMidpoint` | -1 | `/adjust?slider=PostCropVignetteMidpoint&amount=-1` | `http://127.0.0.1:17891/adjust?slider=PostCropVignetteMidpoint&amount=-1` |
| Vignette Midpoint | `PostCropVignetteMidpoint` | Reset | `/reset?slider=PostCropVignetteMidpoint` | `http://127.0.0.1:17891/reset?slider=PostCropVignetteMidpoint` |
| Vignette Midpoint | `PostCropVignetteMidpoint` | +1 | `/adjust?slider=PostCropVignetteMidpoint&amount=1` | `http://127.0.0.1:17891/adjust?slider=PostCropVignetteMidpoint&amount=1` |
| Vignette Midpoint | `PostCropVignetteMidpoint` | +5 | `/adjust?slider=PostCropVignetteMidpoint&amount=5` | `http://127.0.0.1:17891/adjust?slider=PostCropVignetteMidpoint&amount=5` |
| Vignette Feather | `PostCropVignetteFeather` | -5 | `/adjust?slider=PostCropVignetteFeather&amount=-5` | `http://127.0.0.1:17891/adjust?slider=PostCropVignetteFeather&amount=-5` |
| Vignette Feather | `PostCropVignetteFeather` | -1 | `/adjust?slider=PostCropVignetteFeather&amount=-1` | `http://127.0.0.1:17891/adjust?slider=PostCropVignetteFeather&amount=-1` |
| Vignette Feather | `PostCropVignetteFeather` | Reset | `/reset?slider=PostCropVignetteFeather` | `http://127.0.0.1:17891/reset?slider=PostCropVignetteFeather` |
| Vignette Feather | `PostCropVignetteFeather` | +1 | `/adjust?slider=PostCropVignetteFeather&amount=1` | `http://127.0.0.1:17891/adjust?slider=PostCropVignetteFeather&amount=1` |
| Vignette Feather | `PostCropVignetteFeather` | +5 | `/adjust?slider=PostCropVignetteFeather&amount=5` | `http://127.0.0.1:17891/adjust?slider=PostCropVignetteFeather&amount=5` |
| Vignette Roundness | `PostCropVignetteRoundness` | -5 | `/adjust?slider=PostCropVignetteRoundness&amount=-5` | `http://127.0.0.1:17891/adjust?slider=PostCropVignetteRoundness&amount=-5` |
| Vignette Roundness | `PostCropVignetteRoundness` | -1 | `/adjust?slider=PostCropVignetteRoundness&amount=-1` | `http://127.0.0.1:17891/adjust?slider=PostCropVignetteRoundness&amount=-1` |
| Vignette Roundness | `PostCropVignetteRoundness` | Reset | `/reset?slider=PostCropVignetteRoundness` | `http://127.0.0.1:17891/reset?slider=PostCropVignetteRoundness` |
| Vignette Roundness | `PostCropVignetteRoundness` | +1 | `/adjust?slider=PostCropVignetteRoundness&amount=1` | `http://127.0.0.1:17891/adjust?slider=PostCropVignetteRoundness&amount=1` |
| Vignette Roundness | `PostCropVignetteRoundness` | +5 | `/adjust?slider=PostCropVignetteRoundness&amount=5` | `http://127.0.0.1:17891/adjust?slider=PostCropVignetteRoundness&amount=5` |
| Vignette Highlights | `PostCropVignetteHighlightContrast` | -5 | `/adjust?slider=PostCropVignetteHighlightContrast&amount=-5` | `http://127.0.0.1:17891/adjust?slider=PostCropVignetteHighlightContrast&amount=-5` |
| Vignette Highlights | `PostCropVignetteHighlightContrast` | -1 | `/adjust?slider=PostCropVignetteHighlightContrast&amount=-1` | `http://127.0.0.1:17891/adjust?slider=PostCropVignetteHighlightContrast&amount=-1` |
| Vignette Highlights | `PostCropVignetteHighlightContrast` | Reset | `/reset?slider=PostCropVignetteHighlightContrast` | `http://127.0.0.1:17891/reset?slider=PostCropVignetteHighlightContrast` |
| Vignette Highlights | `PostCropVignetteHighlightContrast` | +1 | `/adjust?slider=PostCropVignetteHighlightContrast&amount=1` | `http://127.0.0.1:17891/adjust?slider=PostCropVignetteHighlightContrast&amount=1` |
| Vignette Highlights | `PostCropVignetteHighlightContrast` | +5 | `/adjust?slider=PostCropVignetteHighlightContrast&amount=5` | `http://127.0.0.1:17891/adjust?slider=PostCropVignetteHighlightContrast&amount=5` |
| Grain Amount | `GrainAmount` | -5 | `/adjust?slider=GrainAmount&amount=-5` | `http://127.0.0.1:17891/adjust?slider=GrainAmount&amount=-5` |
| Grain Amount | `GrainAmount` | -1 | `/adjust?slider=GrainAmount&amount=-1` | `http://127.0.0.1:17891/adjust?slider=GrainAmount&amount=-1` |
| Grain Amount | `GrainAmount` | Reset | `/reset?slider=GrainAmount` | `http://127.0.0.1:17891/reset?slider=GrainAmount` |
| Grain Amount | `GrainAmount` | +1 | `/adjust?slider=GrainAmount&amount=1` | `http://127.0.0.1:17891/adjust?slider=GrainAmount&amount=1` |
| Grain Amount | `GrainAmount` | +5 | `/adjust?slider=GrainAmount&amount=5` | `http://127.0.0.1:17891/adjust?slider=GrainAmount&amount=5` |
| Grain Size | `GrainSize` | -5 | `/adjust?slider=GrainSize&amount=-5` | `http://127.0.0.1:17891/adjust?slider=GrainSize&amount=-5` |
| Grain Size | `GrainSize` | -1 | `/adjust?slider=GrainSize&amount=-1` | `http://127.0.0.1:17891/adjust?slider=GrainSize&amount=-1` |
| Grain Size | `GrainSize` | Reset | `/reset?slider=GrainSize` | `http://127.0.0.1:17891/reset?slider=GrainSize` |
| Grain Size | `GrainSize` | +1 | `/adjust?slider=GrainSize&amount=1` | `http://127.0.0.1:17891/adjust?slider=GrainSize&amount=1` |
| Grain Size | `GrainSize` | +5 | `/adjust?slider=GrainSize&amount=5` | `http://127.0.0.1:17891/adjust?slider=GrainSize&amount=5` |
| Grain Roughness | `GrainFrequency` | -5 | `/adjust?slider=GrainFrequency&amount=-5` | `http://127.0.0.1:17891/adjust?slider=GrainFrequency&amount=-5` |
| Grain Roughness | `GrainFrequency` | -1 | `/adjust?slider=GrainFrequency&amount=-1` | `http://127.0.0.1:17891/adjust?slider=GrainFrequency&amount=-1` |
| Grain Roughness | `GrainFrequency` | Reset | `/reset?slider=GrainFrequency` | `http://127.0.0.1:17891/reset?slider=GrainFrequency` |
| Grain Roughness | `GrainFrequency` | +1 | `/adjust?slider=GrainFrequency&amount=1` | `http://127.0.0.1:17891/adjust?slider=GrainFrequency&amount=1` |
| Grain Roughness | `GrainFrequency` | +5 | `/adjust?slider=GrainFrequency&amount=5` | `http://127.0.0.1:17891/adjust?slider=GrainFrequency&amount=5` |

---

## Calibration

| Slider label | Slider ID | Button | Companion path | Full local URL |
|---|---|---|---|---|
| Shadow Tint | `ShadowTint` | -5 | `/adjust?slider=ShadowTint&amount=-5` | `http://127.0.0.1:17891/adjust?slider=ShadowTint&amount=-5` |
| Shadow Tint | `ShadowTint` | -1 | `/adjust?slider=ShadowTint&amount=-1` | `http://127.0.0.1:17891/adjust?slider=ShadowTint&amount=-1` |
| Shadow Tint | `ShadowTint` | Reset | `/reset?slider=ShadowTint` | `http://127.0.0.1:17891/reset?slider=ShadowTint` |
| Shadow Tint | `ShadowTint` | +1 | `/adjust?slider=ShadowTint&amount=1` | `http://127.0.0.1:17891/adjust?slider=ShadowTint&amount=1` |
| Shadow Tint | `ShadowTint` | +5 | `/adjust?slider=ShadowTint&amount=5` | `http://127.0.0.1:17891/adjust?slider=ShadowTint&amount=5` |
| Red Primary Hue | `RedHue` | -5 | `/adjust?slider=RedHue&amount=-5` | `http://127.0.0.1:17891/adjust?slider=RedHue&amount=-5` |
| Red Primary Hue | `RedHue` | -1 | `/adjust?slider=RedHue&amount=-1` | `http://127.0.0.1:17891/adjust?slider=RedHue&amount=-1` |
| Red Primary Hue | `RedHue` | Reset | `/reset?slider=RedHue` | `http://127.0.0.1:17891/reset?slider=RedHue` |
| Red Primary Hue | `RedHue` | +1 | `/adjust?slider=RedHue&amount=1` | `http://127.0.0.1:17891/adjust?slider=RedHue&amount=1` |
| Red Primary Hue | `RedHue` | +5 | `/adjust?slider=RedHue&amount=5` | `http://127.0.0.1:17891/adjust?slider=RedHue&amount=5` |
| Red Primary Saturation | `RedSaturation` | -5 | `/adjust?slider=RedSaturation&amount=-5` | `http://127.0.0.1:17891/adjust?slider=RedSaturation&amount=-5` |
| Red Primary Saturation | `RedSaturation` | -1 | `/adjust?slider=RedSaturation&amount=-1` | `http://127.0.0.1:17891/adjust?slider=RedSaturation&amount=-1` |
| Red Primary Saturation | `RedSaturation` | Reset | `/reset?slider=RedSaturation` | `http://127.0.0.1:17891/reset?slider=RedSaturation` |
| Red Primary Saturation | `RedSaturation` | +1 | `/adjust?slider=RedSaturation&amount=1` | `http://127.0.0.1:17891/adjust?slider=RedSaturation&amount=1` |
| Red Primary Saturation | `RedSaturation` | +5 | `/adjust?slider=RedSaturation&amount=5` | `http://127.0.0.1:17891/adjust?slider=RedSaturation&amount=5` |
| Green Primary Hue | `GreenHue` | -5 | `/adjust?slider=GreenHue&amount=-5` | `http://127.0.0.1:17891/adjust?slider=GreenHue&amount=-5` |
| Green Primary Hue | `GreenHue` | -1 | `/adjust?slider=GreenHue&amount=-1` | `http://127.0.0.1:17891/adjust?slider=GreenHue&amount=-1` |
| Green Primary Hue | `GreenHue` | Reset | `/reset?slider=GreenHue` | `http://127.0.0.1:17891/reset?slider=GreenHue` |
| Green Primary Hue | `GreenHue` | +1 | `/adjust?slider=GreenHue&amount=1` | `http://127.0.0.1:17891/adjust?slider=GreenHue&amount=1` |
| Green Primary Hue | `GreenHue` | +5 | `/adjust?slider=GreenHue&amount=5` | `http://127.0.0.1:17891/adjust?slider=GreenHue&amount=5` |
| Green Primary Saturation | `GreenSaturation` | -5 | `/adjust?slider=GreenSaturation&amount=-5` | `http://127.0.0.1:17891/adjust?slider=GreenSaturation&amount=-5` |
| Green Primary Saturation | `GreenSaturation` | -1 | `/adjust?slider=GreenSaturation&amount=-1` | `http://127.0.0.1:17891/adjust?slider=GreenSaturation&amount=-1` |
| Green Primary Saturation | `GreenSaturation` | Reset | `/reset?slider=GreenSaturation` | `http://127.0.0.1:17891/reset?slider=GreenSaturation` |
| Green Primary Saturation | `GreenSaturation` | +1 | `/adjust?slider=GreenSaturation&amount=1` | `http://127.0.0.1:17891/adjust?slider=GreenSaturation&amount=1` |
| Green Primary Saturation | `GreenSaturation` | +5 | `/adjust?slider=GreenSaturation&amount=5` | `http://127.0.0.1:17891/adjust?slider=GreenSaturation&amount=5` |
| Blue Primary Hue | `BlueHue` | -5 | `/adjust?slider=BlueHue&amount=-5` | `http://127.0.0.1:17891/adjust?slider=BlueHue&amount=-5` |
| Blue Primary Hue | `BlueHue` | -1 | `/adjust?slider=BlueHue&amount=-1` | `http://127.0.0.1:17891/adjust?slider=BlueHue&amount=-1` |
| Blue Primary Hue | `BlueHue` | Reset | `/reset?slider=BlueHue` | `http://127.0.0.1:17891/reset?slider=BlueHue` |
| Blue Primary Hue | `BlueHue` | +1 | `/adjust?slider=BlueHue&amount=1` | `http://127.0.0.1:17891/adjust?slider=BlueHue&amount=1` |
| Blue Primary Hue | `BlueHue` | +5 | `/adjust?slider=BlueHue&amount=5` | `http://127.0.0.1:17891/adjust?slider=BlueHue&amount=5` |
| Blue Primary Saturation | `BlueSaturation` | -5 | `/adjust?slider=BlueSaturation&amount=-5` | `http://127.0.0.1:17891/adjust?slider=BlueSaturation&amount=-5` |
| Blue Primary Saturation | `BlueSaturation` | -1 | `/adjust?slider=BlueSaturation&amount=-1` | `http://127.0.0.1:17891/adjust?slider=BlueSaturation&amount=-1` |
| Blue Primary Saturation | `BlueSaturation` | Reset | `/reset?slider=BlueSaturation` | `http://127.0.0.1:17891/reset?slider=BlueSaturation` |
| Blue Primary Saturation | `BlueSaturation` | +1 | `/adjust?slider=BlueSaturation&amount=1` | `http://127.0.0.1:17891/adjust?slider=BlueSaturation&amount=1` |
| Blue Primary Saturation | `BlueSaturation` | +5 | `/adjust?slider=BlueSaturation&amount=5` | `http://127.0.0.1:17891/adjust?slider=BlueSaturation&amount=5` |

---

## Lens / Defringe

| Slider label | Slider ID | Button | Companion path | Full local URL |
|---|---|---|---|---|
| Profile Distortion | `LensProfileDistortionScale` | -5 | `/adjust?slider=LensProfileDistortionScale&amount=-5` | `http://127.0.0.1:17891/adjust?slider=LensProfileDistortionScale&amount=-5` |
| Profile Distortion | `LensProfileDistortionScale` | -1 | `/adjust?slider=LensProfileDistortionScale&amount=-1` | `http://127.0.0.1:17891/adjust?slider=LensProfileDistortionScale&amount=-1` |
| Profile Distortion | `LensProfileDistortionScale` | Reset | `/reset?slider=LensProfileDistortionScale` | `http://127.0.0.1:17891/reset?slider=LensProfileDistortionScale` |
| Profile Distortion | `LensProfileDistortionScale` | +1 | `/adjust?slider=LensProfileDistortionScale&amount=1` | `http://127.0.0.1:17891/adjust?slider=LensProfileDistortionScale&amount=1` |
| Profile Distortion | `LensProfileDistortionScale` | +5 | `/adjust?slider=LensProfileDistortionScale&amount=5` | `http://127.0.0.1:17891/adjust?slider=LensProfileDistortionScale&amount=5` |
| Enable Profile Corrections | `LensProfileEnable` | -5 | `/adjust?slider=LensProfileEnable&amount=-5` | `http://127.0.0.1:17891/adjust?slider=LensProfileEnable&amount=-5` |
| Enable Profile Corrections | `LensProfileEnable` | -1 | `/adjust?slider=LensProfileEnable&amount=-1` | `http://127.0.0.1:17891/adjust?slider=LensProfileEnable&amount=-1` |
| Enable Profile Corrections | `LensProfileEnable` | Reset | `/reset?slider=LensProfileEnable` | `http://127.0.0.1:17891/reset?slider=LensProfileEnable` |
| Enable Profile Corrections | `LensProfileEnable` | +1 | `/adjust?slider=LensProfileEnable&amount=1` | `http://127.0.0.1:17891/adjust?slider=LensProfileEnable&amount=1` |
| Enable Profile Corrections | `LensProfileEnable` | +5 | `/adjust?slider=LensProfileEnable&amount=5` | `http://127.0.0.1:17891/adjust?slider=LensProfileEnable&amount=5` |
| Remove Chromatic Aberration | `AutoLateralCA` | -5 | `/adjust?slider=AutoLateralCA&amount=-5` | `http://127.0.0.1:17891/adjust?slider=AutoLateralCA&amount=-5` |
| Remove Chromatic Aberration | `AutoLateralCA` | -1 | `/adjust?slider=AutoLateralCA&amount=-1` | `http://127.0.0.1:17891/adjust?slider=AutoLateralCA&amount=-1` |
| Remove Chromatic Aberration | `AutoLateralCA` | Reset | `/reset?slider=AutoLateralCA` | `http://127.0.0.1:17891/reset?slider=AutoLateralCA` |
| Remove Chromatic Aberration | `AutoLateralCA` | +1 | `/adjust?slider=AutoLateralCA&amount=1` | `http://127.0.0.1:17891/adjust?slider=AutoLateralCA&amount=1` |
| Remove Chromatic Aberration | `AutoLateralCA` | +5 | `/adjust?slider=AutoLateralCA&amount=5` | `http://127.0.0.1:17891/adjust?slider=AutoLateralCA&amount=5` |
| Profile Vignetting | `LensProfileVignettingScale` | -5 | `/adjust?slider=LensProfileVignettingScale&amount=-5` | `http://127.0.0.1:17891/adjust?slider=LensProfileVignettingScale&amount=-5` |
| Profile Vignetting | `LensProfileVignettingScale` | -1 | `/adjust?slider=LensProfileVignettingScale&amount=-1` | `http://127.0.0.1:17891/adjust?slider=LensProfileVignettingScale&amount=-1` |
| Profile Vignetting | `LensProfileVignettingScale` | Reset | `/reset?slider=LensProfileVignettingScale` | `http://127.0.0.1:17891/reset?slider=LensProfileVignettingScale` |
| Profile Vignetting | `LensProfileVignettingScale` | +1 | `/adjust?slider=LensProfileVignettingScale&amount=1` | `http://127.0.0.1:17891/adjust?slider=LensProfileVignettingScale&amount=1` |
| Profile Vignetting | `LensProfileVignettingScale` | +5 | `/adjust?slider=LensProfileVignettingScale&amount=5` | `http://127.0.0.1:17891/adjust?slider=LensProfileVignettingScale&amount=5` |
| Manual Distortion | `LensManualDistortionAmount` | -5 | `/adjust?slider=LensManualDistortionAmount&amount=-5` | `http://127.0.0.1:17891/adjust?slider=LensManualDistortionAmount&amount=-5` |
| Manual Distortion | `LensManualDistortionAmount` | -1 | `/adjust?slider=LensManualDistortionAmount&amount=-1` | `http://127.0.0.1:17891/adjust?slider=LensManualDistortionAmount&amount=-1` |
| Manual Distortion | `LensManualDistortionAmount` | Reset | `/reset?slider=LensManualDistortionAmount` | `http://127.0.0.1:17891/reset?slider=LensManualDistortionAmount` |
| Manual Distortion | `LensManualDistortionAmount` | +1 | `/adjust?slider=LensManualDistortionAmount&amount=1` | `http://127.0.0.1:17891/adjust?slider=LensManualDistortionAmount&amount=1` |
| Manual Distortion | `LensManualDistortionAmount` | +5 | `/adjust?slider=LensManualDistortionAmount&amount=5` | `http://127.0.0.1:17891/adjust?slider=LensManualDistortionAmount&amount=5` |
| Purple Defringe Amount | `DefringePurpleAmount` | -5 | `/adjust?slider=DefringePurpleAmount&amount=-5` | `http://127.0.0.1:17891/adjust?slider=DefringePurpleAmount&amount=-5` |
| Purple Defringe Amount | `DefringePurpleAmount` | -1 | `/adjust?slider=DefringePurpleAmount&amount=-1` | `http://127.0.0.1:17891/adjust?slider=DefringePurpleAmount&amount=-1` |
| Purple Defringe Amount | `DefringePurpleAmount` | Reset | `/reset?slider=DefringePurpleAmount` | `http://127.0.0.1:17891/reset?slider=DefringePurpleAmount` |
| Purple Defringe Amount | `DefringePurpleAmount` | +1 | `/adjust?slider=DefringePurpleAmount&amount=1` | `http://127.0.0.1:17891/adjust?slider=DefringePurpleAmount&amount=1` |
| Purple Defringe Amount | `DefringePurpleAmount` | +5 | `/adjust?slider=DefringePurpleAmount&amount=5` | `http://127.0.0.1:17891/adjust?slider=DefringePurpleAmount&amount=5` |
| Purple Hue Low | `DefringePurpleHueLo` | -5 | `/adjust?slider=DefringePurpleHueLo&amount=-5` | `http://127.0.0.1:17891/adjust?slider=DefringePurpleHueLo&amount=-5` |
| Purple Hue Low | `DefringePurpleHueLo` | -1 | `/adjust?slider=DefringePurpleHueLo&amount=-1` | `http://127.0.0.1:17891/adjust?slider=DefringePurpleHueLo&amount=-1` |
| Purple Hue Low | `DefringePurpleHueLo` | Reset | `/reset?slider=DefringePurpleHueLo` | `http://127.0.0.1:17891/reset?slider=DefringePurpleHueLo` |
| Purple Hue Low | `DefringePurpleHueLo` | +1 | `/adjust?slider=DefringePurpleHueLo&amount=1` | `http://127.0.0.1:17891/adjust?slider=DefringePurpleHueLo&amount=1` |
| Purple Hue Low | `DefringePurpleHueLo` | +5 | `/adjust?slider=DefringePurpleHueLo&amount=5` | `http://127.0.0.1:17891/adjust?slider=DefringePurpleHueLo&amount=5` |
| Purple Hue High | `DefringePurpleHueHi` | -5 | `/adjust?slider=DefringePurpleHueHi&amount=-5` | `http://127.0.0.1:17891/adjust?slider=DefringePurpleHueHi&amount=-5` |
| Purple Hue High | `DefringePurpleHueHi` | -1 | `/adjust?slider=DefringePurpleHueHi&amount=-1` | `http://127.0.0.1:17891/adjust?slider=DefringePurpleHueHi&amount=-1` |
| Purple Hue High | `DefringePurpleHueHi` | Reset | `/reset?slider=DefringePurpleHueHi` | `http://127.0.0.1:17891/reset?slider=DefringePurpleHueHi` |
| Purple Hue High | `DefringePurpleHueHi` | +1 | `/adjust?slider=DefringePurpleHueHi&amount=1` | `http://127.0.0.1:17891/adjust?slider=DefringePurpleHueHi&amount=1` |
| Purple Hue High | `DefringePurpleHueHi` | +5 | `/adjust?slider=DefringePurpleHueHi&amount=5` | `http://127.0.0.1:17891/adjust?slider=DefringePurpleHueHi&amount=5` |
| Green Defringe Amount | `DefringeGreenAmount` | -5 | `/adjust?slider=DefringeGreenAmount&amount=-5` | `http://127.0.0.1:17891/adjust?slider=DefringeGreenAmount&amount=-5` |
| Green Defringe Amount | `DefringeGreenAmount` | -1 | `/adjust?slider=DefringeGreenAmount&amount=-1` | `http://127.0.0.1:17891/adjust?slider=DefringeGreenAmount&amount=-1` |
| Green Defringe Amount | `DefringeGreenAmount` | Reset | `/reset?slider=DefringeGreenAmount` | `http://127.0.0.1:17891/reset?slider=DefringeGreenAmount` |
| Green Defringe Amount | `DefringeGreenAmount` | +1 | `/adjust?slider=DefringeGreenAmount&amount=1` | `http://127.0.0.1:17891/adjust?slider=DefringeGreenAmount&amount=1` |
| Green Defringe Amount | `DefringeGreenAmount` | +5 | `/adjust?slider=DefringeGreenAmount&amount=5` | `http://127.0.0.1:17891/adjust?slider=DefringeGreenAmount&amount=5` |
| Green Hue Low | `DefringeGreenHueLo` | -5 | `/adjust?slider=DefringeGreenHueLo&amount=-5` | `http://127.0.0.1:17891/adjust?slider=DefringeGreenHueLo&amount=-5` |
| Green Hue Low | `DefringeGreenHueLo` | -1 | `/adjust?slider=DefringeGreenHueLo&amount=-1` | `http://127.0.0.1:17891/adjust?slider=DefringeGreenHueLo&amount=-1` |
| Green Hue Low | `DefringeGreenHueLo` | Reset | `/reset?slider=DefringeGreenHueLo` | `http://127.0.0.1:17891/reset?slider=DefringeGreenHueLo` |
| Green Hue Low | `DefringeGreenHueLo` | +1 | `/adjust?slider=DefringeGreenHueLo&amount=1` | `http://127.0.0.1:17891/adjust?slider=DefringeGreenHueLo&amount=1` |
| Green Hue Low | `DefringeGreenHueLo` | +5 | `/adjust?slider=DefringeGreenHueLo&amount=5` | `http://127.0.0.1:17891/adjust?slider=DefringeGreenHueLo&amount=5` |
| Green Hue High | `DefringeGreenHueHi` | -5 | `/adjust?slider=DefringeGreenHueHi&amount=-5` | `http://127.0.0.1:17891/adjust?slider=DefringeGreenHueHi&amount=-5` |
| Green Hue High | `DefringeGreenHueHi` | -1 | `/adjust?slider=DefringeGreenHueHi&amount=-1` | `http://127.0.0.1:17891/adjust?slider=DefringeGreenHueHi&amount=-1` |
| Green Hue High | `DefringeGreenHueHi` | Reset | `/reset?slider=DefringeGreenHueHi` | `http://127.0.0.1:17891/reset?slider=DefringeGreenHueHi` |
| Green Hue High | `DefringeGreenHueHi` | +1 | `/adjust?slider=DefringeGreenHueHi&amount=1` | `http://127.0.0.1:17891/adjust?slider=DefringeGreenHueHi&amount=1` |
| Green Hue High | `DefringeGreenHueHi` | +5 | `/adjust?slider=DefringeGreenHueHi&amount=5` | `http://127.0.0.1:17891/adjust?slider=DefringeGreenHueHi&amount=5` |

---

## Transform

| Slider label | Slider ID | Button | Companion path | Full local URL |
|---|---|---|---|---|
| Transform Vertical | `PerspectiveVertical` | -5 | `/adjust?slider=PerspectiveVertical&amount=-5` | `http://127.0.0.1:17891/adjust?slider=PerspectiveVertical&amount=-5` |
| Transform Vertical | `PerspectiveVertical` | -1 | `/adjust?slider=PerspectiveVertical&amount=-1` | `http://127.0.0.1:17891/adjust?slider=PerspectiveVertical&amount=-1` |
| Transform Vertical | `PerspectiveVertical` | Reset | `/reset?slider=PerspectiveVertical` | `http://127.0.0.1:17891/reset?slider=PerspectiveVertical` |
| Transform Vertical | `PerspectiveVertical` | +1 | `/adjust?slider=PerspectiveVertical&amount=1` | `http://127.0.0.1:17891/adjust?slider=PerspectiveVertical&amount=1` |
| Transform Vertical | `PerspectiveVertical` | +5 | `/adjust?slider=PerspectiveVertical&amount=5` | `http://127.0.0.1:17891/adjust?slider=PerspectiveVertical&amount=5` |
| Transform Horizontal | `PerspectiveHorizontal` | -5 | `/adjust?slider=PerspectiveHorizontal&amount=-5` | `http://127.0.0.1:17891/adjust?slider=PerspectiveHorizontal&amount=-5` |
| Transform Horizontal | `PerspectiveHorizontal` | -1 | `/adjust?slider=PerspectiveHorizontal&amount=-1` | `http://127.0.0.1:17891/adjust?slider=PerspectiveHorizontal&amount=-1` |
| Transform Horizontal | `PerspectiveHorizontal` | Reset | `/reset?slider=PerspectiveHorizontal` | `http://127.0.0.1:17891/reset?slider=PerspectiveHorizontal` |
| Transform Horizontal | `PerspectiveHorizontal` | +1 | `/adjust?slider=PerspectiveHorizontal&amount=1` | `http://127.0.0.1:17891/adjust?slider=PerspectiveHorizontal&amount=1` |
| Transform Horizontal | `PerspectiveHorizontal` | +5 | `/adjust?slider=PerspectiveHorizontal&amount=5` | `http://127.0.0.1:17891/adjust?slider=PerspectiveHorizontal&amount=5` |
| Transform Rotate | `PerspectiveRotate` | -5 | `/adjust?slider=PerspectiveRotate&amount=-5` | `http://127.0.0.1:17891/adjust?slider=PerspectiveRotate&amount=-5` |
| Transform Rotate | `PerspectiveRotate` | -1 | `/adjust?slider=PerspectiveRotate&amount=-1` | `http://127.0.0.1:17891/adjust?slider=PerspectiveRotate&amount=-1` |
| Transform Rotate | `PerspectiveRotate` | Reset | `/reset?slider=PerspectiveRotate` | `http://127.0.0.1:17891/reset?slider=PerspectiveRotate` |
| Transform Rotate | `PerspectiveRotate` | +1 | `/adjust?slider=PerspectiveRotate&amount=1` | `http://127.0.0.1:17891/adjust?slider=PerspectiveRotate&amount=1` |
| Transform Rotate | `PerspectiveRotate` | +5 | `/adjust?slider=PerspectiveRotate&amount=5` | `http://127.0.0.1:17891/adjust?slider=PerspectiveRotate&amount=5` |
| Transform Scale | `PerspectiveScale` | -5 | `/adjust?slider=PerspectiveScale&amount=-5` | `http://127.0.0.1:17891/adjust?slider=PerspectiveScale&amount=-5` |
| Transform Scale | `PerspectiveScale` | -1 | `/adjust?slider=PerspectiveScale&amount=-1` | `http://127.0.0.1:17891/adjust?slider=PerspectiveScale&amount=-1` |
| Transform Scale | `PerspectiveScale` | Reset | `/reset?slider=PerspectiveScale` | `http://127.0.0.1:17891/reset?slider=PerspectiveScale` |
| Transform Scale | `PerspectiveScale` | +1 | `/adjust?slider=PerspectiveScale&amount=1` | `http://127.0.0.1:17891/adjust?slider=PerspectiveScale&amount=1` |
| Transform Scale | `PerspectiveScale` | +5 | `/adjust?slider=PerspectiveScale&amount=5` | `http://127.0.0.1:17891/adjust?slider=PerspectiveScale&amount=5` |
| Transform Aspect | `PerspectiveAspect` | -5 | `/adjust?slider=PerspectiveAspect&amount=-5` | `http://127.0.0.1:17891/adjust?slider=PerspectiveAspect&amount=-5` |
| Transform Aspect | `PerspectiveAspect` | -1 | `/adjust?slider=PerspectiveAspect&amount=-1` | `http://127.0.0.1:17891/adjust?slider=PerspectiveAspect&amount=-1` |
| Transform Aspect | `PerspectiveAspect` | Reset | `/reset?slider=PerspectiveAspect` | `http://127.0.0.1:17891/reset?slider=PerspectiveAspect` |
| Transform Aspect | `PerspectiveAspect` | +1 | `/adjust?slider=PerspectiveAspect&amount=1` | `http://127.0.0.1:17891/adjust?slider=PerspectiveAspect&amount=1` |
| Transform Aspect | `PerspectiveAspect` | +5 | `/adjust?slider=PerspectiveAspect&amount=5` | `http://127.0.0.1:17891/adjust?slider=PerspectiveAspect&amount=5` |
| Transform X Offset | `PerspectiveX` | -5 | `/adjust?slider=PerspectiveX&amount=-5` | `http://127.0.0.1:17891/adjust?slider=PerspectiveX&amount=-5` |
| Transform X Offset | `PerspectiveX` | -1 | `/adjust?slider=PerspectiveX&amount=-1` | `http://127.0.0.1:17891/adjust?slider=PerspectiveX&amount=-1` |
| Transform X Offset | `PerspectiveX` | Reset | `/reset?slider=PerspectiveX` | `http://127.0.0.1:17891/reset?slider=PerspectiveX` |
| Transform X Offset | `PerspectiveX` | +1 | `/adjust?slider=PerspectiveX&amount=1` | `http://127.0.0.1:17891/adjust?slider=PerspectiveX&amount=1` |
| Transform X Offset | `PerspectiveX` | +5 | `/adjust?slider=PerspectiveX&amount=5` | `http://127.0.0.1:17891/adjust?slider=PerspectiveX&amount=5` |
| Transform Y Offset | `PerspectiveY` | -5 | `/adjust?slider=PerspectiveY&amount=-5` | `http://127.0.0.1:17891/adjust?slider=PerspectiveY&amount=-5` |
| Transform Y Offset | `PerspectiveY` | -1 | `/adjust?slider=PerspectiveY&amount=-1` | `http://127.0.0.1:17891/adjust?slider=PerspectiveY&amount=-1` |
| Transform Y Offset | `PerspectiveY` | Reset | `/reset?slider=PerspectiveY` | `http://127.0.0.1:17891/reset?slider=PerspectiveY` |
| Transform Y Offset | `PerspectiveY` | +1 | `/adjust?slider=PerspectiveY&amount=1` | `http://127.0.0.1:17891/adjust?slider=PerspectiveY&amount=1` |
| Transform Y Offset | `PerspectiveY` | +5 | `/adjust?slider=PerspectiveY&amount=5` | `http://127.0.0.1:17891/adjust?slider=PerspectiveY&amount=5` |

---

## Tone Curve

| Slider label | Slider ID | Button | Companion path | Full local URL |
|---|---|---|---|---|
| Curve Darks | `ParametricDarks` | -5 | `/adjust?slider=ParametricDarks&amount=-5` | `http://127.0.0.1:17891/adjust?slider=ParametricDarks&amount=-5` |
| Curve Darks | `ParametricDarks` | -1 | `/adjust?slider=ParametricDarks&amount=-1` | `http://127.0.0.1:17891/adjust?slider=ParametricDarks&amount=-1` |
| Curve Darks | `ParametricDarks` | Reset | `/reset?slider=ParametricDarks` | `http://127.0.0.1:17891/reset?slider=ParametricDarks` |
| Curve Darks | `ParametricDarks` | +1 | `/adjust?slider=ParametricDarks&amount=1` | `http://127.0.0.1:17891/adjust?slider=ParametricDarks&amount=1` |
| Curve Darks | `ParametricDarks` | +5 | `/adjust?slider=ParametricDarks&amount=5` | `http://127.0.0.1:17891/adjust?slider=ParametricDarks&amount=5` |
| Curve Lights | `ParametricLights` | -5 | `/adjust?slider=ParametricLights&amount=-5` | `http://127.0.0.1:17891/adjust?slider=ParametricLights&amount=-5` |
| Curve Lights | `ParametricLights` | -1 | `/adjust?slider=ParametricLights&amount=-1` | `http://127.0.0.1:17891/adjust?slider=ParametricLights&amount=-1` |
| Curve Lights | `ParametricLights` | Reset | `/reset?slider=ParametricLights` | `http://127.0.0.1:17891/reset?slider=ParametricLights` |
| Curve Lights | `ParametricLights` | +1 | `/adjust?slider=ParametricLights&amount=1` | `http://127.0.0.1:17891/adjust?slider=ParametricLights&amount=1` |
| Curve Lights | `ParametricLights` | +5 | `/adjust?slider=ParametricLights&amount=5` | `http://127.0.0.1:17891/adjust?slider=ParametricLights&amount=5` |
| Curve Shadows | `ParametricShadows` | -5 | `/adjust?slider=ParametricShadows&amount=-5` | `http://127.0.0.1:17891/adjust?slider=ParametricShadows&amount=-5` |
| Curve Shadows | `ParametricShadows` | -1 | `/adjust?slider=ParametricShadows&amount=-1` | `http://127.0.0.1:17891/adjust?slider=ParametricShadows&amount=-1` |
| Curve Shadows | `ParametricShadows` | Reset | `/reset?slider=ParametricShadows` | `http://127.0.0.1:17891/reset?slider=ParametricShadows` |
| Curve Shadows | `ParametricShadows` | +1 | `/adjust?slider=ParametricShadows&amount=1` | `http://127.0.0.1:17891/adjust?slider=ParametricShadows&amount=1` |
| Curve Shadows | `ParametricShadows` | +5 | `/adjust?slider=ParametricShadows&amount=5` | `http://127.0.0.1:17891/adjust?slider=ParametricShadows&amount=5` |
| Curve Highlights | `ParametricHighlights` | -5 | `/adjust?slider=ParametricHighlights&amount=-5` | `http://127.0.0.1:17891/adjust?slider=ParametricHighlights&amount=-5` |
| Curve Highlights | `ParametricHighlights` | -1 | `/adjust?slider=ParametricHighlights&amount=-1` | `http://127.0.0.1:17891/adjust?slider=ParametricHighlights&amount=-1` |
| Curve Highlights | `ParametricHighlights` | Reset | `/reset?slider=ParametricHighlights` | `http://127.0.0.1:17891/reset?slider=ParametricHighlights` |
| Curve Highlights | `ParametricHighlights` | +1 | `/adjust?slider=ParametricHighlights&amount=1` | `http://127.0.0.1:17891/adjust?slider=ParametricHighlights&amount=1` |
| Curve Highlights | `ParametricHighlights` | +5 | `/adjust?slider=ParametricHighlights&amount=5` | `http://127.0.0.1:17891/adjust?slider=ParametricHighlights&amount=5` |
| Curve Shadow Split | `ParametricShadowSplit` | -5 | `/adjust?slider=ParametricShadowSplit&amount=-5` | `http://127.0.0.1:17891/adjust?slider=ParametricShadowSplit&amount=-5` |
| Curve Shadow Split | `ParametricShadowSplit` | -1 | `/adjust?slider=ParametricShadowSplit&amount=-1` | `http://127.0.0.1:17891/adjust?slider=ParametricShadowSplit&amount=-1` |
| Curve Shadow Split | `ParametricShadowSplit` | Reset | `/reset?slider=ParametricShadowSplit` | `http://127.0.0.1:17891/reset?slider=ParametricShadowSplit` |
| Curve Shadow Split | `ParametricShadowSplit` | +1 | `/adjust?slider=ParametricShadowSplit&amount=1` | `http://127.0.0.1:17891/adjust?slider=ParametricShadowSplit&amount=1` |
| Curve Shadow Split | `ParametricShadowSplit` | +5 | `/adjust?slider=ParametricShadowSplit&amount=5` | `http://127.0.0.1:17891/adjust?slider=ParametricShadowSplit&amount=5` |
| Curve Midtone Split | `ParametricMidtoneSplit` | -5 | `/adjust?slider=ParametricMidtoneSplit&amount=-5` | `http://127.0.0.1:17891/adjust?slider=ParametricMidtoneSplit&amount=-5` |
| Curve Midtone Split | `ParametricMidtoneSplit` | -1 | `/adjust?slider=ParametricMidtoneSplit&amount=-1` | `http://127.0.0.1:17891/adjust?slider=ParametricMidtoneSplit&amount=-1` |
| Curve Midtone Split | `ParametricMidtoneSplit` | Reset | `/reset?slider=ParametricMidtoneSplit` | `http://127.0.0.1:17891/reset?slider=ParametricMidtoneSplit` |
| Curve Midtone Split | `ParametricMidtoneSplit` | +1 | `/adjust?slider=ParametricMidtoneSplit&amount=1` | `http://127.0.0.1:17891/adjust?slider=ParametricMidtoneSplit&amount=1` |
| Curve Midtone Split | `ParametricMidtoneSplit` | +5 | `/adjust?slider=ParametricMidtoneSplit&amount=5` | `http://127.0.0.1:17891/adjust?slider=ParametricMidtoneSplit&amount=5` |
| Curve Highlight Split | `ParametricHighlightSplit` | -5 | `/adjust?slider=ParametricHighlightSplit&amount=-5` | `http://127.0.0.1:17891/adjust?slider=ParametricHighlightSplit&amount=-5` |
| Curve Highlight Split | `ParametricHighlightSplit` | -1 | `/adjust?slider=ParametricHighlightSplit&amount=-1` | `http://127.0.0.1:17891/adjust?slider=ParametricHighlightSplit&amount=-1` |
| Curve Highlight Split | `ParametricHighlightSplit` | Reset | `/reset?slider=ParametricHighlightSplit` | `http://127.0.0.1:17891/reset?slider=ParametricHighlightSplit` |
| Curve Highlight Split | `ParametricHighlightSplit` | +1 | `/adjust?slider=ParametricHighlightSplit&amount=1` | `http://127.0.0.1:17891/adjust?slider=ParametricHighlightSplit&amount=1` |
| Curve Highlight Split | `ParametricHighlightSplit` | +5 | `/adjust?slider=ParametricHighlightSplit&amount=5` | `http://127.0.0.1:17891/adjust?slider=ParametricHighlightSplit&amount=5` |

---

## Browser/curl examples

Browser:

```text
http://127.0.0.1:17891/adjust?slider=Exposure&amount=1
```

PowerShell curl:

```powershell
curl.exe "http://127.0.0.1:17891/adjust?slider=Exposure&amount=1"
curl.exe "http://127.0.0.1:17891/reset?slider=Exposure"
curl.exe "http://127.0.0.1:17891/action?action=setAutoTone"
```

---

## Do not use for normal Companion buttons yet

These endpoints exist but are experimental:

```text
/get?slider=Exposure
/last-result
/set?slider=Exposure&value=1&experimental=1
```

Reason:

```text
LRBridge currently uses Lightroom Classic as the visible source of truth.
Stable feedback should be built later through a proper /state endpoint.
```

---

## For AI agents

When building a Companion module or fork:

1. Read `config/sliders.json` for slider IDs, labels, groups, ranges, and defaults.
2. Read `server/commands.js` for allowed action names.
3. Use `/adjust`, `/reset`, `/reset-group`, `/reset-all`, and `/action` first.
4. Do not build feedback on `/last-result`.
5. Do not treat `/set` as stable.
6. Keep Lightroom logic inside LRBridge, not inside the Companion module.

Correct future Companion architecture:

```text
Companion Module
        ↓
HTTP GET
        ↓
LRBridge API
        ↓
Lightroom plugin polling
        ↓
Lightroom Classic
```
