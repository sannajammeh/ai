# Timing Attacks

CWE-208 / CWE-203. Any comparison of a secret (token, signature, password hash, MAC) against user input must be constant-time. Non-constant-time `===`, `==`, `Buffer.compare`, or character-by-character loop leaks the secret byte by byte across many attempts.

## Constant-time compare in Node

- `crypto.timingSafeEqual(a, b)` — requires both operands to be `Buffer`s (or typed arrays in newer versions) of the *same length*. If lengths differ, it throws.
- To compare safely when lengths may differ: hash both sides with a fixed-length digest (HMAC with a fixed key, or SHA-256) and `timingSafeEqual` on the digests. Length-difference itself can leak; the hash normalizes length and adds a small oracle cost.

```ts
import { createHash, timingSafeEqual } from "node:crypto";

function eqTokens(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
```

If both are Buffers of known equal length (e.g., digests, fixed-length tokens), skip the extra hash:

```ts
timingSafeEqual(Buffer.from(a), Buffer.from(b));
```

## Constant-time compare in the browser

Browser `SubtleCrypto` does not expose a constant-time comparator. Implement:

```ts
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
```

Two caveats:

1. JS engines may optimize this loop; in practice the variance is dominated by JIT warmup, not byte-by-byte leaks, but the pattern is still the ecosystem-accepted best effort.
2. The length check at the top leaks *length equality*. If lengths are themselves secret (rare), pad both to a fixed size first.

## What to search for

Patterns that indicate non-constant comparison of secrets:

```
== \s*(secret|token|sig|mac|hash|signature|hmac|digest|expected)
=== \s*(secret|token|sig|mac|hash|signature|hmac|digest|expected)
Buffer\.compare\(.*(secret|token|sig|mac|hash)
for\s*\(.*\b(secret|token|sig)\[
\.slice\(.*\)\s*===
```

Also check:

- Token parsers that return early on mismatch character-by-character.
- HMAC verification that uses `===` on the hex-encoded digest.
- Password reset flows that compare the submitted token to the stored token with `===`.

## Error-message timing

Even with a constant-time compare, error paths can leak timing. Examples:

- User-not-found vs. wrong-password paths that differ in work done (wrong-password triggers a KDF, user-not-found returns immediately → attacker enumerates usernames by timing).
- JWT verify fast-paths that reject malformed tokens synchronously but do crypto for valid-shape-but-wrong-sig tokens → attacker differentiates shape validity.

Mitigations:

- Do equivalent work on both branches. For auth, hash a dummy password when the user doesn't exist.
- Or introduce randomized jitter — but jitter is a weak defense; noise washes out with sample size. Prefer equal-work.

## Cache-timing and CPU-microarchitectural leaks

For libraries shipped to clients (especially browser), the usual JS-land advice applies: don't implement your own AES in JS table-lookup form, don't roll your own ECC. Use `SubtleCrypto`. Finding threshold: any library that implements crypto primitives in pure JS (not via `crypto`/`subtle`) is at least Medium unless specifically documented for obscure platforms and clearly marked as such.

## When a library is *not* required to be constant-time

- Comparisons of public, non-secret identifiers (e.g., request IDs) — not a finding.
- Comparisons of values where the attacker already knows both sides — not a finding.

Be wary of flagging Low-severity timing issues that aren't exploitable; report only when a reasonable caller pattern lets an attacker probe.

## Finding wording

> `verifyToken(submitted)` compares `submitted` against the stored token with `===` (`src/auth.ts:54`). A remote attacker who can attempt tokens observes a timing difference proportional to the number of leading bytes that match, leaking the stored token byte by byte. With a modest number of samples per byte, the full token is recoverable.

Patch: switch to `timingSafeEqual` on equal-length Buffers (or hash-and-compare if lengths vary).

## Gotchas

- `Buffer.compare` returns `-1 | 0 | 1` and is *not* constant-time.
- `a.equals(b)` on Buffer is not constant-time.
- `timingSafeEqual` throws on length mismatch — handle via hash-and-compare or explicit length check that itself does not leak the expected length.
- Some libraries use `crypto.timingSafeEqual` but stringify both sides first (`Buffer.from(a, "utf8")`), then timing-safely compare — this is correct *provided* both operands are the same length. Double-check.
