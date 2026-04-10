import type { ProviderDraft, ProviderKind, ProviderSummary } from "../types";

interface ProviderSettingsDialogProps {
  open: boolean;
  providers: ProviderSummary[];
  drafts: Record<ProviderKind, ProviderDraft>;
  savingKind: ProviderKind | null;
  testingKind: ProviderKind | null;
  notice: string | null;
  onClose: () => void;
  onDraftChange: (
    kind: Exclude<ProviderKind, "openai-codex">,
    field: keyof ProviderDraft,
    value: string,
  ) => void;
  onSave: (kind: Exclude<ProviderKind, "openai-codex">) => void;
  onTest: (kind: ProviderKind) => void;
  onConnectCodex: () => void;
  onImportCodex: () => void;
  onLogoutCodex: () => void;
}

const providerDescriptions: Record<ProviderKind, string> = {
  openai: "GPT 모델과 Responses API",
  anthropic: "Claude 모델과 Messages API",
  gemini: "Google AI 기반 Gemini 모델",
  ollama: "로컬 추론용 HTTP 엔드포인트",
  "openai-codex": "ChatGPT OAuth 기반 Codex 연결",
};

function providerEnabled(provider: ProviderSummary) {
  return provider.status !== "disconnected" || provider.configured;
}

export function ProviderSettingsDialog(props: ProviderSettingsDialogProps) {
  if (!props.open) {
    return null;
  }

  const codexProvider =
    props.providers.find((provider) => provider.kind === "openai-codex") ?? null;

  return (
    <div className="modal-backdrop" onClick={props.onClose} role="presentation">
      <div
        aria-modal="true"
        className="modal-card modal-card--settings"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-card__header modal-card__header--spacious">
          <div>
            <p className="eyebrow">프로바이더 설정</p>
            <h2>AI 연결을 설정하세요</h2>
            <p className="modal-card__lede">
              이 작업 공간에서 사용할 API 키, 로컬 엔드포인트, ChatGPT OAuth 기반 Codex 연결을
              관리할 수 있습니다.
            </p>
          </div>
          <button className="ghost-button" onClick={props.onClose} type="button">
            닫기
          </button>
        </div>

        {props.notice ? <p className="settings-notice">{props.notice}</p> : null}

        <div className="settings-stack">
          {props.providers
            .filter((provider) => provider.kind !== "openai-codex")
            .map((provider) => {
              const draft = props.drafts[provider.kind];
              const busy =
                props.savingKind === provider.kind || props.testingKind === provider.kind;

              return (
                <section className="settings-card" key={provider.kind}>
                  <div className="settings-card__header">
                    <div>
                      <div className="settings-card__title-row">
                        <h3>{provider.label}</h3>
                        <span
                          className={`settings-toggle ${providerEnabled(provider) ? "is-on" : ""}`}
                        />
                      </div>
                      <p>{providerDescriptions[provider.kind]}</p>
                    </div>
                  </div>

                  <div className="settings-card__fields">
                    {provider.kind === "ollama" ? (
                      <>
                        <label className="field">
                          <span>Base URL</span>
                          <input
                            onChange={(event) =>
                              props.onDraftChange("ollama", "baseUrl", event.target.value)
                            }
                            placeholder="http://127.0.0.1:11434"
                            value={draft.baseUrl}
                          />
                        </label>
                        <div className="field">
                          <span>모델</span>
                          <div className="settings-static-value">
                            메인 채팅 화면에서 대화별로 설정합니다.
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <label className="field">
                          <span>API 키</span>
                          <input
                            autoComplete="off"
                            onChange={(event) =>
                              props.onDraftChange(
                                provider.kind as Exclude<ProviderKind, "openai-codex">,
                                "apiKey",
                                event.target.value,
                              )
                            }
                            placeholder="프로바이더 API 키를 입력하세요"
                            type="password"
                            value={draft.apiKey}
                          />
                        </label>
                        <div className="field">
                          <span>기본 모델</span>
                          <div className="settings-static-value">
                            모델 선택은 채팅 화면에서 대화별로 저장됩니다.
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="settings-card__actions">
                    <button
                      className="ghost-button"
                      disabled={busy}
                      onClick={() => props.onSave(provider.kind as Exclude<ProviderKind, "openai-codex">)}
                      type="button"
                    >
                      저장
                    </button>
                    <button
                      className="primary-button settings-card__test"
                      disabled={busy}
                      onClick={() => props.onTest(provider.kind)}
                      type="button"
                    >
                      연결 테스트
                    </button>
                  </div>
                </section>
              );
            })}

          <section className="settings-card settings-card--codex">
            <div className="settings-card__header">
              <div>
                <div className="settings-card__title-row">
                  <h3>OpenAI Codex</h3>
                  <span
                    className={`settings-toggle ${
                      codexProvider && providerEnabled(codexProvider) ? "is-on" : ""
                    }`}
                  />
                </div>
                <p>{providerDescriptions["openai-codex"]}</p>
              </div>
            </div>

            <div className="codex-account">
              <strong>{codexProvider?.displayName ?? "연결된 ChatGPT 계정이 없습니다"}</strong>
              <span>
                {codexProvider?.email ?? "OAuth로 연결하거나 Codex CLI auth.json을 가져오세요"}
              </span>
            </div>

            <div className="settings-card__actions settings-card__actions--wrap">
              <button className="ghost-button" onClick={props.onConnectCodex} type="button">
                OAuth로 연결
              </button>
              <button className="ghost-button" onClick={props.onImportCodex} type="button">
                CLI 인증 가져오기
              </button>
              <button
                className="primary-button settings-card__test"
                onClick={() => props.onTest("openai-codex")}
                type="button"
              >
                연결 테스트
              </button>
              <button className="ghost-button" onClick={props.onLogoutCodex} type="button">
                로그아웃
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
