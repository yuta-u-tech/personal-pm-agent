import type { PMReport } from "./types.js";

export type ValidationResult = {
  ok: boolean;
  errors: string[];
};

export function validatePMReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(value)) return { ok: false, errors: ["report must be an object"] };

  requireString(value, "date", errors);
  requireObject(value, "summary", errors);
  requireArray(value, "projects", errors);
  requireArray(value, "blockers", errors);
  requireArray(value, "today_focus", errors);
  requireArray(value, "collaborator_actions", errors);
  requireArray(value, "task_reframes", errors);
  requireString(value, "share_message", errors);
  requireArray(value, "suggested_updates", errors);

  if (isObject(value.summary)) {
    requireNumber(value.summary, "total_projects", errors, "summary");
    requireNumber(value.summary, "healthy", errors, "summary");
    requireNumber(value.summary, "needs_attention", errors, "summary");
    requireNumber(value.summary, "blocked", errors, "summary");
    requireString(value.summary, "message", errors, "summary");
  }

  if (Array.isArray(value.projects)) {
    value.projects.forEach((project, index) => {
      if (!isObject(project)) {
        errors.push(`projects[${index}] must be an object`);
        return;
      }
      requireString(project, "id", errors, `projects[${index}]`);
      requireString(project, "name", errors, `projects[${index}]`);
      requireString(project, "status", errors, `projects[${index}]`);
      requireString(project, "risk", errors, `projects[${index}]`);
      requireString(project, "progress", errors, `projects[${index}]`);
      requireArray(project, "blockers", errors, `projects[${index}]`);
      requireArray(project, "next_actions", errors, `projects[${index}]`);
      requireArray(project, "collaborators", errors, `projects[${index}]`);
    });
  }

  if (Array.isArray(value.blockers)) {
    value.blockers.forEach((blocker, index) => {
      if (!isObject(blocker)) {
        errors.push(`blockers[${index}] must be an object`);
        return;
      }
      requireString(blocker, "project_id", errors, `blockers[${index}]`);
      requireString(blocker, "title", errors, `blockers[${index}]`);
      requireString(blocker, "reason", errors, `blockers[${index}]`);
    });
  }

  if (Array.isArray(value.today_focus)) {
    value.today_focus.forEach((focus, index) => {
      if (!isObject(focus)) {
        errors.push(`today_focus[${index}] must be an object`);
        return;
      }
      requireNumber(focus, "priority", errors, `today_focus[${index}]`);
      requireString(focus, "action", errors, `today_focus[${index}]`);
      requireString(focus, "reason", errors, `today_focus[${index}]`);
    });
  }

  if (Array.isArray(value.collaborator_actions)) {
    value.collaborator_actions.forEach((action, index) => {
      if (!isObject(action)) {
        errors.push(`collaborator_actions[${index}] must be an object`);
        return;
      }
      requireString(action, "collaborator", errors, `collaborator_actions[${index}]`);
      requireString(action, "action", errors, `collaborator_actions[${index}]`);
      requireString(action, "reason", errors, `collaborator_actions[${index}]`);
      requireString(action, "message_draft", errors, `collaborator_actions[${index}]`);
    });
  }

  if (Array.isArray(value.task_reframes)) {
    value.task_reframes.forEach((reframe, index) => {
      if (!isObject(reframe)) {
        errors.push(`task_reframes[${index}] must be an object`);
        return;
      }
      requireString(reframe, "project_id", errors, `task_reframes[${index}]`);
      requireString(reframe, "original_task", errors, `task_reframes[${index}]`);
      requireArray(reframe, "split_tasks", errors, `task_reframes[${index}]`);
      if (Array.isArray(reframe.split_tasks)) {
        reframe.split_tasks.forEach((task, taskIndex) => {
          if (!isObject(task)) {
            errors.push(`task_reframes[${index}].split_tasks[${taskIndex}] must be an object`);
            return;
          }
          requireString(task, "title", errors, `task_reframes[${index}].split_tasks[${taskIndex}]`);
          requireString(task, "owner", errors, `task_reframes[${index}].split_tasks[${taskIndex}]`);
          requireString(task, "type", errors, `task_reframes[${index}].split_tasks[${taskIndex}]`);
        });
      }
    });
  }

  if (Array.isArray(value.suggested_updates)) {
    value.suggested_updates.forEach((update, index) => {
      if (!isObject(update)) {
        errors.push(`suggested_updates[${index}] must be an object`);
        return;
      }
      requireString(update, "file", errors, `suggested_updates[${index}]`);
      requireString(update, "type", errors, `suggested_updates[${index}]`);
      requireString(update, "suggestion", errors, `suggested_updates[${index}]`);
      requireString(update, "reason", errors, `suggested_updates[${index}]`);
    });
  }

  if (typeof value.share_message === "string" && value.share_message.trim().length === 0) {
    errors.push("share_message must not be empty");
  }

  return { ok: errors.length === 0, errors };
}

export function assertPMReport(value: unknown): PMReport {
  const result = validatePMReport(value);
  if (!result.ok) {
    throw new Error(`Invalid PM report:\n${result.errors.map((error) => `- ${error}`).join("\n")}`);
  }
  return value as PMReport;
}

function requireString(value: Record<string, unknown>, key: string, errors: string[], prefix?: string): void {
  if (typeof value[key] !== "string") {
    errors.push(`${prefix ? `${prefix}.` : ""}${key} must be a string`);
  }
}

function requireNumber(value: Record<string, unknown>, key: string, errors: string[], prefix?: string): void {
  if (typeof value[key] !== "number" || Number.isNaN(value[key])) {
    errors.push(`${prefix ? `${prefix}.` : ""}${key} must be a number`);
  }
}

function requireObject(value: Record<string, unknown>, key: string, errors: string[], prefix?: string): void {
  if (!isObject(value[key])) {
    errors.push(`${prefix ? `${prefix}.` : ""}${key} must be an object`);
  }
}

function requireArray(value: Record<string, unknown>, key: string, errors: string[], prefix?: string): void {
  if (!Array.isArray(value[key])) {
    errors.push(`${prefix ? `${prefix}.` : ""}${key} must be an array`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
