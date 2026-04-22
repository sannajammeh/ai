# Rate Limiting, Brute Force, Enumeration

CWE-307, CWE-799. Libraries that own expensive operations, authentication, verification flows, or user enumeration vectors need thought about throttling. The library often can't enforce cross-request rate limits on its own (it doesn't own the transport), but it must:

1. Not be expensive-by-default without documenting the cost,
2. Not enable enumeration via error-message or timing differentiation,
3. Provide hooks or primitives that consumers can wire up to a real throttle.

## Where to look

- Login / verify-password flows.
- Token mint/verify that runs a KDF.
- Password reset or email verification flows.
- Invite / membership lookup.
- Any public function whose work scales with input size (parsers, regex runners).

## Enumeration hazards

If the library tells the world *which* part failed, it enables enumeration:

- "Email not found" vs. "Wrong password" — classic user enumeration.
- "Invite code invalid" vs. "Invite code expired" — distinguishes valid-but-used from never-issued.
- Different HTTP status codes for the same category of failure.
- Different response body structures.

Mitigations:

- Single generic failure mode from outside: same response, same timing (see `timing.md` for the timing angle).
- Internal code can still distinguish; external observer should not.

## Brute-force-resistance primitives

- For password verification, use a costly KDF (Argon2id / scrypt / bcrypt) — see `crypto.md`.
- For OTP / token guessing, expose an attempt-counter hook:

```ts
export async function verifyOtp(otp: string, ctx: VerifyCtx) {
  const allowed = await ctx.onAttempt({ subject: ctx.subject });
  if (!allowed) throw new TooManyAttemptsError();
  // …verify
}
```

The library does not *implement* the throttle; it *requires* the consumer to provide an `onAttempt` hook.

- Exponential backoff on repeated failures, if the library owns state.
- Account lockout — controversial; prefer per-IP + per-account throttles with automatic recovery over hard lockouts which are themselves a DoS vector.

## Token / secret entropy

Any token the library generates must be long enough that brute forcing is infeasible against realistic rate limits:

- Session tokens: ≥ 128 bits (16 random bytes).
- Password reset / email verify tokens: ≥ 128 bits, short expiry (15 min typical).
- OTPs: 6 digits is industry standard but requires attempt limits; 8 digits if no attempt limit enforced.
- API keys: ≥ 128 bits.

Flag any generator that produces < 128 bits for secrets.

## Timing-safe comparison in verify paths

See `timing.md`. In this domain specifically: verify paths that run through a constant-time compare of the whole token remove a whole class of incremental guessing attacks.

## Hooks for integration with throttles

Prefer *accepting* a `rateLimit`-shaped callback over *implementing* a specific store. Hooks let the library stay transport-agnostic and test-friendly:

```ts
type RateLimit = (key: string, cost: number) => Promise<{ allowed: boolean; retryAfterMs?: number }>;
```

Document the expected semantics: is `cost` tokens-bucket? Is the limit per-key-per-window? Be specific or consumers will reach for a single global limiter and get it wrong.

## Expensive-by-default

A library that performs a heavy computation on a caller-supplied input without either:

- A stated big-O bound in terms of input size, *or*
- An explicit resource cap (max input length, max depth, max fan-out)

…is a DoS vector. See `resource-exhaustion.md` for the primitive-level view; for the rate-limit angle, flag that a single request can pin CPU for N seconds and recommend a max-input guard.

## Finding wording

> `verifyOtp(code)` performs a constant-time compare against the stored OTP but does not invoke any attempt-counter or throttle (`src/otp.ts:34`). A 6-digit OTP with no attempt cap is brute-forceable in ~1e6 HTTP attempts; at 1k QPS, that's under 20 minutes.

Patch: add a mandatory `onAttempt` hook to the function signature, with a deprecation bridge for existing callers (see `reporting.md` on destructive changes).

## Non-findings

- Pure utility libraries (e.g., a JSON formatter) don't need rate-limit hooks.
- Rate limiting is not a finding for libraries that explicitly don't own auth and document this.
