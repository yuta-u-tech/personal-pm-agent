import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AdapterConfig } from "../core/config.js";
import type { ModelAdapter, ModelRequest, ModelResponse } from "./types.js";

export class AgentAdapter implements ModelAdapter {
  name: string;
  private config: Extract<AdapterConfig, { type: "agent" }>;

  constructor(name: string, config: Extract<AdapterConfig, { type: "agent" }>) {
    this.name = name;
    this.config = config;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const runDir = path.dirname(request.outputPath);
    await mkdir(runDir, { recursive: true });
    this.assertAllowedOutput(request);

    const promptPath = path.join(runDir, "agent-prompt.md");
    const logPath = path.join(runDir, "agent-run.log");
    await writeFile(promptPath, request.prompt, "utf8");

    const args = (this.config.args ?? []).map((arg) =>
      arg
        .replaceAll("{prompt}", request.prompt)
        .replaceAll("{promptFile}", promptPath)
        .replaceAll("{outputPath}", request.outputPath)
        .replaceAll("{contextPackPath}", request.contextPackPath)
        .replaceAll("{schemaPath}", request.schemaPath)
        .replaceAll("{ledgerDir}", request.ledgerDir)
        .replaceAll("{date}", request.date)
    );

    const result = await runProcess({
      command: this.config.command,
      args,
      cwd: request.ledgerDir,
      stdin: this.config.promptMode === "stdin" ? request.prompt : undefined,
      timeoutMs: request.timeoutMs ?? this.config.timeoutMs ?? 300_000
    });

    await writeFile(logPath, result.log, "utf8");
    if (result.exitCode !== 0) {
      throw new Error(`Agent command failed with exit code ${result.exitCode}. See ${logPath}`);
    }

    const text = await readFile(request.outputPath, "utf8");
    return {
      text,
      json: JSON.parse(text),
      raw: {
        exitCode: result.exitCode,
        logPath,
        promptPath
      },
      outputPath: request.outputPath
    };
  }

  private assertAllowedOutput(request: ModelRequest): void {
    const allowed = this.config.allowedOutputs ?? [];
    if (allowed.length === 0) return;

    const relativeOutput = path.relative(request.ledgerDir, request.outputPath);
    const matched = allowed.some((pattern) => matchAllowedPattern(pattern, relativeOutput, request.date));
    if (!matched) {
      throw new Error(`Agent output is not allowed: ${relativeOutput}`);
    }
  }
}

function matchAllowedPattern(pattern: string, relativePath: string, date: string): boolean {
  const normalizedPattern = pattern.replaceAll("{date}", date).split(path.sep).join("/");
  const normalizedPath = relativePath.split(path.sep).join("/");
  return normalizedPath === normalizedPattern;
}

async function runProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
  timeoutMs: number;
}): Promise<{ exitCode: number | null; log: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let log = `$ ${input.command} ${input.args.join(" ")}\n`;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Agent command timed out after ${input.timeoutMs}ms`));
    }, input.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      log += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      log += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, log });
    });

    if (input.stdin) {
      child.stdin.write(input.stdin);
    }
    child.stdin.end();
  });
}
