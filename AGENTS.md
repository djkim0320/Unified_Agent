# AGENTS.md

Operational guide for AI agents working inside `AetherOps`.

## Purpose

This repository is a local-first agent cockpit, scheduler, and log store built on:

- React + Vite frontend
- Express backend
- SQLite local store
- OpenCodeEngine/opencode workspace execution
- provider adapters for OpenAI, Anthropic, Gemini, Ollama, and OpenAI Codex

The product shape is:

- `agent -> session(conversation) -> run -> task`
- `webchat` is the primary channel
- opencode session workspaces are the source of truth for file outputs
- AetherOps schedules work, stores logs/state, and never runs a hidden internal execution loop

Read this file first, then read:

1. [`docs/agent-operator-guide.md`](docs/agent-operator-guide.md)
2. [`docs/agent-change-playbook.md`](docs/agent-change-playbook.md)

## First Files To Read

When starting work, inspect these files first:

- [`README.md`](README.md)
- [`docs/agent-operator-guide.md`](docs/agent-operator-guide.md)
- [`server/app.ts`](server/app.ts)
- [`server/db.ts`](server/db.ts)
- [`server/lib/agent-gateway.ts`](server/lib/agent-gateway.ts)
- [`server/lib/opencode-engine.ts`](server/lib/opencode-engine.ts)
- [`server/lib/workspace.ts`](server/lib/workspace.ts)
- [`src/App.tsx`](src/App.tsx)
- [`src/api.ts`](src/api.ts)

If your task is narrow, also read the closest test file before editing.

## Start Order

Use this order unless your task is extremely narrow:

1. Read [`README.md`](README.md) for run commands and safety flags.
2. Read [`docs/agent-operator-guide.md`](docs/agent-operator-guide.md) for the current architecture.
3. Read [`docs/agent-change-playbook.md`](docs/agent-change-playbook.md) for file-by-file task routing.
4. Read the closest implementation file.
5. Read the closest test file.

Do not start by editing `src/App.tsx` or `server/app.ts` blindly. Most work has a narrower home.

## Development Commands

Use Windows-safe `.cmd` entrypoints.

Install:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' install
```

Run backend from source:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' exec -- tsx server/index.ts
```

Run frontend dev server:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' exec -- vite --host 127.0.0.1 --port 5173
```

Frontend tests:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' exec -- vitest run --config vitest.config.ts
```

Server tests:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' exec -- vitest run --config vitest.server.config.ts
```

Type checks:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' exec -- tsc --noEmit
& 'C:\Program Files\nodejs\npm.cmd' exec -- tsc -p tsconfig.server.json --noEmit
```

Production build:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' exec -- vite build
```

## Ports And Process Rules

- API server listens on `127.0.0.1:8787`
- Vite dev server listens on `127.0.0.1:5173`
- Vite proxies `/api` to `127.0.0.1:8787`

Important:

- Do not run an old `dist/server/index.js` process on `8787` while validating new routes from source.
- If routes appear missing but code exists, check which process owns port `8787`.
- Prefer validating backend changes against `tsx server/index.ts`, not an old `dist` build.

## Local Data Layout

- SQLite DB: `.data/chat.sqlite`
- Secret key: `.data/secret.key`
- Session sandbox: `workspace/opencode/agents/<agentId>/sessions/<conversationId>/`
- Agent control files: `workspace/opencode/agents/<agentId>/SOUL.md`, `STANDING_ORDERS.md`, and `HEARTBEAT.md`
- Legacy internal runtime folders under `workspace/agents`, `workspace/shared/skills`, and `workspace/shared/plugins` are removed by the opencode-only migration marker.

## Safety Invariants

Do not break these:

- Workspace access must stay sandboxed in [`server/lib/workspace.ts`](server/lib/workspace.ts)
- opencode runs must stay scoped to the active session sandbox
- browser/web automation should be connected through opencode/MCP, not a hidden AetherOps fallback
- run/task terminal states must be deterministic and idempotent
- normal UI/API payloads must not leak absolute host paths
- `scope=root` is debug-only and must remain off by default

## Repo Map

Backend:

- [`server/app.ts`](server/app.ts): API routes and top-level wiring
- [`server/db.ts`](server/db.ts): schema bootstrap, migrations, persistence helpers
- [`server/lib/agent-gateway.ts`](server/lib/agent-gateway.ts): wires OpenCodeEngine, tasks, flows, heartbeats, and run logging
- [`server/lib/opencode-engine.ts`](server/lib/opencode-engine.ts): opencode CLI adapter and run event bridge
- [`server/lib/task-manager.ts`](server/lib/task-manager.ts): detached task lifecycle
- [`server/lib/workspace.ts`](server/lib/workspace.ts): sandboxed file access
- [`server/providers/*.ts`](server/providers): provider adapters

Frontend:

- [`src/App.tsx`](src/App.tsx): top-level orchestration and state
- [`src/api.ts`](src/api.ts): API client
- [`src/components/ConversationList.tsx`](src/components/ConversationList.tsx): agent/session sidebar
- [`src/components/Composer.tsx`](src/components/Composer.tsx): chat input and model/reasoning controls
- [`src/components/CockpitSectionView.tsx`](src/components/CockpitSectionView.tsx): workflow cockpit for Flow editing, step control, and run/task logs
- [`src/components/CockpitPanels.tsx`](src/components/CockpitPanels.tsx): chat-side opencode run timeline, changed files, and extension-status panels
- [`src/components/CockpitPanels.tsx`](src/components/CockpitPanels.tsx): right-rail run/task summaries and ops drawer

## Change Routing

Use these shortcuts before you start editing:

- route, payload, or API contract change:
  - [`server/app.ts`](server/app.ts)
  - [`src/api.ts`](src/api.ts)
  - [`src/types.ts`](src/types.ts)
- schema, migration, or ownership logic:
  - [`server/db.ts`](server/db.ts)
  - [`server/db.test.ts`](server/db.test.ts)
- opencode execution, cancellation, run status:
  - [`server/lib/opencode-engine.ts`](server/lib/opencode-engine.ts)
  - [`server/lib/agent-engine.ts`](server/lib/agent-engine.ts)
  - [`server/lib/agent-gateway.ts`](server/lib/agent-gateway.ts)
- session sandbox lifecycle or changed-file summaries:
  - [`server/lib/workspace.ts`](server/lib/workspace.ts)
  - [`src/components/CockpitSectionView.tsx`](src/components/CockpitSectionView.tsx)
- agent standing orders or persistent working context:
  - [`server/lib/workspace.ts`](server/lib/workspace.ts)
  - opencode configuration and workspace artifacts
- detached tasks:
  - [`server/lib/task-manager.ts`](server/lib/task-manager.ts)
- provider-specific behavior:
  - [`server/providers/`](server/providers)
- top-level frontend state:
  - [`src/App.tsx`](src/App.tsx)

For detailed playbooks, use [`docs/agent-change-playbook.md`](docs/agent-change-playbook.md).

## Testing Matrix

If you edit these files, run these tests at minimum:

- session sandbox or changed-file summaries:
  - `vitest run --config vitest.server.config.ts server/lib/workspace.test.ts`
- opencode engine, task execution, cancellation:
  - `vitest run --config vitest.server.config.ts server/lib/opencode-engine.test.ts server/lib/task-manager.test.ts`
- exec safety:
  - `vitest run --config vitest.server.config.ts server/lib/exec-command.test.ts`
- DB or routes:
  - `vitest run --config vitest.server.config.ts server/db.test.ts server/app.test.ts`
- frontend state or UI:
  - `vitest run --config vitest.config.ts src/App.test.tsx src/api.test.ts`

For cross-cutting changes, run both full suites.

## Manual Verification Recipes

API smoke test:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/api/providers | Select-Object -ExpandProperty Content
```

Check removed skill route returns `410 Gone`:

```powershell
curl.exe -i http://127.0.0.1:8787/api/agents/default-agent/skills
```

Browser validation:

- Start source backend on `8787`
- Start Vite on `5173`
- Open `http://127.0.0.1:5173`
- Send a chat that asks opencode to create a file in the current session sandbox
- Confirm chat activity, run completion, and changed-file appearance in the cockpit files/log panels

Suggested verification prompt:

```text
Create hello_browser.ts in the current session workspace with exactly:
export const browserCheck = (): string => 'ok';
```

## Port Diagnostics

If the UI and code disagree, check the backend process first:

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen | Select-Object -Property LocalAddress,LocalPort,OwningProcess
Get-Process -Id <PID>
```

If `dist/server/index.js` is still running, stop it and restart the source server.

## Known Gotchas

- Existing strategy docs may lag code; prefer the actual files above when in doubt.
- OpenAI Codex planning output is probabilistic; narrow prompts verify live flows more reliably.
- On Windows, Playwright CLI can mis-handle long quoted arguments. Prefer short inputs or file-backed scripts when driving it from shell.
- If the UI suddenly shows stale routes or missing endpoints, verify that the correct backend process owns `8787`.
- If you change a route or payload shape, update both the server route and the client helper in the same patch.
- If you change a persistent record shape, update the DB helper and the frontend type at the same time.

## Definition Of Done

Before finishing, confirm:

- behavior works in the relevant UI/API path
- targeted tests pass
- docs and types match the actual route/payload shape
- no stale process or build artifact invalidated the verification
