import type express from "express";
import { z } from "zod";
import type { createStore } from "../db.js";
import type { createWorkspaceManager } from "../lib/workspace.js";
import type { ProviderKind, ReasoningLevel } from "../types.js";
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

export function registerWorkspaceRoutes(
  app: express.Express,
  params: {
    store: WorkspaceRouteStore;
    workspace: WorkspaceRouteManager;
    taskManager: WorkspaceRouteTaskManager;
    exposeWorkspaceDebugPaths: boolean;
  },
) {
  const { store, taskManager } = params;

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
}
