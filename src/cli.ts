#!/usr/bin/env node
import { collectCommand } from "./commands/collect.js";
import { initCommand } from "./commands/init.js";
import { morningCommand } from "./commands/morning.js";
import { reportCommand } from "./commands/report.js";
import { shareCommand } from "./commands/share.js";
import { suggestCommand } from "./commands/suggest.js";
import { resolveTarget } from "./core/fs.js";

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  const parsed = parseArgs(args);
  const targetDir = resolveTarget(parsed.target);

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "init") {
    await initCommand(targetDir);
    console.log(`Initialized progress ledger: ${targetDir}`);
    return;
  }

  if (command === "collect") {
    await collectCommand(targetDir);
    console.log(`Collected context: ${targetDir}`);
    return;
  }

  if (command === "report") {
    await reportCommand(targetDir, parsed.options);
    console.log(`Generated PM report: ${targetDir}`);
    return;
  }

  if (command === "share") {
    await shareCommand(targetDir, parsed.options);
    console.log(`Generated share report: ${targetDir}`);
    return;
  }

  if (command === "suggest") {
    await suggestCommand(targetDir, parsed.options);
    console.log(`Generated suggestions: ${targetDir}`);
    return;
  }

  if (command === "morning") {
    await morningCommand(targetDir, parsed.options);
    console.log(`Completed morning run: ${targetDir}`);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exitCode = 1;
}

function printHelp(): void {
  console.log(`pm-agent

Usage:
  pm-agent init [ledger-dir]
  pm-agent collect [ledger-dir]
  pm-agent report [ledger-dir] [--adapter mock|background-agent]
  pm-agent share [ledger-dir]
  pm-agent suggest [ledger-dir]
  pm-agent morning [ledger-dir] [--adapter mock|background-agent]
`);
}

function parseArgs(args: string[]): { target?: string; options: { adapter?: string; date?: string } } {
  const options: { adapter?: string; date?: string } = {};
  let target: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--adapter") {
      options.adapter = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--date") {
      options.date = args[index + 1];
      index += 1;
      continue;
    }
    if (!target) target = arg;
  }

  return { target, options };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
