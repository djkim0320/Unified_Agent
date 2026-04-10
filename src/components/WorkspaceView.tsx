import type {
  WorkspaceFileRecord,
  WorkspaceRunEventRecord,
  WorkspaceRunRecord,
  WorkspaceScope,
  WorkspaceTreeNode,
} from "../types";

interface WorkspaceViewProps {
  scope: WorkspaceScope;
  tree: WorkspaceTreeNode[];
  file: WorkspaceFileRecord | null;
  runs: WorkspaceRunRecord[];
  runEvents: WorkspaceRunEventRecord[];
  loading: boolean;
  onScopeChange: (scope: WorkspaceScope) => void;
  onSelectFile: (path: string) => void;
}

function TreeNode(props: {
  node: WorkspaceTreeNode;
  onSelectFile: (path: string) => void;
}) {
  if (props.node.kind === "file") {
    return (
      <li className="workspace-tree__node">
        <button
          className="workspace-tree__file"
          onClick={() => props.onSelectFile(props.node.path)}
          type="button"
        >
          {props.node.name}
        </button>
      </li>
    );
  }

  return (
    <li className="workspace-tree__node">
      <details className="workspace-tree__group" open>
        <summary>{props.node.name}</summary>
        {props.node.children?.length ? (
          <ul className="workspace-tree__list">
            {props.node.children.map((child) => (
              <TreeNode key={child.path} node={child} onSelectFile={props.onSelectFile} />
            ))}
          </ul>
        ) : (
          <div className="workspace-tree__empty">빈 폴더</div>
        )}
      </details>
    </li>
  );
}

export function WorkspaceView(props: WorkspaceViewProps) {
  return (
    <section className="workspace-view">
      <header className="workspace-view__header">
        <div>
          <p className="eyebrow">워크스페이스</p>
          <h2>파일 탐색과 에이전트 실행 로그</h2>
        </div>

        <div className="workspace-view__scope-switch">
          {(["sandbox", "shared", "root"] as const).map((scope) => (
            <button
              className={`workspace-view__scope-chip ${
                props.scope === scope ? "is-active" : ""
              }`}
              key={scope}
              onClick={() => props.onScopeChange(scope)}
              type="button"
            >
              {scope === "sandbox" ? "대화 샌드박스" : scope === "shared" ? "공용" : "루트"}
            </button>
          ))}
        </div>
      </header>

      <div className="workspace-view__grid">
        <section className="workspace-card workspace-card--tree">
          <header className="workspace-card__header">
            <h3>파일 트리</h3>
            {props.loading ? <span>불러오는 중...</span> : null}
          </header>

          {props.tree.length ? (
            <ul className="workspace-tree__list">
              {props.tree.map((node) => (
                <TreeNode key={node.path} node={node} onSelectFile={props.onSelectFile} />
              ))}
            </ul>
          ) : (
            <div className="workspace-card__empty">표시할 파일이 없습니다.</div>
          )}
        </section>

        <section className="workspace-card workspace-card--preview">
          <header className="workspace-card__header">
            <h3>파일 미리보기</h3>
            <span>{props.file?.path ?? "파일을 선택하세요"}</span>
          </header>

          {props.file ? (
            props.file.binary ? (
              <div className="workspace-card__empty">바이너리 파일은 미리보기를 지원하지 않습니다.</div>
            ) : (
              <pre className="workspace-preview">{props.file.content}</pre>
            )
          ) : (
            <div className="workspace-card__empty">왼쪽에서 파일을 선택하면 내용을 볼 수 있습니다.</div>
          )}
        </section>

        <section className="workspace-card workspace-card--runs">
          <header className="workspace-card__header">
            <h3>에이전트 로그</h3>
            <span>{props.runs.length}개 실행</span>
          </header>

          <div className="workspace-runs">
            {props.runs.length ? (
              props.runs.map((run) => (
                <article className="workspace-run" key={run.id}>
                  <div className="workspace-run__top">
                    <strong>{run.model}</strong>
                    <span>{run.status}</span>
                  </div>
                  <p className="workspace-run__message">{run.userMessage}</p>
                </article>
              ))
            ) : (
              <div className="workspace-card__empty">아직 실행 로그가 없습니다.</div>
            )}
          </div>

          <div className="workspace-events">
            {props.runEvents.map((event) => (
              <article className="workspace-event" key={event.id}>
                <strong>{event.eventType}</strong>
                <pre>{JSON.stringify(event.payload, null, 2)}</pre>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
