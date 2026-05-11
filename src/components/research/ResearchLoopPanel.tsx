import type { ResearchLoopRecord, ResearchProjectRecord, ResearchQuestionRecord } from "../../types";
import { compactTime, statusLabel } from "./researchFormat";

interface ResearchLoopPanelProps {
  activeProject: ResearchProjectRecord | null;
  loading: boolean;
  loopGoal: string;
  loops: ResearchLoopRecord[];
  questions: ResearchQuestionRecord[];
  selectedQuestionId: string | null;
  setLoopGoal: (goal: string) => void;
  onCancelLoop: (loopId: string) => void;
  onOpenFlow: (flowId: string) => void;
  onProposeLoop: (projectId: string, payload: { questionId?: string | null; goal?: string | null; autoStart?: boolean }) => void;
  onStartLoop: (loopId: string) => void;
  onTickLoop: (loopId: string) => void;
}

export function ResearchLoopPanel({
  activeProject,
  loading,
  loopGoal,
  loops,
  questions,
  selectedQuestionId,
  setLoopGoal,
  onCancelLoop,
  onOpenFlow,
  onProposeLoop,
  onStartLoop,
  onTickLoop,
}: ResearchLoopPanelProps) {
  return (
    <section className="cockpit-section-card cockpit-section-card--wide">
      <div className="cockpit-section-card__header">
        <div>
          <p className="cockpit-eyebrow">Bounded Loop</p>
          <h2>다음 연구 Loop 제안</h2>
        </div>
        <span className="cockpit-pill">{loading ? "처리 중" : "검토 후 실행"}</span>
      </div>
      <label className="cockpit-field">
        <span>Loop 목표</span>
        <textarea
          rows={3}
          value={loopGoal}
          onChange={(event) => setLoopGoal(event.target.value)}
          placeholder="선택한 질문을 좁혀 이번 Loop의 목표를 적어주세요."
        />
      </label>
      <div className="cockpit-section-actions">
        <button
          className="cockpit-mini-button cockpit-mini-button--primary"
          disabled={!activeProject || !questions.length}
          onClick={() =>
            activeProject &&
            onProposeLoop(activeProject.id, {
              questionId: selectedQuestionId,
              goal: loopGoal || null,
              autoStart: false,
            })
          }
          type="button"
        >
          다음 연구 Loop 제안
        </button>
        <button
          className="cockpit-mini-button"
          disabled={!activeProject || !questions.length || !activeProject.autonomyEnabled}
          onClick={() =>
            activeProject &&
            onProposeLoop(activeProject.id, {
              questionId: selectedQuestionId,
              goal: loopGoal || null,
              autoStart: true,
            })
          }
          type="button"
        >
          예산 내 자동 시작
        </button>
      </div>
      <div className="cockpit-compact-list cockpit-compact-list--steps">
        {loops.map((loop) => (
          <article className={`cockpit-step-output cockpit-step-output--${loop.status}`} key={loop.id}>
            <div className="cockpit-step-output__main">
              <strong>{loop.goal}</strong>
              <span>
                {statusLabel(loop.status)} / {compactTime(loop.updatedAt)}
              </span>
              {loop.resultSummary ? <p>{loop.resultSummary}</p> : null}
              {loop.errorText ? <p className="cockpit-error-text">{loop.errorText}</p> : null}
            </div>
            <div className="cockpit-section-actions">
              <button
                className="cockpit-mini-button"
                disabled={!loop.proposedFlowId}
                onClick={() => loop.proposedFlowId && onOpenFlow(loop.proposedFlowId)}
                type="button"
              >
                Flow로 열기
              </button>
              <button
                className="cockpit-mini-button"
                disabled={!loop.proposedFlowId || loop.status === "running"}
                onClick={() => onStartLoop(loop.id)}
                type="button"
              >
                시작
              </button>
              <button
                className="cockpit-mini-button"
                disabled={!loop.proposedFlowId || loop.status === "completed" || loop.status === "cancelled"}
                onClick={() => onTickLoop(loop.id)}
                type="button"
              >
                Tick
              </button>
              <button
                className="cockpit-mini-button"
                disabled={loop.status === "completed" || loop.status === "cancelled"}
                onClick={() => onCancelLoop(loop.id)}
                type="button"
              >
                취소
              </button>
            </div>
          </article>
        ))}
        {!loops.length ? <p className="cockpit-empty">아직 연구 Loop가 없습니다.</p> : null}
      </div>
    </section>
  );
}
