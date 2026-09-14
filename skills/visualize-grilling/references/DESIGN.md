# Decision sheet design system

The exact theme baked into `assets/template.html`. Edit the template through these tokens; add nothing that is not derived from them.

## Colour tokens

| Token | Light | Dark | Role |
|---|---|---|---|
| `--paper` | `#f4f5f3` | `#131518` | page ground, textarea ground |
| `--panel` | `#ffffff` | `#1b1e22` | question cards, output card, bottom bar |
| `--ink` | `#17191c` | `#ecedee` | primary text |
| `--ink-2` | `#4a5058` | `#b4b9c0` | body copy, option descriptions |
| `--ink-3` | `#8a919b` | `#737a84` | eyebrows, labels, status |
| `--line` | `#d9dcd8` | `#2f343a` | card borders, dividers |
| `--line-2` | `#eceeea` | `#24282d` | option borders at rest, progress track |
| `--accent` | `#2456c8` | `#7c9cff` | selected option border, primary button, recommended badge, focus ring, progress fill, Q ids |
| `--accent-ink` | `#ffffff` | `#0c1330` | text on accent |
| `--accent-soft` | `#e6ecfb` | `#1e2740` | selected option fill |
| `--fact` | `#e9eef0` | `#20262b` | settled-facts panel ground |
| `--fact-ink` | `#2d3a44` | `#c7d0d8` | settled-facts text |
| `--ok` | `#1f7a4d` | `#5fc98f` | answered dot in TOC, "Copied" status |
| `--code` | `#eef0ec` | `#101215` | inline code ground |

Neutrals are green-grey biased (paper `#f4f5f3`, lines `#d9dcd8`), cool enough to sit beside a cobalt accent. Dark theme is a redefinition of the same tokens, applied under `@media (prefers-color-scheme: dark)` guarded as `:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]`. No colour is defined outside the token set.

## Type

Google Fonts, all IBM Plex:

| Role | Face | Weights | Where |
|---|---|---|---|
| Display | IBM Plex Sans Condensed | 500, 600 | `h1` 34px, question `h2` 21px, facts `h2` 16px |
| Body | IBM Plex Sans | 400, 500, 600 | 15px / 1.55 body; option labels 500; descriptions 13.5px |
| Utility | IBM Plex Mono | 400, 500 | eyebrow, Q ids, "pick one / pick many", note labels, recommended badge, status, counter, output textarea 13px |

Uppercase utility text carries `letter-spacing: 0.06em` to `0.08em`. Headings use `text-wrap: balance`. Running copy capped at 62 to 66ch.

## Layout

- Page: `max-width 1100px`, grid `200px | 1fr`, `gap 40px`, padding `32px 24px 120px` (bottom padding clears the fixed bar). Under 800px it collapses to one column and the TOC unsticks.
- Header spans both columns, bottom border `--line`.
- Left column: sticky TOC (`top 24px`) listing Q ids + titles, a 7px dot per question that turns `--ok` when answered, a divider, then a link to the compiled answers.
- Main column: vertical stack, `gap 28px`: facts panel → question cards → output card.
- Fixed bottom bar: answered counter (mono, tabular-nums), 4px progress bar (`--line-2` track, `--accent` fill, max 320px), "Jump to answers" link right-aligned.

## Components

- **Facts panel**: `--fact` ground, 6px radius, 16/18px padding, bullet list 14px. No border.
- **Question card**: `--panel`, 1px `--line` border, 6px radius, padding `20px 22px 18px`. Head row: Q id (mono, accent) · title (condensed 21px) · kind label (mono uppercase, right-aligned).
- **Option**: grid `18px | 1fr`, gap 12px, padding `10px 12px`, 1px `--line-2` border, 5px radius. Hover → `--line`. Checked → `--accent` border + `--accent-soft` fill. Focus-visible → 2px accent outline. Native checkbox/radio with `accent-color`.
- **Recommended badge**: mono 10.5px uppercase, 1px accent border, 3px radius, inline after the label.
- **Note field**: mono uppercase label + textarea on `--paper`, 1px `--line` border, 4px radius.
- **Output card**: `--panel` with a 1px `--accent` border (the one lifted card on the page), mono textarea `white-space: pre`, min-height 260px. Buttons: primary = accent fill; secondary = panel with `--line` border. Status text mono 12.5px, `--ok` on success.

## Motion

Progress bar width transitions 200ms; disabled under `prefers-reduced-motion`. Nothing else animates.
