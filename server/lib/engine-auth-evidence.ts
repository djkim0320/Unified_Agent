import type { createStore } from "../db.js";
import type { EngineStatusRecord, ProviderKind } from "../types.js";

type Store = ReturnType<typeof createStore>;

const providerKinds: ProviderKind[] = ["openai", "anthropic", "gemini", "ollama", "openai-codex"];

export function withEngineAuthEvidence(
  status: EngineStatusRecord,
  store: Pick<Store, "getProviderAccount" | "getProviderSecret" | "getLatestSuccessfulWorkspaceRun">,
): EngineStatusRecord {
  return {
    ...status,
    authEvidence: computeEngineAuthEvidence(status, store),
  };
}

export function computeEngineAuthEvidence(
  status: EngineStatusRecord,
  store: Pick<Store, "getProviderAccount" | "getProviderSecret" | "getLatestSuccessfulWorkspaceRun">,
): NonNullable<EngineStatusRecord["authEvidence"]> {
  if (!status.available) {
    return {
      status: "blocked",
      source: "unknown",
      confidence: "high",
      message: status.lastFailure ?? "opencode 실행 엔진을 사용할 수 없습니다.",
      lastSuccessfulRunAt: null,
    };
  }

  if (status.authStatus === "available" || (status.opencodeAuthProviders?.length ?? 0) > 0) {
    return {
      status: "usable",
      source: "auth-command",
      confidence: "high",
      message: "opencode 인증 명령이 사용 가능한 인증 상태를 확인했습니다.",
      lastSuccessfulRunAt: store.getLatestSuccessfulWorkspaceRun?.()?.updatedAt ?? null,
    };
  }

  const codexAccount = store.getProviderAccount("openai-codex");
  if (codexAccount?.status === "connected" || codexAccount?.status === "configured") {
    return {
      status: "usable",
      source: "codex-oauth",
      confidence: "high",
      message: "OpenAI Codex OAuth 계정이 연결되어 있어 opencode 실행 인증 경로로 사용할 수 있습니다.",
      lastSuccessfulRunAt: store.getLatestSuccessfulWorkspaceRun?.()?.updatedAt ?? null,
    };
  }

  const credentialSyncProviders = status.credentialSync?.entries.filter((entry) => entry.configured) ?? [];
  if (credentialSyncProviders.length > 0) {
    return {
      status: "usable",
      source: "credential-sync",
      confidence: "high",
      message: `opencode 런타임 credential sync가 ${credentialSyncProviders
        .map((entry) => entry.providerKind)
        .join(", ")} 인증 정보를 주입하도록 설정되어 있습니다.`,
      lastSuccessfulRunAt: store.getLatestSuccessfulWorkspaceRun?.()?.updatedAt ?? null,
    };
  }

  const configuredSecretProvider = providerKinds.find((kind) => {
    const account = store.getProviderAccount(kind);
    if (account?.status === "connected" || account?.status === "configured") {
      return true;
    }
    return Boolean(store.getProviderSecret(kind));
  });
  if (configuredSecretProvider) {
    return {
      status: "usable",
      source: "provider-secret",
      confidence: "medium",
      message: `${configuredSecretProvider} provider credential이 로컬 저장소에 설정되어 있습니다.`,
      lastSuccessfulRunAt: store.getLatestSuccessfulWorkspaceRun?.()?.updatedAt ?? null,
    };
  }

  const latestSuccessfulRun = store.getLatestSuccessfulWorkspaceRun?.() ?? null;
  if (latestSuccessfulRun) {
    return {
      status: "usable",
      source: "recent-successful-run",
      confidence: "medium",
      message: "최근 opencode 실행이 성공했으므로 인증 상태 경고를 차단 오류로 보지 않습니다.",
      lastSuccessfulRunAt: latestSuccessfulRun.updatedAt,
    };
  }

  return {
    status: "warning",
    source: "unknown",
    confidence: "low",
    message: "opencode 인증 명령이 명확한 로그인 상태를 확인하지 못했습니다. API/OAuth 설정 또는 opencode auth login을 확인하세요.",
    lastSuccessfulRunAt: null,
  };
}
