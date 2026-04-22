# Browser-specific Sinks

Browser-only concerns. Load when the target has any browser surface (check `browser` field in `package.json`, references to `window`/`document`, `/* @vite-ignore */` hints, `browser` conditional exports).

## HTML / DOM sinks

Covered in detail in `xss-dom.md`. Key pattern: caller-supplied string reaches an HTML-parsing sink without context-appropriate encoding.

## `postMessage`

- Sender side: check that `targetOrigin` is specified and not `"*"` when sending sensitive data.
- Receiver side: check `event.origin` against an allowlist. `addEventListener("message", handler)` without an origin check is the canonical mistake.
- Additionally verify `event.source` when expecting a reply from a known window.
- `structuredClone` semantics mean no prototype-pollution risk via the message, but the payload shape must still be validated.

## Iframes

- `<iframe src={userUrl}>` — same URL-scheme concerns as `<a href>`; `javascript:` URLs execute in the embedder.
- `sandbox` attribute — if the library renders iframes, default should include `sandbox="allow-scripts"` minus `allow-same-origin` for untrusted content. Explicitly document any `allow-same-origin` usage as a risk.
- `srcdoc` — same sink class as `innerHTML`; content must be sanitized.

## CSP (Content Security Policy)

Libraries don't set CSP themselves, but they can work well or poorly with it:

- Does the library use `eval` / `new Function`? That breaks `script-src` without `unsafe-eval`.
- Does the library use inline `<script>` or event handlers? Breaks `script-src` without `unsafe-inline` (or a nonce/hash).
- Inline styles? Breaks `style-src` without `unsafe-inline`.
- Does the library use `data:` URIs in images/scripts? Breaks `img-src`/`script-src` without `data:` listed.
- Does the library use blob URLs? `blob:` must be in the source list.

Document CSP compatibility in the README. For a library with eval: consider making it opt-out (a non-eval fallback) to support consumers with stricter CSPs.

Trusted Types: see `xss-dom.md`. If the library emits HTML, it should be Trusted-Types-aware.

## Cookies (browser)

Libraries setting cookies via `document.cookie`:

- No `HttpOnly` — `document.cookie`-set cookies cannot be HttpOnly; that's an inherent restriction of the API. If the library sets auth cookies, it must do so from the server; flag if client-side writes auth cookies.
- `SameSite`, `Secure` — syntactically set via `document.cookie = "a=b; SameSite=Lax; Secure"`.
- Consider the Cookie Store API (`cookieStore.set({...})`) for modern browsers — more structured, easier to audit.

## Storage

- `localStorage` / `sessionStorage` hold strings, accessible to any script in the origin (XSS full disclosure). Auth tokens in `localStorage` are a High finding for any library issuing tokens.
- IndexedDB: same-origin accessible, not inherently worse than localStorage for auth tokens.
- For persistent secrets client-side, there is no *safe* option. Use `HttpOnly`-cookie-plus-fetch-credentials, or no client persistence at all.

## `window.open`, navigation sinks

- `window.open(url, "_blank")` without `rel="noopener"` / `noreferrer` allows the opened tab to navigate the opener. In library code that opens windows with caller URLs, ensure `window.open(url, "_blank", "noopener,noreferrer")` or set `opener = null`.
- `location.assign` / `location.href = x` — redirects. If `x` is caller-supplied, it's an open-redirect primitive; enforce URL allowlist or same-origin-only.

## Clipboard

- `navigator.clipboard.writeText(text)` from input — minor risk (target attacker can get text), but notable if the library writes sensitive data like tokens to clipboard without opt-in. Flag as Medium.
- Clipboard *read* (`readText`) should require user gesture by platform rule; if the library does read, flag if it happens outside a user-initiated context.

## Fetch and XHR

- `fetch(url, { credentials: "include" })` — sends cookies / auth cross-origin if CORS allows. A library that sets `credentials: "include"` by default is flagged as High unless the library is transport-specific and the behavior is documented.
- Custom `Authorization` headers sent cross-origin: preflight revealed; if the library adds `Authorization` headers based on caller input, review whether the token's exposure is intended.

## Web Workers, Shared Workers, Service Workers

- Workers are same-origin by the `new Worker(url)` rule. A library that imports workers from cross-origin URLs via `importScripts` inside the worker is a script-injection primitive — flag.
- Service workers: libraries that install SWs (rare) need to document scope and update semantics. A buggy SW can persist malicious fetch interception across sessions.
- Message channel between worker and main: validate messages as untrusted.

## WebSocket

- `new WebSocket(url)` with caller `url` — same SSRF-like concerns as `fetch`, but SSRF-from-browser is less interesting (no cloud metadata access); still validate scheme and host.
- No origin check at the WebSocket server level in the library's backend examples — library docs often show a permissive server; call that out as a documentation gap if the library ships any server-side example.

## Trusted Context Features

- `SubtleCrypto`, `crypto.getRandomValues` — require Secure Context (`https:` or `localhost`). If the library fails silently in non-secure contexts, flag as an API-contract issue.
- Geolocation, payment, WebAuthn — require user gesture. A library that tries to prompt outside a gesture will fail silently; flag as UX/reliability, Informational.

## Finding wording

> `onMessage` in `src/client.ts:42` handles `window.addEventListener("message", …)` without checking `event.origin`. Any iframe embedded in the host page (third-party analytics, ad, social widget) can post messages that this handler executes. The handler updates library config, including the authentication endpoint URL.

Patch: add origin allowlist (configurable, defaulting to same-origin); reject messages with unexpected `source`; document the contract.

## Non-findings

- Libraries that never touch the DOM and only export pure functions — most of this doesn't apply.
- Libraries that document "requires Secure Context" and fail accordingly — not a finding.
