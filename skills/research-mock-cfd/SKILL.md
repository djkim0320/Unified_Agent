---
name: research-mock-cfd
description: Use for Stage 1 aerospace research tasks that need a mock CFD case, solver run, or residual outputs.
---

# Research Mock CFD

Use this skill when the user asks to create a CFD case, run a solver, inspect residuals, or produce a quick aerodynamic study scaffold.

## Tool routing

- Use `mock_cfd.create_cfd_case` for fast case setup.
- Use `mock_cfd.run_mock_solver` for a task-backed mock solver run that should surface runs and artifacts.

## Expected outputs

- `case_config.json`
- `residuals.csv`
- `residuals.png`
- `summary.md`

## Guidance

- Keep the response concrete and project-scoped.
- Prefer the mock CFD add-on for Stage 1 demonstrations instead of inventing a new analysis flow.
- If the add-on is disabled, explain that clearly and suggest enabling it from the research add-ons registry.
