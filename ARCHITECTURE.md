# Architecture

This document defines the complete system architecture for `agent-dev-team`. Read this before touching any code.

---

## Overview

`agent-dev-team` is a tiered AI agent system that mirrors a real software development workflow. Agents communicate via Discord, manage work via GitHub Issues and Pull Requests in dedicated project repos, and are monitored by the pluggable [`efficiency-auditor`](https://github.com/usebessemer/efficiency-auditor) module.

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
│               (Claude Opus — API)                   │
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
│  Cost estimates │       │  Quality scores │
│  Discord posts  │       │  Close detect   │
└──────────┬──────┘       └────────┬────────┘
           │ confirmed estimate     │
           └───────────┬───────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                 WORKER AGENTS                       │
│              (Ollama — local models)                │
│                                                     │
│   Researcher      Writer        Coder               │
│                                                     │
│   Ephemeral — spawned per GitHub Issue              │
│   Work concurrently unless blocked                  │
│   Commit to branches in project repo                │
│   Open PRs in project repo, then discard            │
│   Only roles justified by the spec are spun up      │
└─────────────────────────────────────────────────────┘
```

---

## Three-Repo Architecture

`agent-dev-team` uses a three-repo model. Each project gets its own dedicated GitHub repo.

```
agent-dev-team repo (this repo)
  └── Agent infrastructure only — Director, PM, Tech Lead, Coder

bessemer-state repo (usebessemer org — post v1.0.0)
  └── estimation-history.json — shared state across all Bessemer 

{project-name} repo (created per project by PM)
  ├── GitHub Issues — project task backlog
  ├── Coder branches — one per Issue
  ├── Pull Requests — one per Coder branch
  └── Merged code — final deliverables

```

This keeps `agent-dev-team` clean as infrastructure-only. Project code lives in its own deployable repo.

---

## Human Confirmation Gates

Nothing spins up without executive confirmation. Two hard gates before any work starts:

```
Gate 1 — Spec confirmation
  Director builds spec from executive brief
  Director → #approvals (type 'approve' or 'reject')
  approve → Director spins up PM + Tech Lead

Gate 2 — Cost estimate confirmation
  PM reads estimation-history.json
  PM builds cost estimate using local model
  PM → #approvals (type 'approve' or 'reject')
  approve → PM creates project repo + Issues, workers spawn
```

---

## Worker Execution Model

Workers are stateless, ephemeral agents. A fresh worker is spawned for each GitHub Issue in the project repo. Once the PR is opened, the worker is discarded.

**Spawn → Execute → PR → Discard**

**Context on spawn:**
- The GitHub Issue (the complete, self-contained task brief)
- Tech Lead's coding standards
- Only the specific files relevant to the task

**Failure handling:**
- Workers use a 3-attempt self-healing loop for commit failures
- On 3rd failure → escalation fires → Issue marked blocked, alert posted to #alerts
- Rejected PRs → Issue requeued → worker respawns

**One worker per PR — always:**
```
One GitHub Issue = One Worker = One Branch = One PR
No exceptions.
```

---

## Pipeline Flow

```
PHASE 1 — BRIEF
Executive → #director: "brief: {description}"
Director builds spec using local model
Director → #approvals (type 'approve' or 'reject')

PHASE 2 — TEAM SPINUP
Director spins up PM + Tech Lead (ephemeral, simultaneously)
Tech Lead defines coding standards immediately
PM reads estimation-history.json
PM builds cost estimate using local model
PM → #approvals (type 'approve' or 'reject')

PHASE 3 — PROJECT SETUP
PM creates GitHub repo for the project
PM creates GitHub Issues from spec deliverables in project repo

PHASE 4 — EXECUTION
watchIssues polls project repo for open Issues
Coder spawns per Issue (ephemeral)
Coder creates branch → generates code → commits → opens PR → discards
watchPRs polls project repo for open PRs
Tech Lead reviews PRs → scores → merges or rejects
Rejected PRs → Issue requeued → Coder respawns
Merged PRs → Issue closed explicitly → Tech Lead checks completion

PHASE 5 — CLOSE DETECTION
After each merge, Tech Lead checks for 0 open PRs + 0 open Issues
When complete:
  Tech Lead → #director: "Project {name} appears complete"
  Posts project repo link and close instructions

PHASE 6 — CLOSE CONFIRMATION
Executive reviews project repo on GitHub
Executive → #director: "close: {project-name}"
Pipeline writes actuals to estimation-history.json
PM + Tech Lead discard (Discord clients destroyed)
Director → #director: "Project {name} closed"
```

---

## Estimation Memory

PM reads from a shared estimation history file on spawn.

Location: `projects/estimation-history.json`

Post-v1.0.0 this will move to the `bessemer-state` repo under the `usebessemer` org.

---

## Discord Structure

```
📁 ORG-WIDE
  #director       ← briefs, specs, project status, close commands
  #efficiency     ← token usage reports (v1.1.0)
  #approvals      ← human confirmation gates (type 'approve'/'reject')
  #alerts         ← worker escalations and system issues
```

**Bot identity model:**

```
Persistent bots (3):
  🤖 Director
  🤖 Auditor
  🤖 Efficiency-Director

Per-project bots (2 per project — ephemeral):
  🤖 PM-{project-name}
  🤖 TechLead-{project-name}
```

---

## Known Limitations (v1.0.0)

- **Tech Lead self-approval** — GitHub prevents a bot from approving its own PRs. Tech Lead uses comment + direct merge. Fix in v1.1.0: separate GitHub account for Tech Lead bot.
- **Local model quality** — `llama3.1:8b` and `llama3.2` produce low quality code. Pipeline logic is correct. Quality improves with Claude API for workers.
- **Project name variability** — project name is model-generated and may vary. Fix in v1.1.0: executive specifies project name in brief.
- **Org-wide Discord channels** — all agents share org-wide channels. Per-project channels planned for v1.1.0.
- **Octokit deprecation warnings** — harmless, resolves in future Octokit release.

---

## Efficiency Module

A pluggable, standalone module. Lives in its own repo: [`efficiency-auditor`](https://github.com/usebessemer/efficiency-auditor).

Import and attach to any agent system. See that repo for full architecture and contracts.