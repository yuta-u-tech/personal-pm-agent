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

  return `# PM Report - ${report.date}

## Executive Summary

${report.summary.message}

- 順調: ${report.summary.healthy}件
- 注意: ${report.summary.needs_attention}件
- 停滞: ${report.summary.blocked}件

## Today's Focus

${report.today_focus.map((item) => `${item.priority}. ${item.action}\n   - ${item.reason}`).join("\n")}

## Project Status

${projects}
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
        ? reframe.split_tasks.map((task) => `- [ ] ${task.title} (${task.owner}, ${task.type})`)
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
