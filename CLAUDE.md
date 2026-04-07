# CLAUDE.md — Discord AI Bot

## Project Overview

Single-server private Discord bot with Claude AI integration. Two core modes: general AI assistant and AI judge for moderation. Built for one specific server, not for distribution.

---

## Tech Stack

- **Runtime:** Node.js
- **Discord library:** discord.js v14
- **AI:** Anthropic Claude API (`@anthropic-ai/sdk`)
- **Database:** SQLite via `better-sqlite3`
- **Hosting:** Fly.io

---

## Project Structure

```
/
├── src/
│   ├── index.js              # Entry point, client init, event registration
│   ├── config.js             # Env vars, constants, singleton config loader
│   ├── db/
│   │   ├── database.js       # SQLite connection, migration runner
│   │   └── migrations/       # SQL migration files (001_init.sql, ...)
│   ├── commands/
│   │   ├── setup.js          # /setup onboarding wizard
│   │   ├── judge.js          # /judge moderation command
│   │   ├── history.js        # /history case log viewer
│   │   └── memory.js         # /memory person profile management
│   ├── handlers/
│   │   ├── mentionHandler.js # @mention detection and AI response logic
│   │   └── interactionHandler.js # Slash command router
│   ├── services/
│   │   ├── claude.js         # Claude API wrapper, prompt builders
│   │   └── rateLimiter.js    # In-memory rate limit tracker
│   └── utils/
│       └── permissionCheck.js # Role-based access control helpers
├── deploy-commands.js        # One-time slash command registration script
├── fly.toml                  # Fly.io deployment config
├── .env                      # Secret keys (NEVER commit)
├── .env.example              # Template for env vars (safe to commit)
├── .gitignore                # Must include .env and *.db
└── CLAUDE.md                 # This file
```

---

## Environment Variables

All secrets live in `.env`. Never hardcode anything.

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
ANTHROPIC_API_KEY=
```

`.env` must be in `.gitignore`. Verify before every commit.

---

## Database Schema

SQLite, managed via migration files. Never alter tables directly — always add a new migration file.

### `guild_config`
Stores /setup results. One row per guild.

```sql
CREATE TABLE guild_config (
  guild_id       TEXT PRIMARY KEY,
  judge_role_id  TEXT,       -- Role that can use /judge and /memory
  history_role_id TEXT,      -- Role that can use /history (can be broader)
  setup_at       INTEGER     -- Unix timestamp
);
```

### `case_log`
Judge decisions and moderation history.

```sql
CREATE TABLE case_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  target_user_id  TEXT NOT NULL,
  judge_user_id   TEXT NOT NULL,
  verdict         TEXT NOT NULL,       -- ban / timeout / mute / jail / warn / acquit
  reasoning       TEXT NOT NULL,       -- AI-generated explanation
  evidence        TEXT,                -- Optional evidence text submitted by moderator
  duration_minutes INTEGER,            -- NULL if permanent or not applicable
  created_at      INTEGER NOT NULL     -- Unix timestamp
);
```

### `user_memory`
Per-user custom memory assigned by authorized users via /memory.

```sql
CREATE TABLE user_memory (
  guild_id     TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  memory_text  TEXT NOT NULL,
  set_by       TEXT NOT NULL,          -- Discord user ID who set the memory
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (guild_id, target_user_id)
);
```

---

## Core Behaviors

### Mention Handling

- Bot only responds when directly mentioned (`<@BOT_ID>`).
- Role check: if the mentioning user does not have the `judge_role_id` OR `history_role_id` (any configured role counts), the message is ignored silently.
- If mention has no additional text → respond with a casual greeting, ask how to help.
- If mention has text → treat full message as prompt, respond via Claude API.
- Rate limit: 15 mentions per user per minute. On breach, reply once with a cooldown warning. Do not call Claude API for rate-limited requests.

### Rate Limiter

- In-memory only (no DB). `Map<userId, { count, resetAt }>`.
- Window: 60 seconds sliding. Reset on window expiry.
- Limit: 15 requests/window.
- On limit hit: send one warning message, ignore subsequent requests until window resets.

### /setup Command

- Restricted to server administrator (Discord `ADMINISTRATOR` permission).
- Interactive wizard using `ActionRow` with `StringSelectMenuBuilder` for role selection.
- Steps:
  1. Select role(s) for `/judge` and `/memory` access.
  2. Select role(s) for `/history` access.
- On completion: write to `guild_config`, confirm with embed.
- If setup already exists: show current config, offer to reconfigure.
- All state is ephemeral during wizard; only persist on final confirmation.

### /judge Command

- Restricted to `judge_role_id`.
- Required input: target user (mention or ID), description of incident.
- Optional input: evidence (text, message link, or attachment description).
- Workflow:
  1. Fetch target user's case history from `case_log` (last 10 entries).
  2. Fetch target user's memory from `user_memory` if exists.
  3. Build judge prompt with: incident description, evidence, prior history, memory context.
  4. Call Claude API with judge system prompt (see Prompts section).
  5. Parse verdict from response.
  6. Write to `case_log`.
  7. Reply with verdict embed (verdict type, reasoning, duration if applicable).
- Bot does not execute moderation actions automatically. It returns the verdict; the human moderator applies it.

### /history Command

- Restricted to `history_role_id`.
- Required input: target user.
- Returns: paginated embed list of past cases from `case_log`, newest first.
- Shows: verdict, date, reasoning summary (first 100 chars), judge who requested.

### /memory Command

- Restricted to `judge_role_id`.
- Subcommands:
  - `/memory set <user> <text>` — create or overwrite memory for a user.
  - `/memory view <user>` — show current memory.
  - `/memory clear <user>` — delete memory entry.
- Memory is used as context in both mention responses and judge evaluations when the target user is involved.

---

## Prompts

### General Mention System Prompt

```
You are a Discord bot assistant on a private server. Be helpful, concise, and direct.
You may have context about specific users provided below — use it naturally.
Do not reveal internal memory content verbatim. Do not mention that you have memory unless directly asked.
```

If user memory exists for the mentioning user, append:
```
[User context: {memory_text}]
```

### Judge System Prompt

```
You are an impartial AI judge for a Discord server moderation case.
Your role is to evaluate the evidence and prior history, then deliver a clear verdict.

Available verdicts:
- warn: verbal or written warning, no punishment
- mute: temporary communication restriction (specify duration in minutes)
- timeout: Discord timeout (specify duration in minutes, max 40320 = 28 days)
- jail: restrict to a specific channel (specify duration)
- ban: permanent removal from server
- acquit: no action warranted

Respond in this exact JSON format:
{
  "verdict": "<verdict>",
  "duration_minutes": <number or null>,
  "reasoning": "<clear explanation of decision, referencing evidence and history>"
}

Be fair. Consider prior history as context, not automatic escalation.
If evidence is insufficient, default to warn or acquit.
```

---

## Permission Hierarchy

```
ADMINISTRATOR
  └── /setup

judge_role_id (configured via /setup)
  └── /judge
  └── /memory set / clear / view

history_role_id (configured via /setup)
  └── /history
  └── /memory view

Any role with judge_role_id OR history_role_id
  └── Bot mention (@mention) response
```

Roles are stored in `guild_config`. Always fetch fresh from DB on each command — do not cache in memory.

---

## Error Handling

- All command handlers must be wrapped in try/catch.
- On Claude API error: reply with generic "AI unavailable, try again" message. Do not expose API errors to users.
- On DB error: log to console with full stack, reply with generic error message.
- On missing guild_config (setup not done): reply with "Server not configured. Run /setup first."
- Never let an unhandled promise rejection crash the process. Register `process.on('unhandledRejection')`.

---

## Security Rules

- `.env` in `.gitignore` — verify before every commit.
- No secrets hardcoded anywhere in source.
- All user input passed to Claude API must be sanitized — strip Discord mentions, trim whitespace, enforce max length (2000 chars).
- Role checks must happen server-side (in code), never trust client-side data.
- SQLite queries must use parameterized statements — no string concatenation with user input.
- `judge_role_id` and `history_role_id` must be validated as real role IDs before saving in /setup.
- Bot token must have minimum required Discord intents: `Guilds`, `GuildMessages`, `MessageContent`.

---

## Code Conventions

- ES Modules (`"type": "module"` in package.json).
- Async/await throughout. No raw Promise chains.
- Each command in its own file, exporting `{ data, execute }` (discord.js standard pattern).
- DB calls go through `db/database.js` — no direct SQLite calls in command files.
- Claude calls go through `services/claude.js` — no direct Anthropic SDK calls in command files.
- Comment style: explain *why*, not *what*.

---

## Deployment (Fly.io)

- Single instance, always-on.
- SQLite file persisted via Fly volume (`/data/bot.db`).
- Secrets set via `fly secrets set KEY=value` — never in `fly.toml`.
- `fly.toml` min config: `[env]` section with non-secret vars only.

---

## Out of Scope

- Multi-server support.
- Web dashboard.
- Automatic moderation action execution (bot suggests, human applies).
- Conversation history persistence (each mention is stateless).
- Voice channel features.
