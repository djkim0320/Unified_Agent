import "@testing-library/jest-dom/vitest";
import { render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as api from "./api";
import type {
  AgentRecord,
  ConversationRecord,
  ProviderSummary,
  TaskRecord,
  WorkspaceRunRecord,
  WorkspaceScope,
  WorkspaceTreeNode,
} from "./types";

vi.mock("./api", () => ({
  cancelAgentTask: vi.fn(),
  createAgentTask: vi.fn(),
  deleteConversation: vi.fn(),
  getAgentMemory: vi.fn(),
  getConversationMessages: vi.fn(),
  getWorkspaceFile: vi.fn(),
  getWorkspaceTree: vi.fn(),
  importCodexCliAuth: vi.fn(),
  listAgentTasks: vi.fn(),
  listAgents: vi.fn(),
  listConversations: vi.fn(),
  listModels: vi.fn(),
  listProviders: vi.fn(),
  listTaskEvents: vi.fn(),
  listWorkspaceRunEvents: vi.fn(),
  listWorkspaceRuns: vi.fn(),
  logoutCodex: vi.fn(),
  saveAgent: vi.fn(),
  saveConversation: vi.fn(),
  saveProviderAccount: vi.fn(),
  startCodexOAuth: vi.fn(),
  streamChat: vi.fn(),
  testProvider: vi.fn(),
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

const defaultAgent: AgentRecord = {
  id: "default-agent",
  name: "기본 에이전트",
  providerKind: "openai",
  model: "gpt-5.4",
  reasoningLevel: "high",
  createdAt: 1,
  updatedAt: 1,
};

const researchAgent: AgentRecord = {
  id: "research-agent",
  name: "리서치 에이전트",
  providerKind: "anthropic",
  model: "claude-sonnet-4-6",
  reasoningLevel: "medium",
  createdAt: 2,
  updatedAt: 2,
};

const firstConversation: ConversationRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  agentId: defaultAgent.id,
  channelKind: "webchat",
  title: "첫 세션",
  providerKind: "openai",
  model: "gpt-5.4",
  reasoningLevel: "high",
  createdAt: 1,
  updatedAt: 2,
};

const researchConversation: ConversationRecord = {
  id: "22222222-2222-4222-8222-222222222222",
  agentId: researchAgent.id,
  channelKind: "webchat",
  title: "리서치 세션",
  providerKind: "anthropic",
  model: "claude-sonnet-4-6",
  reasoningLevel: "medium",
  createdAt: 3,
  updatedAt: 4,
};

const run1: WorkspaceRunRecord = {
  id: "run-1",
  conversationId: firstConversation.id,
  taskId: null,
  providerKind: "openai",
  model: "gpt-5.4",
  userMessage: "첫 실행",
  status: "completed",
  createdAt: 10,
  updatedAt: 10,
};

const run2: WorkspaceRunRecord = {
  id: "run-2",
  conversationId: firstConversation.id,
  taskId: null,
  providerKind: "openai",
  model: "gpt-5.4",
  userMessage: "두 번째 실행",
  status: "completed",
  createdAt: 11,
  updatedAt: 11,
};

const runningTask: TaskRecord = {
  id: "task-running",
  agentId: defaultAgent.id,
  conversationId: firstConversation.id,
  runId: null,
  title: "Background task",
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
};

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    agentId: defaultAgent.id,
    conversationId: firstConversation.id,
    runId: null,
    title: "백그라운드 작업",
    prompt: "조사해줘",
    providerKind: "openai",
    model: "gpt-5.4",
    reasoningLevel: "high",
    status: "queued",
    resultText: null,
    createdAt: 10,
    startedAt: null,
    completedAt: null,
    scheduledFor: null,
    updatedAt: 10,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function mockDefaults() {
  vi.mocked(api.listAgents).mockResolvedValue({ agents: [defaultAgent] });
  vi.mocked(api.listProviders).mockResolvedValue({ providers });
  vi.mocked(api.listModels).mockImplementation(async (kind) => ({
    models:
      kind === "anthropic"
        ? ["claude-sonnet-4-6", "claude-opus-4-6"]
        : ["gpt-5.4", "gpt-5.4-mini"],
  }));
  vi.mocked(api.listConversations).mockResolvedValue({ conversations: [firstConversation] });
  vi.mocked(api.getConversationMessages).mockResolvedValue({
    conversation: firstConversation,
    messages: [],
  });
  vi.mocked(api.saveConversation).mockResolvedValue({ conversation: firstConversation });
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
  vi.mocked(api.listWorkspaceRuns).mockResolvedValue({ runs: [] });
  vi.mocked(api.listWorkspaceRunEvents).mockResolvedValue({ events: [] });
  vi.mocked(api.listAgentTasks).mockResolvedValue({ tasks: [] });
  vi.mocked(api.listTaskEvents).mockResolvedValue({ events: [] });
  vi.mocked(api.getAgentMemory).mockResolvedValue({
    memory: {
      agentId: defaultAgent.id,
      durableMemoryPath: "MEMORY.md",
      durableMemory: "# MEMORY\n",
      dailyMemoryPath: "memory/2026-04-11.md",
      dailyMemory: "# 2026-04-11\n",
    },
  });
  vi.mocked(api.cancelAgentTask).mockResolvedValue({
    task: {
      ...runningTask,
      status: "cancelled",
      completedAt: 12,
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

function getConversationButton(shell: ReturnType<typeof within>, title: string) {
  const titleNode = shell.getByText(title);
  const button = titleNode.closest("button");
  expect(button).not.toBeNull();
  return button as HTMLButtonElement;
}

describe("App agent platform UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaults();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows Korean UI and grouped model options", async () => {
    const { container } = render(<App />);
    const user = userEvent.setup();
    const shell = getShell(container);

    await waitFor(() => {
      expect(api.getConversationMessages).toHaveBeenCalled();
    });
    expect(shell.getByText("마인드풀 워크스페이스")).toBeInTheDocument();
    expect(await shell.findByRole("heading", { name: firstConversation.title })).toBeInTheDocument();

    await user.click(shell.getByRole("button", { name: /모델 선택/ }));

    expect(shell.getAllByText("OpenAI").length).toBeGreaterThan(0);
    expect(shell.getAllByText("Anthropic").length).toBeGreaterThan(0);
    expect((await shell.findAllByRole("option", { name: /GPT-5\.4 Mini/ })).length).toBeGreaterThan(0);
    expect(shell.getByText("연결됨")).toBeInTheDocument();
  });

  it("clears workspace state when switching conversations", async () => {
    const treeB = deferred<{ scope: WorkspaceScope; path: string; tree: WorkspaceTreeNode[] }>();

    vi.mocked(api.listConversations).mockResolvedValue({
      conversations: [firstConversation, { ...firstConversation, id: "33333333-3333-4333-8333-333333333333", title: "두 번째 세션" }],
    });
    vi.mocked(api.getConversationMessages).mockImplementation(async (conversationId) => ({
      conversation: conversationId === firstConversation.id ? firstConversation : { ...firstConversation, id: "33333333-3333-4333-8333-333333333333", title: "두 번째 세션" },
      messages: [],
    }));
    vi.mocked(api.getWorkspaceTree).mockImplementation(async ({ conversationId }) => {
      if (conversationId === firstConversation.id) {
        return {
          scope: "sandbox",
          path: ".",
          tree: [{ name: "a.txt", path: "a.txt", kind: "file", size: 1 }],
        };
      }
      return treeB.promise;
    });
    vi.mocked(api.listWorkspaceRuns).mockImplementation(async (conversationId) => ({
      runs: conversationId === firstConversation.id ? [run1] : [],
    }));

    const { container } = render(<App />);
    const user = userEvent.setup();
    const shell = getShell(container);

    await user.click(shell.getByRole("button", { name: "워크스페이스" }));
    expect(await shell.findByRole("button", { name: "a.txt" })).toBeInTheDocument();
    expect(await shell.findByRole("button", { name: /첫 실행/ })).toHaveAttribute("aria-pressed", "true");

    await user.click(getConversationButton(shell, "두 번째 세션"));
    expect(shell.queryByRole("button", { name: "a.txt" })).not.toBeInTheDocument();

    treeB.resolve({
      scope: "sandbox",
      path: ".",
      tree: [{ name: "b.txt", path: "b.txt", kind: "file", size: 1 }],
    });

    expect(await shell.findByRole("button", { name: "b.txt" })).toBeInTheDocument();
  });

  it("switches agent-scoped sessions, tasks, and memory together", async () => {
    const researchTask = makeTask({
      id: "research-task",
      agentId: researchAgent.id,
      conversationId: researchConversation.id,
      title: "리서치 작업",
      prompt: "collect notes",
      providerKind: "anthropic",
      model: "claude-sonnet-4-6",
      reasoningLevel: "medium",
    });

    vi.mocked(api.listAgents).mockResolvedValue({ agents: [defaultAgent, researchAgent] });
    vi.mocked(api.listConversations).mockImplementation(async (_signal, agentId) => ({
      conversations: agentId === researchAgent.id ? [researchConversation] : [firstConversation],
    }));
    vi.mocked(api.getConversationMessages).mockImplementation(async (conversationId) => ({
      conversation: conversationId === researchConversation.id ? researchConversation : firstConversation,
      messages: [],
    }));
    vi.mocked(api.listAgentTasks).mockImplementation(async (agentId) => ({
      tasks: agentId === researchAgent.id ? [researchTask] : [],
    }));
    vi.mocked(api.getAgentMemory).mockImplementation(async (agentId) => ({
      memory: {
        agentId,
        durableMemoryPath: "MEMORY.md",
        durableMemory: agentId === researchAgent.id ? "Research preferences" : "Default memory",
        dailyMemoryPath: "memory/2026-04-11.md",
        dailyMemory: "",
      },
    }));

    const { container } = render(<App />);
    const user = userEvent.setup();
    const shell = getShell(container);

    await shell.findByRole("option", { name: researchAgent.name });
    await user.selectOptions(shell.getByRole("combobox"), researchAgent.id);
    await user.click(shell.getByRole("button", { name: "워크스페이스" }));

    expect(await shell.findByRole("heading", { name: "리서치 세션" })).toBeInTheDocument();
    expect(await shell.findByText("리서치 작업")).toBeInTheDocument();
    expect(await shell.findByText("Research preferences")).toBeInTheDocument();
    expect(shell.queryByText(firstConversation.title)).not.toBeInTheDocument();
  });

  it("shows selected task events and cancels a running task", async () => {
    vi.mocked(api.listAgentTasks).mockResolvedValue({ tasks: [runningTask] });
    vi.mocked(api.listTaskEvents).mockResolvedValue({
      events: [
        {
          id: "task-event-1",
          taskId: runningTask.id,
          eventType: "running",
          payload: { note: "started" },
          createdAt: 11,
        },
      ],
    });

    const { container } = render(<App />);
    const user = userEvent.setup();
    const shell = getShell(container);

    await user.click(shell.getByRole("button", { name: "워크스페이스" }));
    await user.click(await shell.findByRole("button", { name: /Background task/ }));

    expect(await shell.findByText(/started/)).toBeInTheDocument();

    await user.click(shell.getByRole("button", { name: "취소" }));

    await waitFor(() => {
      expect(api.cancelAgentTask).toHaveBeenCalledWith(defaultAgent.id, runningTask.id);
    });
  });
});
