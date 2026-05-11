import { useMemo, useState } from "react";
import type { ResearchProjectRecord, ResearchQuestionRecord } from "../../types";
import { statusLabel } from "./researchFormat";

interface ResearchQuestionsPanelProps {
  activeProject: ResearchProjectRecord | null;
  questions: ResearchQuestionRecord[];
  selectedQuestionId: string | null;
  setSelectedQuestionId: (questionId: string) => void;
  onAddQuestion: (projectId: string, question: string) => void;
}

export function ResearchQuestionsPanel({ activeProject, questions, selectedQuestionId, setSelectedQuestionId, onAddQuestion }: ResearchQuestionsPanelProps) {
  const [newQuestion, setNewQuestion] = useState("");
  const activeOpenQuestions = useMemo(
    () => questions.filter((question) => question.status === "open" || question.status === "investigating"),
    [questions],
  );

  function submitQuestion() {
    if (!activeProject || !newQuestion.trim()) return;
    onAddQuestion(activeProject.id, newQuestion.trim());
    setNewQuestion("");
  }

  return (
    <section className="cockpit-section-card">
      <div className="cockpit-section-card__header">
        <h2>질문</h2>
        <span className="cockpit-pill">{activeOpenQuestions.length} open</span>
      </div>
      <div className="cockpit-compact-list">
        {questions.map((question) => (
          <button
            className={`cockpit-flow-list-item__main ${selectedQuestionId === question.id ? "is-active" : ""}`}
            key={question.id}
            onClick={() => setSelectedQuestionId(question.id)}
            type="button"
          >
            <strong>{question.question}</strong>
            <span>{statusLabel(question.status)} / 우선순위 {question.priority}</span>
          </button>
        ))}
        {!questions.length ? <p className="cockpit-empty">열린 연구 질문을 추가해 주세요.</p> : null}
      </div>
      <label className="cockpit-field">
        <span>질문 추가</span>
        <textarea rows={3} value={newQuestion} onChange={(event) => setNewQuestion(event.target.value)} />
      </label>
      <button className="cockpit-mini-button" disabled={!activeProject || !newQuestion.trim()} onClick={submitQuestion} type="button">
        질문 추가
      </button>
    </section>
  );
}
