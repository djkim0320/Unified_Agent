import "@testing-library/jest-dom/vitest";
import { render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as api from "./api";
import type {
  AgentHeartbeatRecord,
  AgentRecord,
  AgentSoulRecord,
  ConversationRecord,
  EngineStatusRecord,
  HeartbeatLogRecord,
  PlatformMetadata,
  ProviderSummary,
  TaskFlowRecord,
  TaskFlowStepDetail,
  WorkspaceRunEventRecord,
  WorkspaceRunRecord,
} from "./types";

vi.mock("./api", () => ({
  cancelAgentTask: vi.fn(),
  cancelSubagentSession: vi.fn(),
  cancelTaskFlow: vi.fn(),
  createAgentAutomationRule: vi.fn(),
  createAgentTask: vi.fn(),
  createSubagentSession: vi.fn(),
  createTaskFlow: vi.fn(),
  deleteAgent: vi.fn(),
  deleteAgentAutomationRule: vi.fn(),
  deleteConversation: vi.fn(),
  deleteTaskFlow: vi.fn(),
  getAgentHeartbeat: vi.fn(),
  getAgentSoul: vi.fn(),
  getAgentStandingOrders: vi.fn(),
  getConversationMessages: vi.fn(),
  getEngineStatus: vi.fn(),
  getTaskFlow: vi.fn(),
  importCodexCliAuth: vi.fn(),
  listAgentAutomationRules: vi.fn(),
  listAgentTasks: vi.fn(),
  listAgents: vi.fn(),
  listConversations: vi.fn(),
  listHeartbeatLogs: vi.fn(),
  listModels: vi.fn(),
  listPlatformMetadata: vi.fn(),
  listProviders: vi.fn(),
  listSubagentSessions: vi.fn(),
  listTaskEvents: vi.fn(),
  listTaskFlows: vi.fn(),
  listWorkspaceRunEvents: vi.fn(),
  listWorkspaceRuns: vi.fn(),
  logoutCodex: vi.fn(),
  resumeTaskFlow: vi.fn(),
  retryTaskFlowStep: vi.fn(),
  refreshOpenCodeModels: vi.fn(),
  saveAgent: vi.fn(),
  saveAgentHeartbeat: vi.fn(),
  saveAgentSoul: vi.fn(),
  saveAgentStandingOrders: vi.fn(),
  saveConversation: vi.fn(),
  saveTaskFlowSteps: vi.fn(),
  saveProviderAccount: vi.fn(),
  skipTaskFlowStep: vi.fn(),
  startCodexOAuth: vi.fn(),
  startOpenCodeAuthLogin: vi.fn(),
  startTaskFlow: vi.fn(),
  streamChat: vi.fn(),
  testProvider: vi.fn(),
  triggerAgentAutomationRule: vi.fn(),
  triggerAgentHeartbeat: vi.fn(),
  updateAgentAutomationRule: vi.fn(),
}));

const providers: ProviderSummary[] = [
  {
    kind: "openai",
    label: "OpenAI",
    configured: true,
    status: "connected",
    displayName: "OpenAI",
    email: null,
    accountId: null,
    metadata: {},
  },
  {
    kind: "anthropic",
    label: "Anthropic",
    configured: true,
    status: "configured",
    displayName: null,
    email: null,
    accountId: null,
    metadata: {},
  },
  {
    kind: "gemini",
    label: "Gemini",
    configured: false,
    status: "disconnected",
    displayName: null,
    email: null,
    accountId: null,
    metadata: {},
  },
  {
    kind: "ollama",
    label: "Ollama",
    configured: false,
    status: "disconnected",
    displayName: null,
    email: null,
    accountId: null,
    metadata: {},
  },
  {
    kind: "openai-codex",
    label: "OpenAI Codex",
    configured: false,
    status: "disconnected",
    displayName: null,
    email: null,
    accountId: null,
    metadata: {},
  },
];

const engineStatus: EngineStatusRecord = {
  engineKind: "opencode",
  configuredEngineKind: "opencode",
  available: true,
  installed: true,
  version: "0.0.0-test",
  executable: "opencode",
  executableSource: "test-harness",
  managedPackageVersion: "0.0.0-test",
  configDir: null,
  authStatus: "available",
  models: ["gpt-5.4"],
  sessions: [],
  lastFailure: null,
  environment: {
    autoUpdateDisabled: true,
    pruneDisabled: true,
    defaultPluginsDisabled: true,
    autoApprovePermissions: false,
  },
  credentialSync: {
    mode: "runtime-env",
    configuredProviders: ["openai", "anthropic"],
    entries: [
      {
        providerKind: "openai",
        opencodeProvider: "openai",
        authMode: "api_key",
        configured: true,
        runtimeEnvKeys: ["OPENAI_API_KEY"],
        note: "test",
      },
    ],
  },
  opencodeAuthProviders: ["openai"],
};

const platformMetadata: PlatformMetadata = {
  plugins: [],
  tools: [],
  channels: [
    {
      kind: "webchat",
      label: "Web Chat",
      enabled: true,
      note: "Primary local UI channel.",
    },
  ],
  agentSkills: [],
};

const defaultAgent: AgentRecord = {
  id: "default-agent",
  name: "Default Agent",
  providerKind: "openai",
  model: "gpt-5.4",
  reasoningLevel: "high",
  createdAt: 1,
  updatedAt: 1,
};

const defaultAgentSoul: AgentSoulRecord = {
  path: "SOUL.md",
  content: "Be thoughtful, concise, and helpful.",
};

const defaultAgentHeartbeat: AgentHeartbeatRecord = {
  path: "HEARTBEAT.md",
  content: "enabled: true",
  enabled: true,
  intervalMinutes: 30,
  lastRun: "2026-04-13T00:00:00.000Z",
  instructions: "Check in on the active session.",
  parseError: null,
};

const defaultHeartbeatLogs: HeartbeatLogRecord[] = [
  {
    id: "heartbeat-log-default",
    agentId: defaultAgent.id,
    conversationId: "11111111-1111-4111-8111-111111111111",
    taskId: null,
    triggerSource: "scheduler",
    status: "completed",
    summary: "Heartbeat completed successfully.",
    errorText: null,
    triggeredAt: 10,
    startedAt: 11,
    completedAt: 12,
    updatedAt: 12,
  },
];

const firstConversation: ConversationRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  agentId: defaultAgent.id,
  channelKind: "webchat",
  sessionKind: "webchat",
  parentConversationId: null,
  ownerRunId: null,
  title: "Main session",
  providerKind: "openai",
  model: "gpt-5.4",
  reasoningLevel: "high",
  createdAt: 1,
  updatedAt: 2,
};

const latestRun: WorkspaceRunRecord = {
  id: "run-latest",
  conversationId: firstConversation.id,
  taskId: null,
  parentRunId: null,
  phase: "foreground",
  checkpoint: null,
  resumeToken: null,
  providerKind: "openai",
  model: "gpt-5.4",
  userMessage: "Create the file.",
  status: "completed",
  createdAt: 30,
  updatedAt: 31,
};

const latestRunEvents: WorkspaceRunEventRecord[] = [
  {
    id: "run-event-tool-call",
    runId: latestRun.id,
    eventType: "tool_call",
    payload: { toolName: "write_file", path: "README.md" },
    createdAt: 31,
  },
];

const selectedFlowSteps: TaskFlowStepDetail[] = [
  {
    id: "step-1",
    flowId: "flow-1",
    stepKey: "step-1",
    title: "Step 1",
    prompt: "Do the thing",
    dependencyStepKey: null,
    position: 0,
    status: "queued",
    taskId: null,
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    task: null,
    run: null,
  },
];

const selectedFlow: TaskFlowRecord = {
  id: "flow-1",
  agentId: defaultAgent.id,
  conversationId: firstConversation.id,
  title: "Research flow",
  status: "running",
  originRunId: null,
  triggerSource: "manual",
  resultSummary: null,
  errorText: null,
  createdAt: 1,
  updatedAt: 2,
  completedAt: null,
};

function mockDefaults() {
  vi.mocked(api.listAgents).mockResolvedValue({ agents: [defaultAgent] });
  vi.mocked(api.listProviders).mockResolvedValue({ providers });
  vi.mocked(api.listPlatformMetadata).mockResolvedValue(platformMetadata);
  vi.mocked(api.listModels).mockResolvedValue({ models: ["gpt-5.4"] });
  vi.mocked(api.listConversations).mockResolvedValue({ conversations: [firstConversation] });
  vi.mocked(api.getConversationMessages).mockResolvedValue({
    conversation: firstConversation,
    messages: [],
  });
  vi.mocked(api.getEngineStatus).mockResolvedValue(engineStatus);
  vi.mocked(api.refreshOpenCodeModels).mockResolvedValue({
    ok: true,
    message: "모델 캐시를 갱신했습니다.",
    models: ["gpt-5.4"],
  });
  vi.mocked(api.startOpenCodeAuthLogin).mockResolvedValue({
    ok: true,
    launched: false,
    provider: "openai",
    command: "opencode auth login openai",
    message: "opencode OAuth 연결 명령을 준비했습니다.",
  });
  vi.mocked(api.saveAgent).mockResolvedValue({ agent: defaultAgent });
  vi.mocked(api.getAgentSoul).mockResolvedValue({ soul: defaultAgentSoul });
  vi.mocked(api.getAgentHeartbeat).mockResolvedValue({ heartbeat: defaultAgentHeartbeat });
  vi.mocked(api.saveAgentSoul).mockResolvedValue({ soul: defaultAgentSoul });
  vi.mocked(api.saveAgentHeartbeat).mockResolvedValue({ heartbeat: defaultAgentHeartbeat });
  vi.mocked(api.saveAgentStandingOrders).mockResolvedValue({
    standingOrders: { path: "STANDING_ORDERS.md", content: "# orders" },
  });
  vi.mocked(api.saveConversation).mockResolvedValue({ conversation: firstConversation });
  vi.mocked(api.getAgentStandingOrders).mockResolvedValue({
    standingOrders: { path: "STANDING_ORDERS.md", content: "# orders" },
  });
  vi.mocked(api.listSubagentSessions).mockResolvedValue({ sessions: [] });
  vi.mocked(api.createSubagentSession).mockResolvedValue({
    session: {
      ...firstConversation,
      id: "sub-session-1",
      title: "Sub-agent session",
      parentConversationId: firstConversation.id,
      ownerRunId: latestRun.id,
    },
    task: {
      id: "task-sub-1",
      agentId: defaultAgent.id,
      conversationId: firstConversation.id,
      runId: null,
      taskFlowId: null,
      flowStepKey: null,
      originRunId: null,
      automationRuleId: null,
      taskKind: "detached",
      parentTaskId: null,
      nestingDepth: 0,
      title: "Sub-agent session",
      prompt: "help me",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
      status: "queued",
      resultText: null,
      createdAt: 1,
      startedAt: null,
      completedAt: null,
      scheduledFor: null,
      updatedAt: 1,
    },
  });
  vi.mocked(api.cancelSubagentSession).mockResolvedValue({ ok: true, task: null });
  vi.mocked(api.listTaskFlows).mockResolvedValue({ flows: [selectedFlow] });
  vi.mocked(api.getTaskFlow).mockResolvedValue({ flow: selectedFlow, steps: selectedFlowSteps });
  vi.mocked(api.createTaskFlow).mockResolvedValue({ flow: selectedFlow, steps: selectedFlowSteps });
  vi.mocked(api.cancelTaskFlow).mockResolvedValue({ flow: null });
  vi.mocked(api.deleteTaskFlow).mockResolvedValue({ ok: true, flowId: selectedFlow.id });
  vi.mocked(api.saveTaskFlowSteps).mockResolvedValue({ flow: selectedFlow, steps: selectedFlowSteps });
  vi.mocked(api.startTaskFlow).mockResolvedValue({ flow: selectedFlow, steps: selectedFlowSteps });
  vi.mocked(api.resumeTaskFlow).mockResolvedValue({ flow: selectedFlow, steps: selectedFlowSteps });
  vi.mocked(api.retryTaskFlowStep).mockResolvedValue({ flow: selectedFlow, steps: selectedFlowSteps });
  vi.mocked(api.skipTaskFlowStep).mockResolvedValue({ flow: selectedFlow, steps: selectedFlowSteps });
  vi.mocked(api.listHeartbeatLogs).mockResolvedValue({ logs: defaultHeartbeatLogs });
  vi.mocked(api.listAgentAutomationRules).mockResolvedValue({ rules: [] });
  vi.mocked(api.createAgentAutomationRule).mockResolvedValue({
    rule: {
      id: "automation-1",
      agentId: defaultAgent.id,
      conversationId: firstConversation.id,
      title: "Daily summary",
      prompt: "Summarize state",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
      enabled: true,
      intervalMinutes: 60,
      nextRunAt: 1,
      lastRunAt: null,
      lastTaskId: null,
      runCount: 0,
      createdAt: 1,
      updatedAt: 1,
    },
    conversation: firstConversation,
  });
  vi.mocked(api.updateAgentAutomationRule).mockImplementation(async (_agentId, _ruleId, payload) => ({
    rule: {
      id: "automation-1",
      agentId: defaultAgent.id,
      conversationId: firstConversation.id,
      title: payload.title ?? "Daily summary",
      prompt: payload.prompt ?? "Summarize state",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
      enabled: payload.enabled ?? true,
      intervalMinutes: payload.intervalMinutes ?? 60,
      nextRunAt: 1,
      lastRunAt: null,
      lastTaskId: null,
      runCount: 0,
      createdAt: 1,
      updatedAt: 2,
    },
  }));
  vi.mocked(api.deleteAgentAutomationRule).mockResolvedValue({ ok: true, ruleId: "automation-1" });
  vi.mocked(api.triggerAgentHeartbeat).mockResolvedValue({
    message: "Heartbeat ran.",
    heartbeat: defaultAgentHeartbeat,
    heartbeatLog: defaultHeartbeatLogs[0],
  });
  vi.mocked(api.listWorkspaceRuns).mockResolvedValue({ runs: [latestRun] });
  vi.mocked(api.listWorkspaceRunEvents).mockResolvedValue({ events: latestRunEvents });
  vi.mocked(api.listAgentTasks).mockResolvedValue({ tasks: [] });
  vi.mocked(api.listTaskEvents).mockResolvedValue({ events: [] });
  vi.mocked(api.createAgentTask).mockResolvedValue({
    task: {
      id: "task-running",
      agentId: defaultAgent.id,
      conversationId: firstConversation.id,
      runId: null,
      taskFlowId: null,
      flowStepKey: null,
      originRunId: null,
      automationRuleId: null,
      taskKind: "detached",
      parentTaskId: null,
      nestingDepth: 0,
      title: "Task",
      prompt: "do work",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
      status: "running",
      resultText: null,
      createdAt: 10,
      startedAt: 10,
      completedAt: null,
      scheduledFor: null,
      updatedAt: 10,
    },
  });
  vi.mocked(api.triggerAgentAutomationRule).mockResolvedValue({
    rule: {
      id: "automation-1",
      agentId: defaultAgent.id,
      conversationId: firstConversation.id,
      title: "Daily summary",
      prompt: "Summarize state",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
      enabled: true,
      intervalMinutes: 60,
      nextRunAt: 120,
      lastRunAt: 60,
      lastTaskId: "task-automation",
      runCount: 1,
      createdAt: 1,
      updatedAt: 60,
    },
    task: {
      id: "task-automation",
      agentId: defaultAgent.id,
      conversationId: firstConversation.id,
      runId: null,
      taskFlowId: null,
      flowStepKey: null,
      originRunId: null,
      automationRuleId: "automation-1",
      taskKind: "scheduled",
      parentTaskId: null,
      nestingDepth: 0,
      title: "[자동화] Daily summary",
      prompt: "Summarize state",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
      status: "queued",
      resultText: null,
      createdAt: 60,
      startedAt: null,
      completedAt: null,
      scheduledFor: 60,
      updatedAt: 60,
    },
    message: "자동화 규칙을 즉시 실행했습니다.",
  });
  vi.mocked(api.cancelAgentTask).mockResolvedValue({
    task: {
      id: "task-running",
      agentId: defaultAgent.id,
      conversationId: firstConversation.id,
      runId: null,
      taskFlowId: null,
      flowStepKey: null,
      originRunId: null,
      automationRuleId: null,
      taskKind: "detached",
      parentTaskId: null,
      nestingDepth: 0,
      title: "Task",
      prompt: "do work",
      providerKind: "openai",
      model: "gpt-5.4",
      reasoningLevel: "high",
      status: "cancelled",
      resultText: null,
      createdAt: 10,
      startedAt: 10,
      completedAt: 12,
      scheduledFor: null,
      updatedAt: 12,
    },
  });
  vi.mocked(api.streamChat).mockResolvedValue(undefined);
}

function getShell(container: HTMLElement) {
  const shell = container.querySelector(".app-shell");
  expect(shell).not.toBeNull();
  return within(shell as HTMLElement);
}

describe("App frontend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaults();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the chat cockpit by default and removes the overview tab", async () => {
    const { container } = render(<App />);
    const shell = getShell(container);
    const user = userEvent.setup();

    await shell.findByRole("heading", { name: firstConversation.title });
    expect(shell.queryByRole("button", { name: "개요" })).not.toBeInTheDocument();
    expect(await shell.findByRole("heading", { name: "어떤 작업을 시작할까요?" })).toBeInTheDocument();
    expect(await shell.findByLabelText("워크플로우 관제 패널")).toBeInTheDocument();
    expect(container.querySelector(".cockpit-chat-card__tabs")).not.toBeInTheDocument();
    expect(container.querySelector(".chat-panel__current-model")).not.toBeInTheDocument();
    expect(shell.queryByRole("button", { name: "프로바이더" })).not.toBeInTheDocument();

    await user.click(await shell.findByRole("button", { name: "워크플로우" }));

    expect(await shell.findByRole("heading", { name: "워크플로우 관제" })).toBeInTheDocument();
    expect(await shell.findByRole("heading", { name: "Outline으로 빠르게 만들기" })).toBeInTheDocument();
  });

  it("opens the settings tab as a cockpit page with working settings actions", async () => {
    const { container } = render(<App />);
    const shell = getShell(container);
    const user = userEvent.setup();

    await shell.findByRole("heading", { name: firstConversation.title });
    await user.click(await shell.findByRole("button", { name: "설정 탭" }));

    expect(await shell.findByRole("heading", { name: "로컬 실행 환경을 한곳에서 관리합니다" })).toBeInTheDocument();
    expect(await shell.findByRole("heading", { name: "opencode 엔진" })).toBeInTheDocument();
    expect(await shell.findByRole("heading", { name: "API / OAuth 연결" })).toBeInTheDocument();
    expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument();
    const settingsRegion = await shell.findByRole("region", { name: "설정 탭" });
    const settingsControls = within(settingsRegion);

    await user.click(settingsControls.getByRole("button", { name: "상태 새로고침" }));
    await waitFor(() => {
      expect(api.getEngineStatus).toHaveBeenCalled();
    });

    await user.click(settingsControls.getByRole("button", { name: "API 연결 관리" }));
    expect(await waitFor(() => container.querySelector('[role="dialog"]'))).toBeInTheDocument();
  });

  it("opens the standing orders tab in agent settings", async () => {
    const { container } = render(<App />);
    const shell = getShell(container);
    const user = userEvent.setup();

    await shell.findByRole("heading", { name: firstConversation.title });
    await user.click(container.querySelector(".conversation-list__action-button") as HTMLElement);

    const dialog = await waitFor(() => {
      const node = container.querySelector('[role="dialog"]');
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });

    expect(within(dialog).getByRole("heading", { name: "상시 지침" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("상시 지침 내용")).toBeInTheDocument();
  });

  it("saves standing orders from the agent settings dialog", async () => {
    const { container } = render(<App />);
    const shell = getShell(container);
    const user = userEvent.setup();

    await shell.findByRole("heading", { name: firstConversation.title });
    await user.click(container.querySelector(".conversation-list__action-button") as HTMLElement);

    const dialog = await waitFor(() => {
      const node = container.querySelector('[role="dialog"]');
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });

    await user.click(within(dialog).getByRole("button", { name: "상시 지침 저장" }));

    await waitFor(() => {
      expect(api.saveAgentStandingOrders).toHaveBeenCalledWith(defaultAgent.id, {
        content: "# orders",
      });
    });
  });
});
