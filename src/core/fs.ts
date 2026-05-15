import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export function resolveTarget(input?: string): string {
  return path.resolve(process.cwd(), input ?? ".");
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function readTextIfExists(filePath: string): Promise<string | null> {
  if (!existsSync(filePath)) return null;
  return readFile(filePath, "utf8");
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeTextIfMissing(filePath: string, content: string): Promise<void> {
  if (existsSync(filePath)) return;
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, "utf8");
}

export async function listMarkdownFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

export async function listRecentMarkdownFiles(dir: string, limit: number): Promise<string[]> {
  const files = (await listMarkdownFiles(dir)).filter((file) => /\d{4}-\d{2}-\d{2}\.md$/.test(file));
  return files.slice(-limit);
}
