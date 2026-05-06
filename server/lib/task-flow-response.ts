import type { createStore } from "../db.js";
import type {
  TaskFlowRecord,
  TaskFlowStepDetail,
  TaskFlowStepRecord,
  TaskRecord,
  WorkspaceRunRecord,
} from "../types.js";

function summarizeFlowTask(task: TaskRecord | null) {
  if (!task) {
    return null;
  }
  return {
    id: task.id,
    status: task.status,
    runId: task.runId,
    resultText: task.resultText,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    updatedAt: task.updatedAt,
  };
}

function summarizeFlowRun(run: WorkspaceRunRecord | null) {
  if (!run) {
    return null;
  }
  return {
    id: run.id,
    status: run.status,
    phase: run.phase,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function extractStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function extractEventMessage(payload: Record<string, unknown>) {
  for (const key of ["error", "message", "summary", "reason"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

export function buildTaskFlowResponse(
  store: ReturnType<typeof createStore>,
  flow: TaskFlowRecord,
): { flow: TaskFlowRecord; steps: TaskFlowStepDetail[]; report: ReturnType<typeof store.getLatestFlowReportArtifact> } {
  const steps = (store.listTaskFlowSteps?.(flow.id) ?? []).map((step: TaskFlowStepRecord) => {
    const task = step.taskId ? store.getTask(step.taskId) : null;
    const run = task?.runId ? store.getWorkspaceRun(task.runId) : null;
    const events = run ? store.listWorkspaceRunEvents(run.conversationId, run.id) : [];
    const changedFiles = Array.from(
      new Set(events.flatMap((event) => extractStringArray(event.payload.changedFiles))),
    );
    const errorEvent = [...events]
      .reverse()
      .find((event) => event.eventType === "error" || event.eventType === "run_failed");
    const lastEvent = [...events].reverse().find((event) => extractEventMessage(event.payload));
    const artifacts =
      run && store.listArtifactsForRun
        ? store.listArtifactsForRun(run.conversationId, run.id)
        : [];
    return {
      ...step,
      task: summarizeFlowTask(task),
      run: summarizeFlowRun(run),
      output: {
        resultSummary: task?.resultText ?? null,
        changedFiles,
        artifactCount: artifacts.length,
        lastError: errorEvent ? extractEventMessage(errorEvent.payload) : null,
        lastEventSummary: lastEvent ? extractEventMessage(lastEvent.payload) : null,
      },
    };
  });
  return {
    flow,
    steps,
    report: store.getLatestFlowReportArtifact(flow.id),
  };
}
