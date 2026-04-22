# SSRF — Server-Side Request Forgery

CWE-918. Library makes an outbound HTTP (or other network) request whose destination is influenced by caller input. Attacker steers the request at internal hosts, cloud metadata endpoints, or localhost services — often reading secrets or pivoting into the consumer's private network.

## Patterns to flag

- Any `fetch`, `axios.get`, `got`, `undici.request`, `http.request`, `https.request`, `net.connect`, `dgram.send` where the URL / host / port comes from caller input.
- `new URL(userInput, baseUrl)` — if the user supplies a scheme or host, the base is overridden.
- Webhook / callback URL fields in configuration that the library then calls.
- Redirect followers. By default most clients follow redirects; a request to a caller-controlled URL can be redirected into the metadata endpoint on the second hop.
- Avatar / image fetchers. Classic: "upload from URL" features.

## Safe URL handling

```ts
const parsed = new URL(input); // throws on invalid

// 1. Scheme allowlist
if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("bad scheme");

// 2. Host allowlist (or deny-list of private ranges + DNS-resolved check)
if (isPrivateHost(parsed.hostname)) throw new Error("private host");

// 3. Port pin
if (parsed.port && !ALLOWED_PORTS.has(parsed.port)) throw new Error("bad port");
```

Scheme allowlist alone is not enough — `http://169.254.169.254/` (AWS metadata) is perfectly valid `http`.

## Private ranges to block

IPv4:

- `0.0.0.0/8`
- `10.0.0.0/8`
- `100.64.0.0/10` (CGNAT)
- `127.0.0.0/8`
- `169.254.0.0/16` (link-local, includes AWS/GCP metadata 169.254.169.254)
- `172.16.0.0/12`
- `192.0.0.0/24`
- `192.168.0.0/16`
- `198.18.0.0/15`
- `224.0.0.0/4` (multicast)
- `240.0.0.0/4` (reserved)

IPv6:

- `::/128` (unspecified), `::1/128` (loopback)
- `fc00::/7` (ULA)
- `fe80::/10` (link-local)
- `ff00::/8` (multicast)
- `::ffff:0:0/96` (IPv4-mapped — many libraries forget this, and `::ffff:127.0.0.1` reaches localhost)

Cloud metadata:

- AWS: `169.254.169.254` (IMDSv1), `fd00:ec2::254` (IPv6)
- GCP: `metadata.google.internal`, `169.254.169.254`
- Azure: `169.254.169.254`
- Alibaba, OCI, DO: also `169.254.169.254`
- Kubernetes API: usually `kubernetes.default.svc` inside cluster — consider blocking `.svc` hostnames if library is deployed in k8s

## DNS rebinding

A domain can resolve to a public IP on first lookup and a private IP on the next. If your check is `lookup → is_public → connect`, the second resolution bypasses the check.

Mitigations:

1. Resolve once, pin the resulting IP, and connect to that IP (setting `Host` header manually). Node's `http.request` accepts `host` + `servername` for this.
2. Use an HTTP client that supports a "resolved host" callback (`undici` with a custom dispatcher).
3. Post-connect, check the remote address: `socket.remoteAddress` — if it's private, tear down.

Libraries that fetch URLs on behalf of callers should do option 1 or 3. Option 2 is cleanest on Node 20+ with `undici`.

## Redirect handling

Follow-redirects is a common SSRF vector. Options:

- Disable redirects by default. Make it opt-in.
- If you allow redirects, re-run the full URL validation on each hop, including the resolved IP check.
- Cap redirect count (3–5).

## Other transports

- `ws://` / `wss://` — same risks; `ws` package uses its own http request, same allowlist logic applies.
- `net.connect` to arbitrary host:port — pure SSRF potential (think: database connection, Redis on localhost).
- DNS lookups themselves: `dns.lookup` can enumerate internal hosts. Less severe but worth noting.
- File URIs: `file://` scheme is a separate class — local file read, not SSRF per se, but same vigilance on scheme allowlists.

## Server-render and preview features

Libraries that generate link previews, OG-image fetchers, HTML parsers that follow `<img src>` are all classic SSRF engines.

## Finding wording

> `fetchPreview(url)` accepts any URL, calls `fetch(url, { redirect: "follow" })`, and returns the response body (`src/preview.ts:40`). No scheme, host, or resolved-IP validation is performed. A caller passing `http://169.254.169.254/latest/meta-data/` against an AWS consumer returns IAM credentials.

Patch: scheme allowlist, private-range IP check (including IPv4-in-IPv6), `redirect: "manual"` with per-hop revalidation, optional opt-in for trusted internal hosts.

## Non-findings

- Libraries that take a URL and return it parsed (no network) — no SSRF.
- Internal service clients that require explicit configuration of base URL and don't take arbitrary URLs — no SSRF, but note the API contract so it can't be subverted by later refactors.
