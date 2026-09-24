---
name: hq
description: Orient across every origin of a superrepo from one digest (trackers, wayfinder maps, frontier, worktrees) instead of reading each repo's docs and querying each tracker. Use when starting a new task in an HQ superrepo (a directory holding `origins/` and `worktrees/`), when picking which repo, ticket, or worktree a task belongs to, or when the user asks where things stand across projects.
---

One script run orients a session across the whole HQ. It replaces reading each origin's `AGENTS.md`, its `docs/agents/issue-tracker.md`, and every map body just to find out where things stand.

## Layout the script expects

An HQ is a superrepo that manages other repos:

```
<hq>/
├── AGENTS.md          optional routing line per origin (see below)
├── origins/<repo>/    one clone per managed repo
├── worktrees/<task>/<repo>/
└── data/hq-state.json cache written by the script (git-ignore it)
```

The root is found by walking up from the cwd to the nearest directory holding `origins/`; `--root <path>` or `HQ_ROOT` override it. Each origin's tracker comes from its `docs/agents/issue-tracker.md` (first line names GitHub or Linear; `on \`owner/repo\``, `**Team**:`, `**Project**:` are parsed). Fallback is a line in the HQ `AGENTS.md` that mentions `` `origins/<name>` `` and either `Issues in Linear (team X, project "Y")` or `` GitHub issues on `owner/repo` ``. Maps and their children are the tickets labelled `wayfinder:*` (the `wayfinder` skill's convention). Linear needs `LINEAR_API_KEY` in the env or `~/.zshrc`.

## Steps

1. **Run** `bun ${CLAUDE_SKILL_DIR}/scripts/hq.ts` from inside the HQ. Variants: `--origin <name>` when the task already names its repo; `--closed` when a finished map's decisions matter; `--cached` when the trackers were fetched earlier this session and nothing was written since; `--json` for the raw state.
2. **Read** one block per origin (see [Reading the digest](#reading-the-digest)).
3. **Zoom** into the single ticket you will act on: GitHub `gh issue view <n> --comments`, Linear `get_issue` then `list_comments`. A map body is loaded only by `/wayfinder` when resolving a ticket on it.
4. Oriented when you can state, without further reads: the origin, its tracker and scope, the map and frontier ticket (or "no open map"), the backlog's `ready-for-agent` tickets, and the worktree to reuse or create.

## Reading the digest

```
## <origin> · <tracker> · <branch> · clean|dirty N · ahead A behind B
docs: CONTEXT.md · adr N · spec N · research N
- map #n <title> (<url>)
  destination: <first line>
  decisions N · fog N · open children N of M
  frontier → #n <title> [<type>]
  claimed: … @user   blocked: … (by N)
orphan: #n <title> [<type>] — open wayfinder ticket outside any open map
backlog: N open outside maps
  ready-for-agent → #n <title>
  needs-triage N · needs-info N · ready-for-human N · untriaged N
worktrees:
- <task> → <branch> · clean|dirty N · ticket <id> · PR #n STATE|no PR
```

- **Header**: `behind B` on an origin's `main` means pull before cutting a new worktree from it.
- **docs**: counts only (`CONTEXT.md`, `docs/adr`, `docs/spec`, `docs/research`). Open `CONTEXT.md` and ADRs when the task touches domain terms, per that origin's `docs/agents/domain.md`.
- **maps** (GitHub and Linear alike): `frontier →` is the one ticket to claim. `claimed` means another session holds it. `blocked` waits. Ids read `#12` on GitHub, `SKA-100` on Linear.
- **error** line: the tracker call failed; the rest of the block is still valid.
- **orphan**: an open wayfinder ticket whose map is closed or missing. Leftover until the user says otherwise.
- **backlog**: plain tickets (no open map, no `wayfinder:` label) grouped by the five triage roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`; see the origin's `docs/agents/triage-labels.md`). `ready-for-agent →` is takeable like a frontier ticket; a slice of a feature that never had a map lands here (e.g. "slice 2 of the sidebar"). Other roles are counts only; `untriaged` tickets carry none of the five labels and need a human before an agent acts.
- **worktrees**: `ticket` comes from the branch name or a title match against open issues. Reuse the worktree whose ticket matches the task. `PR MERGED` with a clean tree is removable.

## Refresh

The cache is a snapshot at `generatedAt`. Re-run after any tracker write (claim, close, create) or worktree change.
