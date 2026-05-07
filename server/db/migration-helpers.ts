import Database from "better-sqlite3";
const DEFAULT_AGENT_ID = "default-agent";

import {
  createArtifactVersionsSql,
  createAutomationRulesSql,
  createConversationsSql,
  createSkillTemplatesSql,
  createTaskFlowStepsSql,
  createTasksSql,
  createWorkspaceRunEventsSql,
  createWorkspaceRunsSql,
} from "./schema.js";

function tableSql(db: Database.Database, tableName: string) {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql: string } | undefined;
  return row?.sql ?? "";
}

export function migrateWorkspaceTables(db: Database.Database) {
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

export function migrateTaskMetadataColumns(db: Database.Database) {
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
          automation_rule_id, parent_task_id, nesting_depth, title, prompt, provider_kind, model, reasoning_level,
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
  if (!columnNames.has("automation_rule_id")) {
    statements.push(`ALTER TABLE tasks ADD COLUMN automation_rule_id TEXT`);
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

export function migrateConversationLineageColumns(db: Database.Database) {
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

export function migrateWorkspaceRunMetadataColumns(db: Database.Database) {
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

export function migrateConversationSessionColumns(db: Database.Database) {
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

export function migrateAutomationRuleColumns(db: Database.Database) {
  db.exec(createAutomationRulesSql("automation_rules"));
  const columns = db.prepare(`PRAGMA table_info(automation_rules)`).all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  const statements: string[] = [];
  if (!columnNames.has("provider_kind")) {
    statements.push(`ALTER TABLE automation_rules ADD COLUMN provider_kind TEXT NOT NULL DEFAULT 'openai'`);
  }
  if (!columnNames.has("model")) {
    statements.push(`ALTER TABLE automation_rules ADD COLUMN model TEXT NOT NULL DEFAULT 'gpt-5.4'`);
  }
  if (!columnNames.has("reasoning_level")) {
    statements.push(`ALTER TABLE automation_rules ADD COLUMN reasoning_level TEXT NOT NULL DEFAULT 'medium'`);
  }
  for (const statement of statements) {
    db.exec(statement);
  }
}

export function migrateTaskFlowStepPositionColumn(db: Database.Database) {
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

function tableColumnNames(db: Database.Database, tableName: string) {
  return new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
}

function addColumnIfMissing(db: Database.Database, tableName: string, columnName: string, definition: string) {
  const columns = tableColumnNames(db, tableName);
  if (!columns.has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function rebuildTaskFlowStepsIfStatusCheckIsStale(db: Database.Database) {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'task_flow_steps'`)
    .get() as { sql?: string } | undefined;
  if (!row?.sql || row.sql.includes("waiting_approval")) {
    return;
  }

  const legacyTableName = "task_flow_steps_operations_polish_old";
  const oldColumns = tableColumnNames(db, "task_flow_steps");
  const positionExpr = oldColumns.has("position") ? "position" : "0";
  const stepKindExpr = oldColumns.has("step_kind") ? "COALESCE(step_kind, 'task')" : "'task'";

  db.pragma("foreign_keys = OFF");
  try {
    const tx = db.transaction(() => {
      db.exec(`DROP TABLE IF EXISTS ${legacyTableName}`);
      db.exec(`ALTER TABLE task_flow_steps RENAME TO ${legacyTableName}`);
      db.exec(createTaskFlowStepsSql("task_flow_steps"));
      db.exec(`
        INSERT INTO task_flow_steps (
          id,
          flow_id,
          task_id,
          step_key,
          dependency_step_key,
          position,
          title,
          prompt,
          step_kind,
          status,
          created_at,
          updated_at,
          completed_at
        )
        SELECT
          id,
          flow_id,
          task_id,
          step_key,
          dependency_step_key,
          ${positionExpr},
          title,
          prompt,
          CASE
            WHEN ${stepKindExpr} IN ('task', 'approval_gate', 'verification_gate') THEN ${stepKindExpr}
            ELSE 'task'
          END,
          status,
          created_at,
          updated_at,
          completed_at
        FROM ${legacyTableName};
      `);
      db.exec(`DROP TABLE ${legacyTableName}`);
    });
    tx();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

export function migrateOperationsPolishColumns(db: Database.Database) {
  db.exec(`
    ${createArtifactVersionsSql("artifact_versions")}
    ${createSkillTemplatesSql("skill_templates")}
    ${createTaskFlowStepsSql("task_flow_steps")}
  `);
  addColumnIfMissing(db, "artifact_versions", "unsupported_encoding", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "artifact_versions", "metadata_json", "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing(db, "skill_templates", "metadata_json", "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing(db, "task_flow_steps", "step_kind", "TEXT NOT NULL DEFAULT 'task'");
  rebuildTaskFlowStepsIfStatusCheckIsStale(db);
}
