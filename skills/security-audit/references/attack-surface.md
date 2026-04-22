# Attack Surface Mapping

Phase 1 of the audit. The output is a map of *who can call what* and *what each thing can reach*. Everything downstream depends on this being right.

## Step 1: Enumerate entry points

Open `package.json`. The following fields together define the library's public API:

- `main`, `module`, `browser`, `exports`, `types`, `bin`
- `files` array — limits what ships; anything outside `files` is not part of the surface
- Conditional `exports` — map each condition (`import`, `require`, `types`, `browser`, `node`) to the file it resolves to

For each file that is an entry point, record every `export` it declares (named, default, re-exports). Follow re-exports transitively until you hit actual implementations. These implementations — and every argument they accept — are the **trust boundary**.

If the package exposes a CLI (`bin`), the `argv` parser is also a trust boundary, with process env as a secondary input.

## Step 2: Classify each exported function

For each exported function, record:

| Field                     | What to capture                                                            |
| ------------------------- | -------------------------------------------------------------------------- |
| Name                      | `parseFoo`, default export, etc.                                           |
| Signature                 | Arg types, return type                                                     |
| Caller-trust              | What the library's docs imply callers will pass (strings? user input?)     |
| Internal sinks reached    | Which dangerous sinks downstream of this function (list from Step 3)       |
| Observable side effects   | fs, network, env, globals, prototype, cookies, DOM                         |

A function that *transitively* reaches a dangerous sink is where audits are won or lost — trace it.

## Step 3: Inventory dangerous sinks

Run these greps and record every hit with file:line. Do not prune matches here — prune in Phase 2 after reading context.

### Node-relevant sinks

```
\beval\s*\(
\bnew\s+Function\s*\(
\bvm\.(runInThisContext|runInNewContext|runInContext|createContext|compileFunction|Script)\b
\bchild_process\.(exec|execSync|spawn|spawnSync|execFile|execFileSync|fork)\b
\brequire\s*\(\s*[^'"]          # dynamic require
\bimport\s*\(                     # dynamic import
\bfs\.(readFile|readFileSync|createReadStream|writeFile|writeFileSync|unlink|rm|rmdir|rename|symlink|createWriteStream|readdir|realpath)\b
\bpath\.(join|resolve|normalize)\b   # context-dependent, not always a sink
\b(http|https|fetch|axios|got|undici|node-fetch)\b
\bnet\.(connect|createConnection|Socket)\b
\bdns\.(lookup|resolve|resolve4|resolve6|resolveCname)\b
\bworker_threads\b
\bcrypto\.(createHash|createHmac|createCipher|createCipheriv|randomBytes|randomFillSync|randomUUID|pbkdf2|scrypt|timingSafeEqual)\b
\bJSON\.parse\s*\(.+,\s*[^)]+\)   # JSON.parse with a reviver
\bBuffer\.(from|allocUnsafe|allocUnsafeSlow)\b
\bprocess\.(env|argv|stdin|exit)\b
```

### Browser-relevant sinks

```
\.innerHTML\s*=
\.outerHTML\s*=
\bdocument\.write\b
\bdocument\.writeln\b
\binsertAdjacentHTML\b
\b(createContextualFragment|DOMParser)\b
\bRange\.createContextualFragment\b
\b(eval|Function)\b
\bsetTimeout\s*\(\s*['"`]      # string-form setTimeout
\bsetInterval\s*\(\s*['"`]
\blocation\s*=\s*              # navigation from input
\blocation\.(href|replace|assign)\s*=
\bwindow\.open\b
\b(postMessage|addEventListener\s*\(\s*['"]message)\b
\bcookie\b
\blocalStorage\b|\bsessionStorage\b
\bnew\s+URL\b
\bfetch\s*\(
\bXMLHttpRequest\b
\b(src|href|action|formaction|data|codebase)\s*=   # attribute sinks
\bdangerouslySetInnerHTML\b
\btrustedTypes\b
```

### Universal sinks

```
\bexec(File)?\b
\b(serialize|deserialize|unserialize)\b
\b(YAML\.load|yaml\.load)\b    # flag unsafe loaders specifically
\b__proto__\b|\bconstructor\.prototype\b|\bprototype\s*\[
\bnew\s+RegExp\s*\(             # regex built from input → ReDoS
\b\.\+[^?]|\b\(\.\*\)[^?]       # unbounded quantifiers in regex literals
```

Record raw hits. Reading the context to decide whether each is a real sink happens in Phase 2.

## Step 4: Identify trust boundaries

A trust boundary is any point where data crosses from less-trusted to more-trusted code. For a library, the boundaries are:

1. **Caller → exported function arguments.** The canonical boundary. Every exported function argument is untrusted for audit purposes, *even if* the docs say callers will pass sanitized data. Docs are not a security control.
2. **Network → parser.** Response bodies, inbound sockets, WebSocket frames, webhook payloads.
3. **Filesystem → parser.** Config files, manifest files, user-supplied paths.
4. **Env / argv → library logic.** For CLIs or libraries that read env.
5. **Subresource → library logic.** Fetched scripts, dynamic imports, WASM modules.

For each boundary, identify the *parsers* it crosses. Parsers are where injection, DoS, and deserialization bugs live. A parser includes: JSON/YAML/TOML loaders, URL parsers, template engines, regex-based tokenizers, HTML parsers, decoders (base64, hex, utf-8), and any custom state machine.

## Step 5: Write the map

The map is a working artifact, not part of the final report (though the Scope section references it). Roughly:

```
Entry points:
  - src/index.ts → exports { parseFoo, renderFoo, FooClient }

Reachable sinks:
  - parseFoo → JSON.parse with reviver (src/parse.ts:42) [deserialization]
  - parseFoo → new RegExp(userPattern) (src/parse.ts:61) [ReDoS]
  - renderFoo → el.innerHTML = html (src/render.ts:17) [DOM XSS]
  - FooClient.request → fetch(new URL(userInput, base)) (src/client.ts:88) [SSRF]

Boundaries:
  - caller args → parseFoo, renderFoo, FooClient.*
  - network → FooClient.request response body → JSON.parse (src/client.ts:104)

Non-sinks in scope:
  - No use of child_process
  - No use of vm
  - No use of fs
```

The "non-sinks in scope" line matters — it tells the report reader what you proved *absent*, not just what you found.

## Common misses to watch for

- **Type coercion entry points.** `parseFoo(x)` where `x` is declared `string` in TS but coerced — the library has no runtime check, so the real input type is `unknown`. Treat it as `unknown` for audit.
- **Default exports with dynamic dispatch.** `export default { ...handlers }` where handlers are chosen by a `type` field from caller input. Every handler is on the trust boundary, not just the entry point.
- **Getter side effects.** A property access can run arbitrary code if the input object has getters. Any `x.foo` where `x` came from a caller is a function call for audit purposes.
- **Proxy / Reflect metaprogramming.** Same as above, plus invariant traps.
- **Lazy imports.** A sink imported inside a conditional branch still ships.
- **Test utilities re-exported.** Libraries sometimes re-export `./test-utils` in `exports` accidentally. Check the `exports` map carefully.
