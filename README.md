# AetherOps

AetherOps is a React + Express + SQLite local-first cockpit, scheduler, and log store for opencode-backed agent work.

The product boundary is intentionally narrow:

- AetherOps owns sessions, provider configuration, task scheduling, workflow state, summaries, artifacts, reports, search metadata, and the operator UI.
- opencode owns workspace inspection, file edits, command execution, MCP capability use, and any future browser/computer automation configured through opencode.
- AetherOps does not run a hidden tool loop, internal MCP runtime, executable skill/plugin runtime, Computer Use API, or arbitrary workspace file CRUD product path.

## Supported providers

- OpenAI
- Anthropic
- Gemini
- Ollama
- OpenAI Codex

## Highlights

- Shared chat UI across all providers.
- Conversation-level provider and model persistence.
- SSE streaming from the server to the web client.
- Encrypted provider secrets stored in local SQLite.
- Codex OAuth callback flow plus optional Codex CLI `auth.json` import.
- Multiple agents with scoped sessions, opencode workspaces, run logs, and task history.
- Cockpit UI for workflow scheduling, opencode execution traces, changed-file summaries, reports, artifacts, and extension-status metadata.
- Detached background task ledger plus user-defined automation rules that materialize opencode-backed scheduled tasks.
- Long-running task flows with dependencies, human approval/verification gates, start/resume/retry/skip/cancel controls, and step-linked task/run traces.
- Chat-to-Flow draft generation that turns a project prompt into a reviewable flow before saving.
- Persistent session summaries injected into future opencode runs without introducing a second model path.
- Reviewable opencode-backed summary suggestions that never mutate memory until the operator applies them.
- Run-scoped artifacts with immutable small-text snapshots, safe previews, real unified diffs, and structured run debugger summaries.
- Safe record search across sessions, summaries, reports, artifacts, tasks, and flows without crawling workspace files.
- Redacted session export/import bundles for backup and handoff without provider secrets or workspace file import.
- Research projects with questions, hypotheses, evidence ledgers, bounded autonomy budgets, human approval gates, deterministic loop proposals, and final research reports.
- Embedded `opencode-ai` Workspace Engine integration; chat, tasks, flows, heartbeat, and sub-agents all use the same opencode engine path.

## Run on Windows PowerShell

If PowerShell execution policy blocks `npm` or `pnpm` shim scripts, use the `.cmd` entrypoints directly.

Install:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' install
```

Start development:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run dev
```

Run tests:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' test
```

Build production assets:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run build
```

Start the built server:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' start
```

## Local Data

- SQLite DB: `.data/chat.sqlite`
- Encryption key: `.data/secret.key`
- opencode session workspaces: `workspace/opencode/agents/<agentId>/sessions/<conversationId>/`
- AetherOps agent control files: `workspace/opencode/agents/<agentId>/SOUL.md`, `STANDING_ORDERS.md`, and `HEARTBEAT.md`
- One-time opencode-only migration marker: `.data/opencode-only-migration.json`
- On first server start after the opencode-only migration, only legacy AetherOps runtime folders are deleted: `workspace/agents`, `workspace/shared/skills`, and `workspace/shared/plugins`.
- `.data`, SQLite history, provider secrets, task/flow/run audit records, and local API tokens are preserved.

## Long-Running Workflows

Task flows are the local-first workflow primitive for research or implementation that should not be squeezed into one chat turn. A flow contains up to 8 ordered steps, each with a `stepKey`, title, prompt, optional `dependencyStepKey`, and `stepKind`.

Supported step kinds:

- `task`: normal opencode-backed task step.
- `approval_gate`: human checkpoint that pauses the flow without creating an opencode task.
- `verification_gate`: human verification checkpoint that pauses until approved, skipped, or denied.

For trusted local validation runs that need opencode to edit files without an interactive permission prompt, start the server with `AETHEROPS_OPENCODE_AUTO_APPROVE=true`. This adds opencode's `--dangerously-skip-permissions` flag, so keep it off for untrusted sessions or prompts.

Flow operation endpoints:

- `POST /api/agents/:agentId/flows`
- `POST /api/agents/:agentId/flows/draft`
- `GET /api/flows/:flowId`
- `POST /api/flows/:flowId/start`
- `POST /api/flows/:flowId/resume`
- `POST /api/flows/:flowId/steps/:stepId/retry`
- `POST /api/flows/:flowId/steps/:stepId/skip`
- `POST /api/flows/:flowId/steps/:stepId/approve`
- `POST /api/flows/:flowId/steps/:stepId/deny`
- `POST /api/flows/:flowId/cancel`

The cockpit workflow view exposes the same controls, including an outline-to-steps editor, dependency editor, approval gates, and per-step task/run summaries.

Standalone failed, timed-out, or cancelled tasks can be retried with `POST /api/agents/:agentId/tasks/:taskId/retry`; `flow_step` tasks must still use the flow step retry endpoint so Flow state remains coherent.

## Flow Drafts, Summaries, Artifacts, and Search

AetherOps adds operator-facing memory and inspection surfaces around opencode runs while keeping opencode as the only workspace execution engine.

- `POST /api/agents/:agentId/flows/draft` converts a prompt or outline into a deterministic draft with up to 8 ordered steps. It does not create or start a flow until the operator reviews and saves it.
- `GET/PUT/POST /api/conversations/:conversationId/summary` stores and refreshes structured project memory. Refresh is deterministic from local session data, messages, reports, artifacts, runs, tasks, and flows.
- `POST /api/conversations/:conversationId/summary/refresh-task` creates a normal opencode-backed detached task that proposes an updated summary; it does not mutate memory until the operator saves it.
- `GET /api/conversations/:conversationId/summary/suggestions` loads completed opencode-backed summary suggestions for review.
- `POST /api/conversations/:conversationId/summary/apply-suggestion` saves a reviewed suggestion into persistent session memory.
- `GET /api/runs/:runId/artifacts?conversationId=<id>` lists run-scoped artifacts created from changed files reported by opencode.
- `GET /api/artifacts/:artifactId/preview?mode=redacted|full` prefers the saved run snapshot and only falls back to current workspace content when no snapshot exists. It does not expose arbitrary workspace browsing.
- `GET /api/artifacts/:artifactId/diff` returns a real unified text diff when before/after snapshots are available, and a clear unavailable reason for binary, truncated, oversized, or baseline-less files.
- `GET /api/runs/:runId/debug?conversationId=<id>` returns a redacted debug summary with status, duration, model, changed files, last events, artifact count, prompt-presence booleans, and task linkage.
- `GET /api/search?q=...&agentId=...&conversationId=...` searches AetherOps DB records only and returns redacted snippets.
- `GET /api/conversations/:conversationId/export?mode=redacted|full` exports a safe session bundle.
- `POST /api/conversations/import` imports planning/memory/report metadata into a new session without provider secrets, workspace files, or fake historical execution state.

Full report/artifact/session export is a local power-user action. `mode=full` requires a valid `X-Local-API-Token` header, or `AETHEROPS_ENABLE_FULL_REPORT_EXPORT=true` from a loopback/local host request. Normal preview/copy/export paths stay redacted by default.

## Research Autonomy Layer

The Research tab adds a bounded research layer above normal sessions and flows. It is an operator control surface, not a hidden runtime.

- A Research Project stores an objective, optional domain, linked session, autonomy budget, and safety policy.
- Questions, hypotheses, and evidence form a local evidence ledger with confidence and uncertainty fields.
- `POST /api/research/projects/:projectId/loops/propose` creates a reviewable queued TaskFlow with deterministic steps: research plan, evidence gathering, hypothesis update, approval gate, synthesis, verification, and next actions.
- `autoStart=true` is allowed only when project autonomy is enabled and preflight/budget checks pass.
- Approval and verification gates pause flows for human decisions and do not create opencode tasks.
- When a linked research Flow finishes, AetherOps conservatively extracts local evidence from flow summaries, task results, reports, and artifact summaries. It does not fabricate citations or claim external sources unless they exist in local records.
- `POST /api/research/projects/:projectId/report` creates a deterministic redacted research report artifact from the objective, questions, hypotheses, evidence, uncertainties, and linked artifacts/runs.
- Optional report-task, summary-task, and subagent role actions create ordinary opencode-backed tasks for review. They do not mutate project memory or evidence without an explicit operator action.

Default autonomy budget:

- `maxLoopsPerDay=3`
- `maxConsecutiveLoops=1`
- `maxRuntimeMinutes=60`
- `maxTasksPerLoop=7`
- approval required for external work, file writes, and command execution
- no MCP categories are allowed by default

Research search is scoped to AetherOps records and returns redacted snippets. It does not crawl arbitrary workspace files.

## MCP Configuration Assistant

The MCP tab is an opencode configuration assistant, not an MCP runtime.

- `GET /api/mcp/catalog` returns static candidate metadata for Filesystem, Browser/Web, GitHub, and Database MCP categories.
- `GET /api/mcp/config/status` reports parser type, source label, write safety, validation warnings, configured server metadata, and auth evidence.
- `POST /api/mcp/config/validate-snippet` dry-runs an opencode MCP config snippet, reports risk warnings and env placeholders, and rejects literal token-looking values. AetherOps still does not write config in this flow.
- `POST /api/mcp/test-run` creates a normal opencode-backed background task that asks opencode to verify an MCP setup.
- `POST /api/mcp/servers` remains `410 Gone`; AetherOps does not register or execute MCP servers itself.

The UI shows config source labels, configured server count, risk warnings, copyable config snippets, and test-run creation actions. Absolute local config paths stay hidden unless debug path exposure is explicitly enabled.

## Skill Template Library

The Skill tab is a reusable prompt and workflow template library, not an executable plugin runtime.

- `GET /api/skill-templates` returns built-in plus DB-backed custom templates such as Codebase Review, Aircraft Research Flow, CFD Preparation Flow, and Release Checklist.
- `POST/PATCH/DELETE /api/agents/:agentId/skill-templates/:templateId?` manages custom templates. Built-in templates are read-only.
- `POST /api/agents/:agentId/skill-templates/from-flow/:flowId` saves an existing flow as a reusable custom template. Duplicate source-flow templates return `409` unless explicitly forced.
- `POST /api/agents/:agentId/skill-templates/:templateId/apply-standing-orders` appends a marked section to `STANDING_ORDERS.md` and prevents duplicate insertion.
- `POST /api/agents/:agentId/skill-templates/:templateId/apply-heartbeat` appends a marked heartbeat recipe without enabling Heartbeat automatically.
- The UI can turn a template into a queued TaskFlow, copy the suggested opencode prompt, or insert that prompt into the chat composer.
- `GET/POST /api/agents/:agentId/skills` remains `410 Gone`; AetherOps does not execute skills directly.

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
- Engine status includes `authEvidence`, which combines auth-command output, configured provider credentials, Codex OAuth/account state, credential sync, and recent successful opencode runs. Recent same-provider/model success is treated as stronger evidence; stale or mismatched runs become warnings instead of hiding real blockers.

Useful environment variables:

- `OPENCODE_BIN=opencode` only when you intentionally want to override the managed embedded package
- `OPENCODE_CONFIG_DIR=<path>`
- `OPENCODE_DISABLE_AUTOUPDATE=true`
- `OPENCODE_DISABLE_PRUNE=true`
- `OPENCODE_DISABLE_DEFAULT_PLUGINS=true`
- `AETHEROPS_OPENCODE_PREFIX_PROVIDER=true` if your opencode config expects `provider/model` strings instead of plain model aliases
- `AETHEROPS_MAX_ARTIFACT_SNAPSHOT_BYTES=65536` caps text captured into artifact snapshots
- `AETHEROPS_MAX_ARTIFACT_DIFF_BYTES=131072` caps unified diff output
- `AETHEROPS_ENABLE_FULL_REPORT_EXPORT=true` allows full export only for loopback/local-host requests when no local API token header is provided

Native engine endpoints:

- `GET /api/engine/status`
- `POST /api/engine/opencode/refresh-models`
- `POST /api/engine/opencode/auth/login`
- `GET /api/engine/runs/:runId?conversationId=<id>`

If opencode is not installed or not authenticated, the settings dialog shows the engine as unavailable and chat/task execution returns a structured run failure instead of silently falling back.

## Architecture Notes

- Agent contributor guide: [`AGENTS.md`](AGENTS.md)
- Detailed operator guide: [`docs/agent-operator-guide.md`](docs/agent-operator-guide.md)
- Change playbook for AI agents: [`docs/agent-change-playbook.md`](docs/agent-change-playbook.md)
- Roadmap: [`docs/agent-platform-roadmap.md`](docs/agent-platform-roadmap.md)
- ADR: [`docs/adr/001-agent-gateway-architecture.md`](docs/adr/001-agent-gateway-architecture.md)

## Safety Flags

- `ENABLE_UNSAFE_WORKSPACE_EXEC=true`: allows unsafe shell-style workspace execution. Safe default is off.
- `ENABLE_WORKSPACE_ROOT_SCOPE=true`: enables `scope=root` for workspace APIs. Safe default is off.
- `ENABLE_WORKSPACE_DEBUG_PATHS=true`: adds absolute workspace debug paths to workspace API responses. Safe default is off.
- `ENABLE_AGENT_AUTOMATIONS=true`: enables the conservative background scheduler for Heartbeat and user-defined automation rules. Immediate detached tasks and manual rule triggers do not require this flag.

## Automation Rules

Automation rules are agent-scoped periodic prompts that AetherOps stores in SQLite and converts into `taskKind: "scheduled"` tasks when due. They do not introduce a second execution runtime: every materialized task still runs through the same opencode engine path as chat, Heartbeat, workflows, and sub-agents.

Native rule endpoints:

- `GET /api/agents/:agentId/automation-rules`
- `POST /api/agents/:agentId/automation-rules`
- `PATCH /api/agents/:agentId/automation-rules/:ruleId`
- `DELETE /api/agents/:agentId/automation-rules/:ruleId`
- `POST /api/agents/:agentId/automation-rules/:ruleId/trigger`

The Settings tab exposes rule creation, edit, enable/disable, delete, and "run now" actions. Historical task/run audit logs are preserved when a rule is deleted.

## Codex Auth Import

The app checks:

- `%CODEX_HOME%\auth.json`
- `%USERPROFILE%\.codex\auth.json`

Only ChatGPT-backed Codex CLI sessions are imported.
