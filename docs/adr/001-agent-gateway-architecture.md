# ADR 001: Agent Gateway Architecture

## Status

Accepted

## Context

`Unified_Agent` started as a local chat app with provider selection and a shared UI. The product direction moved toward a local-first agent platform with:

- multiple agents
- session-scoped chat
- workspace-backed execution
- file-backed memory
- detached tasks
- plugins and skills

The architecture needed to evolve without discarding the working web app or existing local data.

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

- tool registry
- plugin manager
- memory manager
- task manager
- foreground runtime

This keeps provider adapters focused on model interaction and keeps local tool execution under server control.

### 4. Use file-backed memory

Memory stays visible and debuggable through files inside the agent workspace.

- durable memory in `MEMORY.md`
- daily notes in `memory/YYYY-MM-DD.md`

No hidden prompt-only memory should become the source of truth.

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
- allows tools, memory, and tasks to stay inspectable
- reduces coupling between provider auth and runtime behavior

Tradeoffs:

- some compatibility layers remain because `conversations` now act as sessions
- provider planning quality still varies by model
- frontend orchestration remains non-trivial because agent/session/run/task state must stay synchronized

## Follow-Up Work

- improve structured tool calling per provider
- continue breaking large frontend state concerns into narrower hooks
- expand plugin and skill ergonomics
- deepen task automation only after current runtime guarantees stay stable
