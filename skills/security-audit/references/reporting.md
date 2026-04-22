# Reporting: Finding Schema and Patch Format

The report is the product. Make it something a senior engineer can read linearly and act on without cross-referencing.

## Finding schema

Every finding follows this structure exactly. The asset `report-template.md` embeds this schema; do not improvise.

```markdown
### F-<NN> — <concise title, no period>

- **Severity**: Critical | High | Medium | Low | Informational
- **CWE**: CWE-<N> (primary)[, CWE-<N> (secondary)]
- **Locations**: `path/to/file.ts:line`[, `path/to/file.ts:line`]
- **Status**: Confirmed | Needs verification

**What.** One sentence stating the defect at the mechanism level.

**Why it matters.** One short paragraph. Who can exploit this, under what caller-facing conditions, and what they gain. If exploitability requires preconditions, state them.

**Evidence.** Quote the code. Use fenced blocks with a language hint, and prefix lines with file:line on the first line:

```ts
// src/parse.ts:42
return JSON.parse(input, (k, v) => resolvers[k]?.(v) ?? v);
```

**Exploit sketch.** A minimal adversarial call that demonstrates the issue. Real code, not prose.

```ts
import { parseFoo } from "the-library";
parseFoo(`{"__proto__": {"polluted": true}}`);
// ({}).polluted === true
```

**Patch.** Unified diff. See the patch format section below.

**Justification.** One sentence connecting the patch to the root cause — not a restatement of "What".
```

### Formatting rules

- Finding IDs are `F-01`, `F-02`, … zero-padded, ordered by severity descending then by file path ascending.
- `Locations` is a comma-separated list. Use full repo-relative paths.
- `Status: Needs verification` is for findings where exploitability depends on caller behavior you couldn't confirm. Do not use it to hedge low-confidence grep hits — those shouldn't be findings at all.
- Omit a section (e.g., Exploit sketch) only if it would be genuinely redundant for the reader. The Patch section is never omitted for Critical/High/Medium.

## Patch format

Patches are unified diffs against the current file content. They must apply cleanly with `git apply` or `patch -p0`.

````markdown
```diff
--- a/src/parse.ts
+++ b/src/parse.ts
@@ -40,7 +40,10 @@ export function parseFoo(input: string) {
-  return JSON.parse(input, (k, v) => resolvers[k]?.(v) ?? v);
+  return JSON.parse(input, (k, v) => {
+    if (k === "__proto__" || k === "constructor" || k === "prototype") return undefined;
+    return resolvers[k]?.(v) ?? v;
+  });
 }
```
````

### Rules for patches

- **Minimal.** Only the lines that need to change. Don't reformat surrounding code.
- **Preserve API.** If a fix requires a signature change, call that out in *Justification* and propose a deprecation bridge (keep the old export, add a new one, deprecate the old).
- **No new deps.** If a fix requires a dep, state why no built-in primitive suffices.
- **Node version aware.** If the fix uses a primitive that requires a specific Node version (e.g., `node:crypto.timingSafeEqual` in recent LTS), check `engines` and note if `engines.node` must be bumped.
- **Test impact.** If existing tests will need to change, say so — do not silently break tests.
- **Multiple files.** For cross-file fixes, emit one diff block per file, in order.

### When a patch would be destructive

Some findings require a behavior change that would break downstream consumers if applied naively. For those, propose a three-step plan instead of a raw diff:

```markdown
**Migration plan.**

1. Introduce `parseFooStrict(input)` with the safe behavior (diff below).
2. Keep `parseFoo` behavior unchanged but emit a deprecation warning via `process.emitWarning` (diff below).
3. In next major, alias `parseFoo = parseFooStrict`.

Patch for step 1:
```diff
…
```

Patch for step 2:
```diff
…
```
```

## Report assembly

After all findings, include:

### Observations & non-findings

A short section listing things you checked and found to be clean, *especially* where their absence is load-bearing:

- "`child_process` is not used."
- "All regex run against caller input are bounded: …"
- "HTTP client passes the `Host` header from `URL.host` only; no user-header injection path."

This section signals audit completeness. It's also where `npm audit` / dependency-CVE output goes as a prose summary, not inline findings, unless a dep CVE is itself exploitable through this library's API (in which case promote it to a finding).

### Recommendations beyond patches

Process and architecture suggestions that are not per-finding:

- Fuzz targets to add
- Tests that would prevent regression of specific findings
- CI additions (a specific linter rule, a specific grep-based check, `publint`/`arethetypeswrong`, `npm pack --dry-run` review)
- Documentation gaps — places where secure usage requires a caller contract that isn't currently documented

## Summary section

Top of the report. Format:

```markdown
## Summary

<One paragraph: what was audited, what the overall security posture looks like, what the worst findings are. Be specific — name the worst finding.>

| Severity       | Count |
| -------------- | ----- |
| Critical       |   <n> |
| High           |   <n> |
| Medium         |   <n> |
| Low            |   <n> |
| Informational  |   <n> |
```

If count is 0 for a row, include the row with 0 — don't drop it. A zero Critical row is itself information.

## Tone

- Second person is fine when talking to the maintainer. "You can fix this by…" reads better than passive voice.
- No hedging clauses that don't add content. "It would probably be a good idea to maybe consider…" → just say what to do.
- No security-theater language. Don't say "hackers could exploit" — say who the attacker is and what the input is.
- If a finding is wrong in retrospect, remove it. Do not leave it in with a caveat.
