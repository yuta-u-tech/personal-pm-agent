import { today } from "../core/date.js";
import { collectCommand } from "./collect.js";
import { morningPlanCommand } from "./planning-flow.js";
import { reportCommand } from "./report.js";
import { shareCommand } from "./share.js";
import { suggestCommand } from "./suggest.js";

export async function morningCommand(targetDir: string, options: { adapter?: string; date?: string } = {}): Promise<string> {
  const date = options.date ?? today();
  await collectCommand(targetDir, date);
  const report = await reportCommand(targetDir, { ...options, date });
  const share = await shareCommand(targetDir, { ...options, date });
  const suggestions = await suggestCommand(targetDir, { ...options, date });
  const plan = await morningPlanCommand(targetDir, { ...options, date });
  return [
    "Completed morning run:",
    `- Daily Report: ${report.markdownPath}`,
    `- Share: ${share.markdownPath}`,
    `- Suggestions: ${suggestions.markdownPath}`,
    "",
    plan
  ].join("\n");
}
