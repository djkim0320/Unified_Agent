import type express from "express";
import { z } from "zod";
import {
  appendSkillTemplateToHeartbeat,
  appendSkillTemplateToStandingOrders,
  getSkillTemplate,
  listSkillTemplates,
} from "../lib/skill-template-catalog.js";
import { requireAgent, type AppStore, type AppWorkspace } from "./context.js";

const SkillTemplateIdSchema = z.string().min(1).max(120);
const FlowTemplateStepSchema = z.object({
  stepKey: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  prompt: z.string().min(1).max(20_000),
  dependencyStepKey: z.string().min(1).max(80).nullable().optional(),
});

const SkillTemplateSaveSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  scope: z.enum(["agent", "shared"]).optional().default("agent"),
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(80),
  summary: z.string().min(1).max(500),
  description: z.string().min(1).max(5000),
  standingOrderPatch: z.string().max(10_000).default(""),
  flowTemplate: z.object({
    title: z.string().min(1).max(120),
    steps: z.array(FlowTemplateStepSchema).min(0).max(8),
  }),
  verificationChecklist: z.array(z.string().min(1).max(500)).max(20).default([]),
  heartbeatInstructions: z.string().max(10_000).default(""),
  suggestedPrompt: z.string().max(20_000).default(""),
  tags: z.array(z.string().min(1).max(80)).max(20).default([]),
  metadata: z.record(z.unknown()).optional().default({}),
});

const SKILL_TEMPLATE_BOUNDARY =
  "Skill templates are reusable prompt, flow, standing-order, verification, and heartbeat patterns. AetherOps does not execute skills directly; execution remains opencode-only.";

const FromFlowSchema = z.object({
  force: z.boolean().optional().default(false),
});

function normalizeFlowTemplate(flowTemplate: z.infer<typeof SkillTemplateSaveSchema>["flowTemplate"]) {
  return {
    title: flowTemplate.title,
    steps: flowTemplate.steps.map((step) => ({
      stepKey: step.stepKey,
      title: step.title,
      prompt: step.prompt,
      dependencyStepKey: step.dependencyStepKey ?? null,
    })),
  };
}

export function registerSkillTemplateRoutes(
  app: express.Express,
  params: {
    store: AppStore;
    workspace: AppWorkspace;
  },
) {
  const { store, workspace } = params;

  function resolveTemplate(agentId: string, templateId: string) {
    return getSkillTemplate(templateId) ?? store.getCustomSkillTemplate?.(agentId, templateId) ?? null;
  }

  app.get("/api/skill-templates", (request, response) => {
    const agentId = typeof request.query.agentId === "string" ? request.query.agentId : undefined;
    response.json({
      templates: listSkillTemplates(store.listCustomSkillTemplates?.(agentId ?? null) ?? []),
      boundary: SKILL_TEMPLATE_BOUNDARY,
    });
  });

  app.post("/api/agents/:agentId/skill-templates", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    const body = SkillTemplateSaveSchema.parse(request.body);
    const template = store.saveCustomSkillTemplate({
      ...body,
      flowTemplate: normalizeFlowTemplate(body.flowTemplate),
      agentId: body.scope === "shared" ? null : agent.id,
    });
    response.json({ template, boundary: SKILL_TEMPLATE_BOUNDARY });
  });

  app.post("/api/agents/:agentId/skill-templates/from-flow/:flowId", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    const body = FromFlowSchema.parse(request.body ?? {});
    const flow = store.getTaskFlow?.(request.params.flowId);
    if (!flow || flow.agentId !== agent.id) {
      response.status(404).json({ error: "Task flow not found." });
      return;
    }
    const existing = (store.listCustomSkillTemplates?.(agent.id) ?? []).find(
      (template) => template.metadata?.sourceFlowId === flow.id,
    );
    if (existing && !body.force) {
      response.status(409).json({
        error: "A skill template already exists for this flow.",
        template: existing,
      });
      return;
    }
    const steps = store.listTaskFlowSteps?.(flow.id) ?? [];
    const template = store.saveCustomSkillTemplate({
      id: existing?.id,
      agentId: agent.id,
      scope: "agent",
      name: flow.title,
      category: "Custom",
      summary: flow.resultSummary ?? `${flow.title} Flow에서 저장된 재사용 템플릿입니다.`,
      description: "AetherOps Flow를 재사용 가능한 Skill 템플릿으로 저장했습니다. Skill은 실행 런타임이 아니라 prompt/flow 패턴입니다.",
      standingOrderPatch: `When using the ${flow.title} pattern, follow the flow steps and verify outputs before continuing.`,
      flowTemplate: {
        title: flow.title,
        steps: steps.map((step) => ({
          stepKey: step.stepKey,
          title: step.title,
          prompt: step.prompt,
          dependencyStepKey: step.dependencyStepKey,
        })),
      },
      verificationChecklist: steps
        .filter((step) => step.stepKind === "verification_gate")
        .map((step) => step.title),
      heartbeatInstructions: `Track progress for ${flow.title}; surface blocked steps, failed runs, and unresolved decisions.`,
      suggestedPrompt: `${flow.title} 목표를 이 Skill flow에 맞춰 단계별로 실행 계획화해 주세요.`,
      tags: ["from-flow", flow.status],
      metadata: {
        source: "flow",
        sourceFlowId: flow.id,
        sourceFlowStatus: flow.status,
        savedAt: Date.now(),
      },
    });
    response.json({ template, updatedExisting: Boolean(existing), boundary: SKILL_TEMPLATE_BOUNDARY });
  });

  app.patch("/api/agents/:agentId/skill-templates/:templateId", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    if (getSkillTemplate(request.params.templateId)) {
      response.status(409).json({ error: "Built-in skill templates are read-only." });
      return;
    }
    const existing = store.getCustomSkillTemplate?.(agent.id, request.params.templateId);
    if (!existing) {
      response.status(404).json({ error: "Skill template not found." });
      return;
    }
    const body = SkillTemplateSaveSchema.partial().parse(request.body);
    const template = store.saveCustomSkillTemplate({
      id: existing.id,
      agentId: body.scope === "shared" ? null : agent.id,
      scope: body.scope ?? (existing.scope === "shared" ? "shared" : "agent"),
      name: body.name ?? existing.name,
      category: body.category ?? existing.category,
      summary: body.summary ?? existing.summary,
      description: body.description ?? existing.description,
      standingOrderPatch: body.standingOrderPatch ?? existing.standingOrderPatch,
      flowTemplate: body.flowTemplate ? normalizeFlowTemplate(body.flowTemplate) : existing.flowTemplate,
      verificationChecklist: body.verificationChecklist ?? existing.verificationChecklist,
      heartbeatInstructions: body.heartbeatInstructions ?? existing.heartbeatInstructions,
      suggestedPrompt: body.suggestedPrompt ?? existing.suggestedPrompt,
      tags: body.tags ?? existing.tags,
      metadata: body.metadata ?? existing.metadata ?? {},
    });
    response.json({ template, boundary: SKILL_TEMPLATE_BOUNDARY });
  });

  app.delete("/api/agents/:agentId/skill-templates/:templateId", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    if (getSkillTemplate(request.params.templateId)) {
      response.status(409).json({ error: "Built-in skill templates are read-only." });
      return;
    }
    const deleted = store.deleteCustomSkillTemplate?.(agent.id, request.params.templateId) ?? false;
    if (!deleted) {
      response.status(404).json({ error: "Skill template not found." });
      return;
    }
    response.json({ ok: true, templateId: request.params.templateId, boundary: SKILL_TEMPLATE_BOUNDARY });
  });

  app.post(
    "/api/agents/:agentId/skill-templates/:templateId/apply-standing-orders",
    (request, response) => {
      const agent = requireAgent(store, response, request.params.agentId);
      if (!agent) {
        return;
      }
      const templateId = SkillTemplateIdSchema.parse(request.params.templateId);
      const template = resolveTemplate(agent.id, templateId);
      if (!template) {
        response.status(404).json({ error: "Skill template not found." });
        return;
      }

      const current = workspace.readAgentStandingOrders(agent.id);
      const result = appendSkillTemplateToStandingOrders(current.content, template);
      const standingOrders = result.applied
        ? workspace.writeAgentStandingOrders(agent.id, result.content)
        : current;
      response.json({
        standingOrders,
        template,
        applied: result.applied,
        message: result.applied
          ? `${template.name} was appended to STANDING_ORDERS.md.`
          : `${template.name} is already present in STANDING_ORDERS.md.`,
        boundary: SKILL_TEMPLATE_BOUNDARY,
      });
    },
  );

  app.post(
    "/api/agents/:agentId/skill-templates/:templateId/apply-heartbeat",
    (request, response) => {
      const agent = requireAgent(store, response, request.params.agentId);
      if (!agent) {
        return;
      }
      const templateId = SkillTemplateIdSchema.parse(request.params.templateId);
      const template = resolveTemplate(agent.id, templateId);
      if (!template) {
        response.status(404).json({ error: "Skill template not found." });
        return;
      }

      const current = workspace.readAgentHeartbeat(agent.id);
      const result = appendSkillTemplateToHeartbeat(current, template);
      const heartbeat = result.applied
        ? workspace.writeAgentHeartbeat(agent.id, {
            enabled: current.enabled,
            intervalMinutes: current.intervalMinutes,
            lastRun: current.lastRun,
            instructions: result.instructions,
          })
        : current;
      response.json({
        heartbeat,
        template,
        applied: result.applied,
        message: result.applied
          ? `${template.name} heartbeat instructions were appended. Heartbeat enabled state was not changed.`
          : `${template.name} is already present in HEARTBEAT.md.`,
        boundary: SKILL_TEMPLATE_BOUNDARY,
      });
    },
  );
}
