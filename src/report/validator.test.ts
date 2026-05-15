import test from "node:test";
import assert from "node:assert/strict";
import { validatePMReport } from "./validator.js";

test("validatePMReport accepts a minimal valid report", () => {
  const result = validatePMReport({
    date: "2026-05-15",
    summary: {},
    projects: [
      {
        id: "pm-agent-blog",
        status: "in_progress",
        risk: "medium",
        next_actions: []
      }
    ],
    today_focus: [],
    collaborator_actions: [],
    share_message: "今日の進捗共有です。",
    suggested_updates: []
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("validatePMReport rejects an empty share message", () => {
  const result = validatePMReport({
    date: "2026-05-15",
    summary: {},
    projects: [],
    today_focus: [],
    collaborator_actions: [],
    share_message: "",
    suggested_updates: []
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /share_message/);
});

