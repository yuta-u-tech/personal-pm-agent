import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loadConfig, type PmAgentConfig } from "../core/config.js";
import { today } from "../core/date.js";
import { ensureDir, readTextIfExists, writeJson } from "../core/fs.js";
import { expandHome } from "../core/git.js";
import { parseGitHubRepoFullName } from "../core/github.js";
import { parseRepositoryLinks } from "../core/markdown.js";

const execFileAsync = promisify(execFile);

export type PlanningCommandOptions = {
  date?: string;
  fewer?: boolean;
  safer?: boolean;
  prefer?: string;
  exclude?: string;
  include?: string;
};

type IssueRef = {
  repoId: string;
  number: number;
  key: string;
};

type RepoContext = {
  id: string;
  dir: string;
  fullName?: string;
  link?: Record<string, string>;
};

type GitHubIssue = {
  number: number;
  title: string;
  body?: string;
  url?: string;
  state?: string;
  labels?: Array<{ name?: string }>;
  assignees?: Array<{ login?: string }>;
  milestone?: { title?: string } | null;
  comments?: Array<{ body?: string; author?: { login?: string } }>;
};

type Knowledge = {
  projectBrief: Record<string, unknown>;
  areaMap: { areas?: KnowledgeArea[] };
  capabilityMap: { capabilities?: KnowledgeCapability[] };
  issueMap: { planningSignals?: KnowledgeSignal[] };
  dependencyGraph: { edges?: Array<{ from?: string; to?: string }> };
  reverseDependencyIndex: Record<string, string[]>;
};

type KnowledgeArea = {
  name: string;
  purpose?: string;
  importantFiles?: string[];
  relatedCapabilities?: string[];
  risks?: string[];
};

type KnowledgeCapability = {
  name: string;
  description?: string;
  areas?: string[];
  files?: string[];
  risks?: string[];
};

type KnowledgeSignal = {
  signal: string;
  files?: string[];
  areas?: string[];
  candidateFiles?: string[];
};

type SubissueProposal = {
  title: string;
  type: "design" | "implementation" | "test" | "docs" | "migration" | "coordination";
  area: string;
  capability: string;
  effort: "small" | "medium" | "large";
  risk: "low" | "medium" | "high";
  suggestedAssignees: string[];
  labels: string[];
  milestone?: string;
  dependsOn: string[];
  likelyFiles: string[];
  doneWhen: string[];
};

type PlanIssue = {
  ref: string;
  title: string;
  status: "ready_to_work" | "in_progress" | "needs_clarification" | "blocked" | "too_large";
  risk: "low" | "medium" | "high";
  reason: string;
  firstAction: string;
  labels: string[];
};

type MorningPlan = {
  date: string;
  version: number;
  policy: string[];
  doToday: PlanIssue[];
  clarifyToday: PlanIssue[];
  breakdownCandidates: PlanIssue[];
  notToday: PlanIssue[];
  adjustments?: string[];
};

export async function breakdownCommand(targetDir: string, issueRefText: string | undefined, options: PlanningCommandOptions = {}): Promise<string> {
  const issueRef = parseIssueRef(requireValue(issueRefText, "Missing issue ref. Example: pm-agent breakdown project-a#120"));
  const date = options.date ?? today();
  const config = await loadConfig(targetDir);
  const repo = await resolveRepoContext(targetDir, issueRef.repoId);
  await ensureUnderstanding(repo.dir);
  const knowledge = await readKnowledge(repo.dir);
  const issue = await fetchIssue(repo, issueRef);
  const existingIssues = await fetchExistingIssues(repo);
  const proposal = buildBreakdown(issueRef, issue, knowledge, config, existingIssues);
  const base = path.join(targetDir, "outputs", date, "breakdowns", `${issueRef.repoId}-${issueRef.number}`);
  await ensureDir(path.dirname(`${base}.md`));
  await writeFile(`${base}.md`, renderBreakdownProposal(proposal), "utf8");
  await writeJson(`${base}.json`, proposal);
  return `Generated breakdown proposal:\n- Markdown: ${base}.md\n- JSON: ${base}.json`;
}

export async function breakdownApplyCommand(targetDir: string, issueRefText: string | undefined, options: PlanningCommandOptions = {}): Promise<string> {
  const issueRef = parseIssueRef(requireValue(issueRefText, "Missing issue ref. Example: pm-agent breakdown apply project-a#120"));
  const date = options.date ?? today();
  const proposalPath = path.join(targetDir, "outputs", date, "breakdowns", `${issueRef.repoId}-${issueRef.number}.json`);
  if (!existsSync(proposalPath)) {
    throw new Error(`Breakdown proposal not found: ${proposalPath}. Run pm-agent breakdown ${issueRef.key} first.`);
  }
  const proposal = JSON.parse(await readFile(proposalPath, "utf8")) as { subissues?: SubissueProposal[]; parent?: { title?: string; number?: number } };
  const repo = await resolveRepoContext(targetDir, issueRef.repoId);
  const auth = await checkGitHubAuth(repo);
  if (!auth.ok) {
    throw new Error("GitHub authentication is required to create subissues. Run gh auth login or configure GITHUB_TOKEN.");
  }
  if (!repo.fullName) {
    throw new Error(`Could not resolve GitHub repository for ${issueRef.repoId}. Add github: owner/name to links/repositories.md or set an origin remote.`);
  }
  if (auth.permission === "read") {
    throw new Error(`GitHub write permission is required for ${repo.fullName}. Current permission: read.`);
  }

  const created = [];
  for (const item of proposal.subissues ?? []) {
    const url = await createGitHubIssue(repo.fullName, item.title, renderSubissueBody(issueRef, item));
    created.push({ title: item.title, url });
  }

  if (created.length > 0 && issueRef.number > 0) {
    await ghText([
      "issue",
      "comment",
      String(issueRef.number),
      "--repo",
      repo.fullName,
      "--body",
      ["Created subissues from breakdown proposal:", ...created.map((item) => `- ${item.title}: ${item.url}`)].join("\n")
    ]);
  }

  const createdPath = path.join(targetDir, "outputs", date, "breakdowns", `${issueRef.repoId}-${issueRef.number}.created.json`);
  await writeJson(createdPath, {
    generatedAt: new Date().toISOString(),
    parent: issueRef.key,
    repository: repo.fullName,
    created
  });

  return [
    `Created ${created.length} subissues under ${issueRef.key}`,
    ...created.map((item, index) => `${index + 1}. ${item.url}`),
    `Saved result: ${createdPath}`
  ].join("\n");
}

export async function morningPlanCommand(targetDir: string, options: PlanningCommandOptions = {}): Promise<string> {
  const date = options.date ?? today();
  const plan = await buildMorningPlan(targetDir, date, []);
  return savePlan(targetDir, plan, "plan");
}

export async function adjustCommand(targetDir: string, options: PlanningCommandOptions = {}): Promise<string> {
  const date = options.date ?? today();
  const inputPath = await latestPlanPath(targetDir, date);
  if (!inputPath) throw new Error(`No plan found for ${date}. Run pm-agent morning first.`);
  const previous = JSON.parse(await readFile(inputPath, "utf8")) as MorningPlan;
  const adjustments = describeAdjustments(options);
  const next = applyAdjustments(previous, adjustments, options);
  const version = previous.version + 1;
  next.version = version;
  next.adjustments = [...(previous.adjustments ?? []), ...adjustments];
  return savePlan(targetDir, next, `plan.v${version}`);
}

export async function prepareCommand(targetDir: string, issueRefText: string | undefined, options: PlanningCommandOptions = {}): Promise<string> {
  const date = options.date ?? today();
  const issueRefs = issueRefText ? [parseIssueRef(issueRefText)] : await readSelectedPlanRefs(targetDir, date);
  if (issueRefs.length === 0) throw new Error("No selected issues found. Pass an issue ref or run pm-agent morning first.");

  const outputs: string[] = [];
  for (const issueRef of issueRefs) {
    const repo = await resolveRepoContext(targetDir, issueRef.repoId);
    await ensureUnderstanding(repo.dir);
    const knowledge = await readKnowledge(repo.dir);
    const issue = await fetchIssue(repo, issueRef);
    const planReason = await readPlanReason(targetDir, date, issueRef.key);
    const task = buildTaskBrief(issueRef, issue, knowledge, planReason);
    const base = path.join(targetDir, "outputs", date, "tasks", `${issueRef.repoId}-issue-${issueRef.number}`);
    await ensureDir(path.dirname(`${base}.md`));
    await writeFile(`${base}.md`, renderTaskBrief(task), "utf8");
    await writeJson(`${base}.json`, task);
    outputs.push(`- ${base}.md`);
  }
  return `Generated Task Brief${outputs.length === 1 ? "" : "s"}:\n${outputs.join("\n")}`;
}

export async function dispatchCommand(targetDir: string, issueRefText: string | undefined, options: PlanningCommandOptions = {}): Promise<string> {
  const date = options.date ?? today();
  const issueRef = parseIssueRef(requireValue(issueRefText, "Missing issue ref. Example: pm-agent dispatch project-a#12"));
  const taskPath = path.join(targetDir, "outputs", date, "tasks", `${issueRef.repoId}-issue-${issueRef.number}.md`);
  if (!existsSync(taskPath)) {
    throw new Error(`Task Brief not found: ${taskPath}. Run pm-agent prepare ${issueRef.key} first.`);
  }
  const repo = await resolveRepoContext(targetDir, issueRef.repoId);
  const relativeTaskPath = path.relative(repo.dir, taskPath);
  return [
    "Dispatch is manual in MVP.",
    "",
    "Review the Task Brief:",
    `cat ${taskPath}`,
    "",
    "Run an implementation agent from the target repository:",
    `cd ${repo.dir}`,
    `codex < ${relativeTaskPath.startsWith("..") ? taskPath : relativeTaskPath}`
  ].join("\n");
}

async function buildMorningPlan(targetDir: string, date: string, adjustments: string[]): Promise<MorningPlan> {
  const candidates = await readIssueCandidates(targetDir);
  const active = await readChecklist(path.join(targetDir, "tasks", "active.md"));
  const waiting = await readChecklist(path.join(targetDir, "tasks", "waiting.md"));
  const reflections = await readReflectionCandidates(targetDir, date);
  const all = [...reflections, ...candidates, ...active, ...waiting];
  const unique = uniquePlanIssues(all.map((item) => classifyPlanIssue(item.ref, item.title, item.labels ?? [], item.source)));
  const doToday = unique
    .filter((issue) => issue.status === "in_progress" || issue.status === "ready_to_work")
    .sort(comparePlanIssue)
    .slice(0, 3);
  return {
    date,
    version: 1,
    adjustments,
    policy: [
      "既に着手中のIssueを優先する",
      "前日のreflectionで示されたnext actionを優先する",
      "ready_to_work のIssueを優先する",
      "blocked / needs_clarification は実装対象にしない",
      "too_large はbreakdown候補にする",
      "1日の作業Issueは最大3件",
      "high risk issueは単独で扱う",
      "Git差分があるIssueは完了優先"
    ],
    doToday,
    clarifyToday: unique.filter((issue) => issue.status === "needs_clarification").slice(0, 5),
    breakdownCandidates: unique.filter((issue) => issue.status === "too_large").slice(0, 5),
    notToday: unique.filter((issue) => !doToday.includes(issue)).slice(0, 10)
  };
}

async function readReflectionCandidates(targetDir: string, date: string): Promise<Array<{ ref: string; title: string; labels?: string[]; source: string }>> {
  const dir = path.join(targetDir, "outputs", date, "reflections");
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const candidates: Array<{ ref: string; title: string; labels?: string[]; source: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const repo = path.basename(entry.name, ".md");
    const markdown = await readFile(path.join(dir, entry.name), "utf8");
    const next = extractSectionBullets(markdown, "Recommended Direction");
    const decisions = extractSectionBullets(markdown, "Open Decisions");
    const sourceItems = next.length > 0 ? next : decisions;
    for (const item of sourceItems.slice(0, 3)) {
      candidates.push({
        ref: `${repo}#0`,
        title: `Reflection: ${item}`,
        labels: decisions.length > 0 ? ["needs_clarification"] : ["reflection"],
        source: "reflection"
      });
    }
  }
  return candidates;
}

async function readIssueCandidates(targetDir: string): Promise<Array<{ ref: string; title: string; labels?: string[]; source: string }>> {
  const file = path.join(targetDir, "tasks", "candidates.json");
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(await readFile(file, "utf8")) as {
    candidates?: Array<{ repo?: string; title?: string; id?: string; source?: string; detail?: string }>;
  };
  return (parsed.candidates ?? []).map((candidate) => {
    const issue = candidate.title?.match(/Issue #(\d+):\s*(.+)$/);
    const repo = candidate.repo ?? candidate.id?.split(":")[0] ?? "repo";
    return {
      ref: issue ? `${repo}#${issue[1]}` : `${repo}#0`,
      title: issue?.[2] ?? candidate.title ?? "Untitled task",
      labels: extractLabelNames(candidate.detail ?? ""),
      source: candidate.source ?? "candidate"
    };
  });
}

async function readChecklist(file: string): Promise<Array<{ ref: string; title: string; labels?: string[]; source: string }>> {
  const text = await readTextIfExists(file);
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.match(/^- \[[ xX]\]\s+(.+?)(?:\s+<!--\s*repo:([^>]+)\s*-->)?$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => {
      const title = match[1].trim();
      const issue = title.match(/#(\d+)/);
      const repo = match[2]?.trim() ?? "repo";
      return { ref: `${repo}#${issue?.[1] ?? "0"}`, title, labels: [], source: "active_task" };
    });
}

function classifyPlanIssue(ref: string, title: string, labels: string[], source: string): PlanIssue {
  const haystack = `${title} ${labels.join(" ")}`.toLowerCase();
  const tooLarge = /(migration|移行|refresh|刷新|全面|version|v2|design system|請求|billing|認証方式|通知機能|api v2)/i.test(haystack);
  const blocked = /(blocked|blocker|依存|待ち|保留)/i.test(haystack);
  const unclear = /(clarify|needs clarification|仕様|確認|不明|決める)/i.test(haystack);
  const risk = /(auth|認証|billing|請求|migration|移行|security|権限)/i.test(haystack) ? "high" : tooLarge ? "medium" : "medium";
  const status = source === "reflection" && labels.includes("needs_clarification")
    ? "needs_clarification"
    : tooLarge ? "too_large" : blocked ? "blocked" : unclear ? "needs_clarification" : source === "active_task" ? "in_progress" : "ready_to_work";
  return {
    ref,
    title,
    status,
    risk,
    labels,
    reason: source === "reflection" ? "reflectionで翌日の方向性として示されているため" : status === "in_progress" ? "現在のactive taskにあるため" : status === "too_large" ? "複数領域にまたがる大きなIssueの可能性が高いため" : "ready_to_work と判断できる候補のため",
    firstAction: status === "too_large" ? `pm-agent breakdown ${ref}` : "Issue本文と関連ファイルを確認する"
  };
}

function applyAdjustments(plan: MorningPlan, adjustments: string[], options: PlanningCommandOptions): MorningPlan {
  let doToday = [...plan.doToday];
  let clarifyToday = [...plan.clarifyToday];
  let breakdownCandidates = [...plan.breakdownCandidates];
  let notToday = [...plan.notToday];
  if (options.exclude) {
    const excluded = new Set([options.exclude]);
    doToday = doToday.filter((issue) => !excluded.has(issue.ref));
    clarifyToday = clarifyToday.filter((issue) => !excluded.has(issue.ref));
    breakdownCandidates = breakdownCandidates.filter((issue) => !excluded.has(issue.ref));
    notToday = notToday.filter((issue) => !excluded.has(issue.ref));
  }
  if (options.prefer) {
    doToday = [...doToday].sort((a, b) => Number(!a.ref.startsWith(options.prefer ?? "")) - Number(!b.ref.startsWith(options.prefer ?? "")));
  }
  if (options.include) {
    const included = [...plan.doToday, ...plan.clarifyToday, ...plan.breakdownCandidates, ...plan.notToday].find((issue) => issue.ref === options.include);
    if (included && !doToday.some((issue) => issue.ref === included.ref)) doToday.unshift({ ...included, status: "ready_to_work" });
  }
  if (options.safer) {
    doToday = doToday.filter((issue) => issue.risk !== "high");
  }
  if (options.fewer) {
    doToday = doToday.slice(0, 1);
  }
  if (doToday.some((issue) => issue.risk === "high")) {
    doToday = doToday.filter((issue) => issue.risk === "high").slice(0, 1);
  } else {
    doToday = doToday.slice(0, 3);
  }
  return { ...plan, doToday, clarifyToday, breakdownCandidates, notToday, adjustments };
}

async function savePlan(targetDir: string, plan: MorningPlan, name: string): Promise<string> {
  const dir = path.join(targetDir, "outputs", plan.date);
  await ensureDir(dir);
  const markdownPath = path.join(dir, `${name}.md`);
  const jsonPath = path.join(dir, `${name}.json`);
  await writeFile(markdownPath, renderMorningPlan(plan), "utf8");
  await writeJson(jsonPath, plan);
  if (name === "plan") {
    await writeFile(path.join(dir, "share.md"), renderSharePlan(plan), "utf8");
  }
  return `Generated morning plan:\n- Markdown: ${markdownPath}\n- JSON: ${jsonPath}${name === "plan" ? `\n- Share: ${path.join(dir, "share.md")}` : ""}`;
}

function buildBreakdown(issueRef: IssueRef, issue: GitHubIssue, knowledge: Knowledge, config: PmAgentConfig, existingIssues: GitHubIssue[]) {
  const text = `${issue.title}\n${issue.body ?? ""}`;
  const matched = matchKnowledge(text, knowledge);
  const area = matched.area?.name ?? "general";
  const capability = matched.capability?.name ?? "general_delivery";
  const areaLabel = area.startsWith("area:") ? area : `area:${area}`;
  const owners = config.owners?.[areaLabel] ?? config.owners?.[area] ?? [];
  const milestone = issue.milestone?.title;
  const likelyFiles = [...new Set([...(matched.signal?.candidateFiles ?? []), ...(matched.capability?.files ?? []), ...(matched.area?.importantFiles ?? [])])].slice(0, 8);
  const subissues = defaultSubissues(issue.title, area, capability, areaLabel, owners, milestone, likelyFiles);
  return {
    generatedAt: new Date().toISOString(),
    parent: {
      ref: issueRef.key,
      number: issue.number,
      title: issue.title,
      url: issue.url,
      labels: (issue.labels ?? []).map((label) => label.name).filter(Boolean)
    },
    summary: summarizeIssue(issue),
    strategy: "設計、実装、検証、移行手順を分け、依存関係が明確な順にsubissue化します。",
    subissues,
    duplicates: existingIssues
      .filter((candidate) => candidate.number !== issue.number && similarTitle(candidate.title, issue.title))
      .slice(0, 5)
      .map((candidate) => ({ number: candidate.number, title: candidate.title, url: candidate.url }))
  };
}

function defaultSubissues(title: string, area: string, capability: string, areaLabel: string, owners: string[], milestone: string | undefined, likelyFiles: string[]): SubissueProposal[] {
  const baseLabels = [areaLabel].filter(Boolean);
  return [
    {
      title: `${title}: 要件と完了条件を確定する`,
      type: "design",
      area,
      capability,
      effort: "small",
      risk: "medium",
      suggestedAssignees: owners,
      labels: ["type:design", ...baseLabels],
      milestone,
      dependsOn: [],
      likelyFiles: [],
      doneWhen: ["親Issueの要求が実装単位に分解されている", "非スコープと完了条件が明記されている", "既存Issueとの重複が確認されている"]
    },
    {
      title: `${title}: 実装方針と影響範囲を整理する`,
      type: "design",
      area,
      capability,
      effort: "medium",
      risk: "medium",
      suggestedAssignees: owners,
      labels: ["type:design", ...baseLabels],
      milestone,
      dependsOn: [`${title}: 要件と完了条件を確定する`],
      likelyFiles,
      doneWhen: ["変更対象ファイルが列挙されている", "依存関係と逆依存への影響が明記されている", "テスト方針が決まっている"]
    },
    {
      title: `${title}: 最小実装を追加する`,
      type: "implementation",
      area,
      capability,
      effort: "medium",
      risk: "medium",
      suggestedAssignees: owners,
      labels: ["type:implementation", ...baseLabels],
      milestone,
      dependsOn: [`${title}: 実装方針と影響範囲を整理する`],
      likelyFiles,
      doneWhen: ["Issueの主要導線が実装されている", "既存挙動が壊れていない", "スコープ外の変更が混ざっていない"]
    },
    {
      title: `${title}: テストと回帰確認を追加する`,
      type: "test",
      area,
      capability,
      effort: "medium",
      risk: "medium",
      suggestedAssignees: owners,
      labels: ["type:test", ...baseLabels],
      milestone,
      dependsOn: [`${title}: 最小実装を追加する`],
      likelyFiles,
      doneWhen: ["関連テストが追加または更新されている", "主要な回帰観点が確認されている", "失敗時の原因が追える状態になっている"]
    },
    {
      title: `${title}: リリース・移行手順を整理する`,
      type: "migration",
      area,
      capability,
      effort: "small",
      risk: "low",
      suggestedAssignees: owners,
      labels: ["type:docs", ...baseLabels],
      milestone,
      dependsOn: [`${title}: テストと回帰確認を追加する`],
      likelyFiles,
      doneWhen: ["必要な移行手順が文書化されている", "運用上の注意点が明記されている", "親Issueへ完了状況を戻せる"]
    }
  ];
}

function buildTaskBrief(issueRef: IssueRef, issue: GitHubIssue, knowledge: Knowledge, planReason: string | null) {
  const matched = matchKnowledge(`${issue.title}\n${issue.body ?? ""}`, knowledge);
  const directFiles = [...new Set([...(matched.signal?.candidateFiles ?? []), ...(matched.capability?.files ?? []), ...(matched.area?.importantFiles ?? [])])].slice(0, 10);
  const reverseDependencies = Object.fromEntries(directFiles.map((file) => [file, knowledge.reverseDependencyIndex[file] ?? []]));
  return {
    generatedAt: new Date().toISOString(),
    issue: { ref: issueRef.key, title: issue.title, url: issue.url, body: issue.body },
    goal: `${issue.title} を完了する。`,
    projectContext: summarizeProject(knowledge.projectBrief),
    issueContext: issue.body?.trim() || "Issue本文は取得できませんでした。タイトルとプロジェクト理解をもとに作業します。",
    currentWorkContext: planReason ?? "morning planでの選定理由は見つかりませんでした。",
    relatedFiles: directFiles,
    reverseDependencies,
    scope: ["Issue本文の期待挙動を満たす", "関連ファイルを必要最小限に変更する", "関連テストを追加または更新する"],
    outOfScope: ["Issueに含まれない大幅なリデザイン", "無関係なリファクタリング", "認証・データモデルなど周辺領域の不要な変更"],
    firstStep: directFiles.length > 0 ? `${directFiles[0]} とIssue本文を確認する。` : "Issue本文とProject Briefを確認し、関連ファイルを特定する。",
    doneWhen: ["Issueの期待挙動を満たす", "関連テストが通る", "変更範囲がIssueのスコープ内に収まっている"],
    suggestedTests: inferTestFiles(directFiles),
    risks: [...(matched.area?.risks ?? []), ...(matched.capability?.risks ?? [])].slice(0, 8),
    expectedFinalSummary: ["変更内容", "確認したテスト", "残ったリスクまたは未確認事項"]
  };
}

async function ensureUnderstanding(repoDir: string): Promise<void> {
  if (existsSync(path.join(repoDir, ".pm-agent", "project", "project-brief.json"))) return;
  throw new Error(`understand output is missing for ${repoDir}. Run pm-agent understand ${repoDir} first.`);
}

async function readKnowledge(repoDir: string): Promise<Knowledge> {
  return {
    projectBrief: await readJsonObject(path.join(repoDir, ".pm-agent", "project", "project-brief.json")),
    areaMap: await readJsonObject(path.join(repoDir, ".pm-agent", "project", "area-map.json")),
    capabilityMap: await readJsonObject(path.join(repoDir, ".pm-agent", "project", "capability-map.json")),
    issueMap: await readJsonObject(path.join(repoDir, ".pm-agent", "project", "issue-map.json")),
    dependencyGraph: await readJsonObject(path.join(repoDir, ".pm-agent", "graph", "dependency-graph.json")),
    reverseDependencyIndex: await readJsonObject(path.join(repoDir, ".pm-agent", "graph", "reverse-dependency-index.json"))
  };
}

async function readJsonObject<T>(file: string): Promise<T> {
  if (!existsSync(file)) return {} as T;
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function resolveRepoContext(targetDir: string, repoId: string): Promise<RepoContext> {
  const repositoriesFile = path.join(targetDir, "links", "repositories.md");
  const markdown = await readTextIfExists(repositoriesFile);
  const links = markdown ? parseRepositoryLinks(markdown) : [];
  const link = links.find((repo) => repo.id === repoId || repo.github === repoId || repo.full_name === repoId);
  if (link) {
    const dir = link.path ? expandHome(link.path) : targetDir;
    const fullName = link.github ?? link.full_name ?? (link.id?.includes("/") ? link.id : await readOriginFullName(dir));
    return { id: link.id ?? repoId, dir, fullName: fullName ?? undefined, link };
  }
  const fullName = repoId.includes("/") ? repoId : await readOriginFullName(targetDir);
  return { id: repoId, dir: targetDir, fullName: fullName ?? undefined };
}

async function readOriginFullName(repoDir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd: repoDir, maxBuffer: 1024 * 1024 });
    return parseGitHubRepoFullName(stdout);
  } catch {
    return null;
  }
}

async function fetchIssue(repo: RepoContext, issueRef: IssueRef): Promise<GitHubIssue> {
  if (!repo.fullName || issueRef.number === 0) return { number: issueRef.number, title: issueRef.key };
  try {
    const issue = await ghJson<GitHubIssue>([
      "issue",
      "view",
      String(issueRef.number),
      "--repo",
      repo.fullName,
      "--json",
      "number,title,body,url,state,labels,assignees,milestone,comments"
    ]);
    return issue;
  } catch {
    return { number: issueRef.number, title: issueRef.key };
  }
}

async function fetchExistingIssues(repo: RepoContext): Promise<GitHubIssue[]> {
  if (!repo.fullName) return [];
  try {
    return await ghJson<GitHubIssue[]>(["issue", "list", "--repo", repo.fullName, "--state", "open", "--limit", "100", "--json", "number,title,url,labels,assignees"]);
  } catch {
    return [];
  }
}

async function checkGitHubAuth(repo: RepoContext): Promise<{ ok: boolean; login?: string; permission?: string }> {
  try {
    const user = await ghJson<{ login: string }>(["api", "user"]);
    let permission: string | undefined;
    if (repo.fullName) {
      try {
        const repoInfo = await ghJson<{ permissions?: Record<string, boolean> }>(["repo", "view", repo.fullName, "--json", "permissions"]);
        permission = repoInfo.permissions?.push ? "write" : repoInfo.permissions?.admin ? "admin" : repoInfo.permissions?.pull ? "read" : "unknown";
      } catch {
        permission = "unknown";
      }
    }
    return { ok: true, login: user.login, permission };
  } catch {
    return { ok: false };
  }
}

async function ghJson<T>(args: string[]): Promise<T> {
  const { stdout } = await execFileAsync("gh", args, { maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout) as T;
}

async function ghText(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", args, { maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

async function createGitHubIssue(repoFullName: string, title: string, body: string): Promise<string> {
  return ghText(["issue", "create", "--repo", repoFullName, "--title", title, "--body", body]);
}

function renderSubissueBody(parent: IssueRef, item: SubissueProposal): string {
  return `Parent: #${parent.number}

## Scope

${item.title}

## Suggested Metadata

- type: ${item.type}
- area: ${item.area}
- capability: ${item.capability}
- effort: ${item.effort}
- risk: ${item.risk}
- suggested assignees: ${item.suggestedAssignees.map((assignee) => `@${assignee}`).join(", ") || "unassigned"}
- suggested labels: ${item.labels.join(", ") || "none"}
- depends_on: ${item.dependsOn.length > 0 ? item.dependsOn.join(", ") : "none"}

## Likely Files

${item.likelyFiles.length > 0 ? item.likelyFiles.map((file) => `- ${file}`).join("\n") : "- none"}

## Done When

${item.doneWhen.map((done) => `- [ ] ${done}`).join("\n")}

## Notes

Generated by pm-agent breakdown apply.
`;
}

function matchKnowledge(text: string, knowledge: Knowledge): { signal?: KnowledgeSignal; capability?: KnowledgeCapability; area?: KnowledgeArea } {
  const normalized = normalize(text);
  const signal = (knowledge.issueMap.planningSignals ?? []).find((item) => normalized.includes(normalize(item.signal)));
  const capability = (knowledge.capabilityMap.capabilities ?? []).find((item) => normalized.includes(normalize(item.name))) ??
    (knowledge.capabilityMap.capabilities ?? []).find((item) => (signal?.areas ?? []).some((area) => item.areas?.includes(area)));
  const area = (knowledge.areaMap.areas ?? []).find((item) => normalized.includes(normalize(item.name))) ??
    (knowledge.areaMap.areas ?? []).find((item) => capability?.areas?.includes(item.name) || signal?.areas?.includes(item.name));
  return { signal, capability, area };
}

function renderBreakdownProposal(proposal: ReturnType<typeof buildBreakdown>): string {
  return `# Breakdown Proposal: ${proposal.parent.ref}

## Parent Issue

${proposal.parent.ref}: ${proposal.parent.title}

## Summary

${proposal.summary}

## Split Strategy

${proposal.strategy}

## Proposed Subissues

${proposal.subissues.map((item, index) => renderSubissue(item, index + 1)).join("\n\n---\n\n")}

## Existing Issue Duplicate Candidates

${proposal.duplicates.length > 0 ? proposal.duplicates.map((item) => `- #${item.number}: ${item.title}`).join("\n") : "- none"}
`;
}

function renderSubissue(item: SubissueProposal, index: number): string {
  return `### ${index}. ${item.title}

- type: ${item.type}
- area: ${item.area}
- capability: ${item.capability}
- effort: ${item.effort}
- risk: ${item.risk}
- suggested assignee: ${item.suggestedAssignees.map((assignee) => `@${assignee}`).join(", ") || "unassigned"}
- labels: ${item.labels.map((label) => `\`${label}\``).join(", ") || "none"}
- milestone: ${item.milestone ?? "none"}
- depends_on: ${item.dependsOn.length > 0 ? item.dependsOn.join(", ") : "none"}

#### Likely Files

${item.likelyFiles.length > 0 ? item.likelyFiles.map((file) => `- ${file}`).join("\n") : "- none"}

#### Done When

${item.doneWhen.map((done) => `- ${done}`).join("\n")}`;
}

function renderMorningPlan(plan: MorningPlan): string {
  return `# Morning Plan - ${plan.date}

## 今日の方針

今日は、既に着手中または ready_to_work のIssueを優先します。大きすぎるIssueは実装対象にせず、breakdown候補として扱います。

## 今日やること

${renderPlanIssueList(plan.doToday)}

## 今日確認すること

${renderPlanIssueList(plan.clarifyToday)}

## 分割した方がいいIssue

${plan.breakdownCandidates.length > 0 ? plan.breakdownCandidates.map((issue) => `### ${issue.ref}: ${issue.title}\n\nこのIssueは複数領域にまたがるため、そのまま今日の実装対象にはしません。\n\n推奨:\n\n\`\`\`bash\npm-agent breakdown ${issue.ref}\n\`\`\``).join("\n\n") : "- none"}

## 今日やらないIssue

${renderPlanIssueList(plan.notToday)}

## Adjust This Plan

- タスク数を減らす: \`pm-agent adjust --fewer\`
- 安全寄りにする: \`pm-agent adjust --safer\`
- repoを優先する: \`pm-agent adjust --prefer <repo>\`
- Issueを除外する: \`pm-agent adjust --exclude <repo>#<number>\`
`;
}

function renderPlanIssueList(issues: PlanIssue[]): string {
  if (issues.length === 0) return "- none";
  return issues
    .map((issue, index) => `### ${index + 1}. ${issue.ref}: ${issue.title}

- reason: ${issue.reason}
- status: ${issue.status}
- risk: ${issue.risk}
- first action: ${issue.firstAction}`)
    .join("\n\n");
}

function renderSharePlan(plan: MorningPlan): string {
  const todayItems = plan.doToday.map((issue) => `- ${issue.ref}: ${issue.title}`).join("\n") || "- none";
  const breakdownItems = plan.breakdownCandidates.map((issue) => `- ${issue.ref}: ${issue.title}`).join("\n") || "- none";
  return `# Today's PM Plan

## Do Today
${todayItems}

## Needs Breakdown
${breakdownItems}
`;
}

function renderTaskBrief(task: ReturnType<typeof buildTaskBrief>): string {
  return `# Task Brief: ${task.issue.ref}

## Goal

${task.goal}

## Project Context

${task.projectContext}

## Issue Context

${task.issueContext}

## Current Work Context

${task.currentWorkContext}

## Related Files

### Direct

${task.relatedFiles.length > 0 ? task.relatedFiles.map((file) => `- ${file}`).join("\n") : "- none inferred"}

### Reverse Dependencies

${Object.entries(task.reverseDependencies).map(([file, dependents]) => `${file} is also imported by:\n${dependents.length > 0 ? dependents.map((dependent) => `- ${dependent}`).join("\n") : "- none"}`).join("\n\n") || "- none"}

## Scope

やること:

${task.scope.map((item) => `- ${item}`).join("\n")}

やらないこと:

${task.outOfScope.map((item) => `- ${item}`).join("\n")}

## First Step

${task.firstStep}

## Done When

${task.doneWhen.map((item) => `- ${item}`).join("\n")}

## Suggested Tests

${task.suggestedTests.length > 0 ? task.suggestedTests.map((file) => `- ${file}`).join("\n") : "- Run the smallest relevant test command for the touched files."}

## Risks

${task.risks.length > 0 ? task.risks.map((risk) => `- ${risk}`).join("\n") : "- none inferred"}

## Expected Final Summary

${task.expectedFinalSummary.map((item) => `- ${item}`).join("\n")}
`;
}

async function latestPlanPath(targetDir: string, date: string): Promise<string | null> {
  const dir = path.join(targetDir, "outputs", date);
  if (!existsSync(dir)) return null;
  const files = (await readdir(dir)).filter((file) => /^plan(?:\.v\d+)?\.json$/.test(file)).sort((a, b) => planVersion(b) - planVersion(a));
  return files[0] ? path.join(dir, files[0]) : null;
}

function planVersion(file: string): number {
  return Number(file.match(/plan\.v(\d+)\.json/)?.[1] ?? "1");
}

async function readSelectedPlanRefs(targetDir: string, date: string): Promise<IssueRef[]> {
  const file = await latestPlanPath(targetDir, date);
  if (!file) return [];
  const plan = JSON.parse(await readFile(file, "utf8")) as MorningPlan;
  return plan.doToday.map((issue) => parseIssueRef(issue.ref)).filter((issue) => issue.number > 0);
}

async function readPlanReason(targetDir: string, date: string, ref: string): Promise<string | null> {
  const file = await latestPlanPath(targetDir, date);
  if (!file) return null;
  const plan = JSON.parse(await readFile(file, "utf8")) as MorningPlan;
  const issue = [...plan.doToday, ...plan.clarifyToday, ...plan.breakdownCandidates, ...plan.notToday].find((item) => item.ref === ref);
  return issue?.reason ?? null;
}

function parseIssueRef(input: string): IssueRef {
  const match = input.match(/^(.+?)#(\d+)$/);
  if (!match) throw new Error(`Invalid issue ref: ${input}. Expected repo#123.`);
  return { repoId: match[1], number: Number(match[2]), key: input };
}

function requireValue(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9ぁ-んァ-ン一-龥]+/g, " ").trim();
}

function summarizeIssue(issue: GitHubIssue): string {
  const body = issue.body?.replace(/\s+/g, " ").trim();
  if (body) return body.length > 240 ? `${body.slice(0, 237)}...` : body;
  return `${issue.title} を実装可能な粒度へ分割します。`;
}

function summarizeProject(projectBrief: Record<string, unknown>): string {
  const purpose = typeof projectBrief.purpose === "string" ? projectBrief.purpose : "Project Brief is available in .pm-agent.";
  const features = Array.isArray(projectBrief.mainFeatures) ? projectBrief.mainFeatures.slice(0, 5).join(", ") : "";
  return features ? `${purpose}\n\nMain features: ${features}` : purpose;
}

function similarTitle(a: string, b: string): boolean {
  const aWords = new Set(normalize(a).split(/\s+/).filter((word) => word.length > 2));
  const bWords = normalize(b).split(/\s+/).filter((word) => word.length > 2);
  if (aWords.size === 0 || bWords.length === 0) return false;
  return bWords.filter((word) => aWords.has(word)).length >= Math.min(3, bWords.length);
}

function extractLabelNames(detail: string): string[] {
  const labels = detail.match(/labels:\s*([^|]+)/)?.[1];
  if (!labels || labels.trim() === "none") return [];
  return labels.split(",").map((label) => label.trim()).filter(Boolean);
}

function extractSectionBullets(markdown: string, heading: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return [];
  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    const bullet = line.trim().match(/^- \s*(.+)$/)?.[1]?.trim();
    if (bullet && bullet !== "none") collected.push(bullet);
  }
  return collected;
}

function comparePlanIssue(a: PlanIssue, b: PlanIssue): number {
  const statusScore = (issue: PlanIssue) => issue.status === "in_progress" ? 0 : issue.status === "ready_to_work" ? 1 : 2;
  return statusScore(a) - statusScore(b);
}

function uniquePlanIssues(issues: PlanIssue[]): PlanIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = issue.ref === "repo#0" ? issue.title : issue.ref;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function describeAdjustments(options: PlanningCommandOptions): string[] {
  return [
    options.fewer ? "fewer" : "",
    options.safer ? "safer" : "",
    options.prefer ? `prefer:${options.prefer}` : "",
    options.exclude ? `exclude:${options.exclude}` : "",
    options.include ? `include:${options.include}` : ""
  ].filter(Boolean);
}

function inferTestFiles(files: string[]): string[] {
  return files.flatMap((file) => {
    const parsed = path.parse(file);
    return [
      path.join(parsed.dir, `${parsed.name}.test${parsed.ext}`),
      path.join(parsed.dir, `${parsed.name}.spec${parsed.ext}`)
    ];
  }).slice(0, 8);
}
