# CSRF — Cross-Site Request Forgery

CWE-352. Libraries don't usually own the request boundary, but they *do* own cookies, state-change helpers, and session-issuing primitives that consumers rely on. A library that issues cookies without modern flags, or exposes state-changing endpoints without a CSRF mechanism, is responsible for the primitive being wrong.

## Cookie flags (must-haves)

For any library that sets cookies:

- `Secure` — transport-required. Should be default for auth-bearing cookies.
- `HttpOnly` — JS-inaccessible, blocks XSS-steal of session cookies.
- `SameSite=Lax` (or `Strict`) — mitigates most CSRF. `None` requires `Secure`.
- `Path` — limit to the specific path if possible.
- `__Host-` / `__Secure-` prefixes — defense-in-depth; the browser enforces related invariants.

Flag defaults that omit any of these for cookies that carry auth or identity. Explicit finding: "`Secure` and `HttpOnly` are unset on the issued session cookie (`src/session.ts:18`)". Note what a library-owned default should look like.

## Session / token issuing

If the library issues session or auth tokens:

- Session ids must be from `crypto.randomBytes(>=16)`, never predictable.
- Tokens should be rotated on privilege change (post-login rotation).
- Provide an explicit "logout invalidates server-side state" primitive; libraries that rely purely on cookie expiry for logout are broken by design.
- If using signed cookies: HMAC with a consumer-provided key (not a library-default key), signed-then-encrypted if encryption is desired, constant-time verification (see `timing.md`).

## State-changing endpoints the library exposes

If the library ships middleware or route handlers for state-changing actions (password reset, email change, etc.):

- The library should either require a CSRF token per request or rely on `SameSite` cookies it also controls.
- Double-submit-cookie patterns: verify the cookie and the body/header token match via constant-time compare.
- `SameSite=Lax` protects against most forms but not against `GET`-triggered state changes — so *never* make a state-changing endpoint respond to `GET`. Flag any route handler that changes state on `GET`.

## CORS

Libraries that configure CORS (or advise consumers):

- `Access-Control-Allow-Origin: *` combined with `Access-Control-Allow-Credentials: true` is rejected by browsers, but check if the library tries to do it in a way that sets both — users hit a surprise.
- Reflecting `Origin` header without a check is a common mistake; flag any middleware that echoes `Origin`.
- Preflight (`OPTIONS`) responses should carry the exact same `Access-Control-Allow-*` constraints — inconsistent preflight/actual CORS responses are often exploitable.

## CSRF tokens done right

If the library implements CSRF tokens:

- Token is per-session (or per-request for ultra-sensitive actions).
- Issued on a non-GET-triggerable path, tied to session id.
- Verified with constant-time compare.
- Token rotated on login / privilege change.
- Available to frontends via a `/csrf` endpoint OR injected into forms at render time — avoid exposing via a JS-readable cookie *only*, since this undermines `HttpOnly` for the session.

## Third-party integration helpers

OAuth / OIDC helpers:

- `state` parameter must be present, random (`crypto.randomBytes`), and verified on callback.
- `nonce` for OIDC must be present and verified.
- PKCE (`code_challenge` / `code_verifier`) should be default for public clients.
- Libraries that implement OAuth callback endpoints must validate the `state` is bound to the initiating session, not just "exists".

## Finding wording

> `createSession(userId)` issues a cookie with no `SameSite`, `Secure`, or `HttpOnly` attributes (`src/session.ts:22`). Consumers using this helper are vulnerable to session-cookie theft via any reflected-content bug on their site (XSS → `document.cookie`), and to cross-site request forgery on any mutating endpoint that trusts the cookie.

Patch: set `SameSite=Lax`, `HttpOnly`, `Secure` by default; accept an options object to override where intentional; document the contract.

## Non-findings

- CSRF is not a library concern if the library has no state-change surface and doesn't manage cookies. Don't invent one.
- `CORS` for a library that just provides utility functions and no HTTP surface — not in scope.
