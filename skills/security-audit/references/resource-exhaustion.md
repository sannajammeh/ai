# Resource Exhaustion / DoS

CWE-400 / CWE-770. Any unbounded allocation, parse, or computation reachable from a trust boundary is a DoS vector. For libraries, the audit bar is: does the library allow a caller to turn bounded input into unbounded resource use?

## Categories

### Unbounded buffer / string allocation

- `Buffer.concat(chunks)` without a `totalLength` cap — an attacker streams chunks until heap is exhausted.
- String concat in loops accumulating attacker-controlled data (HTTP body accumulation, etc.).
- `JSON.stringify` on a large object-graph — `structuredClone` is often safer but both can blow up.

### Parser bombs

- Zip bombs: high-ratio compressed archives. Libraries that extract archives must check decompressed size ratios and impose caps.
- Billion-laughs / XML entity expansion: covered under XXE, but also relevant as pure DoS.
- JSON with deeply nested structures: `JSON.parse` stack is bounded but memory isn't; deeply nested objects with small keys can OOM.
- YAML aliases / anchors: `{&a: [1], b: *a, c: *a, …}` — exponential expansion.

### Regex (ReDoS)

See `redos.md` — catastrophic-backtracking regex is the most common DoS in JS libs.

### Async fan-out

- `Promise.all(items.map(fetch))` where `items` comes from input: N parallel fetches = N sockets, DNS lookups, memory.
- Mitigation: cap concurrency (`p-limit`, `p-queue`, custom semaphore).

### Unbounded recursion

- Tree walkers that don't track depth.
- Recursive merges / traversals called with circular input → stack overflow (which in Node is a *throw*, recoverable, but still a DoS at a request level).

### Event loop starvation

- CPU-heavy sync work on a request path. A single pathological input can block the loop.
- Mitigation: chunk with `setImmediate` for genuinely heavy loops, offload to a worker.

## Patterns to flag

```
# Unbounded accumulation
rg -n 'Buffer\.concat\s*\([^,]+\)' --type ts --type js   # no length arg
rg -n 'on\s*\(\s*[\"\\']data[\"\\']\s*,' --type ts --type js  # raw stream data handlers
rg -n 'Promise\.all\s*\(\s*\w+\.map' --type ts --type js

# Deep recursion
rg -n 'function\s+\w+\s*\([^)]*\)\s*\{\s*[^}]*\w+\s*\([^)]*\)\s*\{' --type ts

# Unbounded JSON / structured clone
rg -n 'JSON\.(parse|stringify)\s*\(' --type ts --type js
rg -n 'structuredClone\s*\(' --type ts --type js
```

## Bounded alternatives

```ts
// Bounded concat
import { Buffer } from "node:buffer";
const MAX = 10 * 1024 * 1024;
let total = 0;
const chunks: Buffer[] = [];
for await (const chunk of stream) {
  total += chunk.length;
  if (total > MAX) { stream.destroy(new Error("payload too large")); break; }
  chunks.push(chunk);
}
const body = Buffer.concat(chunks, total);
```

```ts
// Bounded fan-out
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}
```

## Parser defaults

For each parser in the library or in its deps, check defaults:

- `body-parser` / `express.json`: default limit is 100kb — ok, but if the library ups it by default, flag.
- `multer` / `busboy`: upload size caps — absent by default in some configs; flag.
- `fast-xml-parser`: check entity handling.
- `pako` / `zlib`: document decompression ratio caps for callers.

## Websocket / streaming

- Per-message size caps.
- Per-connection message rate caps.
- Backpressure: does the library drain before accepting more? Silent buffering is a memory DoS.

## Finding wording

> `parseDocument(buf)` accepts a Buffer, decompresses with `zlib.inflate` (`src/doc.ts:20`) and parses the result with no cap on decompressed size. A ~1kb compressed input can expand to 1GB+, OOMing the consumer.

Patch: wrap `inflate` with a streaming decompressor that tracks output size and aborts over a configurable threshold; default threshold to 10× input size or 50MB, whichever is smaller.

## Non-findings

- Pure synchronous utilities that run on trusted data and are bounded by input size are not findings.
- DoS via regex is covered in `redos.md` — don't double-count.
