# claude-code-diy — AI Agent Installation Guide

This document is written for AI coding agents (Claude Code, Cursor, Copilot, etc.).
Follow these steps sequentially to install and configure claude-code-diy for the user.

---

## Prerequisites Check

Run these commands to verify prerequisites:

```bash
node --version   # Must be >= 18.0.0
git --version    # Must be installed
```

If Node.js < 18 or missing: tell the user to install Node.js LTS from https://nodejs.org and re-run.

---

## Step 1 — Clone the Repository

```bash
git clone https://github.com/cookiesheep/claude-code-diy.git
cd claude-code-diy
```

---

## Step 2 — Install Dependencies

```bash
npm install
```

If this fails due to network issues, try:
```bash
npm install --registry https://registry.npmmirror.com
```

---

## Step 3 — Build

```bash
node build.mjs
```

This runs a 14-step automated pipeline. Expected output ends with something like:
```
[Step 14] Done. cli.js ready.
```

If the build fails, check the error message and look at `build.mjs` for context.

---

## Step 4 — Configure API Key

```bash
cp .env.example .env
```

Now edit `.env`. Ask the user for the following information:

1. **API Key** — required. One of:
   - `ANTHROPIC_API_KEY` — standard Anthropic API key (starts with `sk-ant-`)
   - `ANTHROPIC_AUTH_TOKEN` — bearer token (if using a proxy that requires it)

2. **API Base URL** — optional, default is Anthropic official (`https://api.anthropic.com`).
   If the user wants to use a third-party proxy, set `ANTHROPIC_BASE_URL` to the proxy URL.
   The proxy must support Anthropic Messages API format (`/v1/messages`).

3. **Model** — optional, default is `claude-haiku-4-5-20251001`.
   Common choices:
   - `claude-haiku-4-5-20251001` (fast, cheap)
   - `claude-sonnet-4-5` (balanced)
   - `claude-opus-4-5` (most capable)

Write the values into `.env`. Example:

```env
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
DISABLE_TELEMETRY=1
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

---

## Step 5 — Verify Installation

Run this command and check that it returns a response without errors:

```bash
node cli.js -p --bare "say hello"
```

Expected: a short text response from Claude (not an error stack trace).

If it fails:
- `ECONNREFUSED` or network error → check `ANTHROPIC_BASE_URL` and internet connection
- `401 Unauthorized` → API key is wrong or expired
- `Cannot find module` → build step may have failed, run `node build.mjs` again

---

## Step 6 — Launch Interactive Mode

```bash
node cli.js
```

This starts the full terminal TUI. The user can now chat with Claude just like in the official Claude Code.

**Windows users**: if environment variables are not picked up, run via PowerShell:
```powershell
.\start.ps1
```

**macOS/Linux users**:
```bash
bash start.sh
```

---

## Done

Installation is complete. Summary of what was set up:
- Repository cloned to `./claude-code-diy`
- Dependencies installed via npm
- Source built to `./dist/` via `node build.mjs`
- API credentials configured in `.env`
- Interactive TUI available via `node cli.js`

For customization (themes, logo, welcome text), see the main [README.md](./README.md).
For technical details on what was fixed and why, see [RECOVERY_GUIDE.md](./RECOVERY_GUIDE.md).
