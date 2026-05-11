import { CustomSelect } from "./ui/CustomSelect";
import { getModelOption } from "../model-catalog";
import {
  getReasoningLabel,
  getReasoningOptions,
  normalizeReasoningLevel,
} from "../reasoning-options";
import {
  providerKinds,
  providerLabels,
  type AgentHeartbeatRecord,
  type AgentRecord,
  type AgentSoulRecord,
  type ProviderKind,
  type ProviderSummary,
  type ReasoningLevel,
  type StandingOrdersRecord,
} from "../types";

export interface AgentDraft {
  name: string;
  providerKind: ProviderKind;
  model: string;
  reasoningLevel: ReasoningLevel;
}

export interface AgentHeartbeatDraft {
  enabled: boolean;
  intervalMinutes: string;
  instructions: string;
}

export type AgentSoulDraft = string;

interface AgentSettingsDialogProps {
  activeAgentId: string | null;
  agents: AgentRecord[];
  deletingAgentId: string | null;
  draft: AgentDraft;
  heartbeat: AgentHeartbeatRecord | null;
  heartbeatDraft: AgentHeartbeatDraft;
  modelsByProvider: Record<ProviderKind, string[]>;
  notice: string | null;
  onClose: () => void;
  onCreate: () => void;
  onDelete: (agentId: string) => void;
  onDraftChange: (draft: AgentDraft) => void;
  onHeartbeatDraftChange: (draft: AgentHeartbeatDraft) => void;
  onSave: () => void;
  onSaveStandingOrders: () => void;
  onSoulDraftChange: (content: AgentSoulDraft) => void;
  onStandingOrdersDraftChange: (content: string) => void;
  open: boolean;
  providers: ProviderSummary[];
  saving: boolean;
  savingStandingOrders: boolean;
  soul: AgentSoulRecord | null;
  soulDraft: AgentSoulDraft;
  standingOrders: StandingOrdersRecord | null;
  standingOrdersDraft: string;
}

const DEFAULT_AGENT_ID = "default-agent";

function isProviderEnabled(provider: ProviderSummary | null | undefined) {
  return Boolean(provider && (provider.configured || provider.status !== "disconnected"));
}

function getProviderStatusLabel(provider: ProviderSummary | null | undefined) {
  if (!provider) {
    return "설정 없음";
  }

  return isProviderEnabled(provider) ? "사용 가능" : "설정 필요";
}

function getAgentSummary(agent: AgentRecord) {
  return `${providerLabels[agent.providerKind]} / ${getModelOption(agent.providerKind, agent.model).label} / ${getReasoningLabel(
    agent.providerKind,
    agent.model,
    agent.reasoningLevel,
  )}`;
}

function formatMaybeDateString(value: string | null) {
  if (!value) {
    return "기록 없음";
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(parsed));
}

export function AgentSettingsDialog({
  activeAgentId,
  agents,
  deletingAgentId,
  draft,
  heartbeat,
  heartbeatDraft,
  modelsByProvider,
  notice,
  onClose,
  onCreate,
  onDelete,
  onDraftChange,
  onHeartbeatDraftChange,
  onSave,
  onSaveStandingOrders,
  onSoulDraftChange,
  onStandingOrdersDraftChange,
  open,
  providers,
  saving,
  savingStandingOrders,
  soul,
  soulDraft,
  standingOrders,
  standingOrdersDraft,
}: AgentSettingsDialogProps) {
  if (!open) {
    return null;
  }

  const activeAgent = agents.find((agent) => agent.id === activeAgentId) ?? null;
  const provider = providers.find((item) => item.kind === draft.providerKind) ?? null;
  const providerModels = modelsByProvider[draft.providerKind] ?? [];
  const modelOptions = providerModels.length ? providerModels : [draft.model];
  const reasoningOptions = getReasoningOptions(draft.providerKind, draft.model);
  const canDeleteActiveAgent = Boolean(activeAgent && activeAgent.id !== DEFAULT_AGENT_ID);

  return (
    <div
      className="provider-dialog-backdrop provider-dialog-backdrop--agent-settings"
      role="presentation"
      onClick={onClose}
    >
      <div
        aria-label="에이전트 설정"
        className="modal-card modal-card--settings modal-card--agent-settings"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-card__header modal-card__header--spacious">
          <div>
            <h2>에이전트 설정</h2>
            <p className="modal-card__lede">
              {activeAgent?.name ?? "선택된 에이전트 없음"} / {getProviderStatusLabel(provider)}
            </p>
          </div>
          <button className="icon-button" onClick={onClose} type="button">
            닫기
          </button>
        </div>

        {notice ? <div className="notice-banner">{notice}</div> : null}

        <div className="settings-stack">
          <section className="settings-card">
            <div className="settings-card__title-row">
              <div>
                <h3 style={{ margin: 0 }}>현재 에이전트</h3>
                <p style={{ margin: "0.35rem 0 0", color: "var(--muted)" }}>
                  {activeAgent ? getAgentSummary(activeAgent) : "아직 선택된 에이전트가 없습니다."}
                </p>
              </div>

              <div className="agent-settings__toolbar">
                <button className="ghost-button" onClick={onCreate} type="button">
                  새 에이전트
                </button>
                <button
                  className="ghost-button agent-settings__delete-button"
                  disabled={!canDeleteActiveAgent || deletingAgentId === activeAgent?.id}
                  onClick={() => {
                    if (activeAgent) {
                      onDelete(activeAgent.id);
                    }
                  }}
                  type="button"
                >
                  {deletingAgentId === activeAgent?.id ? "삭제 중..." : "에이전트 삭제"}
                </button>
              </div>
            </div>

            {activeAgent?.id === DEFAULT_AGENT_ID ? (
              <p className="agent-settings__helper">
                기본 에이전트는 삭제할 수 없습니다. 별도 에이전트를 만든 뒤 정리해 주세요.
              </p>
            ) : null}

            <div className="agent-settings__section-stack">
              <div className="tab-pane agent-settings__section">
                <div className="settings-card__header">
                  <h3>일반 설정</h3>
                  <p>에이전트 이름, 기본 공급자, 모델과 추론 강도를 관리합니다.</p>
                </div>
                <div className="settings-card__fields">
                  <label className="field">
                    <span>에이전트 이름</span>
                    <input
                      autoComplete="off"
                      className="field__input"
                      onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
                      value={draft.name}
                    />
                  </label>

                  <label className="field">
                    <span>기본 공급자</span>
                    <CustomSelect
                      ariaLabel="기본 공급자"
                      className="field__input"
                      onChange={(value) => {
                        const providerKind = value as ProviderKind;
                        const nextModel = modelsByProvider[providerKind]?.[0] ?? draft.model;
                        onDraftChange({
                          ...draft,
                          providerKind,
                          model: nextModel,
                          reasoningLevel: normalizeReasoningLevel(
                            providerKind,
                            nextModel,
                            draft.reasoningLevel,
                          ),
                        });
                      }}
                      value={draft.providerKind}
                      options={providerKinds
                        .filter((kind) => {
                          const item = providers.find((p) => p.kind === kind);
                          return isProviderEnabled(item);
                        })
                        .map((kind) => {
                          const item = providers.find((p) => p.kind === kind);
                          return {
                            value: kind,
                            label: `${providerLabels[kind]} / ${getProviderStatusLabel(item)}`,
                          };
                        })}
                    />
                  </label>

                  <label className="field">
                    <span>기본 모델</span>
                    <CustomSelect
                      className="field__input"
                      onChange={(value) => {
                        const model = value;
                        onDraftChange({
                          ...draft,
                          model,
                          reasoningLevel: normalizeReasoningLevel(
                            draft.providerKind,
                            model,
                            draft.reasoningLevel,
                          ),
                        });
                      }}
                      value={draft.model}
                      options={modelOptions.map((model) => ({
                        value: model,
                        label: getModelOption(draft.providerKind, model).label,
                      }))}
                    />
                  </label>

                  <label className="field">
                    <span>추론 강도</span>
                    <CustomSelect
                      className="field__input"
                      onChange={(value) =>
                        onDraftChange({
                          ...draft,
                          reasoningLevel: value as ReasoningLevel,
                        })
                      }
                      value={draft.reasoningLevel}
                      options={reasoningOptions.map((option) => ({
                        value: option.value,
                        label: option.label,
                      }))}
                    />
                  </label>
                </div>
              </div>

              <div className="tab-pane agent-settings__section">
                <div className="settings-card__header">
                  <h3>SOUL.md</h3>
                  <p>에이전트의 정체성, 말투, 장기 운영 지침을 기록합니다.</p>
                </div>

                <div className="settings-card__fields">
                  <label className="field">
                    <span>SOUL.md 내용</span>
                    <textarea
                      aria-label="SOUL content"
                      className="field__input"
                      onChange={(event) => onSoulDraftChange(event.target.value)}
                      placeholder={"# SOUL\n\n에이전트의 성격, 역할, 장기 운영 원칙을 적어 주세요."}
                      rows={14}
                      style={{
                        minHeight: "20rem",
                        resize: "vertical",
                        fontFamily: "monospace",
                        fontSize: "0.85rem",
                        lineHeight: 1.6,
                      }}
                      value={soulDraft}
                    />
                  </label>
                  <small className="text-muted">현재 파일: {soul?.path ?? "SOUL.md"}</small>
                </div>
              </div>

              <div className="tab-pane agent-settings__section">
                <div className="settings-card__header">
                  <h3>Heartbeat 자동화</h3>
                  <p>반복 점검에 사용할 백그라운드 지침입니다.</p>
                </div>

                <div className="settings-card__fields">
                  <div className="field field--inline">
                    <span>Heartbeat 활성화</span>
                    <button
                      aria-checked={heartbeatDraft.enabled}
                      className={`settings-toggle${heartbeatDraft.enabled ? " is-on" : ""}`}
                      onClick={() =>
                        onHeartbeatDraftChange({
                          ...heartbeatDraft,
                          enabled: !heartbeatDraft.enabled,
                        })
                      }
                      role="switch"
                      type="button"
                    />
                  </div>

                  <label className="field">
                    <span>반복 주기(분)</span>
                    <input
                      aria-label="Interval minutes"
                      className="field__input"
                      min={1}
                      onChange={(event) =>
                        onHeartbeatDraftChange({
                          ...heartbeatDraft,
                          intervalMinutes: event.target.value,
                        })
                      }
                      step={1}
                      type="number"
                      value={heartbeatDraft.intervalMinutes}
                    />
                  </label>

                  <label className="field">
                    <span>Heartbeat 지침</span>
                    <textarea
                      aria-label="Heartbeat instructions"
                      className="field__input"
                      onChange={(event) =>
                        onHeartbeatDraftChange({
                          ...heartbeatDraft,
                          instructions: event.target.value,
                        })
                      }
                      placeholder="활성 작업을 점검하고, 진행 상황과 다음 단계를 요약해 주세요."
                      rows={6}
                      style={{ minHeight: "8rem", resize: "vertical" }}
                      value={heartbeatDraft.instructions}
                    />
                  </label>

                  <div className="agent-settings__heartbeat-meta">
                    <span>마지막 실행: {formatMaybeDateString(heartbeat?.lastRun ?? null)}</span>
                    {heartbeat?.parseError ? (
                      <span className="agent-settings__heartbeat-error">
                        파싱 오류: {heartbeat.parseError}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="tab-pane agent-settings__section">
                <div className="settings-card__header">
                  <h3>상시 지침</h3>
                  <p>에이전트 범위의 STANDING_ORDERS.md에서 불러오는 지속 지침입니다.</p>
                </div>

                <div className="settings-card__fields">
                  <label className="field">
                    <span>상시 지침 파일</span>
                    <input
                      className="field__input"
                      readOnly
                      value={standingOrders?.path ?? "STANDING_ORDERS.md"}
                    />
                  </label>

                  <label className="field">
                    <span>상시 지침 내용</span>
                    <textarea
                      aria-label="Standing orders content"
                      className="field__input"
                      onChange={(event) => onStandingOrdersDraftChange(event.target.value)}
                      placeholder="# Standing Orders\n\n에이전트가 유지해야 할 운영 지침을 적어 주세요."
                      rows={14}
                      style={{
                        minHeight: "20rem",
                        resize: "vertical",
                        fontFamily: "monospace",
                        fontSize: "0.85rem",
                        lineHeight: 1.6,
                      }}
                      value={standingOrdersDraft}
                    />
                  </label>

                  <div className="settings-card__actions agent-settings__actions">
                    <button
                      className="ghost-button"
                      disabled={savingStandingOrders}
                      onClick={onSaveStandingOrders}
                      type="button"
                    >
                      {savingStandingOrders ? "저장 중..." : "상시 지침 저장"}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="settings-card__actions agent-settings__actions">
              <button
                className="primary-button"
                disabled={saving || !draft.name.trim()}
                onClick={onSave}
                type="button"
              >
                {saving ? "저장 중..." : "에이전트 설정 저장"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
