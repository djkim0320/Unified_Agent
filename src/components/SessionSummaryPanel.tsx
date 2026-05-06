import type { SessionSummaryRecord } from "../types";

interface SessionSummaryPanelProps {
  editing: boolean;
  loading: boolean;
  summary: SessionSummaryRecord | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onRefresh: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export function SessionSummaryPanel(props: SessionSummaryPanelProps) {
  return (
    <section className="cockpit-drawer-panel cockpit-drawer-panel--summary-memory">
      <div className="cockpit-drawer-panel__header">
        <div>
          <h3>세션 요약</h3>
          <p>다음 opencode 실행 프롬프트에 포함되는 지속 메모리입니다.</p>
        </div>
        <span>{props.summary ? "포함됨" : "비어 있음"}</span>
      </div>

      {props.editing ? (
        <label className="cockpit-field">
          <span>요약 내용</span>
          <textarea
            rows={7}
            value={props.draft}
            onChange={(event) => props.onDraftChange(event.target.value)}
          />
        </label>
      ) : props.summary ? (
        <div className="session-summary-content">
          <p>{props.summary.summary}</p>
          {props.summary.decisions.length ? (
            <small>결정: {props.summary.decisions.join(" / ")}</small>
          ) : null}
          {props.summary.openQuestions.length ? (
            <small>열린 질문: {props.summary.openQuestions.join(" / ")}</small>
          ) : null}
          {props.summary.nextActions.length ? (
            <small>다음 액션: {props.summary.nextActions.join(" / ")}</small>
          ) : null}
        </div>
      ) : (
        <p className="cockpit-empty">
          아직 저장된 요약이 없습니다. 새로고침을 누르면 최근 대화, 실행, Flow 상태를 바탕으로
          안전한 결정론적 요약을 만듭니다.
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
            <button className="cockpit-mini-button" onClick={props.onEdit} type="button">
              요약 편집
            </button>
          </>
        )}
      </div>
    </section>
  );
}
