import { today } from "../core/date.js";
import { collectCommand } from "./collect.js";
import { reportCommand } from "./report.js";
import { shareCommand } from "./share.js";
import { suggestCommand } from "./suggest.js";

export async function morningCommand(targetDir: string, options: { adapter?: string; date?: string } = {}): Promise<void> {
  const date = options.date ?? today();
  await collectCommand(targetDir, date);
  await reportCommand(targetDir, { ...options, date });
  await shareCommand(targetDir, { ...options, date });
  await suggestCommand(targetDir, { ...options, date });
}

