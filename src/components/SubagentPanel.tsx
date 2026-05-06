import { useMemo, useState } from "react";
import type { ConversationRecord, TaskRecord, WorkspaceRunRecord } from "../types";

interface SubagentPanelProps {
  activeConversation: ConversationRecord | null;
  sessions: ConversationRecord[];
  tasks: TaskRecord[];
  runs: WorkspaceRunRecord[];
  onCancelSession: (sessionId: string) => void;
  onCreateSession: (payload: { title?: string; prompt: string }) => void;
  onOpenSession: (sessionId: string) => void;
  onRefresh: () => void;
}

function formatTime(timestamp: number | null | undefined) {
  if (!timestamp) {
    return "기록 없음";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function statusLabel(status: string | null | undefined) {
  switch (status) {
    case "queued":
      return "대기";
    case "running":
      return "실행 중";
    case "completed":
      return "완료";
    case "failed":
      return "실패";
    case "timed_out":
      return "시간 초과";
    case "cancelled":
      return "취소됨";
    default:
      return "상태 없음";
  }
}

function statusTone(status: string | null | undefined) {
  if (status === "completed") return "done";
  if (status === "queued" || status === "running") return "active";
  if (status === "failed" || status === "timed_out" || status === "cancelled") return "error";
  return "queued";
}

function defaultPrompt(title: string) {
  return [
    `${title || "서브에이전트"} 역할로 현재 세션의 작업을 독립적으로 조사하세요.`,
    "",
    "규칙:",
    "- 부모 세션의 목표를 보조하는 한정된 하위 작업만 수행하세요.",
    "- 파일을 변경해야 한다면 변경 이유와 경로를 명확히 요약하세요.",
    "- 완료 시 부모 세션에 바로 붙여 넣을 수 있는 짧은 보고서를 작성하세요.",
  ].join("\n");
}

export function SubagentPanel({
  activeConversation,
  sessions,
  tasks,
  runs,
  onCancelSession,
  onCreateSession,
  onOpenSession,
  onRefresh,
}: SubagentPanelProps) {
  const [title, setTitle] = useState("조사 서브에이전트");
  const [prompt, setPrompt] = useState(defaultPrompt("조사 서브에이전트"));

  const tasksByConversationId = useMemo(() => {
    const map = new Map<string, TaskRecord>();
    for (const task of tasks) {
      if (task.taskKind !== "subagent") {
        continue;
      }
      const existing = map.get(task.conversationId);
      if (!existing || task.updatedAt > existing.updatedAt) {
        map.set(task.conversationId, task);
      }
    }
    return map;
  }, [tasks]);

  const activeChildCount = sessions.filter((session) => {
    const task = tasksByConversationId.get(session.id);
    return task?.status === "queued" || task?.status === "running";
  }).length;
  const canCreate =
    Boolean(activeConversation) &&
    activeConversation?.sessionKind !== "subagent" &&
    runs.length > 0 &&
    activeChildCount < 3 &&
    prompt.trim().length > 0;
  const createDisabledReason = !activeConversation
    ? "먼저 세션을 선택하세요."
    : activeConversation.sessionKind === "subagent"
      ? "서브에이전트 세션 안에서는 새 하위 에이전트를 만들 수 없습니다."
      : runs.length === 0
        ? "부모 run이 1개 이상 있어야 서브에이전트를 만들 수 있습니다. 먼저 채팅을 한 번 실행하세요."
        : activeChildCount >= 3
          ? "동시에 관리하는 서브에이전트는 부모 run당 최대 3개입니다."
          : "프롬프트를 입력하면 서브에이전트를 시작할 수 있습니다.";

  return (
    <section className="subagent-panel cockpit-card" aria-label="서브에이전트">
      <div className="cockpit-card__header">
        <div>
          <p className="cockpit-eyebrow">작업 분담</p>
          <h3>서브에이전트</h3>
        </div>
        <span className="cockpit-pill">{sessions.length}</span>
      </div>

      <p className="subagent-panel__copy">
        현재 세션의 최신 opencode run을 기준으로 독립 하위 세션을 만들고, 결과는 부모 채팅에 자동 요약됩니다.
      </p>

      <div className="subagent-panel__form">
        <label className="cockpit-field">
          <span>역할 이름</span>
          <input
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            onBlur={() => {
              if (!prompt.trim()) {
                setPrompt(defaultPrompt(title));
              }
            }}
            placeholder="예: 테스트 조사원"
            value={title}
          />
        </label>
        <label className="cockpit-field">
          <span>하위 작업 지시</span>
          <textarea
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="서브에이전트가 독립적으로 수행할 좁은 작업을 적어주세요."
            rows={5}
            value={prompt}
          />
        </label>
        <div className="subagent-panel__actions">
          <button
            className="cockpit-mini-button is-primary"
            disabled={!canCreate}
            onClick={() => {
              onCreateSession({
                title: title.trim() || undefined,
                prompt: prompt.trim(),
              });
            }}
            type="button"
          >
            서브에이전트 시작
          </button>
          <button className="cockpit-mini-button" onClick={onRefresh} type="button">
            새로고침
          </button>
        </div>
        <p className="cockpit-muted">{createDisabledReason}</p>
      </div>

      <div className="subagent-panel__list">
        {sessions.length ? (
          sessions.map((session) => {
            const task = tasksByConversationId.get(session.id);
            const isActive = task?.status === "queued" || task?.status === "running";
            return (
              <article className="subagent-panel__item" key={session.id}>
                <div className="subagent-panel__item-main">
                  <span className={`status-pill status-pill--${statusTone(task?.status)}`}>
                    {statusLabel(task?.status)}
                  </span>
                  <div>
                    <strong>{session.title}</strong>
                    <small>
                      {task ? `${task.title} / ${formatTime(task.updatedAt)}` : formatTime(session.updatedAt)}
                    </small>
                  </div>
                </div>
                <div className="subagent-panel__item-actions">
                  <button
                    className="cockpit-mini-button"
                    onClick={() => onOpenSession(session.id)}
                    type="button"
                  >
                    열기
                  </button>
                  <button
                    className="cockpit-mini-button cockpit-mini-button--danger"
                    disabled={!isActive}
                    onClick={() => onCancelSession(session.id)}
                    type="button"
                  >
                    취소
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <p className="cockpit-empty">
            아직 서브에이전트가 없습니다. 큰 작업을 조사, 테스트, 문서화처럼 좁게 나눠 맡길 수 있습니다.
          </p>
        )}
      </div>
    </section>
  );
}
