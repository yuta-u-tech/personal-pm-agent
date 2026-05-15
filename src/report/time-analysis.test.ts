import test from "node:test";
import assert from "node:assert/strict";
import { enrichTimeAnalysis } from "./time-analysis.js";
import { validatePMReport } from "./validator.js";

test("enrichTimeAnalysis fills missing estimates and analysis", () => {
  const report = enrichTimeAnalysis({
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
        action: "PMレポートのOutput Contractを確定する",
        reason: "必要なため"
      }
    ],
    collaborator_actions: [],
    task_reframes: [
      {
        project_id: "pm-agent-blog",
        original_task: "記事を書く",
        split_tasks: [
          {
            title: "記事内で説明するOutput Contractの要点を3点に絞る",
            owner: "yuta",
            type: "writing"
          }
        ]
      }
    ],
    share_message: "ok",
    suggested_updates: []
  });

  const result = validatePMReport(report);
  assert.equal(result.ok, true);
});

test("enrichTimeAnalysis normalizes project blocker and next action shorthand", () => {
  const report = enrichTimeAnalysis({
    date: "2026-05-15",
    summary: {
      total_projects: 1,
      healthy: 0,
      needs_attention: 1,
      blocked: 0,
      message: "なし"
    },
    projects: [
      {
        id: "pm-agent-blog",
        name: "PMエージェント開発記事",
        status: "in_progress",
        risk: "medium",
        progress: "進行中",
        blockers: ["MVP範囲が未確定"],
        next_actions: ["Output Contractを確定する"],
        collaborators: [{ name: "レビュアーA", role: "reviewer", focus: "技術レビュー" }]
      }
    ],
    blockers: [],
    today_focus: [],
    collaborator_actions: [],
    task_reframes: [],
    share_message: "ok",
    suggested_updates: []
  });

  const result = validatePMReport(report);
  assert.equal(result.ok, true);
});

test("enrichTimeAnalysis summarizes actual minutes from daily logs", () => {
  const report = enrichTimeAnalysis(
    {
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
      suggested_updates: []
    },
    {
      recent_logs: [
        {
          body: `## Time Entries

- task: Output Contract整理
  category: planning
  actual_minutes: 90
- task: Adapter検証
  category: implementation
  actual_minutes: 120`
        }
      ]
    }
  ) as { task_time_analysis: { total_actual_minutes: number; categories: Array<{ category: string; actual_minutes: number }> } };

  assert.equal(report.task_time_analysis.total_actual_minutes, 210);
  assert.equal(report.task_time_analysis.categories.find((category) => category.category === "planning")?.actual_minutes, 90);
});
