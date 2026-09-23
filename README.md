# ai

Claude Code skills. Install one with the [skills CLI](https://skills.sh):

```sh
npx skills add sannajammeh/ai --skill <name> -g
```

| Skill | What it does |
|---|---|
| `change-summary` | Publish a visual overview of a completed change as an Artifact: mechanism diagram, before/after, commits, what is left to verify. |
| `checkin-integration` | Implement and talk to the Checkin.no API for event participant syncs. |
| `hq` | One digest across every origin of a superrepo: trackers, wayfinder maps, frontier, worktrees. Bun script in `skills/hq/scripts/hq.ts`. |
| `qc` | Ultra-compressed Conventional Commits generator. |
| `security-audit` | Security review of a JS/TS codebase, domain by domain. |
| `visualize-grilling` | Publish a `grilling` round as an interactive decision sheet Artifact with ASCII diagrams and code examples; answers paste back into chat. |

Layout per skill: `SKILL.md` plus optional `references/`, `assets/`, `scripts/`, `evals/` (see `CLAUDE.md`).
