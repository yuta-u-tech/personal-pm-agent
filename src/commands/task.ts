import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const TASK_LISTS = ["active", "waiting", "delegated", "backlog", "done"] as const;
type TaskList = (typeof TASK_LISTS)[number];

export type TaskCommandOptions = {
  list?: string;
  title?: string;
  from?: string;
  to?: string;
};

export async function taskCommand(
  targetDir: string,
  action: string | undefined,
  options: TaskCommandOptions
): Promise<string> {
  if (action === "add") {
    return addTask(targetDir, assertTaskList(options.list ?? "active"), requireOption(options.title, "--title"));
  }

  if (action === "move") {
    return moveTask(
      targetDir,
      assertTaskList(requireOption(options.from, "--from")),
      assertTaskList(requireOption(options.to, "--to")),
      requireOption(options.title, "--title")
    );
  }

  if (action === "list") {
    return listTasks(targetDir, options.list ? assertTaskList(options.list) : undefined);
  }

  throw new Error(`Unknown task action: ${action ?? "(missing)"}. Expected add, move, or list.`);
}

async function addTask(targetDir: string, list: TaskList, title: string): Promise<string> {
  const file = taskFile(targetDir, list);
  const markdown = await readTaskFile(file, list);
  if (findTaskLine(markdown, title)) {
    throw new Error(`Task already exists in ${list}: ${title}`);
  }

  const marker = list === "done" ? "x" : " ";
  const next = appendChecklistItem(markdown, `- [${marker}] ${title}`);
  await writeFile(file, next, "utf8");
  return `Added task to ${list}: ${title}`;
}

async function moveTask(targetDir: string, from: TaskList, to: TaskList, title: string): Promise<string> {
  if (from === to) {
    throw new Error("--from and --to must be different lists.");
  }

  const fromFile = taskFile(targetDir, from);
  const toFile = taskFile(targetDir, to);
  const fromMarkdown = await readTaskFile(fromFile, from);
  const toMarkdown = await readTaskFile(toFile, to);
  const found = findTaskLine(fromMarkdown, title);

  if (!found) {
    throw new Error(`Task not found in ${from}: ${title}`);
  }
  if (findTaskLine(toMarkdown, title)) {
    throw new Error(`Task already exists in ${to}: ${title}`);
  }

  const nextFrom = removeTaskLine(fromMarkdown, found.line);
  const marker = to === "done" ? "x" : " ";
  const nextTo = appendChecklistItem(toMarkdown, `- [${marker}] ${title}`);

  await writeFile(fromFile, nextFrom, "utf8");
  await writeFile(toFile, nextTo, "utf8");
  return `Moved task from ${from} to ${to}: ${title}`;
}

async function listTasks(targetDir: string, list?: TaskList): Promise<string> {
  const lists = list ? [list] : [...TASK_LISTS];
  const sections: string[] = [];

  for (const taskList of lists) {
    const file = taskFile(targetDir, taskList);
    const markdown = await readTaskFile(file, taskList);
    const tasks = markdown
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^- \[[ xX]\]/.test(line));
    sections.push(`## ${taskList}\n${tasks.length > 0 ? tasks.join("\n") : "- (none)"}`);
  }

  return sections.join("\n\n");
}

function findTaskLine(markdown: string, title: string): { line: string; index: number } | null {
  const lines = markdown.split(/\r?\n/);
  const normalizedTitle = normalizeTaskTitle(title);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^- \[[ xX]\]/.test(line.trim())) continue;
    if (normalizeTaskTitle(line) === normalizedTitle) {
      return { line, index };
    }
  }

  return null;
}

function removeTaskLine(markdown: string, lineToRemove: string): string {
  const lines = markdown.split(/\r?\n/);
  const index = lines.findIndex((line) => line === lineToRemove);
  if (index === -1) return markdown;
  lines.splice(index, 1);
  return ensureTrailingNewline(lines.join("\n").replace(/\n{3,}/g, "\n\n"));
}

function appendChecklistItem(markdown: string, item: string): string {
  const trimmed = markdown.trimEnd();
  return `${trimmed}${trimmed ? "\n" : ""}${item}\n`;
}

async function readTaskFile(file: string, list: TaskList): Promise<string> {
  if (!existsSync(file)) {
    return `# ${titleForList(list)}\n\n`;
  }
  return readFile(file, "utf8");
}

function normalizeTaskTitle(value: string): string {
  return value.replace(/^- \[[ xX]\]\s*/, "").trim();
}

function taskFile(targetDir: string, list: TaskList): string {
  return path.join(targetDir, "tasks", `${list}.md`);
}

function assertTaskList(value: string): TaskList {
  if (TASK_LISTS.includes(value as TaskList)) return value as TaskList;
  throw new Error(`Invalid task list: ${value}. Expected one of ${TASK_LISTS.join(", ")}.`);
}

function requireOption(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing required option: ${name}`);
  return value;
}

function titleForList(list: TaskList): string {
  return `${list[0].toUpperCase()}${list.slice(1)} Tasks`;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

