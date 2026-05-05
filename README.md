# AetherOps

AetherOps is a React + Express + SQLite local-first cockpit, scheduler, and log store for opencode-backed agent work.

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
- Multiple agents with scoped sessions, opencode workspaces, run logs, and task history
- Cockpit UI for workflow scheduling, opencode execution traces, changed-file summaries, and extension-status metadata
- No hidden AetherOps tool/plugin/memory/browser runtime; configure execution capabilities in opencode
- Detached background task ledger
- User-defined automation rules that periodically materialize opencode-backed scheduled tasks
- Long-running task flows with ordered steps, dependencies, start/resume/retry/skip/cancel controls, and step-linked task/run traces
- Embedded `opencode-ai` Workspace Engine integration for local-first execution; chat, tasks, flows, heartbeat, and sub-agents all use the same opencode engine path

## Run on Windows PowerShell

If PowerShell execution policy blocks `npm` or `pnpm` shim scripts, use the `.cmd` entrypoints directly.

### Install

```powershell
& 'C:\Program Files\nodejs\npm.cmd' install
```

Optional pnpm alternative:

```powershell
& 'C:\Users\djkim\AppData\Roaming\npm\pnpm.cmd' install
```

### Start development

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run dev
```

### Run tests

```powershell
& 'C:\Program Files\nodejs\npm.cmd' test
```

### Build production assets

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run build
```

### Start the built server

```powershell
& 'C:\Program Files\nodejs\npm.cmd' start
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

For trusted local validation runs that need opencode to edit files without an interactive permission prompt, start the server with `AETHEROPS_OPENCODE_AUTO_APPROVE=true`. This adds opencode's `--dangerously-skip-permissions` flag, so keep it off for untrusted sessions or prompts.

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

The cockpit workflow view exposes the same controls, including an outline-to-steps editor and per-step task/run summaries.

## Removed Internal Runtime Surfaces

AetherOps is now opencode-only for execution. The old internal tool execution path, local skill/plugin execution, direct workspace file CRUD UI, and custom Computer Use API are intentionally removed from the product path.

These routes return `410 Gone` so old clients fail loudly instead of silently using the wrong runtime:

- `GET /api/tools`
- `POST /api/mcp/servers`
- `GET/POST /api/agents/:agentId/skills`
- `GET/POST /api/agents/:agentId/memory`
- `GET /api/agents/:agentId/memory/search`
- `GET /api/workspace/tree`
- `GET/POST /api/workspace/file`
- `POST /api/workspace/folder`
- `/api/computer-use/*`

Equivalent filesystem, command, browser, MCP, and tool behavior should be configured in opencode itself.

## opencode Workspace Engine

AetherOps treats itself as the cockpit/scheduler/log store and delegates the actual workspace execution loop to the official `opencode` CLI. The app depends on `opencode-ai`, so a normal project install provides a managed local opencode launcher under `node_modules` without requiring a separate global install.

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
- `POST /api/engine/opencode/auth/login`
- `GET /api/engine/runs/:runId?conversationId=<id>`

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
  Enables the conservative background scheduler for Heartbeat and user-defined automation rules. Immediate detached tasks and manual rule triggers do not require this flag.

## Automation rules

Automation rules are agent-scoped periodic prompts that AetherOps stores in SQLite and converts into `taskKind: "scheduled"` tasks when due. They do not introduce a second execution runtime: every materialized task still runs through the same opencode engine path as chat, Heartbeat, workflows, and sub-agents.

Native rule endpoints:

- `GET /api/agents/:agentId/automation-rules`
- `POST /api/agents/:agentId/automation-rules`
- `PATCH /api/agents/:agentId/automation-rules/:ruleId`
- `DELETE /api/agents/:agentId/automation-rules/:ruleId`
- `POST /api/agents/:agentId/automation-rules/:ruleId/trigger`

The Settings tab exposes rule creation, edit, enable/disable, delete, and "run now" actions. Historical task/run audit logs are preserved when a rule is deleted.

## Codex auth import

The app checks:

- `%CODEX_HOME%\auth.json`
- or `%USERPROFILE%\.codex\auth.json`

Only ChatGPT-backed Codex CLI sessions are imported.
