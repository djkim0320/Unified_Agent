import type express from "express";
import { z } from "zod";
import { normalizeReasoningLevel } from "../reasoning-options.js";
import { ProviderKindSchema, ReasoningLevelSchema } from "../schemas/common.js";
import {
  requireAgent,
  requireAutomationRule,
  type AppStore,
} from "./context.js";

const AutomationRuleCreateSchema = z.object({
  conversationId: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(120),
  prompt: z.string().min(1).max(20_000),
  providerKind: ProviderKindSchema.optional(),
  model: z.string().min(1).max(120).optional(),
  reasoningLevel: ReasoningLevelSchema.optional(),
  enabled: z.boolean().optional().default(true),
  intervalMinutes: z.coerce.number().int().min(1).max(60 * 24 * 365),
  nextRunAt: z.coerce.number().int().optional(),
});

const AutomationRulePatchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  prompt: z.string().min(1).max(20_000).optional(),
  providerKind: ProviderKindSchema.optional(),
  model: z.string().min(1).max(120).optional(),
  reasoningLevel: ReasoningLevelSchema.optional(),
  enabled: z.boolean().optional(),
  intervalMinutes: z.coerce.number().int().min(1).max(60 * 24 * 365).optional(),
  nextRunAt: z.coerce.number().int().optional(),
});

export function registerAutomationRoutes(app: express.Express, params: { store: AppStore }) {
  const { store } = params;

  app.get("/api/agents/:agentId/automation-rules", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    response.json({
      rules: store.listAutomationRules?.(agent.id) ?? [],
    });
  });

  app.post("/api/agents/:agentId/automation-rules", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    const body = AutomationRuleCreateSchema.parse(request.body);
    const providerKind = body.providerKind ?? agent.providerKind;
    const model = body.model ?? agent.model;
    const reasoningLevel = normalizeReasoningLevel(
      providerKind,
      model,
      body.reasoningLevel ?? agent.reasoningLevel,
    );
    const conversation = body.conversationId
      ? store.getConversation(body.conversationId)
      : store.saveConversation({
          agentId: agent.id,
          title: body.title,
          providerKind,
          model,
          reasoningLevel,
        });
    if (!conversation || conversation.agentId !== agent.id) {
      response.status(404).json({ error: "Session not found for agent." });
      return;
    }
    const rule = store.createAutomationRule({
      agentId: agent.id,
      conversationId: conversation.id,
      title: body.title,
      prompt: body.prompt,
      providerKind,
      model,
      reasoningLevel,
      enabled: body.enabled,
      intervalMinutes: body.intervalMinutes,
      nextRunAt: body.nextRunAt,
    });
    response.status(201).json({ rule, conversation });
  });

  app.patch("/api/agents/:agentId/automation-rules/:ruleId", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    if (!requireAutomationRule(store, response, agent.id, request.params.ruleId)) {
      return;
    }
    const body = AutomationRulePatchSchema.parse(request.body);
    const providerKind = body.providerKind;
    const model = body.model;
    const reasoningLevel =
      providerKind && model
        ? normalizeReasoningLevel(providerKind, model, body.reasoningLevel ?? agent.reasoningLevel)
        : body.reasoningLevel;
    const rule = store.updateAutomationRule({
      agentId: agent.id,
      ruleId: request.params.ruleId,
      title: body.title,
      prompt: body.prompt,
      providerKind,
      model,
      reasoningLevel,
      enabled: body.enabled,
      intervalMinutes: body.intervalMinutes,
      nextRunAt: body.nextRunAt,
    });
    response.json({ rule });
  });

  app.delete("/api/agents/:agentId/automation-rules/:ruleId", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    if (!requireAutomationRule(store, response, agent.id, request.params.ruleId)) {
      return;
    }
    response.json({
      ok: store.deleteAutomationRule(agent.id, request.params.ruleId),
      ruleId: request.params.ruleId,
    });
  });

  app.post("/api/agents/:agentId/automation-rules/:ruleId/trigger", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    const rule = requireAutomationRule(store, response, agent.id, request.params.ruleId);
    if (!rule) {
      return;
    }
    const result = store.enqueueAutomationRuleTask?.(rule.id, Date.now(), true) ?? null;
    if (!result) {
      response.status(400).json({ error: "Automation rule could not be triggered." });
      return;
    }
    if (!result.enqueued) {
      response.status(409).json({
        error: "An automation task for this rule is already queued or running.",
        task: result.task,
      });
      return;
    }
    response.json({
      rule: result.rule,
      task: result.task,
    });
  });
}
