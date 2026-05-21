import { morningPlanCommand } from "./planning-flow.js";

export async function morningCommand(targetDir: string, options: { adapter?: string; date?: string } = {}): Promise<string> {
  return morningPlanCommand(targetDir, options);
}
