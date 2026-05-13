# Contributing to agent-dev-team
 
Thanks for your interest in contributing. This project is part of the [Bessemer Agentic](https://github.com/usebessemer) open source ecosystem.
 
---
 
## Before you start
 
Read [ARCHITECTURE.md](./ARCHITECTURE.md) before touching any code. It defines the system design, agent hierarchy, and pipeline flow. Every contribution should align with the principles laid out there.
 
---
 
## Branching
 
```
main        ← stable releases only
develop     ← integration branch
feature/*   ← your work goes here
```
 
Never commit directly to `main` or `develop`. Always open a PR.
 
```bash
git checkout develop
git checkout -b feature/your-feature-name
```
 
---
 
## Pull Requests
 
- **Base branch:** `develop` (never `main`)
- **Title:** use conventional commit format — `feat:`, `fix:`, `chore:`, `docs:`
- **Description:** explain what you built and why
- **One PR per feature** — keep PRs small and focused
---
 
## Commit messages
 
Follow [Conventional Commits](https://www.conventionalcommits.org):
 
```
feat: add researcher worker agent
fix: handle JSON parse failure in coder
chore: remove debug logs
docs: update ARCHITECTURE.md with project repo flow
```
 
---
 
## Code style
 
- No linter enforced yet — use common sense
- Clear, descriptive variable and function names
- A comment above every function explaining what it does
- Handle errors explicitly — no silent failures
- Keep functions small and single-purpose
- No hardcoded values — use constants or `.env`
---
 
## Environment setup
 
```bash
git clone git@github.com:usebessemer/agent-dev-team.git
cd agent-dev-team
npm install
cp .env.example .env
# Fill in your tokens — see .env.example for required values
npm start
```
 
You'll need:
- Node.js v18+
- [Ollama](https://ollama.com) running locally with `llama3.1:8b` and `llama3.2` pulled
- Discord bots set up (see README)
- A GitHub personal access token with `repo` scope
---
 
## Reporting issues
 
Open a GitHub Issue with:
- A clear description of the problem
- Steps to reproduce
- Terminal output or error messages
- Your Node.js and Ollama versions
---
 
## License
 
By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).