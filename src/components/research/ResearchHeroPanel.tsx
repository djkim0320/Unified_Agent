import type { AgentRecord, ConversationRecord, ResearchProjectRecord } from "../../types";

interface ResearchHeroPanelProps {
  activeAgent: AgentRecord | null;
  activeConversation: ConversationRecord | null;
  activeProject: ResearchProjectRecord | null;
  onCreateReport: (projectId: string) => void;
  onCreateReportTask: (projectId: string) => void;
  onRefresh: (projectId?: string | null) => void;
  onStartSelfImprovement: (
    agentId: string,
    payload?: {
      conversationId?: string | null;
      goal?: string | null;
      autoStart?: boolean;
      workspaceMode?: "session" | "repository";
    },
  ) => void;
}

export function ResearchHeroPanel({
  activeAgent,
  activeConversation,
  activeProject,
  onCreateReport,
  onCreateReportTask,
  onRefresh,
  onStartSelfImprovement,
}: ResearchHeroPanelProps) {
  return (
    <section className="cockpit-section__hero">
      <p className="cockpit-eyebrow">Research Autonomy</p>
      <h1>연구 관제</h1>
      <p>
        장기 연구 목표를 질문, 가설, 증거, Flow Loop로 나누고 opencode 실행 결과를 보수적으로 기록합니다.
        자율 실행은 기본적으로 꺼져 있으며 승인 게이트가 사람의 체크포인트 역할을 합니다.
      </p>
      <div className="cockpit-section__hero-actions">
        <button className="cockpit-mini-button" disabled={!activeProject} onClick={() => activeProject && onRefresh(activeProject.id)} type="button">
          새로고침
        </button>
        <button className="cockpit-mini-button" disabled={!activeProject} onClick={() => activeProject && onCreateReport(activeProject.id)} type="button">
          최종 연구 보고서 생성
        </button>
        <button className="cockpit-mini-button" disabled={!activeProject} onClick={() => activeProject && onCreateReportTask(activeProject.id)} type="button">
          opencode 보고서 초안
        </button>
        <button
          className="cockpit-mini-button cockpit-mini-button--primary"
          disabled={!activeAgent}
          onClick={() =>
            activeAgent &&
            onStartSelfImprovement(activeAgent.id, {
              conversationId: activeConversation?.id ?? null,
              autoStart: true,
              workspaceMode: "repository",
            })
          }
          type="button"
        >
          자기개선 Goal 시작
        </button>
      </div>
    </section>
  );
}
