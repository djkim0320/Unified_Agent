# Agent Change Playbook

Practical task routing guide for AI agents editing `AetherOps`.

Use this after reading [`../AGENTS.md`](../AGENTS.md) and [`agent-operator-guide.md`](agent-operator-guide.md).

## 1. Core Rule

This repo has a platform-shaped architecture, but many behaviors still converge in a few high-leverage files.

Do not start by patching everything at once.

Route your change to the narrowest layer first:

- persistence in `server/db.ts`
- API contracts in `server/app.ts` and `src/api.ts`
- opencode execution behavior in `server/lib/opencode-engine.ts`, `server/lib/agent-engine.ts`, and `server/lib/agent-gateway.ts`
- external tool/MCP behavior in opencode configuration, not an AetherOps runtime
- workspace safety in `server/lib/workspace.ts`
- cockpit UI state in `src/App.tsx`, `src/components/CockpitSectionView.tsx`, and `src/components/CockpitPanels.tsx`

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

### C. Change opencode execution or run bridging

Touch:

- [`../server/lib/opencode-engine.ts`](../server/lib/opencode-engine.ts)
- [`../server/lib/agent-engine.ts`](../server/lib/agent-engine.ts)
- [`../server/lib/agent-gateway.ts`](../server/lib/agent-gateway.ts)
- [`../server/lib/task-manager.ts`](../server/lib/task-manager.ts) if detached execution or flows are affected
- provider adapter if the change is provider-specific

Do not forget:

- run events
- cancellation propagation
- deadline and abort behavior
- final assistant text and changed-file summaries
- no provider/tool fallback when opencode fails

Minimum tests:

- `npm.cmd exec -- vitest run --config vitest.server.config.ts server/lib/opencode-engine.test.ts server/lib/task-manager.test.ts`

Manual check:

- run a chat that reaches a terminal opencode run and records the expected run events

### D. Add or change a tool/MCP capability

Do not add a new AetherOps internal tool runtime. Configure filesystem, command, browser, and MCP behavior in opencode or an opencode MCP integration.

Touch only if the AetherOps cockpit needs metadata or compatibility behavior:

- [`../server/routes/platform.routes.ts`](../server/routes/platform.routes.ts)
- [`../src/components/CockpitSectionView.tsx`](../src/components/CockpitSectionView.tsx)
- [`../src/components/CockpitPanels.tsx`](../src/components/CockpitPanels.tsx)

Minimum tests:

- route/component tests for visible metadata or `410 Gone` compatibility behavior

### E. Change skills, plugins, or persistent instructions

Internal skill/plugin execution was removed. Put repeatable behavior in agent standing orders, workflow step prompts, or opencode configuration.

Touch:

- [`../server/lib/workspace.ts`](../server/lib/workspace.ts) for standing-order file layout
- [`../server/app.ts`](../server/app.ts) if compatibility route behavior changed
- [`../src/App.tsx`](../src/App.tsx) or cockpit components if visible metadata changed

### F. Change persistent working context

AetherOps no longer has a separate memory tool path. Use session history, agent standing orders, task-flow prompts, and opencode workspace artifacts.

Touch:

- [`../server/lib/workspace.ts`](../server/lib/workspace.ts) for agent guide/control files
- [`../server/lib/agent-gateway.ts`](../server/lib/agent-gateway.ts) if prompt context assembly changed
- [`../server/app.ts`](../server/app.ts) if removed memory routes changed

### G. Change detached task behavior

Touch:

- [`../server/lib/task-manager.ts`](../server/lib/task-manager.ts)
- [`../server/db.ts`](../server/db.ts)
- [`../server/lib/agent-gateway.ts`](../server/lib/agent-gateway.ts) if detached execution flow changed
- frontend task consumers in [`../src/App.tsx`](../src/App.tsx), [`../src/components/CockpitSectionView.tsx`](../src/components/CockpitSectionView.tsx), and [`../src/components/CockpitPanels.tsx`](../src/components/CockpitPanels.tsx)

Check:

- `queued -> running -> terminal` lifecycle
- task kinds are `detached`, `heartbeat`, `continuation`, `scheduled`, `subagent`, and `flow_step`
- terminal statuses are `completed`, `failed`, `timed_out`, and `cancelled`
- task events stay append-only and scoped
- result delivery back into the originating session still works

### H. Change opencode sandbox or changed-file reporting

Touch:

- [`../server/lib/workspace.ts`](../server/lib/workspace.ts)
- [`../server/routes/workspace.routes.ts`](../server/routes/workspace.routes.ts) for removed workspace route compatibility
- [`../src/components/CockpitSectionView.tsx`](../src/components/CockpitSectionView.tsx)

Do not break:

- canonical boundary checks
- symlink/junction rejection
- read-only access without implicit directory creation
- relative-path-only responses in normal mode
- direct workspace CRUD routes returning `410 Gone`

Minimum tests:

- `npm.cmd exec -- vitest run --config vitest.server.config.ts server/lib/workspace.test.ts`

### I. Change frontend agent/session/cockpit state

Touch:

- [`../src/App.tsx`](../src/App.tsx)
- [`../src/api.ts`](../src/api.ts)
- the closest component under `src/components/`

State rules:

- agent switch must reset or refetch scoped state
- stale async responses must not overwrite newer selections
- selected run/task must remain stable after refresh
- cockpit file/log panels must not display host absolute paths

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

Use this when you need end-to-end proof that chat, opencode execution, and cockpit logs still connect.

1. Start source backend on `127.0.0.1:8787`
2. Start Vite on `127.0.0.1:5173`
3. Open `http://127.0.0.1:5173`
4. Create or open a session
5. Send this prompt:

```text
Create hello_browser.ts in the current session workspace with exactly:
export const browserCheck = (): string => 'ok';
```

Expected result:

- chat shows opencode run activity
- run timeline reaches a terminal status
- cockpit changed-file list shows `hello_browser.ts`
- opencode created the file in the active session sandbox

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

### opencode execution suddenly regressed

Likely causes:

- opencode auth/config/model selection drifted from the selected AetherOps provider profile
- the run prompt lost required session, flow, or standing-order context
- opencode exited without JSON assistant events; inspect run events instead of fabricating a fallback response

### Context behavior looks inconsistent

Likely causes:

- standing orders or workflow step prompts were not included in the opencode run context
- the selected conversation sandbox or opencode session id was not reused as expected
- agent scope was lost during request wiring

## 6. Definition Of Done

Before closing work, confirm:

- the narrowest relevant tests passed
- the route, client helper, and types agree
- agent/session ownership still holds
- platform metadata is still scoped correctly
- browser/manual verification was done if the change crossed chat + opencode execution + cockpit logs
- docs were updated if the task changed a stable workflow or public route
