import type {
  ArtifactDiffResponse,
  ArtifactPreviewResponse,
  ArtifactRecord,
  RunDebugResponse,
  WorkspaceRunRecord,
} from "../types";

interface RunArtifactsPanelProps {
  artifacts: ArtifactRecord[];
  debug: RunDebugResponse | null;
  diff: ArtifactDiffResponse | null;
  latestRun: WorkspaceRunRecord | null;
  loading: boolean;
  preview: ArtifactPreviewResponse | null;
  onCloseDiff: () => void;
  onClosePreview: () => void;
  onCopyDebug: () => void;
  onCopyReport: (artifactId: string) => void;
  onCreateFollowUpFlow: (artifactId: string) => void;
  onCreateFollowUpTask: (artifactId: string) => void;
  onDebug: () => void;
  onDiff: (artifactId: string) => void;
  onPreview: (artifactId: string) => void;
}

function canPreview(artifact: ArtifactRecord) {
  return ["file", "report", "summary", "log"].includes(artifact.kind);
}

function canRequestDiff(artifact: ArtifactRecord) {
  return artifact.kind === "file" && Boolean(artifact.path);
}

function reportNextAction(artifact: ArtifactRecord) {
  const value = artifact.metadata.nextRecommendedAction;
  return typeof value === "string" && value.trim() ? value : null;
}

function previewSourceLabel(source?: string) {
  if (source === "snapshot") return "스냅샷";
  if (source === "current-workspace") return "현재 워크스페이스";
  if (source === "report") return "보고서";
  return "미리보기";
}

export function RunArtifactsPanel(props: RunArtifactsPanelProps) {
  const reportArtifacts = props.artifacts.filter((artifact) => artifact.kind === "report");

  return (
    <section className="cockpit-drawer-panel cockpit-drawer-panel--artifacts">
      <div className="cockpit-drawer-panel__header">
        <div>
          <h3>산출물 / Run 디버거</h3>
          <p>선택한 opencode 실행의 변경 파일, 보고서, 안전한 미리보기와 디버그 요약을 확인합니다.</p>
        </div>
        <span>{props.artifacts.length}</span>
      </div>

      {props.latestRun ? (
        <div className="run-debug-summary">
          <strong>{props.latestRun.status}</strong>
          <small>
            {props.latestRun.model} / {props.latestRun.phase}
          </small>
          <div className="cockpit-section-actions">
            <button className="cockpit-mini-button" disabled={props.loading} onClick={props.onDebug} type="button">
              디버그 보기
            </button>
            {props.debug ? (
              <button className="cockpit-mini-button" onClick={props.onCopyDebug} type="button">
                안전한 Debug bundle 복사
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="cockpit-empty">아직 선택한 Run이 없습니다.</p>
      )}

      {reportArtifacts.length ? (
        <div className="artifact-report-list">
          {reportArtifacts.map((artifact) => (
            <article className="artifact-report-card" key={artifact.id}>
              <div>
                <strong>{artifact.title}</strong>
                <p>{artifact.summary ?? "Run 또는 Flow 완료 보고서입니다."}</p>
                {reportNextAction(artifact) ? <small>다음 권장 작업: {reportNextAction(artifact)}</small> : null}
              </div>
              <div className="cockpit-section-actions">
                <button className="cockpit-mini-button" onClick={() => props.onPreview(artifact.id)} type="button">
                  보고서 보기
                </button>
                <button className="cockpit-mini-button" onClick={() => props.onCopyReport(artifact.id)} type="button">
                  보고서 복사
                </button>
                <button className="cockpit-mini-button" onClick={() => props.onCreateFollowUpTask(artifact.id)} type="button">
                  후속 Task
                </button>
                <button className="cockpit-mini-button" onClick={() => props.onCreateFollowUpFlow(artifact.id)} type="button">
                  후속 Flow
                </button>
              </div>
            </article>
          ))}
          <p className="cockpit-muted">
            보고서 복사는 기본적으로 redacted mode를 사용합니다. 원문에는 사용자가 입력한 요청이 포함될 수 있습니다.
          </p>
        </div>
      ) : (
        <p className="cockpit-empty">보고서는 Run이 완료되거나 실패하면 자동으로 저장됩니다.</p>
      )}

      <div className="artifact-list">
        {props.artifacts.length ? (
          props.artifacts.map((artifact) => (
            <article className="artifact-row" key={artifact.id}>
              <div>
                <strong>{artifact.title}</strong>
                <small>{artifact.path ?? artifact.kind}</small>
              </div>
              <div className="cockpit-section-actions">
                <button
                  className="cockpit-mini-button"
                  disabled={!canPreview(artifact)}
                  onClick={() => props.onPreview(artifact.id)}
                  type="button"
                >
                  미리보기
                </button>
                <button
                  className="cockpit-mini-button"
                  disabled={!canRequestDiff(artifact)}
                  onClick={() => props.onDiff(artifact.id)}
                  type="button"
                >
                  Diff
                </button>
              </div>
            </article>
          ))
        ) : (
          <p className="cockpit-empty">이 Run에 등록된 산출물이 아직 없습니다.</p>
        )}
      </div>

      {props.debug ? (
        <div className="run-debug-block">
          {props.debug.report ? <p className="cockpit-muted">보고서 artifact: {props.debug.report.title}</p> : null}
          <pre className="run-debug-json">{JSON.stringify(props.debug.summary, null, 2)}</pre>
        </div>
      ) : null}

      {props.preview ? (
        <div className="artifact-preview" role="dialog" aria-label="산출물 미리보기">
          <div className="artifact-preview__header">
            <strong>{props.preview.artifact.title}</strong>
            <button className="cockpit-mini-button" onClick={props.onClosePreview} type="button">
              닫기
            </button>
          </div>
          <p className="cockpit-muted">출처: {previewSourceLabel(props.preview.preview.source)}</p>
          {props.preview.preview.source === "current-workspace" ? (
            <p className="settings-warning">
              이 산출물에는 저장된 스냅샷이 없어 현재 워크스페이스 파일을 읽었습니다. 오래된 Run의 내용과 다를 수 있습니다.
            </p>
          ) : null}
          {props.preview.preview.sensitiveFieldsHidden ? (
            <p className="cockpit-muted">민감할 수 있는 값은 복사/미리보기 기본값에서 숨겨집니다.</p>
          ) : null}
          {props.preview.preview.binary ? (
            <p className="cockpit-empty">바이너리 또는 지원하지 않는 인코딩은 미리보기를 표시할 수 없습니다.</p>
          ) : (
            <pre>{props.preview.preview.content}</pre>
          )}
          {props.preview.preview.truncated ? <small>큰 파일이라 일부만 표시했습니다.</small> : null}
        </div>
      ) : null}

      {props.diff ? (
        <div className="artifact-preview" role="dialog" aria-label="산출물 diff">
          <div className="artifact-preview__header">
            <strong>{props.diff.artifact.title} Diff</strong>
            <button className="cockpit-mini-button" onClick={props.onCloseDiff} type="button">
              닫기
            </button>
          </div>
          {props.diff.diff.available ? (
            <pre>{props.diff.diff.content}</pre>
          ) : (
            <p className="cockpit-empty">
              {props.diff.diff.reason ??
                "변경 전 기준이 없어 diff를 만들 수 없습니다. 현재 파일 미리보기만 제공됩니다."}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
