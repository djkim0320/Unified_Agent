import { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelAgentTask,
  deleteConversation,
  createAgentTask,
  getAgentMemory,
  getConversationMessages,
  getWorkspaceFile,
  getWorkspaceTree,
  importCodexCliAuth,
  listAgentTasks,
  listAgents,
  listConversations,
  listModels,
  listProviders,
  listTaskEvents,
  listWorkspaceRunEvents,
  listWorkspaceRuns,
  logoutCodex,
  saveAgent,
  saveConversation,
  saveProviderAccount,
  startCodexOAuth,
  streamChat,
  testProvider,
} from "./api";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { ConversationList } from "./components/ConversationList";
import { ProviderSettingsDialog } from "./components/ProviderSettingsDialog";
import { WorkspaceView } from "./components/WorkspaceView";
import { getModelOption } from "./model-catalog";
import { getReasoningLabel, normalizeReasoningLevel } from "./reasoning-options";
import {
  defaultModels,
  defaultReasoningLevels,
  providerKinds,
  providerLabels,
  type AgentMemoryRecord,
  type AgentRecord,
  type ConversationRecord,
  type DisplayMessage,
  type ProviderDraft,
  type ProviderKind,
  type ProviderSummary,
  type StreamEventPayloadMap,
  type TaskEventRecord,
  type TaskRecord,
  type WorkspaceFileRecord,
  type WorkspaceRunEventRecord,
  type WorkspaceRunRecord,
  type WorkspaceScope,
  type WorkspaceTreeNode,
} from "./types";

function createEmptyDrafts(): Record<ProviderKind, ProviderDraft> {
  return {
    openai: { apiKey: "", baseUrl: "" },
    anthropic: { apiKey: "", baseUrl: "" },
    gemini: { apiKey: "", baseUrl: "" },
    ollama: { apiKey: "", baseUrl: "http://127.0.0.1:11434" },
    "openai-codex": { apiKey: "", baseUrl: "" },
  };
}

function createModelMap() {
  return {
    openai: [defaultModels.openai],
    anthropic: [defaultModels.anthropic],
    gemini: [defaultModels.gemini],
    ollama: [defaultModels.ollama],
    "openai-codex": [defaultModels["openai-codex"]],
  } satisfies Record<ProviderKind, string[]>;
}

function createLoadingMap(initialValue: boolean) {
  return {
    openai: initialValue,
    anthropic: initialValue,
    gemini: initialValue,
    ollama: initialValue,
    "openai-codex": initialValue,
  } satisfies Record<ProviderKind, boolean>;
}

function createErrorMap(): Record<ProviderKind, string | null> {
  return {
    openai: null,
    anthropic: null,
    gemini: null,
    ollama: null,
    "openai-codex": null,
  } satisfies Record<ProviderKind, string | null>;
}

function mergeConversationList(
  conversations: ConversationRecord[],
  conversation: ConversationRecord,
) {
  return [...conversations.filter((item) => item.id !== conversation.id), conversation].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
}

function mergeProviderDrafts(
  providers: ProviderSummary[],
  currentDrafts: Record<ProviderKind, ProviderDraft>,
) {
  const nextDrafts = createEmptyDrafts();

  for (const provider of providers) {
    if (provider.kind === "ollama") {
      const metadataBaseUrl =
        typeof provider.metadata.baseUrl === "string" ? provider.metadata.baseUrl : "";
      nextDrafts.ollama.baseUrl =
        currentDrafts.ollama.baseUrl || metadataBaseUrl || "http://127.0.0.1:11434";
      continue;
    }

    nextDrafts[provider.kind].apiKey = currentDrafts[provider.kind].apiKey;
  }

  return nextDrafts;
}

function getOptimisticMessageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `temp-${Date.now()}`;
}

function isProviderEnabled(provider: ProviderSummary | null | undefined) {
  return Boolean(provider && (provider.configured || provider.status !== "disconnected"));
}

function pickConversationProvider(
  providers: ProviderSummary[],
  preferredProviderKind?: ProviderKind,
) {
  if (preferredProviderKind) {
    return preferredProviderKind;
  }

  const firstEnabled = providers.find((provider) => isProviderEnabled(provider));
  return firstEnabled?.kind ?? "openai";
}

function createLiveEvent(
  eventType: WorkspaceRunEventRecord["eventType"],
  payload: Record<string, unknown>,
) {
  return {
    id: `live-${Date.now()}-${Math.random()}`,
    runId: "live",
    eventType,
    payload,
    createdAt: Date.now(),
  } satisfies WorkspaceRunEventRecord;
}

function abortRef(controllerRef: { current: AbortController | null }) {
  controllerRef.current?.abort();
  controllerRef.current = null;
}

function beginRequest(
  seqRef: { current: number },
  controllerRef: { current: AbortController | null },
) {
  abortRef(controllerRef);
  const controller = new AbortController();
  controllerRef.current = controller;
  seqRef.current += 1;
  return {
    controller,
    seq: seqRef.current,
  };
}

export default function App() {
  const [activeSection, setActiveSection] = useState<"chat" | "workspace">("chat");
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [activeAgent, setActiveAgent] = useState<AgentRecord | null>(null);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<ConversationRecord | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [modelsByProvider, setModelsByProvider] =
    useState<Record<ProviderKind, string[]>>(createModelMap);
  const [modelsLoadingByProvider, setModelsLoadingByProvider] =
    useState<Record<ProviderKind, boolean>>(createLoadingMap(false));
  const [modelErrorsByProvider, setModelErrorsByProvider] =
    useState<Record<ProviderKind, string | null>>(createErrorMap);
  const [composerText, setComposerText] = useState("");
  const [pendingAssistantText, setPendingAssistantText] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [appNotice, setAppNotice] = useState<string | null>(null);
  const [providerDrafts, setProviderDrafts] = useState<Record<ProviderKind, ProviderDraft>>(
    createEmptyDrafts(),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingKind, setSavingKind] = useState<ProviderKind | null>(null);
  const [testingKind, setTestingKind] = useState<ProviderKind | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [workspaceScope, setWorkspaceScope] = useState<WorkspaceScope>("sandbox");
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceTreeNode[]>([]);
  const [workspaceFile, setWorkspaceFile] = useState<WorkspaceFileRecord | null>(null);
  const [workspaceRuns, setWorkspaceRuns] = useState<WorkspaceRunRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [agentMemory, setAgentMemory] = useState<AgentMemoryRecord | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [workspaceRunEvents, setWorkspaceRunEvents] = useState<WorkspaceRunEventRecord[]>([]);
  const [taskEvents, setTaskEvents] = useState<TaskEventRecord[]>([]);
  const [liveEvents, setLiveEvents] = useState<WorkspaceRunEventRecord[]>([]);
  const [changedFiles, setChangedFiles] = useState<string[]>([]);
  const [workspaceTreeLoading, setWorkspaceTreeLoading] = useState(false);
  const [workspaceRunsLoading, setWorkspaceRunsLoading] = useState(false);
  const [workspaceFileLoading, setWorkspaceFileLoading] = useState(false);

  const activeConversationIdRef = useRef<string | null>(null);
  const activeAgentIdRef = useRef<string | null>(null);
  const selectedRunIdRef = useRef<string | null>(null);
  const selectedTaskIdRef = useRef<string | null>(null);
  const manualRunSelectionRef = useRef(false);
  const lastConversationIdRef = useRef<string | null>(null);
  const conversationListSeqRef = useRef(0);
  const conversationListControllerRef = useRef<AbortController | null>(null);
  const conversationLoadSeqRef = useRef(0);
  const conversationLoadControllerRef = useRef<AbortController | null>(null);
  const workspaceTreeSeqRef = useRef(0);
  const workspaceTreeControllerRef = useRef<AbortController | null>(null);
  const workspaceRunsSeqRef = useRef(0);
  const workspaceRunsControllerRef = useRef<AbortController | null>(null);
  const tasksSeqRef = useRef(0);
  const tasksControllerRef = useRef<AbortController | null>(null);
  const taskEventsSeqRef = useRef(0);
  const taskEventsControllerRef = useRef<AbortController | null>(null);
  const memorySeqRef = useRef(0);
  const memoryControllerRef = useRef<AbortController | null>(null);
  const workspaceEventsSeqRef = useRef(0);
  const workspaceEventsControllerRef = useRef<AbortController | null>(null);
  const workspaceFileSeqRef = useRef(0);
  const workspaceFileControllerRef = useRef<AbortController | null>(null);
  const streamSeqRef = useRef(0);
  const streamControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    activeAgentIdRef.current = activeAgentId;
    setActiveAgent(agents.find((agent) => agent.id === activeAgentId) ?? null);
  }, [activeAgentId, agents]);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId;
  }, [selectedTaskId]);

  const providersByKind = useMemo(
    () =>
      Object.fromEntries(providers.map((provider) => [provider.kind, provider])) as Record<
        ProviderKind,
        ProviderSummary
      >,
    [providers],
  );

  function abortAllPendingRequests() {
    abortRef(conversationListControllerRef);
    abortConversationScopedRequests();
    abortRef(tasksControllerRef);
    abortRef(taskEventsControllerRef);
    abortRef(memoryControllerRef);
  }

  function abortConversationScopedRequests() {
    abortRef(conversationLoadControllerRef);
    abortRef(workspaceTreeControllerRef);
    abortRef(workspaceRunsControllerRef);
    abortRef(workspaceEventsControllerRef);
    abortRef(workspaceFileControllerRef);
    abortRef(streamControllerRef);
  }

  function resetConversationWorkspaceState() {
    setWorkspaceTree([]);
    setWorkspaceFile(null);
    setWorkspaceRuns([]);
    setSelectedRunId(null);
    setWorkspaceRunEvents([]);
    setLiveEvents([]);
    setChangedFiles([]);
    setWorkspaceTreeLoading(false);
    setWorkspaceRunsLoading(false);
    setWorkspaceFileLoading(false);
  }

  function resetWorkspaceState() {
    resetConversationWorkspaceState();
    setTasks([]);
    setAgentMemory(null);
    setSelectedTaskId(null);
    setTaskEvents([]);
  }

  async function refreshProviders() {
    const response = await listProviders();
    setProviders(response.providers);
    setProviderDrafts((currentDrafts) => mergeProviderDrafts(response.providers, currentDrafts));
  }

  async function refreshAgents(preferredAgentId?: string | null) {
    const response = await listAgents();
    setAgents(response.agents);
    const nextAgentId =
      preferredAgentId && response.agents.some((agent) => agent.id === preferredAgentId)
        ? preferredAgentId
        : response.agents[0]?.id ?? null;
    setActiveAgentId(nextAgentId);
    setActiveAgent(response.agents.find((agent) => agent.id === nextAgentId) ?? null);
    return response.agents;
  }

  async function refreshConversationList(
    preferredConversationId?: string | null,
    agentId = activeAgentIdRef.current,
  ) {
    const request = beginRequest(conversationListSeqRef, conversationListControllerRef);

    try {
      const response = await listConversations(request.controller.signal, agentId);
      if (
        request.controller.signal.aborted ||
        conversationListSeqRef.current !== request.seq ||
        activeAgentIdRef.current !== agentId
      ) {
        return [];
      }

      setConversations(response.conversations);

      const nextId =
        preferredConversationId &&
        response.conversations.some((item) => item.id === preferredConversationId)
          ? preferredConversationId
          : response.conversations[0]?.id ?? null;

      setActiveConversationId(nextId);
      return response.conversations;
    } finally {
      if (conversationListSeqRef.current === request.seq) {
        abortRef(conversationListControllerRef);
      }
    }
  }

  async function createConversationThread(preferredProviderKind?: ProviderKind, preferredAgentId = activeAgentIdRef.current) {
    const agent = agents.find((item) => item.id === preferredAgentId) ?? activeAgent;
    const providerKind = preferredProviderKind ?? agent?.providerKind ?? pickConversationProvider(providers);
    const model = agent?.providerKind === providerKind ? agent.model : defaultModels[providerKind];
    const reasoningLevel = normalizeReasoningLevel(
      providerKind,
      model,
      agent?.providerKind === providerKind
        ? agent.reasoningLevel
        : defaultReasoningLevels[providerKind],
    );
    const response = await saveConversation({
      agentId: agent?.id ?? preferredAgentId ?? undefined,
      providerKind,
      model,
      reasoningLevel,
      title: "새 채팅",
    });

    setConversations((current) => mergeConversationList(current, response.conversation));
    setActiveConversation(response.conversation);
    setActiveConversationId(response.conversation.id);
    setMessages([]);
    setPendingAssistantText("");
    setChatError(null);
    setChangedFiles([]);
    return response.conversation;
  }

  async function loadConversation(conversationId: string) {
    const request = beginRequest(conversationLoadSeqRef, conversationLoadControllerRef);

    try {
      const response = await getConversationMessages(conversationId, request.controller.signal);
      if (request.controller.signal.aborted || conversationLoadSeqRef.current !== request.seq) {
        return;
      }

      setActiveConversation(response.conversation);
      setMessages(
        response.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
        })),
      );
      setConversations((current) => mergeConversationList(current, response.conversation));
    } catch (error) {
      if (request.controller.signal.aborted || conversationLoadSeqRef.current !== request.seq) {
        return;
      }

      setChatError(error instanceof Error ? error.message : "대화 내용을 불러오지 못했습니다.");
    } finally {
      if (conversationLoadSeqRef.current === request.seq) {
        abortRef(conversationLoadControllerRef);
      }
    }
  }
  async function refreshWorkspaceTree(conversationId: string, scope: WorkspaceScope) {
    const request = beginRequest(workspaceTreeSeqRef, workspaceTreeControllerRef);
    setWorkspaceTreeLoading(true);

    try {
      const response = await getWorkspaceTree({
        conversationId,
        scope,
        maxDepth: 4,
        signal: request.controller.signal,
      });

      if (request.controller.signal.aborted || workspaceTreeSeqRef.current !== request.seq) {
        return;
      }

      setWorkspaceTree(response.tree);
    } catch (error) {
      if (request.controller.signal.aborted || workspaceTreeSeqRef.current !== request.seq) {
        return;
      }

      setAppNotice(error instanceof Error ? error.message : "워크스페이스 트리를 불러오지 못했습니다.");
    } finally {
      if (workspaceTreeSeqRef.current === request.seq) {
        setWorkspaceTreeLoading(false);
        abortRef(workspaceTreeControllerRef);
      }
    }
  }

  async function refreshWorkspaceRuns(conversationId: string, preferredRunId?: string | null) {
    const request = beginRequest(workspaceRunsSeqRef, workspaceRunsControllerRef);
    setWorkspaceRunsLoading(true);

    try {
      const response = await listWorkspaceRuns(conversationId, request.controller.signal);
      if (request.controller.signal.aborted || workspaceRunsSeqRef.current !== request.seq) {
        return;
      }

      setWorkspaceRuns(response.runs);

      const currentSelectedRunId = selectedRunIdRef.current;
      const hasCurrentSelection =
        currentSelectedRunId !== null && response.runs.some((run) => run.id === currentSelectedRunId);
      const hasPreferredRun =
        preferredRunId !== undefined &&
        preferredRunId !== null &&
        response.runs.some((run) => run.id === preferredRunId);

      const nextRunId = hasCurrentSelection
        ? currentSelectedRunId
        : hasPreferredRun
          ? preferredRunId
          : response.runs[0]?.id ?? null;

      if (nextRunId !== currentSelectedRunId) {
        setSelectedRunId(nextRunId);
        manualRunSelectionRef.current = false;
      }

      if (nextRunId === null) {
        setWorkspaceRunEvents([]);
      }
    } catch (error) {
      if (request.controller.signal.aborted || workspaceRunsSeqRef.current !== request.seq) {
        return;
      }

      setAppNotice(error instanceof Error ? error.message : "실행 로그를 불러오지 못했습니다.");
    } finally {
      if (workspaceRunsSeqRef.current === request.seq) {
        setWorkspaceRunsLoading(false);
        abortRef(workspaceRunsControllerRef);
      }
    }
  }

  async function refreshAgentTasks(agentId: string) {
    const request = beginRequest(tasksSeqRef, tasksControllerRef);

    try {
      const response = await listAgentTasks(agentId, request.controller.signal);
      if (request.controller.signal.aborted || tasksSeqRef.current !== request.seq || activeAgentIdRef.current !== agentId) {
        return;
      }
      setTasks(response.tasks);

      const currentSelectedTaskId = selectedTaskIdRef.current;
      const nextSelectedTaskId =
        currentSelectedTaskId && response.tasks.some((task) => task.id === currentSelectedTaskId)
          ? currentSelectedTaskId
          : response.tasks[0]?.id ?? null;

      if (nextSelectedTaskId !== currentSelectedTaskId) {
        setSelectedTaskId(nextSelectedTaskId);
      }
    } catch (error) {
      if (request.controller.signal.aborted || tasksSeqRef.current !== request.seq) {
        return;
      }
      setAppNotice(error instanceof Error ? error.message : "태스크 목록을 불러오지 못했습니다.");
    } finally {
      if (tasksSeqRef.current === request.seq) {
        abortRef(tasksControllerRef);
      }
    }
  }

  async function refreshTaskEvents(agentId: string, taskId: string | null) {
    const request = beginRequest(taskEventsSeqRef, taskEventsControllerRef);

    if (!taskId) {
      setTaskEvents([]);
      abortRef(taskEventsControllerRef);
      return;
    }

    try {
      const response = await listTaskEvents(agentId, taskId, request.controller.signal);
      if (
        request.controller.signal.aborted ||
        taskEventsSeqRef.current !== request.seq ||
        activeAgentIdRef.current !== agentId ||
        selectedTaskIdRef.current !== taskId
      ) {
        return;
      }

      setTaskEvents(response.events);
    } catch (error) {
      if (request.controller.signal.aborted || taskEventsSeqRef.current !== request.seq) {
        return;
      }

      setAppNotice(error instanceof Error ? error.message : "태스크 이벤트를 불러오지 못했습니다.");
    } finally {
      if (taskEventsSeqRef.current === request.seq) {
        abortRef(taskEventsControllerRef);
      }
    }
  }

  async function refreshAgentMemory(agentId: string) {
    const request = beginRequest(memorySeqRef, memoryControllerRef);

    try {
      const response = await getAgentMemory(agentId, request.controller.signal);
      if (request.controller.signal.aborted || memorySeqRef.current !== request.seq || activeAgentIdRef.current !== agentId) {
        return;
      }
      setAgentMemory(response.memory);
    } catch (error) {
      if (request.controller.signal.aborted || memorySeqRef.current !== request.seq) {
        return;
      }
      setAppNotice(error instanceof Error ? error.message : "메모리를 불러오지 못했습니다.");
    } finally {
      if (memorySeqRef.current === request.seq) {
        abortRef(memoryControllerRef);
      }
    }
  }

  async function refreshWorkspaceRunEvents(conversationId: string, runId: string | null) {
    const request = beginRequest(workspaceEventsSeqRef, workspaceEventsControllerRef);

    if (!runId) {
      setWorkspaceRunEvents([]);
      abortRef(workspaceEventsControllerRef);
      return;
    }

    try {
      const response = await listWorkspaceRunEvents(conversationId, runId, request.controller.signal);
      if (request.controller.signal.aborted || workspaceEventsSeqRef.current !== request.seq) {
        return;
      }

      setWorkspaceRunEvents(response.events);
    } catch (error) {
      if (request.controller.signal.aborted || workspaceEventsSeqRef.current !== request.seq) {
        return;
      }

      setAppNotice(error instanceof Error ? error.message : "실행 이벤트를 불러오지 못했습니다.");
    } finally {
      if (workspaceEventsSeqRef.current === request.seq) {
        abortRef(workspaceEventsControllerRef);
      }
    }
  }

  async function openWorkspaceFile(path: string) {
    if (!activeConversationId) {
      return;
    }

    const request = beginRequest(workspaceFileSeqRef, workspaceFileControllerRef);
    setWorkspaceFileLoading(true);

    try {
      const response = await getWorkspaceFile({
        conversationId: activeConversationId,
        scope: workspaceScope,
        path,
        signal: request.controller.signal,
      });

      if (request.controller.signal.aborted || workspaceFileSeqRef.current !== request.seq) {
        return;
      }

      setWorkspaceFile(response.file);
    } catch (error) {
      if (request.controller.signal.aborted || workspaceFileSeqRef.current !== request.seq) {
        return;
      }

      setAppNotice(error instanceof Error ? error.message : "파일을 불러오지 못했습니다.");
    } finally {
      if (workspaceFileSeqRef.current === request.seq) {
        setWorkspaceFileLoading(false);
        abortRef(workspaceFileControllerRef);
      }
    }
  }

  async function updateConversation(patch: Partial<ConversationRecord>) {
    if (!activeConversation) {
      return;
    }

    const providerKind = patch.providerKind ?? activeConversation.providerKind;
    const model = patch.model ?? activeConversation.model;
    const reasoningLevel = normalizeReasoningLevel(
      providerKind,
      model,
      patch.reasoningLevel ?? activeConversation.reasoningLevel,
    );

    const optimisticConversation: ConversationRecord = {
      ...activeConversation,
      ...patch,
      providerKind,
      model,
      reasoningLevel,
      updatedAt: Date.now(),
    };

    setActiveConversation(optimisticConversation);
    setConversations((current) => mergeConversationList(current, optimisticConversation));

    try {
      const response = await saveConversation({
        conversationId: activeConversation.id,
        agentId: activeConversation.agentId,
        title: optimisticConversation.title,
        providerKind,
        model,
        reasoningLevel,
      });
      setActiveConversation(response.conversation);
      setConversations((current) => mergeConversationList(current, response.conversation));
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "설정을 저장하지 못했습니다.");
    }
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await refreshProviders();
        await refreshAgents();
      } catch (error) {
        if (!cancelled) {
          setAppNotice(error instanceof Error ? error.message : "초기 데이터를 불러오지 못했습니다.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!providers.length) {
      return;
    }

    let cancelled = false;
    setModelsLoadingByProvider(createLoadingMap(true));

    void (async () => {
      const nextModels = createModelMap();
      const nextErrors = createErrorMap();

      await Promise.all(
        providerKinds.map(async (kind) => {
          try {
            const response = await listModels(kind);
            nextModels[kind] = response.models.length ? response.models : [defaultModels[kind]];
          } catch (error) {
            nextModels[kind] = [defaultModels[kind]];
            nextErrors[kind] =
              error instanceof Error ? error.message : `${providerLabels[kind]} 모델을 불러오지 못했습니다.`;
          }
        }),
      );

      if (cancelled) {
        return;
      }

      setModelsByProvider(nextModels);
      setModelErrorsByProvider(nextErrors);
      setModelsLoadingByProvider(createLoadingMap(false));
    })();

    return () => {
      cancelled = true;
    };
  }, [providers]);

  useEffect(() => {
    if (!activeAgentId) {
      return;
    }

    abortAllPendingRequests();
    resetWorkspaceState();
    setActiveConversation(null);
    setActiveConversationId(null);
    setConversations([]);
    setMessages([]);
    setPendingAssistantText("");
    setChatError(null);
    manualRunSelectionRef.current = false;

    void (async () => {
      const loadedConversations = await refreshConversationList(null, activeAgentId);
      void refreshAgentTasks(activeAgentId);
      void refreshAgentMemory(activeAgentId);
      if (loadedConversations.length === 0) {
        await createConversationThread(undefined, activeAgentId);
      }
    })();
  }, [activeAgentId]);

  useEffect(() => {
    const conversationChanged = lastConversationIdRef.current !== activeConversationId;
    lastConversationIdRef.current = activeConversationId;

    if (conversationChanged) {
      abortConversationScopedRequests();
      resetConversationWorkspaceState();
      setActiveConversation(null);
      setMessages([]);
      setPendingAssistantText("");
      setChatError(null);
      setLiveEvents([]);
      setChangedFiles([]);
      setStreaming(false);
      manualRunSelectionRef.current = false;
    }

    if (!activeConversationId) {
      return;
    }

    void loadConversation(activeConversationId);
  }, [activeConversationId]);

  useEffect(() => {
    if (!activeConversationId) {
      return;
    }

    void refreshWorkspaceTree(activeConversationId, workspaceScope);
    void refreshWorkspaceRuns(activeConversationId, selectedRunIdRef.current);
    setWorkspaceFile(null);
  }, [activeConversationId, workspaceScope]);

  useEffect(() => {
    if (!activeConversationId) {
      setWorkspaceRunEvents([]);
      return;
    }

    void refreshWorkspaceRunEvents(activeConversationId, selectedRunId);
  }, [activeConversationId, selectedRunId]);

  useEffect(() => {
    if (!activeAgentId) {
      setTaskEvents([]);
      return;
    }

    void refreshTaskEvents(activeAgentId, selectedTaskId);
  }, [activeAgentId, selectedTaskId]);

  useEffect(() => {
    if (!activeAgentId || !tasks.some((task) => task.status === "queued" || task.status === "running")) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshAgentTasks(activeAgentId);
      void refreshTaskEvents(activeAgentId, selectedTaskIdRef.current);
      if (activeConversationId) {
        void refreshWorkspaceRuns(activeConversationId, selectedRunIdRef.current);
      }
    }, 1500);

    return () => window.clearInterval(timer);
  }, [activeAgentId, activeConversationId, tasks]);

  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      let payload: { type?: string; message?: string } | null = null;

      if (typeof event.data === "string") {
        try {
          payload = JSON.parse(event.data) as { type?: string; message?: string };
        } catch {
          return;
        }
      } else if (typeof event.data === "object" && event.data !== null) {
        payload = event.data as { type?: string; message?: string };
      }

      if (!payload || payload.type !== "openai-codex-oauth") {
        return;
      }

      setAppNotice(payload.message ?? "Codex 연결 상태를 갱신했습니다.");
      void refreshProviders();
    };

    window.addEventListener("message", handleOAuthMessage);
    return () => {
      window.removeEventListener("message", handleOAuthMessage);
    };
  }, []);

  useEffect(() => {
    return () => {
      abortAllPendingRequests();
    };
  }, []);

  const activeProvider =
    providers.find((provider) => provider.kind === activeConversation?.providerKind) ?? null;
  const activeModelOption = activeConversation
    ? getModelOption(activeConversation.providerKind, activeConversation.model)
    : null;
  const activeModelCount = activeConversation
    ? modelsByProvider[activeConversation.providerKind].length
    : 0;
  const activeModelsLoading = activeConversation
    ? modelsLoadingByProvider[activeConversation.providerKind]
    : false;
  const activeModelsError = activeConversation
    ? modelErrorsByProvider[activeConversation.providerKind]
    : null;
  const workspaceLoading = workspaceTreeLoading || workspaceRunsLoading || workspaceFileLoading;

  async function handleSaveProvider(kind: Exclude<ProviderKind, "openai-codex">) {
    const draft = providerDrafts[kind];
    setSavingKind(kind);

    try {
      if (kind === "ollama") {
        await saveProviderAccount(kind, {
          baseUrl: draft.baseUrl.trim(),
        });
      } else {
        await saveProviderAccount(kind, {
          apiKey: draft.apiKey.trim(),
        });
        setProviderDrafts((current) => ({
          ...current,
          [kind]: {
            ...current[kind],
            apiKey: "",
          },
        }));
      }

      await refreshProviders();
      setAppNotice(`${providerLabels[kind]} 설정을 저장했습니다.`);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "프로바이더 설정 저장에 실패했습니다.");
    } finally {
      setSavingKind(null);
    }
  }

  async function handleCreateAgent() {
    const index = agents.length + 1;
    try {
      const providerKind = activeConversation?.providerKind ?? pickConversationProvider(providers);
      const response = await saveAgent({
        name: `로컬 에이전트 ${index}`,
        providerKind,
        model: activeConversation?.model ?? defaultModels[providerKind],
        reasoningLevel: activeConversation?.reasoningLevel ?? defaultReasoningLevels[providerKind],
      });
      await refreshAgents(response.agent.id);
      setAppNotice(`${response.agent.name}를 만들었습니다.`);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "에이전트를 만들지 못했습니다.");
    }
  }

  async function handleSelectAgent(agentId: string) {
    if (!agentId || agentId === activeAgentId) {
      return;
    }
    setActiveAgentId(agentId);
  }

  async function handleStartBackgroundTask() {
    if (!activeAgentId || !activeConversation || !composerText.trim()) {
      setAppNotice("백그라운드 태스크로 실행할 내용을 입력하세요.");
      return;
    }

    const prompt = composerText.trim();
    setComposerText("");
    try {
      const response = await createAgentTask(activeAgentId, {
        conversationId: activeConversation.id,
        title: prompt.slice(0, 80),
        prompt,
        providerKind: activeConversation.providerKind,
        model: activeConversation.model,
        reasoningLevel: activeConversation.reasoningLevel,
      });
      setTasks((current) => [response.task, ...current.filter((task) => task.id !== response.task.id)]);
      setSelectedTaskId(response.task.id);
      setAppNotice("백그라운드 태스크를 시작했습니다.");
      void refreshAgentTasks(activeAgentId);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "백그라운드 태스크를 시작하지 못했습니다.");
    }
  }

  async function handleCancelTask(taskId: string) {
    if (!activeAgentId) {
      return;
    }

    try {
      const response = await cancelAgentTask(activeAgentId, taskId);
      setTasks((current) =>
        current.map((task) => (task.id === response.task.id ? response.task : task)),
      );
      setAppNotice("백그라운드 작업을 취소했습니다.");
      void refreshAgentTasks(activeAgentId);
      void refreshTaskEvents(activeAgentId, taskId);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "백그라운드 작업을 취소하지 못했습니다.");
    }
  }

  async function handleTestProvider(kind: ProviderKind) {
    setTestingKind(kind);
    try {
      const result = await testProvider(kind);
      setAppNotice(result.message);
      await refreshProviders();
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "연결 테스트에 실패했습니다.");
    } finally {
      setTestingKind(null);
    }
  }

  async function handleConnectCodex() {
    try {
      setAppNotice("공식 Codex OAuth 흐름을 시작합니다...");
      const response = await startCodexOAuth(window.location.origin);
      await refreshProviders();
      setAppNotice(response.message);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "Codex OAuth 시작에 실패했습니다.");
    }
  }

  async function handleImportCodex() {
    try {
      await importCodexCliAuth();
      await refreshProviders();
      setAppNotice("Codex CLI 인증 정보를 가져왔습니다.");
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "Codex CLI 인증 가져오기에 실패했습니다.");
    }
  }

  async function handleLogoutCodex() {
    try {
      await logoutCodex();
      await refreshProviders();
      setAppNotice("OpenAI Codex 연결을 해제했습니다.");
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "Codex 로그아웃에 실패했습니다.");
    }
  }

  async function handleSendMessage() {
    if (!activeConversation || streaming || !composerText.trim()) {
      return;
    }

    const conversation = activeConversation;
    const prompt = composerText.trim();
    const request = beginRequest(streamSeqRef, streamControllerRef);

    setComposerText("");
    setChatError(null);
    setPendingAssistantText("");
    setStreaming(true);
    setLiveEvents([]);
    setChangedFiles([]);
    setMessages((current) => [
      ...current,
      {
        id: getOptimisticMessageId(),
        role: "user",
        content: prompt,
        pending: true,
      },
    ]);

    try {
      await streamChat(
        {
          conversationId: conversation.id,
          providerKind: conversation.providerKind,
          model: conversation.model,
          reasoningLevel: conversation.reasoningLevel,
          message: prompt,
        },
        (eventName, payload) => {
          if (request.controller.signal.aborted || activeConversationIdRef.current !== conversation.id) {
            return;
          }

          if (eventName === "delta") {
            const deltaPayload = payload as StreamEventPayloadMap["delta"];
            setPendingAssistantText((current) => current + deltaPayload.delta);
            return;
          }

          if (eventName === "status") {
            setLiveEvents((current) => [...current, createLiveEvent("status", payload)]);
            return;
          }

          if (eventName === "tool_call") {
            setLiveEvents((current) => [...current, createLiveEvent("tool_call", payload)]);
            return;
          }

          if (eventName === "tool_result") {
            setLiveEvents((current) => [...current, createLiveEvent("tool_result", payload)]);
            return;
          }

          if (eventName === "run_complete") {
            const completePayload = payload as StreamEventPayloadMap["run_complete"];
            setChangedFiles(completePayload.changedFiles ?? []);
            if (!manualRunSelectionRef.current && completePayload.runId) {
              setSelectedRunId(completePayload.runId);
            }
            void refreshWorkspaceRuns(conversation.id, completePayload.runId);
            void refreshWorkspaceTree(conversation.id, workspaceScope);
            return;
          }

          if (eventName === "done") {
            const donePayload = payload as StreamEventPayloadMap["done"];
            if (donePayload.changedFiles) {
              setChangedFiles(donePayload.changedFiles);
            }
            if (donePayload.runId && !manualRunSelectionRef.current) {
              setSelectedRunId(donePayload.runId);
            }
            return;
          }

          if (eventName === "error") {
            const errorPayload = payload as StreamEventPayloadMap["error"];
            setChatError(errorPayload.error);
            setLiveEvents((current) => [...current, createLiveEvent("error", errorPayload)]);
            if (errorPayload.runId && !manualRunSelectionRef.current) {
              setSelectedRunId(errorPayload.runId);
            }
          }
        },
        request.controller.signal,
      );

      if (!request.controller.signal.aborted && activeConversationIdRef.current === conversation.id) {
        await loadConversation(conversation.id);
        await refreshConversationList(conversation.id);
        await refreshWorkspaceRuns(conversation.id, selectedRunIdRef.current);
      }
    } catch (error) {
      if (!request.controller.signal.aborted) {
        setChatError(error instanceof Error ? error.message : "메시지 전송에 실패했습니다.");
      }
    } finally {
      if (streamSeqRef.current === request.seq) {
        setStreaming(false);
        setPendingAssistantText("");
        abortRef(streamControllerRef);
      }
    }
  }

  async function handleDeleteConversation(conversationId: string) {
    try {
      await deleteConversation(conversationId);

      const remaining = conversations.filter((conversation) => conversation.id !== conversationId);
      setConversations(remaining);

      if (activeConversationId === conversationId) {
        const nextConversationId = remaining[0]?.id ?? null;
        abortConversationScopedRequests();
        resetConversationWorkspaceState();
        setActiveConversation(null);
        setMessages([]);
        setPendingAssistantText("");
        setChatError(null);
        setStreaming(false);
        manualRunSelectionRef.current = false;

        if (nextConversationId) {
          setActiveConversationId(nextConversationId);
        } else {
          await createConversationThread(activeConversation?.providerKind);
        }
      }

      setAppNotice("대화를 삭제했습니다.");
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "대화 삭제에 실패했습니다.");
    }
  }

  return (
    <div className="app-shell">
      <div className="app-shell__orb app-shell__orb--top" />
      <div className="app-shell__orb app-shell__orb--bottom" />

      <ConversationList
        activeAgentId={activeAgentId}
        agents={agents}
        activeConversationId={activeConversationId}
        conversations={conversations}
        onCreateAgent={() => {
          void handleCreateAgent();
        }}
        onCreateConversation={() => {
          void createConversationThread(activeConversation?.providerKind, activeAgentId);
        }}
        onDeleteConversation={(conversationId) => {
          void handleDeleteConversation(conversationId);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onSelectAgent={(agentId) => {
          void handleSelectAgent(agentId);
        }}
        onSelectConversation={(conversationId) => {
          setActiveConversationId(conversationId);
          setChatError(null);
          setPendingAssistantText("");
          setLiveEvents([]);
          setChangedFiles([]);
        }}
      />

      <main className="chat-panel">
        <header className="chat-panel__topbar">
          <div className="chat-panel__model-switcher">
            <span className="chat-panel__current-model">
              {activeModelOption?.label ?? "모델을 불러오는 중..."}
            </span>
            <nav className="chat-panel__tabs" aria-label="워크스페이스 탭">
              <button
                className={`chat-panel__tab ${activeSection === "chat" ? "is-active" : ""}`}
                onClick={() => setActiveSection("chat")}
                type="button"
              >
                채팅
              </button>
              <button
                className={`chat-panel__tab ${activeSection === "workspace" ? "is-active" : ""}`}
                onClick={() => setActiveSection("workspace")}
                type="button"
              >
                워크스페이스
              </button>
            </nav>
          </div>

          <div className="chat-panel__actions">
            <ConnectionStatus
              modelCount={activeModelCount}
              modelsError={activeModelsError}
              modelsLoading={activeModelsLoading}
              provider={activeProvider}
            />
            <button className="ghost-button" onClick={() => setSettingsOpen(true)} type="button">
              프로바이더
            </button>
          </div>
        </header>

        <section className="chat-panel__canvas">
          <div className="chat-panel__intro">
            <p className="eyebrow">{activeSection === "chat" ? "대화" : "워크스페이스"}</p>
            <h1>{activeConversation?.title ?? "새 채팅"}</h1>
            <p className="chat-panel__intro-copy">
              {activeSection === "chat"
                ? "대화와 공통 에이전트 런타임을 통해 파일 작업, 명령 실행, 연구 흐름을 함께 다룰 수 있습니다."
                : "현재 대화의 샌드박스와 실행 로그를 바로 확인할 수 있습니다."}
            </p>
            {activeConversation ? (
              <p className="chat-panel__intro-copy">
                현재 에이전트: {activeAgent?.name ?? "기본 에이전트"} /{" "}
                {providersByKind[activeConversation.providerKind]?.label ?? activeConversation.providerKind} /{" "}
                {activeModelOption?.label ?? activeConversation.model} /{" "}
                {getReasoningLabel(
                  activeConversation.providerKind,
                  activeConversation.model,
                  activeConversation.reasoningLevel,
                )}
              </p>
            ) : null}
          </div>

          {appNotice ? <div className="app-notice">{appNotice}</div> : null}

          {activeSection === "chat" ? (
            <ChatView
              changedFiles={changedFiles}
              error={chatError}
              liveEvents={liveEvents}
              loading={streaming}
              messages={messages}
              pendingAssistantText={pendingAssistantText}
            />
          ) : (
            <WorkspaceView
              file={workspaceFile}
              loading={workspaceLoading}
              memory={agentMemory}
              onCancelTask={(taskId) => {
                void handleCancelTask(taskId);
              }}
              onScopeChange={(scope) => {
                setWorkspaceScope(scope);
                setWorkspaceFile(null);
              }}
              onSelectFile={(path) => {
                void openWorkspaceFile(path);
              }}
              onSelectRun={(runId) => {
                manualRunSelectionRef.current = true;
                setSelectedRunId(runId);
              }}
              onSelectTask={(taskId) => {
                setSelectedTaskId(taskId);
              }}
              onStartTask={() => {
                void handleStartBackgroundTask();
              }}
              runEvents={workspaceRunEvents}
              runs={workspaceRuns}
              scope={workspaceScope}
              selectedRunId={selectedRunId}
              selectedTaskId={selectedTaskId}
              taskEvents={taskEvents}
              tasks={tasks}
              tree={workspaceTree}
            />
          )}
        </section>

        {activeConversation ? (
          <Composer
            disabled={streaming}
            loadingByProvider={modelsLoadingByProvider}
            message={composerText}
            model={activeConversation.model}
            modelsByProvider={modelsByProvider}
            onMessageChange={setComposerText}
            onModelSelect={(providerKind, model) => {
              void updateConversation({
                providerKind,
                model,
                reasoningLevel: normalizeReasoningLevel(
                  providerKind,
                  model,
                  activeConversation.reasoningLevel,
                ),
              });
            }}
            onOpenSettings={() => setSettingsOpen(true)}
            onReasoningChange={(reasoningLevel) => {
              void updateConversation({ reasoningLevel });
            }}
            onSend={() => {
              void handleSendMessage();
            }}
            providerKind={activeConversation.providerKind}
            providers={providers}
            reasoningLevel={activeConversation.reasoningLevel}
          />
        ) : null}
      </main>

      <ProviderSettingsDialog
        drafts={providerDrafts}
        notice={appNotice}
        onClose={() => setSettingsOpen(false)}
        onConnectCodex={() => {
          void handleConnectCodex();
        }}
        onDraftChange={(kind, field, value) => {
          setProviderDrafts((current) => ({
            ...current,
            [kind]: {
              ...current[kind],
              [field]: value,
            },
          }));
        }}
        onImportCodex={() => {
          void handleImportCodex();
        }}
        onLogoutCodex={() => {
          void handleLogoutCodex();
        }}
        onSave={(kind) => {
          void handleSaveProvider(kind as Exclude<ProviderKind, "openai-codex">);
        }}
        onTest={(kind) => {
          void handleTestProvider(kind);
        }}
        open={settingsOpen}
        providers={providers}
        savingKind={savingKind}
        testingKind={testingKind}
      />
    </div>
  );
}
