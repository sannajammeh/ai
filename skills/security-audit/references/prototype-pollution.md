# Prototype Pollution

CWE-1321. A classic JS-specific defect: untrusted input is assigned to object keys in a way that lets `__proto__`, `constructor`, or `prototype` paths reach `Object.prototype`, changing the shape of every object in the process.

## The canonical sinks

Any recursive merge, deep-set, or "assign by path" helper is suspect:

```ts
function merge(dst, src) {
  for (const k in src) {
    if (typeof src[k] === "object") merge(dst[k] ?? (dst[k] = {}), src[k]);
    else dst[k] = src[k];
  }
}
merge({}, JSON.parse(userInput));
```

If `userInput` is `{"__proto__":{"admin":true}}`, then `({}).admin === true` afterwards.

Flag every occurrence of:

- Custom `merge`, `defaults`, `deepAssign`, `extend` that recurses
- `lodash.merge`, `lodash.defaultsDeep`, `lodash.set` — older versions were known-vulnerable; even in fixed versions, chained keys `"a.__proto__.polluted"` in a path-string API can still reach `Object.prototype` unless guarded
- `minimist`/`yargs` with `--` argv injection (`--__proto__.x=y`) — check the version and config
- Any assignment of the form `obj[key] = value` where `key` is not a known-literal

## Dangerous key list

The guard must reject:

- `__proto__`
- `constructor`
- `prototype`

Guarding only `__proto__` is insufficient: `{"constructor":{"prototype":{"polluted":true}}}` is a valid payload for a recursive merge that walks both levels.

## Null-prototype objects

The correct fix for "map of arbitrary keys → values" is almost always `Object.create(null)` or `new Map`:

```ts
const bag = Object.create(null);
bag[userKey] = userValue; // safe-ish — bag has no prototype
```

This does not prevent the caller from pollution if they pass `bag` back into a sink that walks `Object.prototype`, but it contains the damage.

## Merge safely

If the library must merge arbitrary objects:

```ts
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

function safeMerge(dst, src) {
  if (src === null || typeof src !== "object") return dst;
  for (const k of Object.keys(src)) {         // Object.keys skips __proto__ on modern engines
    if (FORBIDDEN.has(k)) continue;
    const v = src[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      dst[k] = safeMerge(dst[k] && typeof dst[k] === "object" ? dst[k] : {}, v);
    } else {
      dst[k] = v;
    }
  }
  return dst;
}
```

Do not rely on `for...in` with `hasOwnProperty` alone — modern engines make `Object.keys` behave correctly for own-property iteration, but `for...in` with `Object.prototype` already polluted is still a gun pointed at a foot.

## Gadget chains

Even when the library itself doesn't have a vulnerable dispatch, prototype pollution anywhere in the process can mutate options objects later (the "gadget"). Check for patterns where options default via `{ ...defaults, ...userOpts }` and `defaults` is later read as `opts.someFlag` — if `someFlag` was polluted, the default is silently swapped.

When auditing, if the library has a vulnerable merge, explicitly note:

> Consumers of this library may have gadgets elsewhere (e.g., `mongoose`, `lodash`, framework-internal option parsing) that convert this pollution into RCE or auth bypass. The library's exposure is the merge itself; the consequence depends on the host process.

This framing is correct and defensible — it does not over-claim but does not understate.

## Things that look like pollution but aren't (usually)

- Setting `Foo.prototype.bar = …` on a library-owned class. That's just a method. Not pollution unless `Foo` is `Object`.
- `Object.assign(target, source)` where `source` is *not* from an untrusted parsed payload — `Object.assign` ignores `__proto__` as a setter since it uses `[[DefineOwnProperty]]`.
- `JSON.parse(x)` alone. The parsed object has a non-enumerable `__proto__` property (it's an own property named `__proto__`, not the prototype slot) only when the reviver is not used. The pollution happens in whatever consumes the parsed result.

## Input-validation defenses

For JSON APIs, consider rejecting payloads whose serialized form contains the literal string `"__proto__"`, `"constructor"`, or `"prototype"` as a *property name*. This is a blunt instrument but for libraries that only expect tabular data, it's defensible:

```ts
function assertNoPollutionKeys(x) {
  if (x === null || typeof x !== "object") return;
  for (const k of Object.keys(x)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") {
      throw new TypeError(`Forbidden key: ${k}`);
    }
    assertNoPollutionKeys(x[k]);
  }
}
```

Document the restriction in the API contract.

## Finding wording

> `defaults` recursively merges caller-supplied options into a library-owned defaults object (`src/config.ts:87`). The recursion treats `__proto__` and `constructor` as regular keys, so a caller (or any JSON-parsed payload reaching this function) can mutate `Object.prototype`.

Patch is usually either switching to `Object.create(null)` for the target, or adding the forbidden-key check.
