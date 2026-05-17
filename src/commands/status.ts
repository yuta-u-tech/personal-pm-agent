import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { today } from "../core/date.js";

export async function statusCommand(targetDir: string, date = today()): Promise<string> {
  const reportPath = path.join(targetDir, "ai/outputs", date, "pm-report.json");
  const contextPath = path.join(targetDir, "ai/outputs", date, "context-pack.json");

  if (!existsSync(reportPath)) {
    if (!existsSync(contextPath)) {
      return `No report or context found for ${date}. Run /morning or /collect.`;
    }
    return `Context exists for ${date}, but pm-report.json is missing. Run /report or /morning.`;
  }

  const report = JSON.parse(await readFile(reportPath, "utf8")) as {
    summary?: { message?: string };
    today_focus?: Array<{ priority?: number; action?: string; estimated_minutes?: number }>;
    task_time_analysis?: { total_estimated_minutes?: number; total_actual_minutes?: number; variance_minutes?: number };
  };

  const focus = (report.today_focus ?? [])
    .slice(0, 5)
    .map((item) => `${item.priority ?? "-"}。 ${item.action ?? "(no action)"}${item.estimated_minutes ? ` (${item.estimated_minutes}分)` : ""}`)
    .join("\n");
  const time = report.task_time_analysis
    ? `Estimate: ${report.task_time_analysis.total_estimated_minutes ?? 0}分 / Actual: ${report.task_time_analysis.total_actual_minutes ?? 0}分 / Variance: ${report.task_time_analysis.variance_minutes ?? 0}分`
    : "Time analysis: unavailable";

  return [`# Status ${date}`, report.summary?.message ?? "No summary.", "", time, "", "Today's Focus", focus || "- none"].join("\n");
}

