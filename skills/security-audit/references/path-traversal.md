# Path Traversal

CWE-22 / CWE-23 / CWE-59. A user-supplied path component escapes an intended directory, reaching sensitive files or writing to unintended locations. For libraries, the attack surface is any function that takes a path-like argument.

## Classic patterns

```ts
// Reading
const file = path.join(baseDir, userName);
fs.readFileSync(file);

// Writing
fs.writeFileSync(path.join(uploadsDir, fileName), data);

// Listing
fs.readdirSync(path.join(baseDir, subDir));
```

`path.join` collapses `..` sequences but does not keep the result within `baseDir`. `path.join("/safe", "../etc/passwd")` returns `/etc/passwd`. Always verify containment.

## Correct containment check

```ts
import path from "node:path";

function resolveWithin(base: string, user: string): string {
  const resolved = path.resolve(base, user);
  const rel = path.relative(base, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path escapes base directory");
  }
  return resolved;
}
```

Things to check on this pattern:

- `base` must itself be resolved (absolute). If `base` is relative and cwd changes, the check is unstable.
- The comparison must be after resolution to handle `..` correctly.
- On Windows, mix-cased drive letters and `\\?\` prefixes are edge cases — use `path.win32.relative` explicitly on cross-platform libs, or normalize once.

## Symlink races (CWE-59, TOCTOU)

Even with a correct path check, on Node, the check-then-open pattern is racy:

```ts
if (!resolveWithin(base, file).startsWith(base)) throw …;
const fd = await fs.promises.open(resolved, "r"); // symlink could have been created between check and open
```

If the attacker can write to `base` (often the case in extraction tools), they can create a symlink pointing outside `base` between the check and the open. Mitigations:

- Open with `O_NOFOLLOW` where available: `fs.promises.open(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)` — Linux/macOS only, throws `ELOOP` on symlink. Not portable to Windows.
- Use `realpathSync` after open, verify containment, re-check. Still imperfect; document the residual risk.
- On Linux, use `openat2` via `node:fs.promises` (not exposed directly — requires `posix`-style native binding or a subprocess). Usually overkill for libraries; flag as "defense-in-depth suggestion" at Low severity unless the library is an archive extractor.

## Archive extraction (special case)

Archive extractors are perennial sources of traversal and symlink bugs ("zip slip"):

- Check every entry's normalized path for containment **before** creating any file.
- Reject entries whose type is symlink/hardlink unless explicitly allowed and validated for containment (dereference the target, check containment).
- Reject entries whose normalized path contains `..` anywhere, even mid-path (`a/../b` normalizes to `b` but check order matters with symlinks created in earlier entries).
- On Windows, also reject paths with `:`, reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`), and trailing dots/spaces.

For libraries that extract archives, the finding threshold is "does this library have any of the above protections". If not, it's at least Medium, often High.

## Static file serving (libraries)

If the library implements static file serving (rare but it happens):

- Only serve from a single, pre-resolved root.
- Reject requests whose decoded path contains `..`, `%2e%2e`, `\`, or null bytes.
- Decode exactly once. Double-decoding is a known-class bug.
- Set `X-Content-Type-Options: nosniff` by default.

## Windows-specific traversal

Patterns to flag specifically for Windows-compatible libraries:

- Absolute paths starting with `C:`, `\\?\`, `\\.\`, `\\server\share`
- Alternate data streams: `file.txt:hidden`
- UNC paths when a local path was expected: `\\attacker\share`

`path.isAbsolute` on POSIX returns false for `C:\foo`; on Windows it returns true. Cross-platform libraries should test both.

## Finding wording

> `writeEntry` accepts an archive entry's `path` field and uses `path.join(outDir, entry.path)` to compute the destination. No containment check is performed before `fs.writeFile`. An archive containing `../../etc/cron.d/root` will write outside `outDir`.

Patch: introduce or use `resolveWithin`, reject disallowed entries, handle symlink entries explicitly. For archive extractors, include an *exploit sketch* that constructs a malicious archive with `tar-stream` or similar — it makes the finding concrete.
