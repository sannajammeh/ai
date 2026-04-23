# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## About this repo

Collection of Claude Code skills and AI tools. No build system, no tests, no package.json — pure skill definitions and reference docs.

## Skill structure

Skills live in `skills/<skill-name>/` and are **never** placed in `.claude/skills/` — that directory is a symlink to `skills/` and must not be modified directly.

Each skill follows this layout:

```
skills/<name>/
  SKILL.md          # Required — frontmatter + skill instructions
  references/       # Optional domain-specific reference docs loaded on demand
  assets/           # Optional templates, report skeletons, etc.
  evals/            # Optional eval definitions
  scripts/          # Optional helper scripts
```

`SKILL.md` frontmatter (YAML between `---` fences):

```yaml
---
name: skill-name
description: >
  One-sentence trigger description used by Claude to decide when to invoke the skill.
  Include trigger phrases and anti-triggers (when NOT to use).
---
```

## Key conventions

- **Skill descriptions are trigger prompts.** Write them to match the natural language a user would say, including negative examples ("do NOT use for…"). Claude uses only the description to decide whether to invoke a skill.
- **Reference files load on demand.** Skills should not load all references up front — load only what's relevant to the detected scope to keep context lean.
- **Skills propose, don't mutate by default.** Unless the user explicitly asks to apply changes, skills produce output (reports, diffs, analysis) without modifying files.
