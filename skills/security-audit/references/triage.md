# Triage: Exploitability-First Severity Rubric

We grade on exploitability, not theory. OWASP labels help consumers filter, but the severity number must reflect how bad this would be if shipped.

## Severity formula

```
severity = exploitability × blast_radius × library_context
```

Score each axis 1–5 using the rubrics below. Severity band by total score:

| Score range | Band          |
| ----------- | ------------- |
| 60–125      | Critical      |
| 30–59       | High          |
| 12–29       | Medium        |
| 4–11        | Low           |
| 1–3         | Informational |

You don't need to show the arithmetic in the report — this is a thinking tool. But you should be able to defend the band if asked.

## Exploitability (1–5)

How much skill, access, and luck does an attacker need?

| Score | Meaning                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------- |
| 5     | One-liner call to a documented API with adversarial input triggers the bug. No preconditions.           |
| 4     | Adversarial input reaches the bug via a documented API path, but requires crafting (e.g., specific encoding, specific key order). |
| 3     | Requires a non-default config, a specific version of a transitive dep, or a specific runtime.           |
| 2     | Requires chaining with another vulnerability, or control of an upstream resource the library fetches.   |
| 1     | Only exploitable in a pathological setup a consumer would not produce by accident.                      |

## Blast radius (1–5)

What does a single successful exploit buy the attacker?

| Score | Meaning                                                                                               |
| ----- | ----------------------------------------------------------------------------------------------------- |
| 5     | Arbitrary code execution in the consumer's process, arbitrary file read/write, or full auth bypass.   |
| 4     | Persistent data compromise: token forgery, session hijack, stored XSS vector, credential leakage.     |
| 3     | One-shot data compromise: reflected XSS, SSRF to internal metadata endpoint, timing oracle for tokens.|
| 2     | DoS — service degradation, request amplification, unbounded memory or CPU.                            |
| 1     | Information disclosure without direct consequence: internal path leak, library version probe.         |

## Library-context multiplier (1–5)

Libraries live inside other people's code. A bug in a library with wide reach is worse than the same bug in an internal script.

| Score | Meaning                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------------- |
| 5     | Library is a security primitive (auth, crypto, sanitizer, parser for an untrusted format). Any bug here undermines consumers' security claims. |
| 4     | Library is middleware, SDK, or framework plugin with broad runtime surface.                          |
| 3     | General-purpose utility library with significant install base and indirect exposure to user input.   |
| 2     | Domain-specific utility where most usage is internal, but the library doesn't know that.             |
| 1     | Narrow, non-security-adjacent utility with limited reach.                                            |

Ask the user or infer from `package.json` keywords / README what the library does before assigning this multiplier. For an unknown library, default to 3.

## CWE tagging

Tag every finding with the closest CWE. A single finding can have more than one; pick the most specific primary and list secondaries. Common ones for JS/TS libraries:

| Class                     | CWE(s)                                                              |
| ------------------------- | ------------------------------------------------------------------- |
| DOM / reflected XSS       | CWE-79                                                              |
| HTML injection from server| CWE-79 (primary), CWE-116 (improper encoding)                       |
| Command injection         | CWE-77, CWE-78                                                      |
| SQL / NoSQL injection     | CWE-89, CWE-943                                                     |
| SSRF                      | CWE-918                                                             |
| CSRF                      | CWE-352                                                             |
| Prototype pollution       | CWE-1321                                                            |
| Path traversal            | CWE-22, CWE-23, CWE-59 (symlink)                                    |
| ReDoS                     | CWE-1333                                                            |
| Insecure deserialization  | CWE-502                                                             |
| Hard-coded credentials    | CWE-798                                                             |
| Use of broken crypto      | CWE-327, CWE-326 (weak strength), CWE-338 (weak RNG)                |
| Non-constant time compare | CWE-208, CWE-203 (observable discrepancy)                           |
| Insufficient rate limit   | CWE-307, CWE-799                                                    |
| Uncontrolled resource use | CWE-400                                                             |
| Supply chain              | CWE-506 (embedded malicious code), CWE-829 (inclusion of untrusted) |
| Improper input validation | CWE-20 (fallback when nothing more specific fits)                   |

Do not stretch to tag CWE-20 on everything — if nothing more specific fits, reconsider whether the finding belongs in the report at all.

## When to downgrade

Downgrade aggressively in these situations:

- The code path is only reachable with an explicit dangerous config flag and the docs clearly warn consumers.
- The "vulnerable" function is internal and only called from one site that passes safe input — but flag this as Medium if the internal function is exported (future-maintenance risk).
- A mitigation exists elsewhere in the library that fully neutralizes the issue (e.g., escape-on-output even though input was not escaped). Verify the mitigation; if it is complete, it's an Informational note.

## When to upgrade

Upgrade when any of these are true:

- The library is a security primitive (auth, crypto, a sanitizer) — multiplier goes to 5, and "defense-in-depth only" issues become real.
- The bug exists in a pre-1.0 or "beta" surface that is nevertheless reachable in published code — do not let `1.0.0-beta` reduce severity.
- The bug is present in code that is part of a public TypeScript type but not yet implemented — flag as an *API contract* finding at Medium so the signature isn't shipped.

## Non-findings

Things that should *not* appear in the report as findings (mention as "Observations" at most):

- Missing CI scanners — unless the user specifically asked for a CI/process review
- Stylistic issues (var vs. const, naming, etc.)
- Dependency versions that are behind latest but have no known CVE
- Use of `any` in TypeScript — unless it is on a trust boundary and hides a real validation gap
- Absence of rate limiting in a library that doesn't own the transport layer (note it, don't score it)
