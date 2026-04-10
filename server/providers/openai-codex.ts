import { z } from "zod";
import { parseAgentStep } from "../lib/agent-step.js";
import { resolveCodexWorkspaceId } from "../lib/codex-auth.js";
import { runCodexExec } from "../lib/codex-cli.js";
import { createPkcePair, randomState } from "../lib/oauth.js";
import { ensureOk, readJson } from "../lib/streaming.js";
import { providerModelCatalog } from "../model-catalog.js";
import { normalizeReasoningLevel } from "../reasoning-options.js";
import type {
  ChatMessage,
  ProviderSecret,
  ProviderTestResult,
  ReasoningLevel,
} from "../types.js";
import type { ProviderAdapter } from "./base.js";

export const CODEX_MODELS = providerModelCatalog["openai-codex"].map((entry) => entry.id);

export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_SCOPE =
  "openid profile email offline_access api.connectors.read api.connectors.invoke";
const CODEX_ORIGINATOR = "codex_cli_rs";
const DEFAULT_CODEX_INSTRUCTIONS =
  "You are OpenAI Codex inside a local web chat app. Answer helpfully and concisely. The local server executes workspace tools for you, so do not try to run your own shell commands.";

const CodexTokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
});

function buildCodexPrompt(messages: ChatMessage[]) {
  const transcript = messages
    .map((message) => {
      const speaker = message.role === "user" ? "User" : "Assistant";
      return `${speaker}: ${message.content}`;
    })
    .join("\n\n");

  return `${DEFAULT_CODEX_INSTRUCTIONS}\n\nConversation transcript:\n${transcript}\n\nReply as the assistant to the final user message.`;
}

function buildCodexPromptWithInstructions(instructions: string, messages: ChatMessage[]) {
  const transcript = messages
    .map((message) => {
      const speaker = message.role === "user" ? "User" : "Assistant";
      return `${speaker}: ${message.content}`;
    })
    .join("\n\n");

  return `${instructions}\n\nConversation transcript:\n${transcript}`;
}

function assertConfigured(secret: ProviderSecret<"openai-codex"> | null) {
  if (!secret?.accessToken || !secret.refreshToken) {
    throw new Error("OpenAI Codex is not connected.");
  }
  return secret;
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
    refreshToken: payload.refresh_token ?? "",
    expiresAt:
      typeof payload.expires_in === "number"
        ? Date.now() + payload.expires_in * 1000
        : null,
    chatgptAccountId: resolveCodexWorkspaceId(payload.access_token),
  };
}

export async function refreshCodexSecret(
  secret: ProviderSecret<"openai-codex">,
  fetchImpl: typeof fetch = fetch,
) {
  if (!secret.refreshToken) {
    return secret;
  }

  const expiresAt = secret.expiresAt ?? 0;
  if (expiresAt === 0 || expiresAt > Date.now() + 60_000) {
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
  return {
    ...secret,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? secret.refreshToken,
    expiresAt:
      typeof payload.expires_in === "number"
        ? Date.now() + payload.expires_in * 1000
        : secret.expiresAt,
    chatgptAccountId:
      resolveCodexWorkspaceId(payload.access_token) ?? secret.chatgptAccountId,
    importedFromCli: false,
  };
}

async function generateCodexText(params: {
  model: string;
  reasoningLevel: ReasoningLevel;
  instructions: string;
  messages: ChatMessage[];
}) {
  const result = await runCodexExec({
    cwd: process.cwd(),
    model: params.model,
    reasoningEffort: normalizeReasoningLevel(
      "openai-codex",
      params.model,
      params.reasoningLevel,
    ),
    prompt: buildCodexPromptWithInstructions(params.instructions, params.messages),
  });
  return result.finalAgentMessage.trim();
}

export const openAICodexAdapter: ProviderAdapter<"openai-codex"> = {
  kind: "openai-codex",
  label: "OpenAI Codex",
  defaultModel: "gpt-5.4",

  async listModels() {
    return [...CODEX_MODELS];
  },

  async testConnection(secret): Promise<ProviderTestResult> {
    try {
      assertConfigured(secret);
      const result = await runCodexExec({
        cwd: process.cwd(),
        model: "gpt-5.4-mini",
        prompt: buildCodexPrompt([
          {
            role: "user",
            content: "Reply with exactly pong. No markdown, no extra words.",
          },
        ]),
      });
      if (result.finalAgentMessage.trim().toLowerCase() !== "pong") {
        throw new Error(`Unexpected Codex test reply: ${result.finalAgentMessage.trim()}`);
      }
      return {
        ok: true,
        message: "Connected successfully. Official Codex CLI auth is working.",
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Codex connection test failed.",
      };
    }
  },

  async planToolStep({ secret, model, reasoningLevel, instructions, messages }) {
    assertConfigured(secret);
    const text = await generateCodexText({
      model,
      reasoningLevel,
      instructions,
      messages,
    });
    return parseAgentStep(text);
  },

  async streamFinalAnswer({ secret, model, reasoningLevel, instructions, messages, onText }) {
    assertConfigured(secret);
    const text = await generateCodexText({
      model,
      reasoningLevel,
      instructions,
      messages,
    });
    if (text) {
      onText(text);
    }
  },
};
