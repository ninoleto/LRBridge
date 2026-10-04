# LRBridge

LRBridge lets you control **Adobe Lightroom Classic** from a browser, hardware buttons and knobs, or scripts. It runs alongside Lightroom on your **Windows PC** and sends your adjustments to Lightroom, where the photo editing happens.

**[Download the recommended Windows beta — v0.6.0-beta.2](https://github.com/ninoleto/LRBridge/releases/latest)**

Requires Windows x64 and Lightroom Classic, not the cloud-based Lightroom app. The tested baseline is Lightroom Classic **15.4.1**; other versions have not been verified.

> **Looking for v0.6 source?** Use the [released source at v0.6.0-beta.2](https://github.com/ninoleto/LRBridge/tree/v0.6.0-beta.2). This homepage describes that release, but the application code on `main` is older. Downloading or running `main` does not give you v0.6. Use the release tag for v0.6 source, build instructions and documentation.

## What is LRBridge?

The project started as a way to connect Lightroom with **Bitfocus Companion**. Companion is an application that lets you assign commands to buttons and knobs on devices such as Stream Deck, Loupedeck and Razer Stream Controller. LRBridge supplies the connection that allows those controls to adjust Lightroom settings.

LRBridge has since grown into much more than that connection. Its included **Web Controller** puts Lightroom controls in a browser, ready to use with a mouse or touchscreen. Open it on your computer, or use a phone, tablet or another computer on the same trusted local network.

You can use the Web Controller directly with LRBridge and Lightroom, build a hardware setup through Companion, or use both together. **Companion and additional hardware are not required for the Web Controller.**

**HTTP Builder** primarily helps create custom commands for Companion’s **Generic: HTTP Requests** module. Its commands can also be used through PowerShell and other HTTP integrations. There is no LRBridge plug-in for Elgato’s native Stream Deck application; Stream Deck hardware connects through Companion.

Use LRBridge only on a **trusted local network or private VPN**.

## What is new in v0.6?

**This is the most complete LRBridge release so far**, with a substantially expanded Web Controller and many more Lightroom controls.

The earlier Web Controller used adjustment buttons and basic value feedback. In v0.6, interactive sliders show values reported by Lightroom. You can drag a slider, enter a value, make small adjustments with +/− buttons, and reset individual settings. Changes made directly in Lightroom can also appear in the Controller.

The available controls now cover:

- **Develop adjustments:** exposure, white balance, colour, detail, effects, calibration, lens corrections, transforms and HDR/SDR settings.
- **Colour and curves:** Color Mixer, Point Color, Color Grading, editable Point Curves and Parametric Curve adjustments.
- **Masking and editing tools:** supported mask adjustments, Crop, Healing, Red Eye, Lens Blur and Enhance controls.
- **Profiles and presets:** browse available choices, apply them and adjust their amount where supported.
- **Photo workflows:** selection, Copy/Paste Settings, export and other Lightroom actions.

This release also improves touch and Reset behavior, feedback, navigation and layouts. The Parametric Curve graph updates when its adjustment sliders are offscreen, including changes made in Lightroom or another browser.

LRBridge uses **Adobe’s official Lightroom plug-in SDK** for an extensive range of controls. Selected additional features use **experimental Windows automation** to operate Lightroom’s interface or read its current state. Some functions still need to be used directly in Lightroom, and some displayed values may take a moment to catch up.

## Get started on Windows

1. Open the [recommended release](https://github.com/ninoleto/LRBridge/releases/latest) and download **LRBridge-0.6.0-beta.2-win-x64-portable.zip** from **Assets**.
2. Extract the whole ZIP into a new writable folder. Keep its files together and quit any older LRBridge instance.
3. **Only if you want Dust controls:** close Lightroom and run **Install Dust Presets.cmd** from the extracted folder.
4. Start **LRBridge.exe**.
5. In Lightroom Classic, open **File → Plug-in Manager → Add**. Select the matching **lightroom\LRBridge.lrplugin** folder inside the extracted folder, enable it and click **Done**. Restart Lightroom after installing the plug-in or Dust presets.
6. In LRBridge, click **Open web controller**. Select a photo and switch Lightroom to **Develop** before sending editing commands.

Keep LRBridge and Lightroom running on the Windows PC. On a phone or tablet, use the PC’s network address shown in LRBridge. The Web Controller normally uses port **17892**. **Setup example on the same PC:** `http://127.0.0.1:17892/`. On another device, use the Windows PC’s LAN IP address instead; `127.0.0.1` means the device you are currently using.

For instructions, click **Open help** in the LRBridge application. See the [Windows installation and upgrade guide for v0.6](https://github.com/ninoleto/LRBridge/blob/v0.6.0-beta.2/docs/WINDOWS_BETA.md) for matching plug-in setup, Dust presets and preserving settings when upgrading.

## HTTP Builder and Bitfocus Companion

**HTTP Builder helps you create custom Lightroom commands without writing them manually.** Its main purpose is to make buttons and actions for Companion’s **Generic: HTTP Requests** module. Choose an action, enter its values and copy the generated request. SDK commands and experimental Windows automation commands are listed separately.

You can also copy PowerShell commands or use the generated HTTP requests in scripts and other integrations. **The Builder prepares and copies commands; it does not execute them.** Companion, PowerShell or your chosen software sends them to LRBridge.

To open the command builder, click **HTTP Builder** in the LRBridge application. The command cards include connection instructions. The HTTP API normally uses port **17891**. **API Base URL example on the same PC:** `http://127.0.0.1:17891`. From another device, use the Windows PC’s LAN IP address with port **17891**.

Companion can use either **Generic: HTTP Requests** with Builder-generated commands or the [separate LRBridge Companion module](https://github.com/ninoleto/companion-module-ninoleto-lrbridge), which provides its supported Lightroom actions in Companion’s menus.

**There is currently no LRBridge plug-in for Elgato’s Stream Deck application.** Stream Deck hardware can be used through Bitfocus Companion.

## Use a trusted network

Use LRBridge only on a **trusted local network or trusted private VPN**. It has no login or encrypted HTTPS connection. Anyone who can reach its controls may be able to send commands to Lightroom.

Do not expose ports **17890, 17891 or 17892** to the public internet, including through port forwarding or public tunnels. Restrict access to trusted devices, especially on shared Wi-Fi.

## Beta limitations

**This is a beta release.** Some controls may respond slowly or fail to show Lightroom’s latest settings. If something does not work as expected, use that control directly in Lightroom Classic.

- Some controls are experimental or unavailable. Creating a new Lens Blur refinement and choosing lens profiles still require Lightroom directly.
- Profile changes can appear in Lightroom before the Controller catches up. Lens Blur may show **Unavailable** or **Confirmation unavailable** after Lightroom applies a change.
- Tone Curve can occasionally get stuck waiting for Lightroom’s values. Refine Saturation may still jump in normal or Masking views. The Parametric preview can differ slightly from Lightroom’s graph.
- Auto Mask and Constrain Crop performance improvements are deferred.
- **There is no macOS package yet.** A future port still needs implementation and testing.

See the [v0.6 release notes](https://github.com/ninoleto/LRBridge/releases/tag/v0.6.0-beta.2) and [Windows guide](https://github.com/ninoleto/LRBridge/blob/v0.6.0-beta.2/docs/WINDOWS_BETA.md) for details.

## For developers and AI agents

Use the **v0.6.0-beta.2 release tag**, not the older application code on `main`. These links point to the source and documentation that match the published package:

- [Released source code](https://github.com/ninoleto/LRBridge/tree/v0.6.0-beta.2)
- [Source setup and developer workflow](https://github.com/ninoleto/LRBridge/blob/v0.6.0-beta.2/README.md)
- [Packaging documentation](https://github.com/ninoleto/LRBridge/blob/v0.6.0-beta.2/docs/RELEASE_CLEANUP.md)
- [HTTP API and workflows](https://github.com/ninoleto/LRBridge/blob/v0.6.0-beta.2/docs/HTTP_WORKFLOWS.md)
- [Starting point for developers and AI agents](https://github.com/ninoleto/LRBridge/blob/v0.6.0-beta.2/docs/AI_CONTEXT.md)
- [Curve compatibility notes](https://github.com/ninoleto/LRBridge/blob/v0.6.0-beta.2/docs/NATIVE_CURVE_COMPATIBILITY.md)
- [macOS porting guide](https://github.com/ninoleto/LRBridge/blob/v0.6.0-beta.2/docs/MACOS_PORTING.md) — future work, not a supported macOS release.

## Support and funding

Active development is currently paused due to limited time and funding. If LRBridge is useful to you, donations and contributions from other developers are welcome. Further development will depend on available resources and community support.

[Support LRBridge on Ko-fi](https://ko-fi.com/ninoleto).
