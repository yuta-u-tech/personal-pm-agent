import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { expandHome } from "../core/git.js";
import { parseRepositoryLinks } from "../core/markdown.js";
import { understandCommand } from "./understand.js";

const execFileAsync = promisify(execFile);

export type UnderstandActiveOptions = {
  refresh?: boolean;
  github?: boolean;
};

type RegisteredRepository = Record<string, string>;

type ActiveRepository = {
  repo: RegisteredRepository;
  reason: string;
};

export async function understandActiveCommand(ledgerDir: string, options: UnderstandActiveOptions = {}): Promise<string> {
  const repositories = await readRegisteredRepositories(ledgerDir);
  const activeRepos = await findActiveRepositories(ledgerDir, repositories, options);

  if (activeRepos.length === 0) {
    return [
      "No active repositories found.",
      "",
      "Active means:",
      "- referenced by tasks/active.md with <!-- repo:<repo-id> -->",
      "- or has an open GitHub Issue assigned to you",
      "",
      "Next:",
      "- Run /discover github <repo-id>",
      "- Run /import <number> --list active",
      "- Or add a task with /add \"task\" --list active --repo <repo-id>"
    ].join("\n");
  }

  const results: string[] = [];
  let completed = 0;
  let skipped = 0;
  let failed = 0;

  for (const active of activeRepos) {
    const repo = active.repo;
    const repoId = repo.id;
    const repoPath = resolveRepositoryPath(ledgerDir, repo);
    if (!repoPath || !existsSync(path.join(repoPath, ".git"))) {
      skipped += 1;
      results.push(`- ${repoId} skipped\n  reason: repository is not cloned locally\n  active reason: ${active.reason}`);
      continue;
    }

    try {
      await understandCommand(repoPath, { refresh: options.refresh });
      completed += 1;
      results.push(`✓ ${repoId}\n  path: ${repoPath}\n  active reason: ${active.reason}`);
    } catch (error) {
      failed += 1;
      results.push(`✗ ${repoId} failed\n  reason: ${error instanceof Error ? error.message : String(error)}\n  active reason: ${active.reason}`);
    }
  }

  return [
    "Understanding active repositories...",
    "",
    ...results,
    "",
    "Summary:",
    `- completed: ${completed}`,
    `- skipped: ${skipped}`,
    `- failed: ${failed}`,
    "",
    "Open dashboard:",
    "pm-agent dashboard <ledger-dir>"
  ].join("\n");
}

async function readRegisteredRepositories(ledgerDir: string): Promise<RegisteredRepository[]> {
  const file = path.join(ledgerDir, "links/repositories.md");
  const markdown = existsSync(file) ? await readFile(file, "utf8") : "";
  return parseRepositoryLinks(markdown).filter((repo) => repo.id);
}

async function findActiveRepositories(
  ledgerDir: string,
  repositories: RegisteredRepository[],
  options: UnderstandActiveOptions
): Promise<ActiveRepository[]> {
  const byId = new Map(repositories.map((repo) => [repo.id, repo]));
  const active = new Map<string, ActiveRepository>();

  for (const repoId of await repoIdsFromActiveTasks(ledgerDir)) {
    const repo = byId.get(repoId);
    if (repo) active.set(repoId, { repo, reason: "tasks/active.md" });
  }

  if (options.github !== false) {
    for (const repo of repositories) {
      if (!repo.github) continue;
      if (active.has(repo.id)) continue;
      if (await hasAssignedOpenIssue(repo.github)) {
        active.set(repo.id, { repo, reason: "assigned open GitHub Issue" });
      }
    }
  }

  return [...active.values()].sort((a, b) => a.repo.id.localeCompare(b.repo.id));
}

async function repoIdsFromActiveTasks(ledgerDir: string): Promise<string[]> {
  const file = path.join(ledgerDir, "tasks/active.md");
  const markdown = existsSync(file) ? await readFile(file, "utf8") : "";
  return [...markdown.matchAll(/<!--\s*repo:([A-Za-z0-9_.-]+)\s*-->/g)].map((match) => match[1]);
}

async function hasAssignedOpenIssue(repoFullName: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("gh", [
      "issue",
      "list",
      "--repo",
      repoFullName,
      "--state",
      "open",
      "--assignee",
      "@me",
      "--limit",
      "1",
      "--json",
      "number"
    ]);
    const issues = JSON.parse(stdout) as unknown[];
    return issues.length > 0;
  } catch {
    return false;
  }
}

function resolveRepositoryPath(ledgerDir: string, repo: RegisteredRepository): string | undefined {
  const candidates = [
    repo.path ? expandHome(repo.path) : "",
    path.join(path.dirname(ledgerDir), repo.id)
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(path.join(candidate, ".git"))) ?? candidates[0];
}
