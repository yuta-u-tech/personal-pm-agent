import type { PMReport } from "./types.js";

export function renderDailyReport(report: PMReport): string {
  const projects = report.projects
    .map(
      (project) => `### ${project.name}

Status: ${project.status}
Risk: ${project.risk}

#### 現状

${project.progress || "記録なし"}

#### 詰まり

${project.blockers.length > 0 ? project.blockers.map((blocker) => `- ${blocker.title}: ${blocker.reason}`).join("\n") : "- なし"}

#### 次アクション

${project.next_actions.map((action) => `${action.priority}. ${action.title} (${action.owner})`).join("\n")}
`
    )
    .join("\n");
  const collaboratorActions = report.collaborator_actions
    .map((action) => `- ${action.collaborator}: ${action.action}\n  - ${action.reason}`)
    .join("\n");
  const taskReframes = report.task_reframes
    .map(
      (reframe) => `### ${reframe.original_task}

${reframe.split_tasks.map((task) => `- [ ] ${task.title} (${task.owner}, ${task.type}, ${task.estimated_minutes}分)`).join("\n")}
`
    )
    .join("\n");
  const timeCategories = report.task_time_analysis.categories
    .map((category) => `- ${category.category}: 見積 ${category.estimated_minutes}分 / 実績 ${category.actual_minutes}分 / ${category.task_count}件\n  - ${category.notes}`)
    .join("\n");
  const oversizedTasks = report.task_time_analysis.oversized_tasks
    .map(
      (task) => `- ${task.title}: ${task.estimated_minutes}分
  - ${task.reason}
  - split: ${task.suggested_split.join(" / ")}`
    )
    .join("\n");
  const suggestedUpdates = report.suggested_updates
    .map((update) => `- ${update.file}: ${update.suggestion}`)
    .join("\n");

  return `# PM Report - ${report.date}

## Executive Summary

${report.summary.message}

- 順調: ${report.summary.healthy}件
- 注意: ${report.summary.needs_attention}件
- 停滞: ${report.summary.blocked}件

## Today's Focus

${report.today_focus.map((item) => `${item.priority}. ${item.action} (${item.task_category}, ${item.estimated_minutes}分)\n   - ${item.reason}`).join("\n")}

## Time Analysis

Total Estimate: ${report.task_time_analysis.total_estimated_minutes}分
Total Actual: ${report.task_time_analysis.total_actual_minutes}分
Variance: ${report.task_time_analysis.variance_minutes}分

### Categories

${timeCategories || "- なし"}

### Oversized Tasks

${oversizedTasks || "- なし"}

### Notes

${report.task_time_analysis.daily_notes}

## Project Status

${projects}

## Collaborator Actions

${collaboratorActions || "- なし"}

## Task Reframes

${taskReframes || "- なし"}

## Suggested Updates

${suggestedUpdates || "- なし"}
`;
}

export function renderShareReport(report: PMReport): string {
  const confirmations = report.collaborator_actions
    .map((action) => `- ${action.collaborator}: ${action.action}`)
    .join("\n");

  return `${report.share_message}

確認したいこと:
${confirmations || "- なし"}

今日やること:
${report.today_focus.map((item) => `${item.priority}. ${item.action}`).join("\n")}
`;
}

export function renderSuggestions(report: PMReport): string {
  const updates = report.suggested_updates
    .map((update) => {
      const flexibleUpdate = update as unknown as { target?: string; suggestion?: string };
      return `## ${update.file ?? flexibleUpdate.target ?? "unknown"}

### ${update.type}

Status: proposed

Suggestion:
${flexibleUpdate.suggestion ?? "記録なし"}

Reason:
${update.reason}
`;
    })
    .join("\n");

  const reframes = (report.task_reframes ?? [])
    .map((reframe) => {
      const splitTasks = Array.isArray(reframe.split_tasks)
        ? reframe.split_tasks.map((task) => `- [ ] ${task.title} (${task.owner}, ${task.type}, ${task.estimated_minutes}分)`)
        : [];
      const reframedAs = Array.isArray((reframe as unknown as { reframed_as?: unknown }).reframed_as)
        ? ((reframe as unknown as { reframed_as: unknown[] }).reframed_as.map((task) => `- [ ] ${String(task)}`))
        : [];
      const items = splitTasks.length > 0 ? splitTasks : reframedAs;

      return `## Task Reframe: ${reframe.project_id}

Original:
- ${reframe.original_task}

Split:
${items.join("\n") || "- なし"}

Reason:
${(reframe as unknown as { reason?: string }).reason ?? "タスク粒度を進めやすくするため。"}
`;
    })
    .join("\n");

  return `# Suggested Ledger Updates - ${report.date}

${updates || "更新提案はありません。"}

${reframes}
`;
}
