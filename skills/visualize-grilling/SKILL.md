---
name: visualize-grilling
description: Turn the current grilling round into an interactive decision sheet (Artifact) whose compiled answers the user pastes back.
model: claude-sonnet-5
disable-model-invocation: true
---

Publish the current grilling round as a decision sheet: one card per frontier question, recommended picks preselected, a compiled answer block the user copies and pastes back into the chat. Use it after a round has been asked in chat (via `grilling` / `grill-with-docs`) and the user wants to answer by clicking instead of typing.

## Steps

1. **Collect the round.** From the conversation, take the current frontier: every open `❓ Qn` with its options and the `➡️` recommendation, plus the facts already settled by exploration. Settled questions from earlier rounds stay out; only the open frontier goes on the sheet.

2. **Fill the template.** Copy `${CLAUDE_SKILL_DIR}/assets/template.html` into the scratchpad as `<slug>-round-<n>.html` and replace every `{{...}}` marker:
   - `TITLE`: product-style name, two to four words (`Agenda Sidebar Decisions`). Keep it stable across rounds of the same subject.
   - `SUBJECT`, `SLUG`, `ROUND`, `LEDE`.
   - Facts `<li>` list: settled facts the options depend on. Delete the section if none.
   - `QUESTIONS` array: one entry per `Qn`. `multi: true` when the chat question said "pick all that apply". `rec: true` on the option(s) matching the `➡️` recommendation. Option `d` carries the trade-off in one line. Plain text everywhere in the array (it is JS string literals; escape quotes).

3. **Publish.** Artifact tool, favicon `🗂️` on first publish only. A new round of the same subject is a new file path (round in the name); a fix to the current round republishes the same path.

4. **Reply** with the link in one line. Then wait.

5. **On paste-back**, the block arrives as:
   ```
   <SUBJECT> — round <n> answers

   Q1 <title>: <picked labels; separated>
       note: <free text>
   ```
   Treat each line as the user's answer to that question. Notes override picks when they conflict. Recompute the frontier and continue the grilling round loop in chat.

6. **Diagram the hard parts.** When the frontier is empty and the settled design gets written down (issues, ADR, spec), every complex piece carries a diagram so a human can grasp it at a glance. Complex means: a user flow across more than one screen, a UI with several regions or states, a backend path crossing more than two components (browser → runtime → hook → DB), or code whose control flow branches. Two forms:
   - **ASCII** goes inline in the issue or ADR body, inside a fenced code block. Default form; survives GitHub, terminals, and diffs. Box a layout, arrow a data flow, one diagram per mechanism.
   - **HTML** is for anything ASCII cannot hold legibly (many nodes, states that toggle, layers that overlap). Publish it as an Artifact styled from the `references/DESIGN.md` tokens, load `artifact-diagramming` first, and link it from the issue under the ASCII sketch.
   Each diagram shows the real mechanism with real names from the codebase (routes, files, tables, events), never generic boxes. Done when a reader could explain the piece from the picture alone.

## Design

The sheet's theme is fixed and lives in `assets/template.html`; `references/DESIGN.md` records the tokens, type, layout, and component specs. When a round needs a new element, derive it from those tokens rather than adding new colours or faces.

## Sheet behaviour (for reference)

Picks persist in the viewer's browser under `KEY`, so reopening keeps state. "Reset to recommended" restores the `rec` defaults. Copy falls back to selecting the textarea when the clipboard is blocked.
