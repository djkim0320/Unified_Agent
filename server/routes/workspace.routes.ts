import type express from "express";
import fs from "node:fs";
import { z } from "zod";
import type { createStore } from "../db.js";
import type { createWorkspaceManager } from "../lib/workspace.js";
import type { ArtifactRecord, ArtifactVersionRecord, EngineRunRecord, ProviderKind, ReasoningLevel } from "../types.js";
import { redactSensitiveText, redactUnknown } from "../lib/redaction.js";
import { createUnifiedDiff } from "../lib/artifact-diff.js";
import {
  exportModeFromRequest,
  requireFullExportAllowed,
  type ExportMode,
} from "../lib/full-export-guard.js";
import { sendLegacyGone } from "./legacy-gone.js";

type WorkspaceRouteStore = ReturnType<typeof createStore>;
type WorkspaceRouteManager = ReturnType<typeof createWorkspaceManager>;

type WorkspaceRouteTaskManager = {
  cancelTask: (taskId: string) => Promise<unknown>;
  enqueueDetachedTask: (input: {
    agentId: string;
    conversationId: string;
    title?: string;
    prompt: string;
    providerKind: ProviderKind;
    model: string;
    reasoningLevel: ReasoningLevel;
    taskKind: "continuation";
    originRunId: string;
    startImmediately: boolean;
  }) => Promise<unknown>;
};

const TEXT_PREVIEW_BYTES = 64 * 1024;
const MAX_READ_BYTES = 1024 * 1024;

function requireConversation(
  response: express.Response,
  store: WorkspaceRouteStore,
  conversationId: string,
) {
  const conversation = store.getConversation(conversationId);
  if (!conversation) {
    response.status(404).json({ error: "Conversation not found" });
    return null;
  }
  return conversation;
}

function requireScopedWorkspaceRun(
  response: express.Response,
  store: WorkspaceRouteStore,
  conversationId: string,
  runId: string,
) {
  if (!requireConversation(response, store, conversationId)) {
    return null;
  }
  const run = store.getWorkspaceRunForConversation(conversationId, runId);
  if (!run) {
    response.status(404).json({ error: "Workspace run not found" });
    return null;
  }
  return run;
}

function isEngineRunRecord(value: unknown): value is EngineRunRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "engineKind" in value &&
    (value as { engineKind?: unknown }).engineKind === "opencode" &&
    typeof (value as { runId?: unknown }).runId === "string"
  );
}

function sendArtifactDiffResponse(
  response: express.Response,
  artifact: ArtifactRecord,
  snapshot: ArtifactVersionRecord | null,
) {
  if (!snapshot) {
    response.json({
      artifact,
      diff: {
        available: false,
        reason: "No before snapshot is available. Only current file preview can be shown.",
      },
    });
    return;
  }
  if (snapshot.binary || snapshot.truncated || snapshot.unsupportedEncoding) {
    response.json({
      artifact,
      diff: {
        available: false,
        reason: snapshot.binary
          ? "Binary files cannot produce a text diff."
          : snapshot.unsupportedEncoding
            ? "Unsupported text encoding cannot produce a diff."
            : "The snapshot exceeded the configured diff storage limit.",
        binary: snapshot.binary,
        truncated: snapshot.truncated,
        unsupportedEncoding: snapshot.unsupportedEncoding,
      },
    });
    return;
  }
  if (snapshot.afterContent == null) {
    response.json({
      artifact,
      diff: {
        available: false,
        reason: "The file was deleted or no text snapshot is available for diff generation.",
      },
    });
    return;
  }
  const diff = createUnifiedDiff(artifact.path ?? snapshot.path, snapshot.beforeContent, snapshot.afterContent);
  response.json({
    artifact,
    diff: diff.available
      ? {
          available: true,
          reason: snapshot.beforeContent == null ? "new-file" : "snapshot",
          content: diff.content,
          binary: false,
          truncated: false,
          sizeBytes: diff.sizeBytes,
          maxBytes: diff.maxBytes,
          lineCountBefore: diff.lineCountBefore,
          lineCountAfter: diff.lineCountAfter,
          maxLines: diff.maxLines,
          maxMatrixCells: diff.maxMatrixCells,
          matrixCells: diff.matrixCells,
        }
      : {
          available: false,
          reason: diff.reason,
          binary: false,
          truncated: diff.truncated,
          sizeBytes: diff.sizeBytes,
          maxBytes: diff.maxBytes,
          lineCountBefore: diff.lineCountBefore,
          lineCountAfter: diff.lineCountAfter,
          maxLines: diff.maxLines,
          maxMatrixCells: diff.maxMatrixCells,
          matrixCells: diff.matrixCells,
        },
  });
}
function buildSafeRunDebugRecord(run: ReturnType<WorkspaceRouteStore["getWorkspaceRunForConversation"]>) {
  if (!run) {
    return null;
  }
  return {
    id: run.id,
    conversationId: run.conversationId,
    taskId: run.taskId,
    parentRunId: run.parentRunId,
    providerKind: run.providerKind,
    model: run.model,
    status: run.status,
    phase: run.phase,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    hasUserMessage: Boolean(run.userMessage),
    hasCheckpoint: Boolean(run.checkpoint),
    hasResumeToken: Boolean(run.resumeToken),
  };
}

function buildSafeTaskDebugRecord(task: ReturnType<WorkspaceRouteStore["getTask"]>) {
  if (!task) {
    return null;
  }
  return {
    id: task.id,
    agentId: task.agentId,
    conversationId: task.conversationId,
    runId: task.runId,
    taskKind: task.taskKind,
    taskFlowId: task.taskFlowId,
    flowStepKey: task.flowStepKey,
    originRunId: task.originRunId,
    automationRuleId: task.automationRuleId,
    parentTaskId: task.parentTaskId,
    nestingDepth: task.nestingDepth,
    title: task.title,
    providerKind: task.providerKind,
    model: task.model,
    reasoningLevel: task.reasoningLevel,
    status: task.status,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    scheduledFor: task.scheduledFor,
    updatedAt: task.updatedAt,
    hasPrompt: Boolean(task.prompt),
    hasResultText: Boolean(task.resultText),
  };
}

function artifactReportContent(artifact: ReturnType<WorkspaceRouteStore["getArtifact"]>) {
  if (!artifact || !["report", "summary", "log"].includes(artifact.kind)) {
    return null;
  }
  const markdown = artifact.metadata.markdown;
  if (typeof markdown === "string") {
    return markdown;
  }
  const content = artifact.metadata.content;
  return typeof content === "string" ? content : artifact.summary;
}

function redactedReportContent(content: string | null, mode: ExportMode) {
  return mode === "full" ? content : redactSensitiveText(content ?? "");
}

function buildSafeReportDebugRecord(artifact: ReturnType<WorkspaceRouteStore["getArtifact"]>) {
  if (!artifact) {
    return null;
  }
  const { markdown: _markdown, content: _content, ...metadata } = artifact.metadata;
  return {
    ...artifact,
    metadata: {
      ...metadata,
      markdownPresent: typeof _markdown === "string" && _markdown.length > 0,
      contentPresent: typeof _content === "string" && _content.length > 0,
    },
  };
}

export function registerWorkspaceRoutes(
  app: express.Express,
  params: {
    store: WorkspaceRouteStore;
    workspace: WorkspaceRouteManager;
    taskManager: WorkspaceRouteTaskManager;
    exposeWorkspaceDebugPaths: boolean;
    localApiToken: string;
    localApiAllowedPorts: number[];
  },
) {
  const { store, taskManager, workspace } = params;

  app.get("/api/workspace/tree", (_request, response) => {
    sendLegacyGone(response, "Workspace file CRUD");
  });

  app.get("/api/workspace/file", (_request, response) => {
    sendLegacyGone(response, "Workspace file CRUD");
  });

  app.post("/api/workspace/file", (_request, response) => {
    sendLegacyGone(response, "Workspace file CRUD");
  });

  app.post("/api/workspace/folder", (_request, response) => {
    sendLegacyGone(response, "Workspace file CRUD");
  });

  app.get("/api/workspace/runs", (request, response) => {
    const conversationId = z.string().uuid().parse(request.query.conversationId);
    if (!requireConversation(response, store, conversationId)) {
      return;
    }
    response.json({
      runs: store.listWorkspaceRuns(conversationId),
    });
  });

  app.get("/api/workspace/runs/:runId/events", (request, response) => {
    const conversationId = z.string().uuid().parse(request.query.conversationId);
    if (!requireConversation(response, store, conversationId)) {
      return;
    }
    if (!store.getWorkspaceRunForConversation(conversationId, request.params.runId)) {
      response.status(404).json({ error: "Workspace run not found" });
      return;
    }
    response.json({
      events: store.listWorkspaceRunEvents(conversationId, request.params.runId),
    });
  });

  app.get("/api/runs/:runId", (request, response) => {
    const conversationId = z.string().uuid().parse(request.query.conversationId);
    const run = requireScopedWorkspaceRun(response, store, conversationId, request.params.runId);
    if (!run) {
      return;
    }
    response.json({ run });
  });

  app.post("/api/runs/:runId/cancel", (request, response) => {
    const conversationId = z.string().uuid().parse(request.query.conversationId);
    const run = requireScopedWorkspaceRun(response, store, conversationId, request.params.runId);
    if (!run) {
      return;
    }
    if (!run.taskId) {
      response.status(409).json({ error: "Only task-backed runs can be cancelled from the control API." });
      return;
    }
    void taskManager
      .cancelTask(run.taskId)
      .then((task) => {
        response.json({ run, task });
      })
      .catch((error) => {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Failed to cancel run.",
        });
      });
  });

  app.post("/api/runs/:runId/resume", (request, response) => {
    const conversationId = z.string().uuid().parse(request.query.conversationId);
    const run = requireScopedWorkspaceRun(response, store, conversationId, request.params.runId);
    if (!run) {
      return;
    }
    if (run.status === "running") {
      response.status(409).json({ error: "Run is still active." });
      return;
    }
    const conversation = store.getConversation(run.conversationId);
    if (!conversation) {
      response.status(404).json({ error: "Session not found for run." });
      return;
    }
    const prompt = [
      "Resume the previous opencode-backed run from the latest saved AetherOps context.",
      `Original request: ${run.userMessage}`,
      `Previous run id: ${run.id}`,
      run.checkpoint ? `Previous phase step: ${run.checkpoint.stepIndex} / ${run.checkpoint.maxSteps}` : "",
      "Use the same session workspace and summarize the continuation result.",
    ]
      .filter(Boolean)
      .join("\n");
    void taskManager
      .enqueueDetachedTask({
        agentId: conversation.agentId,
        conversationId: conversation.id,
        title: `${conversation.title} (resume)`,
        prompt,
        providerKind: conversation.providerKind,
        model: conversation.model,
        reasoningLevel: conversation.reasoningLevel,
        taskKind: "continuation",
        originRunId: run.id,
        startImmediately: true,
      })
      .then((task) => {
        response.json({ run, task });
      })
      .catch((error) => {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Failed to resume run.",
        });
      });
  });

  app.get("/api/runs/:runId/artifacts", (request, response) => {
    const conversationId = z.string().uuid().parse(request.query.conversationId);
    const run = requireScopedWorkspaceRun(response, store, conversationId, request.params.runId);
    if (!run) {
      return;
    }
    response.json({
      artifacts: store.listArtifactsForRun(conversationId, run.id),
    });
  });

  app.get("/api/artifacts/:artifactId/preview", (request, response) => {
    const artifact = store.getArtifact(request.params.artifactId);
    if (!artifact) {
      response.status(404).json({ error: "Artifact not found" });
      return;
    }
    const mode = exportModeFromRequest(request);
    if (
      mode === "full" &&
      !requireFullExportAllowed(response, {
        request,
        token: params.localApiToken,
        allowedPorts: params.localApiAllowedPorts,
      })
    ) {
      return;
    }
    const reportContent = artifactReportContent(artifact);
    if (reportContent !== null) {
      response.json({
        artifact,
        preview: {
          content: redactedReportContent(reportContent, mode),
          binary: false,
          unsupportedEncoding: false,
          truncated: false,
          source: "report",
          sensitiveFieldsHidden: mode !== "full",
          fullContentAvailable: mode !== "full",
        },
      });
      return;
    }
    if (artifact.kind !== "file" || !artifact.path) {
      response.status(415).json({ error: "Artifact preview is only available for file artifacts." });
      return;
    }
    if (!artifact.runId || !store.getWorkspaceRunForConversation(artifact.conversationId, artifact.runId)) {
      response.status(404).json({ error: "Artifact run was not found." });
      return;
    }

    const snapshot = store.getArtifactVersion?.(artifact.id) ?? null;
    if (snapshot?.afterContent !== null && snapshot?.afterContent !== undefined) {
      response.json({
        artifact,
        preview: {
          content: snapshot.afterContent,
          binary: snapshot.binary,
          unsupportedEncoding: snapshot.unsupportedEncoding,
          truncated: snapshot.truncated,
          source: "snapshot",
        },
      });
      return;
    }
    if (snapshot?.binary || snapshot?.truncated) {
      response.json({
        artifact,
        preview: {
          content: "",
          binary: snapshot.binary,
          unsupportedEncoding: snapshot.unsupportedEncoding,
          truncated: snapshot.truncated,
          source: "snapshot",
        },
      });
      return;
    }

    const resolved = workspace.resolvePath({
      conversationId: artifact.conversationId,
      scope: "sandbox",
      relativePath: artifact.path,
      mode: "read",
    });
    const stat = fs.lstatSync(resolved.absolutePath, { throwIfNoEntry: false });
    if (!stat || !stat.isFile()) {
      response.status(404).json({ error: "Artifact file was not found." });
      return;
    }
    const bytesToRead = Math.min(stat.size, TEXT_PREVIEW_BYTES, MAX_READ_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    const fileHandle = fs.openSync(resolved.absolutePath, "r");
    try {
      fs.readSync(fileHandle, buffer, 0, bytesToRead, 0);
    } finally {
      fs.closeSync(fileHandle);
    }
    const binary = buffer.includes(0);
    let content = "";
    let unsupportedEncoding = binary;
    if (!binary) {
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      } catch {
        unsupportedEncoding = true;
      }
    }
    response.json({
      artifact,
      preview: {
        content: unsupportedEncoding ? "" : content,
        binary,
        unsupportedEncoding,
        truncated: stat.size > bytesToRead,
        source: "current-workspace",
      },
    });
  });

  app.get("/api/artifacts/:artifactId/diff", (request, response) => {
    const artifact = store.getArtifact(request.params.artifactId);
    if (!artifact) {
      response.status(404).json({ error: "Artifact not found" });
      return;
    }
    const snapshot = store.getArtifactVersion?.(artifact.id) ?? null;
    return sendArtifactDiffResponse(response, artifact, snapshot);
  });

  app.get("/api/runs/:runId/debug", async (request, response) => {
    const conversationId = z.string().uuid().parse(request.query.conversationId);
    const run = requireScopedWorkspaceRun(response, store, conversationId, request.params.runId);
    if (!run) {
      return;
    }
    const task = run.taskId ? store.getTask(run.taskId) : null;
    const events = store.listWorkspaceRunEvents(conversationId, run.id);
    const lastEvents = events.slice(-12).map((event) => ({
      ...event,
      payload: redactUnknown(event.payload) as Record<string, unknown>,
    }));
    const changedFiles = [
      ...new Set(
        events.flatMap((event) => {
          const value = event.payload.changedFiles;
          return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
        }),
      ),
    ];
    const errorEvent = [...events]
      .reverse()
      .find((event) => typeof event.payload.error === "string");
    const engineRun =
      [...events]
        .reverse()
        .map((event) => event.payload.engineRun)
        .find(isEngineRunRecord) ?? null;
    const report =
      store
        .listArtifactsForRun(conversationId, run.id)
        .filter((artifact) => artifact.kind === "report")
        .find((artifact) => artifact.metadata.reportType === "run") ?? null;
    response.json({
      run: buildSafeRunDebugRecord(run),
      task: buildSafeTaskDebugRecord(task),
      engineRun,
      report: buildSafeReportDebugRecord(report),
      summary: {
        status: run.status,
        phase: run.phase,
        durationMs: Math.max(0, run.updatedAt - run.createdAt),
        model: run.model,
        changedFiles,
        error: typeof errorEvent?.payload.error === "string" ? errorEvent.payload.error : null,
        lastEvents,
        artifactCount: store.countArtifactsForRun(conversationId, run.id),
        taskKind: task?.taskKind ?? null,
      },
    });
  });
}
