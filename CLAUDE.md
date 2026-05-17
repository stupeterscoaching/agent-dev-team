# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Boot the system (runs index.js)
npm run lint       # ESLint check (eslint:recommended, no-unused-vars warns, console allowed)
```

Run `npm test` to execute the full suite (90 tests, ~0.2s). All external services are mocked — no real credentials needed. Manual Discord interaction remains the primary way to verify end-to-end behaviour.

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

`src/pipeline/index.js` is the main orchestrator. After PM finishes, it:
1. Saves project state to SQLite (`src/state/db.js`) — persists through crashes
2. Starts two pollers (5-min interval each) as fallback safety nets:
   - `watchIssues` — spawns a Coder per open Issue (tracks already-spawned via `Set`)
   - `watchPRs` — triggers Tech Lead review per open PR
3. Receives GitHub webhooks via `src/webhooks/github.js` (Express on `WEBHOOK_PORT`) — webhooks are the primary trigger; pollers are the eventual-consistency fallback

`Pipeline.resume()` is called at startup and re-instantiates any projects that were active when the process last crashed. Both pollers operate on the **project repo** (created by PM), not the `agent-dev-team` repo itself.

### Key constraint: GitHub Issues as complete task briefs

Because workers are stateless (no shared memory), every GitHub Issue must be entirely self-contained. The PM agent is responsible for writing Issues that a Coder can execute with zero additional context.

### Communication layer

- **Discord** — real-time visibility and human approval gates. Bots use `discord.js`; workers use webhooks only (no bot token, no persistent identity).
- **GitHub** — source of truth for work. Issues = task backlog, branches = active work, merged PRs = completed work.
- **Ollama** — local model inference for all agents. Director/managers default to `llama3.1:8b`, workers to `llama3.2:latest`. Model vars are in `.env`.

### State

| State | Location |
|---|---|
| Active projects | SQLite at `./state/agent-dev-team.db` (`src/state/db.js`) |
| Task backlog | GitHub Issues (project repo) |
| Estimation memory | `projects/estimation-history.json` (local) + `bessemer-state` repo (cross-project) |

### How agents communicate

There is no in-process message bus. Agents coordinate through three real channels:

- **Discord** — human visibility and approval gates. Bots post to project channels via `postToChannel`; workers post via webhook via `postAsWorker`.
- **GitHub Issues** — the task backlog. PM creates Issues from the spec; the pipeline's `watchIssues` poller spawns workers; workers move Issues through `status:backlog` → `status:review` → `status:complete` via label updates.
- **GitHub PRs** — the work handoff. Workers open PRs; the `watchPRs` poller triggers Tech Lead review; merge closes the Issue.

State that needs to persist beyond a single run lives in `projects/estimation-history.json` (local cache) and the `bessemer-state` repo (cross-project).

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

**`.env` is loaded once at boot** by `src/config.js` (`loadEnv()`), called from `index.js`. `dotenv` / `dotenvx` is intentionally bypassed. No agent or module should read `.env` directly — add new env vars to `src/config.js`'s parser and `.env.example` only.

## Important caveats

- `config.json` at the root is empty.
- Discord bots require **Message Content Intent** enabled in the Discord Developer Portal.
- The human approval flow (`waitForApproval` in `src/discord/client.js`) is blocking — the pipeline waits for `approve` or `reject` in `#approvals` before continuing.

## Working Conventions (Stu's dev practice)
- One change at a time — never batch changes
- Test before committing, always
- feature/* → develop → main
- Never commit directly to main or develop
- Full file output preferred over snippets

## Session Handoff Protocol

At the end of every coding session, write a `HANDOFF.md` in this repo root with the following format:

```
# Bessemer Handoff — YYYY-MM-DD

## What was worked on
[What changed this session]

## In progress / incomplete
[Anything half-finished, broken, or mid-PR]

## Next move
[The single most important thing to do next session]

## Decisions made
[Any architectural or strategic calls worth logging — these get copied to the AIOS decisions/log.md]
```

Stu pastes this into his AIOS session (~/AI-dev/AI-OS) after each bessemer coding session. Delete the file once it's been handed off. This is how strategic context and coding context stay in sync.

## Agent Branching (runtime behaviour — not dev practice)
- Workers branch as: {agent}/{taskId}/{short-description}
- Example: coder/task-001/add-tweet-formatter
- Set by PM Agent in GitHub Issues, executed by Coder agents