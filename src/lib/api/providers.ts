import { apiRequest } from "../../apiClient";
import type {
  EngineAuthLoginResult,
  EngineRunRecord,
  EngineStatusRecord,
  PreflightResponse,
  ProviderKind,
  ProviderModelCapabilities,
  ProviderSummary,
} from "../../types";

export async function listProviders() {
  return apiRequest<{ providers: ProviderSummary[] }>("/api/providers");
}

export async function saveProviderAccount(
  kind: Exclude<ProviderKind, "openai-codex">,
  payload: { apiKey?: string; baseUrl?: string },
) {
  return apiRequest<{ provider: ProviderSummary }>(`/api/providers/${kind}/account`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function listModels(kind: ProviderKind) {
  return apiRequest<{
    models: string[];
    capabilitiesByModel?: Record<string, ProviderModelCapabilities>;
  }>(`/api/providers/${kind}/models`);
}

export async function getEngineStatus(signal?: AbortSignal) {
  return apiRequest<EngineStatusRecord>("/api/engine/status", { signal });
}

export async function getPreflightStatus(
  payload: {
    agentId?: string | null;
    conversationId?: string | null;
  },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  if (payload.agentId) {
    params.set("agentId", payload.agentId);
  }
  if (payload.conversationId) {
    params.set("conversationId", payload.conversationId);
  }
  const query = params.toString();
  return apiRequest<PreflightResponse>(`/api/preflight${query ? `?${query}` : ""}`, { signal });
}

export async function refreshOpenCodeModels() {
  return apiRequest<{ ok: boolean; models: string[]; message: string }>(
    "/api/engine/opencode/refresh-models",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function startOpenCodeAuthLogin(payload?: {
  provider?: string;
  method?: string | null;
  launch?: boolean;
}) {
  return apiRequest<EngineAuthLoginResult>("/api/engine/opencode/auth/login", {
    method: "POST",
    body: JSON.stringify(payload ?? { provider: "openai", launch: true }),
  });
}

export async function getEngineRun(conversationId: string, runId: string, signal?: AbortSignal) {
  const searchParams = new URLSearchParams({ conversationId });
  return apiRequest<{ engineRun: EngineRunRecord }>(
    `/api/engine/runs/${encodeURIComponent(runId)}?${searchParams.toString()}`,
    { signal },
  );
}

export async function testProvider(kind: ProviderKind) {
  return apiRequest<{ ok: boolean; message: string }>(`/api/providers/${kind}/test`, {
    method: "POST",
  });
}

export async function startCodexOAuth(frontendOrigin: string) {
  return apiRequest<{ provider: ProviderSummary; message: string }>(
    "/api/providers/openai-codex/oauth/start",
    {
      method: "POST",
      body: JSON.stringify({ frontendOrigin, mode: "official-cli" }),
    },
  );
}

export async function importCodexCliAuth() {
  return apiRequest<{ provider: ProviderSummary }>("/api/providers/openai-codex/import-cli-auth", {
    method: "POST",
  });
}

export async function logoutCodex() {
  return apiRequest<{ ok: boolean }>("/api/providers/openai-codex/logout", {
    method: "POST",
  });
}
