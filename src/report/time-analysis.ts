import type { PMReport } from "./types.js";

type MutableReport = Record<string, unknown>;

export function enrichTimeAnalysis(value: unknown, contextPack?: unknown): unknown {
  if (!isObject(value)) return value;

  const report = value as MutableReport;
  normalizeProjects(report);
  enrichTodayFocus(report);
  enrichTaskReframes(report);
  report.task_time_analysis = buildTaskTimeAnalysis(report, extractTimeEntries(contextPack));
  return report;
}

function normalizeProjects(report: MutableReport): void {
  if (!Array.isArray(report.projects)) return;

  for (const project of report.projects) {
    if (!isObject(project)) continue;
    const projectId = String(project.id ?? "unknown");
    const owner = String(project.owner ?? "yuta");

    if (Array.isArray(project.blockers)) {
      project.blockers = project.blockers.map((blocker) =>
        isObject(blocker)
          ? blocker
          : {
              title: String(blocker),
              reason: "台帳上でblockerとして記録されています。"
            }
      );
    }

    if (Array.isArray(project.next_actions)) {
      project.next_actions = project.next_actions.map((action, index) =>
        isObject(action)
          ? action
          : {
              title: String(action),
              priority: index + 1,
              owner
            }
      );
    }

    if (Array.isArray(project.collaborators)) {
      project.collaborators = project.collaborators.map((collaborator) => {
        if (!isObject(collaborator)) {
          return {
            id: String(collaborator),
            role: "collaborator",
            needed_for: []
          };
        }

        return {
          ...collaborator,
          id: String(collaborator.id ?? collaborator.name ?? `${projectId}-collaborator`),
          role: String(collaborator.role ?? "collaborator"),
          needed_for: Array.isArray(collaborator.needed_for)
            ? collaborator.needed_for
            : collaborator.focus
              ? [String(collaborator.focus)]
              : []
        };
      });
    }
  }
}

function enrichTodayFocus(report: MutableReport): void {
  if (!Array.isArray(report.today_focus)) return;

  for (const item of report.today_focus) {
    if (!isObject(item)) continue;
    const action = String(item.action ?? "");
    item.task_category ??= categorizeTask(action);
    item.estimated_minutes ??= estimateMinutes(action);
  }
}

function enrichTaskReframes(report: MutableReport): void {
  if (!Array.isArray(report.task_reframes)) return;

  for (const reframe of report.task_reframes) {
    if (!isObject(reframe) || !Array.isArray(reframe.split_tasks)) continue;
    for (const task of reframe.split_tasks) {
      if (!isObject(task)) continue;
      const title = String(task.title ?? "");
      task.task_category ??= categorizeTask(title);
      task.estimated_minutes ??= estimateMinutes(title);
    }
  }
}

function buildTaskTimeAnalysis(
  report: MutableReport,
  actualEntries: Array<{ task: string; category: string; actual_minutes: number }>
): PMReport["task_time_analysis"] {
  const tasks: Array<{ title: string; category: string; estimated_minutes: number }> = [];

  if (Array.isArray(report.today_focus)) {
    for (const item of report.today_focus) {
      if (!isObject(item)) continue;
      tasks.push({
        title: String(item.action ?? ""),
        category: String(item.task_category ?? categorizeTask(String(item.action ?? ""))),
        estimated_minutes: toNumber(item.estimated_minutes, estimateMinutes(String(item.action ?? "")))
      });
    }
  }

  if (Array.isArray(report.task_reframes)) {
    for (const reframe of report.task_reframes) {
      if (!isObject(reframe) || !Array.isArray(reframe.split_tasks)) continue;
      for (const task of reframe.split_tasks) {
        if (!isObject(task)) continue;
        tasks.push({
          title: String(task.title ?? ""),
          category: String(task.task_category ?? categorizeTask(String(task.title ?? ""))),
          estimated_minutes: toNumber(task.estimated_minutes, estimateMinutes(String(task.title ?? "")))
        });
      }
    }
  }

  const categories = new Map<string, { estimated_minutes: number; actual_minutes: number; task_count: number }>();
  for (const task of tasks) {
    const current = categories.get(task.category) ?? { estimated_minutes: 0, actual_minutes: 0, task_count: 0 };
    current.estimated_minutes += task.estimated_minutes;
    current.task_count += 1;
    categories.set(task.category, current);
  }
  for (const entry of actualEntries) {
    const current = categories.get(entry.category) ?? { estimated_minutes: 0, actual_minutes: 0, task_count: 0 };
    current.actual_minutes += entry.actual_minutes;
    categories.set(entry.category, current);
  }
  const totalEstimated = tasks.reduce((sum, task) => sum + task.estimated_minutes, 0);
  const totalActual = actualEntries.reduce((sum, entry) => sum + entry.actual_minutes, 0);

  return {
    total_estimated_minutes: totalEstimated,
    total_actual_minutes: totalActual,
    variance_minutes: totalActual - totalEstimated,
    oversized_tasks: tasks
      .filter((task) => task.estimated_minutes > 90)
      .map((task) => ({
        title: task.title,
        estimated_minutes: task.estimated_minutes,
        reason: "90分を超える見積もりのため、さらに小さい受け渡し可能な単位に分けるべきです。",
        suggested_split: [
          `${task.title}の完了条件を決める`,
          `${task.title}を実行する`,
          `${task.title}の結果を確認する`
        ]
      })),
    categories: Array.from(categories.entries()).map(([category, value]) => ({
      category,
      estimated_minutes: value.estimated_minutes,
      actual_minutes: value.actual_minutes,
      task_count: value.task_count,
      notes: `${category}カテゴリの合計見積もりです。`
    })),
    daily_notes:
      "見積もりは過去ログが少ない段階の初期値です。実績を日次ログに残すと、次回以降の粒度調整に使えます。"
  };
}

function extractTimeEntries(contextPack: unknown): Array<{ task: string; category: string; actual_minutes: number }> {
  if (!isObject(contextPack) || !Array.isArray(contextPack.recent_logs)) return [];

  const entries: Array<{ task: string; category: string; actual_minutes: number }> = [];
  for (const log of contextPack.recent_logs) {
    if (!isObject(log) || typeof log.body !== "string") continue;
    entries.push(...parseTimeEntries(log.body));
  }
  return entries;
}

function parseTimeEntries(markdown: string): Array<{ task: string; category: string; actual_minutes: number }> {
  const entries: Array<{ task: string; category: string; actual_minutes: number }> = [];
  let current: Record<string, string> | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const taskMatch = line.match(/^- task:\s*(.+)$/);
    if (taskMatch) {
      if (current) pushEntry(current, entries);
      current = { task: taskMatch[1].trim() };
      continue;
    }

    const keyMatch = line.match(/^(category|actual_minutes):\s*(.+)$/);
    if (current && keyMatch) {
      current[keyMatch[1]] = keyMatch[2].trim();
    }
  }

  if (current) pushEntry(current, entries);
  return entries;
}

function pushEntry(
  current: Record<string, string>,
  entries: Array<{ task: string; category: string; actual_minutes: number }>
): void {
  const actual = Number(current.actual_minutes);
  if (!current.task || !current.category || Number.isNaN(actual)) return;
  entries.push({
    task: current.task,
    category: current.category,
    actual_minutes: actual
  });
}

export function estimateMinutes(title: string): number {
  if (/実装|生成|作る|構成図|renderer|adapter/i.test(title)) return 90;
  if (/確定|決める|仕様|Output Contract|schema|Validator/i.test(title)) return 60;
  if (/レビュー|依頼|相談|共有/.test(title)) return 30;
  if (/記事|書く|説明/.test(title)) return 60;
  return 45;
}

export function categorizeTask(title: string): string {
  if (/実装|生成|動作|adapter|renderer/i.test(title)) return "implementation";
  if (/構成図|図解|デザイン|ラフ/.test(title)) return "design";
  if (/記事|書く|説明/.test(title)) return "writing";
  if (/レビュー|依頼|相談|共有/.test(title)) return "communication";
  if (/決める|確定|仕様|範囲|Output Contract|schema|Validator/i.test(title)) return "planning";
  return "operations";
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && !Number.isNaN(value) ? value : fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
