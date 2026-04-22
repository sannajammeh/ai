# Node-specific Sinks

Node-only concerns that don't have a cleaner home. Load this when the target has any Node surface.

## `child_process`

Covered in `injection.md` for command injection. Additional Node-specific notes:

- `spawn`/`exec`/`fork` inherit file descriptors by default via `stdio: "inherit"`. If the library uses this and the parent has sensitive fds (e.g., a Unix socket), the child gets them. Prefer explicit `stdio` arrays.
- `fork` runs a JS file in a new Node process with IPC. If the path is caller-influenced, it's an arbitrary-file-execution sink. Treat as `require`-with-input.
- `execPath`: by default `fork` uses `process.execPath` but accepts `options.execPath` — if caller can influence, they choose the interpreter.
- Environment inheritance: children inherit `process.env` unless `env` is set. This leaks env vars (potentially with secrets) into the child — which matters if the child is less trusted (e.g., a plugin system).

## `fs`

- `fs.realpath` can resolve through symlinks; don't use it as a containment check (use it *after* one).
- `fs.readlink` — reveals symlink targets, can leak information about the host.
- `fs.watch`: resource exhaustion surface — unbounded watchers can OOM.
- `fs.createReadStream(path, { start, end })`: ranges. A library serving partial content must validate `start` and `end` bounds.
- Temp files: `os.tmpdir()` + random name. Use `fs.mkdtemp` for directories; for files, open with `O_EXCL | O_CREAT` (`wx` flag) to avoid symlink-races in `/tmp`.

## `vm`

`vm.runInNewContext` is **not a security boundary**. Code inside the context has full access to its own realm and, via prototype tricks, often to the parent realm. Don't treat `vm` as a sandbox.

If the library uses `vm` to run untrusted code:

- That's a Critical finding unless the library explicitly disclaims sandboxing and callers opt in knowingly.
- True sandbox = separate process (child_process / worker) with permissions (Node permissions model, or OS-level sandboxing).

## `worker_threads`

- Worker code runs in the same process, sharing memory via `SharedArrayBuffer`. Don't treat workers as security isolation.
- `workerData` is structured-cloned — safe from prototype gadgets but not from resource exhaustion.
- If the library spawns workers from a path caller-supplied, same class as `fork` — arbitrary code.

## `node:http` / `node:https`

- `http.request(url, options, cb)` — if `url` and `options` merge in surprising ways (e.g., `options.host` wins over `url.host` in some wrappers), the library can be tricked. Check documentation.
- `trust proxy` equivalent: libraries behind a proxy reading `X-Forwarded-For` — without an explicit trusted-proxy list, clients forge IPs.
- Keep-alive sockets: in connection-pooled clients, cross-tenant leakage of connection state is theoretically possible. Flag libraries that pool connections across request identities.

## `node:net` / `node:dgram`

- Binding to `0.0.0.0` by default exposes to public network. Any library that opens a listening socket should bind to `127.0.0.1` or accept an explicit `host`.
- Raw-socket features (`dgram`) can be used for amplification — flag if the library takes destination addresses from input.

## `node:dns`

- `dns.lookup` uses the OS resolver, respects `/etc/hosts` — generally fine. `dns.resolve*` uses c-ares and ignores `/etc/hosts`. A library doing `resolve` vs. `lookup` can produce different behavior; note if the distinction matters to security (e.g., TLS `servername` vs. `host`).
- DNS rebinding: covered in `ssrf.md`.

## `process`

- `process.kill` reachable via library logic — huge blast radius; flag.
- `process.binding` — deprecated; if used, definitely flag (direct access to Node internals).
- `process.dlopen` — arbitrary native module load; flag.
- `process.exit` deep in a library — a library should rarely kill the process; returns / throws instead. Flag as an API-contract finding.

## `Buffer`

- `Buffer.allocUnsafe(n)` returns uninitialized memory. If the library returns this buffer to callers without overwriting every byte, it leaks arbitrary process memory. Flag usage that returns without fully writing.
- `Buffer.from(string, encoding)`: encoding-specific length math is easy to get wrong. For byte-oriented work, prefer `Buffer.from(typedArray)` or explicit encoding.

## Native modules (`.node`)

Native bindings are outside V8's sandbox and can do anything to the process. If the library ships or depends on native modules:

- Are prebuilds signed / checksummed?
- Is the native module audited (or at least inspected)?
- Does it expose functions that take strings / pointers / arbitrary data across the N-API boundary? Memory-safety bugs in native code are a separate audit (generally out of scope for a JS audit, but flag the surface).

## Node Permissions / Policies

Node 20+ has a `--permission` model (experimental). If the library is a security primitive, consider recommending callers enable it (Informational).

`--policy=` (integrity manifest) is a defense consumers can layer on. Not a finding against the library unless the library's structure (dynamic imports of unknown paths) would defeat it.

## `inspector` / `Error.prepareStackTrace`

- `inspector` module — enabling the inspector exposes REPL-level control. Flag any library that auto-enables without explicit caller intent.
- `Error.prepareStackTrace` is global. If the library patches it, it affects every error in the process — fragile and surprising. Flag as Medium.

## Finding wording

> `runSandboxed(code)` executes caller-supplied strings via `vm.runInNewContext(code, contextify({}))` (`src/sandbox.ts:14`). Node's `vm` is explicitly not a sandbox per the Node docs; context escapes via `this.constructor.constructor('return process')()` are trivial.

Patch: remove the function, or if the feature is required, run code in a forked child with `--permission` restrictions and a strict stdin/stdout protocol; clearly document the threat model.
