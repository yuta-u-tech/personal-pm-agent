import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { today } from "../core/date.js";
import { renderSuggestions } from "../report/renderer.js";
import { assertPMReport } from "../report/validator.js";
import { reportCommand } from "./report.js";

export type SuggestCommandResult = {
  markdownPath: string;
};

export async function suggestCommand(targetDir: string, options: { adapter?: string; date?: string } = {}): Promise<SuggestCommandResult> {
  const date = options.date ?? today();
  const reportPath = path.join(targetDir, "ai/outputs", date, "pm-report.json");
  const markdownPath = path.join(targetDir, "suggestions", `${date}.md`);

  if (!(await exists(reportPath))) {
    await reportCommand(targetDir, options);
  }

  const report = assertPMReport(JSON.parse(await readFile(reportPath, "utf8")));
  await mkdir(path.dirname(markdownPath), { recursive: true });
  await writeFile(markdownPath, renderSuggestions(report), "utf8");
  return { markdownPath };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
}
