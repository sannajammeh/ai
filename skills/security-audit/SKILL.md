---
name: security-audit
description: Perform an exploitability-first security audit of a JavaScript/TypeScript library (Node, browser, or isomorphic) and produce a findings report plus concrete proposed patches. Use whenever the user asks for a security review, security audit, hardening pass, pre-release or pre-publish audit, threat model, vulnerability sweep, OWASP review, or supply-chain review, or says things like "harden this before we ship", "make this bulletproof", "look for security issues", or mentions any specific class such as XSS, CSRF, SSRF, timing attacks, credential leakage, rate limiting, brute force, ReDoS, prototype pollution, path traversal, or command injection. Trigger even when the request is phrased as a code review — if the stated goal is security or production readiness, prefer this skill over a generic review. Assume the consumer is a senior professional — library author, staff-level engineer, or external auditor — and do not produce beginner-tier advice or noise.
---

# Security Audit — Advanced Review for JS/TS Libraries

This skill drives a rigorous security audit of a JavaScript or TypeScript codebase, optimized for **library authors preparing for a professional third-party audit or a production release**. The output is a structured findings report plus concrete patch proposals.

**Audience assumption.** The reader is senior. Do not emit findings for things a linter or a junior reviewer would catch. Do not pad the report. If there is nothing to say in a category, say so explicitly rather than inventing concerns.

**The prime directive: signal over noise.** A finding earns a place in the report only if a competent attacker could plausibly reach it or if a professional auditor would flag it. If you are uncertain whether a pattern is exploitable in this codebase, mark it as *Needs verification* and explain what would have to be true for it to be exploitable — do not inflate severity to be safe.

---

## When to use (and when not to)

Use this skill when the user asks for:

- A pre-release or pre-publish security audit of a library
- A hardening pass on code that will be consumed by untrusted callers
- Review for specific vulnerability classes (XSS, CSRF, SSRF, timing, crypto misuse, prototype pollution, injection, ReDoS, deserialization)
- A "professional audit" rehearsal — surfacing what an external auditor will ask about
- Supply-chain / publish-time risk review of an npm package

Do **not** use this skill for:

- Routine code review of non-security changes (use a normal review)
- Application-level pen-testing of a deployed service (this skill is for libraries and library-like code)
- Pure dependency CVE scanning that `npm audit` already covers — include it, but don't make it the center of the report

---

## Scope detection (first thing to do)

Before auditing, determine the **shape** of the target. The shape drives which reference docs you load. Use the file tools — do not guess.

1. **Package type.** Read `package.json`.
   - `type`, `main`, `module`, `exports`, `bin`, `types` — entry points define the public API surface
   - `engines` — Node version window affects which primitives are available (e.g., `node:crypto.timingSafeEqual`)
   - `scripts.postinstall` / `scripts.install` / `scripts.preinstall` — supply-chain risk
   - `dependencies` vs `devDependencies` — runtime trust surface vs build-only
   - `files` / `.npmignore` — what actually ships to the registry
2. **Runtime target.** Infer Node-only, browser-only, or isomorphic:
   - imports of `node:*` or `fs`, `child_process`, `net`, `dgram`, `vm` → Node
   - references to `window`, `document`, `navigator`, `DOMParser`, `postMessage`, `localStorage` → browser
   - both, or no strong signal → isomorphic (audit for both)
3. **API surface.** Enumerate the *actual* exports reachable from entry points. This is the trust boundary: any argument to any exported function is attacker-controlled for audit purposes.
4. **Sink inventory.** Grep for dangerous sinks relevant to the runtime. See `references/attack-surface.md` for the exact grep list. Record file:line for each hit.
5. **Dependency topology.** Note direct dependencies and any with install scripts or native bindings. See `references/supply-chain.md`.

Write these findings into a short "Scope" section in your working notes — the report will reference them.

---

## Audit methodology

Work in phases. Do **not** jump straight to grepping for `eval`. A phased approach is what catches the things that are actually exploitable rather than the things that look scary.

**Sequential vs. parallel execution.** Both Phase 1 (attack-surface mapping) and Phase 2 (domain passes) parallelize well across subagents; Phase 3 (cross-cutting review) does not — it must see the whole picture, so it stays in the orchestrator. For medium-to-large codebases, fan Phase 1 out by task (surface / sinks / deps) and Phase 2 out by domain group using the Task tool. See `references/parallel-execution.md` for the full protocol — Phase 1 subagent roles, sharding rules for large codebases, Phase 2 grouping table, subagent prompt templates, merge rules, and when to fall back to sequential.

### Phase 1 — Attack surface mapping

Load `references/attack-surface.md`. Follow it to produce, as a working artifact, a list of:

- Every exported function and what untrusted inputs reach it
- Every dangerous sink (exec, eval, fs, network, DOM mutation, crypto, cookies, etc.) with file:line
- Every trust-boundary crossing (caller → library internals, network → parser, parser → sink)

This artifact is the spine of the audit. Every later finding must tie back to a path on this map. A finding with no reachable path from a trust boundary to a sink is not a finding — it is a note at most.

**Parallel mode.** After the cheap preamble (read `package.json`, infer runtime target), Phase 1 fans out into three task-based subagents: `surface` (enumerates exports and signatures), `sinks` (grep + context-prune the dangerous-sink inventory), `deps` (dependency topology and ships-what). Spawn them in a single turn with the Task tool. For codebases > 100 source files, further shard `sinks` by top-level source directory so each file is read once. The orchestrator then merges their outputs into the canonical attack-surface map written to `.security-audit-scratch/surface.md`. Full protocol and prompt template in `references/parallel-execution.md`.

**Sequential mode.** For tiny codebases or when reproducibility is required, do the inventory yourself in the orchestrator — step through `references/attack-surface.md` top to bottom.

### Phase 2 — Domain-specific audits

For each domain relevant to the detected runtime, load the corresponding reference file and perform the checks it describes. Skip domains that do not apply (e.g., skip DOM XSS for a pure Node library). Do not load all references up-front — load them on demand to keep context lean.

**Parallel mode.** If the trigger conditions in `references/parallel-execution.md` are met (medium-to-large codebase, multiple domains with real surface area, user hasn't vetoed token spend), dispatch this phase as subagents — one per domain group. Each subagent loads its own references, reads the attack-surface map from disk, and returns findings in the schema defined in `parallel-execution.md`. Spawn all subagents in a single turn so they run concurrently, then run the merge protocol before Phase 3.

**Sequential mode (fallback).** Work through the table below one row at a time. Same reference files, same checks, same output schema — just one domain at a time in the orchestrator.

| Domain                                   | Reference                                     | Load when …                                                                 |
| ---------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| Injection (SQL, command, header, NoSQL)  | `references/injection.md`                     | Any shell-out, query builder, HTTP header construction, or DB driver use    |
| DOM / HTML XSS                           | `references/xss-dom.md`                       | Browser target, or library emits HTML/DOM strings                           |
| Prototype pollution                      | `references/prototype-pollution.md`           | Any deep merge, object assignment from untrusted keys, `lodash.set`-style   |
| Path traversal                           | `references/path-traversal.md`                | `fs.*`, `path.*`, `fs.createReadStream`, or static file serving             |
| ReDoS                                    | `references/redos.md`                         | Any regex run against caller-supplied strings                               |
| Crypto misuse                            | `references/crypto.md`                        | Use of `crypto`, `subtle`, JWT, tokens, password hashing, signatures        |
| Timing attacks                           | `references/timing.md`                        | Comparisons involving secrets, tokens, MACs, password hashes                |
| Credential / secret leakage              | `references/credentials.md`                   | Logging, error messages, thrown errors, URL construction, telemetry        |
| SSRF                                     | `references/ssrf.md`                          | Outbound HTTP built from caller input, URL parsing, webhook dispatch        |
| CSRF-relevant primitives                 | `references/csrf.md`                          | Cookie setting, session handling, state-changing helpers                    |
| Rate limiting / brute force              | `references/rate-limiting.md`                 | Auth endpoints, verification flows, any expensive op keyed by user input    |
| Deserialization                          | `references/deserialization.md`               | `JSON.parse` with reviver, YAML loaders, structured-clone of untrusted data |
| Resource exhaustion / DoS                | `references/resource-exhaustion.md`           | Streams, buffers, parsers, any unbounded allocation from input              |
| Supply chain                             | `references/supply-chain.md`                  | Always (it's a library)                                                     |
| Node-specific sinks                      | `references/node-sinks.md`                    | Node or isomorphic target                                                   |
| Browser-specific sinks                   | `references/browser-sinks.md`                 | Browser or isomorphic target                                                |
| API contract and secure defaults         | `references/api-contract.md`                  | Always (it's a library)                                                     |

### Phase 3 — Cross-cutting checks

After the domain passes, do a sweep for issues that do not belong to a single domain:

- **Defaults.** Are security-relevant options opt-in or opt-out? A safe library is safe by default; hardening is a red-flag pattern, lax-by-default is another.
- **Error surfaces.** Do thrown errors, rejected promises, or returned error objects leak secrets, stack traces from untrusted input, or internal paths?
- **TOCTOU and races.** Any check-then-use pattern across async boundaries (e.g., `fs.stat` then `fs.readFile`, DNS lookup then connect, token validation then token use).
- **Isomorphism traps.** Code that looks safe in Node can be unsafe in a browser build, and vice versa (e.g., a `Buffer` polyfill that leaks memory, a `crypto` shim that falls back to `Math.random`).
- **Test-only surfaces in production bundles.** Fixture loaders, debug endpoints, `__esModule` back doors shipped to consumers.

### Phase 4 — Triage and report

Load `references/triage.md` and `references/reporting.md`. Score each finding on exploitability-first axes and produce the report using the template in `assets/report-template.md`. Propose patches for each actionable finding (see "Patches" below).

---

## Triage model (exploitability-first)

Full rubric is in `references/triage.md`. The short version: **severity = exploitability × blast radius**, with a library-context multiplier for supply-chain reach.

- **Critical** — Remotely exploitable by a caller with the library's documented input contract, no exotic preconditions, impacts confidentiality/integrity/availability of the consumer or consumer's users.
- **High** — Exploitable by a caller who passes intentionally malicious input through a documented API path; or a default that quietly undermines a security claim the library makes.
- **Medium** — Exploitable only with unusual preconditions (specific config flags, mixed-case encoding quirks, etc.), or a hardening gap that does not directly cause compromise but removes defense-in-depth.
- **Low** — Hygiene issue a professional auditor will mention but that is not itself exploitable. Example: not using `timingSafeEqual` for a public, non-secret identifier.
- **Informational** — Observations worth recording (architecture notes, suggested refactor, documentation gap).

Do not grade on the OWASP Top 10 alphabetically. Do tag findings with the closest CWE where one exists (e.g., CWE-79, CWE-352, CWE-918, CWE-400, CWE-352, CWE-1321).

**Raise the bar for the report.** If a finding would be Low or Informational and is not genuinely interesting, consider omitting it. The goal is that every item in the report rewards the reader's attention.

---

## Patches

For every Critical, High, and Medium finding, produce a **concrete patch proposal** — not a description of what to do. Patches must:

- Be minimal and scoped to the issue. Do not refactor adjacent code.
- Preserve the library's public API unless the fix *requires* an API change — and if it does, call that out explicitly and propose a deprecation path.
- Use primitives that already exist in the codebase's dependency graph; do not introduce a new dep for a one-line fix.
- Be shown as unified diffs against the current file contents. Use the format in `references/reporting.md`.
- Include a one-line justification that ties the patch to the finding's root cause, so the reader can check you aren't patching a symptom.

For Low / Informational, describe the change in prose — no diff required.

Do **not** apply patches in place unless the user explicitly asks. The default is "propose, don't mutate".

---

## Output format

Produce a single Markdown report at the path the user requests, or at `SECURITY_AUDIT.md` in the target repo if they didn't specify. Follow the template in `assets/report-template.md` exactly — it is what downstream tooling and the user will expect.

High-level structure (full template is in the asset file):

1. **Summary** — one paragraph, plus a findings count by severity.
2. **Scope** — what was in/out of scope, runtime target, entry points audited, commit or state audited.
3. **Methodology** — phases run, references consulted, checks skipped (and why).
4. **Findings** — each finding is self-contained: title, severity, CWE, locations, exploit sketch, patch, justification.
5. **Observations & non-findings** — things you checked that were fine, and notable *absences* (e.g., "no use of `child_process`" is worth saying).
6. **Recommendations beyond patches** — architectural or process suggestions (fuzzing targets, CI additions, tests that would catch regressions).

---

## How to behave while auditing

- **Read before you grep.** Grep is for inventory, not for understanding. Open the files and read the call paths. Many "findings" evaporate once you read five lines above the match.
- **Prove reachability.** For each would-be finding, write the trust-boundary-to-sink path in one sentence before deciding whether it is a finding. If you cannot write the path, it is not a finding.
- **Quote the code.** In the report, quote the exact lines you are flagging with file:line. Ambiguity here wastes the reader's time.
- **Cite the reference.** When a finding comes from a pattern documented in a reference doc, name the doc. This makes your reasoning auditable too.
- **Don't moralize.** No "you should really…" language. State the issue, state the fix.
- **Admit uncertainty.** If a finding depends on how the library is called, say so and describe the calling pattern that triggers it.

---

## Reference index

The `references/` directory contains the domain-specific playbooks. Load on demand:

- `attack-surface.md` — Phase 1 map, grep inventories, trust boundary definitions
- `triage.md` — severity rubric, CWE mapping guidance
- `reporting.md` — exact finding schema, diff formatting rules
- `parallel-execution.md` — subagent fan-out protocol for Phase 2, grouping table, merge rules
- `injection.md` — command / SQL / NoSQL / header / template injection
- `xss-dom.md` — DOM XSS, HTML sinks, sanitizer pitfalls, trusted types
- `prototype-pollution.md` — merge / assign / set patterns, gadget chains
- `path-traversal.md` — `fs` and `path` traversal, symlink races, archive extraction
- `redos.md` — catastrophic backtracking, safe regex construction, input bounding
- `crypto.md` — primitive selection, randomness, nonces, KDFs, key handling, JWT
- `timing.md` — constant-time comparison, cache/side-channel notes, error-timing
- `credentials.md` — secret leakage surfaces, logging hygiene, URL / error redaction
- `ssrf.md` — URL validation, DNS rebinding, allowlists, metadata endpoints
- `csrf.md` — cookie flags, SameSite, state-change helpers, double-submit patterns
- `rate-limiting.md` — brute force, enumeration, expensive-op guards
- `deserialization.md` — JSON revivers, YAML loaders, structured clone, pickle-alikes
- `resource-exhaustion.md` — unbounded allocation, async backpressure, parser bombs
- `supply-chain.md` — install scripts, pinning, lockfiles, postinstall, published files
- `node-sinks.md` — `child_process`, `fs`, `vm`, `http`, `net`, `dns`, `worker_threads`
- `browser-sinks.md` — `innerHTML`, `postMessage`, iframe, CSP, cookies, clipboard
- `api-contract.md` — secure defaults, misuse-resistance, typed errors, deprecations

The `assets/report-template.md` file is the exact Markdown template to produce for the final report.
