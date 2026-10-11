# Public-release blockers — separate from beta.4 functional work

Do not publish this private candidate. Native acceptance of the guarded Set and
Companion fine-button implementation remains pending.

## Security review carry-forward

The user identified unresolved findings from an earlier security review. Its full
artifact was not found in the selected handoffs or review documents. That review
has not been declared resolved or reproduced: recover and reconcile its exact
finding list before a public release.

Source inspection confirms items requiring an explicit public-release decision:

- `server/bridge.js` defaults to unspecified HTTP/WebSocket bind hosts. Its
  listeners can accept non-loopback connections, subject to network/firewall settings.
- Core mutation routes, internal plug-in routes and WebSocket command admission
  do not authenticate the caller. Context/receipt identifiers protect operation
  ownership; they are not authentication credentials. Review remote command
  admission and forged internal feedback together before distribution.

No security refactor, new dependency, authentication migration or bind-address
change was mixed into this candidate. These source findings do not replace the
missing earlier report or constitute a completed penetration test.

## Historical regression failures

Six failures already reproduced on unchanged beta.2 remain separate failures:

- `tests/lens-blur.js`
- `tests/develop-presets.js`
- `tests/contract-baseline.js`
- `tests/controller-http-limits.js`
- `tests/controller-command-tabs.js`
- `tests/release-docs-browser.js`

Reuse the completed beta.3 comparison in the original
`resume-verification-20261006` records. These failures were not repaired or hidden
in Point Color work. The full public release gate is not green.
