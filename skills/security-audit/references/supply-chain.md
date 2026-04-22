# Supply Chain

For a library, the supply chain is two-faced: what you depend on, and what you ship. Both are in scope.

## What ships (from this package)

### `files` / `.npmignore`

Read `package.json`'s `files` array. If absent, `.npmignore` rules; if also absent, `.gitignore` rules; if also absent, the entire cwd ships. Flag:

- Missing `files` entirely — ships test fixtures, editor configs, `.env.example`, `.env` (!).
- `files` too broad (e.g., `"**/*"`).
- `.env`, `.env.*` not excluded.
- `coverage/`, test directories, `tsconfig.json`, source maps with embedded source — case-by-case; for library authors targeting end users, inline source maps increase surface.

Check with:

```bash
npm pack --dry-run 2>/dev/null | sed -n '/Tarball Contents/,/Tarball Details/p'
```

and review the list.

### Install scripts

```
scripts.preinstall
scripts.install
scripts.postinstall
scripts.preuninstall
scripts.uninstall
```

Any of these run during `npm install` in consumer environments. Audit each:

- Fetches a binary from the network? That's a known-bad pattern — consumers using `--ignore-scripts` will install a broken package, but consumers without it will run whatever the library fetched.
- Runs arbitrary build? Check whether prebuilt binaries are shipped instead, with fallback to build.
- Has side effects in the consumer's cwd? Flag — install scripts should not.

Best-practice patches:

- Ship prebuilt native bindings via `prebuildify` / `node-gyp-build`, make `install` optional.
- Move build to `prepare` scripts (runs on publish, not install), where possible.
- Avoid `postinstall` for anything that isn't strictly required; document what each script does.

### Binary publishing (`bin`)

- Binaries receive `argv` — treat as trust boundary; see `injection.md`.
- Shebang line: `#!/usr/bin/env node` is standard.
- Binary files should have executable bit set in the tarball.

### Publish-time invariants

- `npmrc` / `.npmrc` in repo containing tokens — checked in, leaked.
- `NPM_TOKEN` / `GH_TOKEN` in `.github/workflows` without secret masking.
- `publishConfig.access` should be set explicitly for scoped packages (`public` for open source).
- 2FA on publish: `publishConfig.provenance: true` on recent npm enables attestations — recommend enabling.
- `name` squatting: note if the package name is close to popular packages (typosquat-adjacent).

## What comes in (dependencies)

### Dependency audit

Run or reason about:

- `npm audit --production` — surface known CVEs for runtime deps. Include the summary in the report as prose, not inline findings.
- Lockfile present? `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`. Lockfile-free repos are a red flag for reproducibility.
- Pinned versions vs. `^` / `~` ranges — ranges are fine for libraries (consumers resolve), but integrity is via lockfile for the library's own dev.

### Transitive risk

- Deps with install scripts show up in `npm ls --production` with `postinstall` annotations if you inspect their package.json. A small direct dep graph with many transitive install scripts is a larger attack surface than it looks.
- Prefer deps with no install scripts; many alternatives exist for common needs.

### Dep selection hygiene

Flag at "Observations" level (not as Findings):

- Dependencies with very low weekly downloads on npm (typosquat risk if the name is close to popular).
- Dependencies maintained by a single unverified author with no public identity.
- Deps that were recently transferred to a new maintainer (npm sends deprecation emails; GitHub org transfers can be a signal).

This is qualitative. Don't turn it into noise.

### License concerns

Out of scope for security unless a dep is GPL and the library is distributed under a permissive license — raise as a non-security process concern.

### Subresource integrity (browser libs)

If the library recommends a CDN URL in docs, the URL should have a `subresource-integrity` (SRI) hash in examples. Document `<script integrity="…">` usage.

## `npm` / `pnpm` / `yarn` specifics

- `npm overrides` / `pnpm.overrides` / `resolutions` in the library's own package.json — sometimes used to patch transitive deps; review for intent. If a library pins a dep's sub-dep to a specific version, that pin ships with metadata and affects consumers' resolution.
- `sideEffects: false` — not a security field per se, but mis-declaring causes tree-shaken bundles to omit side effects (including security checks) — verify none of the library's modules are security-relevant and declared side-effect-free.

## Reproducible builds

- Deterministic outputs (bundled dist): do rebuilds produce byte-identical output? Non-determinism complicates attestations but isn't a security finding by itself.
- SBOM generation (`npm sbom` on npm 10+, or `syft`): recommend, don't require.

## Finding wording

> The package has a `postinstall` script that downloads `./prebuilds/<platform>.tar.gz` from `https://deploys.example.com/…` over HTTP, without integrity verification (`package.json:scripts.postinstall`). A network attacker with MITM capability or control of the fetch destination achieves arbitrary code execution on install in every consumer environment.

Patch: switch to HTTPS, pin a SHA-256 of the tarball in the package, verify before extraction; or ship prebuilds via the npm tarball itself.

## Non-findings

- Version ranges in `dependencies` — normal for libraries.
- Deprecated deps with no CVE and no alternative — note as Observation.
