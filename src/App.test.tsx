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
  HeartbeatLogRecord,
  PlatformMetadata,
  ProviderSummary,
  TaskFlowRecord,
  TaskFlowStepRecord,
  WorkspaceRunEventRecord,
  WorkspaceRunRecord,
} from "./types";

vi.mock("./api", () => ({
  cancelAgentTask: vi.fn(),
  cancelSubagentSession: vi.fn(),
  cancelTaskFlow: vi.fn(),
  createAgentTask: vi.fn(),
  createSubagentSession: vi.fn(),
  createTaskFlow: vi.fn(),
  deleteAgent: vi.fn(),
  deleteConversation: vi.fn(),
  getAgentHeartbeat: vi.fn(),
  getAgentMemory: vi.fn(),
  getAgentSoul: vi.fn(),
  getAgentStandingOrders: vi.fn(),
  getConversationMessages: vi.fn(),
  getTaskFlow: vi.fn(),
  getWorkspaceFile: vi.fn(),
  getWorkspaceTree: vi.fn(),
  importCodexCliAuth: vi.fn(),
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
  saveAgent: vi.fn(),
  saveAgentHeartbeat: vi.fn(),
  saveAgentSoul: vi.fn(),
  saveAgentStandingOrders: vi.fn(),
  saveConversation: vi.fn(),
  saveProviderAccount: vi.fn(),
  searchAgentMemory: vi.fn(),
  startCodexOAuth: vi.fn(),
  streamChat: vi.fn(),
  testProvider: vi.fn(),
  triggerAgentHeartbeat: vi.fn(),
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

const platformMetadata: PlatformMetadata = {
  plugins: [],
  tools: [
    {
      name: "list_tree",
      description: "List files.",
      permission: "workspace",
      risk: "low",
      costHint: null,
      concurrencyClass: "single",
      batchable: true,
      rolePolicy: null,
    },
  ],
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

const selectedFlowSteps: TaskFlowStepRecord[] = [
  {
    id: "step-1",
    flowId: "flow-1",
    stepKey: "step-1",
    title: "Step 1",
    prompt: "Do the thing",
    dependencyStepKey: null,
    status: "queued",
    taskId: null,
    createdAt: 1,
    updatedAt: 1,
  },
];

const selectedFlow: TaskFlowRecord = {
  id: "flow-1",
  agentId: defaultAgent.id,
  conversationId: firstConversation.id,
  title: "Research flow",
  status: "running",
  createdAt: 1,
  updatedAt: 2,
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
  vi.mocked(api.saveAgent).mockResolvedValue({ agent: defaultAgent });
  vi.mocked(api.saveAgentSoul).mockResolvedValue({ soul: defaultAgentSoul });
  vi.mocked(api.saveAgentHeartbeat).mockResolvedValue({ heartbeat: defaultAgentHeartbeat });
  vi.mocked(api.saveAgentStandingOrders).mockResolvedValue({
    standingOrders: { path: "standing-orders.md", content: "# orders" },
  });
  vi.mocked(api.saveConversation).mockResolvedValue({ conversation: firstConversation });
  vi.mocked(api.getAgentStandingOrders).mockResolvedValue({
    standingOrders: { path: "standing-orders.md", content: "# orders" },
  });
  vi.mocked(api.getAgentMemory).mockResolvedValue({
    memory: {
      agentId: defaultAgent.id,
      durableMemoryPath: "MEMORY.md",
      durableMemory: "# MEMORY\n",
      dailyMemoryPath: "memory/2026-04-11.md",
      dailyMemory: "# 2026-04-11\n",
    },
  });
  vi.mocked(api.searchAgentMemory).mockResolvedValue({ results: [] });
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
  vi.mocked(api.listHeartbeatLogs).mockResolvedValue({ logs: defaultHeartbeatLogs });
  vi.mocked(api.triggerAgentHeartbeat).mockResolvedValue({
    message: "Heartbeat ran.",
    heartbeat: defaultAgentHeartbeat,
    heartbeatLog: defaultHeartbeatLogs[0],
  });
  vi.mocked(api.listWorkspaceRuns).mockResolvedValue({ runs: [latestRun] });
  vi.mocked(api.listWorkspaceRunEvents).mockResolvedValue({ events: latestRunEvents });
  vi.mocked(api.getWorkspaceTree).mockResolvedValue({ scope: "sandbox", path: ".", tree: [] });
  vi.mocked(api.getWorkspaceFile).mockResolvedValue({
    file: {
      scope: "sandbox",
      path: "README.md",
      content: "# README",
      binary: false,
      unsupportedEncoding: false,
      encoding: "utf-8",
    },
  });
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
  vi.mocked(api.cancelAgentTask).mockResolvedValue({
    task: {
      id: "task-running",
      agentId: defaultAgent.id,
      conversationId: firstConversation.id,
      runId: null,
      taskFlowId: null,
      flowStepKey: null,
      originRunId: null,
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

  it("renders the workspace control-plane cards", async () => {
    const { container } = render(<App />);
    const shell = getShell(container);
    const user = userEvent.setup();

    await shell.findByRole("heading", { name: firstConversation.title });
    const tabs = container.querySelectorAll<HTMLButtonElement>(".chat-panel__tab");
    await user.click(tabs[1]!);

    expect(await shell.findByText("Memory search")).toBeInTheDocument();
    expect(await shell.findByText("Sub-agent sessions")).toBeInTheDocument();
    expect(await shell.findByText("Task flows")).toBeInTheDocument();
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

    await user.click(within(dialog).getByRole("button", { name: "Standing Orders" }));
    expect(within(dialog).getByRole("heading", { name: "Standing Orders" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Standing orders content")).toBeInTheDocument();
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

    await user.click(within(dialog).getByRole("button", { name: "Standing Orders" }));
    await user.click(within(dialog).getByRole("button", { name: "Save standing orders" }));

    await waitFor(() => {
      expect(api.saveAgentStandingOrders).toHaveBeenCalledWith(defaultAgent.id, {
        content: "# orders",
      });
    });
  });
});
