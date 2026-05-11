import { useState } from "react";
import type { ResearchEvidenceRecord, ResearchProjectRecord, ResearchSourceRecord } from "../../types";

interface ResearchEvidencePanelProps {
  activeProject: ResearchProjectRecord | null;
  evidence: ResearchEvidenceRecord[];
  sources: ResearchSourceRecord[];
  selectedQuestionId: string | null;
  onAddEvidence: (projectId: string, payload: { claim: string; summary: string; questionId?: string | null }) => void;
  onAddSource: (
    projectId: string,
    payload: {
      evidenceId?: string | null;
      url?: string | null;
      title: string;
      author?: string | null;
      institution?: string | null;
      publishedAt?: string | null;
      accessedAt?: string | null;
      summary: string;
      quote?: string | null;
      snapshot?: string | null;
      reliability?: number;
      relatedClaim?: string | null;
    },
  ) => void;
}

function sourceHost(url: string | null) {
  if (!url) return "로컬 자료";
  try {
    return new URL(url).hostname;
  } catch {
    return "URL 확인 필요";
  }
}

export function ResearchEvidencePanel({
  activeProject,
  evidence,
  sources,
  selectedQuestionId,
  onAddEvidence,
  onAddSource,
}: ResearchEvidencePanelProps) {
  const [newEvidenceClaim, setNewEvidenceClaim] = useState("");
  const [newEvidenceSummary, setNewEvidenceSummary] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceSummary, setSourceSummary] = useState("");
  const [sourceQuote, setSourceQuote] = useState("");
  const [sourceSnapshot, setSourceSnapshot] = useState("");
  const [sourceEvidenceId, setSourceEvidenceId] = useState("");
  const [sourceReliability, setSourceReliability] = useState(0.6);

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

  function submitSource() {
    if (!activeProject || !sourceTitle.trim() || !sourceSummary.trim()) return;
    onAddSource(activeProject.id, {
      evidenceId: sourceEvidenceId || null,
      title: sourceTitle.trim(),
      url: sourceUrl.trim() || null,
      summary: sourceSummary.trim(),
      quote: sourceQuote.trim() || null,
      snapshot: sourceSnapshot.trim() || null,
      reliability: sourceReliability,
      relatedClaim: evidence.find((item) => item.id === sourceEvidenceId)?.claim ?? null,
    });
    setSourceTitle("");
    setSourceUrl("");
    setSourceSummary("");
    setSourceQuote("");
    setSourceSnapshot("");
    setSourceEvidenceId("");
    setSourceReliability(0.6);
  }

  return (
    <section className="cockpit-section-card">
      <div className="cockpit-section-card__header">
        <h2>증거와 출처 DB</h2>
        <span className="cockpit-pill">{evidence.length + sources.length}</span>
      </div>
      <p className="cockpit-muted">
        연구 루프는 이 프로젝트 DB에서 관련 증거와 출처를 검색해 다음 opencode 실행 프롬프트에 포함합니다.
      </p>

      <div className="cockpit-compact-list">
        {evidence.slice(0, 8).map((item) => (
          <article className="cockpit-flow-list-item" key={item.id}>
            <div className="cockpit-flow-list-item__main">
              <strong>{item.claim}</strong>
              <span>{item.sourceType} / 신뢰도 {Math.round(item.confidence * 100)}%</span>
              <p>{item.summary}</p>
              {item.uncertainty ? <small>불확실성: {item.uncertainty}</small> : null}
            </div>
          </article>
        ))}
        {!evidence.length ? (
          <p className="cockpit-empty">아직 주장과 증거가 없습니다. 연구 Loop 완료 후 자동으로 쌓이거나 직접 추가할 수 있습니다.</p>
        ) : null}
      </div>

      <label className="cockpit-field">
        <span>주장</span>
        <input
          value={newEvidenceClaim}
          onChange={(event) => setNewEvidenceClaim(event.target.value)}
          placeholder="예: 이 설계 방향은 장기 연구 추적에 유리하다"
        />
      </label>
      <label className="cockpit-field">
        <span>근거 요약</span>
        <textarea
          rows={3}
          value={newEvidenceSummary}
          onChange={(event) => setNewEvidenceSummary(event.target.value)}
          placeholder="이 주장을 뒷받침하거나 반박하는 근거를 적어주세요."
        />
      </label>
      <button
        className="cockpit-mini-button"
        disabled={!activeProject || !newEvidenceClaim.trim() || !newEvidenceSummary.trim()}
        onClick={submitEvidence}
        type="button"
      >
        증거 추가
      </button>

      <div className="cockpit-section-card__divider" />
      <div className="cockpit-section-card__header">
        <h3>출처 DB</h3>
        <span className="cockpit-pill">{sources.length}</span>
      </div>
      <div className="cockpit-compact-list">
        {sources.slice(0, 6).map((source) => (
          <article className="cockpit-flow-list-item" key={source.id}>
            <div className="cockpit-flow-list-item__main">
              <strong>{source.title}</strong>
              <span>
                {sourceHost(source.url)} / 신뢰도 {Math.round(source.reliability * 100)}%
              </span>
              <p>{source.summary}</p>
              {source.quote ? <small>인용문: {source.quote}</small> : null}
              {source.snapshot ? <small>본문 스냅샷 저장됨</small> : null}
            </div>
          </article>
        ))}
        {!sources.length ? (
          <p className="cockpit-empty">
            URL뿐 아니라 당시 읽은 요약, 인용문, 본문 스냅샷을 함께 저장해 결론의 근거를 추적할 수 있습니다.
          </p>
        ) : null}
      </div>

      <label className="cockpit-field">
        <span>연결할 증거</span>
        <select value={sourceEvidenceId} onChange={(event) => setSourceEvidenceId(event.target.value)}>
          <option value="">연결 없음</option>
          {evidence.map((item) => (
            <option key={item.id} value={item.id}>
              {item.claim.slice(0, 80)}
            </option>
          ))}
        </select>
      </label>
      <label className="cockpit-field">
        <span>출처 제목</span>
        <input
          value={sourceTitle}
          onChange={(event) => setSourceTitle(event.target.value)}
          placeholder="예: NASA technical report, 논문 제목, 웹페이지 제목"
        />
      </label>
      <label className="cockpit-field">
        <span>URL</span>
        <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://..." />
      </label>
      <label className="cockpit-field">
        <span>출처 요약</span>
        <textarea
          rows={3}
          value={sourceSummary}
          onChange={(event) => setSourceSummary(event.target.value)}
          placeholder="당시 확인한 핵심 내용을 요약합니다."
        />
      </label>
      <label className="cockpit-field">
        <span>인용문 또는 핵심 문장</span>
        <textarea rows={2} value={sourceQuote} onChange={(event) => setSourceQuote(event.target.value)} />
      </label>
      <label className="cockpit-field">
        <span>본문 스냅샷</span>
        <textarea
          rows={3}
          value={sourceSnapshot}
          onChange={(event) => setSourceSnapshot(event.target.value)}
          placeholder="웹페이지가 바뀌거나 사라져도 남길 본문 일부를 저장합니다."
        />
      </label>
      <label className="cockpit-field">
        <span>신뢰도 {Math.round(sourceReliability * 100)}%</span>
        <input
          min="0"
          max="1"
          step="0.05"
          type="range"
          value={sourceReliability}
          onChange={(event) => setSourceReliability(Number(event.target.value))}
        />
      </label>
      <button
        className="cockpit-mini-button"
        disabled={!activeProject || !sourceTitle.trim() || !sourceSummary.trim()}
        onClick={submitSource}
        type="button"
      >
        출처 저장
      </button>
    </section>
  );
}
