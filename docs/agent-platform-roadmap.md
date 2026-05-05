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
5. Multi-agent UX polish
6. More channel and external-tool metadata polish

## Roadmap Themes

### 1. Runtime reliability

- keep all workspace execution routed through opencode
- fail loudly instead of fabricating provider/tool fallbacks
- tighten cancellation and timeout semantics
- reduce planner instability in live Codex workflows

### 2. Persistent context

- improve standing-order and session-summary workflows
- add better session-summary compaction
- keep session history, opencode workspace artifacts, and agent control files visible

### 3. Tasks and automation

- expand detached task workflows
- implemented: Heartbeat and user-defined automation rules materialize normal opencode-backed tasks when `ENABLE_AGENT_AUTOMATIONS=true`
- keep conservative local automation defaults
- add clearer scheduling, pause windows, and automation debugging UX

### 4. External capabilities

- surface external tool/MCP metadata without adding an AetherOps runtime
- improve guidance for configuring filesystem, command, browser, and MCP behavior in opencode
- keep removed compatibility routes explicit with `410 Gone`

### 5. Frontend operations UX

- better agent/session/task navigation
- clearer run timeline presentation
- stronger changed-file and run-log inspection workflows
- reduce state race conditions and stale refresh hazards

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
