#!/usr/bin/env bun
/**
 * pele.mjs — render Mermaid to a self-contained HTML page with pele (https://pele.run)
 * and open it in the browser.
 *
 *   bun pele.mjs 'flowchart TD
 *     A[Client] --> B[API]'                          one diagram: fresh tmpdir, open browser
 *   bun pele.mjs 'flowchart ...' 'sequenceDiagram …'  several diagrams, stacked on one page
 *   bun pele.mjs <<'EOF'                              read from stdin; a lone === line
 *   flowchart TD                                     separates diagrams
 *     A --> B
 *   ===
 *   sequenceDiagram
 *     A->>B: hi
 *   EOF
 *   bun pele.mjs '<mermaid>' --out diagram.html       keep the HTML at a path
 *   bun pele.mjs '<mermaid>' --no-open                write and print the path only
 *
 * Every pele diagram type is supported (the main `pele` entry registers all of them).
 * Exits 1 with a pele error (code, line, column, snippet) — fix the mermaid and re-run.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = `usage: bun pele.mjs '<mermaid>' [more mermaid…] [--out <path>] [--no-open]
   or: bun pele.mjs <<'EOF'   (stdin; a lone === line separates diagrams)
flowchart TD
  A --> B
EOF`;

function die(message) {
  console.error(`pele: ${message}`);
  process.exit(1);
}

// --- args ---------------------------------------------------------------

const argv = process.argv.slice(2);
const flags = { out: undefined, open: true };
const sources = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--out") { flags.out = argv[++i]; if (!flags.out) die("--out needs a path"); }
  else if (a === "--no-open") flags.open = false;
  else if (a === "-h" || a === "--help") { console.log(USAGE); process.exit(0); }
  else if (a.startsWith("-")) die(`unknown flag ${a}\n${USAGE}`);
  else sources.push(a);
}
if (sources.length === 0 && !process.stdin.isTTY) sources.push(await Bun.stdin.text());
if (sources.every((s) => !s.trim())) die(`no mermaid source\n${USAGE}`);

// A lone === line separates diagrams, so one run can combine views on one page.
const diagrams = sources
  .flatMap((s) => s.split(/^===[ \t]*\r?$/m))
  .map((s) => s.trim())
  .filter(Boolean);

// --- load pele ----------------------------------------------------------
// Resolves via Bun's auto-install outside any project. Inside a project that has
// its own node_modules, install into a user cache once and re-run from there,
// where the import resolves.

function bootstrap() {
  const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "pele-skill");
  mkdirSync(cache, { recursive: true });
  const pkg = join(cache, "package.json");
  if (!existsSync(pkg)) writeFileSync(pkg, JSON.stringify({ name: "pele-skill", private: true }) + "\n");
  if (!existsSync(join(cache, "node_modules", "pele"))) {
    const add = Bun.spawnSync(["bun", "add", "pele"], { cwd: cache, stdout: "inherit", stderr: "inherit" });
    if (add.exitCode !== 0) die(`bun add pele failed in ${cache}`);
  }
  const script = join(cache, "pele.mjs");
  copyFileSync(fileURLToPath(import.meta.url), script);
  const rerun = Bun.spawnSync([process.execPath, script, ...argv], {
    cwd: cache,
    env: { ...process.env, PELE_SKILL_BOOTSTRAP: "1" },
    stdio: ["inherit", "inherit", "inherit"],
  });
  process.exit(rerun.exitCode ?? 1);
}

let pele;
try {
  pele = await import("pele");
} catch (error) {
  if (process.env.PELE_SKILL_BOOTSTRAP) die(`pele is installed but could not be imported: ${error.message}`);
  bootstrap();
}

// --- render -------------------------------------------------------------

const results = [];
for (let i = 0; i < diagrams.length; i++) {
  try {
    // Unique idPrefix per diagram on the page, per the pele API.
    results.push(pele.render(diagrams[i], { idPrefix: `pele-${i + 1}` }));
  } catch (error) {
    if (error instanceof pele.PeleError) {
      console.error(`pele: diagram ${i + 1} of ${diagrams.length} — ${error.code} at line ${error.line}, column ${error.column}`);
      if (error.snippet) console.error(error.snippet);
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

// --- page ---------------------------------------------------------------

const types = results.map((r) => r.type);

function page(results) {
  const palette = `--pele-bg:#fffcf0;--pele-fg:#100f0f;--pele-fg-on-light:#100f0f;--pele-fg-on-dark:#ffffff;
    --pele-muted:#6f6e69;--pele-line:#100f0f;--pele-surface:#f2f0e5;--pele-surface-alt:#e6e4d9;
    --pele-border:#cecdc3;--pele-accent:#205ea6;--pele-critical:#af3029;`;
  const dark = `--pele-bg:#100f0f;--pele-fg:#cecdc3;--pele-fg-on-light:#100f0f;--pele-fg-on-dark:#ffffff;
    --pele-muted:#878580;--pele-line:#cecdc3;--pele-surface:#1c1b1a;--pele-surface-alt:#282726;
    --pele-border:#403e3c;--pele-accent:#4385be;--pele-critical:#d14d41;`;
  const many = results.length > 1;
  const body = results
    .map(({ svg, type }) => (many ? `<div class="view">${svg}<div class="caption">${type}</div></div>` : svg))
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pele · ${types.join(" + ")}</title>
<style>
  :root { color-scheme: light dark; ${palette} }
  @media (prefers-color-scheme: dark) { :root { ${dark} } }
  body {
    margin: 0; min-height: 100vh; box-sizing: border-box; padding: 32px;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 56px;
    background: var(--pele-bg); color: var(--pele-fg);
    font: 13px/1.4 ui-sans-serif, system-ui, sans-serif;
  }
  svg.pele { max-width: 100%; height: auto; }
  .view { display: flex; flex-direction: column; align-items: center; gap: 12px; max-width: 100%; }
  .caption { color: var(--pele-muted); letter-spacing: 0.04em; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function writeOut() {
  if (flags.out) {
    mkdirSync(dirname(flags.out), { recursive: true });
    return flags.out;
  }
  return join(mkdtempSync(join(tmpdir(), "pele-")), `pele-${types.join("+")}.html`);
}

const file = writeOut();
writeFileSync(file, page(results));

const opener = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : undefined;
if (flags.open && opener) Bun.spawn([opener, file], { stdout: "ignore", stderr: "inherit" });
console.log(`${file}  (${results.map((r) => `${r.type} ${r.width}×${r.height}`).join(", ")})`);
