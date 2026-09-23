# Relevo

**Claude Code and Gemini working as one team, on your own subscriptions.**

Relevo ("relay" in Spanish) is a free, open-source [Claude Code](https://code.claude.com) plugin. It makes Claude the tech lead of a two-member team. The other member is Gemini, running through Google's official [Antigravity CLI](https://antigravity.google/docs/cli/) (`agy`).

- **They plan together.** Gemini drafts a plan, Claude critiques it, and Claude decides the final plan.
- **They split the work.** Gemini handles the volume: exploring code, implementing, tests, docs and research. Claude takes the parts that need judgment.
- **They review each other.** Claude reviews Gemini's diffs before applying them, and Gemini adversarially reviews Claude's code.
- **They share memory.** A team board and memory live in the project, alongside Claude's own memory and, optionally, your Obsidian vault.

**Why:** Claude usage runs out fast. With Relevo, the heavy lifting runs on your Google subscription, and Claude spends its quota on decisions and reviews.

> [Español](README.md) · English

## What do you need to connect?

| | What to do |
|---|---|
| **Claude** | **Nothing.** Relevo is a plugin: it runs **inside** your Claude Code (desktop app or terminal), which already uses your Claude Pro/Max account. |
| **Gemini** | Install the Antigravity CLI (`agy`) and **sign in once** with your Google AI Pro/Ultra account. If you already use the Antigravity app with that account, you are usually signed in already. |

No API keys and no passwords to paste anywhere. Each tool uses **your** official session, and Relevo never sees your credentials.

## Install (5 minutes)

### 1. Requirements

You need Node.js 18 or later and git. Check them with `node -v` and `git --version`.

### 2. Connect Gemini

**a) Install `agy`.**

```powershell
# Windows (PowerShell)
irm https://antigravity.google/cli/install.ps1 | iex
```

```bash
# macOS / Linux
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

**b) Sign in.** Open a **new** terminal, run `agy` and sign in with Google in the browser that opens. Exit `agy` with `/exit`.

### 3. Install Relevo

**Option A · Recommended.** Run this one command in a terminal. It works for both the desktop app and the terminal.

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/Piratapacorro/relevo/main/install.cjs | node
```

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/Piratapacorro/relevo/main/install.cjs | node
```

**Option B.** If you use Claude Code in the terminal, run this inside Claude Code:

```
/plugin marketplace add Piratapacorro/relevo
/plugin install relevo@relevo
```

`/plugin` is not available in the desktop app, so desktop users should use option A.

### 4. Restart and set up your project

1. Restart Claude (the app or the CLI) so it downloads Relevo.
2. Open your project.
3. Run `/relevo:iniciar`. It checks the connection, asks you to accept the Google terms notice below (first time only), sets up the project and asks about Obsidian.

### 5. Work

```
/relevo:equipo add a contact form with validation and tests
```

## Commands

| Command | What it does |
|---|---|
| `/relevo:equipo <goal>` | Full autonomous flow: context → plan → split work → cross review → tests → memory |
| `/relevo:preguntar <question>` | Quick question to Gemini (about your code, or research) that barely touches your Claude quota |
| `/relevo:revisar [R-n]` | Gemini adversarially reviews your current changes (or a given job), and Claude filters out false positives |
| `/relevo:estado` | Status of Gemini, the board and pending jobs |
| `/relevo:iniciar` | Set up the project and check that everything is connected |

## How it works

- **Isolated copy.** Gemini works in an isolated copy of your project (a `git worktree`). Nothing reaches your code until Claude reviews the diff and integrates it.
- **Projects without git** use a shadow repository stored outside your folder, so no `.git` ever appears in your project.
- **Everything can be undone.**
- **Zero dependencies.** Pure Node.js; runs on Windows (no WSL), macOS and Linux.

## ⚠️ Terms of service

- **Anthropic:** using the unmodified Claude Code with your own subscription is allowed. Relevo does not use the Agent SDK and never runs `claude -p`.
- **Google:** the [Antigravity terms](https://antigravity.google/terms) forbid using the service "in connection with products not provided by us", and the [FAQ](https://antigravity.google/docs/faq/) names Claude Code as third-party software.
  - Google documents scripted use of `agy`, but has **not clarified** whether running the official binary from another tool is allowed.
  - In 2026 Google suspended accounts that reused their Antigravity login in other apps. Relevo does not do that, but **the risk is real** and it is yours to take.
- **Risk-free alternative:** configure `agy` with a Google AI Studio API key.

Relevo is not affiliated with Anthropic or Google. Claude, Gemini and Antigravity are trademarks of their respective owners.

## Troubleshooting

| Symptom | Fix |
|---|---|
| The `/relevo:...` commands don't show up | Restart Claude. Plugins load at startup |
| "`/plugin` is not available" | You are in the desktop app: install with option A |
| Windows says `agy` is not recognized | Open a new terminal, or run `& "$env:LOCALAPPDATA\agy\bin\agy.exe"` |
| "Sesión de agy: NO iniciada" | Run `agy` in a terminal and sign in with Google |

## License

MIT
