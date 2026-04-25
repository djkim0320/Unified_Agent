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
- Workspace runtime with per-session sandboxes, file tree, run logs, and browser research/computer-use tools
- Core tool registry, skill/plugin loader, and detached background task ledger
- Long-running task flows with ordered steps, dependencies, start/resume/retry/skip/cancel controls, and step-linked task/run traces

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

## Long-Running Workflows

Task flows are the local-first workflow primitive for research or implementation that should not be squeezed into one chat turn. A flow contains up to 8 ordered steps, each with a `stepKey`, title, prompt, and optional `dependencyStepKey`.

Native API controls:

```powershell
Invoke-WebRequest -UseBasicParsing -Method Post http://127.0.0.1:8787/api/agents/default-agent/flows -Body (@{
  conversationId = "SESSION_ID"
  title = "Aircraft concept study"
  autoStart = $false
  steps = @(
    @{ stepKey = "requirements"; title = "Requirements"; prompt = "Capture requirements. Expected output: requirements summary." },
    @{ stepKey = "research"; title = "Research"; prompt = "Research references. Expected output: cited findings."; dependencyStepKey = "requirements" }
  )
} | ConvertTo-Json -Depth 5) -ContentType "application/json"
```

Flow operation endpoints:

- `POST /api/flows/:flowId/start`
- `POST /api/flows/:flowId/resume`
- `POST /api/flows/:flowId/steps/:stepId/retry`
- `POST /api/flows/:flowId/steps/:stepId/skip`
- `POST /api/flows/:flowId/cancel`

The workspace UI exposes the same controls in the task-flow panel, including an outline-to-steps editor and per-step task/run summaries.

## Workspace File Actions

The cockpit file tab can create local workspace artifacts without leaving the UI. Writes stay scoped to either the active session sandbox or the shared workspace; `scope=root` is intentionally rejected for write routes.

- `POST /api/workspace/file`: create a UTF-8 text file with `{ conversationId, scope, path, content, overwrite? }`
- `POST /api/workspace/folder`: create a folder with `{ conversationId, scope, path }`
- Existing files are protected by default; pass `overwrite=true` only when the user explicitly intends to replace a file.

## Browser Computer-Use Tools

The core tool registry includes browser actions for rendered web/UI work:

- `browser_wait_for`: wait for a selector, text, or URL fragment before the next step.
- `browser_press`: press keyboard shortcuts or keys, optionally scoped to a selector.
- `browser_screenshot`: save a PNG evidence artifact under the active session sandbox, for example `artifacts/browser/home.png`.

These tools keep the existing browser SSRF protections and run-scoped isolation. Screenshot paths are workspace-bounded and must end in `.png`.

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
