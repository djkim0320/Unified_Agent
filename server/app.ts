import express from "express";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { resolveCodexIdentity, importCodexCliAuth } from "./lib/codex-auth.js";
import { createBrowserRuntime } from "./lib/browser-runtime.js";
import { runCodexLogin, runCodexLoginStatus } from "./lib/codex-cli.js";
import { createDebugLog, redactOpaqueValue } from "./lib/debug-log.js";
import { AgentRunError, runAgentTurn } from "./lib/agent-runtime.js";
import { isAbortError } from "./lib/process-control.js";
import { createWorkspaceManager } from "./lib/workspace.js";
import { createStore } from "./db.js";
import { getCuratedModelIds } from "./model-catalog.js";
import { getProviderAdapter, providerKinds } from "./provider-registry.js";
import { normalizeReasoningLevel } from "./reasoning-options.js";
import {
  createCodexOAuthStart,
  exchangeCodexAuthorizationCode,
  refreshCodexSecret,
} from "./providers/openai-codex.js";
import type { ProviderKind, ProviderSecret, ProviderSummary } from "./types.js";

const ProviderKindSchema = z.enum([
  "openai",
  "anthropic",
  "gemini",
  "ollama",
  "openai-codex",
]);

const ReasoningLevelSchema = z.enum(["minimal", "low", "medium", "high", "xhigh"]);
const WorkspaceScopeSchema = z.enum(["sandbox", "shared", "root"]);

const ConversationUpsertSchema = z.object({
  conversationId: z.string().uuid().optional(),
  title: z.string().min(1).max(120).optional(),
  providerKind: ProviderKindSchema.optional(),
  model: z.string().min(1).max(120).optional(),
  reasoningLevel: ReasoningLevelSchema.optional(),
});

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

const WorkspaceTreeQuerySchema = z.object({
  conversationId: z.string().uuid(),
  scope: WorkspaceScopeSchema.optional().default("sandbox"),
  path: z.string().optional(),
  maxDepth: z.coerce.number().int().min(0).max(8).optional(),
});

const WorkspaceFileQuerySchema = z.object({
  conversationId: z.string().uuid(),
  scope: WorkspaceScopeSchema.optional().default("sandbox"),
  path: z.string().min(1),
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
  const exposeWorkspaceDebugPaths = process.env.ENABLE_WORKSPACE_DEBUG_PATHS === "true";
  const store = createStore(dataDir);
  const workspace = createWorkspaceManager(projectRoot, {
    conversationExists: (conversationId) => Boolean(store.getConversation(conversationId)),
    enableRootScope: process.env.ENABLE_WORKSPACE_ROOT_SCOPE === "true",
  });
  const browserRuntime = createBrowserRuntime();
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

  function workspaceErrorStatus(error: unknown) {
    if (error instanceof Error && /conversation not found/i.test(error.message)) {
      return 404;
    }
    return 400;
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
          importedFromCli: false,
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
      response.json({ models });
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
          });
          store.saveProviderConfiguration({
            kind: "openai-codex",
            secret: {
              accessToken: imported.accessToken,
              refreshToken: imported.refreshToken,
              expiresAt: imported.expiresAt,
              chatgptAccountId: imported.accountId,
              importedFromCli: true,
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
      });
      store.saveProviderConfiguration({
        kind: "openai-codex",
        secret: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
          chatgptAccountId: tokens.chatgptAccountId,
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
      });
      store.saveProviderConfiguration({
        kind: "openai-codex",
        secret: {
          accessToken: imported.accessToken,
          refreshToken: imported.refreshToken,
          expiresAt: imported.expiresAt,
          chatgptAccountId: imported.accountId,
          importedFromCli: true,
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

  app.get("/api/conversations", (_request, response) => {
    response.json({
      conversations: store.listConversations(),
    });
  });

  app.post("/api/conversations", (request, response) => {
    const body = ConversationUpsertSchema.parse(request.body);
    const existing = body.conversationId ? store.getConversation(body.conversationId) : null;
    const providerKind = body.providerKind ?? existing?.providerKind ?? "openai";
    const model = body.model ?? existing?.model ?? getProviderAdapter(providerKind).defaultModel;
    const reasoningLevel = normalizeReasoningLevel(
      providerKind,
      model,
      body.reasoningLevel ?? existing?.reasoningLevel,
    );
    const normalizedConversationTitle = body.title ?? existing?.title ?? "새 채팅";
    const title = body.title ?? existing?.title ?? "새 채팅";
    const normalizedTitle = body.title ?? existing?.title ?? "새 채팅";
    const conversation = store.saveConversation({
      id: body.conversationId,
      title: normalizedConversationTitle,
      providerKind,
      model,
      reasoningLevel,
    });
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
    await browserRuntime.closeConversationSessions(conversation.id).catch(() => undefined);
    const deleted = store.deleteConversation(conversation.id);
    if (!deleted) {
      response.status(404).json({ error: "Conversation not found" });
      return;
    }
    try {
      workspace.deleteConversationWorkspace(conversation.id);
    } catch {
      // Workspace cleanup is best-effort, but deleteConversationWorkspace is scoped to this sandbox only.
    }
    response.json({ ok: true });
  });

  app.get("/api/workspace/tree", (request, response) => {
    try {
      const query = WorkspaceTreeQuerySchema.parse(request.query);
      if (!requireConversation(response, query.conversationId)) {
        return;
      }
      const tree = workspace.listTree({
        conversationId: query.conversationId,
        scope: query.scope,
        relativePath: query.path,
        maxDepth: query.maxDepth,
      });
      const resolved =
        exposeWorkspaceDebugPaths
          ? workspace.resolvePath({
              conversationId: query.conversationId,
              scope: query.scope,
              relativePath: query.path ?? ".",
              mode: "read",
            })
          : null;
      response.json({
        scope: query.scope,
        path: query.path ?? ".",
        tree,
        ...(resolved
          ? {
              debug: {
                workspaceRoot: resolved.root,
                absolutePath: resolved.absolutePath,
              },
            }
          : {}),
      });
    } catch (error) {
      response.status(workspaceErrorStatus(error)).json({
        error: error instanceof Error ? error.message : "Failed to read workspace tree",
      });
    }
  });

  app.get("/api/workspace/file", (request, response) => {
    try {
      const query = WorkspaceFileQuerySchema.parse(request.query);
      if (!requireConversation(response, query.conversationId)) {
        return;
      }
      const file = workspace.readFile({
        conversationId: query.conversationId,
        scope: query.scope,
        relativePath: query.path,
      });
      const resolved =
        exposeWorkspaceDebugPaths
          ? workspace.resolvePath({
              conversationId: query.conversationId,
              scope: query.scope,
              relativePath: query.path,
              mode: "read",
            })
          : null;
      response.json({
        file: {
          ...file,
          ...(resolved ? { absolutePath: resolved.absolutePath } : {}),
        },
      });
    } catch (error) {
      response.status(workspaceErrorStatus(error)).json({
        error: error instanceof Error ? error.message : "Failed to read workspace file",
      });
    }
  });

  app.get("/api/workspace/runs", (request, response) => {
    const conversationId = z.string().uuid().parse(request.query.conversationId);
    if (!requireConversation(response, conversationId)) {
      return;
    }
    response.json({
      runs: store.listWorkspaceRuns(conversationId),
    });
  });

  app.get("/api/workspace/runs/:runId/events", (request, response) => {
    const conversationId = z.string().uuid().parse(request.query.conversationId);
    if (!requireConversation(response, conversationId)) {
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

  app.post("/api/chat/stream", async (request, response) => {
    const body = ChatRequestSchema.parse(request.body);
    const conversation = requireConversation(response, body.conversationId);
    if (!conversation) {
      return;
    }

    const adapter = getProviderAdapter(body.providerKind);
    const secret = await getSecret(body.providerKind);
    if (!secret) {
      response.status(400).json({ error: `${adapter.label} must be configured first.` });
      return;
    }

    const normalizedReasoningLevel = normalizeReasoningLevel(
      body.providerKind,
      body.model,
      body.reasoningLevel,
    );

    store.saveConversation({
      id: conversation.id,
      title: conversation.title,
      providerKind: body.providerKind,
      model: body.model,
      reasoningLevel: normalizedReasoningLevel,
    });
    store.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: body.message,
    });
    store.ensureConversationTitle(conversation.id, body.message);
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
        abortController.abort(new AgentRunError("Client disconnected.", "cancelled"));
      }
    };
    request.on("close", closeHandler);
    response.on("close", closeHandler);

    const sendEvent = (eventName: string, payload: Record<string, unknown>) => {
      if (response.destroyed || response.writableEnded) {
        return;
      }
      response.write(`event: ${eventName}\n`);
      response.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const runtimeResult = await runAgentTurn({
        adapter: adapter as never,
        secret: secret as never,
        providerKind: body.providerKind,
        model: body.model,
        reasoningLevel: normalizedReasoningLevel,
        conversationId: conversation.id,
        userMessage: body.message,
        messages: store.listMessages(conversation.id).map((message) => ({
          role: message.role,
          content: message.content,
        })),
        workspace,
        browserRuntime,
        store,
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
        error instanceof AgentRunError
          ? error.status
          : isAbortError(error)
            ? "cancelled"
            : "failed";
      sendEvent("error", {
        error: error instanceof Error ? error.message : "Streaming failed",
        runId: error instanceof AgentRunError ? error.runId : undefined,
        status,
      });
    } finally {
      streamFinished = true;
      request.off("close", closeHandler);
      response.off("close", closeHandler);
      if (!response.destroyed && !response.writableEnded) {
        response.end();
      }
    }
  });

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
    browserRuntime,
  };
}
