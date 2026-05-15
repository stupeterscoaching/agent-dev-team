# Architecture

This document defines the complete system architecture for `agent-dev-team`. Read this before touching any code.

---

## Overview

`agent-dev-team` is a tiered AI agent system that mirrors a real software development workflow. Agents communicate via Discord for human visibility and approval, and manage work through GitHub Issues and Pull Requests in per-project repos.

Three core principles:

- **Intelligence cascades down** — strategy and decisions flow from frontier models to local workers
- **Insights bubble up** — workers and managers surface observations back to the top
- **Humans stay in control** — any decision that costs money requires executive approval

---

## Design Philosophy

This system is influenced by [Late](https://github.com/mlhher/late)'s approach to agent orchestration: strict context discipline, ephemeral agent context windows, and deterministic execution. The core insight is that context pollution actively degrades model reasoning — research shows models can lose 60-80% of their effectiveness within 2-3 attempts when context is bloated.

Our solution: one persistent agent at the top, everything else ephemeral and scoped to its role.

Every role in the system must be justified by the project. Agents spin up when needed and are discarded when done. The Director is the only persistent agent.

---

## Agent Hierarchy

```
┌─────────────────────────────────────────────────────┐
│                    DIRECTOR                         │
│          (Claude Opus or Ollama — configured)       │
│                                                     │
│  Persistent global context                          │
│  Collaborates with executive to build project spec  │
│  Spins up PM + Tech Lead on spec confirmation       │
│  Listens for close: commands to end projects        │
└──────────────────────┬──────────────────────────────┘
                       │ confirmed spec
           ┌───────────┴───────────┐
           │                       │
┌──────────▼──────┐       ┌────────▼────────┐
│    PM AGENT     │       │   TECH LEAD     │
│  (ephemeral)    │       │   (ephemeral)   │
│                 │       │                 │
│  Creates project│       │  Coding stds    │
│  GitHub repo    │       │  PR review      │
│  GitHub Issues  │       │  PR merge       │
│  Cost estimates │       │  Close detect   │
│  Discord posts  │       │                 │
└──────────┬──────┘       └─────────────────┘
           │ confirmed estimate
           │
┌──────────▼──────────────────────────────────────────┐
│                 WORKER AGENTS                       │
│         (Claude API or Ollama — configured)         │
│                                                     │
│   Coder         Writer        Researcher            │
│   type:feature  type:docs     type:research         │
│   (default)                                         │
│                                                     │
│   Ephemeral — spawned per GitHub Issue              │
│   Routed by Issue label                             │
│   Coder/Writer: branch → work → PR → discard       │
│   Researcher: research → Issue comment → discard    │
└─────────────────────────────────────────────────────┘
```

---

## Three-Repo Architecture

`agent-dev-team` uses a three-repo model. Each project gets its own dedicated GitHub repo.

```
agent-dev-team repo (this repo)
  └── Agent infrastructure only

bessemer-state repo (usebessemer/bessemer-state)
  └── estimation-history.json — shared state across all projects

{project-name} repo (created per project by PM)
  ├── GitHub Issues — project task backlog
  ├── Worker branches — one per Issue
  ├── Pull Requests — one per Coder/Writer branch
  └── Merged code — final deliverables
```

This keeps `agent-dev-team` clean as infrastructure-only. Project code lives in its own deployable repo.

---

## How Agents Communicate

There is no in-process message bus. Agents coordinate through three real channels:

- **Discord** — human visibility and approval gates. Bots post to the project channel via `postToChannel`; workers post via webhook via `postAsWorker`. Each project gets its own `#proj-{name}` channel created automatically by the pipeline.
- **GitHub Issues** — the task backlog. PM creates Issues from the spec; the pipeline's `watchIssues` poller spawns workers; workers advance Issues through label states (`status:backlog` → `status:review` → `status:complete`).
- **GitHub PRs** — the work handoff. Coder/Writer workers open PRs; the `watchPRs` poller triggers Tech Lead review; merge closes the Issue.

---

## Human Confirmation Gates

Nothing spins up without executive confirmation. Two hard gates before any work starts:

```
Gate 1 — Spec confirmation
  Director builds spec from executive brief
  Director → #approvals (type 'approve' or 'reject')
  approve → Director spins up PM + Tech Lead

Gate 2 — Cost estimate confirmation
  PM reads estimation-history.json from bessemer-state
  PM builds cost estimate
  PM → #approvals (type 'approve' or 'reject')
  approve → PM creates project repo + Issues, workers spawn
```

---

## Worker Execution Model

Workers are stateless, ephemeral agents. A fresh worker is spawned for each GitHub Issue. Routing is determined by the Issue's `type:*` label, set by the PM when it creates Issues.

**Coder** (`type:feature` or unlabelled)
- Spawn → generate code (single model call) → commit → open PR → discard

**Writer** (`type:docs`)
- Spawn → generate written artifact (README, changelog, etc.) → commit → open PR → discard

**Researcher** (`type:research`)
- Spawn → run research prompt → post findings as Issue comment → close Issue → discard
- No branch or PR — research is delivered directly to the Issue

**Failure handling (Coder and Writer):**
- 3-attempt self-healing loop for commit/API failures
- On 3rd failure → escalation fires → Issue labelled `status:blocked`, alert posted to `#alerts`
- Rejected PRs → Issue requeued → worker respawns on next poll

**One worker per Issue — always:**
```
One GitHub Issue = One Worker = One Branch = One PR
No exceptions (for Coder and Writer).
```

---

## Pipeline Flow

```
PHASE 1 — BRIEF
Executive → #director: "brief: [project-name] {description}"
Director builds spec using configured model
Director → #approvals (type 'approve' or 'reject')

PHASE 2 — TEAM SPINUP
Director spins up PM + Tech Lead (ephemeral, simultaneously)
Pipeline creates #proj-{name} Discord channel + webhook
Tech Lead defines coding standards immediately
PM reads estimation-history.json from bessemer-state
PM builds cost estimate
PM → #approvals (type 'approve' or 'reject')

PHASE 3 — PROJECT SETUP
PM creates GitHub repo for the project
PM creates GitHub Labels in project repo
PM creates GitHub Issues from spec deliverables in project repo

PHASE 4 — EXECUTION
watchIssues polls project repo every 30s for open Issues
Worker spawns per Issue based on type: label (Coder / Writer / Researcher)
Coder/Writer: branch → work → commit → PR → discard
Researcher: research → Issue comment → close Issue → discard
watchPRs polls project repo every 30s for open PRs
Tech Lead reviews PRs → merges or rejects
Rejected PRs → Issue requeued → worker respawns next poll
Merged PRs → Issue closed → Tech Lead checks completion

PHASE 5 — CLOSE DETECTION
After each merge, Tech Lead checks for 0 open PRs + 0 open Issues
When complete:
  Tech Lead → #director: "Project {name} appears complete"
  Posts project repo link and close instructions

PHASE 6 — CLOSE CONFIRMATION
Executive reviews project repo on GitHub
Executive → #director: "close: {project-name}"
Pipeline writes estimate to bessemer-state estimation history
PM + Tech Lead discard (Discord clients destroyed)
Project channel archived (renamed archived-proj-{name}, set read-only)
Director → #director: "Project {name} closed"
```

---

## Estimation Memory

The PM reads from a shared estimation history in the `bessemer-state` repo on spawn. After a project closes, the pipeline writes the estimate back.

- Remote: `usebessemer/bessemer-state/estimation-history.json`
- Local fallback: `projects/estimation-history.json` (used if bessemer-state is unreachable)

Both locations use the same JSON schema: `{ "projects": [ { projectName, closedAt, estimate: { hours, cost, currency } } ] }`.

---

## Discord Structure

```
📁 ORG-WIDE (permanent)
  #director       ← briefs, specs, project status, close commands
  #approvals      ← human confirmation gates (type 'approve'/'reject')
  #alerts         ← worker escalations and system issues

📁 PER-PROJECT (auto-created, auto-archived)
  #proj-{name}    ← all agent activity for this project
                     managers post here; workers post via webhook
                     renamed to archived-proj-{name} on close
```

**Bot identity model:**

```
Persistent bots (always running):
  🤖 Director

Per-project bots (ephemeral — spawned with PM and Tech Lead):
  🤖 PM
  🤖 TechLead

Workers post via webhook — no bot token, no persistent identity.
```

**Note on concurrency:** `PM_TOKEN` and `TECHLEAD_TOKEN` are global env vars. True multi-project concurrency is not yet supported — two projects running simultaneously would share the same PM/Tech Lead bot identity. See ROADMAP.md v1.5.0 for the planned fix.

---

## Known Limitations (v1.2)

- **Single-shot workers** — Coder and Writer generate output in one model call with no tool use or iteration. The model cannot read existing repo files, run its own output, or recover from errors in its code. Planned fix: v1.3 agentic Coder with tool use.
- **No verification before merge** — Tech Lead reads the diff text and asks the model for a quality score. No tests run. No build happens. Planned fix: v1.3 Tech Lead runs project tests in a sandbox before merging.
- **Hardcoded Node/Express spec** — Director always produces the same architecture regardless of brief content. A Python brief gets an Express app. Planned fix: v1.4 tech-stack-aware spec generation.
- **Estimation is approximate** — PM asks the model for a number and multiplies by a fixed hourly rate. Historical data is written but the filter by `projectType` doesn't match (Director doesn't set `projectType` on specs yet). Planned fix: v1.4.
- **Single project at a time** — see Discord section above. Planned fix: v1.5.
- **30s polling latency** — Issues and PRs are detected by polling every 30 seconds. Planned fix: v1.5 GitHub webhooks.
- **In-memory state** — `activeProjects` is in RAM. A process crash loses all in-flight project state. Planned fix: v1.5 SQLite persistence.
