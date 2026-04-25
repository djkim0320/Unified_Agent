import type {
  DisplayMessage,
  WorkspaceRunEventRecord,
  WorkspaceRunRecord,
} from "../types";

interface ActivityFeedProps {
  messages: DisplayMessage[];
  liveEvents: WorkspaceRunEventRecord[];
  runEvents: WorkspaceRunEventRecord[] | null;
  pendingAssistantText: string;
  selectedRun?: WorkspaceRunRecord | null;
}

type ActivityItem =
  | {
      kind: "message";
      id: string;
      role: DisplayMessage["role"];
      content: string;
      pending?: boolean;
    }
  | {
      kind: "event";
      id: string;
      event: WorkspaceRunEventRecord;
      source: "stored" | "live";
    };

function looksStructuredText(content: string) {
  const trimmed = content.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function renderMessageBody(content: string) {
  if (looksStructuredText(content)) {
    return <pre className="activity-bubble__code">{content}</pre>;
  }

  return <p>{content}</p>;
}

function isAbsoluteHostPath(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) || /^\/(?!\/)/.test(value);
}

function sanitizePayload(value: unknown): unknown {
  if (typeof value === "string") {
    return isAbsoluteHostPath(value) ? "[경로 비공개]" : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePayload(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, sanitizePayload(child)]),
    );
  }

  return value;
}

function formatPayload(payload: Record<string, unknown>) {
  try {
    return JSON.stringify(sanitizePayload(payload), null, 2);
  } catch {
    return "[표시할 수 없는 이벤트 데이터]";
  }
}

function getToolName(payload: Record<string, unknown>) {
  const candidates = [
    payload.toolName,
    payload.tool,
    payload.name,
    payload.command,
  ];

  const match = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof match === "string" ? match : "도구 실행";
}

function getEventSignature(event: WorkspaceRunEventRecord) {
  return `${event.eventType}:${formatPayload(event.payload)}`;
}

function getStatusMessage(event: WorkspaceRunEventRecord) {
  if (typeof event.payload.message === "string" && event.payload.message.trim().length > 0) {
    return event.payload.message;
  }

  if (typeof event.payload.error === "string" && event.payload.error.trim().length > 0) {
    return event.payload.error;
  }

  switch (event.eventType) {
    case "status":
      return "실행 상태가 업데이트되었습니다.";
    case "run_complete":
      return "실행이 완료되었습니다.";
    case "run_failed":
      return "실행이 실패했습니다.";
    case "run_cancelled":
      return "실행이 취소되었습니다.";
    case "error":
      return "실행 중 오류가 발생했습니다.";
    default:
      return event.eventType;
  }
}

function isSuccessfulResult(event: WorkspaceRunEventRecord) {
  if (event.eventType === "error" || event.eventType === "run_failed") {
    return false;
  }

  if (typeof event.payload.success === "boolean") {
    return event.payload.success;
  }

  if (typeof event.payload.ok === "boolean") {
    return event.payload.ok;
  }

  if (typeof event.payload.error === "string" && event.payload.error.trim().length > 0) {
    return false;
  }

  return true;
}

function buildFeedItems(props: ActivityFeedProps): ActivityItem[] {
  const storedEvents = [...(props.runEvents ?? [])].sort((left, right) => left.createdAt - right.createdAt);
  const storedSignatures = new Set(storedEvents.map((event) => getEventSignature(event)));
  const liveEvents = [...props.liveEvents]
    .filter((event) => !storedSignatures.has(getEventSignature(event)))
    .sort((left, right) => left.createdAt - right.createdAt);
  const eventItems: ActivityItem[] = [
    ...storedEvents.map((event) => ({
      kind: "event" as const,
      id: `stored-${event.id}`,
      event,
      source: "stored" as const,
    })),
    ...liveEvents.map((event) => ({
      kind: "event" as const,
      id: `live-${event.id}`,
      event,
      source: "live" as const,
    })),
  ].sort((left, right) => left.event.createdAt - right.event.createdAt);

  const lastUserIndex = [...props.messages]
    .map((message, index) => (message.role === "user" ? index : -1))
    .filter((index) => index >= 0)
    .at(-1) ?? -1;

  const items: ActivityItem[] = [];

  props.messages.forEach((message, index) => {
    items.push({
      kind: "message",
      id: message.id,
      role: message.role,
      content: message.content,
      pending: message.pending,
    });

    if (index === lastUserIndex) {
      items.push(...eventItems);

      if (props.pendingAssistantText) {
        items.push({
          kind: "message",
          id: "pending-assistant",
          role: "assistant",
          content: props.pendingAssistantText,
          pending: true,
        });
      }
    }
  });

  if (lastUserIndex === -1) {
    items.push(...eventItems);

    if (props.pendingAssistantText) {
      items.push({
        kind: "message",
        id: "pending-assistant",
        role: "assistant",
        content: props.pendingAssistantText,
        pending: true,
      });
    }
  }

  return items;
}

function renderEventStatusLabel(eventType: WorkspaceRunEventRecord["eventType"]) {
  switch (eventType) {
    case "run_complete":
      return "완료";
    case "run_failed":
      return "실패";
    case "run_cancelled":
      return "취소";
    case "error":
      return "오류";
    default:
      return "상태";
  }
}

function renderEventBubble(item: Extract<ActivityItem, { kind: "event" }>) {
  const { event } = item;

  if (event.eventType === "tool_call") {
    const toolName = getToolName(event.payload);
    return (
      <article className="activity-entry activity-entry--tool" key={item.id}>
        <div className="activity-bubble activity-bubble--tool">
          <div className="activity-bubble__eyebrow">도구 호출</div>
          <div className="activity-bubble__title-row">
            <strong>{toolName}</strong>
            <span className="activity-badge activity-badge--muted">
              {item.source === "live" ? "실시간" : "기록"}
            </span>
          </div>
          <details className="activity-bubble__details">
            <summary>요청 JSON 보기</summary>
            <pre>{formatPayload(event.payload)}</pre>
          </details>
        </div>
      </article>
    );
  }

  if (event.eventType === "tool_result" || event.eventType === "error") {
    const toolName = getToolName(event.payload);
    const successful = isSuccessfulResult(event);

    return (
      <article className="activity-entry activity-entry--result" key={item.id}>
        <div
          className={`activity-bubble activity-bubble--result${
            successful ? "" : " is-error"
          }`}
        >
          <div className="activity-bubble__eyebrow">
            {event.eventType === "error" ? "실행 오류" : "도구 결과"}
          </div>
          <div className="activity-bubble__title-row">
            <strong>{toolName}</strong>
            <span
              className={`activity-badge ${
                successful ? "activity-badge--success" : "activity-badge--error"
              }`}
            >
              {successful ? "성공" : "실패"}
            </span>
          </div>
          <details className="activity-bubble__details">
            <summary>결과 JSON 보기</summary>
            <pre>{formatPayload(event.payload)}</pre>
          </details>
        </div>
      </article>
    );
  }

  return (
    <article className="activity-entry activity-entry--status" key={item.id}>
      <div
        className={`activity-bubble activity-bubble--status${
          event.eventType === "run_failed" || event.eventType === "run_cancelled" ? " is-error" : ""
        }`}
      >
        <span className="activity-bubble__status-label">{renderEventStatusLabel(event.eventType)}</span>
        <strong>{getStatusMessage(event)}</strong>
      </div>
    </article>
  );
}

export function ActivityFeed(props: ActivityFeedProps) {
  const items = buildFeedItems(props);

  if (items.length === 0) {
    return (
      <div className="activity-feed activity-feed--empty">
        <p className="activity-feed__empty">
          아직 기록된 활동이 없습니다. 대화를 보내면 사용자 메시지와 실행 로그가 이 흐름에 함께 쌓입니다.
        </p>
      </div>
    );
  }

  return (
    <div className="activity-feed">
      {props.selectedRun ? (
        <p className="activity-feed__meta">
          현재 표시 중인 실행: <strong>{props.selectedRun.model}</strong>
        </p>
      ) : null}

      {items.map((item) => {
        if (item.kind === "event") {
          return renderEventBubble(item);
        }

        const isUser = item.role === "user";
        return (
          <article
            className={`activity-entry ${isUser ? "activity-entry--user" : "activity-entry--assistant"}`}
            key={item.id}
          >
            {isUser ? (
              <div className="activity-bubble activity-bubble--user">
                {renderMessageBody(item.content)}
              </div>
            ) : (
              <div
                className={`activity-bubble activity-bubble--assistant${
                  item.pending ? " is-pending" : ""
                }`}
              >
                <div className="activity-bubble__eyebrow">에이전트 응답</div>
                {renderMessageBody(item.content)}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
