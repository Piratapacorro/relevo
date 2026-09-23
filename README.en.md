# Relevo

**Claude Code and Gemini working as one team, on your own subscriptions.**

Relevo ("relay" in Spanish) is a free, open-source [Claude Code](https://code.claude.com) plugin. It makes Claude the tech lead of a two-member team. The other member is Gemini, running through Google's official [Antigravity CLI](https://antigravity.google/docs/cli/) (`agy`).

- **They plan together.** Gemini drafts a plan, Claude critiques it, and Claude decides the final plan.
- **They split the work by specialty.** Gemini handles the volume (exploring code, implementing, tests, docs, research). Claude takes the parts that need judgment.
- **They review each other.** Claude reviews Gemini's diffs, and Gemini adversarially reviews Claude's code.
- **They share memory.** A team board and memory live in the project, alongside Claude's own memory and your Obsidian vault.

No API keys: each person uses **their own** Claude Pro/Max and Google AI Pro/Ultra by signing in to the official tools.

> [Español](README.md) · English

## Why

Claude usage runs out fast. With Relevo, Gemini does the heavy lifting on your Google subscription: reading half the repo, writing boilerplate, running tests. Claude receives compact reports and spends its quota on decisions and reviews.

## How it works

- **Isolated copy by default.** Gemini works in a `git worktree` outside your project. Nothing reaches your code until Claude reviews the diff and integrates it.
  - Projects **without git** get a "shadow" repository stored outside your folder, so no `.git` ever appears in your project.
  - Everything can be undone.
- **No credentials handled.** Relevo only runs the official `agy` binary with the session you signed in to yourself. It never reads, stores or forwards tokens.
- **Zero dependencies.** Pure Node.js; runs on **Windows (no WSL), macOS and Linux**.

## Requirements

- Claude Code (recent; tested with 2.1.275), signed in with Claude Pro or Max
- Node.js 18 or later
- git
- `agy` 1.2.6 or later, signed in with Google AI Pro or Ultra

## Install

**1. Install `agy`.**

```bash
# macOS / Linux
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

```powershell
# Windows (PowerShell)
irm https://antigravity.google/cli/install.ps1 | iex
```

**2. Sign in to `agy`.** Run `agy` once in a new terminal and sign in with your Google account in the browser that opens.

**3. Install Relevo in Claude Code.**

```
/plugin marketplace add piratapacorro/relevo
/plugin install relevo@relevo
```

**4. Set up your project.** Run `/relevo:iniciar`. The first time, it walks you through the Google terms notice below and asks you to accept it.

## Commands

| Command | What it does |
|---|---|
| `/relevo:equipo <goal>` | Full autonomous flow: context → debated plan → split work → cross review → tests → memory |
| `/relevo:preguntar <question>` | Quick question to Gemini (research or codebase exploration) that barely touches your Claude quota |
| `/relevo:revisar [R-n]` | Gemini adversarially reviews your current changes (or a given job), and Claude filters out false positives |
| `/relevo:estado` | Status of `agy`, the board and pending jobs |
| `/relevo:iniciar` | Set up the project and check that everything is ready |

## ⚠️ Terms of service

- **Anthropic:** using the unmodified Claude Code with your own subscription is allowed. Relevo does not use the Agent SDK and never runs `claude -p`.
- **Google:** the [Antigravity terms](https://antigravity.google/terms) forbid using the service "in connection with products not provided by us", and the [FAQ](https://antigravity.google/docs/faq/) names Claude Code as third-party software.
  - Google documents scripted use of `agy`, but has **not clarified** whether running the official binary from another tool is allowed.
  - In 2026 Google suspended accounts that reused their Antigravity login in other apps. Relevo does not do that, but **the risk is real** and it is yours to take.
- **Risk-free alternative:** configure `agy` with a Google AI Studio API key.

Relevo is not affiliated with Anthropic or Google. Claude, Gemini and Antigravity are trademarks of their respective owners.

## License

MIT
