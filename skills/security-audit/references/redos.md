# ReDoS — Regular Expression Denial of Service

CWE-1333. A regex with catastrophic backtracking takes super-polynomial time on certain inputs. A single request can peg a Node event loop for seconds or minutes.

Libraries that run regex against caller-supplied strings without bounding them are the usual culprit. This is one of the most under-triaged real bugs in the JS ecosystem.

## The two failure modes

1. **Regex literal with ambiguous quantifiers run against user input.**
2. **Regex built from user input** (`new RegExp(userPattern)`) — attacker-controlled pattern, attacker-controlled catastrophic behavior.

The first is harder to spot; the second is always a finding unless the pattern is wrapped in a bound.

## Patterns to flag (regex literals)

Look for:

- Nested quantifiers: `(a+)+`, `(a*)*`, `(a|a)*`
- Overlapping alternations: `(a|ab)+`, `(.|\n)*`
- Unbounded lookaheads/lookbehinds with quantifiers inside
- `.*` or `.+` at the start or end when combined with non-trivial captures
- Email-validating, URL-parsing, HTML-tag-stripping regexes copied from Stack Overflow

Run a scanner to enumerate candidates. Two useful commands:

```bash
# List all regex literals (rough)
rg -n '(?<!\w)/[^/\n]+/[gimsuy]*' --type js --type ts

# Likely-catastrophic shapes
rg -nP '\([^)]*[+*][^)]*\)[+*]' --type js --type ts
```

For each candidate, check the source of the string it's applied to. If the string can be attacker-controlled and is not length-bounded, it's a finding.

## Length bounding as a defense

If removing the regex is infeasible, bound the input:

```ts
const MAX = 1024;
if (input.length > MAX) throw new RangeError("too long");
return /…/.test(input);
```

The bound must be *before* the regex runs. "We only pass short strings" is not a bound.

## Use `RegExp.exec` with timeouts (Node only, imperfect)

Node has no regex timeout. Workers are the portable option for bounded regex eval but add complexity. For libraries, the right pattern is almost always:

1. Rewrite the regex to eliminate catastrophic backtracking (possessive quantifiers aren't available in JS, but atomic-group emulation works: `(?=(regex))\1`).
2. Bound input length.
3. Switch to a linear-time regex engine for hot paths — e.g., `re2` (native, requires node-gyp — ecosystem trade-off to flag in the patch note).

## Safe rewriting techniques

- Anchor both ends when possible: `^pattern$` prevents some backtracking.
- Use character classes instead of alternations where possible: `[abc]` beats `(a|b|c)`.
- Use lazy (`*?`, `+?`) instead of greedy when the parse admits it. Note lazy has its own pathological cases — test both.
- Replace `(x+)+` with `x+` or `x*` where semantically equivalent.
- Split a complex regex into staged passes (`String.prototype.indexOf` then a targeted regex on the candidate).

## Detecting catastrophic behavior

For a suspected regex:

```js
function timeRegex(re, input) {
  const t0 = performance.now();
  re.test(input);
  return performance.now() - t0;
}
// try input = "a".repeat(N) followed by "!" — if time grows super-linearly with N, it's catastrophic
```

Include a timing demonstration in the finding when feasible.

## `new RegExp(userInput)` specifically

Always a finding. Even if catastrophic backtracking is bounded (say, via `re2`), the user now controls *what matches*, which may itself be a logic bug (see injection.md, Regex-injection section). The patch:

- Don't accept regex at all. Define a subset grammar (globs, prefixes) and compile it internally.
- If regex is a feature, require consumers to opt in explicitly, document the DoS risk, and run the regex in a worker with a watchdog.

## Finding wording

> `matchUserAgent` applies the regex `/^((Mozilla|Chrome)+)+\/(\d+)/` (`src/ua.ts:12`) to the caller-supplied `ua` string. Inputs of the form `"Mozilla".repeat(N) + "!"` cause exponential backtracking — on a 2023 laptop, N=30 blocks the event loop for ~2 s.

Patch: rewrite to non-backtracking form, add length bound, or replace with `re2`.

## Notes on the ecosystem

- `semver`'s historical regexes have been hardened; check the version.
- `jsonwebtoken`, `ms`, `marked`, `markdown-it` — ecosystem has had multiple ReDoS CVEs; not a finding in itself unless the library pins an affected version.
- Vue / Angular template parsers use their own regex pipelines; if the library wraps them for user input, flag.
