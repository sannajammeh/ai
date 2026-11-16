# pele (Mermaid) type table

Every type below renders through pele (https://pele.run). Syntax reference per type: https://pele.run/examples/<type> — check it when a type is unfamiliar. The source starts with the listed keyword; that first line is also how the wrapper detects the engine.

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

Rule of thumb against the D2 branch: pele takes the *narrative* views (flows over time, states, axes, storytelling); D2 takes the *structural* ones (systems, schemas, complex graphs). A quick 3-entity sketch can stay `erDiagram`; a real database model belongs in D2's `sql_table`.
