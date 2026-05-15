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
- The JSON must satisfy the schema and include date, summary, projects, blockers, today_focus, collaborator_actions, task_reframes, share_message, and suggested_updates.
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

