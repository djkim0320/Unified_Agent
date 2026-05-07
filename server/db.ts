import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createSecretBox } from "./lib/crypto.js";
import { buildFlowReportArtifact, buildRunReportArtifact } from "./lib/run-report.js";
import {
  configureDatabaseConnection,
  ensureSchemaMigrationsTable,
  now,
  parseEventRetentionLimit,
  recordSchemaMigration,
  runSchemaMigration,
} from "./db/migrations.js";
import {
  createArtifactsSql,
  createArtifactVersionsSql,
  createAutomationRulesSql,
  createConversationsSql,
  createHeartbeatLogsSql,
  createSessionSummariesSql,
  createTaskEventsSql,
  createTaskFlowsSql,
  createTaskFlowStepsSql,
  createTasksSql,
  createSkillTemplatesSql,
  createWorkspaceRunEventsSql,
  createWorkspaceRunsSql,
} from "./db/schema.js";
import {
  mapAccount,
  mapAgent,
  mapArtifact,
  mapArtifactVersion,
  mapAutomationRule,
  mapConversation,
  mapHeartbeatLog,
  mapMessage,
  mapSessionSummary,
  mapSkillTemplate,
  mapTask,
  mapTaskEvent,
  mapTaskFlow,
  mapTaskFlowStep,
  mapWorkspaceRun,
  mapWorkspaceRunEvent,
  type AccountRow,
  type AgentRow,
  type ArtifactRow,
  type ArtifactVersionRow,
  type AutomationRuleRow,
  type ConversationRow,
  type HeartbeatLogRow,
  type MessageRow,
  type SecretRow,
  type SessionSummaryRow,
  type SkillTemplateRow,
  type TaskEventRow,
  type TaskFlowRow,
  type TaskFlowStepRow,
  type TaskRow,
  type WorkspaceRunEventRow,
  type WorkspaceRunRow,
} from "./db/mappers.js";
import type {
  AgentRecord,
  ArtifactKind,
  ArtifactRecord,
  ArtifactVersionRecord,
  AutomationRuleRecord,
  ConversationRecord,
  HeartbeatLogRecord,
  HeartbeatTriggerSource,
  MessageRecord,
  ProviderAccountRecord,
  ProviderKind,
  ProviderSecret,
  ReasoningLevel,
  RunCheckpoint,
  SessionKind,
  SessionSummaryRecord,
  SkillTemplateRecord,
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

export const DEFAULT_AGENT_ID = "default-agent";
export const DEFAULT_CONVERSATION_TITLE = "\uC0C8 \uCC44\uD305";

function tableSql(db: Database.Database, tableName: string) {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql: string } | undefined;
  return row?.sql ?? "";
}

function normalizeArtifactPath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/").trim();
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw new Error("Artifact path must be relative to the session workspace.");
  }
  return normalized;
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

function migrateAutomationRuleColumns(db: Database.Database) {
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
  const maxRunEventsPerRun = parseEventRetentionLimit("AETHEROPS_MAX_RUN_EVENTS_PER_RUN");
  const maxTaskEventsPerTask = parseEventRetentionLimit("AETHEROPS_MAX_TASK_EVENTS_PER_TASK");

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

    ${createSessionSummariesSql("session_summaries")}

    ${createArtifactsSql("artifacts")}

    ${createArtifactVersionsSql("artifact_versions")}

    ${createSkillTemplatesSql("skill_templates")}

    ${createHeartbeatLogsSql("heartbeat_logs")}

    ${createAutomationRulesSql("automation_rules")}
  `);
  recordSchemaMigration(db, 1, "base_schema");

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
  migrateTaskMetadataColumns(db);

  runSchemaMigration(db, 7, "conversation_reasoning_level", () => {
    const conversationColumns = db
      .prepare(`PRAGMA table_info(conversations)`)
      .all() as Array<{ name: string }>;
    if (!conversationColumns.some((column) => column.name === "reasoning_level")) {
      db.exec(`ALTER TABLE conversations ADD COLUMN reasoning_level TEXT NOT NULL DEFAULT 'medium'`);
    }
  });
  runSchemaMigration(db, 8, "computer_use_removed_from_product_path", () => {
    // Kept as a no-op migration marker so existing databases remain compatible
    // without creating legacy custom Computer Use tables for new installations.
  });
  runSchemaMigration(db, 9, "task_flow_step_positions", () => {
    migrateTaskFlowStepPositionColumn(db);
  });
  runSchemaMigration(db, 10, "automation_rules", () => {
    migrateAutomationRuleColumns(db);
  });
  runSchemaMigration(db, 11, "session_summaries_and_artifacts", () => {
    db.exec(`
      ${createSessionSummariesSql("session_summaries")}
      ${createArtifactsSql("artifacts")}
    `);
  });
  runSchemaMigration(db, 12, "artifact_versions_summary_metadata_and_skill_templates", () => {
    const summaryColumns = db
      .prepare(`PRAGMA table_info(session_summaries)`)
      .all() as Array<{ name: string }>;
    if (!summaryColumns.some((column) => column.name === "metadata_json")) {
      db.exec(`ALTER TABLE session_summaries ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'`);
    }
    db.exec(`
      ${createArtifactVersionsSql("artifact_versions")}
      ${createSkillTemplatesSql("skill_templates")}
    `);
  });
  const summaryColumns = db
    .prepare(`PRAGMA table_info(session_summaries)`)
    .all() as Array<{ name: string }>;
  if (!summaryColumns.some((column) => column.name === "metadata_json")) {
    db.exec(`ALTER TABLE session_summaries ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'`);
  }
  migrateAutomationRuleColumns(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS automation_rules_agent_due_idx
      ON automation_rules(agent_id, enabled, next_run_at);
    CREATE INDEX IF NOT EXISTS tasks_automation_rule_status_idx
      ON tasks(automation_rule_id, status);
    CREATE INDEX IF NOT EXISTS artifacts_conversation_run_idx
      ON artifacts(conversation_id, run_id, created_at);
    CREATE INDEX IF NOT EXISTS artifacts_run_path_idx
      ON artifacts(run_id, path);
    CREATE INDEX IF NOT EXISTS artifact_versions_artifact_idx
      ON artifact_versions(artifact_id, created_at);
    CREATE INDEX IF NOT EXISTS skill_templates_agent_scope_idx
      ON skill_templates(agent_id, scope, updated_at);
  `);

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

  const upsertSessionSummaryStmt = db.prepare(`
    INSERT INTO session_summaries (
      conversation_id, summary, decisions_json, open_questions_json, next_actions_json, metadata_json, created_at, updated_at
    ) VALUES (
      @conversation_id, @summary, @decisions_json, @open_questions_json, @next_actions_json, @metadata_json, @created_at, @updated_at
    )
    ON CONFLICT(conversation_id) DO UPDATE SET
      summary = excluded.summary,
      decisions_json = excluded.decisions_json,
      open_questions_json = excluded.open_questions_json,
      next_actions_json = excluded.next_actions_json,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at;
  `);

  const insertArtifactStmt = db.prepare(`
    INSERT INTO artifacts (
      id, agent_id, conversation_id, run_id, task_id, kind, title, path, summary, metadata_json, created_at, updated_at
    ) VALUES (
      @id, @agent_id, @conversation_id, @run_id, @task_id, @kind, @title, @path, @summary, @metadata_json, @created_at, @updated_at
    );
  `);

  const insertArtifactVersionStmt = db.prepare(`
    INSERT INTO artifact_versions (
      id, artifact_id, run_id, path, before_content, after_content, before_hash, after_hash,
      size_bytes, encoding, binary, truncated, created_at
    ) VALUES (
      @id, @artifact_id, @run_id, @path, @before_content, @after_content, @before_hash, @after_hash,
      @size_bytes, @encoding, @binary, @truncated, @created_at
    );
  `);

  const upsertSkillTemplateStmt = db.prepare(`
    INSERT INTO skill_templates (
      id, agent_id, scope, name, category, summary, description, standing_order_patch,
      flow_template_json, verification_checklist_json, heartbeat_instructions, suggested_prompt,
      tags_json, created_at, updated_at
    ) VALUES (
      @id, @agent_id, @scope, @name, @category, @summary, @description, @standing_order_patch,
      @flow_template_json, @verification_checklist_json, @heartbeat_instructions, @suggested_prompt,
      @tags_json, @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      agent_id = excluded.agent_id,
      scope = excluded.scope,
      name = excluded.name,
      category = excluded.category,
      summary = excluded.summary,
      description = excluded.description,
      standing_order_patch = excluded.standing_order_patch,
      flow_template_json = excluded.flow_template_json,
      verification_checklist_json = excluded.verification_checklist_json,
      heartbeat_instructions = excluded.heartbeat_instructions,
      suggested_prompt = excluded.suggested_prompt,
      tags_json = excluded.tags_json,
      updated_at = excluded.updated_at;
  `);

  const deleteRunFileArtifactsStmt = db.prepare(`
    DELETE FROM artifacts
    WHERE run_id = ? AND kind = 'file';
  `);

  const deleteRunReportArtifactsStmt = db.prepare(`
    DELETE FROM artifacts
    WHERE run_id = ? AND kind = 'report';
  `);

  const deleteFlowReportArtifactsStmt = db.prepare(`
    DELETE FROM artifacts
    WHERE kind = 'report' AND metadata_json LIKE ?;
  `);

  const insertTaskStmt = db.prepare(`
    INSERT INTO tasks (
      id, agent_id, conversation_id, task_kind, task_flow_id, flow_step_key, origin_run_id, automation_rule_id, parent_task_id, nesting_depth, title, prompt, provider_kind, model, reasoning_level,
      status, run_id, result_text, created_at, started_at, updated_at, completed_at, scheduled_for
    ) VALUES (
      @id, @agent_id, @conversation_id, @task_kind, @task_flow_id, @flow_step_key, @origin_run_id, @automation_rule_id, @parent_task_id, @nesting_depth, @title, @prompt, @provider_kind, @model, @reasoning_level,
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

  const pruneWorkspaceRunEventsStmt = db.prepare(`
    DELETE FROM workspace_run_events
    WHERE run_id = @run_id
      AND id IN (
        SELECT id
        FROM workspace_run_events
        WHERE run_id = @run_id
        ORDER BY created_at DESC, id DESC
        LIMIT -1 OFFSET @limit
      );
  `);

  const pruneTaskEventsStmt = db.prepare(`
    DELETE FROM task_events
    WHERE task_id = @task_id
      AND id IN (
        SELECT id
        FROM task_events
        WHERE task_id = @task_id
        ORDER BY created_at DESC, id DESC
        LIMIT -1 OFFSET @limit
      );
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

  const insertAutomationRuleStmt = db.prepare(`
    INSERT INTO automation_rules (
      id, agent_id, conversation_id, title, prompt, provider_kind, model, reasoning_level, enabled, interval_minutes,
      next_run_at, last_run_at, last_task_id, run_count, created_at, updated_at
    ) VALUES (
      @id, @agent_id, @conversation_id, @title, @prompt, @provider_kind, @model, @reasoning_level, @enabled, @interval_minutes,
      @next_run_at, @last_run_at, @last_task_id, @run_count, @created_at, @updated_at
    );
  `);

  const updateAutomationRuleStmt = db.prepare(`
    UPDATE automation_rules
    SET title = COALESCE(@title, title),
        prompt = COALESCE(@prompt, prompt),
        provider_kind = COALESCE(@provider_kind, provider_kind),
        model = COALESCE(@model, model),
        reasoning_level = COALESCE(@reasoning_level, reasoning_level),
        enabled = COALESCE(@enabled, enabled),
        interval_minutes = COALESCE(@interval_minutes, interval_minutes),
        next_run_at = COALESCE(@next_run_at, next_run_at),
        updated_at = @updated_at
    WHERE id = @id AND agent_id = @agent_id;
  `);

  const markAutomationRuleRunStmt = db.prepare(`
    UPDATE automation_rules
    SET last_run_at = @last_run_at,
        last_task_id = @last_task_id,
        next_run_at = @next_run_at,
        run_count = run_count + 1,
        updated_at = @updated_at
    WHERE id = @id;
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

  function pruneWorkspaceRunEvents(runId: string) {
    if (maxRunEventsPerRun == null) {
      return;
    }
    pruneWorkspaceRunEventsStmt.run({
      run_id: runId,
      limit: maxRunEventsPerRun,
    });
  }

  function pruneTaskEvents(taskId: string) {
    if (maxTaskEventsPerTask == null) {
      return;
    }
    pruneTaskEventsStmt.run({
      task_id: taskId,
      limit: maxTaskEventsPerTask,
    });
  }

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
    pruneWorkspaceRunEvents(input.runId);
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
      pruneWorkspaceRunEvents(input.runId);
    }

    return result.changes > 0;
  });

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
        pruneWorkspaceRunEvents(id);
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

    getLatestSuccessfulWorkspaceRun(): WorkspaceRunRecord | null {
      const row = db
        .prepare(
          `SELECT id, conversation_id, task_id, parent_run_id, provider_kind, model, user_message, status, phase, checkpoint_json, resume_token, created_at, updated_at
           FROM workspace_runs
           WHERE status = 'completed'
           ORDER BY updated_at DESC
           LIMIT 1`,
        )
        .get() as WorkspaceRunRow | undefined;
      return row ? mapWorkspaceRun(row) : null;
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
      if (finalized) {
        try {
          store.createRunReportArtifact(id);
        } catch (error) {
          store.appendWorkspaceRunEvent({
            runId: id,
            eventType: "error",
            payload: {
              phase: "report_generation_failed",
              error: error instanceof Error ? error.message : "Run report generation failed.",
            },
          });
        }
      }
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

    getSessionSummary(conversationId: string): SessionSummaryRecord | null {
      const row = db
        .prepare(
          `SELECT conversation_id, summary, decisions_json, open_questions_json, next_actions_json, metadata_json, created_at, updated_at
           FROM session_summaries
           WHERE conversation_id = ?`,
        )
        .get(conversationId) as SessionSummaryRow | undefined;
      return row ? mapSessionSummary(row) : null;
    },

    saveSessionSummary(input: {
      conversationId: string;
      summary: string;
      decisions?: string[];
      openQuestions?: string[];
      nextActions?: string[];
      metadata?: SessionSummaryRecord["metadata"];
    }): SessionSummaryRecord {
      if (!store.getConversation(input.conversationId)) {
        throw new Error("Conversation not found.");
      }
      const existing = store.getSessionSummary(input.conversationId);
      const timestamp = now();
      upsertSessionSummaryStmt.run({
        conversation_id: input.conversationId,
        summary: input.summary,
        decisions_json: JSON.stringify(input.decisions ?? []),
        open_questions_json: JSON.stringify(input.openQuestions ?? []),
        next_actions_json: JSON.stringify(input.nextActions ?? []),
        metadata_json: JSON.stringify(input.metadata ?? existing?.metadata ?? {}),
        created_at: existing?.createdAt ?? timestamp,
        updated_at: timestamp,
      });
      return store.getSessionSummary(input.conversationId)!;
    },

    createRunReportArtifact(runId: string): ArtifactRecord | null {
      const run = store.getWorkspaceRun(runId);
      if (!run || run.status === "running") {
        return null;
      }
      const conversation = store.getConversation(run.conversationId);
      if (!conversation) {
        return null;
      }
      const task = run.taskId ? store.getTask(run.taskId) : null;
      const events = store.listWorkspaceRunEvents(run.conversationId, run.id);
      const artifacts = store
        .listArtifactsForRun(run.conversationId, run.id)
        .filter((artifact) => artifact.kind !== "report");
      const report = buildRunReportArtifact({
        run,
        conversation,
        task,
        events,
        artifacts,
      });
      const id = crypto.randomUUID();
      const timestamp = now();
      db.transaction(() => {
        deleteRunReportArtifactsStmt.run(run.id);
        insertArtifactStmt.run({
          id,
          agent_id: conversation.agentId,
          conversation_id: run.conversationId,
          run_id: run.id,
          task_id: run.taskId,
          kind: "report" satisfies ArtifactKind,
          title: report.title,
          path: null,
          summary: report.summary,
          metadata_json: JSON.stringify(report.metadata),
          created_at: timestamp,
          updated_at: timestamp,
        });
      })();
      return store.getArtifact(id);
    },

    createFlowReportArtifact(flowId: string): ArtifactRecord | null {
      const flow = store.getTaskFlow(flowId);
      if (!flow || flow.status !== "completed") {
        return null;
      }
      const conversation = store.getConversation(flow.conversationId);
      if (!conversation) {
        return null;
      }
      const steps = store.listTaskFlowSteps(flow.id).map((step) => {
        const task = step.taskId ? store.getTask(step.taskId) : null;
        const run = task?.runId ? store.getWorkspaceRun(task.runId) : null;
        const events = run ? store.listWorkspaceRunEvents(run.conversationId, run.id) : [];
        const artifacts = run ? store.listArtifactsForRun(run.conversationId, run.id) : [];
        return {
          step,
          task,
          run,
          events,
          artifacts,
        };
      });
      const report = buildFlowReportArtifact({
        flow,
        conversation,
        steps,
      });
      const id = crypto.randomUUID();
      const timestamp = now();
      db.transaction(() => {
        deleteFlowReportArtifactsStmt.run(`%"flowId":"${flow.id}"%`);
        insertArtifactStmt.run({
          id,
          agent_id: flow.agentId,
          conversation_id: flow.conversationId,
          run_id: null,
          task_id: null,
          kind: "report" satisfies ArtifactKind,
          title: report.title,
          path: null,
          summary: report.summary,
          metadata_json: JSON.stringify(report.metadata),
          created_at: timestamp,
          updated_at: timestamp,
        });
      })();
      return store.getArtifact(id);
    },

    getLatestFlowReportArtifact(flowId: string): ArtifactRecord | null {
      const row = db
        .prepare(
          `SELECT id, agent_id, conversation_id, run_id, task_id, kind, title, path, summary, metadata_json, created_at, updated_at
           FROM artifacts
           WHERE kind = 'report' AND metadata_json LIKE ?
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(`%"flowId":"${flowId}"%`) as ArtifactRow | undefined;
      return row ? mapArtifact(row) : null;
    },

    createArtifactsForRun(input: {
      agentId: string;
      conversationId: string;
      runId: string;
      taskId?: string | null;
      changedFiles: string[];
      snapshots?: Array<{
        path: string;
        beforeContent?: string | null;
        afterContent?: string | null;
        beforeHash?: string | null;
        afterHash?: string | null;
        sizeBytes?: number | null;
        encoding?: string | null;
        binary?: boolean;
        truncated?: boolean;
      }>;
    }): ArtifactRecord[] {
      const run = store.getWorkspaceRunForConversation(input.conversationId, input.runId);
      if (!run) {
        throw new Error("Workspace run not found.");
      }
      const uniquePaths = [...new Set(input.changedFiles.map(normalizeArtifactPath))];
      const snapshotsByPath = new Map(
        (input.snapshots ?? []).map((snapshot) => [normalizeArtifactPath(snapshot.path), snapshot]),
      );
      const timestamp = now();
      db.transaction(() => {
        deleteRunFileArtifactsStmt.run(input.runId);
        for (const filePath of uniquePaths) {
          const artifactId = crypto.randomUUID();
          const snapshot = snapshotsByPath.get(filePath);
          insertArtifactStmt.run({
            id: artifactId,
            agent_id: input.agentId,
            conversation_id: input.conversationId,
            run_id: input.runId,
            task_id: input.taskId ?? run.taskId ?? null,
            kind: "file" satisfies ArtifactKind,
            title: path.basename(filePath),
            path: filePath,
            summary: `Changed file from opencode run ${input.runId}.`,
            metadata_json: JSON.stringify({
              source: "opencode.changedFiles",
              snapshot: snapshot
                ? {
                    available: true,
                    binary: Boolean(snapshot.binary),
                    truncated: Boolean(snapshot.truncated),
                    encoding: snapshot.encoding ?? null,
                  }
                : { available: false },
            }),
            created_at: timestamp,
            updated_at: timestamp,
          });
          if (snapshot) {
            insertArtifactVersionStmt.run({
              id: crypto.randomUUID(),
              artifact_id: artifactId,
              run_id: input.runId,
              path: filePath,
              before_content: snapshot.beforeContent ?? null,
              after_content: snapshot.afterContent ?? null,
              before_hash: snapshot.beforeHash ?? null,
              after_hash: snapshot.afterHash ?? null,
              size_bytes: snapshot.sizeBytes ?? null,
              encoding: snapshot.encoding ?? null,
              binary: snapshot.binary ? 1 : 0,
              truncated: snapshot.truncated ? 1 : 0,
              created_at: timestamp,
            });
          }
        }
      })();
      return store.listArtifactsForRun(input.conversationId, input.runId);
    },

    getArtifactVersion(artifactId: string): ArtifactVersionRecord | null {
      const row = db
        .prepare(
          `SELECT id, artifact_id, run_id, path, before_content, after_content, before_hash, after_hash,
                  size_bytes, encoding, binary, truncated, created_at
           FROM artifact_versions
           WHERE artifact_id = ?
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(artifactId) as ArtifactVersionRow | undefined;
      return row ? mapArtifactVersion(row) : null;
    },

    listArtifactsForRun(conversationId: string, runId: string): ArtifactRecord[] {
      const rows = db
        .prepare(
          `SELECT id, agent_id, conversation_id, run_id, task_id, kind, title, path, summary, metadata_json, created_at, updated_at
           FROM artifacts
           WHERE conversation_id = ? AND run_id = ?
           ORDER BY created_at ASC, title ASC`,
        )
        .all(conversationId, runId) as ArtifactRow[];
      return rows.map(mapArtifact);
    },

    getArtifact(artifactId: string): ArtifactRecord | null {
      const row = db
        .prepare(
          `SELECT id, agent_id, conversation_id, run_id, task_id, kind, title, path, summary, metadata_json, created_at, updated_at
           FROM artifacts
           WHERE id = ?`,
        )
        .get(artifactId) as ArtifactRow | undefined;
      return row ? mapArtifact(row) : null;
    },

    countArtifactsForRun(conversationId: string, runId: string): number {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM artifacts
           WHERE conversation_id = ? AND run_id = ?`,
        )
        .get(conversationId, runId) as { count: number };
      return row.count;
    },

    recoverStaleRunningWork() {
      const timestamp = now();
      const reason = "server_restart_recovery";
      const message = "Task was marked cancelled because the server restarted while it was running.";
      const runMessage = "Workspace run was marked cancelled because the server restarted while it was running.";
      const eventPayload = {
        reason,
        message,
      };
      const runPayload = {
        reason,
        message: runMessage,
      };
      const runningTasks = db
        .prepare(
          `SELECT id, agent_id, conversation_id, task_kind, task_flow_id, flow_step_key, origin_run_id, automation_rule_id, parent_task_id, nesting_depth, title, prompt, provider_kind, model, reasoning_level,
                  status, run_id, result_text, created_at, started_at, updated_at, completed_at, scheduled_for
           FROM tasks
           WHERE status = 'running'`,
        )
        .all() as TaskRow[];
      const runningRuns = db
        .prepare(
          `SELECT id, conversation_id, task_id, parent_run_id, provider_kind, model, user_message, status, phase, checkpoint_json, resume_token, created_at, updated_at
           FROM workspace_runs
           WHERE status = 'running'`,
        )
        .all() as WorkspaceRunRow[];
      const runningSteps = db
        .prepare(
          `SELECT id, flow_id, task_id, step_key, dependency_step_key, position, title, prompt, status, created_at, updated_at, completed_at
           FROM task_flow_steps
           WHERE status = 'running'`,
        )
        .all() as TaskFlowStepRow[];
      const runningFlows = db
        .prepare(
          `SELECT id, agent_id, conversation_id, origin_run_id, trigger_source, title, status, result_summary, error_text, created_at, updated_at, completed_at
           FROM task_flows
           WHERE status = 'running'`,
        )
        .all() as TaskFlowRow[];

      const recoverRunningTaskStmt = db.prepare(`
        UPDATE tasks
        SET status = 'cancelled',
            result_text = @result_text,
            updated_at = @timestamp,
            completed_at = @timestamp
        WHERE id = @id
          AND status = 'running';
      `);
      const updateHeartbeatForTaskStmt = db.prepare(`
        UPDATE heartbeat_logs
        SET status = 'cancelled',
            summary = 'Heartbeat task cancelled during server restart recovery.',
            error_text = @message,
            completed_at = @timestamp,
            updated_at = @timestamp
        WHERE task_id = @task_id
          AND status IN ('queued', 'running');
      `);
      const cancelFlowStepByTaskStmt = db.prepare(`
        UPDATE task_flow_steps
        SET status = 'cancelled',
            updated_at = @timestamp,
            completed_at = @timestamp
        WHERE flow_id = @flow_id
          AND step_key = @step_key
          AND status = 'running';
      `);
      const cancelRunningFlowStepStmt = db.prepare(`
        UPDATE task_flow_steps
        SET status = 'cancelled',
            updated_at = @timestamp,
            completed_at = @timestamp
        WHERE id = @id
          AND status = 'running';
      `);

      const result = db.transaction(() => {
        let recoveredTasks = 0;
        let recoveredRuns = 0;
        let recoveredSteps = 0;
        let recoveredFlows = 0;

        for (const task of runningTasks) {
          const update = recoverRunningTaskStmt.run({
            id: task.id,
            result_text: message,
            timestamp,
          });
          if (update.changes > 0) {
            recoveredTasks += 1;
            insertTaskEventStmt.run({
              id: crypto.randomUUID(),
              task_id: task.id,
              event_type: "cancelled",
              payload_json: JSON.stringify(eventPayload),
              created_at: timestamp,
            });
            pruneTaskEvents(task.id);
            updateHeartbeatForTaskStmt.run({
              task_id: task.id,
              message,
              timestamp,
            });
            if (task.task_flow_id && task.flow_step_key) {
              const stepUpdate = cancelFlowStepByTaskStmt.run({
                flow_id: task.task_flow_id,
                step_key: task.flow_step_key,
                timestamp,
              });
              recoveredSteps += stepUpdate.changes;
            }
          }
        }

        for (const run of runningRuns) {
          const update = updateWorkspaceRunStatusStmt.run({
            id: run.id,
            status: "cancelled",
            phase: "cancelled",
            checkpoint_json: null,
            resume_token: run.resume_token,
            updated_at: timestamp,
          });
          if (update.changes > 0) {
            recoveredRuns += 1;
            insertWorkspaceRunEventStmt.run({
              id: crypto.randomUUID(),
              run_id: run.id,
              event_type: "run_cancelled",
              payload_json: JSON.stringify(runPayload),
              created_at: timestamp,
            });
            pruneWorkspaceRunEvents(run.id);
          }
        }

        for (const step of runningSteps) {
          const update = cancelRunningFlowStepStmt.run({
            id: step.id,
            timestamp,
          });
          if (update.changes > 0) {
            recoveredSteps += 1;
          }
        }

        for (const flow of runningFlows) {
          const update = updateTaskFlowStmt.run({
            id: flow.id,
            title: null,
            status: "cancelled",
            result_summary: null,
            error_text: runMessage,
            updated_at: timestamp,
            completed_at: timestamp,
            clear_result_summary: 0,
            clear_error_text: 0,
            clear_completed_at: 0,
          });
          if (update.changes > 0) {
            recoveredFlows += 1;
          }
        }

        return {
          tasks: recoveredTasks,
          workspaceRuns: recoveredRuns,
          taskFlowSteps: recoveredSteps,
          taskFlows: recoveredFlows,
        };
      })();

      return result;
    },

    createTask(input: {
      agentId: string;
      conversationId: string;
      taskKind?: TaskKind;
      taskFlowId?: string | null;
      flowStepKey?: string | null;
      originRunId?: string | null;
      automationRuleId?: string | null;
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
          automation_rule_id: input.automationRuleId ?? null,
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
        pruneTaskEvents(id);
      })();
      return store.getTask(id)!;
    },

    getTask(id: string): TaskRecord | null {
      const row = db
        .prepare(
          `SELECT id, agent_id, conversation_id, task_kind, task_flow_id, flow_step_key, origin_run_id, automation_rule_id, parent_task_id, nesting_depth, title, prompt, provider_kind, model, reasoning_level,
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
          `SELECT id, agent_id, conversation_id, task_kind, task_flow_id, flow_step_key, origin_run_id, automation_rule_id, parent_task_id, nesting_depth, title, prompt, provider_kind, model, reasoning_level,
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
          `SELECT id, agent_id, conversation_id, task_kind, task_flow_id, flow_step_key, origin_run_id, automation_rule_id, parent_task_id, nesting_depth, title, prompt, provider_kind, model, reasoning_level,
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
          `SELECT id, agent_id, conversation_id, task_kind, task_flow_id, flow_step_key, origin_run_id, automation_rule_id, parent_task_id, nesting_depth, title, prompt, provider_kind, model, reasoning_level,
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
          pruneTaskEvents(input.taskId);
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
      pruneTaskEvents(input.taskId);
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

    createAutomationRule(input: {
      agentId: string;
      conversationId: string;
      title: string;
      prompt: string;
      providerKind: ProviderKind;
      model: string;
      reasoningLevel: ReasoningLevel;
      enabled?: boolean;
      intervalMinutes: number;
      nextRunAt?: number | null;
    }): AutomationRuleRecord {
      if (!store.getAgent(input.agentId)) {
        throw new Error("Agent not found.");
      }
      const conversation = store.getConversation(input.conversationId);
      if (!conversation || conversation.agentId !== input.agentId) {
        throw new Error("Session not found for agent.");
      }
      const id = crypto.randomUUID();
      const timestamp = now();
      insertAutomationRuleStmt.run({
        id,
        agent_id: input.agentId,
        conversation_id: input.conversationId,
        title: input.title,
        prompt: input.prompt,
        provider_kind: input.providerKind,
        model: input.model,
        reasoning_level: input.reasoningLevel,
        enabled: input.enabled === false ? 0 : 1,
        interval_minutes: input.intervalMinutes,
        next_run_at: input.nextRunAt ?? timestamp + input.intervalMinutes * 60_000,
        last_run_at: null,
        last_task_id: null,
        run_count: 0,
        created_at: timestamp,
        updated_at: timestamp,
      });
      return store.getAutomationRuleForAgent(input.agentId, id)!;
    },

    getAutomationRuleForAgent(agentId: string, ruleId: string): AutomationRuleRecord | null {
      const row = db
        .prepare(
          `SELECT id, agent_id, conversation_id, title, prompt, provider_kind, model, reasoning_level,
                  enabled, interval_minutes, next_run_at, last_run_at, last_task_id, run_count, created_at, updated_at
           FROM automation_rules
           WHERE agent_id = ? AND id = ?`,
        )
        .get(agentId, ruleId) as AutomationRuleRow | undefined;
      return row ? mapAutomationRule(row) : null;
    },

    getAutomationRule(ruleId: string): AutomationRuleRecord | null {
      const row = db
        .prepare(
          `SELECT id, agent_id, conversation_id, title, prompt, provider_kind, model, reasoning_level,
                  enabled, interval_minutes, next_run_at, last_run_at, last_task_id, run_count, created_at, updated_at
           FROM automation_rules
           WHERE id = ?`,
        )
        .get(ruleId) as AutomationRuleRow | undefined;
      return row ? mapAutomationRule(row) : null;
    },

    listAutomationRules(agentId: string): AutomationRuleRecord[] {
      const rows = db
        .prepare(
          `SELECT id, agent_id, conversation_id, title, prompt, provider_kind, model, reasoning_level,
                  enabled, interval_minutes, next_run_at, last_run_at, last_task_id, run_count, created_at, updated_at
           FROM automation_rules
           WHERE agent_id = ?
           ORDER BY enabled DESC, next_run_at ASC, updated_at DESC`,
        )
        .all(agentId) as AutomationRuleRow[];
      return rows.map(mapAutomationRule);
    },

    listDueAutomationRules(timestamp: number): AutomationRuleRecord[] {
      const rows = db
        .prepare(
          `SELECT id, agent_id, conversation_id, title, prompt, provider_kind, model, reasoning_level,
                  enabled, interval_minutes, next_run_at, last_run_at, last_task_id, run_count, created_at, updated_at
           FROM automation_rules
           WHERE enabled = 1 AND next_run_at <= ?
           ORDER BY next_run_at ASC
           LIMIT 25`,
        )
        .all(timestamp) as AutomationRuleRow[];
      return rows.map(mapAutomationRule);
    },

    updateAutomationRule(input: {
      agentId: string;
      ruleId: string;
      title?: string;
      prompt?: string;
      providerKind?: ProviderKind;
      model?: string;
      reasoningLevel?: ReasoningLevel;
      enabled?: boolean;
      intervalMinutes?: number;
      nextRunAt?: number;
    }): AutomationRuleRecord | null {
      updateAutomationRuleStmt.run({
        id: input.ruleId,
        agent_id: input.agentId,
        title: input.title ?? null,
        prompt: input.prompt ?? null,
        provider_kind: input.providerKind ?? null,
        model: input.model ?? null,
        reasoning_level: input.reasoningLevel ?? null,
        enabled: input.enabled === undefined ? null : input.enabled ? 1 : 0,
        interval_minutes: input.intervalMinutes ?? null,
        next_run_at: input.nextRunAt ?? null,
        updated_at: now(),
      });
      return store.getAutomationRuleForAgent(input.agentId, input.ruleId);
    },

    deleteAutomationRule(agentId: string, ruleId: string): boolean {
      const result = db
        .prepare(`DELETE FROM automation_rules WHERE agent_id = ? AND id = ?`)
        .run(agentId, ruleId);
      return result.changes > 0;
    },

    markAutomationRuleRun(input: {
      ruleId: string;
      taskId: string;
      runAt?: number;
      nextRunAt?: number;
    }): AutomationRuleRecord | null {
      const runAt = input.runAt ?? now();
      const rule = store.getAutomationRule(input.ruleId);
      if (!rule) {
        return null;
      }
      markAutomationRuleRunStmt.run({
        id: input.ruleId,
        last_run_at: runAt,
        last_task_id: input.taskId,
        next_run_at: input.nextRunAt ?? runAt + rule.intervalMinutes * 60_000,
        updated_at: runAt,
      });
      return store.getAutomationRule(input.ruleId);
    },

    enqueueAutomationRuleTask(ruleId: string, timestamp = now(), force = false) {
      const tx = db.transaction(() => {
        const rule = store.getAutomationRule(ruleId);
        if (!rule || (!force && (!rule.enabled || rule.nextRunAt > timestamp))) {
          return null;
        }
        const conversation = store.getConversation(rule.conversationId);
        if (!conversation || conversation.agentId !== rule.agentId) {
          return null;
        }
        const activeTask = db
          .prepare(
            `SELECT id, agent_id, conversation_id, task_kind, task_flow_id, flow_step_key, origin_run_id, automation_rule_id, parent_task_id, nesting_depth, title, prompt, provider_kind, model, reasoning_level,
                    status, run_id, result_text, created_at, started_at, updated_at, completed_at, scheduled_for
             FROM tasks
             WHERE automation_rule_id = ? AND status IN ('queued', 'running')
             ORDER BY created_at DESC
             LIMIT 1`,
          )
          .get(rule.id) as TaskRow | undefined;
        if (activeTask) {
          return {
            rule,
            task: mapTask(activeTask),
            enqueued: false,
          };
        }

        const taskId = crypto.randomUUID();
        const taskTitle = `[자동화] ${rule.title}`;
        const taskPrompt = [
          "[AetherOps 자동화 규칙]",
          `규칙: ${rule.title}`,
          `주기: ${rule.intervalMinutes}분`,
          `예약 시각: ${new Date(timestamp).toISOString()}`,
          "",
          rule.prompt,
        ].join("\n");

        insertTaskStmt.run({
          id: taskId,
          agent_id: rule.agentId,
          conversation_id: rule.conversationId,
          task_kind: "scheduled",
          task_flow_id: null,
          flow_step_key: null,
          origin_run_id: null,
          automation_rule_id: rule.id,
          parent_task_id: null,
          nesting_depth: 0,
          title: taskTitle,
          prompt: taskPrompt,
          provider_kind: rule.providerKind,
          model: rule.model,
          reasoning_level: rule.reasoningLevel,
          status: "queued",
          run_id: null,
          result_text: null,
          created_at: timestamp,
          started_at: null,
          updated_at: timestamp,
          completed_at: null,
          scheduled_for: timestamp,
        });
        insertTaskEventStmt.run({
          id: crypto.randomUUID(),
          task_id: taskId,
          event_type: "queued",
          payload_json: JSON.stringify({
            message: "자동화 규칙이 예약 작업을 만들었습니다.",
            automationRuleId: rule.id,
            automationTitle: rule.title,
          }),
          created_at: timestamp,
        });
        pruneTaskEvents(taskId);
        markAutomationRuleRunStmt.run({
          id: rule.id,
          last_run_at: timestamp,
          last_task_id: taskId,
          next_run_at: timestamp + rule.intervalMinutes * 60_000,
          updated_at: timestamp,
        });
        return {
          rule: store.getAutomationRule(rule.id)!,
          task: store.getTask(taskId)!,
          enqueued: true,
        };
      });
      return tx();
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
      if (input.status === "completed") {
        try {
          store.createFlowReportArtifact(input.flowId);
        } catch (error) {
          // Flow reports are observability artifacts. A report failure should not roll back
          // an already completed opencode-backed flow, but it should remain visible in logs.
          console.warn(
            "[aetherops] flow_report_generation_failed",
            error instanceof Error ? error.message : "Flow report generation failed.",
          );
        }
      }
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

    listCustomSkillTemplates(agentId?: string | null): SkillTemplateRecord[] {
      const rows = agentId
        ? (db
            .prepare(
              `SELECT id, agent_id, scope, name, category, summary, description, standing_order_patch,
                      flow_template_json, verification_checklist_json, heartbeat_instructions,
                      suggested_prompt, tags_json, created_at, updated_at
               FROM skill_templates
               WHERE scope = 'shared' OR agent_id = ?
               ORDER BY updated_at DESC, name ASC`,
            )
            .all(agentId) as SkillTemplateRow[])
        : (db
            .prepare(
              `SELECT id, agent_id, scope, name, category, summary, description, standing_order_patch,
                      flow_template_json, verification_checklist_json, heartbeat_instructions,
                      suggested_prompt, tags_json, created_at, updated_at
               FROM skill_templates
               ORDER BY updated_at DESC, name ASC`,
            )
            .all() as SkillTemplateRow[]);
      return rows.map(mapSkillTemplate);
    },

    getCustomSkillTemplate(agentId: string, templateId: string): SkillTemplateRecord | null {
      const row = db
        .prepare(
          `SELECT id, agent_id, scope, name, category, summary, description, standing_order_patch,
                  flow_template_json, verification_checklist_json, heartbeat_instructions,
                  suggested_prompt, tags_json, created_at, updated_at
           FROM skill_templates
           WHERE id = ?
             AND (scope = 'shared' OR agent_id = ?)
           LIMIT 1`,
        )
        .get(templateId, agentId) as SkillTemplateRow | undefined;
      return row ? mapSkillTemplate(row) : null;
    },

    saveCustomSkillTemplate(input: {
      id?: string;
      agentId: string | null;
      scope?: "agent" | "shared";
      name: string;
      category: string;
      summary: string;
      description: string;
      standingOrderPatch: string;
      flowTemplate: SkillTemplateRecord["flowTemplate"];
      verificationChecklist: string[];
      heartbeatInstructions: string;
      suggestedPrompt: string;
      tags?: string[];
    }): SkillTemplateRecord {
      if (input.agentId && !store.getAgent(input.agentId)) {
        throw new Error("Agent not found.");
      }
      const id = input.id ?? crypto.randomUUID();
      const existing = input.id ? store.getCustomSkillTemplate(input.agentId ?? DEFAULT_AGENT_ID, input.id) : null;
      const timestamp = now();
      upsertSkillTemplateStmt.run({
        id,
        agent_id: input.scope === "shared" ? null : input.agentId,
        scope: input.scope ?? "agent",
        name: input.name,
        category: input.category,
        summary: input.summary,
        description: input.description,
        standing_order_patch: input.standingOrderPatch,
        flow_template_json: JSON.stringify(input.flowTemplate),
        verification_checklist_json: JSON.stringify(input.verificationChecklist),
        heartbeat_instructions: input.heartbeatInstructions,
        suggested_prompt: input.suggestedPrompt,
        tags_json: JSON.stringify(input.tags ?? []),
        created_at: existing?.createdAt ?? timestamp,
        updated_at: timestamp,
      });
      const saved = store.getCustomSkillTemplate(input.agentId ?? DEFAULT_AGENT_ID, id);
      if (!saved) {
        throw new Error("Failed to save skill template.");
      }
      return saved;
    },

    deleteCustomSkillTemplate(agentId: string, templateId: string): boolean {
      const result = db
        .prepare(
          `DELETE FROM skill_templates
           WHERE id = ?
             AND (scope = 'shared' OR agent_id = ?)`,
        )
        .run(templateId, agentId);
      return result.changes > 0;
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
