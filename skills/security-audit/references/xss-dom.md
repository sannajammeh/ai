# DOM / HTML XSS

Applies to browser-targeted libraries and any server-side library that emits HTML strings for downstream rendering. The core question: does untrusted data ever end up in an HTML-parsing sink without passing through a correct encoder for that specific context?

## Sinks (unambiguous)

These execute HTML/script when assigned untrusted values:

- `element.innerHTML = x`
- `element.outerHTML = x`
- `element.insertAdjacentHTML(pos, x)`
- `document.write(x)` / `document.writeln(x)`
- `new DOMParser().parseFromString(x, "text/html")` — doesn't execute scripts, but *does* parse all HTML, so any downstream `appendChild` into the live tree activates `<script>`. Flag.
- `Range.createContextualFragment(x)` + append
- `Element.setHTML(x)` (newer, behaves like `innerHTML` without Trusted Types check in some implementations)
- `new Function(x)` / `eval(x)` / `setTimeout(x, …)` with string x / `setInterval(x, …)` with string x
- `el.setAttribute("onclick", x)` — any event-handler attribute
- `<a href={x}>` where `x` starts with `javascript:` — a URL-sink (see URL sinks below)

## Sinks (context-dependent)

These are safe for *text* but unsafe for *HTML*, and vice versa:

- `el.textContent = x` — safe for HTML, unsafe if you wanted markdown/HTML rendering
- `el.innerText = x` — safe
- `node.data = x` on a `Text` node — safe
- `new URL(x).href` → `el.href = …` — safe for most attributes, but `javascript:` URLs still execute on `<a>`, `<iframe src>`, `<form action>`, `<button formaction>`, etc. Normalize schemes.

## URL sinks

Any attribute that resolves a URL can execute JS if the URL scheme is `javascript:` (and some legacy schemes). Flag any library code that writes a URL from input into:

- `a.href`, `area.href`, `base.href`
- `iframe.src`, `frame.src`, `embed.src`, `object.data`
- `form.action`, `button.formaction`, `input.formaction`
- `link.href` (especially with `rel="import"` in old code, though Imports are dead)
- Any attribute with `url()` syntax in inline style

Safe check:

```ts
const u = new URL(input, location.href);
if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad scheme");
```

Flag allowlists that use `startsWith("http")` — matches `httpzombie:` too.

## CSS / style sinks

- `el.style.cssText = x` — allows `expression()` in old IE; still allows `--var: url(javascript:…)` which some browsers used to execute via `url()` in background. Minor but worth flagging for libraries targeting broad browser support.
- `<style>{x}</style>` in JSX or server-rendered HTML — can break out of `</style>`.

## SVG sinks

SVG is HTML-shaped and carries its own script surface:

- `<svg>` containing `<script>`, `<foreignObject>`, `<iframe>`, `<use xlink:href="#...">` with external refs
- `Element.innerHTML = "<svg>…</svg>"` executes `<script>` inside
- Any library that accepts SVG strings from input and injects them into the DOM without a sanitizer that specifically knows about SVG.

## Sanitizer pitfalls

If the library uses a sanitizer:

- **DOMPurify** is fine when used correctly. Things to check:
  - Is it called with `RETURN_TRUSTED_TYPE: true` when the consumer uses Trusted Types?
  - Are `ALLOWED_TAGS` / `ALLOWED_ATTR` customized in a way that allows `javascript:` URLs (e.g., allowing `href` without the URL-check hook)?
  - Is it called with `SAFE_FOR_TEMPLATES: true` if the output goes into a template engine that re-interprets `{{…}}`?
- **Home-rolled regex-based sanitizers** — always a finding. HTML is not regular. Propose replacement with DOMPurify.
- **Parse-then-serialize "cleanup"** — browsers normalize HTML weirdly. Mutation XSS (mXSS) is a known class. If a library parses, modifies, then reserializes and re-inserts, flag for mXSS risk unless Trusted Types or a dedicated sanitizer is in the loop.

## Trusted Types

For libraries targeting modern browsers:

- Does the library create policies? Are policy names namespaced to the library (e.g., `foo-lib`) so consumers can allow only this lib's policies?
- Are there any `unsafeHTML`-style escape hatches that bypass Trusted Types?
- If the library doesn't use TT, that's not a finding in isolation — but if it writes to `innerHTML` unconditionally, consumers using `require-trusted-types-for` CSP will break. Flag as an API-contract note.

## React and JSX-specific

- `dangerouslySetInnerHTML={{ __html: x }}` with `x` from input is the only "obviously XSS" path in React. Flag it and require a sanitizer in the patch.
- `href={x}` and `src={x}` — React does **not** block `javascript:` URLs (as of React 19 it still doesn't, though the ecosystem warns). Libraries returning JSX should validate URL schemes themselves.
- Server-rendered React via `renderToString` is fine for text, but custom serializers (e.g., for streaming) can escape-mismatch.

## Pattern: building HTML strings in libraries

Libraries sometimes build HTML strings for consumers to render themselves. Every string concat is a potential sink:

```ts
return `<a href="${href}">${label}</a>`;
```

Both `href` and `label` are sinks here. `label` needs HTML-encoding; `href` needs URL-scheme validation *and* HTML-encoding. A correct helper uses distinct encoders per context.

Proposed patch pattern:

```ts
import { escapeHtml } from "./internal/escape";
import { safeUrl } from "./internal/url";
return `<a href="${escapeHtml(safeUrl(href))}">${escapeHtml(label)}</a>`;
```

And the `escapeHtml` must handle `&`, `<`, `>`, `"`, `'`, and `/`.

## Finding wording

Avoid "could be exploited by an attacker". Write:

> `render(label)` interpolates `label` directly into an `<a>` tag written to `el.innerHTML`. A caller passing `"</a><img src=x onerror=alert(1)>"` achieves script execution in the consumer page.

The *Patch* for DOM-XSS findings is almost always one of: switch the sink to `textContent`, introduce/extend an escape helper, or require a sanitizer for the input.
