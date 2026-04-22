# Parallel Execution — Fanning Out to Subagents

Phases 1 and 2 both parallelize well. Phase 1 is dominated by file reading — enumerating exports, pruning sink-inventory hits by context, walking the dep graph — and these tasks are independent. Phase 2 is embarrassingly parallel across domains. Phase 3 is the only phase that stays sequential in the orchestrator, because it correlates findings across domains.

This document is the protocol. Follow it exactly — the merge steps are where ad-hoc parallelism breaks.

## Phases at a glance

| Phase | What it does                             | Parallelizable?                                   |
| ----- | ---------------------------------------- | ------------------------------------------------- |
| 1     | Attack-surface mapping                   | **Yes** — task-based fan-out, optional dir-shards |
| 2     | Domain-specific audits                   | **Yes** — group-based fan-out                     |
| 3     | Cross-cutting review, merge, report      | **No** — orchestrator only                        |

Small, cheap steps (read `package.json`, infer runtime target) stay in the orchestrator even in Phase 1 — fanning those out costs more than it saves.

## When to go parallel at all

Use the Task / Agent tool to fan out when **any** of these is true:

- Codebase is > ~30 source files, or
- A first grep shows > 20 candidate sink hits, or
- The user explicitly asked for a fast audit.

Use sequential mode when:

- The codebase is tiny (< 15 source files) — orchestration overhead is not worth it.
- The user is iterating on one specific concern (e.g., "just check for ReDoS") and doesn't want the full sweep.
- The audit must be reproducible for regulatory purposes (parallel subagents are inherently non-deterministic on borderline findings).

---

## Phase 1 — Parallel attack-surface mapping

Phase 1 splits into three task-based subagents. The orchestrator runs the cheap preamble (read `package.json`, infer runtime target), then spawns these three in one turn. For very large codebases, the `sinks` subagent can be further sharded by source directory.

### Subagent roles

| Role        | Output                                                                                                 | Input                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `surface`   | The public API surface: every exported function reachable from entry points, signatures, trust notes  | `package.json`, entry-point files, `references/attack-surface.md` §§ Steps 1–2        |
| `sinks`     | Pruned list of dangerous sinks, grouped by category, each with `file:line` and 3–5 lines of context   | Target repo path, runtime hint (Node/browser), `references/attack-surface.md` § Step 3, `scripts/grep-sinks.sh` may be invoked |
| `deps`      | Dependency topology: direct deps, install scripts, native bindings, what ships via `files`/`npmignore` | `package.json`, lockfile, `references/supply-chain.md` §§ "What ships" and "What comes in" |

### Sharding the `sinks` subagent

For codebases with > 100 source files, split the `sinks` subagent by directory:

- One subagent per top-level source directory (typically `src/`, `lib/`, `packages/*`).
- Each shard runs the same grep inventory against its subdirectory, prunes false positives from context, and returns its category-grouped list.
- The orchestrator concatenates shard outputs before passing the unified sink inventory to Phase 2.

Do **not** shard by category (e.g., one subagent for crypto sinks, one for fs sinks). That redistributes the same files across many subagents and wastes reads. Shard by directory — each file is read once.

### Subagent prompt template (Phase 1)

```
You are part of the Phase 1 attack-surface mapping team for a security audit. You are working in parallel with other mappers. Your role is: <ROLE: surface | sinks | deps>.

## Inputs

- Target repo: <ABSOLUTE_PATH_TO_REPO>
- Runtime target: <Node | Browser | Isomorphic>
- References to follow:
  - <ABSOLUTE_PATH_TO_attack-surface.md>
  - <role-specific additions>
- Grep helper (optional): <ABSOLUTE_PATH_TO_scripts/grep-sinks.sh>
- Shard (sinks role only): scan only under <DIR> and skip other top-level dirs

## Task

<role-specific task description from the table above>

## Output contract

Return a JSON object with this exact shape:

Role `surface`:
{
  "entry_points": ["src/index.ts", "..."],
  "exports": [
    { "name": "parseFoo", "from": "src/index.ts", "signature": "(input: string) => Foo", "notes": "reaches JSON.parse reviver in src/parse.ts:42" },
    ...
  ],
  "cli_argv_boundary": false,
  "notes": "anything worth flagging for downstream reviewers"
}

Role `sinks`:
{
  "shard": "<dir or 'all'>",
  "categories": {
    "code_exec": [{ "file": "src/foo.ts", "line": 12, "snippet": "…3-5 lines…", "verdict": "real|false-positive", "note": "..." }],
    "shell": [...],
    "fs": [...],
    "network": [...],
    "crypto": [...],
    "dom": [...],
    "proto_pollution": [...],
    "regex_from_input": [...],
    "deserialize": [...],
    "storage": [...],
    "process_env": [...]
  }
}

Role `deps`:
{
  "direct_deps": ["pkg@^1", "..."],
  "install_scripts": { "postinstall": "...", "preinstall": "..." },
  "native_bindings": ["pkg"],
  "ships": ["dist/**", "README.md", "..."],
  "ships_warnings": ["e.g., no `files` field → everything ships"],
  "npm_audit_summary": "<short prose if the orchestrator asked for it>"
}

## Constraints

- Quote code exactly in `snippet`. Include file:line on the first line of the snippet as a comment.
- The `sinks` reviewer prunes false positives — don't include hits that obviously aren't sinks after reading 3–5 lines of context (e.g., `eval` inside a comment, `innerHTML` on a local variable never rendered).
- Do not audit. Do not propose patches. Your job is inventory, not review.
- Do not infer severity. Severity is assigned in Phase 2.
```

### Merging Phase 1 outputs

The orchestrator receives three JSON objects (plus one per shard if sinks was sharded). It assembles the canonical attack-surface map:

1. **Union the sink lists.** If sinks was sharded, concatenate each shard's categories. Drop anything with `verdict: "false-positive"`.
2. **Cross-reference surface and sinks.** For each export in the `surface` output, check which sinks are transitively reachable — this is the "exported function → reaches sink" column used by Phase 2. If the orchestrator can't trace reachability cheaply, leave it as "possibly reachable" and let Phase 2 decide.
3. **Write to disk.** Save the merged map to `<target-repo>/.security-audit-scratch/surface.md` (create `.security-audit-scratch/` if absent, add to `.gitignore` if writing in a git repo). Phase 2 subagents will read from this path.
4. **Feed `deps` output into two places.** The `supplychain` Phase 2 group consumes it directly. The Methodology section of the final report summarizes `ships_warnings` and `npm_audit_summary`.

---

## Phase 2 — Parallel domain audits

Phase 2 is the core parallelism most audits will benefit from. It runs after Phase 1's map is written to disk.

### When to go parallel in Phase 2

Fan Phase 2 out when:

- Attack-surface map has > 20 real sinks (post-prune), or
- Multiple domain groups each have ≥ 3 real sinks, or
- The user explicitly asked for a fast audit.

Otherwise run Phase 2 sequentially — walk the grouping table one row at a time.

### Phase 2 subagent grouping

Group domains that share a mental model into one subagent rather than spawning one per reference. The grouping below is the default; the orchestrator can adjust based on what the attack surface shows.

| Group            | References loaded                                                  | Triggered when …                                                                  |
| ---------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `injection`      | `injection.md`, `node-sinks.md`, `prototype-pollution.md`          | Any `child_process`, shell, DB, header, or recursive-merge hits                   |
| `dom`            | `xss-dom.md`, `browser-sinks.md`                                   | Browser target, or HTML-string emission                                           |
| `secrets`        | `crypto.md`, `timing.md`, `credentials.md`                         | Any `crypto`, `subtle`, JWT, auth, or secret-shaped material                      |
| `transport`      | `ssrf.md`, `csrf.md`, `rate-limiting.md`                           | Outbound HTTP, cookies, auth flows, verify endpoints                              |
| `parsers`        | `redos.md`, `deserialization.md`, `resource-exhaustion.md`         | Regex, JSON/YAML/XML/binary parsers, stream accumulators                          |
| `fs`             | `path-traversal.md`                                                | Any `fs`, `path`, archive extraction                                              |
| `supplychain`    | `supply-chain.md`                                                  | Always — reads `package.json`, independent of source                              |
| `contract`       | `api-contract.md`                                                  | Always — scans exports, options, defaults                                         |

If a group's trigger doesn't fire, skip it entirely. Don't spawn idle subagents.

## End-to-end orchestrator protocol

1. **Phase 1 preamble (orchestrator).** Read `package.json`, infer runtime target. Decide if Phase 1 parallel fan-out is warranted (see "When to go parallel at all").
2. **Phase 1 fan-out (parallel).** Spawn `surface` + `sinks` + `deps` subagents in one turn. For > 100 source files, shard `sinks` by top-level directory.
3. **Phase 1 merge (orchestrator).** Combine subagent outputs into the canonical attack-surface map. Write to `.security-audit-scratch/surface.md` in the target repo.
4. **Phase 2 dispatch (orchestrator).** Inspect the map, decide which Phase 2 groups fire, build the dispatch list.
5. **Phase 2 fan-out (parallel).** Spawn one subagent per fired group in one turn. Each gets:
   - The path to the scratch attack-surface map.
   - The path to the target repo.
   - The list of reference files to load (absolute paths inside the skill).
   - The group name and the exact output contract (see Phase 2 template below).
6. **Phase 2 merge (orchestrator).** Run the dedupe-and-merge protocol. The result is a single findings list.
7. **Phase 3 (orchestrator only).** Cross-cutting checks (defaults, errors, TOCTOU, isomorphism traps). Phase 3 has the full findings list and may downgrade, correlate, or add.
8. **Report assembly (orchestrator).** Use `assets/report-template.md`. Record in Methodology which phases ran parallel vs. sequential.

## Phase 2 subagent prompt template

Each Phase 2 subagent's prompt should be substantially this shape. Adapt only the fields in `<angle brackets>`.

```
You are auditing a JavaScript/TypeScript library for a single security domain group: <GROUP_NAME>.

You are working in parallel with other auditors covering other groups. Do not produce findings outside your group — those will be handled elsewhere, and duplicates create noise.

## Inputs

- Target repo: <ABSOLUTE_PATH_TO_REPO>
- Attack-surface map (produced by orchestrator): <ABSOLUTE_PATH_TO_SURFACE_MD>
- Reference playbooks to follow (load in order):
  - <ABSOLUTE_PATH_TO_REFERENCE_1>
  - <ABSOLUTE_PATH_TO_REFERENCE_2>
- Triage rubric (shared): <ABSOLUTE_PATH_TO_TRIAGE_MD>
- Reporting schema (shared): <ABSOLUTE_PATH_TO_REPORTING_MD>

## Task

1. Read the attack-surface map first. Identify which entries belong to your group.
2. Read each reference in order.
3. For each candidate sink in your group, verify the path from trust boundary to sink. Do not produce a finding unless you can write that path.
4. Apply the triage rubric to score severity.
5. Return findings in the exact schema below. Do not include preamble or narration.

## Output contract

Return **only** a JSON array. Each element is one finding:

```json
[
  {
    "group": "<GROUP_NAME>",
    "title": "<concise title, no period>",
    "severity": "Critical|High|Medium|Low|Informational",
    "cwe_primary": "CWE-<N>",
    "cwe_secondary": ["CWE-<N>", "..."],
    "locations": ["path/to/file.ts:LINE", "..."],
    "status": "Confirmed|Needs verification",
    "what": "<one sentence, mechanism-level>",
    "why_it_matters": "<short paragraph>",
    "evidence": "<quoted code with file:line header; as markdown fenced block>",
    "exploit_sketch": "<minimal adversarial call, or empty string if not applicable>",
    "patch_diff": "<unified diff against current file content, or empty string if destructive change — see migration_plan>",
    "migration_plan": "<for destructive changes, a 3-step plan; else empty string>",
    "justification": "<one sentence tying patch to root cause>"
  }
]
```

Return an empty array `[]` if you find nothing material in your group. Do not invent Low-severity filler to justify the run.

## Constraints

- Stay inside your domain group. If you notice something outside it, note it internally but do not emit it.
- Do not modify any file in the target repo. Propose patches as diffs only.
- Quote evidence exactly; do not paraphrase code.
- Do not guess CWEs — if nothing specific fits, use "CWE-20" and reconsider whether it's a finding.
```

Keep the template stable. If you diverge, merge becomes unreliable.

## Merge protocol

The orchestrator receives one JSON array per subagent. Merge:

1. **Parse & validate.** If a subagent returned malformed JSON, re-prompt that subagent once with "return valid JSON only". If still malformed, treat its findings as advisory and log the failure in the report appendix.
2. **Deduplicate.** Two findings are duplicates if they share primary CWE *and* at least one location. Take the higher severity, union the CWE-secondary lists, concatenate justifications (prefixed with group name), and keep one patch. Prefer the patch from the higher-severity finding, but cross-check that both subagents' intended fixes are compatible.
3. **Resolve conflicts.** If two subagents propose contradictory patches for overlapping lines, that's an orchestrator decision — pick the fix that addresses the deeper root cause and note the override in the finding's justification.
4. **Renumber.** Assign `F-01`, `F-02`, … after dedup, sorted by severity descending then path ascending.
5. **Pass through Phase 3.** The cross-cutting reviewer may raise new findings or mark some as informational based on compensating controls the domain reviewers didn't see.

## Context hygiene

Subagents load their own references; the orchestrator doesn't need to pre-load them. This keeps the orchestrator's context focused on the map and the merge.

Do **not** pass the full source tree in-prompt. Pass paths; subagents read on demand. This is the whole point of going parallel.

## Failure modes to guard against

- **Subagent ignores its group scope.** Mitigated by the "stay inside your domain group" constraint. Dedupe will catch strays anyway.
- **Subagent over-produces Low-severity noise.** The empty-array instruction is deliberate; reinforce if needed.
- **Subagent reads files and hallucinates line numbers.** Spot-check a sample of locations against the actual file; if a subagent's numbers are consistently wrong, re-run it.
- **Coordinator token budget blows up on merge.** If aggregate findings exceed ~100, do the merge in stages — dedupe per CWE bucket rather than globally.
- **Two subagents patch the same file.** The merge step must resolve; do not apply two independent diffs to the same lines without reconciling.

## When *not* to use parallel execution

- When the user is tight on inference budget and asked for the audit. Parallelism trades tokens for wall clock; state that tradeoff.
- When the codebase is small. Overhead dominates.
- When the user asked a narrow question (e.g., "just check for ReDoS"). Run the single relevant reference sequentially.

## A note on non-determinism

Parallel subagents will produce slightly different outputs across runs, especially on borderline findings. For audits that must be reproducible (e.g., for regulatory purposes), run sequentially. Document the mode used in the report's `Methodology` section.
