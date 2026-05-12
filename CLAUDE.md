# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Boot the system (runs index.js)
npm run lint       # ESLint check (eslint:recommended, no-unused-vars warns, console allowed)
```

No test suite is configured. Manual Discord interaction is the primary way to verify behavior.

## Architecture overview

`agent-dev-team` is a tiered, ephemeral AI agent system. Agents communicate via Discord and manage work through GitHub Issues and PRs. **Read ARCHITECTURE.md before touching pipeline or agent code** — it defines the contracts and execution model in full.

### Agent tiers

```
Director (persistent) → PM + Tech Lead (ephemeral, per project) → Coder (ephemeral, per Issue)
```

- **Director** (`src/agents/director/index.js`) — the only persistent agent. Listens on Discord `#director` for `brief:` commands. Builds specs via Ollama, sends to `#approvals` for human gate, then calls `pipeline.spawnManagers()`.
- **PM** (`src/agents/managers/pm.js`) — ephemeral, spawned per project. Creates GitHub repo, labels, and Issues from the spec. Posts cost estimate to `#approvals` for second human gate. Exposes `this.projectRepo` after `run()` completes.
- **Tech Lead** (`src/agents/managers/techlead.js`) — ephemeral, spawned alongside PM. Reviews and merges PRs in the project repo. Uses comment + direct merge (cannot formally approve own PRs on same GitHub account).
- **Coder** (`src/agents/workers/coder.js`) — ephemeral, one per GitHub Issue. Creates branch → generates code via Ollama → commits → opens PR → discards. Posts via webhook (no bot token). Retries up to 3 times before escalating.

### Orchestration

`src/pipeline/index.js` is the main orchestrator. After PM finishes, it starts two pollers (30s interval each):
- `watchIssues` — spawns a Coder per open Issue (tracks already-spawned via `Set`)
- `watchPRs` — triggers Tech Lead review per open PR

Both pollers operate on the **project repo** (created by PM), not the `agent-dev-team` repo itself.

### Key constraint: GitHub Issues as complete task briefs

Because workers are stateless (no shared memory), every GitHub Issue must be entirely self-contained. The PM agent is responsible for writing Issues that a Coder can execute with zero additional context.

### Communication layer

- **Discord** — real-time visibility and human approval gates. Bots use `discord.js`; workers use webhooks only (no bot token, no persistent identity).
- **GitHub** — source of truth for work. Issues = task backlog, branches = active work, merged PRs = completed work.
- **Ollama** — local model inference for all agents. Director/managers default to `llama3.1:8b`, workers to `llama3.2:latest`. Model vars are in `.env`.

### State without a database

| State | Location |
|---|---|
| Task backlog | GitHub Issues (project repo) |
| Estimation memory | `projects/estimation-history.json` |
| Project spec | `projects/{name}/project.json` |

### Agent message contracts

All inter-agent messages use the base contract in `src/contracts/base.js` (`createMessage()`). Types: `task`, `result`, `insight`, `escalation`, `feedback`. See ARCHITECTURE.md for payload shapes per message type.

## Environment setup

Copy `.env.example` to `.env`. Required values:

```
DIRECTOR_TOKEN          # Discord bot token for the Director bot
PM_TOKEN                # Discord bot token for the PM bot
TECHLEAD_TOKEN          # Discord bot token for the Tech Lead bot
DISCORD_GUILD_ID
DISCORD_CHANNEL_DIRECTOR
DISCORD_CHANNEL_APPROVALS
DISCORD_CHANNEL_ALERTS
GITHUB_TOKEN            # PAT with repo scope
GITHUB_OWNER
OLLAMA_BASE_URL         # default: http://127.0.0.1:11434
DIRECTOR_MODEL / MANAGER_MODEL / WORKER_MODEL
```

**`.env` is loaded via raw `fs.readFileSync`** in every file — `dotenv` / `dotenvx` is intentionally bypassed to avoid interference. Do not change this pattern.

## Important caveats

- The `managers/`, `pipeline/`, `orchestrator/`, `workers/` directories at the repo root are **legacy/unused**. All active code lives under `src/`.
- `config.json` at the root is empty.
- Discord bots require **Message Content Intent** enabled in the Discord Developer Portal.
- The human approval flow (`waitForApproval` in `src/discord/client.js`) is blocking — the pipeline waits for `approve` or `reject` in `#approvals` before continuing.

## Working Conventions (Stu's dev practice)
- One change at a time — never batch changes
- Test before committing, always
- feature/* → develop → main
- Never commit directly to main or develop
- Full file output preferred over snippets

## Agent Branching (runtime behaviour — not dev practice)
- Workers branch as: {agent}/{taskId}/{short-description}
- Example: coder/task-001/add-tweet-formatter
- Set by PM Agent in GitHub Issues, executed by Coder agents