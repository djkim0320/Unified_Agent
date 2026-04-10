import type {
  WorkspaceFileRecord,
  WorkspaceRunEventRecord,
  WorkspaceRunRecord,
  WorkspaceScope,
  WorkspaceTreeNode,
} from "../types";

interface WorkspaceViewProps {
  file: WorkspaceFileRecord | null;
  loading: boolean;
  onScopeChange: (scope: WorkspaceScope) => void;
  onSelectFile: (path: string) => void;
  onSelectRun: (runId: string) => void;
  runEvents: WorkspaceRunEventRecord[];
  runs: WorkspaceRunRecord[];
  scope: WorkspaceScope;
  selectedRunId: string | null;
  tree: WorkspaceTreeNode[];
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function renderTreeNode(node: WorkspaceTreeNode, onSelectFile: (path: string) => void) {
  if (node.kind === "file") {
    return (
      <li key={node.path}>
        <button className="workspace-tree__file" onClick={() => onSelectFile(node.path)} type="button">
          {node.name}
        </button>
      </li>
    );
  }

  return (
    <li key={node.path}>
      <details open>
        <summary>{node.name}</summary>
        <ul>{node.children?.map((child) => renderTreeNode(child, onSelectFile))}</ul>
      </details>
    </li>
  );
}

export function WorkspaceView({
  file,
  loading,
  onScopeChange,
  onSelectFile,
  onSelectRun,
  runEvents,
  runs,
  scope,
  selectedRunId,
  tree,
}: WorkspaceViewProps) {
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;
  const eventsForSelectedRun = selectedRun ? runEvents : [];

  return (
    <div className="workspace-panel">
      <header className="workspace-panel__header">
        <div>
          <h2>워크스페이스</h2>
          <p>현재 대화의 샌드박스와 작업 기록을 확인합니다.</p>
        </div>
        <div className="workspace-panel__scope-switcher">
          <button
            aria-pressed={scope === "sandbox"}
            onClick={() => onScopeChange("sandbox")}
            type="button"
          >
            샌드박스
          </button>
          <button aria-pressed={scope === "shared"} onClick={() => onScopeChange("shared")} type="button">
            공유
          </button>
        </div>
      </header>

      <div className="workspace-panel__content">
        <aside className="workspace-panel__sidebar">
          <section>
            <h3>파일 트리</h3>
            {loading ? <p>불러오는 중...</p> : null}
            {tree.length ? (
              <ul className="workspace-tree">
                {tree.map((node) => renderTreeNode(node, onSelectFile))}
              </ul>
            ) : (
              <p>선택한 범위에 파일이 없습니다.</p>
            )}
          </section>

          <section>
            <h3>실행 기록</h3>
            <ul className="workspace-runs">
              {runs.map((run) => (
                <li key={run.id}>
                  <button
                    aria-pressed={run.id === selectedRunId}
                    className={`workspace-run${run.id === selectedRunId ? " is-active" : ""}`}
                    onClick={() => onSelectRun(run.id)}
                    type="button"
                  >
                    <strong>{run.model}</strong>
                    <span>{run.providerKind}</span>
                    <small>{run.userMessage}</small>
                    <small>
                      {run.status} / {formatTime(run.createdAt)}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <section className="workspace-panel__preview">
          <div className="workspace-preview">
            <h3>파일 미리보기</h3>
            {file ? (
              <article>
                <p>{file.path}</p>
                {file.binary ? <p>바이너리 파일입니다.</p> : null}
                {file.unsupportedEncoding ? <p>지원되지 않는 인코딩입니다.</p> : null}
                {!file.binary && !file.unsupportedEncoding ? <pre>{file.content}</pre> : null}
              </article>
            ) : (
              <p>파일을 선택해주세요.</p>
            )}
          </div>

          <div className="workspace-preview">
            <h3>선택한 실행</h3>
            {selectedRun ? (
              <article>
                <p>
                  {selectedRun.providerKind} / {selectedRun.model} / {selectedRun.status}
                </p>
                <p>{selectedRun.userMessage}</p>
                <ul className="workspace-run-events">
                  {eventsForSelectedRun.map((event) => (
                    <li key={event.id}>
                      <strong>{event.eventType}</strong>
                      <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                    </li>
                  ))}
                </ul>
              </article>
            ) : (
              <p>실행 기록을 선택해주세요.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
