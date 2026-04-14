import { useState } from "react";
import { ActivityFeed } from "./ActivityFeed";
import {
  providerLabels,
  type AgentHeartbeatRecord,
  type AgentMemorySnapshot,
  type ConversationRecord,
  type DisplayMessage,
  type HeartbeatLogRecord,
  type MemorySearchResult,
  type PlatformMetadata,
  type PluginSkillSummary,
  type TaskEventRecord,
  type TaskFlowRecord,
  type TaskFlowStepRecord,
  type TaskRecord,
  type ToolPermission,
  type WorkspaceFileRecord,
  type WorkspaceRunEventRecord,
  type WorkspaceRunRecord,
  type WorkspaceScope,
  type WorkspaceTreeNode,
} from "../types";

interface WorkspaceViewProps {
  file: WorkspaceFileRecord | null;
  heartbeat?: AgentHeartbeatRecord | null;
  heartbeatLogs?: HeartbeatLogRecord[];
  liveEvents: WorkspaceRunEventRecord[];
  loading: boolean;
  memory?: AgentMemorySnapshot | null;
  memorySearchLoading?: boolean;
  memorySearchResults?: MemorySearchResult[];
  messages: DisplayMessage[];
  onCancelTask?: (taskId: string) => void;
  onCancelSubagentSession?: (sessionId: string) => void;
  onCancelTaskFlow?: (flowId: string) => void;
  onCreateSubagentSession?: (payload: { title?: string; prompt: string }) => void;
  onCreateTaskFlow?: (payload: { title: string; prompt: string }) => void;
  onMemorySearch?: (query: string) => void;
  onScopeChange: (scope: WorkspaceScope) => void;
  onSelectFile: (path: string) => void;
  onSelectSubagentSession?: (sessionId: string) => void;
  onSelectTask?: (taskId: string) => void;
  onSelectTaskFlow?: (flowId: string) => void;
  onStartTask?: () => void;
  onTriggerHeartbeat?: () => void;
  pendingAssistantText: string;
  platformMetadata?: PlatformMetadata | null;
  platformMetadataLoading?: boolean;
  runEvents: WorkspaceRunEventRecord[] | null;
  runs: WorkspaceRunRecord[];
  scope: WorkspaceScope;
  selectedRunId: string | null;
  selectedTaskId?: string | null;
  selectedTaskFlow?: { flow: TaskFlowRecord; steps: TaskFlowStepRecord[] } | null;
  subagentSessions?: ConversationRecord[];
  taskEvents?: TaskEventRecord[] | null;
  taskFlows?: TaskFlowRecord[];
  tasks?: TaskRecord[];
  tree: WorkspaceTreeNode[];
}

const taskStatusLabels: Record<TaskRecord["status"], string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  timed_out: "Timed out",
  cancelled: "Cancelled",
};

const taskEventTypeLabels: Record<TaskEventRecord["eventType"], string> = {
  queued: "Queued",
  running: "Running",
  status: "Status",
  completed: "Completed",
  failed: "Failed",
  timed_out: "Timed out",
  cancelled: "Cancelled",
  result_delivered: "Result delivered",
};

const heartbeatLogStatusLabels: Record<HeartbeatLogRecord["status"], string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const heartbeatTriggerSourceLabels: Record<HeartbeatLogRecord["triggerSource"], string> = {
  manual: "Manual",
  scheduler: "Scheduled",
};

const toolPermissionLabels: Record<ToolPermission, string> = {
  workspace: "Workspace",
  memory: "Memory",
  network: "Network",
  browser: "Browser",
  exec: "Exec",
  tasks: "Tasks",
};

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function formatDateTimeString(value: string | null) {
  if (!value) return "none";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : formatTime(parsed);
}

function isAbsoluteHostPath(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) || /^\/(?!\/)/.test(value);
}

function displayPath(value: string) {
  return isAbsoluteHostPath(value) ? "[hidden path]" : value;
}

function sanitizePayload(value: unknown): unknown {
  if (typeof value === "string") return isAbsoluteHostPath(value) ? "[hidden path]" : value;
  if (Array.isArray(value)) return value.map((entry) => sanitizePayload(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitizePayload(child)]));
  }
  return value;
}

function formatPayload(payload: Record<string, unknown>) {
  try {
    return JSON.stringify(sanitizePayload(payload), null, 2);
  } catch {
    return "[unserializable payload]";
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

function countToolsByPermission(metadata: PlatformMetadata | null | undefined) {
  const counts = new Map<ToolPermission, number>();
  for (const tool of metadata?.tools ?? []) counts.set(tool.permission, (counts.get(tool.permission) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0]));
}

function getMemoryResultLabel(result: MemorySearchResult, index: number) {
  return result.title ?? result.path ?? `result-${index + 1}`;
}

function getMemoryResultSummary(result: MemorySearchResult) {
  return result.excerpt ?? result.content ?? "No excerpt available.";
}

function renderPreview(file: WorkspaceFileRecord | null) {
  if (!file) return <div className="terminal-empty">Pick a file from the tree to preview it here.</div>;
  return (
    <article>
      <div className="terminal-header">{displayPath(file.path)}</div>
      {file.binary ? <p className="text-muted">Binary files cannot be previewed inline.</p> : null}
      {file.unsupportedEncoding ? <p className="text-muted">This file uses an unsupported encoding.</p> : null}
      {!file.binary && !file.unsupportedEncoding ? <pre>{file.content}</pre> : null}
    </article>
  );
}

export function WorkspaceView({
  file,
  heartbeat = null,
  heartbeatLogs = [],
  liveEvents,
  loading,
  memory,
  memorySearchLoading = false,
  memorySearchResults = [],
  messages,
  onCancelTask,
  onCancelSubagentSession,
  onCancelTaskFlow,
  onCreateSubagentSession,
  onCreateTaskFlow,
  onMemorySearch,
  onScopeChange,
  onSelectFile,
  onSelectSubagentSession,
  onSelectTask,
  onSelectTaskFlow,
  onStartTask,
  onTriggerHeartbeat,
  pendingAssistantText,
  platformMetadata = null,
  platformMetadataLoading = false,
  runEvents,
  runs,
  scope,
  selectedRunId,
  selectedTaskId = null,
  selectedTaskFlow = null,
  subagentSessions = [],
  taskEvents = [],
  taskFlows = [],
  tasks = [],
  tree,
}: WorkspaceViewProps) {
  const [memorySearchQuery, setMemorySearchQuery] = useState("");
  const [subagentTitle, setSubagentTitle] = useState("");
  const [subagentPrompt, setSubagentPrompt] = useState("");
  const [flowTitle, setFlowTitle] = useState("");
  const [flowPrompt, setFlowPrompt] = useState("");

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const eventsForSelectedTask = selectedTask ? taskEvents ?? [] : [];
  const selectedFlow = selectedTaskFlow?.flow ?? null;
  const selectedFlowSteps = selectedTaskFlow?.steps ?? [];
  const pluginSkills = (platformMetadata?.plugins ?? []).flatMap((plugin) =>
    (plugin.skills ?? []).map((skill) => ({
      pluginName: plugin.name,
      skillName: typeof skill === "string" ? skill : skill.name,
    })),
  );
  const agentSkills = platformMetadata?.agentSkills ?? [];
  const toolsByPermission = countToolsByPermission(platformMetadata);
  const pendingTaskCount = tasks.filter((task) => task.status === "queued" || task.status === "running").length;
  const activeFlowCount = taskFlows.filter((flow) => flow.status === "queued" || flow.status === "running").length;

  return (
    <div className="dashboard-layout workspace-hub">
      <header className="dashboard-header workspace-hub__header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h2>Current session workspace</h2>
          <p>Inspect runs, files, memory, sub-agent activity, and task flows from one place.</p>
        </div>
        <div className="dashboard-actions">
          <div className="dashboard-scope">
            <button aria-pressed={scope === "sandbox"} onClick={() => onScopeChange("sandbox")} type="button">
              Sandbox
            </button>
            <button aria-pressed={scope === "shared"} onClick={() => onScopeChange("shared")} type="button">
              Shared
            </button>
          </div>
          {onStartTask ? (
            <button className="ghost-button" onClick={onStartTask} type="button">
              Start task
            </button>
          ) : null}
        </div>
      </header>

      <div className="workspace-focus-layout">
        <main className="workspace-stage">
          <section className="bento-card workspace-stage__summary">
            <div className="workspace-summary-grid">
              <article className="workspace-summary-chip">
                <div className={`summary-icon${heartbeat?.enabled ? " pulse-heartbeat" : ""}`}>HB</div>
                <div className="summary-details">
                  <span className="summary-label">Heartbeat</span>
                  <span className="summary-value">{heartbeat?.enabled ? `Enabled / ${heartbeat.intervalMinutes} min` : "Disabled"}</span>
                </div>
              </article>
              <article className="workspace-summary-chip">
                <div className="summary-icon">TK</div>
                <div className="summary-details">
                  <span className="summary-label">Tasks</span>
                  <span className="summary-value">{pendingTaskCount} running</span>
                </div>
              </article>
              <article className="workspace-summary-chip">
                <div className="summary-icon">TL</div>
                <div className="summary-details">
                  <span className="summary-label">Tools</span>
                  <span className="summary-value">{platformMetadataLoading ? "Loading" : `${platformMetadata?.tools.length ?? 0} ready`}</span>
                </div>
              </article>
              <article className="workspace-summary-chip">
                <div className="summary-icon">ME</div>
                <div className="summary-details">
                  <span className="summary-label">Memory</span>
                  <span className="summary-value">{memory && memory.dailyMemory.length > 0 ? "Daily notes present" : "No daily notes"}</span>
                </div>
              </article>
            </div>
          </section>

          <section className="bento-card activity-feed-card activity-feed-card--stage">
            <div className="bento-card__header activity-feed-card__header">
              <div>
                <h3>Session activity</h3>
                <p className="activity-feed__subtitle">Messages, tool calls, task state, and run updates in one feed.</p>
              </div>
              {selectedRun ? (
                <div className="activity-feed__run-summary">
                  <strong>{providerLabels[selectedRun.providerKind]}</strong>
                  <span>{selectedRun.model}</span>
                </div>
              ) : null}
            </div>
            <div className="bento-card__content activity-feed-card__content activity-feed-card__content--stage">
              <ActivityFeed
                liveEvents={liveEvents}
                messages={messages}
                pendingAssistantText={pendingAssistantText}
                runEvents={runEvents}
                selectedRun={selectedRun}
              />
            </div>
          </section>
        </main>

        <aside className="workspace-rail">
          <section className="bento-card workspace-rail-card">
            <div className="bento-card__header">
              <h3>File tree</h3>
            </div>
            <div className="bento-card__content workspace-rail-card__content">
              {loading ? <p className="text-muted">Loading files...</p> : null}
              {tree.length ? (
                <ul className="workspace-tree">{tree.map((node) => renderTreeNode(node, onSelectFile))}</ul>
              ) : (
                <p className="text-muted">No files available at the current scope.</p>
              )}
            </div>
          </section>

          <section className="bento-card workspace-rail-card workspace-rail-card--preview">
            <div className="bento-card__header">
              <h3>File preview</h3>
            </div>
            <div className="bento-card__content terminal-view workspace-rail-card__content">{renderPreview(file)}</div>
          </section>

          <section className="bento-card workspace-rail-card">
            <div className="bento-card__header">
              <h3>Background tasks</h3>
            </div>
            <div className="bento-card__content workspace-rail-card__content">
              {tasks.length ? (
                <ul className="timeline-list">
                  {tasks.map((task) => (
                    <li key={task.id} className="timeline-item">
                      <div className={`timeline-dot timeline-dot--${task.status === "running" ? "active" : task.status === "completed" ? "done" : task.status === "failed" ? "error" : "default"}`} />
                      <div className="timeline-content">
                        <button
                          aria-pressed={task.id === selectedTaskId}
                          className={`task-btn${task.id === selectedTaskId ? " is-active" : ""}`}
                          onClick={() => onSelectTask?.(task.id)}
                          type="button"
                        >
                          <strong>{task.title}</strong>
                          <span className="status-badge">{taskStatusLabels[task.status]}</span>
                          <small>{formatTime(task.createdAt)}</small>
                        </button>
                        {onCancelTask && (task.status === "queued" || task.status === "running") ? (
                          <button className="task-cancel" onClick={() => onCancelTask(task.id)} type="button">
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">No background tasks yet.</p>
              )}
            </div>
          </section>

          <section className="bento-card workspace-rail-card">
            <div className="bento-card__header">
              <h3>Selected task events</h3>
            </div>
            <div className="bento-card__content workspace-rail-card__content">
              {selectedTask ? (
                eventsForSelectedTask.length ? (
                  <div className="event-list">
                    {eventsForSelectedTask.map((event) => (
                      <div key={event.id} className="event-item">
                        <div className="event-header">
                          <strong>{taskEventTypeLabels[event.eventType]}</strong>
                          <small>{formatTime(event.createdAt)}</small>
                        </div>
                        <pre className="event-payload">{formatPayload(event.payload)}</pre>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted">This task has no recorded events yet.</p>
                )
              ) : (
                <p className="text-muted">Select a task from the list to inspect its events.</p>
              )}
            </div>
          </section>

          <section className="bento-card workspace-rail-card">
            <div className="bento-card__header workspace-rail-card__header--action">
              <h3>Heartbeat</h3>
              {onTriggerHeartbeat ? (
                <button className="summary-action" onClick={onTriggerHeartbeat} type="button">
                  Run now
                </button>
              ) : null}
            </div>
            <div className="bento-card__content workspace-rail-card__content">
              {heartbeat ? (
                <article>
                  {heartbeat.parseError ? <p className="workspace-view__error">Parse error: {heartbeat.parseError}</p> : null}
                  <div className="event-list">
                    <div className="event-item">
                      <div className="event-header">
                        <strong>Instructions</strong>
                        <small>Last run: {formatDateTimeString(heartbeat.lastRun)}</small>
                      </div>
                      <pre className="event-payload">{heartbeat.instructions || "No heartbeat instructions have been saved yet."}</pre>
                    </div>
                    {heartbeatLogs.length ? (
                      heartbeatLogs.map((log) => (
                        <div key={log.id} className="event-item">
                          <div className="event-header">
                            <strong>{heartbeatTriggerSourceLabels[log.triggerSource]} / {heartbeatLogStatusLabels[log.status]}</strong>
                            <small>{formatTime(log.triggeredAt)}</small>
                          </div>
                          <pre className="event-payload">{log.summary ?? "No summary available."}</pre>
                        </div>
                      ))
                    ) : (
                      <p className="text-muted">No heartbeat logs yet.</p>
                    )}
                  </div>
                </article>
              ) : (
                <p className="text-muted">No heartbeat configuration loaded.</p>
              )}
            </div>
          </section>

          <section className="bento-card workspace-rail-card">
            <div className="bento-card__header">
              <h3>Memory</h3>
            </div>
            <div className="bento-card__content workspace-rail-card__content">
              {memory ? (
                <div className="event-list">
                  <div className="event-item">
                    <div className="event-header">
                      <strong>Durable memory</strong>
                      <small>{displayPath(memory.durableMemoryPath)}</small>
                    </div>
                    <pre className="event-payload">{memory.durableMemory || "No durable memory has been saved yet."}</pre>
                  </div>
                  <div className="event-item">
                    <div className="event-header">
                      <strong>Daily memory</strong>
                      <small>{displayPath(memory.dailyMemoryPath)}</small>
                    </div>
                    <pre className="event-payload">{memory.dailyMemory || "No daily memory has been saved yet."}</pre>
                  </div>
                </div>
              ) : (
                <p className="text-muted">No memory snapshot loaded.</p>
              )}
            </div>
          </section>

          <section className="bento-card workspace-rail-card">
            <div className="bento-card__header workspace-rail-card__header--action">
              <h3>Memory search</h3>
              <span className="status-badge">{memorySearchResults.length} results</span>
            </div>
            <div className="bento-card__content workspace-rail-card__content">
              <div className="settings-card__fields">
                <label className="field">
                  <span>Query</span>
                  <input
                    autoComplete="off"
                    className="field__input"
                    onChange={(event) => setMemorySearchQuery(event.target.value)}
                    value={memorySearchQuery}
                  />
                </label>
                <button
                  className="ghost-button"
                  disabled={memorySearchLoading || !onMemorySearch || !memorySearchQuery.trim()}
                  onClick={() => onMemorySearch?.(memorySearchQuery.trim())}
                  type="button"
                >
                  {memorySearchLoading ? "Searching..." : "Search memory"}
                </button>
              </div>
              {memorySearchResults.length ? (
                <div className="event-list">
                  {memorySearchResults.map((result, index) => (
                    <div key={`${result.path ?? "result"}-${index}`} className="event-item">
                      <div className="event-header">
                        <strong>{getMemoryResultLabel(result, index)}</strong>
                        <small>{result.score != null ? `score ${result.score}` : "match"}</small>
                      </div>
                      <pre className="event-payload">{getMemoryResultSummary(result)}</pre>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted">Search the agent memory for a quick evidence trail.</p>
              )}
            </div>
          </section>

          <section className="bento-card workspace-rail-card">
            <div className="bento-card__header workspace-rail-card__header--action">
              <h3>Sub-agent sessions</h3>
              <span className="status-badge">{subagentSessions.length} sessions</span>
            </div>
            <div className="bento-card__content workspace-rail-card__content">
              <div className="settings-card__fields">
                <label className="field">
                  <span>Title</span>
                  <input autoComplete="off" className="field__input" onChange={(event) => setSubagentTitle(event.target.value)} value={subagentTitle} />
                </label>
                <label className="field">
                  <span>Prompt</span>
                  <textarea
                    className="field__input"
                    onChange={(event) => setSubagentPrompt(event.target.value)}
                    placeholder="Ask the sub-agent to research, draft, or verify something."
                    rows={5}
                    value={subagentPrompt}
                  />
                </label>
                <button
                  className="ghost-button"
                  disabled={!onCreateSubagentSession || !subagentPrompt.trim()}
                  onClick={() => onCreateSubagentSession?.({ title: subagentTitle.trim() || undefined, prompt: subagentPrompt.trim() })}
                  type="button"
                >
                  Launch sub-agent
                </button>
              </div>
              {subagentSessions.length ? (
                <div className="event-list">
                  {subagentSessions.map((session) => (
                    <div key={session.id} className="event-item">
                      <div className="event-header">
                        <strong>{session.title}</strong>
                        <small>{session.sessionKind}</small>
                      </div>
                      <pre className="event-payload">
                        {session.parentConversationId ? `parent: ${session.parentConversationId}` : "parent: none"}
                        {"\n"}
                        {session.ownerRunId ? `run: ${session.ownerRunId}` : "run: none"}
                      </pre>
                      <div className="dashboard-actions">
                        <button className="ghost-button" onClick={() => onSelectSubagentSession?.(session.id)} type="button">Open</button>
                        <button className="ghost-button" onClick={() => onCancelSubagentSession?.(session.id)} type="button">Cancel</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted">No sub-agent sessions yet.</p>
              )}
            </div>
          </section>

          <section className="bento-card workspace-rail-card">
            <div className="bento-card__header workspace-rail-card__header--action">
              <h3>Task flows</h3>
              <span className="status-badge">{activeFlowCount} active</span>
            </div>
            <div className="bento-card__content workspace-rail-card__content">
              <div className="settings-card__fields">
                <label className="field">
                  <span>Flow title</span>
                  <input autoComplete="off" className="field__input" onChange={(event) => setFlowTitle(event.target.value)} value={flowTitle} />
                </label>
                <label className="field">
                  <span>Flow prompt</span>
                  <textarea
                    className="field__input"
                    onChange={(event) => setFlowPrompt(event.target.value)}
                    placeholder="Describe the step sequence you want the flow to perform."
                    rows={5}
                    value={flowPrompt}
                  />
                </label>
                <button
                  className="ghost-button"
                  disabled={!onCreateTaskFlow || !flowTitle.trim() || !flowPrompt.trim()}
                  onClick={() => onCreateTaskFlow?.({ title: flowTitle.trim(), prompt: flowPrompt.trim() })}
                  type="button"
                >
                  Create flow
                </button>
              </div>
              {taskFlows.length ? (
                <div className="event-list">
                  {taskFlows.map((flow) => (
                    <div key={flow.id} className="event-item">
                      <div className="event-header">
                        <strong>{flow.title}</strong>
                        <small>{flow.status}</small>
                      </div>
                      <pre className="event-payload">
                        {flow.conversationId ? `conversation: ${flow.conversationId}` : "conversation: none"}
                        {"\n"}
                        {flow.id}
                      </pre>
                      <div className="dashboard-actions">
                        <button className="ghost-button" onClick={() => onSelectTaskFlow?.(flow.id)} type="button">Open</button>
                        <button className="ghost-button" onClick={() => onCancelTaskFlow?.(flow.id)} type="button">Cancel</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted">No task flows yet.</p>
              )}
              {selectedFlow ? (
                <div className="event-list">
                  <div className="event-item">
                    <div className="event-header">
                      <strong>Selected flow</strong>
                      <small>{selectedFlow.status}</small>
                    </div>
                    <pre className="event-payload">
                      {selectedFlow.title}
                      {"\n"}
                      {selectedFlow.id}
                    </pre>
                  </div>
                  {selectedFlowSteps.length ? (
                    selectedFlowSteps.map((step) => (
                      <div key={step.id} className="event-item">
                        <div className="event-header">
                          <strong>{step.stepKey}</strong>
                          <small>{step.status ?? "pending"}</small>
                        </div>
                        <pre className="event-payload">
                          {step.title}
                          {"\n"}
                          {step.prompt}
                        </pre>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted">Load a flow to inspect its steps.</p>
                  )}
                </div>
              ) : null}
            </div>
          </section>

          <section className="bento-card workspace-rail-card">
            <div className="bento-card__header">
              <h3>Platform metadata</h3>
            </div>
            <div className="bento-card__content workspace-rail-card__content">
              {platformMetadataLoading ? (
                <p className="text-muted">Loading platform metadata...</p>
              ) : (
                <div className="event-list">
                  <div className="event-item">
                    <div className="event-header"><strong>Summary</strong></div>
                    <pre className="event-payload">
                      {JSON.stringify({ plugins: platformMetadata?.plugins.length ?? 0, tools: platformMetadata?.tools.length ?? 0, channels: platformMetadata?.channels.length ?? 0, pluginSkills: pluginSkills.length, agentSkills: agentSkills.length }, null, 2)}
                    </pre>
                  </div>
                  <div className="event-item">
                    <div className="event-header"><strong>Tool permissions</strong></div>
                    <pre className="event-payload">
                      {toolsByPermission.length ? toolsByPermission.map(([permission, count]) => `${toolPermissionLabels[permission]}: ${count}`).join("\n") : "No tools registered."}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
