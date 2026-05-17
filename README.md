# Personal PM Agent

Personal PM Agent is a local-first CLI for maintaining a private project progress ledger.

Personal PM Agent focuses on:

- creating a progress ledger structure
- collecting project, task, log, people, and repository context
- generating `context-raw.json`, `context-pack.json`, `pm-report.json`, daily reports, share drafts, and ledger suggestions
- analyzing estimated and actual task time from daily logs

## Commands

```sh
npm install
npm run build
npm run pm-agent -- init ../progress-ledger
npm run pm-agent -- morning ../progress-ledger
```

`morning` uses JST (`Asia/Tokyo`) for the default date. You can override it:

```sh
npm run pm-agent -- morning ../progress-ledger --date 2026-05-18
```

The default adapter is `mock`, so the MVP flow can be tested without an API contract.
To use a background terminal agent, configure `pm-agent.config.json` in the ledger and run:

```sh
npm run pm-agent -- morning ../progress-ledger --adapter background-agent
```

The generated report contract is file-based:

- input: `ai/outputs/YYYY-MM-DD/context-pack.json`
- schema: `ai/schemas/pm-report.schema.json`
- output: `ai/outputs/YYYY-MM-DD/pm-report.json`
- local logs: `ai/outputs/YYYY-MM-DD/agent-run.log`

`agent-run.log` is local diagnostic output and should usually be ignored by Git.

## Daily Time Entries

Add actual work time to `logs/daily/YYYY-MM-DD.md`:

```md
## Time Entries

- task: Output Contract整理
  category: planning
  actual_minutes: 90
  notes: Validator条件と出力契約を整理
```

Supported categories are stable labels such as `planning`, `design`, `implementation`, `writing`, `review`, `communication`, `research`, `operations`, and `decision`.

## Config

`pm-agent.config.json` controls collection and agent logs:

```json
{
  "collect": {
    "projects": { "enabled": true },
    "tasks": { "enabled": true },
    "dailyLogs": { "enabled": true, "days": 7 },
    "people": { "enabled": true },
    "repositories": { "enabled": true, "includeGitStatus": true },
    "previousReport": { "enabled": true }
  },
  "agentLogs": {
    "save": true,
    "gitIgnore": true
  }
}
```

## Repository Roles

- `personal-pm-agent`: CLI and agent implementation
- `progress-ledger`: private progress ledger data
