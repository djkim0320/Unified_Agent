import { useMemo, useState } from "react";
import { getModelOption } from "../model-catalog";
import { getReasoningLabel } from "../reasoning-options";
import {
  type AgentHeartbeatRecord,
  type AgentRecord,
  type AgentSoulRecord,
  type ConversationRecord,
  type EngineStatusRecord,
  type McpConfigStatus,
  type McpRiskLevel,
  type McpServerSummary,
  type PlatformMetadata,
  type ProviderSummary,
  type SkillTemplateRecord,
  type StandingOrdersRecord,
} from "../types";
import type { CockpitNavTarget } from "./ConversationList";

type ExtensionsTarget = Extract<CockpitNavTarget, "mcp" | "skills">;

interface ExtensionsSectionViewProps {
  activeAgent: AgentRecord | null;
  activeConversation: ConversationRecord | null;
  engineStatus: EngineStatusRecord | null;
  heartbeat: AgentHeartbeatRecord | null;
  mcpCatalog: McpServerSummary[];
  mcpStatus: McpConfigStatus | null;
  mcpLoading: boolean;
  mcpTestRunPendingId: string | null;
  platformMetadata: PlatformMetadata | null;
  providers: ProviderSummary[];
  skillActionPendingId: string | null;
  skillTemplates: SkillTemplateRecord[];
  skillTemplatesLoading: boolean;
  soul: AgentSoulRecord | null;
  standingOrders: StandingOrdersRecord | null;
  target: ExtensionsTarget;
  onApplySkillHeartbeat: (template: SkillTemplateRecord) => void;
  onApplySkillStandingOrders: (template: SkillTemplateRecord) => void;
  onCreateMcpTestRun: (server: McpServerSummary) => void;
  onCreateSkillFlow: (template: SkillTemplateRecord) => void;
  onInsertSkillPrompt: (template: SkillTemplateRecord) => void;
  onNavigate: (target: CockpitNavTarget) => void;
  onOpenAgentSettings: () => void;
  onOpenProviderSettings: () => void;
  onRefreshEngineStatus: () => void;
  onRefreshMcpMetadata: () => void;
  onRefreshPlatformMetadata: () => void;
  onRefreshSkillTemplates: () => void;
  onTriggerHeartbeat: () => void;
}

function statusTone(active: boolean | null | undefined) {
  if (active === true) return "connected";
  if (active === false) return "disconnected";
  return "configured";
}

function statusLabel(active: boolean | null | undefined, fallback = "확인 중") {
  if (active === true) return "사용 가능";
  if (active === false) return "확인 필요";
  return fallback;
}

function riskLabel(risk: McpRiskLevel) {
  if (risk === "low") return "낮음";
  if (risk === "medium") return "중간";
  return "높음";
}

function countConfiguredProviders(providers: ProviderSummary[]) {
  return providers.filter((provider) => provider.configured || provider.status !== "disconnected").length;
}

function previewText(content: string | null | undefined) {
  const trimmed = content?.trim();
  if (!trimmed) {
    return "아직 내용이 없습니다.";
  }
  return trimmed.length > 220 ? `${trimmed.slice(0, 220)}...` : trimmed;
}

function dedupeServers(configured: McpServerSummary[], catalog: McpServerSummary[]) {
  const configuredKeys = new Set(configured.map((server) => `${server.category}:${server.id}`));
  return [
    ...configured,
    ...catalog.filter((server) => !configuredKeys.has(`${server.category}:${server.id}`)),
  ];
}

function categoryLabel(category: string) {
  const labels: Record<string, string> = {
    Aerospace: "항공/엔지니어링",
    Documentation: "문서화",
    Engineering: "엔지니어링",
    Operations: "운영",
    Planning: "계획",
    Quality: "품질",
    Research: "조사",
  };
  return labels[category] ?? category;
}

function isStandingApplied(template: SkillTemplateRecord, standingOrders: StandingOrdersRecord | null) {
  const content = standingOrders?.content ?? "";
  return (
    content.includes(`<!-- aetherops-skill-template:standing-orders:${template.id} -->`) ||
    content.includes(`## Skill: ${template.name}`)
  );
}

function isHeartbeatApplied(template: SkillTemplateRecord, heartbeat: AgentHeartbeatRecord | null) {
  const content = heartbeat?.instructions ?? "";
  return (
    content.includes(`<!-- aetherops-skill-template:heartbeat:${template.id} -->`) ||
    content.includes(`## Skill: ${template.name}`)
  );
}

function defaultSkillTemplates(): SkillTemplateRecord[] {
  return [];
}

export function ExtensionsSectionView({
  activeAgent,
  activeConversation,
  engineStatus,
  heartbeat,
  mcpCatalog,
  mcpLoading,
  mcpStatus,
  mcpTestRunPendingId,
  platformMetadata,
  providers,
  skillActionPendingId,
  skillTemplates,
  skillTemplatesLoading,
  soul,
  standingOrders,
  target,
  onApplySkillHeartbeat,
  onApplySkillStandingOrders,
  onCreateMcpTestRun,
  onCreateSkillFlow,
  onInsertSkillPrompt,
  onNavigate,
  onOpenAgentSettings,
  onOpenProviderSettings,
  onRefreshEngineStatus,
  onRefreshMcpMetadata,
  onRefreshPlatformMetadata,
  onRefreshSkillTemplates,
  onTriggerHeartbeat,
}: ExtensionsSectionViewProps) {
  const [copyState, setCopyState] = useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const configuredProviders = countConfiguredProviders(providers);
  const opencodeSyncEntries = engineStatus?.credentialSync?.entries.filter((entry) => entry.configured) ?? [];
  const activeModel = activeConversation
    ? getModelOption(activeConversation.providerKind, activeConversation.model).label
    : "선택 없음";
  const activeReasoning = activeConversation
    ? getReasoningLabel(
        activeConversation.providerKind,
        activeConversation.model,
        activeConversation.reasoningLevel,
      )
    : "선택 없음";
  const templates = skillTemplates.length ? skillTemplates : defaultSkillTemplates();
  const selectedSkill =
    templates.find((template) => template.id === selectedSkillId) ?? templates[0] ?? null;
  const mcpServers = useMemo(
    () => dedupeServers(mcpStatus?.configuredServers ?? [], mcpCatalog),
    [mcpCatalog, mcpStatus?.configuredServers],
  );
  const groupedSkills = useMemo(() => {
    const groups = new Map<string, SkillTemplateRecord[]>();
    for (const template of templates) {
      groups.set(template.category, [...(groups.get(template.category) ?? []), template]);
    }
    return [...groups.entries()];
  }, [templates]);
  const standingAppliedCount = templates.filter((template) => isStandingApplied(template, standingOrders)).length;
  const heartbeatAppliedCount = templates.filter((template) => isHeartbeatApplied(template, heartbeat)).length;

  const quickStats = useMemo(() => {
    if (target === "mcp") {
      return [
        ["opencode", statusLabel(engineStatus?.available)],
        [
          "Config 출처",
          mcpStatus?.configDirSource === "env"
            ? "환경 변수"
            : mcpStatus?.configDirSource === "default"
              ? "기본값"
              : "확인 필요",
        ],
        ["감지된 MCP", String(mcpStatus?.configuredCount ?? 0)],
        ["후보 카탈로그", String(mcpCatalog.length)],
      ];
    }

    return [
      ["활성 에이전트", activeAgent?.name ?? "선택 없음"],
      ["템플릿", String(templates.length)],
      ["상시 지침 적용", String(standingAppliedCount)],
      ["Heartbeat 적용", String(heartbeatAppliedCount)],
    ];
  }, [
    activeAgent?.name,
    engineStatus?.available,
    heartbeatAppliedCount,
    mcpCatalog.length,
    mcpStatus,
    standingAppliedCount,
    target,
    templates.length,
  ]);

  async function copyText(label: string, content: string) {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable.");
      }
      await navigator.clipboard.writeText(content);
      setCopyState(`${label}을 클립보드에 복사했습니다.`);
    } catch {
      setCopyState(`${label}을 복사하지 못했습니다. 브라우저 권한을 확인해 주세요.`);
    }
  }

  if (target === "mcp") {
    return (
      <div className="extensions-view" aria-label="MCP 관리" role="region">
        <section className="settings-view__hero extensions-view__hero">
          <div>
            <p className="eyebrow">opencode MCP 설정 관제</p>
            <h1>MCP 서버 관리</h1>
            <p>
              AetherOps는 MCP 서버를 직접 실행하지 않습니다. 이 화면은 opencode 설정 상태,
              후보 서버, 위험 안내, 설정 스니펫 복사, 테스트 Run 생성만 제공합니다.
            </p>
          </div>
          <div className="settings-view__hero-actions">
            <button className="cockpit-mini-button is-primary" disabled={mcpLoading} onClick={onRefreshMcpMetadata} type="button">
              {mcpLoading ? "새로고침 중..." : "MCP 상태 새로고침"}
            </button>
            <button className="cockpit-mini-button" onClick={onOpenProviderSettings} type="button">
              opencode/API 설정
            </button>
            <button className="cockpit-mini-button" onClick={onRefreshEngineStatus} type="button">
              엔진 상태 확인
            </button>
          </div>
        </section>

        <section className="settings-view__quick-grid" aria-label="MCP 요약">
          {quickStats.map(([label, value]) => (
            <div className="settings-summary-chip" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </section>

        {copyState ? <div className="settings-note extensions-copy-note">{copyState}</div> : null}

        <div className="settings-view__grid">
          <section className="settings-panel settings-panel--wide">
            <div className="settings-panel__header">
              <div>
                <p className="settings-panel__eyebrow">MCP Boundary</p>
                <h2>현재 opencode 설정 상태</h2>
                <p>
                  Config 경로는 기본적으로 안전한 라벨로만 표시합니다. 실제 경로는 debug path
                  플래그가 켜진 경우에만 API가 반환합니다.
                </p>
              </div>
              <span className={`status-pill status-pill--${statusTone(engineStatus?.available)}`}>
                {statusLabel(engineStatus?.available)}
              </span>
            </div>

            <div className="settings-kv-grid">
              <div>
                <span>Config 표시</span>
                <strong>{mcpStatus?.displayPath ?? "확인 중"}</strong>
              </div>
              <div>
                <span>Config 출처</span>
                <strong>{mcpStatus?.configDirSource ?? "unknown"}</strong>
              </div>
              <div>
                <span>감지된 서버</span>
                <strong>{mcpStatus?.configuredCount ?? 0}</strong>
              </div>
              <div>
                <span>opencode 인증</span>
                <strong>{engineStatus?.authStatus ?? "unknown"}</strong>
              </div>
              <div>
                <span>전달 계정</span>
                <strong>{opencodeSyncEntries.length}</strong>
              </div>
              <div>
                <span>관리 주체</span>
                <strong>opencode</strong>
              </div>
            </div>

            {mcpStatus?.warnings.length ? (
              <div className="settings-warning">
                {mcpStatus.warnings.join(" ")}
              </div>
            ) : null}
            {engineStatus?.environment.autoApprovePermissions ? (
              <div className="settings-warning">
                권한 자동 승인이 켜져 있습니다. 파일, 브라우저, 외부 API를 다루는 MCP는 신뢰할 수
                있는 작업에서만 사용하세요.
              </div>
            ) : null}
          </section>

          <section className="settings-panel settings-panel--wide">
            <div className="settings-panel__header">
              <div>
                <p className="settings-panel__eyebrow">Server Catalog</p>
                <h2>연결 후보</h2>
                <p>각 카드는 opencode config snippet 복사와 일반 opencode 테스트 task 생성을 지원합니다.</p>
              </div>
            </div>
            <div className="extensions-card-list extensions-card-list--dense">
              {mcpServers.map((server) => (
                <article className="extensions-card extensions-card--mcp" key={`${server.status}-${server.id}`}>
                  <div>
                    <strong>{server.name}</strong>
                    <span>{server.description}</span>
                  </div>
                  <div className="settings-kv-grid settings-kv-grid--compact">
                    <div>
                      <span>상태</span>
                      <strong>{server.status === "configured" ? "설정 감지" : "후보"}</strong>
                    </div>
                    <div>
                      <span>위험도</span>
                      <strong>{riskLabel(server.riskLevel)}</strong>
                    </div>
                    <div>
                      <span>분류</span>
                      <strong>{server.category}</strong>
                    </div>
                  </div>
                  <small>{server.recommendedBoundary}</small>
                  {server.warnings.length ? (
                    <ul className="extensions-warning-list">
                      {server.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="settings-action-row">
                    <button
                      className="cockpit-mini-button"
                      onClick={() => copyText(`${server.name} 설정`, server.configSnippet)}
                      type="button"
                    >
                      설정 복사
                    </button>
                    <button
                      className="cockpit-mini-button is-primary"
                      disabled={!activeAgent || mcpTestRunPendingId === server.id}
                      onClick={() => onCreateMcpTestRun(server)}
                      type="button"
                    >
                      {mcpTestRunPendingId === server.id ? "생성 중..." : "테스트 Run 생성"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="settings-panel">
            <div className="settings-panel__header">
              <div>
                <p className="settings-panel__eyebrow">Operations</p>
                <h2>안전 운용 규칙</h2>
                <p>
                  테스트 Run은 MCP를 직접 호출하지 않고 opencode에게 설정 확인을 요청하는 일반 task입니다.
                </p>
              </div>
            </div>
            <div className="settings-action-row">
              <button className="cockpit-mini-button is-primary" onClick={() => onNavigate("chat")} type="button">
                채팅으로 이동
              </button>
              <button className="cockpit-mini-button" onClick={onRefreshPlatformMetadata} type="button">
                메타데이터 새로고침
              </button>
            </div>
            <div className="settings-note">
              인증된 사이트 접속, 계정 변경, 파일 업로드, 삭제 같은 고위험 작업은 opencode/MCP 쪽 승인 정책과
              AetherOps 실행 로그를 함께 확인하세요.
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="extensions-view" aria-label="스킬 템플릿 관리" role="region">
      <section className="settings-view__hero extensions-view__hero">
        <div>
          <p className="eyebrow">프롬프트 / Flow / 운영 패턴</p>
          <h1>스킬 템플릿 라이브러리</h1>
          <p>
            스킬은 실행 플러그인이 아닙니다. 반복 가능한 작업 방식을 Flow, 상시 지침,
            검증 체크리스트, Heartbeat 지침, opencode 프롬프트로 재사용하는 템플릿입니다.
          </p>
        </div>
        <div className="settings-view__hero-actions">
          <button className="cockpit-mini-button is-primary" disabled={skillTemplatesLoading} onClick={onRefreshSkillTemplates} type="button">
            {skillTemplatesLoading ? "불러오는 중..." : "템플릿 새로고침"}
          </button>
          <button className="cockpit-mini-button" onClick={onOpenAgentSettings} type="button">
            에이전트 지침 편집
          </button>
          <button className="cockpit-mini-button" onClick={() => onNavigate("workflow")} type="button">
            Flow 화면 열기
          </button>
        </div>
      </section>

      <section className="settings-view__quick-grid" aria-label="스킬 요약">
        {quickStats.map(([label, value]) => (
          <div className="settings-summary-chip" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      {copyState ? <div className="settings-note extensions-copy-note">{copyState}</div> : null}

      <div className="settings-view__grid settings-view__grid--balanced">
        <section className="settings-panel settings-panel--wide">
          <div className="settings-panel__header">
            <div>
              <p className="settings-panel__eyebrow">Active Context</p>
              <h2>현재 적용 대상</h2>
              <p>선택된 에이전트와 세션의 opencode 실행 컨텍스트에 템플릿을 연결합니다.</p>
            </div>
            <span className="status-pill status-pill--configured">metadata only</span>
          </div>
          <div className="settings-kv-grid">
            <div>
              <span>에이전트</span>
              <strong>{activeAgent?.name ?? "선택 없음"}</strong>
            </div>
            <div>
              <span>모델</span>
              <strong>{activeModel}</strong>
            </div>
            <div>
              <span>추론</span>
              <strong>{activeReasoning}</strong>
            </div>
            <div>
              <span>SOUL.md</span>
              <strong>{soul?.content.trim() ? "작성됨" : "비어 있음"}</strong>
            </div>
            <div>
              <span>STANDING_ORDERS.md</span>
              <strong>{standingOrders?.content.trim() ? "작성됨" : "비어 있음"}</strong>
            </div>
            <div>
              <span>Heartbeat</span>
              <strong>{heartbeat?.enabled ? `${heartbeat.intervalMinutes}분` : "꺼짐"}</strong>
            </div>
          </div>
          <div className="settings-note">
            연결된 공급자 {configuredProviders}개, opencode 동기화 계정 {opencodeSyncEntries.length}개가 감지되었습니다.
            스킬 템플릿은 이 정보를 실행하지 않고 지침과 작업 구조로만 전달합니다.
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-panel__header">
            <div>
              <p className="settings-panel__eyebrow">Catalog</p>
              <h2>템플릿 목록</h2>
              <p>카드를 선택하면 오른쪽에서 Flow, 지침, 체크리스트를 확인할 수 있습니다.</p>
            </div>
          </div>
          <div className="extensions-skill-groups">
            {groupedSkills.map(([category, group]) => (
              <div className="extensions-skill-group" key={category}>
                <h3>{categoryLabel(category)}</h3>
                <div className="extensions-card-list">
                  {group.map((skill) => {
                    const standingApplied = isStandingApplied(skill, standingOrders);
                    const heartbeatApplied = isHeartbeatApplied(skill, heartbeat);
                    return (
                      <button
                        className={`extensions-card extensions-card--button ${
                          selectedSkill?.id === skill.id ? "is-active" : ""
                        }`}
                        key={skill.id}
                        onClick={() => setSelectedSkillId(skill.id)}
                        type="button"
                      >
                        <strong>{skill.name}</strong>
                        <span>{skill.summary}</span>
                        <small>
                          {skill.tags.join(" / ")}
                          {standingApplied ? " · 상시 지침 적용됨" : ""}
                          {heartbeatApplied ? " · Heartbeat 적용됨" : ""}
                        </small>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {!templates.length ? <p className="cockpit-empty">표시할 스킬 템플릿이 없습니다.</p> : null}
          </div>
        </section>

        <section className="settings-panel settings-panel--wide">
          <div className="settings-panel__header">
            <div>
              <p className="settings-panel__eyebrow">Template Detail</p>
              <h2>{selectedSkill?.name ?? "템플릿을 선택하세요"}</h2>
              <p>{selectedSkill?.description ?? "왼쪽에서 스킬 템플릿을 선택하면 상세 내용을 볼 수 있습니다."}</p>
            </div>
          </div>

          {selectedSkill ? (
            <div className="extensions-template-detail">
              <div className="settings-action-row">
                <button
                  className="cockpit-mini-button is-primary"
                  disabled={!activeAgent || skillActionPendingId === `flow:${selectedSkill.id}`}
                  onClick={() => onCreateSkillFlow(selectedSkill)}
                  type="button"
                >
                  {skillActionPendingId === `flow:${selectedSkill.id}` ? "생성 중..." : "Flow로 만들기"}
                </button>
                <button
                  className="cockpit-mini-button"
                  disabled={
                    !activeAgent ||
                    isStandingApplied(selectedSkill, standingOrders) ||
                    skillActionPendingId === `standing:${selectedSkill.id}`
                  }
                  onClick={() => onApplySkillStandingOrders(selectedSkill)}
                  type="button"
                >
                  {isStandingApplied(selectedSkill, standingOrders) ? "상시 지침 적용됨" : "상시 지침에 추가"}
                </button>
                <button
                  className="cockpit-mini-button"
                  disabled={
                    !activeAgent ||
                    isHeartbeatApplied(selectedSkill, heartbeat) ||
                    skillActionPendingId === `heartbeat:${selectedSkill.id}`
                  }
                  onClick={() => onApplySkillHeartbeat(selectedSkill)}
                  type="button"
                >
                  {isHeartbeatApplied(selectedSkill, heartbeat) ? "Heartbeat 적용됨" : "Heartbeat에 적용"}
                </button>
                <button
                  className="cockpit-mini-button"
                  onClick={() => copyText(`${selectedSkill.name} 프롬프트`, selectedSkill.suggestedPrompt)}
                  type="button"
                >
                  프롬프트 복사
                </button>
                <button
                  className="cockpit-mini-button"
                  onClick={() => onInsertSkillPrompt(selectedSkill)}
                  type="button"
                >
                  채팅에 삽입
                </button>
              </div>

              <div className="extensions-template-grid">
                <article>
                  <h3>추천 Flow</h3>
                  <strong>{selectedSkill.flowTemplate.title}</strong>
                  <ol>
                    {selectedSkill.flowTemplate.steps.map((step) => (
                      <li key={step.stepKey}>
                        <strong>{step.title}</strong>
                        <span>{step.stepKey}</span>
                      </li>
                    ))}
                  </ol>
                </article>
                <article>
                  <h3>상시 지침 Patch</h3>
                  <pre>{selectedSkill.standingOrderPatch}</pre>
                </article>
                <article>
                  <h3>검증 체크리스트</h3>
                  <ul>
                    {selectedSkill.verificationChecklist.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
                <article>
                  <h3>Heartbeat Recipe</h3>
                  <p>{selectedSkill.heartbeatInstructions}</p>
                </article>
                <article className="extensions-template-grid__wide">
                  <h3>권장 opencode 프롬프트</h3>
                  <pre>{selectedSkill.suggestedPrompt}</pre>
                </article>
              </div>
            </div>
          ) : null}
        </section>

        <section className="settings-panel">
          <div className="settings-panel__header">
            <div>
              <p className="settings-panel__eyebrow">Instruction Files</p>
              <h2>지침 파일 미리보기</h2>
              <p>실제 경로는 숨기고 현재 내용 요약만 표시합니다.</p>
            </div>
          </div>
          <div className="extensions-preview-stack">
            <article>
              <strong>SOUL.md</strong>
              <p>{previewText(soul?.content)}</p>
            </article>
            <article>
              <strong>STANDING_ORDERS.md</strong>
              <p>{previewText(standingOrders?.content)}</p>
            </article>
            <article>
              <strong>HEARTBEAT.md</strong>
              <p>{previewText(heartbeat?.instructions)}</p>
            </article>
          </div>
          <div className="settings-action-row">
            <button className="cockpit-mini-button is-primary" onClick={onOpenAgentSettings} type="button">
              지침 편집
            </button>
            <button className="cockpit-mini-button" onClick={onTriggerHeartbeat} type="button">
              Heartbeat 실행
            </button>
            <button className="cockpit-mini-button" onClick={() => onNavigate("chat")} type="button">
              채팅에서 확인
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
