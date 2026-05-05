import {
  providerKinds,
  providerLabels,
  type EngineStatusRecord,
  type ProviderDraft,
  type ProviderKind,
  type ProviderSummary,
} from "../types";

interface ProviderSettingsDialogProps {
  drafts: Record<ProviderKind, ProviderDraft>;
  engineStatus: EngineStatusRecord | null;
  engineStatusLoading: boolean;
  notice: string | null;
  onClose: () => void;
  onConnectCodex: () => void;
  onConnectOpenCodeOAuth: () => void;
  onDraftChange: (kind: ProviderKind, field: keyof ProviderDraft, value: string) => void;
  onImportCodex: () => void;
  onLogoutCodex: () => void;
  onRefreshEngineStatus: () => void;
  onRefreshOpenCodeModels: () => void;
  onSave: (kind: ProviderKind) => void;
  onTest: (kind: ProviderKind) => void;
  open: boolean;
  providers: ProviderSummary[];
  providerAuthPending: boolean;
  savingKind: ProviderKind | null;
  testingKind: ProviderKind | null;
}

function statusLabel(status: ProviderSummary["status"] | undefined) {
  switch (status) {
    case "connected":
      return "연결됨";
    case "configured":
      return "설정됨";
    default:
      return "연결 필요";
  }
}

function statusDetail(provider: ProviderSummary | undefined) {
  if (!provider) {
    return "아직 저장된 연결 정보가 없습니다.";
  }

  if (provider.status === "connected" || provider.status === "configured") {
    return provider.email ?? provider.displayName ?? "로컬에 저장된 계정 정보가 있습니다.";
  }

  return "연결 정보가 없거나 확인이 필요합니다.";
}

function providerDescription(kind: ProviderKind) {
  switch (kind) {
    case "openai":
      return "OpenAI API 키를 AetherOps 로컬 DB에 암호화해 저장합니다. opencode 실행 시 런타임 환경으로만 전달됩니다.";
    case "anthropic":
      return "Anthropic API 키를 저장해 Claude 계열 모델과 opencode 런타임에서 함께 사용할 수 있게 합니다.";
    case "gemini":
      return "Google Gemini API 키를 저장합니다. opencode에는 Google provider 런타임 설정으로 전달됩니다.";
    case "ollama":
      return "로컬 Ollama 서버 주소를 저장합니다. API 키는 사용하지 않습니다.";
    case "openai-codex":
      return "Codex는 공식 OAuth/CLI 인증을 사용합니다. opencode OAuth는 opencode의 공식 연결 흐름에서 별도로 관리합니다.";
    default:
      return "프로바이더 연결 정보를 관리합니다.";
  }
}

function baseUrlPlaceholder(kind: ProviderKind) {
  if (kind === "ollama") {
    return "http://127.0.0.1:11434";
  }
  return "선택 입력: 호환 API 서버를 사용할 때만 입력";
}

function syncSummary(engineStatus: EngineStatusRecord | null) {
  const configured = engineStatus?.credentialSync?.configuredProviders ?? [];
  const opencodeAuthProviders = engineStatus?.opencodeAuthProviders ?? [];
  if (opencodeAuthProviders.length > 0) {
    return `opencode OAuth 인증이 연결되었습니다: ${opencodeAuthProviders.join(", ")}`;
  }
  if (configured.length === 0) {
    return "AetherOps에 저장된 provider 정보가 아직 opencode 런타임에 연결되지 않았습니다.";
  }
  return `${configured.length}개 provider 설정이 opencode 실행 시 런타임 환경으로 자동 전달됩니다.`;
}

export function ProviderSettingsDialog({
  drafts,
  engineStatus,
  engineStatusLoading,
  notice,
  onClose,
  onConnectCodex,
  onConnectOpenCodeOAuth,
  onDraftChange,
  onImportCodex,
  onLogoutCodex,
  onRefreshEngineStatus,
  onRefreshOpenCodeModels,
  onSave,
  onTest,
  open,
  providers,
  providerAuthPending,
  savingKind,
  testingKind,
}: ProviderSettingsDialogProps) {
  if (!open) {
    return null;
  }

  const connectedCount = providers.filter(
    (provider) => provider.status === "connected" || provider.status === "configured",
  ).length;
  const configuredSyncEntries =
    engineStatus?.credentialSync?.entries.filter((entry) => entry.configured) ?? [];
  const opencodeAuthProviders = engineStatus?.opencodeAuthProviders ?? [];
  const opencodeAuthLabel =
    opencodeAuthProviders.length > 0 ? opencodeAuthProviders.join(", ") : engineStatus?.authStatus ?? "unknown";

  return (
    <div className="provider-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        aria-label="API 연결 관리"
        aria-modal="true"
        className="provider-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="provider-dialog__header">
          <div>
            <p className="provider-dialog__eyebrow">로컬 인증 저장소</p>
            <h2>API 연결 관리</h2>
            <p>
              공급자별 인증 정보만 로컬에 저장합니다. 모델 선택은 채팅창 하단의 모델 메뉴에서
              별도로 관리됩니다.
            </p>
          </div>
          <button className="icon-button provider-dialog__close" onClick={onClose} type="button">
            닫기
          </button>
        </div>

        <div className="provider-dialog__summary" aria-label="연결 요약">
          <span>연결/설정됨 {connectedCount}</span>
          <span>API 키는 서버 로컬 DB에 암호화 저장</span>
          <span>opencode에는 실행 순간에만 전달</span>
        </div>

        <section className="provider-card provider-card--engine">
          <div className="provider-card__title-row">
            <div>
              <h3>Execution Engine: opencode</h3>
              <p>
                AetherOps는 세션, 워크플로우, 감사 로그를 관리하고 실제 워크스페이스 실행은
                opencode CLI에 위임합니다.
              </p>
            </div>
            <span className={`status-pill status-pill--${engineStatus?.available ? "connected" : "disconnected"}`}>
              {engineStatusLoading ? "확인 중" : engineStatus?.available ? "사용 가능" : "확인 필요"}
            </span>
          </div>

          <div className="provider-dialog__summary provider-dialog__summary--engine" aria-label="opencode 엔진 상태">
            <span>실행 파일: {engineStatus?.executable ?? "opencode"}</span>
            <span>버전: {engineStatus?.version ?? "미확인"}</span>
            <span>모델 캐시: {engineStatus?.models.length ?? 0}</span>
            <span>Auth: {opencodeAuthLabel}</span>
          </div>

          <div className="provider-card__codex-box">
            <strong>opencode 자격 증명 동기화</strong>
            <span>{syncSummary(engineStatus)}</span>
            {configuredSyncEntries.length > 0 ? (
              <span>
                동기화 대상:{" "}
                {configuredSyncEntries
                  .map((entry) => `${providerLabels[entry.providerKind]} -> ${entry.opencodeProvider}`)
                  .join(", ")}
              </span>
            ) : null}
            <span>
              OAuth는 토큰을 복사하지 않습니다. opencode OAuth가 필요한 경우 opencode의 공식
              <code> auth login </code>또는 <code>/connect</code> 흐름으로 연결해야 합니다.
            </span>
          </div>

          {engineStatus?.lastFailure ? (
            <p className="provider-card__description">최근 오류: {engineStatus.lastFailure}</p>
          ) : (
            <p className="provider-card__description">
              OPENCODE_BIN과 OPENCODE_CONFIG_DIR 환경변수로 실행 파일과 설정 경로를 지정할 수 있습니다.
            </p>
          )}

          <div className="provider-card__actions">
            <button
              className="provider-button provider-button--secondary"
              disabled={engineStatusLoading}
              onClick={onRefreshEngineStatus}
              type="button"
            >
              상태 새로고침
            </button>
            <button
              className="provider-button provider-button--primary"
              disabled={engineStatusLoading || !engineStatus?.available}
              onClick={onRefreshOpenCodeModels}
              type="button"
            >
              opencode 모델 갱신
            </button>
            <button
              className="provider-button provider-button--primary"
              disabled={engineStatusLoading || providerAuthPending || !engineStatus?.available}
              onClick={onConnectOpenCodeOAuth}
              type="button"
            >
              {providerAuthPending ? "연결 처리 중..." : "opencode OAuth 연결"}
            </button>
          </div>
        </section>

        {notice ? <div className="notice-banner provider-dialog__notice">{notice}</div> : null}

        <div className="provider-grid">
          {providerKinds.map((kind) => {
            const provider = providers.find((item) => item.kind === kind);
            const draft = drafts[kind];
            const isSaving = savingKind === kind;
            const isTesting = testingKind === kind;
            const isCodex = kind === "openai-codex";
            const isOllama = kind === "ollama";

            return (
              <section
                className={`provider-card ${isCodex ? "provider-card--codex" : ""}`}
                key={kind}
              >
                <div className="provider-card__title-row">
                  <div>
                    <h3>{providerLabels[kind]}</h3>
                    <p>{statusDetail(provider)}</p>
                  </div>
                  <span className={`status-pill status-pill--${provider?.status ?? "disconnected"}`}>
                    {statusLabel(provider?.status)}
                  </span>
                </div>

                <p className="provider-card__description">{providerDescription(kind)}</p>

                {isCodex ? (
                  <>
                    <div className="provider-card__codex-box">
                      <strong>Codex 연결 방식</strong>
                      <span>
                        OpenAI 로그인 세션을 통해 연결하거나 이미 로그인된 로컬 Codex CLI 인증을 가져옵니다.
                        비공식 토큰 추출은 하지 않습니다.
                      </span>
                    </div>
                    <div className="provider-card__actions provider-card__actions--stacked">
                      <button
                        className="provider-button provider-button--primary provider-button--full"
                        disabled={providerAuthPending}
                        onClick={onConnectCodex}
                        type="button"
                      >
                        {providerAuthPending ? "연결 처리 중..." : "OpenAI 로그인으로 Codex 연결"}
                      </button>
                      <button
                        className="provider-button provider-button--secondary"
                        disabled={providerAuthPending}
                        onClick={onImportCodex}
                        type="button"
                      >
                        Codex CLI 인증 가져오기
                      </button>
                      <button
                        className="provider-button provider-button--secondary"
                        disabled={providerAuthPending || engineStatusLoading || !engineStatus?.available}
                        onClick={onConnectOpenCodeOAuth}
                        type="button"
                      >
                        opencode OAuth도 연결
                      </button>
                      <button
                        className="provider-button provider-button--secondary"
                        disabled={isTesting}
                        onClick={() => onTest(kind)}
                        type="button"
                      >
                        {isTesting ? "확인 중..." : "연결 확인"}
                      </button>
                      <button
                        className="provider-button provider-button--danger provider-button--full"
                        disabled={providerAuthPending}
                        onClick={onLogoutCodex}
                        type="button"
                      >
                        Codex 연결 해제
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {!isOllama ? (
                      <label className="field provider-field">
                        <span>API 키</span>
                        <input
                          autoComplete="off"
                          className="field__input"
                          onChange={(event) => onDraftChange(kind, "apiKey", event.target.value)}
                          placeholder="저장 후에는 다시 표시되지 않습니다"
                          type="password"
                          value={draft.apiKey}
                        />
                      </label>
                    ) : null}

                    <label className="field provider-field">
                      <span>{isOllama ? "Ollama 서버 URL" : "기본 URL (선택)"}</span>
                      <input
                        autoComplete="off"
                        className="field__input"
                        onChange={(event) => onDraftChange(kind, "baseUrl", event.target.value)}
                        placeholder={baseUrlPlaceholder(kind)}
                        value={draft.baseUrl}
                      />
                    </label>

                    <div className="provider-card__actions">
                      <button
                        className="provider-button provider-button--secondary"
                        disabled={isTesting}
                        onClick={() => onTest(kind)}
                        type="button"
                      >
                        {isTesting ? "확인 중..." : "연결 확인"}
                      </button>
                      <button
                        className="provider-button provider-button--primary"
                        disabled={isSaving}
                        onClick={() => onSave(kind)}
                        type="button"
                      >
                        {isSaving ? "저장 중..." : "로컬에 저장"}
                      </button>
                    </div>
                  </>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
