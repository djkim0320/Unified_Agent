import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import {
  appendResearchRunLog,
  createResearchArtifactFiles,
  createResearchRun,
  finalizeResearchRun,
  getEnabledResearchAddonIds,
  readProjectManifestFromWorkspace,
  registerResearchArtifacts,
} from "../../../src/research/index.js";
import {
  completeTaskRunByRunId,
  createRunningTaskRun,
  failTaskRunByRunId,
  recordTaskRunProgressByRunId,
} from "../../../src/tasks/task-executor.js";
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";

function resolveProjectContext(ctx: { workspaceDir?: string; sessionKey?: string }) {
  const workspaceDir = normalizeOptionalString(ctx.workspaceDir);
  if (!workspaceDir) {
    return null;
  }
  return { workspaceDir, sessionKey: normalizeOptionalString(ctx.sessionKey) };
}

async function resolveProjectManifest(workspaceDir: string) {
  return await readProjectManifestFromWorkspace(workspaceDir);
}

function resolveProjectManifestSync(workspaceDir: string) {
  try {
    const raw = fs.readFileSync(
      path.join(workspaceDir, ".openclaw-research", "project.json"),
      "utf8",
    );
    return JSON.parse(raw) as Awaited<ReturnType<typeof resolveProjectManifest>>;
  } catch {
    return null;
  }
}

function buildCaseConfig(args: Record<string, unknown>) {
  const span = typeof args.span === "number" ? args.span : 12;
  const angle = typeof args.angle === "number" ? args.angle : 5;
  const mach = typeof args.mach === "number" ? args.mach : 0.78;
  return {
    caseType: "mock-cfd",
    createdAt: new Date().toISOString(),
    geometry: {
      span,
      angle,
      chord: typeof args.chord === "number" ? args.chord : 1.4,
    },
    flow: {
      mach,
      reynolds: typeof args.reynolds === "number" ? args.reynolds : 4.2e6,
      turbulenceModel: "k-omega-sst",
    },
  };
}

function buildResidualCsv(seed: string) {
  const rows = ["iteration,residual"];
  for (let i = 1; i <= 12; i += 1) {
    const residual = (0.8 / i + 0.015 * Math.sin(i + seed.length)).toFixed(6);
    rows.push(`${i},${residual}`);
  }
  return rows.join("\n");
}

function buildResidualPngPlaceholder() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+4n2cAAAAASUVORK5CYII=",
    "base64",
  );
}

const CFD_PARAMETERS = Type.Object({
  projectId: Type.Optional(Type.String()),
  span: Type.Optional(Type.Number()),
  angle: Type.Optional(Type.Number()),
  chord: Type.Optional(Type.Number()),
  mach: Type.Optional(Type.Number()),
  reynolds: Type.Optional(Type.Number()),
  note: Type.Optional(Type.String()),
});

export function registerMockCfdTool(ctx: {
  workspaceDir?: string;
  sessionKey?: string;
}) {
  const project = resolveProjectContext(ctx);
  if (!project) {
    return null;
  }
  const manifest = resolveProjectManifestSync(project.workspaceDir);
  if (!manifest || !getEnabledResearchAddonIds(manifest).includes("mock_cfd")) {
    return null;
  }

  return [
    {
      name: "mock_cfd.create_cfd_case",
      label: "Create CFD Case",
      description: "Create deterministic CFD case inputs for Stage 1 aerospace studies.",
      parameters: CFD_PARAMETERS,
      async execute(_toolCallId: string, args: Record<string, unknown>) {
        const currentProject = await resolveProjectManifest(project.workspaceDir);
        if (!currentProject) {
          throw new Error("research project manifest not found");
        }
        const runId = `research:mock_cfd:${crypto.randomUUID()}`;
        const caseConfig = buildCaseConfig(args);
        const artifactRoot = path.join(
          project.workspaceDir,
          ".openclaw-research",
          "artifacts",
          runId,
        );

        await createResearchRun({
          project: currentProject,
          runId,
          addonId: "mock_cfd",
          status: "succeeded",
          sessionKey: project.sessionKey ?? null,
          summary: "Creating mock CFD case inputs",
          structuredOutputSummary: caseConfig,
        });
        await createResearchArtifactFiles({
          project: currentProject,
          runId,
          files: [{ name: "case_config.json", content: JSON.stringify(caseConfig, null, 2) + "\n" }],
        });
        const artifacts = await registerResearchArtifacts({
          project: currentProject,
          runId,
          addonId: "mock_cfd",
          items: [
            {
              name: "case_config.json",
              type: "json",
              sourcePath: path.join(artifactRoot, "case_config.json"),
              preview: {
                kind: "json",
                excerpt: JSON.stringify(caseConfig, null, 2).slice(0, 4000),
              },
            },
          ],
        });
        await finalizeResearchRun({
          project: currentProject,
          runId,
          status: "succeeded",
          progressSummary: "Mock CFD case created",
          terminalSummary: "Mock CFD case created successfully.",
          artifactIds: artifacts.map((artifact: { artifactId: string }) => artifact.artifactId),
          structuredOutputSummary: caseConfig,
        });
        return {
          content: [{ type: "text" as const, text: `Created mock CFD case ${runId}` }],
          details: {
            projectId: currentProject.id,
            addonId: "mock_cfd",
            runId,
            artifactIds: artifacts.map((artifact: { artifactId: string }) => artifact.artifactId),
            caseConfig,
          },
        };
      },
    },
    {
      name: "mock_cfd.run_mock_solver",
      label: "Run Mock Solver",
      description: "Start a task-backed deterministic CFD solver placeholder run.",
      parameters: CFD_PARAMETERS,
      async execute(_toolCallId: string, args: Record<string, unknown>) {
        const currentProject = await resolveProjectManifest(project.workspaceDir);
        if (!currentProject) {
          throw new Error("research project manifest not found");
        }

        const runId = `research:mock_cfd:${crypto.randomUUID()}`;
        const task = createRunningTaskRun({
          runtime: "cli",
          taskKind: "research.mock_cfd.solver",
          sourceId: "research:mock_cfd",
          requesterSessionKey: project.sessionKey ?? undefined,
          ownerKey: project.sessionKey ?? undefined,
          scopeKind: "session",
          childSessionKey: project.sessionKey ?? undefined,
          runId,
          label: "Run mock CFD solver",
          task: `Run mock CFD solver for ${currentProject.name}`,
          startedAt: Date.now(),
          lastEventAt: Date.now(),
          progressSummary: "Initializing mock residual history",
        });
        await createResearchRun({
          project: currentProject,
          runId,
          addonId: "mock_cfd",
          taskId: task.taskId,
          status: "running",
          sessionKey: project.sessionKey ?? null,
          summary: "Initializing mock residual history",
        });
        await appendResearchRunLog({
          project: currentProject,
          runId,
          line: "Mock CFD solver started.",
        });

        void (async () => {
          try {
            await new Promise((resolve) => setTimeout(resolve, 250));
            recordTaskRunProgressByRunId({
              runId,
              runtime: "cli",
              sessionKey: project.sessionKey ?? undefined,
              lastEventAt: Date.now(),
              progressSummary: "Running deterministic iterations",
              eventSummary: "Iterations 1-8 converging",
            });
            await appendResearchRunLog({
              project: currentProject,
              runId,
              line: "Residual history converging through deterministic placeholder iterations.",
            });

            const residualsCsv = buildResidualCsv(runId);
            const residualsPng = buildResidualPngPlaceholder();
            const summaryMd = [
              "# Mock CFD Solver",
              "",
              `Project: ${currentProject.name}`,
              `Run: ${runId}`,
              "",
              "This is a deterministic Stage 1 solver placeholder.",
            ].join("\n");
            const artifactRoot = path.join(
              project.workspaceDir,
              ".openclaw-research",
              "artifacts",
              runId,
            );
            await createResearchArtifactFiles({
              project: currentProject,
              runId,
              files: [
                { name: "residuals.csv", content: residualsCsv },
                { name: "residuals.png", content: residualsPng },
                { name: "summary.md", content: summaryMd },
              ],
            });
            const artifacts = await registerResearchArtifacts({
              project: currentProject,
              runId,
              addonId: "mock_cfd",
              items: [
                {
                  name: "residuals.csv",
                  type: "csv",
                  sourcePath: path.join(artifactRoot, "residuals.csv"),
                  preview: { kind: "csv", excerpt: residualsCsv.slice(0, 4000) },
                },
                {
                  name: "residuals.png",
                  type: "png",
                  sourcePath: path.join(artifactRoot, "residuals.png"),
                  preview: { kind: "image" },
                },
                {
                  name: "summary.md",
                  type: "markdown",
                  sourcePath: path.join(artifactRoot, "summary.md"),
                  preview: { kind: "markdown", excerpt: summaryMd.slice(0, 4000) },
                },
              ],
            });
            await appendResearchRunLog({
              project: currentProject,
              runId,
              line: "Mock CFD solver completed successfully.",
            });
            await finalizeResearchRun({
              project: currentProject,
              runId,
              status: "succeeded",
              progressSummary: "Mock solver completed",
              terminalSummary: "Mock CFD solver completed successfully.",
              artifactIds: artifacts.map((artifact: { artifactId: string }) => artifact.artifactId),
              structuredOutputSummary: {
                dragCoefficient: 0.023,
                liftCoefficient: 0.41,
                iterations: 12,
              },
            });
            await completeTaskRunByRunId({
              runId,
              runtime: "cli",
              sessionKey: project.sessionKey ?? undefined,
              endedAt: Date.now(),
              lastEventAt: Date.now(),
              progressSummary: "Mock solver completed",
              terminalSummary: "Mock CFD solver completed successfully.",
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Mock CFD solver failed.";
            await appendResearchRunLog({
              project: currentProject,
              runId,
              line: `ERROR: ${message}`,
            });
            await finalizeResearchRun({
              project: currentProject,
              runId,
              status: "failed",
              progressSummary: "Mock solver failed",
              terminalSummary: message,
            });
            await failTaskRunByRunId({
              runId,
              runtime: "cli",
              sessionKey: project.sessionKey ?? undefined,
              endedAt: Date.now(),
              lastEventAt: Date.now(),
              error: message,
              progressSummary: "Mock solver failed",
              terminalSummary: message,
            });
          }
        })();

        return {
          content: [{ type: "text" as const, text: `Started mock CFD solver run ${runId}` }],
          details: {
            projectId: currentProject.id,
            addonId: "mock_cfd",
            runId,
            taskId: task.taskId,
            artifactIds: [],
          },
        };
      },
    },
  ];
}
