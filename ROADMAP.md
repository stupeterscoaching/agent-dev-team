# Roadmap

This document captures where `agent-dev-team` is heading. The mission: **make agentic software development accessible to normal people, as real working software — not a toy.**

The v1.x milestones below are committed work, tracked as GitHub Issues. The v2.x section is directional — bets we may take once the v1.x foundations are solid.

---

## Shipped

### v1.0.0 — Foundations
First end-to-end pipeline: Director receives a brief on Discord, generates a spec, PM creates Issues, Coder workers open PRs, Tech Lead reviews and merges. All inside the `agent-dev-team` repo.

### v1.1.0 — Project repos + estimation memory
Each project gets its own GitHub repo (created by PM). Estimation history is written to a shared `bessemer-state` repo so it persists across projects. Approval timeouts made configurable.

### v1.2.0 — Specialized workers + per-project surfaces
- Per-project Discord channels — each project gets `#proj-{name}` with its own webhook, archived on close (#88)
- Researcher worker for `type:research` Issues (#90) — runs focused research, posts as Issue comment, no PR
- Writer worker for `type:docs` Issues (#91) — generates docs/READMEs through the same branch/PR flow as Coder
- Optional separate GitHub account for Tech Lead (#89) — unlocks formal `APPROVE` / `REQUEST_CHANGES` reviews

---

## v1.x — Making it real software

The v1.x line is about closing the gap between **what the docs claim** and **what the code does**. After v1.5 the system should be something a working developer can use without caveats.

### v1.2.1 — Hygiene
Pre-architectural cleanup. Small, orthogonal items that should be done before the big rewrites.
- CI: run tests on every PR via GitHub Actions
- Consolidate the six copies of `.env` parsing into one module
- Decide on the dead message-contract code — wire it through or delete it
- Delete legacy root directories (`managers/`, `workers/`, `orchestrator/`, `pipeline/`)
- Sync `README.md` and `ARCHITECTURE.md` with what the code actually does as of v1.2

### v1.3.0 — Agents that actually act
The single largest gap between this project and the rest of the field. Today the Coder is a one-shot text generator: prompt in, JSON out, commit. Modern coding agents work in a loop on real files with real tools. This milestone closes that gap.
- Docker sandbox per Coder, with the project repo checked out into the container
- Tool-using agentic Coder loop (Read / Edit / Write / Bash) iterating until tests pass
- Tech Lead pulls the PR branch, runs the project's tests in a sandbox, and merges only on green
- Replace `score >= 3` numeric merge gate with real verification signals (tests, build, lint)

### v1.4.0 — A Director that actually directs
Today `Director._assembleSpec()` returns the same hardcoded Express + Node spec for every brief. The model only extracts a project name and a one-sentence outcome.
- Multi-turn spec refinement — Director iterates on a spec with the user across multiple Discord messages
- Tech-stack-aware spec generation — Python, Go, Rust briefs produce Python/Go/Rust specs
- Real estimation: wire `projectType` through the spec, filter estimation history meaningfully, surface estimate-vs-actual

### v1.5.0 — Persistence + real concurrency
Today `activeProjects` is in-memory. A crash loses all in-flight state. `PM_TOKEN` and `TECHLEAD_TOKEN` are global env vars, so the system can only handle one project at a time even though the data model suggests otherwise.
- SQLite (or Postgres) for `activeProjects`, agent state, run history
- Crash recovery — resume in-flight projects on restart
- GitHub webhooks replace 30-second polling
- Per-project bot identity model — either dynamic bot provisioning or threaded single-bot with channel-scoped contexts

---

## v2.x and beyond — Directional bets

Not yet committed. These are the moves that would take the project from "real software a developer can use" to "real software a non-developer can use."

### Accessibility for non-developers
- **Web UI.** Submit a brief in a form. Watch agents work in real time. Approve costs. Browse generated repos. Discord stays as the advanced/transparent view, but it stops being the primary product surface.
- **Hosted demo.** A URL where anyone can try the system without setup. The single highest-leverage thing for OSS adoption.
- **One-command local setup.** `docker-compose up` brings up everything except bring-your-own-keys.

### Platform extensibility
- **Plugin system for worker types.** Stable interface (`run(issue, context) → PR | comment`) so third parties contribute Designer, SecurityAuditor, DataEngineer, DBA, MobileDev. This is how the project becomes a platform instead of an app.
- **Plugin system for managers and Directors.** Same idea, different tier.

### Economics + learning
- **Cost dashboard with actuals.** Track real $/project from Claude API usage. Surface estimate-vs-actual in the approval flow. Over time the estimator gets real feedback and becomes evidence-based instead of theatrical.
- **Self-improvement loop.** Accepted vs. rejected PRs become training signal — either fine-tune a local reviewer or evolve prompts/standards over time. This is the long-term moat.
- **Cross-project memory.** Extend the shared research store idea. Reusable patterns, "we already solved X" registry, components and approaches that get smarter as more projects ship.

---

## Principles

These hold across all milestones:

- **Working software over impressive demos.** If a feature works only on the happy path, it isn't shipped.
- **Humans control money.** Spec approval and cost approval are non-negotiable gates.
- **Context discipline.** Ephemeral agents stay ephemeral. Persistent context belongs to the Director and durable stores, not to workers.
- **GitHub is the source of truth.** Issues are the backlog; PRs are the work; merged commits are the deliverable. Don't rebuild what GitHub already gives us.
- **The Tech Lead is a real reviewer.** Not a score generator. After v1.3 the system never merges code it hasn't verified.
