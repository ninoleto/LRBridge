# LRBridge 0.6.0-rc.1

RC1 packages the user-accepted LRBridge beta.4 application with the tested
beta4.10 Lightroom plug-in and the matching Companion 0.6.0-rc.1 module, whose
implementation is beta4.13. Newer Companion revisions did not require a newer
Lightroom plug-in. This is integration and release packaging, with no new
controller behavior or authentication/network redesign.

The owner accepts the [documented security limitations](PUBLIC_RELEASE_BLOCKERS.md)
for publication. Version `0.6.0-rc.1` is distributed as a normal GitHub release,
explicitly marked **Latest**, with `prerelease=false`. The version string and
accepted behavior are unchanged.

The [complete source at v0.6.0-rc.1](https://github.com/ninoleto/LRBridge/tree/v0.6.0-rc.1)
matches the package's source commit manifest. GitHub's source ZIP/tarball downloads
also refer to that tag. See the [contributor handoff](CONTRIBUTOR_HANDOFF.md) for
build instructions. Forks, issues and pull requests, including contributions
using AI coding agents, are welcome. Existing license terms are preserved;
continued maintenance and response times are not promised.

## Included changes

- Integrates the verified `Remove.lua`, `ColorGrading.lua`, `Crop.lua` and
  `Info.lua` update from the accepted installation. Before the RC1 metadata
  update, all four match the beta4.13 source archive's overlay hashes and the
  beta4.10 update ZIP; only Info.lua version metadata changes afterward.
- Sets package and Lightroom display metadata to `0.6.0-rc.1`.
- Retains native Windows helpers, Dust presets, SDK feedback, photo/context and
  Develop-revision guards, command queues and gesture/stale-response handling.
- Keeps the Companion module ID `ninoleto-lrbridge` and its existing mappings.

## Install or upgrade

1. Verify `LRBridge-0.6.0-rc.1-win-x64-portable.zip` against its SHA-256 sidecar.
   Extract into a **new writable folder**. Keep the previous working folder.
2. With LRBridge closed, copy your old `config/settings.txt` and, if used,
   `config/develop-presets.json` into the new folder. The download contains only
   public defaults; do not replace your preferences with those defaults.
3. With Lightroom closed, run `Install Dust Presets.cmd` from the new folder.
   It verifies the bundled presets and preserves conflicting existing files.
4. Run the new `LRBridge.exe`. In Lightroom Plug-in Manager, select the new
   `lightroom/LRBridge.lrplugin` folder and **reload the plug-in once** (or restart
   Lightroom) before manual validation. Avoid running both bridge copies.
5. Import `ninoleto-lrbridge-0.6.0-rc.1.tgz` into Companion and select it for the
   existing connection. Keep the connection settings and placed buttons.
6. Open the Web Controller and confirm the Lightroom connection. Check the
   displayed versions and ordinary controls on a disposable photo yourself.

The tested baseline is Windows x64, Lightroom Classic 15.4.1 and Companion 5.0.1.
See the [installation guide](WINDOWS_BETA.md) for Dust setup, configuration,
browser preferences and feature limitations. Use only a **trusted LAN or trusted
private VPN**. Listeners bind beyond loopback, and command/internal feedback
interfaces lack caller authentication. Do not expose LRBridge through public
port forwarding or tunnels. The earlier complete security review remains
unreconciled. These are accepted publication limitations, not claims of fixes.

## Verification

Run `npm ci`, `npm run test:release`, `npm run test:release -- --browser`, and
`npm run dist:win` from this source checkout. Guarded Set and Point Color checks
also run as focused checks. All automated tests use isolated fixtures; release
preparation must not issue commands to the user's Lightroom installation.

The final source checks pass **75/75 core** and **10/10 browser** checks.
Companion passes **265/265 tests** using Node 22.20.0 and Yarn 4.17.0, and its
executable bundle matches accepted beta4.13 byte-for-byte. Historical regression
fixtures were reconciled against the accepted implementation; production
behavior and assertion thresholds were preserved.

The generated `release-manifest.json` records version, source commit, source
cleanliness and every packaged file's SHA-256. Final package verification must
match source, staged `runtime/lightroom`, extracted plug-in files and resources.
Current results and accepted known limitations are recorded in
[PUBLIC_RELEASE_BLOCKERS.md](PUBLIC_RELEASE_BLOCKERS.md).
