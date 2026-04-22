# Credential and Secret Leakage

The library sees secrets in memory — API keys, tokens, cookies, passwords, private keys. Any of these escaping into logs, error messages, URLs, telemetry, or repeated error pathways is a finding.

## Logging

### Patterns to flag

- `logger.info(requestObject)` where `requestObject` includes headers — `Authorization`, `Cookie`, `Proxy-Authorization`, `Set-Cookie` — printed verbatim.
- `logger.debug({ config })` where config contains `password`, `apiKey`, `secret`, `token`, or `privateKey` fields.
- Exception loggers that dump `err.stack` containing the original call arguments via V8's `Error.captureStackTrace` with `Error.prepareStackTrace` patched — rare, but if the library patches this globally, flag.
- Third-party telemetry (Sentry, Datadog wrappers) called with full request/response bodies.

### Safe pattern

Introduce a redactor:

```ts
const REDACTED = "[REDACTED]";
const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization", "x-api-key"]);
const SENSITIVE_FIELDS = /^(password|passwd|pwd|secret|token|apikey|api_key|privatekey|private_key|authorization|auth|session|cookie|x-api-key)$/i;

function redact(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.test(k)) out[k] = REDACTED;
    else if (k.toLowerCase() === "headers") out[k] = redactHeaders(v);
    else out[k] = redact(v);
  }
  return out;
}
```

Apply it at the logger boundary, not at every call site — call sites will forget.

### Error messages

Errors thrown from deep in the library may contain secrets. Specific patterns:

- `throw new Error("failed to parse token: " + token)` — now the token is in the message, which tends to get logged.
- `throw new Error("fetch failed for url: " + url)` — URL may contain credentials or reset tokens in query params.
- `AggregateError` wrappers that preserve causes with embedded secrets.

Policy: error messages may not contain caller-supplied tokens, keys, or URL-embedded credentials. For context, refer to an opaque id (e.g., request id) and log the full context elsewhere under a redactor.

## URLs

### Patterns to flag

- Redirect URLs that include reset tokens as query params and end up in `Referer` headers of the next request.
- Logging of full URLs without stripping query string.
- Passing URLs to subprocesses (which log argv in process listings on Linux — `ps` shows secrets).
- Webhook libraries that include secrets in the URL path.

### Safe pattern

- Tokens belong in `Authorization` headers, not URLs, when feasible.
- If a token must be in a URL (e.g., OAuth redirect), scrub it from logs at parse time — store the URL without the token for logging purposes.

## Memory hygiene

JavaScript does not expose a reliable way to wipe memory — strings are immutable and interned, typed arrays can be zeroed but garbage-collected copies may persist. Claims of "secure memory" in pure JS are false. Best efforts:

- Use `Buffer`s / `Uint8Array`s for key material where possible; `.fill(0)` after use.
- Don't convert key material to `String` (it's interned). If you must, destroy the Buffer view afterward, though the string may linger.
- If the library is a crypto primitive, document this limitation explicitly in the README.

Don't produce a finding just because the library uses strings for keys — note as Informational with the above framing.

## Telemetry / error reporting

If the library ships Sentry / Datadog / analytics integration:

- Check default sampling for request bodies.
- Check whether `beforeSend` redactors are installed and enumerate the fields they cover.
- Any default that sends *full* request/response bodies is at least High.

## Stored secrets (for libraries that persist state)

- Tokens at rest in the library's cache should be encrypted only if the cache is in untrusted storage. For in-memory caches, don't.
- Password hashes in persistent state — use a KDF (see `crypto.md`).
- API keys stored in `localStorage`/`sessionStorage` in a browser library → always a finding. See `browser-sinks.md`.

## Env vars and config files

- If the library reads `process.env.*_SECRET` and logs the config on startup, the secret ends up in stdout. Redact.
- `.env` files committed to the repo — flag via a scan of the repo, not runtime.
- `dotenv`-style auto-loading in a library is a red flag; libraries shouldn't reach into consumer env without explicit opt-in.

## Stack traces

Stack frames include argument values for synchronous errors in some Node versions (`--stack-trace-limit`, `util.inspect` of args). Sanitize `err.stack` before including in external responses or logs.

For libraries that construct error responses (e.g., an HTTP framework plugin), default should be: never include stack in responses. Make debug stack opt-in, and warn in docs.

## Finding wording

> `fetch` wraps errors from the underlying HTTP client and includes the full request URL in the thrown error's message (`src/client.ts:118`). Callers that include reset tokens, session ids, or OAuth codes in the query string will leak them into any log that captures error messages.

Patch: scrub query strings in error messages, reference a request id instead.

## Non-findings to filter

- Error messages that include *caller-controlled non-secret* data are fine; don't flag defensively.
- Debug logs gated behind `DEBUG=...` that are not enabled by default are not findings unless they log secrets and consumers might reasonably turn them on in production.
