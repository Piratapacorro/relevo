# Relevo

**Claude Code and Gemini working as one team, on your own subscriptions.**

Relevo ("relay" in Spanish) is a free [Claude Code](https://code.claude.com) plugin. It makes Claude work as a team with Gemini, through Google's official [Antigravity CLI](https://antigravity.google/docs/cli/).

- **They split the work.** Gemini does the heavy lifting (reading code, implementing, running tests, research), while Claude decides and reviews.
- **They review each other.** Nothing Gemini does reaches your project until Claude approves it.
- **They remember.** A team board and memory live in your project, plus an optional session log in your Obsidian vault.

**Why:** Claude usage runs out fast. With Relevo, the heavy lifting runs on your Google subscription.

> [Español](README.md) · English

## Install

**You need:**
- **Claude Code** (the Claude desktop app or the terminal) with your **Claude Pro or Max** account.
- A **Google account with AI Pro or Ultra**.

No API keys and no passwords to paste.

### Step 1 · Run the installer

<details open>
<summary><b>Windows</b></summary>

1. Press <kbd>Windows</kbd>, type **PowerShell** and open it.
2. Paste this line and press <kbd>Enter</kbd>:

```powershell
irm https://raw.githubusercontent.com/Piratapacorro/relevo/main/install.ps1 | iex
```
</details>

<details>
<summary><b>Mac / Linux</b></summary>

1. Open **Terminal**.
2. Paste this line and press <kbd>Enter</kbd>:

```bash
curl -fsSL https://raw.githubusercontent.com/Piratapacorro/relevo/main/install.sh | bash
```

> No `curl` on your Linux? Use `wget -qO- https://raw.githubusercontent.com/Piratapacorro/relevo/main/install.sh | bash`, or first run `sudo apt install curl`.
</details>

The installer checks your machine and **asks before installing anything**:
1. It checks for curl, git and Node.js 18+, and installs them if missing. It uses winget on Windows, apt/dnf/pacman on Linux and Homebrew on Mac.
2. It installs Claude Code with Anthropic's official installer, if you don't have it.
3. It installs Google's official Antigravity CLI (`agy`), if needed.
4. It enables Relevo in Claude Code, after backing up your settings.
5. It checks that `agy` is signed in to your Google account.

The installer messages are in Spanish.

### Step 2 · Sign in to Google (first time only)

If the installer asks, sign in with your **Google AI Pro/Ultra** account in the browser that opens. Then, back in the terminal, type `/exit` when the `agy` chat appears.

### Step 3 · Use it

1. **Restart** the Claude app (or Claude Code in the terminal). It downloads Relevo on startup.
2. Open your project and type `/relevo:iniciar`.
3. Then ask the team for work:

```
/relevo:equipo add a contact form with validation and tests
```

<details>
<summary><b>Other ways to install</b></summary>

**Inside Claude Code in the terminal:**
```
/plugin marketplace add Piratapacorro/relevo
/plugin install relevo@relevo
```
The desktop app has no `/plugin` command.

**Manually:**
1. Install the [Antigravity CLI](https://antigravity.google/docs/cli/install/) and run `agy` once to sign in.
2. Add this to `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": { "relevo": { "source": { "source": "github", "repo": "Piratapacorro/relevo" } } },
  "enabledPlugins": { "relevo@relevo": true }
}
```

Relevo needs Node.js 18+ and git.
</details>

## Commands

| Command | What it does |
|---|---|
| `/relevo:equipo <goal>` | Full teamwork flow: context → plan → split work → review → tests → memory |
| `/relevo:preguntar <question>` | Quick question to Gemini (about your code, or research) that barely touches your Claude quota |
| `/relevo:revisar` | Gemini closely reviews your current changes, and Claude keeps what really matters |
| `/relevo:estado` | Team status: Gemini, tasks and pending jobs |
| `/relevo:iniciar` | Set up the project and check that everything is connected |

## ⚠️ Terms of service

- **Anthropic:** using Claude Code with your own subscription is allowed. Relevo does not use the Agent SDK or `claude -p`.
- **Google:** the [Antigravity terms](https://antigravity.google/terms) forbid using the service "in connection with products not provided by us", and the [FAQ](https://antigravity.google/docs/faq/) names Claude Code.
  - Relevo only runs the official `agy` program with your own session, but Google **has not clarified** whether that is allowed.
  - **The risk is yours to take.**
- **Risk-free alternative:** configure `agy` with a Google AI Studio API key.

Relevo is not affiliated with Anthropic or Google. Claude, Gemini and Antigravity are trademarks of their respective owners.

## Troubleshooting

| Problem | Fix |
|---|---|
| The `/relevo:...` commands don't show up | Restart the Claude app. Plugins load at startup |
| The installer can't install Node.js or git | Install them from [nodejs.org](https://nodejs.org) (LTS) and [git-scm.com](https://git-scm.com), open a new terminal and run the installer again |
| "Sesión de agy: NO iniciada" (agy not signed in) | Run the installer again and accept to sign in, or run `agy` in a new terminal |

## License

MIT
