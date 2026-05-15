import { readFile } from "node:fs/promises";
import { writeJson } from "../core/fs.js";
import type { ContextPack } from "../core/types.js";
import type { PMReport } from "../report/types.js";
import type { ModelAdapter, ModelRequest, ModelResponse } from "./types.js";

export class MockAdapter implements ModelAdapter {
  name = "mock";

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const context = JSON.parse(await readFile(request.contextPackPath, "utf8")) as ContextPack;
    const report = buildMockReport(request.date, context);
    await writeJson(request.outputPath, report);
    return {
      text: "mock report generated",
      json: report,
      raw: report,
      outputPath: request.outputPath
    };
  }
}

function buildMockReport(date: string, context: ContextPack): PMReport {
  const projects = context.projects.map((project, index) => {
    const id = String(project.id ?? `project-${index + 1}`);
    const name = String(project.name ?? id);
    const blockers = toStringArray(project.blockers);
    const nextActions = toStringArray(project.next_actions);
    const activeTasks = toStringArray(project.active_tasks);

    return {
      id,
      name,
      status: String(project.status ?? "unknown"),
      risk: String(project.risk ?? "medium"),
      progress: String(project.current_status ?? "進捗情報は未記録です。"),
      blockers: blockers.map((blocker) => ({
        title: blocker,
        reason: "台帳上でblockerとして記録されています。",
        needs_alignment_with: String(project.owner ?? "owner")
      })),
      next_actions: (nextActions.length > 0 ? nextActions : activeTasks.slice(0, 3)).map((action, actionIndex) => ({
        title: action,
        priority: actionIndex + 1,
        owner: String(project.owner ?? "yuta")
      })),
      collaborators: [
        {
          id: "reviewer-a",
          role: "reviewer",
          needed_for: ["technical_review", "article_feedback"]
        }
      ],
      task_reframes:
        activeTasks.length > 0
          ? [
              {
                original_task: activeTasks[0],
                reason: "タスクを受け渡し可能な単位に分けるため。",
                split_tasks: activeTasks.slice(0, 3).map((task) => ({
                  title: task,
                  owner: String(project.owner ?? "yuta"),
                  type: "planning"
                }))
              }
            ]
          : []
    };
  });

  const allBlockers = projects.flatMap((project) =>
    project.blockers.map((blocker) => ({
      project_id: project.id,
      title: blocker.title,
      reason: blocker.reason
    }))
  );

  const firstAction = projects[0]?.next_actions[0]?.title ?? "PMエージェントのMVP範囲を確定する";

  return {
    date,
    summary: {
      total_projects: projects.length,
      healthy: projects.filter((project) => project.risk === "low").length,
      needs_attention: projects.filter((project) => project.risk === "medium").length,
      blocked: projects.filter((project) => project.risk === "high").length,
      message: `今日の最優先は「${firstAction}」です。`
    },
    projects,
    blockers: allBlockers,
    today_focus: [
      {
        priority: 1,
        action: firstAction,
        reason: "ここが決まるとMVP実装と記事化の両方が進むため。"
      }
    ],
    collaborator_actions: [
      {
        collaborator: "reviewer-a",
        action: "Output ContractとValidatorの説明についてレビューを依頼する",
        reason: "技術説明の妥当性を確認するため。",
        message_draft: "Output ContractとValidatorの説明に違和感がないか、軽く見てもらえますか？"
      }
    ],
    task_reframes: projects.flatMap((project) =>
      project.task_reframes.map((reframe) => ({
        project_id: project.id,
        original_task: reframe.original_task,
        split_tasks: reframe.split_tasks
      }))
    ),
    share_message:
      "今日の進捗共有です。PMエージェントは、AI秘書ではなく個人PMエージェントとして設計する方針に整理し、Privateな進捗台帳を中心にMVP実装を進めています。",
    suggested_updates: [
      {
        file: "projects/pm-agent-blog.md",
        type: "status_update",
        reason: "MVP実装の起点として、CLIとContext Pack生成が進んだため。"
      }
    ]
  };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

