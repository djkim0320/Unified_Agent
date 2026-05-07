import type { SessionSummaryRecord, SessionSummarySuggestionRecord } from "../types";

interface SessionSummaryPanelProps {
  editing: boolean;
  loading: boolean;
  summary: SessionSummaryRecord | null;
  suggestions: SessionSummarySuggestionRecord[];
  draft: string;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onRefresh: () => void;
  onRefreshTask: () => void;
  onLoadSuggestions: () => void;
  onApplySuggestion: (suggestion: SessionSummarySuggestionRecord) => void;
  onSave: () => void;
  onCancel: () => void;
}

function listSection(title: string, items: string[] | undefined) {
  if (!items?.length) {
    return null;
  }
  return (
    <div className="session-summary-section">
      <strong>{title}</strong>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function SessionSummaryPanel(props: SessionSummaryPanelProps) {
  const metadata = props.summary?.metadata ?? {};

  return (
    <section className="cockpit-drawer-panel cockpit-drawer-panel--summary-memory">
      <div className="cockpit-drawer-panel__header">
        <div>
          <h3>프로젝트 메모리</h3>
          <p>다음 opencode 실행 프롬프트에 포함되는 지속 요약입니다.</p>
        </div>
        <span>{props.summary ? "포함됨" : "비어 있음"}</span>
      </div>

      {props.editing ? (
        <label className="cockpit-field">
          <span>요약 내용</span>
          <textarea rows={7} value={props.draft} onChange={(event) => props.onDraftChange(event.target.value)} />
        </label>
      ) : props.summary ? (
        <div className="session-summary-content">
          {typeof metadata.currentGoal === "string" && metadata.currentGoal ? (
            <div className="session-summary-section">
              <strong>현재 목표</strong>
              <p>{metadata.currentGoal}</p>
            </div>
          ) : null}
          <div className="session-summary-section">
            <strong>요약</strong>
            <p>{props.summary.summary}</p>
          </div>
          {listSection("완료된 작업", Array.isArray(metadata.completedWork) ? metadata.completedWork : undefined)}
          {listSection("결정 사항", props.summary.decisions)}
          {listSection("열린 질문", props.summary.openQuestions)}
          {listSection("다음 액션", props.summary.nextActions)}
          {listSection(
            "중요 산출물",
            Array.isArray(metadata.importantArtifacts) ? metadata.importantArtifacts : undefined,
          )}
          {typeof metadata.lastVerification === "string" && metadata.lastVerification ? (
            <div className="session-summary-section">
              <strong>최근 검증</strong>
              <p>{metadata.lastVerification}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="cockpit-empty">
          아직 저장된 요약이 없습니다. 새로고침을 누르면 최근 대화, 실행, Flow, 보고서를 바탕으로 결정론적 요약을 만듭니다.
        </p>
      )}

      <div className="cockpit-section-actions">
        {props.editing ? (
          <>
            <button className="cockpit-mini-button cockpit-mini-button--primary" onClick={props.onSave} type="button">
              요약 저장
            </button>
            <button className="cockpit-mini-button" onClick={props.onCancel} type="button">
              취소
            </button>
          </>
        ) : (
          <>
            <button className="cockpit-mini-button" disabled={props.loading} onClick={props.onRefresh} type="button">
              {props.loading ? "새로고침 중..." : "요약 새로고침"}
            </button>
            <button className="cockpit-mini-button" disabled={props.loading} onClick={props.onRefreshTask} type="button">
              opencode로 요약 제안
            </button>
            <button className="cockpit-mini-button" disabled={props.loading} onClick={props.onLoadSuggestions} type="button">
              제안 불러오기
            </button>
            <button className="cockpit-mini-button" onClick={props.onEdit} type="button">
              요약 편집
            </button>
          </>
        )}
      </div>
      {props.suggestions.length ? (
        <div className="session-summary-section">
          <strong>검토 대기 중인 요약 제안</strong>
          {props.suggestions.slice(0, 3).map((suggestion) => (
            <article className="artifact-row" key={suggestion.task.id}>
              <div>
                <strong>{suggestion.task.title}</strong>
                <small>{suggestion.suggestion.parsed.summary.slice(0, 140)}</small>
              </div>
              <button
                className="cockpit-mini-button cockpit-mini-button--primary"
                disabled={props.loading}
                onClick={() => props.onApplySuggestion(suggestion)}
                type="button"
              >
                검토 후 저장
              </button>
            </article>
          ))}
          <p className="cockpit-muted">요약 제안은 자동 저장되지 않습니다. 적용 전 화면에서 내용을 확인해 주세요.</p>
        </div>
      ) : null}
    </section>
  );
}
