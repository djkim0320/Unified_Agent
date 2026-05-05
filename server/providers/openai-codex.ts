import { z } from "zod";
import {
  resolveCodexExpiry,
  resolveCodexWorkspaceId,
  writeCodexCliAuth,
} from "../lib/codex-auth.js";
import { createPkcePair, randomState } from "../lib/oauth.js";
import { ensureOk, readJson } from "../lib/streaming.js";
import { providerModelCatalog } from "../model-catalog.js";
import type { ProviderSecret } from "../types.js";
import type { ProviderAdapter } from "./base.js";

export const CODEX_MODELS = providerModelCatalog["openai-codex"].map((entry) => entry.id);

export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_SCOPE =
  "openid profile email offline_access api.connectors.read api.connectors.invoke";
const CODEX_ORIGINATOR = "codex_cli_rs";

const CodexTokenSchema = z.object({
  access_token: z.string(),
  id_token: z.string().optional(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
});

function assertConfigured(secret: ProviderSecret<"openai-codex"> | null) {
  if (!secret?.accessToken || !secret.refreshToken) {
    throw new Error("OpenAI Codex is not connected.");
  }
  return secret;
}

function shouldRefreshCodexSecret(secret: ProviderSecret<"openai-codex">) {
  if (!secret.refreshToken) {
    return false;
  }

  const decodedAccessTokenExpiry = resolveCodexExpiry(secret.accessToken);
  if (typeof decodedAccessTokenExpiry === "number" && Number.isFinite(decodedAccessTokenExpiry)) {
    return decodedAccessTokenExpiry <= Date.now() + 60_000;
  }

  if (typeof secret.expiresAt === "number" && Number.isFinite(secret.expiresAt)) {
    return secret.expiresAt <= Date.now() + 60_000;
  }

  const lastRefreshTimestamp = secret.lastRefresh
    ? Date.parse(secret.lastRefresh)
    : Number.NaN;
  if (Number.isFinite(lastRefreshTimestamp)) {
    return lastRefreshTimestamp <= Date.now() - 55 * 60_000;
  }

  return true;
}

export function createCodexOAuthStart(params: {
  redirectUri: string;
  frontendOrigin: string;
  allowedWorkspaceId?: string | null;
}) {
  const state = randomState();
  const pkce = createPkcePair();
  const authUrl = new URL(CODEX_AUTHORIZE_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", CODEX_OAUTH_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", params.redirectUri);
  authUrl.searchParams.set("scope", CODEX_SCOPE);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", pkce.challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("originator", CODEX_ORIGINATOR);
  authUrl.searchParams.set("codex_cli_simplified_flow", "true");
  authUrl.searchParams.set("id_token_add_organizations", "true");
  if (params.allowedWorkspaceId) {
    authUrl.searchParams.set("allowed_workspace_id", params.allowedWorkspaceId);
  }

  return {
    state,
    verifier: pkce.verifier,
    frontendOrigin: params.frontendOrigin,
    authUrl: authUrl.toString(),
  };
}

export async function exchangeCodexAuthorizationCode(params: {
  code: string;
  verifier: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await ensureOk(
    await fetchImpl(CODEX_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CODEX_OAUTH_CLIENT_ID,
        code: params.code,
        code_verifier: params.verifier,
        redirect_uri: params.redirectUri,
      }),
    }),
  );

  const payload = CodexTokenSchema.parse(await readJson(response));
  return {
    accessToken: payload.access_token,
    idToken: payload.id_token,
    refreshToken: payload.refresh_token ?? "",
    expiresAt:
      typeof payload.expires_in === "number"
        ? Date.now() + payload.expires_in * 1000
        : null,
    chatgptAccountId: resolveCodexWorkspaceId(
      payload.access_token,
      payload.id_token,
    ),
    lastRefresh: new Date().toISOString(),
  };
}

export async function refreshCodexSecret(
  secret: ProviderSecret<"openai-codex">,
  fetchImpl: typeof fetch = fetch,
) {
  if (!secret.refreshToken) {
    return secret;
  }

  if (!shouldRefreshCodexSecret(secret)) {
    return secret;
  }

  const response = await ensureOk(
    await fetchImpl(CODEX_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CODEX_OAUTH_CLIENT_ID,
        refresh_token: secret.refreshToken,
      }),
    }),
  );

  const payload = CodexTokenSchema.parse(await readJson(response));
  const refreshedSecret: ProviderSecret<"openai-codex"> = {
    ...secret,
    accessToken: payload.access_token,
    idToken: payload.id_token ?? secret.idToken,
    refreshToken: payload.refresh_token ?? secret.refreshToken,
    expiresAt:
      typeof payload.expires_in === "number"
        ? Date.now() + payload.expires_in * 1000
        : resolveCodexExpiry(payload.access_token) ?? secret.expiresAt,
    chatgptAccountId:
      resolveCodexWorkspaceId(payload.access_token, payload.id_token) ??
      secret.chatgptAccountId,
    importedFromCli: secret.importedFromCli,
    sourcePath: secret.sourcePath ?? null,
    lastRefresh: new Date().toISOString(),
  };

  if (secret.importedFromCli && secret.sourcePath) {
    try {
      writeCodexCliAuth({
        authFilePath: secret.sourcePath,
        accessToken: refreshedSecret.accessToken,
        refreshToken: refreshedSecret.refreshToken,
        idToken: refreshedSecret.idToken,
        accountId: refreshedSecret.chatgptAccountId,
        lastRefresh: refreshedSecret.lastRefresh ?? null,
      });
    } catch {
      // Best-effort sync only. Stored provider secrets remain the source of truth for the app.
    }
  }

  return refreshedSecret;
}

export const openAICodexAdapter: ProviderAdapter<"openai-codex"> = {
  kind: "openai-codex",
  label: "OpenAI Codex",
  defaultModel: "gpt-5.5",

  async listModels() {
    return [...CODEX_MODELS];
  },

  async testConnection(secret) {
    try {
      assertConfigured(secret);
      return {
        ok: true,
        message: "Codex OAuth credentials are stored. opencode will use the synced auth/config path for execution.",
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Codex connection test failed.",
      };
    }
  },
};
