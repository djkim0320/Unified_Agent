import type { createStore } from "../db.js";
import type { EngineStatusRecord, ProviderKind, WorkspaceRunRecord } from "../types.js";

type Store = ReturnType<typeof createStore>;
type EvidenceContext = { providerKind?: ProviderKind | null; model?: string | null; now?: number };

const providerKinds: ProviderKind[] = ["openai", "anthropic", "gemini", "ollama", "openai-codex"];
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

export function withEngineAuthEvidence(
  status: EngineStatusRecord,
  store: Pick<Store, "getProviderAccount" | "getProviderSecret" | "getLatestSuccessfulWorkspaceRun">,
  context?: EvidenceContext,
): EngineStatusRecord {
  return {
    ...status,
    authEvidence: computeEngineAuthEvidence(status, store, context),
  };
}

function runEvidence(run: WorkspaceRunRecord | null, context?: EvidenceContext) {
  const now = context?.now ?? Date.now();
  if (!run) {
    return {
      run: null,
      ageMs: null,
      recent: false,
      freshEnough: false,
      stale: false,
      matchesContext: true,
    };
  }
  const ageMs = Math.max(0, now - run.updatedAt);
  return {
    run,
    ageMs,
    recent: ageMs <= ONE_DAY_MS,
    freshEnough: ageMs <= SEVEN_DAYS_MS,
    stale: ageMs > SEVEN_DAYS_MS,
    matchesContext:
      (!context?.providerKind || run.providerKind === context.providerKind) &&
      (!context?.model || run.model === context.model),
  };
}

function koreanTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString("ko-KR");
}

function withLatestRunMetadata(
  evidence: Omit<NonNullable<EngineStatusRecord["authEvidence"]>, "lastSuccessfulRunAt">,
  latest: ReturnType<typeof runEvidence>,
): NonNullable<EngineStatusRecord["authEvidence"]> {
  return {
    ...evidence,
    lastSuccessfulRunAt: latest.run?.updatedAt ?? null,
    evidenceAgeMs: latest.ageMs,
    stale: latest.stale,
    providerKind: latest.run?.providerKind ?? null,
    model: latest.run?.model ?? null,
  };
}

export function computeEngineAuthEvidence(
  status: EngineStatusRecord,
  store: Pick<Store, "getProviderAccount" | "getProviderSecret" | "getLatestSuccessfulWorkspaceRun">,
  context?: EvidenceContext,
): NonNullable<EngineStatusRecord["authEvidence"]> {
  const latest = runEvidence(store.getLatestSuccessfulWorkspaceRun?.() ?? null, context);

  if (!status.available) {
    return withLatestRunMetadata(
      {
        status: "blocked",
        source: "unknown",
        confidence: "high",
        message: status.lastFailure ?? "opencode 실행 엔진을 사용할 수 없습니다.",
      },
      latest,
    );
  }

  if (status.authStatus === "available" || (status.opencodeAuthProviders?.length ?? 0) > 0) {
    return withLatestRunMetadata(
      {
        status: "usable",
        source: "auth-command",
        confidence: "high",
        message: "opencode 인증 명령이 사용 가능한 인증 상태를 확인했습니다.",
      },
      latest,
    );
  }

  const codexAccount = store.getProviderAccount("openai-codex");
  if (codexAccount?.status === "connected" || codexAccount?.status === "configured") {
    return withLatestRunMetadata(
      {
        status: "usable",
        source: "codex-oauth",
        confidence: "high",
        message: "OpenAI Codex OAuth 계정이 연결되어 opencode 실행 인증 경로로 사용할 수 있습니다.",
      },
      latest,
    );
  }

  const credentialSyncProviders = status.credentialSync?.entries.filter((entry) => entry.configured) ?? [];
  if (credentialSyncProviders.length > 0) {
    return withLatestRunMetadata(
      {
        status: "usable",
        source: "credential-sync",
        confidence: "high",
        message: `opencode credential sync가 ${credentialSyncProviders
          .map((entry) => entry.providerKind)
          .join(", ")} 인증 정보를 런타임에 주입하도록 설정되어 있습니다.`,
      },
      latest,
    );
  }

  const configuredSecretProvider = providerKinds.find((kind) => {
    const account = store.getProviderAccount(kind);
    if (account?.status === "connected" || account?.status === "configured") {
      return true;
    }
    return Boolean(store.getProviderSecret(kind));
  });
  if (configuredSecretProvider) {
    return withLatestRunMetadata(
      {
        status: "usable",
        source: "provider-secret",
        confidence: "medium",
        message: `${configuredSecretProvider} provider credential이 로컬 저장소에 설정되어 있습니다.`,
      },
      latest,
    );
  }

  if (latest.run && latest.freshEnough) {
    const contextNote = latest.matchesContext ? "" : " 선택한 provider/model과 달라 신뢰도를 낮췄습니다.";
    return withLatestRunMetadata(
      {
        status: "usable",
        source: "recent-successful-run",
        confidence: latest.recent && latest.matchesContext ? "high" : "medium",
        message: `최근 opencode run 성공: ${koreanTimestamp(latest.run.updatedAt)}.${contextNote}`,
      },
      latest,
    );
  }

  if (latest.run) {
    return withLatestRunMetadata(
      {
        status: "warning",
        source: "recent-successful-run",
        confidence: "low",
        message: `최근 성공 run이 오래되었습니다 (${koreanTimestamp(latest.run.updatedAt)}). 인증 상태 재확인이 필요합니다.`,
      },
      latest,
    );
  }

  return withLatestRunMetadata(
    {
      status: "warning",
      source: "unknown",
      confidence: "low",
      message: "opencode 인증 명령이 명확한 로그인 상태를 확인하지 못했습니다. API/OAuth 설정 또는 opencode auth login을 확인하세요.",
    },
    latest,
  );
}
