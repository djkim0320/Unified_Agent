import type express from "express";
import { z } from "zod";
import { resolveCodexIdentity, importCodexCliAuth } from "../lib/codex-auth.js";
import { runCodexLogin, runCodexLoginStatus } from "../lib/codex-cli.js";
import { redactOpaqueValue } from "../lib/debug-log.js";
import { renderOAuthResultPage } from "../lib/oauth-result-page.js";
import { getProviderSummary } from "../lib/provider-summary.js";
import { buildCapabilitiesByModel } from "../lib/provider-capabilities.js";
import { getCuratedModelIds } from "../model-catalog.js";
import { getProviderAdapter, providerKinds } from "../provider-registry.js";
import {
  createCodexOAuthStart,
  exchangeCodexAuthorizationCode,
} from "../providers/openai-codex.js";
import { ProviderKindSchema } from "../schemas/common.js";
import type { ProviderKind, ProviderSecret } from "../types.js";
import type { AppStore } from "./context.js";

export const CODEX_CALLBACK_PATH = "/auth/callback";

const ApiProviderAccountSchema = z.object({
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
});

type ProviderSecretResolver = (kind: ProviderKind) => Promise<ProviderSecret<ProviderKind> | null>;

type RouteDebugLog = {
  append(event: string, payload: Record<string, unknown>): void;
  list(): unknown[];
};

export function registerProvidersRoutes(
  app: express.Express,
  params: {
    store: AppStore;
    port: number;
    fetchImpl: typeof fetch;
    resolveSecret: ProviderSecretResolver;
    codexOAuthDebug: RouteDebugLog;
  },
) {
  const { store, port, fetchImpl, resolveSecret, codexOAuthDebug } = params;
  const oauthStates = new Map<
    string,
    {
      verifier: string;
      frontendOrigin: string;
    }
  >();

  app.get("/api/providers", (_request, response) => {
    response.json({
      providers: providerKinds.map((kind) => getProviderSummary(store, kind)),
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
      response.json({ provider: getProviderSummary(store, kind) });
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
    response.json({ provider: getProviderSummary(store, kind) });
  });

  app.get("/api/providers/:kind/models", async (request, response) => {
    const kind = ProviderKindSchema.parse(request.params.kind);
    const adapter = getProviderAdapter(kind);
    const secret = await resolveSecret(kind);

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
    const result = await adapter.testConnection((await resolveSecret(kind)) as never);
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
            provider: getProviderSummary(store, "openai-codex"),
            message: "Codex OAuth connection completed through the official Codex CLI.",
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
        provider: getProviderSummary(store, "openai-codex"),
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
}
