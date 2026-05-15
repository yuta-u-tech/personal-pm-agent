import test from "node:test";
import assert from "node:assert/strict";
import { PM_REPORT_SCHEMA } from "./schema.js";

test("PM_REPORT_SCHEMA requires contract fields that the runtime validator checks", () => {
  assert.deepEqual(PM_REPORT_SCHEMA.required, [
    "date",
    "summary",
    "projects",
    "blockers",
    "today_focus",
    "collaborator_actions",
    "task_reframes",
    "share_message",
    "suggested_updates"
  ]);
  assert.deepEqual(PM_REPORT_SCHEMA.properties.suggested_updates.items.required, [
    "file",
    "type",
    "suggestion",
    "reason"
  ]);
  assert.deepEqual(PM_REPORT_SCHEMA.properties.task_reframes.items.required, [
    "project_id",
    "original_task",
    "split_tasks"
  ]);
});

