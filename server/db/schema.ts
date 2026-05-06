const WORKSPACE_RUN_EVENT_TYPES = [
  "status",
  "tool_call",
  "tool_result",
  "error",
  "run_complete",
  "run_failed",
  "run_cancelled",
];

const TASK_EVENT_TYPES = [
  "queued",
  "running",
  "status",
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "result_delivered",
];

const HEARTBEAT_LOG_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;
const HEARTBEAT_TRIGGER_SOURCES = ["manual", "scheduler"] as const;
const WORKSPACE_RUN_PHASES = [
  "accepted",
  "planning",
  "tool_execution",
  "synthesizing",
  "completed",
  "failed",
  "cancelled",
] as const;
const TASK_FLOW_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;
const TASK_FLOW_STEP_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "skipped",
] as const;
const TASK_FLOW_TRIGGER_SOURCES = ["manual", "schedule", "event_hook"] as const;

export function createWorkspaceRunsSql(tableName: string, options?: { ifNotExists?: boolean }) {
  const createClause = options?.ifNotExists === false ? "CREATE TABLE" : "CREATE TABLE IF NOT EXISTS";
  return `
    ${createClause} ${tableName} (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      parent_run_id TEXT REFERENCES workspace_runs(id) ON DELETE SET NULL,
      provider_kind TEXT NOT NULL,
      model TEXT NOT NULL,
      user_message TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),
      phase TEXT NOT NULL CHECK(phase IN ('${WORKSPACE_RUN_PHASES.join("', '")}')),
      checkpoint_json TEXT,
      resume_token TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;
}

export function createWorkspaceRunEventsSql(tableName: string, options?: { ifNotExists?: boolean }) {
  const createClause = options?.ifNotExists === false ? "CREATE TABLE" : "CREATE TABLE IF NOT EXISTS";
  return `
    ${createClause} ${tableName} (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES workspace_runs(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL CHECK(
        event_type IN ('${WORKSPACE_RUN_EVENT_TYPES.join("', '")}')
      ),
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `;
}

export function createSessionSummariesSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      decisions_json TEXT NOT NULL DEFAULT '[]',
      open_questions_json TEXT NOT NULL DEFAULT '[]',
      next_actions_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;
}

export function createArtifactsSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES workspace_runs(id) ON DELETE SET NULL,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      kind TEXT NOT NULL CHECK(kind IN ('file', 'diff', 'report', 'summary', 'log')),
      title TEXT NOT NULL,
      path TEXT,
      summary TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;
}

export function createConversationsSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      channel_kind TEXT NOT NULL DEFAULT 'webchat',
      session_kind TEXT NOT NULL DEFAULT 'primary',
      parent_conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
      owner_run_id TEXT,
      title TEXT NOT NULL,
      provider_kind TEXT NOT NULL,
      model TEXT NOT NULL,
      reasoning_level TEXT NOT NULL DEFAULT 'medium',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;
}

export function createTasksSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      task_kind TEXT NOT NULL DEFAULT 'detached' CHECK(task_kind IN ('detached', 'heartbeat', 'continuation', 'scheduled', 'subagent', 'flow_step')),
      task_flow_id TEXT REFERENCES task_flows(id) ON DELETE SET NULL,
      flow_step_key TEXT,
      origin_run_id TEXT REFERENCES workspace_runs(id) ON DELETE SET NULL,
      automation_rule_id TEXT REFERENCES automation_rules(id) ON DELETE SET NULL,
      parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      nesting_depth INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      provider_kind TEXT NOT NULL,
      model TEXT NOT NULL,
      reasoning_level TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'timed_out', 'cancelled')),
      run_id TEXT,
      result_text TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      scheduled_for INTEGER
    );
  `;
}

export function createTaskFlowsSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      origin_run_id TEXT REFERENCES workspace_runs(id) ON DELETE SET NULL,
      trigger_source TEXT NOT NULL CHECK(trigger_source IN ('${TASK_FLOW_TRIGGER_SOURCES.join("', '")}')),
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('${TASK_FLOW_STATUSES.join("', '")}')),
      result_summary TEXT,
      error_text TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
  `;
}

export function createTaskFlowStepsSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL REFERENCES task_flows(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      step_key TEXT NOT NULL,
      dependency_step_key TEXT,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('${TASK_FLOW_STEP_STATUSES.join("', '")}')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
  `;
}

export function createHeartbeatLogsSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      trigger_source TEXT NOT NULL CHECK(trigger_source IN ('${HEARTBEAT_TRIGGER_SOURCES.join("', '")}')),
      status TEXT NOT NULL CHECK(status IN ('${HEARTBEAT_LOG_STATUSES.join("', '")}')),
      summary TEXT,
      error_text TEXT,
      triggered_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      updated_at INTEGER NOT NULL
    );
  `;
}

export function createAutomationRulesSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      provider_kind TEXT NOT NULL,
      model TEXT NOT NULL,
      reasoning_level TEXT NOT NULL DEFAULT 'medium',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
      interval_minutes INTEGER NOT NULL CHECK(interval_minutes >= 1),
      next_run_at INTEGER NOT NULL,
      last_run_at INTEGER,
      last_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      run_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;
}

export function createTaskEventsSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL CHECK(event_type IN ('${TASK_EVENT_TYPES.join("', '")}')),
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `;
}
