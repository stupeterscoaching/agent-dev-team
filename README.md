# Project Automator Bot

A Discord + GitHub automation system that takes project requests from Discord, creates GitHub repositories with bootstrapped issues, and manages the approval workflow — all without leaving your chat.

---

## What it looks like

### Discord: Director → #approvals → #proj-{name} flow

![Discord approval workflow showing a Director submitting a project request in #approvals, the bot creating a dedicated #proj-storefront-redesign channel, and team members reacting to approve](docs/screenshots/discord-approval-flow.png)

*A Director posts a project request in **#approvals**. The bot parses the request, opens a dedicated **#proj-{name}** channel, and pings the relevant stakeholders. Once the required approvals (👍 reactions) are collected, the bot triggers repository creation automatically.*

### GitHub: Auto-generated repo with Issues and merged PR

![GitHub repository view showing an auto-generated repo named storefront-redesign with 12 open issues created from the project brief and a merged pull request titled 'chore: initial scaffold'](docs/screenshots/github-auto-repo-issues-pr.png)

*The bot creates the repository, populates it with labelled Issues derived from the project brief, and opens — then auto-merges — a scaffold PR that wires up the base file structure, CI workflow, and branch protection rules.*

---

## How it works

```
Discord #approvals
     │
     │  Director posts /project request
     ▼
  Bot parses request & creates #proj-{name} channel
     │
     │  Stakeholders react 👍 (quorum reached)
     ▼
  GitHub API called
     ├─ New repo created (org/{project-name})
     ├─ Issues created from brief sections
     └─ Scaffold PR opened + auto-merged
     │
     ▼
  Bot posts summary back to #proj-{name}
```

---

## Quick start

### Prerequisites

- Node.js 18+
- A Discord application with a bot token ([guide](https://discord.com/developers/docs/getting-started))
- A GitHub App or Personal Access Token with `repo` and `issues` scopes

### Installation

```bash
git clone https://github.com/your-org/project-automator-bot.git
cd project-automator-bot
npm install
```

### Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

```env
# .env
DISCORD_TOKEN=your-discord-bot-token
DISCORD_GUILD_ID=your-server-id
DISCORD_APPROVALS_CHANNEL_ID=channel-id-for-approvals
APPROVAL_QUORUM=3

GITHUB_TOKEN=ghp_your_token
GITHUB_ORG=your-github-org
```

### Run

```bash
npm start
```

The bot will come online in your Discord server and begin listening for `/project` commands in any channel it has access to, and for reactions in the configured **#approvals** channel.

---

## Commands

| Command | Where | Description |
|---|---|---|
| `/project new` | Any channel | Opens a modal to submit a new project request |
| `/project status` | #proj-* channel | Prints current approval count and repo link |
| `/project cancel` | #proj-* channel | Cancels a pending request (Director only) |

---

## Approval workflow in detail

1. A Director runs `/project new` and fills in the project name, description, and list of deliverables.
2. The bot posts a formatted embed in **#approvals** and creates a private **#proj-{name}** channel.
3. Designated approvers react with 👍 to the embed. The bot tracks unique reactions.
4. Once `APPROVAL_QUORUM` approvers have reacted, the bot automatically proceeds to GitHub provisioning.
5. A summary embed is posted in **#proj-{name}** with links to the new repo, issues, and the merged scaffold PR.

---

## GitHub provisioning in detail

When an approval quorum is reached the bot:

1. Creates `{GITHUB_ORG}/{project-name}` as a private repository.
2. Pushes a scaffold commit containing:
   - `.github/workflows/ci.yml` — lint + test pipeline
   - `README.md` — auto-populated from the project brief
   - `CODEOWNERS` — set to the Director who raised the request
3. Opens issues for each deliverable listed in the brief, labelled `scope: initial`.
4. Opens a PR titled `chore: initial scaffold` and merges it immediately.
5. Applies branch protection to `main` (requires 1 review, passing CI).

---

## Contributing

Pull requests are welcome. Please open an issue first to discuss larger changes.

```bash
npm test        # run the test suite
npm run lint    # ESLint + Prettier check
```

---

## License

MIT
