import path from "node:path";
import { basename } from "node:path";
import { collectGitSummary } from "../core/git.js";
import { listMarkdownFiles, listRecentMarkdownFiles, readTextIfExists, writeJson } from "../core/fs.js";
import { extractBullets, extractChecklist, extractSection, parseFrontmatter, parseRepositoryLinks } from "../core/markdown.js";
import type { CollectedItem, ContextPack } from "../core/types.js";

export async function collectCommand(targetDir: string, date = today()): Promise<void> {
  const rawItems: CollectedItem[] = [];

  const projectFiles = await listMarkdownFiles(path.join(targetDir, "projects"));
  const projects = await Promise.all(projectFiles.map(async (file) => collectProject(file, rawItems)));

  const tasks = await collectTasks(targetDir, rawItems);
  const recentLogs = await collectRecentLogs(targetDir, rawItems);
  const people = await collectPeople(targetDir, rawItems);
  const repositories = await collectRepositories(targetDir, rawItems);
  const previousReport = await collectPreviousReport(targetDir, date, rawItems);

  const pack: ContextPack = {
    date,
    workspace: {
      name: basename(targetDir),
      path: targetDir
    },
    projects,
    tasks,
    people,
    recent_logs: recentLogs,
    repositories,
    previous_report: previousReport,
    collected_items: rawItems.length
  };

  const outputDir = path.join(targetDir, "ai/outputs", date);
  await writeJson(path.join(outputDir, "context-raw.json"), {
    date,
    items: rawItems
  });
  await writeJson(path.join(outputDir, "context-pack.json"), pack);
}

async function collectProject(file: string, rawItems: CollectedItem[]): Promise<Record<string, unknown>> {
  const markdown = (await readTextIfExists(file)) ?? "";
  const parsed = parseFrontmatter(markdown);
  const body = parsed.body;
  const project: Record<string, unknown> = {
    ...parsed.frontmatter,
    source: path.relative(process.cwd(), file),
    goal: extractSection(body, "Goal"),
    current_status: extractSection(body, "Current Status"),
    collaborators: extractSection(body, "Collaborators"),
    active_tasks: extractChecklist(extractSection(body, "Active Tasks")),
    blockers: extractBullets(extractSection(body, "Blockers")),
    next_actions: extractBullets(extractSection(body, "Next Actions")),
    related_repositories: extractBullets(extractSection(body, "Related Repositories")),
    last_updated: extractSection(body, "Last Updated")
  };

  rawItems.push({
    source: file,
    type: "project",
    title: String(project.name ?? path.basename(file, ".md")),
    body,
    metadata: parsed.frontmatter
  });

  return project;
}

async function collectTasks(targetDir: string, rawItems: CollectedItem[]): Promise<Array<Record<string, unknown>>> {
  const taskFiles = ["active", "waiting", "delegated", "backlog", "done"];
  const tasks: Array<Record<string, unknown>> = [];

  for (const name of taskFiles) {
    const file = path.join(targetDir, "tasks", `${name}.md`);
    const markdown = await readTextIfExists(file);
    if (!markdown) continue;

    const items = extractChecklist(markdown);
    tasks.push({ list: name, items, body: markdown.trim() });
    rawItems.push({
      source: file,
      type: "task",
      title: name,
      body: markdown.trim(),
      metadata: { count: items.length }
    });
  }

  return tasks;
}

async function collectRecentLogs(targetDir: string, rawItems: CollectedItem[]): Promise<Array<Record<string, unknown>>> {
  const files = await listRecentMarkdownFiles(path.join(targetDir, "logs/daily"), 7);
  const logs: Array<Record<string, unknown>> = [];

  for (const file of files) {
    const body = (await readTextIfExists(file))?.trim() ?? "";
    const date = path.basename(file, ".md");
    logs.push({ date, body });
    rawItems.push({ source: file, type: "note", title: `daily log ${date}`, body, timestamp: date });
  }

  return logs;
}

async function collectPeople(targetDir: string, rawItems: CollectedItem[]): Promise<Array<Record<string, unknown>>> {
  const file = path.join(targetDir, "context/people.md");
  const body = (await readTextIfExists(file))?.trim() ?? "";
  if (!body) return [];

  rawItems.push({ source: file, type: "person", title: "people", body });
  return body
    .split(/\n## /)
    .filter((section) => section.trim() && !section.startsWith("# People"))
    .map((section) => {
      const [nameLine, ...rest] = section.split(/\r?\n/);
      return {
        name: nameLine.replace(/^## /, "").trim(),
        body: rest.join("\n").trim()
      };
    });
}

async function collectRepositories(targetDir: string, rawItems: CollectedItem[]): Promise<Array<Record<string, unknown>>> {
  const file = path.join(targetDir, "links/repositories.md");
  const markdown = (await readTextIfExists(file)) ?? "";
  if (!markdown.trim()) return [];

  const links = parseRepositoryLinks(markdown);
  const repositories: Array<Record<string, unknown> & { id?: string; path?: string; git: Record<string, unknown> | null }> = await Promise.all(
    links.map(async (repo) => ({
      ...repo,
      git: repo.path ? await collectGitSummary(repo.path) : null
    }))
  );

  rawItems.push({
    source: file,
    type: "repository",
    title: "repositories",
    body: markdown.trim(),
    metadata: { count: repositories.length }
  });

  for (const repo of repositories) {
    rawItems.push({
      source: String(repo.path),
      type: "git",
      title: String(repo.id),
      body: JSON.stringify(repo.git, null, 2),
      metadata: repo
    });
  }

  return repositories;
}

async function collectPreviousReport(
  targetDir: string,
  date: string,
  rawItems: CollectedItem[]
): Promise<Record<string, unknown> | null> {
  const previous = await readPreviousJson(targetDir, date);
  if (!previous) return null;

  rawItems.push({
    source: previous.source,
    type: "previous_report",
    title: "previous pm report",
    body: JSON.stringify(previous.report, null, 2)
  });
  return previous.report;
}

async function readPreviousJson(
  targetDir: string,
  date: string
): Promise<{ source: string; report: Record<string, unknown> } | null> {
  const outputsPath = path.join(targetDir, "ai/outputs");
  const { readdir } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  if (!existsSync(outputsPath)) return null;

  const dirs = (await readdir(outputsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name < date)
    .map((entry) => entry.name)
    .sort();

  for (const dir of dirs.reverse()) {
    const file = path.join(outputsPath, dir, "pm-report.json");
    const text = await readTextIfExists(file);
    if (!text) continue;
    try {
      return { source: file, report: JSON.parse(text) as Record<string, unknown> };
    } catch {
      continue;
    }
  }

  return null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
