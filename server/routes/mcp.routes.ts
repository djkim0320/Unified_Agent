import type express from "express";
import { z } from "zod";
import {
  buildMcpConfigStatus,
  getMcpCatalogEntry,
  getStaticMcpCatalog,
  validateMcpSnippet,
} from "../lib/mcp-config-metadata.js";
import { withEngineAuthEvidence } from "../lib/engine-auth-evidence.js";
import { normalizeReasoningLevel } from "../reasoning-options.js";
import { requireAgent, type AppGateway, type AppStore } from "./context.js";

const McpTestRunSchema = z.object({
  agentId: z.string().min(1).max(120),
  conversationId: z.string().uuid().optional().nullable(),
  catalogId: z.string().min(1).max(80).optional(),
  serverId: z.string().min(1).max(120).optional(),
  autoStart: z.boolean().optional().default(true),
});

const McpSnippetValidateSchema = z.object({
  snippet: z.string().min(1).max(50_000),
});

export function registerMcpRoutes(
  app: express.Express,
  params: {
    store: AppStore;
    gateway: AppGateway;
    exposeWorkspaceDebugPaths: boolean;
  },
) {
  const { store, gateway } = params;

  app.get("/api/mcp/catalog", (_request, response) => {
    response.json({
      servers: getStaticMcpCatalog(),
      boundary: "AetherOps는 MCP 서버를 직접 실행하지 않습니다. opencode 설정과 일반 opencode Run만 관제합니다.",
    });
  });

  app.get("/api/mcp/config/status", async (_request, response) => {
    const engineStatus = withEngineAuthEvidence(await gateway.agentEngine.getStatus(), store);
    response.json({
      status: buildMcpConfigStatus({
        engineStatus,
        exposeDebugPaths: params.exposeWorkspaceDebugPaths,
      }),
    });
  });

  app.post("/api/mcp/config/validate-snippet", (request, response) => {
    const body = McpSnippetValidateSchema.parse(request.body);
    const result = validateMcpSnippet(body.snippet);
    response.status(result.ok ? 200 : 400).json({ validation: result });
  });

  app.post("/api/mcp/test-run", (request, response) => {
    const body = McpTestRunSchema.parse(request.body);
    const agent = requireAgent(store, response, body.agentId);
    if (!agent) {
      return;
    }
    const conversation =
      body.conversationId
        ? store.getConversation(body.conversationId)
        : store.saveConversation({
            agentId: agent.id,
            title: "MCP 설정 테스트",
            providerKind: agent.providerKind,
            model: agent.model,
            reasoningLevel: agent.reasoningLevel,
          });
    if (!conversation || conversation.agentId !== agent.id) {
      response.status(404).json({ error: "Session not found for agent." });
      return;
    }

    const catalog = body.catalogId ? getMcpCatalogEntry(body.catalogId) : null;
    const targetName = catalog?.name ?? body.serverId ?? "configured MCP";
    const providerKind = conversation.providerKind ?? agent.providerKind;
    const model = conversation.model ?? agent.model;
    const reasoningLevel = normalizeReasoningLevel(
      providerKind,
      model,
      conversation.reasoningLevel ?? agent.reasoningLevel,
    );
    const prompt =
      catalog?.testPrompt ??
      `Check whether the configured ${targetName} MCP capability is available inside opencode. Do not modify files, submit forms, upload data, purchase anything, or delete resources. Summarize what tools are available.`;

    void gateway.taskManager
      .enqueueDetachedTask({
        agentId: agent.id,
        conversationId: conversation.id,
        title: `${targetName} MCP 테스트`,
        prompt,
        providerKind,
        model,
        reasoningLevel,
        startImmediately: body.autoStart,
      })
      .then((task) => {
        response.json({
          task,
          conversation,
          prompt,
          boundary: "AetherOps did not execute MCP directly; this is a normal opencode-backed task.",
        });
      })
      .catch((error) => {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Failed to create MCP test run.",
        });
      });
  });
}
