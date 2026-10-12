# LRBridge

LRBridge lets you control **Adobe Lightroom Classic** from a browser, hardware buttons and knobs, or scripts. It runs alongside Lightroom on your Windows PC and sends your adjustments to Lightroom, where the photo editing happens.

**[Download LRBridge 0.6.0-rc.1 for Windows x64](https://github.com/ninoleto/LRBridge/releases/download/v0.6.0-rc.1/LRBridge-0.6.0-rc.1-win-x64-portable.zip)** · [Release downloads](https://github.com/ninoleto/LRBridge/releases/latest)

Requires **Windows x64 and Lightroom Classic**, not the cloud-based Lightroom app. The tested Lightroom version is **15.4.1**.

## What is LRBridge?

The project started as a way to connect Lightroom with **Bitfocus Companion**. Companion is an application that lets you assign commands to buttons and knobs on devices such as Stream Deck, Loupedeck and Razer Stream Controller. LRBridge supplies the connection that allows those controls to adjust Lightroom settings.

LRBridge has since grown into much more than that connection. Its included **Web Controller** puts Lightroom controls in a browser, ready to use with a mouse or touchscreen. Open it on your computer, or use a phone, tablet or another computer on the same trusted local network.

You can use the Web Controller directly with LRBridge and Lightroom, build a hardware setup through Companion, or use both together. **Companion and additional hardware are not required for the Web Controller.**

## Lightroom controls

The Web Controller provides interactive sliders that show values reported by Lightroom. You can drag a slider, enter a value, make small adjustments with +/− buttons, and reset individual settings. Changes made directly in Lightroom can also appear in the Controller.

The available controls cover:

- **Develop adjustments:** exposure, white balance, colour, detail, effects, calibration, lens corrections, transforms and HDR/SDR settings.
- **Colour and curves:** Color Mixer, Point Color, Color Grading, editable Point Curves and Parametric Curve adjustments.
- **Masking and editing tools:** supported mask adjustments, Crop, Healing, Red Eye, Lens Blur and Enhance controls.
- **Profiles and presets:** browse available choices, apply them and adjust their amount where supported.
- **Photo workflows:** selection, Copy/Paste Settings, export and other Lightroom actions.

RC1 includes Point Color swatch selection, updates to Reset handling, and more responsive Crop Angle, Color Grading and Healing controls. The matching Companion module also updates Zoom and Lens Blur/Healing feedback. Existing Companion buttons and connection settings can be kept when upgrading. Export and Copy/Paste Settings work when the Web Controller is opened from another device on the trusted network.

**HTTP Builder** helps you create custom Lightroom commands for Bitfocus Companion’s Generic: HTTP Requests module. You can also copy PowerShell commands or HTTP requests for scripts and other integrations.

LRBridge uses **Adobe’s official Lightroom plug-in SDK** for an extensive range of controls. Selected additional features use **experimental Windows automation** to operate Lightroom’s interface or read its current state. Some functions still need to be used directly in Lightroom, and some displayed values may take a moment to catch up. The remaining limitations are explained below.

## Basic Windows installation

Requires **Windows x64 and Adobe Lightroom Classic**, not the cloud-based Lightroom app. Tested with **Lightroom Classic 15.4.1**; other versions have not been verified.

1. Open the [latest release](https://github.com/ninoleto/LRBridge/releases/latest) and download **[LRBridge-0.6.0-rc.1-win-x64-portable.zip](https://github.com/ninoleto/LRBridge/releases/download/v0.6.0-rc.1/LRBridge-0.6.0-rc.1-win-x64-portable.zip)** from **Assets**. This is the application ZIP; GitHub’s “Source code” downloads are for developers.
2. Extract the whole ZIP into a **new writable folder**. Keep its files together, preserve your previous folder and settings, and quit any older LRBridge instance.
3. **To use Dust controls under Healing:** close Lightroom and run **Install Dust Presets.cmd** from the extracted LRBridge folder. This installs the helper presets required by the Dust On, Off and Reset buttons.
4. Start **LRBridge.exe**.
5. Open Lightroom Classic's **File → Plug-in Manager → Add**. Select the matching **lightroom\LRBridge.lrplugin** folder inside your extracted LRBridge folder, enable it and click **Done**. Restart Lightroom after installing the plug-in or Dust presets.
6. In LRBridge, click **Open web controller**.
7. Select a photo in Lightroom and switch to **Develop** before sending editing commands.

**Why Dust needs this extra step:** Dust On and Off apply the included helper presets automatically; you do not need to select them manually in Lightroom. Install the presets before using Dust On, Off or Reset. Reset clears Dust while preserving manual Healing repairs. Dust Size, Visualize Spots, Threshold and other Healing controls do not require this installer. If Dust status is unavailable, check Lightroom’s Apply checkbox.

Upgrading? Use the plug-in from the new folder, replacing the old entry in Plug-in Manager. Read the [Windows installation and upgrade guide](https://github.com/ninoleto/LRBridge/blob/v0.6.0-rc.1/docs/WINDOWS_BETA.md) to preserve your settings. The Dust installer handles supported older preset copies; do not import duplicates.

## Open and use the standalone Web Controller

Keep LRBridge and Lightroom Classic running on your Windows PC. Open the Controller, check its Lightroom connection indicator, then choose the controls you want to use.

The Web Controller normally uses port **17892**:

- **Setup example on the Windows PC:** open `http://127.0.0.1:17892/`, or click **Open web controller** in LRBridge.
- **On a phone or tablet:** connect to the same trusted network and open the PC's network address shown by LRBridge. It uses the PC's LAN IP address and port **17892**.

“Localhost” and `127.0.0.1` mean **the device you are currently using**. On a phone, they refer to the phone, not your Windows PC. Use the PC's LAN address there instead.

For instructions, click **Open help** in the LRBridge application.

A [repository copy of Help](https://github.com/ninoleto/LRBridge/blob/v0.6.0-rc.1/app/controller-help.html) is also available.

## HTTP Builder and Bitfocus Companion

**HTTP Builder helps you create Lightroom commands without writing them manually.** Its main purpose is to make custom buttons and actions for Bitfocus Companion’s **Generic: HTTP Requests** module.

Choose a Lightroom action, enter its values and copy the generated request into Companion. SDK commands use Adobe’s official Lightroom plug-in interface; experimental Windows automation commands are listed separately.

You can also use HTTP Builder without Companion. Copy a PowerShell command to run on your computer, or use the generated HTTP requests in scripts and custom integrations that send commands over your network. **The Builder prepares and copies commands; it does not execute them.** Companion, PowerShell or your chosen software sends them to LRBridge.

**There are two ways to connect Companion:**

- **Generic: HTTP Requests:** use commands generated by HTTP Builder to create your own actions.
- **The LRBridge Companion module:** choose its supported Lightroom actions directly from Companion’s menus. Download **[ninoleto-lrbridge-0.6.0-rc.1.tgz](https://github.com/ninoleto/companion-module-ninoleto-lrbridge/releases/download/v0.6.0-rc.1/ninoleto-lrbridge-0.6.0-rc.1.tgz)** from the [matching Companion 0.6.0-rc.1 release](https://github.com/ninoleto/companion-module-ninoleto-lrbridge/releases/tag/v0.6.0-rc.1), import it into Companion and select it for your LRBridge connection. Keep your existing buttons and connection settings. Tested with **Companion 5.0.1**.

**There is currently no LRBridge plug-in for Elgato’s Stream Deck application.** Stream Deck hardware can be used through Bitfocus Companion.

To open the command builder, click **HTTP Builder** in the LRBridge application. There you’ll find the command cards and connection instructions.

## SDK and Windows automation, explained simply

The SDK is Lightroom's official way for plug-ins to request changes. Windows automation works through Lightroom's interface instead. Some controls send changes through the SDK but use Windows automation to check what Lightroom is displaying, so the Controller's status can arrive later than the change itself.

## Security warning

Use LRBridge only on a **trusted local network or trusted private VPN**. It has no login or encrypted HTTPS connection. Anyone who can reach its controls may be able to send commands to Lightroom.

**Do not expose ports 17890, 17891 or 17892 to the public internet**, including through port forwarding or public tunnels. Restrict access to trusted devices, especially on shared Wi-Fi.

## Known limitations

Some controls may respond slowly or fail to show Lightroom’s latest settings. If something does not work as expected, use that control directly in Lightroom Classic.

- **Some controls are experimental or unavailable.** Creating a new Lens Blur refinement and choosing lens profiles still require Lightroom directly.
- **Profile feedback:** Lightroom may apply a change before the Controller catches up. A “command sent” message does not mean Lightroom has finished.
- **Tone Curve:** can occasionally get stuck waiting for Lightroom's values.
- **Refine Saturation:** may still jump in normal or Masking views.
- **Parametric Curve:** the preview can differ slightly from Lightroom's graph.
- **Lens Blur:** some controls may show ‘Unavailable’ or ‘Confirmation unavailable’ even after Lightroom applies the change.
- **Auto Mask and Constrain Crop:** performance improvements are deferred.
- **There is no macOS package yet.** The porting guide describes future work and testing needs, not current macOS support.

## For developers and AI-assisted development

**Built with AI assistance:** LRBridge was developed with extensive help from ChatGPT and Codex—a process often called ‘vibe coding’. Its features and interface were guided by the maintainer and tested through hands-on use in Lightroom Classic. The source code and development notes are available so other developers and AI agents can review the implementation, fix remaining issues and continue the project.

The current application source branch is **[release/0.6.0-rc.1](https://github.com/ninoleto/LRBridge/tree/release/0.6.0-rc.1)**. The **[v0.6.0-rc.1 tag](https://github.com/ninoleto/LRBridge/tree/v0.6.0-rc.1)** matches the published package. The `main` branch hosts this homepage and older application code; start development from the current source branch or release tag.

- [Contributor handoff: build instructions, tested versions and safeguards](https://github.com/ninoleto/LRBridge/blob/v0.6.0-rc.1/docs/CONTRIBUTOR_HANDOFF.md)
- [HTTP API and workflows](https://github.com/ninoleto/LRBridge/blob/v0.6.0-rc.1/docs/HTTP_WORKFLOWS.md) · [AI-agent context](https://github.com/ninoleto/LRBridge/blob/v0.6.0-rc.1/docs/AI_CONTEXT.md)
- [Source manifest and build provenance](https://github.com/ninoleto/LRBridge/releases/download/v0.6.0-rc.1/LRBridge-release-manifest.json) · [Package checksums](https://github.com/ninoleto/LRBridge/releases/download/v0.6.0-rc.1/LRBridge-SHA256SUMS.txt)
- [Detailed known limitations and publication decision](https://github.com/ninoleto/LRBridge/blob/v0.6.0-rc.1/docs/PUBLIC_RELEASE_BLOCKERS.md) · [macOS porting notes](https://github.com/ninoleto/LRBridge/blob/v0.6.0-rc.1/docs/MACOS_PORTING.md)

Forks, issues and pull requests are welcome, including work with AI coding agents. Existing license terms remain unchanged. Continued maintenance, review times and future releases are not promised.

## Support and funding

Active development is currently paused due to limited time and funding. If LRBridge is useful to you, donations and contributions from other developers are welcome. Further development will depend on available resources and community support.

[Support LRBridge on Ko-fi](https://ko-fi.com/ninoleto).
