import { useState } from "react";
import type { ResearchHypothesisRecord, ResearchProjectRecord } from "../../types";
import { statusLabel } from "./researchFormat";

interface ResearchHypothesesPanelProps {
  activeProject: ResearchProjectRecord | null;
  hypotheses: ResearchHypothesisRecord[];
  selectedQuestionId: string | null;
  onAddHypothesis: (projectId: string, hypothesis: string, questionId?: string | null) => void;
}

export function ResearchHypothesesPanel({ activeProject, hypotheses, selectedQuestionId, onAddHypothesis }: ResearchHypothesesPanelProps) {
  const [newHypothesis, setNewHypothesis] = useState("");

  function submitHypothesis() {
    if (!activeProject || !newHypothesis.trim()) return;
    onAddHypothesis(activeProject.id, newHypothesis.trim(), selectedQuestionId);
    setNewHypothesis("");
  }

  return (
    <section className="cockpit-section-card">
      <div className="cockpit-section-card__header">
        <h2>가설</h2>
        <span className="cockpit-pill">{hypotheses.length}</span>
      </div>
      <div className="cockpit-compact-list">
        {hypotheses.slice(0, 8).map((hypothesis) => (
          <article className="cockpit-flow-list-item" key={hypothesis.id}>
            <div className="cockpit-flow-list-item__main">
              <strong>{hypothesis.hypothesis}</strong>
              <span>{statusLabel(hypothesis.status)} / 신뢰도 {Math.round(hypothesis.confidence * 100)}%</span>
            </div>
          </article>
        ))}
        {!hypotheses.length ? <p className="cockpit-empty">아직 가설이 없습니다.</p> : null}
      </div>
      <label className="cockpit-field">
        <span>가설 추가</span>
        <textarea rows={3} value={newHypothesis} onChange={(event) => setNewHypothesis(event.target.value)} />
      </label>
      <button className="cockpit-mini-button" disabled={!activeProject || !newHypothesis.trim()} onClick={submitHypothesis} type="button">
        가설 추가
      </button>
    </section>
  );
}
