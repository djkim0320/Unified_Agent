import type {
  AgentRecord,
  ArtifactKind,
  ArtifactRecord,
  AutomationRuleRecord,
  ConversationRecord,
  HeartbeatLogRecord,
  HeartbeatTriggerSource,
  MessageRecord,
  ProviderAccountRecord,
  ProviderKind,
  ReasoningLevel,
  RunCheckpoint,
  SessionKind,
  SessionSummaryRecord,
  TaskEventRecord,
  TaskFlowRecord,
  TaskFlowStatus,
  TaskFlowStepRecord,
  TaskFlowStepStatus,
  TaskFlowTriggerSource,
  TaskKind,
  TaskRecord,
  TaskStatus,
  WorkspaceRunEventRecord,
  WorkspaceRunPhase,
  WorkspaceRunRecord,
  WorkspaceRunStatus,
} from "../types.js";

export type SecretRow = {
  provider_kind: ProviderKind;
  encrypted_blob: string;
};

export type AccountRow = {
  provider_kind: ProviderKind;
  display_name: string | null;
  email: string | null;
  account_id: string | null;
  status: ProviderAccountRecord["status"];
  metadata_json: string;
  created_at: number;
  updated_at: number;
};

export type AgentRow = {
  id: string;
  name: string;
  description: string | null;
  default_provider_kind: ProviderKind;
  default_model: string;
  default_reasoning_level: ReasoningLevel;
  created_at: number;
  updated_at: number;
};

export type ConversationRow = {
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

export type MessageRow = {
  id: string;
  conversation_id: string;
  role: MessageRecord["role"];
  content: string;
  created_at: number;
};

export type WorkspaceRunRow = {
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

export type WorkspaceRunEventRow = {
  id: string;
  run_id: string;
  event_type: WorkspaceRunEventRecord["eventType"];
  payload_json: string;
  created_at: number;
};

export type SessionSummaryRow = {
  conversation_id: string;
  summary: string;
  decisions_json: string;
  open_questions_json: string;
  next_actions_json: string;
  created_at: number;
  updated_at: number;
};

export type ArtifactRow = {
  id: string;
  agent_id: string;
  conversation_id: string;
  run_id: string | null;
  task_id: string | null;
  kind: ArtifactKind;
  title: string;
  path: string | null;
  summary: string | null;
  metadata_json: string;
  created_at: number;
  updated_at: number;
};

export type TaskRow = {
  id: string;
  agent_id: string;
  conversation_id: string;
  task_kind: TaskKind;
  task_flow_id: string | null;
  flow_step_key: string | null;
  origin_run_id: string | null;
  automation_rule_id: string | null;
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

export type TaskFlowRow = {
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

export type TaskFlowStepRow = {
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

export type TaskEventRow = {
  id: string;
  task_id: string;
  event_type: TaskEventRecord["eventType"];
  payload_json: string;
  created_at: number;
};

export type HeartbeatLogRow = {
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

export type AutomationRuleRow = {
  id: string;
  agent_id: string;
  conversation_id: string;
  title: string;
  prompt: string;
  provider_kind: ProviderKind;
  model: string;
  reasoning_level: ReasoningLevel;
  enabled: number;
  interval_minutes: number;
  next_run_at: number;
  last_run_at: number | null;
  last_task_id: string | null;
  run_count: number;
  created_at: number;
  updated_at: number;
};

export function mapConversation(row: ConversationRow): ConversationRecord {
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

export function mapAgent(row: AgentRow): AgentRecord {
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

export function mapMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

export function mapAccount(row: AccountRow): ProviderAccountRecord {
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

export function mapWorkspaceRun(row: WorkspaceRunRow): WorkspaceRunRecord {
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

export function mapWorkspaceRunEvent(row: WorkspaceRunEventRow): WorkspaceRunEventRecord {
  return {
    id: row.id,
    runId: row.run_id,
    eventType: row.event_type,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function mapSessionSummary(row: SessionSummaryRow): SessionSummaryRecord {
  return {
    conversationId: row.conversation_id,
    summary: row.summary,
    decisions: parseStringArray(row.decisions_json),
    openQuestions: parseStringArray(row.open_questions_json),
    nextActions: parseStringArray(row.next_actions_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapArtifact(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    taskId: row.task_id,
    kind: row.kind,
    title: row.title,
    path: row.path,
    summary: row.summary,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    conversationId: row.conversation_id,
    taskKind: row.task_kind,
    taskFlowId: row.task_flow_id,
    flowStepKey: row.flow_step_key,
    originRunId: row.origin_run_id,
    automationRuleId: row.automation_rule_id,
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

export function mapTaskEvent(row: TaskEventRow): TaskEventRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    eventType: row.event_type,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

export function mapHeartbeatLog(row: HeartbeatLogRow): HeartbeatLogRecord {
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

export function mapAutomationRule(row: AutomationRuleRow): AutomationRuleRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    conversationId: row.conversation_id,
    title: row.title,
    prompt: row.prompt,
    providerKind: row.provider_kind,
    model: row.model,
    reasoningLevel: row.reasoning_level,
    enabled: row.enabled === 1,
    intervalMinutes: row.interval_minutes,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastTaskId: row.last_task_id,
    runCount: row.run_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTaskFlow(row: TaskFlowRow): TaskFlowRecord {
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

export function mapTaskFlowStep(row: TaskFlowStepRow): TaskFlowStepRecord {
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
