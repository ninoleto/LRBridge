# Export and Copy/Paste on LAN HTTP

The released v0.6.0-beta.1 Controller called `crypto.randomUUID()` before its
Export and Copy/Paste error handlers. Browsers can omit that API on an ordinary
HTTP LAN address, so an enabled button could throw before sending any request.
Loopback HTTP normally counts as a secure context and did not expose the defect.

The focused browser correction shares
[`controller-request-id.js`](../app/controller-request-id.js) between
[`controller-export.js`](../app/controller-export.js) and
[`controller-clipboard.js`](../app/controller-clipboard.js). It uses
`crypto.randomUUID()` when available and otherwise constructs a UUID v4 from
16 bytes of `crypto.getRandomValues()` output. Only the standard version and
variant bits are fixed, preserving 122 random bits. No `Math.random` fallback,
clock/counter substitute or automatic command retry is used.

The existing `options.requestId` override remains supported. Generation failure
is caught before setting a pending operation or dispatching HTTP. The section
and Favorite action feedback say the command was not sent; polling an older
successful receipt cannot replace that explanation. A new explicit attempt or
a context change clears this local error. Selection/context bindings, duplicate
protection, operation receipts and Lightroom confirmation remain unchanged.

## Focused verification

From the source folder:

```powershell
node tests/controller-request-id.js
node tests/controller-request-id-browser.js
node tests/controller-browser-lifecycle.js --export-only
node tests/controller-browser-lifecycle.js --clipboard-only
```

The new browser test uses installed Edge/Chrome, the production Controller HTML
and scripts, and isolated synthetic API fixtures. It opens both loopback and an
actual private LAN IPv4 address. If needed, set `LRBRIDGE_TEST_LAN_IP` to this
computer's LAN address. It requires `isSecureContext === false` and a genuinely
absent `randomUUID` on the LAN origin, then checks Export, Export with Previous,
Quick Copy Settings and Paste Settings each dispatch exactly once through the
correct `/api/.../action` route. It also checks unique UUIDs, secure entropy
failure, retained error messages, no retries and the request-ID override.

Before the correction, the four LAN actions produced zero requests and four
uncaught `randomUUID is not a function` errors, while all four loopback actions
dispatched. With the correction, all four LAN actions use secure random bytes
and dispatch once; loopback retains native UUID generation.

These automated checks use browser/HTTP fixtures, **not native Lightroom
confirmation**. The user subsequently reported successful testing and accepted
private build **20261004T163816Z** for publication as **v0.6.0-beta.2**. This records
acceptance within the reported scope; it does not claim additional devices,
selection sizes or export scenarios were manually tested.

The accepted application package is retained byte-for-byte under the distinct
beta.2 download filename, after verification against the committed source.
This browser-only fix does not require a plug-in reload when the matching
released production plug-in is already running. Do not repeat an uncertain
request without checking Lightroom.
