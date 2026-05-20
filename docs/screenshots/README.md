# Screenshots

This directory holds the visual assets embedded in the root `README.md`.

## Required files

| Filename | Contents |
|---|---|
| `discord-approval-flow.png` | Discord view: Director posting in **#approvals**, the bot's approval embed, and the auto-created **#proj-{name}** channel visible in the sidebar |
| `github-auto-repo-issues-pr.png` | GitHub view: the auto-generated repository with the Issues tab open (showing bootstrapped issues) and the merged scaffold PR visible in the Pull Requests tab or commit history |

## Capture guidelines

- Resolution: **1440 × 900 px** minimum (Retina/HiDPI preferred — export at 2×).
- Format: **PNG** (lossless; avoids JPEG compression artefacts on text).
- Discord: use the Light or Dark theme — Dark is preferred for contrast.
- GitHub: default Light theme so issue labels and status badges render clearly.
- Crop out personal profile pictures and real email addresses before committing.
- Run `optipng -o5 *.png` or similar to compress before pushing.

## Updating screenshots

When the workflow changes in a way that makes the existing screenshots misleading, replace the relevant file in this directory and open a PR. The root `README.md` image references use relative paths and will pick up the new file automatically.
