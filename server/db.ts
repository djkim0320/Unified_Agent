import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createSecretBox } from "./lib/crypto.js";
import type {
  AgentRecord,
  ComputerUseActionEventRecord,
  ComputerUseActionType,
  ComputerUseApprovalRecord,
  ComputerUseEventStatus,
  ComputerUseSessionRecord,
  ComputerUseSettingsRecord,
  ConversationRecord,
  HeartbeatLogRecord,
  HeartbeatTriggerSource,
  MemorySearchResult,
  MessageRecord,
  ProviderAccountRecord,
  ProviderKind,
  ProviderSecret,
  ReasoningLevel,
  RunCheckpoint,
  SessionKind,
  TaskKind,
  TaskFlowRecord,
  TaskFlowStatus,
  TaskFlowStepRecord,
  TaskFlowStepStatus,
  TaskFlowTriggerSource,
  TaskEventRecord,
  TaskRecord,
  TaskStatus,
  WorkspaceRunEventRecord,
  WorkspaceRunPhase,
  WorkspaceRunRecord,
  WorkspaceRunStatus,
} from "./types.js";

type SecretRow = {
  provider_kind: ProviderKind;
  encrypted_blob: string;
};

type AccountRow = {
  provider_kind: ProviderKind;
  display_name: string | null;
  email: string | null;
  account_id: string | null;
  status: ProviderAccountRecord["status"];
  metadata_json: string;
  created_at: number;
  updated_at: number;
};

type AgentRow = {
  id: string;
  name: string;
  description: string | null;
  default_provider_kind: ProviderKind;
  default_model: string;
  default_reasoning_level: ReasoningLevel;
  created_at: number;
  updated_at: number;
};

type ConversationRow = {
  id: string;
  agent_id: string;
  channel_kind: ConversationRecord["channelKind"];
  session_kind: SessionKind;
  parent_conversation_id: string | null;
  owner_run_id: string | null;
  title: string;
  provider_kind: ProviderKind;
  model: string;
  reasoning_level: ConversationRecord["reasoningLevel"];
  created_at: number;
  updated_at: number;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: MessageRecord["role"];
  content: string;
  created_at: number;
};

type WorkspaceRunRow = {
  id: string;
  conversation_id: string;
  task_id: string | null;
  parent_run_id: string | null;
  provider_kind: ProviderKind;
  model: string;
  user_message: string;
  status: WorkspaceRunStatus;
  phase: WorkspaceRunPhase;
  checkpoint_json: string | null;
  resume_token: string | null;
  created_at: number;
  updated_at: number;
};

type WorkspaceRunEventRow = {
  id: string;
  run_id: string;
  event_type: WorkspaceRunEventRecord["eventType"];
  payload_json: string;
  created_at: number;
};

type TaskRow = {
  id: string;
  agent_id: string;
  conversation_id: string;
  task_kind: TaskKind;
  task_flow_id: string | null;
  flow_step_key: string | null;
  origin_run_id: string | null;
  parent_task_id: string | null;
  nesting_depth: number;
  title: string;
  prompt: string;
  provider_kind: ProviderKind;
  model: string;
  reasoning_level: ReasoningLevel;
  status: TaskStatus;
  run_id: string | null;
  result_text: string | null;
  created_at: number;
  started_at: number | null;
  updated_at: number;
  completed_at: number | null;
  scheduled_for: number | null;
};

type TaskFlowRow = {
  id: string;
  agent_id: string;
  conversation_id: string;
  origin_run_id: string | null;
  trigger_source: TaskFlowTriggerSource;
  title: string;
  status: TaskFlowStatus;
  result_summary: string | null;
  error_text: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

type TaskFlowStepRow = {
  id: string;
  flow_id: string;
  task_id: string | null;
  step_key: string;
  dependency_step_key: string | null;
  position: number;
  title: string;
  prompt: string;
  status: TaskFlowStepStatus;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

type TaskEventRow = {
  id: string;
  task_id: string;
  event_type: TaskEventRecord["eventType"];
  payload_json: string;
  created_at: number;
};

type HeartbeatLogRow = {
  id: string;
  agent_id: string;
  conversation_id: string;
  task_id: string | null;
  trigger_source: HeartbeatTriggerSource;
  status: HeartbeatLogRecord["status"];
  summary: string | null;
  error_text: string | null;
  triggered_at: number;
  started_at: number | null;
  completed_at: number | null;
  updated_at: number;
};

type ComputerUseSettingsRow = {
  id: string;
  enabled: number;
  custom_browser_harness_enabled: number;
  allow_external_domains_json: string;
  allow_file_urls: number;
  max_actions_per_session: number;
  session_timeout_ms: number;
  updated_at: number;
};

type ComputerUseSessionRow = {
  id: string;
  agent_id: string | null;
  conversation_id: string | null;
  run_id: string | null;
  task_id: string | null;
  status: ComputerUseSessionRecord["status"];
  current_url: string | null;
  allowed_domains_json: string;
  action_count: number;
  latest_screenshot_path: string | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
};

type ComputerUseEventRow = {
  id: string;
  session_id: string;
  action_type: ComputerUseActionType;
  status: ComputerUseEventStatus;
  current_url: string | null;
  target_url: string | null;
  summary: string;
  metadata_json: string;
  screenshot_path: string | null;
  created_at: number;
};

type ComputerUseApprovalRow = {
  id: string;
  session_id: string;
  action_event_id: string | null;
  decision: ComputerUseApprovalRecord["decision"];
  reason: string | null;
  created_at: number;
};

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
const COMPUTER_USE_ACTION_TYPES = [
  "create_session",
  "navigate",
  "screenshot",
  "click",
  "double_click",
  "type",
  "keypress",
  "scroll",
  "wait",
  "extract_text",
  "close_session",
] as const;
const COMPUTER_USE_EVENT_STATUSES = [
  "allowed",
  "requires_approval",
  "blocked",
  "approved",
  "denied",
  "started",
  "completed",
  "failed",
] as const;

export const DEFAULT_AGENT_ID = "default-agent";
export const DEFAULT_CONVERSATION_TITLE = "\uC0C8 \uCC44\uD305";

function configureDatabaseConnection(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
}

function ensureSchemaMigrationsTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
}

function hasSchemaMigration(db: Database.Database, version: number) {
  const row = db
    .prepare(`SELECT version FROM schema_migrations WHERE version = ?`)
    .get(version) as { version: number } | undefined;
  return Boolean(row);
}

function recordSchemaMigration(db: Database.Database, version: number, name: string) {
  db.prepare(
    `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`,
  ).run(version, name, now());
}

function runSchemaMigration(
  db: Database.Database,
  version: number,
  name: string,
  migrate: () => void,
) {
  if (hasSchemaMigration(db, version)) {
    return;
  }
  migrate();
  recordSchemaMigration(db, version, name);
}

function now() {
  return Date.now();
}

function createWorkspaceRunsSql(tableName: string, options?: { ifNotExists?: boolean }) {
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

function createWorkspaceRunEventsSql(tableName: string, options?: { ifNotExists?: boolean }) {
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

function createConversationsSql(tableName: string) {
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

function createTasksSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      task_kind TEXT NOT NULL DEFAULT 'detached' CHECK(task_kind IN ('detached', 'heartbeat', 'continuation', 'scheduled', 'subagent', 'flow_step')),
      task_flow_id TEXT REFERENCES task_flows(id) ON DELETE SET NULL,
      flow_step_key TEXT,
      origin_run_id TEXT REFERENCES workspace_runs(id) ON DELETE SET NULL,
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

function createTaskFlowsSql(tableName: string) {
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

function createTaskFlowStepsSql(tableName: string) {
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

function createMemoryIndexSql(tableName: string) {
  return `
    CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName} USING fts5(
      agent_id UNINDEXED,
      path UNINDEXED,
      kind UNINDEXED,
      line UNINDEXED,
      reason UNINDEXED,
      text,
      tokenize = 'unicode61'
    );
  `;
}

function createHeartbeatLogsSql(tableName: string) {
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

function createTaskEventsSql(tableName: string) {
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

function createComputerUseSql() {
  return `
    CREATE TABLE IF NOT EXISTS computer_use_settings (
      id TEXT PRIMARY KEY CHECK(id = 'default'),
      enabled INTEGER NOT NULL DEFAULT 0,
      custom_browser_harness_enabled INTEGER NOT NULL DEFAULT 1,
      allow_external_domains_json TEXT NOT NULL DEFAULT '[]',
      allow_file_urls INTEGER NOT NULL DEFAULT 0,
      max_actions_per_session INTEGER NOT NULL DEFAULT 60,
      session_timeout_ms INTEGER NOT NULL DEFAULT 900000,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS computer_use_sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      run_id TEXT REFERENCES workspace_runs(id) ON DELETE SET NULL,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK(status IN ('open', 'closed')),
      current_url TEXT,
      allowed_domains_json TEXT NOT NULL DEFAULT '[]',
      action_count INTEGER NOT NULL DEFAULT 0,
      latest_screenshot_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      closed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS computer_use_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES computer_use_sessions(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL CHECK(action_type IN ('${COMPUTER_USE_ACTION_TYPES.join("', '")}')),
      status TEXT NOT NULL CHECK(status IN ('${COMPUTER_USE_EVENT_STATUSES.join("', '")}')),
      current_url TEXT,
      target_url TEXT,
      summary TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      screenshot_path TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS computer_use_approvals (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES computer_use_sessions(id) ON DELETE CASCADE,
      action_event_id TEXT REFERENCES computer_use_events(id) ON DELETE SET NULL,
      decision TEXT NOT NULL CHECK(decision IN ('approved', 'denied')),
      reason TEXT,
      created_at INTEGER NOT NULL
    );
  `;
}

function tableSql(db: Database.Database, tableName: string) {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql: string } | undefined;
  return row?.sql ?? "";
}

function migrateWorkspaceTables(db: Database.Database) {
  const runsSql = tableSql(db, "workspace_runs");
  const eventsSql = tableSql(db, "workspace_run_events");
  const needsMigration =
    (runsSql && !runsSql.includes("cancelled")) ||
    (eventsSql && (!eventsSql.includes("run_failed") || !eventsSql.includes("run_cancelled")));

  if (!needsMigration) {
    return;
  }

  db.pragma("foreign_keys = OFF");
  try {
    db.exec("BEGIN");
    db.exec(createWorkspaceRunsSql("workspace_runs_next", { ifNotExists: false }));
    db.exec(`
      INSERT INTO workspace_runs_next (
        id, conversation_id, task_id, parent_run_id, provider_kind, model, user_message, status, phase, checkpoint_json, resume_token, created_at, updated_at
      )
      SELECT id, conversation_id, NULL, NULL, provider_kind, model, user_message, status, 'accepted', NULL, NULL, created_at, updated_at
      FROM workspace_runs;
    `);

    db.exec(createWorkspaceRunEventsSql("workspace_run_events_next", { ifNotExists: false }));
    db.exec(`
      INSERT INTO workspace_run_events_next (id, run_id, event_type, payload_json, created_at)
      SELECT id, run_id, event_type, payload_json, created_at
      FROM workspace_run_events;
    `);

    db.exec("DROP TABLE workspace_run_events");
    db.exec("DROP TABLE workspace_runs");
    db.exec("ALTER TABLE workspace_runs_next RENAME TO workspace_runs");
    db.exec("ALTER TABLE workspace_run_events_next RENAME TO workspace_run_events");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function migrateTaskMetadataColumns(db: Database.Database) {
  const tasksSql = tableSql(db, "tasks");
  const requiresRebuild =
    Boolean(tasksSql) &&
    (!tasksSql.includes("'subagent'") ||
      !tasksSql.includes("'flow_step'") ||
      !tasksSql.includes("task_flow_id") ||
      !tasksSql.includes("origin_run_id") ||
      !tasksSql.includes("flow_step_key"));

  if (requiresRebuild) {
    db.pragma("foreign_keys = OFF");
    try {
      db.exec("BEGIN");
      db.exec(createTasksSql("tasks_next"));
      db.exec(`
        INSERT INTO tasks_next (
          id, agent_id, conversation_id, task_kind, task_flow_id, flow_step_key, origin_run_id,
          parent_task_id, nesting_depth, title, prompt, provider_kind, model, reasoning_level,
          status, run_id, result_text, created_at, started_at, updated_at, completed_at, scheduled_for
        )
        SELECT
          id,
          agent_id,
          conversation_id,
          COALESCE(task_kind, 'detached'),
          NULL,
          NULL,
          NULL,
          parent_task_id,
          COALESCE(nesting_depth, 0),
          title,
          prompt,
          provider_kind,
          model,
          reasoning_level,
          status,
          run_id,
          result_text,
          created_at,
          started_at,
          updated_at,
          completed_at,
          scheduled_for
        FROM tasks;
      `);
      db.exec("DROP TABLE tasks");
      db.exec("ALTER TABLE tasks_next RENAME TO tasks");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      db.pragma("foreign_keys = ON");
    }
    return;
  }

  const columns = db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  const statements: string[] = [];

  if (!columnNames.has("task_kind")) {
    statements.push(`ALTER TABLE tasks ADD COLUMN task_kind TEXT NOT NULL DEFAULT 'detached'`);
  }
  if (!columnNames.has("parent_task_id")) {
    statements.push(`ALTER TABLE tasks ADD COLUMN parent_task_id TEXT`);
  }
  if (!columnNames.has("nesting_depth")) {
    statements.push(`ALTER TABLE tasks ADD COLUMN nesting_depth INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columnNames.has("task_flow_id")) {
    statements.push(`ALTER TABLE tasks ADD COLUMN task_flow_id TEXT`);
  }
  if (!columnNames.has("flow_step_key")) {
    statements.push(`ALTER TABLE tasks ADD COLUMN flow_step_key TEXT`);
  }
  if (!columnNames.has("origin_run_id")) {
    statements.push(`ALTER TABLE tasks ADD COLUMN origin_run_id TEXT`);
  }

  if (statements.length) {
    db.pragma("foreign_keys = OFF");
    try {
      db.exec("BEGIN");
      for (const statement of statements) {
        db.exec(statement);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }
}

function migrateConversationLineageColumns(db: Database.Database) {
  const columns = db.prepare(`PRAGMA table_info(conversations)`).all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  const statements: string[] = [];

  if (!columnNames.has("session_kind")) {
    statements.push(`ALTER TABLE conversations ADD COLUMN session_kind TEXT NOT NULL DEFAULT 'primary'`);
  }
  if (!columnNames.has("parent_conversation_id")) {
    statements.push(`ALTER TABLE conversations ADD COLUMN parent_conversation_id TEXT`);
  }
  if (!columnNames.has("owner_run_id")) {
    statements.push(`ALTER TABLE conversations ADD COLUMN owner_run_id TEXT`);
  }

  if (!statements.length) {
    return;
  }

  db.pragma("foreign_keys = OFF");
  try {
    db.exec("BEGIN");
    for (const statement of statements) {
      db.exec(statement);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function migrateWorkspaceRunMetadataColumns(db: Database.Database) {
  const columns = db.prepare(`PRAGMA table_info(workspace_runs)`).all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  const statements: string[] = [];

  if (!columnNames.has("task_id")) {
    statements.push(`ALTER TABLE workspace_runs ADD COLUMN task_id TEXT`);
  }
  if (!columnNames.has("parent_run_id")) {
    statements.push(`ALTER TABLE workspace_runs ADD COLUMN parent_run_id TEXT`);
  }
  if (!columnNames.has("phase")) {
    statements.push(`ALTER TABLE workspace_runs ADD COLUMN phase TEXT NOT NULL DEFAULT 'accepted'`);
  }
  if (!columnNames.has("checkpoint_json")) {
    statements.push(`ALTER TABLE workspace_runs ADD COLUMN checkpoint_json TEXT`);
  }
  if (!columnNames.has("resume_token")) {
    statements.push(`ALTER TABLE workspace_runs ADD COLUMN resume_token TEXT`);
  }

  if (!statements.length) {
    return;
  }

  db.pragma("foreign_keys = OFF");
  try {
    db.exec("BEGIN");
    for (const statement of statements) {
      db.exec(statement);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function ensureDefaultAgent(db: Database.Database) {
  const timestamp = now();
  db.prepare(`
    INSERT INTO agents (
      id, name, description, default_provider_kind, default_model, default_reasoning_level, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING;
  `).run(
    DEFAULT_AGENT_ID,
    "\uAE30\uBCF8 \uC5D0\uC774\uC804\uD2B8",
    "Migrated local webchat agent.",
    "openai",
    "gpt-5.5",
    "high",
    timestamp,
    timestamp,
  );
}

function migrateConversationSessionColumns(db: Database.Database) {
  const conversationsSql = tableSql(db, "conversations");
  if (!conversationsSql || (conversationsSql.includes("agent_id") && conversationsSql.includes("channel_kind"))) {
    return;
  }
  const columns = db.prepare(`PRAGMA table_info(conversations)`).all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  const reasoningExpression = columnNames.has("reasoning_level")
    ? "COALESCE(reasoning_level, 'medium')"
    : "'medium'";

  db.pragma("foreign_keys = OFF");
  try {
    db.exec("BEGIN");
    db.exec(createConversationsSql("conversations_next"));
    db.exec(`
      INSERT INTO conversations_next (
        id, agent_id, channel_kind, session_kind, parent_conversation_id, owner_run_id, title, provider_kind, model, reasoning_level, created_at, updated_at
      )
      SELECT
        id,
        '${DEFAULT_AGENT_ID}',
        'webchat',
        'primary',
        NULL,
        NULL,
        title,
        provider_kind,
        model,
        ${reasoningExpression},
        created_at,
        updated_at
      FROM conversations;
    `);
    db.exec("DROP TABLE conversations");
    db.exec("ALTER TABLE conversations_next RENAME TO conversations");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function migrateTaskFlowStepPositionColumn(db: Database.Database) {
  const columns = db.prepare(`PRAGMA table_info(task_flow_steps)`).all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("position")) {
    db.exec(`ALTER TABLE task_flow_steps ADD COLUMN position INTEGER NOT NULL DEFAULT 0`);
  }

  const rows = db
    .prepare(
      `SELECT id, flow_id
       FROM task_flow_steps
       ORDER BY flow_id ASC, created_at ASC, id ASC`,
    )
    .all() as Array<{ id: string; flow_id: string }>;
  const updatePosition = db.prepare(`UPDATE task_flow_steps SET position = ? WHERE id = ?`);
  const tx = db.transaction(() => {
    let currentFlowId: string | null = null;
    let position = 0;
    for (const row of rows) {
      if (row.flow_id !== currentFlowId) {
        currentFlowId = row.flow_id;
        position = 0;
      }
      updatePosition.run(position, row.id);
      position += 1;
    }
  });
  tx();
}

export function createStore(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "chat.sqlite");
  const db = new Database(dbPath);
  const secrets = createSecretBox(dataDir);

  configureDatabaseConnection(db);
  ensureSchemaMigrationsTable(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      default_provider_kind TEXT NOT NULL,
      default_model TEXT NOT NULL,
      default_reasoning_level TEXT NOT NULL DEFAULT 'medium',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_accounts (
      provider_kind TEXT PRIMARY KEY,
      display_name TEXT,
      email TEXT,
      account_id TEXT,
      status TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_secrets (
      provider_kind TEXT PRIMARY KEY,
      encrypted_blob TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    ${createConversationsSql("conversations")}

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    ${createTaskFlowsSql("task_flows")}

    ${createTaskFlowStepsSql("task_flow_steps")}

    ${createTasksSql("tasks")}

    ${createTaskEventsSql("task_events")}

    ${createWorkspaceRunsSql("workspace_runs")}

    ${createWorkspaceRunEventsSql("workspace_run_events")}

    ${createHeartbeatLogsSql("heartbeat_logs")}

    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  recordSchemaMigration(db, 1, "base_schema");

  db.exec(createMemoryIndexSql("memory_index"));

  ensureDefaultAgent(db);
  runSchemaMigration(db, 2, "conversation_session_columns", () =>
    migrateConversationSessionColumns(db),
  );
  runSchemaMigration(db, 3, "conversation_lineage_columns", () =>
    migrateConversationLineageColumns(db),
  );
  runSchemaMigration(db, 4, "workspace_run_status_and_events", () =>
    migrateWorkspaceTables(db),
  );
  runSchemaMigration(db, 5, "workspace_run_metadata_columns", () =>
    migrateWorkspaceRunMetadataColumns(db),
  );
  runSchemaMigration(db, 6, "task_metadata_columns", () =>
    migrateTaskMetadataColumns(db),
  );

  runSchemaMigration(db, 7, "conversation_reasoning_level", () => {
    const conversationColumns = db
      .prepare(`PRAGMA table_info(conversations)`)
      .all() as Array<{ name: string }>;
    if (!conversationColumns.some((column) => column.name === "reasoning_level")) {
      db.exec(`ALTER TABLE conversations ADD COLUMN reasoning_level TEXT NOT NULL DEFAULT 'medium'`);
    }
  });
  runSchemaMigration(db, 8, "computer_use_tables", () => {
    db.exec(createComputerUseSql());
  });
  runSchemaMigration(db, 9, "task_flow_step_positions", () => {
    migrateTaskFlowStepPositionColumn(db);
  });

  const upsertProviderAccount = db.prepare(`
    INSERT INTO provider_accounts (
      provider_kind, display_name, email, account_id, status, metadata_json, created_at, updated_at
    ) VALUES (
      @provider_kind, @display_name, @email, @account_id, @status, @metadata_json, @created_at, @updated_at
    )
    ON CONFLICT(provider_kind) DO UPDATE SET
      display_name = excluded.display_name,
      email = excluded.email,
      account_id = excluded.account_id,
      status = excluded.status,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at;
  `);

  const upsertProviderSecret = db.prepare(`
    INSERT INTO provider_secrets (
      provider_kind, encrypted_blob, created_at, updated_at
    ) VALUES (
      @provider_kind, @encrypted_blob, @created_at, @updated_at
    )
    ON CONFLICT(provider_kind) DO UPDATE SET
      encrypted_blob = excluded.encrypted_blob,
      updated_at = excluded.updated_at;
  `);

  const upsertAgentStmt = db.prepare(`
    INSERT INTO agents (
      id, name, description, default_provider_kind, default_model, default_reasoning_level, created_at, updated_at
    ) VALUES (
      @id, @name, @description, @default_provider_kind, @default_model, @default_reasoning_level, @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      default_provider_kind = excluded.default_provider_kind,
      default_model = excluded.default_model,
      default_reasoning_level = excluded.default_reasoning_level,
      updated_at = excluded.updated_at;
  `);

  const saveConversationStmt = db.prepare(`
    INSERT INTO conversations (
      id, agent_id, channel_kind, session_kind, parent_conversation_id, owner_run_id, title, provider_kind, model, reasoning_level, created_at, updated_at
    ) VALUES (
      @id, @agent_id, @channel_kind, @session_kind, @parent_conversation_id, @owner_run_id, @title, @provider_kind, @model, @reasoning_level, @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      agent_id = excluded.agent_id,
      channel_kind = excluded.channel_kind,
      session_kind = excluded.session_kind,
      parent_conversation_id = excluded.parent_conversation_id,
      owner_run_id = excluded.owner_run_id,
      title = excluded.title,
      provider_kind = excluded.provider_kind,
      model = excluded.model,
      reasoning_level = excluded.reasoning_level,
      updated_at = excluded.updated_at;
  `);

  const insertMessageStmt = db.prepare(`
    INSERT INTO messages (id, conversation_id, role, content, created_at)
    VALUES (@id, @conversation_id, @role, @content, @created_at);
  `);

  const touchConversationStmt = db.prepare(`
    UPDATE conversations SET updated_at = ? WHERE id = ?;
  `);

  const insertWorkspaceRunStmt = db.prepare(`
    INSERT INTO workspace_runs (
      id, conversation_id, task_id, parent_run_id, provider_kind, model, user_message, status, phase, checkpoint_json, resume_token, created_at, updated_at
    ) VALUES (
      @id, @conversation_id, @task_id, @parent_run_id, @provider_kind, @model, @user_message, @status, @phase, @checkpoint_json, @resume_token, @created_at, @updated_at
    );
  `);

  const updateWorkspaceRunStatusStmt = db.prepare(`
    UPDATE workspace_runs
    SET status = @status,
        phase = @phase,
        checkpoint_json = COALESCE(@checkpoint_json, checkpoint_json),
        resume_token = COALESCE(@resume_token, resume_token),
        updated_at = @updated_at
    WHERE id = @id AND status = 'running';
  `);

  const patchWorkspaceRunStmt = db.prepare(`
    UPDATE workspace_runs
    SET task_id = COALESCE(@task_id, task_id),
        parent_run_id = COALESCE(@parent_run_id, parent_run_id),
        phase = COALESCE(@phase, phase),
        checkpoint_json = COALESCE(@checkpoint_json, checkpoint_json),
        resume_token = COALESCE(@resume_token, resume_token),
        updated_at = @updated_at
    WHERE id = @id;
  `);

  const insertWorkspaceRunEventStmt = db.prepare(`
    INSERT INTO workspace_run_events (
      id, run_id, event_type, payload_json, created_at
    ) VALUES (
      @id, @run_id, @event_type, @payload_json, @created_at
    );
  `);

  const upsertComputerUseSettingsStmt = db.prepare(`
    INSERT INTO computer_use_settings (
      id, enabled, custom_browser_harness_enabled, allow_external_domains_json, allow_file_urls,
      max_actions_per_session, session_timeout_ms, updated_at
    ) VALUES (
      'default', @enabled, @custom_browser_harness_enabled, @allow_external_domains_json, @allow_file_urls,
      @max_actions_per_session, @session_timeout_ms, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      enabled = excluded.enabled,
      custom_browser_harness_enabled = excluded.custom_browser_harness_enabled,
      allow_external_domains_json = excluded.allow_external_domains_json,
      allow_file_urls = excluded.allow_file_urls,
      max_actions_per_session = excluded.max_actions_per_session,
      session_timeout_ms = excluded.session_timeout_ms,
      updated_at = excluded.updated_at;
  `);

  const insertComputerUseSessionStmt = db.prepare(`
    INSERT INTO computer_use_sessions (
      id, agent_id, conversation_id, run_id, task_id, status, current_url, allowed_domains_json,
      action_count, latest_screenshot_path, created_at, updated_at, closed_at
    ) VALUES (
      @id, @agent_id, @conversation_id, @run_id, @task_id, @status, @current_url, @allowed_domains_json,
      @action_count, @latest_screenshot_path, @created_at, @updated_at, @closed_at
    );
  `);

  const updateComputerUseSessionStmt = db.prepare(`
    UPDATE computer_use_sessions
    SET status = COALESCE(@status, status),
        current_url = COALESCE(@current_url, current_url),
        action_count = COALESCE(@action_count, action_count),
        latest_screenshot_path = COALESCE(@latest_screenshot_path, latest_screenshot_path),
        updated_at = @updated_at,
        closed_at = COALESCE(@closed_at, closed_at)
    WHERE id = @id;
  `);

  const insertComputerUseEventStmt = db.prepare(`
    INSERT INTO computer_use_events (
      id, session_id, action_type, status, current_url, target_url, summary, metadata_json, screenshot_path, created_at
    ) VALUES (
      @id, @session_id, @action_type, @status, @current_url, @target_url, @summary, @metadata_json, @screenshot_path, @created_at
    );
  `);

  const insertComputerUseApprovalStmt = db.prepare(`
    INSERT INTO computer_use_approvals (
      id, session_id, action_event_id, decision, reason, created_at
    ) VALUES (
      @id, @session_id, @action_event_id, @decision, @reason, @created_at
    );
  `);

  const insertTaskStmt = db.prepare(`
    INSERT INTO tasks (
      id, agent_id, conversation_id, task_kind, task_flow_id, flow_step_key, origin_run_id, parent_task_id, nesting_depth, title, prompt, provider_kind, model, reasoning_level,
      status, run_id, result_text, created_at, started_at, updated_at, completed_at, scheduled_for
    ) VALUES (
      @id, @agent_id, @conversation_id, @task_kind, @task_flow_id, @flow_step_key, @origin_run_id, @parent_task_id, @nesting_depth, @title, @prompt, @provider_kind, @model, @reasoning_level,
      @status, @run_id, @result_text, @created_at, @started_at, @updated_at, @completed_at, @scheduled_for
    );
  `);

  const updateTaskStateStmt = db.prepare(`
    UPDATE tasks
    SET status = @status,
        run_id = COALESCE(@run_id, run_id),
        result_text = COALESCE(@result_text, result_text),
        origin_run_id = COALESCE(@origin_run_id, origin_run_id),
        started_at = COALESCE(@started_at, started_at),
        updated_at = @updated_at,
        completed_at = @completed_at
    WHERE id = @id
      AND status IN ('queued', 'running');
  `);

  const insertTaskFlowStmt = db.prepare(`
    INSERT INTO task_flows (
      id, agent_id, conversation_id, origin_run_id, trigger_source, title, status, result_summary, error_text, created_at, updated_at, completed_at
    ) VALUES (
      @id, @agent_id, @conversation_id, @origin_run_id, @trigger_source, @title, @status, @result_summary, @error_text, @created_at, @updated_at, @completed_at
    );
  `);

  const updateTaskFlowStmt = db.prepare(`
    UPDATE task_flows
    SET title = COALESCE(@title, title),
        status = COALESCE(@status, status),
        result_summary = CASE
          WHEN @clear_result_summary = 1 THEN NULL
          ELSE COALESCE(@result_summary, result_summary)
        END,
        error_text = CASE
          WHEN @clear_error_text = 1 THEN NULL
          ELSE COALESCE(@error_text, error_text)
        END,
        updated_at = @updated_at,
        completed_at = CASE
          WHEN @clear_completed_at = 1 THEN NULL
          ELSE COALESCE(@completed_at, completed_at)
        END
    WHERE id = @id;
  `);

  const insertTaskFlowStepStmt = db.prepare(`
    INSERT INTO task_flow_steps (
      id, flow_id, task_id, step_key, dependency_step_key, position, title, prompt, status, created_at, updated_at, completed_at
    ) VALUES (
      @id, @flow_id, @task_id, @step_key, @dependency_step_key, @position, @title, @prompt, @status, @created_at, @updated_at, @completed_at
    );
  `);

  const updateTaskFlowStepStmt = db.prepare(`
    UPDATE task_flow_steps
    SET task_id = CASE
          WHEN @clear_task_id = 1 THEN NULL
          ELSE COALESCE(@task_id, task_id)
        END,
        status = COALESCE(@status, status),
        updated_at = @updated_at,
        completed_at = CASE
          WHEN @clear_completed_at = 1 THEN NULL
          ELSE COALESCE(@completed_at, completed_at)
        END
    WHERE id = @id;
  `);

  const deleteTaskFlowStepsStmt = db.prepare(`DELETE FROM task_flow_steps WHERE flow_id = ?`);
  const deleteTaskFlowStmt = db.prepare(`DELETE FROM task_flows WHERE id = ?`);

  const insertTaskEventStmt = db.prepare(`
    INSERT INTO task_events (id, task_id, event_type, payload_json, created_at)
    VALUES (@id, @task_id, @event_type, @payload_json, @created_at);
  `);

  const insertHeartbeatLogStmt = db.prepare(`
    INSERT INTO heartbeat_logs (
      id, agent_id, conversation_id, task_id, trigger_source, status, summary, error_text,
      triggered_at, started_at, completed_at, updated_at
    ) VALUES (
      @id, @agent_id, @conversation_id, @task_id, @trigger_source, @status, @summary, @error_text,
      @triggered_at, @started_at, @completed_at, @updated_at
    );
  `);

  const updateHeartbeatLogStmt = db.prepare(`
    UPDATE heartbeat_logs
    SET task_id = COALESCE(@task_id, task_id),
        status = COALESCE(@status, status),
        summary = COALESCE(@summary, summary),
        error_text = COALESCE(@error_text, error_text),
        started_at = COALESCE(@started_at, started_at),
        completed_at = COALESCE(@completed_at, completed_at),
        updated_at = @updated_at
    WHERE id = @id;
  `);

  const deleteMemoryIndexForAgentStmt = db.prepare(`
    DELETE FROM memory_index WHERE agent_id = ?;
  `);

  const insertMemoryIndexStmt = db.prepare(`
    INSERT INTO memory_index (agent_id, path, kind, line, reason, text)
    VALUES (@agent_id, @path, @kind, @line, @reason, @text);
  `);

  const appendMessageTx = db.transaction((input: {
    id: string;
    conversationId: string;
    role: MessageRecord["role"];
    content: string;
    createdAt: number;
  }) => {
    insertMessageStmt.run({
      id: input.id,
      conversation_id: input.conversationId,
      role: input.role,
      content: input.content,
      created_at: input.createdAt,
    });
    touchConversationStmt.run(input.createdAt, input.conversationId);
  });

  const appendRunEventTx = db.transaction((input: {
    id: string;
    runId: string;
    eventType: WorkspaceRunEventRecord["eventType"];
    payload: Record<string, unknown>;
    createdAt: number;
  }) => {
    insertWorkspaceRunEventStmt.run({
      id: input.id,
      run_id: input.runId,
      event_type: input.eventType,
      payload_json: JSON.stringify(input.payload),
      created_at: input.createdAt,
    });
    db.prepare(`UPDATE workspace_runs SET updated_at = ? WHERE id = ?`).run(input.createdAt, input.runId);
  });

  const finalizeRunTx = db.transaction((input: {
    runId: string;
    status: Exclude<WorkspaceRunStatus, "running">;
    eventType: WorkspaceRunEventRecord["eventType"];
    payload: Record<string, unknown>;
    timestamp: number;
  }) => {
    const result = updateWorkspaceRunStatusStmt.run({
      id: input.runId,
      status: input.status,
      phase: input.status,
      checkpoint_json: null,
      resume_token: null,
      updated_at: input.timestamp,
    });

    if (result.changes > 0) {
      insertWorkspaceRunEventStmt.run({
        id: crypto.randomUUID(),
        run_id: input.runId,
        event_type: input.eventType,
        payload_json: JSON.stringify(input.payload),
        created_at: input.timestamp,
      });
    }

    return result.changes > 0;
  });

  function mapConversation(row: ConversationRow): ConversationRecord {
    return {
      id: row.id,
      agentId: row.agent_id,
      channelKind: row.channel_kind,
      sessionKind: row.session_kind,
      parentConversationId: row.parent_conversation_id,
      ownerRunId: row.owner_run_id,
      title: row.title,
      providerKind: row.provider_kind,
      model: row.model,
      reasoningLevel: row.reasoning_level,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function mapAgent(row: AgentRow): AgentRecord {
    return {
      id: row.id,
      name: row.name,
      providerKind: row.default_provider_kind,
      model: row.default_model,
      reasoningLevel: row.default_reasoning_level,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function mapMessage(row: MessageRow): MessageRecord {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    };
  }

  function mapAccount(row: AccountRow): ProviderAccountRecord {
    return {
      providerKind: row.provider_kind,
      displayName: row.display_name,
      email: row.email,
      accountId: row.account_id,
      status: row.status,
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function mapWorkspaceRun(row: WorkspaceRunRow): WorkspaceRunRecord {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      taskId: row.task_id,
      parentRunId: row.parent_run_id,
      providerKind: row.provider_kind,
      model: row.model,
      userMessage: row.user_message,
      status: row.status,
      phase: row.phase,
      checkpoint: row.checkpoint_json ? (JSON.parse(row.checkpoint_json) as RunCheckpoint) : null,
      resumeToken: row.resume_token,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function mapWorkspaceRunEvent(row: WorkspaceRunEventRow): WorkspaceRunEventRecord {
    return {
      id: row.id,
      runId: row.run_id,
      eventType: row.event_type,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      createdAt: row.created_at,
    };
  }

  function mapTask(row: TaskRow): TaskRecord {
    return {
      id: row.id,
      agentId: row.agent_id,
      conversationId: row.conversation_id,
      taskKind: row.task_kind,
      taskFlowId: row.task_flow_id,
      flowStepKey: row.flow_step_key,
      originRunId: row.origin_run_id,
      parentTaskId: row.parent_task_id,
      nestingDepth: row.nesting_depth,
      title: row.title,
      prompt: row.prompt,
      providerKind: row.provider_kind,
      model: row.model,
      reasoningLevel: row.reasoning_level,
      status: row.status,
      runId: row.run_id,
      resultText: row.result_text,
      createdAt: row.created_at,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      scheduledFor: row.scheduled_for,
    };
  }

  function mapTaskEvent(row: TaskEventRow): TaskEventRecord {
    return {
      id: row.id,
      taskId: row.task_id,
      eventType: row.event_type,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      createdAt: row.created_at,
    };
  }

  function mapHeartbeatLog(row: HeartbeatLogRow): HeartbeatLogRecord {
    return {
      id: row.id,
      agentId: row.agent_id,
      conversationId: row.conversation_id,
      taskId: row.task_id,
      triggerSource: row.trigger_source,
      status: row.status,
      summary: row.summary,
      errorText: row.error_text,
      triggeredAt: row.triggered_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      updatedAt: row.updated_at,
    };
  }

  function mapTaskFlow(row: TaskFlowRow): TaskFlowRecord {
    return {
      id: row.id,
      agentId: row.agent_id,
      conversationId: row.conversation_id,
      originRunId: row.origin_run_id,
      triggerSource: row.trigger_source,
      title: row.title,
      status: row.status,
      resultSummary: row.result_summary,
      errorText: row.error_text,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    };
  }

  function mapTaskFlowStep(row: TaskFlowStepRow): TaskFlowStepRecord {
    return {
      id: row.id,
      flowId: row.flow_id,
      taskId: row.task_id,
      stepKey: row.step_key,
      dependencyStepKey: row.dependency_step_key,
      position: row.position,
      title: row.title,
      prompt: row.prompt,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    };
  }

  function defaultComputerUseSettings(): ComputerUseSettingsRecord {
    return {
      enabled: false,
      customBrowserHarnessEnabled: true,
      allowExternalDomains: [],
      allowFileUrls: false,
      maxActionsPerSession: 60,
      sessionTimeoutMs: 15 * 60_000,
      updatedAt: now(),
    };
  }

  function parseJsonArray(value: string) {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  }

  function mapComputerUseSettings(row: ComputerUseSettingsRow): ComputerUseSettingsRecord {
    return {
      enabled: Boolean(row.enabled),
      customBrowserHarnessEnabled: Boolean(row.custom_browser_harness_enabled),
      allowExternalDomains: parseJsonArray(row.allow_external_domains_json),
      allowFileUrls: Boolean(row.allow_file_urls),
      maxActionsPerSession: row.max_actions_per_session,
      sessionTimeoutMs: row.session_timeout_ms,
      updatedAt: row.updated_at,
    };
  }

  function mapComputerUseSession(row: ComputerUseSessionRow): ComputerUseSessionRecord {
    return {
      id: row.id,
      agentId: row.agent_id,
      conversationId: row.conversation_id,
      runId: row.run_id,
      taskId: row.task_id,
      status: row.status,
      currentUrl: row.current_url,
      allowedDomains: parseJsonArray(row.allowed_domains_json),
      actionCount: row.action_count,
      latestScreenshotPath: row.latest_screenshot_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at,
    };
  }

  function mapComputerUseEvent(row: ComputerUseEventRow): ComputerUseActionEventRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      actionType: row.action_type,
      status: row.status,
      currentUrl: row.current_url,
      targetUrl: row.target_url,
      summary: row.summary,
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
      screenshotPath: row.screenshot_path,
      createdAt: row.created_at,
    };
  }

  function mapComputerUseApproval(row: ComputerUseApprovalRow): ComputerUseApprovalRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      actionEventId: row.action_event_id,
      decision: row.decision,
      reason: row.reason,
      createdAt: row.created_at,
    };
  }

  const store = {
    dbPath,
    rawDb: db,

    getDefaultAgent(): AgentRecord {
      return store.getAgent(DEFAULT_AGENT_ID)!;
    },

    listAgents(): AgentRecord[] {
      const rows = db
        .prepare(
          `SELECT id, name, description, default_provider_kind, default_model, default_reasoning_level, created_at, updated_at
           FROM agents
           ORDER BY CASE WHEN id = '${DEFAULT_AGENT_ID}' THEN 0 ELSE 1 END, updated_at DESC`,
        )
        .all() as AgentRow[];
      return rows.map(mapAgent);
    },

    getAgent(id: string): AgentRecord | null {
      const row = db
        .prepare(
          `SELECT id, name, description, default_provider_kind, default_model, default_reasoning_level, created_at, updated_at
           FROM agents
           WHERE id = ?`,
        )
        .get(id) as AgentRow | undefined;
      return row ? mapAgent(row) : null;
    },

    saveAgent(input: {
      id?: string;
      name: string;
      providerKind: ProviderKind;
      model: string;
      reasoningLevel: ReasoningLevel;
    }): AgentRecord {
      const timestamp = now();
      const id = input.id ?? crypto.randomUUID();
      const existing = input.id ? store.getAgent(input.id) : null;
      upsertAgentStmt.run({
        id,
        name: input.name,
        description: null,
        default_provider_kind: input.providerKind,
        default_model: input.model,
        default_reasoning_level: input.reasoningLevel,
        created_at: existing?.createdAt ?? timestamp,
        updated_at: timestamp,
      });
      return store.getAgent(id)!;
    },

    deleteAgent(id: string) {
      if (id === DEFAULT_AGENT_ID) {
        throw new Error("The default agent cannot be deleted.");
      }
      const result = db.prepare(`DELETE FROM agents WHERE id = ?`).run(id);
      return result.changes > 0;
    },

    listConversations(
      agentId?: string,
      options?: {
        includeSubagents?: boolean;
        parentConversationId?: string | null;
        ownerRunId?: string | null;
        sessionKind?: SessionKind;
      },
    ): ConversationRecord[] {
      const conditions: string[] = [];
      const values: Array<string> = [];
      if (agentId) {
        conditions.push("agent_id = ?");
        values.push(agentId);
      }
      if (!options?.includeSubagents && !options?.parentConversationId && !options?.ownerRunId && !options?.sessionKind) {
        conditions.push("session_kind = 'primary'");
      }
      if (options?.parentConversationId !== undefined) {
        if (options.parentConversationId === null) {
          conditions.push("parent_conversation_id IS NULL");
        } else {
          conditions.push("parent_conversation_id = ?");
          values.push(options.parentConversationId);
        }
      }
      if (options?.ownerRunId !== undefined) {
        if (options.ownerRunId === null) {
          conditions.push("owner_run_id IS NULL");
        } else {
          conditions.push("owner_run_id = ?");
          values.push(options.ownerRunId);
        }
      }
      if (options?.sessionKind) {
        conditions.push("session_kind = ?");
        values.push(options.sessionKind);
      }
      const rows = db
        .prepare(
          `SELECT id, agent_id, channel_kind, session_kind, parent_conversation_id, owner_run_id, title, provider_kind, model, reasoning_level, created_at, updated_at
           FROM conversations
           ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
           ORDER BY updated_at DESC`,
        )
        .all(...values) as ConversationRow[];
      return rows.map(mapConversation);
    },

    getConversation(id: string): ConversationRecord | null {
      const row = db
        .prepare(
          `SELECT id, agent_id, channel_kind, session_kind, parent_conversation_id, owner_run_id, title, provider_kind, model, reasoning_level, created_at, updated_at
           FROM conversations
           WHERE id = ?`,
        )
        .get(id) as ConversationRow | undefined;
      return row ? mapConversation(row) : null;
    },

    saveConversation(input: {
      id?: string;
      agentId?: string;
      channelKind?: ConversationRecord["channelKind"];
      sessionKind?: SessionKind;
      parentConversationId?: string | null;
      ownerRunId?: string | null;
      title: string;
      providerKind: ProviderKind;
      model: string;
      reasoningLevel: ConversationRecord["reasoningLevel"];
    }): ConversationRecord {
      const timestamp = now();
      const id = input.id ?? crypto.randomUUID();
      const existing = input.id ? store.getConversation(input.id) : null;
      const agentId = input.agentId ?? existing?.agentId ?? DEFAULT_AGENT_ID;
      if (!store.getAgent(agentId)) {
        throw new Error("Agent not found.");
      }
      saveConversationStmt.run({
        id,
        agent_id: agentId,
        channel_kind: input.channelKind ?? existing?.channelKind ?? "webchat",
        session_kind: input.sessionKind ?? existing?.sessionKind ?? "primary",
        parent_conversation_id: input.parentConversationId ?? existing?.parentConversationId ?? null,
        owner_run_id: input.ownerRunId ?? existing?.ownerRunId ?? null,
        title: input.title,
        provider_kind: input.providerKind,
        model: input.model,
        reasoning_level: input.reasoningLevel,
        created_at: existing?.createdAt ?? timestamp,
        updated_at: timestamp,
      });
      return store.getConversation(id)!;
    },

    deleteConversation(id: string) {
      const result = db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
      return result.changes > 0;
    },

    listMessages(conversationId: string): MessageRecord[] {
      const rows = db
        .prepare(
          `SELECT id, conversation_id, role, content, created_at
           FROM messages
           WHERE conversation_id = ?
           ORDER BY created_at ASC`,
        )
        .all(conversationId) as MessageRow[];
      return rows.map(mapMessage);
    },

    appendMessage(input: {
      conversationId: string;
      role: MessageRecord["role"];
      content: string;
    }): MessageRecord {
      const id = crypto.randomUUID();
      const createdAt = now();
      appendMessageTx({
        id,
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        createdAt,
      });
      return {
        id,
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        createdAt,
      };
    },

    ensureConversationTitle(conversationId: string, fallbackText: string) {
      const conversation = store.getConversation(conversationId);
      const defaultConversationTitle = DEFAULT_CONVERSATION_TITLE;
      if (!conversation) {
        return;
      }
      if (conversation.title === DEFAULT_CONVERSATION_TITLE) {
        const nextTitle = fallbackText.trim().slice(0, 60) || DEFAULT_CONVERSATION_TITLE;
        store.saveConversation({
          id: conversationId,
          agentId: conversation.agentId,
          channelKind: conversation.channelKind,
          title: nextTitle,
          providerKind: conversation.providerKind,
          model: conversation.model,
          reasoningLevel: conversation.reasoningLevel,
        });
        return;
      }
      if (conversation.title === defaultConversationTitle) {
        const nextTitle = fallbackText.trim().slice(0, 60) || defaultConversationTitle;
        store.saveConversation({
          id: conversationId,
          agentId: conversation.agentId,
          channelKind: conversation.channelKind,
          title: nextTitle,
          providerKind: conversation.providerKind,
          model: conversation.model,
          reasoningLevel: conversation.reasoningLevel,
        });
        return;
      }
      if (!conversation || conversation.title !== DEFAULT_CONVERSATION_TITLE) {
        return;
      }
      const title = fallbackText.trim().slice(0, 60) || DEFAULT_CONVERSATION_TITLE;
      store.saveConversation({
        id: conversationId,
        agentId: conversation.agentId,
        channelKind: conversation.channelKind,
        title,
        providerKind: conversation.providerKind,
        model: conversation.model,
        reasoningLevel: conversation.reasoningLevel,
      });
    },

    createWorkspaceRun(input: {
      conversationId: string;
      taskId?: string | null;
      parentRunId?: string | null;
      providerKind: ProviderKind;
      model: string;
      userMessage: string;
      phase?: WorkspaceRunPhase;
      checkpoint?: RunCheckpoint | null;
      resumeToken?: string | null;
    }) {
      const id = crypto.randomUUID();
      const timestamp = now();
      db.transaction(() => {
        insertWorkspaceRunStmt.run({
          id,
          conversation_id: input.conversationId,
          task_id: input.taskId ?? null,
          parent_run_id: input.parentRunId ?? null,
          provider_kind: input.providerKind,
          model: input.model,
          user_message: input.userMessage,
          status: "running",
          phase: input.phase ?? "accepted",
          checkpoint_json: input.checkpoint ? JSON.stringify(input.checkpoint) : null,
          resume_token: input.resumeToken ?? null,
          created_at: timestamp,
          updated_at: timestamp,
        });
        insertWorkspaceRunEventStmt.run({
          id: crypto.randomUUID(),
          run_id: id,
          event_type: "status",
          payload_json: JSON.stringify({ message: "\uC791\uC5C5\uC744 \uC2DC\uC791\uD588\uC2B5\uB2C8\uB2E4." }),
          created_at: timestamp,
        });
      })();
      return store.getWorkspaceRun(id)!;
    },

    getWorkspaceRun(id: string): WorkspaceRunRecord | null {
      const row = db
        .prepare(
          `SELECT id, conversation_id, task_id, parent_run_id, provider_kind, model, user_message, status, phase, checkpoint_json, resume_token, created_at, updated_at
           FROM workspace_runs
           WHERE id = ?`,
        )
        .get(id) as WorkspaceRunRow | undefined;
      return row ? mapWorkspaceRun(row) : null;
    },

    getWorkspaceRunForConversation(conversationId: string, runId: string): WorkspaceRunRecord | null {
      const row = db
        .prepare(
          `SELECT id, conversation_id, task_id, parent_run_id, provider_kind, model, user_message, status, phase, checkpoint_json, resume_token, created_at, updated_at
           FROM workspace_runs
           WHERE conversation_id = ? AND id = ?`,
        )
        .get(conversationId, runId) as WorkspaceRunRow | undefined;
      return row ? mapWorkspaceRun(row) : null;
    },

    listWorkspaceRuns(conversationId: string) {
      const rows = db
        .prepare(
          `SELECT id, conversation_id, task_id, parent_run_id, provider_kind, model, user_message, status, phase, checkpoint_json, resume_token, created_at, updated_at
           FROM workspace_runs
           WHERE conversation_id = ?
           ORDER BY created_at DESC`,
        )
        .all(conversationId) as WorkspaceRunRow[];
      return rows.map(mapWorkspaceRun);
    },

    patchWorkspaceRun(input: {
      runId: string;
      taskId?: string | null;
      parentRunId?: string | null;
      phase?: WorkspaceRunPhase | null;
      checkpoint?: RunCheckpoint | null;
      resumeToken?: string | null;
    }) {
      patchWorkspaceRunStmt.run({
        id: input.runId,
        task_id: input.taskId ?? null,
        parent_run_id: input.parentRunId ?? null,
        phase: input.phase ?? null,
        checkpoint_json: input.checkpoint ? JSON.stringify(input.checkpoint) : null,
        resume_token: input.resumeToken ?? null,
        updated_at: now(),
      });
      return store.getWorkspaceRun(input.runId);
    },

    completeWorkspaceRun(id: string, status: WorkspaceRunStatus) {
      if (status === "running") {
        throw new Error("Cannot finalize a workspace run with running status.");
      }
      const eventType =
        status === "completed"
          ? "run_complete"
          : status === "cancelled"
            ? "run_cancelled"
            : "run_failed";
      store.finalizeWorkspaceRun(id, status, eventType, {});
      return store.getWorkspaceRun(id);
    },

    finalizeWorkspaceRun(
      id: string,
      status: Exclude<WorkspaceRunStatus, "running">,
      eventType: WorkspaceRunEventRecord["eventType"],
      payload: Record<string, unknown>,
    ) {
      const finalized = finalizeRunTx({
        runId: id,
        status,
        eventType,
        payload,
        timestamp: now(),
      });
      return {
        finalized,
        run: store.getWorkspaceRun(id),
      };
    },

    appendWorkspaceRunEvent(input: {
      runId: string;
      eventType: WorkspaceRunEventRecord["eventType"];
      payload: Record<string, unknown>;
    }) {
      const id = crypto.randomUUID();
      const createdAt = now();
      appendRunEventTx({
        id,
        runId: input.runId,
        eventType: input.eventType,
        payload: input.payload,
        createdAt,
      });
      return {
        id,
        runId: input.runId,
        eventType: input.eventType,
        payload: input.payload,
        createdAt,
      } satisfies WorkspaceRunEventRecord;
    },

    listWorkspaceRunEvents(conversationId: string, runId: string) {
      const rows = db
        .prepare(
          `SELECT events.id, events.run_id, events.event_type, events.payload_json, events.created_at
           FROM workspace_run_events events
           JOIN workspace_runs runs ON runs.id = events.run_id
           WHERE runs.conversation_id = ? AND events.run_id = ?
           ORDER BY events.created_at ASC`,
        )
        .all(conversationId, runId) as WorkspaceRunEventRow[];
      return rows.map(mapWorkspaceRunEvent);
    },

    getComputerUseSettings(): ComputerUseSettingsRecord {
      const row = db
        .prepare(
          `SELECT id, enabled, custom_browser_harness_enabled, allow_external_domains_json, allow_file_urls,
                  max_actions_per_session, session_timeout_ms, updated_at
           FROM computer_use_settings
           WHERE id = 'default'`,
        )
        .get() as ComputerUseSettingsRow | undefined;
      return row ? mapComputerUseSettings(row) : defaultComputerUseSettings();
    },

    saveComputerUseSettings(input: Partial<Omit<ComputerUseSettingsRecord, "updatedAt">>) {
      const current = store.getComputerUseSettings();
      const updated = {
        ...current,
        ...input,
        allowExternalDomains: input.allowExternalDomains ?? current.allowExternalDomains,
        updatedAt: now(),
      };
      upsertComputerUseSettingsStmt.run({
        enabled: updated.enabled ? 1 : 0,
        custom_browser_harness_enabled: updated.customBrowserHarnessEnabled ? 1 : 0,
        allow_external_domains_json: JSON.stringify(updated.allowExternalDomains),
        allow_file_urls: updated.allowFileUrls ? 1 : 0,
        max_actions_per_session: updated.maxActionsPerSession,
        session_timeout_ms: updated.sessionTimeoutMs,
        updated_at: updated.updatedAt,
      });
      return store.getComputerUseSettings();
    },

    createComputerUseSession(input: {
      agentId?: string | null;
      conversationId?: string | null;
      runId?: string | null;
      taskId?: string | null;
      allowedDomains?: string[];
    }) {
      const id = crypto.randomUUID();
      const timestamp = now();
      insertComputerUseSessionStmt.run({
        id,
        agent_id: input.agentId ?? null,
        conversation_id: input.conversationId ?? null,
        run_id: input.runId ?? null,
        task_id: input.taskId ?? null,
        status: "open",
        current_url: "about:blank",
        allowed_domains_json: JSON.stringify(input.allowedDomains ?? []),
        action_count: 0,
        latest_screenshot_path: null,
        created_at: timestamp,
        updated_at: timestamp,
        closed_at: null,
      });
      return store.getComputerUseSession(id)!;
    },

    getComputerUseSession(id: string): ComputerUseSessionRecord | null {
      const row = db
        .prepare(
          `SELECT id, agent_id, conversation_id, run_id, task_id, status, current_url, allowed_domains_json,
                  action_count, latest_screenshot_path, created_at, updated_at, closed_at
           FROM computer_use_sessions
           WHERE id = ?`,
        )
        .get(id) as ComputerUseSessionRow | undefined;
      return row ? mapComputerUseSession(row) : null;
    },

    updateComputerUseSession(input: {
      sessionId: string;
      status?: ComputerUseSessionRecord["status"];
      currentUrl?: string | null;
      actionCount?: number;
      latestScreenshotPath?: string | null;
      closedAt?: number | null;
    }) {
      updateComputerUseSessionStmt.run({
        id: input.sessionId,
        status: input.status ?? null,
        current_url: input.currentUrl ?? null,
        action_count: input.actionCount ?? null,
        latest_screenshot_path: input.latestScreenshotPath ?? null,
        updated_at: now(),
        closed_at: input.closedAt ?? null,
      });
      return store.getComputerUseSession(input.sessionId);
    },

    appendComputerUseEvent(input: {
      sessionId: string;
      actionType: ComputerUseActionType;
      status: ComputerUseEventStatus;
      currentUrl?: string | null;
      targetUrl?: string | null;
      summary: string;
      metadata?: Record<string, unknown>;
      screenshotPath?: string | null;
    }) {
      const id = crypto.randomUUID();
      const createdAt = now();
      insertComputerUseEventStmt.run({
        id,
        session_id: input.sessionId,
        action_type: input.actionType,
        status: input.status,
        current_url: input.currentUrl ?? null,
        target_url: input.targetUrl ?? null,
        summary: input.summary,
        metadata_json: JSON.stringify(input.metadata ?? {}),
        screenshot_path: input.screenshotPath ?? null,
        created_at: createdAt,
      });
      return {
        id,
        sessionId: input.sessionId,
        actionType: input.actionType,
        status: input.status,
        currentUrl: input.currentUrl ?? null,
        targetUrl: input.targetUrl ?? null,
        summary: input.summary,
        metadata: input.metadata ?? {},
        screenshotPath: input.screenshotPath ?? null,
        createdAt,
      } satisfies ComputerUseActionEventRecord;
    },

    listComputerUseEvents(sessionId: string): ComputerUseActionEventRecord[] {
      const rows = db
        .prepare(
          `SELECT id, session_id, action_type, status, current_url, target_url, summary, metadata_json, screenshot_path, created_at
           FROM computer_use_events
           WHERE session_id = ?
           ORDER BY created_at ASC`,
        )
        .all(sessionId) as ComputerUseEventRow[];
      return rows.map(mapComputerUseEvent);
    },

    recordComputerUseApproval(input: {
      sessionId: string;
      actionEventId?: string | null;
      decision: ComputerUseApprovalRecord["decision"];
      reason?: string | null;
    }) {
      const id = crypto.randomUUID();
      const createdAt = now();
      insertComputerUseApprovalStmt.run({
        id,
        session_id: input.sessionId,
        action_event_id: input.actionEventId ?? null,
        decision: input.decision,
        reason: input.reason ?? null,
        created_at: createdAt,
      });
      return {
        id,
        sessionId: input.sessionId,
        actionEventId: input.actionEventId ?? null,
        decision: input.decision,
        reason: input.reason ?? null,
        createdAt,
      } satisfies ComputerUseApprovalRecord;
    },

    listComputerUseApprovals(sessionId: string): ComputerUseApprovalRecord[] {
      const rows = db
        .prepare(
          `SELECT id, session_id, action_event_id, decision, reason, created_at
           FROM computer_use_approvals
           WHERE session_id = ?
           ORDER BY created_at ASC`,
        )
        .all(sessionId) as ComputerUseApprovalRow[];
      return rows.map(mapComputerUseApproval);
    },

    createTask(input: {
      agentId: string;
      conversationId: string;
      taskKind?: TaskKind;
      taskFlowId?: string | null;
      flowStepKey?: string | null;
      originRunId?: string | null;
      parentTaskId?: string | null;
      nestingDepth?: number;
      title: string;
      prompt: string;
      providerKind: ProviderKind;
      model: string;
      reasoningLevel: ReasoningLevel;
      scheduledFor?: number | null;
    }) {
      if (!store.getAgent(input.agentId)) {
        throw new Error("Agent not found.");
      }
      const conversation = store.getConversation(input.conversationId);
      if (!conversation || conversation.agentId !== input.agentId) {
        throw new Error("Session not found for agent.");
      }
      const parentTask = input.parentTaskId ? store.getTask(input.parentTaskId) : null;
      if (input.parentTaskId && !parentTask) {
        throw new Error("Parent task not found.");
      }
      const taskKind =
        input.taskKind ??
        (input.parentTaskId ? "continuation" : input.scheduledFor != null ? "scheduled" : "detached");
      const nestingDepth =
        input.nestingDepth ?? (parentTask ? parentTask.nestingDepth + 1 : input.parentTaskId ? 1 : 0);

      const id = crypto.randomUUID();
      const timestamp = now();
      db.transaction(() => {
        insertTaskStmt.run({
          id,
          agent_id: input.agentId,
          conversation_id: input.conversationId,
          task_kind: taskKind,
          task_flow_id: input.taskFlowId ?? null,
          flow_step_key: input.flowStepKey ?? null,
          origin_run_id: input.originRunId ?? null,
          parent_task_id: input.parentTaskId ?? null,
          nesting_depth: nestingDepth,
          title: input.title,
          prompt: input.prompt,
          provider_kind: input.providerKind,
          model: input.model,
          reasoning_level: input.reasoningLevel,
          status: "queued",
          run_id: null,
          result_text: null,
          created_at: timestamp,
          started_at: null,
          updated_at: timestamp,
          completed_at: null,
          scheduled_for: input.scheduledFor ?? null,
        });
        insertTaskEventStmt.run({
          id: crypto.randomUUID(),
          task_id: id,
          event_type: "queued",
          payload_json: JSON.stringify({ message: "\uD0DC\uC2A4\uD06C\uAC00 \uB300\uAE30\uC5F4\uC5D0 \uB4E4\uC5B4\uAC14\uC2B5\uB2C8\uB2E4." }),
          created_at: timestamp,
        });
      })();
      return store.getTask(id)!;
    },

    getTask(id: string): TaskRecord | null {
      const row = db
        .prepare(
          `SELECT id, agent_id, conversation_id, task_kind, task_flow_id, flow_step_key, origin_run_id, parent_task_id, nesting_depth, title, prompt, provider_kind, model, reasoning_level,
                  status, run_id, result_text, created_at, started_at, updated_at, completed_at, scheduled_for
           FROM tasks
           WHERE id = ?`,
        )
        .get(id) as TaskRow | undefined;
      return row ? mapTask(row) : null;
    },

    getTaskForAgent(agentId: string, taskId: string): TaskRecord | null {
      const row = db
        .prepare(
          `SELECT id, agent_id, conversation_id, task_kind, task_flow_id, flow_step_key, origin_run_id, parent_task_id, nesting_depth, title, prompt, provider_kind, model, reasoning_level,
                  status, run_id, result_text, created_at, started_at, updated_at, completed_at, scheduled_for
           FROM tasks
           WHERE agent_id = ? AND id = ?`,
        )
        .get(agentId, taskId) as TaskRow | undefined;
      return row ? mapTask(row) : null;
    },

    listTasks(agentId: string): TaskRecord[] {
      const rows = db
        .prepare(
          `SELECT id, agent_id, conversation_id, task_kind, task_flow_id, flow_step_key, origin_run_id, parent_task_id, nesting_depth, title, prompt, provider_kind, model, reasoning_level,
                  status, run_id, result_text, created_at, started_at, updated_at, completed_at, scheduled_for
           FROM tasks
           WHERE agent_id = ?
           ORDER BY updated_at DESC`,
        )
        .all(agentId) as TaskRow[];
      return rows.map(mapTask);
    },

    listTasksForConversation(conversationId: string): TaskRecord[] {
      const rows = db
        .prepare(
          `SELECT id, agent_id, conversation_id, task_kind, task_flow_id, flow_step_key, origin_run_id, parent_task_id, nesting_depth, title, prompt, provider_kind, model, reasoning_level,
                  status, run_id, result_text, created_at, started_at, updated_at, completed_at, scheduled_for
           FROM tasks
           WHERE conversation_id = ?
           ORDER BY updated_at DESC`,
        )
        .all(conversationId) as TaskRow[];
      return rows.map(mapTask);
    },

    transitionTask(input: {
      taskId: string;
      status: TaskStatus;
      eventType: TaskEventRecord["eventType"];
      payload?: Record<string, unknown>;
      runId?: string | null;
      resultText?: string | null;
    }) {
      const timestamp = now();
      const changed = db.transaction(() => {
        const result = updateTaskStateStmt.run({
          id: input.taskId,
          status: input.status,
          run_id: input.runId ?? null,
          result_text: input.resultText ?? null,
          origin_run_id: input.runId ?? null,
          started_at: input.status === "running" ? timestamp : null,
          updated_at: timestamp,
          completed_at:
            input.status === "completed" ||
            input.status === "failed" ||
            input.status === "timed_out" ||
            input.status === "cancelled"
              ? timestamp
              : null,
        });
        if (result.changes > 0) {
          insertTaskEventStmt.run({
            id: crypto.randomUUID(),
            task_id: input.taskId,
            event_type: input.eventType,
            payload_json: JSON.stringify(input.payload ?? {}),
            created_at: timestamp,
          });
        }
        return result.changes > 0;
      })();
      return {
        changed,
        task: store.getTask(input.taskId),
      };
    },

    appendTaskEvent(input: {
      taskId: string;
      eventType: TaskEventRecord["eventType"];
      payload: Record<string, unknown>;
    }) {
      const id = crypto.randomUUID();
      const createdAt = now();
      insertTaskEventStmt.run({
        id,
        task_id: input.taskId,
        event_type: input.eventType,
        payload_json: JSON.stringify(input.payload),
        created_at: createdAt,
      });
      return {
        id,
        taskId: input.taskId,
        eventType: input.eventType,
        payload: input.payload,
        createdAt,
      } satisfies TaskEventRecord;
    },

    listTaskEvents(agentId: string, taskId: string): TaskEventRecord[] {
      const rows = db
        .prepare(
          `SELECT events.id, events.task_id, events.event_type, events.payload_json, events.created_at
           FROM task_events events
           JOIN tasks ON tasks.id = events.task_id
           WHERE tasks.agent_id = ? AND events.task_id = ?
           ORDER BY events.created_at ASC`,
        )
        .all(agentId, taskId) as TaskEventRow[];
      return rows.map(mapTaskEvent);
    },

    createHeartbeatLog(input: {
      agentId: string;
      conversationId: string;
      triggerSource?: HeartbeatTriggerSource;
      taskId?: string | null;
      status?: HeartbeatLogRecord["status"];
      summary?: string | null;
      errorText?: string | null;
      startedAt?: number | null;
      completedAt?: number | null;
    }): HeartbeatLogRecord {
      const id = crypto.randomUUID();
      const timestamp = now();
      insertHeartbeatLogStmt.run({
        id,
        agent_id: input.agentId,
        conversation_id: input.conversationId,
        task_id: input.taskId ?? null,
        trigger_source: input.triggerSource ?? "manual",
        status: input.status ?? "queued",
        summary: input.summary ?? null,
        error_text: input.errorText ?? null,
        triggered_at: timestamp,
        started_at: input.startedAt ?? null,
        completed_at: input.completedAt ?? null,
        updated_at: timestamp,
      });
      const row = db
        .prepare(
          `SELECT id, agent_id, conversation_id, task_id, trigger_source, status, summary, error_text,
                  triggered_at, started_at, completed_at, updated_at
           FROM heartbeat_logs
           WHERE id = ?`,
        )
        .get(id) as HeartbeatLogRow | undefined;
      return row ? mapHeartbeatLog(row) : mapHeartbeatLog({
        id,
        agent_id: input.agentId,
        conversation_id: input.conversationId,
        task_id: input.taskId ?? null,
        trigger_source: input.triggerSource ?? "manual",
        status: input.status ?? "queued",
        summary: input.summary ?? null,
        error_text: input.errorText ?? null,
        triggered_at: timestamp,
        started_at: input.startedAt ?? null,
        completed_at: input.completedAt ?? null,
        updated_at: timestamp,
      });
    },

    transitionHeartbeatLog(input: {
      id: string;
      taskId?: string | null;
      status?: HeartbeatLogRecord["status"];
      summary?: string | null;
      errorText?: string | null;
      startedAt?: number | null;
      completedAt?: number | null;
    }) {
      const timestamp = now();
      const result = updateHeartbeatLogStmt.run({
        id: input.id,
        task_id: input.taskId ?? null,
        status: input.status ?? null,
        summary: input.summary ?? null,
        error_text: input.errorText ?? null,
        started_at: input.startedAt ?? null,
        completed_at: input.completedAt ?? null,
        updated_at: timestamp,
      });
      if (!result.changes) {
        return null;
      }
      const row = db
        .prepare(
          `SELECT id, agent_id, conversation_id, task_id, trigger_source, status, summary, error_text,
                  triggered_at, started_at, completed_at, updated_at
           FROM heartbeat_logs
           WHERE id = ?`,
        )
        .get(input.id) as HeartbeatLogRow | undefined;
      return row ? mapHeartbeatLog(row) : null;
    },

    listHeartbeatLogs(agentId: string) {
      const rows = db
        .prepare(
          `SELECT id, agent_id, conversation_id, task_id, trigger_source, status, summary, error_text,
                  triggered_at, started_at, completed_at, updated_at
           FROM heartbeat_logs
           WHERE agent_id = ?
           ORDER BY triggered_at DESC`,
        )
        .all(agentId) as HeartbeatLogRow[];
      return rows.map(mapHeartbeatLog);
    },

    getHeartbeatLog(agentId: string, logId: string) {
      const row = db
        .prepare(
          `SELECT id, agent_id, conversation_id, task_id, trigger_source, status, summary, error_text,
                  triggered_at, started_at, completed_at, updated_at
           FROM heartbeat_logs
           WHERE agent_id = ? AND id = ?`,
        )
        .get(agentId, logId) as HeartbeatLogRow | undefined;
      return row ? mapHeartbeatLog(row) : null;
    },

    createTaskFlow(input: {
      agentId: string;
      conversationId: string;
      title: string;
      triggerSource?: TaskFlowTriggerSource;
      originRunId?: string | null;
    }) {
      const id = crypto.randomUUID();
      const timestamp = now();
      insertTaskFlowStmt.run({
        id,
        agent_id: input.agentId,
        conversation_id: input.conversationId,
        origin_run_id: input.originRunId ?? null,
        trigger_source: input.triggerSource ?? "manual",
        title: input.title,
        status: "queued",
        result_summary: null,
        error_text: null,
        created_at: timestamp,
        updated_at: timestamp,
        completed_at: null,
      });
      return store.getTaskFlow(id)!;
    },

    getTaskFlow(flowId: string): TaskFlowRecord | null {
      const row = db
        .prepare(
          `SELECT id, agent_id, conversation_id, origin_run_id, trigger_source, title, status, result_summary, error_text, created_at, updated_at, completed_at
           FROM task_flows
           WHERE id = ?`,
        )
        .get(flowId) as TaskFlowRow | undefined;
      return row ? mapTaskFlow(row) : null;
    },

    listTaskFlows(agentId: string): TaskFlowRecord[] {
      const rows = db
        .prepare(
          `SELECT id, agent_id, conversation_id, origin_run_id, trigger_source, title, status, result_summary, error_text, created_at, updated_at, completed_at
           FROM task_flows
           WHERE agent_id = ?
           ORDER BY updated_at DESC`,
        )
        .all(agentId) as TaskFlowRow[];
      return rows.map(mapTaskFlow);
    },

    transitionTaskFlow(input: {
      flowId: string;
      title?: string;
      status?: TaskFlowStatus;
      resultSummary?: string | null;
      errorText?: string | null;
      completedAt?: number | null;
      clearResultSummary?: boolean;
      clearErrorText?: boolean;
      clearCompletedAt?: boolean;
    }) {
      updateTaskFlowStmt.run({
        id: input.flowId,
        title: input.title ?? null,
        status: input.status ?? null,
        result_summary: input.resultSummary ?? null,
        error_text: input.errorText ?? null,
        updated_at: now(),
        completed_at: input.completedAt ?? null,
        clear_result_summary: input.clearResultSummary ? 1 : 0,
        clear_error_text: input.clearErrorText ? 1 : 0,
        clear_completed_at: input.clearCompletedAt ? 1 : 0,
      });
      return store.getTaskFlow(input.flowId);
    },

    createTaskFlowStep(input: {
      flowId: string;
      stepKey: string;
      dependencyStepKey?: string | null;
      position?: number;
      title: string;
      prompt: string;
    }) {
      const id = crypto.randomUUID();
      const timestamp = now();
      const position =
        input.position ??
        ((db
          .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM task_flow_steps WHERE flow_id = ?`)
          .get(input.flowId) as { next_position: number } | undefined)?.next_position ?? 0);
      insertTaskFlowStepStmt.run({
        id,
        flow_id: input.flowId,
        task_id: null,
        step_key: input.stepKey,
        dependency_step_key: input.dependencyStepKey ?? null,
        position,
        title: input.title,
        prompt: input.prompt,
        status: "queued",
        created_at: timestamp,
        updated_at: timestamp,
        completed_at: null,
      });
      return store.getTaskFlowStep(id)!;
    },

    getTaskFlowStep(stepId: string): TaskFlowStepRecord | null {
      const row = db
        .prepare(
          `SELECT id, flow_id, task_id, step_key, dependency_step_key, position, title, prompt, status, created_at, updated_at, completed_at
           FROM task_flow_steps
           WHERE id = ?`,
        )
        .get(stepId) as TaskFlowStepRow | undefined;
      return row ? mapTaskFlowStep(row) : null;
    },

    listTaskFlowSteps(flowId: string): TaskFlowStepRecord[] {
      const rows = db
        .prepare(
          `SELECT id, flow_id, task_id, step_key, dependency_step_key, position, title, prompt, status, created_at, updated_at, completed_at
           FROM task_flow_steps
           WHERE flow_id = ?
           ORDER BY position ASC, created_at ASC`,
        )
        .all(flowId) as TaskFlowStepRow[];
      return rows.map(mapTaskFlowStep);
    },

    replaceTaskFlowSteps(
      flowId: string,
      steps: Array<{
        stepKey: string;
        dependencyStepKey?: string | null;
        position?: number;
        title: string;
        prompt: string;
      }>,
      title?: string,
    ): TaskFlowStepRecord[] {
      const timestamp = now();
      const tx = db.transaction(() => {
        deleteTaskFlowStepsStmt.run(flowId);
        steps.forEach((step, index) => {
          insertTaskFlowStepStmt.run({
            id: crypto.randomUUID(),
            flow_id: flowId,
            task_id: null,
            step_key: step.stepKey,
            dependency_step_key: step.dependencyStepKey ?? null,
            position: step.position ?? index,
            title: step.title,
            prompt: step.prompt,
            status: "queued",
            created_at: timestamp + index,
            updated_at: timestamp + index,
            completed_at: null,
          });
        });
      });
      tx();
      store.transitionTaskFlow({
        flowId,
        title,
        status: "queued",
        clearResultSummary: true,
        clearErrorText: true,
        clearCompletedAt: true,
      });
      return store.listTaskFlowSteps(flowId);
    },

    deleteTaskFlow(flowId: string) {
      const result = deleteTaskFlowStmt.run(flowId);
      return result.changes > 0;
    },

    transitionTaskFlowStep(input: {
      stepId: string;
      taskId?: string | null;
      status?: TaskFlowStepStatus;
      completedAt?: number | null;
      clearTaskId?: boolean;
      clearCompletedAt?: boolean;
    }) {
      updateTaskFlowStepStmt.run({
        id: input.stepId,
        task_id: input.taskId ?? null,
        status: input.status ?? null,
        updated_at: now(),
        completed_at: input.completedAt ?? null,
        clear_task_id: input.clearTaskId ? 1 : 0,
        clear_completed_at: input.clearCompletedAt ? 1 : 0,
      });
      return store.getTaskFlowStep(input.stepId);
    },

    replaceMemoryIndex(
      agentId: string,
      entries: Array<{
        path: string;
        kind: MemorySearchResult["kind"];
        line: number;
        reason: string;
        text: string;
      }>,
    ) {
      const tx = db.transaction(() => {
        deleteMemoryIndexForAgentStmt.run(agentId);
        for (const entry of entries) {
          insertMemoryIndexStmt.run({
            agent_id: agentId,
            path: entry.path,
            kind: entry.kind,
            line: entry.line,
            reason: entry.reason,
            text: entry.text,
          });
        }
      });
      tx();
      return entries.length;
    },

    searchMemoryIndex(agentId: string, query: string, maxResults = 8): MemorySearchResult[] {
      if (!query.trim()) {
        return [];
      }
      const tokens = query
        .toLowerCase()
        .split(/[\s,.;:!?()[\]{}"']+/)
        .filter((token) => token.length >= 2)
        .map((token) => `"${token.replace(/"/g, '""')}"`);
      if (!tokens.length) {
        return [];
      }
      const rows = db
        .prepare(
          `SELECT path, kind, line, reason, text, bm25(memory_index) AS score
           FROM memory_index
           WHERE memory_index MATCH ? AND agent_id = ?
           ORDER BY score
           LIMIT ?`,
        )
        .all(tokens.join(" OR "), agentId, maxResults) as Array<{
          path: string;
          kind: MemorySearchResult["kind"];
          line: number | string;
          reason: string;
          text: string;
          score: number;
        }>;
      return rows.map((row) => ({
        path: row.path,
        kind: row.kind,
        line: typeof row.line === "number" ? row.line : Number.parseInt(String(row.line), 10) || 1,
        reason: row.reason,
        text: row.text,
        score: typeof row.score === "number" ? row.score : 0,
      }));
    },

    getProviderAccount(kind: ProviderKind): ProviderAccountRecord | null {
      const row = db
        .prepare(
          `SELECT provider_kind, display_name, email, account_id, status, metadata_json, created_at, updated_at
           FROM provider_accounts
           WHERE provider_kind = ?`,
        )
        .get(kind) as AccountRow | undefined;
      return row ? mapAccount(row) : null;
    },

    getProviderSecret<K extends ProviderKind>(kind: K): ProviderSecret<K> | null {
      const row = db
        .prepare(
          `SELECT provider_kind, encrypted_blob
           FROM provider_secrets
           WHERE provider_kind = ?`,
        )
        .get(kind) as SecretRow | undefined;
      if (!row) {
        return null;
      }
      return secrets.decrypt<ProviderSecret<K>>(row.encrypted_blob);
    },

    saveProviderConfiguration<K extends ProviderKind>(params: {
      kind: K;
      status: ProviderAccountRecord["status"];
      displayName?: string | null;
      email?: string | null;
      accountId?: string | null;
      metadata?: Record<string, unknown>;
      secret: ProviderSecret<K>;
    }) {
      const timestamp = now();
      upsertProviderAccount.run({
        provider_kind: params.kind,
        display_name: params.displayName ?? null,
        email: params.email ?? null,
        account_id: params.accountId ?? null,
        status: params.status,
        metadata_json: JSON.stringify(params.metadata ?? {}),
        created_at: timestamp,
        updated_at: timestamp,
      });
      upsertProviderSecret.run({
        provider_kind: params.kind,
        encrypted_blob: secrets.encrypt(params.secret),
        created_at: timestamp,
        updated_at: timestamp,
      });
    },

    clearProvider(kind: ProviderKind) {
      db.prepare(`DELETE FROM provider_accounts WHERE provider_kind = ?`).run(kind);
      db.prepare(`DELETE FROM provider_secrets WHERE provider_kind = ?`).run(kind);
    },
  };

  return store;
}
