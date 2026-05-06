import type express from "express";
import { z } from "zod";
import { generateFlowDraft } from "../lib/flow-draft.js";
import { buildTaskFlowResponse } from "../lib/task-flow-response.js";
import {
  requireAgent,
  requireTaskFlow,
  requireTaskFlowStep,
  type AppGateway,
  type AppStore,
} from "./context.js";

const TaskFlowCreateSchema = z
  .object({
    conversationId: z.string().uuid().optional().nullable(),
    title: z.string().min(1).max(120),
    autoStart: z.boolean().optional().default(true),
    steps: z
      .array(
        z.object({
          stepKey: z.string().min(1).max(80),
          title: z.string().min(1).max(120),
          prompt: z.string().min(1).max(20_000),
          dependencyStepKey: z.string().min(1).max(80).optional().nullable(),
        }),
      )
      .min(0)
      .max(8)
      .default([]),
  })
  .superRefine((flow, context) => {
    if (flow.autoStart && flow.steps.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps"],
        message: "Empty task flows must be created with autoStart=false.",
      });
    }
    validateStepDependencies(flow.steps, context);
  });

const TaskFlowStepsReplaceSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    steps: z
      .array(
        z.object({
          stepKey: z.string().min(1).max(80),
          title: z.string().min(1).max(120),
          prompt: z.string().min(1).max(20_000),
          dependencyStepKey: z.string().min(1).max(80).optional().nullable(),
        }),
      )
      .min(0)
      .max(8),
  })
  .superRefine((body, context) => {
    validateStepDependencies(body.steps, context);
  });

const TaskFlowDraftSchema = z.object({
  conversationId: z.string().uuid().optional().nullable(),
  prompt: z.string().min(1).max(20_000),
  title: z.string().min(1).max(120).optional().nullable(),
});

function validateStepDependencies(
  steps: Array<{ stepKey: string; dependencyStepKey?: string | null }>,
  context: z.RefinementCtx,
) {
  const stepKeys = new Set<string>();
  const dependencyByStepKey = new Map<string, string | null | undefined>();
  for (const [index, step] of steps.entries()) {
    if (stepKeys.has(step.stepKey)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps", index, "stepKey"],
        message: "Step keys must be unique.",
      });
    }
    stepKeys.add(step.stepKey);
    dependencyByStepKey.set(step.stepKey, step.dependencyStepKey);
  }

  for (const [index, step] of steps.entries()) {
    if (!step.dependencyStepKey) {
      continue;
    }
    if (step.dependencyStepKey === step.stepKey || !stepKeys.has(step.dependencyStepKey)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps", index, "dependencyStepKey"],
        message: "Dependency must reference another step in the same flow.",
      });
      continue;
    }

    const seen = new Set<string>([step.stepKey]);
    let dependency: string | null | undefined = step.dependencyStepKey;
    while (dependency) {
      if (seen.has(dependency)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", index, "dependencyStepKey"],
          message: "Step dependencies must not form a cycle.",
        });
        break;
      }
      seen.add(dependency);
      dependency = dependencyByStepKey.get(dependency);
    }
  }
}

export function registerTaskFlowRoutes(
  app: express.Express,
  params: {
    store: AppStore;
    gateway: AppGateway;
  },
) {
  const { store, gateway } = params;

  app.get("/api/agents/:agentId/flows", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    response.json({
      flows: store.listTaskFlows?.(agent.id) ?? [],
    });
  });

  app.post("/api/agents/:agentId/flows/draft", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    const parsedBody = TaskFlowDraftSchema.safeParse(request.body);
    if (!parsedBody.success) {
      response.status(400).json({
        error: "Invalid flow draft request.",
        details: parsedBody.error.issues,
      });
      return;
    }
    const body = parsedBody.data;
    if (body.conversationId) {
      const conversation = store.getConversation(body.conversationId);
      if (!conversation || conversation.agentId !== agent.id) {
        response.status(404).json({ error: "Session not found for flow draft." });
        return;
      }
    }
    response.json({
      draft: generateFlowDraft({
        prompt: body.prompt,
        title: body.title,
      }),
    });
  });

  app.post("/api/agents/:agentId/flows", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    const parsedBody = TaskFlowCreateSchema.safeParse(request.body);
    if (!parsedBody.success) {
      response.status(400).json({
        error: "Invalid task flow request.",
        details: parsedBody.error.issues,
      });
      return;
    }
    const body = parsedBody.data;
    const conversation =
      body.conversationId
        ? store.getConversation(body.conversationId)
        : store.listConversations(agent.id)[0] ??
          store.saveConversation({
            agentId: agent.id,
            title: body.title,
            providerKind: agent.providerKind,
            model: agent.model,
            reasoningLevel: agent.reasoningLevel,
          });
    if (!conversation || conversation.agentId !== agent.id) {
      response.status(404).json({ error: "Session not found for task flow." });
      return;
    }
    void gateway
      .createFlow({
        agentId: agent.id,
        conversationId: conversation.id,
        title: body.title,
        autoStart: body.autoStart,
        steps: body.steps.map((step) => ({
          stepKey: step.stepKey,
          title: step.title,
          prompt: step.prompt,
          dependencyStepKey: step.dependencyStepKey ?? null,
        })),
      })
      .then((result) => {
        response.json(buildTaskFlowResponse(store, result.flow));
      })
      .catch((error) => {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Failed to create task flow.",
        });
      });
  });

  app.get("/api/flows/:flowId", (request, response) => {
    const flow = requireTaskFlow(store, response, request.params.flowId);
    if (!flow) {
      return;
    }
    response.json(buildTaskFlowResponse(store, flow));
  });

  app.put("/api/flows/:flowId/steps", (request, response) => {
    const flow = requireTaskFlow(store, response, request.params.flowId);
    if (!flow) {
      return;
    }
    if (flow.status !== "queued") {
      response.status(409).json({ error: "Only queued task flows can be edited." });
      return;
    }
    const existingSteps = store.listTaskFlowSteps?.(flow.id) ?? [];
    if (existingSteps.some((step) => step.taskId || step.status !== "queued")) {
      response.status(409).json({ error: "Task flow steps with execution history cannot be edited." });
      return;
    }
    const parsedBody = TaskFlowStepsReplaceSchema.safeParse(request.body);
    if (!parsedBody.success) {
      response.status(400).json({
        error: "Invalid task flow steps.",
        details: parsedBody.error.issues,
      });
      return;
    }
    if (!store.replaceTaskFlowSteps) {
      response.status(501).json({ error: "Task flow editing is not available." });
      return;
    }
    store.replaceTaskFlowSteps(
      flow.id,
      parsedBody.data.steps.map((step, index) => ({
        ...step,
        position: index,
        dependencyStepKey: step.dependencyStepKey ?? null,
      })),
      parsedBody.data.title,
    );
    const updatedFlow = store.getTaskFlow?.(flow.id) ?? flow;
    response.json(buildTaskFlowResponse(store, updatedFlow));
  });

  app.delete("/api/flows/:flowId", (request, response) => {
    const flow = requireTaskFlow(store, response, request.params.flowId);
    if (!flow) {
      return;
    }
    if (flow.status === "running") {
      response.status(409).json({ error: "Running task flows must be cancelled before deletion." });
      return;
    }
    if (!store.deleteTaskFlow) {
      response.status(501).json({ error: "Task flow deletion is not available." });
      return;
    }
    const deleted = store.deleteTaskFlow(flow.id);
    response.json({ ok: deleted, flowId: flow.id });
  });

  app.post("/api/flows/:flowId/cancel", (request, response) => {
    const flow = requireTaskFlow(store, response, request.params.flowId);
    if (!flow) {
      return;
    }
    void gateway.taskManager
      .cancelTaskFlow(flow.id)
      .then((updated) => {
        response.json(updated ? buildTaskFlowResponse(store, updated) : { flow: null, steps: [] });
      })
      .catch((error) => {
        response.status(400).json({ error: error instanceof Error ? error.message : "Failed to cancel task flow." });
      });
  });

  app.post("/api/flows/:flowId/start", (request, response) => {
    const flow = requireTaskFlow(store, response, request.params.flowId);
    if (!flow) {
      return;
    }
    if ((store.listTaskFlowSteps?.(flow.id) ?? []).length === 0) {
      response.status(409).json({ error: "Task flow needs at least one step before it can start." });
      return;
    }
    void gateway.taskManager
      .startTaskFlow(flow.id)
      .then((updated) => {
        const nextFlow = updated ?? store.getTaskFlow?.(flow.id) ?? flow;
        response.json(buildTaskFlowResponse(store, nextFlow));
      })
      .catch((error) => {
        response.status(400).json({ error: error instanceof Error ? error.message : "Failed to start task flow." });
      });
  });

  app.post("/api/flows/:flowId/resume", (request, response) => {
    const flow = requireTaskFlow(store, response, request.params.flowId);
    if (!flow) {
      return;
    }
    void gateway.taskManager
      .resumeTaskFlow(flow.id)
      .then((updated) => {
        const nextFlow = updated ?? store.getTaskFlow?.(flow.id) ?? flow;
        response.json(buildTaskFlowResponse(store, nextFlow));
      })
      .catch((error) => {
        response.status(400).json({ error: error instanceof Error ? error.message : "Failed to resume task flow." });
      });
  });

  app.post("/api/flows/:flowId/steps/:stepId/retry", (request, response) => {
    const flow = requireTaskFlow(store, response, request.params.flowId);
    if (!flow || !requireTaskFlowStep(store, response, flow, request.params.stepId)) {
      return;
    }
    void gateway.taskManager
      .retryTaskFlowStep(flow.id, request.params.stepId)
      .then((updated) => {
        const nextFlow = updated ?? store.getTaskFlow?.(flow.id) ?? flow;
        response.json(buildTaskFlowResponse(store, nextFlow));
      })
      .catch((error) => {
        response.status(400).json({ error: error instanceof Error ? error.message : "Failed to retry task flow step." });
      });
  });

  app.post("/api/flows/:flowId/steps/:stepId/skip", (request, response) => {
    const flow = requireTaskFlow(store, response, request.params.flowId);
    if (!flow || !requireTaskFlowStep(store, response, flow, request.params.stepId)) {
      return;
    }
    void gateway.taskManager
      .skipTaskFlowStep(flow.id, request.params.stepId)
      .then((updated) => {
        const nextFlow = updated ?? store.getTaskFlow?.(flow.id) ?? flow;
        response.json(buildTaskFlowResponse(store, nextFlow));
      })
      .catch((error) => {
        response.status(400).json({ error: error instanceof Error ? error.message : "Failed to skip task flow step." });
      });
  });
}
