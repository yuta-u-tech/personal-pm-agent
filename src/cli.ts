#!/usr/bin/env node
import { collectCommand } from "./commands/collect.js";
import { initCommand } from "./commands/init.js";
import { resolveTarget } from "./core/fs.js";

async function main(): Promise<void> {
  const [, , command, target] = process.argv;
  const targetDir = resolveTarget(target);

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

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exitCode = 1;
}

function printHelp(): void {
  console.log(`pm-agent

Usage:
  pm-agent init [ledger-dir]
  pm-agent collect [ledger-dir]
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

