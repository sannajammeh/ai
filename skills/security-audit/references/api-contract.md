# API Contract and Secure Defaults

Not a bug class in the OWASP sense, but a category professional auditors always comment on. A library's *shape* determines whether it is safe-by-construction or safe-if-you-hold-it-right. The second is not good enough for production library code.

## Safe-by-default

For each security-relevant option in the library, ask:

- Is the safe value the default?
- Does it require an explicit, named opt-out?
- Is the opt-out name scary enough that a reviewer will notice?

Examples of good opt-out naming: `allowUnsafeRedirect`, `unsafe_disableVerification`, `INSECURE_allowAlgNone`. The word `insecure` or `unsafe` must appear.

Bad naming: `strict: false`, `relaxed: true`, `compat: "legacy"` — these hide the risk.

Flag any security-relevant toggle whose name doesn't telegraph the risk.

## Default-configuration review

Enumerate every option with a default, and ask what a zero-config consumer gets. Specific checklist:

- Redirect following: default-off for security-sensitive clients; default-on is acceptable only with loud documentation.
- TLS verification: always on; "disabled for dev" must require an env var or special option.
- Body size limits: present and sane (typically ≤ 10MB for general HTTP).
- Timeouts: present and non-default (Node's default of "wait forever" is a DoS surface).
- Log levels: never `debug` by default.
- Error verbosity: sanitized by default; stacks opt-in.

## Misuse-resistance

A misuse-resistant API makes the unsafe thing hard, or ideally impossible, to express. Techniques:

- **Typed tokens as branded types.** `type UserToken = string & { __brand: "UserToken" }` makes it a compile-time error to pass a raw string. Callers go through a constructor that asserts invariants.
- **Opaque configs.** Instead of an options object with a `password?: string`, accept a pre-constructed `Credentials` object produced by a factory that validates.
- **One-shot verifiers.** Auth verifiers that can only be called once per token (via internal nonce cache) block replay.
- **Required-context args.** State-changing methods require a `Session` arg; impossible to call without getting authenticated first.

Recommend misuse-resistance upgrades as *Recommendations beyond patches* unless the current API actively encourages a misuse-that-was-observed-in-the-wild, in which case it becomes a Medium finding.

## Public API minimality

The smallest public surface is the easiest to audit. Flag:

- Internal helpers accidentally exported (`exports` re-exports `./internal/*`).
- Test utilities exposed in production bundles.
- Debugging helpers (e.g., `_dumpState`) in the public API.

Check via `npm pack --dry-run` output + reading `exports` / `main` / re-exports.

## Error types

- Distinct error classes for each failure mode the caller might want to discriminate on (e.g., `AuthenticationError` vs. `RateLimitError`). Prose-only error messages push callers to string-match, which breaks across versions.
- `cause` chain set on wrapped errors (Node 16.9+).
- Errors should carry minimum context needed for the caller; see `credentials.md`.

## Deprecations

Security-relevant deprecations require a clear path:

- Announce in CHANGELOG + README.
- Emit a runtime `process.emitWarning` with `"DeprecationWarning"` and a code (`FOOLIB0001`) so it's filterable.
- Keep the old behavior available for ≥ one major version, then remove.
- Document a migration in a section dedicated to it.

## Versioning and breaking changes

A security fix sometimes requires a breaking change. The industry-accepted path:

- Ship the fix in the current major with a feature flag (default: safe).
- In next major, remove the flag.
- Alternatively, ship a parallel API (`encryptV2`) and deprecate the old.

Don't silently change behavior in a minor release even when the old behavior is insecure — it breaks consumers and makes maintainers distrust updates.

## Documentation expectations

For a library that claims to solve a security problem (auth, signing, sanitizing), the README must:

- State what threat model the library addresses.
- State what it does *not* address.
- Document each API's input contract including what is *not* validated.
- Document how to report vulnerabilities (a `SECURITY.md` with a private channel — email or HackerOne).

Flag `SECURITY.md` absence as an Observation; absence of threat-model documentation in a security primitive is at least Medium (a correctness-of-advertising issue).

## API-contract Findings — scoring

Contract findings are usually Medium unless they quietly undermine a security claim the library *makes*, in which case escalate to High. Example: a JWT library documented as "handles algorithm confusion for you" that actually accepts `alg: "none"` — the docs mislead; High.

## Finding wording

> `createClient({ verify = true })` defaults `verify` to `true`, but the option is read via destructuring with `verify: false` accepted without comment (`src/client.ts:12`). The option name is reasonable, but the documentation only describes the `true` path, so a consumer copy-pasting a "minimal" example from an unofficial guide may disable verification without understanding the consequence.

Patch (docs + API): rename the insecure path to `INSECURE_skipVerification` (deprecation bridge for `verify: false`), add a runtime warning when set, and document the risk explicitly.
