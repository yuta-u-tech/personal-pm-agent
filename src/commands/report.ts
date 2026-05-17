import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadConfig } from "../core/config.js";
import { today } from "../core/date.js";
import { readTextIfExists, writeJson } from "../core/fs.js";
import { createAdapter } from "../model/index.js";
import { buildRepairPrompt, buildReportPrompt } from "../report/prompt.js";
import { renderDailyReport } from "../report/renderer.js";
import { enrichTimeAnalysis } from "../report/time-analysis.js";
import { assertPMReport, validatePMReport } from "../report/validator.js";
import { collectCommand } from "./collect.js";

export type ReportCommandResult = {
  jsonPath: string;
  markdownPath: string;
};

export async function reportCommand(targetDir: string, options: { adapter?: string; date?: string } = {}): Promise<ReportCommandResult> {
  const date = options.date ?? today();
  const outputDir = path.join(targetDir, "ai/outputs", date);
  const contextPackPath = path.join(outputDir, "context-pack.json");
  const schemaPath = path.join(targetDir, "ai/schemas/pm-report.schema.json");
  const outputPath = path.join(outputDir, "pm-report.json");
  const markdownPath = path.join(targetDir, "reports/daily", `${date}.md`);

  if (!existsSync(contextPackPath)) {
    await collectCommand(targetDir, date);
  }

  const config = await loadConfig(targetDir);
  const adapter = createAdapter(config, options.adapter);
  const systemPrompt = (await readTextIfExists(path.join(targetDir, "ai/prompts/system.md"))) ?? "";
  const reportPrompt = (await readTextIfExists(path.join(targetDir, "ai/prompts/report.md"))) ?? "";
  const prompt = buildReportPrompt({
    date,
    contextPackPath,
    schemaPath,
    outputPath,
    systemPrompt,
    reportPrompt
  });

  await adapter.generate({
    date,
    ledgerDir: targetDir,
    contextPackPath,
    schemaPath,
    outputPath,
    prompt
  });

  const contextPack = JSON.parse(await readFile(contextPackPath, "utf8")) as unknown;
  let rawReport = enrichTimeAnalysis(JSON.parse(await readFile(outputPath, "utf8")) as unknown, contextPack);
  let validation = validatePMReport(rawReport);

  if (!validation.ok && adapter.name !== "mock") {
    await adapter.generate({
      date,
      ledgerDir: targetDir,
      contextPackPath,
      schemaPath,
      outputPath,
      prompt: buildRepairPrompt({ originalPrompt: prompt, outputPath, errors: validation.errors })
    });
    rawReport = enrichTimeAnalysis(JSON.parse(await readFile(outputPath, "utf8")) as unknown, contextPack);
    validation = validatePMReport(rawReport);
  }

  const report = assertPMReport(rawReport);
  await writeJson(outputPath, report);
  await mkdir(path.dirname(markdownPath), { recursive: true });
  await writeFile(markdownPath, renderDailyReport(report), "utf8");
  return { jsonPath: outputPath, markdownPath };
}
