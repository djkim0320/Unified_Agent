# Agent Operator Guide

Detailed working guide for AI agents contributing to `AetherOps`.

If you need task-by-task routing, use [`agent-change-playbook.md`](agent-change-playbook.md) after this file.

## 1. What This Repo Is

This codebase is not just a chat UI. It is a local-first cockpit/scheduler/log store for opencode-backed agent work with:

- first-class agents
- webchat sessions
- workspace runs and run events
- detached tasks and task events
- task-flow scheduling
- opencode run/event capture
- provider account and model selection

The current product focus is local desktop usage with `webchat` as the first channel. AetherOps does not execute a hidden internal runtime; all workspace execution goes through `OpenCodeEngine`/opencode.

## 2. Domain Model

Current domain model:

- `agents`
  - default provider/model/reasoning configuration
  - opencode control files and session sandbox ownership
- `conversations`
  - currently act as sessions
  - belong to an agent
  - use `channel_kind=webchat`
- `messages`
  - persistent session transcript
- `session_summaries`
  - persistent compact session memory injected into future opencode prompts
- `workspace_runs`
  - one foreground or detached agent execution
- `workspace_run_events`
  - status, tool calls, tool results, terminal events
- `artifacts`
  - run-scoped records for changed files and future reports/summaries
- `tasks`
  - detached background work
- `task_events`
  - task lifecycle ledger
- `automation_rules`
  - agent-scoped periodic prompts
  - materialized into `scheduled` tasks by the scheduler
  - historical task/run records are retained when rules are deleted

The stable mental model is:

`agent -> session(conversation) -> run -> task`

## 2.2 Workspace Engine

AetherOps is the local control plane: cockpit UI, scheduler, and log store. It owns sessions, persistence, task flows, heartbeats, operator-facing policy notes, and run/audit events. Actual workspace execution is routed through an `AgentEngine` abstraction.

- Runtime engine: `OpenCodeEngine`, backed by the official `opencode` CLI through the embedded `opencode-ai` package.
- Tests use an opencode-shaped deterministic command harness so coverage still exercises the same engine boundary without requiring a local opencode install.
- Engine selection flags are no longer used; the old provider/tool fallback path has been removed from gateway wiring.
- Launcher resolution prefers `OPENCODE_BIN` when explicitly set, then the project-local `node_modules/opencode-ai/bin/opencode` launcher, then a global `opencode` command.
- Status and operations: `GET /api/engine/status`, `POST /api/engine/opencode/refresh-models`, `POST /api/engine/opencode/auth/login`, `GET /api/engine/runs/:runId?conversationId=<id>`.

The opencode engine always runs inside the active conversation sandbox and uses an allowlisted process environment. It records command metadata, JSON event summaries, external session ids when available, changed files, and exit state into workspace run events.

When a conversation has a saved session summary, `OpenCodeEngine` includes a concise "Persistent session summary" section in the run prompt. The summary is owned by AetherOps persistence, but it is refreshed deterministically from local data rather than by a hidden model call.

## 2.1 Source Of Truth

Do not guess where data lives. The main sources of truth are:

- SQLite for agents, sessions, messages, runs, run events, tasks, and task events
- opencode conversation sandboxes under `workspace/opencode/agents/<agentId>/sessions/<conversationId>/`
- AetherOps guide files such as agent standing orders and heartbeat configuration under `workspace/opencode/agents/<agentId>/`
- provider accounts and secrets through the local store helpers in [`server/db.ts`](../server/db.ts)

If a behavior spans multiple layers, inspect the DB helper first and then the route/runtime wiring.

## 3. Backend Architecture

Primary flow starts in [`server/app.ts`](../server/app.ts).

### App wiring

`createApp(...)` builds:

- SQLite store from [`server/db.ts`](../server/db.ts)
- workspace manager from [`server/lib/workspace.ts`](../server/lib/workspace.ts)
- provider registry from [`server/provider-registry.ts`](../server/provider-registry.ts)
- channel registry from [`server/lib/channel-registry.ts`](../server/lib/channel-registry.ts)
- agent gateway from [`server/lib/agent-gateway.ts`](../server/lib/agent-gateway.ts)

### Agent gateway

[`server/lib/agent-gateway.ts`](../server/lib/agent-gateway.ts) is the composition layer. It creates:

- opencode `AgentEngine`
- task manager
- foreground turn runner

This is the main place to inspect when behavior spans providers, tasks, flows, heartbeats, and opencode runs.

### Runtime

[`server/lib/agent-gateway.ts`](../server/lib/agent-gateway.ts) now calls the configured `AgentEngine` for foreground chat, detached tasks, heartbeats, task-flow steps, and sub-agents.

The old internal provider execution path is not a product fallback. Chat, tasks, flows, heartbeat, and sub-agent execution must call `AgentEngine.runTurn(...)` and fail loudly if opencode fails.

For foreground chat, the path is:

1. `POST /api/chat/stream` in [`../server/app.ts`](../server/app.ts)
2. `gateway.runForegroundTurn(...)`
3. configured `AgentEngine.runTurn(...)`
4. opencode CLI workspace execution with AetherOps run context and guide files embedded into the engine prompt
5. run event persistence
6. SSE back to the client

For detached tasks, the path is:

1. `POST /api/agents/:agentId/tasks`
2. task record creation
3. `taskManager.runTask(...)`
4. `executeDetachedTask(...)` in [`../server/lib/agent-gateway.ts`](../server/lib/agent-gateway.ts)
5. `AgentEngine.runTurn(...)`
6. assistant result appended back into the session only when opencode emits final assistant text

### Tools

AetherOps no longer owns an internal executable tool runtime in the product path. Filesystem, command, browser, MCP, and external-tool behavior should be configured in opencode itself. AetherOps records opencode run events and changed-file summaries.

### MCP configuration assistant

The MCP tab is useful by design, but it is still not an AetherOps-owned MCP runtime.

- Catalog route: `GET /api/mcp/catalog`.
- Safe config metadata route: `GET /api/mcp/config/status`.
- Test route: `POST /api/mcp/test-run`.
- Deprecated execution/registration route: `POST /api/mcp/servers` returns `410 Gone`.

The catalog provides copyable opencode config snippets, risk notes, recommended boundaries, and test prompts for common categories such as Filesystem, Browser/Web, GitHub, and Database. The test route creates a normal detached task through `TaskManager -> AgentEngine.runTurn(...) -> opencode`; it does not directly execute an MCP server.

Path-safety rule: normal API responses show display-safe config labels. Absolute local config paths are only returned when debug path exposure is explicitly enabled.

### Computer Use

Custom AetherOps Computer Use was removed from the product path. `/api/computer-use/*` returns `410 Gone`. Browser/computer automation should be configured in opencode or an opencode MCP integration.

### Skills and plugins

Internal skill/plugin execution was removed from the product path. Put repeatable behavior in agent standing orders, workflow step prompts, or opencode configuration.

The Skill tab now exposes a template library, not an execution runtime.

- Catalog route: `GET /api/skill-templates`.
- Standing-order application route: `POST /api/agents/:agentId/skill-templates/:templateId/apply-standing-orders`.
- Heartbeat application route: `POST /api/agents/:agentId/skill-templates/:templateId/apply-heartbeat`.
- Deprecated execution route: `GET/POST /api/agents/:agentId/skills` still returns `410 Gone`.

Skill templates contain descriptions, standing-order patches, flow templates, verification checklists, heartbeat recipes, and suggested opencode prompts. Applying a template only edits agent instruction files or creates a normal queued TaskFlow; it never starts a hidden AetherOps tool/plugin runtime.

### Memory

AetherOps does not run a separate internal memory tool path in opencode-only mode. Persistent working context should be expressed through session history, agent standing orders, task-flow prompts, and opencode workspace artifacts.

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

Task kinds:

- `detached`: operator-created background work
- `heartbeat`: built-in recurring health/progress check
- `continuation`: resumed run continuation
- `scheduled`: user-defined automation rule materialization
- `subagent`: child session work spawned from a parent run
- `flow_step`: one step in an ordered task flow

Tasks can append assistant messages back into the session when they finish.

### Automation rules

User-defined automation rules live beside Heartbeat. The scheduler only materializes them when `ENABLE_AGENT_AUTOMATIONS=true`; manual "run now" actions are allowed without that flag. A materialized rule is a normal `taskKind: "scheduled"` task with `automationRuleId` set, so execution still flows through `TaskManager -> AgentEngine.runTurn(...) -> opencode`.

Automation rule routes:

- `GET /api/agents/:agentId/automation-rules`
- `POST /api/agents/:agentId/automation-rules`
- `PATCH /api/agents/:agentId/automation-rules/:ruleId`
- `DELETE /api/agents/:agentId/automation-rules/:ruleId`
- `POST /api/agents/:agentId/automation-rules/:ruleId/trigger`

Important invariants:

- never create a hidden provider/tool fallback for rule execution
- keep one queued/running task per rule
- validate agent/session ownership before materializing work
- preserve past task/run audit records when rules are deleted

### Task flows

Task flows are ordered, observable long-running workflows on top of detached tasks.

- storage: `task_flows` and `task_flow_steps`
- runtime: [`server/lib/task-manager.ts`](../server/lib/task-manager.ts)
- API: `POST /api/agents/:agentId/flows`, `POST /api/agents/:agentId/flows/draft`, `GET /api/flows/:flowId`, `POST /api/flows/:flowId/start`, `POST /api/flows/:flowId/resume`, `POST /api/flows/:flowId/steps/:stepId/retry`, `POST /api/flows/:flowId/steps/:stepId/skip`, `POST /api/flows/:flowId/cancel`
- UI: [`src/components/CockpitSectionView.tsx`](../src/components/CockpitSectionView.tsx)

Rules:

- only one runnable step is executed at a time
- flow drafts are deterministic review objects and do not create DB flows until the operator saves them
- a queued step runs only after its dependency is `completed` or `skipped`
- failed steps fail the flow until the operator retries or resumes
- retry resets the selected step and downstream dependency chain
- skip counts as dependency-satisfied
- `GET /api/flows/:flowId` includes linked task/run summaries for each step

### Session summaries, artifacts, and run debugger

These features improve observability without adding another execution runtime.

- Summary routes: `GET /api/conversations/:id/summary`, `PUT /api/conversations/:id/summary`, `POST /api/conversations/:id/summary/refresh`.
- Artifact routes: `GET /api/runs/:runId/artifacts?conversationId=<id>`, `GET /api/artifacts/:artifactId/preview`, `GET /api/artifacts/:artifactId/diff`.
- Debug route: `GET /api/runs/:runId/debug?conversationId=<id>`.

Safety invariants:

- artifact paths are stored and returned as relative paths
- preview is read-only and tied to the artifact's run/conversation ownership
- unsupported or binary previews stay explicit instead of being coerced
- debugger payloads are capped and intended for local diagnosis, not public log export

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
- [`src/components/CockpitSectionView.tsx`](../src/components/CockpitSectionView.tsx)
- [`src/components/CockpitPanels.tsx`](../src/components/CockpitPanels.tsx)

When changing frontend behavior, preserve these constraints:

- state must stay scoped to active agent/session/run/task
- stale async requests must not overwrite newer state
- cockpit file/log panels must not leak absolute host paths
- unsupported file encodings must remain explicit instead of being silently corrupted

State orchestration in `src/App.tsx` is high leverage. Change it carefully and prefer keeping fetch helpers, selection state, and refresh sequencing explicit.

## 5. Workspace Rules

The workspace manager is still security-sensitive because it creates and cleans opencode sandboxes, anchors agent control files, and summarizes changed files. Direct workspace tree/file/folder CRUD routes were removed from the product path and return `410 Gone`.

Relevant file:

- [`server/lib/workspace.ts`](../server/lib/workspace.ts)

Required invariants:

- reject traversal and absolute-path escapes
- reject symlink/junction/reparse-point escapes
- read-only endpoints must not create directories
- deleting a conversation must clean only that session sandbox
- normal API responses must use relative paths

Never bypass `workspace.ts` for sandbox lifecycle or changed-file reporting.

If a file feature looks simple but touches path resolution, treat it as security-sensitive work and keep execution delegated to opencode.

## 6. Exec Rules

Relevant file:

- [`server/lib/exec-command.ts`](../server/lib/exec-command.ts)

Current expectation:

- product execution goes through opencode, not direct AetherOps command tools
- structured helper execution only by default
- safe working directory under sandbox
- timeout and abort support
- Windows process-tree cleanup on timeout/cancel
- output caps

Do not reintroduce raw shell execution or direct command tools as default product behavior.

If a command execution change needs more power, gate it explicitly behind the unsafe flag instead of weakening the default path.

## 7. Browser / Web Research Rules

AetherOps no longer owns a browser, web research, or Computer Use runtime. `/api/computer-use/*` returns `410 Gone`, and browser/web automation should be configured in opencode or an opencode MCP integration.

Do not add a hidden AetherOps fallback for browsing, screenshots, network fetches, or local computer control. If opencode writes artifacts, keep them scoped to the active session sandbox and surface them through run events or changed-file summaries.

## 8. Route Map

High-value routes:

- `GET /api/providers`
- `GET /api/agents`
- `POST /api/agents`
- `DELETE /api/agents/:agentId`
- `GET /api/agents/:agentId/tasks`
- `POST /api/agents/:agentId/tasks`
- `POST /api/agents/:agentId/tasks/:taskId/cancel`
- `GET /api/agents/:agentId/tasks/:taskId/events`
- `GET/POST /api/conversations`
- `GET /api/conversations/:id/messages`
- `GET/PUT/POST /api/conversations/:id/summary`
- `POST /api/chat/stream`
- Removed workspace file CRUD routes return `410 Gone`; use opencode runs for file work.
- `GET /api/workspace/runs`
- `GET /api/workspace/runs/:runId/events`
- `GET /api/runs/:runId/artifacts?conversationId=<id>`
- `GET /api/runs/:runId/debug?conversationId=<id>`
- `GET /api/artifacts/:artifactId/preview`
- `GET /api/artifacts/:artifactId/diff`
- `GET /api/plugins` returns empty local-plugin metadata for compatibility.
- Removed internal tool/profile routes return `410 Gone`; use opencode MCP/tool configuration.
- Removed memory and skill routes return `410 Gone`; use standing orders, workflow prompts, session history, and opencode artifacts.
- `/api/computer-use/*` returns `410 Gone`; use opencode browser/computer integrations.
- `GET /api/channels`

When routes and frontend drift apart, update both `server/app.ts` and `src/api.ts`.

If you add a scoped route, also check that ownership validation exists in `server/db.ts` or route-level lookup logic.

## 9. Recommended Task Routing

If your task is about:

- DB schema or persistence:
  - inspect `server/db.ts`, `server/db.test.ts`
- run lifecycle, opencode execution, cancellation:
  - inspect `server/lib/opencode-engine.ts`, `server/lib/agent-engine.ts`, `server/lib/agent-gateway.ts`
- providers:
  - inspect `server/providers/*.ts`
- sandbox/file safety:
  - inspect `server/lib/workspace.ts`, `server/lib/workspace.test.ts`
- tasks/background work:
  - inspect `server/lib/task-manager.ts`
- external tool/skill metadata:
  - inspect opencode configuration, `server/routes/platform.routes.ts`, and cockpit metadata displays
- frontend agent/session/cockpit state:
  - inspect `src/App.tsx`, `src/api.ts`, `src/components/CockpitSectionView.tsx`, `src/components/CockpitPanels.tsx`

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
curl.exe -i http://127.0.0.1:8787/api/agents/default-agent/skills
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

- send a chat that asks opencode to create a file in the current session workspace
- confirm chat activity shows opencode run progress
- open the cockpit files/log panels
- confirm the changed-file summary includes the new file
- confirm run ledger shows terminal status

Recommended verification prompt:

```text
Create hello_browser.ts in the current session workspace with exactly:
export const browserCheck = (): string => 'ok';
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
