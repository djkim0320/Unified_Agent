import { getModelOption } from "../model-catalog";
import { providerLabels, type ConversationRecord } from "../types";

interface ConversationListProps {
  conversations: ConversationRecord[];
  activeConversationId: string | null;
  onCreateConversation: () => void;
  onDeleteConversation: (conversationId: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onOpenSettings: () => void;
}

export function ConversationList(props: ConversationListProps) {
  return (
    <aside className="conversation-list">
      <div className="conversation-list__brand">
        <div className="conversation-list__mark">M</div>
        <div>
          <p className="conversation-list__brand-title">마인드풀 워크스페이스</p>
          <p className="conversation-list__brand-subtitle">디지털 생추어리</p>
        </div>
      </div>

      <button
        className="primary-button conversation-list__new-chat"
        onClick={props.onCreateConversation}
        type="button"
      >
        + 새 채팅
      </button>

      <div className="conversation-list__section-label">최근 대화</div>

      <div className="conversation-list__items">
        {props.conversations.map((conversation) => {
          const active = conversation.id === props.activeConversationId;
          const model = getModelOption(conversation.providerKind, conversation.model);
          return (
            <div className={`conversation-list__item ${active ? "is-active" : ""}`} key={conversation.id}>
              <button
                className="conversation-list__item-main"
                onClick={() => props.onSelectConversation(conversation.id)}
                type="button"
              >
                <span className="conversation-list__title">{conversation.title}</span>
                <span className="conversation-list__meta">
                  {providerLabels[conversation.providerKind]} / {model.label}
                </span>
              </button>

              <button
                aria-label={`${conversation.title} 삭제`}
                className="conversation-list__delete"
                onClick={() => props.onDeleteConversation(conversation.id)}
                type="button"
              >
                ×
              </button>
            </div>
          );
        })}

        {props.conversations.length === 0 ? (
          <div className="conversation-list__empty">
            대화를 시작하면 선택한 프로바이더와 모델 정보가 여기에 저장됩니다.
          </div>
        ) : null}
      </div>

      <div className="conversation-list__footer">
        <button className="conversation-list__footer-link" onClick={props.onOpenSettings} type="button">
          설정
        </button>
        <button className="conversation-list__footer-link" type="button">
          도움말
        </button>
      </div>
    </aside>
  );
}
