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
    ? "[숨긴 경로]"
    : value;
}

function eventName(event: WorkspaceRunEventRecord) {
  const payload = event.payload;
  const candidates = [payload.phase, payload.command, payload.action, payload.status, payload.name, payload.toolName];
  const match = candidates.find((value) => typeof value === "string" && value.trim());
  return typeof match === "string" ? match : event.eventType;
}

function eventSummary(event: WorkspaceRunEventRecord) {
  const payload = event.payload;
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.error === "string") return payload.error;
  if (typeof payload.path === "string") return displayPath(payload.path);
  if (typeof payload.query === "string") return payload.query;
  if (typeof payload.summary === "string") return payload.summary;
  return event.eventType;
}

function stepTone(status: string | null | undefined) {
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

function flowStatusCounts(flows: TaskFlowRecord[]) {
  return flows.reduce<Record<string, number>>((counts, flow) => {
    counts[flow.status] = (counts[flow.status] ?? 0) + 1;
    return counts;
  }, {});
}

function collectExecutionEvents(events: WorkspaceRunEventRecord[]) {
  return events
    .filter((event) =>
      event.eventType === "status" ||
      event.eventType === "error" ||
      event.eventType === "run_complete" ||
      event.eventType === "run_failed" ||
      event.eventType === "run_cancelled" ||
      event.eventType === "tool_call" ||
      event.eventType === "tool_result",
    )
    .slice(-6)
    .reverse();
}

function collectOpenCodeExtensionEntries(platformMetadata: PlatformMetadata | null) {
  return (platformMetadata?.tools ?? [])
    .filter((tool) => {
      const name = tool.name.toLowerCase();
      return tool.permission === "network" || name.includes("mcp") || name.includes("browser");
    })
    .map((tool) => ({
      name: tool.name,
      status: tool.audit?.safeByDefault ? "opencode에서 자동 가능" : "opencode 정책 확인 필요",
    }));
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
          <span className={`cockpit-status cockpit-status--${stepTone(activeFlow?.flow.status)}`}>
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
            <article className={`cockpit-step cockpit-step--${stepTone(step.status)}`} key={step.id}>
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
            <h3>opencode 실행 이벤트</h3>
          </div>
          <span className="cockpit-pill">live</span>
        </div>
        <div className="cockpit-timeline">
          {traceEvents.length ? (
            traceEvents.map((event) => (
              <article className={`cockpit-timeline__item cockpit-timeline__item--${event.eventType}`} key={event.id}>
                <span className="cockpit-timeline__dot" />
                <div>
                  <strong>{eventName(event)}</strong>
                  <p>{eventSummary(event)}</p>
                  <small>{formatClock(event.createdAt)}</small>
                </div>
              </article>
            ))
          ) : (
            <p className="cockpit-empty">
              아직 실시간 이벤트가 없습니다. 채팅을 보내면 opencode 실행 이벤트가 여기에 표시됩니다.
            </p>
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
  const events = collectExecutionEvents([...(runEvents ?? []), ...liveEvents]);
  const extensionEntries = collectOpenCodeExtensionEntries(platformMetadata);

  return (
    <section className="cockpit-ops-drawer" aria-label="운영 로그 서랍">
      <div className="cockpit-drawer-panel cockpit-drawer-panel--wide">
        <div className="cockpit-drawer-panel__header">
          <h3>opencode 실행 이벤트</h3>
          <span>{events.length}</span>
        </div>
        <div className="cockpit-tool-table">
          {events.length ? (
            events.map((event) => (
              <article className="cockpit-tool-row" key={`${event.id}-${event.createdAt}`}>
                <time>{formatClock(event.createdAt)}</time>
                <strong>{eventName(event)}</strong>
                <span>{eventSummary(event)}</span>
                <em>{event.eventType === "error" ? "오류" : "기록됨"}</em>
              </article>
            ))
          ) : (
            <p className="cockpit-empty">최근 opencode 실행 이벤트가 없습니다.</p>
          )}
        </div>
      </div>

      <div className="cockpit-drawer-panel">
        <div className="cockpit-drawer-panel__header">
          <h3>실행 정책</h3>
          <span>opencode</span>
        </div>
        <p className="cockpit-approval-copy">
          AetherOps는 내부 툴을 직접 실행하지 않습니다. 파일 변경, 명령 실행, MCP/브라우저 기능은 opencode 설정과 실행
          로그를 통해 관제됩니다.
        </p>
      </div>

      <div className="cockpit-drawer-panel">
        <div className="cockpit-drawer-panel__header">
          <h3>opencode 확장 상태</h3>
          <span>{extensionEntries.length}</span>
        </div>
        <div className="cockpit-server-list">
          {extensionEntries.length ? (
            extensionEntries.map((entry) => (
              <article key={entry.name}>
                <span className="cockpit-server-dot" />
                <div>
                  <strong>{entry.name}</strong>
                  <small>{entry.status}</small>
                </div>
              </article>
            ))
          ) : (
            <p className="cockpit-empty">
              AetherOps 내부 MCP/도구 런타임은 비활성화되어 있습니다. 확장 기능은 opencode 설정에서 연결하세요.
            </p>
          )}
        </div>
      </div>

      <div className="cockpit-drawer-panel">
        <div className="cockpit-drawer-panel__header">
          <h3>변경 파일</h3>
          <span>{changedFiles.length}</span>
        </div>
        <div className="cockpit-file-list">
          {changedFiles.length ? (
            changedFiles.slice(0, 5).map((file) => <span key={file}>{displayPath(file)}</span>)
          ) : (
            <p className="cockpit-empty">아직 변경된 파일이 없습니다.</p>
          )}
        </div>
      </div>
    </section>
  );
}
