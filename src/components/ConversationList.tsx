import { getModelOption } from "../model-catalog";
import { type AgentRecord, type ConversationRecord, providerLabels } from "../types";
import { CustomSelect } from "./ui/CustomSelect";

export type CockpitNavTarget =
  | "chat"
  | "workflow"
  | "mcp"
  | "skills"
  | "files"
  | "settings";

interface ConversationListProps {
  activeAgentId: string | null;
  activeConversationId: string | null;
  activeNavTarget: CockpitNavTarget;
  agents: AgentRecord[];
  conversations: ConversationRecord[];
  onCreateConversation: () => void;
  onDeleteConversation: (conversationId: string) => void;
  onNavigate: (target: CockpitNavTarget) => void;
  onOpenAgentSettings: () => void;
  onSelectAgent: (agentId: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onOpenSettings: () => void;
}

const navItems: Array<{ target: CockpitNavTarget; label: string }> = [
  { target: "chat", label: "채팅" },
  { target: "workflow", label: "워크플로우" },
  { target: "mcp", label: "MCP 서버" },
  { target: "skills", label: "스킬" },
  { target: "files", label: "파일" },
];

export function ConversationList(props: ConversationListProps) {
  const activeAgent = props.agents.find((agent) => agent.id === props.activeAgentId) ?? null;

  return (
    <aside className="conversation-shell">
      <nav className="cockpit-nav" aria-label="주요 화면">
        <div className="cockpit-nav__mark">UA</div>
        {navItems.map((item) => (
          <button
            aria-current={props.activeNavTarget === item.target ? "page" : undefined}
            aria-label={item.label}
            className={`cockpit-nav__item ${props.activeNavTarget === item.target ? "is-active" : ""}`}
            key={item.target}
            onClick={() => props.onNavigate(item.target)}
            type="button"
          >
            {item.label}
          </button>
        ))}
        <button
          aria-current={props.activeNavTarget === "settings" ? "page" : undefined}
          aria-label="설정"
          className={`cockpit-nav__item cockpit-nav__item--bottom ${
            props.activeNavTarget === "settings" ? "is-active" : ""
          }`}
          onClick={() => props.onNavigate("settings")}
          type="button"
        >
          설정
        </button>
      </nav>

      <div className="conversation-list">
        <div className="conversation-list__brand">
          <div className="conversation-list__mark">◇</div>
          <div>
            <p className="conversation-list__brand-title">통합 에이전트</p>
            <p className="conversation-list__brand-subtitle">로컬 작업 조종석</p>
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

          <div className="conversation-list__agent-row">
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
          + 새 세션
        </button>

        <div className="conversation-list__section-row">
          <div className="conversation-list__section-label">세션</div>
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
                  x
                </button>
              </div>
            );
          })}

          {props.conversations.length === 0 ? (
            <div className="conversation-list__empty">
              아직 세션이 없습니다. 새 세션을 만들고 바로 작업을 시작해 보세요.
            </div>
          ) : null}
        </div>

        <div className="conversation-list__footer">
          <button className="conversation-list__footer-link" onClick={props.onOpenSettings} type="button">
            API 연결 관리
          </button>
        </div>
      </div>
    </aside>
  );
}
