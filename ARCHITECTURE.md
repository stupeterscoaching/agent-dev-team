# Architecture

This document defines the complete system architecture for `agent-dev-team`. Read this before touching any code.

---

## Overview

`agent-dev-team` is a tiered AI agent system that mirrors a real software development workflow. Agents communicate via Discord, manage work via GitHub Issues and Pull Requests, and are monitored by the pluggable [`efficiency-auditor`](https://github.com/stupeterscoaching/efficiency-auditor) module.

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
└──────────────────────┬──────────────────────────────┘
                       │ confirmed spec
           ┌───────────┴───────────┐
           │                       │
┌──────────▼──────┐       ┌────────▼────────┐
│    PM AGENT     │       │   TECH LEAD     │
│  (ephemeral)    │       │   (ephemeral)   │
│                 │       │                 │
│  GitHub Issues  │       │  Code review    │
│  Sprint mgmt    │       │  PR approval    │
│  Discord setup  │       │  Quality scores │
│  Cost estimates │       │  Cost estimates │
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
│   Commit to branches, open PRs, then discard        │
│   Only roles justified by the spec are spun up      │
└─────────────────────────────────────────────────────┘
```

---

## Human Confirmation Gates

Nothing spins up without executive confirmation. Two hard gates before any work starts:

```
Gate 1 — Spec confirmation
  Director builds spec collaboratively with executive
  Director → executive (#approvals ✅/❌)
  ✅ → Director spins up PM + Tech Lead

Gate 2 — Cost estimate confirmation
  PM + Tech Lead read estimation-history.json
  PM + Tech Lead build cost estimate
  PM + Tech Lead → executive (#approvals ✅/❌)
  ✅ → PM + Tech Lead spin up workers
```

---

## Worker Execution Model

Workers are stateless, ephemeral agents. A fresh worker is spawned for each GitHub Issue. Once the PR is opened, the worker is discarded.

**Spawn → Execute → PR → Discard**

**Context on spawn — nothing else:**
- The GitHub Issue (the complete, self-contained task brief)
- `project.json` (project spec)
- Tech Lead's coding standards
- Only the specific files relevant to the task

**Why this matters:**
Context pollution degrades model reasoning. By giving workers only what they need for a single task, token usage stays minimal, output quality stays high, and the Efficiency Auditor's data stays clean.

**Failure handling — deterministic execution:**
- Workers use strict exact-match search/replace blocks for code edits
- If output doesn't match the file state exactly, the edit fails loudly
- Worker enters a self-healing loop (max 3 attempts)
- On 3rd failure → escalation contract fires → task returned to PM as blocked

**One worker per PR — always:**
```
One GitHub Issue = One Worker = One Branch = One PR
No exceptions.
```

This eliminates merge conflicts at the worker level entirely.

**PM Agent responsibility:**
Because workers have no shared memory, every GitHub Issue must be completely self-contained. The PM Agent is responsible for writing Issues that a worker can execute with zero additional context. This is the most important constraint in the system.

---

## Project Spec Format

The spec is built collaboratively between the executive and the Director before any agents spin up.

**What the executive provides — the Brief:**

```json
{
  "brief": {
    "projectName": "string",
    "problemStatement": "what problem does this solve and for who",
    "desiredOutcome": "what does success look like from the user's perspective",
    "constraints": {
      "budget": 0,
      "currency": "CAD",
      "timeline": "string",
      "technical": []
    },
    "examples": [],
    "antiGoals": []
  }
}
```

**What the Director builds from the brief — the Spec:**

```json
{
  "spec": {
    "projectName": "string",
    "version": "1.0.0",
    "createdAt": "ISO8601",
    "brief": {},
    "architecture": {
      "overview": "string",
      "components": [],
      "dataFlow": "string",
      "techStack": {
        "language": "string",
        "runtime": "string",
        "packages": []
      }
    },
    "team": {
      "workers": [],
      "managers": ["pm", "techlead"],
      "efficiency": true
    },
    "models": {
      "director": "claude-opus-4-6",
      "managers": "claude-haiku-4-5-20251001",
      "workers": "llama3.1:8b"
    },
    "deliverables": [
      {
        "name": "string",
        "type": "code | content | research",
        "description": "string",
        "acceptanceCriteria": []
      }
    ],
    "openQuestions": []
  }
}
```

**Anti-goals** are as important as goals — they constrain the Director's architecture decisions and prevent scope creep before it starts.

**Open questions** let the Director flag ambiguity before building. The Director posts these to `#approvals` and waits for executive clarification before finalising the spec.

---

## Estimation Memory

PM and Tech Lead read from a shared estimation history file on spawn. This gives ephemeral agents institutional memory without persistent context.

Location: `projects/estimation-history.json`

```json
{
  "projects": [
    {
      "projectName": "string",
      "projectType": "web-app | cli | content | research",
      "completedAt": "ISO8601",
      "estimate": {
        "hours": 0,
        "cost": 0,
        "currency": "CAD"
      },
      "actuals": {
        "hours": 0,
        "cost": 0,
        "currency": "CAD"
      },
      "variance": 0,
      "notes": "string"
    }
  ]
}
```

After each project closes, the Efficiency Auditor writes actuals back to this file via a PR. Estimation accuracy improves over time as the history grows.

---

## Pipeline Flow

The complete end-to-end sequence:

```
PHASE 1 — BRIEF
Executive → Director (high level brief via Discord #director)
Director iterates, asks clarifying questions via #approvals
Executive confirms ✅

PHASE 2 — SPEC
Director builds project.json
Director → Executive (spec review via #approvals)
Executive confirms ✅

PHASE 3 — TEAM SPINUP
Director spins up PM + Tech Lead (ephemeral)
PM + Tech Lead read estimation-history.json
PM + Tech Lead build cost estimate
PM + Tech Lead → Executive (cost estimate via #approvals)
Executive confirms ✅

PHASE 4 — PROJECT SETUP
PM creates GitHub repo labels
PM creates Discord project channels
PM creates GitHub Issues from spec deliverables
PM → Tech Lead (coding standards for this project)

PHASE 5 — EXECUTION
Workers spawn per Issue (ephemeral)
Workers execute → open PRs → discard
Tech Lead reviews PRs → scores quality → merges or rejects
Rejected PRs → worker respawns with feedback in Issue
Efficiency Auditor observes all traffic passively
Insights bubble up via insight contracts
Escalations fire as needed

PHASE 6 — CLOSE
All Issues closed
Tech Lead → PM (final quality report)
PM → Director (project summary)
Efficiency Auditor writes actuals to estimation-history.json via PR
PM + Tech Lead discard
Director → Executive (project complete, summary in #output)
```

---

## Efficiency Module

A pluggable, standalone module. Lives in its own repo: [`efficiency-auditor`](https://github.com/stupeterscoaching/efficiency-auditor).

Import and attach to any agent system. See that repo for full architecture and contracts.

---

## Discord Structure

Discord is the real-time visibility and communication layer. GitHub is the source of truth for work.

```
📁 ORG-WIDE
  #director       ← strategic decisions across all projects
  #efficiency     ← token usage and optimisation reports
  #approvals      ← human confirmation gates (✅/❌)
  #alerts         ← system-wide issues requiring attention

📁 proj-{project-name}   ← created by PM Agent on project start
  #director       ← project-level strategy
  #managers       ← PM and Tech Lead coordination
  #workers        ← worker webhook posts
  #output         ← final deliverables for human review
```

**Bot identity model:**

```
Persistent bots (3 — always exist):
  🤖 Director
  🤖 Auditor
  🤖 Efficiency-Director

Per-project bots (2 per project — ephemeral):
  🤖 PM-{project-name}
  🤖 TechLead-{project-name}

Workers — webhooks only:
  Posts via dynamic webhook with name and avatar
  e.g. "Coder-task-042" or "Researcher-task-017"
  No bot token, no persistent identity
  Discarded with the worker
```

The Director never needs direct Discord comms with a front-line worker. That's what managers are for.

---

## State Management

State lives in three places — no additional database required.

| State | Location |
|---|---|
| Task backlog | GitHub Issues |
| Active work | GitHub Branches |
| Completed work | Merged PRs |
| Live context | Discord channels |
| Token usage | efficiency-auditor module |
| Estimation history | `projects/estimation-history.json` |
| Project spec | `projects/{name}/project.json` |
| Agent config | `config.json` |

**GitHub Issues conventions:**

```
Labels:
  tier:     director | manager | worker
  agent:    pm | techlead | researcher | writer | coder
  status:   backlog | in-progress | review | complete | blocked
  project:  {project-name}
  priority: low | medium | high | critical

Branch naming: {agent}/{taskId}/{short-description}
Example: coder/task-001/add-tweet-formatter
```

**GitHub Issues as task briefs:**

Each Issue is the complete world for the worker that picks it up. Issues must include:
- Clear objective
- Relevant file paths
- Acceptance criteria
- Any constraints or dependencies
- Links to relevant prior PRs if needed

---

## Communication Protocol

**Synchronous** — sender waits for acknowledgement before continuing:
```
Director → PM             task assignment
Director → TechLead       task assignment
Manager → Worker          Issue assignment
```

**Asynchronous** — sender fires and continues:
```
Manager ← Worker          result (PR opened)
Director ← Manager        report
Director/Manager ← Any    insight
Director/Manager ← Any    escalation
Director ← Efficiency     recommendation
```

**Concurrency rules:**
- Director fires PM and TechLead simultaneously on project start
- Workers self-assign from GitHub Issues immediately on task completion
- Workers operate concurrently — no waiting unless explicitly blocked
- Insights and escalations interrupt pipeline immediately

---

## Error Handling

**Category 1 — Worker errors (self-healing first)**

| Error | Handling |
|---|---|
| `edit-mismatch` | Self-heal up to 3 attempts, then escalate to PM |
| `context-insufficient` | Escalate to PM immediately |
| `model-timeout` | Retry once, then escalate |
| `output-rejected` | One revision attempt, then escalate |

**Category 2 — Manager errors**

| Error | Handling |
|---|---|
| `backlog-empty` | Director notified |
| `quality-deadlock` | 3 review cycles with no resolution → Director notified |

**Category 3 — System errors (straight to #alerts)**

| Error | Handling |
|---|---|
| `model-unavailable` | Ollama down or API key invalid |
| `github-api-failure` | Can't read/write Issues or PRs |
| `discord-api-failure` | Can't post to channels |
| `budget-exceeded` | Token spend limit hit |

---

## Agent Contracts

Every message passed between agents uses this base structure:

```javascript
{
  id: "uuid",
  timestamp: "ISO8601",
  from: {
    agent: "director | pm | techlead | researcher | writer | coder",
    tier: "director | manager | worker"
  },
  to: {
    agent: "agent name",
    tier: "tier name"
  },
  type: "task | result | insight | escalation | feedback",
  priority: "low | medium | high | critical",
  payload: {},
  context: {},
  discord: {
    channel: "channel name",
    threadId: "optional"
  }
}
```

### Director → PM/TechLead (task)
```javascript
payload: {
  project: "project name",
  goal: "what we're building",
  constraints: [],
  successCriteria: []
}
```

### Manager → Worker (task)
```javascript
payload: {
  taskId: "unique id",
  taskType: "research | write | code | review",
  description: "what to do",
  inputs: [],
  expectedOutput: "description of deliverable",
  deadline: "ISO8601"
}
```

### Manager ← Worker (result)
```javascript
payload: {
  taskId: "matches original task",
  status: "complete | partial | blocked",
  output: {
    type: "research | content | code",
    data: {}
  },
  insights: [
    {
      observation: "string",
      relevance: "why this matters",
      suggestedAction: "optional"
    }
  ],
  blockers: [],
  metrics: {
    tokensUsed: 0,
    timeElapsed: 0,
    attempts: 0
  }
}
```

### Director ← Manager (report)
```javascript
payload: {
  period: "session | daily | weekly",
  project: "project name",
  status: "on-track | at-risk | blocked",
  completedTasks: [],
  pendingTasks: [],
  insights: [],
  efficiencyFlags: []
}
```

### Director/Manager ← Any (escalation)
```javascript
payload: {
  taskId: "original task id",
  escalatingAgent: "agent name + tier",
  reason: "blocked | quality-threshold-exceeded | out-of-scope | resource-limit",
  description: "what happened and why it can't continue",
  attemptsMade: 0,
  lastOutput: {},
  suggestedResolution: "optional",
  requiresHuman: true
}
```

### Director/Manager ← Any (insight)
```javascript
payload: {
  sourceTask: "taskId that triggered the insight",
  observation: "string",
  confidence: "low | medium | high",
  relevance: "why this matters",
  suggestedAction: "optional",
  urgency: "low | medium | high | critical",
  requiresDecision: true
}
```

### Director/Manager ← Efficiency Director (escalation revert)
```javascript
payload: {
  originalChange: {
    taskType: "string",
    agent: "string",
    fromModel: "string",
    toModel: "string",
    changedAt: "ISO8601"
  },
  failureReason: "quality-drop | completion-failure | timeout",
  qualityDelta: {
    before: 0,
    after: 0,
    threshold: 0
  },
  proposedRevert: {
    toModel: "string",
    tier: "string",
    estimatedCostIncrease: 0
  },
  requiresExecutiveApproval: true,
  discordChannel: "#approvals"
}
```
