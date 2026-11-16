---
name: diagramming
description: >
  Render diagrams to a self-contained themed HTML page, opened in the browser: D2
  for complex flowcharts, system design (services, boundaries, data stores), and
  database/entity modelling (sql_table); pele (Mermaid) for everything else —
  sequence, state, class, mindmap, gantt, timeline, journey, C4. Use when the user
  says "diagram this", "visualize the architecture", "show the design/flow",
  "entity diagram", "ER diagram", "system design diagram", or invokes /diagramming —
  and fire it whenever a proposed or reviewed design deserves a picture. Do NOT use
  for mermaid destined for markdown or PRs (just write the mermaid), UI mockups, or
  ASCII sketches.
---

Give a design a **diagram view**. Two engines behind one workflow: write the source, one script renders every diagram onto the same themed page. The script owns the theme — dark `#0a0a0a`, mono type, accent-coded categories — for both engines, so write content, never page styling.

## Steps

1. **Pick the engine per diagram**, by what the reader must see:

   | The reader must see | Engine |
   |---|---|
   | Complex flowchart — many branches, clustered subgraphs, deep chains | D2 |
   | System design — services, trust boundaries, stores, external systems | D2 |
   | Database model — entities, columns, keys, relations | D2 (`sql_table`) |
   | Hop-by-hop message flow | pele: `sequenceDiagram` |
   | Lifecycle, states, modes | pele: `stateDiagram-v2` |
   | Domain model, inheritance | pele: `classDiagram` |
   | Quick entity sketch, few entities | pele: `erDiagram` |
   | Anything else — mindmap, gantt, timeline, journey, C4, sankey, … | pele: see `references/mermaid-types.md` |

   D2 wins ties: anything structural or layered goes D2. When writing mermaid, load `references/mermaid-types.md` for the full type table; when writing D2, load `references/d2.md` for authoring rules (quoting, reserved ids, `sql_table`, layouts).

2. **Write the sources.** One source per diagram. A lone `===` line separates diagrams on one page, and mixing engines on one page is fine — each source is detected on its own.

3. **Render.** From this skill's `scripts/` directory; quote the source (brackets, pipes and arrows are shell metacharacters):

   ```sh
   bun <this skill's dir>/scripts/diagramming.mjs '<source>' [more sources…] [--out <path>] [--no-open]
   # or via stdin, === separating diagrams:
   bun <this skill's dir>/scripts/diagramming.mjs <<'EOF'
   flowchart TD
     A[Client] --> B[API]
   ===
   direction: down
   api: API {shape: cylinder}
   a -> api
   EOF
   ```

   Engine is auto-detected per diagram: a source whose first line is a mermaid type keyword goes pele, anything else goes D2. Force an engine with `--engine d2` or `--engine mermaid`.

4. **Verify.** Exit 0 writes the HTML, opens the browser, prints the path. Done when the page is on screen and matches the design. Exit 1 names the failing diagram with the engine's own error (pele: code, line, column, snippet; D2: line, column) — fix the source and re-run; the HTML is never hand-edited.

## Rules

- The script carries the theme for both engines: pele through its CSS variables, D2 through `--theme=201` plus canvas recolor to `#0a0a0a`, layout TALA with elk fallback, embedded mono font. Sources stay free of page-chrome styling; category accent strokes inside a D2 source (blue client, purple server, green data, red auth) are the one allowed touch.
- `--out <path>` keeps the HTML at a path instead of a fresh tmpdir — use it when the artifact should outlive the session; `--no-open` writes and prints the path only.
- The page is self-contained (inline SVG, fonts embedded, no network) and writes nowhere but the tmpdir or `--out`.
