import { useEffect, useMemo, useRef } from "react";
import type { DisplayMessage, WorkspaceRunEventRecord } from "../types";

interface ChatViewProps {
  activityEvents: WorkspaceRunEventRecord[];
  messages: DisplayMessage[];
  pendingAssistantText: string;
  loading: boolean;
  error: string | null;
  changedFiles: string[];
}

const defaultPlanSteps = [
  "요구사항 정리",
  "자료 조사",
  "후보안 비교",
  "실행 계획",
  "결정 로그",
];

function looksStructuredText(content: string) {
  const trimmed = content.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function removeMarkdownEmphasis(content: string) {
  return content
    .replace(/\*\*([^*\n][^*]*?)\*\*/g, "$1")
    .replace(/__([^_\n][^_]*?)__/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "");
}

function renderMessageBody(content: string) {
  if (looksStructuredText(content)) {
    return <pre className="chat-response__code">{content}</pre>;
  }

  const displayText = removeMarkdownEmphasis(content);
  const paragraphs = displayText
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!paragraphs.length) {
    return <p />;
  }

  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <p className="chat-response__paragraph" key={`${paragraph.slice(0, 24)}-${index}`}>
          {paragraph}
        </p>
      ))}
    </>
  );
}

function safeText(value: unknown, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value
    .replace(/[A-Za-z]:[\\/][^\s"'<>]+/g, "[로컬 경로]")
    .replace(/\\\\[^\s"'<>]+/g, "[로컬 경로]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b[A-Z0-9_]*(TOKEN|SECRET|PASSWORD|API_KEY|KEY)\s*=\s*[^\s"'<>]+/gi, "$1=[redacted]")
    .slice(0, 220);
}

function nestedString(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : null;
}

function phaseLabel(phase: string | null) {
  switch (phase) {
    case "engine_run_started":
      return "opencode 실행 시작";
    case "opencode_event":
      return "opencode 이벤트 처리";
    case "opencode_stderr":
      return "엔진 상태 수신";
    case "snapshot_timing":
      return "변경 파일 확인";
    case "snapshot_degraded":
      return "스냅샷 축소 모드";
    case "artifact_indexed":
      return "산출물 기록";
    case "engine_run_completed":
      return "실행 완료";
    case "engine_run_failed":
      return "실행 실패";
    default:
      return phase ?? "작업 상태";
  }
}

function summarizeActivityEvent(event: WorkspaceRunEventRecord) {
  const payload = event.payload;
  const phase = typeof payload.phase === "string" ? payload.phase : null;
  const nestedEvent = typeof payload.event === "object" && payload.event !== null
    ? (payload.event as Record<string, unknown>)
    : null;
  const nestedType = typeof nestedEvent?.type === "string" ? nestedEvent.type : null;
  const message =
    safeText(payload.message) ||
    safeText(payload.error) ||
    safeText(payload.summary) ||
    safeText(nestedString(nestedEvent, ["message"])) ||
    safeText(nestedString(nestedEvent, ["title"]));
  const lowerType = nestedType?.toLowerCase() ?? "";
  const isCommandLike =
    event.eventType === "tool_call" ||
    event.eventType === "tool_result" ||
    Boolean(phase?.toLowerCase().includes("command")) ||
    lowerType.includes("command") ||
    lowerType.includes("tool");

  if (phase === "snapshot_timing" && typeof payload.changedFiles === "number") {
    return {
      id: event.id,
      kind: "status" as const,
      title: "변경 파일 확인",
      detail: `${payload.changedFiles}개 파일 변경을 확인했습니다.`,
    };
  }

  if (phase === "artifact_indexed" && typeof payload.artifactCount === "number") {
    return {
      id: event.id,
      kind: "status" as const,
      title: "산출물 기록",
      detail: `${payload.artifactCount}개 산출물을 기록했습니다.`,
    };
  }

  if (phase === "opencode_event" && nestedType) {
    return {
      id: event.id,
      kind: isCommandLike ? "command" as const : "status" as const,
      title: lowerType.includes("command")
        ? "명령 이벤트 처리"
        : lowerType.includes("tool")
          ? "도구 이벤트 처리"
          : "opencode 이벤트 처리",
      detail: message || nestedType,
    };
  }

  return {
    id: event.id,
    kind: isCommandLike ? "command" as const : event.eventType === "error" ? "error" as const : "status" as const,
    title: event.eventType === "error" ? "오류 감지" : phaseLabel(phase),
    detail: message,
  };
}

function ChatActivityTimeline({
  events,
  loading,
  pendingAssistantText,
}: {
  events: WorkspaceRunEventRecord[];
  loading: boolean;
  pendingAssistantText: string;
}) {
  const items = useMemo(
    () =>
      events
        .map(summarizeActivityEvent)
        .filter((item) => item.title || item.detail)
        .slice(-8),
    [events],
  );
  const commandItems = items.filter((item) => item.kind === "command");
  const latest = items.at(-1);

  if (!loading && items.length === 0) {
    return null;
  }

  return (
    <article className="chat-entry chat-entry--assistant chat-activity-entry">
      <div className="chat-activity-stack">
        {commandItems.length ? (
          <details className="chat-activity" open>
            <summary>
              <span className="chat-activity__icon">&gt;_</span>
              <strong>명령/작업 {commandItems.length}개 실행</strong>
              <span>{latest?.title ?? "진행 중"}</span>
            </summary>
            <div className="chat-activity__body">
              {commandItems.slice(-5).map((item) => (
                <p key={item.id}>
                  <strong>{item.title}</strong>
                  {item.detail ? <span>{item.detail}</span> : null}
                </p>
              ))}
            </div>
          </details>
        ) : null}

        <details className="chat-activity chat-activity--thinking" open={loading && !pendingAssistantText}>
          <summary>
            <span className="chat-activity__icon">...</span>
            <strong>{loading ? "생각 중" : "실행 요약"}</strong>
            <span>{latest?.title ?? "응답 준비 중"}</span>
          </summary>
          <div className="chat-activity__body">
            <p className="chat-activity__note">
              내부 추론 전문은 표시하지 않고, 안전하게 공개 가능한 실행 단계와 관찰 로그만 보여줍니다.
            </p>
            {items.length ? (
              items.map((item) => (
                <p key={item.id}>
                  <strong>{item.title}</strong>
                  {item.detail ? <span>{item.detail}</span> : null}
                </p>
              ))
            ) : (
              <p>
                <strong>응답 준비</strong>
                <span>세션 상태와 실행 컨텍스트를 확인하고 있습니다.</span>
              </p>
            )}
          </div>
        </details>
      </div>
    </article>
  );
}

export function ChatView(props: ChatViewProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastAssistantMessageId =
    [...props.messages].reverse().find((message) => message.role === "assistant")?.id ?? null;
  const hasAssistantMessage = props.messages.some((message) => message.role === "assistant");

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [props.messages, props.pendingAssistantText, props.activityEvents.length]);

  const showEmpty = props.messages.length === 0 && !props.pendingAssistantText;
  const showPlanPreview =
    props.messages.length > 0 &&
    !hasAssistantMessage &&
    !props.pendingAssistantText &&
    !props.loading &&
    !props.error;

  return (
    <section className="chat-view">
      {showEmpty ? (
        <div className="chat-view__empty">
          <p className="eyebrow">채팅</p>
          <h2>어떤 작업을 시작할까요?</h2>
          <p>
            요구사항 분석, 워크플로우 생성, 파일 작성, 자료 조사처럼 결과가 분명한 작업을 요청해 주세요.
            opencode 실행 이벤트와 변경 파일은 조종석 패널에 함께 기록됩니다.
          </p>

          <div className="chat-view__starter-grid" aria-label="빠른 시작 예시">
            <div className="chat-view__starter-card">
              <strong>파일 생성</strong>
              <span>현재 세션 워크스페이스에 초안을 만들고 변경 파일을 요약합니다.</span>
            </div>
            <div className="chat-view__starter-card">
              <strong>워크플로우 작성</strong>
              <span>요구사항 정리부터 결정 로그까지 긴 작업을 단계별 Flow로 나눕니다.</span>
            </div>
            <div className="chat-view__starter-card">
              <strong>조사 / 요약</strong>
              <span>최근 실행 로그와 변경 파일을 읽고 다음 액션을 제안합니다.</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="chat-view__messages">
          {props.messages.map((message) => (
            <article key={message.id} className={`chat-entry chat-entry--${message.role}`}>
              {message.role === "user" ? (
                <>
                  <div className="chat-bubble chat-bubble--user">
                    <p>{message.content}</p>
                  </div>
                  <span className="chat-entry__meta">사용자 요청</span>
                </>
              ) : (
                <div className="chat-response">
                  <p className="chat-response__label">AetherOps</p>
                  <div className="chat-response__body">
                    {renderMessageBody(message.content)}
                    {message.id === lastAssistantMessageId && props.changedFiles.length ? (
                      <div className="chat-response__artifacts">
                        <strong>변경된 파일</strong>
                        <ul className="chat-response__files">
                          {props.changedFiles.map((file) => (
                            <li key={file}>{file}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </article>
          ))}

          {showPlanPreview ? (
            <article className="chat-entry chat-entry--assistant cockpit-inline-plan">
              <div className="chat-response">
                <p className="chat-response__label">AetherOps · 실행 계획 미리보기</p>
                <div className="chat-response__body">
                  <p>요청을 장기 작업 흐름으로 분해할 준비가 되어 있습니다. 실행하면 아래 단계가 추적 패널에 연결됩니다.</p>
                  <div className="cockpit-inline-plan__steps">
                    {defaultPlanSteps.map((step, index) => (
                      <div className="cockpit-inline-plan__step" key={step}>
                        <span>{index + 1}</span>
                        <strong>{step}</strong>
                        <em>queued</em>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </article>
          ) : null}

          <ChatActivityTimeline
            events={props.activityEvents}
            loading={props.loading}
            pendingAssistantText={props.pendingAssistantText}
          />

          {props.pendingAssistantText ? (
            <article className="chat-entry chat-entry--assistant">
              <div className="chat-response is-pending">
                <p className="chat-response__label">AetherOps</p>
                <div className="chat-response__body">{renderMessageBody(props.pendingAssistantText)}</div>
              </div>
            </article>
          ) : null}

          {props.loading && !props.pendingAssistantText ? (
            <article className="chat-entry chat-entry--assistant">
              <div className="chat-response is-pending">
                <p className="chat-response__label">AetherOps</p>
                <div className="chat-response__body">
                  <p>응답을 준비하고 있습니다...</p>
                </div>
              </div>
            </article>
          ) : null}

          {props.error ? <p className="chat-view__error">{props.error}</p> : null}
          <div ref={endRef} />
        </div>
      )}
    </section>
  );
}
