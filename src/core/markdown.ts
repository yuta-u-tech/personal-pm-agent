import matter from "gray-matter";

export function parseFrontmatter(markdown: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const parsed = matter(markdown);
  return {
    frontmatter: parsed.data,
    body: parsed.content.trim()
  };
}

export function extractSection(markdown: string, heading: string): string {
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

export function extractChecklist(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^- \[[ xX]\]/.test(line))
    .map((line) => line.replace(/^- \[[ xX]\]\s*/, "").trim());
}

export function extractBullets(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /, "").trim());
}

export function parseRepositoryLinks(markdown: string): Array<Record<string, string>> {
  const repos: Array<Record<string, string>> = [];
  let current: Record<string, string> | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const idMatch = line.match(/^- id:\s*(.+)$/);
    if (idMatch) {
      if (current) repos.push(current);
      current = { id: idMatch[1].trim() };
      continue;
    }

    const keyMatch = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (current && keyMatch) {
      current[keyMatch[1]] = keyMatch[2].trim();
    }
  }

  if (current) repos.push(current);
  return repos;
}
