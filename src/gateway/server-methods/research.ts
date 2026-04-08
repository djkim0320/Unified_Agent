import fs from "node:fs/promises";
import { buildResearchAddonStatuses, isResearchAddonId, updateProjectAddonState } from "../../research/addons.js";
import { listResearchArtifacts, resolveArtifactFile } from "../../research/artifacts.js";
import {
  getResearchProject,
  getResearchProjectWithOverview,
  listResearchProjects,
  patchResearchProject,
} from "../../research/projects.js";
import { cancelResearchRun, getResearchRun, listResearchRuns } from "../../research/runs.js";
import { readTextSnippet } from "../../research/fs.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function requireStringParam(
  params: Record<string, unknown>,
  key: string,
): string | { error: ReturnType<typeof errorShape> } {
  const value = params[key];
  if (typeof value !== "string" || !value.trim()) {
    return {
      error: errorShape(ErrorCodes.INVALID_REQUEST, `missing ${key}`),
    };
  }
  return value.trim();
}

function parseProjectPatch(params: Record<string, unknown>) {
  const patchValue =
    params.patch && typeof params.patch === "object" && !Array.isArray(params.patch)
      ? (params.patch as Record<string, unknown>)
      : params;
  const next: Record<string, unknown> = {};
  if (typeof patchValue.name === "string") {
    next.name = patchValue.name.trim();
  }
  if (typeof patchValue.description === "string") {
    next.description = patchValue.description.trim();
  }
  if (typeof patchValue.defaultModel === "string" || patchValue.defaultModel === null) {
    next.defaultModel = patchValue.defaultModel;
  }
  if (typeof patchValue.defaultProvider === "string" || patchValue.defaultProvider === null) {
    next.defaultProvider = patchValue.defaultProvider;
  }
  if (
    patchValue.preferences &&
    typeof patchValue.preferences === "object" &&
    !Array.isArray(patchValue.preferences)
  ) {
    next.preferences = patchValue.preferences;
  }
  return next;
}

async function readRunLog(logPath: string | null | undefined): Promise<string | null> {
  if (!logPath) {
    return null;
  }
  try {
    await fs.access(logPath);
  } catch {
    return null;
  }
  const snippet = await readTextSnippet(logPath, 120_000);
  return snippet || null;
}

export const researchHandlers: GatewayRequestHandlers = {
  "research.projects.list": async ({ respond }) => {
    respond(true, await listResearchProjects(), undefined);
  },
  "research.projects.get": async ({ params, respond }) => {
    const projectId = requireStringParam(params, "projectId");
    if (typeof projectId !== "string") {
      respond(false, undefined, projectId.error);
      return;
    }
    const result = await getResearchProjectWithOverview(projectId);
    if (!result) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unknown project: ${projectId}`));
      return;
    }
    respond(true, result, undefined);
  },
  "research.projects.patch": async ({ params, respond }) => {
    const projectId = requireStringParam(params, "projectId");
    if (typeof projectId !== "string") {
      respond(false, undefined, projectId.error);
      return;
    }
    try {
      const project = await patchResearchProject({
        projectId,
        patch: parseProjectPatch(params),
      });
      respond(true, project, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : "failed to patch research project",
        ),
      );
    }
  },
  "research.runs.list": async ({ params, respond }) => {
    const projectId = requireStringParam(params, "projectId");
    if (typeof projectId !== "string") {
      respond(false, undefined, projectId.error);
      return;
    }
    const project = await getResearchProject(projectId);
    if (!project) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unknown project: ${projectId}`));
      return;
    }
    respond(
      true,
      {
        projectId: project.id,
        runs: await listResearchRuns({
          project,
          addonId: typeof params.addonId === "string" ? params.addonId : undefined,
          status: typeof params.status === "string" ? params.status : undefined,
        }),
      },
      undefined,
    );
  },
  "research.runs.get": async ({ params, respond }) => {
    const projectId = requireStringParam(params, "projectId");
    const runId = requireStringParam(params, "runId");
    if (typeof projectId !== "string") {
      respond(false, undefined, projectId.error);
      return;
    }
    if (typeof runId !== "string") {
      respond(false, undefined, runId.error);
      return;
    }
    const project = await getResearchProject(projectId);
    if (!project) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unknown project: ${projectId}`));
      return;
    }
    const run = await getResearchRun({ project, runId });
    if (!run) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unknown run: ${runId}`));
      return;
    }
    respond(
      true,
      {
        run,
        logText: await readRunLog(run.logPath),
      },
      undefined,
    );
  },
  "research.runs.cancel": async ({ params, respond }) => {
    const projectId = requireStringParam(params, "projectId");
    const runId = requireStringParam(params, "runId");
    if (typeof projectId !== "string") {
      respond(false, undefined, projectId.error);
      return;
    }
    if (typeof runId !== "string") {
      respond(false, undefined, runId.error);
      return;
    }
    const project = await getResearchProject(projectId);
    if (!project) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unknown project: ${projectId}`));
      return;
    }
    respond(true, await cancelResearchRun({ project, runId }), undefined);
  },
  "research.artifacts.list": async ({ params, respond }) => {
    const projectId = requireStringParam(params, "projectId");
    if (typeof projectId !== "string") {
      respond(false, undefined, projectId.error);
      return;
    }
    const project = await getResearchProject(projectId);
    if (!project) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unknown project: ${projectId}`));
      return;
    }
    respond(
      true,
      {
        projectId: project.id,
        artifacts: await listResearchArtifacts({
          project,
          addonId: typeof params.addonId === "string" ? params.addonId : undefined,
          runId: typeof params.runId === "string" ? params.runId : undefined,
          type: typeof params.type === "string" ? params.type : undefined,
        }),
      },
      undefined,
    );
  },
  "research.artifacts.get": async ({ params, respond }) => {
    const projectId = requireStringParam(params, "projectId");
    const artifactId = requireStringParam(params, "artifactId");
    if (typeof projectId !== "string") {
      respond(false, undefined, projectId.error);
      return;
    }
    if (typeof artifactId !== "string") {
      respond(false, undefined, artifactId.error);
      return;
    }
    const project = await getResearchProject(projectId);
    if (!project) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unknown project: ${projectId}`));
      return;
    }
    const artifact = await resolveArtifactFile({ project, artifactId });
    if (!artifact) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown artifact: ${artifactId}`),
      );
      return;
    }
    respond(true, artifact, undefined);
  },
  "research.addons.list": async ({ params, respond }) => {
    const projectId = requireStringParam(params, "projectId");
    if (typeof projectId !== "string") {
      respond(false, undefined, projectId.error);
      return;
    }
    const project = await getResearchProject(projectId);
    if (!project) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unknown project: ${projectId}`));
      return;
    }
    respond(true, { projectId: project.id, addons: buildResearchAddonStatuses(project) }, undefined);
  },
  "research.addons.patch": async ({ params, respond }) => {
    const projectId = requireStringParam(params, "projectId");
    const addonId = requireStringParam(params, "addonId");
    if (typeof projectId !== "string") {
      respond(false, undefined, projectId.error);
      return;
    }
    if (typeof addonId !== "string") {
      respond(false, undefined, addonId.error);
      return;
    }
    if (!isResearchAddonId(addonId)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unknown addon: ${addonId}`));
      return;
    }
    if (typeof params.enabled !== "boolean") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing enabled"));
      return;
    }
    const project = await getResearchProject(projectId);
    if (!project) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unknown project: ${projectId}`));
      return;
    }
    const manifest = await updateProjectAddonState({
      workspaceDir: project.workspacePath,
      addonId,
      enabled: params.enabled,
    });
    respond(true, { projectId: manifest.id, addons: buildResearchAddonStatuses(manifest) }, undefined);
  },
};
