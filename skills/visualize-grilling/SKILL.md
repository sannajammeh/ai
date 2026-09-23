---
name: visualize-grilling
description: Turn the current grilling round into an interactive decision sheet (Artifact), with ASCII diagrams and code examples, whose compiled answers the user pastes back.
model: claude-sonnet-5
disable-model-invocation: true
---

Publish the current grilling round as a decision sheet: an overview of the task, one card per frontier question, recommended picks preselected, and a compiled answer block the user copies back into the chat. The sheet is a wizard: the user answers every card from the sheet alone, without scrolling back through the chat. Figures carry the complex parts.

## Steps

1. **Collect the round.** From the conversation, take the current frontier: every open `❓ Qn` with its options and the `➡️` recommendation, plus the facts already settled by exploration. Earlier rounds' settled questions stay out. Done when every open `Qn` is in hand.

2. **Plan the figures.** Walk the task, then each question and option, against [Figures](#figures) and decide which ones earn one. Read the code the question touches so each figure uses real names. Done when every complex piece has a figure planned and every figure maps to real routes, files, types, or events.

3. **Fill the template.** Copy `${CLAUDE_SKILL_DIR}/assets/template.html` into the scratchpad as `<slug>-round-<n>.html` and replace every `{{...}}` marker:
   - `TITLE`: product-style name, two to four words (`Agenda Sidebar Decisions`), stable across rounds of the same subject.
   - `SUBJECT`, `SLUG`, `ROUND`, `LEDE`.
   - `OVERVIEW`: title, one or two sentences on how the whole task fits together, and its figures. Set it to `null` when the task is a single mechanism the questions already show.
   - Facts `<li>` list: settled facts the options depend on. Delete the section if none.
   - `QUESTIONS`: one entry per `Qn`. `multi: true` when the chat question said "pick all that apply". `rec: true` on the option(s) matching `➡️`. `body` states what the choice decides and what it touches. Option `d` carries the trade-off in one line. Question-level `figs` show the shared mechanism; an option's `fig` shows what that option looks like, so two options side by side read as a diff. Drop any `figs`/`fig` key a question does not need.
   - Everything in the arrays is a JS literal: plain text in `"..."` strings (escape quotes), figure `text` in backtick template literals (escape backticks and `${`). HTML in figure text is escaped on render.

   Done when no `{{` remains and each card is answerable by someone who never saw the chat.

4. **Publish.** Artifact tool, `icon: "checklist"` on first publish only. A new round of the same subject is a new file path (round in the name); a fix to the current round republishes the same path.

5. **Reply** with the link in one line. Then wait.

6. **On paste-back**, the block arrives as:
   ```
   <SUBJECT> — round <n> answers

   Q1 <title>: <picked labels; separated>
       note: <free text>
   ```
   Each line is the user's answer to that question. Notes override picks when they conflict. Recompute the frontier and continue the grilling loop in chat.

7. **Diagram the settled design.** When the frontier is empty and the design gets written down (issues, ADR, spec), every complex piece carries a figure per [Figures](#figures). ASCII goes inline in the issue or ADR body inside a fenced code block. Anything ASCII cannot hold legibly (many nodes, toggling states, overlapping layers) becomes an HTML Artifact styled from `references/DESIGN.md`: load `artifact-diagramming` first and link it under the ASCII sketch. Done when a reader could explain each piece from its picture alone.

## Figures

A figure earns its place on complex functionality:

- a user flow across more than one screen
- a UI with several regions or states
- a backend path crossing more than two components (browser → runtime → hook → DB)
- control flow that branches
- a choice between API shapes, types, config, or call sites

Simple questions (naming, a yes/no policy, a number) stay text-only.

Two kinds:

- **ASCII** (`kind: "ascii"`) for structure: box a layout, arrow a data flow, lay out a state machine, draw a before/after. One mechanism per figure, at most about 70 columns wide.
- **Code** (`kind: "code"`, `lang`) for shape: the call site, type, config, or schema each option produces. Show the smallest snippet where the options differ, with real identifiers from the codebase.

Every figure shows the real mechanism with real names (routes, files, tables, events, functions), and its caption says what the reader is looking at. Done when the reader could pick an option from the figure and its caption alone.

## Design

The sheet's theme is fixed in `assets/template.html`. `references/DESIGN.md` records its tokens, type, layout, and component specs. New elements derive from those tokens.
