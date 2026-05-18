import path from "node:path";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { initCommand } from "./init.js";
import { ensureDir, readTextIfExists } from "../core/fs.js";

const execFileAsync = promisify(execFile);

export type SetupCommandOptions = {
  ledgerName?: string;
  owner?: string;
  visibility?: "private" | "public";
  github?: boolean;
  selectRepos?: boolean;
  repoScope?: string;
};

type GitHubRepo = {
  name: string;
  full_name: string;
  private: boolean;
  description?: string | null;
  owner?: { login?: string };
};

type RepositorySelection = {
  id: string;
  name: string;
  fullName: string;
  visibility: "private" | "public";
  scope: "owned" | "collaborating";
  description: string;
  readmeSummary: string;
};

export async function setupCommand(targetDir: string, options: SetupCommandOptions = {}): Promise<string> {
  const ledgerName = options.ledgerName ?? (path.basename(targetDir) || "progress-ledger");
  const visibility = options.visibility ?? "private";

  if (options.github === false) {
    await ensureDir(targetDir);
    await initCommand(targetDir);
    return `Initialized local progress ledger: ${targetDir}`;
  }

  await assertGhAuthenticated();
  const owner = options.owner ?? (await githubLogin());
  const fullName = `${owner}/${ledgerName}`;
  const existed = await githubRepoExists(fullName);

  if (!existed) {
    await run("gh", ["repo", "create", fullName, `--${visibility}`, "--description", "Private progress ledger for Personal PM Agent"]);
  }

  if (!existsSync(targetDir)) {
    await run("git", ["clone", `https://github.com/${fullName}.git`, targetDir]);
  } else {
    await ensureDir(targetDir);
  }

  await initCommand(targetDir);
  if (options.selectRepos) {
    const selected = await selectRepositories(options.repoScope ?? "all");
    await updateRepositoryLedger(targetDir, selected);
  }
  await ensureGitRemote(targetDir, fullName);
  await commitAndPushIfNeeded(targetDir);

  return [
    `Progress ledger is ready: ${targetDir}`,
    `GitHub repository: https://github.com/${fullName}`,
    options.selectRepos ? "Repository context was updated from selected GitHub repositories." : "Repository selection was skipped. Run setup with --select-repos to register project repos.",
    existed ? "Repository already existed; reused it." : "Repository was created."
  ].join("\n");
}

async function selectRepositories(scope: string): Promise<RepositorySelection[]> {
  const viewer = await githubLogin();
  const repos = await listAccessibleRepositories(viewer, scope);
  if (repos.length === 0) return [];

  console.log("\nGitHub repositories visible to this account:");
  repos.forEach((repo, index) => {
    const repoScope = repo.owner?.login === viewer ? "owned" : "collaborating";
    const visibility = repo.private ? "private" : "public";
    const description = repo.description ? ` - ${repo.description}` : "";
    console.log(`${index + 1}. [${repoScope}/${visibility}] ${repo.full_name}${description}`);
  });

  const rl = readline.createInterface({ input, output });
  const answer = (await rl.question("\nSelect repositories to register (e.g. 1,3-5, all, none): ")).trim();
  rl.close();

  const selectedIndexes = parseSelection(answer, repos.length);
  const selectedRepos = selectedIndexes.map((index) => repos[index]);
  const selections: RepositorySelection[] = [];
  for (const repo of selectedRepos) {
    const repoScope = repo.owner?.login === viewer ? "owned" : "collaborating";
    selections.push({
      id: repo.name,
      name: repo.name,
      fullName: repo.full_name,
      visibility: repo.private ? "private" : "public",
      scope: repoScope,
      description: repo.description ?? "",
      readmeSummary: await readRepositoryReadmeSummary(repo.full_name)
    });
  }
  return selections;
}

async function listAccessibleRepositories(viewer: string, scope: string): Promise<GitHubRepo[]> {
  const affiliation = scope === "owned" ? "owner" : scope === "collaborating" ? "collaborator" : "owner,collaborator";
  const { stdout } = await run("gh", ["api", "--paginate", "-X", "GET", "/user/repos", "-f", `affiliation=${affiliation}`, "-f", "per_page=100"]);
  const repos = JSON.parse(stdout) as GitHubRepo[];
  return repos
    .filter((repo) => {
      const repoScope = repo.owner?.login === viewer ? "owned" : "collaborating";
      return scope === "all" || scope === repoScope;
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

function parseSelection(answer: string, max: number): number[] {
  if (!answer || answer === "none") return [];
  if (answer === "all") return Array.from({ length: max }, (_, index) => index);

  const indexes = new Set<number>();
  for (const part of answer.split(",")) {
    const trimmed = part.trim();
    const range = trimmed.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      for (let value = start; value <= end; value += 1) {
        if (value >= 1 && value <= max) indexes.add(value - 1);
      }
      continue;
    }
    const value = Number(trimmed);
    if (Number.isInteger(value) && value >= 1 && value <= max) indexes.add(value - 1);
  }
  return [...indexes].sort((a, b) => a - b);
}

async function readRepositoryReadmeSummary(fullName: string): Promise<string> {
  try {
    const { stdout } = await run("gh", ["api", `repos/${fullName}/readme`, "-H", "Accept: application/vnd.github.raw"]);
    return summarizeReadme(stdout);
  } catch {
    return "README could not be read during setup.";
  }
}

function summarizeReadme(readme: string): string {
  const lines = readme
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("```"));
  return lines.slice(0, 12).join("\n").slice(0, 1200);
}

async function updateRepositoryLedger(targetDir: string, selections: RepositorySelection[]): Promise<void> {
  if (selections.length === 0) return;
  await updateRepositoryLinks(targetDir, selections);
  await updateRepositoryContext(targetDir, selections);
}

async function updateRepositoryLinks(targetDir: string, selections: RepositorySelection[]): Promise<void> {
  const file = path.join(targetDir, "links/repositories.md");
  const current = (await readTextIfExists(file)) ?? "# Repositories\n\n";
  const additions = selections
    .filter((selection) => !current.includes(`github: ${selection.fullName}`))
    .map(
      (selection) => `- id: ${selection.id}
  name: ${selection.name}
  github: ${selection.fullName}
  scope: ${selection.scope}
`
    );
  if (additions.length === 0) return;
  await writeFile(file, `${current.trimEnd()}\n\n${additions.join("\n")}`, "utf8");
}

async function updateRepositoryContext(targetDir: string, selections: RepositorySelection[]): Promise<void> {
  const file = path.join(targetDir, "context/repositories.md");
  const current = (await readTextIfExists(file)) ?? "# Repository Context\n\n";
  const additions = selections
    .filter((selection) => !current.includes(`github: ${selection.fullName}`))
    .map(
      (selection) => `## ${selection.id}

- github: ${selection.fullName}
- scope: ${selection.scope}
- visibility: ${selection.visibility}
- description: ${selection.description || "なし"}

### README Summary

${selection.readmeSummary || "README summary is not available."}

### PM Handling

- status: candidate
- notes: setupで選択されたrepo。Issueを見ながら必要に応じてManaged Repositoryへ昇格する。
`
    );
  if (additions.length === 0) return;
  await writeFile(file, `${current.trimEnd()}\n\n${additions.join("\n")}`, "utf8");
}

async function assertGhAuthenticated(): Promise<void> {
  try {
    await run("gh", ["auth", "status"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`GitHub CLI is not authenticated. Run \`gh auth login\` first. ${message}`);
  }
}

async function githubLogin(): Promise<string> {
  const { stdout } = await run("gh", ["api", "user", "--jq", ".login"]);
  return stdout.trim();
}

async function githubRepoExists(fullName: string): Promise<boolean> {
  try {
    await run("gh", ["repo", "view", fullName, "--json", "nameWithOwner"]);
    return true;
  } catch {
    return false;
  }
}

async function ensureGitRemote(targetDir: string, fullName: string): Promise<void> {
  if (!existsSync(path.join(targetDir, ".git"))) {
    await run("git", ["init"], { cwd: targetDir });
    await run("git", ["branch", "-M", "main"], { cwd: targetDir });
  }

  const remoteUrl = `https://github.com/${fullName}.git`;
  try {
    await run("git", ["remote", "get-url", "origin"], { cwd: targetDir });
  } catch {
    await run("git", ["remote", "add", "origin", remoteUrl], { cwd: targetDir });
  }
}

async function commitAndPushIfNeeded(targetDir: string): Promise<void> {
  const { stdout } = await run("git", ["status", "--short"], { cwd: targetDir });
  if (!stdout.trim()) return;

  await run("git", ["add", "."], { cwd: targetDir });
  await run("git", ["commit", "-m", "Initialize progress ledger"], { cwd: targetDir });
  await run("git", ["push", "-u", "origin", "main"], { cwd: targetDir });
}

async function run(command: string, args: string[], options: { cwd?: string } = {}): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(command, args, {
      cwd: options.cwd,
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(String(error));
  }
}
