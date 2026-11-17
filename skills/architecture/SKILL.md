---
name: architecture
description: >
  Persist a settled design into the architecture file pair — architecture.md
  (prose + diagram sources, the source of truth) and architecture.html (the
  diagrams rendered) — via the diagramming skill's renderer. Use when the user
  is happy with the design and says "save the architecture", "write it to the
  architecture file", "persist the diagrams", "ship the architecture docs", or
  invokes /architecture. Do NOT use for one-off iteration diagrams (that's
  diagramming) — this fires when the design is settled, not while exploring it.
---

Turn a settled design into a durable **architecture file pair**: `architecture.md` carries the prose and every diagram's source; `architecture.html` is those sources rendered through the diagramming skill's script. The markdown is the source of truth — the html is always derived from it, so the two cannot disagree.

## Steps

1. **Locate the pair.** Default `docs/architecture.md` + `docs/architecture.html` at the repo root; a path the user names wins. A pair already there? Read the markdown first and update it in place — prose evolves, diagrams are added, replaced, or dropped, and nothing stale may survive into the new html. Done when the target paths are fixed and any existing markdown is in context.

2. **Write the markdown.** Narrative prose sections; each diagram as one fenced code block tagged with its engine (```mermaid or ```d2), under a heading that says what it shows, in reading order. Done when every diagram belonging in the document is a tagged block in this file — nothing renders until the markdown is complete.

3. **Render the html.** Extract the fenced blocks from the markdown just written, in order, and feed them to the diagramming script:

   ```sh
   bun <diagramming skill's dir>/scripts/diagramming.mjs --format html --out <same dir>/architecture.html --no-open <<'EOF'
   <block 1 source>
   ===
   <block 2 source>
   EOF
   ```

   Invoke the diagramming skill for the script's location, theme, and render rules — its script and conventions are used as-is, never reimplemented. Done on exit 0.

4. **Verify.** Both files on disk and the html holding one view per markdown block, in the same order — open the page and check. An html rendered from anything other than the markdown's own blocks is wrong: regenerate it, never hand-patch.

## Rules

- The pair lives or dies as a unit: a markdown edit without a re-render, or an html with no markdown behind it, is broken.
- Diagrams keep the engine they were drawn with; saving converts nothing.
