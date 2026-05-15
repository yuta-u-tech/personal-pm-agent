import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { today } from "../core/date.js";
import { renderSuggestions } from "../report/renderer.js";
import { assertPMReport } from "../report/validator.js";
import { reportCommand } from "./report.js";

export async function suggestCommand(targetDir: string, options: { adapter?: string; date?: string } = {}): Promise<void> {
  const date = options.date ?? today();
  const reportPath = path.join(targetDir, "ai/outputs", date, "pm-report.json");

  if (!(await exists(reportPath))) {
    await reportCommand(targetDir, options);
  }

  const report = assertPMReport(JSON.parse(await readFile(reportPath, "utf8")));
  await mkdir(path.join(targetDir, "suggestions"), { recursive: true });
  await writeFile(path.join(targetDir, "suggestions", `${date}.md`), renderSuggestions(report), "utf8");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
}

