import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentAdapter } from "./agent-adapter.js";

test("AgentAdapter runs an external process and reads the generated JSON file", async () => {
  const ledgerDir = await mkdtemp(path.join(os.tmpdir(), "pm-agent-ledger-"));
  const outputDir = path.join(ledgerDir, "ai/outputs/2026-05-15");
  await mkdir(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, "pm-report.json");
  const adapter = new AgentAdapter("test-agent", {
    type: "agent",
    command: process.execPath,
    args: [
      "-e",
      "const fs=require('node:fs'); fs.writeFileSync(process.argv[1], JSON.stringify({date:'2026-05-15',summary:{},projects:[],today_focus:[],collaborator_actions:[],share_message:'ok',suggested_updates:[]}, null, 2));",
      "{outputPath}"
    ],
    promptMode: "stdin",
    allowedOutputs: ["ai/outputs/{date}/pm-report.json"]
  });

  const response = await adapter.generate({
    date: "2026-05-15",
    ledgerDir,
    contextPackPath: path.join(outputDir, "context-pack.json"),
    schemaPath: path.join(ledgerDir, "ai/schemas/pm-report.schema.json"),
    outputPath,
    prompt: "write report"
  });

  assert.equal(response.outputPath, outputPath);
  assert.match(await readFile(outputPath, "utf8"), /2026-05-15/);
});

test("AgentAdapter rejects output paths outside allowedOutputs", async () => {
  const ledgerDir = await mkdtemp(path.join(os.tmpdir(), "pm-agent-ledger-"));
  const outputPath = path.join(ledgerDir, "projects/pm-agent-blog.md");
  const adapter = new AgentAdapter("test-agent", {
    type: "agent",
    command: process.execPath,
    args: ["-e", ""],
    allowedOutputs: ["ai/outputs/{date}/pm-report.json"]
  });

  await assert.rejects(
    () =>
      adapter.generate({
        date: "2026-05-15",
        ledgerDir,
        contextPackPath: path.join(ledgerDir, "ai/outputs/2026-05-15/context-pack.json"),
        schemaPath: path.join(ledgerDir, "ai/schemas/pm-report.schema.json"),
        outputPath,
        prompt: "write report"
      }),
    /not allowed/
  );
});

