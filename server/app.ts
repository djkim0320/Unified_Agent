import express from "express";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createAgentGateway } from "./lib/agent-gateway.js";
import { resolveCodexIdentity, importCodexCliAuth } from "./lib/codex-auth.js";
import { createChannelRegistry } from "./lib/channel-registry.js";
import { runCodexLogin, runCodexLoginStatus } from "./lib/codex-cli.js";
import { createDebugLog, redactOpaqueValue } from "./lib/debug-log.js";
import { EngineRunError, isEngineRunError } from "./lib/agent-engine.js";
import { isAbortError } from "./lib/process-control.js";
import { createWorkspaceManager } from "./lib/workspace.js";
import { runOpenCodeOnlyWorkspaceMigration } from "./lib/opencode-only-migration.js";
import { loadOrCreateLocalApiToken } from "./lib/local-api-token.js";
import { createLocalApiAuthMiddleware } from "./middleware/local-api-auth.js";
import { errorHandler, notFound } from "./middleware/error-handler.js";
import { sendLegacyGone } from "./routes/legacy-gone.js";
import { registerPlatformRoutes } from "./routes/platform.routes.js";
import { registerWorkspaceRoutes } from "./routes/workspace.routes.js";
import { createStore, DEFAULT_AGENT_ID, DEFAULT_CONVERSATION_TITLE } from "./db.js";
import { getCuratedModelIds } from "./model-catalog.js";
import {
  buildCapabilitiesByModel,
  getProviderModelCapabilities,
} from "./lib/provider-capabilities.js";
import { getProviderAdapter, providerKinds } from "./provider-registry.js";
import { normalizeReasoningLevel } from "./reasoning-options.js";
import {
  createCodexOAuthStart,
  exchangeCodexAuthorizationCode,
  refreshCodexSecret,
} from "./providers/openai-codex.js";
import type {
  AgentRecord,
  ProviderKind,
  ProviderSecret,
  ProviderSummary,
  TaskFlowRecord,
  TaskFlowStepDetail,
  TaskFlowStepRecord,
  TaskRecord,
  WorkspaceRunRecord,
} from "./types.js";

const ProviderKindSchema = z.enum([
  "openai",
  "anthropic",
  "gemini",
  "ollama",
  "openai-codex",
]);

const ReasoningLevelSchema = z.enum(["minimal", "low", "medium", "high", "xhigh"]);

const ConversationUpsertSchema = z.object({
  conversationId: z.string().uuid().optional(),
  agentId: z.string().min(1).max(120).optional(),
  title: z.string().min(1).max(120).optional(),
  providerKind: ProviderKindSchema.optional(),
  model: z.string().min(1).max(120).optional(),
  reasoningLevel: ReasoningLevelSchema.optional(),
});

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

const SubagentCreateSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  prompt: z.string().min(1).max(20_000),
  providerKind: ProviderKindSchema.optional(),
  model: z.string().min(1).max(120).optional(),
  reasoningLevel: ReasoningLevelSchema.optional(),
});

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
      .max(8),
  })
  .superRefine((flow, context) => {
    if (flow.autoStart && flow.steps.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps"],
        message: "Empty task flows must be created with autoStart=false.",
      });
    }
    const stepKeys = new Set<string>();
    const dependencyByStepKey = new Map<string, string | null | undefined>();
    for (const [index, step] of flow.steps.entries()) {
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
    for (const [index, step] of flow.steps.entries()) {
      if (!step.dependencyStepKey) {
        continue;
      }
      if (step.dependencyStepKey === step.stepKey || !stepKeys.has(step.dependencyStepKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", index, "dependencyStepKey"],
          message: "Dependency must reference another step in the same flow.",
        });
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
        }),
      )
      .min(0)
      .max(8),
  })
  .superRefine((body, context) => {
    const stepKeys = new Set<string>();
    for (const [index, step] of body.steps.entries()) {
      if (stepKeys.has(step.stepKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", index, "stepKey"],
          message: "Step keys must be unique.",
        });
      }
      stepKeys.add(step.stepKey);
    }
  });

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

function toSafeLocalName(value: string, fallback: string) {
  const normalized = value
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

const ApiProviderAccountSchema = z.object({
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
});

const ChatRequestSchema = z.object({
  conversationId: z.string().uuid(),
  providerKind: ProviderKindSchema,
  model: z.string().min(1),
  reasoningLevel: ReasoningLevelSchema,
  message: z.string().min(1),
});

const OpenCodeAuthLoginSchema = z.object({
  provider: z.string().min(1).max(80).optional().default("openai"),
  method: z.string().min(1).max(80).optional().nullable(),
  launch: z.boolean().optional().default(true),
});

function formatProviderSummary(params: {
  kind: ProviderKind;
  label: string;
  configured: boolean;
  status: ProviderSummary["status"];
  displayName?: string | null;
  email?: string | null;
  accountId?: string | null;
  metadata?: Record<string, unknown>;
}): ProviderSummary {
  return {
    kind: params.kind,
    label: params.label,
    configured: params.configured,
    status: params.status,
    displayName: params.displayName ?? null,
    email: params.email ?? null,
    accountId: params.accountId ?? null,
    metadata: params.metadata ?? {},
    capabilities: getProviderModelCapabilities(params.kind, getProviderAdapter(params.kind).defaultModel),
  };
}

function renderOAuthResultPage(params: {
  success: boolean;
  message: string;
  frontendOrigin: string;
}) {
  const payload = JSON.stringify({
    type: "openai-codex-oauth",
    success: params.success,
    message: params.message,
  });

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Codex OAuth</title>
      <style>
        body {
          margin: 0;
          min-height: 100vh;
          display: grid;
          place-items: center;
          background: #10141f;
          color: #f5f7fb;
          font: 16px/1.4 "IBM Plex Sans", "Segoe UI Variable", sans-serif;
        }
        .card {
          width: min(92vw, 480px);
          padding: 24px;
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
        }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>${params.success ? "연결 완료" : "연결 실패"}</h1>
        <p>${params.message}</p>
      </div>
      <script>
        const payload = ${payload};
        if (window.opener) {
          window.opener.postMessage(payload, ${JSON.stringify(params.frontendOrigin)});
        }
        setTimeout(() => window.close(), 250);
      </script>
    </body>
  </html>`;
}

const CODEX_CALLBACK_PATH = "/auth/callback";

export function createApp(options?: {
  dataDir?: string;
  projectRoot?: string;
  port?: number;
  fetchImpl?: typeof fetch;
}) {
  const app = express();
  const projectRoot = options?.projectRoot ?? process.cwd();
  const dataDir = options?.dataDir ?? path.join(projectRoot, ".data");
  const port = options?.port ?? 8787;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const localApiToken = loadOrCreateLocalApiToken(dataDir);
  const opencodeOnlyMigration = runOpenCodeOnlyWorkspaceMigration({ projectRoot, dataDir });
  app.locals.localApiToken = localApiToken;
  app.locals.opencodeOnlyMigration = opencodeOnlyMigration;
  const exposeWorkspaceDebugPaths = process.env.ENABLE_WORKSPACE_DEBUG_PATHS === "true";
  const channelRegistry = createChannelRegistry();
  const store = createStore(dataDir);
  const workspace = createWorkspaceManager(projectRoot, {
    conversationExists: (conversationId) => Boolean(store.getConversation(conversationId)),
    conversationAgentId: (conversationId) => store.getConversation(conversationId)?.agentId ?? null,
    enableRootScope: process.env.ENABLE_WORKSPACE_ROOT_SCOPE === "true",
  });
  const gateway = createAgentGateway({
    projectRoot,
    workspace,
    store,
    resolveSecret: getSecret,
  });
  const codexOAuthDebug = createDebugLog({
    dataDir,
    fileName: "codex-oauth-debug.log",
    namespace: "codex-oauth",
  });
  const oauthStates = new Map<
    string,
    {
      verifier: string;
      frontendOrigin: string;
    }
  >();

  app.use(express.json({ limit: "2mb" }));
  app.use(
    createLocalApiAuthMiddleware({
      token: localApiToken,
      allowedPorts: [port, 5173],
    }),
  );

  registerPlatformRoutes(app, { localApiToken, gateway, channelRegistry });
  app.get("/api/engine/status", async (_request, response) => {
    response.json(await gateway.agentEngine.getStatus());
  });
  app.post("/api/engine/opencode/refresh-models", async (_request, response) => {
    const result = await gateway.agentEngine.refreshModels();
    response.status(result.ok ? 200 : 400).json(result);
  });
  app.post("/api/engine/opencode/auth/login", async (request, response) => {
    const body = OpenCodeAuthLoginSchema.parse(request.body ?? {});
    const result = await gateway.agentEngine.startAuthLogin(body);
    response.status(result.ok ? 200 : 400).json(result);
  });
  app.get("/api/engine/runs/:runId", async (request, response) => {
    const conversationId = z.string().uuid().parse(request.query.conversationId);
    const conversation = requireConversation(response, conversationId);
    if (!conversation) {
      return;
    }
    const engineRun = await gateway.agentEngine.getRunSummary(conversation.id, request.params.runId);
    if (!engineRun) {
      response.status(404).json({ error: "Engine run not found." });
      return;
    }
    response.json({ engineRun });
  });
  app.get(["/health", "/api/health"], (_request, response) => {
    response.json({
      ok: true,
      service: "aetherops",
      timestamp: new Date().toISOString(),
    });
  });
  registerWorkspaceRoutes(app, {
    store,
    workspace,
    taskManager: gateway.taskManager,
    exposeWorkspaceDebugPaths,
  });

  app.use("/api/computer-use", (_request, response) => {
    sendLegacyGone(response, "Custom Computer Use API");
  });

  function requireConversation(
    response: express.Response,
    conversationId: string,
  ) {
    const conversation = store.getConversation(conversationId);
    if (!conversation) {
      response.status(404).json({ error: "Conversation not found" });
      return null;
    }
    return conversation;
  }

  function requireAgent(response: express.Response, agentId: string) {
    const agent = store.getAgent(agentId);
    if (!agent) {
      response.status(404).json({ error: "Agent not found" });
      return null;
    }
    return agent;
  }

  function buildTaskFlowResponse(flow: TaskFlowRecord): { flow: TaskFlowRecord; steps: TaskFlowStepDetail[] } {
    const steps = (store.listTaskFlowSteps?.(flow.id) ?? []).map((step: TaskFlowStepRecord) => {
      const task = step.taskId ? store.getTask(step.taskId) : null;
      const run = task?.runId ? store.getWorkspaceRun(task.runId) : null;
      return {
        ...step,
        task: summarizeFlowTask(task),
        run: summarizeFlowRun(run),
      };
    });
    return {
      flow,
      steps,
    };
  }

  function requireTaskFlow(response: express.Response, flowId: string) {
    const flow = store.getTaskFlow?.(flowId) ?? null;
    if (!flow) {
      response.status(404).json({ error: "Task flow not found" });
      return null;
    }
    return flow;
  }

  function requireTaskFlowStep(response: express.Response, flow: TaskFlowRecord, stepId: string) {
    const step = store.getTaskFlowStep?.(stepId) ?? null;
    if (!step || step.flowId !== flow.id) {
      response.status(404).json({ error: "Task flow step not found" });
      return null;
    }
    return step;
  }

  function requireAutomationRule(response: express.Response, agentId: string, ruleId: string) {
    const rule = store.getAutomationRuleForAgent?.(agentId, ruleId) ?? null;
    if (!rule) {
      response.status(404).json({ error: "Automation rule not found" });
      return null;
    }
    return rule;
  }

  function getProviderSummary(kind: ProviderKind): ProviderSummary {
    const adapter = getProviderAdapter(kind);
    const account = store.getProviderAccount(kind);
    const secret = store.getProviderSecret(kind);
    return formatProviderSummary({
      kind,
      label: adapter.label,
      configured: Boolean(secret),
      status: account?.status ?? "disconnected",
      displayName: account?.displayName,
      email: account?.email,
      accountId: account?.accountId,
      metadata: account?.metadata ?? {},
    });
  }

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
    const agent = requireAgent(response, request.params.agentId);
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
      workspace.deleteAgentWorkspace(agent.id);
    } catch {
      // Agent workspace cleanup is best-effort and anchored to workspace/opencode/agents/<agentId>.
    }
    response.json({ ok: true });
  });

  app.get("/api/agents/:agentId/memory", (_request, response) => {
    sendLegacyGone(response, "AetherOps internal memory");
  });

  app.post("/api/agents/:agentId/memory", (_request, response) => {
    sendLegacyGone(response, "AetherOps internal memory");
  });

  app.get("/api/agents/:agentId/memory/search", (_request, response) => {
    sendLegacyGone(response, "AetherOps internal memory search");
  });

  app.get("/api/agents/:agentId/skills", (_request, response) => {
    sendLegacyGone(response, "AetherOps skill/plugin execution");
  });

  app.post("/api/agents/:agentId/skills", (_request, response) => {
    sendLegacyGone(response, "AetherOps skill/plugin execution");
  });

  app.get("/api/agents/:agentId/soul", (request, response) => {
    const agent = requireAgent(response, request.params.agentId);
    if (!agent) {
      return;
    }
    response.json({
      soul: workspace.readAgentSoul(agent.id),
    });
  });

  app.put("/api/agents/:agentId/soul", (request, response) => {
    const agent = requireAgent(response, request.params.agentId);
    if (!agent) {
      return;
    }
    const body = AgentSoulWriteSchema.parse(request.body);
    response.json({
      soul: workspace.writeAgentSoul(agent.id, body.content),
    });
  });

  app.get("/api/agents/:agentId/standing-orders", (request, response) => {
    const agent = requireAgent(response, request.params.agentId);
    if (!agent) {
      return;
    }
    response.json({
      standingOrders: workspace.readAgentStandingOrders(agent.id),
    });
  });

  app.put("/api/agents/:agentId/standing-orders", (request, response) => {
    const agent = requireAgent(response, request.params.agentId);
    if (!agent) {
      return;
    }
    const body = AgentStandingOrdersWriteSchema.parse(request.body);
    response.json({
      standingOrders: workspace.writeAgentStandingOrders(agent.id, body.content),
    });
  });

  app.get("/api/agents/:agentId/heartbeat", (request, response) => {
    const agent = requireAgent(response, request.params.agentId);
    if (!agent) {
      return;
    }
    response.json({
      heartbeat: workspace.readAgentHeartbeat(agent.id),
    });
  });

  app.put("/api/agents/:agentId/heartbeat", (request, response) => {
    const agent = requireAgent(response, request.params.agentId);
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
    const agent = requireAgent(response, request.params.agentId);
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
      });
  });

  app.get("/api/agents/:agentId/heartbeat/logs", (request, response) => {
    const agent = requireAgent(response, request.params.agentId);
    if (!agent) {
      return;
    }
    response.json({
      logs: store.listHeartbeatLogs(agent.id),
    });
  });

  app.get("/api/agents/:agentId/automation-rules", (request, response) => {
    const agent = requireAgent(response, request.params.agentId);
    if (!agent) {
      return;
    }
    response.json({
      rules: store.listAutomationRules?.(agent.id) ?? [],
    });
  });

  app.post("/api/agents/:agentId/automation-rules", (request, response) => {
    const agent = requireAgent(response, request.params.agentId);
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
    const agent = requireAgent(response, request.params.agentId);
    if (!agent) {
      return;
    }
    if (!requireAutomationRule(response, agent.id, request.params.ruleId)) {
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
    const agent = requireAgent(response, request.params.agentId);
    if (!agent) {
      return;
    }
    if (!requireAutomationRule(response, agent.id, request.params.ruleId)) {
      return;
    }
    response.json({
      ok: store.deleteAutomationRule(agent.id, request.params.ruleId),
      ruleId: request.params.ruleId,
    });
  });

  app.post("/api/agents/:agentId/automation-rules/:ruleId/trigger", (request, response) => {
    const agent = requireAgent(response, request.params.agentId);
    if (!agent) {
      return;
    }
    const rule = requireAutomationRule(response, agent.id, request.params.ruleId);
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
        rule: result.rule,
        task: result.task,
      });
      return;
    }
    void gateway.taskManager.runTask(result.task.id);
    response.json({
      rule: result.rule,
      task: result.task,
      message: "자동화 규칙을 즉시 실행했습니다.",
    });
  });

  app.get("/api/agents/:agentId/tasks", (request, response) => {
    const agent = requireAgent(response, request.params.agentId);
    if (!agent) {
      return;
    }
    response.json({
      tasks: store.listTasks(agent.id),
    });
  });

  app.get("/api/agents/:agentId/flows", (request, response) => {
    const agent = requireAgent(response, request.params.agentId);
    if (!agent) {
      return;
    }
    response.json({
      flows: store.listTaskFlows?.(agent.id) ?? [],
    });
  });

  app.post("/api/agents/:agentId/flows", (request, response) => {
    const agent = requireAgent(response, request.params.agentId);
    if (!agent) {
      return;
    }
    const parsedBody = TaskFlowCreateSchema.safeParse(request.body);
    if (!parsedBody.success) {
      response.status(400).json({
        error: "Invalid task flow request.",
        details: parsedBody.error.flatten(),
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
        response.json(buildTaskFlowResponse(result.flow));
      })
      .catch((error) => {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Failed to create task flow.",
        });
      });
  });

  app.get("/api/flows/:flowId", (request, response) => {
    const flow = requireTaskFlow(response, request.params.flowId);
    if (!flow) {
      return;
    }
    response.json(buildTaskFlowResponse(flow));
  });

  app.put("/api/flows/:flowId/steps", (request, response) => {
    const flow = requireTaskFlow(response, request.params.flowId);
    if (!flow) {
      return;
    }
    if (flow.status !== "queued") {
      response.status(409).json({ error: "Only queued task flows can be edited." });
      return;
    }
    const existingSteps = store.listTaskFlowSteps?.(flow.id) ?? [];
    if (existingSteps.some((step) => step.taskId)) {
      response.status(409).json({ error: "Task flow steps with task audit records cannot be edited." });
      return;
    }
    const parsedBody = TaskFlowStepsReplaceSchema.safeParse(request.body);
    if (!parsedBody.success) {
      response.status(400).json({
        error: "Invalid task flow steps request.",
        details: parsedBody.error.flatten(),
      });
      return;
    }
    if (!store.replaceTaskFlowSteps) {
      response.status(500).json({ error: "Task flow step editing is unavailable." });
      return;
    }

    store.replaceTaskFlowSteps(
      flow.id,
      parsedBody.data.steps.map((step, index, steps) => ({
        stepKey: step.stepKey,
        title: step.title,
        prompt: step.prompt,
        dependencyStepKey: index > 0 ? steps[index - 1].stepKey : null,
        position: index,
      })),
      parsedBody.data.title,
    );
    const updatedFlow = store.getTaskFlow?.(flow.id) ?? flow;
    response.json(buildTaskFlowResponse(updatedFlow));
  });

  app.delete("/api/flows/:flowId", (request, response) => {
    const flow = requireTaskFlow(response, request.params.flowId);
    if (!flow) {
      return;
    }
    if (flow.status === "running") {
      response.status(409).json({ error: "Running task flows cannot be deleted." });
      return;
    }
    if (!store.deleteTaskFlow) {
      response.status(500).json({ error: "Task flow deletion is unavailable." });
      return;
    }
    const deleted = store.deleteTaskFlow(flow.id);
    if (!deleted) {
      response.status(404).json({ error: "Task flow not found" });
      return;
    }
    response.json({ ok: true, flowId: flow.id });
  });

  app.post("/api/flows/:flowId/cancel", (request, response) => {
    const flow = requireTaskFlow(response, request.params.flowId);
    if (!flow) {
      return;
    }
    void gateway.taskManager
      .cancelTaskFlow(flow.id)
      .then((updated) => {
        response.json(updated ? buildTaskFlowResponse(updated) : { flow: null, steps: [] });
      })
      .catch((error) => {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Failed to cancel task flow.",
        });
      });
  });

  app.post("/api/flows/:flowId/start", (request, response) => {
    const flow = requireTaskFlow(response, request.params.flowId);
    if (!flow) {
      return;
    }
    if ((store.listTaskFlowSteps?.(flow.id) ?? []).length === 0) {
      response.status(409).json({ error: "Task flow requires at least one step before it can start." });
      return;
    }
    void gateway.taskManager
      .startTaskFlow(flow.id)
      .then((updated) => {
        const nextFlow = updated ?? store.getTaskFlow?.(flow.id) ?? flow;
        response.json(buildTaskFlowResponse(nextFlow));
      })
      .catch((error) => {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Failed to start task flow.",
        });
      });
  });

  app.post("/api/flows/:flowId/resume", (request, response) => {
    const flow = requireTaskFlow(response, request.params.flowId);
    if (!flow) {
      return;
    }
    void gateway.taskManager
      .resumeTaskFlow(flow.id)
      .then((updated) => {
        const nextFlow = updated ?? store.getTaskFlow?.(flow.id) ?? flow;
        response.json(buildTaskFlowResponse(nextFlow));
      })
      .catch((error) => {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Failed to resume task flow.",
        });
      });
  });

  app.post("/api/flows/:flowId/steps/:stepId/retry", (request, response) => {
    const flow = requireTaskFlow(response, request.params.flowId);
    if (!flow || !requireTaskFlowStep(response, flow, request.params.stepId)) {
      return;
    }
    void gateway.taskManager
      .retryTaskFlowStep(flow.id, request.params.stepId)
      .then((updated) => {
        const nextFlow = updated ?? store.getTaskFlow?.(flow.id) ?? flow;
        response.json(buildTaskFlowResponse(nextFlow));
      })
      .catch((error) => {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Failed to retry task flow step.",
        });
      });
  });

  app.post("/api/flows/:flowId/steps/:stepId/skip", (request, response) => {
    const flow = requireTaskFlow(response, request.params.flowId);
    if (!flow || !requireTaskFlowStep(response, flow, request.params.stepId)) {
      return;
    }
    void gateway.taskManager
      .skipTaskFlowStep(flow.id, request.params.stepId)
      .then((updated) => {
        const nextFlow = updated ?? store.getTaskFlow?.(flow.id) ?? flow;
        response.json(buildTaskFlowResponse(nextFlow));
      })
      .catch((error) => {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Failed to skip task flow step.",
        });
      });
  });

  app.post("/api/agents/:agentId/tasks", (request, response) => {
    const agent = requireAgent(response, request.params.agentId);
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

  async function getSecret(kind: ProviderKind) {
    const secret = store.getProviderSecret(kind);
    if (kind !== "openai-codex" || !secret) {
      return secret;
    }

    const codexSecret = secret as ProviderSecret<"openai-codex">;
    const refreshed = await refreshCodexSecret(codexSecret, fetchImpl);
    if (JSON.stringify(refreshed) !== JSON.stringify(secret)) {
      const existingAccount = store.getProviderAccount(kind);
      const identity = resolveCodexIdentity({
        accessToken: refreshed.accessToken,
        idToken: refreshed.idToken ?? null,
        email: existingAccount?.email ?? null,
      });
      store.saveProviderConfiguration({
        kind,
        secret: refreshed,
        status: "connected",
        displayName: identity.profileName,
        email: identity.email,
        accountId: refreshed.chatgptAccountId ?? identity.accountId,
        metadata: {
          importedFromCli: Boolean(refreshed.importedFromCli),
        },
      });
    }
    return refreshed;
  }

  app.get("/api/providers", (_request, response) => {
    response.json({
      providers: providerKinds.map((kind) => getProviderSummary(kind)),
    });
  });

  app.put("/api/providers/:kind/account", (request, response) => {
    const kind = ProviderKindSchema.parse(request.params.kind);
    if (kind === "openai-codex") {
      response.status(400).json({
        error: "Use the Codex OAuth or import endpoints instead.",
      });
      return;
    }

    const body = ApiProviderAccountSchema.parse(request.body);
    if (kind === "ollama") {
      if (!body.baseUrl) {
        response.status(400).json({ error: "baseUrl is required for Ollama" });
        return;
      }
      store.saveProviderConfiguration({
        kind,
        secret: {
          baseUrl: body.baseUrl,
        },
        status: "configured",
        displayName: "Local Ollama",
        metadata: {
          baseUrl: body.baseUrl,
        },
      });
      response.json({ provider: getProviderSummary(kind) });
      return;
    }

    if (!body.apiKey) {
      response.status(400).json({ error: "apiKey is required" });
      return;
    }

    store.saveProviderConfiguration({
      kind,
      secret: {
        apiKey: body.apiKey,
      } as never,
      status: "configured",
      displayName: getProviderAdapter(kind).label,
      metadata: {},
    });
    response.json({ provider: getProviderSummary(kind) });
  });

  app.get("/api/providers/:kind/models", async (request, response) => {
    const kind = ProviderKindSchema.parse(request.params.kind);
    const adapter = getProviderAdapter(kind);
    const secret = await getSecret(kind);

    try {
      let liveModels: string[] | null = null;

      if (secret) {
        try {
          liveModels = await adapter.listModels(secret as never);
        } catch {
          liveModels = null;
        }
      }

      const models = getCuratedModelIds(kind, liveModels);
      response.json({
        models,
        capabilitiesByModel: buildCapabilitiesByModel(kind, models),
      });
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : "Failed to load models",
      });
    }
  });

  app.post("/api/providers/:kind/test", async (request, response) => {
    const kind = ProviderKindSchema.parse(request.params.kind);
    const adapter = getProviderAdapter(kind);
    const result = await adapter.testConnection((await getSecret(kind)) as never);
    response.status(result.ok ? 200 : 400).json(result);
  });

  app.post("/api/providers/openai-codex/oauth/start", (request, response) => {
    if (request.body?.mode === "official-cli") {
      void (async () => {
        try {
          const status = await runCodexLoginStatus(process.cwd());
          if (!status.summary.toLowerCase().includes("logged in")) {
            codexOAuthDebug.append("oauth_cli_login_started", {
              mode: "official-cli",
            });
            await runCodexLogin(process.cwd());
            codexOAuthDebug.append("oauth_cli_login_completed", {
              mode: "official-cli",
            });
          } else {
            codexOAuthDebug.append("oauth_cli_login_reused_existing_session", {
              mode: "official-cli",
              summary: status.summary,
            });
          }

          const imported = importCodexCliAuth();
          const identity = resolveCodexIdentity({
            accessToken: imported.accessToken,
            idToken: imported.idToken ?? null,
          });
          store.saveProviderConfiguration({
            kind: "openai-codex",
            secret: {
              accessToken: imported.accessToken,
              refreshToken: imported.refreshToken,
              idToken: imported.idToken,
              expiresAt: imported.expiresAt,
              chatgptAccountId: imported.accountId,
              importedFromCli: true,
              sourcePath: imported.sourcePath,
              lastRefresh: imported.lastRefresh,
            },
            status: "connected",
            displayName: identity.profileName,
            email: identity.email,
            accountId: imported.accountId ?? identity.accountId,
        metadata: {
          importedFromCli: true,
          loginManagedBy: "official-cli",
        },
          });

          response.json({
            provider: getProviderSummary("openai-codex"),
            message: "공식 Codex CLI를 통해 Codex OAuth 연결을 완료했습니다.",
          });
        } catch (error) {
          codexOAuthDebug.append("oauth_cli_login_failed", {
            mode: "official-cli",
            message: error instanceof Error ? error.message : "Codex login failed",
          });
          response.status(400).json({
            error: error instanceof Error ? error.message : "Codex login failed.",
          });
        }
      })();
      return;
    }

    const frontendOrigin =
      (typeof request.body?.frontendOrigin === "string" && request.body.frontendOrigin) ||
      request.headers.origin ||
      "http://localhost:5173";
    const redirectUri = `http://localhost:${port}${CODEX_CALLBACK_PATH}`;
    const start = createCodexOAuthStart({
      redirectUri,
      frontendOrigin,
      allowedWorkspaceId:
        store.getProviderAccount("openai-codex")?.accountId ??
        (() => {
          try {
            return importCodexCliAuth().accountId;
          } catch {
            return null;
          }
        })(),
    });
    oauthStates.set(start.state, {
      verifier: start.verifier,
      frontendOrigin: start.frontendOrigin,
    });
    codexOAuthDebug.append("oauth_start", {
      redirectUri,
      frontendOrigin: start.frontendOrigin,
      requestOrigin: typeof request.headers.origin === "string" ? request.headers.origin : null,
      state: redactOpaqueValue(start.state),
      verifier: redactOpaqueValue(start.verifier),
    });
    response.json({ authUrl: start.authUrl });
  });

  app.get("/api/providers/openai-codex/debug/logs", (_request, response) => {
    response.json({
      entries: codexOAuthDebug.list(),
      hasLogFile: true,
    });
  });

  async function handleCodexOAuthCallback(
    request: express.Request,
    response: express.Response,
  ) {
    const state = typeof request.query.state === "string" ? request.query.state : "";
    const code = typeof request.query.code === "string" ? request.query.code : "";
    const error = typeof request.query.error === "string" ? request.query.error : "";
    const errorDescription =
      typeof request.query.error_description === "string"
        ? request.query.error_description
        : "";
    const stateEntry = oauthStates.get(state);
    const frontendOrigin = stateEntry?.frontendOrigin ?? "http://127.0.0.1:5173";
    codexOAuthDebug.append("oauth_callback_received", {
      route: request.path,
      state: redactOpaqueValue(state),
      stateMatched: Boolean(stateEntry),
      codePresent: Boolean(code),
      error: error || null,
      errorDescription: errorDescription || null,
      queryKeys: Object.keys(request.query).sort(),
    });
    oauthStates.delete(state);

    if (!stateEntry) {
      response.status(400).send(
        renderOAuthResultPage({
          success: false,
          message: "OAuth state has expired. Please try again.",
          frontendOrigin,
        }),
      );
      return;
    }

    if (error) {
      response.send(
        renderOAuthResultPage({
          success: false,
          message: `OAuth request failed: ${error}`,
          frontendOrigin,
        }),
      );
      return;
    }

    try {
      const redirectUri = `http://localhost:${port}${CODEX_CALLBACK_PATH}`;
      const tokens = await exchangeCodexAuthorizationCode({
        code,
        verifier: stateEntry.verifier,
        redirectUri,
        fetchImpl,
      });
      codexOAuthDebug.append("oauth_token_exchange_succeeded", {
        state: redactOpaqueValue(state),
        accessToken: redactOpaqueValue(tokens.accessToken),
        refreshToken: redactOpaqueValue(tokens.refreshToken),
        expiresAt: tokens.expiresAt,
      });
      const identity = resolveCodexIdentity({
        accessToken: tokens.accessToken,
        idToken: tokens.idToken ?? null,
      });
      store.saveProviderConfiguration({
        kind: "openai-codex",
        secret: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          idToken: tokens.idToken,
          expiresAt: tokens.expiresAt,
          chatgptAccountId: tokens.chatgptAccountId,
          sourcePath: null,
          lastRefresh: tokens.lastRefresh ?? new Date().toISOString(),
        },
        status: "connected",
        displayName: identity.profileName,
        email: identity.email,
        accountId: tokens.chatgptAccountId ?? identity.accountId,
      });
      response.send(
        renderOAuthResultPage({
          success: true,
          message: "Codex account connected successfully.",
          frontendOrigin,
        }),
      );
    } catch (callbackError) {
      response.status(500).send(
        renderOAuthResultPage({
          success: false,
          message:
            callbackError instanceof Error
              ? callbackError.message
              : "OAuth callback failed.",
          frontendOrigin,
        }),
      );
      codexOAuthDebug.append("oauth_token_exchange_failed", {
        state: redactOpaqueValue(state),
        message:
          callbackError instanceof Error ? callbackError.message : "OAuth callback failed",
      });
    }
  }

  app.get("/api/providers/openai-codex/oauth/callback", handleCodexOAuthCallback);
  app.get(CODEX_CALLBACK_PATH, handleCodexOAuthCallback);

  app.post("/api/providers/openai-codex/import-cli-auth", (_request, response) => {
    try {
      const imported = importCodexCliAuth();
      const identity = resolveCodexIdentity({
        accessToken: imported.accessToken,
        idToken: imported.idToken ?? null,
      });
      store.saveProviderConfiguration({
        kind: "openai-codex",
        secret: {
          accessToken: imported.accessToken,
          refreshToken: imported.refreshToken,
          idToken: imported.idToken,
          expiresAt: imported.expiresAt,
          chatgptAccountId: imported.accountId,
          importedFromCli: true,
          sourcePath: imported.sourcePath,
          lastRefresh: imported.lastRefresh,
        },
        status: "connected",
        displayName: identity.profileName,
        email: identity.email,
        accountId: identity.accountId ?? imported.accountId,
        metadata: {
          importedFromCli: true,
        },
      });
      response.json({
        provider: getProviderSummary("openai-codex"),
      });
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : "Failed to import Codex CLI auth.",
      });
    }
  });

  app.post("/api/providers/openai-codex/logout", (_request, response) => {
    store.clearProvider("openai-codex");
    response.json({ ok: true });
  });

  app.get("/api/conversations", (request, response) => {
    const agentId = typeof request.query.agentId === "string" ? request.query.agentId : undefined;
    if (agentId && !requireAgent(response, agentId)) {
      return;
    }
    response.json({
      conversations: store.listConversations(agentId),
    });
  });

  app.post("/api/conversations", (request, response) => {
    const body = ConversationUpsertSchema.parse(request.body);
    const existing = body.conversationId ? store.getConversation(body.conversationId) : null;
    const agentId = body.agentId ?? existing?.agentId ?? DEFAULT_AGENT_ID;
    const agent = requireAgent(response, agentId);
    if (!agent) {
      return;
    }
    const providerKind = body.providerKind ?? existing?.providerKind ?? agent.providerKind;
    const model = body.model ?? existing?.model ?? agent.model ?? getProviderAdapter(providerKind).defaultModel;
    const reasoningLevel = normalizeReasoningLevel(
      providerKind,
      model,
      body.reasoningLevel ?? existing?.reasoningLevel ?? agent.reasoningLevel,
    );
    const normalizedConversationTitle = body.title ?? existing?.title ?? DEFAULT_CONVERSATION_TITLE;
    const conversation = store.saveConversation({
      id: body.conversationId,
      agentId: agent.id,
      channelKind: channelRegistry.getDefaultChannel().kind,
      title: normalizedConversationTitle,
      providerKind,
      model,
      reasoningLevel,
    });
    store.saveAgent({
      id: agent.id,
      name: agent.name,
      providerKind,
      model,
      reasoningLevel,
    });
    workspace.createAgentWorkspace(agent.id);
    workspace.createConversationWorkspace(conversation.id);
    response.json({ conversation });
  });

  app.get("/api/conversations/:id/messages", (request, response) => {
    const conversation = store.getConversation(request.params.id);
    if (!conversation) {
      response.status(404).json({ error: "Conversation not found" });
      return;
    }
    response.json({
      conversation,
      messages: store.listMessages(conversation.id),
    });
  });

  app.delete("/api/conversations/:id", async (request, response) => {
    const conversation = store.getConversation(request.params.id);
    if (!conversation) {
      response.status(404).json({ error: "Conversation not found" });
      return;
    }
    try {
      workspace.deleteConversationWorkspace(conversation.id);
    } catch {
      // Workspace cleanup is best-effort, but deleteConversationWorkspace is scoped to this sandbox only.
    }
    const deleted = store.deleteConversation(conversation.id);
    if (!deleted) {
      response.status(404).json({ error: "Conversation not found" });
      return;
    }
    response.json({ ok: true });
  });

  app.get("/api/sessions/:sessionId/subagents", (request, response) => {
    const parentConversation = requireConversation(response, request.params.sessionId);
    if (!parentConversation) {
      return;
    }
    response.json({
      sessions: store.listConversations(parentConversation.agentId, {
        sessionKind: "subagent",
        parentConversationId: parentConversation.id,
      }),
    });
  });

  app.post("/api/sessions/:sessionId/subagents", (request, response) => {
    const parentConversation = requireConversation(response, request.params.sessionId);
    if (!parentConversation) {
      return;
    }
    const body = SubagentCreateSchema.parse(request.body);
    const providerKind = body.providerKind ?? parentConversation.providerKind;
    const model = body.model ?? parentConversation.model;
    const reasoningLevel = normalizeReasoningLevel(
      providerKind,
      model,
      body.reasoningLevel ?? parentConversation.reasoningLevel,
    );
    const parentRun = store.listWorkspaceRuns(parentConversation.id)[0] ?? null;
    if (!parentRun) {
      response.status(409).json({ error: "A parent run must exist before spawning a sub-agent session." });
      return;
    }

    void gateway
      .spawnSubagentSession({
        agentId: parentConversation.agentId,
        parentConversationId: parentConversation.id,
        parentRunId: parentRun.id,
        prompt: body.prompt,
        title: body.title,
        providerKind,
        model,
        reasoningLevel,
      })
      .then((result) => {
        response.json(result);
      })
      .catch((error) => {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Failed to spawn sub-agent session.",
        });
      });
  });

  app.post("/api/subagents/:sessionId/cancel", (request, response) => {
    const childConversation = requireConversation(response, request.params.sessionId);
    if (!childConversation) {
      return;
    }
    if (childConversation.sessionKind !== "subagent") {
      response.status(400).json({ error: "Session is not a sub-agent session." });
      return;
    }
    const activeTask =
      store
        .listTasks(childConversation.agentId)
        .find(
          (task) =>
            task.conversationId === childConversation.id &&
            (task.status === "queued" || task.status === "running"),
        ) ?? null;

    if (!activeTask) {
      response.json({ ok: true, task: null });
      return;
    }

    void gateway.taskManager
      .cancelTask(activeTask.id)
      .then((task) => {
        response.json({ ok: true, task });
      })
      .catch((error) => {
        response.status(400).json({
          error: error instanceof Error ? error.message : "Failed to cancel sub-agent task.",
        });
      });
  });

  app.post("/api/chat/stream", async (request, response) => {
    const body = ChatRequestSchema.parse(request.body);
    const conversation = requireConversation(response, body.conversationId);
    if (!conversation) {
      return;
    }

    const normalizedReasoningLevel = normalizeReasoningLevel(
      body.providerKind,
      body.model,
      body.reasoningLevel,
    );

    store.saveConversation({
      id: conversation.id,
      agentId: conversation.agentId,
      channelKind: conversation.channelKind ?? channelRegistry.getDefaultChannel().kind,
      title: conversation.title,
      providerKind: body.providerKind,
      model: body.model,
      reasoningLevel: normalizedReasoningLevel,
    });
    const agent = store.getAgent(conversation.agentId);
    if (agent) {
      store.saveAgent({
        id: agent.id,
        name: agent.name,
        providerKind: body.providerKind,
        model: body.model,
        reasoningLevel: normalizedReasoningLevel,
      });
    }
    store.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: body.message,
    });
    store.ensureConversationTitle(conversation.id, body.message);
    workspace.createAgentWorkspace(conversation.agentId);
    workspace.createConversationWorkspace(conversation.id);

    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();

    const abortController = new AbortController();
    let streamFinished = false;
    const closeHandler = () => {
      if (!streamFinished) {
        abortController.abort(new EngineRunError("Client disconnected.", "cancelled"));
      }
    };
    request.on("aborted", closeHandler);
    response.on("close", closeHandler);

    const sendEvent = (eventName: string, payload: Record<string, unknown>) => {
      if (response.destroyed || response.writableEnded) {
        return;
      }
      response.write(`event: ${eventName}\n`);
      response.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const runtimeResult = await gateway.runForegroundTurn({
        providerKind: body.providerKind,
        model: body.model,
        reasoningLevel: normalizedReasoningLevel,
        conversationId: conversation.id,
        userMessage: body.message,
        sendEvent,
        signal: abortController.signal,
        unsafeShellEnabled: process.env.ENABLE_UNSAFE_WORKSPACE_EXEC === "true",
      });

      if (abortController.signal.aborted) {
        return;
      }

      if (runtimeResult.assistantText.trim()) {
        const saved = store.appendMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: runtimeResult.assistantText,
        });
        sendEvent("done", {
          messageId: saved.id,
          runId: runtimeResult.runId,
          changedFiles: runtimeResult.changedFiles,
        });
      } else {
        sendEvent("done", {
          messageId: null,
          runId: runtimeResult.runId,
          changedFiles: runtimeResult.changedFiles,
        });
      }
    } catch (error) {
      const status =
        isEngineRunError(error)
          ? error.status
          : isAbortError(error)
            ? "cancelled"
            : "failed";
      sendEvent("error", {
        error: error instanceof Error ? error.message : "Streaming failed",
        runId: isEngineRunError(error) ? error.runId : undefined,
        status,
      });
    } finally {
      streamFinished = true;
      request.off("aborted", closeHandler);
      response.off("close", closeHandler);
      if (!response.destroyed && !response.writableEnded) {
        response.end();
      }
    }
  });

  app.use("/api", notFound);
  app.use(errorHandler);

  const clientDir = path.join(process.cwd(), "dist", "client");
  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir));
    app.get(/^(?!\/api(?:\/|$)).*/, (_request, response) => {
      response.sendFile(path.join(clientDir, "index.html"));
    });
  }

  return {
    app,
    store,
    workspace,
    gateway,
  };
}
