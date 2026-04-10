import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createSecretBox } from "./lib/crypto.js";
import type {
  AgentRecord,
  ConversationRecord,
  MessageRecord,
  ProviderAccountRecord,
  ProviderKind,
  ProviderSecret,
  ReasoningLevel,
  TaskEventRecord,
  TaskRecord,
  TaskStatus,
  WorkspaceRunEventRecord,
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
  provider_kind: ProviderKind;
  model: string;
  user_message: string;
  status: WorkspaceRunStatus;
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

type TaskEventRow = {
  id: string;
  task_id: string;
  event_type: TaskEventRecord["eventType"];
  payload_json: string;
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

export const DEFAULT_AGENT_ID = "default-agent";
export const DEFAULT_CONVERSATION_TITLE = "새 채팅";

function now() {
  return Date.now();
}

function createWorkspaceRunsSql(tableName: string) {
  return `
    CREATE TABLE ${tableName} (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      provider_kind TEXT NOT NULL,
      model TEXT NOT NULL,
      user_message TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;
}

function createWorkspaceRunEventsSql(tableName: string) {
  return `
    CREATE TABLE ${tableName} (
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
    db.exec(createWorkspaceRunsSql("workspace_runs_next"));
    db.exec(`
      INSERT INTO workspace_runs_next (
        id, conversation_id, provider_kind, model, user_message, status, created_at, updated_at
      )
      SELECT id, conversation_id, provider_kind, model, user_message, status, created_at, updated_at
      FROM workspace_runs;
    `);

    db.exec(createWorkspaceRunEventsSql("workspace_run_events_next"));
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

function ensureDefaultAgent(db: Database.Database) {
  const timestamp = now();
  db.prepare(`
    INSERT INTO agents (
      id, name, description, default_provider_kind, default_model, default_reasoning_level, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING;
  `).run(
    DEFAULT_AGENT_ID,
    "기본 에이전트",
    "Migrated local webchat agent.",
    "openai",
    "gpt-5.4",
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

  db.pragma("foreign_keys = OFF");
  try {
    db.exec("BEGIN");
    db.exec(createConversationsSql("conversations_next"));
    db.exec(`
      INSERT INTO conversations_next (
        id, agent_id, channel_kind, title, provider_kind, model, reasoning_level, created_at, updated_at
      )
      SELECT
        id,
        '${DEFAULT_AGENT_ID}',
        'webchat',
        title,
        provider_kind,
        model,
        COALESCE(reasoning_level, 'medium'),
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

export function createStore(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "chat.sqlite");
  const db = new Database(dbPath);
  const secrets = createSecretBox(dataDir);

  db.pragma("foreign_keys = ON");

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

    CREATE TABLE IF NOT EXISTS workspace_runs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      provider_kind TEXT NOT NULL,
      model TEXT NOT NULL,
      user_message TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES workspace_runs(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL CHECK(
        event_type IN ('status', 'tool_call', 'tool_result', 'error', 'run_complete', 'run_failed', 'run_cancelled')
      ),
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    ${createTasksSql("tasks")}

    ${createTaskEventsSql("task_events")}

    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  ensureDefaultAgent(db);
  migrateConversationSessionColumns(db);
  migrateWorkspaceTables(db);

  const conversationColumns = db
    .prepare(`PRAGMA table_info(conversations)`)
    .all() as Array<{ name: string }>;
  if (!conversationColumns.some((column) => column.name === "reasoning_level")) {
    db.exec(`ALTER TABLE conversations ADD COLUMN reasoning_level TEXT NOT NULL DEFAULT 'medium'`);
  }

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
      id, agent_id, channel_kind, title, provider_kind, model, reasoning_level, created_at, updated_at
    ) VALUES (
      @id, @agent_id, @channel_kind, @title, @provider_kind, @model, @reasoning_level, @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      agent_id = excluded.agent_id,
      channel_kind = excluded.channel_kind,
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
      id, conversation_id, provider_kind, model, user_message, status, created_at, updated_at
    ) VALUES (
      @id, @conversation_id, @provider_kind, @model, @user_message, @status, @created_at, @updated_at
    );
  `);

  const updateWorkspaceRunStatusStmt = db.prepare(`
    UPDATE workspace_runs
    SET status = @status,
        updated_at = @updated_at
    WHERE id = @id AND status = 'running';
  `);

  const insertWorkspaceRunEventStmt = db.prepare(`
    INSERT INTO workspace_run_events (
      id, run_id, event_type, payload_json, created_at
    ) VALUES (
      @id, @run_id, @event_type, @payload_json, @created_at
    );
  `);

  const insertTaskStmt = db.prepare(`
    INSERT INTO tasks (
      id, agent_id, conversation_id, title, prompt, provider_kind, model, reasoning_level,
      status, run_id, result_text, created_at, started_at, updated_at, completed_at, scheduled_for
    ) VALUES (
      @id, @agent_id, @conversation_id, @title, @prompt, @provider_kind, @model, @reasoning_level,
      @status, @run_id, @result_text, @created_at, @started_at, @updated_at, @completed_at, @scheduled_for
    );
  `);

  const updateTaskStateStmt = db.prepare(`
    UPDATE tasks
    SET status = @status,
        run_id = COALESCE(@run_id, run_id),
        result_text = COALESCE(@result_text, result_text),
        started_at = COALESCE(@started_at, started_at),
        updated_at = @updated_at,
        completed_at = @completed_at
    WHERE id = @id
      AND status IN ('queued', 'running');
  `);

  const insertTaskEventStmt = db.prepare(`
    INSERT INTO task_events (id, task_id, event_type, payload_json, created_at)
    VALUES (@id, @task_id, @event_type, @payload_json, @created_at);
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
      taskId: null,
      providerKind: row.provider_kind,
      model: row.model,
      userMessage: row.user_message,
      status: row.status,
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

    listConversations(agentId?: string): ConversationRecord[] {
      const rows = db
        .prepare(
          `SELECT id, agent_id, channel_kind, title, provider_kind, model, reasoning_level, created_at, updated_at
           FROM conversations
           ${agentId ? "WHERE agent_id = ?" : ""}
           ORDER BY updated_at DESC`,
        )
        .all(...(agentId ? [agentId] : [])) as ConversationRow[];
      return rows.map(mapConversation);
    },

    getConversation(id: string): ConversationRecord | null {
      const row = db
        .prepare(
          `SELECT id, agent_id, channel_kind, title, provider_kind, model, reasoning_level, created_at, updated_at
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
      const defaultConversationTitle = "새 채팅";
      if (!conversation) {
        return;
      }
      if (conversation.title === "새 채팅") {
        const nextTitle = fallbackText.trim().slice(0, 60) || "새 채팅";
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
      if (!conversation || conversation.title !== "새 채팅") {
        return;
      }
      const title = fallbackText.trim().slice(0, 60) || "새 채팅";
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
      providerKind: ProviderKind;
      model: string;
      userMessage: string;
    }) {
      const id = crypto.randomUUID();
      const timestamp = now();
      db.transaction(() => {
        insertWorkspaceRunStmt.run({
          id,
          conversation_id: input.conversationId,
          provider_kind: input.providerKind,
          model: input.model,
          user_message: input.userMessage,
          status: "running",
          created_at: timestamp,
          updated_at: timestamp,
        });
        insertWorkspaceRunEventStmt.run({
          id: crypto.randomUUID(),
          run_id: id,
          event_type: "status",
          payload_json: JSON.stringify({ message: "작업을 시작했습니다." }),
          created_at: timestamp,
        });
      })();
      return store.getWorkspaceRun(id)!;
    },

    getWorkspaceRun(id: string): WorkspaceRunRecord | null {
      const row = db
        .prepare(
          `SELECT id, conversation_id, provider_kind, model, user_message, status, created_at, updated_at
           FROM workspace_runs
           WHERE id = ?`,
        )
        .get(id) as WorkspaceRunRow | undefined;
      return row ? mapWorkspaceRun(row) : null;
    },

    getWorkspaceRunForConversation(conversationId: string, runId: string): WorkspaceRunRecord | null {
      const row = db
        .prepare(
          `SELECT id, conversation_id, provider_kind, model, user_message, status, created_at, updated_at
           FROM workspace_runs
           WHERE conversation_id = ? AND id = ?`,
        )
        .get(conversationId, runId) as WorkspaceRunRow | undefined;
      return row ? mapWorkspaceRun(row) : null;
    },

    listWorkspaceRuns(conversationId: string) {
      const rows = db
        .prepare(
          `SELECT id, conversation_id, provider_kind, model, user_message, status, created_at, updated_at
           FROM workspace_runs
           WHERE conversation_id = ?
           ORDER BY created_at DESC`,
        )
        .all(conversationId) as WorkspaceRunRow[];
      return rows.map(mapWorkspaceRun);
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

    createTask(input: {
      agentId: string;
      conversationId: string;
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

      const id = crypto.randomUUID();
      const timestamp = now();
      db.transaction(() => {
        insertTaskStmt.run({
          id,
          agent_id: input.agentId,
          conversation_id: input.conversationId,
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
          payload_json: JSON.stringify({ message: "Task queued." }),
          created_at: timestamp,
        });
      })();
      return store.getTask(id)!;
    },

    getTask(id: string): TaskRecord | null {
      const row = db
        .prepare(
          `SELECT id, agent_id, conversation_id, title, prompt, provider_kind, model, reasoning_level,
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
          `SELECT id, agent_id, conversation_id, title, prompt, provider_kind, model, reasoning_level,
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
          `SELECT id, agent_id, conversation_id, title, prompt, provider_kind, model, reasoning_level,
                  status, run_id, result_text, created_at, started_at, updated_at, completed_at, scheduled_for
           FROM tasks
           WHERE agent_id = ?
           ORDER BY updated_at DESC`,
        )
        .all(agentId) as TaskRow[];
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
