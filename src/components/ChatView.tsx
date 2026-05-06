import { useEffect, useRef } from "react";
import type { DisplayMessage } from "../types";

interface ChatViewProps {
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
  const hasAssistantMessage = props.messages.some((message) => message.role === "assistant");

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [props.messages, props.pendingAssistantText]);

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
              <span>예: 현재 세션 워크스페이스에 README 초안을 만들고 변경 파일을 요약해 줘.</span>
            </div>
            <div className="chat-view__starter-card">
              <strong>워크플로우 작성</strong>
              <span>예: 요구사항 정리부터 결정 로그까지 긴 작업을 단계별 Flow로 나눠 줘.</span>
            </div>
            <div className="chat-view__starter-card">
              <strong>조사 / 요약</strong>
              <span>예: 이 세션의 최근 실행 로그와 변경 파일을 읽고 다음 액션을 제안해 줘.</span>
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
