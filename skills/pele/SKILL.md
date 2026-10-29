---
name: pele
description: >
  Render a visual architecture of a proposed or active solution: Mermaid in, a self-contained
  themed HTML page out, opened in the user's browser. Use when the user says "visualize the
  architecture", "diagram this system", "show the design/flow", "big picture", or invokes /pele —
  and fire it yourself whenever an architecture you proposed or reviewed deserves a picture.
  Picks the right pele diagram type per solution, combining several on one page when no single
  view carries it. Do NOT use for mermaid destined for markdown or PRs (just write the mermaid),
  UI mockups, or ASCII sketches.
---

Give a proposed or active solution an **architecture view**. You write Mermaid, pele (https://pele.run) renders it to SVG, and the wrapper packages it as a self-contained HTML page in a fresh tmpdir and opens it in the user's browser.

## Steps

1. **Choose the view.** Decide what the reader must see, then write the mermaid source whose type carries it. Every type below is supported.

   | The reader must see | Source starts with |
   |---|---|
   | Components, dependencies, boundaries | `flowchart TD` / `flowchart LR` — subgraphs are boundaries |
   | Deployed services, groups, links | `architecture-beta` |
   | A request's hop-by-hop message flow | `sequenceDiagram` |
   | Hand-offs across actors or roles | `swimlane-beta LR` |
   | Lifecycle: states, events, modes | `stateDiagram-v2` |
   | Domain model: types and inheritance | `classDiagram` |
   | Data model: entities, relations, cardinality | `erDiagram` |
   | Agent pipeline: tools, connectors, nested flows | `agentflow-beta TB` |
   | Event-sourced flow: commands, events, processors | `eventmodeling` |
   | Capabilities decomposed into sub-areas | `mindmap` |
   | Delivery phases and dependencies | `gantt` |
   | Milestones over time | `timeline` |
   | An actor's experience over steps | `journey` |
   | Branch / release strategy | `gitGraph` |
   | Actors against use cases | `usecase-beta` |
   | Options on two axes (effort vs impact) | `quadrantChart` |
   | Component evolution, build-vs-buy | `wardley-beta` |
   | Root causes grouped by category | `ishikawa-beta` |
   | Decision domains, sense-making | `cynefin-beta` |
   | Overlapping concerns | `venn-beta` |
   | Protocol / grammar structure | `railroad-ebnf-beta` (or `railroad-beta`) |
   | Work in columns of state | `kanban` |
   | Requirements and traceability | `requirementDiagram` |
   | Composition, cost or size share | `treemap-beta` / `pie` |
   | Flow volume between nodes | `sankey` |
   | Metric across categories or time | `xychart` |
   | Multi-dimensional comparison | `radar-beta` |
   | Byte / field layout | `packet` / `block` |
   | File or project tree | `treeView-beta` |
   | C4 model views | `C4Component` (also `C4Context`, `C4Container`) |

   Syntax reference per type: https://pele.run/examples/<type> — check it when a type is unfamiliar.

2. **Render.** Run the wrapper from this skill's `scripts/` directory. Quote the source: brackets, pipes and arrows are shell metacharacters.

   ```sh
   bun <this skill's dir>/scripts/pele.mjs '<mermaid source>'
   ```

   Multi-line sources and combinations go through stdin; a lone `===` line separates diagrams on one page:

   ```sh
   bun <this skill's dir>/scripts/pele.mjs <<'EOF'
   flowchart TD
     A[Client] --> B[API]
   ===
   sequenceDiagram
     A->>B: POST /orders
   EOF
   ```

3. **Verify.** The script exits 0, writes the HTML, opens the browser, and prints the path. Done when the diagram is on screen and matches the solution.

   - `--out <path>` keeps the HTML at a path instead of a fresh tmpdir — use it when the artifact should outlive the session.
   - `--no-open` writes and prints the path without opening a browser — use it for variants or headless runs.
   - Exit 1 prints a pele error — code, line, column, source snippet — naming which diagram failed. Fix the mermaid and re-run; the HTML is never hand-edited.

## Choices

- One view per run when it carries the solution; a **combination** when it does not — typically a flowchart of components plus a sequence of the key request, or a state diagram of the lifecycle being proposed.
- The page is self-contained (inline SVG, no network, light/dark aware) and writes nowhere but the tmpdir or `--out`.
