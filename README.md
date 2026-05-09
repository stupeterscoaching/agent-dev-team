# agent-dev-team
 
A tiered AI agent system that builds software projects autonomously. Define a project brief in Discord, and the team plans, builds, reviews, and ships it — with human approval gates at every major decision point.
 
Part of the [Bessemer Agentic](https://github.com/usebessemer) open source ecosystem.
 
---
 
## How it works
 
```
You type a brief in Discord
        ↓
Director builds a project spec → you approve
        ↓
PM creates a GitHub repo + Issues → cost estimate → you approve
        ↓
Coders spawn per Issue → branch → code → PR
        ↓
Tech Lead reviews PRs → scores quality → merges
        ↓
Tech Lead detects completion → notifies you
        ↓
You type close: {project-name} → project closed
```
 
Every project gets its own GitHub repo. The `agent-dev-team` repo stays clean as infrastructure only.
 
---
 
## Agent hierarchy
 
```
┌─────────────────────────────────────────┐
│            DIRECTOR                     │
│         (persistent)                    │
│  Receives briefs, builds specs,         │
│  spins up managers, handles close       │
└──────────────────┬──────────────────────┘
                   │
       ┌───────────┴───────────┐
       │                       │
┌──────▼──────┐         ┌──────▼──────┐
│  PM AGENT   │         │  TECH LEAD  │
│ (ephemeral) │         │ (ephemeral) │
│             │         │             │
│  Project    │         │  Coding     │
│  repo setup │         │  standards  │
│  Issues     │         │  PR review  │
│  Estimates  │         │  PR merge   │
└──────┬──────┘         └─────────────┘
       │
┌──────▼──────────────────────────────────┐
│            CODER AGENTS                 │
│           (ephemeral)                   │
│  One per GitHub Issue                   │
│  Branch → code → PR → discard          │
└─────────────────────────────────────────┘
```
 
---
 
## Prerequisites
 
- [Node.js](https://nodejs.org) v18+
- [Ollama](https://ollama.com) running locally with at least one model pulled. The system uses three model tiers — Director, Manager, and Worker. Larger models produce better results at the Director and Manager tiers. Smaller, faster models work well for workers.
- A Discord server with 4 channels: `#director`, `#approvals`, `#alerts`, `#efficiency`
- 5 Discord bots created in the [Discord Developer Portal](https://discord.com/developers/applications):
  - `Director`, `Auditor`, `Efficiency-Director`, `PM-{project}`, `TechLead-{project}`
- A GitHub personal access token with `repo` scope
---

## Discord setup

1. Create a Discord server with these channels:
   - `#director` — briefs, specs, close commands
   - `#approvals` — confirmation gates
   - `#alerts` — worker escalations
   - `#efficiency` — future use

2. Go to [discord.com/developers/applications](https://discord.com/developers/applications) and create 5 bots:
   - `Director`
   - `Auditor`
   - `Efficiency-Director`
   - `PM-{your-project-name}`
   - `TechLead-{your-project-name}`

3. For each bot:
   - Go to **Bot** → enable **Message Content Intent**
   - Copy the bot token
   - Go to **OAuth2 → URL Generator** → select `bot` scope → invite to your server

4. Enable **Developer Mode** in Discord (**Settings → Advanced → Developer Mode**)

5. Right-click each channel and your server to copy IDs into your `.env` file
 
## Setup
 
```bash
# Clone the repo
git clone git@github.com:usebessemer/agent-dev-team.git
cd agent-dev-team
 
# Install dependencies
npm install
 
# Configure environment
cp .env.example .env
# Edit .env and fill in your tokens — see .env.example for all required values
 
# Start the system
npm start
```
 
---
 
## Usage
 
Once running, interact with the Director in your Discord `#director` channel:
 
```
# Start a new project
brief: build a calculator with a web interface
 
# When prompted in #approvals, type:
approve   ← confirms spec
approve   ← confirms cost estimate
 
# When the project is complete, the Tech Lead will notify you in #director
# Review the project repo on GitHub, then type:
close: {project-name}
```
 
---
 
## Environment variables
 
See `.env.example` for the full list. Key variables:
 
```bash
# Discord bot tokens
DIRECTOR_TOKEN=
PM_TOKEN=
TECHLEAD_TOKEN=
AUDITOR_TOKEN=
EFFICIENCY_DIRECTOR_TOKEN=
 
# Discord channel IDs
DISCORD_CHANNEL_DIRECTOR=
DISCORD_CHANNEL_APPROVALS=
DISCORD_CHANNEL_ALERTS=
DISCORD_CHANNEL_EFFICIENCY=
 
# GitHub
GITHUB_TOKEN=           # personal access token with repo scope
GITHUB_OWNER=           # your GitHub username or org
 
# Ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
DIRECTOR_MODEL=llama3.1:8b
MANAGER_MODEL=llama3.1:8b
WORKER_MODEL=llama3.2:latest
```
 
---
 
## Project structure
 
```
agent-dev-team/
├── src/
│   ├── agents/
│   │   ├── director/       ← persistent Director agent
│   │   ├── managers/       ← PM and Tech Lead agents
│   │   └── workers/        ← Coder agent
│   ├── contracts/          ← base message contracts
│   ├── discord/            ← Discord client utilities
│   └── pipeline/           ← orchestration layer
├── projects/
│   └── estimation-history.json
├── index.js                ← entry point
├── .env.example
├── ARCHITECTURE.md         ← read this before touching any code
├── CONTRIBUTING.md
└── LICENSE
```
 
---
 
## Known limitations (v1.0.0)
 
- **Local model quality** — `llama3.1:8b` produces functional but low quality code. Quality improves significantly when using Claude API for workers (v1.1.0).
- **Tech Lead self-approval** — GitHub prevents a bot from formally approving its own PRs. Tech Lead uses comment + direct merge instead.
- **Project name variability** — project names are model-generated and may vary between runs.
- **Org-wide Discord channels** — all agents share org-wide channels. Per-project channel creation coming in v1.1.0.
---
 
## Architecture
 
See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full system design, agent hierarchy, pipeline flow, and communication contracts.
 
---
 
## Contributing
 
See [CONTRIBUTING.md](./CONTRIBUTING.md).
 
---
 
## License
 
[MIT](./LICENSE) — Bessemer Agentic 2026