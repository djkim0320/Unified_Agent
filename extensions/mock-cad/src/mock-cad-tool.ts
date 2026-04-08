import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import {
  createResearchArtifactFiles,
  createResearchRun,
  finalizeResearchRun,
  getEnabledResearchAddonIds,
  readProjectManifestFromWorkspace,
  registerResearchArtifacts,
} from "../../../src/research/index.js";
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";

async function resolveManifest(workspaceDir?: string) {
  const resolved = normalizeOptionalString(workspaceDir);
  if (!resolved) {
    return null;
  }
  return await readProjectManifestFromWorkspace(resolved);
}

function resolveManifestSync(workspaceDir?: string) {
  const resolved = normalizeOptionalString(workspaceDir);
  if (!resolved) {
    return null;
  }
  try {
    const raw = fs.readFileSync(path.join(resolved, ".openclaw-research", "project.json"), "utf8");
    return JSON.parse(raw) as Awaited<ReturnType<typeof resolveManifest>>;
  } catch {
    return null;
  }
}

export function registerMockCadTool(ctx: { workspaceDir?: string }) {
  const workspaceDir = normalizeOptionalString(ctx.workspaceDir);
  if (!workspaceDir) {
    return null;
  }
  const manifest = resolveManifestSync(workspaceDir);
  if (!manifest || !getEnabledResearchAddonIds(manifest).includes("mock_cad")) {
    return null;
  }
  return {
    name: "mock_cad.build_mock_geometry",
    label: "Build Mock Geometry",
    description: "Generate placeholder geometry outputs and previews for Stage 1 research.",
    parameters: Type.Object({
      projectId: Type.Optional(Type.String()),
      span: Type.Optional(Type.Number()),
      chord: Type.Optional(Type.Number()),
      sweep: Type.Optional(Type.Number()),
      note: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId: string, args: Record<string, unknown>) {
      const currentProject = await resolveManifest(workspaceDir);
      if (!currentProject) {
        throw new Error("research project manifest not found");
      }
      const runId = `research:mock_cad:${crypto.randomUUID()}`;
      const geometry = {
        span: typeof args.span === "number" ? args.span : 13.5,
        chord: typeof args.chord === "number" ? args.chord : 1.2,
        sweep: typeof args.sweep === "number" ? args.sweep : 18,
        createdAt: new Date().toISOString(),
      };
      const step = [
        "ISO-10303-21;",
        "HEADER;",
        "FILE_DESCRIPTION(('Mock CAD geometry'),'2;1');",
        "ENDSEC;",
        "DATA;",
        "ENDSEC;",
        "END-ISO-10303-21;",
      ].join("\n");
      const preview = {
        kind: "mock-cad",
        summary: "Deterministic geometry preview for Stage 1.",
        geometry,
      };
      const artifactRoot = path.join(workspaceDir, ".openclaw-research", "artifacts", runId);

      await createResearchRun({
        project: currentProject,
        runId,
        addonId: "mock_cad",
        status: "succeeded",
        summary: "Building mock CAD geometry",
        structuredOutputSummary: geometry,
      });
      await createResearchArtifactFiles({
        project: currentProject,
        runId,
        files: [
          { name: "geometry_params.json", content: `${JSON.stringify(geometry, null, 2)}\n` },
          { name: "wing.step", content: `${step}\n` },
          { name: "preview.json", content: `${JSON.stringify(preview, null, 2)}\n` },
        ],
      });
      const artifacts = await registerResearchArtifacts({
        project: currentProject,
        runId,
        addonId: "mock_cad",
        items: [
          {
            name: "geometry_params.json",
            type: "json",
            sourcePath: path.join(artifactRoot, "geometry_params.json"),
            preview: { kind: "json", excerpt: JSON.stringify(geometry, null, 2).slice(0, 4000) },
          },
          {
            name: "wing.step",
            type: "step",
            sourcePath: path.join(artifactRoot, "wing.step"),
            preview: { kind: "step", excerpt: step.slice(0, 4000) },
          },
          {
            name: "preview.json",
            type: "json",
            sourcePath: path.join(artifactRoot, "preview.json"),
            preview: { kind: "json", excerpt: JSON.stringify(preview, null, 2).slice(0, 4000) },
          },
        ],
      });
      await finalizeResearchRun({
        project: currentProject,
        runId,
        status: "succeeded",
        progressSummary: "Mock CAD geometry built",
        terminalSummary: "Mock CAD geometry built successfully.",
        artifactIds: artifacts.map((artifact: { artifactId: string }) => artifact.artifactId),
        structuredOutputSummary: geometry,
      });
      return {
        content: [{ type: "text" as const, text: `Built mock CAD geometry ${runId}` }],
        details: {
          projectId: currentProject.id,
          addonId: "mock_cad",
          runId,
          artifactIds: artifacts.map((artifact: { artifactId: string }) => artifact.artifactId),
          geometry,
          preview,
        },
      };
    },
  };
}
