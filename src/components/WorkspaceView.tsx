import { providerLabels, type WorkspaceFileRecord, type WorkspaceRunEventRecord, type WorkspaceRunRecord, type WorkspaceScope, type WorkspaceTreeNode } from "../types";

interface WorkspaceViewProps {
  file: WorkspaceFileRecord | null;
  loading: boolean;
  onScopeChange: (scope: WorkspaceScope) => void;
  onSelectFile: (path: string) => void;
  onSelectRun: (runId: string) => void;
  runEvents: WorkspaceRunEventRecord[] | null;
  runs: WorkspaceRunRecord[];
  scope: WorkspaceScope;
  selectedRunId: string | null;
  tree: WorkspaceTreeNode[];
}

const runStatusLabels: Record<WorkspaceRunRecord["status"], string> = {
  running: "실행 중",
  completed: "완료",
  failed: "실패",
  cancelled: "취소됨",
};

const eventTypeLabels: Record<WorkspaceRunEventRecord["eventType"], string> = {
  status: "상태",
  tool_call: "도구 호출",
  tool_result: "도구 결과",
  error: "오류",
  run_complete: "실행 완료",
  run_failed: "실행 실패",
  run_cancelled: "실행 취소",
};

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function isAbsoluteHostPath(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) || /^\/(?!\/)/.test(value);
}

function displayPath(path: string) {
  return isAbsoluteHostPath(path) ? "[경로 숨김]" : path;
}

function sanitizePayload(value: unknown): unknown {
  if (typeof value === "string") {
    return isAbsoluteHostPath(value) ? "[경로 숨김]" : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizePayload(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, childValue]) => [key, sanitizePayload(childValue)]),
    );
  }

  return value;
}

function formatPayload(payload: Record<string, unknown>) {
  try {
    return JSON.stringify(sanitizePayload(payload), null, 2);
  } catch {
    return "[표시할 수 없는 실행 정보]";
  }
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
  const eventsForSelectedRun = selectedRun ? runEvents ?? [] : [];

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
              <ul className="workspace-tree">{tree.map((node) => renderTreeNode(node, onSelectFile))}</ul>
            ) : (
              <p>선택한 범위에 파일이 없습니다.</p>
            )}
          </section>

          <section>
            <h3>실행 기록</h3>
            {runs.length ? (
              <ul className="workspace-runs">
                {runs.map((run) => (
                  <li key={run.id}>
                    <button
                      aria-pressed={run.id === selectedRunId}
                      className={`workspace-run${run.id === selectedRunId ? " is-active" : ""}`}
                      onClick={() => onSelectRun(run.id)}
                      type="button"
                    >
                      <strong>{providerLabels[run.providerKind]}</strong>
                      <span>{run.model}</span>
                      <small>{run.userMessage}</small>
                      <small>
                        {runStatusLabels[run.status]} / {formatTime(run.createdAt)}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>실행 기록이 없습니다.</p>
            )}
          </section>
        </aside>

        <section className="workspace-panel__preview">
          <div className="workspace-preview">
            <h3>파일 미리보기</h3>
            {file ? (
              <article>
                <p>{displayPath(file.path)}</p>
                {file.binary ? <p>바이너리 파일이라 미리볼 수 없습니다.</p> : null}
                {file.unsupportedEncoding ? <p>지원하지 않는 인코딩이라 내용을 표시할 수 없습니다.</p> : null}
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
                  {providerLabels[selectedRun.providerKind]} / {selectedRun.model} /{" "}
                  {runStatusLabels[selectedRun.status]}
                </p>
                <p>{selectedRun.userMessage}</p>
                <ul className="workspace-run-events">
                  {eventsForSelectedRun.length ? (
                    eventsForSelectedRun.map((event) => (
                      <li key={event.id}>
                        <strong>{eventTypeLabels[event.eventType]}</strong>
                        <pre>{formatPayload(event.payload)}</pre>
                      </li>
                    ))
                  ) : (
                    <li>
                      <p>선택한 실행에 대한 이벤트가 없습니다.</p>
                    </li>
                  )}
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
