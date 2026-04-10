import { render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as api from "./api";
import type {
  ConversationRecord,
  ProviderSummary,
  WorkspaceRunRecord,
  WorkspaceScope,
  WorkspaceTreeNode,
} from "./types";

vi.mock("./api", () => ({
  deleteConversation: vi.fn(),
  getConversationMessages: vi.fn(),
  getWorkspaceFile: vi.fn(),
  getWorkspaceTree: vi.fn(),
  importCodexCliAuth: vi.fn(),
  listConversations: vi.fn(),
  listModels: vi.fn(),
  listProviders: vi.fn(),
  listWorkspaceRunEvents: vi.fn(),
  listWorkspaceRuns: vi.fn(),
  logoutCodex: vi.fn(),
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
    configured: false,
    status: "disconnected",
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

const conversationA: ConversationRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "첫 번째 대화",
  providerKind: "openai",
  model: "gpt-5.4",
  reasoningLevel: "high",
  createdAt: 1,
  updatedAt: 2,
};

const conversationB: ConversationRecord = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "두 번째 대화",
  providerKind: "openai",
  model: "gpt-5.4",
  reasoningLevel: "high",
  createdAt: 3,
  updatedAt: 4,
};

const run1: WorkspaceRunRecord = {
  id: "run-1",
  conversationId: conversationA.id,
  providerKind: "openai",
  model: "gpt-5.4",
  userMessage: "첫 번째 실행",
  status: "completed",
  createdAt: 10,
  updatedAt: 10,
};

const run2: WorkspaceRunRecord = {
  id: "run-2",
  conversationId: conversationA.id,
  providerKind: "openai",
  model: "gpt-5.4",
  userMessage: "두 번째 실행",
  status: "completed",
  createdAt: 11,
  updatedAt: 11,
};

const run3: WorkspaceRunRecord = {
  id: "run-3",
  conversationId: conversationA.id,
  providerKind: "openai",
  model: "gpt-5.4",
  userMessage: "세 번째 실행",
  status: "completed",
  createdAt: 12,
  updatedAt: 12,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function mockDefaults() {
  vi.mocked(api.listProviders).mockResolvedValue({ providers });
  vi.mocked(api.listModels).mockResolvedValue({ models: ["gpt-5.4", "gpt-5.4-mini"] });
  vi.mocked(api.listConversations).mockResolvedValue({ conversations: [conversationA] });
  vi.mocked(api.getConversationMessages).mockResolvedValue({ conversation: conversationA, messages: [] });
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

describe("App workspace state sync", () => {
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

    expect(await shell.findByRole("heading", { name: "첫 번째 대화" })).toBeInTheDocument();
    await user.click(shell.getByRole("button", { name: "모델 선택: GPT-5.4" }));

    expect((await shell.findAllByRole("option", { name: /GPT-5\.4 Mini/i })).length).toBeGreaterThan(0);
    expect(shell.getByText("OpenAI Codex")).toBeInTheDocument();
    expect(shell.getAllByText("API 미설정").length).toBeGreaterThan(0);
    expect(shell.getByText("연결됨")).toBeInTheDocument();
  });

  it("clears workspace state when switching conversations", async () => {
    const treeB = deferred<{ scope: WorkspaceScope; path: string; tree: WorkspaceTreeNode[] }>();

    vi.mocked(api.listConversations).mockResolvedValue({ conversations: [conversationA, conversationB] });
    vi.mocked(api.getConversationMessages).mockImplementation(async (conversationId) => ({
      conversation: conversationId === conversationB.id ? conversationB : conversationA,
      messages: [],
    }));
    vi.mocked(api.getWorkspaceTree).mockImplementation(async ({ conversationId }) => {
      if (conversationId === conversationA.id) {
        return {
          scope: "sandbox",
          path: ".",
          tree: [{ name: "a.txt", path: "a.txt", kind: "file", size: 1 }],
        };
      }

      return treeB.promise;
    });
    vi.mocked(api.listWorkspaceRuns).mockImplementation(async (conversationId) => ({
      runs: conversationId === conversationA.id ? [run1] : [],
    }));

    const { container } = render(<App />);
    const user = userEvent.setup();
    const shell = getShell(container);

    expect(await shell.findByRole("heading", { name: "첫 번째 대화" })).toBeInTheDocument();
    await user.click(shell.getByRole("button", { name: "워크스페이스" }));

    expect(await shell.findByRole("button", { name: "a.txt" })).toBeInTheDocument();
    expect(await shell.findByRole("button", { name: /첫 번째 실행/ })).toHaveAttribute("aria-pressed", "true");

    await user.click(getConversationButton(shell, "두 번째 대화"));

    expect(shell.queryByRole("button", { name: "a.txt" })).not.toBeInTheDocument();
    expect(shell.queryByRole("button", { name: /첫 번째 실행/ })).not.toBeInTheDocument();

    treeB.resolve({
      scope: "sandbox",
      path: ".",
      tree: [{ name: "b.txt", path: "b.txt", kind: "file", size: 1 }],
    });

    expect(await shell.findByRole("button", { name: "b.txt" })).toBeInTheDocument();
  });

  it("ignores stale workspace tree responses from a previous conversation", async () => {
    const treeA = deferred<{ scope: WorkspaceScope; path: string; tree: WorkspaceTreeNode[] }>();
    const treeB = deferred<{ scope: WorkspaceScope; path: string; tree: WorkspaceTreeNode[] }>();

    vi.mocked(api.listConversations).mockResolvedValue({ conversations: [conversationA, conversationB] });
    vi.mocked(api.getConversationMessages).mockImplementation(async (conversationId) => ({
      conversation: conversationId === conversationB.id ? conversationB : conversationA,
      messages: [],
    }));
    vi.mocked(api.getWorkspaceTree).mockImplementation(async ({ conversationId }) => {
      if (conversationId === conversationB.id) {
        return treeB.promise;
      }
      return treeA.promise;
    });

    const { container } = render(<App />);
    const user = userEvent.setup();
    const shell = getShell(container);

    expect(await shell.findByRole("heading", { name: "첫 번째 대화" })).toBeInTheDocument();
    await user.click(shell.getByRole("button", { name: "워크스페이스" }));
    await user.click(getConversationButton(shell, "두 번째 대화"));

    treeB.resolve({
      scope: "sandbox",
      path: ".",
      tree: [{ name: "b.txt", path: "b.txt", kind: "file", size: 1 }],
    });

    expect(await shell.findByRole("button", { name: "b.txt" })).toBeInTheDocument();

    treeA.resolve({
      scope: "sandbox",
      path: ".",
      tree: [{ name: "a.txt", path: "a.txt", kind: "file", size: 1 }],
    });

    await waitFor(() => {
      expect(shell.getByRole("button", { name: "b.txt" })).toBeInTheDocument();
      expect(shell.queryByRole("button", { name: "a.txt" })).not.toBeInTheDocument();
    });
  });

  it("keeps a manually selected run stable after stream completion and refresh", async () => {
    vi.mocked(api.listWorkspaceRuns).mockResolvedValue({ runs: [run1, run2] });
    vi.mocked(api.streamChat).mockImplementation(async (_payload, onEvent) => {
      onEvent("delta", { delta: "안녕하세요" });
      onEvent("run_complete", { runId: run3.id, changedFiles: [] });
      onEvent("done", { messageId: "assistant-1", runId: run3.id, changedFiles: [] });
    });

    const { container } = render(<App />);
    const user = userEvent.setup();
    const shell = getShell(container);

    expect(await shell.findByRole("heading", { name: "첫 번째 대화" })).toBeInTheDocument();
    await user.click(shell.getByRole("button", { name: "워크스페이스" }));
    expect(await shell.findByRole("button", { name: /첫 번째 실행/ })).toBeInTheDocument();
    await user.click(shell.getByRole("button", { name: /두 번째 실행/ }));

    await user.type(shell.getByPlaceholderText("후속 변경 사항을 입력하세요"), "작업해줘");
    await user.click(shell.getByRole("button", { name: "메시지 보내기" }));

    await waitFor(() => {
      expect(shell.getByRole("button", { name: /두 번째 실행/ })).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("does not render absolute host paths from workspace payloads", async () => {
    vi.mocked(api.getWorkspaceTree).mockResolvedValue({
      scope: "sandbox",
      path: ".",
      tree: [{ name: "safe.txt", path: "safe.txt", kind: "file", size: 1 }],
    });

    const { container } = render(<App />);
    const user = userEvent.setup();
    const shell = getShell(container);

    expect(await shell.findByRole("heading", { name: "첫 번째 대화" })).toBeInTheDocument();
    await user.click(shell.getByRole("button", { name: "워크스페이스" }));

    expect(await shell.findByRole("button", { name: "safe.txt" })).toBeInTheDocument();
    expect(shell.queryByText(/D:\\/)).not.toBeInTheDocument();
  });
});
