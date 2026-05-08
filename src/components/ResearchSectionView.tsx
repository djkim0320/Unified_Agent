import { useMemo, useState } from "react";
import type {
  AgentRecord,
  ConversationRecord,
  ResearchEvidenceRecord,
  ResearchHypothesisRecord,
  ResearchLoopRecord,
  ResearchPreflightResponse,
  ResearchProjectRecord,
  ResearchQuestionRecord,
  ResearchSearchResult,
} from "../types";

interface ResearchSectionViewProps {
  activeAgent: AgentRecord | null;
  activeConversation: ConversationRecord | null;
  activeProject: ResearchProjectRecord | null;
  projects: ResearchProjectRecord[];
  questions: ResearchQuestionRecord[];
  hypotheses: ResearchHypothesisRecord[];
  evidence: ResearchEvidenceRecord[];
  loops: ResearchLoopRecord[];
  preflight: ResearchPreflightResponse | null;
  searchResults: ResearchSearchResult[];
  loading: boolean;
  onAddEvidence: (projectId: string, payload: { claim: string; summary: string; questionId?: string | null }) => void;
  onAddHypothesis: (projectId: string, hypothesis: string, questionId?: string | null) => void;
  onAddQuestion: (projectId: string, question: string) => void;
  onCancelLoop: (loopId: string) => void;
  onCreateProject: (payload: {
    agentId: string;
    conversationId?: string | null;
    title: string;
    objective: string;
    domain?: string | null;
  }) => void;
  onCreateReport: (projectId: string) => void;
  onCreateReportTask: (projectId: string) => void;
  onCreateSubagent: (
    projectId: string,
    role: "researcher" | "critic" | "verifier" | "synthesizer" | "experiment-planner",
    questionId?: string | null,
  ) => void;
  onOpenFlow: (flowId: string) => void;
  onProposeLoop: (projectId: string, payload: { questionId?: string | null; goal?: string | null; autoStart?: boolean }) => void;
  onRefresh: (projectId?: string | null) => void;
  onSearch: (query: string) => void;
  onSelectProject: (projectId: string) => void;
  onStartLoop: (loopId: string) => void;
}

function statusLabel(status: string | null | undefined) {
  if (!status) return "알 수 없음";
  const labels: Record<string, string> = {
    active: "활성",
    paused: "일시정지",
    completed: "완료",
    archived: "보관",
    open: "열림",
    investigating: "조사 중",
    answered: "답변됨",
    blocked: "막힘",
    proposed: "제안됨",
    supported: "지지됨",
    contradicted: "반박됨",
    unresolved: "미해결",
    queued: "대기",
    running: "실행 중",
    waiting_approval: "승인 대기",
    failed: "실패",
    cancelled: "취소",
  };
  return labels[status] ?? status;
}

function compactTime(value: number | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ResearchSectionView({
  activeAgent,
  activeConversation,
  activeProject,
  projects,
  questions,
  hypotheses,
  evidence,
  loops,
  preflight,
  searchResults,
  loading,
  onAddEvidence,
  onAddHypothesis,
  onAddQuestion,
  onCancelLoop,
  onCreateProject,
  onCreateReport,
  onCreateReportTask,
  onCreateSubagent,
  onOpenFlow,
  onProposeLoop,
  onRefresh,
  onSearch,
  onSelectProject,
  onStartLoop,
}: ResearchSectionViewProps) {
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [newProjectObjective, setNewProjectObjective] = useState("");
  const [newQuestion, setNewQuestion] = useState("");
  const [newHypothesis, setNewHypothesis] = useState("");
  const [newEvidenceClaim, setNewEvidenceClaim] = useState("");
  const [newEvidenceSummary, setNewEvidenceSummary] = useState("");
  const [loopGoal, setLoopGoal] = useState("");
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");

  const activeOpenQuestions = useMemo(
    () => questions.filter((question) => question.status === "open" || question.status === "investigating"),
    [questions],
  );

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

  function submitQuestion() {
    if (!activeProject || !newQuestion.trim()) return;
    onAddQuestion(activeProject.id, newQuestion.trim());
    setNewQuestion("");
  }

  function submitHypothesis() {
    if (!activeProject || !newHypothesis.trim()) return;
    onAddHypothesis(activeProject.id, newHypothesis.trim(), selectedQuestionId);
    setNewHypothesis("");
  }

  function submitEvidence() {
    if (!activeProject || !newEvidenceClaim.trim() || !newEvidenceSummary.trim()) return;
    onAddEvidence(activeProject.id, {
      claim: newEvidenceClaim.trim(),
      summary: newEvidenceSummary.trim(),
      questionId: selectedQuestionId,
    });
    setNewEvidenceClaim("");
    setNewEvidenceSummary("");
  }

  return (
    <div className="cockpit-section cockpit-section--research">
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
        </div>
      </section>

      <div className="cockpit-section-grid cockpit-section-grid--research">
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
      </div>

      <div className="cockpit-section-grid cockpit-section-grid--research">
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
      </div>

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
          <textarea rows={3} value={loopGoal} onChange={(event) => setLoopGoal(event.target.value)} placeholder="선택한 질문을 좁혀 이번 Loop의 목표를 적어주세요." />
        </label>
        <div className="cockpit-section-actions">
          <button className="cockpit-mini-button cockpit-mini-button--primary" disabled={!activeProject || !questions.length} onClick={() => activeProject && onProposeLoop(activeProject.id, { questionId: selectedQuestionId, goal: loopGoal || null, autoStart: false })} type="button">
            다음 연구 Loop 제안
          </button>
          <button className="cockpit-mini-button" disabled={!activeProject || !questions.length || !activeProject.autonomyEnabled} onClick={() => activeProject && onProposeLoop(activeProject.id, { questionId: selectedQuestionId, goal: loopGoal || null, autoStart: true })} type="button">
            예산 내 자동 시작
          </button>
        </div>
        <div className="cockpit-compact-list cockpit-compact-list--steps">
          {loops.map((loop) => (
            <article className={`cockpit-step-output cockpit-step-output--${loop.status}`} key={loop.id}>
              <div className="cockpit-step-output__main">
                <strong>{loop.goal}</strong>
                <span>{statusLabel(loop.status)} / {compactTime(loop.updatedAt)}</span>
                {loop.resultSummary ? <p>{loop.resultSummary}</p> : null}
                {loop.errorText ? <p className="cockpit-error-text">{loop.errorText}</p> : null}
              </div>
              <div className="cockpit-section-actions">
                <button className="cockpit-mini-button" disabled={!loop.proposedFlowId} onClick={() => loop.proposedFlowId && onOpenFlow(loop.proposedFlowId)} type="button">
                  Flow로 열기
                </button>
                <button className="cockpit-mini-button" disabled={!loop.proposedFlowId || loop.status === "running"} onClick={() => onStartLoop(loop.id)} type="button">
                  시작
                </button>
                <button className="cockpit-mini-button" disabled={loop.status === "completed" || loop.status === "cancelled"} onClick={() => onCancelLoop(loop.id)} type="button">
                  취소
                </button>
              </div>
            </article>
          ))}
          {!loops.length ? <p className="cockpit-empty">아직 연구 Loop가 없습니다.</p> : null}
        </div>
      </section>

      <div className="cockpit-section-grid cockpit-section-grid--research">
        <section className="cockpit-section-card">
          <div className="cockpit-section-card__header">
            <h2>증거 Ledger</h2>
            <span className="cockpit-pill">{evidence.length}</span>
          </div>
          <div className="cockpit-compact-list">
            {evidence.slice(0, 10).map((item) => (
              <article className="cockpit-flow-list-item" key={item.id}>
                <div className="cockpit-flow-list-item__main">
                  <strong>{item.claim}</strong>
                  <span>{item.sourceType} / 신뢰도 {Math.round(item.confidence * 100)}%</span>
                  <p>{item.summary}</p>
                  {item.uncertainty ? <small>불확실성: {item.uncertainty}</small> : null}
                </div>
              </article>
            ))}
            {!evidence.length ? <p className="cockpit-empty">Loop 완료나 수동 입력으로 증거가 쌓입니다.</p> : null}
          </div>
          <label className="cockpit-field">
            <span>Claim</span>
            <input value={newEvidenceClaim} onChange={(event) => setNewEvidenceClaim(event.target.value)} />
          </label>
          <label className="cockpit-field">
            <span>Evidence summary</span>
            <textarea rows={3} value={newEvidenceSummary} onChange={(event) => setNewEvidenceSummary(event.target.value)} />
          </label>
          <button className="cockpit-mini-button" disabled={!activeProject || !newEvidenceClaim.trim() || !newEvidenceSummary.trim()} onClick={submitEvidence} type="button">
            증거 추가
          </button>
        </section>

        <section className="cockpit-section-card">
          <div className="cockpit-section-card__header">
            <h2>검색 / 역할 작업</h2>
            <span className="cockpit-pill">{searchResults.length}</span>
          </div>
          <label className="cockpit-field">
            <span>연구 기록 검색</span>
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="보고서, 증거, 질문 검색" />
          </label>
          <button className="cockpit-mini-button" disabled={!searchText.trim()} onClick={() => onSearch(searchText)} type="button">
            검색
          </button>
          <div className="cockpit-compact-list">
            {searchResults.map((result, index) => (
              <article className="cockpit-flow-list-item" key={`${result.kind}-${result.projectId ?? index}-${index}`}>
                <div className="cockpit-flow-list-item__main">
                  <strong>{result.title}</strong>
                  <span>{result.kind}</span>
                  <p>{result.snippet}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="cockpit-section-actions">
            {(["researcher", "critic", "verifier", "synthesizer", "experiment-planner"] as const).map((role) => (
              <button className="cockpit-mini-button" disabled={!activeProject} key={role} onClick={() => activeProject && onCreateSubagent(activeProject.id, role, selectedQuestionId)} type="button">
                {role}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
