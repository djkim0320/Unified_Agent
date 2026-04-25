import type {
  ConversationRecord,
  PlatformMetadata,
  TaskFlowRecord,
  TaskFlowStepDetail,
  WorkspaceRunEventRecord,
} from "../types";

interface CockpitPanelsProps {
  activeConversation: ConversationRecord | null;
  changedFiles: string[];
  liveEvents: WorkspaceRunEventRecord[];
  platformMetadata: PlatformMetadata | null;
  runEvents: WorkspaceRunEventRecord[] | null;
  selectedTaskFlow: { flow: TaskFlowRecord; steps: TaskFlowStepDetail[] } | null;
  taskFlows: TaskFlowRecord[];
  onOpenWorkspace: () => void;
  onResumeTaskFlow?: (flowId: string) => void;
  onStartTaskFlow?: (flowId: string) => void;
}

function formatClock(timestamp: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function displayPath(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) || /^\/(?!\/)/.test(value)
    ? "[숨김 경로]"
    : value;
}

function getToolName(event: WorkspaceRunEventRecord) {
  const payload = event.payload;
  const candidates = [payload.toolName, payload.tool, payload.name, payload.command, payload.action];
  const match = candidates.find((value) => typeof value === "string" && value.trim());
  return typeof match === "string" ? match : event.eventType;
}

function getEventSummary(event: WorkspaceRunEventRecord) {
  const payload = event.payload;
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.error === "string") return payload.error;
  if (typeof payload.path === "string") return displayPath(payload.path);
  if (typeof payload.query === "string") return payload.query;
  return event.eventType;
}

function getStepTone(status: string | null | undefined) {
  if (status === "completed" || status === "skipped") return "done";
  if (status === "running") return "active";
  if (status === "failed" || status === "cancelled") return "error";
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
    default:
      return "준비";
  }
}

function flowStatusCounts(flows: TaskFlowRecord[]) {
  return flows.reduce<Record<string, number>>((counts, flow) => {
    counts[flow.status] = (counts[flow.status] ?? 0) + 1;
    return counts;
  }, {});
}

function collectToolEvents(events: WorkspaceRunEventRecord[]) {
  return events
    .filter((event) => event.eventType === "tool_call" || event.eventType === "tool_result" || event.eventType === "error")
    .slice(-6)
    .reverse();
}

export function CockpitRightRail({
  liveEvents,
  onOpenWorkspace,
  onResumeTaskFlow,
  onStartTaskFlow,
  selectedTaskFlow,
  taskFlows,
}: CockpitPanelsProps) {
  const activeFlow =
    selectedTaskFlow ??
    (taskFlows[0]
      ? {
          flow: taskFlows[0],
          steps: [],
        }
      : null);
  const counts = flowStatusCounts(taskFlows);
  const traceEvents = liveEvents.slice(-6).reverse();

  return (
    <aside className="cockpit-right-rail" aria-label="워크플로우 관제 패널">
      <section className="cockpit-card cockpit-card--workflow">
        <div className="cockpit-card__header">
          <div>
            <p className="cockpit-eyebrow">워크플로우</p>
            <h3>{activeFlow?.flow.title ?? "활성 작업 흐름 없음"}</h3>
          </div>
          <span className={`cockpit-status cockpit-status--${getStepTone(activeFlow?.flow.status)}`}>
            {statusLabel(activeFlow?.flow.status)}
          </span>
        </div>

        <div className="cockpit-flow-actions">
          {activeFlow?.flow.status === "queued" || activeFlow?.flow.status === "running" ? (
            <button className="cockpit-mini-button" onClick={() => onStartTaskFlow?.(activeFlow.flow.id)} type="button">
              시작/평가
            </button>
          ) : null}
          {activeFlow?.flow.status === "failed" || activeFlow?.flow.status === "cancelled" ? (
            <button className="cockpit-mini-button" onClick={() => onResumeTaskFlow?.(activeFlow.flow.id)} type="button">
              재개
            </button>
          ) : null}
          <button className="cockpit-mini-button" onClick={onOpenWorkspace} type="button">
            상세 보기
          </button>
        </div>

        <div className="cockpit-step-stack">
          {(activeFlow?.steps.length
            ? activeFlow.steps
            : [
                { id: "placeholder-1", stepKey: "requirements", title: "요구사항 정리", status: "queued" },
                { id: "placeholder-2", stepKey: "research", title: "자료 조사", status: "queued" },
                { id: "placeholder-3", stepKey: "variants", title: "후보안 비교", status: "queued" },
                { id: "placeholder-4", stepKey: "plan", title: "실행 계획", status: "queued" },
                { id: "placeholder-5", stepKey: "decision", title: "결정 로그", status: "queued" },
              ]).map((step, index) => (
            <article className={`cockpit-step cockpit-step--${getStepTone(step.status)}`} key={step.id}>
              <span className="cockpit-step__index">{index + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <small>{step.stepKey}</small>
              </div>
              <span className="cockpit-step__badge">{statusLabel(step.status)}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="cockpit-card cockpit-card--trace">
        <div className="cockpit-card__header">
          <div>
            <p className="cockpit-eyebrow">실시간 흐름 추적</p>
            <h3>도구와 실행 이벤트</h3>
          </div>
          <span className="cockpit-pill">live</span>
        </div>
        <div className="cockpit-timeline">
          {traceEvents.length ? (
            traceEvents.map((event) => (
              <article className={`cockpit-timeline__item cockpit-timeline__item--${event.eventType}`} key={event.id}>
                <span className="cockpit-timeline__dot" />
                <div>
                  <strong>{getToolName(event)}</strong>
                  <p>{getEventSummary(event)}</p>
                  <small>{formatClock(event.createdAt)}</small>
                </div>
              </article>
            ))
          ) : (
            <p className="cockpit-empty">아직 실시간 이벤트가 없습니다. 채팅을 보내면 도구 호출과 결과가 여기에 표시됩니다.</p>
          )}
        </div>
      </section>

      <section className="cockpit-card cockpit-card--metrics">
        <div className="cockpit-metric">
          <span>활성 Flow</span>
          <strong>{(counts.queued ?? 0) + (counts.running ?? 0)}</strong>
        </div>
        <div className="cockpit-metric">
          <span>완료</span>
          <strong>{counts.completed ?? 0}</strong>
        </div>
        <div className="cockpit-metric">
          <span>주의</span>
          <strong>{(counts.failed ?? 0) + (counts.cancelled ?? 0)}</strong>
        </div>
      </section>
    </aside>
  );
}

export function CockpitOpsDrawer({
  changedFiles,
  liveEvents,
  platformMetadata,
  runEvents,
}: CockpitPanelsProps) {
  const events = collectToolEvents([...(runEvents ?? []), ...liveEvents]);
  const mcpLikeTools = (platformMetadata?.tools ?? []).filter(
    (tool) => tool.permission === "network" || tool.name.includes("mcp") || tool.name.includes("browser"),
  );
  const skillsCount =
    (platformMetadata?.agentSkills?.length ?? 0) +
    (platformMetadata?.plugins ?? []).reduce((total, plugin) => total + (plugin.skills?.length ?? 0), 0);

  return (
    <section className="cockpit-ops-drawer" aria-label="운영 로그 드로어">
      <div className="cockpit-drawer-panel cockpit-drawer-panel--wide">
        <div className="cockpit-drawer-panel__header">
          <h3>도구 호출</h3>
          <span>{events.length}</span>
        </div>
        <div className="cockpit-tool-table">
          {events.length ? (
            events.map((event) => (
              <article className="cockpit-tool-row" key={`${event.id}-${event.createdAt}`}>
                <time>{formatClock(event.createdAt)}</time>
                <strong>{getToolName(event)}</strong>
                <span>{getEventSummary(event)}</span>
                <em>{event.eventType === "error" ? "오류" : "기록됨"}</em>
              </article>
            ))
          ) : (
            <p className="cockpit-empty">최근 도구 호출이 없습니다.</p>
          )}
        </div>
      </div>

      <div className="cockpit-drawer-panel">
        <div className="cockpit-drawer-panel__header">
          <h3>승인 대기</h3>
          <span>0</span>
        </div>
        <p className="cockpit-approval-copy">
          파일 쓰기, 외부 API 호출, 장기 실행 작업처럼 side effect가 있는 액션은 여기에서 확인 후 승인합니다.
        </p>
      </div>

      <div className="cockpit-drawer-panel">
        <div className="cockpit-drawer-panel__header">
          <h3>MCP 서버</h3>
          <span>{mcpLikeTools.length}</span>
        </div>
        <div className="cockpit-server-list">
          {["filesystem", "web-search", "github", "database"].map((name, index) => (
            <article key={name}>
              <span className="cockpit-server-dot" />
              <div>
                <strong>{name}</strong>
                <small>{index < Math.max(1, mcpLikeTools.length) ? "연결됨" : "대기"}</small>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="cockpit-drawer-panel">
        <div className="cockpit-drawer-panel__header">
          <h3>스킬 / 파일 변경</h3>
          <span>{skillsCount}</span>
        </div>
        <div className="cockpit-file-list">
          {changedFiles.length ? (
            changedFiles.slice(0, 5).map((file) => <span key={file}>{displayPath(file)}</span>)
          ) : (
            <p className="cockpit-empty">변경된 파일이 아직 없습니다.</p>
          )}
        </div>
      </div>
    </section>
  );
}
