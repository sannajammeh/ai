# Security Audit — `<library-name>`

<!--
This is the exact template to use for the final report. Keep the section headings and
ordering. Fill in `<angle-bracket>` placeholders. Remove this comment block before emitting.
-->

**Commit / state audited:** `<sha or "working tree at 2026-04-22">`
**Runtime target:** `<Node | Browser | Isomorphic>`
**Entry points audited:** `<list of modules / exports>`
**Audit date:** `<YYYY-MM-DD>`

---

## Summary

<One paragraph. What was audited, what the overall security posture looks like, what the
worst findings are. Name the worst finding by its F-id and severity.>

| Severity       | Count |
| -------------- | ----- |
| Critical       |   <n> |
| High           |   <n> |
| Medium         |   <n> |
| Low            |   <n> |
| Informational  |   <n> |

---

## Scope

**In scope:**

- `<file / module>` — `<short description of role>`
- …

**Out of scope:**

- `<file / module>` — `<reason: e.g., "test fixtures, not published">`
- …

**Trust boundaries identified:**

- Caller → `<exported function(s)>`
- Network → `<parser>`
- `<other>`

**Sinks reachable from trust boundaries:** (summary, details in findings)

- `<class>` — `<count>` occurrences in `<files>`
- …

---

## Methodology

Phases executed:

1. Attack-surface mapping (`references/attack-surface.md`)
2. Domain passes:
   - `<each reference loaded, in order>`
3. Cross-cutting review (defaults, errors, TOCTOU, isomorphism traps)
4. Triage and report assembly

Phases / domains skipped (with reason):

- `<domain>` — `<reason: e.g., "no filesystem access in this library">`

Tools used (if any): `npm audit`, `npm pack --dry-run`, custom greps documented below.

---

## Findings

<!-- Findings sorted by severity descending, then by path ascending. -->
<!-- If zero findings, say so explicitly here and skip this section. -->

### F-01 — <concise title, no period>

- **Severity**: <Critical | High | Medium | Low | Informational>
- **CWE**: CWE-<N> (primary)[, CWE-<N> (secondary)]
- **Locations**: `path/to/file.ts:line`[, `path/to/file.ts:line`]
- **Status**: <Confirmed | Needs verification>

**What.** <One sentence stating the defect at the mechanism level.>

**Why it matters.** <Short paragraph. Who can exploit this, under what caller-facing
conditions, and what they gain. If exploitability requires preconditions, state them.>

**Evidence.**

```ts
// path/to/file.ts:NN
<quoted code>
```

**Exploit sketch.**

```ts
<minimal adversarial call>
```

**Patch.**

```diff
--- a/path/to/file.ts
+++ b/path/to/file.ts
@@ -NN,N +NN,N @@
<diff>
```

**Justification.** <One sentence tying the patch to the root cause — not a restatement of What.>

---

### F-02 — …

<!-- Continue for each finding. -->

---

## Observations & non-findings

<!-- Things you checked and found clean, plus notable absences. This signals audit completeness. -->

- <"`child_process` is not used.">
- <"All regex run against caller input are length-bounded at <N> in …">
- <"`npm audit --production` surfaces 0 known CVEs at current lockfile state.">

---

## Recommendations beyond patches

<!-- Process / architecture suggestions that don't map to a single finding. -->

- **Fuzzing targets.** <Suggest functions with parser-shaped input that would benefit from fuzzing via `jsfuzz` or `fuzzer.js`.>
- **Regression tests.** <For each Critical/High finding, name the test that would catch regression and where it should live.>
- **CI additions.** <e.g., "enable `publint` to catch exports-map mistakes", "add `npm pack --dry-run` check to PRs".>
- **Documentation gaps.** <Contracts that should be documented so callers can't accidentally misuse.>

---

## Appendix: audit notes

<!-- Optional. Use for anything that informed the audit but doesn't belong in the body:
     grep commands run, dep topology notes, version checks, deferred items. -->
