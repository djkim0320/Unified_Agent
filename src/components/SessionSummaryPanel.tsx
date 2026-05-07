import type { SessionSummaryRecord } from "../types";

interface SessionSummaryPanelProps {
  editing: boolean;
  loading: boolean;
  summary: SessionSummaryRecord | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onRefresh: () => void;
  onRefreshTask: () => void;
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
            <button className="cockpit-mini-button" onClick={props.onEdit} type="button">
              요약 편집
            </button>
          </>
        )}
      </div>
    </section>
  );
}
