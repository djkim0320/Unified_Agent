import { useEffect, useRef } from "react";
import type { DisplayMessage } from "../types";

interface ChatViewProps {
  messages: DisplayMessage[];
  pendingAssistantText: string;
  loading: boolean;
  error: string | null;
  changedFiles: string[];
}

function looksStructuredText(content: string) {
  const trimmed = content.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function renderMessageBody(content: string) {
  if (looksStructuredText(content)) {
    return <pre className="chat-response__code">{content}</pre>;
  }

  return <p>{content}</p>;
}

export function ChatView(props: ChatViewProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastAssistantMessageId =
    [...props.messages].reverse().find((message) => message.role === "assistant")?.id ?? null;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [props.messages, props.pendingAssistantText]);

  const showEmpty = props.messages.length === 0 && !props.pendingAssistantText;

  return (
    <section className="chat-view">
      {showEmpty ? (
        <div className="chat-view__empty">
          <p className="eyebrow">채팅</p>
          <h2>무엇을 도와드릴까요?</h2>
          <p>
            에이전트에게 바로 작업을 요청할 수 있습니다. 파일 수정, 코드 작성, 조사, 요약처럼
            결과가 분명한 요청일수록 흐름이 더 매끄럽습니다.
          </p>

          <div className="chat-view__starter-grid" aria-hidden="true">
            <div className="chat-view__starter-card">
              <strong>파일 작업</strong>
              <span>현재 세션 워크스페이스 안에서 파일을 만들거나 수정합니다.</span>
            </div>
            <div className="chat-view__starter-card">
              <strong>리서치</strong>
              <span>웹 조사와 브라우저 흐름까지 같은 세션 안에서 이어갑니다.</span>
            </div>
            <div className="chat-view__starter-card">
              <strong>자동화</strong>
              <span>백그라운드 작업과 heartbeat 상태까지 함께 추적할 수 있습니다.</span>
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
                  <span className="chat-entry__meta">내 요청</span>
                </>
              ) : (
                <div className="chat-response">
                  <p className="chat-response__label">에이전트</p>
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

          {props.pendingAssistantText ? (
            <article className="chat-entry chat-entry--assistant">
              <div className="chat-response is-pending">
                <p className="chat-response__label">에이전트</p>
                <div className="chat-response__body">{renderMessageBody(props.pendingAssistantText)}</div>
              </div>
            </article>
          ) : null}

          {props.loading && !props.pendingAssistantText ? (
            <article className="chat-entry chat-entry--assistant">
              <div className="chat-response is-pending">
                <p className="chat-response__label">에이전트</p>
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
