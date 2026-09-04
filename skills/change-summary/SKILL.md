---
name: change-summary
description: Publish a visual overview of a completed change as an Artifact — a mechanism diagram, a before/after, a field-by-field table, the commits, and what is left to verify.
disable-model-invocation: true
---

Publish one Artifact page that lets a reader who did not watch the work see what changed and why it was needed. Run it after the change is committed.

## Gather

1. **Scope**: `git log <base>..HEAD --oneline` and `git diff <base>...HEAD --stat`. `<base>` is the branch's merge-base with main unless the user names one.
2. **Spec**: the issue, ADR, or user request the change answers. One sentence on what it demanded.
3. **Verification**: what was run and what passed. Anything not run goes on the page under *Left to verify*, never implied.

## Build

Load `artifact-design` and `artifact-diagramming`, then write the page. Utilitarian treatment: a plan, not a landing page. Sections, in order:

1. **Lede**: the change in two sentences. Lead with what was wrong or missing, then what is true now.
2. **Figure**: one inline SVG of the mechanism. Draw where data flows and which part the change adds, removes, or reroutes. Color by ownership or source (who owns each value, which system answers), with a legend and a caption stating the one claim the figure makes. Real example values from the domain, never placeholders.
3. **Before / Now**: the concrete scenario the change fixes, one column each, in the user's vocabulary.
4. **Table**: one row per field, component, or path touched. Columns: was, now, and the untouched sibling when one exists.
5. **What else landed**: adjacent deletions or additions, each tagged and explained in one sentence.
6. **Commits**: SHA and subject per commit on the branch.
7. **Left to verify**: numbered checks a human runs next, each naming the observable result.

Done when every behavioural change in the diff appears in exactly one section and every unverified claim sits under *Left to verify*.

## Deliver

Publish with a subject-specific title (the thing that changed, not "Change summary"). Reply with the link first, then a terminal recap short enough to stand alone: commits, verification status, and what was not verified.
