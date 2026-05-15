import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

export function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

export async function collectGitSummary(repoPath: string): Promise<Record<string, unknown>> {
  const cwd = expandHome(repoPath);
  try {
    const [branch, status, diffStat, log] = await Promise.all([
      git(["branch", "--show-current"], cwd),
      git(["status", "--short"], cwd),
      git(["diff", "--stat"], cwd),
      git(["log", "--since=yesterday", "--oneline", "--max-count=10"], cwd)
    ]);

    return {
      path: repoPath,
      resolved_path: cwd,
      branch: branch.trim() || "unknown",
      status: status.trim() || "clean",
      diff_stat: diffStat.trim() || "no diff",
      recent_commits: log.trim() || "no commits since yesterday"
    };
  } catch (error) {
    return {
      path: repoPath,
      resolved_path: cwd,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 1024 * 1024
  });
  return stdout;
}

