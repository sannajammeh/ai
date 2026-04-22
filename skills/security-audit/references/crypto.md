# Crypto Misuse

CWE-327 (broken/risky primitives), CWE-326 (inadequate strength), CWE-338 (weak RNG). Crypto bugs are rarely "use AES", they're "use AES correctly". For library authors, the bar is high: a crypto primitive that is misused by default is a Critical finding.

## Randomness

### Patterns to flag

- `Math.random()` used anywhere near a security decision (token, session id, nonce, salt, CSRF token, password reset link, probabilistic auth, UUID that's expected to be unpredictable).
- Date-based token seeds: `Date.now().toString(36)` — predictable.
- Homegrown PRNGs or "quick UUID" generators.
- `crypto.randomBytes(n)` where `n` is small and the result is used as a secret (e.g., 4-byte tokens).

### Safe primitives

- Node: `crypto.randomBytes(n)` (async or sync), `crypto.randomUUID()` for v4 UUIDs, `crypto.randomInt(min, max)` for integers.
- Browser: `crypto.getRandomValues(new Uint8Array(n))`, `crypto.randomUUID()` in Secure Contexts.
- For tokens: 16 bytes (128 bits) of randomness is the floor; 32 bytes is the typical choice.

## Hashing

### Patterns to flag

- `crypto.createHash("md5")` or `"sha1"` for anything security-adjacent.
- Raw SHA-256 (or anything) for password storage. Passwords need a KDF, not a hash.
- HMAC with a non-constant-time compare for verification (see `timing.md`).

### Safe primitives

- Password storage: Argon2id (via `argon2` package) is the modern choice. `scrypt` (Node built-in via `crypto.scrypt`) is acceptable. `bcrypt` is acceptable up to ~72 bytes. PBKDF2 is acceptable but dated — if using, set iterations to current NIST recommendation and document.
- Content hashing (integrity, not secrets): SHA-256 or SHA-384. SHA-512 is fine.
- HMAC for message integrity: `crypto.createHmac("sha256", key)`.

## Symmetric encryption

### Patterns to flag

- `crypto.createCipher(algorithm, password)` — deprecated, derives key from password with MD5, always wrong.
- Mode = `ECB` — never for multi-block data.
- Mode = `CBC` without a separate MAC (encrypt-then-MAC) — unauth encryption is vulnerable to padding-oracle attacks.
- Static or missing IV/nonce.
- Nonce reuse with GCM, CCM, ChaCha20-Poly1305 — catastrophically breaks confidentiality and authenticity.
- Same key used for both encryption and MAC without domain separation.

### Safe primitives

- AES-256-GCM with a fresh 12-byte random nonce per message, or XChaCha20-Poly1305 when available.
- Derive keys with HKDF (`crypto.hkdfSync`) from a master key, with a context string per use ("auth-cookie", "storage-enc", etc.) to enforce domain separation.
- Store nonce and ciphertext and tag; don't truncate the tag.

### Nonce discipline checklist

- Is the nonce generated per-message? (random or counter)
- If counter-based, is there a guard against resets (e.g., persistent counter, or random nonce)?
- Is the nonce carried alongside ciphertext at rest?
- Does any code path ever reuse a key across contexts? HKDF-separate them.

## Asymmetric crypto

### Patterns to flag

- RSA with PKCS#1 v1.5 padding for encryption. Prefer OAEP. (Signing with PKCS#1 v1.5 is acceptable but PSS is preferred for new code.)
- RSA with keys < 2048 bits.
- Elliptic-curve operations using non-standard curves or custom implementations. Use `node:crypto` KeyObjects or WebCrypto SubtleCrypto only.
- Signing without domain separation: if the library signs messages for multiple purposes with one key, flag.
- Use of `crypto.sign`/`crypto.verify` without an explicit algorithm — older APIs accepted `null` digest; this was a bug vector.

## JWT

If the library issues or verifies JWTs:

- **Algorithm confusion.** Flag any verifier that accepts `alg` from the token header without pinning (e.g., `jwt.verify(token, key)` — check the options). Pin expected algorithms: `{ algorithms: ["RS256"] }`.
- **`alg: "none"`.** Any path that tolerates this is a finding, period.
- **HS vs. RS confusion.** If the public key can be passed as the HMAC secret, an attacker who knows the public key can forge tokens. The fix is pinning `algorithms`.
- **Key injection via `jku`/`jwk`/`x5u` headers.** If the library blindly fetches keys from URLs in token headers, that's SSRF + auth-bypass. The library should only resolve keys from a trusted key set.
- **Missing `exp`/`nbf` checks.** Libraries that issue tokens must set `exp`. Verifiers must enforce it.
- **`kid` / key id.** Treat as an opaque identifier. Don't use it as a file path or SQL key.

## TLS and network crypto

- `NODE_TLS_REJECT_UNAUTHORIZED=0` anywhere — critical.
- `rejectUnauthorized: false` in HTTPS/TLS options — critical unless inside a test file.
- Custom `checkServerIdentity` that returns `undefined` for all inputs — critical.
- Pinning certificates without a rotation plan — flag as Medium ("operational risk").

## Key handling

- Keys as hex or base64 strings passed through functions that end up in error messages.
- Keys in URLs (always bad).
- Keys in logs (see `credentials.md`).
- Keys hard-coded in source — CWE-798. Always a finding, even if the code comments say "test key". Published libraries ship these to the registry.
- Keys stored in `localStorage` (for a browser library issuing keys). Flag as High — any XSS extracts them.

## Random constants and secret material

- Any `const SECRET = "…"` in source is a finding if the library uses it as a secret. Even if it's a default, it's a finding — the fix is requiring the caller to pass one, with a non-optional type.
- Initialization vectors hard-coded to zero (`Buffer.alloc(12)`) — standard anti-pattern.

## Crypto ergonomics to flag at API-contract level

- Functions that accept a `password` parameter without specifying KDF in the docs — callers will pass raw passwords.
- Functions that return `{ cipher, tag }` separately with no canonical wire format — invites nonce/tag/aad misorder.
- Functions that default `associatedData` to the empty string — callers skip it, enabling tag substitution.

## Finding wording

> `encrypt(plaintext, password)` derives a key from `password` with a single round of MD5 via `crypto.createCipher`, then encrypts with AES-256-CBC without authentication (`src/enc.ts:22`). The result is malleable (no MAC) and the key derivation has ~0 cost for a GPU attacker.

Patch: switch to `crypto.createCipheriv` with AES-256-GCM, require a key (not a password) or derive via `scrypt`/Argon2, append IV and tag to ciphertext, return a canonical encoding. Update types and changelog accordingly.
