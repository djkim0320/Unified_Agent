import type { ProviderDraft, ProviderKind, ProviderSummary } from "../types";
import { providerKinds, providerLabels } from "../types";

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

function statusLabel(status: ProviderSummary["status"]) {
  switch (status) {
    case "connected":
      return "연결됨";
    case "configured":
      return "구성됨";
    default:
      return "미연결";
  }
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

  return (
    <div className="provider-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        aria-label="프로바이더 설정"
        className="provider-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="provider-dialog__header">
          <div>
            <h2>프로바이더 설정</h2>
            <p>각 API 키와 연결 상태를 관리합니다.</p>
          </div>
          <button className="icon-button" onClick={onClose} type="button">
            닫기
          </button>
        </div>

        {notice ? <div className="notice-banner">{notice}</div> : null}

        <div className="provider-grid">
          {providerKinds.map((kind) => {
            const provider = providers.find((item) => item.kind === kind);
            const draft = drafts[kind];
            const isSaving = savingKind === kind;
            const isTesting = testingKind === kind;

            return (
              <section className="provider-card" key={kind}>
                <div className="provider-card__title-row">
                  <div>
                    <h3>{providerLabels[kind]}</h3>
                    <p>
                      {provider
                        ? `${statusLabel(provider.status)} / ${provider.displayName ?? "계정 없음"}`
                        : "연결되지 않음"}
                    </p>
                  </div>
                  <span className={`status-pill status-pill--${provider?.status ?? "disconnected"}`}>
                    {statusLabel(provider?.status ?? "disconnected")}
                  </span>
                </div>

                <label className="field">
                  <span>API 키</span>
                  <input
                    autoComplete="off"
                    className="field__input"
                    onChange={(event) => onDraftChange(kind, "apiKey", event.target.value)}
                    value={draft.apiKey}
                  />
                </label>

                <label className="field">
                  <span>기본 URL</span>
                  <input
                    autoComplete="off"
                    className="field__input"
                    onChange={(event) => onDraftChange(kind, "baseUrl", event.target.value)}
                    placeholder={kind === "ollama" ? "http://127.0.0.1:11434" : "선택 사항"}
                    value={draft.baseUrl}
                  />
                </label>

                <div className="provider-card__actions">
                  <button disabled={isTesting} onClick={() => onTest(kind)} type="button">
                    {isTesting ? "연결 확인 중..." : "연결 확인"}
                  </button>
                  <button disabled={isSaving} onClick={() => onSave(kind)} type="button">
                    {isSaving ? "저장 중..." : "저장"}
                  </button>
                </div>

                {kind === "openai-codex" ? (
                  <div className="provider-card__actions provider-card__actions--stacked">
                    <button onClick={onConnectCodex} type="button">
                      Codex OAuth 연결
                    </button>
                    <button onClick={onImportCodex} type="button">
                      CLI 인증 가져오기
                    </button>
                    <button onClick={onLogoutCodex} type="button">
                      로그아웃
                    </button>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
