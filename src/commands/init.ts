import path from "node:path";
import { ensureDir, writeTextIfMissing } from "../core/fs.js";

const DIRECTORIES = [
  "projects",
  "tasks",
  "logs/daily",
  "logs/weekly",
  "context",
  "links",
  "reports/daily",
  "reports/share",
  "reports/weekly",
  "suggestions",
  "ai/prompts",
  "ai/schemas",
  "ai/outputs"
];

export async function initCommand(targetDir: string): Promise<void> {
  await ensureDir(targetDir);
  await Promise.all(DIRECTORIES.map((dir) => ensureDir(path.join(targetDir, dir))));

  await Promise.all([
    writeTextIfMissing(path.join(targetDir, "README.md"), readme()),
    writeTextIfMissing(path.join(targetDir, "pm-agent.config.json"), config()),
    writeTextIfMissing(path.join(targetDir, "tasks/active.md"), "# Active Tasks\n\n- [ ] PM report output contractを確定する\n"),
    writeTextIfMissing(path.join(targetDir, "tasks/waiting.md"), "# Waiting Tasks\n\n"),
    writeTextIfMissing(path.join(targetDir, "tasks/delegated.md"), "# Delegated Tasks\n\n"),
    writeTextIfMissing(path.join(targetDir, "tasks/backlog.md"), "# Backlog\n\n"),
    writeTextIfMissing(path.join(targetDir, "tasks/done.md"), "# Done\n\n"),
    writeTextIfMissing(path.join(targetDir, "context/people.md"), "# People\n\n"),
    writeTextIfMissing(path.join(targetDir, "context/priorities.md"), "# Priorities\n\n"),
    writeTextIfMissing(path.join(targetDir, "links/repositories.md"), "# Repositories\n\n"),
    writeTextIfMissing(path.join(targetDir, "ai/schemas/pm-report.schema.json"), pmReportSchema())
  ]);
}

function readme(): string {
  return `# Progress Ledger

Private project progress ledger for Personal PM Agent.

This repository stores project goals, current status, logs, collaborators, generated reports, and AI outputs.
`;
}

function config(): string {
  return `{
  "model": {
    "defaultAdapter": "mock",
    "adapters": {
      "mock": {
        "type": "mock"
      },
      "background-agent": {
        "type": "agent",
        "command": "codex",
        "args": ["exec", "--cd", "{ledgerDir}", "--sandbox", "workspace-write", "-"],
        "promptMode": "stdin",
        "timeoutMs": 300000,
        "allowedOutputs": [
          "ai/outputs/{date}/pm-report.json"
        ]
      }
    }
  }
}
`;
}

function pmReportSchema(): string {
  return `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "PMReport",
  "type": "object",
  "required": ["date", "summary", "projects", "blockers", "today_focus", "collaborator_actions", "task_reframes", "share_message", "suggested_updates"],
  "properties": {
    "date": { "type": "string", "minLength": 1 },
    "summary": {
      "type": "object",
      "required": ["total_projects", "healthy", "needs_attention", "blocked", "message"],
      "properties": {
        "total_projects": { "type": "number" },
        "healthy": { "type": "number" },
        "needs_attention": { "type": "number" },
        "blocked": { "type": "number" },
        "message": { "type": "string", "minLength": 1 }
      },
      "additionalProperties": true
    },
    "projects": { "type": "array" },
    "blockers": { "type": "array" },
    "today_focus": { "type": "array" },
    "collaborator_actions": { "type": "array" },
    "task_reframes": { "type": "array" },
    "share_message": { "type": "string", "minLength": 1 },
    "suggested_updates": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["file", "type", "suggestion", "reason"],
        "properties": {
          "file": { "type": "string", "minLength": 1 },
          "type": { "type": "string", "minLength": 1 },
          "suggestion": { "type": "string", "minLength": 1 },
          "reason": { "type": "string", "minLength": 1 }
        },
        "additionalProperties": true
      }
    }
  },
  "additionalProperties": true
}
`;
}
