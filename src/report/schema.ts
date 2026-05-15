export const PM_REPORT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "PMReport",
  type: "object",
  required: [
    "date",
    "summary",
    "projects",
    "blockers",
    "today_focus",
    "collaborator_actions",
    "task_reframes",
    "share_message",
    "suggested_updates"
  ],
  properties: {
    date: { type: "string", minLength: 1 },
    summary: {
      type: "object",
      required: ["total_projects", "healthy", "needs_attention", "blocked", "message"],
      properties: {
        total_projects: { type: "number" },
        healthy: { type: "number" },
        needs_attention: { type: "number" },
        blocked: { type: "number" },
        message: { type: "string", minLength: 1 }
      },
      additionalProperties: true
    },
    projects: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "status", "risk", "progress", "blockers", "next_actions", "collaborators"],
        properties: {
          id: { type: "string", minLength: 1 },
          name: { type: "string", minLength: 1 },
          status: { type: "string", minLength: 1 },
          risk: { type: "string", minLength: 1 },
          progress: { type: "string" },
          blockers: { type: "array" },
          next_actions: { type: "array" },
          collaborators: { type: "array" }
        },
        additionalProperties: true
      }
    },
    blockers: {
      type: "array",
      items: {
        type: "object",
        required: ["project_id", "title", "reason"],
        properties: {
          project_id: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          reason: { type: "string", minLength: 1 }
        },
        additionalProperties: true
      }
    },
    today_focus: {
      type: "array",
      items: {
        type: "object",
        required: ["priority", "action", "reason"],
        properties: {
          priority: { type: "number" },
          action: { type: "string", minLength: 1 },
          reason: { type: "string", minLength: 1 }
        },
        additionalProperties: true
      }
    },
    collaborator_actions: {
      type: "array",
      items: {
        type: "object",
        required: ["collaborator", "action", "reason", "message_draft"],
        properties: {
          collaborator: { type: "string", minLength: 1 },
          action: { type: "string", minLength: 1 },
          reason: { type: "string", minLength: 1 },
          message_draft: { type: "string", minLength: 1 }
        },
        additionalProperties: true
      }
    },
    task_reframes: {
      type: "array",
      items: {
        type: "object",
        required: ["project_id", "original_task", "split_tasks"],
        properties: {
          project_id: { type: "string", minLength: 1 },
          original_task: { type: "string", minLength: 1 },
          split_tasks: {
            type: "array",
            items: {
              type: "object",
              required: ["title", "owner", "type"],
              properties: {
                title: { type: "string", minLength: 1 },
                owner: { type: "string", minLength: 1 },
                type: { type: "string", minLength: 1 }
              },
              additionalProperties: true
            }
          }
        },
        additionalProperties: true
      }
    },
    share_message: { type: "string", minLength: 1 },
    suggested_updates: {
      type: "array",
      items: {
        type: "object",
        required: ["file", "type", "suggestion", "reason"],
        properties: {
          file: { type: "string", minLength: 1 },
          type: { type: "string", minLength: 1 },
          suggestion: { type: "string", minLength: 1 },
          reason: { type: "string", minLength: 1 }
        },
        additionalProperties: true
      }
    }
  },
  additionalProperties: true
} as const;

export function stringifyPMReportSchema(): string {
  return `${JSON.stringify(PM_REPORT_SCHEMA, null, 2)}\n`;
}

