import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createSecretBox } from "./lib/crypto.js";
import { redactSensitiveText } from "./lib/redaction.js";
import { extractResearchSections, extractResearchSources } from "./lib/research/section-parser.js";
import { buildFlowReportArtifact, buildRunReportArtifact } from "./lib/run-report.js";
import { addTokenUsage, emptyTokenUsage, extractTokenUsage } from "./lib/token-usage.js";
import {
  migrateAutomationRuleColumns,
  migrateConversationLineageColumns,
  migrateConversationSessionColumns,
  migrateOperationsPolishColumns,
  migrateTaskFlowStepPositionColumn,
  migrateTaskMetadataColumns,
  migrateWorkspaceRunMetadataColumns,
  migrateWorkspaceTables,
} from "./db/migration-helpers.js";
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
  createProjectDocumentChunksSql,
  createProjectDocumentsSql,
  createResearchEvidenceSql,
  createResearchHypothesesSql,
  createResearchLoopsSql,
  createResearchProjectSessionsSql,
  createResearchProjectsSql,
  createResearchQuestionsSql,
  createResearchSourcesSql,
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
  mapProjectDocument,
  mapProjectDocumentChunk,
  mapResearchEvidence,
  mapResearchHypothesis,
  mapResearchLoop,
  mapResearchProject,
  mapResearchProjectSession,
  mapResearchQuestion,
  mapResearchSource,
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
  type ProjectDocumentChunkRow,
  type ProjectDocumentRow,
  type ResearchEvidenceRow,
  type ResearchHypothesisRow,
  type ResearchLoopRow,
  type ResearchProjectRow,
  type ResearchProjectSessionRow,
  type ResearchQuestionRow,
  type ResearchSourceRow,
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
  ProjectDocumentRecord,
  ProjectDocumentSourceType,
  ProjectRagQueryResult,
  ReasoningLevel,
  ResearchAutonomyBudget,
  ResearchEvidenceRecord,
  ResearchEvidenceSourceType,
  ResearchHypothesisRecord,
  ResearchHypothesisStatus,
  ResearchLoopRecord,
  ResearchLoopStatus,
  ResearchProjectRecord,
  ResearchProjectSessionRecord,
  ResearchProjectStatus,
  ResearchQuestionRecord,
  ResearchQuestionStatus,
  ResearchSafetyPolicy,
  ResearchSourceRecord,
  RunCheckpoint,
  SessionKind,
  SessionSummaryRecord,
  SkillTemplateRecord,
  TaskKind,
  TaskFlowRecord,
  TaskFlowStatus,
  TaskFlowStepKind,
  TaskFlowStepRecord,
  TaskFlowStepStatus,
  TaskFlowTriggerSource,
  TaskEventRecord,
  TaskRecord,
  TaskStatus,
  TokenUsageModelSummary,
  TokenUsageSummary,
  WorkspaceRunEventRecord,
  WorkspaceRunPhase,
  WorkspaceRunRecord,
  WorkspaceRunStatus,
} from "./types.js";

export const DEFAULT_AGENT_ID = "default-agent";
export const DEFAULT_CONVERSATION_TITLE = "\uC0C8 \uCC44\uD305";

export const DEFAULT_RESEARCH_AUTONOMY_BUDGET: ResearchAutonomyBudget = {
  maxLoopsPerDay: 3,
  maxConsecutiveLoops: 1,
  maxRuntimeMinutes: 60,
  maxTasksPerLoop: 7,
  requireApprovalForExternal: true,
  requireApprovalForFileWrites: true,
  requireApprovalForCommandExecution: true,
  allowMcpCategories: [],
  stopWhenConfidenceAbove: 0.85,
  stopWhenNoOpenQuestions: true,
};

export const DEFAULT_RESEARCH_SAFETY_POLICY: ResearchSafetyPolicy = {
  allowedDomains: [],
  blockedActions: ["purchase", "submit", "delete", "publish", "transfer"],
  approvalRequiredActions: ["external", "file_write", "command_execution", "mcp", "browser"],
  notes: "External, MCP, browser, file write, and command execution work requires an operator checkpoint by default.",
  workspaceMode: "session",
};

function tableSql(db: Database.Database, tableName: string) {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql: string } | undefined;
  return row?.sql ?? "";
}

function searchFtsAvailable(db: Database.Database) {
  return Boolean(tableSql(db, "aetherops_search_index"));
}

function ensureSearchTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_documents (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      agent_id TEXT,
      conversation_id TEXT,
      project_id TEXT,
      record_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      redacted_body TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(kind, record_id)
    );
    CREATE INDEX IF NOT EXISTS search_documents_scope_idx
      ON search_documents(agent_id, conversation_id, project_id, updated_at);
    CREATE INDEX IF NOT EXISTS search_documents_kind_idx
      ON search_documents(kind, updated_at);
  `);
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS aetherops_search_index USING fts5(
        kind UNINDEXED,
        agent_id UNINDEXED,
        conversation_id UNINDEXED,
        project_id UNINDEXED,
        record_id UNINDEXED,
        title,
        body,
        redacted_body,
        updated_at UNINDEXED
      );
    `);
  } catch {
    // Some SQLite builds do not include FTS5. The LIKE-backed search_documents table remains available.
  }
}

function projectRagFtsAvailable(db: Database.Database) {
  return Boolean(tableSql(db, "project_document_chunks_fts"));
}

function ensureProjectRagTables(db: Database.Database) {
  db.exec(`
    ${createProjectDocumentsSql("project_documents")}
    ${createProjectDocumentChunksSql("project_document_chunks")}
    CREATE INDEX IF NOT EXISTS project_documents_project_type_idx
      ON project_documents(project_id, source_type, updated_at);
    CREATE INDEX IF NOT EXISTS project_documents_project_updated_idx
      ON project_documents(project_id, updated_at);
    CREATE INDEX IF NOT EXISTS project_document_chunks_project_idx
      ON project_document_chunks(project_id, created_at);
    CREATE INDEX IF NOT EXISTS project_document_chunks_document_idx
      ON project_document_chunks(document_id, chunk_index);
  `);
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS project_document_chunks_fts USING fts5(
        project_id UNINDEXED,
        document_id UNINDEXED,
        chunk_id UNINDEXED,
        title,
        content,
        redacted_content
      );
    `);
  } catch {
    // SQLite builds without FTS5 still use the project_document_chunks LIKE fallback.
  }
}

function safeSearchId(kind: string, recordId: string) {
  return `${kind}:${recordId}`;
}

function buildFtsQuery(query: string) {
  const tokens = query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 8) ?? [];
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" ");
}

function searchSnippet(text: string, query: string) {
  const redacted = redactSensitiveText(text);
  const lower = redacted.toLowerCase();
  const index = lower.indexOf(query.toLowerCase());
  if (index < 0) {
    return redacted.slice(0, 240);
  }
  const start = Math.max(0, index - 80);
  const end = Math.min(redacted.length, index + query.length + 160);
  return `${start > 0 ? "..." : ""}${redacted.slice(start, end)}${end < redacted.length ? "..." : ""}`;
}

function clampScore(value: number | null | undefined, fallback = 0.5) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function estimateTokenHint(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function chunkProjectDocumentText(text: string, maxChunkChars = 1400, maxChunks = 24) {
  const normalized = redactSensitiveText(text)
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  const paragraphs = normalized.split(/\n{2,}/);
  let current = "";
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChunkChars) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      if (paragraph.length <= maxChunkChars) {
        current = paragraph;
      } else {
        for (let index = 0; index < paragraph.length && chunks.length < maxChunks; index += maxChunkChars) {
          chunks.push(paragraph.slice(index, index + maxChunkChars));
        }
        current = "";
      }
    }
    if (chunks.length >= maxChunks) break;
  }
  if (current && chunks.length < maxChunks) chunks.push(current);
  return chunks.slice(0, maxChunks);
}

function projectDocumentBody(input: {
  title: string;
  summary?: string | null;
  uri?: string | null;
  body: string;
}) {
  return [input.title, input.uri ?? "", input.summary ?? "", input.body].filter(Boolean).join("\n");
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

function mergeResearchBudget(value?: Partial<ResearchAutonomyBudget> | null): ResearchAutonomyBudget {
  return {
    ...DEFAULT_RESEARCH_AUTONOMY_BUDGET,
    ...(value ?? {}),
    allowMcpCategories: Array.isArray(value?.allowMcpCategories)
      ? value.allowMcpCategories.filter((item): item is string => typeof item === "string")
      : DEFAULT_RESEARCH_AUTONOMY_BUDGET.allowMcpCategories,
  };
}

function mergeResearchPolicy(value?: Partial<ResearchSafetyPolicy> | null): ResearchSafetyPolicy {
  return {
    ...DEFAULT_RESEARCH_SAFETY_POLICY,
    ...(value ?? {}),
    allowedDomains: Array.isArray(value?.allowedDomains)
      ? value.allowedDomains.filter((item): item is string => typeof item === "string")
      : DEFAULT_RESEARCH_SAFETY_POLICY.allowedDomains,
    blockedActions: Array.isArray(value?.blockedActions)
      ? value.blockedActions.filter((item): item is string => typeof item === "string")
      : DEFAULT_RESEARCH_SAFETY_POLICY.blockedActions,
    approvalRequiredActions: Array.isArray(value?.approvalRequiredActions)
      ? value.approvalRequiredActions.filter((item): item is string => typeof item === "string")
      : DEFAULT_RESEARCH_SAFETY_POLICY.approvalRequiredActions,
  };
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

    ${createResearchProjectsSql("research_projects")}

    ${createResearchProjectSessionsSql("research_project_sessions")}

    ${createResearchQuestionsSql("research_questions")}

    ${createResearchHypothesesSql("research_hypotheses")}

    ${createResearchEvidenceSql("research_evidence")}

    ${createResearchSourcesSql("research_sources")}

    ${createResearchLoopsSql("research_loops")}

    ${createProjectDocumentsSql("project_documents")}

    ${createProjectDocumentChunksSql("project_document_chunks")}

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
  runSchemaMigration(db, 13, "operations_polish_columns", () => {
    migrateOperationsPolishColumns(db);
  });
  migrateOperationsPolishColumns(db);
  runSchemaMigration(db, 14, "research_autonomy_tables", () => {
    db.exec(`
      ${createResearchProjectsSql("research_projects")}
      ${createResearchProjectSessionsSql("research_project_sessions")}
      ${createResearchQuestionsSql("research_questions")}
      ${createResearchHypothesesSql("research_hypotheses")}
      ${createResearchEvidenceSql("research_evidence")}
      ${createResearchSourcesSql("research_sources")}
      ${createResearchLoopsSql("research_loops")}
    `);
  });
  runSchemaMigration(db, 16, "research_sources", () => {
    db.exec(createResearchSourcesSql("research_sources"));
  });
  runSchemaMigration(db, 17, "research_project_sessions", () => {
    db.exec(createResearchProjectSessionsSql("research_project_sessions"));
    db.exec(`
      INSERT OR IGNORE INTO research_project_sessions (
        project_id, conversation_id, role, include_in_context, created_at, updated_at
      )
      SELECT id, conversation_id, 'primary', 1, created_at, updated_at
      FROM research_projects
      WHERE conversation_id IS NOT NULL
    `);
  });
  runSchemaMigration(db, 18, "project_rag_documents", () => {
    ensureProjectRagTables(db);
  });
  ensureProjectRagTables(db);
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
    CREATE INDEX IF NOT EXISTS research_projects_agent_status_idx
      ON research_projects(agent_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS research_project_sessions_conversation_idx
      ON research_project_sessions(conversation_id);
    CREATE INDEX IF NOT EXISTS research_project_sessions_project_context_idx
      ON research_project_sessions(project_id, include_in_context, updated_at);
    CREATE INDEX IF NOT EXISTS research_questions_project_status_idx
      ON research_questions(project_id, status, priority);
    CREATE INDEX IF NOT EXISTS research_hypotheses_project_status_idx
      ON research_hypotheses(project_id, status, confidence);
    CREATE INDEX IF NOT EXISTS research_evidence_project_idx
      ON research_evidence(project_id, created_at);
    CREATE INDEX IF NOT EXISTS research_sources_project_idx
      ON research_sources(project_id, updated_at);
    CREATE INDEX IF NOT EXISTS research_sources_evidence_idx
      ON research_sources(evidence_id, updated_at);
    CREATE INDEX IF NOT EXISTS research_loops_project_status_idx
      ON research_loops(project_id, status, updated_at);
  `);
  runSchemaMigration(db, 15, "search_documents_index", () => {
    ensureSearchTables(db);
  });
  ensureSearchTables(db);

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
      size_bytes, encoding, binary, truncated, unsupported_encoding, metadata_json, created_at
    ) VALUES (
      @id, @artifact_id, @run_id, @path, @before_content, @after_content, @before_hash, @after_hash,
      @size_bytes, @encoding, @binary, @truncated, @unsupported_encoding, @metadata_json, @created_at
    );
  `);

  const upsertSkillTemplateStmt = db.prepare(`
    INSERT INTO skill_templates (
      id, agent_id, scope, name, category, summary, description, standing_order_patch,
      flow_template_json, verification_checklist_json, heartbeat_instructions, suggested_prompt,
      tags_json, metadata_json, created_at, updated_at
    ) VALUES (
      @id, @agent_id, @scope, @name, @category, @summary, @description, @standing_order_patch,
      @flow_template_json, @verification_checklist_json, @heartbeat_instructions, @suggested_prompt,
      @tags_json, @metadata_json, @created_at, @updated_at
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
      metadata_json = excluded.metadata_json,
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
      id, flow_id, task_id, step_key, dependency_step_key, position, title, prompt, step_kind, status, created_at, updated_at, completed_at
    ) VALUES (
      @id, @flow_id, @task_id, @step_key, @dependency_step_key, @position, @title, @prompt, @step_kind, @status, @created_at, @updated_at, @completed_at
    );
  `);

  const updateTaskFlowStepStmt = db.prepare(`
    UPDATE task_flow_steps
    SET task_id = CASE
          WHEN @clear_task_id = 1 THEN NULL
          ELSE COALESCE(@task_id, task_id)
        END,
        step_kind = COALESCE(@step_kind, step_kind),
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

    getTokenUsageSummary(): TokenUsageSummary {
      const rows = db
        .prepare(
          `SELECT runs.id, runs.provider_kind, runs.model, runs.updated_at, events.payload_json
           FROM workspace_run_events events
           JOIN workspace_runs runs ON runs.id = events.run_id
           WHERE events.payload_json LIKE '%tokenUsage%'
              OR events.payload_json LIKE '%token_usage%'
              OR events.payload_json LIKE '%prompt_tokens%'
              OR events.payload_json LIKE '%completion_tokens%'
              OR events.payload_json LIKE '%input_tokens%'
              OR events.payload_json LIKE '%output_tokens%'
           ORDER BY events.created_at ASC`,
        )
        .all() as Array<{
          id: string;
          provider_kind: ProviderKind;
          model: string;
          updated_at: number;
          payload_json: string;
        }>;
      const usageByRun = new Map<
        string,
        {
          providerKind: ProviderKind;
          model: string;
          updatedAt: number;
          usage: ReturnType<typeof emptyTokenUsage>;
        }
      >();
      for (const row of rows) {
        try {
          const payload = JSON.parse(row.payload_json) as unknown;
          const usage =
            extractTokenUsage(payload) ??
            (typeof payload === "object" && payload !== null
              ? extractTokenUsage((payload as { engineRun?: { eventSummary?: unknown } }).engineRun?.eventSummary)
              : null);
          if (!usage || usage.totalTokens <= 0) {
            continue;
          }
          usageByRun.set(row.id, {
            providerKind: row.provider_kind,
            model: row.model,
            updatedAt: row.updated_at,
            usage,
          });
        } catch {
          // Ignore malformed historical payloads. Token usage is an observability
          // convenience and should not make settings unavailable.
        }
      }

      let total = emptyTokenUsage();
      let lastUpdatedAt: number | null = null;
      const modelMap = new Map<string, TokenUsageModelSummary>();
      for (const entry of usageByRun.values()) {
        total = addTokenUsage(total, entry.usage);
        lastUpdatedAt = Math.max(lastUpdatedAt ?? 0, entry.updatedAt);
        const key = `${entry.providerKind}:${entry.model}`;
        const current =
          modelMap.get(key) ??
          ({
            providerKind: entry.providerKind,
            model: entry.model,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 0,
            runsWithUsage: 0,
            lastUpdatedAt: null,
          } satisfies TokenUsageModelSummary);
        const next = addTokenUsage(current, entry.usage);
        modelMap.set(key, {
          ...current,
          ...next,
          runsWithUsage: current.runsWithUsage + 1,
          lastUpdatedAt: Math.max(current.lastUpdatedAt ?? 0, entry.updatedAt),
        });
      }

      return {
        ...total,
        runsWithUsage: usageByRun.size,
        lastUpdatedAt,
        byModel: [...modelMap.values()].sort((left, right) => right.totalTokens - left.totalTokens),
        source: "opencode-events",
        note: "opencode JSON 이벤트가 제공한 토큰 사용량만 집계합니다. 모델/버전에 따라 0으로 보일 수 있습니다.",
      };
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
      const summary = store.getSessionSummary(input.conversationId)!;
      const project = store.findResearchProjectForConversation(input.conversationId);
      if (project) {
        const conversation = store.getConversation(input.conversationId);
        store.upsertProjectDocument({
          projectId: project.id,
          sourceType: "session_summary",
          sourceRef: input.conversationId,
          title: `Session memory: ${conversation?.title ?? input.conversationId}`,
          summary: summary.summary,
          body: [
            summary.summary,
            summary.decisions.length ? `Decisions:\n${summary.decisions.join("\n")}` : "",
            summary.openQuestions.length ? `Open questions:\n${summary.openQuestions.join("\n")}` : "",
            summary.nextActions.length ? `Next actions:\n${summary.nextActions.join("\n")}` : "",
            JSON.stringify(summary.metadata ?? {}),
          ].filter(Boolean).join("\n\n"),
          reliability: 0.65,
          confidence: 0.65,
          metadata: { conversationId: input.conversationId, source: "session_summary" },
          updatedAt: summary.updatedAt,
        });
      }
      return summary;
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
      const artifact = store.getArtifact(id);
      const project = artifact ? store.findResearchProjectForConversation(artifact.conversationId) : null;
      if (artifact && project) {
        store.upsertProjectDocument({
          projectId: project.id,
          sourceType: "report",
          sourceRef: artifact.id,
          title: artifact.title,
          summary: artifact.summary,
          body: [artifact.title, artifact.summary ?? "", report.metadata.markdown].filter(Boolean).join("\n"),
          reliability: 0.7,
          confidence: 0.7,
          metadata: { runId: run.id, taskId: run.taskId, source: "run_report" },
          updatedAt: artifact.updatedAt,
        });
      }
      return artifact;
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
      const artifact = store.getArtifact(id);
      const project = artifact ? store.findResearchProjectForConversation(artifact.conversationId) : null;
      if (artifact && project) {
        store.upsertProjectDocument({
          projectId: project.id,
          sourceType: "report",
          sourceRef: artifact.id,
          title: artifact.title,
          summary: artifact.summary,
          body: [artifact.title, artifact.summary ?? "", report.metadata.markdown].filter(Boolean).join("\n"),
          reliability: 0.72,
          confidence: 0.72,
          metadata: { flowId: flow.id, source: "flow_report" },
          updatedAt: artifact.updatedAt,
        });
      }
      return artifact;
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
        unsupportedEncoding?: boolean;
        metadata?: Record<string, unknown>;
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
                    unsupportedEncoding: Boolean(snapshot.unsupportedEncoding),
                    encoding: snapshot.encoding ?? null,
                    metadata: snapshot.metadata ?? {},
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
              unsupported_encoding: snapshot.unsupportedEncoding ? 1 : 0,
              metadata_json: JSON.stringify(snapshot.metadata ?? {}),
              created_at: timestamp,
            });
          }
        }
      })();
      const artifacts = store.listArtifactsForRun(input.conversationId, input.runId);
      const project = store.findResearchProjectForConversation(input.conversationId);
      if (project) {
        for (const artifact of artifacts.filter((item) => item.kind === "file")) {
          const version = store.getArtifactVersion(artifact.id);
          store.upsertProjectDocument({
            projectId: project.id,
            sourceType: "artifact",
            sourceRef: artifact.id,
            title: artifact.title,
            summary: artifact.summary,
            uri: artifact.path,
            body: [
              artifact.title,
              artifact.path ?? "",
              artifact.summary ?? "",
              version?.afterContent ?? "",
            ].filter(Boolean).join("\n"),
            reliability: 0.55,
            confidence: 0.55,
            metadata: {
              runId: artifact.runId,
              taskId: artifact.taskId,
              path: artifact.path,
              binary: version?.binary ?? null,
              truncated: version?.truncated ?? null,
              unsupportedEncoding: version?.unsupportedEncoding ?? null,
            },
            updatedAt: artifact.updatedAt,
          });
        }
      }
      return artifacts;
    },

    getArtifactVersion(artifactId: string): ArtifactVersionRecord | null {
      const row = db
        .prepare(
          `SELECT id, artifact_id, run_id, path, before_content, after_content, before_hash, after_hash,
                  size_bytes, encoding, binary, truncated, unsupported_encoding, metadata_json, created_at
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

    getProjectDocument(documentId: string): ProjectDocumentRecord | null {
      const row = db
        .prepare(
          `SELECT id, project_id, source_type, source_ref, title, summary, uri, reliability, confidence,
                  metadata_json, created_at, updated_at
           FROM project_documents
           WHERE id = ?`,
        )
        .get(documentId) as ProjectDocumentRow | undefined;
      return row ? mapProjectDocument(row) : null;
    },

    listProjectDocuments(projectId: string): ProjectDocumentRecord[] {
      const rows = db
        .prepare(
          `SELECT id, project_id, source_type, source_ref, title, summary, uri, reliability, confidence,
                  metadata_json, created_at, updated_at
           FROM project_documents
           WHERE project_id = ?
           ORDER BY updated_at DESC, title ASC`,
        )
        .all(projectId) as ProjectDocumentRow[];
      return rows.map(mapProjectDocument);
    },

    upsertProjectDocument(input: {
      projectId: string;
      sourceType: ProjectDocumentSourceType;
      sourceRef: string;
      title: string;
      body: string;
      summary?: string | null;
      uri?: string | null;
      reliability?: number | null;
      confidence?: number | null;
      metadata?: Record<string, unknown>;
      updatedAt?: number;
    }): { document: ProjectDocumentRecord; chunkCount: number } {
      if (!store.getResearchProject(input.projectId)) {
        throw new Error("Research project not found.");
      }
      const timestamp = input.updatedAt ?? now();
      const existing = db
        .prepare(
          `SELECT id, project_id, source_type, source_ref, title, summary, uri, reliability, confidence,
                  metadata_json, created_at, updated_at
           FROM project_documents
           WHERE project_id = ? AND source_type = ? AND source_ref = ?`,
        )
        .get(input.projectId, input.sourceType, input.sourceRef) as ProjectDocumentRow | undefined;
      const documentId = existing?.id ?? crypto.randomUUID();
      const body = projectDocumentBody({
        title: input.title,
        summary: input.summary,
        uri: input.uri,
        body: input.body,
      });
      const chunks = chunkProjectDocumentText(body);
      const metadataJson = JSON.stringify(
        input.metadata ?? (existing ? (JSON.parse(existing.metadata_json) as Record<string, unknown>) : {}),
      );
      db.transaction(() => {
        db.prepare(
          `INSERT INTO project_documents (
            id, project_id, source_type, source_ref, title, summary, uri, reliability, confidence,
            metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(project_id, source_type, source_ref) DO UPDATE SET
            title = excluded.title,
            summary = excluded.summary,
            uri = excluded.uri,
            reliability = excluded.reliability,
            confidence = excluded.confidence,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at`,
        ).run(
          documentId,
          input.projectId,
          input.sourceType,
          input.sourceRef,
          redactSensitiveText(input.title),
          input.summary ? redactSensitiveText(input.summary) : null,
          input.uri ?? null,
          clampScore(input.reliability),
          clampScore(input.confidence),
          metadataJson,
          existing?.created_at ?? timestamp,
          timestamp,
        );
        db.prepare(`DELETE FROM project_document_chunks WHERE document_id = ?`).run(documentId);
        if (projectRagFtsAvailable(db)) {
          db.prepare(`DELETE FROM project_document_chunks_fts WHERE document_id = ?`).run(documentId);
        }
        for (const [index, chunk] of chunks.entries()) {
          const chunkId = crypto.randomUUID();
          const redactedContent = redactSensitiveText(chunk);
          db.prepare(
            `INSERT INTO project_document_chunks (
              id, document_id, project_id, chunk_index, content, redacted_content, token_hint, metadata_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            chunkId,
            documentId,
            input.projectId,
            index,
            chunk,
            redactedContent,
            estimateTokenHint(chunk),
            JSON.stringify({ sourceType: input.sourceType, sourceRef: input.sourceRef }),
            timestamp,
          );
          if (projectRagFtsAvailable(db)) {
            db.prepare(
              `INSERT INTO project_document_chunks_fts (
                project_id, document_id, chunk_id, title, content, redacted_content
              ) VALUES (?, ?, ?, ?, ?, ?)`,
            ).run(input.projectId, documentId, chunkId, redactSensitiveText(input.title), chunk, redactedContent);
          }
        }
      })();
      const document = store.getProjectDocument(documentId);
      if (!document) {
        throw new Error("Failed to upsert project document.");
      }
      return { document, chunkCount: chunks.length };
    },

    rebuildProjectRagIndex(projectId: string) {
      const startedAt = Date.now();
      const project = store.getResearchProject(projectId);
      if (!project) {
        throw new Error("Research project not found.");
      }
      db.transaction(() => {
        db.prepare(`DELETE FROM project_document_chunks WHERE project_id = ?`).run(projectId);
        db.prepare(`DELETE FROM project_documents WHERE project_id = ?`).run(projectId);
        if (projectRagFtsAvailable(db)) {
          db.prepare(`DELETE FROM project_document_chunks_fts WHERE project_id = ?`).run(projectId);
        }
      })();
      let documentCount = 0;
      let chunkCount = 0;
      const addDocument = (input: Parameters<typeof store.upsertProjectDocument>[0]) => {
        const result = store.upsertProjectDocument(input);
        documentCount += 1;
        chunkCount += result.chunkCount;
      };

      addDocument({
        projectId,
        sourceType: "project",
        sourceRef: project.id,
        title: project.title,
        summary: project.objective,
        body: [
          `Objective: ${project.objective}`,
          project.domain ? `Domain: ${project.domain}` : "",
          `Status: ${project.status}`,
          `Autonomy enabled: ${project.autonomyEnabled ? "yes" : "no"}`,
        ].filter(Boolean).join("\n"),
        reliability: 0.8,
        confidence: 0.8,
        metadata: { status: project.status, domain: project.domain },
        updatedAt: project.updatedAt,
      });

      const linkedConversationIds = new Set<string>();
      if (project.conversationId) linkedConversationIds.add(project.conversationId);
      for (const link of store.listResearchProjectSessions(projectId)) {
        linkedConversationIds.add(link.conversationId);
        const summary = store.getSessionSummary(link.conversationId);
        const conversation = store.getConversation(link.conversationId);
        if (summary) {
          addDocument({
            projectId,
            sourceType: "session_summary",
            sourceRef: link.conversationId,
            title: `Session memory: ${conversation?.title ?? link.conversationId}`,
            summary: summary.summary,
            body: [
              summary.summary,
              summary.decisions.length ? `Decisions:\n${summary.decisions.join("\n")}` : "",
              summary.openQuestions.length ? `Open questions:\n${summary.openQuestions.join("\n")}` : "",
              summary.nextActions.length ? `Next actions:\n${summary.nextActions.join("\n")}` : "",
              JSON.stringify(summary.metadata ?? {}),
            ].filter(Boolean).join("\n\n"),
            reliability: 0.65,
            confidence: 0.65,
            metadata: { conversationId: link.conversationId, role: link.role },
            updatedAt: summary.updatedAt,
          });
        }
      }

      for (const source of store.listResearchSources(projectId)) {
        addDocument({
          projectId,
          sourceType: "source",
          sourceRef: source.id,
          title: source.title,
          summary: source.summary,
          uri: source.url,
          body: [
            source.title,
            source.url ?? "",
            source.author ? `Author: ${source.author}` : "",
            source.institution ? `Institution: ${source.institution}` : "",
            source.publishedAt ? `Published: ${source.publishedAt}` : "",
            source.accessedAt ? `Accessed: ${source.accessedAt}` : "",
            source.summary,
            source.quote ? `Quote: ${source.quote}` : "",
            source.snapshot ? `Snapshot: ${source.snapshot}` : "",
            source.relatedClaim ? `Related claim: ${source.relatedClaim}` : "",
          ].filter(Boolean).join("\n"),
          reliability: source.reliability,
          confidence: source.reliability,
          metadata: { evidenceId: source.evidenceId, relatedClaim: source.relatedClaim },
          updatedAt: source.updatedAt,
        });
      }

      for (const evidence of store.listResearchEvidence(projectId)) {
        addDocument({
          projectId,
          sourceType: "evidence",
          sourceRef: evidence.id,
          title: evidence.claim.slice(0, 160),
          summary: evidence.summary,
          body: [
            `Claim: ${evidence.claim}`,
            `Summary: ${evidence.summary}`,
            evidence.uncertainty ? `Uncertainty: ${evidence.uncertainty}` : "",
          ].filter(Boolean).join("\n"),
          reliability: evidence.confidence,
          confidence: evidence.confidence,
          metadata: {
            questionId: evidence.questionId,
            hypothesisId: evidence.hypothesisId,
            sourceType: evidence.sourceType,
            sourceRef: evidence.sourceRef,
          },
          updatedAt: evidence.updatedAt,
        });
      }

      for (const loop of store.listResearchLoops(projectId)) {
        if (!loop.proposedFlowId) continue;
        const flow = store.getTaskFlow(loop.proposedFlowId);
        if (!flow) continue;
        const steps = store.listTaskFlowSteps(flow.id);
        addDocument({
          projectId,
          sourceType: "flow",
          sourceRef: flow.id,
          title: flow.title,
          summary: flow.resultSummary ?? flow.errorText,
          body: [
            flow.title,
            flow.resultSummary ?? "",
            flow.errorText ?? "",
            ...steps.map((step) => `${step.position + 1}. ${step.title}\n${step.prompt}`),
          ].filter(Boolean).join("\n\n"),
          reliability: flow.status === "completed" ? 0.7 : 0.45,
          confidence: flow.status === "completed" ? 0.7 : 0.45,
          metadata: { loopId: loop.id, status: flow.status },
          updatedAt: flow.updatedAt,
        });
      }

      for (const conversationId of linkedConversationIds) {
        const rows = db
          .prepare(
            `SELECT id, agent_id, conversation_id, run_id, task_id, kind, title, path, summary, metadata_json, created_at, updated_at
             FROM artifacts
             WHERE conversation_id = ?
             ORDER BY updated_at DESC
             LIMIT 100`,
          )
          .all(conversationId) as ArtifactRow[];
        for (const artifact of rows.map(mapArtifact)) {
          const markdown = typeof artifact.metadata.markdown === "string" ? artifact.metadata.markdown : "";
          addDocument({
            projectId,
            sourceType: artifact.kind === "report" ? "report" : "artifact",
            sourceRef: artifact.id,
            title: artifact.title,
            summary: artifact.summary,
            body: [artifact.title, artifact.summary ?? "", markdown, artifact.path ?? ""].filter(Boolean).join("\n"),
            reliability: artifact.kind === "report" ? 0.7 : 0.55,
            confidence: artifact.kind === "report" ? 0.7 : 0.55,
            metadata: { runId: artifact.runId, taskId: artifact.taskId, kind: artifact.kind, path: artifact.path },
            updatedAt: artifact.updatedAt,
          });
        }
      }

      return {
        projectId,
        documentCount,
        chunkCount,
        indexMode: projectRagFtsAvailable(db) ? "fts5" as const : "like" as const,
        durationMs: Date.now() - startedAt,
        embedding: {
          enabled: false as const,
          provider: "none" as const,
          reason: "Vector embeddings are intentionally disabled by default; SQLite FTS powers v1 project RAG.",
        },
      };
    },

    searchProjectRag(input: {
      projectId: string;
      q: string;
      limit?: number;
      offset?: number;
    }): { results: ProjectRagQueryResult[]; indexMode: "fts5" | "like" } {
      const project = store.getResearchProject(input.projectId);
      if (!project) {
        throw new Error("Research project not found.");
      }
      const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
      const offset = Math.max(input.offset ?? 0, 0);
      type RagSearchRow = {
        doc_id: string;
        doc_project_id: string;
        doc_source_type: ProjectDocumentSourceType;
        doc_source_ref: string;
        doc_title: string;
        doc_summary: string | null;
        doc_uri: string | null;
        doc_reliability: number;
        doc_confidence: number;
        doc_metadata_json: string;
        doc_created_at: number;
        doc_updated_at: number;
        chunk_id: string;
        chunk_document_id: string;
        chunk_project_id: string;
        chunk_index: number;
        chunk_content: string;
        chunk_redacted_content: string;
        chunk_token_hint: number;
        chunk_metadata_json: string;
        chunk_created_at: number;
        rank?: number;
      };
      const rowsToResults = (
        rows: RagSearchRow[],
        indexMode: "fts5" | "like",
      ) => {
        const nowMs = Date.now();
        return rows
          .map((row) => {
            const document = mapProjectDocument({
              id: row.doc_id,
              project_id: row.doc_project_id,
              source_type: row.doc_source_type,
              source_ref: row.doc_source_ref,
              title: row.doc_title,
              summary: row.doc_summary,
              uri: row.doc_uri,
              reliability: row.doc_reliability,
              confidence: row.doc_confidence,
              metadata_json: row.doc_metadata_json,
              created_at: row.doc_created_at,
              updated_at: row.doc_updated_at,
            });
            const chunk = mapProjectDocumentChunk({
              id: row.chunk_id,
              document_id: row.chunk_document_id,
              project_id: row.chunk_project_id,
              chunk_index: row.chunk_index,
              content: row.chunk_content,
              redacted_content: row.chunk_redacted_content,
              token_hint: row.chunk_token_hint,
              metadata_json: row.chunk_metadata_json,
              created_at: row.chunk_created_at,
            });
            const ageDays = Math.max(0, (nowMs - document.updatedAt) / 86_400_000);
            const recencyBoost = Math.max(0, 1 - ageDays / 30) * 0.2;
            const rankScore = indexMode === "fts5" ? 1 / (1 + Math.abs(row.rank ?? 0)) : 1;
            const score =
              rankScore +
              document.reliability * 0.25 +
              document.confidence * 0.35 +
              recencyBoost;
            return {
              document,
              chunk,
              snippet: searchSnippet(chunk.redactedContent, input.q),
              score,
              indexMode,
            };
          })
          .sort((left, right) => right.score - left.score || right.document.updatedAt - left.document.updatedAt)
          .slice(0, limit);
      };

      const selectColumns = `
        d.id AS doc_id, d.project_id AS doc_project_id, d.source_type AS doc_source_type,
        d.source_ref AS doc_source_ref, d.title AS doc_title, d.summary AS doc_summary,
        d.uri AS doc_uri, d.reliability AS doc_reliability, d.confidence AS doc_confidence,
        d.metadata_json AS doc_metadata_json, d.created_at AS doc_created_at, d.updated_at AS doc_updated_at,
        c.id AS chunk_id, c.document_id AS chunk_document_id, c.project_id AS chunk_project_id,
        c.chunk_index AS chunk_index, c.content AS chunk_content, c.redacted_content AS chunk_redacted_content,
        c.token_hint AS chunk_token_hint, c.metadata_json AS chunk_metadata_json, c.created_at AS chunk_created_at
      `;
      const ftsQuery = buildFtsQuery(input.q);
      if (projectRagFtsAvailable(db) && ftsQuery) {
        try {
          const rows = db
            .prepare(
              `SELECT ${selectColumns}, bm25(project_document_chunks_fts) AS rank
               FROM project_document_chunks_fts
               JOIN project_document_chunks c ON c.id = project_document_chunks_fts.chunk_id
               JOIN project_documents d ON d.id = c.document_id
               WHERE project_document_chunks_fts MATCH ? AND project_document_chunks_fts.project_id = ?
               ORDER BY rank
               LIMIT ? OFFSET ?`,
            )
            .all(ftsQuery, input.projectId, limit * 4, offset) as RagSearchRow[];
          return { results: rowsToResults(rows, "fts5"), indexMode: "fts5" };
        } catch {
          // Fall through to LIKE search when FTS is unavailable or rejects a query.
        }
      }

      const like = `%${input.q}%`;
      const rows = db
        .prepare(
          `SELECT ${selectColumns}
           FROM project_document_chunks c
           JOIN project_documents d ON d.id = c.document_id
           WHERE c.project_id = ? AND (d.title LIKE ? OR c.redacted_content LIKE ?)
           ORDER BY d.updated_at DESC
           LIMIT ? OFFSET ?`,
        )
        .all(input.projectId, like, like, limit * 4, offset) as RagSearchRow[];
      return { results: rowsToResults(rows, "like"), indexMode: "like" };
    },

    createMetadataArtifact(input: {
      agentId: string;
      conversationId: string;
      kind: Exclude<ArtifactKind, "file" | "diff">;
      title: string;
      summary?: string | null;
      metadata?: Record<string, unknown>;
      runId?: string | null;
      taskId?: string | null;
    }): ArtifactRecord {
      const id = crypto.randomUUID();
      const timestamp = now();
      insertArtifactStmt.run({
        id,
        agent_id: input.agentId,
        conversation_id: input.conversationId,
        run_id: input.runId ?? null,
        task_id: input.taskId ?? null,
        kind: input.kind,
        title: input.title,
        path: null,
        summary: input.summary ?? null,
        metadata_json: JSON.stringify(input.metadata ?? {}),
        created_at: timestamp,
        updated_at: timestamp,
      });
      const artifact = store.getArtifact(id);
      if (!artifact) {
        throw new Error("Failed to create artifact.");
      }
      store.upsertSearchDocument({
        kind: artifact.kind === "report" ? "report" : "artifact",
        agentId: artifact.agentId,
        conversationId: artifact.conversationId,
        recordId: artifact.id,
        title: artifact.title,
        body: `${artifact.title}\n${artifact.summary ?? ""}\n${typeof artifact.metadata.markdown === "string" ? artifact.metadata.markdown : ""}`,
        updatedAt: artifact.updatedAt,
      });
      const project = store.findResearchProjectForConversation(artifact.conversationId);
      if (project) {
        store.upsertProjectDocument({
          projectId: project.id,
          sourceType: artifact.kind === "report" ? "report" : "artifact",
          sourceRef: artifact.id,
          title: artifact.title,
          summary: artifact.summary,
          body: [
            artifact.title,
            artifact.summary ?? "",
            typeof artifact.metadata.markdown === "string" ? artifact.metadata.markdown : "",
            artifact.path ?? "",
          ].filter(Boolean).join("\n"),
          reliability: artifact.kind === "report" ? 0.7 : 0.55,
          confidence: artifact.kind === "report" ? 0.7 : 0.55,
          metadata: { runId: artifact.runId, taskId: artifact.taskId, kind: artifact.kind, path: artifact.path },
          updatedAt: artifact.updatedAt,
        });
      }
      return artifact;
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

    createResearchProject(input: {
      agentId: string;
      conversationId?: string | null;
      title: string;
      objective: string;
      domain?: string | null;
      status?: ResearchProjectStatus;
      autonomyEnabled?: boolean;
      autonomyBudget?: Partial<ResearchAutonomyBudget>;
      safetyPolicy?: Partial<ResearchSafetyPolicy>;
    }): ResearchProjectRecord {
      if (!store.getAgent(input.agentId)) {
        throw new Error("Agent not found.");
      }
      if (input.conversationId) {
        const conversation = store.getConversation(input.conversationId);
        if (!conversation || conversation.agentId !== input.agentId) {
          throw new Error("Conversation not found for research project.");
        }
      }
      const id = crypto.randomUUID();
      const timestamp = now();
      db.prepare(
        `INSERT INTO research_projects (
          id, agent_id, conversation_id, title, objective, domain, status, autonomy_enabled,
          autonomy_budget_json, safety_policy_json, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.agentId,
        input.conversationId ?? null,
        input.title,
        input.objective,
        input.domain ?? null,
        input.status ?? "active",
        input.autonomyEnabled ? 1 : 0,
        JSON.stringify(mergeResearchBudget(input.autonomyBudget)),
        JSON.stringify(mergeResearchPolicy(input.safetyPolicy)),
        timestamp,
        timestamp,
        input.status === "completed" ? timestamp : null,
      );
      const project = store.getResearchProject(id)!;
      if (project.conversationId) {
        store.linkResearchProjectSession({
          projectId: project.id,
          conversationId: project.conversationId,
          role: "primary",
          includeInContext: true,
        });
      }
      store.upsertSearchDocument({
        kind: "research_project",
        agentId: project.agentId,
        conversationId: project.conversationId,
        projectId: project.id,
        recordId: project.id,
        title: project.title,
        body: `${project.title}\n${project.objective}\n${project.domain ?? ""}`,
        updatedAt: project.updatedAt,
      });
      return project;
    },

    updateResearchProject(input: {
      projectId: string;
      conversationId?: string | null;
      title?: string;
      objective?: string;
      domain?: string | null;
      status?: ResearchProjectStatus;
      autonomyEnabled?: boolean;
      autonomyBudget?: Partial<ResearchAutonomyBudget>;
      safetyPolicy?: Partial<ResearchSafetyPolicy>;
    }): ResearchProjectRecord | null {
      const existing = store.getResearchProject(input.projectId);
      if (!existing) {
        return null;
      }
      const timestamp = now();
      const status = input.status ?? existing.status;
      if (input.conversationId) {
        const conversation = store.getConversation(input.conversationId);
        if (!conversation || conversation.agentId !== existing.agentId) {
          throw new Error("Conversation not found for research project.");
        }
      }
      db.prepare(
        `UPDATE research_projects
         SET conversation_id = ?, title = ?, objective = ?, domain = ?, status = ?, autonomy_enabled = ?,
             autonomy_budget_json = ?, safety_policy_json = ?, updated_at = ?,
             completed_at = CASE
               WHEN ? = 'completed' THEN COALESCE(completed_at, ?)
               WHEN ? != 'completed' THEN NULL
               ELSE completed_at
             END
       WHERE id = ?`,
      ).run(
        input.conversationId === undefined ? existing.conversationId : input.conversationId,
        input.title ?? existing.title,
        input.objective ?? existing.objective,
        input.domain === undefined ? existing.domain : input.domain,
        status,
        input.autonomyEnabled === undefined ? (existing.autonomyEnabled ? 1 : 0) : input.autonomyEnabled ? 1 : 0,
        JSON.stringify(mergeResearchBudget(input.autonomyBudget ?? existing.autonomyBudget)),
        JSON.stringify(mergeResearchPolicy(input.safetyPolicy ?? existing.safetyPolicy)),
        timestamp,
        status,
        timestamp,
        status,
        input.projectId,
      );
      const updated = store.getResearchProject(input.projectId);
      if (updated?.conversationId) {
        store.linkResearchProjectSession({
          projectId: updated.id,
          conversationId: updated.conversationId,
          role: "primary",
          includeInContext: true,
        });
      }
      return updated;
    },

    getResearchProject(projectId: string): ResearchProjectRecord | null {
      const row = db
        .prepare(
          `SELECT id, agent_id, conversation_id, title, objective, domain, status, autonomy_enabled,
                  autonomy_budget_json, safety_policy_json, created_at, updated_at, completed_at
           FROM research_projects
           WHERE id = ?`,
        )
        .get(projectId) as ResearchProjectRow | undefined;
      return row ? mapResearchProject(row) : null;
    },

    listResearchProjects(agentId?: string): ResearchProjectRecord[] {
      const rows = agentId
        ? (db
            .prepare(
              `SELECT id, agent_id, conversation_id, title, objective, domain, status, autonomy_enabled,
                      autonomy_budget_json, safety_policy_json, created_at, updated_at, completed_at
               FROM research_projects
               WHERE agent_id = ?
               ORDER BY updated_at DESC`,
            )
            .all(agentId) as ResearchProjectRow[])
        : (db
            .prepare(
              `SELECT id, agent_id, conversation_id, title, objective, domain, status, autonomy_enabled,
                      autonomy_budget_json, safety_policy_json, created_at, updated_at, completed_at
               FROM research_projects
               ORDER BY updated_at DESC`,
            )
            .all() as ResearchProjectRow[]);
      return rows.map(mapResearchProject);
    },

    linkResearchProjectSession(input: {
      projectId: string;
      conversationId: string;
      role?: string;
      includeInContext?: boolean;
    }): ResearchProjectSessionRecord {
      const project = store.getResearchProject(input.projectId);
      if (!project) {
        throw new Error("Research project not found.");
      }
      const conversation = store.getConversation(input.conversationId);
      if (!conversation || conversation.agentId !== project.agentId) {
        throw new Error("Conversation not found for research project.");
      }
      const timestamp = now();
      db.prepare(
        `INSERT INTO research_project_sessions (
          project_id, conversation_id, role, include_in_context, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, conversation_id) DO UPDATE SET
          role = excluded.role,
          include_in_context = excluded.include_in_context,
          updated_at = excluded.updated_at`,
      ).run(
        project.id,
        conversation.id,
        input.role?.trim() || "member",
        input.includeInContext === false ? 0 : 1,
        timestamp,
        timestamp,
      );
      if (!project.conversationId) {
        db.prepare(`UPDATE research_projects SET conversation_id = ?, updated_at = ? WHERE id = ?`).run(
          conversation.id,
          timestamp,
          project.id,
        );
      }
      return store
        .listResearchProjectSessions(project.id)
        .find((session) => session.conversationId === conversation.id)!;
    },

    unlinkResearchProjectSession(projectId: string, conversationId: string): boolean {
      const result = db
        .prepare(`DELETE FROM research_project_sessions WHERE project_id = ? AND conversation_id = ?`)
        .run(projectId, conversationId);
      const project = store.getResearchProject(projectId);
      if (project?.conversationId === conversationId) {
        const replacement = store.listResearchProjectSessions(projectId)[0] ?? null;
        db.prepare(`UPDATE research_projects SET conversation_id = ?, updated_at = ? WHERE id = ?`).run(
          replacement?.conversationId ?? null,
          now(),
          projectId,
        );
      }
      return result.changes > 0;
    },

    listResearchProjectSessions(projectId: string): ResearchProjectSessionRecord[] {
      const rows = db
        .prepare(
          `SELECT project_id, conversation_id, role, include_in_context, created_at, updated_at
           FROM research_project_sessions
           WHERE project_id = ?
           ORDER BY role = 'primary' DESC, updated_at DESC`,
        )
        .all(projectId) as ResearchProjectSessionRow[];
      return rows.map(mapResearchProjectSession);
    },

    findResearchProjectForConversation(conversationId: string): ResearchProjectRecord | null {
      const row = db
        .prepare(
          `SELECT p.id, p.agent_id, p.conversation_id, p.title, p.objective, p.domain, p.status,
                  p.autonomy_enabled, p.autonomy_budget_json, p.safety_policy_json,
                  p.created_at, p.updated_at, p.completed_at
           FROM research_projects p
           LEFT JOIN research_project_sessions s ON s.project_id = p.id
           WHERE p.conversation_id = ? OR s.conversation_id = ?
           ORDER BY CASE WHEN p.conversation_id = ? THEN 0 ELSE 1 END, p.updated_at DESC
           LIMIT 1`,
        )
        .get(conversationId, conversationId, conversationId) as ResearchProjectRow | undefined;
      return row ? mapResearchProject(row) : null;
    },

    createResearchQuestion(input: {
      projectId: string;
      question: string;
      status?: ResearchQuestionStatus;
      priority?: number;
    }): ResearchQuestionRecord {
      if (!store.getResearchProject(input.projectId)) {
        throw new Error("Research project not found.");
      }
      const id = crypto.randomUUID();
      const timestamp = now();
      db.prepare(
        `INSERT INTO research_questions (id, project_id, question, status, priority, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, input.projectId, input.question, input.status ?? "open", input.priority ?? 0, timestamp, timestamp);
      const question = store.getResearchQuestion(id)!;
      const project = store.getResearchProject(question.projectId);
      if (project) {
        store.upsertSearchDocument({
          kind: "question",
          agentId: project.agentId,
          conversationId: project.conversationId,
          projectId: project.id,
          recordId: question.id,
          title: question.question.slice(0, 120),
          body: question.question,
          updatedAt: question.updatedAt,
        });
      }
      return question;
    },

    updateResearchQuestion(input: {
      questionId: string;
      question?: string;
      status?: ResearchQuestionStatus;
      priority?: number;
    }): ResearchQuestionRecord | null {
      const existing = store.getResearchQuestion(input.questionId);
      if (!existing) {
        return null;
      }
      db.prepare(
        `UPDATE research_questions
         SET question = ?, status = ?, priority = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        input.question ?? existing.question,
        input.status ?? existing.status,
        input.priority ?? existing.priority,
        now(),
        input.questionId,
      );
      return store.getResearchQuestion(input.questionId);
    },

    getResearchQuestion(questionId: string): ResearchQuestionRecord | null {
      const row = db
        .prepare(
          `SELECT id, project_id, question, status, priority, created_at, updated_at
           FROM research_questions
           WHERE id = ?`,
        )
        .get(questionId) as ResearchQuestionRow | undefined;
      return row ? mapResearchQuestion(row) : null;
    },

    listResearchQuestions(projectId: string): ResearchQuestionRecord[] {
      const rows = db
        .prepare(
          `SELECT id, project_id, question, status, priority, created_at, updated_at
           FROM research_questions
           WHERE project_id = ?
           ORDER BY status ASC, priority DESC, updated_at DESC`,
        )
        .all(projectId) as ResearchQuestionRow[];
      return rows.map(mapResearchQuestion);
    },

    createResearchHypothesis(input: {
      projectId: string;
      questionId?: string | null;
      hypothesis: string;
      status?: ResearchHypothesisStatus;
      confidence?: number;
    }): ResearchHypothesisRecord {
      if (!store.getResearchProject(input.projectId)) {
        throw new Error("Research project not found.");
      }
      if (input.questionId) {
        const question = store.getResearchQuestion(input.questionId);
        if (!question || question.projectId !== input.projectId) {
          throw new Error("Research question not found for project.");
        }
      }
      const id = crypto.randomUUID();
      const timestamp = now();
      db.prepare(
        `INSERT INTO research_hypotheses (
          id, project_id, question_id, hypothesis, status, confidence, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.projectId,
        input.questionId ?? null,
        input.hypothesis,
        input.status ?? "proposed",
        input.confidence ?? 0,
        timestamp,
        timestamp,
      );
      const hypothesis = store.getResearchHypothesis(id)!;
      const project = store.getResearchProject(hypothesis.projectId);
      if (project) {
        store.upsertSearchDocument({
          kind: "hypothesis",
          agentId: project.agentId,
          conversationId: project.conversationId,
          projectId: project.id,
          recordId: hypothesis.id,
          title: hypothesis.hypothesis.slice(0, 120),
          body: hypothesis.hypothesis,
          updatedAt: hypothesis.updatedAt,
        });
      }
      return hypothesis;
    },

    updateResearchHypothesis(input: {
      hypothesisId: string;
      questionId?: string | null;
      hypothesis?: string;
      status?: ResearchHypothesisStatus;
      confidence?: number;
    }): ResearchHypothesisRecord | null {
      const existing = store.getResearchHypothesis(input.hypothesisId);
      if (!existing) {
        return null;
      }
      if (input.questionId) {
        const question = store.getResearchQuestion(input.questionId);
        if (!question || question.projectId !== existing.projectId) {
          throw new Error("Research question not found for project.");
        }
      }
      db.prepare(
        `UPDATE research_hypotheses
         SET question_id = ?, hypothesis = ?, status = ?, confidence = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        input.questionId === undefined ? existing.questionId : input.questionId,
        input.hypothesis ?? existing.hypothesis,
        input.status ?? existing.status,
        input.confidence ?? existing.confidence,
        now(),
        input.hypothesisId,
      );
      return store.getResearchHypothesis(input.hypothesisId);
    },

    getResearchHypothesis(hypothesisId: string): ResearchHypothesisRecord | null {
      const row = db
        .prepare(
          `SELECT id, project_id, question_id, hypothesis, status, confidence, created_at, updated_at
           FROM research_hypotheses
           WHERE id = ?`,
        )
        .get(hypothesisId) as ResearchHypothesisRow | undefined;
      return row ? mapResearchHypothesis(row) : null;
    },

    listResearchHypotheses(projectId: string): ResearchHypothesisRecord[] {
      const rows = db
        .prepare(
          `SELECT id, project_id, question_id, hypothesis, status, confidence, created_at, updated_at
           FROM research_hypotheses
           WHERE project_id = ?
           ORDER BY confidence DESC, updated_at DESC`,
        )
        .all(projectId) as ResearchHypothesisRow[];
      return rows.map(mapResearchHypothesis);
    },

    createResearchEvidence(input: {
      projectId: string;
      questionId?: string | null;
      hypothesisId?: string | null;
      sourceType: ResearchEvidenceSourceType;
      sourceRef?: string | null;
      claim: string;
      summary: string;
      confidence?: number;
      uncertainty?: string | null;
      metadata?: Record<string, unknown>;
    }): ResearchEvidenceRecord {
      if (!store.getResearchProject(input.projectId)) {
        throw new Error("Research project not found.");
      }
      const id = crypto.randomUUID();
      const timestamp = now();
      db.prepare(
        `INSERT INTO research_evidence (
          id, project_id, question_id, hypothesis_id, source_type, source_ref, claim, summary,
          confidence, uncertainty, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.projectId,
        input.questionId ?? null,
        input.hypothesisId ?? null,
        input.sourceType,
        input.sourceRef ?? null,
        input.claim,
        input.summary,
        input.confidence ?? 0.5,
        input.uncertainty ?? null,
        JSON.stringify(input.metadata ?? {}),
        timestamp,
        timestamp,
      );
      const evidence = db
        .prepare(
          `SELECT id, project_id, question_id, hypothesis_id, source_type, source_ref, claim, summary,
                  confidence, uncertainty, metadata_json, created_at, updated_at
           FROM research_evidence
           WHERE id = ?`,
        )
        .get(id) as ResearchEvidenceRow | undefined;
      if (!evidence) {
        throw new Error("Failed to create research evidence.");
      }
      const record = mapResearchEvidence(evidence);
      const project = store.getResearchProject(record.projectId);
      if (project) {
        store.upsertSearchDocument({
          kind: "evidence",
          agentId: project.agentId,
          conversationId: project.conversationId,
          projectId: project.id,
          recordId: record.id,
          title: record.claim.slice(0, 120),
          body: `${record.claim}\n${record.summary}\n${record.uncertainty ?? ""}`,
          updatedAt: record.updatedAt,
        });
      }
      store.upsertProjectDocument({
        projectId: record.projectId,
        sourceType: "evidence",
        sourceRef: record.id,
        title: record.claim.slice(0, 160),
        summary: record.summary,
        body: [
          `Claim: ${record.claim}`,
          `Summary: ${record.summary}`,
          record.uncertainty ? `Uncertainty: ${record.uncertainty}` : "",
        ].filter(Boolean).join("\n"),
        reliability: record.confidence,
        confidence: record.confidence,
        metadata: {
          questionId: record.questionId,
          hypothesisId: record.hypothesisId,
          sourceType: record.sourceType,
          sourceRef: record.sourceRef,
        },
        updatedAt: record.updatedAt,
      });
      return record;
    },

    listResearchEvidence(projectId: string): ResearchEvidenceRecord[] {
      const rows = db
        .prepare(
          `SELECT id, project_id, question_id, hypothesis_id, source_type, source_ref, claim, summary,
                  confidence, uncertainty, metadata_json, created_at, updated_at
           FROM research_evidence
           WHERE project_id = ?
           ORDER BY created_at DESC`,
        )
        .all(projectId) as ResearchEvidenceRow[];
      return rows.map(mapResearchEvidence);
    },

    createResearchSource(input: {
      projectId: string;
      evidenceId?: string | null;
      url?: string | null;
      title: string;
      author?: string | null;
      institution?: string | null;
      publishedAt?: string | null;
      accessedAt?: string | null;
      summary: string;
      quote?: string | null;
      snapshot?: string | null;
      reliability?: number;
      relatedClaim?: string | null;
      metadata?: Record<string, unknown>;
    }): ResearchSourceRecord {
      const project = store.getResearchProject(input.projectId);
      if (!project) {
        throw new Error("Research project not found.");
      }
      if (input.evidenceId) {
        const evidence = store.listResearchEvidence(input.projectId).find((item) => item.id === input.evidenceId);
        if (!evidence) {
          throw new Error("Research evidence not found for project.");
        }
      }
      const id = crypto.randomUUID();
      const timestamp = now();
      const reliability = Math.max(0, Math.min(1, input.reliability ?? 0.5));
      db.prepare(
        `INSERT INTO research_sources (
          id, project_id, evidence_id, url, title, author, institution, published_at, accessed_at,
          summary, quote, snapshot, reliability, related_claim, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.projectId,
        input.evidenceId ?? null,
        input.url ?? null,
        input.title,
        input.author ?? null,
        input.institution ?? null,
        input.publishedAt ?? null,
        input.accessedAt ?? new Date(timestamp).toISOString().slice(0, 10),
        input.summary,
        input.quote ?? null,
        input.snapshot ?? null,
        reliability,
        input.relatedClaim ?? null,
        JSON.stringify(input.metadata ?? {}),
        timestamp,
        timestamp,
      );
      const source = store.getResearchSource(id);
      if (!source) {
        throw new Error("Failed to create research source.");
      }
      store.upsertSearchDocument({
        kind: "source",
        agentId: project.agentId,
        conversationId: project.conversationId,
        projectId: project.id,
        recordId: source.id,
        title: source.title,
        body: [
          source.title,
          source.url ?? "",
          source.author ?? "",
          source.institution ?? "",
          source.summary,
          source.quote ?? "",
          source.relatedClaim ?? "",
        ].join("\n"),
        updatedAt: source.updatedAt,
      });
      store.upsertProjectDocument({
        projectId: project.id,
        sourceType: "source",
        sourceRef: source.id,
        title: source.title,
        summary: source.summary,
        uri: source.url,
        body: [
          source.title,
          source.url ?? "",
          source.author ? `Author: ${source.author}` : "",
          source.institution ? `Institution: ${source.institution}` : "",
          source.publishedAt ? `Published: ${source.publishedAt}` : "",
          source.accessedAt ? `Accessed: ${source.accessedAt}` : "",
          source.summary,
          source.quote ? `Quote: ${source.quote}` : "",
          source.snapshot ? `Snapshot: ${source.snapshot}` : "",
          source.relatedClaim ? `Related claim: ${source.relatedClaim}` : "",
        ].filter(Boolean).join("\n"),
        reliability: source.reliability,
        confidence: source.reliability,
        metadata: { evidenceId: source.evidenceId, relatedClaim: source.relatedClaim },
        updatedAt: source.updatedAt,
      });
      return source;
    },

    getResearchSource(sourceId: string): ResearchSourceRecord | null {
      const row = db
        .prepare(
          `SELECT id, project_id, evidence_id, url, title, author, institution, published_at, accessed_at,
                  summary, quote, snapshot, reliability, related_claim, metadata_json, created_at, updated_at
           FROM research_sources
           WHERE id = ?`,
        )
        .get(sourceId) as ResearchSourceRow | undefined;
      return row ? mapResearchSource(row) : null;
    },

    listResearchSources(projectId: string): ResearchSourceRecord[] {
      const rows = db
        .prepare(
          `SELECT id, project_id, evidence_id, url, title, author, institution, published_at, accessed_at,
                  summary, quote, snapshot, reliability, related_claim, metadata_json, created_at, updated_at
           FROM research_sources
           WHERE project_id = ?
           ORDER BY updated_at DESC`,
        )
        .all(projectId) as ResearchSourceRow[];
      return rows.map(mapResearchSource);
    },

    createResearchLoop(input: {
      projectId: string;
      goal: string;
      selectedQuestionId?: string | null;
      proposedFlowId?: string | null;
      taskId?: string | null;
      runId?: string | null;
      status?: ResearchLoopStatus;
    }): ResearchLoopRecord {
      if (!store.getResearchProject(input.projectId)) {
        throw new Error("Research project not found.");
      }
      const id = crypto.randomUUID();
      const timestamp = now();
      db.prepare(
        `INSERT INTO research_loops (
          id, project_id, status, iteration, goal, selected_question_id, proposed_flow_id,
          task_id, run_id, result_summary, error_text, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.projectId,
        input.status ?? "queued",
        0,
        input.goal,
        input.selectedQuestionId ?? null,
        input.proposedFlowId ?? null,
        input.taskId ?? null,
        input.runId ?? null,
        null,
        null,
        timestamp,
        timestamp,
        null,
      );
      return store.getResearchLoop(id)!;
    },

    transitionResearchLoop(input: {
      loopId: string;
      status?: ResearchLoopStatus;
      iteration?: number;
      goal?: string;
      selectedQuestionId?: string | null;
      proposedFlowId?: string | null;
      taskId?: string | null;
      runId?: string | null;
      resultSummary?: string | null;
      errorText?: string | null;
      completedAt?: number | null;
      clearErrorText?: boolean;
      clearCompletedAt?: boolean;
    }): ResearchLoopRecord | null {
      const existing = store.getResearchLoop(input.loopId);
      if (!existing) {
        return null;
      }
      const status = input.status ?? existing.status;
      const timestamp = now();
      db.prepare(
        `UPDATE research_loops
         SET status = ?, iteration = ?, goal = ?, selected_question_id = ?, proposed_flow_id = ?,
             task_id = ?, run_id = ?, result_summary = ?, error_text = ?, updated_at = ?,
             completed_at = ?
         WHERE id = ?`,
      ).run(
        status,
        input.iteration ?? existing.iteration,
        input.goal ?? existing.goal,
        input.selectedQuestionId === undefined ? existing.selectedQuestionId : input.selectedQuestionId,
        input.proposedFlowId === undefined ? existing.proposedFlowId : input.proposedFlowId,
        input.taskId === undefined ? existing.taskId : input.taskId,
        input.runId === undefined ? existing.runId : input.runId,
        input.resultSummary === undefined ? existing.resultSummary : input.resultSummary,
        input.clearErrorText ? null : input.errorText === undefined ? existing.errorText : input.errorText,
        timestamp,
        input.clearCompletedAt
          ? null
          : input.completedAt === undefined
            ? existing.completedAt
            : input.completedAt,
        input.loopId,
      );
      return store.getResearchLoop(input.loopId);
    },

    getResearchLoop(loopId: string): ResearchLoopRecord | null {
      const row = db
        .prepare(
          `SELECT id, project_id, status, iteration, goal, selected_question_id, proposed_flow_id,
                  task_id, run_id, result_summary, error_text, created_at, updated_at, completed_at
           FROM research_loops
           WHERE id = ?`,
        )
        .get(loopId) as ResearchLoopRow | undefined;
      return row ? mapResearchLoop(row) : null;
    },

    listResearchLoops(projectId: string): ResearchLoopRecord[] {
      const rows = db
        .prepare(
          `SELECT id, project_id, status, iteration, goal, selected_question_id, proposed_flow_id,
                  task_id, run_id, result_summary, error_text, created_at, updated_at, completed_at
           FROM research_loops
           WHERE project_id = ?
           ORDER BY created_at DESC`,
        )
        .all(projectId) as ResearchLoopRow[];
      return rows.map(mapResearchLoop);
    },

    syncResearchLoopsForFlow(flowId: string): ResearchLoopRecord[] {
      const flow = store.getTaskFlow(flowId);
      if (!flow || !["completed", "failed", "cancelled"].includes(flow.status)) {
        return [];
      }
      const rows = db
        .prepare(
          `SELECT id, project_id, status, iteration, goal, selected_question_id, proposed_flow_id,
                  task_id, run_id, result_summary, error_text, created_at, updated_at, completed_at
           FROM research_loops
           WHERE proposed_flow_id = ?`,
        )
        .all(flowId) as ResearchLoopRow[];
      const loops = rows.map(mapResearchLoop);
      for (const loop of loops) {
        const completedAt = now();
        if (flow.status === "completed") {
          const existingEvidenceForFlow = store
            .listResearchEvidence(loop.projectId)
            .some((item) => item.metadata?.researchLoopId === loop.id && item.sourceRef === flow.id);
          const steps = store.listTaskFlowSteps(flow.id);
          const taskTexts = steps
            .map((step) => (step.taskId ? store.getTask(step.taskId)?.resultText ?? "" : ""))
            .filter(Boolean);
          const report = store.getLatestFlowReportArtifact(flow.id);
          const artifactSummaries = steps.flatMap((step) => {
            const task = step.taskId ? store.getTask(step.taskId) : null;
            const run = task?.runId ? store.getWorkspaceRun(task.runId) : null;
            return run ? store.listArtifactsForRun(run.conversationId, run.id).map((artifact) => artifact.summary ?? artifact.title) : [];
          });
          const combined = [
            flow.resultSummary ?? "",
            report?.summary ?? "",
            typeof report?.metadata.markdown === "string" ? report.metadata.markdown : "",
            ...taskTexts,
            ...artifactSummaries,
          ]
            .filter(Boolean)
            .join("\n\n")
            .trim();
          if (!existingEvidenceForFlow && combined) {
            const sections = extractResearchSections(combined);
            const existingHypotheses = store.listResearchHypotheses(loop.projectId);
            for (const hypothesisText of sections.hypotheses.slice(0, 5)) {
              const normalizedHypothesis = hypothesisText.trim();
              if (!normalizedHypothesis) {
                continue;
              }
              const duplicate = existingHypotheses.some(
                (hypothesis) =>
                  hypothesis.hypothesis.trim().toLowerCase() === normalizedHypothesis.toLowerCase(),
              );
              if (!duplicate) {
                existingHypotheses.push(
                  store.createResearchHypothesis({
                    projectId: loop.projectId,
                    questionId: loop.selectedQuestionId,
                    hypothesis: normalizedHypothesis,
                    status: "proposed",
                    confidence: 0.4,
                  }),
                );
              }
            }
            const claim = sections.claims[0] ?? flow.resultSummary ?? report?.summary ?? "Research loop produced evidence.";
            const summary = sections.evidence[0] ?? combined.slice(0, 1200);
            const claimHash = crypto.createHash("sha256").update(claim).digest("hex");
            const extractionKey = `${loop.id}:report:${flow.id}:${claimHash}`;
            const existingExtraction = store
              .listResearchEvidence(loop.projectId)
              .some((item) => item.metadata?.extractionKey === extractionKey);
            if (!existingExtraction) {
              const hasContradiction = /\b(contradict|contradicted|contradiction|반박|모순)\b/i.test(`${claim}\n${summary}`);
              const createdEvidence = store.createResearchEvidence({
                projectId: loop.projectId,
                questionId: loop.selectedQuestionId,
                sourceType: "report",
                sourceRef: flow.id,
                claim,
                summary,
                uncertainty: sections.uncertainty,
                confidence: hasContradiction ? 0.45 : sections.claims.length || sections.evidence.length ? 0.65 : 0.5,
                metadata: {
                  extractionKey,
                  researchLoopId: loop.id,
                  flowId: flow.id,
                  reportArtifactId: report?.id ?? null,
                  nextQuestions: sections.nextQuestions,
                  structured: Boolean(sections.claims.length || sections.evidence.length),
                },
              });
              const existingSources = store.listResearchSources(loop.projectId);
              for (const parsedSource of extractResearchSources(combined)) {
                const sourceHash = crypto
                  .createHash("sha256")
                  .update(`${parsedSource.url ?? ""}\n${parsedSource.title}\n${parsedSource.summary}`)
                  .digest("hex");
                const sourceExtractionKey = `${loop.id}:source:${flow.id}:${sourceHash}`;
                const duplicateSource = existingSources.some(
                  (source) =>
                    source.metadata?.extractionKey === sourceExtractionKey ||
                    (parsedSource.url && source.url === parsedSource.url) ||
                    (!parsedSource.url &&
                      source.title.trim().toLowerCase() === parsedSource.title.trim().toLowerCase() &&
                      source.summary.trim().toLowerCase() === parsedSource.summary.trim().toLowerCase()),
                );
                if (duplicateSource) {
                  continue;
                }
                existingSources.push(
                  store.createResearchSource({
                    projectId: loop.projectId,
                    evidenceId: createdEvidence.id,
                    url: parsedSource.url,
                    title: redactSensitiveText(parsedSource.title),
                    author: parsedSource.author ? redactSensitiveText(parsedSource.author) : null,
                    institution: parsedSource.institution ? redactSensitiveText(parsedSource.institution) : null,
                    publishedAt: parsedSource.publishedAt,
                    accessedAt: parsedSource.accessedAt,
                    summary: redactSensitiveText(parsedSource.summary),
                    quote: parsedSource.quote ? redactSensitiveText(parsedSource.quote) : null,
                    snapshot: parsedSource.snapshot ? redactSensitiveText(parsedSource.snapshot) : null,
                    reliability: parsedSource.reliability ?? createdEvidence.confidence,
                    relatedClaim: parsedSource.relatedClaim ? redactSensitiveText(parsedSource.relatedClaim) : createdEvidence.claim,
                    metadata: {
                      extractionKey: sourceExtractionKey,
                      researchLoopId: loop.id,
                      flowId: flow.id,
                      evidenceId: createdEvidence.id,
                      source: "flow_output",
                    },
                  }),
                );
              }
            }
          }
          if (loop.selectedQuestionId) {
            store.updateResearchQuestion({
              questionId: loop.selectedQuestionId,
              status: existingEvidenceForFlow || (combined && !/\b(contradict|contradicted|contradiction|반박|모순)\b/i.test(combined))
                ? "answered"
                : "investigating",
            });
          }
          store.transitionResearchLoop({
            loopId: loop.id,
            status: "completed",
            resultSummary: flow.resultSummary ?? report?.summary ?? "Research loop completed.",
            errorText: null,
            completedAt,
          });
        } else {
          if (loop.selectedQuestionId) {
            store.updateResearchQuestion({
              questionId: loop.selectedQuestionId,
              status: "blocked",
            });
          }
          store.transitionResearchLoop({
            loopId: loop.id,
            status: flow.status === "cancelled" ? "cancelled" : "failed",
            resultSummary: flow.resultSummary ?? null,
            errorText: flow.errorText ?? `Linked flow ended with status ${flow.status}.`,
            completedAt,
          });
        }
      }
      for (const projectId of new Set(loops.map((loop) => loop.projectId))) {
        try {
          store.rebuildProjectRagIndex(projectId);
        } catch {
          // Evidence extraction should not fail a terminal flow sync when the auxiliary RAG index cannot rebuild.
        }
      }
      return loops.map((loop) => store.getResearchLoop(loop.id)).filter((loop): loop is ResearchLoopRecord => Boolean(loop));
    },

    upsertSearchDocument(input: {
      kind: string;
      agentId?: string | null;
      conversationId?: string | null;
      projectId?: string | null;
      recordId: string;
      title: string;
      body: string;
      updatedAt?: number;
    }) {
      const timestamp = input.updatedAt ?? now();
      const redactedBody = redactSensitiveText(input.body);
      const id = safeSearchId(input.kind, input.recordId);
      db.prepare(
        `INSERT INTO search_documents (
          id, kind, agent_id, conversation_id, project_id, record_id, title, body, redacted_body, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(kind, record_id) DO UPDATE SET
          agent_id = excluded.agent_id,
          conversation_id = excluded.conversation_id,
          project_id = excluded.project_id,
          title = excluded.title,
          body = excluded.body,
          redacted_body = excluded.redacted_body,
          updated_at = excluded.updated_at`,
      ).run(
        id,
        input.kind,
        input.agentId ?? null,
        input.conversationId ?? null,
        input.projectId ?? null,
        input.recordId,
        redactSensitiveText(input.title),
        input.body,
        redactedBody,
        timestamp,
      );
      if (searchFtsAvailable(db)) {
        db.prepare(`DELETE FROM aetherops_search_index WHERE kind = ? AND record_id = ?`).run(input.kind, input.recordId);
        db.prepare(
          `INSERT INTO aetherops_search_index (
            kind, agent_id, conversation_id, project_id, record_id, title, body, redacted_body, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          input.kind,
          input.agentId ?? null,
          input.conversationId ?? null,
          input.projectId ?? null,
          input.recordId,
          redactSensitiveText(input.title),
          input.body,
          redactedBody,
          timestamp,
        );
      }
    },

    deleteSearchDocument(kind: string, recordId: string) {
      db.prepare(`DELETE FROM search_documents WHERE kind = ? AND record_id = ?`).run(kind, recordId);
      if (searchFtsAvailable(db)) {
        db.prepare(`DELETE FROM aetherops_search_index WHERE kind = ? AND record_id = ?`).run(kind, recordId);
      }
    },

    rebuildSearchIndex() {
      const startedAt = Date.now();
      db.prepare(`DELETE FROM search_documents`).run();
      if (searchFtsAvailable(db)) {
        db.prepare(`DELETE FROM aetherops_search_index`).run();
      }
      let indexed = 0;
      const add = (input: Parameters<typeof store.upsertSearchDocument>[0]) => {
        store.upsertSearchDocument(input);
        indexed += 1;
      };

      for (const agent of store.listAgents()) {
        for (const conversation of store.listConversations(agent.id)) {
          add({
            kind: "session",
            agentId: agent.id,
            conversationId: conversation.id,
            recordId: conversation.id,
            title: conversation.title,
            body: conversation.title,
            updatedAt: conversation.updatedAt,
          });
          const summary = store.getSessionSummary(conversation.id);
          if (summary) {
            add({
              kind: "summary",
              agentId: agent.id,
              conversationId: conversation.id,
              recordId: summary.conversationId,
              title: "Session summary",
              body: [
                summary.summary,
                ...summary.decisions,
                ...summary.openQuestions,
                ...summary.nextActions,
                JSON.stringify(summary.metadata ?? {}),
              ].join("\n"),
              updatedAt: summary.updatedAt,
            });
          }
          for (const flow of store.listTaskFlows(agent.id).filter((item) => item.conversationId === conversation.id)) {
            add({
              kind: "flow",
              agentId: agent.id,
              conversationId: conversation.id,
              recordId: flow.id,
              title: flow.title,
              body: `${flow.title}\n${flow.resultSummary ?? ""}\n${flow.errorText ?? ""}`,
              updatedAt: flow.updatedAt,
            });
          }
          for (const task of store.listTasksForConversation(conversation.id)) {
            add({
              kind: "task",
              agentId: agent.id,
              conversationId: conversation.id,
              recordId: task.id,
              title: task.title,
              body: `${task.title}\n${task.resultText ?? ""}`,
              updatedAt: task.updatedAt,
            });
          }
          const artifactRows = db
            .prepare(
              `SELECT id, agent_id, conversation_id, run_id, task_id, kind, title, path, summary, metadata_json, created_at, updated_at
               FROM artifacts
               WHERE conversation_id = ?
               ORDER BY updated_at DESC`,
            )
            .all(conversation.id) as ArtifactRow[];
          for (const artifact of artifactRows.map(mapArtifact)) {
            const markdown = typeof artifact.metadata.markdown === "string" ? artifact.metadata.markdown : "";
            add({
              kind: artifact.kind === "report" ? "report" : "artifact",
              agentId: agent.id,
              conversationId: conversation.id,
              recordId: artifact.id,
              title: artifact.title,
              body: `${artifact.title}\n${artifact.summary ?? ""}\n${markdown}`,
              updatedAt: artifact.updatedAt,
            });
          }
        }
      }

      for (const project of store.listResearchProjects()) {
        add({
          kind: "research_project",
          agentId: project.agentId,
          conversationId: project.conversationId,
          projectId: project.id,
          recordId: project.id,
          title: project.title,
          body: `${project.title}\n${project.objective}\n${project.domain ?? ""}`,
          updatedAt: project.updatedAt,
        });
        for (const question of store.listResearchQuestions(project.id)) {
          add({
            kind: "question",
            agentId: project.agentId,
            conversationId: project.conversationId,
            projectId: project.id,
            recordId: question.id,
            title: question.question.slice(0, 120),
            body: question.question,
            updatedAt: question.updatedAt,
          });
        }
        for (const hypothesis of store.listResearchHypotheses(project.id)) {
          add({
            kind: "hypothesis",
            agentId: project.agentId,
            conversationId: project.conversationId,
            projectId: project.id,
            recordId: hypothesis.id,
            title: hypothesis.hypothesis.slice(0, 120),
            body: hypothesis.hypothesis,
            updatedAt: hypothesis.updatedAt,
          });
        }
        for (const evidence of store.listResearchEvidence(project.id)) {
          add({
            kind: "evidence",
            agentId: project.agentId,
            conversationId: project.conversationId,
            projectId: project.id,
            recordId: evidence.id,
            title: evidence.claim.slice(0, 120),
            body: `${evidence.claim}\n${evidence.summary}\n${evidence.uncertainty ?? ""}`,
            updatedAt: evidence.updatedAt,
          });
        }
        for (const source of store.listResearchSources(project.id)) {
          add({
            kind: "source",
            agentId: project.agentId,
            conversationId: project.conversationId,
            projectId: project.id,
            recordId: source.id,
            title: source.title,
            body: [
              source.title,
              source.url ?? "",
              source.author ?? "",
              source.institution ?? "",
              source.summary,
              source.quote ?? "",
              source.relatedClaim ?? "",
            ].join("\n"),
            updatedAt: source.updatedAt,
          });
        }
      }

      return {
        indexed,
        indexMode: searchFtsAvailable(db) ? "fts5" : "like",
        durationMs: Date.now() - startedAt,
      };
    },

    searchDocuments(input: {
      q: string;
      agentId?: string | null;
      conversationId?: string | null;
      projectId?: string | null;
      limit?: number;
      offset?: number;
    }) {
      const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
      const offset = Math.max(input.offset ?? 0, 0);
      const filters: string[] = [];
      const params: unknown[] = [];
      if (input.agentId) {
        filters.push("agent_id = ?");
        params.push(input.agentId);
      }
      if (input.conversationId) {
        filters.push("conversation_id = ?");
        params.push(input.conversationId);
      }
      if (input.projectId) {
        filters.push("project_id = ?");
        params.push(input.projectId);
      }

      const ftsQuery = buildFtsQuery(input.q);
      if (searchFtsAvailable(db) && ftsQuery) {
        try {
          const where = ["aetherops_search_index MATCH ?", ...filters].join(" AND ");
          const rows = db
            .prepare(
              `SELECT kind, agent_id, conversation_id, project_id, record_id, title, redacted_body, updated_at
               FROM aetherops_search_index
               WHERE ${where}
               ORDER BY rank
               LIMIT ? OFFSET ?`,
            )
            .all(ftsQuery, ...params, limit, offset) as Array<{
              kind: string;
              agent_id: string | null;
              conversation_id: string | null;
              project_id: string | null;
              record_id: string;
              title: string;
              redacted_body: string;
              updated_at: number;
            }>;
          return {
            results: rows.map((row) => ({
              kind: row.kind,
              agentId: row.agent_id,
              conversationId: row.conversation_id,
              projectId: row.project_id,
              recordId: row.record_id,
              title: row.title,
              snippet: searchSnippet(row.redacted_body, input.q),
              updatedAt: row.updated_at,
            })),
            indexMode: "fts5" as const,
          };
        } catch {
          // Fall through to LIKE search if a SQLite build or query token rejects FTS.
        }
      }

      const likeFilters = ["(title LIKE ? OR redacted_body LIKE ?)"];
      const likeParams: unknown[] = [`%${input.q}%`, `%${input.q}%`, ...params, limit, offset];
      const where = [...likeFilters, ...filters].join(" AND ");
      const rows = db
        .prepare(
          `SELECT kind, agent_id, conversation_id, project_id, record_id, title, redacted_body, updated_at
           FROM search_documents
           WHERE ${where}
           ORDER BY updated_at DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...likeParams) as Array<{
          kind: string;
          agent_id: string | null;
          conversation_id: string | null;
          project_id: string | null;
          record_id: string;
          title: string;
          redacted_body: string;
          updated_at: number;
        }>;
      return {
        results: rows.map((row) => ({
          kind: row.kind,
          agentId: row.agent_id,
          conversationId: row.conversation_id,
          projectId: row.project_id,
          recordId: row.record_id,
          title: row.title,
          snippet: searchSnippet(row.redacted_body, input.q),
          updatedAt: row.updated_at,
        })),
        indexMode: "like" as const,
      };
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
          `SELECT id, flow_id, task_id, step_key, dependency_step_key, position, title, prompt, step_kind, status, created_at, updated_at, completed_at
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
      if (input.status && ["completed", "failed", "cancelled"].includes(input.status)) {
        try {
          store.syncResearchLoopsForFlow(input.flowId);
        } catch (error) {
          console.warn(
            "[aetherops] research_loop_sync_failed",
            error instanceof Error ? error.message : "Research loop sync failed.",
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
      stepKind?: TaskFlowStepKind;
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
        step_kind: input.stepKind ?? "task",
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
          `SELECT id, flow_id, task_id, step_key, dependency_step_key, position, title, prompt, step_kind, status, created_at, updated_at, completed_at
           FROM task_flow_steps
           WHERE id = ?`,
        )
        .get(stepId) as TaskFlowStepRow | undefined;
      return row ? mapTaskFlowStep(row) : null;
    },

    listTaskFlowSteps(flowId: string): TaskFlowStepRecord[] {
      const rows = db
        .prepare(
          `SELECT id, flow_id, task_id, step_key, dependency_step_key, position, title, prompt, step_kind, status, created_at, updated_at, completed_at
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
        stepKind?: TaskFlowStepKind;
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
            step_kind: step.stepKind ?? "task",
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
      stepKind?: TaskFlowStepKind | null;
      status?: TaskFlowStepStatus;
      completedAt?: number | null;
      clearTaskId?: boolean;
      clearCompletedAt?: boolean;
    }) {
      updateTaskFlowStepStmt.run({
        id: input.stepId,
        task_id: input.taskId ?? null,
        step_kind: input.stepKind ?? null,
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
                      suggested_prompt, tags_json, metadata_json, created_at, updated_at
               FROM skill_templates
               WHERE scope = 'shared' OR agent_id = ?
               ORDER BY updated_at DESC, name ASC`,
            )
            .all(agentId) as SkillTemplateRow[])
        : (db
            .prepare(
              `SELECT id, agent_id, scope, name, category, summary, description, standing_order_patch,
                      flow_template_json, verification_checklist_json, heartbeat_instructions,
                      suggested_prompt, tags_json, metadata_json, created_at, updated_at
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
                  suggested_prompt, tags_json, metadata_json, created_at, updated_at
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
      metadata?: Record<string, unknown>;
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
        metadata_json: JSON.stringify(input.metadata ?? existing?.metadata ?? {}),
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
