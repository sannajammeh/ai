# Deserialization

CWE-502. Turning untrusted bytes into a live object graph is where many "unexpected code execution" bugs live. JS has fewer direct "magic deserialization" gadgets than Python or Java, but there are real ones.

## JSON

### `JSON.parse` with a reviver

```ts
JSON.parse(input, (k, v) => resolvers[k]?.(v) ?? v);
```

The reviver runs for every key. If the reviver dispatches based on caller-controlled keys (especially with prototype walk), it's both a pollution risk and a gadget:

- `"__proto__"` as a key in a reviver may reach `Object.prototype` (see `prototype-pollution.md`).
- Revivers that instantiate classes from a `__type` field (attempt at generic deserialization) invite attacker class choice.

### Safe patterns

- Plain `JSON.parse(input)` with no reviver, then validate shape with Zod / io-ts / a hand-rolled validator.
- If a reviver is used, allowlist keys and never walk via `Object.prototype`.

## YAML

`yaml` (the npm package) exposes both safe and unsafe parsers:

- `YAML.parse(text)` — safe, returns plain data.
- `YAML.parseDocument(text)` — exposes tags, types; with custom tag handlers, can instantiate classes.
- `js-yaml` `load` was historically unsafe (enabled custom types); `safeLoad` / `load` with `DEFAULT_SAFE_SCHEMA` is the safe variant. Modern `js-yaml` renamed `load` to be safe by default — check the version.

Flag any YAML parser that accepts custom tags or uses `!!js/function`, `!!js/regexp`, `!!js/undefined` schemas.

## TOML, XML, CSV

- TOML: most parsers are safe by default; no code exec primitive.
- XML: watch for XXE (XML External Entity) if the library uses a DOM-based parser with entity expansion. In Node, `libxmljs` with `noent: false` is a finding; `fast-xml-parser` is safe. For browser, `DOMParser` does not resolve external entities.
- CSV: the parse itself is safe, but downstream spreadsheet-formula injection (`=CMD("…")` when a user opens the CSV in Excel) is a finding for libraries emitting CSVs with untrusted content. Prefix suspicious cells with `'` or escape per [CVE-2014-3524](https://owasp.org/www-community/attacks/CSV_Injection).

## Structured Clone

`structuredClone(x)` is safe for cloning but:

- Can fail on unserializable values.
- Can consume a lot of memory on deeply nested or circular inputs — see `resource-exhaustion.md`.
- Does not invoke toJSON / revivers — safer than JSON for round-tripping.

## MessagePack, CBOR, BSON

Binary formats. Two categories of concern:

1. **Tag-based type reviver** — some CBOR decoders allow custom tag handlers that can instantiate classes. Flag any use of tag handlers for untrusted input.
2. **Canonical encoding bypass** — for security-relevant data (e.g., signed payloads), the library should *only* accept canonical encoding, not tolerate equivalent-but-different encodings. Non-canonical acceptance invites signature-replay with altered-but-equivalent payloads.

For libraries that verify signatures over encoded data, verify over the *raw bytes* received, not over re-encoded data. Always.

## Protobuf

- Unknown fields: ensure the library either preserves or drops them deterministically. Unknown fields carried forward can confuse downstream consumers.
- Deeply nested messages: most decoders impose depth limits (typically 100). Flag if the library disables the limit.
- Union / oneof decoding: ensure mutually exclusive fields are not all populated post-decode.

## JWT / JWS

Covered in `crypto.md`. The deserialization specifics:

- Accept only canonical base64url encodings.
- Reject non-compact or extended JWTs if the library only intends compact JWS.
- Reject `typ: "JWE"` on a JWS verifier and vice versa.

## Generic "class reconstruction"

Any library that accepts a blob and instantiates classes based on a type field is a Critical finding waiting to happen. Patterns to flag:

- `eval("new " + typeName + "(" + JSON.stringify(args) + ")")` — obvious, rare, still happens.
- Lookup table `new classes[typeName](...args)` — safer but still admits any class the table registers.
- Use of `node-serialize`, `serialize-javascript`, `cryo`, `funcster` — these have had RCE histories.

If the library has a legitimate need to reconstruct classes:

- Each class registers an explicit, named deserializer that validates every field.
- The class registry is a closed allowlist, not a lookup by arbitrary string.

## Finding wording

> `loadConfig(text)` calls `yaml.load(text)` using `js-yaml` v3 with the default schema, which accepts `!!js/function` tags (`src/config.ts:14`). A malicious config file triggers arbitrary code execution at load time.

Patch: upgrade `js-yaml` and use `yaml.load` (now safe) or `CORE_SCHEMA`, or switch to `yaml`'s `parse`.

## Non-findings

- `JSON.parse` with no reviver on data that will be validated before use is not a finding.
- Binary parsers that don't expose tag handlers and impose depth limits are fine.
