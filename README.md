# AetherOps

AetherOps is a React + Express + SQLite local-first agent operations platform for tool-calling chat, workspace automation, long-running workflows, and future engineering design integrations.

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
- Embedded `opencode-ai` Workspace Engine integration for local-first execution; chat, tasks, flows, heartbeat, and sub-agents all use the same opencode engine path

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
- opencode session workspaces: `workspace/opencode/agents/<agentId>/sessions/<conversationId>/`
- AetherOps agent control files: `workspace/opencode/agents/<agentId>/SOUL.md`, `STANDING_ORDERS.md`, and `HEARTBEAT.md`
- One-time opencode-only migration marker: `.data/opencode-only-migration.json`
- On first server start after the migration, only legacy AetherOps runtime folders are deleted: `workspace/agents`, `workspace/shared/skills`, and `workspace/shared/plugins`.
- `.data`, SQLite history, provider secrets, task/flow/run audit records, and local API tokens are preserved.

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

## Removed Internal Runtime Surfaces

AetherOps is now opencode-only for execution. The old internal tool registry, local skill/plugin execution, direct workspace file CRUD UI, and custom Computer Use API are intentionally removed from the product path.

These routes return `410 Gone` so old clients fail loudly instead of silently using the wrong runtime:

- `GET /api/tools`
- `POST /api/mcp/servers`
- `GET/POST /api/agents/:agentId/skills`
- `GET/POST /api/agents/:agentId/memory`
- `GET /api/agents/:agentId/memory/search`
- `GET/POST /api/workspace/tree`
- `GET/POST /api/workspace/file`
- `POST /api/workspace/folder`
- `/api/computer-use/*`

Equivalent filesystem, command, browser, MCP, and tool behavior should be configured in opencode itself.

## opencode Workspace Engine

AetherOps treats itself as the control tower and delegates the actual workspace execution loop to the official `opencode` CLI. The app depends on `opencode-ai`, so a normal project install provides a managed local opencode launcher under `node_modules` without requiring a separate global install.

- Foreground chat, detached tasks, heartbeat runs, sub-agent tasks, and task-flow steps all route through the shared `AgentEngine` abstraction.
- The only runtime engine path is `opencode`; tests use an opencode-shaped deterministic command harness instead of the old provider/tool fallback.
- Runtime resolution order is `OPENCODE_BIN` when explicitly set, then the embedded `opencode-ai` package, then a global `opencode` command as a last compatibility path.
- The opencode engine runs only inside the active conversation sandbox under `workspace/opencode/agents/<agentId>/sessions/<conversationId>/`.
- Host provider secrets are not forwarded through environment inheritance. The process environment is allowlisted and sets `OPENCODE_DISABLE_AUTOUPDATE=true`, `OPENCODE_DISABLE_PRUNE=true`, and `OPENCODE_DISABLE_DEFAULT_PLUGINS=true` by default.
- AetherOps records the opencode command metadata, external session id when reported, JSON event summary, stdout/stderr summary, exit code, changed files, and lifecycle status into workspace run events.

Useful environment variables:

- `OPENCODE_BIN=opencode` only when you intentionally want to override the managed embedded package
- `OPENCODE_CONFIG_DIR=<path>`
- `OPENCODE_DISABLE_AUTOUPDATE=true`
- `OPENCODE_DISABLE_PRUNE=true`
- `OPENCODE_DISABLE_DEFAULT_PLUGINS=true`
- `AETHEROPS_OPENCODE_PREFIX_PROVIDER=true` if your opencode config expects `provider/model` strings instead of plain model aliases

Native engine endpoints:

- `GET /api/engine/status`
- `POST /api/engine/opencode/refresh-models`
- `GET /api/engine/runs/:runId`

If opencode is not installed or not authenticated, the settings dialog shows the engine as unavailable and chat/task execution returns a structured run failure instead of silently falling back.

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
