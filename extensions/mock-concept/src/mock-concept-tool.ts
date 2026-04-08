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

export function registerMockConceptTool(ctx: { workspaceDir?: string }) {
  const workspaceDir = normalizeOptionalString(ctx.workspaceDir);
  if (!workspaceDir) {
    return null;
  }
  const manifest = resolveManifestSync(workspaceDir);
  if (!manifest || !getEnabledResearchAddonIds(manifest).includes("mock_concept")) {
    return null;
  }
  return {
    name: "mock_concept.generate_concept_tradeoff",
    label: "Generate Concept Tradeoff",
    description: "Generate deterministic conceptual tradeoff outputs for Stage 1 studies.",
    parameters: Type.Object({
      projectId: Type.Optional(Type.String()),
      criteria: Type.Optional(Type.Array(Type.String())),
      conceptCount: Type.Optional(Type.Number()),
      note: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId: string, args: Record<string, unknown>) {
      const currentProject = await resolveManifest(workspaceDir);
      if (!currentProject) {
        throw new Error("research project manifest not found");
      }
      const runId = `research:mock_concept:${crypto.randomUUID()}`;
      const conceptCount = typeof args.conceptCount === "number" ? args.conceptCount : 3;

      await createResearchRun({
        project: currentProject,
        runId,
        addonId: "mock_concept",
        status: "succeeded",
        summary: "Generating conceptual tradeoff table",
        structuredOutputSummary: { conceptCount },
      });

      const rows = ["concept,score,range"];
      for (let i = 1; i <= conceptCount; i += 1) {
        rows.push(`Concept ${i},${(0.78 - i * 0.05).toFixed(3)},${(i * 12).toFixed(0)}`);
      }
      const report = [
        "# Mock Concept Tradeoff",
        "",
        `Project: ${currentProject.name}`,
        `Run: ${runId}`,
        "",
        "This is a deterministic tradeoff placeholder for Stage 1.",
      ].join("\n");
      const artifactRoot = path.join(workspaceDir, ".openclaw-research", "artifacts", runId);

      await createResearchArtifactFiles({
        project: currentProject,
        runId,
        files: [
          { name: "tradeoff.csv", content: `${rows.join("\n")}\n` },
          { name: "concept_report.md", content: `${report}\n` },
        ],
      });
      const artifacts = await registerResearchArtifacts({
        project: currentProject,
        runId,
        addonId: "mock_concept",
        items: [
          {
            name: "tradeoff.csv",
            type: "csv",
            sourcePath: path.join(artifactRoot, "tradeoff.csv"),
            preview: { kind: "csv", excerpt: rows.join("\n").slice(0, 4000) },
          },
          {
            name: "concept_report.md",
            type: "markdown",
            sourcePath: path.join(artifactRoot, "concept_report.md"),
            preview: { kind: "markdown", excerpt: report.slice(0, 4000) },
          },
        ],
      });
      await finalizeResearchRun({
        project: currentProject,
        runId,
        status: "succeeded",
        progressSummary: "Tradeoff study generated",
        terminalSummary: "Mock concept tradeoff generated successfully.",
        artifactIds: artifacts.map((artifact: { artifactId: string }) => artifact.artifactId),
        structuredOutputSummary: {
          conceptCount,
          criteria: Array.isArray(args.criteria) ? args.criteria : [],
        },
      });
      return {
        content: [{ type: "text" as const, text: `Generated mock concept tradeoff ${runId}` }],
        details: {
          projectId: currentProject.id,
          addonId: "mock_concept",
          runId,
          artifactIds: artifacts.map((artifact: { artifactId: string }) => artifact.artifactId),
          rows,
          report,
        },
      };
    },
  };
}
