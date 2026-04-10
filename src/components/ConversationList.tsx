import { getModelOption } from "../model-catalog";
import { providerLabels, type AgentRecord, type ConversationRecord } from "../types";

interface ConversationListProps {
  agents: AgentRecord[];
  activeAgentId: string | null;
  conversations: ConversationRecord[];
  activeConversationId: string | null;
  onCreateAgent: () => void;
  onCreateConversation: () => void;
  onDeleteConversation: (conversationId: string) => void;
  onSelectAgent: (agentId: string) => void;
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
          <p className="conversation-list__brand-subtitle">로컬 에이전트 게이트웨이</p>
        </div>
      </div>

      <section className="conversation-list__agents" aria-label="에이전트 선택">
        <div className="conversation-list__section-label">에이전트</div>
        <div className="conversation-list__agent-row">
          <select
            aria-label="활성 에이전트"
            value={props.activeAgentId ?? ""}
            onChange={(event) => props.onSelectAgent(event.target.value)}
          >
            {props.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <button
            className="conversation-list__agent-create"
            onClick={props.onCreateAgent}
            type="button"
          >
            + 에이전트
          </button>
        </div>
      </section>

      <button
        className="primary-button conversation-list__new-chat"
        onClick={props.onCreateConversation}
        type="button"
      >
        + 새 채팅
      </button>

      <div className="conversation-list__section-label">최근 세션</div>

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
            아직 이 에이전트의 세션이 없습니다. 새 채팅을 만들어 바로 시작해 보세요.
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
