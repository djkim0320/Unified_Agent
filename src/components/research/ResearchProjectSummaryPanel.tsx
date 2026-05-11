import type {
  ResearchEvidenceRecord,
  ResearchHypothesisRecord,
  ResearchLoopRecord,
  ResearchPreflightResponse,
  ResearchProjectRecord,
  ResearchQuestionRecord,
} from "../../types";
import { statusLabel } from "./researchFormat";

interface ResearchProjectSummaryPanelProps {
  activeProject: ResearchProjectRecord | null;
  evidence: ResearchEvidenceRecord[];
  goalWorkspaceMode: "session" | "repository";
  hypotheses: ResearchHypothesisRecord[];
  loops: ResearchLoopRecord[];
  loopGoal: string;
  preflight: ResearchPreflightResponse | null;
  questions: ResearchQuestionRecord[];
  selectedQuestionId: string | null;
  setGoalWorkspaceMode: (mode: "session" | "repository") => void;
  onStartGoal: (
    projectId: string,
    payload?: {
      questionId?: string | null;
      goal?: string | null;
      autoStart?: boolean;
      enableAutonomy?: boolean;
      workspaceMode?: "session" | "repository";
    },
  ) => void;
  onStopGoal: (projectId: string) => void;
  onTickGoal: (projectId: string) => void;
}

export function ResearchProjectSummaryPanel({
  activeProject,
  evidence,
  goalWorkspaceMode,
  hypotheses,
  loops,
  loopGoal,
  preflight,
  questions,
  selectedQuestionId,
  setGoalWorkspaceMode,
  onStartGoal,
  onStopGoal,
  onTickGoal,
}: ResearchProjectSummaryPanelProps) {
  return (
    <section className="cockpit-section-card cockpit-section-card--wide">
      <div className="cockpit-section-card__header">
        <div>
          <p className="cockpit-eyebrow">Active Project</p>
          <h2>{activeProject?.title ?? "프로젝트를 선택하세요"}</h2>
        </div>
        <span className="cockpit-pill">{activeProject ? statusLabel(activeProject.status) : "대기"}</span>
      </div>
      {activeProject ? (
        <>
          <p className="cockpit-muted">{activeProject.objective}</p>
          <div className="cockpit-metric-strip">
            <span>질문 {questions.length}</span>
            <span>가설 {hypotheses.length}</span>
            <span>증거 {evidence.length}</span>
            <span>Loop {loops.length}</span>
            <span>Goal Runner {activeProject.autonomyEnabled ? "켜짐" : "꺼짐"}</span>
            <span>작업공간 {activeProject.safetyPolicy.workspaceMode === "repository" ? "Repo" : "Session"}</span>
          </div>
          <label className="cockpit-field">
            <span>Goal Runner 작업공간</span>
            <select value={goalWorkspaceMode} onChange={(event) => setGoalWorkspaceMode(event.target.value === "repository" ? "repository" : "session")}>
              <option value="session">대화 샌드박스</option>
              <option value="repository">AetherOps repo 루트</option>
            </select>
          </label>
          {goalWorkspaceMode === "repository" ? (
            <p className="cockpit-warning-text">
              Repo 루트 모드는 이 코드베이스를 직접 작업 대상으로 삼습니다. `.data`, `.env*`, token, secret 파일은 읽거나 노출하지 않도록 실행 프롬프트와 스냅샷에서 제외합니다.
            </p>
          ) : null}
          <div className="cockpit-section-actions">
            <button
              className="cockpit-mini-button cockpit-mini-button--primary"
              disabled={!questions.length && !activeProject.objective.trim()}
              onClick={() =>
                onStartGoal(activeProject.id, {
                  questionId: selectedQuestionId,
                  goal: loopGoal || null,
                  autoStart: true,
                  enableAutonomy: true,
                  workspaceMode: goalWorkspaceMode,
                })
              }
              type="button"
            >
              Goal Runner 시작
            </button>
            <button className="cockpit-mini-button" onClick={() => onTickGoal(activeProject.id)} type="button">
              한 번 진행
            </button>
            <button className="cockpit-mini-button" disabled={!activeProject.autonomyEnabled} onClick={() => onStopGoal(activeProject.id)} type="button">
              Goal Runner 중지
            </button>
          </div>
          <div className="cockpit-preflight-list">
            {(preflight?.checks ?? []).map((check) => (
              <article className={`cockpit-preflight-item cockpit-preflight-item--${check.status}`} key={check.id}>
                <strong>{check.label}</strong>
                <span>{check.message}</span>
              </article>
            ))}
            {!preflight ? <p className="cockpit-empty">Preflight 정보가 아직 없습니다.</p> : null}
          </div>
        </>
      ) : (
        <p className="cockpit-empty">왼쪽에서 프로젝트를 선택하거나 새 프로젝트를 만들어 주세요.</p>
      )}
    </section>
  );
}
