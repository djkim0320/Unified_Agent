import type { AgentRecord, ConversationRecord, ResearchProjectRecord } from "../../types";
import { compactTime, statusLabel } from "./researchFormat";

interface ResearchProjectListPanelProps {
  activeAgent: AgentRecord | null;
  activeConversation: ConversationRecord | null;
  activeProject: ResearchProjectRecord | null;
  projects: ResearchProjectRecord[];
  newProjectTitle: string;
  newProjectObjective: string;
  onCreateProject: (payload: {
    agentId: string;
    conversationId?: string | null;
    title: string;
    objective: string;
    domain?: string | null;
  }) => void;
  onSelectProject: (projectId: string) => void;
  setNewProjectObjective: (value: string) => void;
  setNewProjectTitle: (value: string) => void;
}

export function ResearchProjectListPanel({
  activeAgent,
  activeConversation,
  activeProject,
  projects,
  newProjectTitle,
  newProjectObjective,
  onCreateProject,
  onSelectProject,
  setNewProjectObjective,
  setNewProjectTitle,
}: ResearchProjectListPanelProps) {
  function submitProject() {
    if (!activeAgent || !newProjectTitle.trim() || !newProjectObjective.trim()) return;
    onCreateProject({
      agentId: activeAgent.id,
      conversationId: activeConversation?.id ?? null,
      title: newProjectTitle.trim(),
      objective: newProjectObjective.trim(),
    });
    setNewProjectTitle("");
    setNewProjectObjective("");
  }

  return (
    <section className="cockpit-section-card">
      <div className="cockpit-section-card__header">
        <h2>Research Project</h2>
        <span className="cockpit-pill">{projects.length}</span>
      </div>
      <div className="cockpit-compact-list">
        {projects.map((project) => (
          <button
            className={`cockpit-flow-list-item__main ${activeProject?.id === project.id ? "is-active" : ""}`}
            key={project.id}
            onClick={() => onSelectProject(project.id)}
            type="button"
          >
            <strong>{project.title}</strong>
            <span>{statusLabel(project.status)} / {compactTime(project.updatedAt)}</span>
          </button>
        ))}
        {!projects.length ? <p className="cockpit-empty">아직 연구 프로젝트가 없습니다.</p> : null}
      </div>
      <div className="cockpit-inline-form">
        <strong>새 연구 프로젝트</strong>
        <label className="cockpit-field">
          <span>제목</span>
          <input value={newProjectTitle} onChange={(event) => setNewProjectTitle(event.target.value)} placeholder="예: 항공 연구 자동화" />
        </label>
        <label className="cockpit-field">
          <span>목표</span>
          <textarea rows={4} value={newProjectObjective} onChange={(event) => setNewProjectObjective(event.target.value)} placeholder="연구 목표와 제약조건을 적어주세요." />
        </label>
        <button className="cockpit-mini-button cockpit-mini-button--primary" disabled={!activeAgent || !newProjectTitle.trim() || !newProjectObjective.trim()} onClick={submitProject} type="button">
          프로젝트 만들기
        </button>
      </div>
    </section>
  );
}
