#!/usr/bin/env bun
/**
 * diagramming.mjs — render Mermaid (via pele) and D2 sources onto one shared
 * themed HTML page and open it in the browser.
 *
 *   bun diagramming.mjs '<source>' [more sources…] [--out <path>] [--no-open]
 *   bun diagramming.mjs <<'EOF'        stdin; a lone === line separates diagrams
 *   flowchart TD
 *     A --> B
 *   ===
 *   direction: down
 *   api: API {shape: cylinder}
 *   a -> api
 *   EOF
 *   bun diagramming.mjs '<source>' --engine d2      force an engine (default: auto)
 *
 * Engine auto-detection is per diagram: a source whose first meaningful line is a
 * mermaid type keyword renders through pele; anything else renders through D2.
 *
 * Shared theme (both engines): dark #0a0a0a page, #111113 cards, #EDEDEF text on
 * ui-monospace, accent palette blue/purple/green/red. pele gets it as --pele-*
 * CSS variables; D2 gets --theme=201 with the canvas recolored to the page
 * background, TALA layout when installed (elk fallback), MesloLGS NF embedded
 * when present on disk.
 *
 * Exits 1 with the failing engine's own error (pele: code/line/column/snippet;
 * D2: line/column) — fix the source and re-run.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = `usage: bun diagramming.mjs '<source>' [more sources…] [--out <path>] [--no-open] [--engine d2|mermaid]
   or: bun diagramming.mjs <<'EOF'   (stdin; a lone === line separates diagrams)
flowchart TD
  A --> B
===
direction: down
api: API {shape: cylinder}
a -> api
EOF`;

function die(message) {
  console.error(`diagramming: ${message}`);
  process.exit(1);
}

// --- shared theme ---------------------------------------------------------

const THEME = {
  bg: "#0a0a0a",
  card: "#111113",
  cardAlt: "#17171A",
  fg: "#EDEDEF",
  muted: "#A1A1AA",
  line: "#3F3F46",
  border: "#26262A",
  accent: "#3291FF",
  critical: "#E5484D",
  d2Base: "#000410", // d2 theme 201's canvas color, recolored to bg below
};

const MERMAID_STARTERS = [
  "flowchart", "graph", "sequencediagram", "classdiagram", "statediagram",
  "erdiagram", "mindmap", "gantt", "timeline", "journey", "gitgraph",
  "quadrantchart", "sankey", "pie", "xychart", "requirementdiagram",
  "architecture-beta", "swimlane-beta", "agentflow-beta", "eventmodeling",
  "kanban", "treemap-beta", "radar-beta", "packet", "block", "treeview-beta",
  "railroad-ebnf-beta", "railroad-beta", "venn-beta", "ishikawa-beta",
  "cynefin-beta", "wardley-beta", "usecase-beta", "c4component", "c4context",
  "c4container", "c4dynamic", "c4deployment",
];

function detectEngine(source) {
  const first = source
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("//"));
  if (!first) return "d2";
  const key = first.toLowerCase().replace(/[^a-z0-9]/g, "").split(/[\s{]+/)[0];
  const hit = MERMAID_STARTERS.some((s) => s === key || key.startsWith(s));
  return hit ? "mermaid" : "d2";
}

// --- args -----------------------------------------------------------------

const argv = process.argv.slice(2);
const flags = { out: undefined, open: true, engine: undefined };
const sources = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--out") { flags.out = argv[++i]; if (!flags.out) die("--out needs a path"); }
  else if (a === "--no-open") flags.open = false;
  else if (a === "--engine") {
    flags.engine = argv[++i];
    if (flags.engine !== "d2" && flags.engine !== "mermaid") die(`--engine must be d2 or mermaid`);
  }
  else if (a === "-h" || a === "--help") { console.log(USAGE); process.exit(0); }
  else if (a.startsWith("-")) die(`unknown flag ${a}\n${USAGE}`);
  else sources.push(a);
}
if (sources.length === 0 && !process.stdin.isTTY) sources.push(await Bun.stdin.text());
if (sources.every((s) => !s.trim())) die(`no diagram source\n${USAGE}`);

const diagrams = sources
  .flatMap((s) => s.split(/^===[ \t]*\r?$/m))
  .map((s) => s.trim())
  .filter(Boolean);

// --- pele (mermaid) --------------------------------------------------------
// Resolves via Bun's auto-install outside any project. Inside a project that has
// its own node_modules, install into a user cache once and re-run from there.

function peleBootstrap() {
  const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "pele-skill");
  mkdirSync(cache, { recursive: true });
  const pkg = join(cache, "package.json");
  if (!existsSync(pkg)) writeFileSync(pkg, JSON.stringify({ name: "pele-skill", private: true }) + "\n");
  if (!existsSync(join(cache, "node_modules", "pele"))) {
    const add = Bun.spawnSync(["bun", "add", "pele"], { cwd: cache, stdout: "inherit", stderr: "inherit" });
    if (add.exitCode !== 0) die(`bun add pele failed in ${cache}`);
  }
  const script = join(cache, "diagramming.mjs");
  copyFileSync(fileURLToPath(import.meta.url), script);
  const rerun = Bun.spawnSync([process.execPath, script, ...argv], {
    cwd: cache,
    env: { ...process.env, DIAGRAMMING_BOOTSTRAP: "1" },
    stdio: ["inherit", "inherit", "inherit"],
  });
  process.exit(rerun.exitCode ?? 1);
}

async function renderMermaid(source, index) {
  let pele;
  try {
    pele = await import("pele");
  } catch (error) {
    if (process.env.DIAGRAMMING_BOOTSTRAP) die(`pele is installed but could not be imported: ${error.message}`);
    peleBootstrap();
  }
  try {
    const result = pele.render(source, { idPrefix: `diagram-${index + 1}` });
    return { engine: "pele", type: result.type, svg: result.svg, width: result.width, height: result.height };
  } catch (error) {
    if (error instanceof pele.PeleError) {
      console.error(`diagramming: diagram ${index + 1} of ${diagrams.length} (pele) — ${error.code} at line ${error.line}, column ${error.column}`);
      if (error.snippet) console.error(error.snippet);
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

// --- d2 --------------------------------------------------------------------

function d2FontFlags() {
  const dir = join(homedir(), "Library", "Fonts");
  const regular = join(dir, "MesloLGS NF Regular.ttf");
  const bold = join(dir, "MesloLGS NF Bold.ttf");
  const flags = [];
  if (existsSync(regular)) flags.push("--font-regular", regular);
  if (existsSync(bold)) flags.push("--font-bold", bold);
  return flags;
}

function d2Layout() {
  const probe = Bun.spawnSync(["d2", "layout"], { stdout: "pipe", stderr: "pipe" });
  if (probe.exitCode === 0) {
    const listed = new TextDecoder().decode(probe.stdout);
    if (/^\s*-\s*.*tala/im.test(listed)) return "tala";
  }
  return "elk";
}

function renderD2(source, index) {
  const work = mkdtempSync(join(tmpdir(), "diagramming-d2-"));
  const input = join(work, "source.d2");
  const output = join(work, "out.svg");
  writeFileSync(input, source);

  const base = ["d2", "--layout", d2Layout(), "--theme", "201", ...d2FontFlags(), input, output];
  let run = Bun.spawnSync(base, { stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) {
    const err = new TextDecoder().decode(run.stderr);
    console.error(`diagramming: diagram ${index + 1} of ${diagrams.length} (d2)`);
    console.error(err.trim().split("\n").filter((l) => !l.startsWith("info: ")).join("\n"));
    rmSync(work, { recursive: true, force: true });
    process.exit(1);
  }

  let svg = new TextDecoder().decode(readFileSync(output));
  svg = svg.replaceAll(THEME.d2Base, THEME.bg); // canvas → page background
  svg = svg.replace("<svg ", `<svg preserveAspectRatio="xMidYMid meet" style="max-width:100%;height:auto;display:block" `, 1);
  const size = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  rmSync(work, { recursive: true, force: true });
  return {
    engine: "d2",
    type: "d2",
    svg,
    width: size ? Number(size[1]) : undefined,
    height: size ? Number(size[2]) : undefined,
  };
}

// --- render all ------------------------------------------------------------

const results = [];
for (let i = 0; i < diagrams.length; i++) {
  const engine = flags.engine ?? detectEngine(diagrams[i]);
  results.push(engine === "mermaid" ? await renderMermaid(diagrams[i], i) : renderD2(diagrams[i], i));
}

// --- page ------------------------------------------------------------------

function page(results) {
  const vars = `--pele-bg:${THEME.bg};--pele-fg:${THEME.fg};--pele-fg-on-light:#0a0a0a;--pele-fg-on-dark:#ffffff;
    --pele-muted:${THEME.muted};--pele-line:${THEME.line};--pele-surface:${THEME.card};--pele-surface-alt:${THEME.cardAlt};
    --pele-border:${THEME.border};--pele-accent:${THEME.accent};--pele-critical:${THEME.critical};`;
  const many = results.length > 1;
  const body = results
    .map(({ engine, type, svg }) =>
      many
        ? `<div class="view"><div class="caption">${type} · ${engine}</div>${svg}</div>`
        : svg,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Diagram · ${results.map((r) => r.type).join(" + ")}</title>
<style>
  :root { color-scheme: dark; ${vars} }
  body {
    margin: 0; min-height: 100vh; box-sizing: border-box; padding: 32px;
    display: flex; flex-direction: column; align-items: center; gap: 48px;
    background: var(--pele-bg); color: var(--pele-fg);
    font: 13px/1.4 ui-monospace, "Geist Mono", Menlo, monospace;
  }
  svg { max-width: 100%; height: auto; }
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
  return join(mkdtempSync(join(tmpdir(), "diagramming-")), `diagramming-${results.map((r) => r.type).join("+")}.html`);
}

const file = writeOut();
writeFileSync(file, page(results));

const opener = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : undefined;
if (flags.open && opener) Bun.spawn([opener, file], { stdout: "ignore", stderr: "inherit" });
console.log(
  `${file}  (${results.map((r) => `${r.type} ${r.engine}${r.width ? ` ${r.width}×${r.height}` : ""}`).join(", ")})`,
);
