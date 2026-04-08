---
name: research-mock-cad
description: Use for Stage 1 aerospace geometry drafts and placeholder CAD-style outputs.
---

# Research Mock CAD

Use this skill when the user asks for a geometry draft, wing sketch, or CAD-style placeholder output.

## Tool routing

- Use `mock_cad.build_mock_geometry` for a CAD-style geometry build.

## Expected outputs

- `geometry_params.json`
- `wing.step`
- `preview.json`

## Guidance

- Keep geometry output simple and deterministic.
- Use this add-on for Stage 1 structure and artifact flow, not for real CAD or meshing.
