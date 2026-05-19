import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { understandCommand } from "./understand.js";

const execFileAsync = promisify(execFile);

test("understand generates project knowledge without raw secret values", async () => {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), "pm-agent-understand-"));
  await execFileAsync("git", ["init"], { cwd: repoDir });
  await mkdir(path.join(repoDir, "src/config"), { recursive: true });

  await writeFile(
    path.join(repoDir, "README.md"),
    "# Demo App\n\nA small demo application for testing repository understanding.\n",
    "utf8"
  );
  await writeFile(
    path.join(repoDir, "package.json"),
    JSON.stringify({ scripts: { build: "tsc", test: "node --test" }, dependencies: { react: "latest" } }, null, 2),
    "utf8"
  );
  await writeFile(
    path.join(repoDir, "src/index.ts"),
    "import { env } from './config/env';\nexport function main() { return env.NODE_ENV; }\n",
    "utf8"
  );
  await writeFile(
    path.join(repoDir, "src/config/env.ts"),
    "export const env = { NODE_ENV: 'test', API_TOKEN: 'ghp_123456789012345678901234567890123456' };\n",
    "utf8"
  );
  await writeFile(path.join(repoDir, ".env.example"), "OPENAI_API_KEY=sk-123456789012345678901234567890\n", "utf8");
  await execFileAsync("git", ["add", "README.md", "package.json", "src/index.ts", "src/config/env.ts", ".env.example"], { cwd: repoDir });

  const message = await understandCommand(repoDir, { refresh: true });
  assert.match(message, /Analyzing repository/);
  assert.match(message, /Token Budget/);

  const cards = JSON.parse(await readFile(path.join(repoDir, ".pm-agent/catalog/file-cards.json"), "utf8"));
  assert.ok(cards.some((card: { path: string }) => card.path === "src/index.ts"));
  assert.ok(cards.some((card: { path: string; hash?: string; packageInfo?: unknown }) => card.path === "package.json" && card.hash && card.packageInfo));

  const graph = JSON.parse(await readFile(path.join(repoDir, ".pm-agent/graph/dependency-graph.json"), "utf8"));
  assert.ok(graph.edges.some((edge: { from: string; to: string }) => edge.from === "src/index.ts" && edge.to === "src/config/env.ts"));

  const safety = await readFile(path.join(repoDir, ".pm-agent/safety/safety-report.md"), "utf8");
  assert.match(safety, /src\/config\/env\.ts/);
  assert.match(safety, /\.env\.example/);
  assert.match(safety, /Redacted/);

  const catalogText = await readFile(path.join(repoDir, ".pm-agent/catalog/file-cards.json"), "utf8");
  assert.doesNotMatch(catalogText, /ghp_123456789012345678901234567890123456/);
  assert.doesNotMatch(catalogText, /sk-123456789012345678901234567890/);

  const budget = await readFile(path.join(repoDir, ".pm-agent/cache/token-budget.json"), "utf8");
  assert.match(budget, /fileCards/);
  assert.match(budget, /deepReadFiles/);

  const secondMessage = await understandCommand(repoDir);
  assert.match(secondMessage, /file cards reused: [1-9]/);
});
