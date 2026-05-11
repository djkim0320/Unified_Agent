import { useEffect, useState } from "react";
import { getTokenUsageSummary } from "../api";
import { getModelOption } from "../model-catalog";
import { getReasoningLabel } from "../reasoning-options";
import {
  providerKinds,
  providerLabels,
  type AgentHeartbeatRecord,
  type AgentRecord,
  type AutomationRuleRecord,
  type ConversationRecord,
  type EngineStatusRecord,
  type HeartbeatLogRecord,
  type PlatformMetadata,
  type ProviderKind,
  type ProviderSummary,
  type TokenUsageSummary,
} from "../types";

interface AutomationRuleDraft {
  title: string;
  prompt: string;
  intervalMinutes: string;
  enabled: boolean;
}

interface SettingsSectionViewProps {
  activeAgent: AgentRecord | null;
  activeConversation: ConversationRecord | null;
  automationRules: AutomationRuleRecord[];
  backendOnline: boolean | null;
  engineStatus: EngineStatusRecord | null;
  engineStatusLoading: boolean;
  heartbeat: AgentHeartbeatRecord | null;
  heartbeatLogs: HeartbeatLogRecord[];
  heartbeatTriggering: boolean;
  platformMetadata: PlatformMetadata | null;
  providers: ProviderSummary[];
  providerAuthPending: boolean;
  triggeringAutomationRuleIds: string[];
  onConnectCodex: () => void;
  onConnectOpenCodeOAuth: () => void;
  onCreateAutomationRule: (payload: {
    title: string;
    prompt: string;
    intervalMinutes: number;
    enabled: boolean;
  }) => void;
  onDeleteAutomationRule: (ruleId: string) => void;
  onImportCodex: () => void;
  onLogoutCodex: () => void;
  onOpenAgentSettings: () => void;
  onOpenProviderSettings: () => void;
  onRefreshEngineStatus: () => void;
  onRefreshOpenCodeModels: () => void;
  onRefreshPlatformMetadata: () => void;
  onTriggerAutomationRule: (ruleId: string) => void;
  onTriggerHeartbeat: () => void;
  onUpdateAutomationRule: (
    ruleId: string,
    payload: Partial<{
      title: string;
      prompt: string;
      intervalMinutes: number;
      enabled: boolean;
    }>,
  ) => void;
}

function createEmptyRuleDraft(): AutomationRuleDraft {
  return {
    title: "",
    prompt: "",
    intervalMinutes: "60",
    enabled: true,
  };
}

function createDraftFromRule(rule: AutomationRuleRecord): AutomationRuleDraft {
  return {
    title: rule.title,
    prompt: rule.prompt,
    intervalMinutes: String(rule.intervalMinutes),
    enabled: rule.enabled,
  };
}

function formatDate(value: number | string | null | undefined) {
  if (!value) {
    return "기록 없음";
  }

  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "기록 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    notation: value >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function displayPathName(value: string | null | undefined, fallback: string) {
  if (!value?.trim()) {
    return fallback;
  }
  if (value.includes("[path")) {
    return value;
  }
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) ?? fallback;
}

function providerStatusLabel(provider: ProviderSummary | undefined) {
  if (!provider) {
    return "미등록";
  }

  switch (provider.status) {
    case "connected":
      return "연결됨";
    case "configured":
      return "저장됨";
    default:
      return "연결 필요";
  }
}

function providerStatusTone(provider: ProviderSummary | undefined) {
  if (!provider || provider.status === "disconnected") {
    return "disconnected";
  }

  return provider.status;
}

function backendStatusLabel(backendOnline: boolean | null) {
  if (backendOnline === false) {
    return "서버 오프라인";
  }

  if (backendOnline === null) {
    return "확인 중";
  }

  return "정상";
}

function engineStatusLabel(engineStatus: EngineStatusRecord | null, loading: boolean) {
  if (loading) {
    return "확인 중";
  }

  if (!engineStatus) {
    return "미확인";
  }

  return engineStatus.available ? "사용 가능" : "확인 필요";
}

function engineStatusTone(engineStatus: EngineStatusRecord | null, loading: boolean) {
  if (loading) {
    return "configured";
  }

  return engineStatus?.available ? "connected" : "disconnected";
}

function authSummary(engineStatus: EngineStatusRecord | null) {
  const authProviders = engineStatus?.opencodeAuthProviders ?? [];
  if (authProviders.length > 0) {
    return authProviders.join(", ");
  }

  if (!engineStatus) {
    return "아직 상태를 확인하지 않았습니다.";
  }

  if (engineStatus.authStatus === "available") {
    return "opencode 인증 사용 가능";
  }

  if (engineStatus.authStatus === "unavailable") {
    return "opencode 인증 없음";
  }

  return "opencode 인증 상태 미확인";
}

function providerDetail(provider: ProviderSummary | undefined) {
  if (!provider) {
    return "로컬 저장소에 계정 정보가 없습니다.";
  }

  if (provider.email) {
    return provider.email;
  }

  if (provider.displayName) {
    return provider.displayName;
  }

  return provider.configured || provider.status !== "disconnected"
    ? "로컬 DB에 연결 정보가 저장되어 있습니다."
    : "연결 정보가 없습니다.";
}

function validateRuleDraft(draft: AutomationRuleDraft) {
  const intervalMinutes = Number.parseInt(draft.intervalMinutes, 10);
  if (!draft.title.trim()) {
    return { error: "규칙 제목을 입력하세요.", intervalMinutes };
  }
  if (!draft.prompt.trim()) {
    return { error: "자동화할 지시문을 입력하세요.", intervalMinutes };
  }
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1) {
    return { error: "반복 주기는 1분 이상의 정수여야 합니다.", intervalMinutes };
  }
  return { error: null, intervalMinutes };
}

export function SettingsSectionView({
  activeAgent,
  activeConversation,
  automationRules,
  backendOnline,
  engineStatus,
  engineStatusLoading,
  heartbeat,
  heartbeatLogs,
  heartbeatTriggering,
  platformMetadata,
  providers,
  providerAuthPending,
  triggeringAutomationRuleIds,
  onConnectCodex,
  onConnectOpenCodeOAuth,
  onCreateAutomationRule,
  onDeleteAutomationRule,
  onImportCodex,
  onLogoutCodex,
  onOpenAgentSettings,
  onOpenProviderSettings,
  onRefreshEngineStatus,
  onRefreshOpenCodeModels,
  onRefreshPlatformMetadata,
  onTriggerAutomationRule,
  onTriggerHeartbeat,
  onUpdateAutomationRule,
}: SettingsSectionViewProps) {
  const [newRuleDraft, setNewRuleDraft] = useState<AutomationRuleDraft>(createEmptyRuleDraft);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingRuleDraft, setEditingRuleDraft] = useState<AutomationRuleDraft>(createEmptyRuleDraft);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageSummary | null>(null);
  const [tokenUsageError, setTokenUsageError] = useState<string | null>(null);

  const configuredProviderCount = providers.filter(
    (provider) => provider.configured || provider.status !== "disconnected",
  ).length;
  const providerMap = new Map<ProviderKind, ProviderSummary>(
    providers.map((provider) => [provider.kind, provider]),
  );
  const activeModel = activeConversation
    ? getModelOption(activeConversation.providerKind, activeConversation.model)
    : null;
  const activeReasoning = activeConversation
    ? getReasoningLabel(
        activeConversation.providerKind,
        activeConversation.model,
        activeConversation.reasoningLevel,
      )
    : "선택 없음";
  const configuredSyncEntries =
    engineStatus?.credentialSync?.entries.filter((entry) => entry.configured) ?? [];
  const latestHeartbeat = heartbeatLogs[0] ?? null;
  const triggeringRuleIds = new Set(triggeringAutomationRuleIds);

  useEffect(() => {
    const controller = new AbortController();
    getTokenUsageSummary(controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setTokenUsage(response.usage);
          setTokenUsageError(null);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setTokenUsageError(error instanceof Error ? error.message : "토큰 사용량을 불러오지 못했습니다.");
        }
      });
    return () => controller.abort();
  }, []);

  function submitNewRule() {
    const validation = validateRuleDraft(newRuleDraft);
    if (validation.error) {
      setDraftError(validation.error);
      return;
    }
    setDraftError(null);
    onCreateAutomationRule({
      title: newRuleDraft.title.trim(),
      prompt: newRuleDraft.prompt.trim(),
      intervalMinutes: validation.intervalMinutes,
      enabled: newRuleDraft.enabled,
    });
    setNewRuleDraft(createEmptyRuleDraft());
  }

  function submitEditRule(ruleId: string) {
    const validation = validateRuleDraft(editingRuleDraft);
    if (validation.error) {
      setDraftError(validation.error);
      return;
    }
    setDraftError(null);
    onUpdateAutomationRule(ruleId, {
      title: editingRuleDraft.title.trim(),
      prompt: editingRuleDraft.prompt.trim(),
      intervalMinutes: validation.intervalMinutes,
      enabled: editingRuleDraft.enabled,
    });
    setEditingRuleId(null);
  }

  return (
    <div className="settings-view" aria-label="설정 탭" role="region">
      <section className="settings-view__hero">
        <div>
          <p className="eyebrow">AetherOps 설정</p>
          <h1>로컬 실행 환경을 한곳에서 관리합니다</h1>
          <p>
            API/OAuth 연결, opencode 엔진 상태, 에이전트 기본값, Heartbeat, 사용자 정의 자동화
            규칙을 같은 화면에서 확인하고 조정합니다.
          </p>
        </div>
        <div className="settings-view__hero-actions">
          <button className="cockpit-mini-button is-primary" onClick={onOpenProviderSettings} type="button">
            API / OAuth 관리
          </button>
          <button className="cockpit-mini-button" onClick={onOpenAgentSettings} type="button">
            에이전트 설정
          </button>
        </div>
      </section>

      <section className="settings-view__quick-grid" aria-label="설정 요약">
        <div className="settings-summary-chip">
          <span>백엔드</span>
          <strong>{backendStatusLabel(backendOnline)}</strong>
        </div>
        <div className="settings-summary-chip">
          <span>opencode</span>
          <strong>{engineStatusLabel(engineStatus, engineStatusLoading)}</strong>
        </div>
        <div className="settings-summary-chip">
          <span>연결 공급자</span>
          <strong>{configuredProviderCount}</strong>
        </div>
        <div className="settings-summary-chip">
          <span>자동화 규칙</span>
          <strong>{automationRules.length}</strong>
        </div>
        <div className="settings-summary-chip">
          <span>누적 토큰</span>
          <strong>{tokenUsage ? formatCompactNumber(tokenUsage.totalTokens) : "확인 중"}</strong>
        </div>
      </section>

      <div className="settings-view__grid">
        <section className="settings-panel settings-panel--wide">
          <div className="settings-panel__header">
            <div>
              <p className="settings-panel__eyebrow">Execution Engine</p>
              <h2>opencode 엔진</h2>
              <p>
                AetherOps는 관제와 스케줄링을 맡고, 실제 워크스페이스 작업은 opencode 실행
                엔진에 위임합니다.
              </p>
            </div>
            <span className={`status-pill status-pill--${engineStatusTone(engineStatus, engineStatusLoading)}`}>
              {engineStatusLabel(engineStatus, engineStatusLoading)}
            </span>
          </div>

          <div className="settings-kv-grid">
            <div>
              <span>실행 파일</span>
              <strong title={engineStatus?.executable ?? undefined}>
                {displayPathName(engineStatus?.executable, "opencode")}
              </strong>
            </div>
            <div>
              <span>소스</span>
              <strong>{engineStatus?.executableSource ?? "미확인"}</strong>
            </div>
            <div>
              <span>버전</span>
              <strong>{engineStatus?.version ?? engineStatus?.managedPackageVersion ?? "미확인"}</strong>
            </div>
            <div>
              <span>모델 캐시</span>
              <strong>{engineStatus?.models.length ?? 0}</strong>
            </div>
            <div>
              <span>OAuth/Auth</span>
              <strong>{authSummary(engineStatus)}</strong>
            </div>
            <div>
              <span>Config dir</span>
              <strong title={engineStatus?.configDir ?? undefined}>
                {displayPathName(engineStatus?.configDir, "기본 opencode 설정")}
              </strong>
            </div>
            <div>
              <span>권한 자동 승인</span>
              <strong>{engineStatus?.environment.autoApprovePermissions ? "켜짐" : "꺼짐"}</strong>
            </div>
          </div>

          {engineStatus?.environment.autoApprovePermissions ? (
            <div className="settings-warning">
              opencode 권한 자동 승인이 켜져 있습니다. 로컬 검증이나 신뢰할 수 있는 세션에서만 사용하세요.
            </div>
          ) : null}

          {engineStatus?.lastFailure ? (
            <div className="settings-warning">최근 opencode 오류: {engineStatus.lastFailure}</div>
          ) : null}

          <div className="settings-action-row">
            <button className="cockpit-mini-button" disabled={engineStatusLoading} onClick={onRefreshEngineStatus} type="button">
              상태 새로고침
            </button>
            <button
              className="cockpit-mini-button"
              disabled={engineStatusLoading || !engineStatus?.available}
              onClick={onRefreshOpenCodeModels}
              type="button"
            >
              모델 캐시 갱신
            </button>
            <button
              className="cockpit-mini-button is-primary"
              disabled={engineStatusLoading || providerAuthPending || !engineStatus?.available}
              onClick={onConnectOpenCodeOAuth}
              type="button"
            >
              {providerAuthPending ? "연결 처리 중..." : "opencode OAuth 연결"}
            </button>
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-panel__header">
            <div>
              <p className="settings-panel__eyebrow">Provider Profiles</p>
              <h2>API / OAuth 연결</h2>
              <p>
                자격 증명은 로컬 DB에 암호화되어 저장되고, opencode 실행 시점에만 환경으로
                전달됩니다.
              </p>
            </div>
          </div>

          <div className="settings-provider-list">
            {providerKinds.map((kind) => {
              const provider = providerMap.get(kind);
              return (
                <div className="settings-provider-item" key={kind}>
                  <div>
                    <strong>{providerLabels[kind]}</strong>
                    <span>{providerDetail(provider)}</span>
                  </div>
                  <span className={`status-pill status-pill--${providerStatusTone(provider)}`}>
                    {providerStatusLabel(provider)}
                  </span>
                </div>
              );
            })}
          </div>

          {configuredSyncEntries.length > 0 ? (
            <div className="settings-note">
              opencode 전달 대상:{" "}
              {configuredSyncEntries
                .map((entry) => `${providerLabels[entry.providerKind]} -> ${entry.opencodeProvider}`)
                .join(", ")}
            </div>
          ) : (
            <div className="settings-note">아직 opencode로 전달할 API 프로필이 없습니다.</div>
          )}

          <div className="settings-action-row">
            <button className="cockpit-mini-button is-primary" onClick={onOpenProviderSettings} type="button">
              API 연결 관리
            </button>
            <button className="cockpit-mini-button" disabled={providerAuthPending} onClick={onConnectCodex} type="button">
              Codex OAuth
            </button>
            <button className="cockpit-mini-button" disabled={providerAuthPending} onClick={onImportCodex} type="button">
              Codex CLI 가져오기
            </button>
            <button className="cockpit-mini-button" disabled={providerAuthPending} onClick={onLogoutCodex} type="button">
              Codex 해제
            </button>
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-panel__header">
            <div>
              <p className="settings-panel__eyebrow">Token Usage</p>
              <h2>토큰 사용량</h2>
              <p>opencode 실행 이벤트가 보고한 모델 토큰 사용량을 로컬 기록에서 집계합니다.</p>
            </div>
          </div>

          <div className="settings-token-meter">
            <div>
              <span>총 사용량</span>
              <strong>{formatNumber(tokenUsage?.totalTokens ?? 0)}</strong>
              <small>tokens</small>
            </div>
            <div>
              <span>입력</span>
              <strong>{formatNumber(tokenUsage?.inputTokens ?? 0)}</strong>
            </div>
            <div>
              <span>출력</span>
              <strong>{formatNumber(tokenUsage?.outputTokens ?? 0)}</strong>
            </div>
            <div>
              <span>집계 Run</span>
              <strong>{formatNumber(tokenUsage?.runsWithUsage ?? 0)}</strong>
            </div>
          </div>

          {tokenUsage?.cacheReadTokens || tokenUsage?.cacheWriteTokens ? (
            <div className="settings-note">
              캐시 읽기 {formatNumber(tokenUsage.cacheReadTokens)} / 캐시 쓰기 {formatNumber(tokenUsage.cacheWriteTokens)}
            </div>
          ) : null}

          {tokenUsage?.byModel.length ? (
            <div className="settings-token-list">
              {tokenUsage.byModel.slice(0, 4).map((item) => (
                <div className="settings-token-row" key={`${item.providerKind}-${item.model}`}>
                  <div>
                    <strong>{item.model}</strong>
                    <span>{item.providerKind ?? "provider"} / {item.runsWithUsage} runs</span>
                  </div>
                  <em>{formatNumber(item.totalTokens)}</em>
                </div>
              ))}
            </div>
          ) : (
            <div className="settings-note">아직 토큰 사용량을 보고한 opencode Run이 없습니다.</div>
          )}

          {tokenUsageError ? <div className="settings-warning">{tokenUsageError}</div> : null}
          <div className="settings-note">{tokenUsage?.note ?? "사용량은 모델 이벤트가 제공할 때만 표시됩니다."}</div>
        </section>

        <section className="settings-panel">
          <div className="settings-panel__header">
            <div>
              <p className="settings-panel__eyebrow">Agent Defaults</p>
              <h2>에이전트 기본값</h2>
              <p>새 작업을 시작할 때 사용할 기본 에이전트, 세션, 모델, 추론 강도입니다.</p>
            </div>
          </div>

          <div className="settings-kv-list">
            <div>
              <span>활성 에이전트</span>
              <strong>{activeAgent?.name ?? "선택 없음"}</strong>
            </div>
            <div>
              <span>활성 세션</span>
              <strong>{activeConversation?.title ?? "선택 없음"}</strong>
            </div>
            <div>
              <span>채팅 모델</span>
              <strong>
                {activeConversation
                  ? `${providerLabels[activeConversation.providerKind]} / ${
                      activeModel?.label ?? activeConversation.model
                    }`
                  : "선택 없음"}
              </strong>
            </div>
            <div>
              <span>추론 강도</span>
              <strong>{activeReasoning}</strong>
            </div>
          </div>

          <div className="settings-note">
            모델은 채팅 입력창의 모델 메뉴에서 세션별로 선택합니다. 이 패널은 기본값과 장기
            실행 지침만 관리합니다.
          </div>

          <div className="settings-action-row">
            <button className="cockpit-mini-button is-primary" onClick={onOpenAgentSettings} type="button">
              에이전트 설정 열기
            </button>
          </div>
        </section>

        <section className="settings-panel settings-panel--wide">
          <div className="settings-panel__header">
            <div>
              <p className="settings-panel__eyebrow">Automation</p>
              <h2>장기 자동화</h2>
              <p>
                Heartbeat는 기본 점검 루프이고, 사용자 정의 규칙은 정해진 주기마다 opencode
                작업을 예약합니다.
              </p>
            </div>
          </div>

          <div className="settings-automation-grid">
            <section className="settings-automation-card">
              <div className="settings-panel__header">
                <div>
                  <p className="settings-panel__eyebrow">Built-in Rule</p>
                  <h3>Heartbeat</h3>
                </div>
                <span className={`status-pill status-pill--${heartbeat?.enabled ? "connected" : "disconnected"}`}>
                  {heartbeat?.enabled ? "켜짐" : "꺼짐"}
                </span>
              </div>

              <div className="settings-kv-list">
                <div>
                  <span>주기</span>
                  <strong>{heartbeat?.enabled ? `${heartbeat.intervalMinutes}분` : "비활성화"}</strong>
                </div>
                <div>
                  <span>마지막 실행</span>
                  <strong>{formatDate(heartbeat?.lastRun)}</strong>
                </div>
                <div>
                  <span>최근 로그</span>
                  <strong>{latestHeartbeat ? `${latestHeartbeat.status} / ${formatDate(latestHeartbeat.updatedAt)}` : "없음"}</strong>
                </div>
              </div>

              {heartbeat?.parseError ? <div className="settings-warning">{heartbeat.parseError}</div> : null}

              <div className="settings-action-row">
                <button
                  className="cockpit-mini-button"
                  disabled={heartbeatTriggering}
                  onClick={onTriggerHeartbeat}
                  type="button"
                >
                  {heartbeatTriggering ? "실행 중..." : "지금 실행"}
                </button>
                <button className="cockpit-mini-button" onClick={onOpenAgentSettings} type="button">
                  Heartbeat 편집
                </button>
              </div>
            </section>

            <section className="settings-automation-card">
              <div className="settings-panel__header">
                <div>
                  <p className="settings-panel__eyebrow">User Rules</p>
                  <h3>사용자 정의 규칙</h3>
                  <p>정기 조사, 파일 정리, 회고 작성처럼 반복되는 opencode 작업을 예약합니다.</p>
                </div>
                <span className="status-pill status-pill--configured">{automationRules.length}</span>
              </div>

              <div className="settings-form-grid">
                <label className="settings-field">
                  <span>규칙 이름</span>
                  <input
                    onChange={(event) => setNewRuleDraft((draft) => ({ ...draft, title: event.target.value }))}
                    placeholder="예: 매일 연구 노트 정리"
                    type="text"
                    value={newRuleDraft.title}
                  />
                </label>
                <label className="settings-field">
                  <span>반복 주기(분)</span>
                  <input
                    min={1}
                    onChange={(event) =>
                      setNewRuleDraft((draft) => ({ ...draft, intervalMinutes: event.target.value }))
                    }
                    type="number"
                    value={newRuleDraft.intervalMinutes}
                  />
                </label>
                <label className="settings-field settings-field--wide">
                  <span>opencode에 전달할 지시문</span>
                  <textarea
                    onChange={(event) => setNewRuleDraft((draft) => ({ ...draft, prompt: event.target.value }))}
                    placeholder="예: 현재 세션의 변경 파일과 작업 로그를 요약하고 다음 실행 계획을 작성해줘."
                    rows={4}
                    value={newRuleDraft.prompt}
                  />
                </label>
                <label className="settings-inline-toggle">
                  <input
                    checked={newRuleDraft.enabled}
                    onChange={(event) => setNewRuleDraft((draft) => ({ ...draft, enabled: event.target.checked }))}
                    type="checkbox"
                  />
                  생성 즉시 활성화
                </label>
              </div>

              {draftError ? <div className="settings-warning">{draftError}</div> : null}

              <div className="settings-action-row">
                <button className="cockpit-mini-button is-primary" onClick={submitNewRule} type="button">
                  규칙 추가
                </button>
              </div>

              <div className="settings-rule-list">
                {automationRules.length === 0 ? (
                  <div className="settings-note">아직 사용자 정의 자동화 규칙이 없습니다.</div>
                ) : (
                  automationRules.map((rule) => {
                    const isEditing = editingRuleId === rule.id;
                    return (
                      <article className="settings-rule-item" key={rule.id}>
                        {isEditing ? (
                          <>
                            <div className="settings-form-grid">
                              <label className="settings-field">
                                <span>규칙 이름</span>
                                <input
                                  onChange={(event) =>
                                    setEditingRuleDraft((draft) => ({ ...draft, title: event.target.value }))
                                  }
                                  type="text"
                                  value={editingRuleDraft.title}
                                />
                              </label>
                              <label className="settings-field">
                                <span>반복 주기(분)</span>
                                <input
                                  min={1}
                                  onChange={(event) =>
                                    setEditingRuleDraft((draft) => ({
                                      ...draft,
                                      intervalMinutes: event.target.value,
                                    }))
                                  }
                                  type="number"
                                  value={editingRuleDraft.intervalMinutes}
                                />
                              </label>
                              <label className="settings-field settings-field--wide">
                                <span>지시문</span>
                                <textarea
                                  onChange={(event) =>
                                    setEditingRuleDraft((draft) => ({ ...draft, prompt: event.target.value }))
                                  }
                                  rows={4}
                                  value={editingRuleDraft.prompt}
                                />
                              </label>
                              <label className="settings-inline-toggle">
                                <input
                                  checked={editingRuleDraft.enabled}
                                  onChange={(event) =>
                                    setEditingRuleDraft((draft) => ({ ...draft, enabled: event.target.checked }))
                                  }
                                  type="checkbox"
                                />
                                활성화
                              </label>
                            </div>
                            <div className="settings-action-row">
                              <button className="cockpit-mini-button is-primary" onClick={() => submitEditRule(rule.id)} type="button">
                                저장
                              </button>
                              <button className="cockpit-mini-button" onClick={() => setEditingRuleId(null)} type="button">
                                취소
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="settings-rule-item__header">
                              <div>
                                <strong>{rule.title}</strong>
                                <span>{rule.prompt.slice(0, 140) || "지시문 없음"}</span>
                              </div>
                              <span className={`status-pill status-pill--${rule.enabled ? "connected" : "disconnected"}`}>
                                {rule.enabled ? "활성" : "중지"}
                              </span>
                            </div>
                            <div className="settings-rule-meta">
                              <span>주기 {rule.intervalMinutes}분</span>
                              <span>다음 {formatDate(rule.nextRunAt)}</span>
                              <span>마지막 {formatDate(rule.lastRunAt)}</span>
                              <span>실행 {rule.runCount}회</span>
                            </div>
                            <div className="settings-action-row">
                              <button
                                className="cockpit-mini-button is-primary"
                                disabled={triggeringRuleIds.has(rule.id)}
                                onClick={() => onTriggerAutomationRule(rule.id)}
                                type="button"
                              >
                                {triggeringRuleIds.has(rule.id) ? "실행 중..." : "지금 실행"}
                              </button>
                              <button
                                className="cockpit-mini-button"
                                onClick={() => onUpdateAutomationRule(rule.id, { enabled: !rule.enabled })}
                                type="button"
                              >
                                {rule.enabled ? "일시중지" : "활성화"}
                              </button>
                              <button
                                className="cockpit-mini-button"
                                onClick={() => {
                                  setEditingRuleId(rule.id);
                                  setEditingRuleDraft(createDraftFromRule(rule));
                                  setDraftError(null);
                                }}
                                type="button"
                              >
                                수정
                              </button>
                              <button className="cockpit-mini-button" onClick={() => onDeleteAutomationRule(rule.id)} type="button">
                                삭제
                              </button>
                            </div>
                          </>
                        )}
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-panel__header">
            <div>
              <p className="settings-panel__eyebrow">Safety Boundary</p>
              <h2>안전 경계</h2>
              <p>현재 AetherOps는 숨겨진 내부 tool/browser/skill 루프 없이 opencode-only 구조로 동작합니다.</p>
            </div>
          </div>

          <div className="settings-check-list">
            <span>내부 직접 실행 루프 제거됨</span>
            <span>세션 sandbox는 workspace/opencode 아래로 고정</span>
            <span>API 키는 로컬 암호화 저장 후 실행 시점에만 전달</span>
            <span>플러그인, MCP, 브라우저 기능은 opencode 설정 경로로 연결</span>
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-panel__header">
            <div>
              <p className="settings-panel__eyebrow">Compatibility Metadata</p>
              <h2>호환 메타데이터</h2>
              <p>opencode-only 전환 뒤에도 UI 호환을 위해 유지하는 채널/플러그인 메타데이터입니다.</p>
            </div>
          </div>

          <div className="settings-kv-list">
            <div>
              <span>채널</span>
              <strong>{platformMetadata?.channels.length ?? 0}</strong>
            </div>
            <div>
              <span>플러그인 메타데이터</span>
              <strong>{platformMetadata?.plugins.length ?? 0}</strong>
            </div>
            <div>
              <span>내부 실행 도구</span>
              <strong>사용 안 함</strong>
            </div>
          </div>

          <div className="settings-action-row">
            <button className="cockpit-mini-button" onClick={onRefreshPlatformMetadata} type="button">
              호환 메타데이터 새로고침
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
