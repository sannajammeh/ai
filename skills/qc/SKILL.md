---
name: qc
description: >
  Ultra-compressed commit generator. Cuts noise from commit messages while preserving
  intent and reasoning, then runs the commit. Splits unrelated changes into separate
  commits so the working tree ends up clean. Conventional Commits format. Subject ≤50 chars,
  body only when "why" isn't obvious. Use when user says "write a commit", "commit message",
  "generate commit", "/commit", or invokes /qc.
model: haiku
---

Write commit messages terse and exact. Conventional Commits format. No fluff. Why over what.

## Rules

**Subject line:**
- `<type>(<scope>): <imperative summary>` — `<scope>` optional
- Types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `build`, `ci`, `style`, `revert`
- Imperative mood: "add", "fix", "remove" — not "added", "adds", "adding"
- ≤50 chars when possible, hard cap 72
- No trailing period
- Match project convention for capitalization after the colon

**Body (only if needed):**
- Skip entirely when subject is self-explanatory
- Add body only for: non-obvious *why*, breaking changes, migration notes, linked issues
- Wrap at 72 chars
- Bullets `-` not `*`
- Reference issues/PRs at end: `Closes #42`, `Refs #17`

**What NEVER goes in:**
- "This commit does X", "I", "we", "now", "currently" — the diff says what
- "As requested by..." — use Co-authored-by trailer
- "Generated with Claude Code" or any AI attribution — unless the user's own rule requires an `Assisted-by`/AI-attribution trailer, then add it as a trailer
- Emoji (unless project convention requires)
- Restating the file name when scope already says it

## Examples

Diff: new endpoint for user profile with body explaining the why
- ❌ "feat: add a new endpoint to get user profile information from the database"
- ✅
  ```
  feat(api): add GET /users/:id/profile

  Mobile client needs profile data without the full user payload
  to reduce LTE bandwidth on cold-launch screens.

  Closes #128
  ```

Diff: breaking API change
- ✅
  ```
  feat(api)!: rename /v1/orders to /v1/checkout

  BREAKING CHANGE: clients on /v1/orders must migrate to /v1/checkout
  before 2026-06-01. Old route returns 410 after that date.
  ```

## Auto-Clarity

Always include body for: breaking changes, security fixes, data migrations, anything reverting a prior commit. Never compress these into subject-only — future debuggers need the context.

## Committing

The goal is a **clean working tree** — every change committed under a fitting message.

1. Survey everything first: `git status` and `git diff` (and `git diff --staged`). Account for staged, unstaged, and untracked files.
2. Decide whether it's one logical change or several unrelated ones (see **Splitting** below).
3. For each logical unit, stage exactly its files, write its message, commit.
4. Re-check `git status` at the end — the tree must be clean (nothing left uncommitted). If anything remains, it belongs to a commit you missed; go back to step 2.

Rules for each commit:

- The message must match what's actually staged for *that* commit — verify with `git diff --staged` before committing
- Never `git add -A` blindly when the changes are unrelated — stage per group with explicit paths
- Commit with a heredoc to preserve formatting:
  ```bash
  git commit -m "$(cat <<'EOF'
  <message>
  EOF
  )"
  ```
- Never `--no-verify`, never `--amend`, never rewrite history

## Splitting

When the changes clearly belong to more than one concern, commit them **separately** — one commit per logical unit — rather than one mixed commit.

Signs the changes are unrelated:
- Different types (`feat` here, unrelated `fix`/`chore`/`docs` there)
- Touch unrelated modules, features, or scopes with no shared reason
- A cleanup or formatting drive-by riding along with a feature
- Bumping deps / config alongside actual logic changes

How to split:
- Group files (or hunks, via `git add -p` when a single file mixes concerns) by concern
- Stage one group with explicit paths, commit it, then the next — smallest independent units, ideally each buildable on its own
- Order commits so dependencies land first (e.g. the refactor before the feature that uses it)
- When it's genuinely one coherent change, don't over-split — a single commit is correct

If grouping is ambiguous (a change could plausibly belong to two units), state your proposed grouping and commit it; don't stall waiting for confirmation unless the user asked to review first.

Show `git log --oneline -n <count>` (and `git status` proving the tree is clean) as confirmation once all commits are made.

## Boundaries

Generates messages and runs `git commit` — one or several as needed to clear the tree. Does not push, does not amend. "stop caveman-commit" or "normal mode": revert to verbose, single-commit style.
