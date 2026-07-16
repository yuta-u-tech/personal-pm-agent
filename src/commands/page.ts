import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { today } from "../core/date.js";
import { ensureDir, readTextIfExists } from "../core/fs.js";
import { parseRepositoryLinks } from "../core/markdown.js";

export type PageOptions = {
  date?: string;
  open?: boolean;
};

type Artifact = {
  title: string;
  path: string;
  content?: string;
};

type MenuItem = {
  label: string;
  page: string;
  arg?: string;
  aliases?: string[];
};

export async function pageCommand(targetDir: string, page: string | undefined, arg: string | undefined, options: PageOptions = {}): Promise<string> {
  const date = options.date ?? today();
  const pageName = page ?? "today";
  const outputDir = path.join(targetDir, "outputs", date, "pages");
  await ensureDir(outputDir);

  if (pageName === "menu") {
    return pageMenu(targetDir, outputDir, date, options);
  }

  const result = await buildPage(targetDir, outputDir, date, pageName, arg);
  if (options.open) await openExternalEditor(result.path);
  return `Generated page:\n- Markdown: ${result.path}${options.open ? "\n- Opened in editor" : ""}`;
}

async function buildPage(targetDir: string, outputDir: string, date: string, pageName: string, arg: string | undefined): Promise<{ path: string }> {
  if (pageName === "status") {
    const filePath = path.join(outputDir, "status.md");
    await writeFile(filePath, await renderStatusPage(targetDir, date), "utf8");
    return { path: filePath };
  }
  if (pageName === "plan") {
    const filePath = path.join(outputDir, "plan.md");
    await writeFile(filePath, await renderSingleArtifactPage(targetDir, date, "Plan", [
      ["plan.v9.md", "Latest Adjusted Plan"],
      ["plan.v8.md", "Latest Adjusted Plan"],
      ["plan.v7.md", "Latest Adjusted Plan"],
      ["plan.v6.md", "Latest Adjusted Plan"],
      ["plan.v5.md", "Latest Adjusted Plan"],
      ["plan.v4.md", "Latest Adjusted Plan"],
      ["plan.v3.md", "Latest Adjusted Plan"],
      ["plan.v2.md", "Latest Adjusted Plan"],
      ["plan.md", "Morning Plan"]
    ]), "utf8");
    return { path: filePath };
  }
  if (pageName === "share") {
    const filePath = path.join(outputDir, "share.md");
    await writeFile(filePath, await renderSingleArtifactPage(targetDir, date, "Share", [
      ["share.md", "Planning Share"],
      [path.join("..", "..", "reports", "share", `${date}.md`), "Share Report"]
    ]), "utf8");
    return { path: filePath };
  }
  if (pageName === "report") {
    const filePath = path.join(outputDir, "report.md");
    await writeFile(filePath, await renderSingleArtifactPage(targetDir, date, "Report", [
      [path.join("..", "..", "reports", "daily", `${date}.md`), "Daily Report"]
    ]), "utf8");
    return { path: filePath };
  }
  if (pageName === "suggestions" || pageName === "suggest") {
    const filePath = path.join(outputDir, "suggestions.md");
    await writeFile(filePath, await renderSingleArtifactPage(targetDir, date, "Suggestions", [
      [path.join("..", "..", "suggestions", `${date}.md`), "Suggestions"]
    ]), "utf8");
    return { path: filePath };
  }
  if (pageName === "repos" || pageName === "repositories") {
    const filePath = path.join(outputDir, "repositories.md");
    await writeFile(filePath, await renderRepositoriesPage(targetDir), "utf8");
    return { path: filePath };
  }
  if (pageName === "reflections") {
    const filePath = path.join(outputDir, "reflections.md");
    await writeFile(filePath, await renderReflectionsPage(targetDir, date), "utf8");
    return { path: filePath };
  }
  if (pageName === "issues") {
    const filePath = path.join(outputDir, "issues.md");
    await writeFile(filePath, await renderIssuesPage(targetDir, date), "utf8");
    return { path: filePath };
  }
  if (pageName === "today") {
    const filePath = path.join(outputDir, "today.md");
    await writeFile(filePath, await renderTodayPage(targetDir, date), "utf8");
    return { path: filePath };
  }
  if (pageName === "project") {
    if (!arg) throw new Error("Missing repo id. Example: pm-agent page project personal-pm-agent");
    const filePath = path.join(outputDir, `project-${safeName(arg)}.md`);
    await writeFile(filePath, await renderProjectPage(targetDir, date, arg), "utf8");
    return { path: filePath };
  }
  if (pageName === "logs") {
    const filePath = path.join(outputDir, "logs.md");
    await writeFile(filePath, await renderLogsPage(targetDir, date), "utf8");
    return { path: filePath };
  }
  if (pageName === "tasks") {
    const filePath = path.join(outputDir, "tasks.md");
    await writeFile(filePath, await renderTasksPage(targetDir, date), "utf8");
    return { path: filePath };
  }
  if (pageName === "breakdowns") {
    const filePath = path.join(outputDir, "breakdowns.md");
    await writeFile(filePath, await renderBreakdownsPage(targetDir, date), "utf8");
    return { path: filePath };
  }
  throw new Error(`Unknown page: ${pageName}. Expected menu, today, status, plan, share, report, suggestions, project, logs, reflections, issues, tasks, breakdowns, or repos.`);
}

async function pageMenu(targetDir: string, outputDir: string, date: string, options: PageOptions): Promise<string> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("page menu requires an interactive terminal.");
  }

  const repos = await listRepoIds(targetDir, date);
  const items: MenuItem[] = [
    { label: "Today", page: "today", aliases: ["t", "today"] },
    { label: "Status", page: "status", aliases: ["st", "status"] },
    { label: "Plan", page: "plan", aliases: ["p", "plan"] },
    { label: "Share", page: "share", aliases: ["sh", "share"] },
    { label: "Report", page: "report", aliases: ["r", "report"] },
    { label: "Suggestions", page: "suggestions", aliases: ["sg", "suggestions", "suggest"] },
    { label: "Logs", page: "logs", aliases: ["l", "logs"] },
    { label: "Reflections", page: "reflections", aliases: ["rf", "reflections"] },
    { label: "Issue Proposals", page: "issues", aliases: ["i", "issues"] },
    { label: "Tasks", page: "tasks", aliases: ["ta", "tasks"] },
    { label: "Breakdowns", page: "breakdowns", aliases: ["b", "breakdowns"] },
    { label: "Repositories", page: "repos", aliases: ["repo", "repos", "repositories"] },
    ...repos.map((repo) => ({ label: `Project: ${repo}`, page: "project", arg: repo, aliases: [`project ${repo}`, repo] }))
  ];

  const rl = createInterface({ input, output });
  const generated: string[] = [];
  try {
    while (true) {
      output.write(`\nPM Page Menu - ${date}\n`);
      items.forEach((item, index) => {
        const shortcut = item.aliases?.[0] ? ` (${item.aliases[0]})` : "";
        output.write(`${index + 1}. ${item.label}${shortcut}\n`);
      });
      output.write("q. Quit\n");
      const answer = (await rl.question("Open page > ")).trim().toLowerCase();
      if (answer === "q" || answer === "quit") break;
      const item = selectMenuItem(items, answer);
      if (!item) {
        output.write("Invalid choice.\n");
        continue;
      }
      const result = await buildPage(targetDir, outputDir, date, item.page, item.arg);
      generated.push(result.path);
      if (options.open) {
        await openExternalEditor(result.path);
        output.write(`Returned from editor: ${result.path}\n`);
      } else {
        output.write(`\n${result.path}\n\n`);
        output.write(`${await preview(result.path, 18)}\n`);
      }
    }
  } finally {
    rl.close();
  }
  return generated.length > 0 ? `Generated pages:\n${generated.map((file) => `- ${file}`).join("\n")}` : "Page menu closed.";
}

function selectMenuItem(items: MenuItem[], answer: string): MenuItem | null {
  const index = Number(answer) - 1;
  if (Number.isInteger(index) && index >= 0 && index < items.length) return items[index];
  return items.find((item) => item.aliases?.includes(answer) || item.label.toLowerCase() === answer) ?? null;
}

async function renderTodayPage(targetDir: string, date: string): Promise<string> {
  const repos = await listRepoIds(targetDir, date);
  const plan = await artifact(targetDir, date, "plan.md", "Morning Plan");
  const share = await artifact(targetDir, date, "share.md", "Share");
  const report = await artifact(targetDir, date, path.join("..", "..", "reports", "daily", `${date}.md`), "Daily Report");
  const suggestions = await artifact(targetDir, date, path.join("..", "..", "suggestions", `${date}.md`), "Suggestions");
  const reflections = await artifactsIn(path.join(targetDir, "outputs", date, "reflections"));
  const logs = await artifactsIn(path.join(targetDir, "outputs", date, "project-logs"));
  const issues = await artifactsIn(path.join(targetDir, "outputs", date, "issues"));
  const tasks = await artifactsIn(path.join(targetDir, "outputs", date, "tasks"));
  const breakdowns = await artifactsIn(path.join(targetDir, "outputs", date, "breakdowns"));
  return `# PM Page: Today - ${date}

## Primary

${renderArtifactLinks([plan, share, report, suggestions].filter(Boolean) as Artifact[])}

## Quick Pages

- status: \`pm-agent page status --open\`
- plan: \`pm-agent page plan --open\`
- share: \`pm-agent page share --open\`
- report: \`pm-agent page report --open\`
- suggestions: \`pm-agent page suggestions --open\`
- menu: \`pm-agent page menu --open\`

## Projects

${repos.length > 0 ? repos.map((repo) => `- ${repo}: \`pm-agent page project ${repo} --open\``).join("\n") : "- none"}

## Reflections

${renderArtifactLinks(reflections)}

## Reflection Summary

${await renderReflectionSummaries(reflections)}

## Project Logs

${renderArtifactLinks(logs)}

## Issue Proposals

${renderArtifactLinks(issues)}

## Task Briefs

${renderArtifactLinks(tasks)}

## Breakdown Proposals

${renderArtifactLinks(breakdowns)}

## Next Commands

\`\`\`sh
pm-agent page today --open
pm-agent page menu --open
pm-agent page status --open
pm-agent page share --open
pm-agent page logs --open
pm-agent page issues --open
pm-agent page tasks --open
pm-agent log draft <repo> --note "..."
pm-agent log review <repo>
EDITOR=emacs pm-agent log edit <repo>
pm-agent reflect <repo>
pm-agent morning
\`\`\`
`;
}

async function renderReflectionSummaries(reflections: Artifact[]): Promise<string> {
  if (reflections.length === 0) return "- none";
  const summaries = await Promise.all(reflections.map(async (reflection) => {
    const markdown = await readFile(reflection.path, "utf8");
    const recommended = extractMarkdownSection(markdown, "Recommended Direction");
    const decisions = extractMarkdownSection(markdown, "Open Decisions");
    return `### ${reflection.title}

Recommended:
${recommended || "- none"}

Open decisions:
${decisions || "- none"}`;
  }));
  return summaries.join("\n\n");
}

async function renderStatusPage(targetDir: string, date: string): Promise<string> {
  const outputsDir = path.join(targetDir, "outputs", date);
  const outputArtifacts = await artifactsIn(outputsDir);
  const logs = await artifactsIn(path.join(outputsDir, "project-logs"));
  const reflections = await artifactsIn(path.join(outputsDir, "reflections"));
  const tasks = await artifactsIn(path.join(outputsDir, "tasks"));
  const breakdowns = await artifactsIn(path.join(outputsDir, "breakdowns"));
  const active = await readTextIfExists(path.join(targetDir, "tasks", "active.md"));
  const waiting = await readTextIfExists(path.join(targetDir, "tasks", "waiting.md"));
  const backlog = await readTextIfExists(path.join(targetDir, "tasks", "backlog.md"));
  const repositories = await readTextIfExists(path.join(targetDir, "links", "repositories.md"));
  return `# PM Page: Status - ${date}

## Artifact Counts

- top-level outputs: ${outputArtifacts.length}
- project logs: ${logs.length}
- reflections: ${reflections.length}
- task briefs: ${tasks.length}
- breakdown proposals: ${breakdowns.length}

## Ledger Tasks

### Active

${active?.trim() || "- none"}

### Waiting

${waiting?.trim() || "- none"}

### Backlog

${backlog?.trim() || "- none"}

## Registered Repositories

${repositories?.trim() || "- none"}

## Quick Switch

\`\`\`sh
pm-agent page menu --open
pm-agent page today --open
pm-agent page plan --open
pm-agent page share --open
pm-agent page logs --open
pm-agent page reflections --open
\`\`\`
`;
}

async function renderSingleArtifactPage(targetDir: string, date: string, title: string, candidates: Array<[string, string]>): Promise<string> {
  const found = await firstExistingArtifact(targetDir, date, candidates);
  return `# PM Page: ${title} - ${date}

${found ? renderArtifactEmbed(found) : `- no ${title.toLowerCase()} artifact found`}

## Related Commands

\`\`\`sh
pm-agent page menu --open
pm-agent page today --open
pm-agent page status --open
\`\`\`
`;
}

async function renderReflectionsPage(targetDir: string, date: string): Promise<string> {
  const reflections = await artifactsIn(path.join(targetDir, "outputs", date, "reflections"));
  return `# PM Page: Reflections - ${date}

${reflections.length > 0 ? reflections.map(renderArtifactEmbed).join("\n\n---\n\n") : "- no reflections yet"}
`;
}

async function renderRepositoriesPage(targetDir: string): Promise<string> {
  const links = await readTextIfExists(path.join(targetDir, "links", "repositories.md"));
  const context = await readTextIfExists(path.join(targetDir, "context", "repositories.md"));
  const active = await readTextIfExists(path.join(targetDir, "context", "active-repositories.md"));
  return `# PM Page: Repositories

## Active Repositories

${active?.trim() || "- none"}

## Links

${links?.trim() || "- none"}

## Context

${context?.trim() || "- none"}
`;
}

async function renderProjectPage(targetDir: string, date: string, repoId: string): Promise<string> {
  const log = await firstExistingArtifact(targetDir, date, [
    [`project-logs/${repoId}.md`, "Reviewed Project Log"],
    [`project-logs/${repoId}.draft.md`, "Project Log Draft"]
  ]);
  const reflection = await artifact(targetDir, date, `reflections/${repoId}.md`, "Reflection");
  const tasks = (await artifactsIn(path.join(targetDir, "outputs", date, "tasks"))).filter((item) => path.basename(item.path).startsWith(`${repoId}-`));
  const breakdowns = (await artifactsIn(path.join(targetDir, "outputs", date, "breakdowns"))).filter((item) => path.basename(item.path).startsWith(`${repoId}-`));
  return `# PM Page: Project - ${repoId}

## Current Log

${log ? renderArtifactEmbed(log) : "- no project log yet"}

## Reflection

${reflection ? renderArtifactEmbed(reflection) : "- no reflection yet"}

## Task Briefs

${renderArtifactLinks(tasks)}

## Breakdown Proposals

${renderArtifactLinks(breakdowns)}

## Next Commands

\`\`\`sh
pm-agent log draft ${repoId} --note "..."
pm-agent log review ${repoId}
EDITOR=emacs pm-agent log edit ${repoId}
pm-agent reflect ${repoId}
pm-agent page project ${repoId} --open
\`\`\`
`;
}

async function renderLogsPage(targetDir: string, date: string): Promise<string> {
  const logs = await artifactsIn(path.join(targetDir, "outputs", date, "project-logs"));
  return `# PM Page: Project Logs - ${date}

${logs.length > 0 ? logs.map(renderArtifactEmbed).join("\n\n---\n\n") : "- no project logs yet"}
`;
}

async function renderTasksPage(targetDir: string, date: string): Promise<string> {
  const tasks = await artifactsIn(path.join(targetDir, "outputs", date, "tasks"));
  return `# PM Page: Task Briefs - ${date}

${tasks.length > 0 ? tasks.map(renderArtifactEmbed).join("\n\n---\n\n") : "- no task briefs yet"}
`;
}

async function renderIssuesPage(targetDir: string, date: string): Promise<string> {
  const issues = await artifactsIn(path.join(targetDir, "outputs", date, "issues"));
  return `# PM Page: Issue Proposals - ${date}

${issues.length > 0 ? issues.map(renderArtifactEmbed).join("\n\n---\n\n") : "- no issue proposals yet"}
`;
}

async function renderBreakdownsPage(targetDir: string, date: string): Promise<string> {
  const breakdowns = await artifactsIn(path.join(targetDir, "outputs", date, "breakdowns"));
  return `# PM Page: Breakdowns - ${date}

${breakdowns.length > 0 ? breakdowns.map(renderArtifactEmbed).join("\n\n---\n\n") : "- no breakdown proposals yet"}
`;
}

async function artifact(targetDir: string, date: string, relativePath: string, title: string): Promise<Artifact | null> {
  const filePath = path.join(targetDir, "outputs", date, relativePath);
  if (!existsSync(filePath)) return null;
  return { title, path: filePath, content: await readFile(filePath, "utf8") };
}

async function firstExistingArtifact(targetDir: string, date: string, candidates: Array<[string, string]>): Promise<Artifact | null> {
  for (const [relativePath, title] of candidates) {
    const found = await artifact(targetDir, date, relativePath, title);
    if (found) return found;
  }
  return null;
}

async function artifactsIn(dir: string): Promise<Artifact[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(dir, entry.name))
    .sort();
  return Promise.all(files.map(async (filePath) => ({
    title: path.basename(filePath, ".md"),
    path: filePath,
    content: await readFile(filePath, "utf8")
  })));
}

async function listRepoIds(targetDir: string, date: string): Promise<string[]> {
  const repos = new Set<string>();
  const repositoriesMarkdown = await readTextIfExists(path.join(targetDir, "links", "repositories.md"));
  for (const repo of repositoriesMarkdown ? parseRepositoryLinks(repositoriesMarkdown) : []) {
    if (repo.id) repos.add(repo.id);
  }
  for (const artifact of await artifactsIn(path.join(targetDir, "outputs", date, "project-logs"))) {
    repos.add(path.basename(artifact.path).replace(/\.draft\.md$|\.md$/g, ""));
  }
  for (const artifact of await artifactsIn(path.join(targetDir, "outputs", date, "reflections"))) {
    repos.add(path.basename(artifact.path, ".md"));
  }
  return [...repos].sort();
}

async function preview(filePath: string, maxLines = 24): Promise<string> {
  const text = await readFile(filePath, "utf8");
  const lines = text.trim().split(/\r?\n/);
  return lines.slice(0, maxLines).join("\n");
}

function renderArtifactLinks(items: Artifact[]): string {
  if (items.length === 0) return "- none";
  return items.map((item) => `- [${item.title}](${relativeLink(item.path)})`).join("\n");
}

function renderArtifactEmbed(item: Artifact): string {
  return `## ${item.title}

Path: [${path.basename(item.path)}](${relativeLink(item.path)})

${item.content ?? ""}`;
}

function extractMarkdownSection(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return "";
  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    collected.push(line);
  }
  return collected.join("\n").trim();
}

function relativeLink(filePath: string): string {
  return filePath;
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function openExternalEditor(filePath: string): Promise<void> {
  const editor = process.env.EDITOR || process.env.VISUAL || "vi";
  const [command, ...args] = editor.split(/\s+/).filter(Boolean);
  if (!command) throw new Error("No editor configured. Set EDITOR=emacs, EDITOR=vim, or another editor command.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args, filePath], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Editor exited with code ${code ?? "unknown"}: ${command}`));
    });
  });
}
