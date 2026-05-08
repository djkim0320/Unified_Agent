# Agent Platform Roadmap

This document describes the intended direction of `AetherOps`.

## Current State

The repository already supports:

- local React + Express + SQLite runtime
- webchat as the first channel
- per-agent sessions backed by the `conversations` table
- persistent messages, runs, run events, tasks, and task events
- opencode session sandboxes
- agent standing orders and heartbeat control files
- detached tasks
- task-flow scheduling
- chat-to-flow draft generation
- persistent session summaries injected into opencode prompt context
- run-scoped artifacts with stable text snapshots, safe preview, and small-file diff
- structured run debugger summaries
- protected full export for report/artifact/session bundles, with redacted defaults
- safe search across AetherOps DB records without workspace crawling
- human approval and verification gates inside task flows
- research projects with questions, hypotheses, evidence ledgers, autonomy budgets, deterministic loop proposals, linked Flow execution, and redacted final reports
- MCP configuration assistant for opencode config snippets, dry-run validation, risk notes, and opencode-backed test tasks
- skill template library for built-in and custom reusable prompts, flow templates, standing-order patches, verification checklists, and heartbeat recipes
- opencode-backed execution through the embedded `opencode-ai` launcher
- multi-provider account and model selection

## Target Shape

The long-term platform model is:

- cockpit, scheduler, and log store
- Agent Gateway
- Session Router
- OpenCodeEngine bridge
- Task and Flow Manager
- Channel Registry
- opencode-managed filesystem, command, browser, MCP, and external-tool capabilities

The current implementation is opencode-only for execution. The remaining work is mostly deeper integration, better UX, and stronger observability around opencode runs.

## Priority Order

1. Security and correctness
2. Agent/session/task coherence
3. opencode run reliability and observability
4. Better visible context through standing orders, summaries, and artifacts
5. Research autonomy with explicit budgets, evidence tracking, and human checkpoints
6. Multi-agent UX polish
7. More channel and external-tool metadata polish

## Roadmap Themes

### 1. Runtime reliability

- keep all workspace execution routed through opencode
- fail loudly instead of fabricating provider/tool fallbacks
- tighten cancellation and timeout semantics
- keep engine readiness contextual with auth-command, provider credential, Codex OAuth, credential-sync, and recent successful-run evidence
- reduce planner instability in live Codex workflows

### 2. Persistent context

- implemented: session summaries can be saved, deterministically refreshed with report/artifact/task signals, structured as project memory, and injected into future opencode runs
- implemented: opencode-backed summary suggestion tasks are normal detached tasks and do not mutate memory automatically; operators review and apply suggestions explicitly
- add better session-summary compaction
- keep session history, opencode workspace artifacts, and agent control files visible

### 3. Tasks and automation

- expand detached task workflows
- implemented: Heartbeat and user-defined automation rules materialize normal opencode-backed tasks when `ENABLE_AGENT_AUTOMATIONS=true`
- keep conservative local automation defaults
- add clearer scheduling, pause windows, and automation debugging UX

### 4. External capabilities

- implemented: surface opencode MCP catalog/status/test-run metadata and snippet validation without adding an AetherOps runtime
- improve guidance for configuring filesystem, command, browser, and MCP behavior in opencode
- keep removed compatibility routes explicit with `410 Gone`

### 5. Frontend operations UX

- better agent/session/task navigation
- implemented: flow draft dependency editing, approval gates, structured summary panel, snapshot-backed artifact preview/diff, redacted report copy, safe search/export, custom skills, Flow-to-Skill reuse, and run debugger entry points in the cockpit
- clearer run timeline presentation
- stronger changed-file and run-log inspection workflows
- reduce state race conditions and stale refresh hazards

### 6. Research autonomy

- implemented: Research tab for project dashboards, questions, hypotheses, evidence, loop proposals, reports, role-specific subagent tasks, and research search
- implemented: deterministic research loop proposal that creates normal TaskFlows with approval/verification gates rather than direct hidden execution
- implemented: conservative evidence extraction from local flow summaries, task results, report artifacts, and artifact summaries
- keep autonomy disabled by default and bounded by loop/day/runtime/task budgets
- keep external/MCP/browser-style work behind explicit approval gates and opencode configuration
- next: improve evidence review UX, source provenance scoring, and final report editing workflows

## Non-Goals

Not the current priority:

- external messaging channel expansion first
- complex multi-agent orchestration
- hosted multi-user deployment
- hidden AetherOps tool, browser, Computer Use, plugin, skill, or memory runtimes

## Working Rule

When choosing between a larger refactor and a safe vertical slice, prefer the vertical slice if it preserves:

- correctness
- local debuggability
- workspace safety
- agent usefulness
