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

This system is influenced by [Late](https://github.com/mlhher/late)'s approach to agent orchestration: strict context discipline, ephemeral worker context windows, and deterministic execution. The core insight is that context pollution actively degrades model reasoning — research shows models can lose 60-80% of their effectiveness within 2-3 attempts when context is bloated.

Our solution: persistent global context at the top, ephemeral isolated context at the worker level.

---

## Agent Hierarchy

```
┌─────────────────────────────────────────────────────┐
│                    DIRECTOR                         │
│               (Claude Opus — API)                   │
│                                                     │
│  Strategy, architecture, quality control            │
└──────────────────────┬──────────────────────────────┘
                       │
           ┌───────────┴───────────┐
           │                       │
┌──────────▼──────┐       ┌────────▼────────┐
│    PM AGENT     │       │   TECH LEAD     │
│  (mid-tier)     │       │   (mid-tier)    │
│                 │       │                 │
│  GitHub Issues  │       │  Code review    │
│  Sprint mgmt    │       │  PR approval    │
│  Discord setup  │       │  Quality scores │
└──────────┬──────┘       └────────┬────────┘
           │                       │
           └───────────┬───────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                 WORKER AGENTS                       │
│              (Ollama — local models)                │
│                                                     │
│   Researcher      Writer        Coder               │
│                                                     │
│   Ephemeral context — spawned per GitHub Issue      │
│   Work concurrently unless blocked                  │
│   Commit to branches, open PRs, then discard        │
└─────────────────────────────────────────────────────┘
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
Context pollution degrades model reasoning. By giving workers only what they need for a single task, we keep token usage minimal, output quality high, and the Efficiency Auditor's data clean.

**Failure handling — deterministic execution:**
- Workers use strict exact-match search/replace blocks for code edits
- If output doesn't match the file state exactly, the edit fails loudly
- Worker enters a self-healing loop (max 3 attempts)
- On 3rd failure → escalation contract fires → task returned to PM as blocked

**PM Agent responsibility:**
Because workers have no shared memory, every GitHub Issue must be completely self-contained. The PM Agent is responsible for writing Issues that a worker can execute with zero additional context. This is the most important constraint in the system.

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
  #approvals      ← human approval requests (✅/❌)
  #alerts         ← system-wide issues requiring attention

📁 proj-{project-name}   ← created by PM Agent on project start
  #director       ← project-level strategy
  #managers       ← PM and Tech Lead coordination
  #workers        ← researcher, writer, coder outputs
  #output         ← final deliverables for human review
```

**Bot identities — one Discord bot per agent:**

| Bot | Role |
|---|---|
| 🤖 Director | Strategic decisions |
| 🤖 PM-Agent | Backlog and sprint management |
| 🤖 TechLead-Agent | Code review and quality |
| 🤖 Researcher-Agent | Research tasks |
| 🤖 Writer-Agent | Content tasks |
| 🤖 Coder-Agent | Development tasks |
| 🤖 Auditor | Efficiency monitoring (from efficiency-auditor) |
| 🤖 Efficiency-Director | Optimisation recommendations (from efficiency-auditor) |

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
Example: researcher/task-001/ai-agent-news-scrape
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
Manager → Worker          task assignment
```

**Asynchronous** — sender fires and continues:
```
Manager ← Worker          result
Director ← Manager        report
Director/Manager ← Any    insight
Director/Manager ← Any    escalation
Director ← Efficiency     recommendation
```

**Concurrency rules:**
- Director fires PM and TechLead simultaneously on project start
- Workers self-assign from GitHub Issues immediately on task completion
- No waiting unless explicitly blocked
- Insights and escalations interrupt pipeline immediately

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

---

## What's next

⬜ Error handling
⬜ Project spec format
⬜ Pipeline flow
