import { useEffect, useMemo, useState } from "react";
import {
  deleteConversation,
  getConversationMessages,
  getWorkspaceFile,
  getWorkspaceTree,
  importCodexCliAuth,
  listConversations,
  listModels,
  listProviders,
  listWorkspaceRunEvents,
  listWorkspaceRuns,
  logoutCodex,
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
  type ConversationRecord,
  type DisplayMessage,
  type ProviderDraft,
  type ProviderKind,
  type ProviderSummary,
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

function createErrorMap() {
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

export default function App() {
  const [activeSection, setActiveSection] = useState<"chat" | "workspace">("chat");
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
  const [workspaceRunEvents, setWorkspaceRunEvents] = useState<WorkspaceRunEventRecord[]>([]);
  const [liveEvents, setLiveEvents] = useState<WorkspaceRunEventRecord[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [changedFiles, setChangedFiles] = useState<string[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);

  async function refreshProviders() {
    const response = await listProviders();
    setProviders(response.providers);
    setProviderDrafts((currentDrafts) => mergeProviderDrafts(response.providers, currentDrafts));
  }

  async function refreshConversationList(preferredConversationId?: string | null) {
    const response = await listConversations();
    setConversations(response.conversations);

    const nextId =
      preferredConversationId &&
      response.conversations.some((item) => item.id === preferredConversationId)
        ? preferredConversationId
        : response.conversations[0]?.id ?? null;

    setActiveConversationId(nextId);
    return response.conversations;
  }

  async function createConversationThread(preferredProviderKind?: ProviderKind) {
    const providerKind = pickConversationProvider(providers, preferredProviderKind);
    const model = defaultModels[providerKind];
    const reasoningLevel = normalizeReasoningLevel(
      providerKind,
      model,
      defaultReasoningLevels[providerKind],
    );
    const response = await saveConversation({
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
    const response = await getConversationMessages(conversationId);
    setActiveConversation(response.conversation);
    setMessages(
      response.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
      })),
    );
    setConversations((current) => mergeConversationList(current, response.conversation));
  }

  async function refreshWorkspaceTree(conversationId: string, scope: WorkspaceScope) {
    setWorkspaceLoading(true);
    try {
      const response = await getWorkspaceTree({
        conversationId,
        scope,
        maxDepth: 4,
      });
      setWorkspaceTree(response.tree);
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function refreshWorkspaceRuns(conversationId: string, preferredRunId?: string | null) {
    const response = await listWorkspaceRuns(conversationId);
    setWorkspaceRuns(response.runs);
    const nextRunId =
      preferredRunId && response.runs.some((run) => run.id === preferredRunId)
        ? preferredRunId
        : response.runs[0]?.id ?? null;
    setActiveRunId(nextRunId);
  }

  async function refreshWorkspaceRunEvents(runId: string | null) {
    if (!runId) {
      setWorkspaceRunEvents([]);
      return;
    }
    const response = await listWorkspaceRunEvents(runId);
    setWorkspaceRunEvents(response.events);
  }

  async function openWorkspaceFile(path: string) {
    if (!activeConversationId) {
      return;
    }
    try {
      const response = await getWorkspaceFile({
        conversationId: activeConversationId,
        scope: workspaceScope,
        path,
      });
      setWorkspaceFile(response.file);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "파일을 불러오지 못했습니다.");
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
        title: optimisticConversation.title,
        providerKind,
        model,
        reasoningLevel,
      });
      setActiveConversation(response.conversation);
      setConversations((current) => mergeConversationList(current, response.conversation));
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "대화 설정을 업데이트하지 못했습니다.");
    }
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await refreshProviders();
        const loadedConversations = await refreshConversationList();
        if (!cancelled && loadedConversations.length === 0) {
          await createConversationThread();
        }
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
    if (!activeConversationId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await getConversationMessages(activeConversationId);
        if (cancelled) {
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
      } catch (error) {
        if (!cancelled) {
          setChatError(error instanceof Error ? error.message : "대화를 불러오지 못했습니다.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeConversationId]);

  useEffect(() => {
    if (!activeConversationId) {
      return;
    }
    void refreshWorkspaceTree(activeConversationId, workspaceScope);
    void refreshWorkspaceRuns(activeConversationId, activeRunId);
    setWorkspaceFile(null);
  }, [activeConversationId, workspaceScope]);

  useEffect(() => {
    void refreshWorkspaceRunEvents(activeRunId);
  }, [activeRunId]);

  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      let payload: {
        type?: string;
        message?: string;
      } | null = null;

      if (typeof event.data === "string") {
        try {
          payload = JSON.parse(event.data) as {
            type?: string;
            message?: string;
          };
        } catch {
          return;
        }
      } else if (typeof event.data === "object" && event.data !== null) {
        payload = event.data as {
          type?: string;
          message?: string;
        };
      }

      if (!payload || payload.type !== "openai-codex-oauth") {
        return;
      }

      setAppNotice(payload.message ?? "Codex 연결 상태가 업데이트되었습니다.");
      void refreshProviders();
    };

    window.addEventListener("message", handleOAuthMessage);
    return () => {
      window.removeEventListener("message", handleOAuthMessage);
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

  const providersByKind = useMemo(
    () => Object.fromEntries(providers.map((provider) => [provider.kind, provider])) as Record<ProviderKind, ProviderSummary>,
    [providers],
  );

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
      setAppNotice(
        error instanceof Error ? error.message : "프로바이더 설정 저장에 실패했습니다.",
      );
    } finally {
      setSavingKind(null);
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
      setAppNotice("공식 Codex CLI 로그인 흐름을 시작합니다...");
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
      setAppNotice(error instanceof Error ? error.message : "Codex 인증 가져오기에 실패했습니다.");
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
          if (eventName === "delta") {
            setPendingAssistantText((current) => current + payload.delta);
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
            setChangedFiles(payload.changedFiles ?? []);
            setActiveRunId(payload.runId);
            void refreshWorkspaceRuns(conversation.id, payload.runId);
            void refreshWorkspaceTree(conversation.id, workspaceScope);
            return;
          }

          if (eventName === "done") {
            if (payload.changedFiles) {
              setChangedFiles(payload.changedFiles);
            }
            if (payload.runId) {
              setActiveRunId(payload.runId);
            }
            return;
          }

          if (eventName === "error") {
            setChatError(payload.error);
            setLiveEvents((current) => [...current, createLiveEvent("error", payload)]);
          }
        },
      );
      await loadConversation(conversation.id);
      await refreshConversationList(conversation.id);
      await refreshWorkspaceRuns(conversation.id, activeRunId);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "메시지 전송에 실패했습니다.");
    } finally {
      setStreaming(false);
      setPendingAssistantText("");
    }
  }

  async function handleDeleteConversation(conversationId: string) {
    try {
      await deleteConversation(conversationId);

      const remaining = conversations.filter((conversation) => conversation.id !== conversationId);
      setConversations(remaining);

      if (activeConversationId === conversationId) {
        const nextConversationId = remaining[0]?.id ?? null;
        setActiveConversationId(nextConversationId);
        setActiveConversation(
          nextConversationId
            ? remaining.find((conversation) => conversation.id === nextConversationId) ?? null
            : null,
        );
        setMessages([]);
        setPendingAssistantText("");
        setChatError(null);

        if (!nextConversationId) {
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
        activeConversationId={activeConversationId}
        conversations={conversations}
        onCreateConversation={() => {
          void createConversationThread(activeConversation?.providerKind);
        }}
        onDeleteConversation={(conversationId) => {
          void handleDeleteConversation(conversationId);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
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
              {activeModelOption?.label ?? "불러오는 중..."}
            </span>
            <nav className="chat-panel__tabs" aria-label="워크스페이스 섹션">
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
            <h1>{activeConversation?.title ?? "불러오는 중..."}</h1>
            <p className="chat-panel__intro-copy">
              {activeSection === "chat"
                ? "채팅은 공통 에이전트 런타임을 통해 파일 작업, 명령 실행, 웹 연구 도구를 호출할 수 있습니다."
                : "현재 대화 샌드박스의 파일, 연구 산출물, 실행 로그를 여기서 직접 확인할 수 있습니다."}
            </p>
            {activeConversation ? (
              <p className="chat-panel__intro-copy">
                현재 선택: {providersByKind[activeConversation.providerKind]?.label ?? activeConversation.providerKind} /{" "}
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
              onScopeChange={(scope) => {
                setWorkspaceScope(scope);
                setWorkspaceFile(null);
              }}
              onSelectFile={(path) => {
                void openWorkspaceFile(path);
              }}
              runEvents={workspaceRunEvents}
              runs={workspaceRuns}
              scope={workspaceScope}
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
          void handleSaveProvider(kind);
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
