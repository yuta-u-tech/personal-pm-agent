export function buildReportPrompt(input: {
  date: string;
  contextPackPath: string;
  schemaPath: string;
  outputPath: string;
  systemPrompt: string;
  reportPrompt: string;
}): string {
  return `${input.systemPrompt}

${input.reportPrompt}

Read these files:
- Context Pack: ${input.contextPackPath}
- Output Schema: ${input.schemaPath}

Write exactly one JSON file:
- ${input.outputPath}

Rules:
- Return only valid JSON in the output file.
- Do not modify ledger source files such as projects, tasks, logs, context, or links.
- The JSON must satisfy the schema and include date, summary, projects, blockers, today_focus, collaborator_actions, task_reframes, task_time_analysis, share_message, and suggested_updates.
- For every today_focus item, include task_category and estimated_minutes.
- For every task_reframes item, use split_tasks as an array of objects with title, owner, type, task_category, and estimated_minutes. Do not use reframed_as.
- Include task_time_analysis with total_estimated_minutes, oversized_tasks, categories, and daily_notes.
- Classify task categories with stable labels such as planning, design, implementation, writing, review, communication, research, operations, or decision.
- Flag tasks estimated over 90 minutes as oversized and suggest smaller split tasks.
- For every suggested_updates item, use file, type, suggestion, and reason. Do not use target.
- Use ${input.date} as the report date.
`;
}

export function buildRepairPrompt(input: {
  originalPrompt: string;
  outputPath: string;
  errors: string[];
}): string {
  return `${input.originalPrompt}

The JSON currently written to ${input.outputPath} is invalid.
Fix these validation errors:
${input.errors.map((error) => `- ${error}`).join("\n")}

Overwrite ${input.outputPath} with corrected JSON only.
`;
}
