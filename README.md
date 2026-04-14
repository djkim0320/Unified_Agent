# Local Multi-Provider Chat

React + Express + SQLite based local chat app with per-conversation provider and model selection.

## Supported providers

- OpenAI
- Anthropic
- Gemini
- Ollama
- OpenAI Codex

## Highlights

- Shared chat UI across all providers
- Conversation-level provider and model persistence
- SSE streaming from the server to the web client
- Encrypted provider secrets stored in local SQLite
- OpenAI Codex integrated as a separate `openai-codex` provider
- Codex OAuth callback flow plus optional Codex CLI `auth.json` import
- Local-first agent gateway with webchat as the first channel
- Multiple agents with scoped sessions, workspaces, memory files, and task history
- Workspace runtime with per-session sandboxes, file tree, run logs, and browser research tools
- Core tool registry, skill/plugin loader, and detached background task ledger

## Run on Windows PowerShell

If PowerShell execution policy blocks `npm` or `pnpm` shim scripts, use the `.cmd` entrypoints directly.

### Install

```powershell
& 'C:\Users\djkim\AppData\Roaming\npm\pnpm.cmd' install
```

Alternative with npm:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' install
```

### Start development

```powershell
& 'C:\Users\djkim\AppData\Roaming\npm\pnpm.cmd' dev
```

### Run tests

```powershell
& 'C:\Users\djkim\AppData\Roaming\npm\pnpm.cmd' test
```

### Build production assets

```powershell
& 'C:\Users\djkim\AppData\Roaming\npm\pnpm.cmd' build
```

### Start the built server

```powershell
& 'C:\Users\djkim\AppData\Roaming\npm\pnpm.cmd' start
```

## Local data

- SQLite DB: `.data/chat.sqlite`
- Encryption key: `.data/secret.key`
- Agent workspaces: `workspace/agents/<agentId>/`
  - durable memory: `MEMORY.md`
  - daily notes: `memory/YYYY-MM-DD.md`
  - sessions: `sessions/<conversationId>/`
- Shared skills: `workspace/shared/skills/`
- Local plugins: `workspace/shared/plugins/`

## Architecture notes

- Agent contributor guide: [`AGENTS.md`](AGENTS.md)
- Detailed operator guide: [`docs/agent-operator-guide.md`](docs/agent-operator-guide.md)
- Change playbook for AI agents: [`docs/agent-change-playbook.md`](docs/agent-change-playbook.md)
- Roadmap: [`docs/agent-platform-roadmap.md`](docs/agent-platform-roadmap.md)
- ADR: [`docs/adr/001-agent-gateway-architecture.md`](docs/adr/001-agent-gateway-architecture.md)

## Safety flags

- `ENABLE_UNSAFE_WORKSPACE_EXEC=true`
  Allows unsafe shell-style workspace execution. Safe default is off.
- `ENABLE_WORKSPACE_ROOT_SCOPE=true`
  Enables `scope=root` for workspace APIs. Safe default is off.
- `ENABLE_WORKSPACE_DEBUG_PATHS=true`
  Adds absolute workspace debug paths to workspace API responses. Safe default is off.
- `ENABLE_AGENT_AUTOMATIONS=true`
  Enables the conservative background automation heartbeat. Immediate detached tasks do not require this flag.

## Codex auth import

The app checks:

- `%CODEX_HOME%\auth.json`
- or `%USERPROFILE%\.codex\auth.json`

Only ChatGPT-backed Codex CLI sessions are imported.
