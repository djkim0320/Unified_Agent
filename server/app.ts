import express from "express";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createAgentGateway } from "./lib/agent-gateway.js";
import { createChannelRegistry } from "./lib/channel-registry.js";
import { createDebugLog } from "./lib/debug-log.js";
import { withEngineAuthEvidence } from "./lib/engine-auth-evidence.js";
import { EngineRunError, isEngineRunError } from "./lib/agent-engine.js";
import { isAbortError } from "./lib/process-control.js";
import { createProviderSecretResolver } from "./lib/provider-secret-resolver.js";
import { createWorkspaceManager } from "./lib/workspace.js";
import { runOpenCodeOnlyWorkspaceMigration } from "./lib/opencode-only-migration.js";
import { loadOrCreateLocalApiToken } from "./lib/local-api-token.js";
import { createLocalApiAuthMiddleware } from "./middleware/local-api-auth.js";
import { errorHandler, notFound } from "./middleware/error-handler.js";
import { sendLegacyGone } from "./routes/legacy-gone.js";
import { registerAgentsRoutes } from "./routes/agents.routes.js";
import { registerAutomationRoutes } from "./routes/automation.routes.js";
import { registerConversationsRoutes } from "./routes/conversations.routes.js";
import { requireConversation } from "./routes/context.js";
import { registerMcpRoutes } from "./routes/mcp.routes.js";
import { registerPlatformRoutes } from "./routes/platform.routes.js";
import { registerProvidersRoutes } from "./routes/providers.routes.js";
import { registerSkillTemplateRoutes } from "./routes/skill-templates.routes.js";
import { registerSearchRoutes } from "./routes/search.routes.js";
import { registerTaskFlowRoutes } from "./routes/task-flows.routes.js";
import { registerTasksRoutes } from "./routes/tasks.routes.js";
import { registerWorkspaceRoutes } from "./routes/workspace.routes.js";
import { createStore } from "./db.js";
import { normalizeReasoningLevel } from "./reasoning-options.js";
import { ProviderKindSchema, ReasoningLevelSchema } from "./schemas/common.js";

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

const PreflightQuerySchema = z.object({
  agentId: z.string().min(1).max(120).optional(),
  conversationId: z.string().uuid().optional(),
});

type PreflightCheck = {
  id: string;
  label: string;
  status: "ok" | "warn" | "error";
  message: string;
};

function checkOk(id: string, label: string, message: string): PreflightCheck {
  return { id, label, status: "ok", message };
}

function checkWarn(id: string, label: string, message: string): PreflightCheck {
  return { id, label, status: "warn", message };
}

function checkError(id: string, label: string, message: string): PreflightCheck {
  return { id, label, status: "error", message };
}

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
  const localApiAllowedPorts = [port, 5173];
  const fetchImpl = options?.fetchImpl ?? fetch;
  const localApiToken = loadOrCreateLocalApiToken(dataDir);
  const opencodeOnlyMigration = runOpenCodeOnlyWorkspaceMigration({ projectRoot, dataDir });
  app.locals.localApiToken = localApiToken;
  app.locals.opencodeOnlyMigration = opencodeOnlyMigration;

  const exposeWorkspaceDebugPaths = process.env.ENABLE_WORKSPACE_DEBUG_PATHS === "true";
  const channelRegistry = createChannelRegistry();
  const store = createStore(dataDir);
  const startupRecovery = store.recoverStaleRunningWork();
  app.locals.startupRecovery = startupRecovery;
  const resolveSecret = createProviderSecretResolver({ store, fetchImpl });
  const workspace = createWorkspaceManager(projectRoot, {
    conversationExists: (conversationId) => Boolean(store.getConversation(conversationId)),
    conversationAgentId: (conversationId) => store.getConversation(conversationId)?.agentId ?? null,
    enableRootScope: process.env.ENABLE_WORKSPACE_ROOT_SCOPE === "true",
  });
  const gateway = createAgentGateway({
    projectRoot,
    workspace,
    store,
    resolveSecret,
  });
  const codexOAuthDebug = createDebugLog({
    dataDir,
    fileName: "codex-oauth-debug.log",
    namespace: "codex-oauth",
  });

  app.use(express.json({ limit: "2mb" }));
  app.use(
    createLocalApiAuthMiddleware({
      token: localApiToken,
      allowedPorts: localApiAllowedPorts,
    }),
  );

  registerPlatformRoutes(app, { localApiToken, gateway, channelRegistry });
  app.get("/api/engine/status", async (_request, response) => {
    response.json(withEngineAuthEvidence(await gateway.agentEngine.getStatus(), store));
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
    const conversation = requireConversation(store, response, conversationId);
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

  app.get("/api/preflight", async (request, response) => {
    const query = PreflightQuerySchema.parse(request.query);
    const checks: PreflightCheck[] = [
      checkOk("backend", "Backend", "AetherOps 백엔드가 응답 중입니다."),
    ];

    const agent = query.agentId ? store.getAgent(query.agentId) : null;
    if (!query.agentId) {
      checks.push(checkWarn("agent", "Agent", "선택된 에이전트가 없습니다."));
    } else if (!agent) {
      checks.push(checkError("agent", "Agent", "선택한 에이전트를 찾을 수 없습니다."));
    } else {
      checks.push(checkOk("agent", "Agent", `${agent.name} 에이전트를 사용할 수 있습니다.`));
    }

    const conversation = query.conversationId ? store.getConversation(query.conversationId) : null;
    if (!query.conversationId) {
      checks.push(checkWarn("conversation", "Session", "선택된 채팅 세션이 없습니다."));
    } else if (!conversation) {
      checks.push(checkError("conversation", "Session", "선택한 채팅 세션을 찾을 수 없습니다."));
    } else if (agent && conversation.agentId !== agent.id) {
      checks.push(checkError("conversation", "Session", "세션이 선택한 에이전트에 속하지 않습니다."));
    } else {
      checks.push(checkOk("conversation", "Session", "채팅 세션이 준비되어 있습니다."));
    }

    let engineStatus: Awaited<ReturnType<typeof gateway.agentEngine.getStatus>> | null = null;
    try {
      engineStatus = withEngineAuthEvidence(await gateway.agentEngine.getStatus(), store, {
        providerKind: agent?.providerKind ?? conversation?.providerKind ?? null,
        model: agent?.model ?? conversation?.model ?? null,
      });
      checks.push(
        engineStatus.available
          ? checkOk("opencode", "opencode", `opencode 엔진 사용 가능${engineStatus.version ? ` (${engineStatus.version})` : ""}.`)
          : checkError("opencode", "opencode", engineStatus.lastFailure ?? "opencode 엔진을 사용할 수 없습니다."),
      );
      checks.push(
        engineStatus.authEvidence?.status === "usable"
          ? checkOk("opencode-auth", "opencode auth", "opencode 인증 상태가 사용 가능합니다.")
          : checkWarn("opencode-auth", "opencode auth", "opencode 인증 상태가 확인되지 않았습니다. API 프로필 또는 OAuth 설정을 확인하세요."),
      );
      if (engineStatus.authEvidence) {
        checks.push(
          engineStatus.authEvidence.status === "usable"
            ? checkOk("opencode-auth-detail", "Auth evidence", engineStatus.authEvidence.message)
            : engineStatus.authEvidence.status === "blocked"
              ? checkError("opencode-auth-detail", "Auth evidence", engineStatus.authEvidence.message)
              : checkWarn("opencode-auth-detail", "Auth evidence", engineStatus.authEvidence.message),
        );
      }
      if (engineStatus.environment.autoApprovePermissions) {
        checks.push(
          checkWarn(
            "dangerous-auto-approve",
            "Permission mode",
            "위험 권한 자동 승인 플래그가 켜져 있습니다. 로컬 테스트 외에는 비활성화를 권장합니다.",
          ),
        );
      } else {
        checks.push(checkOk("dangerous-auto-approve", "Permission mode", "위험 권한 자동 승인이 꺼져 있습니다."));
      }
    } catch (error) {
      checks.push(
        checkError(
          "opencode",
          "opencode",
          error instanceof Error ? error.message : "opencode 상태 확인 중 오류가 발생했습니다.",
        ),
      );
    }

    if (agent) {
      const configuredProvider = Boolean(store.getProviderAccount(agent.providerKind) || store.getProviderSecret(agent.providerKind));
      const opencodeAuthAvailable = engineStatus?.authEvidence?.status === "usable";
      if (configuredProvider || opencodeAuthAvailable) {
        checks.push(checkOk("provider", "Provider", `${agent.providerKind} 실행 인증 경로가 준비되어 있습니다.`));
      } else {
        checks.push(
          checkWarn(
            "provider",
            "Provider",
            `${agent.providerKind} 계정 정보가 없습니다. opencode OAuth 또는 API 프로필을 먼저 연결하세요.`,
          ),
        );
      }
      checks.push(
        agent.model
          ? checkOk("model", "Model", `선택 모델: ${agent.model}`)
          : checkError("model", "Model", "선택된 모델이 없습니다."),
      );
    }

    if (conversation) {
      try {
        workspace.createConversationWorkspace(conversation.id);
        checks.push(checkOk("workspace", "Workspace", "세션 sandbox를 확인했습니다."));
      } catch (error) {
        checks.push(
          checkError(
            "workspace",
            "Workspace",
            error instanceof Error ? error.message : "세션 sandbox 확인에 실패했습니다.",
          ),
        );
      }
    }

    checks.push(
      process.env.ENABLE_AGENT_AUTOMATIONS === "true"
        ? checkOk("scheduler", "Scheduler", "자동화 스케줄러가 활성화되어 있습니다.")
        : checkWarn("scheduler", "Scheduler", "자동화 스케줄러가 비활성화되어 있습니다. 수동 실행은 가능합니다."),
    );

    response.json({
      ok: !checks.some((check) => check.status === "error"),
      checks,
    });
  });

  registerWorkspaceRoutes(app, {
    store,
    workspace,
    taskManager: gateway.taskManager,
    exposeWorkspaceDebugPaths,
    localApiToken,
    localApiAllowedPorts,
  });
  registerSearchRoutes(app, { store });
  registerMcpRoutes(app, { store, gateway, exposeWorkspaceDebugPaths });
  registerSkillTemplateRoutes(app, { store, workspace });
  app.use("/api/computer-use", (_request, response) => {
    sendLegacyGone(response, "Custom Computer Use API");
  });

  registerAgentsRoutes(app, { store, workspace, gateway });
  registerAutomationRoutes(app, { store });
  registerTasksRoutes(app, { store, gateway });
  registerTaskFlowRoutes(app, { store, gateway });
  registerProvidersRoutes(app, {
    store,
    port,
    fetchImpl,
    resolveSecret,
    codexOAuthDebug,
  });
  registerConversationsRoutes(app, { store, workspace, gateway, localApiToken, localApiAllowedPorts });

  app.post("/api/chat/stream", async (request, response) => {
    const body = ChatRequestSchema.parse(request.body);
    const conversation = requireConversation(store, response, body.conversationId);
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
