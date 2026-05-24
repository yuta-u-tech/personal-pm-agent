import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { promisify } from "node:util";
import { today } from "../core/date.js";
import { ensureDir, readTextIfExists, writeJson } from "../core/fs.js";
import { expandHome } from "../core/git.js";
import { parseGitHubRepoFullName } from "../core/github.js";
import { parseRepositoryLinks } from "../core/markdown.js";

const execFileAsync = promisify(execFile);

export type ProjectLogOptions = {
  date?: string;
  note?: string;
};

type RepoContext = {
  id: string;
  dir: string;
  fullName?: string;
};

type GitSnapshot = {
  branch: string;
  status: string[];
  diffStat: string;
  changedFiles: string[];
  recentCommits: string[];
};

type ProjectLogDraft = {
  generatedAt: string;
  date: string;
  repo: RepoContext;
  note?: string;
  git: GitSnapshot;
  taskBriefs: string[];
  inferred: {
    completedOrTouched: string[];
    checks: string[];
    concerns: string[];
    nextNotes: string[];
  };
};

type Reflection = {
  generatedAt: string;
  date: string;
  repo: RepoContext;
  sourcePath: string;
  progressSummary: string[];
  openDecisions: string[];
  recommendedDirection: string[];
  suggestedIssues: string[];
  morningPlanInput: {
    priority: string;
    avoid: string[];
    next: string[];
  };
};

type MarkdownSection = {
  heading: string;
  body: string;
};

type MarkdownDocument = {
  title: string;
  sections: MarkdownSection[];
};

export async function projectLogCommand(targetDir: string, action: string | undefined, repoId: string | undefined, options: ProjectLogOptions = {}): Promise<string> {
  if (action === "draft") {
    return projectLogDraftCommand(targetDir, repoId, options);
  }
  if (action === "review") {
    return projectLogReviewCommand(targetDir, repoId, options);
  }
  if (action === "edit") {
    return projectLogEditCommand(targetDir, repoId, options);
  }
  throw new Error(`Unknown log action: ${action ?? "(missing)"}. Expected draft, review, or edit.`);
}

export async function projectLogDraftCommand(targetDir: string, repoId: string | undefined, options: ProjectLogOptions = {}): Promise<string> {
  const date = options.date ?? today();
  const repo = await resolveRepoContext(targetDir, requireRepo(repoId));
  const git = await collectGitSnapshot(repo.dir);
  const taskBriefs = await listTaskBriefs(targetDir, date, repo.id);
  const draft = buildProjectLogDraft(date, repo, git, taskBriefs, options.note);
  const base = path.join(targetDir, "outputs", date, "project-logs", `${repo.id}.draft`);
  await ensureDir(path.dirname(`${base}.md`));
  await writeFile(`${base}.md`, renderProjectLogDraft(draft), "utf8");
  await writeJson(`${base}.json`, draft);
  return `Generated project log draft:\n- Markdown: ${base}.md\n- JSON: ${base}.json`;
}

export async function projectLogReviewCommand(targetDir: string, repoId: string | undefined, options: ProjectLogOptions = {}): Promise<string> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("log review requires an interactive terminal.");
  }

  const date = options.date ?? today();
  const repo = await resolveRepoContext(targetDir, requireRepo(repoId));
  const sourcePath = await findProjectLog(targetDir, date, repo.id) ?? await createDraftAndReturnPath(targetDir, repo.id, options);
  const markdown = await readFile(sourcePath, "utf8");
  const document = parseMarkdownSections(markdown);
  const rl = createInterface({ input, output });

  try {
    output.write(`\nProject Log Review: ${repo.id} - ${date}\n`);
    output.write(`Source: ${sourcePath}\n\n`);

    let index = 0;
    while (index < document.sections.length) {
      const section = document.sections[index];
      output.write(renderSectionReview(section, index, document.sections.length));
      const action = (await rl.question("Action [n=next, a=add bullet, d=delete bullet, r=replace, s=save, q=quit] > ")).trim().toLowerCase();

      if (action === "" || action === "n" || action === "y") {
        index += 1;
        continue;
      }
      if (action === "a") {
        const bullet = (await rl.question("Bullet to add > ")).trim();
        if (bullet) section.body = appendBullet(section.body, bullet);
        continue;
      }
      if (action === "d") {
        const bullets = sectionBullets(section.body);
        if (bullets.length === 0) {
          output.write("No bullets in this section.\n\n");
          continue;
        }
        bullets.forEach((bullet, bulletIndex) => output.write(`${bulletIndex + 1}. ${bullet}\n`));
        const choice = Number((await rl.question("Bullet number to delete > ")).trim());
        if (Number.isInteger(choice) && choice >= 1 && choice <= bullets.length) {
          section.body = deleteBullet(section.body, choice - 1);
        }
        continue;
      }
      if (action === "r") {
        output.write("Replace section body. Enter one line; use \\n text later in the file for richer editing.\n");
        const replacement = (await rl.question("New section body > ")).trim();
        if (replacement) section.body = replacement.startsWith("- ") ? replacement : `- ${replacement}`;
        continue;
      }
      if (action === "s") {
        const finalPath = await saveReviewedProjectLog(targetDir, date, repo.id, document);
        return `Saved reviewed project log:\n- Markdown: ${finalPath}`;
      }
      if (action === "q") {
        return "Review exited without saving.";
      }
      output.write("Unknown action.\n\n");
    }

    const finalPath = await saveReviewedProjectLog(targetDir, date, repo.id, document);
    return `Saved reviewed project log:\n- Markdown: ${finalPath}`;
  } finally {
    rl.close();
  }
}

export async function projectLogEditCommand(targetDir: string, repoId: string | undefined, options: ProjectLogOptions = {}): Promise<string> {
  const date = options.date ?? today();
  const repo = await resolveRepoContext(targetDir, requireRepo(repoId));
  const sourcePath = await findProjectLog(targetDir, date, repo.id) ?? await createDraftAndReturnPath(targetDir, repo.id, options);
  const markdown = await readFile(sourcePath, "utf8");
  const finalPath = path.join(targetDir, "outputs", date, "project-logs", `${repo.id}.md`);
  await ensureDir(path.dirname(finalPath));
  await writeFile(finalPath, markdown, "utf8");
  await openExternalEditor(finalPath);
  return `Opened project log in external editor:\n- Markdown: ${finalPath}`;
}

export async function reflectCommand(targetDir: string, repoId: string | undefined, options: ProjectLogOptions = {}): Promise<string> {
  const date = options.date ?? today();
  const repo = await resolveRepoContext(targetDir, requireRepo(repoId));
  const sourcePath = await findProjectLog(targetDir, date, repo.id);
  const finalSourcePath = sourcePath ?? await createDraftAndReturnPath(targetDir, repo.id, options);
  const markdown = await readFile(finalSourcePath, "utf8");
  const reflection = buildReflection(date, repo, finalSourcePath, markdown);
  const base = path.join(targetDir, "outputs", date, "reflections", repo.id);
  await ensureDir(path.dirname(`${base}.md`));
  await writeFile(`${base}.md`, renderReflection(reflection), "utf8");
  await writeJson(`${base}.json`, reflection);
  return `Generated project reflection:\n- Markdown: ${base}.md\n- JSON: ${base}.json\n- Source: ${finalSourcePath}`;
}

async function createDraftAndReturnPath(targetDir: string, repoId: string, options: ProjectLogOptions): Promise<string> {
  await projectLogDraftCommand(targetDir, repoId, options);
  return path.join(targetDir, "outputs", options.date ?? today(), "project-logs", `${repoId}.draft.md`);
}

async function saveReviewedProjectLog(targetDir: string, date: string, repoId: string, document: MarkdownDocument): Promise<string> {
  const finalPath = path.join(targetDir, "outputs", date, "project-logs", `${repoId}.md`);
  await ensureDir(path.dirname(finalPath));
  await writeFile(finalPath, renderMarkdownDocument(document), "utf8");
  return finalPath;
}

async function openExternalEditor(filePath: string): Promise<void> {
  const editor = process.env.EDITOR || process.env.VISUAL || "vi";
  const [command, ...args] = editor.split(/\s+/).filter(Boolean);
  if (!command) throw new Error("No editor configured. Set EDITOR=emacs, EDITOR=vim, or another editor command.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args, filePath], {
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Editor exited with code ${code ?? "unknown"}: ${command}`));
    });
  });
}

function parseMarkdownSections(markdown: string): MarkdownDocument {
  const lines = markdown.split(/\r?\n/);
  const title = lines.find((line) => line.startsWith("# ")) ?? "# Project Log";
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;
  const bodyLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("# ")) continue;
    if (line.startsWith("## ")) {
      if (current) {
        current.body = bodyLines.join("\n").trim();
        sections.push(current);
        bodyLines.length = 0;
      }
      current = { heading: line.replace(/^##\s+/, "").trim(), body: "" };
      continue;
    }
    if (current) bodyLines.push(line);
  }

  if (current) {
    current.body = bodyLines.join("\n").trim();
    sections.push(current);
  }

  return { title, sections };
}

function renderMarkdownDocument(document: MarkdownDocument): string {
  return `${document.title}

${document.sections.map((section) => `## ${section.heading}

${section.body.trim() || "- none"}`).join("\n\n")}
`;
}

function renderSectionReview(section: MarkdownSection, index: number, total: number): string {
  return `\n[${index + 1}/${total}] ${section.heading}

${section.body.trim() || "- none"}

`;
}

function appendBullet(body: string, bullet: string): string {
  const normalized = bullet.startsWith("- ") ? bullet : `- ${bullet}`;
  const trimmed = body.trim();
  if (!trimmed || trimmed === "- none") return normalized;
  return `${trimmed}\n${normalized}`;
}

function sectionBullets(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /, "").trim());
}

function deleteBullet(body: string, bulletIndex: number): string {
  let seen = -1;
  const lines = body.split(/\r?\n/).filter((line) => {
    if (!line.trim().startsWith("- ")) return true;
    seen += 1;
    return seen !== bulletIndex;
  });
  return lines.join("\n").trim() || "- none";
}

function buildProjectLogDraft(date: string, repo: RepoContext, git: GitSnapshot, taskBriefs: string[], note?: string): ProjectLogDraft {
  const touched = git.changedFiles.slice(0, 20);
  const checks = [
    git.diffStat === "no diff" ? "Git差分はありません" : "Git差分があります",
    "テスト実行ログは自動検出していません"
  ];
  const concerns = inferConcerns(git.changedFiles, note);
  const nextNotes = inferNextNotes(git.changedFiles, taskBriefs, note);
  return {
    generatedAt: new Date().toISOString(),
    date,
    repo,
    note,
    git,
    taskBriefs,
    inferred: {
      completedOrTouched: touched,
      checks,
      concerns,
      nextNotes
    }
  };
}

function buildReflection(date: string, repo: RepoContext, sourcePath: string, markdown: string): Reflection {
  const bullets = extractBullets(markdown);
  const concerns = extractSectionBullets(markdown, "気になっていそうなこと");
  const next = [
    ...extractSectionBullets(markdown, "明日につなぐメモ"),
    ...extractSectionBullets(markdown, "明日やるなら")
  ];
  const touched = extractSectionBullets(markdown, "成果物");
  const openDecisions = concerns.length > 0 ? concerns : bullets.filter((item) => /(未決|不明|確認|迷|決め|risk|リスク|concern)/i.test(item));
  const nextItems = next.length > 0 ? next : inferDirectionFromBullets(bullets);
  return {
    generatedAt: new Date().toISOString(),
    date,
    repo,
    sourcePath,
    progressSummary: summarizeProgress(touched, bullets),
    openDecisions: openDecisions.slice(0, 8),
    recommendedDirection: nextItems.slice(0, 5),
    suggestedIssues: suggestIssues(nextItems, openDecisions).slice(0, 6),
    morningPlanInput: {
      priority: openDecisions.length > 0 ? "decision" : "implementation",
      avoid: openDecisions.length > 0 ? ["未決事項を残したまま実装範囲を広げる"] : [],
      next: nextItems.slice(0, 5)
    }
  };
}

function renderProjectLogDraft(draft: ProjectLogDraft): string {
  return `# Project Log Draft: ${draft.repo.id} - ${draft.date}

## 今日やったこと

${draft.inferred.completedOrTouched.length > 0 ? draft.inferred.completedOrTouched.map((file) => `- ${file} を変更または確認`).join("\n") : "- 変更ファイルは検出されませんでした"}

## 成果物

${draft.git.changedFiles.length > 0 ? draft.git.changedFiles.map((file) => `- ${file}`).join("\n") : "- none"}

## 確認したこと

${draft.inferred.checks.map((item) => `- ${item}`).join("\n")}

## 気になっていそうなこと

${draft.inferred.concerns.length > 0 ? draft.inferred.concerns.map((item) => `- ${item}`).join("\n") : "- 追加メモがあればここに書く"}

## 明日につなぐメモ

${draft.inferred.nextNotes.length > 0 ? draft.inferred.nextNotes.map((item) => `- ${item}`).join("\n") : "- 次に判断したいことを書く"}

## Agent Materials

- branch: ${draft.git.branch}
- repository: ${draft.repo.fullName ?? draft.repo.dir}
- note: ${draft.note ?? "none"}

### Diff Stat

\`\`\`txt
${draft.git.diffStat}
\`\`\`

### Recent Commits

${draft.git.recentCommits.length > 0 ? draft.git.recentCommits.map((commit) => `- ${commit}`).join("\n") : "- none"}

### Task Briefs

${draft.taskBriefs.length > 0 ? draft.taskBriefs.map((file) => `- ${file}`).join("\n") : "- none"}
`;
}

function renderReflection(reflection: Reflection): string {
  return `# Reflection: ${reflection.repo.id} - ${reflection.date}

## Progress Summary

${reflection.progressSummary.length > 0 ? reflection.progressSummary.map((item) => `- ${item}`).join("\n") : "- 成果物ログから進捗を特定できませんでした"}

## Open Decisions

${reflection.openDecisions.length > 0 ? reflection.openDecisions.map((item) => `- ${item}`).join("\n") : "- none"}

## Recommended Direction

${reflection.recommendedDirection.length > 0 ? reflection.recommendedDirection.map((item) => `- ${item}`).join("\n") : "- まず成果物ログに明日の判断材料を追記してください"}

## Suggested Issues

${reflection.suggestedIssues.length > 0 ? reflection.suggestedIssues.map((item) => `- ${item}`).join("\n") : "- none"}

## Morning Plan Input

- priority: ${reflection.morningPlanInput.priority}
- avoid: ${reflection.morningPlanInput.avoid.join(", ") || "none"}
- next: ${reflection.morningPlanInput.next.join(", ") || "none"}

Source: ${reflection.sourcePath}
`;
}

async function collectGitSnapshot(repoDir: string): Promise<GitSnapshot> {
  const [branch, status, diffStat, commits] = await Promise.all([
    git(["branch", "--show-current"], repoDir, "unknown"),
    git(["status", "--short"], repoDir, ""),
    git(["diff", "--stat"], repoDir, "no diff"),
    git(["log", "--since=midnight", "--oneline", "--max-count=10"], repoDir, "")
  ]);
  const statusLines = status.split(/\r?\n/).filter((line) => line.trim());
  return {
    branch: branch.trim() || "unknown",
    status: statusLines,
    diffStat: diffStat.trim() || "no diff",
    changedFiles: statusLines.map((line) => line.slice(3).trim()).filter(Boolean),
    recentCommits: commits.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  };
}

async function git(args: string[], cwd: string, fallback: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 1024 * 1024 });
    return stdout;
  } catch {
    return fallback;
  }
}

async function listTaskBriefs(targetDir: string, date: string, repoId: string): Promise<string[]> {
  const dir = path.join(targetDir, "outputs", date, "tasks");
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  return files
    .filter((file) => file.startsWith(`${repoId}-`) && file.endsWith(".md"))
    .map((file) => path.join(dir, file));
}

async function findProjectLog(targetDir: string, date: string, repoId: string): Promise<string | null> {
  const dir = path.join(targetDir, "outputs", date, "project-logs");
  const finalPath = path.join(dir, `${repoId}.md`);
  const draftPath = path.join(dir, `${repoId}.draft.md`);
  if (existsSync(finalPath)) return finalPath;
  if (existsSync(draftPath)) return draftPath;
  return null;
}

async function resolveRepoContext(targetDir: string, repoId: string): Promise<RepoContext> {
  const repositoriesFile = path.join(targetDir, "links", "repositories.md");
  const markdown = await readTextIfExists(repositoriesFile);
  const links = markdown ? parseRepositoryLinks(markdown) : [];
  const link = links.find((repo) => repo.id === repoId || repo.github === repoId || repo.full_name === repoId);
  if (link) {
    const dir = link.path ? expandHome(link.path) : targetDir;
    return {
      id: link.id ?? repoId,
      dir,
      fullName: link.github ?? link.full_name ?? (link.id?.includes("/") ? link.id : await readOriginFullName(dir) ?? undefined)
    };
  }
  return { id: repoId, dir: targetDir, fullName: await readOriginFullName(targetDir) ?? undefined };
}

async function readOriginFullName(repoDir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd: repoDir, maxBuffer: 1024 * 1024 });
    return parseGitHubRepoFullName(stdout);
  } catch {
    return null;
  }
}

function requireRepo(repoId: string | undefined): string {
  if (!repoId) throw new Error("Missing repository id. Example: pm-agent log draft project-a");
  return repoId;
}

function extractBullets(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /, "").trim())
    .filter(Boolean);
}

function extractSectionBullets(markdown: string, heading: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return [];
  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (line.trim().startsWith("- ")) collected.push(line.trim().replace(/^- /, "").trim());
  }
  return collected.filter((item) => item !== "none" && !item.startsWith("追加メモ") && !item.startsWith("次に判断"));
}

function inferConcerns(files: string[], note?: string): string[] {
  const concerns = new Set<string>();
  if (files.some((file) => /\.(test|spec)\./.test(file))) concerns.add("テスト変更があるため、関連実装との整合を確認する");
  if (files.some((file) => file.includes("api") || file.includes("route"))) concerns.add("API変更の影響範囲を確認する");
  if (files.some((file) => file.includes("config") || file.includes("schema"))) concerns.add("設定またはスキーマ変更の互換性を確認する");
  if (note && /(未決|不明|確認|迷|risk|リスク)/i.test(note)) concerns.add(note);
  return [...concerns].slice(0, 6);
}

function inferNextNotes(files: string[], taskBriefs: string[], note?: string): string[] {
  const notes = new Set<string>();
  if (taskBriefs.length > 0) notes.add("Task BriefのDone Whenを満たしているか確認する");
  if (files.length > 0) notes.add("変更ファイルの意図と残作業を短く確定する");
  if (note) notes.add(note);
  return [...notes].slice(0, 6);
}

function summarizeProgress(touched: string[], bullets: string[]): string[] {
  if (touched.length > 0) return touched.slice(0, 8).map((item) => `${item} が成果物として残っている`);
  return bullets.filter((item) => !/(none|branch:|repository:|note:)/i.test(item)).slice(0, 8);
}

function inferDirectionFromBullets(bullets: string[]): string[] {
  const decision = bullets.filter((item) => /(未決|不明|確認|決め|迷)/.test(item));
  if (decision.length > 0) return decision.map((item) => `${item} を先に決める`);
  return bullets.slice(0, 3).map((item) => `${item} の次の一手を決める`);
}

function suggestIssues(nextItems: string[], openDecisions: string[]): string[] {
  const source = nextItems.length > 0 ? nextItems : openDecisions;
  return source.map((item) => `${item.replace(/[。.]$/, "")}`);
}
