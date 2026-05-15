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
    task_time_analysis: {
      total_estimated_minutes: 0,
      total_actual_minutes: 0,
      variance_minutes: 0,
      oversized_tasks: [],
      categories: [],
      daily_notes: "見積もりなし"
    },
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
    task_time_analysis: {
      total_estimated_minutes: 0,
      total_actual_minutes: 0,
      variance_minutes: 0,
      oversized_tasks: [],
      categories: [],
      daily_notes: "見積もりなし"
    },
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
    task_time_analysis: {
      total_estimated_minutes: 0,
      total_actual_minutes: 0,
      variance_minutes: 0,
      oversized_tasks: [],
      categories: [],
      daily_notes: "見積もりなし"
    },
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

test("validatePMReport requires time estimates for focus and split tasks", () => {
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
    today_focus: [
      {
        priority: 1,
        action: "大きいタスク",
        reason: "確認するため"
      }
    ],
    collaborator_actions: [],
    task_reframes: [
      {
        project_id: "pm-agent-blog",
        original_task: "大きいタスク",
        split_tasks: [
          {
            title: "分割タスク",
            owner: "yuta",
            type: "planning"
          }
        ]
      }
    ],
    task_time_analysis: {
      total_estimated_minutes: 0,
      total_actual_minutes: 0,
      variance_minutes: 0,
      oversized_tasks: [],
      categories: [],
      daily_notes: "見積もりなし"
    },
    share_message: "ok",
    suggested_updates: []
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /estimated_minutes/);
});
