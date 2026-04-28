# Agent Operator Guide

Detailed working guide for AI agents contributing to `AetherOps`.

If you need task-by-task routing, use [`agent-change-playbook.md`](agent-change-playbook.md) after this file.

## 1. What This Repo Is

This codebase is not just a chat UI. It is a local-first agent platform with:

- first-class agents
- webchat sessions
- workspace runs and run events
- detached tasks and task events
- file-backed memory
- plugin and skill loading
- provider-backed planning and final-answer streaming

The current product focus is local desktop usage with `webchat` as the first channel.

## 2. Domain Model

Current domain model:

- `agents`
  - default provider/model/reasoning configuration
  - isolated workspace and memory root
- `conversations`
  - currently act as sessions
  - belong to an agent
  - use `channel_kind=webchat`
- `messages`
  - persistent session transcript
- `workspace_runs`
  - one foreground or detached agent execution
- `workspace_run_events`
  - status, tool calls, tool results, terminal events
- `tasks`
  - detached background work
- `task_events`
  - task lifecycle ledger

The stable mental model is:

`agent -> session(conversation) -> run -> task`

## 2.2 Workspace Engine

AetherOps is the local control plane. It owns sessions, persistence, task flows, heartbeats, approvals, memory, and run/audit events. Actual workspace execution is routed through an `AgentEngine` abstraction.

- Runtime engine: `OpenCodeEngine`, backed by the official `opencode` CLI through the embedded `opencode-ai` package.
- Tests use an opencode-shaped deterministic command harness so coverage still exercises the same engine boundary without requiring a local opencode install.
- Engine selection flags are no longer used; the old provider/tool fallback path has been removed from gateway wiring.
- Launcher resolution prefers `OPENCODE_BIN` when explicitly set, then the project-local `node_modules/opencode-ai/bin/opencode` launcher, then a global `opencode` command.
- Status and operations: `GET /api/engine/status`, `POST /api/engine/opencode/refresh-models`, `GET /api/engine/runs/:runId`.

The opencode engine always runs inside the active conversation sandbox and uses an allowlisted process environment. It records command metadata, JSON event summaries, external session ids when available, changed files, and exit state into workspace run events.

## 2.1 Source Of Truth

Do not guess where data lives. The main sources of truth are:

- SQLite for agents, sessions, messages, runs, run events, tasks, and task events
- workspace files for memory, session sandbox files, shared skills, and local plugins
- provider accounts and secrets through the local store helpers in [`server/db.ts`](../server/db.ts)

If a behavior spans multiple layers, inspect the DB helper first and then the route/runtime wiring.

## 3. Backend Architecture

Primary flow starts in [`server/app.ts`](../server/app.ts).

### App wiring

`createApp(...)` builds:

- SQLite store from [`server/db.ts`](../server/db.ts)
- workspace manager from [`server/lib/workspace.ts`](../server/lib/workspace.ts)
- browser runtime from [`server/lib/browser-runtime.ts`](../server/lib/browser-runtime.ts)
- provider registry from [`server/provider-registry.ts`](../server/provider-registry.ts)
- channel registry from [`server/lib/channel-registry.ts`](../server/lib/channel-registry.ts)
- agent gateway from [`server/lib/agent-gateway.ts`](../server/lib/agent-gateway.ts)

### Agent gateway

[`server/lib/agent-gateway.ts`](../server/lib/agent-gateway.ts) is the composition layer. It creates:

- tool registry
- plugin manager
- memory manager
- task manager
- foreground turn runner

This is the main place to inspect when behavior spans providers, tasks, memory, and tools.

### Runtime

[`server/lib/agent-gateway.ts`](../server/lib/agent-gateway.ts) now calls the configured `AgentEngine` for foreground chat, detached tasks, heartbeats, task-flow steps, and sub-agents.

The old provider/tool loop remains in [`server/lib/agent-runtime.ts`](../server/lib/agent-runtime.ts) only as isolated reference/test coverage. It is not wired into chat, tasks, flows, heartbeat, or sub-agent execution:

1. create run
2. plan tool step
3. validate tool call
4. execute tool
5. record events
6. repeat until `final_answer`
7. stream final answer
8. finalize run

Supporting parser:

- [`server/lib/agent-step.ts`](../server/lib/agent-step.ts)

For foreground chat, the path is:

1. `POST /api/chat/stream` in [`../server/app.ts`](../server/app.ts)
2. `gateway.runForegroundTurn(...)`
3. configured `AgentEngine.runTurn(...)`
4. opencode CLI workspace execution with plugin skill guidance and memory context embedded into the engine prompt
5. run event persistence
6. SSE back to the client

For detached tasks, the path is:

1. `POST /api/agents/:agentId/tasks`
2. task record creation
3. `taskManager.runTask(...)`
4. `executeDetachedTask(...)` in [`../server/lib/agent-gateway.ts`](../server/lib/agent-gateway.ts)
5. `AgentEngine.runTurn(...)`
6. assistant result appended back into the session

### Tools

### Computer Use

Computer Use is implemented as an opt-in controlled browser harness. It is intentionally not unrestricted OS desktop automation.

- Settings and observability live under `/api/computer-use/*`.
- The default policy allows localhost/127.0.0.1 and blocks arbitrary external domains unless allowlisted.
- Sensitive typing, destructive clicks, submission-like actions, uploads/downloads, and allowlisted external navigation require approval records.
- Screenshots are private artifacts under `workspace/computer-use-artifacts/`; they are not served as public static files.
- Agent planner access is gated: `computer.browser.*` tools are hidden unless Computer Use is enabled.
- Provider-native OpenAI computer tool integration is reserved behind the capability field `computerUseMode`; the current working path is `custom-browser-harness`.

Typed tools are registered via:

- [`server/lib/tool-registry.ts`](../server/lib/tool-registry.ts)
- [`server/plugins/core.ts`](../server/plugins/core.ts)

The registry is the source of truth for:

- planner guidance
- schema validation
- permission classification
- executable behavior

If you add a tool, update the registry and related tests. Do not add hidden tool behaviors in multiple places.

Planner instructions should be derived from the registry and loaded skills. If the planner stops calling a tool correctly, inspect the registry metadata before changing the core loop.

### Skills and plugins

Plugin and skill loading is handled by:

- [`server/lib/plugin-manager.ts`](../server/lib/plugin-manager.ts)

Skill sources:

- built-in plugin skills
- `workspace/shared/skills/*.md`
- `workspace/agents/<agentId>/skills/*.md`

Plugin source:

- built-in plugins
- `workspace/shared/plugins/<pluginId>/plugin.json`

### Memory

Memory is file-backed and visible:

- durable: `workspace/agents/<agentId>/MEMORY.md`
- daily: `workspace/agents/<agentId>/memory/YYYY-MM-DD.md`

Manager:

- [`server/lib/memory-manager.ts`](../server/lib/memory-manager.ts)

Do not introduce hidden memory state that exists only in prompts.

Memory capture happens in two forms:

- explicit writes through memory tools/routes
- runtime-driven summary capture after agent runs

If memory behavior looks wrong, inspect both the memory manager and the call sites in the runtime/gateway path.

### Tasks

Detached task lifecycle is implemented in:

- [`server/lib/task-manager.ts`](../server/lib/task-manager.ts)

Task states:

- `queued`
- `running`
- `completed`
- `failed`
- `timed_out`
- `cancelled`

Tasks can append assistant messages back into the session when they finish.

### Task flows

Task flows are ordered, observable long-running workflows on top of detached tasks.

- storage: `task_flows` and `task_flow_steps`
- runtime: [`server/lib/task-manager.ts`](../server/lib/task-manager.ts)
- API: `POST /api/agents/:agentId/flows`, `GET /api/flows/:flowId`, `POST /api/flows/:flowId/start`, `POST /api/flows/:flowId/resume`, `POST /api/flows/:flowId/steps/:stepId/retry`, `POST /api/flows/:flowId/steps/:stepId/skip`, `POST /api/flows/:flowId/cancel`
- UI: [`src/components/WorkspaceView.tsx`](../src/components/WorkspaceView.tsx)

Rules:

- only one runnable step is executed at a time
- a queued step runs only after its dependency is `completed` or `skipped`
- failed steps fail the flow until the operator retries or resumes
- retry resets the selected step and downstream dependency chain
- skip counts as dependency-satisfied
- `GET /api/flows/:flowId` includes linked task/run summaries for each step

## 4. Frontend Architecture

Top-level UI state lives in:

- [`src/App.tsx`](../src/App.tsx)

API client:

- [`src/api.ts`](../src/api.ts)

Important components:

- [`src/components/ConversationList.tsx`](../src/components/ConversationList.tsx)
- [`src/components/AgentSettingsDialog.tsx`](../src/components/AgentSettingsDialog.tsx)
- [`src/components/ChatView.tsx`](../src/components/ChatView.tsx)
- [`src/components/Composer.tsx`](../src/components/Composer.tsx)
- [`src/components/WorkspaceView.tsx`](../src/components/WorkspaceView.tsx)

When changing frontend behavior, preserve these constraints:

- state must stay scoped to active agent/session/run/task
- stale async requests must not overwrite newer state
- workspace UI must not leak absolute host paths
- unsupported file encodings must remain explicit instead of being silently corrupted

State orchestration in `src/App.tsx` is high leverage. Change it carefully and prefer keeping fetch helpers, selection state, and refresh sequencing explicit.

## 5. Workspace Rules

The workspace manager is security-sensitive.

Relevant file:

- [`server/lib/workspace.ts`](../server/lib/workspace.ts)

Required invariants:

- reject traversal and absolute-path escapes
- reject symlink/junction/reparse-point escapes
- read-only endpoints must not create directories
- deleting a conversation must clean only that session sandbox
- normal API responses must use relative paths

Never bypass `workspace.ts` for sandbox file operations.

If a file feature looks simple but touches path resolution, treat it as security-sensitive work.

## 6. Exec Rules

Relevant file:

- [`server/lib/exec-command.ts`](../server/lib/exec-command.ts)

Current expectation:

- structured execution only by default
- safe working directory under sandbox
- timeout and abort support
- Windows process-tree cleanup on timeout/cancel
- output caps

Do not reintroduce raw shell execution as default behavior.

If a command execution change needs more power, gate it explicitly behind the unsafe flag instead of weakening the default path.

## 7. Browser / Web Research Rules

Relevant files:

- [`server/lib/browser-runtime.ts`](../server/lib/browser-runtime.ts)
- [`server/lib/web-fetch.ts`](../server/lib/web-fetch.ts)
- [`server/lib/network-guard.ts`](../server/lib/network-guard.ts)

Required invariants:

- block SSRF targets
- revalidate redirects
- bound fetched/extracted content
- keep browser state isolated
- treat extracted page text as untrusted input

Browser continuity is useful within a run, but it must not quietly become cross-agent or cross-run shared state.

Computer-use oriented browser tools:

- `browser_wait_for`: wait for visible selectors, text, or URL fragments after navigation/clicks.
- `browser_press`: press keys or shortcuts in the current page, optionally targeting a selector.
- `browser_screenshot`: capture a PNG into the active session sandbox as a visual evidence artifact.

Screenshot artifacts are written through the workspace manager, so path traversal and absolute-path escapes remain blocked.

## 8. Route Map

High-value routes:

- `GET /api/providers`
- `GET /api/agents`
- `POST /api/agents`
- `DELETE /api/agents/:agentId`
- `GET /api/agents/:agentId/memory`
- `POST /api/agents/:agentId/memory`
- `GET /api/agents/:agentId/skills`
- `GET /api/agents/:agentId/tasks`
- `POST /api/agents/:agentId/tasks`
- `POST /api/agents/:agentId/tasks/:taskId/cancel`
- `GET /api/agents/:agentId/tasks/:taskId/events`
- `GET/POST /api/conversations`
- `GET /api/conversations/:id/messages`
- `POST /api/chat/stream`
- `GET /api/workspace/tree`
- `GET /api/workspace/file`
- `POST /api/workspace/file`
- `POST /api/workspace/folder`
- `GET /api/workspace/runs`
- `GET /api/workspace/runs/:runId/events`
- `GET /api/plugins`
- `GET /api/tools`
- `GET /api/channels`

When routes and frontend drift apart, update both `server/app.ts` and `src/api.ts`.

If you add a scoped route, also check that ownership validation exists in `server/db.ts` or route-level lookup logic.

## 9. Recommended Task Routing

If your task is about:

- DB schema or persistence:
  - inspect `server/db.ts`, `server/db.test.ts`
- run lifecycle, tool calls, cancellation:
  - inspect `server/lib/agent-runtime.ts`, `server/lib/agent-runtime.test.ts`
- providers:
  - inspect `server/providers/*.ts`
- sandbox/file safety:
  - inspect `server/lib/workspace.ts`, `server/lib/workspace.test.ts`
- tasks/background work:
  - inspect `server/lib/task-manager.ts`
- plugin/skill metadata:
  - inspect `server/lib/plugin-manager.ts`, `server/plugins/core.ts`
- frontend agent/session/workspace state:
  - inspect `src/App.tsx`, `src/api.ts`, `src/components/WorkspaceView.tsx`

If your task is broad and crosses more than two items above, read [`agent-change-playbook.md`](agent-change-playbook.md) before editing.

## 10. Verification Workflow

### Backend verification

Run source backend:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' exec -- tsx server/index.ts
```

Smoke routes:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/api/providers | Select-Object -ExpandProperty Content
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/api/agents/default-agent/skills | Select-Object -ExpandProperty Content
```

### Frontend verification

Run Vite:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' exec -- vite --host 127.0.0.1 --port 5173
```

Then open:

- `http://127.0.0.1:5173`

### Browser verification

Preferred checks:

- send a chat that triggers `write_file`
- confirm chat activity shows tool call and tool result
- switch to workspace tab
- confirm file exists in tree
- confirm run ledger shows terminal status

Recommended verification prompt:

```text
Create hello_browser.ts in the current session workspace with exactly:
export const browserCheck = (): string => 'ok';
Use the write_file tool.
```

### Important process check

If a route seems missing even though the code exists:

1. check who owns port `8787`
2. kill stale `dist/server/index.js` if needed
3. rerun `tsx server/index.ts`

## 11. Practical Editing Rules

When working in this repo:

- keep changes narrow and route them to the right layer
- update tests near the changed behavior
- avoid changing persistent payload shapes in only one place
- avoid introducing hidden global state when the platform model is scoped by agent and session
- prefer documenting new stable workflows in `AGENTS.md` or the playbook if future agents will need them

## 11. Known Live-Validation Pitfalls

- OpenAI Codex planner output can be inconsistent under broad prompts. For live verification, narrow prompts that strongly constrain the first tool step are more reliable.
- Vite can render stale UI behavior if the backend process is old.
- Playwright CLI on Windows can split long quoted arguments unexpectedly. Use shorter inputs or file-backed scripts when driving it from shell.

## 12. Documentation Maintenance Rule

When architecture or route shapes change, update at least:

- [`AGENTS.md`](../AGENTS.md)
- [`README.md`](../README.md)
- this guide

Do not leave the operator docs behind the code.
