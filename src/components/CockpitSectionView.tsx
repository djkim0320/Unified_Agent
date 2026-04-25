import { useMemo, useState } from "react";
import type {
  AgentMemorySnapshot,
  AgentRecord,
  ConversationRecord,
  PlatformMetadata,
  TaskFlowRecord,
  TaskFlowStepDetail,
  TaskRecord,
  WorkspaceFileRecord,
  WorkspaceRunEventRecord,
  WorkspaceRunRecord,
  WorkspaceScope,
  WorkspaceTreeNode,
} from "../types";
import type { CockpitNavTarget } from "./ConversationList";

type CockpitSectionTarget = Exclude<CockpitNavTarget, "chat" | "settings">;

interface CockpitSectionViewProps {
  activeAgent: AgentRecord | null;
  activeConversation: ConversationRecord | null;
  changedFiles: string[];
  file: WorkspaceFileRecord | null;
  liveEvents: WorkspaceRunEventRecord[];
  memory: AgentMemorySnapshot | null;
  modelLabel: string;
  platformMetadata: PlatformMetadata | null;
  platformMetadataLoading: boolean;
  providerLabel: string;
  reasoningLabel: string;
  runEvents: WorkspaceRunEventRecord[] | null;
  runs: WorkspaceRunRecord[];
  scope: WorkspaceScope;
  selectedTaskFlow: { flow: TaskFlowRecord; steps: TaskFlowStepDetail[] } | null;
  target: CockpitSectionTarget;
  taskFlows: TaskFlowRecord[];
  tasks: TaskRecord[];
  tree: WorkspaceTreeNode[];
  workspaceLoading: boolean;
  onCancelTaskFlow: (flowId: string) => void;
  onCreateConversation: () => void;
  onCreateMcpServerProfile: (payload: {
    label: string;
    transport?: "stdio" | "http" | "mock";
    command?: string;
    description?: string;
    enabled?: boolean;
  }) => void;
  onCreateSkill: (payload: {
    name: string;
    content: string;
    scope?: "agent" | "shared";
  }) => void;
  onCreateTaskFlow: (payload: {
    title: string;
    autoStart?: boolean;
    steps: Array<{
      stepKey: string;
      title: string;
      prompt: string;
      dependencyStepKey?: string | null;
    }>;
  }) => void;
  onCreateWorkspaceFile: (payload: {
    scope: Extract<WorkspaceScope, "sandbox" | "shared">;
    path: string;
    content?: string;
    overwrite?: boolean;
  }) => void;
  onCreateWorkspaceFolder: (payload: {
    scope: Extract<WorkspaceScope, "sandbox" | "shared">;
    path: string;
  }) => void;
  onNavigate: (target: CockpitNavTarget) => void;
  onOpenAgentSettings: () => void;
  onOpenProviderSettings: () => void;
  onRefreshFiles: () => void;
  onRefreshPlatformMetadata: () => void;
  onResumeTaskFlow: (flowId: string) => void;
  onRetryTaskFlowStep: (flowId: string, stepId: string) => void;
  onScopeChange: (scope: WorkspaceScope) => void;
  onSelectFile: (path: string) => void;
  onSelectTaskFlow: (flowId: string) => void;
  onSkipTaskFlowStep: (flowId: string, stepId: string) => void;
  onStartTaskFlow: (flowId: string) => void;
}

const sectionCopy: Record<
  CockpitSectionTarget,
  { eyebrow: string; title: string; description: string }
> = {
  workflow: {
    eyebrow: "장기 작업",
    title: "워크플로우 관제",
    description: "여러 단계로 나뉜 작업 흐름을 만들고, 시작하고, 실패한 단계를 재시도하거나 건너뜁니다.",
  },
  mcp: {
    eyebrow: "외부 도구 연결",
    title: "MCP 서버",
    description: "현재 등록된 브리지 기반 도구와 플러그인 상태를 확인합니다. 실제 stdio MCP 클라이언트는 다음 단계 연결 지점입니다.",
  },
  skills: {
    eyebrow: "행동 지침",
    title: "스킬 카탈로그",
    description: "스킬은 실행 엔진이 아니라 프롬프트 지침, 정책, 추천 도구 묶음으로 에이전트 행동을 조정합니다.",
  },
  files: {
    eyebrow: "로컬 산출물",
    title: "파일 작업 영역",
    description: "현재 세션 샌드박스와 공유 영역 파일을 살펴보고, 최근 변경 산출물을 확인합니다.",
  },
};

function formatTime(timestamp: number | null | undefined) {
  if (!timestamp) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function displayPath(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) || /^\/(?!\/)/.test(value)
    ? "[숨김 경로]"
    : value;
}

function statusTone(status: string | null | undefined) {
  if (status === "completed" || status === "skipped") return "done";
  if (status === "running") return "active";
  if (status === "failed" || status === "cancelled" || status === "timed_out") return "error";
  return "queued";
}

function statusLabel(status: string | null | undefined) {
  switch (status) {
    case "completed":
      return "완료";
    case "running":
      return "실행 중";
    case "queued":
      return "대기";
    case "failed":
      return "실패";
    case "cancelled":
      return "취소";
    case "skipped":
      return "건너뜀";
    case "timed_out":
      return "시간 초과";
    default:
      return "준비";
  }
}

function countStatus<T extends { status: string }>(items: T[]) {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
}

function eventName(event: WorkspaceRunEventRecord) {
  const payload = event.payload;
  const candidates = [payload.toolName, payload.tool, payload.name, payload.command, payload.action];
  const match = candidates.find((value) => typeof value === "string" && value.trim());
  return typeof match === "string" ? match : event.eventType;
}

function eventSummary(event: WorkspaceRunEventRecord) {
  const payload = event.payload;
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.error === "string") return payload.error;
  if (typeof payload.path === "string") return displayPath(payload.path);
  if (typeof payload.query === "string") return payload.query;
  return event.eventType;
}

function flattenTree(nodes: WorkspaceTreeNode[], limit = 12) {
  const rows: Array<{ depth: number; node: WorkspaceTreeNode }> = [];
  const visit = (nodeList: WorkspaceTreeNode[], depth: number) => {
    for (const node of nodeList) {
      if (rows.length >= limit) return;
      rows.push({ depth, node });
      if (node.children?.length) visit(node.children, depth + 1);
    }
  };
  visit(nodes, 0);
  return rows;
}

function normalizeStepKey(value: string, index: number) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^[\d.)\-\s]+/, "")
    .replace(/[^a-z0-9가-힣]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return normalized || `step-${index + 1}`;
}

function parseFlowOutline(title: string, outline: string) {
  const lines = outline
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 8);

  if (!lines.length && title.trim()) {
    return [
      {
        stepKey: "step-1",
        title: title.trim(),
        prompt: `${title.trim()}\n\n기대 산출물: 완료한 작업, 생성 파일, 결정 사항, 남은 위험을 요약합니다.`,
        dependencyStepKey: null,
      },
    ];
  }

  return lines.map((line, index) => ({
    stepKey: normalizeStepKey(line, index),
    title: line.slice(0, 80),
    prompt: `${line}\n\n기대 산출물: 완료한 작업, 생성 파일, 결정 사항, 남은 위험을 요약합니다.`,
    dependencyStepKey: index === 0 ? null : normalizeStepKey(lines[index - 1], index - 1),
  }));
}

function createAircraftResearchFlow() {
  const steps = [
    ["requirements", "요구사항 정리", "항공 과제의 목표, 제약조건, 성공 기준, 필요한 산출물을 정리합니다."],
    ["research", "자료 조사", "관련 자료와 기준을 조사하고 출처, 적용 가능성, 불확실성을 기록합니다."],
    ["variants", "후보안 비교", "여러 개념안을 만들고 장단점, 리스크, 필요한 도구 호출을 비교합니다."],
    ["plan", "실행 계획", "CFD/CAD/문서화로 이어질 실행 순서와 검증 체크포인트를 계획합니다."],
    ["decision", "결정 로그", "선택한 방향, 근거, 보류 이슈, 다음 액션을 결정 로그로 남깁니다."],
  ];

  return steps.map(([stepKey, title, prompt], index) => ({
    stepKey,
    title,
    prompt: `${prompt}\n\n기대 산출물: ${title} 결과와 다음 단계 입력값.`,
    dependencyStepKey: index === 0 ? null : steps[index - 1][0],
  }));
}

export function CockpitSectionView({
  activeAgent,
  activeConversation,
  changedFiles,
  file,
  liveEvents,
  memory,
  modelLabel,
  platformMetadata,
  platformMetadataLoading,
  providerLabel,
  reasoningLabel,
  runEvents,
  runs,
  scope,
  selectedTaskFlow,
  target,
  taskFlows,
  tasks,
  tree,
  workspaceLoading,
  onCancelTaskFlow,
  onCreateConversation,
  onCreateMcpServerProfile,
  onCreateSkill,
  onCreateTaskFlow,
  onCreateWorkspaceFile,
  onCreateWorkspaceFolder,
  onNavigate,
  onOpenAgentSettings,
  onOpenProviderSettings,
  onRefreshFiles,
  onRefreshPlatformMetadata,
  onResumeTaskFlow,
  onRetryTaskFlowStep,
  onScopeChange,
  onSelectFile,
  onSelectTaskFlow,
  onSkipTaskFlowStep,
  onStartTaskFlow,
}: CockpitSectionViewProps) {
  const [flowTitle, setFlowTitle] = useState("");
  const [flowOutline, setFlowOutline] = useState("");
  const [flowAutoStart, setFlowAutoStart] = useState(true);
  const [skillName, setSkillName] = useState("");
  const [skillContent, setSkillContent] = useState("");
  const [skillScope, setSkillScope] = useState<"agent" | "shared">("agent");
  const [mcpLabel, setMcpLabel] = useState("");
  const [mcpTransport, setMcpTransport] = useState<"stdio" | "http" | "mock">("stdio");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpDescription, setMcpDescription] = useState("");
  const [mcpEnabled, setMcpEnabled] = useState(false);
  const [workspaceFilePath, setWorkspaceFilePath] = useState("notes.md");
  const [workspaceFileContent, setWorkspaceFileContent] = useState("# Notes\n\n");
  const [workspaceFolderPath, setWorkspaceFolderPath] = useState("research");

  const flowCounts = countStatus(taskFlows);
  const taskCounts = countStatus(tasks);
  const runCounts = countStatus(runs);
  const selectedOrFirstFlow =
    selectedTaskFlow ?? (taskFlows[0] ? { flow: taskFlows[0], steps: [] } : null);
  const allEvents = useMemo(
    () => [...(runEvents ?? []), ...liveEvents].slice(-10).reverse(),
    [liveEvents, runEvents],
  );
  const toolEvents = allEvents.filter(
    (event) => event.eventType === "tool_call" || event.eventType === "tool_result" || event.eventType === "error",
  );
  const visibleFiles = flattenTree(tree, 14);
  const pluginSkills = (platformMetadata?.plugins ?? []).flatMap((plugin) =>
    (plugin.skills ?? []).map((skill) => ({
      id: `${plugin.id}:${skill.name}`,
      name: skill.name,
      summary: skill.summary ?? "플러그인에서 제공하는 스킬입니다.",
      source: plugin.name,
    })),
  );
  const agentSkills = platformMetadata?.agentSkills ?? [];
  const mcpCandidateTools = (platformMetadata?.tools ?? []).filter(
    (tool) => tool.permission === "network" || tool.permission === "browser" || tool.name.toLowerCase().includes("mcp"),
  );
  const copy = sectionCopy[target];
  const writableScope: Extract<WorkspaceScope, "sandbox" | "shared"> =
    scope === "shared" ? "shared" : "sandbox";

  const createFlowFromEditor = () => {
    const title = flowTitle.trim() || "새 장기 작업 흐름";
    const steps = parseFlowOutline(title, flowOutline);
    onCreateTaskFlow({ title, autoStart: flowAutoStart, steps });
    setFlowTitle("");
    setFlowOutline("");
  };

  const createDefaultResearchFlow = () => {
    onCreateTaskFlow({
      title: "항공 연구 자동화 기본 Flow",
      autoStart: false,
      steps: createAircraftResearchFlow(),
    });
    onNavigate("workflow");
  };

  const createSkillFromForm = () => {
    const name = skillName.trim();
    const content = skillContent.trim();
    if (!name || !content) return;
    onCreateSkill({ name, content, scope: skillScope });
    setSkillName("");
    setSkillContent("");
    setSkillScope("agent");
  };

  const createMcpProfileFromForm = () => {
    const label = mcpLabel.trim();
    if (!label) return;
    onCreateMcpServerProfile({
      label,
      transport: mcpTransport,
      command: mcpCommand.trim(),
      description: mcpDescription.trim(),
      enabled: mcpEnabled,
    });
    setMcpLabel("");
    setMcpCommand("");
    setMcpDescription("");
    setMcpEnabled(false);
  };

  const createFilesystemMcpTemplate = () => {
    onCreateMcpServerProfile({
      label: "filesystem-mcp",
      transport: "stdio",
      command: "npx -y @modelcontextprotocol/server-filesystem ./workspace",
      description:
        "로컬 workspace 폴더를 대상으로 하는 MCP 서버 프로필입니다. 1단계에서는 실행 연결이 아니라 메타데이터 등록만 수행합니다.",
      enabled: false,
    });
  };

  const createAviationSkillTemplate = () => {
    onCreateSkill({
      name: "aviation-research-planner",
      scope: "agent",
      content: [
        "# Aviation Research Planner",
        "",
        "- 긴 항공 연구 과제는 requirements -> research -> variants -> plan -> decision 순서의 Flow로 나눕니다.",
        "- 각 단계는 기대 산출물, 검증 기준, 다음 단계 입력을 반드시 남깁니다.",
        "- CFD/CAD 실행은 실제 어댑터가 연결되기 전까지 mock_not_connected 상태를 명시합니다.",
        "- 파일 산출물은 세션 sandbox에 쓰고, 재사용 자료는 shared 영역에 정리합니다.",
      ].join("\n"),
    });
  };

  const createWorkspaceFileFromForm = () => {
    const path = workspaceFilePath.trim();
    if (!path) return;
    onCreateWorkspaceFile({
      scope: writableScope,
      path,
      content: workspaceFileContent,
    });
  };

  const createWorkspaceFolderFromForm = () => {
    const path = workspaceFolderPath.trim();
    if (!path) return;
    onCreateWorkspaceFolder({
      scope: writableScope,
      path,
    });
  };

  const prepareResearchWorkspace = () => {
    onCreateWorkspaceFolder({
      scope: writableScope,
      path: "research",
    });
  };

  const scrollToPanel = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className={`cockpit-section cockpit-section--${target}`} data-active-cockpit-section={target}>
      <header className="cockpit-section__hero">
        <div>
          <p className="cockpit-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <div className="cockpit-section__hero-actions">
          <button className="cockpit-mini-button" onClick={() => onNavigate("chat")} type="button">
            채팅으로 이동
          </button>
          <button className="cockpit-mini-button" onClick={onOpenProviderSettings} type="button">
            연결 설정
          </button>
        </div>
      </header>

      <section className="cockpit-command-strip" aria-label="탭 빠른 작업">
        {target === "workflow" ? (
          <>
            <button onClick={() => scrollToPanel("flow-create-panel")} type="button">Flow 작성</button>
            <button onClick={createDefaultResearchFlow} type="button">항공 연구 템플릿</button>
            <button onClick={() => selectedOrFirstFlow && onSelectTaskFlow(selectedOrFirstFlow.flow.id)} disabled={!selectedOrFirstFlow} type="button">
              선택 Flow 새로고침
            </button>
            <button onClick={() => onNavigate("chat")} type="button">채팅으로 실행 요청</button>
            <button onClick={() => onNavigate("files")} type="button">산출 파일 보기</button>
            <button onClick={() => onNavigate("mcp")} type="button">외부 도구 연결</button>
          </>
        ) : null}
        {target === "mcp" ? (
          <>
            <button onClick={() => scrollToPanel("mcp-profile-form")} type="button">MCP 서버 추가</button>
            <button onClick={createFilesystemMcpTemplate} type="button">Filesystem MCP 템플릿</button>
            <button onClick={onRefreshPlatformMetadata} type="button">상태 새로고침</button>
            <button onClick={onOpenProviderSettings} type="button">인증 설정</button>
            <button onClick={() => onNavigate("skills")} type="button">관련 스킬 보기</button>
          </>
        ) : null}
        {target === "skills" ? (
          <>
            <button onClick={() => scrollToPanel("skill-create-panel")} type="button">스킬 추가</button>
            <button onClick={createAviationSkillTemplate} type="button">항공 연구 스킬 템플릿</button>
            <button onClick={onOpenAgentSettings} type="button">에이전트 지침 편집</button>
            <button onClick={createDefaultResearchFlow} type="button">연구 Flow 생성</button>
            <button onClick={onRefreshPlatformMetadata} type="button">카탈로그 새로고침</button>
            <button onClick={() => onNavigate("mcp")} type="button">MCP와 연결</button>
          </>
        ) : null}
        {target === "files" ? (
          <>
            <button aria-pressed={scope === "sandbox"} onClick={() => onScopeChange("sandbox")} type="button">세션 파일</button>
            <button aria-pressed={scope === "shared"} onClick={() => onScopeChange("shared")} type="button">공유 파일</button>
            <button onClick={() => scrollToPanel("workspace-file-create-panel")} type="button">새 파일</button>
            <button onClick={() => scrollToPanel("workspace-folder-create-panel")} type="button">새 폴더</button>
            <button onClick={prepareResearchWorkspace} type="button">Research 폴더 준비</button>
            <button onClick={onRefreshFiles} type="button">파일 새로고침</button>
            <button onClick={() => onNavigate("chat")} type="button">채팅에서 파일 생성 요청</button>
          </>
        ) : null}
      </section>

      {target === "workflow" ? (
        <div className="cockpit-section-grid cockpit-section-grid--workflow">
          <section className="cockpit-section-card cockpit-section-card--wide">
            <div className="cockpit-section-card__header">
              <div>
                <p className="cockpit-eyebrow">선택된 Flow</p>
                <h2>{selectedOrFirstFlow?.flow.title ?? "아직 Flow가 없습니다"}</h2>
              </div>
              <span className={`cockpit-status cockpit-status--${statusTone(selectedOrFirstFlow?.flow.status)}`}>
                {statusLabel(selectedOrFirstFlow?.flow.status)}
              </span>
            </div>
            <div className="cockpit-section-actions">
              {selectedOrFirstFlow ? (
                <>
                  <button
                    className="cockpit-mini-button"
                    onClick={() => onSelectTaskFlow(selectedOrFirstFlow.flow.id)}
                    type="button"
                  >
                    상세 불러오기
                  </button>
                  {selectedOrFirstFlow.flow.status === "queued" || selectedOrFirstFlow.flow.status === "running" ? (
                    <>
                      <button
                        className="cockpit-mini-button"
                        onClick={() => onStartTaskFlow(selectedOrFirstFlow.flow.id)}
                        type="button"
                      >
                        시작/평가
                      </button>
                      <button
                        className="cockpit-mini-button"
                        onClick={() => onCancelTaskFlow(selectedOrFirstFlow.flow.id)}
                        type="button"
                      >
                        취소
                      </button>
                    </>
                  ) : null}
                  {selectedOrFirstFlow.flow.status === "failed" || selectedOrFirstFlow.flow.status === "cancelled" ? (
                    <button
                      className="cockpit-mini-button"
                      onClick={() => onResumeTaskFlow(selectedOrFirstFlow.flow.id)}
                      type="button"
                    >
                      재개
                    </button>
                  ) : null}
                </>
              ) : (
                <button className="cockpit-mini-button" onClick={createDefaultResearchFlow} type="button">
                  기본 Flow 만들기
                </button>
              )}
            </div>
            <div className="cockpit-step-stack cockpit-step-stack--section">
              {(selectedOrFirstFlow?.steps.length ? selectedOrFirstFlow.steps : []).map((step, index) => (
                <article className={`cockpit-step cockpit-step--${statusTone(step.status)}`} key={step.id}>
                  <span className="cockpit-step__index">{index + 1}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <small>
                      {step.stepKey}
                      {step.task?.runId ? ` / run ${step.task.runId.slice(0, 8)}` : ""}
                    </small>
                  </div>
                  <span className="cockpit-step__badge">{statusLabel(step.status)}</span>
                  <div className="cockpit-step__actions">
                    <button
                      className="cockpit-mini-button"
                      onClick={() => onRetryTaskFlowStep(selectedOrFirstFlow!.flow.id, step.id)}
                      type="button"
                    >
                      재시도
                    </button>
                    {step.status !== "completed" && step.status !== "skipped" ? (
                      <button
                        className="cockpit-mini-button"
                        onClick={() => onSkipTaskFlowStep(selectedOrFirstFlow!.flow.id, step.id)}
                        type="button"
                      >
                        건너뜀
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
              {selectedOrFirstFlow && !selectedOrFirstFlow.steps.length ? (
                <p className="cockpit-empty">상세 불러오기를 누르면 step, task, run 연결 정보가 표시됩니다.</p>
              ) : null}
            </div>
          </section>

          <section className="cockpit-section-card">
            <div className="cockpit-section-card__header">
              <h2>Flow 생성</h2>
              <span className="cockpit-pill">최대 8단계</span>
            </div>
            <label className="cockpit-field">
              <span>제목</span>
              <input
                onChange={(event) => setFlowTitle(event.target.value)}
                placeholder="예: 항공 과제 자동화 연구"
                value={flowTitle}
              />
            </label>
            <label className="cockpit-field">
              <span>Outline 붙여넣기</span>
              <textarea
                onChange={(event) => setFlowOutline(event.target.value)}
                placeholder={"1. 요구사항 정리\n2. 자료 조사\n3. 후보안 비교\n4. 실행 계획\n5. 결정 로그"}
                rows={7}
                value={flowOutline}
              />
            </label>
            <label className="cockpit-field cockpit-field--inline">
              <span>생성 후 실행</span>
              <select onChange={(event) => setFlowAutoStart(event.target.value === "true")} value={String(flowAutoStart)}>
                <option value="true">바로 시작</option>
                <option value="false">수동 시작</option>
              </select>
            </label>
            <div className="cockpit-section-actions">
              <button
                className="cockpit-mini-button"
                disabled={!flowTitle.trim() && !flowOutline.trim()}
                onClick={createFlowFromEditor}
                type="button"
              >
                Flow 생성
              </button>
              <button className="cockpit-mini-button" onClick={createDefaultResearchFlow} type="button">
                항공 연구 템플릿
              </button>
            </div>
          </section>

          <section className="cockpit-section-card">
            <div className="cockpit-section-card__header">
              <h2>Flow 목록</h2>
              <span className="cockpit-pill">{taskFlows.length}</span>
            </div>
            <div className="cockpit-compact-list">
              {taskFlows.length ? (
                taskFlows.slice(0, 8).map((flow) => (
                  <article key={flow.id}>
                    <button onClick={() => onSelectTaskFlow(flow.id)} type="button">
                      <strong>{flow.title}</strong>
                      <span>{statusLabel(flow.status)} / {formatTime(flow.updatedAt)}</span>
                    </button>
                  </article>
                ))
              ) : (
                <p className="cockpit-empty">아직 생성된 Flow가 없습니다.</p>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {target === "mcp" ? (
        <div className="cockpit-section-grid cockpit-section-grid--mcp">
          <section className="cockpit-section-card cockpit-section-card--wide">
            <div className="cockpit-section-card__header">
              <div>
                <p className="cockpit-eyebrow">Bridge Registry</p>
                <h2>MCP 브리지 상태</h2>
              </div>
              <span className="cockpit-pill">{platformMetadataLoading ? "동기화 중" : "로컬"}</span>
            </div>
            <p className="cockpit-muted">
              현재 단계에서는 MCP 서버 등록/상태/도구 노출 경계만 제품화되어 있습니다. 실제 외부 stdio 연결은 이 브리지 인터페이스에 붙이면 됩니다.
            </p>
            <div className="cockpit-section-actions">
              <button className="cockpit-mini-button" onClick={onRefreshPlatformMetadata} type="button">
                상태 새로고침
              </button>
              <button className="cockpit-mini-button" onClick={() => scrollToPanel("mcp-profile-form")} type="button">
                MCP 서버 추가
              </button>
              <button className="cockpit-mini-button" onClick={onOpenProviderSettings} type="button">
                인증/공급자 설정
              </button>
            </div>
            <div className="cockpit-inline-form" id="mcp-profile-form">
              <div className="cockpit-inline-form__header">
                <strong>MCP 브리지 프로필 추가</strong>
                <span>실행 없이 로컬 메타데이터만 등록합니다.</span>
              </div>
              <label className="cockpit-field">
                <span>서버 이름</span>
                <input
                  onChange={(event) => setMcpLabel(event.target.value)}
                  placeholder="예: filesystem-mcp"
                  value={mcpLabel}
                />
              </label>
              <div className="cockpit-form-grid">
                <label className="cockpit-field">
                  <span>전송 방식</span>
                  <select onChange={(event) => setMcpTransport(event.target.value as "stdio" | "http" | "mock")} value={mcpTransport}>
                    <option value="stdio">stdio</option>
                    <option value="http">http</option>
                    <option value="mock">mock</option>
                  </select>
                </label>
                <label className="cockpit-field cockpit-field--checkbox">
                  <input
                    checked={mcpEnabled}
                    onChange={(event) => setMcpEnabled(event.target.checked)}
                    type="checkbox"
                  />
                  <span>활성 후보로 표시</span>
                </label>
              </div>
              <label className="cockpit-field">
                <span>실행 명령 또는 URL</span>
                <input
                  onChange={(event) => setMcpCommand(event.target.value)}
                  placeholder="예: npx -y @modelcontextprotocol/server-filesystem ./workspace"
                  value={mcpCommand}
                />
              </label>
              <label className="cockpit-field">
                <span>설명</span>
                <textarea
                  onChange={(event) => setMcpDescription(event.target.value)}
                  placeholder="이 서버가 어떤 도구를 제공할 예정인지 적어주세요."
                  rows={3}
                  value={mcpDescription}
                />
              </label>
              <button
                className="cockpit-mini-button"
                disabled={!mcpLabel.trim()}
                onClick={createMcpProfileFromForm}
                type="button"
              >
                로컬 프로필 추가
              </button>
            </div>
          </section>

          <section className="cockpit-section-card">
            <div className="cockpit-section-card__header">
              <h2>등록 도구</h2>
              <span className="cockpit-pill">{mcpCandidateTools.length}</span>
            </div>
            <div className="cockpit-compact-list">
              {mcpCandidateTools.length ? (
                mcpCandidateTools.slice(0, 10).map((tool) => (
                  <article key={tool.name}>
                    <strong>{tool.name}</strong>
                    <span>{tool.permission} / {tool.risk}</span>
                    <p>{tool.description}</p>
                  </article>
                ))
              ) : (
                <p className="cockpit-empty">MCP 성격의 외부 도구가 아직 없습니다.</p>
              )}
            </div>
          </section>

          <section className="cockpit-section-card">
            <div className="cockpit-section-card__header">
              <h2>플러그인</h2>
              <span className="cockpit-pill">{platformMetadata?.plugins.length ?? 0}</span>
            </div>
            <div className="cockpit-compact-list">
              {(platformMetadata?.plugins ?? []).length ? (
                platformMetadata!.plugins.map((plugin) => (
                  <article key={plugin.id}>
                    <strong>{plugin.name}</strong>
                    <span>{plugin.version} / tools {plugin.tools.length}</span>
                    <p>{plugin.description}</p>
                  </article>
                ))
              ) : (
                <p className="cockpit-empty">등록된 로컬 플러그인이 없습니다.</p>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {target === "skills" ? (
        <div className="cockpit-section-grid cockpit-section-grid--skills">
          <section className="cockpit-section-card cockpit-section-card--wide">
            <div className="cockpit-section-card__header">
              <div>
                <p className="cockpit-eyebrow">Skill Policy</p>
                <h2>활성 행동 지침</h2>
              </div>
              <span className="cockpit-pill">{agentSkills.length + pluginSkills.length}</span>
            </div>
            <p className="cockpit-muted">
              장기 항공 연구는 요구사항 정리, 자료 조사, 후보안 비교, 실행 계획, 결정 로그 순서로 분해하도록 기본 지침을 강화했습니다.
            </p>
            <div className="cockpit-section-actions">
              <button className="cockpit-mini-button" onClick={onOpenAgentSettings} type="button">
                에이전트 지침 편집
              </button>
              <button className="cockpit-mini-button" onClick={() => scrollToPanel("skill-create-panel")} type="button">
                스킬 추가
              </button>
              <button className="cockpit-mini-button" onClick={createDefaultResearchFlow} type="button">
                연구 Flow 생성
              </button>
            </div>
            <div className="cockpit-inline-form" id="skill-create-panel">
              <div className="cockpit-inline-form__header">
                <strong>로컬 스킬 추가</strong>
                <span>Markdown 파일로 저장되어 다음 프롬프트 구성부터 반영됩니다.</span>
              </div>
              <div className="cockpit-form-grid">
                <label className="cockpit-field">
                  <span>스킬 이름</span>
                  <input
                    onChange={(event) => setSkillName(event.target.value)}
                    placeholder="예: aviation-research-planner"
                    value={skillName}
                  />
                </label>
                <label className="cockpit-field">
                  <span>저장 위치</span>
                  <select onChange={(event) => setSkillScope(event.target.value as "agent" | "shared")} value={skillScope}>
                    <option value="agent">현재 에이전트 전용</option>
                    <option value="shared">모든 에이전트 공유</option>
                  </select>
                </label>
              </div>
              <label className="cockpit-field">
                <span>프롬프트 지침</span>
                <textarea
                  onChange={(event) => setSkillContent(event.target.value)}
                  placeholder={"# Aviation Research Planner\n\n- 긴 항공 과제는 요구사항, 조사, 후보안, 실행 계획, 결정 로그로 나눕니다.\n- 각 단계는 기대 산출물과 검증 기준을 명시합니다."}
                  rows={5}
                  value={skillContent}
                />
              </label>
              <button
                className="cockpit-mini-button"
                disabled={!skillName.trim() || !skillContent.trim()}
                onClick={createSkillFromForm}
                type="button"
              >
                스킬 저장
              </button>
            </div>
          </section>

          <section className="cockpit-section-card">
            <div className="cockpit-section-card__header">
              <h2>에이전트 스킬</h2>
              <span className="cockpit-pill">{agentSkills.length}</span>
            </div>
            <div className="cockpit-compact-list">
              {agentSkills.length ? (
                agentSkills.map((skill) => (
                  <article key={skill.id}>
                    <strong>{skill.name}</strong>
                    <span>{skill.source}{skill.pluginId ? ` / ${skill.pluginId}` : ""}</span>
                    <p>{skill.summary}</p>
                  </article>
                ))
              ) : (
                <p className="cockpit-empty">에이전트별 스킬 파일이 아직 없습니다.</p>
              )}
            </div>
          </section>

          <section className="cockpit-section-card">
            <div className="cockpit-section-card__header">
              <h2>플러그인 스킬</h2>
              <span className="cockpit-pill">{pluginSkills.length}</span>
            </div>
            <div className="cockpit-compact-list">
              {pluginSkills.length ? (
                pluginSkills.map((skill) => (
                  <article key={skill.id}>
                    <strong>{skill.name}</strong>
                    <span>{skill.source}</span>
                    <p>{skill.summary}</p>
                  </article>
                ))
              ) : (
                <p className="cockpit-empty">플러그인 스킬이 없습니다.</p>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {target === "files" ? (
        <div className="cockpit-section-grid cockpit-section-grid--files">
          <section className="cockpit-section-card cockpit-section-card--wide">
            <div className="cockpit-section-card__header">
              <div>
                <p className="cockpit-eyebrow">Workspace</p>
                <h2>{scope === "sandbox" ? "세션 샌드박스" : "공유 작업 영역"}</h2>
              </div>
              <span className="cockpit-pill">{workspaceLoading ? "읽는 중" : `${visibleFiles.length}개 표시`}</span>
            </div>
            <div className="cockpit-section-actions">
              <button
                aria-pressed={scope === "sandbox"}
                className="cockpit-mini-button"
                onClick={() => onScopeChange("sandbox")}
                type="button"
              >
                Sandbox
              </button>
              <button
                aria-pressed={scope === "shared"}
                className="cockpit-mini-button"
                onClick={() => onScopeChange("shared")}
                type="button"
              >
                Shared
              </button>
              <button className="cockpit-mini-button" onClick={onRefreshFiles} type="button">
                파일 새로고침
              </button>
            </div>
            <div className="cockpit-inline-form cockpit-inline-form--compact" id="workspace-file-settings">
              <div className="cockpit-inline-form__header">
                <strong>워크스페이스 파일 설정</strong>
                <span>세션 전용 산출물은 Sandbox, 재사용 자료는 Shared에 둡니다.</span>
              </div>
              <div className="cockpit-section-actions">
                <button
                  aria-pressed={scope === "sandbox"}
                  className="cockpit-mini-button"
                  onClick={() => onScopeChange("sandbox")}
                  type="button"
                >
                  세션 샌드박스 사용
                </button>
                <button
                  aria-pressed={scope === "shared"}
                  className="cockpit-mini-button"
                  onClick={() => onScopeChange("shared")}
                  type="button"
                >
                  공유 자료실 사용
                </button>
                <button className="cockpit-mini-button" onClick={() => onNavigate("chat")} type="button">
                  채팅에서 파일 생성 요청
                </button>
              </div>
            </div>
            <div className="cockpit-inline-form" id="workspace-file-create-panel">
              <div className="cockpit-inline-form__header">
                <strong>새 파일 만들기</strong>
                <span>현재 선택된 {writableScope === "sandbox" ? "세션 샌드박스" : "공유 자료실"}에 UTF-8 텍스트 파일을 만듭니다.</span>
              </div>
              <label className="cockpit-field">
                <span>파일 경로</span>
                <input
                  onChange={(event) => setWorkspaceFilePath(event.target.value)}
                  placeholder="예: notes.md 또는 research/summary.md"
                  value={workspaceFilePath}
                />
              </label>
              <label className="cockpit-field">
                <span>초기 내용</span>
                <textarea
                  onChange={(event) => setWorkspaceFileContent(event.target.value)}
                  placeholder="# Notes"
                  rows={5}
                  value={workspaceFileContent}
                />
              </label>
              <div className="cockpit-section-actions">
                <button
                  className="cockpit-mini-button"
                  disabled={!workspaceFilePath.trim()}
                  onClick={createWorkspaceFileFromForm}
                  type="button"
                >
                  파일 만들기
                </button>
                <button className="cockpit-mini-button" onClick={() => onNavigate("chat")} type="button">
                  에이전트에게 작성 요청
                </button>
              </div>
            </div>
            <div className="cockpit-inline-form cockpit-inline-form--compact" id="workspace-folder-create-panel">
              <div className="cockpit-inline-form__header">
                <strong>새 폴더 만들기</strong>
                <span>작업 산출물을 정리할 폴더를 먼저 준비할 수 있습니다.</span>
              </div>
              <div className="cockpit-form-grid">
                <label className="cockpit-field">
                  <span>폴더 경로</span>
                  <input
                    onChange={(event) => setWorkspaceFolderPath(event.target.value)}
                    placeholder="예: research 또는 outputs/cad"
                    value={workspaceFolderPath}
                  />
                </label>
                <div className="cockpit-section-actions cockpit-section-actions--align-end">
                  <button
                    className="cockpit-mini-button"
                    disabled={!workspaceFolderPath.trim()}
                    onClick={createWorkspaceFolderFromForm}
                    type="button"
                  >
                    폴더 만들기
                  </button>
                  <button className="cockpit-mini-button" onClick={prepareResearchWorkspace} type="button">
                    Research 폴더 준비
                  </button>
                </div>
              </div>
            </div>
            <div className="cockpit-file-browser">
              {visibleFiles.length ? (
                visibleFiles.map(({ depth, node }) => (
                  <button
                    className={`cockpit-file-browser__row cockpit-file-browser__row--${node.kind}`}
                    disabled={node.kind !== "file"}
                    key={node.path}
                    onClick={() => node.kind === "file" && onSelectFile(node.path)}
                    style={{ paddingLeft: `${0.75 + depth * 0.9}rem` }}
                    type="button"
                  >
                    <span>{node.kind === "directory" ? "폴더" : "파일"}</span>
                    <strong>{node.name}</strong>
                    <small>{displayPath(node.path)}</small>
                  </button>
                ))
              ) : (
                <p className="cockpit-empty">현재 범위에 표시할 파일이 없습니다.</p>
              )}
            </div>
          </section>

          <section className="cockpit-section-card">
            <div className="cockpit-section-card__header">
              <h2>파일 미리보기</h2>
              <span className="cockpit-pill">{file ? "열림" : "대기"}</span>
            </div>
            {file ? (
              <div className="cockpit-file-preview">
                <strong>{displayPath(file.path)}</strong>
                {file.binary || file.unsupportedEncoding ? (
                  <p className="cockpit-muted">바이너리 또는 지원하지 않는 인코딩 파일은 본문을 표시하지 않습니다.</p>
                ) : (
                  <pre>{file.content.slice(0, 4000)}</pre>
                )}
              </div>
            ) : (
              <p className="cockpit-empty">왼쪽 파일 목록에서 파일을 선택하면 여기에 표시됩니다.</p>
            )}
          </section>

          <section className="cockpit-section-card">
            <div className="cockpit-section-card__header">
              <h2>최근 변경</h2>
              <span className="cockpit-pill">{changedFiles.length}</span>
            </div>
            <div className="cockpit-file-list">
              {changedFiles.length ? (
                changedFiles.slice(0, 10).map((path) => <span key={path}>{displayPath(path)}</span>)
              ) : (
                <p className="cockpit-empty">아직 변경된 파일이 없습니다.</p>
              )}
            </div>
          </section>
        </div>
      ) : null}

      <section className="cockpit-ops-drawer cockpit-ops-drawer--section" aria-label="최근 실행 이벤트">
        <div className="cockpit-drawer-panel cockpit-drawer-panel--wide">
          <div className="cockpit-drawer-panel__header">
            <h3>최근 도구 호출</h3>
            <span>{toolEvents.length}</span>
          </div>
          <div className="cockpit-tool-table">
            {toolEvents.length ? (
              toolEvents.slice(0, 6).map((event) => (
                <article className="cockpit-tool-row" key={`${event.id}-${event.createdAt}`}>
                  <time>{formatTime(event.createdAt)}</time>
                  <strong>{eventName(event)}</strong>
                  <span>{eventSummary(event)}</span>
                  <em>{event.eventType === "error" ? "오류" : "기록"}</em>
                </article>
              ))
            ) : (
              <p className="cockpit-empty">최근 도구 호출이 없습니다.</p>
            )}
          </div>
        </div>
        <div className="cockpit-drawer-panel">
          <div className="cockpit-drawer-panel__header">
            <h3>런 상태</h3>
            <span>{runs.length}</span>
          </div>
          <div className="cockpit-metric-strip cockpit-metric-strip--stack">
            <span>실행 중 {runCounts.running ?? 0}</span>
            <span>완료 {runCounts.completed ?? 0}</span>
            <span>실패 {(runCounts.failed ?? 0) + (runCounts.cancelled ?? 0)}</span>
          </div>
        </div>
        <div className="cockpit-drawer-panel">
          <div className="cockpit-drawer-panel__header">
            <h3>Task 큐</h3>
            <span>{tasks.length}</span>
          </div>
          <div className="cockpit-metric-strip cockpit-metric-strip--stack">
            <span>대기 {taskCounts.queued ?? 0}</span>
            <span>실행 {taskCounts.running ?? 0}</span>
            <span>완료 {taskCounts.completed ?? 0}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
