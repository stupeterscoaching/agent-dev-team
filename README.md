# agent-dev-team

An AI agent dev team.

A general purpose, tiered AI agent system for building software projects. Define a project, and the team researches, plans, builds, and reviews it — with intelligence cascading down from frontier models to local workers, and insights bubbling back up.

---

## Architecture

```
┌─────────────────────────────────────────┐
│            DIRECTOR                     │
│         (Claude API)                    │
│                                         │
│  Business intelligence, architecture    │
│  decisions, quality control, strategy   │
└──────────────────┬──────────────────────┘
                   │
       ┌───────────┴───────────┐
       │                       │
┌──────▼──────┐         ┌──────▼──────┐
│  PM AGENT   │         │  TECH LEAD  │
│ (mid-tier)  │         │ (mid-tier)  │
│             │         │             │
│  Backlog    │         │  Code       │
│  Sprint     │         │  Review     │
│  Planning   │         │  Standards  │
└──────┬──────┘         └──────┬──────┘
       │                       │
       └───────────┬───────────┘
                   │
┌──────────────────▼──────────────────────┐
│            WORKER AGENTS                │
│           (local models)                │
│                                         │
│  Researcher │  Writer │  Coder          │
│                                         │
│  High volume, repetitive tasks          │
└─────────────────────────────────────────┘
```

### Information flow

- **Top-down:** Strategy, architecture decisions, and quality standards cascade from the Director through Managers to Workers
- **Bottom-up:** Worker insights, blockers, and outputs bubble up through Managers to the Director for review

---

## How it works

1. **Define a project** — add a config file to the `projects/` folder describing what you want to build
2. **The Director** reads the project spec and creates an architecture plan
3. **The PM Agent** breaks the plan into tasks and manages the backlog
4. **The Tech Lead** reviews worker output and enforces code quality
5. **Workers** execute tasks — researching, writing, and coding
6. **Output** is collected in the `output/` folder, reviewed by managers, and reported to the Director

---

## Model configuration

Models are assigned per tier in `config.json`. Swap any tier without touching the codebase:

```json
{
  "director": {
    "provider": "anthropic",
    "model": "claude-opus-4-6"
  },
  "managers": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001"
  },
  "workers": {
    "provider": "ollama",
    "model": "llama3.1:8b",
    "baseUrl": "http://127.0.0.1:11434"
  }
}
```

---

## Projects

Each project lives in its own folder under `projects/`. A project defines:

- **Goal** — what to build
- **Tasks** — the work to be done
- **Output format** — what the final artifact looks like

```
projects/
└── twitter-content/       ← example project
    ├── project.json       ← project spec
    └── output/            ← generated artifacts
```

See `projects/twitter-content/` for a working example.

---

## Prerequisites

- [Node.js](https://nodejs.org) v18+
- [Ollama](https://ollama.com) running locally with at least one model pulled
- An [Anthropic API key](https://console.anthropic.com) for the Director and Manager tiers

---

## Setup

```bash
# Clone the repo
git clone git@github.com:stupeterscoaching/agent-dev-team.git
cd agent-dev-team

# Install dependencies
npm install

# Add your Anthropic API key
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Run the team on a project
node pipeline/index.js --project twitter-content
```

---

## Project structure

```
agent-dev-team/
├── README.md
├── config.json          ← model assignments per tier
├── .env.example         ← environment variable template
├── orchestrator/        ← director layer
│   └── index.js
├── managers/            ← PM and tech lead agents
│   ├── pm.js
│   └── techlead.js
├── workers/             ← researcher, writer, coder agents
│   ├── researcher.js
│   ├── writer.js
│   └── dev.js
├── pipeline/            ← orchestration layer
│   └── index.js
├── projects/            ← one folder per project
│   └── twitter-content/
└── output/              ← generated artifacts
```

---

## Contributing

This project is designed to be forked, extended, and improved. A few principles:

- **Keep tiers modular** — each agent should be independently swappable
- **Config-driven models** — never hardcode a model name in agent logic
- **Insights bubble up** — workers should always return structured output that managers can act on
- **Document your projects** — if you build a new project config, share it

Pull requests welcome.

---

## License

MIT
