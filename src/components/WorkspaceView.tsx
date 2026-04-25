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
  type TaskFlowStepDetail,
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
  onCreateTaskFlow?: (payload: {
    title: string;
    autoStart?: boolean;
    steps: Array<{
      stepKey: string;
      title: string;
      prompt: string;
      dependencyStepKey?: string | null;
    }>;
  }) => void;
  onMemorySearch?: (query: string) => void;
  onScopeChange: (scope: WorkspaceScope) => void;
  onSelectFile: (path: string) => void;
  onSelectSubagentSession?: (sessionId: string) => void;
  onSelectTask?: (taskId: string) => void;
  onSelectTaskFlow?: (flowId: string) => void;
  onResumeTaskFlow?: (flowId: string) => void;
  onRetryTaskFlowStep?: (flowId: string, stepId: string) => void;
  onSkipTaskFlowStep?: (flowId: string, stepId: string) => void;
  onStartTask?: () => void;
  onStartTaskFlow?: (flowId: string) => void;
  onTriggerHeartbeat?: () => void;
  pendingAssistantText: string;
  platformMetadata?: PlatformMetadata | null;
  platformMetadataLoading?: boolean;
  runEvents: WorkspaceRunEventRecord[] | null;
  runs: WorkspaceRunRecord[];
  scope: WorkspaceScope;
  selectedRunId: string | null;
  selectedTaskId?: string | null;
  selectedTaskFlow?: { flow: TaskFlowRecord; steps: TaskFlowStepDetail[] } | null;
  subagentSessions?: ConversationRecord[];
  taskEvents?: TaskEventRecord[] | null;
  taskFlows?: TaskFlowRecord[];
  tasks?: TaskRecord[];
  tree: WorkspaceTreeNode[];
}

interface TaskFlowDraftStep {
  stepKey: string;
  title: string;
  prompt: string;
  dependencyStepKey: string;
}

function createDefaultFlowStep(index = 1, dependencyStepKey = ""): TaskFlowDraftStep {
  return {
    stepKey: `step-${index}`,
    title: `Step ${index}`,
    prompt: "",
    dependencyStepKey,
  };
}

function normalizeStepKey(value: string, index: number) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^[\d.)\-\s]+/, "")
    .replace(/[^a-z0-9가-힣]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || `step-${index + 1}`;
}

function parseOutlineSteps(outline: string): TaskFlowDraftStep[] {
  const lines = outline
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 8);

  return lines.map((line, index) => ({
    stepKey: normalizeStepKey(line, index),
    title: line.slice(0, 80),
    prompt: `${line}\n\nExpected output: summarize the completed work and any files, decisions, or blockers created by this step.`,
    dependencyStepKey: index === 0 ? "" : normalizeStepKey(lines[index - 1], index - 1),
  }));
}

function truncateText(value: string | null | undefined, maxLength = 240) {
  if (!value) return "No summary available.";
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
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
  onResumeTaskFlow,
  onRetryTaskFlowStep,
  onSkipTaskFlowStep,
  onStartTask,
  onStartTaskFlow,
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
  const [flowSteps, setFlowSteps] = useState<TaskFlowDraftStep[]>([createDefaultFlowStep()]);
  const [flowOutline, setFlowOutline] = useState("");
  const [flowAutoStart, setFlowAutoStart] = useState(true);

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
  const flowStatusCounts = taskFlows.reduce<Record<string, number>>((counts, flow) => {
    counts[flow.status] = (counts[flow.status] ?? 0) + 1;
    return counts;
  }, {});
  const canCreateFlow =
    Boolean(onCreateTaskFlow) &&
    flowTitle.trim().length > 0 &&
    flowSteps.some((step) => step.prompt.trim().length > 0 || step.title.trim().length > 0);

  function updateFlowStep(index: number, patch: Partial<TaskFlowDraftStep>) {
    setFlowSteps((current) =>
      current.map((step, stepIndex) => (stepIndex === index ? { ...step, ...patch } : step)),
    );
  }

  function addFlowStep() {
    setFlowSteps((current) => [
      ...current,
      createDefaultFlowStep(current.length + 1, current[current.length - 1]?.stepKey ?? ""),
    ]);
  }

  function removeFlowStep(index: number) {
    setFlowSteps((current) => {
      const removedKey = current[index]?.stepKey;
      const next = current.filter((_, stepIndex) => stepIndex !== index);
      return (next.length ? next : [createDefaultFlowStep()]).map((step, stepIndex) => ({
        ...step,
        dependencyStepKey:
          step.dependencyStepKey && step.dependencyStepKey !== removedKey
            ? step.dependencyStepKey
            : stepIndex === 0
              ? ""
              : next[stepIndex - 1]?.stepKey ?? "",
      }));
    });
  }

  function moveFlowStep(index: number, direction: -1 | 1) {
    setFlowSteps((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }
      const next = [...current];
      const [step] = next.splice(index, 1);
      next.splice(nextIndex, 0, step);
      return next;
    });
  }

  function handleCreateFlowFromEditor() {
    const steps = flowSteps
      .map((step, index) => ({
        stepKey: step.stepKey.trim() || `step-${index + 1}`,
        title: step.title.trim() || `Step ${index + 1}`,
        prompt: step.prompt.trim() || step.title.trim() || flowTitle.trim(),
        dependencyStepKey: step.dependencyStepKey.trim() || null,
      }))
      .slice(0, 8);
    onCreateTaskFlow?.({
      title: flowTitle.trim(),
      autoStart: flowAutoStart,
      steps,
    });
  }

  return (
    <div className="dashboard-layout workspace-hub" id="workspace-overview">
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
          <section className="bento-card workspace-rail-card" id="workspace-files">
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

          <section className="bento-card workspace-rail-card" id="workspace-flows">
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

          <span className="workspace-nav-anchor" id="workspace-mcp" />
          <span className="workspace-nav-anchor" id="workspace-skills" />
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
              <h3>장기 작업 흐름</h3>
              <span className="status-badge">
                {activeFlowCount} active / {flowStatusCounts.completed ?? 0} done / {flowStatusCounts.failed ?? 0} failed
              </span>
            </div>
            <div className="bento-card__content workspace-rail-card__content">
              <div className="settings-card__fields">
                <label className="field">
                  <span>Flow title</span>
                  <input autoComplete="off" className="field__input" onChange={(event) => setFlowTitle(event.target.value)} value={flowTitle} />
                </label>
                <label className="field">
                  <span>Outline 붙여넣기</span>
                  <textarea
                    className="field__input"
                    onChange={(event) => setFlowOutline(event.target.value)}
                    placeholder={"1. 요구사항 정리\n2. 자료 조사\n3. 후보안 비교\n4. 실행 계획 작성"}
                    rows={5}
                    value={flowOutline}
                  />
                </label>
                <button
                  className="ghost-button"
                  disabled={!flowOutline.trim()}
                  onClick={() => {
                    const parsedSteps = parseOutlineSteps(flowOutline);
                    if (parsedSteps.length) {
                      setFlowSteps(parsedSteps);
                      if (!flowTitle.trim()) {
                        setFlowTitle(parsedSteps[0]?.title ?? "New task flow");
                      }
                    }
                  }}
                  type="button"
                >
                  Outline을 단계로 변환
                </button>
                <label className="field">
                  <span>실행 방식</span>
                  <select
                    className="field__input"
                    onChange={(event) => setFlowAutoStart(event.target.value === "true")}
                    value={String(flowAutoStart)}
                  >
                    <option value="true">생성 즉시 시작</option>
                    <option value="false">생성 후 수동 시작</option>
                  </select>
                </label>
                <div className="event-list">
                  {flowSteps.map((step, index) => (
                    <div key={`${step.stepKey}-${index}`} className="event-item">
                      <div className="event-header">
                        <strong>Step {index + 1}</strong>
                        <small>{step.dependencyStepKey ? `after ${step.dependencyStepKey}` : "first"}</small>
                      </div>
                      <div className="settings-card__fields">
                        <label className="field">
                          <span>stepKey</span>
                          <input
                            autoComplete="off"
                            className="field__input"
                            onChange={(event) => updateFlowStep(index, { stepKey: event.target.value })}
                            value={step.stepKey}
                          />
                        </label>
                        <label className="field">
                          <span>Title</span>
                          <input
                            autoComplete="off"
                            className="field__input"
                            onChange={(event) => updateFlowStep(index, { title: event.target.value })}
                            value={step.title}
                          />
                        </label>
                        <label className="field">
                          <span>Dependency</span>
                          <select
                            className="field__input"
                            onChange={(event) => updateFlowStep(index, { dependencyStepKey: event.target.value })}
                            value={step.dependencyStepKey}
                          >
                            <option value="">없음</option>
                            {flowSteps
                              .filter((candidate, candidateIndex) => candidateIndex !== index)
                              .map((candidate) => (
                                <option key={candidate.stepKey} value={candidate.stepKey}>
                                  {candidate.stepKey}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>Prompt</span>
                          <textarea
                            className="field__input"
                            onChange={(event) => updateFlowStep(index, { prompt: event.target.value })}
                            placeholder="이 단계에서 수행할 일과 기대 산출물을 적어주세요."
                            rows={4}
                            value={step.prompt}
                          />
                        </label>
                      </div>
                      <div className="dashboard-actions">
                        <button className="ghost-button" disabled={index === 0} onClick={() => moveFlowStep(index, -1)} type="button">
                          위로
                        </button>
                        <button className="ghost-button" disabled={index === flowSteps.length - 1} onClick={() => moveFlowStep(index, 1)} type="button">
                          아래로
                        </button>
                        <button className="ghost-button" onClick={() => removeFlowStep(index)} type="button">
                          삭제
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button className="ghost-button" disabled={flowSteps.length >= 8} onClick={addFlowStep} type="button">
                  Step 추가
                </button>
                <button
                  className="ghost-button"
                  disabled={!canCreateFlow}
                  onClick={handleCreateFlowFromEditor}
                  type="button"
                >
                  Flow 생성
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
                        updated: {formatTime(flow.updatedAt)}
                        {"\n"}
                        {flow.id}
                      </pre>
                      <div className="dashboard-actions">
                        <button className="ghost-button" onClick={() => onSelectTaskFlow?.(flow.id)} type="button">Open</button>
                        {flow.status === "queued" || flow.status === "running" ? (
                          <button className="ghost-button" onClick={() => onStartTaskFlow?.(flow.id)} type="button">Start</button>
                        ) : null}
                        {flow.status === "failed" || flow.status === "cancelled" ? (
                          <button className="ghost-button" onClick={() => onResumeTaskFlow?.(flow.id)} type="button">Resume</button>
                        ) : null}
                        {flow.status === "queued" || flow.status === "running" ? (
                          <button className="ghost-button" onClick={() => onCancelTaskFlow?.(flow.id)} type="button">Cancel</button>
                        ) : null}
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
                      updated: {formatTime(selectedFlow.updatedAt)}
                      {"\n"}
                      {selectedFlow.resultSummary ? `summary: ${truncateText(selectedFlow.resultSummary)}` : ""}
                      {selectedFlow.errorText ? `\nerror: ${truncateText(selectedFlow.errorText)}` : ""}
                      {"\n"}
                      {selectedFlow.id}
                    </pre>
                    <div className="dashboard-actions">
                      {selectedFlow.status === "queued" || selectedFlow.status === "running" ? (
                        <button className="ghost-button" onClick={() => onStartTaskFlow?.(selectedFlow.id)} type="button">Start</button>
                      ) : null}
                      {selectedFlow.status === "failed" || selectedFlow.status === "cancelled" ? (
                        <button className="ghost-button" onClick={() => onResumeTaskFlow?.(selectedFlow.id)} type="button">Resume</button>
                      ) : null}
                      {selectedFlow.status === "queued" || selectedFlow.status === "running" ? (
                        <button className="ghost-button" onClick={() => onCancelTaskFlow?.(selectedFlow.id)} type="button">Cancel</button>
                      ) : null}
                    </div>
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
                          dependency: {step.dependencyStepKey ?? "none"}
                          {"\n"}
                          task: {step.task?.id ?? step.taskId ?? "none"} / {step.task?.status ?? "none"}
                          {"\n"}
                          run: {step.run?.id ?? "none"} / {step.run?.status ?? "none"}
                          {"\n"}
                          completed: {step.completedAt ? formatTime(step.completedAt) : "not completed"}
                          {"\n\n"}
                          {step.prompt}
                          {"\n\n"}
                          result: {truncateText(step.task?.resultText)}
                        </pre>
                        <div className="dashboard-actions">
                          <button className="ghost-button" onClick={() => onRetryTaskFlowStep?.(selectedFlow.id, step.id)} type="button">
                            Retry
                          </button>
                          {step.status !== "completed" && step.status !== "skipped" ? (
                            <button className="ghost-button" onClick={() => onSkipTaskFlowStep?.(selectedFlow.id, step.id)} type="button">
                              Skip
                            </button>
                          ) : null}
                        </div>
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
