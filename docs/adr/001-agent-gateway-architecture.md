# ADR 001: Agent Gateway Architecture

## Status

Accepted

## Context

`AetherOps` started as a local chat app with provider selection and a shared UI. The product direction moved toward a local-first agent platform with:

- multiple agents
- session-scoped chat
- workspace-backed execution
- detached tasks
- task flows
- opencode session sandboxes
- visible run/event logging
- standing orders and workflow prompts for durable operator context

The architecture needed to evolve without discarding the working web app or existing local data.

Post-migration note: AetherOps is now opencode-only for workspace execution. Removed legacy AetherOps execution subsystems are not product paths; configure equivalent capabilities in opencode.

## Decision

The repository uses a webchat-first agent gateway model.

### 1. Keep webchat as the first channel

The current web UI remains the primary interaction surface.

- channel abstraction exists
- `webchat` is the first fully supported channel
- future channels are extension points, not current scope drivers

### 2. Treat conversations as sessions

For compatibility, the existing `conversations` table is retained and upgraded semantically.

- each conversation is a session
- each session belongs to an agent
- each session records its channel kind

This avoids destructive migration while enabling agent-first behavior.

### 3. Centralize execution through an agent gateway

The gateway composes:

- opencode `AgentEngine`
- task manager
- foreground runtime
- run/event persistence

This keeps provider adapters focused on account/model metadata while delegating filesystem, command, browser, MCP, and external-tool behavior to opencode configuration.

### 4. Keep persistent context visible

Persistent working context stays visible and debuggable through:

- session transcripts
- agent control files under `workspace/opencode/agents/<agentId>/`
- task-flow prompts
- artifacts written by opencode inside the active session sandbox

No hidden AetherOps memory runtime should become the source of truth.

### 5. Support detached tasks as a first-class concept

Longer-running work must have:

- persistent records
- explicit lifecycle states
- event history
- optional delivery back into the originating session

## Consequences

Positive:

- preserves the working app while enabling a stronger platform model
- keeps local debugging straightforward
- keeps opencode run events, changed files, and task history inspectable
- reduces coupling between provider auth and runtime behavior

Tradeoffs:

- some compatibility layers remain because `conversations` now act as sessions
- provider planning quality still varies by model
- frontend orchestration remains non-trivial because agent/session/run/task state must stay synchronized

## Follow-Up Work

- improve opencode run metadata and changed-file presentation
- continue breaking large frontend state concerns into narrower hooks
- improve standing-order and task-flow prompt ergonomics
- deepen task automation only after current runtime guarantees stay stable
