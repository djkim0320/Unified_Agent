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
  type McpSnippetValidationResult,
  type PlatformMetadata,
  type ProviderSummary,
  type SkillTemplateRecord,
  type StandingOrdersRecord,
} from "../types";
import type { CockpitNavTarget } from "./ConversationList";

type ExtensionsTarget = Extract<CockpitNavTarget, "mcp" | "skills">;

type CustomSkillPayload = Omit<
  SkillTemplateRecord,
  "id" | "agentId" | "scope" | "builtIn" | "createdAt" | "updatedAt"
> & {
  id?: string;
  scope?: "agent" | "shared";
};

interface ExtensionsSectionViewProps {
  activeAgent: AgentRecord | null;
  activeConversation: ConversationRecord | null;
  engineStatus: EngineStatusRecord | null;
  heartbeat: AgentHeartbeatRecord | null;
  mcpCatalog: McpServerSummary[];
  mcpSnippetValidation: McpSnippetValidationResult | null;
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
  onCreateCustomSkill: (payload: CustomSkillPayload) => void;
  onCreateMcpTestRun: (server: McpServerSummary) => void;
  onCreateSkillFlow: (template: SkillTemplateRecord) => void;
  onDeleteCustomSkill: (template: SkillTemplateRecord) => void;
  onInsertSkillPrompt: (template: SkillTemplateRecord) => void;
  onNavigate: (target: CockpitNavTarget) => void;
  onOpenAgentSettings: () => void;
  onOpenProviderSettings: () => void;
  onRefreshEngineStatus: () => void;
  onRefreshMcpMetadata: () => void;
  onRefreshPlatformMetadata: () => void;
  onRefreshSkillTemplates: () => void;
  onTriggerHeartbeat: () => void;
  onUpdateCustomSkill: (template: SkillTemplateRecord, payload: CustomSkillPayload) => void;
  onValidateMcpSnippet: (snippet: string) => void;
}

const EMPTY_SKILL_DRAFT: CustomSkillPayload = {
  scope: "agent",
  name: "",
  category: "Custom",
  summary: "",
  description: "",
  standingOrderPatch: "",
  flowTemplate: {
    title: "새 Skill Flow",
    steps: [
      {
        stepKey: "plan",
        title: "계획 수립",
        prompt: "목표를 확인하고 실행 계획을 제안하세요.",
        dependencyStepKey: null,
      },
    ],
  },
  verificationChecklist: [],
  heartbeatInstructions: "",
  suggestedPrompt: "",
  tags: [],
};

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
    Custom: "사용자 정의",
    Documentation: "문서화",
    Engineering: "엔지니어링",
    Operations: "운영",
    Planning: "계획",
    Quality: "검증",
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

function cloneTemplate(template: SkillTemplateRecord): CustomSkillPayload {
  return {
    scope: template.scope === "shared" ? "shared" : "agent",
    name: template.builtIn ? `${template.name} 복사본` : template.name,
    category: template.category,
    summary: template.summary,
    description: template.description,
    standingOrderPatch: template.standingOrderPatch,
    flowTemplate: template.flowTemplate,
    verificationChecklist: template.verificationChecklist,
    heartbeatInstructions: template.heartbeatInstructions,
    suggestedPrompt: template.suggestedPrompt,
    tags: template.tags,
  };
}

function flowStepsText(template: CustomSkillPayload) {
  return template.flowTemplate.steps.map((step) => `${step.title} :: ${step.prompt}`).join("\n");
}

function parseFlowSteps(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
  return lines.length
    ? lines.map((line, index) => {
        const [titlePart, promptPart] = line.split("::");
        const title = (titlePart ?? line).replace(/^\d+[\).\-\s]+/, "").trim() || `단계 ${index + 1}`;
        const stepKey =
          title
            .toLowerCase()
            .replace(/[^a-z0-9가-힣]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 40) || `step-${index + 1}`;
        return {
          stepKey,
          title,
          prompt: (promptPart ?? title).trim(),
          dependencyStepKey: index === 0 ? null : null,
        };
      })
    : EMPTY_SKILL_DRAFT.flowTemplate.steps;
}

export function ExtensionsSectionView({
  activeAgent,
  activeConversation,
  engineStatus,
  heartbeat,
  mcpCatalog,
  mcpLoading,
  mcpSnippetValidation,
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
  onCreateCustomSkill,
  onCreateMcpTestRun,
  onCreateSkillFlow,
  onDeleteCustomSkill,
  onInsertSkillPrompt,
  onNavigate,
  onOpenAgentSettings,
  onOpenProviderSettings,
  onRefreshEngineStatus,
  onRefreshMcpMetadata,
  onRefreshPlatformMetadata,
  onRefreshSkillTemplates,
  onTriggerHeartbeat,
  onUpdateCustomSkill,
  onValidateMcpSnippet,
}: ExtensionsSectionViewProps) {
  const [copyState, setCopyState] = useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [snippetDraft, setSnippetDraft] = useState("");
  const [skillDraft, setSkillDraft] = useState<CustomSkillPayload | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [flowStepsDraft, setFlowStepsDraft] = useState(flowStepsText(EMPTY_SKILL_DRAFT));
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
  const selectedSkill =
    skillTemplates.find((template) => template.id === selectedSkillId) ?? skillTemplates[0] ?? null;
  const mcpServers = useMemo(
    () => dedupeServers(mcpStatus?.configuredServers ?? [], mcpCatalog),
    [mcpCatalog, mcpStatus?.configuredServers],
  );
  const groupedSkills = useMemo(() => {
    const groups = new Map<string, SkillTemplateRecord[]>();
    for (const template of skillTemplates) {
      groups.set(template.category, [...(groups.get(template.category) ?? []), template]);
    }
    return [...groups.entries()];
  }, [skillTemplates]);
  const standingAppliedCount = skillTemplates.filter((template) => isStandingApplied(template, standingOrders)).length;
  const heartbeatAppliedCount = skillTemplates.filter((template) => isHeartbeatApplied(template, heartbeat)).length;

  const quickStats = target === "mcp"
    ? [
        ["opencode", statusLabel(engineStatus?.available)],
        ["인증 근거", engineStatus?.authEvidence?.message ?? engineStatus?.authStatus ?? "확인 중"],
        ["Config", mcpStatus?.sourceLabel ?? mcpStatus?.displayPath ?? "확인 중"],
        ["MCP 후보", String(mcpCatalog.length)],
      ]
    : [
        ["활성 에이전트", activeAgent?.name ?? "선택 없음"],
        ["템플릿", String(skillTemplates.length)],
        ["상시 지침 적용", String(standingAppliedCount)],
        ["Heartbeat 적용", String(heartbeatAppliedCount)],
      ];

  async function copyText(label: string, content: string) {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable.");
      }
      await navigator.clipboard.writeText(content);
      setCopyState(`${label}을 클립보드에 복사했습니다.`);
    } catch {
      setCopyState(`${label} 복사에 실패했습니다. 브라우저 권한을 확인하세요.`);
    }
  }

  function openSkillForm(template?: SkillTemplateRecord) {
    const nextDraft = template ? cloneTemplate(template) : EMPTY_SKILL_DRAFT;
    setSkillDraft(nextDraft);
    setEditingTemplateId(template && !template.builtIn ? template.id : null);
    setFlowStepsDraft(flowStepsText(nextDraft));
  }

  function saveSkillDraft() {
    if (!skillDraft) return;
    const payload: CustomSkillPayload = {
      ...skillDraft,
      flowTemplate: {
        ...skillDraft.flowTemplate,
        steps: parseFlowSteps(flowStepsDraft),
      },
      verificationChecklist: skillDraft.verificationChecklist.filter(Boolean),
      tags: skillDraft.tags.filter(Boolean),
    };
    if (editingTemplateId) {
      const existing = skillTemplates.find((template) => template.id === editingTemplateId);
      if (existing) {
        onUpdateCustomSkill(existing, payload);
      }
    } else {
      onCreateCustomSkill(payload);
    }
    setSkillDraft(null);
    setEditingTemplateId(null);
  }

  if (target === "mcp") {
    return (
      <div className="extensions-view" aria-label="MCP 관리" role="region">
        <section className="settings-view__hero extensions-view__hero">
          <div>
            <p className="eyebrow">opencode MCP 설정 보조</p>
            <h1>MCP 서버 관리</h1>
            <p>
              AetherOps는 MCP 서버를 직접 실행하지 않습니다. 여기서는 opencode 설정을 설명하고, 스니펫을 검증하고,
              안전한 테스트 Run을 생성합니다.
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
                <p className="settings-panel__eyebrow">Config Status</p>
                <h2>현재 opencode 설정</h2>
                <p>민감한 절대 경로는 기본 UI에서 숨기고 display-safe label만 표시합니다.</p>
              </div>
              <span className={`status-pill status-pill--${statusTone(engineStatus?.available)}`}>
                {statusLabel(engineStatus?.available)}
              </span>
            </div>

            <div className="settings-kv-grid">
              <div>
                <span>표시 경로</span>
                <strong>{mcpStatus?.displayPath ?? "확인 중"}</strong>
              </div>
              <div>
                <span>Parser</span>
                <strong>{mcpStatus?.parserType ?? "unknown"}</strong>
              </div>
              <div>
                <span>안전 쓰기</span>
                <strong>{mcpStatus?.canWriteSafely ? "가능" : "비활성"}</strong>
              </div>
              <div>
                <span>감지 서버</span>
                <strong>{mcpStatus?.configuredCount ?? 0}</strong>
              </div>
              <div>
                <span>인증 근거</span>
                <strong>{engineStatus?.authEvidence?.message ?? engineStatus?.authStatus ?? "unknown"}</strong>
              </div>
              <div>
                <span>동기화 계정</span>
                <strong>{opencodeSyncEntries.length}</strong>
              </div>
            </div>

            {((mcpStatus?.warnings ?? []).length || (mcpStatus?.validationWarnings ?? []).length) ? (
              <div className="settings-warning">
                {[...(mcpStatus?.warnings ?? []), ...(mcpStatus?.validationWarnings ?? [])].join(" ")}
              </div>
            ) : null}
            {engineStatus?.environment.autoApprovePermissions ? (
              <div className="settings-warning">
                opencode 권한 자동 승인 모드가 켜져 있습니다. 고위험 MCP 설정을 테스트하기 전에 반드시 범위를 확인하세요.
              </div>
            ) : null}
          </section>

          <section className="settings-panel settings-panel--wide">
            <div className="settings-panel__header">
              <div>
                <p className="settings-panel__eyebrow">Snippet Validation</p>
                <h2>MCP 스니펫 검증</h2>
                <p>설정 파일에 쓰지 않고, 위험도와 env placeholder를 먼저 확인합니다.</p>
              </div>
            </div>
            <label className="cockpit-field">
              <span>opencode MCP config snippet</span>
              <textarea
                rows={8}
                value={snippetDraft}
                onChange={(event) => setSnippetDraft(event.target.value)}
                placeholder='예: { "mcp": { "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"] } } }'
              />
            </label>
            <div className="settings-action-row">
              <button
                className="cockpit-mini-button is-primary"
                disabled={!snippetDraft.trim()}
                onClick={() => onValidateMcpSnippet(snippetDraft)}
                type="button"
              >
                스니펫 검증
              </button>
              <button className="cockpit-mini-button" onClick={() => copyText("MCP 스니펫", snippetDraft)} type="button">
                스니펫 복사
              </button>
            </div>
            {mcpSnippetValidation ? (
              <div className={mcpSnippetValidation.ok ? "settings-note" : "settings-warning"}>
                <strong>{mcpSnippetValidation.ok ? "검증 통과" : "검증 필요"}</strong>
                <p>
                  서버 {mcpSnippetValidation.parsedServerCount}개, parser {mcpSnippetValidation.parserType},
                  placeholder {mcpSnippetValidation.envPlaceholders.length}개
                </p>
                {[...mcpSnippetValidation.riskWarnings, ...mcpSnippetValidation.errors].map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            ) : null}
          </section>

          <section className="settings-panel settings-panel--wide">
            <div className="settings-panel__header">
              <div>
                <p className="settings-panel__eyebrow">Server Catalog</p>
                <h2>연결 후보</h2>
                <p>각 카드는 config snippet 복사와 일반 opencode 테스트 Task 생성을 지원합니다.</p>
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
        </div>
      </div>
    );
  }

  return (
    <div className="extensions-view" aria-label="Skill 템플릿 관리" role="region">
      <section className="settings-view__hero extensions-view__hero">
        <div>
          <p className="eyebrow">프롬프트 / Flow / 운영 패턴</p>
          <h1>스킬 템플릿 라이브러리</h1>
          <p>
            Skill은 실행 플러그인이 아닙니다. 반복 가능한 작업 방식을 Flow, 상시 지침, 검증 체크리스트,
            Heartbeat 지침, opencode 프롬프트로 재사용하는 템플릿입니다.
          </p>
        </div>
        <div className="settings-view__hero-actions">
          <button className="cockpit-mini-button is-primary" disabled={skillTemplatesLoading} onClick={onRefreshSkillTemplates} type="button">
            {skillTemplatesLoading ? "불러오는 중..." : "템플릿 새로고침"}
          </button>
          <button className="cockpit-mini-button" onClick={() => openSkillForm()} type="button">
            새 Skill 만들기
          </button>
          <button className="cockpit-mini-button" onClick={() => onNavigate("workflow")} type="button">
            Flow 화면 열기
          </button>
        </div>
      </section>

      <section className="settings-view__quick-grid" aria-label="Skill 요약">
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
              <p>선택한 에이전트와 세션의 opencode 실행 컨텍스트에 템플릿을 연결합니다.</p>
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
              <span>인증 근거</span>
              <strong>{engineStatus?.authEvidence?.message ?? "확인 중"}</strong>
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
            연결된 공급자 {configuredProviders}개, opencode 동기화 계정 {opencodeSyncEntries.length}개,
            등록 플러그인 메타데이터 {platformMetadata?.plugins.length ?? 0}개가 감지되었습니다.
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
                          {skill.builtIn ? "기본 제공" : "사용자 정의"}
                          {standingApplied ? " · 상시 지침 적용됨" : ""}
                          {heartbeatApplied ? " · Heartbeat 적용됨" : ""}
                        </small>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {!skillTemplates.length ? <p className="cockpit-empty">표시할 Skill 템플릿이 없습니다.</p> : null}
          </div>
        </section>

        <section className="settings-panel settings-panel--wide">
          <div className="settings-panel__header">
            <div>
              <p className="settings-panel__eyebrow">Template Detail</p>
              <h2>{selectedSkill?.name ?? "템플릿을 선택하세요"}</h2>
              <p>{selectedSkill?.description ?? "왼쪽에서 Skill 템플릿을 선택하면 상세 내용을 볼 수 있습니다."}</p>
            </div>
            {selectedSkill ? (
              <span className="status-pill status-pill--configured">
                {selectedSkill.builtIn ? "read-only" : "custom"}
              </span>
            ) : null}
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
                <button className="cockpit-mini-button" onClick={() => onInsertSkillPrompt(selectedSkill)} type="button">
                  채팅에 삽입
                </button>
                <button className="cockpit-mini-button" onClick={() => openSkillForm(selectedSkill)} type="button">
                  {selectedSkill.builtIn ? "복제" : "편집"}
                </button>
                {!selectedSkill.builtIn ? (
                  <button className="cockpit-mini-button" onClick={() => onDeleteCustomSkill(selectedSkill)} type="button">
                    삭제
                  </button>
                ) : null}
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

        {skillDraft ? (
          <section className="settings-panel settings-panel--wide">
            <div className="settings-panel__header">
              <div>
                <p className="settings-panel__eyebrow">Custom Skill</p>
                <h2>{editingTemplateId ? "Skill 편집" : "새 Skill 만들기"}</h2>
                <p>사용자 정의 Skill도 실행하지 않습니다. Flow/지침/체크리스트 템플릿으로만 저장됩니다.</p>
              </div>
            </div>
            <label className="cockpit-field">
              <span>이름</span>
              <input value={skillDraft.name} onChange={(event) => setSkillDraft({ ...skillDraft, name: event.target.value })} />
            </label>
            <label className="cockpit-field">
              <span>요약</span>
              <input value={skillDraft.summary} onChange={(event) => setSkillDraft({ ...skillDraft, summary: event.target.value })} />
            </label>
            <label className="cockpit-field">
              <span>설명</span>
              <textarea rows={3} value={skillDraft.description} onChange={(event) => setSkillDraft({ ...skillDraft, description: event.target.value })} />
            </label>
            <label className="cockpit-field">
              <span>Flow 단계 (한 줄에 하나, "제목 :: 프롬프트")</span>
              <textarea rows={5} value={flowStepsDraft} onChange={(event) => setFlowStepsDraft(event.target.value)} />
            </label>
            <label className="cockpit-field">
              <span>상시 지침 Patch</span>
              <textarea rows={4} value={skillDraft.standingOrderPatch} onChange={(event) => setSkillDraft({ ...skillDraft, standingOrderPatch: event.target.value })} />
            </label>
            <label className="cockpit-field">
              <span>검증 체크리스트 (줄 단위)</span>
              <textarea
                rows={4}
                value={skillDraft.verificationChecklist.join("\n")}
                onChange={(event) =>
                  setSkillDraft({
                    ...skillDraft,
                    verificationChecklist: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
                  })
                }
              />
            </label>
            <label className="cockpit-field">
              <span>Heartbeat 지침</span>
              <textarea rows={3} value={skillDraft.heartbeatInstructions} onChange={(event) => setSkillDraft({ ...skillDraft, heartbeatInstructions: event.target.value })} />
            </label>
            <label className="cockpit-field">
              <span>권장 프롬프트</span>
              <textarea rows={4} value={skillDraft.suggestedPrompt} onChange={(event) => setSkillDraft({ ...skillDraft, suggestedPrompt: event.target.value })} />
            </label>
            <div className="settings-action-row">
              <button
                className="cockpit-mini-button is-primary"
                disabled={!skillDraft.name.trim() || !skillDraft.summary.trim()}
                onClick={saveSkillDraft}
                type="button"
              >
                저장
              </button>
              <button className="cockpit-mini-button" onClick={() => setSkillDraft(null)} type="button">
                취소
              </button>
            </div>
          </section>
        ) : null}

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
