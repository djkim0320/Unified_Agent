import { useEffect, useRef } from "react";
import type { DisplayMessage, WorkspaceRunEventRecord } from "../types";

interface ChatViewProps {
  messages: DisplayMessage[];
  pendingAssistantText: string;
  loading: boolean;
  error: string | null;
  liveEvents: WorkspaceRunEventRecord[];
  changedFiles: string[];
}

function eventLabel(event: WorkspaceRunEventRecord) {
  if (event.eventType === "status" && typeof event.payload.message === "string") {
    return event.payload.message;
  }
  if (event.eventType === "tool_call") {
    return "도구 호출";
  }
  if (event.eventType === "tool_result") {
    return "도구 결과";
  }
  if (event.eventType === "error") {
    return "오류";
  }
  return event.eventType;
}

export function ChatView(props: ChatViewProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [props.messages, props.pendingAssistantText, props.liveEvents]);

  const showEmpty = props.messages.length === 0 && !props.pendingAssistantText;

  return (
    <section className="chat-view">
      {showEmpty ? (
        <div className="chat-view__empty">
          <p className="eyebrow">채팅</p>
          <h2>대화를 시작하면 AI 작업 공간이 바로 열립니다.</h2>
          <p>메시지, 워크스페이스 파일, 에이전트 실행 로그를 같은 흐름 안에서 함께 확인할 수 있습니다.</p>
        </div>
      ) : (
        <div className="chat-view__messages">
          {props.liveEvents.length ? (
            <section className="chat-activity">
              <h3>실시간 작업 상태</h3>
              {props.liveEvents.map((event) => (
                <article className="chat-activity__item" key={event.id}>
                  <strong>{eventLabel(event)}</strong>
                  <span>{JSON.stringify(event.payload)}</span>
                </article>
              ))}
            </section>
          ) : null}

          {props.messages.map((message) => (
            <article key={message.id} className={`chat-entry chat-entry--${message.role}`}>
              {message.role === "user" ? (
                <>
                  <div className="chat-bubble chat-bubble--user">
                    <p>{message.content}</p>
                  </div>
                  <span className="chat-entry__meta">이 세션에 고정됨</span>
                </>
              ) : (
                <div className="chat-response">
                  <p className="chat-response__label">Assistant</p>
                  <div className="chat-response__body">
                    <p>{message.content}</p>
                    {props.changedFiles.length ? (
                      <div className="chat-response__artifacts">
                        <strong>변경 파일</strong>
                        <ul>
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

          {props.pendingAssistantText ? (
            <article className="chat-entry chat-entry--assistant">
              <div className="chat-response is-pending">
                <p className="chat-response__label">Assistant</p>
                <div className="chat-response__body">
                  <p>{props.pendingAssistantText}</p>
                </div>
              </div>
            </article>
          ) : null}

          {props.loading && !props.pendingAssistantText ? (
            <article className="chat-entry chat-entry--assistant">
              <div className="chat-response is-pending">
                <p className="chat-response__label">Assistant</p>
                <div className="chat-response__body">
                  <p>응답을 생성하는 중입니다...</p>
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
