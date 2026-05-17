import path from "node:path";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { initCommand } from "./init.js";
import { ensureDir } from "../core/fs.js";

const execFileAsync = promisify(execFile);

export type SetupCommandOptions = {
  ledgerName?: string;
  owner?: string;
  visibility?: "private" | "public";
  github?: boolean;
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
  await ensureGitRemote(targetDir, fullName);
  await commitAndPushIfNeeded(targetDir);

  return [
    `Progress ledger is ready: ${targetDir}`,
    `GitHub repository: https://github.com/${fullName}`,
    existed ? "Repository already existed; reused it." : "Repository was created."
  ].join("\n");
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
