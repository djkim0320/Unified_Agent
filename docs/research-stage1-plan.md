# Research Stage 1 Plan

## Reused OpenClaw Subsystems

- Gateway remains the backend control plane for auth, pairing, WebSocket RPC, and static Control UI serving.
- Existing chat and session behavior stays intact through `ui/src/ui/views/chat.ts`, `ui/src/ui/controllers/chat.ts`, `src/gateway/server-chat.ts`, and `src/gateway/server-methods/sessions.ts`.
- Existing inline tool event handling stays intact through `ui/src/ui/app-tool-stream.ts`; Stage 1 only enriches tool metadata for research-specific deep links.
- Existing task and background-run machinery remains the source of truth for long-running jobs through `src/tasks/task-registry.ts` and `src/tasks/task-executor.ts`.
- Existing agent/workspace boundaries remain the underlying project boundary. Stage 1 maps one research project to one OpenClaw agent/workspace.
- Existing workspace skill loading remains intact through `src/agents/skills/workspace.ts`; research skills are copied into workspace skill directories instead of hardcoding tool routing in the UI.
- Existing plugin/tool registration remains intact through the bundled extension system and `api.registerTool(...)`.

## Thin New Layers

- `src/research/*` adds a thin filesystem-backed project, run, artifact, and add-on layer.
- Each workspace gains a small `.openclaw-research/` sidecar with:
  - `project.json`
  - `runs/<runId>.json`
  - `runs/<runId>.log`
  - `artifacts/index.json`
  - `artifacts/<runId>/...`
- New namespaced Gateway methods expose the research layer without replacing existing chat/session/config methods:
  - `research.projects.*`
  - `research.runs.*`
  - `research.artifacts.*`
  - `research.addons.*`
- Bundled mock research add-ons are introduced as normal OpenClaw extensions:
  - `mock_cfd`
  - `mock_concept`
  - `mock_cad`
- A research-first UI shell is layered on top of the existing Control UI rather than replacing the browser stack.

## Features Hidden Or Demoted Under Advanced

- Legacy operator and admin surfaces remain available, but they move out of the default research flow.
- The following surfaces are preserved behind `Advanced`:
  - channels
  - raw config editors
  - logs and debug tools
  - cron and automation operations
  - updates and infrastructure controls
  - legacy agent/admin panels

## Why This Stays Merge-Friendly

- The implementation keeps OpenClaw core runtime paths in place and adds research-specific behavior in new `src/research/*` modules plus namespaced Gateway handlers.
- Project state is stored in lightweight workspace sidecars instead of introducing a new database or second backend.
- The existing Control UI stack is extended in place, so upstream UI/runtime updates remain mergeable.
- Mock add-ons are bundled as regular extensions, which keeps the future path to real CFD or CAD add-ons aligned with OpenClaw’s existing plugin model.
