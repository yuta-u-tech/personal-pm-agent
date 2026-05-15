# Personal PM Agent

Personal PM Agent is a local-first CLI for maintaining a private project progress ledger.

The first MVP focuses on:

- creating a progress ledger structure
- collecting project, task, log, people, and repository context
- generating `context-raw.json` and `context-pack.json`

## Commands

```sh
npm install
npm run build
npm run pm-agent -- init ../progress-ledger
npm run pm-agent -- morning ../progress-ledger
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

## Repository Roles

- `personal-pm-agent`: CLI and agent implementation
- `progress-ledger`: private progress ledger data
