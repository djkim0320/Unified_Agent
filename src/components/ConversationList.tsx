import { getModelOption } from "../model-catalog";
import { type AgentRecord, type ConversationRecord, providerLabels } from "../types";
import { CustomSelect } from "./ui/CustomSelect";

interface ConversationListProps {
  agents: AgentRecord[];
  activeAgentId: string | null;
  conversations: ConversationRecord[];
  activeConversationId: string | null;
  onCreateConversation: () => void;
  onDeleteConversation: (conversationId: string) => void;
  onOpenAgentSettings: () => void;
  onSelectAgent: (agentId: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onOpenSettings: () => void;
}

export function ConversationList(props: ConversationListProps) {
  const activeAgent = props.agents.find((agent) => agent.id === props.activeAgentId) ?? null;

  return (
    <aside className="conversation-list">
      <div className="conversation-list__brand">
        <div className="conversation-list__mark">M</div>
        <div>
          <p className="conversation-list__brand-title">마인드 워크스페이스</p>
          <p className="conversation-list__brand-subtitle">로컬 에이전트 게이트웨이</p>
        </div>
      </div>

      <section className="conversation-list__agents" aria-label="에이전트 선택">
        <div className="conversation-list__section-row">
          <div>
            <div className="conversation-list__section-label">에이전트</div>
            <p className="conversation-list__agent-caption">
              {activeAgent ? `현재 작업 대상: ${activeAgent.name}` : "작업할 에이전트를 선택해 주세요."}
            </p>
          </div>
          <button className="conversation-list__action-button" onClick={props.onOpenAgentSettings} type="button">
            설정
          </button>
        </div>

        <div className="conversation-list__agent-row" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <CustomSelect
            ariaLabel="활성 에이전트"
            value={props.activeAgentId ?? ""}
            onChange={props.onSelectAgent}
            options={props.agents.map((agent) => ({ value: agent.id, label: agent.name }))}
            className="flex-grow-select"
          />
        </div>
      </section>

      <button className="primary-button conversation-list__new-chat" onClick={props.onCreateConversation} type="button">
        + 새 채팅
      </button>

      <div className="conversation-list__section-row">
        <div className="conversation-list__section-label">최근 세션</div>
        <span className="conversation-list__count">{props.conversations.length}</span>
      </div>

      <div className="conversation-list__items">
        {props.conversations.map((conversation) => {
          const active = conversation.id === props.activeConversationId;
          const model = getModelOption(conversation.providerKind, conversation.model);

          return (
            <div className={`conversation-list__item ${active ? "is-active" : ""}`} key={conversation.id}>
              <button
                className="conversation-list__item-main"
                onClick={() => props.onSelectConversation(conversation.id)}
                title={conversation.title}
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
            아직 세션이 없습니다. 새 채팅을 만들고 바로 작업을 시작해 보세요.
          </div>
        ) : null}
      </div>

      <div className="conversation-list__footer">
        <button className="conversation-list__footer-link" onClick={props.onOpenSettings} type="button">
          API 연결 관리
        </button>
      </div>
    </aside>
  );
}
