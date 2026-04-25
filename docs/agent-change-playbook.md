# Agent Change Playbook

Practical task routing guide for AI agents editing `Unified_Agent`.

Use this after reading [`../AGENTS.md`](../AGENTS.md) and [`agent-operator-guide.md`](agent-operator-guide.md).

## 1. Core Rule

This repo has a platform-shaped architecture, but many behaviors still converge in a few high-leverage files.

Do not start by patching everything at once.

Route your change to the narrowest layer first:

- persistence in `server/db.ts`
- API contracts in `server/app.ts` and `src/api.ts`
- runtime behavior in `server/lib/agent-runtime.ts`
- tool registration in `server/lib/tool-registry.ts` and `server/plugins/core.ts`
- workspace safety in `server/lib/workspace.ts`
- top-level UI state in `src/App.tsx`

## 2. Common Task Recipes

### A. Add or change an API route

Touch:

- [`../server/app.ts`](../server/app.ts)
- [`../src/api.ts`](../src/api.ts)
- [`../src/types.ts`](../src/types.ts) if the payload shape changed
- closest UI component that consumes the route

Minimum checks:

- route exists in server
- client helper matches query/body shape
- frontend type matches actual JSON
- tests cover ownership or validation if the route is scoped

Minimum tests:

- `npm.cmd exec -- vitest run --config vitest.server.config.ts server/app.test.ts`
- frontend test if the route feeds visible UI state

### B. Change DB schema or persistent domain logic

Touch:

- [`../server/db.ts`](../server/db.ts)
- [`../server/types.ts`](../server/types.ts) if stored records changed
- any route or runtime code that reads the changed record

Common cases:

- agent/session ownership
- run/task status transitions
- default-agent bootstrapping
- cascades on delete

Minimum tests:

- `npm.cmd exec -- vitest run --config vitest.server.config.ts server/db.test.ts`
- `server/app.test.ts` if route behavior depends on the changed shape

### C. Change the agent loop or tool calling

Touch:

- [`../server/lib/agent-runtime.ts`](../server/lib/agent-runtime.ts)
- [`../server/lib/agent-step.ts`](../server/lib/agent-step.ts)
- provider adapter if the change is provider-specific

Do not forget:

- run events
- cancellation propagation
- max-step and deadline behavior
- finalization path

Minimum tests:

- `npm.cmd exec -- vitest run --config vitest.server.config.ts server/lib/agent-runtime.test.ts`

Manual check:

- run a chat that triggers at least one tool call and reaches a final answer

### D. Add or change a tool

Touch:

- [`../server/lib/tool-registry.ts`](../server/lib/tool-registry.ts)
- [`../server/plugins/core.ts`](../server/plugins/core.ts) or the owning plugin
- runtime tests if planner guidance or tool execution semantics changed

Keep these fields coherent:

- `name`
- `description`
- `permission`
- `schema`
- `example`
- `execute`

Do not hide tool behavior in ad hoc runtime switches.

Minimum tests:

- runtime test that the tool is visible to planning
- execution test for success and validation failure

### E. Change plugin or skill loading

Touch:

- [`../server/lib/plugin-manager.ts`](../server/lib/plugin-manager.ts)
- [`../server/plugins/core.ts`](../server/plugins/core.ts)
- [`../server/app.ts`](../server/app.ts) if metadata routes changed
- [`../src/App.tsx`](../src/App.tsx) if platform metadata display changed

Remember:

- built-in plugin metadata and local plugin manifests must coexist
- shared skills live under `workspace/shared/skills/`
- agent skills live under `workspace/agents/<agentId>/skills/`

### F. Change memory behavior

Touch:

- [`../server/lib/memory-manager.ts`](../server/lib/memory-manager.ts)
- [`../server/lib/workspace.ts`](../server/lib/workspace.ts) if file layout or search changes
- routes in [`../server/app.ts`](../server/app.ts) if memory API payloads changed

Source of truth:

- `workspace/agents/<agentId>/MEMORY.md`
- `workspace/agents/<agentId>/memory/YYYY-MM-DD.md`

Do not move durable memory into hidden prompt state.

### G. Change detached task behavior

Touch:

- [`../server/lib/task-manager.ts`](../server/lib/task-manager.ts)
- [`../server/db.ts`](../server/db.ts)
- [`../server/lib/agent-gateway.ts`](../server/lib/agent-gateway.ts) if detached execution flow changed
- frontend task consumers in [`../src/App.tsx`](../src/App.tsx) and [`../src/components/WorkspaceView.tsx`](../src/components/WorkspaceView.tsx)

Check:

- `queued -> running -> terminal` lifecycle
- task events stay append-only and scoped
- result delivery back into the originating session still works

### H. Change workspace sandbox or file preview

Touch:

- [`../server/lib/workspace.ts`](../server/lib/workspace.ts)
- [`../server/app.ts`](../server/app.ts) for workspace routes
- [`../src/components/WorkspaceView.tsx`](../src/components/WorkspaceView.tsx)

Do not break:

- canonical boundary checks
- symlink/junction rejection
- read-only access without implicit directory creation
- relative-path-only responses in normal mode
- unsupported encoding handling

Minimum tests:

- `npm.cmd exec -- vitest run --config vitest.server.config.ts server/lib/workspace.test.ts`

### I. Change frontend agent/session/workspace state

Touch:

- [`../src/App.tsx`](../src/App.tsx)
- [`../src/api.ts`](../src/api.ts)
- the closest component under `src/components/`

State rules:

- agent switch must reset or refetch scoped state
- stale async responses must not overwrite newer selections
- selected run/task must remain stable after refresh
- workspace UI must not display host absolute paths

Minimum tests:

- `npm.cmd exec -- vitest run --config vitest.config.ts src/App.test.tsx src/api.test.ts`

### J. Change provider behavior or model metadata

Touch:

- the relevant file in [`../server/providers/`](../server/providers)
- [`../server/provider-registry.ts`](../server/provider-registry.ts) if adapter wiring changes
- frontend model metadata helpers if the visible model list changes

Check:

- auth path stays provider-specific
- model lists stay scoped to the correct provider
- chat route and provider settings route still agree on the provider kind

## 3. Verification Loops

### Small backend-only change

Run:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' exec -- tsc -p tsconfig.server.json --noEmit
& 'C:\Program Files\nodejs\npm.cmd' exec -- vitest run --config vitest.server.config.ts
```

### Small frontend-only change

Run:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' exec -- tsc --noEmit
& 'C:\Program Files\nodejs\npm.cmd' exec -- vitest run --config vitest.config.ts
```

### Cross-cutting change

Run:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' exec -- tsc --noEmit
& 'C:\Program Files\nodejs\npm.cmd' exec -- tsc -p tsconfig.server.json --noEmit
& 'C:\Program Files\nodejs\npm.cmd' exec -- vitest run --config vitest.config.ts
& 'C:\Program Files\nodejs\npm.cmd' exec -- vitest run --config vitest.server.config.ts
& 'C:\Program Files\nodejs\npm.cmd' exec -- vite build
```

## 4. Browser Validation Recipe

Use this when you need end-to-end proof that chat, runtime, and workspace still connect.

1. Start source backend on `127.0.0.1:8787`
2. Start Vite on `127.0.0.1:5173`
3. Open `http://127.0.0.1:5173`
4. Create or open a session
5. Send this prompt:

```text
Create hello_browser.ts in the current session workspace with exactly:
export const browserCheck = (): string => 'ok';
Use the write_file tool.
```

Expected result:

- chat shows tool activity
- run timeline reaches a terminal status
- workspace tree shows `hello_browser.ts`
- the file contents match exactly

## 5. Common Failure Modes

### Route exists in code but 404s in the browser

Likely cause:

- old `dist/server/index.js` still owns port `8787`

Check:

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen | Select-Object -Property LocalAddress,LocalPort,OwningProcess
Get-Process -Id <PID>
```

### Frontend still shows old data after a change

Likely causes:

- stale request won the race
- agent/session selection did not reset dependent state
- `src/api.ts` and the route payload drifted

### Tool calling suddenly regressed

Likely causes:

- registry metadata no longer matches runtime behavior
- planner guidance lost the tool example or schema shape
- provider-specific structured calling path drifted from fallback JSON path

### Memory behavior looks inconsistent

Likely causes:

- file-backed source of truth was bypassed
- durable and daily memory were mixed up
- agent scope was lost during request wiring

## 6. Definition Of Done

Before closing work, confirm:

- the narrowest relevant tests passed
- the route, client helper, and types agree
- agent/session ownership still holds
- platform metadata is still scoped correctly
- browser/manual verification was done if the change crossed chat + runtime + workspace
- docs were updated if the task changed a stable workflow or public route
