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
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
  "skipped",
] as const;
const TASK_FLOW_STEP_KINDS = ["task", "approval_gate", "verification_gate"] as const;
const TASK_FLOW_TRIGGER_SOURCES = ["manual", "schedule", "event_hook"] as const;
const RESEARCH_PROJECT_STATUSES = ["active", "paused", "completed", "archived"] as const;
const RESEARCH_QUESTION_STATUSES = ["open", "investigating", "answered", "blocked"] as const;
const RESEARCH_HYPOTHESIS_STATUSES = ["proposed", "supported", "contradicted", "unresolved"] as const;
const RESEARCH_EVIDENCE_SOURCE_TYPES = [
  "artifact",
  "report",
  "run",
  "task",
  "message",
  "human_note",
  "external",
] as const;
const PROJECT_DOCUMENT_SOURCE_TYPES = [
  "project",
  "session_summary",
  "source",
  "evidence",
  "artifact",
  "report",
  "flow",
  "task",
  "manual",
] as const;
const RESEARCH_LOOP_STATUSES = [
  "queued",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
] as const;

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
      metadata_json TEXT NOT NULL DEFAULT '{}',
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

export function createArtifactVersionsSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES workspace_runs(id) ON DELETE SET NULL,
      path TEXT NOT NULL,
      before_content TEXT,
      after_content TEXT,
      before_hash TEXT,
      after_hash TEXT,
      size_bytes INTEGER,
      encoding TEXT,
      binary INTEGER NOT NULL DEFAULT 0,
      truncated INTEGER NOT NULL DEFAULT 0,
      unsupported_encoding INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
  `;
}

export function createSkillTemplatesSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
      scope TEXT NOT NULL CHECK(scope IN ('agent', 'shared')),
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      summary TEXT NOT NULL,
      description TEXT NOT NULL,
      standing_order_patch TEXT NOT NULL,
      flow_template_json TEXT NOT NULL,
      verification_checklist_json TEXT NOT NULL,
      heartbeat_instructions TEXT NOT NULL,
      suggested_prompt TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;
}

export function createResearchProjectsSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      domain TEXT,
      status TEXT NOT NULL CHECK(status IN ('${RESEARCH_PROJECT_STATUSES.join("', '")}')) DEFAULT 'active',
      autonomy_enabled INTEGER NOT NULL DEFAULT 0,
      autonomy_budget_json TEXT NOT NULL DEFAULT '{}',
      safety_policy_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
  `;
}

export function createResearchProjectSessionsSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      include_in_context INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(project_id, conversation_id)
    );
  `;
}

export function createResearchQuestionsSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('${RESEARCH_QUESTION_STATUSES.join("', '")}')) DEFAULT 'open',
      priority INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;
}

export function createResearchHypothesesSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      question_id TEXT REFERENCES research_questions(id) ON DELETE SET NULL,
      hypothesis TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('${RESEARCH_HYPOTHESIS_STATUSES.join("', '")}')) DEFAULT 'proposed',
      confidence REAL NOT NULL DEFAULT 0.0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;
}

export function createResearchEvidenceSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      question_id TEXT REFERENCES research_questions(id) ON DELETE SET NULL,
      hypothesis_id TEXT REFERENCES research_hypotheses(id) ON DELETE SET NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('${RESEARCH_EVIDENCE_SOURCE_TYPES.join("', '")}')),
      source_ref TEXT,
      claim TEXT NOT NULL,
      summary TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      uncertainty TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;
}

export function createResearchSourcesSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      evidence_id TEXT REFERENCES research_evidence(id) ON DELETE SET NULL,
      url TEXT,
      title TEXT NOT NULL,
      author TEXT,
      institution TEXT,
      published_at TEXT,
      accessed_at TEXT,
      summary TEXT NOT NULL,
      quote TEXT,
      snapshot TEXT,
      reliability REAL NOT NULL DEFAULT 0.5,
      related_claim TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;
}

export function createResearchLoopsSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('${RESEARCH_LOOP_STATUSES.join("', '")}')) DEFAULT 'queued',
      iteration INTEGER NOT NULL DEFAULT 0,
      goal TEXT NOT NULL,
      selected_question_id TEXT REFERENCES research_questions(id) ON DELETE SET NULL,
      proposed_flow_id TEXT REFERENCES task_flows(id) ON DELETE SET NULL,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      run_id TEXT REFERENCES workspace_runs(id) ON DELETE SET NULL,
      result_summary TEXT,
      error_text TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
  `;
}

export function createProjectDocumentsSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK(source_type IN ('${PROJECT_DOCUMENT_SOURCE_TYPES.join("', '")}')),
      source_ref TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      uri TEXT,
      reliability REAL NOT NULL DEFAULT 0.5,
      confidence REAL NOT NULL DEFAULT 0.5,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id, source_type, source_ref)
    );
  `;
}

export function createProjectDocumentChunksSql(tableName: string) {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      redacted_content TEXT NOT NULL,
      token_hint INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      UNIQUE(document_id, chunk_index)
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
      step_kind TEXT NOT NULL DEFAULT 'task' CHECK(step_kind IN ('${TASK_FLOW_STEP_KINDS.join("', '")}')),
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
