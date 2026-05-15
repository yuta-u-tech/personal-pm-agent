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
  requireArray(value, "today_focus", errors);
  requireArray(value, "collaborator_actions", errors);
  requireString(value, "share_message", errors);
  requireArray(value, "suggested_updates", errors);

  if (Array.isArray(value.projects)) {
    value.projects.forEach((project, index) => {
      if (!isObject(project)) {
        errors.push(`projects[${index}] must be an object`);
        return;
      }
      requireString(project, "id", errors, `projects[${index}]`);
      requireString(project, "status", errors, `projects[${index}]`);
      requireString(project, "risk", errors, `projects[${index}]`);
      requireArray(project, "next_actions", errors, `projects[${index}]`);
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

