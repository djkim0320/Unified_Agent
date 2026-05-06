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

const SKILL_TEMPLATE_BOUNDARY =
  "Skill templates are reusable prompt, flow, standing-order, verification, and heartbeat patterns. AetherOps does not execute skills directly; execution remains opencode-only.";

export function registerSkillTemplateRoutes(
  app: express.Express,
  params: {
    store: AppStore;
    workspace: AppWorkspace;
  },
) {
  const { store, workspace } = params;

  app.get("/api/skill-templates", (_request, response) => {
    response.json({
      templates: listSkillTemplates(),
      boundary: SKILL_TEMPLATE_BOUNDARY,
    });
  });

  app.post(
    "/api/agents/:agentId/skill-templates/:templateId/apply-standing-orders",
    (request, response) => {
      const agent = requireAgent(store, response, request.params.agentId);
      if (!agent) {
        return;
      }
      const templateId = SkillTemplateIdSchema.parse(request.params.templateId);
      const template = getSkillTemplate(templateId);
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
      const template = getSkillTemplate(templateId);
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
