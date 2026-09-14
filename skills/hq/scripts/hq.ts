#!/usr/bin/env bun
/**
 * HQ digest: one run replaces the per-session discovery of trackers, docs,
 * wayfinder maps, and worktree state across every origin.
 *
 *   bun hq.ts                 markdown digest on stdout, JSON cached in <root>/data/hq-state.json
 *   bun hq.ts --json          JSON on stdout instead of markdown
 *   bun hq.ts --cached        render the last cache, no network
 *   bun hq.ts --origin agenda one origin only
 *   bun hq.ts --closed        include closed maps (read a finished map's decisions)
 *   bun hq.ts --root <path>   HQ root; default: HQ_ROOT env, else the nearest ancestor of cwd holding origins/
 *
 * The HQ root is a superrepo laid out as origins/<repo>/ and worktrees/<task>/<repo>/, with an
 * optional AGENTS.md routing line per origin (see the hq skill).
 *
 * Zero dependencies: git + gh CLIs via Bun.$, Linear via GraphQL fetch.
 * LINEAR_API_KEY is read from the env, else from ~/.zshrc.
 */
import { $ } from "bun";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** Nearest ancestor of `from` (inclusive) that holds an origins/ directory. */
function findRoot(from: string): string | undefined {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "origins"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const rootArg = process.argv.includes("--root") ? process.argv[process.argv.indexOf("--root") + 1] : undefined;
const HQ = rootArg ? resolve(rootArg) : process.env.HQ_ROOT ? resolve(process.env.HQ_ROOT) : findRoot(process.cwd());
if (!HQ || !existsSync(join(HQ, "origins"))) {
  console.error("no HQ root: pass --root <path>, set HQ_ROOT, or run inside a superrepo with an origins/ directory");
  process.exit(1);
}
const INCLUDE_CLOSED = process.argv.includes("--closed");
const CACHE = join(HQ, "data", "hq-state.json");

type Tracker =
  | { kind: "github"; repo: string }
  | { kind: "linear"; team: string; project: string }
  | { kind: "unknown"; note: string };

interface Ticket {
  /** `#12` on GitHub, `SKA-100` on Linear */
  id: string;
  title: string;
  url: string;
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
  blockedBy: number;
}

interface MapInfo {
  id: string;
  title: string;
  url: string;
  state: "open" | "closed";
  destination: string;
  decisions: number;
  fog: number;
  children: Ticket[];
}

interface Worktree {
  task: string;
  path: string;
  branch: string;
  dirty: number;
  ticket?: string;
  pr?: { number: number; state: string; url: string };
}

interface Docs {
  context: boolean;
  adr: number;
  spec: number;
  research: number;
}

interface Origin {
  name: string;
  path: string;
  remote?: string;
  branch: string;
  dirty: number;
  aheadBehind?: string;
  tracker: Tracker;
  docs: Docs;
  maps: MapInfo[];
  closedMaps: number;
  orphans: Ticket[];
  /** open tickets outside every open map and without a wayfinder label; grouped by triage role when rendered */
  backlog: Ticket[];
  /** all open issues, for matching worktrees to tickets by title */
  openIssues: Ticket[];
  worktrees: Worktree[];
  error?: string;
}

interface State {
  generatedAt: string;
  origins: Origin[];
}

// ---------- shell helpers ----------

async function run(cmd: string[], cwd = HQ): Promise<string> {
  const r = await $`${cmd}`.cwd(cwd).quiet().nothrow();
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${r.stderr.toString().trim()}`);
  return r.text().trim();
}

const runOr = async (cmd: string[], cwd: string, fallback = "") =>
  run(cmd, cwd).catch(() => fallback);

async function ghJson<T>(args: string[]): Promise<T> {
  return JSON.parse(await run(["gh", ...args])) as T;
}

// ---------- discovery ----------

const dirs = (p: string) =>
  existsSync(p) ? readdirSync(p).filter((d) => statSync(join(p, d)).isDirectory()) : [];

const countFiles = (p: string) =>
  existsSync(p) ? readdirSync(p).filter((f) => f.endsWith(".md")).length : 0;

function readDocs(path: string): Docs {
  return {
    context: existsSync(join(path, "CONTEXT.md")),
    adr: countFiles(join(path, "docs", "adr")),
    spec: countFiles(join(path, "docs", "spec")),
    research: countFiles(join(path, "docs", "research")),
  };
}

function repoFromRemote(remote: string): string | undefined {
  const m = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
  return m?.[1];
}

/** Tracker doc is the source of truth; HQ AGENTS.md routing line is the fallback. */
function readTracker(name: string, path: string, remote?: string): Tracker {
  const doc = join(path, "docs", "agents", "issue-tracker.md");
  if (existsSync(doc)) {
    const text = readFileSync(doc, "utf8");
    const head = text.split("\n")[0] ?? "";
    if (/linear/i.test(head)) {
      const team = text.match(/\*\*Team\*\*:\s*(.+)/)?.[1]?.trim() ?? "?";
      const project = text.match(/\*\*Project\*\*:\s*(.+)/)?.[1]?.trim() ?? "?";
      return { kind: "linear", team, project };
    }
    if (/github/i.test(head)) {
      const repo = text.match(/on `([^`]+\/[^`]+)`/)?.[1] ?? (remote && repoFromRemote(remote));
      if (repo) return { kind: "github", repo };
    }
  }
  const agentsPath = join(HQ, "AGENTS.md");
  const agents = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : "";
  const line = agents.split("\n").find((l) => l.includes(`origins/${name}\``));
  const linear = line?.match(/Issues in Linear \(team (\w+), project "([^"]+)"\)/);
  if (linear) return { kind: "linear", team: linear[1]!, project: linear[2]! };
  const gh = line?.match(/GitHub issues on `([^`]+)`/);
  if (gh) return { kind: "github", repo: gh[1]! };
  return { kind: "unknown", note: "no docs/agents/issue-tracker.md and no routing line in AGENTS.md" };
}

function guessTicket(...hints: string[]): string | undefined {
  for (const h of hints) {
    const linear = h.match(/\b([a-z]{2,5}-\d+)\b/i);
    if (linear) return linear[1]!.toUpperCase();
    const gh = h.match(/(?:^|[\/-])(?:issue-)?(\d{1,5})(?:[-_]|$)/);
    if (gh) return `#${gh[1]}`;
  }
  return undefined;
}

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** `feat/sidebar-shell` matches an open issue titled "Sidebar shell: ..." */
function matchByTitle(issues: Ticket[], ...hints: string[]): string | undefined {
  for (const h of hints) {
    const s = slug(h.split("/").pop() ?? h);
    if (s.length < 5) continue;
    const hit = issues.find((i) => slug(i.title).startsWith(s));
    if (hit) return hit.id;
  }
  return undefined;
}

// ---------- github tracker ----------

interface GhIssue {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  body?: string;
  labels: { name: string }[];
  assignees: { login: string }[];
  issue_dependencies_summary?: { blocked_by: number };
  pull_request?: unknown;
}

const toTicket = (i: GhIssue): Ticket => ({
  id: `#${i.number}`,
  title: i.title,
  url: i.html_url,
  state: i.state,
  labels: i.labels.map((l) => l.name),
  assignees: i.assignees.map((a) => a.login),
  blockedBy: i.issue_dependencies_summary?.blocked_by ?? 0,
});

/** Five-role triage vocabulary from docs/agents/triage-labels.md, in display order. */
const TRIAGE = ["ready-for-agent", "needs-triage", "needs-info", "ready-for-human", "wontfix"] as const;
type TriageRole = (typeof TRIAGE)[number] | "untriaged";

const isWayfinder = (t: Ticket) => t.labels.some((l) => l.startsWith("wayfinder:"));
const triageRole = (t: Ticket): TriageRole => TRIAGE.find((r) => t.labels.includes(r)) ?? "untriaged";

/** Open tickets that no open map owns and no wayfinder label routes: the plain backlog. */
function backlogOf(tickets: Ticket[], maps: MapInfo[]): Ticket[] {
  const known = new Set(maps.filter((m) => m.state === "open").flatMap((m) => m.children.map((c) => c.id)));
  return tickets.filter((t) => t.state === "open" && !isWayfinder(t) && !known.has(t.id));
}

function section(body: string, heading: string): string {
  const re = new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "mi");
  return (body.match(re)?.[1] ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
}

const countLines = (s: string) => s.split("\n").filter((l) => l.trim()).length;

async function githubMaps(
  repo: string,
  includeClosed: boolean,
): Promise<Pick<Origin, "maps" | "closedMaps" | "orphans" | "backlog" | "openIssues">> {
  const open = await ghJson<GhIssue[]>(["api", `repos/${repo}/issues?state=open&per_page=100`]);
  const issues = open.filter((i) => !i.pull_request);
  const closedMapIssues = includeClosed
    ? await ghJson<GhIssue[]>(["api", `repos/${repo}/issues?state=closed&labels=wayfinder:map&per_page=100`])
    : [];
  const mapIssues = [...issues.filter((i) => i.labels.some((l) => l.name === "wayfinder:map")), ...closedMapIssues];

  const maps: MapInfo[] = await Promise.all(
    mapIssues.map(async (m) => {
      const kids = await ghJson<GhIssue[]>(["api", `repos/${repo}/issues/${m.number}/sub_issues`, "--paginate"]);
      const body = m.body ?? "";
      return {
        id: `#${m.number}`,
        title: m.title,
        url: m.html_url,
        state: m.state,
        destination: section(body, "Destination").split("\n")[0] ?? "",
        decisions: countLines(section(body, "Decisions so far")),
        fog: countLines(section(body, "Not yet specified")),
        children: kids.map(toTicket),
      };
    }),
  );

  const known = new Set(maps.flatMap((m) => m.children.map((c) => c.id)));
  const orphans = issues
    .filter((i) => i.labels.some((l) => l.name.startsWith("wayfinder:") && l.name !== "wayfinder:map"))
    .map(toTicket)
    .filter((t) => !known.has(t.id));

  const closedMaps = includeClosed
    ? closedMapIssues.length
    : (await ghJson<{ number: number }[]>([
        "issue", "list", "-R", repo, "--state", "closed", "--label", "wayfinder:map", "--json", "number", "--limit", "100",
      ])).length;

  const openIssues = issues.map(toTicket);
  return { maps, closedMaps, orphans, backlog: backlogOf(openIssues, maps), openIssues };
}

async function prFor(repo: string, branch: string): Promise<Worktree["pr"]> {
  const prs = await ghJson<{ number: number; state: string; url: string }[]>([
    "pr", "list", "-R", repo, "--head", branch, "--state", "all", "--json", "number,state,url", "--limit", "1",
  ]).catch(() => []);
  return prs[0];
}

// ---------- linear tracker ----------

async function linearKey(): Promise<string | undefined> {
  if (process.env.LINEAR_API_KEY) return process.env.LINEAR_API_KEY;
  const fromRc = await runOr(["zsh", "-c", 'source ~/.zshrc >/dev/null 2>&1; printf %s "$LINEAR_API_KEY"'], HQ);
  return fromRc || undefined;
}

async function linearQuery<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const key = await linearKey();
  if (!key) throw new Error("LINEAR_API_KEY not set (env or ~/.zshrc)");
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`linear: ${json.errors.map((e) => e.message).join("; ")}`);
  if (!json.data) throw new Error(`linear: HTTP ${res.status}`);
  return json.data;
}

interface LinearIssue {
  identifier: string;
  title: string;
  url: string;
  description?: string | null;
  subIssueSortOrder?: number | null;
  state: { type: string };
  assignee?: { displayName: string } | null;
  labels: { nodes: { name: string }[] };
  parent?: { identifier: string; state: { type: string } } | null;
  inverseRelations?: { nodes: { type: string; issue: { state: { type: string } } }[] };
  children?: { nodes: LinearIssue[] };
}

const linearDone = (t: string) => t === "completed" || t === "canceled";

const LINEAR_TICKET_FIELDS = `
  identifier title url subIssueSortOrder
  state { type }
  assignee { displayName }
  labels { nodes { name } }
  inverseRelations { nodes { type issue { state { type } } } }
`;

const LINEAR_QUERY = `
query($team: String!, $project: String!) {
  maps: issues(first: 50, filter: {
    team: { or: [{ key: { eq: $team } }, { name: { eq: $team } }] },
    project: { name: { eq: $project } },
    labels: { name: { eq: "wayfinder:map" } }
  }) {
    nodes {
      identifier title url description
      state { type }
      children(first: 100) { nodes { ${LINEAR_TICKET_FIELDS} } }
    }
  }
  tickets: issues(first: 100, filter: {
    team: { or: [{ key: { eq: $team } }, { name: { eq: $team } }] },
    project: { name: { eq: $project } },
    state: { type: { nin: ["completed", "canceled"] } }
  }) {
    nodes { ${LINEAR_TICKET_FIELDS} parent { identifier state { type } } }
  }
}`;

const toLinearTicket = (i: LinearIssue): Ticket => ({
  id: i.identifier,
  title: i.title,
  url: i.url,
  state: linearDone(i.state.type) ? "closed" : "open",
  labels: i.labels.nodes.map((l) => l.name),
  assignees: i.assignee ? [i.assignee.displayName] : [],
  blockedBy: (i.inverseRelations?.nodes ?? []).filter((r) => r.type === "blocks" && !linearDone(r.issue.state.type)).length,
});

async function linearMaps(
  team: string,
  project: string,
  includeClosed: boolean,
): Promise<Pick<Origin, "maps" | "closedMaps" | "orphans" | "backlog" | "openIssues">> {
  const data = await linearQuery<{ maps: { nodes: LinearIssue[] }; tickets: { nodes: LinearIssue[] } }>(LINEAR_QUERY, {
    team,
    project,
  });
  const all = data.maps.nodes;
  const closed = all.filter((m) => linearDone(m.state.type));
  const shown = includeClosed ? all : all.filter((m) => !linearDone(m.state.type));

  const maps: MapInfo[] = shown.map((m) => {
    const body = m.description ?? "";
    const kids = [...(m.children?.nodes ?? [])].sort((a, b) => (a.subIssueSortOrder ?? 0) - (b.subIssueSortOrder ?? 0));
    return {
      id: m.identifier,
      title: m.title,
      url: m.url,
      state: linearDone(m.state.type) ? "closed" : "open",
      destination: section(body, "Destination").split("\n")[0] ?? "",
      decisions: countLines(section(body, "Decisions so far")),
      fog: countLines(section(body, "Not yet specified")),
      children: kids.map(toLinearTicket),
    };
  });

  const openMapIds = new Set(all.filter((m) => !linearDone(m.state.type)).map((m) => m.identifier));
  const tickets = data.tickets.nodes.filter((t) => !t.labels.nodes.some((l) => l.name === "wayfinder:map"));
  const orphans = tickets
    .filter((t) => t.labels.nodes.some((l) => l.name.startsWith("wayfinder:")))
    .filter((t) => !t.parent || !openMapIds.has(t.parent.identifier))
    .map(toLinearTicket);

  const openIssues = tickets.map(toLinearTicket);
  return { maps, closedMaps: closed.length, orphans, backlog: backlogOf(openIssues, maps), openIssues };
}

// ---------- per-origin ----------

async function gitState(path: string) {
  const branch = await runOr(["git", "rev-parse", "--abbrev-ref", "HEAD"], path, "?");
  const dirty = (await runOr(["git", "status", "--porcelain"], path)).split("\n").filter(Boolean).length;
  const lr = await runOr(["git", "rev-list", "--left-right", "--count", "HEAD...@{u}"], path);
  const [ahead, behind] = lr.split(/\s+/);
  const aheadBehind = lr && (ahead !== "0" || behind !== "0") ? `ahead ${ahead} behind ${behind}` : undefined;
  return { branch, dirty, aheadBehind };
}

async function readOrigin(name: string, path: string): Promise<Origin> {
  const remote = (await runOr(["git", "remote", "get-url", "origin"], path)) || undefined;
  const tracker = readTracker(name, path, remote);
  const origin: Origin = {
    name,
    path,
    remote,
    ...(await gitState(path)),
    tracker,
    docs: readDocs(path),
    maps: [],
    closedMaps: 0,
    orphans: [],
    backlog: [],
    openIssues: [],
    worktrees: [],
  };

  const repo = remote && repoFromRemote(remote);

  try {
    if (tracker.kind === "github") Object.assign(origin, await githubMaps(tracker.repo, INCLUDE_CLOSED));
    if (tracker.kind === "linear") Object.assign(origin, await linearMaps(tracker.team, tracker.project, INCLUDE_CLOSED));
  } catch (e) {
    origin.error = (e as Error).message;
  }

  const wtDirs = dirs(join(HQ, "worktrees"))
    .map((task) => ({ task, path: join(HQ, "worktrees", task, name) }))
    .filter((w) => existsSync(w.path));

  origin.worktrees = await Promise.all(
    wtDirs.map(async (w) => {
      const g = await gitState(w.path);
      return {
        task: w.task,
        path: w.path,
        branch: g.branch,
        dirty: g.dirty,
        ticket: guessTicket(g.branch, w.task) ?? matchByTitle(origin.openIssues, g.branch, w.task),
        pr: repo ? await prFor(repo, g.branch) : undefined,
      };
    }),
  );
  return origin;
}

// ---------- render ----------

const short = (t: Ticket) => `${t.id} ${t.title} [${t.labels.filter((l) => l.startsWith("wayfinder:")).map((l) => l.slice(10)).join(",") || "-"}]`;

/**
 * Plain tickets (no map, no wayfinder label) grouped by triage role.
 * `ready-for-agent` lists every takeable ticket (unassigned, unblocked) since each is a
 * candidate task; other roles are counted so a stale queue still shows.
 */
function renderBacklog(backlog: Ticket[]): string[] {
  if (backlog.length === 0) return [];
  const byRole = new Map<TriageRole, Ticket[]>();
  for (const t of backlog) byRole.set(triageRole(t), [...(byRole.get(triageRole(t)) ?? []), t]);
  const out = [`backlog: ${backlog.length} open outside maps`];
  const ready = byRole.get("ready-for-agent") ?? [];
  const takeable = ready.filter((t) => t.blockedBy === 0 && t.assignees.length === 0);
  for (const t of takeable) out.push(`  ready-for-agent → ${t.id} ${t.title}`);
  for (const t of ready.filter((t) => !takeable.includes(t)))
    out.push(`  ready-for-agent · ${t.id} ${t.title}${t.assignees.length ? ` @${t.assignees.join(",")}` : ""}${t.blockedBy ? ` (blocked by ${t.blockedBy})` : ""}`);
  const counts = ([...TRIAGE.filter((r) => r !== "ready-for-agent"), "untriaged"] as TriageRole[])
    .map((r) => [r, byRole.get(r)?.length ?? 0] as const)
    .filter(([, n]) => n > 0)
    .map(([r, n]) => `${r} ${n}`);
  if (counts.length) out.push(`  ${counts.join(" · ")}`);
  return out;
}

function renderOrigin(o: Origin): string {
  const out: string[] = [];
  const tracker =
    o.tracker.kind === "github" ? `github ${o.tracker.repo}`
    : o.tracker.kind === "linear" ? `linear ${o.tracker.team} / "${o.tracker.project}"`
    : `tracker unknown (${o.tracker.note})`;
  const git = [o.branch, o.dirty ? `dirty ${o.dirty}` : "clean", o.aheadBehind].filter(Boolean).join(" · ");
  out.push(`## ${o.name} · ${tracker} · ${git}`);
  out.push(
    `docs: ${o.docs.context ? "CONTEXT.md" : "no CONTEXT.md"} · adr ${o.docs.adr} · spec ${o.docs.spec} · research ${o.docs.research}`,
  );
  if (o.error) out.push(`error: ${o.error}`);

  if (o.tracker.kind !== "unknown" && !o.error) {
    if (o.maps.length === 0) out.push(`maps: none open (${o.closedMaps} closed)`);
    for (const m of o.maps) {
      const open = m.children.filter((c) => c.state === "open");
      const frontier = open.filter((c) => c.blockedBy === 0 && c.assignees.length === 0);
      const claimed = open.filter((c) => c.assignees.length > 0);
      const blocked = open.filter((c) => c.blockedBy > 0 && c.assignees.length === 0);
      out.push(`- map ${m.id} ${m.title}${m.state === "closed" ? " (closed)" : ""} (${m.url})`);
      if (m.destination) out.push(`  destination: ${m.destination}`);
      out.push(`  decisions ${m.decisions} · fog ${m.fog} · open children ${open.length} of ${m.children.length}`);
      if (frontier[0]) out.push(`  frontier → ${short(frontier[0])}${frontier.length > 1 ? ` (+${frontier.length - 1} more takeable)` : ""}`);
      else if (open.length) out.push(`  frontier → none takeable`);
      for (const c of claimed) out.push(`  claimed: ${short(c)} @${c.assignees.join(",")}`);
      for (const c of blocked) out.push(`  blocked: ${short(c)} (by ${c.blockedBy})`);
    }
    for (const t of o.orphans) out.push(`orphan: ${short(t)} — open wayfinder ticket outside any open map${t.assignees.length ? ` @${t.assignees.join(",")}` : ""}`);
    out.push(...renderBacklog(o.backlog));
  }

  if (o.worktrees.length) {
    out.push("worktrees:");
    for (const w of o.worktrees) {
      const pr = w.pr ? `PR #${w.pr.number} ${w.pr.state}` : "no PR";
      out.push(`- ${w.task} → ${w.branch} · ${w.dirty ? `dirty ${w.dirty}` : "clean"} · ticket ${w.ticket ?? "?"} · ${pr}`);
    }
  }
  return out.join("\n");
}

function render(state: State): string {
  return [`# HQ digest · ${state.generatedAt}`, ...state.origins.map(renderOrigin)].join("\n\n");
}

// ---------- main ----------

const args = new Set(process.argv.slice(2));
const only = process.argv[process.argv.indexOf("--origin") + 1];

let state: State;
if (args.has("--cached")) {
  if (!existsSync(CACHE)) {
    console.error("no cache yet; run without --cached");
    process.exit(1);
  }
  state = JSON.parse(readFileSync(CACHE, "utf8")) as State;
} else {
  const names = dirs(join(HQ, "origins"));
  const rootRemote = await runOr(["git", "remote", "get-url", "origin"], HQ);
  const rootName = (rootRemote && repoFromRemote(rootRemote)?.split("/")[1]) || basename(HQ);
  const targets = [
    { name: rootName, path: HQ },
    ...names.map((n) => ({ name: n, path: join(HQ, "origins", n) })),
  ].filter((t) => !args.has("--origin") || t.name === only);
  state = {
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    origins: await Promise.all(targets.map((t) => readOrigin(t.name, t.path))),
  };
  if (!args.has("--origin") && !INCLUDE_CLOSED) {
    mkdirSync(join(HQ, "data"), { recursive: true });
    await Bun.write(CACHE, JSON.stringify(state, null, 2));
  }
}

console.log(args.has("--json") ? JSON.stringify(state, null, 2) : render(state));
