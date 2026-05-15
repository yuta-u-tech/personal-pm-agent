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
npm run pm-agent -- collect ../progress-ledger
```

## Repository Roles

- `personal-pm-agent`: CLI and agent implementation
- `progress-ledger`: private progress ledger data

