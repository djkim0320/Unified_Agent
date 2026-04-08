import fs from "node:fs/promises";
import { loadConfig } from "../config/config.js";
import { cancelDetachedTaskRunById } from "../tasks/task-executor.js";
import { findTaskByRunId, listTasksForAgentId } from "../tasks/task-registry.js";
import { appendTextFile, pathExists, readJsonFile, writeJsonFile } from "./fs.js";
import {
  ensureResearchLayout,
  resolveProjectRunLogPath,
  resolveProjectRunMetadataPath,
  resolveProjectRunsDir,
} from "./paths.js";
import type {
  ResearchAddonId,
  ResearchProjectManifest,
  ResearchRunRecord,
  ResearchRunStatus,
} from "./types.js";

function isResearchTask(task: {
  taskKind?: string;
  sourceId?: string;
  runId?: string;
}): boolean {
  return (
    task.taskKind?.startsWith("research.") === true ||
    task.sourceId?.startsWith("research:") === true ||
    task.runId?.startsWith("research:") === true
  );
}

function normalizeResearchStatus(value: unknown): ResearchRunStatus {
  return value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "timed_out" ||
    value === "cancelled" ||
    value === "lost"
    ? value
    : "succeeded";
}

async function readRunSidecar(
  workspaceDir: string,
  runId: string,
): Promise<ResearchRunRecord | null> {
  return await readJsonFile<ResearchRunRecord | null>(
    resolveProjectRunMetadataPath(workspaceDir, runId),
    null,
  );
}

async function listRunSidecars(workspaceDir: string): Promise<ResearchRunRecord[]> {
  try {
    const entries = await fs.readdir(resolveProjectRunsDir(workspaceDir), { withFileTypes: true });
    const loaded = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => readRunSidecar(workspaceDir, entry.name.slice(0, -".json".length))),
    );
    return loaded.filter((entry): entry is ResearchRunRecord => Boolean(entry));
  } catch {
    return [];
  }
}

function deriveAddonId(task: { sourceId?: string; taskKind?: string }): ResearchAddonId {
  const source = task.sourceId?.split(":").pop();
  if (source === "mock_concept") return "mock_concept";
  if (source === "mock_cad") return "mock_cad";
  return "mock_cfd";
}

function mergeTaskIntoRun(
  run: ResearchRunRecord,
  task: {
    taskId: string;
    status: ResearchRunStatus;
    startedAt?: number;
    endedAt?: number;
    progressSummary?: string;
    terminalSummary?: string;
  },
): ResearchRunRecord {
  return {
    ...run,
    taskId: task.taskId,
    status: task.status,
    startedAt: task.startedAt ?? run.startedAt,
    endedAt: task.endedAt ?? run.endedAt ?? null,
    progressSummary: task.progressSummary ?? run.progressSummary ?? null,
    terminalSummary: task.terminalSummary ?? run.terminalSummary ?? null,
    cancelSupported: false,
  };
}

export async function createResearchRun(params: {
  project: ResearchProjectManifest;
  runId: string;
  addonId: ResearchAddonId;
  taskId?: string | null;
  status: ResearchRunStatus;
  sessionKey?: string | null;
  summary?: string | null;
  structuredOutputSummary?: Record<string, unknown> | null;
}): Promise<ResearchRunRecord> {
  await ensureResearchLayout(params.project.workspacePath);
  const startedAt = Date.now();
  const record: ResearchRunRecord = {
    runId: params.runId,
    taskId: params.taskId ?? null,
    projectId: params.project.id,
    agentId: params.project.agentId,
    addonId: params.addonId,
    status: params.status,
    startedAt,
    endedAt: params.status === "running" || params.status === "queued" ? null : startedAt,
    progressSummary: params.summary ?? null,
    terminalSummary: null,
    logPath: resolveProjectRunLogPath(params.project.workspacePath, params.runId),
    artifactIds: [],
    structuredOutputSummary: params.structuredOutputSummary ?? null,
    sessionKey: params.sessionKey ?? null,
    summary: params.summary ?? null,
    cancelSupported: false,
  };
  await writeJsonFile(resolveProjectRunMetadataPath(params.project.workspacePath, params.runId), record);
  return record;
}

export async function updateResearchRun(params: {
  project: ResearchProjectManifest;
  runId: string;
  patch: Partial<ResearchRunRecord>;
}): Promise<ResearchRunRecord> {
  const current = await readRunSidecar(params.project.workspacePath, params.runId);
  if (!current) {
    throw new Error(`Research run not found: ${params.runId}`);
  }
  const next: ResearchRunRecord = {
    ...current,
    ...params.patch,
  };
  await writeJsonFile(resolveProjectRunMetadataPath(params.project.workspacePath, params.runId), next);
  return next;
}

export async function appendResearchRunLog(params: {
  project: ResearchProjectManifest;
  runId: string;
  line: string;
}): Promise<void> {
  const logPath = resolveProjectRunLogPath(params.project.workspacePath, params.runId);
  const line = params.line.endsWith("\n") ? params.line : `${params.line}\n`;
  await appendTextFile(logPath, line);
}

export async function finalizeResearchRun(params: {
  project: ResearchProjectManifest;
  runId: string;
  status: ResearchRunStatus;
  progressSummary?: string | null;
  terminalSummary?: string | null;
  artifactIds?: string[];
  structuredOutputSummary?: Record<string, unknown> | null;
}): Promise<ResearchRunRecord> {
  return await updateResearchRun({
    project: params.project,
    runId: params.runId,
    patch: {
      status: params.status,
      endedAt: Date.now(),
      progressSummary: params.progressSummary ?? null,
      terminalSummary: params.terminalSummary ?? null,
      artifactIds: params.artifactIds ?? [],
      structuredOutputSummary: params.structuredOutputSummary ?? null,
    },
  });
}

export async function listResearchRuns(params: {
  project: ResearchProjectManifest;
  addonId?: string;
  status?: string;
}): Promise<ResearchRunRecord[]> {
  const sidecars = await listRunSidecars(params.project.workspacePath);
  const merged = new Map(sidecars.map((run) => [run.runId, run]));
  const tasks = listTasksForAgentId(params.project.agentId).filter(isResearchTask);

  for (const task of tasks) {
    if (!task.runId) {
      continue;
    }
    const current =
      merged.get(task.runId) ??
      ({
        runId: task.runId,
        taskId: task.taskId,
        projectId: params.project.id,
        agentId: params.project.agentId,
        addonId: deriveAddonId(task),
        status: normalizeResearchStatus(task.status),
        startedAt: task.startedAt ?? Date.now(),
        endedAt: task.endedAt ?? null,
        progressSummary: task.progressSummary ?? null,
        terminalSummary: task.terminalSummary ?? null,
        logPath: resolveProjectRunLogPath(params.project.workspacePath, task.runId),
        artifactIds: [],
        structuredOutputSummary: null,
        sessionKey: task.ownerKey ?? null,
        summary: task.label ?? null,
        cancelSupported: false,
      } satisfies ResearchRunRecord);
    merged.set(
      task.runId,
      mergeTaskIntoRun(current, {
        taskId: task.taskId,
        status: normalizeResearchStatus(task.status),
        startedAt: task.startedAt,
        endedAt: task.endedAt,
        progressSummary: task.progressSummary,
        terminalSummary: task.terminalSummary,
      }),
    );
  }

  return [...merged.values()]
    .filter((run) => {
      if (params.addonId && run.addonId !== params.addonId) {
        return false;
      }
      if (params.status && run.status !== params.status) {
        return false;
      }
      return true;
    })
    .toSorted((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

export async function getResearchRun(params: {
  project: ResearchProjectManifest;
  runId: string;
}): Promise<ResearchRunRecord | null> {
  const runs = await listResearchRuns({ project: params.project });
  const run = runs.find((entry) => entry.runId === params.runId) ?? null;
  if (!run) {
    return null;
  }
  if (!run.logPath || !(await pathExists(run.logPath))) {
    return run;
  }
  return run;
}

export async function cancelResearchRun(params: {
  project: ResearchProjectManifest;
  runId: string;
}): Promise<{ found: boolean; cancelled: boolean; reason?: string }> {
  const run = await getResearchRun(params);
  if (!run) {
    return { found: false, cancelled: false, reason: "Run not found." };
  }
  const task = run.taskId ? { taskId: run.taskId } : findTaskByRunId(params.runId);
  if (!task?.taskId) {
    return {
      found: true,
      cancelled: false,
      reason: "Run is not backed by a cancellable task.",
    };
  }
  const result = await cancelDetachedTaskRunById({
    cfg: loadConfig(),
    taskId: task.taskId,
  });
  return {
    found: result.found,
    cancelled: result.cancelled,
    reason: result.reason,
  };
}
