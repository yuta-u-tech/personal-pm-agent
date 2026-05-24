import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { today } from "../core/date.js";
import { ensureDir, readTextIfExists, writeJson } from "../core/fs.js";
import { expandHome } from "../core/git.js";
import { parseGitHubRepoFullName } from "../core/github.js";
import { parseRepositoryLinks } from "../core/markdown.js";

const execFileAsync = promisify(execFile);

export type IssueCommandOptions = {
  date?: string;
};

type RepoContext = {
  id: string;
  dir: string;
  fullName?: string;
};

type ReflectionJson = {
  suggestedIssues?: string[];
  openDecisions?: string[];
  recommendedDirection?: string[];
  sourcePath?: string;
};

type IssueProposal = {
  title: string;
  body: string;
  source: string;
  needsBreakdown: boolean;
  subissues: Array<{
    title: string;
    body: string;
  }>;
};

type IssueProposalFile = {
  generatedAt: string;
  repoId: string;
  repository?: string;
  sourceReflection?: string;
  issues: IssueProposal[];
};

export async function issueCommand(targetDir: string, action: string | undefined, repoId: string | undefined, options: IssueCommandOptions = {}): Promise<string> {
  if (action === "propose" || !action) return issueProposeCommand(targetDir, repoId, options);
  if (action === "apply") return issueApplyCommand(targetDir, repoId, options);
  throw new Error(`Unknown issue action: ${action}. Expected propose or apply.`);
}

async function issueProposeCommand(targetDir: string, repoId: string | undefined, options: IssueCommandOptions): Promise<string> {
  const date = options.date ?? today();
  const repo = await resolveRepoContext(targetDir, requireRepo(repoId));
  const reflection = await readReflection(targetDir, date, repo.id);
  const proposal = buildIssueProposal(repo, reflection);
  const base = path.join(targetDir, "outputs", date, "issues", repo.id);
  await ensureDir(path.dirname(`${base}.md`));
  await writeFile(`${base}.md`, renderIssueProposalFile(proposal), "utf8");
  await writeJson(`${base}.json`, proposal);
  return `Generated issue proposal:\n- Markdown: ${base}.md\n- JSON: ${base}.json`;
}

async function issueApplyCommand(targetDir: string, repoId: string | undefined, options: IssueCommandOptions): Promise<string> {
  const date = options.date ?? today();
  const repo = await resolveRepoContext(targetDir, requireRepo(repoId));
  if (!repo.fullName) {
    throw new Error(`Could not resolve GitHub repository for ${repo.id}. Add github: owner/name to links/repositories.md or set an origin remote.`);
  }
  await assertGitHubWrite(repo.fullName);

  const proposalPath = path.join(targetDir, "outputs", date, "issues", `${repo.id}.json`);
  if (!existsSync(proposalPath)) {
    await issueProposeCommand(targetDir, repo.id, options);
  }
  const proposal = JSON.parse(await readFile(proposalPath, "utf8")) as IssueProposalFile;
  const created: Array<{ title: string; url: string; subissues?: Array<{ title: string; url: string }> }> = [];

  for (const issue of proposal.issues) {
    const url = await createGitHubIssue(repo.fullName, issue.title, issue.body);
    const entry: { title: string; url: string; subissues?: Array<{ title: string; url: string }> } = { title: issue.title, url };
    if (issue.needsBreakdown && issue.subissues.length > 0) {
      const parentNumber = issueNumberFromUrl(url);
      entry.subissues = [];
      for (const subissue of issue.subissues) {
        const subUrl = await createGitHubIssue(repo.fullName, subissue.title, `Parent: ${parentNumber ? `#${parentNumber}` : url}\n\n${subissue.body}`);
        entry.subissues.push({ title: subissue.title, url: subUrl });
      }
      if (parentNumber && entry.subissues.length > 0) {
        await ghText([
          "issue",
          "comment",
          String(parentNumber),
          "--repo",
          repo.fullName,
          "--body",
          ["Created subissues:", ...entry.subissues.map((item) => `- ${item.title}: ${item.url}`)].join("\n")
        ]);
      }
    }
    created.push(entry);
  }

  const createdPath = path.join(targetDir, "outputs", date, "issues", `${repo.id}.created.json`);
  await writeJson(createdPath, {
    generatedAt: new Date().toISOString(),
    repoId: repo.id,
    repository: repo.fullName,
    created
  });
  return [
    `Created ${created.length} issue groups from reflection.`,
    ...created.map((item, index) => {
      const subissues = item.subissues?.length ? `\n${item.subissues.map((sub, subIndex) => `   ${index + 1}.${subIndex + 1}. ${sub.url}`).join("\n")}` : "";
      return `${index + 1}. ${item.url}${subissues}`;
    }),
    `Saved result: ${createdPath}`
  ].join("\n");
}

function buildIssueProposal(repo: RepoContext, reflection: ReflectionJson): IssueProposalFile {
  const sourceItems = [
    ...(reflection.suggestedIssues ?? []),
    ...(reflection.recommendedDirection ?? []).map((item) => `${item}`)
  ];
  const unique = [...new Set(sourceItems.map((item) => item.trim()).filter(Boolean))];
  const issues = unique.length > 0 ? unique : (reflection.openDecisions ?? []).map((item) => `${item}を決める`);
  return {
    generatedAt: new Date().toISOString(),
    repoId: repo.id,
    repository: repo.fullName,
    sourceReflection: reflection.sourcePath,
    issues: issues.slice(0, 8).map((item) => buildSingleIssueProposal(item, reflection))
  };
}

function buildSingleIssueProposal(titleText: string, reflection: ReflectionJson): IssueProposal {
  const title = titleText.replace(/^Reflection:\s*/, "").replace(/[。.]$/, "");
  const needsBreakdown = isComplexIssue(title);
  const body = `## Summary

${title}

## Context From Reflection

### Recommended Direction

${(reflection.recommendedDirection ?? []).map((item) => `- ${item}`).join("\n") || "- none"}

### Open Decisions

${(reflection.openDecisions ?? []).map((item) => `- ${item}`).join("\n") || "- none"}

## Done When

- [ ] 期待する方向性が明確になっている
- [ ] 実装または判断結果を成果物ログに戻せる
- [ ] 必要なテストまたは確認観点が明記されている

## Notes

Generated by pm-agent issue propose from reflection.
`;
  return {
    title,
    body,
    source: "reflection",
    needsBreakdown,
    subissues: needsBreakdown ? buildDefaultSubissues(title) : []
  };
}

function buildDefaultSubissues(parentTitle: string): Array<{ title: string; body: string }> {
  return [
    {
      title: `${parentTitle}: 要件と完了条件を確定する`,
      body: "## Done When\n\n- [ ] 目的と非スコープが明確になっている\n- [ ] 未決事項が列挙されている\n- [ ] 実装に進める判断材料が揃っている\n"
    },
    {
      title: `${parentTitle}: 実装方針と影響範囲を整理する`,
      body: "## Done When\n\n- [ ] 変更対象が整理されている\n- [ ] 依存関係とリスクが明記されている\n- [ ] テスト方針が決まっている\n"
    },
    {
      title: `${parentTitle}: 最小実装を行う`,
      body: "## Done When\n\n- [ ] 主要な期待挙動が実装されている\n- [ ] スコープ外変更が混ざっていない\n- [ ] 成果物ログに戻せる状態になっている\n"
    },
    {
      title: `${parentTitle}: 検証と引き継ぎを整理する`,
      body: "## Done When\n\n- [ ] 関連テストまたは手動確認が完了している\n- [ ] 残リスクが明記されている\n- [ ] 親Issueへ状況を戻せる\n"
    }
  ];
}

function isComplexIssue(title: string): boolean {
  return /(移行|刷新|全面|v2|version|認証|権限|請求|billing|通知|設計|architecture|複数|全体|dashboard|ワークフロー|workflow)/i.test(title);
}

function renderIssueProposalFile(proposal: IssueProposalFile): string {
  return `# Issue Proposal: ${proposal.repoId}

Repository: ${proposal.repository ?? "unknown"}
Source reflection: ${proposal.sourceReflection ?? "unknown"}

## Proposed Issues

${proposal.issues.map((issue, index) => `### ${index + 1}. ${issue.title}

- source: ${issue.source}
- needs_breakdown: ${issue.needsBreakdown ? "yes" : "no"}

${issue.body}

${issue.subissues.length > 0 ? `#### Proposed Subissues\n\n${issue.subissues.map((subissue) => `- ${subissue.title}`).join("\n")}` : ""}`).join("\n\n---\n\n")}
`;
}

async function readReflection(targetDir: string, date: string, repoId: string): Promise<ReflectionJson> {
  const jsonPath = path.join(targetDir, "outputs", date, "reflections", `${repoId}.json`);
  if (existsSync(jsonPath)) {
    return JSON.parse(await readFile(jsonPath, "utf8")) as ReflectionJson;
  }
  const markdownPath = path.join(targetDir, "outputs", date, "reflections", `${repoId}.md`);
  if (!existsSync(markdownPath)) {
    throw new Error(`Reflection not found for ${repoId}. Run pm-agent reflect ${repoId} first.`);
  }
  const markdown = await readFile(markdownPath, "utf8");
  return {
    sourcePath: markdownPath,
    suggestedIssues: extractBullets(markdown, "Suggested Issues"),
    openDecisions: extractBullets(markdown, "Open Decisions"),
    recommendedDirection: extractBullets(markdown, "Recommended Direction")
  };
}

function extractBullets(markdown: string, heading: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    const item = line.trim().match(/^- \s*(.+)$/)?.[1]?.trim();
    if (item && item !== "none") items.push(item);
  }
  return items;
}

async function resolveRepoContext(targetDir: string, repoId: string): Promise<RepoContext> {
  const repositoriesFile = path.join(targetDir, "links", "repositories.md");
  const markdown = await readTextIfExists(repositoriesFile);
  const links = markdown ? parseRepositoryLinks(markdown) : [];
  const link = links.find((repo) => repo.id === repoId || repo.github === repoId || repo.full_name === repoId);
  if (link) {
    const dir = link.path ? expandHome(link.path) : targetDir;
    const fullName = link.github ?? link.full_name ?? (link.id?.includes("/") ? link.id : await readOriginFullName(dir));
    return { id: link.id ?? repoId, dir, fullName: fullName ?? undefined };
  }
  return { id: repoId, dir: targetDir, fullName: repoId.includes("/") ? repoId : await readOriginFullName(targetDir) ?? undefined };
}

async function readOriginFullName(repoDir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd: repoDir, maxBuffer: 1024 * 1024 });
    return parseGitHubRepoFullName(stdout);
  } catch {
    return null;
  }
}

async function assertGitHubWrite(repoFullName: string): Promise<void> {
  try {
    await ghJson<{ login: string }>(["api", "user"]);
  } catch {
    throw new Error("GitHub authentication is required. Run gh auth login or configure GITHUB_TOKEN.");
  }
  const repo = await ghJson<{ permissions?: Record<string, boolean> }>(["repo", "view", repoFullName, "--json", "permissions"]);
  if (repo.permissions?.pull && !repo.permissions?.push && !repo.permissions?.admin) {
    throw new Error(`GitHub write permission is required for ${repoFullName}.`);
  }
}

async function createGitHubIssue(repoFullName: string, title: string, body: string): Promise<string> {
  return ghText(["issue", "create", "--repo", repoFullName, "--title", title, "--body", body]);
}

async function ghJson<T>(args: string[]): Promise<T> {
  const { stdout } = await execFileAsync("gh", args, { maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout) as T;
}

async function ghText(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", args, { maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

function issueNumberFromUrl(url: string): number | null {
  const value = url.match(/\/issues\/(\d+)/)?.[1];
  return value ? Number(value) : null;
}

function requireRepo(repoId: string | undefined): string {
  if (!repoId) throw new Error("Missing repository id. Example: pm-agent issue propose project-a");
  return repoId;
}
