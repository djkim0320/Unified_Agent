import {
  providerLabels,
  type AgentMemorySnapshot,
  type TaskEventRecord,
  type TaskRecord,
  type WorkspaceFileRecord,
  type WorkspaceRunEventRecord,
  type WorkspaceRunRecord,
  type WorkspaceScope,
  type WorkspaceTreeNode,
} from "../types";

interface WorkspaceViewProps {
  file: WorkspaceFileRecord | null;
  loading: boolean;
  memory?: AgentMemorySnapshot | null;
  onCancelTask?: (taskId: string) => void;
  onScopeChange: (scope: WorkspaceScope) => void;
  onSelectFile: (path: string) => void;
  onSelectRun: (runId: string) => void;
  onSelectTask?: (taskId: string) => void;
  onStartTask?: () => void;
  runEvents: WorkspaceRunEventRecord[] | null;
  runs: WorkspaceRunRecord[];
  scope: WorkspaceScope;
  selectedRunId: string | null;
  selectedTaskId?: string | null;
  taskEvents?: TaskEventRecord[] | null;
  tasks?: TaskRecord[];
  tree: WorkspaceTreeNode[];
}

const runStatusLabels: Record<WorkspaceRunRecord["status"], string> = {
  running: "실행 중",
  completed: "완료",
  failed: "실패",
  cancelled: "취소됨",
};

const taskStatusLabels: Record<TaskRecord["status"], string> = {
  queued: "대기 중",
  running: "실행 중",
  completed: "완료",
  failed: "실패",
  timed_out: "시간 초과",
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

const taskEventTypeLabels: Record<TaskEventRecord["eventType"], string> = {
  queued: "대기 등록",
  running: "실행 시작",
  status: "상태",
  completed: "완료",
  failed: "실패",
  timed_out: "시간 초과",
  cancelled: "취소",
  result_delivered: "결과 전달",
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

function displayPath(value: string) {
  return isAbsoluteHostPath(value) ? "[경로 숨김]" : value;
}

function sanitizePayload(value: unknown): unknown {
  if (typeof value === "string") {
    return isAbsoluteHostPath(value) ? "[경로 숨김]" : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePayload(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, sanitizePayload(child)]),
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
  memory,
  onCancelTask,
  onScopeChange,
  onSelectFile,
  onSelectRun,
  onSelectTask,
  onStartTask,
  runEvents,
  runs,
  scope,
  selectedRunId,
  selectedTaskId = null,
  taskEvents = [],
  tasks = [],
  tree,
}: WorkspaceViewProps) {
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const eventsForSelectedRun = selectedRun ? runEvents ?? [] : [];
  const eventsForSelectedTask = taskEvents ?? [];

  return (
    <div className="workspace-panel">
      <header className="workspace-panel__header">
        <div>
          <h2>워크스페이스</h2>
          <p>현재 세션의 파일, 실행 로그, 태스크, 메모리를 한 화면에서 확인할 수 있습니다.</p>
        </div>
        <div className="workspace-panel__scope-switcher">
          {onStartTask ? (
            <button onClick={onStartTask} type="button">
              백그라운드 작업 시작
            </button>
          ) : null}
          <button aria-pressed={scope === "sandbox"} onClick={() => onScopeChange("sandbox")} type="button">
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

          <section>
            <h3>백그라운드 작업</h3>
            {tasks.length ? (
              <ul className="workspace-runs">
                {tasks.map((task) => (
                  <li key={task.id}>
                    <div className="workspace-task-item">
                      <button
                        aria-pressed={task.id === selectedTaskId}
                        className={`workspace-run workspace-run--task${task.id === selectedTaskId ? " is-active" : ""}`}
                        onClick={() => onSelectTask?.(task.id)}
                        type="button"
                      >
                        <strong>{task.title}</strong>
                        <span>{taskStatusLabels[task.status]}</span>
                        <small>{task.prompt}</small>
                        <small>{formatTime(task.createdAt)}</small>
                      </button>
                      {onCancelTask &&
                      (task.status === "queued" || task.status === "running") ? (
                        <button
                          className="workspace-run__cancel"
                          onClick={() => onCancelTask(task.id)}
                          type="button"
                        >
                          취소
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p>등록된 작업이 없습니다.</p>
            )}
          </section>
        </aside>

        <section className="workspace-panel__preview">
          <div className="workspace-preview">
            <h3>파일 미리보기</h3>
            {file ? (
              <article>
                <p>{displayPath(file.path)}</p>
                {file.binary ? <p>바이너리 파일이라 미리보기를 제공하지 않습니다.</p> : null}
                {file.unsupportedEncoding ? (
                  <p>지원하지 않는 인코딩이라 내용을 안전하게 표시하지 않았습니다.</p>
                ) : null}
                {!file.binary && !file.unsupportedEncoding ? <pre>{file.content}</pre> : null}
              </article>
            ) : (
              <p>파일을 선택해 주세요.</p>
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
              <p>실행 기록을 선택해 주세요.</p>
            )}
          </div>

          <div className="workspace-preview">
            <h3>선택한 작업</h3>
            {selectedTask ? (
              <article>
                <p>
                  {selectedTask.title} / {taskStatusLabels[selectedTask.status]}
                </p>
                <p>{selectedTask.prompt}</p>
                {selectedTask.resultText ? (
                  <>
                    <strong>결과</strong>
                    <pre>{selectedTask.resultText}</pre>
                  </>
                ) : null}
                <ul className="workspace-run-events">
                  {eventsForSelectedTask.length ? (
                    eventsForSelectedTask.map((event) => (
                      <li key={event.id}>
                        <strong>{taskEventTypeLabels[event.eventType]}</strong>
                        <pre>{formatPayload(event.payload)}</pre>
                      </li>
                    ))
                  ) : (
                    <li>
                      <p>선택한 작업에 대한 이벤트가 없습니다.</p>
                    </li>
                  )}
                </ul>
              </article>
            ) : (
              <p>작업을 선택하면 상태 변화와 결과를 여기서 볼 수 있습니다.</p>
            )}
          </div>

          <div className="workspace-preview">
            <h3>에이전트 메모리</h3>
            {memory ? (
              <article>
                <p>{displayPath(memory.durableMemoryPath)}</p>
                <pre>{memory.durableMemory || "저장된 장기 메모리가 없습니다."}</pre>
                <p>{displayPath(memory.dailyMemoryPath)}</p>
                <pre>{memory.dailyMemory || "오늘의 메모리가 없습니다."}</pre>
              </article>
            ) : (
              <p>메모리를 불러오면 여기에 표시됩니다.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
