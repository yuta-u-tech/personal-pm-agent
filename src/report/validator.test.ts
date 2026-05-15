import test from "node:test";
import assert from "node:assert/strict";
import { validatePMReport } from "./validator.js";

test("validatePMReport accepts a minimal valid report", () => {
  const result = validatePMReport({
    date: "2026-05-15",
    summary: {
      total_projects: 1,
      healthy: 0,
      needs_attention: 1,
      blocked: 0,
      message: "今日の最優先を確認する。"
    },
    projects: [
      {
        id: "pm-agent-blog",
        name: "PMエージェント開発記事",
        status: "in_progress",
        risk: "medium",
        progress: "設計中",
        blockers: [],
        collaborators: [],
        next_actions: []
      }
    ],
    blockers: [],
    today_focus: [],
    collaborator_actions: [],
    task_reframes: [],
    share_message: "今日の進捗共有です。",
    suggested_updates: []
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("validatePMReport rejects an empty share message", () => {
  const result = validatePMReport({
    date: "2026-05-15",
    summary: {
      total_projects: 0,
      healthy: 0,
      needs_attention: 0,
      blocked: 0,
      message: "なし"
    },
    projects: [],
    blockers: [],
    today_focus: [],
    collaborator_actions: [],
    task_reframes: [],
    share_message: "",
    suggested_updates: []
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /share_message/);
});

test("validatePMReport rejects suggested update key drift", () => {
  const result = validatePMReport({
    date: "2026-05-15",
    summary: {
      total_projects: 0,
      healthy: 0,
      needs_attention: 0,
      blocked: 0,
      message: "なし"
    },
    projects: [],
    blockers: [],
    today_focus: [],
    collaborator_actions: [],
    task_reframes: [],
    share_message: "ok",
    suggested_updates: [
      {
        target: "tasks/active",
        type: "add",
        suggestion: "タスクを追加する",
        reason: "必要なため"
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /suggested_updates\[0\]\.file/);
});
