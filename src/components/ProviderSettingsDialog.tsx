import {
  providerKinds,
  providerLabels,
  type ProviderDraft,
  type ProviderKind,
  type ProviderSummary,
} from "../types";

interface ProviderSettingsDialogProps {
  drafts: Record<ProviderKind, ProviderDraft>;
  notice: string | null;
  onClose: () => void;
  onConnectCodex: () => void;
  onDraftChange: (kind: ProviderKind, field: keyof ProviderDraft, value: string) => void;
  onImportCodex: () => void;
  onLogoutCodex: () => void;
  onSave: (kind: ProviderKind) => void;
  onTest: (kind: ProviderKind) => void;
  open: boolean;
  providers: ProviderSummary[];
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
    return provider.email ?? provider.displayName ?? "저장된 계정 정보가 있습니다.";
  }

  return "연결 정보가 없거나 확인이 필요합니다.";
}

function providerDescription(kind: ProviderKind) {
  switch (kind) {
    case "openai":
      return "OpenAI API 키를 로컬 암호화 저장소에 저장합니다.";
    case "anthropic":
      return "Anthropic API 키를 저장해 Claude 계열 모델을 사용할 수 있게 합니다.";
    case "gemini":
      return "Google Gemini API 키를 저장합니다.";
    case "ollama":
      return "로컬 Ollama 서버 주소만 설정합니다. API 키는 사용하지 않습니다.";
    case "openai-codex":
      return "API 키 입력이 아니라 공식 Codex OAuth 또는 로컬 Codex CLI 인증을 사용합니다.";
    default:
      return "프로바이더 연결 정보를 관리합니다.";
  }
}

function baseUrlPlaceholder(kind: ProviderKind) {
  if (kind === "ollama") {
    return "http://127.0.0.1:11434";
  }
  return "선택 입력: 호환 API 서버를 쓸 때만 입력";
}

export function ProviderSettingsDialog({
  drafts,
  notice,
  onClose,
  onConnectCodex,
  onDraftChange,
  onImportCodex,
  onLogoutCodex,
  onSave,
  onTest,
  open,
  providers,
  savingKind,
  testingKind,
}: ProviderSettingsDialogProps) {
  if (!open) {
    return null;
  }

  const connectedCount = providers.filter(
    (provider) => provider.status === "connected" || provider.status === "configured",
  ).length;

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
              공급자별 인증 정보만 저장합니다. 모델 선택은 채팅창 하단의 모델 선택 메뉴에서 별도로
              관리합니다.
            </p>
          </div>
          <button className="icon-button provider-dialog__close" onClick={onClose} type="button">
            닫기
          </button>
        </div>

        <div className="provider-dialog__summary" aria-label="연결 요약">
          <span>연결/설정됨 {connectedCount}</span>
          <span>API 키는 서버 로컬 DB에 암호화 저장</span>
          <span>Codex는 OAuth/CLI 인증 전용</span>
        </div>

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
                        OpenAI 로그인 세션을 통해 연결하거나, 이미 로그인된 로컬 Codex CLI 인증을
                        가져옵니다. 비공식 토큰 추출은 하지 않습니다.
                      </span>
                    </div>
                    <div className="provider-card__actions provider-card__actions--stacked">
                      <button
                        className="provider-button provider-button--primary provider-button--full"
                        onClick={onConnectCodex}
                        type="button"
                      >
                        OpenAI 로그인으로 Codex 연결
                      </button>
                      <button
                        className="provider-button provider-button--secondary"
                        onClick={onImportCodex}
                        type="button"
                      >
                        Codex CLI 인증 가져오기
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
                          placeholder="저장 후에는 화면에 다시 표시되지 않습니다"
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
