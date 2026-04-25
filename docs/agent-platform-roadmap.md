# Agent Platform Roadmap

This document describes the intended direction of `Unified_Agent`.

## Current State

The repository already supports:

- local React + Express + SQLite runtime
- webchat as the first channel
- per-agent sessions backed by the `conversations` table
- persistent messages, runs, run events, tasks, and task events
- local workspace sandboxes
- file-backed memory
- plugin and skill loading
- detached tasks
- multi-provider execution

## Target Shape

The long-term platform model is:

- Agent Gateway
- Session Router
- Agent Runtime
- Tool Registry
- Plugin Manager
- Memory Manager
- Task Manager
- Channel Registry

The current implementation already contains early versions of most of these pieces. The remaining work is mostly deeper integration, better UX, and broader automation support.

## Priority Order

1. Security and correctness
2. Agent/session/task coherence
3. Better structured tool calling
4. Stronger memory and compaction
5. Multi-agent UX polish
6. More channel/plugin extensibility

## Roadmap Themes

### 1. Runtime reliability

- improve provider-native structured tool calling where practical
- keep strict fallback for providers that still need text planning
- tighten cancellation and timeout semantics
- reduce planner instability in live Codex workflows

### 2. Memory

- improve memory retrieval quality
- add better session-summary compaction
- keep file-backed memory as the source of truth

### 3. Tasks and automation

- expand detached task workflows
- keep conservative local automation defaults
- add clearer scheduling and automation UX

### 4. Plugins and skills

- strengthen local plugin manifests
- improve skill discoverability
- keep tools, skills, and plugins clearly separated

### 5. Frontend operations UX

- better agent/session/task navigation
- clearer run timeline presentation
- stronger workspace inspection workflows
- reduce state race conditions and stale refresh hazards

## Non-Goals

Not the current priority:

- external messaging channel expansion first
- complex multi-agent orchestration
- hosted multi-user deployment
- hidden or opaque memory systems

## Working Rule

When choosing between a larger refactor and a safe vertical slice, prefer the vertical slice if it preserves:

- correctness
- local debuggability
- workspace safety
- agent usefulness
