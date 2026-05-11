import { useState } from "react";
import type {
  ProjectRagQueryResult,
  ProjectRagRebuildResponse,
  ResearchProjectRecord,
  ResearchSearchResult,
} from "../../types";

interface ResearchSearchRolePanelProps {
  activeProject: ResearchProjectRecord | null;
  ragResults: ProjectRagQueryResult[];
  ragStatus: ProjectRagRebuildResponse | null;
  searchResults: ResearchSearchResult[];
  selectedQuestionId: string | null;
  onCreateSubagent: (
    projectId: string,
    role: "researcher" | "critic" | "verifier" | "synthesizer" | "experiment-planner",
    questionId?: string | null,
  ) => void;
  onRebuildRag: (projectId: string) => void;
  onSearch: (query: string) => void;
  onSearchRag: (projectId: string, query: string) => void;
}

const roleLabels: Record<
  "researcher" | "critic" | "verifier" | "synthesizer" | "experiment-planner",
  string
> = {
  researcher: "조사자",
  critic: "비판자",
  verifier: "검증자",
  synthesizer: "종합자",
  "experiment-planner": "실험 설계",
};

export function ResearchSearchRolePanel({
  activeProject,
  ragResults,
  ragStatus,
  searchResults,
  selectedQuestionId,
  onCreateSubagent,
  onRebuildRag,
  onSearch,
  onSearchRag,
}: ResearchSearchRolePanelProps) {
  const [searchText, setSearchText] = useState("");

  return (
    <section className="cockpit-section-card">
      <div className="cockpit-section-card__header">
        <div>
          <p className="cockpit-eyebrow">Research Memory</p>
          <h2>검색 / 역할 작업</h2>
        </div>
        <span className="cockpit-pill">{ragResults.length + searchResults.length}</span>
      </div>
      <label className="cockpit-field">
        <span>검색어</span>
        <input
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="보고서, 증거, 출처, 질문 검색"
        />
      </label>
      <div className="cockpit-section-actions">
        <button
          className="cockpit-mini-button cockpit-mini-button--primary"
          disabled={!activeProject || !searchText.trim()}
          onClick={() => activeProject && onSearchRag(activeProject.id, searchText)}
          type="button"
        >
          프로젝트 RAG 검색
        </button>
        <button className="cockpit-mini-button" disabled={!searchText.trim()} onClick={() => onSearch(searchText)} type="button">
          전체 기록 검색
        </button>
        <button className="cockpit-mini-button" disabled={!activeProject} onClick={() => activeProject && onRebuildRag(activeProject.id)} type="button">
          RAG 재색인
        </button>
      </div>
      {ragStatus ? (
        <p className="cockpit-muted">
          RAG 색인: 문서 {ragStatus.documentCount}개 / 청크 {ragStatus.chunkCount}개 / {ragStatus.indexMode}
        </p>
      ) : null}
      <div className="cockpit-compact-list">
        {ragResults.map((result) => (
          <article className="cockpit-flow-list-item" key={`${result.document.id}-${result.chunk.id}`}>
            <div className="cockpit-flow-list-item__main">
              <strong>{result.document.title}</strong>
              <span>
                {result.document.sourceType} / 신뢰도 {result.document.reliability.toFixed(2)} / 점수 {result.score.toFixed(2)}
              </span>
              <p>{result.snippet}</p>
            </div>
          </article>
        ))}
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
          <button
            className="cockpit-mini-button"
            disabled={!activeProject}
            key={role}
            onClick={() => activeProject && onCreateSubagent(activeProject.id, role, selectedQuestionId)}
            type="button"
          >
            {roleLabels[role]}
          </button>
        ))}
      </div>
    </section>
  );
}
