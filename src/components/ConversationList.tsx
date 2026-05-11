import { displayConversationTitle } from "../appStateUtils";
import { type AgentRecord, type ConversationRecord, type ResearchProjectRecord } from "../types";

export type CockpitNavTarget = "chat" | "workflow" | "research" | "mcp" | "skills" | "settings";

interface ConversationListProps {
  activeAgentId: string | null;
  activeConversationId: string | null;
  activeNavTarget: CockpitNavTarget;
  activeResearchProjectId?: string | null;
  agents: AgentRecord[];
  conversations: ConversationRecord[];
  researchProjects?: ResearchProjectRecord[];
  onCreateConversation: () => void;
  onCreateProject?: () => void;
  onDeleteConversation: (conversationId: string) => void;
  onNavigate: (target: CockpitNavTarget) => void;
  onOpenAgentSettings: () => void;
  onSelectAgent: (agentId: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onSelectResearchProject?: (projectId: string) => void;
  onOpenSettings: () => void;
}

const quickActions: Array<{ label: string; icon: string; action: "new-chat" | CockpitNavTarget }> = [
  { label: "새 채팅", icon: "✎", action: "new-chat" },
  { label: "검색", icon: "⌕", action: "research" },
  { label: "플러그인", icon: "⌘", action: "mcp" },
  { label: "스킬", icon: "◇", action: "skills" },
  { label: "자동화", icon: "◷", action: "settings" },
];

function relativeTime(timestamp: number) {
  const diff = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일`;
  if (days < 35) return `${Math.floor(days / 7)}주`;
  return `${Math.floor(days / 30)}개월`;
}

function shortTitle(title: string, fallback = "새 채팅") {
  const value = displayConversationTitle(title).trim() || fallback;
  return value.length > 34 ? `${value.slice(0, 33)}…` : value;
}

export function ConversationList(props: ConversationListProps) {
  const activeAgent = props.agents.find((agent) => agent.id === props.activeAgentId) ?? null;
  const projects = [...(props.researchProjects ?? [])].sort((left, right) => right.updatedAt - left.updatedAt);
  const linkedConversationIds = new Set(projects.map((project) => project.conversationId).filter(Boolean));
  const looseConversations = props.conversations.filter((conversation) => !linkedConversationIds.has(conversation.id));

  const handleQuickAction = (action: "new-chat" | CockpitNavTarget) => {
    if (action === "new-chat") {
      props.onCreateConversation();
      return;
    }
    props.onNavigate(action);
  };

  return (
    <aside className="conversation-shell conversation-shell--projects">
      <div className="project-sidebar">
        <div className="project-sidebar__brand">
          <span className="project-sidebar__mark">AO</span>
          <div>
            <strong>AetherOps</strong>
            <span>연구 프로젝트 cockpit</span>
          </div>
        </div>

        <nav className="project-sidebar__quick-actions" aria-label="주요 작업">
          {quickActions.map((item) => (
            <button
              className={`project-sidebar__quick-action ${
                item.action !== "new-chat" && props.activeNavTarget === item.action ? "is-active" : ""
              }`}
              key={item.label}
              onClick={() => handleQuickAction(item.action)}
              type="button"
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          ))}
          <button className="project-sidebar__quick-action" onClick={props.onCreateProject} type="button">
            <span aria-hidden="true">＋</span>
            새 프로젝트
          </button>
        </nav>

        <section className="project-sidebar__agent" aria-label="활성 에이전트">
          <div>
            <span>에이전트</span>
            <strong>{activeAgent?.name ?? "에이전트 선택 필요"}</strong>
          </div>
          <button aria-label="에이전트 설정" onClick={props.onOpenAgentSettings} type="button">
            설정
          </button>
        </section>

        <div className="project-sidebar__section-title">프로젝트</div>

        <div className="project-sidebar__scroll">
          {looseConversations.length ? (
            <section className="project-group">
              <button
                className={`project-group__header ${props.activeNavTarget === "chat" ? "is-active" : ""}`}
                onClick={() => props.onNavigate("chat")}
                type="button"
              >
                <span aria-hidden="true">▱</span>
                채팅
              </button>
              <div className="project-group__sessions">
                {looseConversations.slice(0, 8).map((conversation) => (
                  <div
                    className={`project-session ${conversation.id === props.activeConversationId ? "is-active" : ""}`}
                    key={conversation.id}
                  >
                    <button
                      className="project-session__main"
                      onClick={() => props.onSelectConversation(conversation.id)}
                      title={displayConversationTitle(conversation.title)}
                      type="button"
                    >
                      <span>{shortTitle(conversation.title)}</span>
                      <small>{relativeTime(conversation.updatedAt)}</small>
                    </button>
                    <button
                      aria-label={`${displayConversationTitle(conversation.title)} 삭제`}
                      className="project-session__delete"
                      onClick={() => props.onDeleteConversation(conversation.id)}
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {projects.map((project) => {
            const projectConversation = project.conversationId
              ? props.conversations.find((conversation) => conversation.id === project.conversationId)
              : null;
            const activeProject = props.activeResearchProjectId === project.id;
            return (
              <section className="project-group" key={project.id}>
                <button
                  className={`project-group__header ${activeProject ? "is-active" : ""}`}
                  onClick={() => {
                    props.onSelectResearchProject?.(project.id);
                    props.onNavigate("research");
                  }}
                  title={project.title}
                  type="button"
                >
                  <span aria-hidden="true">▱</span>
                  {project.title}
                </button>
                <div className="project-group__sessions">
                  {projectConversation ? (
                    <div
                      className={`project-session ${
                        projectConversation.id === props.activeConversationId ? "is-active" : ""
                      }`}
                    >
                      <button
                        className="project-session__main"
                        onClick={() => {
                          props.onSelectResearchProject?.(project.id);
                          props.onSelectConversation(projectConversation.id);
                        }}
                        title={displayConversationTitle(projectConversation.title)}
                        type="button"
                      >
                        <span>{shortTitle(projectConversation.title, project.title)}</span>
                        <small>{relativeTime(projectConversation.updatedAt)}</small>
                      </button>
                      <button
                        aria-label={`${displayConversationTitle(projectConversation.title)} 삭제`}
                        className="project-session__delete"
                        onClick={() => props.onDeleteConversation(projectConversation.id)}
                        type="button"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <button
                      className="project-session project-session--empty"
                      onClick={() => {
                        props.onSelectResearchProject?.(project.id);
                        props.onNavigate("research");
                      }}
                      type="button"
                    >
                      세션 연결 필요
                    </button>
                  )}
                </div>
              </section>
            );
          })}

          {!projects.length && !looseConversations.length ? (
            <div className="project-sidebar__empty">
              새 프로젝트를 만들고 그 안에서 연구 세션을 시작해 보세요.
            </div>
          ) : null}
        </div>

        <div className="project-sidebar__footer">
          <button aria-label="API 연결 관리" onClick={props.onOpenSettings} type="button">
            API 연결 관리
          </button>
        </div>
      </div>
    </aside>
  );
}
