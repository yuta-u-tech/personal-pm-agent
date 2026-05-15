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
    "task_time_analysis",
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
          blockers: {
            type: "array",
            items: {
              type: "object",
              required: ["title", "reason"],
              properties: {
                title: { type: "string", minLength: 1 },
                reason: { type: "string", minLength: 1 },
                needs_alignment_with: { type: "string" }
              },
              additionalProperties: true
            }
          },
          next_actions: {
            type: "array",
            items: {
              type: "object",
              required: ["title", "priority", "owner"],
              properties: {
                title: { type: "string", minLength: 1 },
                priority: { type: "number" },
                owner: { type: "string", minLength: 1 }
              },
              additionalProperties: true
            }
          },
          collaborators: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "role", "needed_for"],
              properties: {
                id: { type: "string", minLength: 1 },
                role: { type: "string", minLength: 1 },
                needed_for: {
                  type: "array",
                  items: { type: "string" }
                }
              },
              additionalProperties: true
            }
          }
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
        required: ["priority", "action", "reason", "task_category", "estimated_minutes"],
        properties: {
          priority: { type: "number" },
          action: { type: "string", minLength: 1 },
          reason: { type: "string", minLength: 1 },
          task_category: { type: "string", minLength: 1 },
          estimated_minutes: { type: "number" }
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
              required: ["title", "owner", "type", "task_category", "estimated_minutes"],
              properties: {
                title: { type: "string", minLength: 1 },
                owner: { type: "string", minLength: 1 },
                type: { type: "string", minLength: 1 },
                task_category: { type: "string", minLength: 1 },
                estimated_minutes: { type: "number" }
              },
              additionalProperties: true
            }
          }
        },
        additionalProperties: true
      }
    },
    task_time_analysis: {
      type: "object",
      required: [
        "total_estimated_minutes",
        "total_actual_minutes",
        "variance_minutes",
        "oversized_tasks",
        "categories",
        "daily_notes"
      ],
      properties: {
        total_estimated_minutes: { type: "number" },
        total_actual_minutes: { type: "number" },
        variance_minutes: { type: "number" },
        oversized_tasks: {
          type: "array",
          items: {
            type: "object",
            required: ["title", "estimated_minutes", "reason", "suggested_split"],
            properties: {
              title: { type: "string", minLength: 1 },
              estimated_minutes: { type: "number" },
              reason: { type: "string", minLength: 1 },
              suggested_split: {
                type: "array",
                items: { type: "string" }
              }
            },
            additionalProperties: true
          }
        },
        categories: {
          type: "array",
          items: {
            type: "object",
            required: ["category", "estimated_minutes", "actual_minutes", "task_count", "notes"],
            properties: {
              category: { type: "string", minLength: 1 },
              estimated_minutes: { type: "number" },
              actual_minutes: { type: "number" },
              task_count: { type: "number" },
              notes: { type: "string", minLength: 1 }
            },
            additionalProperties: true
          }
        },
        daily_notes: { type: "string", minLength: 1 }
      },
      additionalProperties: true
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
