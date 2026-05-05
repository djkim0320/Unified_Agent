# Long-Running Agent Validation Report

Date: 2026-05-05

## Hypothesis

AetherOps should behave as an opencode-only control plane:

- It should run ordered workflow steps inside a conversation sandbox.
- It should reuse the same opencode session for dependent workflow steps.
- It should record task, run, changed-file, and result metadata for each step.
- It should fail loudly when opencode reports an error or produces no observable result.
- It should not use internal LLM/tool fallbacks or fabricated assistant output.

## Safe Validation Boundary

The validation prompts only created small text files inside newly created opencode conversation sandboxes:

- `workspace/opencode/agents/default-agent/sessions/<conversationId>/validation_report/*`

The prompts did not request deletion, credential access, external account changes, uploads, purchases, or access outside the session sandbox.

## Findings And Fixes

### 1. opencode child process hung during background runs

Observed behavior:

- Workflow steps remained `running` until the 10 minute timeout.
- The opencode process produced zero stdout and zero stderr.

Root cause:

- The server spawned opencode with an open non-TTY stdin pipe.
- opencode waited for stdin input in non-interactive server runs.

Fix:

- The opencode runner now closes stdin explicitly with `stdio: ["ignore", "pipe", "pipe"]`.
- A regression test uses a stdin-sensitive fake opencode command to prove stdin is closed.

### 2. Permission bypass needed explicit local opt-in

Observed behavior:

- File-writing validation can require opencode permission approval.

Fix:

- `AETHEROPS_OPENCODE_AUTO_APPROVE=true` now explicitly adds opencode's `--dangerously-skip-permissions` flag.
- Engine status exposes `environment.autoApprovePermissions`.
- Settings UI shows whether this mode is enabled.

This is intended for trusted local validation only.

### 3. Empty or error-only opencode output was incorrectly reported as success

Observed behavior:

- An invalid model produced an opencode JSON `error` event, but the process exited with code `0`.
- AetherOps previously marked that run and flow as completed with an empty result.

Fix:

- JSON `error` events now fail the run even if the process exit code is `0`.
- Runs with no assistant text and no changed files now fail instead of reporting fake success.
- Non-JSON-only stdout is preserved in run event metadata but no longer used as assistant text.
- Prompt construction now fails if workspace guidance files cannot be read, instead of silently dropping guidance.

## Successful Workflow Validation

Flow:

- `ddd36f68-a56a-4dfa-ad96-975390118612`
- Conversation: `aca60fa5-413f-4b64-b3cc-84867e912f1f`
- Marker: `hypothesis-probe-20260505-033547`

Steps:

- `requirements`: completed, changed `validation_report/requirements.txt`
- `research`: completed, changed `validation_report/research.txt`
- `plan`: completed, changed `validation_report/plan.txt`
- `final`: completed, changed `validation_report/final.txt`

All four workspace runs reused the same opencode resume token:

- `ses_20bb995deffeyRL7HreNe6UEAw`

Verified file contents:

- `requirements.txt`: objective, boundary, and expected execution notes
- `research.txt`: confirmed the requirements file was observed
- `plan.txt`: recorded the plan
- `final.txt`: recorded `workflow completed with sandbox files only`

## No-Fallback Failure Validation

Flow:

- `1c4562ea-7cfe-4c2f-86d9-04d26e1f2522`
- Conversation: `3cea63e9-c471-46f6-b0d1-d662e53df0f0`
- Model: `openai/aetherops-invalid-model-probe`

Expected result:

- The run should not silently fall back to a valid/default model.

Observed result after fix:

- Flow status: `failed`
- Step status: `failed`
- Task status: `failed`
- Error: `Model not found: openai/aetherops-invalid-model-probe.`

## Post-Fix Success Regression

Flow:

- `d94e6d74-8720-47cf-aa92-4fd78075d260`
- Conversation: `f7aa3e29-51a6-4788-9406-13aa43d93a81`
- Marker: `postfix-success-20260505-034114`

Result:

- Two dependent steps completed.
- `validation_report/postfix_step1.txt` and `validation_report/postfix_final.txt` were created inside the session sandbox.
- The final step returned `POSTFIX_OK`.

## Validation Commands

Passed:

- `npm exec -- vitest run --config vitest.server.config.ts server/lib/opencode-engine.test.ts`
- `npm run typecheck`

Pending full-suite validation should still run before release:

- `npm test`
- `npm run build`
