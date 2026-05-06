import type express from "express";
import { z } from "zod";
import { normalizeReasoningLevel } from "../reasoning-options.js";
import { ProviderKindSchema, ReasoningLevelSchema } from "../schemas/common.js";
import { requireAgent, type AppGateway, type AppStore } from "./context.js";

const TaskCreateSchema = z.object({
  agentId: z.string().min(1).max(120),
  conversationId: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(120).optional(),
  prompt: z.string().min(1).max(20_000),
  providerKind: ProviderKindSchema.optional(),
  model: z.string().min(1).max(120).optional(),
  reasoningLevel: ReasoningLevelSchema.optional(),
  autoStart: z.boolean().optional().default(true),
});

export function registerTasksRoutes(
  app: express.Express,
  params: {
    store: AppStore;
    gateway: AppGateway;
  },
) {
  const { store, gateway } = params;

  app.get("/api/agents/:agentId/tasks", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    response.json({
      tasks: store.listTasks(agent.id),
    });
  });

  app.post("/api/agents/:agentId/tasks", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    const body = TaskCreateSchema.parse({
      ...request.body,
      agentId: agent.id,
    });
    const providerKind = body.providerKind ?? agent.providerKind;
    const model = body.model ?? agent.model;
    const reasoningLevel = normalizeReasoningLevel(
      providerKind,
      model,
      body.reasoningLevel ?? agent.reasoningLevel,
    );
    const conversation =
      body.conversationId
        ? store.getConversation(body.conversationId)
        : store.saveConversation({
            agentId: agent.id,
            title: body.title ?? "백그라운드 작업",
            providerKind,
            model,
            reasoningLevel,
          });
    if (!conversation || conversation.agentId !== agent.id) {
      response.status(404).json({ error: "Session not found for agent." });
      return;
    }

    void gateway.taskManager
      .enqueueDetachedTask({
        agentId: agent.id,
        conversationId: conversation.id,
        title: body.title ?? (body.prompt.trim().slice(0, 80) || "백그라운드 작업"),
        prompt: body.prompt,
        providerKind,
        model,
        reasoningLevel,
        startImmediately: body.autoStart,
      })
      .then((task) => {
        response.json({ task });
      })
      .catch((error) => {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Failed to start background task.",
        });
      });
  });

  app.post("/api/agents/:agentId/tasks/:taskId/cancel", (request, response) => {
    const task = store.getTaskForAgent(request.params.agentId, request.params.taskId);
    if (!task) {
      response.status(404).json({ error: "Task not found" });
      return;
    }
    void gateway.taskManager
      .cancelTask(task.id)
      .then((updated) => {
        response.json({ task: updated ?? task });
      })
      .catch((error) => {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Failed to cancel task.",
        });
      });
  });

  app.get("/api/agents/:agentId/tasks/:taskId/events", (request, response) => {
    const task = store.getTaskForAgent(request.params.agentId, request.params.taskId);
    if (!task) {
      response.status(404).json({ error: "Task not found" });
      return;
    }
    response.json({
      events: store.listTaskEvents(request.params.agentId, request.params.taskId),
    });
  });

  app.get("/api/agents/:agentId/tasks/:taskId/debug", (request, response) => {
    const task = store.getTaskForAgent(request.params.agentId, request.params.taskId);
    if (!task) {
      response.status(404).json({ error: "Task not found" });
      return;
    }
    const run = task.runId ? store.getWorkspaceRun(task.runId) : null;
    const events = store.listTaskEvents(request.params.agentId, task.id);
    const runEvents = run ? store.listWorkspaceRunEvents(run.conversationId, run.id).slice(-12) : [];
    const flow = task.taskFlowId && store.getTaskFlow ? store.getTaskFlow(task.taskFlowId) : null;
    const step =
      task.taskFlowId && task.flowStepKey && store.listTaskFlowSteps
        ? store.listTaskFlowSteps(task.taskFlowId).find((candidate) => candidate.stepKey === task.flowStepKey) ?? null
        : null;
    const lastEvent = [...events].reverse()[0] ?? null;
    response.json({
      task: {
        ...task,
        prompt: undefined,
        resultText: undefined,
        hasPrompt: Boolean(task.prompt),
        hasResultText: Boolean(task.resultText),
      },
      run: run
        ? {
            id: run.id,
            status: run.status,
            phase: run.phase,
            providerKind: run.providerKind,
            model: run.model,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
          }
        : null,
      flow: flow
        ? {
            id: flow.id,
            title: flow.title,
            status: flow.status,
          }
        : null,
      step: step
        ? {
            id: step.id,
            stepKey: step.stepKey,
            title: step.title,
            status: step.status,
            dependencyStepKey: step.dependencyStepKey,
          }
        : null,
      summary: {
        status: task.status,
        taskKind: task.taskKind,
        runId: task.runId,
        scheduledFor: task.scheduledFor,
        automationRuleId: task.automationRuleId,
        taskFlowId: task.taskFlowId,
        flowStepKey: task.flowStepKey,
        lastEvent,
        runEvents,
      },
    });
  });
}
