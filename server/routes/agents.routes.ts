import type express from "express";
import { z } from "zod";
import { DEFAULT_AGENT_ID } from "../db.js";
import { getProviderAdapter } from "../provider-registry.js";
import { sendLegacyGone } from "./legacy-gone.js";
import { requireAgent, type AppGateway, type AppStore, type AppWorkspace } from "./context.js";
import { ProviderKindSchema, ReasoningLevelSchema } from "../schemas/common.js";

const AgentUpsertSchema = z.object({
  agentId: z.string().min(1).max(120).optional(),
  name: z.string().min(1).max(80),
  providerKind: ProviderKindSchema.optional(),
  model: z.string().min(1).max(120).optional(),
  reasoningLevel: ReasoningLevelSchema.optional(),
});

const AgentSoulWriteSchema = z.object({
  content: z.string().max(50_000),
});

const AgentStandingOrdersWriteSchema = z.object({
  content: z.string().max(50_000),
});

const AgentHeartbeatWriteSchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.coerce.number().int().min(1).max(60 * 24 * 365),
  lastRun: z.string().nullable().optional(),
  instructions: z.string().max(50_000).optional().default(""),
});

export function registerAgentsRoutes(
  app: express.Express,
  params: {
    store: AppStore;
    workspace: AppWorkspace;
    gateway: AppGateway;
  },
) {
  const { store, workspace, gateway } = params;

  app.get("/api/agents", (_request, response) => {
    response.json({
      agents: store.listAgents(),
    });
  });

  app.post("/api/agents", (request, response) => {
    const body = AgentUpsertSchema.parse(request.body);
    const existing = body.agentId ? store.getAgent(body.agentId) : null;
    const providerKind = body.providerKind ?? existing?.providerKind ?? "openai";
    const agent = store.saveAgent({
      id: body.agentId,
      name: body.name,
      providerKind,
      model: body.model ?? existing?.model ?? getProviderAdapter(providerKind).defaultModel,
      reasoningLevel: body.reasoningLevel ?? existing?.reasoningLevel ?? "high",
    });
    workspace.createAgentWorkspace(agent.id);
    response.json({ agent });
  });

  app.delete("/api/agents/:agentId", async (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    if (agent.id === DEFAULT_AGENT_ID) {
      response.status(400).json({ error: "The default agent cannot be deleted." });
      return;
    }
    const deleted = store.deleteAgent(agent.id);
    if (!deleted) {
      response.status(404).json({ error: "Agent not found" });
      return;
    }
    try {
      await workspace.deleteAgentWorkspace(agent.id);
    } catch {
      // Agent workspace cleanup is best-effort and anchored to workspace/opencode/agents/<agentId>.
    }
    response.json({ ok: true, agentId: agent.id });
  });

  app.get("/api/agents/:agentId/memory", (_request, response) => {
    sendLegacyGone(response, "Agent memory API");
  });
  app.post("/api/agents/:agentId/memory", (_request, response) => {
    sendLegacyGone(response, "Agent memory API");
  });
  app.get("/api/agents/:agentId/memory/search", (_request, response) => {
    sendLegacyGone(response, "Agent memory search API");
  });
  app.get("/api/agents/:agentId/skills", (_request, response) => {
    sendLegacyGone(response, "AetherOps skill/plugin execution");
  });
  app.post("/api/agents/:agentId/skills", (_request, response) => {
    sendLegacyGone(response, "AetherOps skill/plugin execution");
  });

  app.get("/api/agents/:agentId/soul", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    response.json({
      soul: workspace.readAgentSoul(agent.id),
    });
  });

  app.put("/api/agents/:agentId/soul", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    const body = AgentSoulWriteSchema.parse(request.body);
    response.json({
      soul: workspace.writeAgentSoul(agent.id, body.content),
    });
  });

  app.get("/api/agents/:agentId/standing-orders", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    response.json({
      standingOrders: workspace.readAgentStandingOrders(agent.id),
    });
  });

  app.put("/api/agents/:agentId/standing-orders", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    const body = AgentStandingOrdersWriteSchema.parse(request.body);
    response.json({
      standingOrders: workspace.writeAgentStandingOrders(agent.id, body.content),
    });
  });

  app.get("/api/agents/:agentId/heartbeat", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    response.json({
      heartbeat: workspace.readAgentHeartbeat(agent.id),
    });
  });

  app.put("/api/agents/:agentId/heartbeat", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    const body = AgentHeartbeatWriteSchema.parse(request.body);
    response.json({
      heartbeat: workspace.writeAgentHeartbeat(agent.id, {
        enabled: body.enabled,
        intervalMinutes: body.intervalMinutes,
        lastRun: body.lastRun ?? null,
        instructions: body.instructions,
      }),
    });
  });

  app.post("/api/agents/:agentId/heartbeat/trigger", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    void gateway.queueHeartbeatTask({ agentId: agent.id, triggerSource: "manual" })
      .then((result) => {
        if (!result) {
          response.status(409).json({ error: "A heartbeat task is already queued or running." });
          return;
        }
        response.json(result);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to trigger heartbeat.";
        response.status(/already queued or running/i.test(message) ? 409 : 400).json({
          error: message,
        });
      })
  });

  app.get("/api/agents/:agentId/heartbeat/logs", (request, response) => {
    const agent = requireAgent(store, response, request.params.agentId);
    if (!agent) {
      return;
    }
    response.json({
      logs: store.listHeartbeatLogs(agent.id),
    });
  });
}
