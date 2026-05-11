import { useEffect, useMemo, useRef, useState } from "react";
import {
  applySkillTemplateToHeartbeat,
  applySkillTemplateToStandingOrders,
  cancelAgentTask,
  deleteConversation,
  deleteAgent,
  createAgentAutomationRule,
  createAgentTask,
  cancelSubagentSession,
  cancelTaskFlow,
  createMcpTestRun,
  createSubagentSession,
  createTaskFlow,
  deleteAgentAutomationRule,
  deleteTaskFlow,
  draftFlowFromPrompt,
  getAgentStandingOrders,
  getAgentHeartbeat,
  getAgentSoul,
  getConversationSummary,
  getConversationSummarySuggestions,
  getEngineStatus,
  getConversationMessages,
  getRunDebug,
  importCodexCliAuth,
  listAgentAutomationRules,
  listAgentTasks,
  listAgents,
  listConversations,
  listSubagentSessions,
  listModels,
  listHeartbeatLogs,
  listPlatformMetadata,
  listProviders,
  listRunArtifacts,
  listTaskEvents,
  listTaskFlows,
  listWorkspaceRunEvents,
  listWorkspaceRuns,
  logoutCodex,
  resumeTaskFlow,
  retryAgentTask,
  retryTaskFlowStep,
  approveTaskFlowStep,
  denyTaskFlowStep,
  refreshOpenCodeModels,
  refreshConversationSummary,
  refreshConversationSummaryTask,
  saveAgentStandingOrders,
  saveAgent,
  saveAgentHeartbeat,
  saveAgentSoul,
  saveConversation,
  saveConversationSummary,
  applyConversationSummarySuggestion,
  saveSkillTemplateFromFlow,
  saveTaskFlowSteps,
  saveProviderAccount,
  startCodexOAuth,
  startOpenCodeAuthLogin,
  skipTaskFlowStep,
  startTaskFlow,
  triggerAgentAutomationRule,
  triggerAgentHeartbeat,
  updateAgentAutomationRule,
  getTaskFlow,
  streamChat,
  testProvider,
  previewArtifact,
  getArtifactDiff,
} from "../api";
import {
  type AgentDraft,
  type AgentHeartbeatDraft,
  type AgentSoulDraft,
} from "../components/AgentSettingsDialog";
import type { CockpitNavTarget } from "../components/ConversationList";
import { createAgentDraft } from "./agentDraft";
import { getModelOption } from "../model-catalog";
import { getReasoningLabel, normalizeReasoningLevel } from "../reasoning-options";
import { useMcpMetadata } from "../hooks/useMcpMetadata";
import { usePreflight } from "../hooks/usePreflight";
import {
  type CustomSkillTemplateCreatePayload,
  type CustomSkillTemplateUpdatePayload,
  useSkillTemplates,
} from "../hooks/useSkillTemplates";
import { useResearchProjects } from "../hooks/useResearchProjects";
import {
  defaultModels,
  defaultReasoningLevels,
  providerKinds,
  providerLabels,
  type AgentRecord,
  type AgentHeartbeatRecord,
  type AutomationRuleRecord,
  type ConversationRecord,
  type DisplayMessage,
  type HeartbeatLogRecord,
  type AgentSoulRecord,
  type ProviderDraft,
  type ProviderKind,
  type PlatformMetadata,
  type ProviderSummary,
  type StandingOrdersRecord,
  type StreamEventPayloadMap,
  type TaskEventRecord,
  type TaskFlowDetailResponse,
  type TaskFlowRecord,
  type TaskFlowStepDraft,
  type TaskFlowStepDetail,
  type TaskRecord,
  type WorkspaceRunEventRecord,
  type WorkspaceRunRecord,
  type EngineStatusRecord,
  type McpServerSummary,
  type ArtifactPreviewResponse,
  type ArtifactDiffResponse,
  type ArtifactRecord,
  type FlowDraft,
  type RunDebugResponse,
  type SessionSummaryRecord,
  type SessionSummarySuggestionRecord,
  type SkillTemplateRecord,
} from "../types";
import {
  abortRef,
  beginRequest,
  createAgentHeartbeatDraft,
  createAgentSoulDraft,
  createEmptyDrafts,
  createErrorMap,
  createLiveEvent,
  createLoadingMap,
  createModelMap,
  DEFAULT_NEW_CONVERSATION_TITLE,
  displayAppNotice,
  displayConversationTitle,
  getOptimisticMessageId,
  mergeConversationList,
  mergeProviderDrafts,
  pickConversationProvider,
} from "../appStateUtils";

type AppSection = "chat" | "workflow" | "research" | "mcp" | "skills" | "settings";

export function useAetherOpsController() {
  const [activeSection, setActiveSection] = useState<AppSection>("chat");
  const [activeNavTarget, setActiveNavTarget] = useState<CockpitNavTarget>("chat");
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [activeAgent, setActiveAgent] = useState<AgentRecord | null>(null);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [engineStatus, setEngineStatus] = useState<EngineStatusRecord | null>(null);
  const [engineStatusLoading, setEngineStatusLoading] = useState(false);
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
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [providerDrafts, setProviderDrafts] = useState<Record<ProviderKind, ProviderDraft>>(
    createEmptyDrafts(),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [agentDraft, setAgentDraft] = useState<AgentDraft>(() => createAgentDraft(null));
  const [agentSoul, setAgentSoul] = useState<AgentSoulRecord | null>(null);
  const [agentSoulDraft, setAgentSoulDraft] = useState<AgentSoulDraft>("");
  const [agentHeartbeat, setAgentHeartbeat] = useState<AgentHeartbeatRecord | null>(null);
  const [agentHeartbeatDraft, setAgentHeartbeatDraft] = useState<AgentHeartbeatDraft>(() =>
    createAgentHeartbeatDraft(null),
  );
  const [standingOrders, setStandingOrders] = useState<StandingOrdersRecord | null>(null);
  const [standingOrdersDraft, setStandingOrdersDraft] = useState("");
  const [subagentSessions, setSubagentSessions] = useState<ConversationRecord[]>([]);
  const [taskFlows, setTaskFlows] = useState<TaskFlowRecord[]>([]);
  const [selectedTaskFlowId, setSelectedTaskFlowId] = useState<string | null>(null);
  const [selectedTaskFlow, setSelectedTaskFlow] = useState<TaskFlowDetailResponse | null>(null);
  const [heartbeatLogs, setHeartbeatLogs] = useState<HeartbeatLogRecord[]>([]);
  const [automationRules, setAutomationRules] = useState<AutomationRuleRecord[]>([]);
  const [heartbeatTriggering, setHeartbeatTriggering] = useState(false);
  const [triggeringAutomationRuleIds, setTriggeringAutomationRuleIds] = useState<string[]>([]);
  const [providerAuthAction, setProviderAuthAction] = useState<string | null>(null);
  const [savingAgent, setSavingAgent] = useState(false);
  const [savingStandingOrders, setSavingStandingOrders] = useState(false);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [savingKind, setSavingKind] = useState<ProviderKind | null>(null);
  const [testingKind, setTestingKind] = useState<ProviderKind | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [workspaceRuns, setWorkspaceRuns] = useState<WorkspaceRunRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [workspaceRunEvents, setWorkspaceRunEvents] = useState<WorkspaceRunEventRecord[]>([]);
  const [taskEvents, setTaskEvents] = useState<TaskEventRecord[]>([]);
  const [platformMetadata, setPlatformMetadata] = useState<PlatformMetadata | null>(null);
  const [mcpTestRunPendingId, setMcpTestRunPendingId] = useState<string | null>(null);
  const [skillActionPendingId, setSkillActionPendingId] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<WorkspaceRunEventRecord[]>([]);
  const [changedFiles, setChangedFiles] = useState<string[]>([]);
  const [sessionSummary, setSessionSummary] = useState<SessionSummaryRecord | null>(null);
  const [sessionSummaryDraft, setSessionSummaryDraft] = useState("");
  const [sessionSummarySuggestions, setSessionSummarySuggestions] = useState<SessionSummarySuggestionRecord[]>([]);
  const [summaryEditing, setSummaryEditing] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [flowDraftPrompt, setFlowDraftPrompt] = useState("");
  const [flowDraft, setFlowDraft] = useState<FlowDraft | null>(null);
  const [flowDraftEditing, setFlowDraftEditing] = useState(false);
  const [flowDraftLoading, setFlowDraftLoading] = useState(false);
  const [flowDraftError, setFlowDraftError] = useState<string | null>(null);
  const [runArtifacts, setRunArtifacts] = useState<ArtifactRecord[]>([]);
  const [artifactPreview, setArtifactPreview] = useState<ArtifactPreviewResponse | null>(null);
  const [artifactDiff, setArtifactDiff] = useState<ArtifactDiffResponse | null>(null);
  const [runDebug, setRunDebug] = useState<RunDebugResponse | null>(null);
  const [runDetailLoading, setRunDetailLoading] = useState(false);
  const {
    abortMcpMetadataRequests,
    handleApplyMcpSnippet,
    handleValidateMcpSnippet,
    mcpCatalog,
    mcpLoading,
    mcpSnippetValidation,
    mcpStatus,
    refreshMcpMetadata,
  } = useMcpMetadata({ onNotice: setAppNotice });
  const {
    abortSkillTemplateRequests,
    createTemplate: createCustomSkillTemplateFromHook,
    deleteTemplate: deleteCustomSkillTemplateFromHook,
    refreshSkillTemplates: refreshSkillTemplatesFromHook,
    skillTemplates,
    skillTemplatesLoading,
    updateTemplate: updateCustomSkillTemplateFromHook,
  } = useSkillTemplates({ onNotice: setAppNotice });
  const {
    abortResearchRequests,
    activeResearchProject,
    activeResearchProjectId,
    addEvidence: addResearchEvidence,
    addHypothesis: addResearchHypothesis,
    addQuestion: addResearchQuestion,
    addSource: addResearchSource,
    cancelLoop: cancelResearchLoopFromHook,
    createProject: createResearchProjectFromHook,
    createReport: createResearchReportFromHook,
    createReportTask: createResearchReportTaskFromHook,
    createSubagent: createResearchSubagentFromHook,
    patchProject: patchResearchProjectFromHook,
    proposeLoop: proposeResearchLoopFromHook,
    refreshResearchProjectDetail,
    refreshResearchProjects,
    researchEvidence,
    researchHypotheses,
    researchLastReport,
    researchLoading,
    researchLoops,
    researchPreflight,
    researchProjects,
    researchQuestions,
    researchRagResults,
    researchRagStatus,
    researchSearchResults,
    researchSources,
    rebuildProjectRagIndex,
    searchProjectRagRecords,
    searchResearchRecords,
    setActiveResearchProjectId,
    startGoal: startResearchGoalFromHook,
    startSelfImprovement: startSelfImprovementGoalFromHook,
    startLoop: startResearchLoopFromHook,
    stopGoal: stopResearchGoalFromHook,
    tickGoal: tickResearchGoalFromHook,
    tickLoop: tickResearchLoopFromHook,
  } = useResearchProjects({
    onNotice: setAppNotice,
    onFlowCreated(flowId) {
      setSelectedTaskFlowId(flowId);
      setActiveNavTarget("workflow");
      setActiveSection("workflow");
      const agentId = activeAgentIdRef.current;
      if (agentId) {
        void refreshTaskFlowDetail(agentId, flowId);
        void refreshTaskFlows(agentId);
      }
    },
  });

  const activeConversationIdRef = useRef<string | null>(null);
  const activeAgentIdRef = useRef<string | null>(null);
  const selectedRunIdRef = useRef<string | null>(null);
  const selectedTaskIdRef = useRef<string | null>(null);
  const selectedTaskFlowIdRef = useRef<string | null>(null);
  const manualRunSelectionRef = useRef(false);
  const lastConversationIdRef = useRef<string | null>(null);
  const conversationListSeqRef = useRef(0);
  const conversationListControllerRef = useRef<AbortController | null>(null);
  const conversationLoadSeqRef = useRef(0);
  const conversationLoadControllerRef = useRef<AbortController | null>(null);
  const workspaceRunsSeqRef = useRef(0);
  const workspaceRunsControllerRef = useRef<AbortController | null>(null);
  const runArtifactsSeqRef = useRef(0);
  const runArtifactsControllerRef = useRef<AbortController | null>(null);
  const sessionSummarySeqRef = useRef(0);
  const sessionSummaryControllerRef = useRef<AbortController | null>(null);
  const tasksSeqRef = useRef(0);
  const tasksControllerRef = useRef<AbortController | null>(null);
  const taskEventsSeqRef = useRef(0);
  const taskEventsControllerRef = useRef<AbortController | null>(null);
  const soulSeqRef = useRef(0);
  const soulControllerRef = useRef<AbortController | null>(null);
  const heartbeatSeqRef = useRef(0);
  const heartbeatControllerRef = useRef<AbortController | null>(null);
  const heartbeatLogsSeqRef = useRef(0);
  const heartbeatLogsControllerRef = useRef<AbortController | null>(null);
  const automationRulesSeqRef = useRef(0);
  const automationRulesControllerRef = useRef<AbortController | null>(null);
  const heartbeatTriggeringRef = useRef(false);
  const triggeringAutomationRuleIdsRef = useRef<Set<string>>(new Set());
  const providerAuthActionRef = useRef<string | null>(null);
  const standingOrdersSeqRef = useRef(0);
  const standingOrdersControllerRef = useRef<AbortController | null>(null);
  const subagentSessionsSeqRef = useRef(0);
  const subagentSessionsControllerRef = useRef<AbortController | null>(null);
  const taskFlowsSeqRef = useRef(0);
  const taskFlowsControllerRef = useRef<AbortController | null>(null);
  const taskFlowDetailSeqRef = useRef(0);
  const taskFlowDetailControllerRef = useRef<AbortController | null>(null);
  const platformMetadataSeqRef = useRef(0);
  const platformMetadataControllerRef = useRef<AbortController | null>(null);
  const workspaceEventsSeqRef = useRef(0);
  const workspaceEventsControllerRef = useRef<AbortController | null>(null);
  const streamSeqRef = useRef(0);
  const streamControllerRef = useRef<AbortController | null>(null);
  const {
    abortPreflightRequests,
    clearPreflight,
    preflightLoading,
    preflightStatus,
    refreshPreflight,
  } = usePreflight({
    getActiveAgentId: () => activeAgentIdRef.current,
    getActiveConversationId: () => activeConversationIdRef.current,
  });

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    activeAgentIdRef.current = activeAgentId;
    setActiveAgent(agents.find((agent) => agent.id === activeAgentId) ?? null);
  }, [activeAgentId, agents]);

  useEffect(() => {
    if (!agentSettingsOpen) {
      setAgentDraft(createAgentDraft(activeAgent));
      setAgentSoulDraft(createAgentSoulDraft(agentSoul));
      setAgentHeartbeatDraft(createAgentHeartbeatDraft(agentHeartbeat));
      setStandingOrdersDraft(standingOrders?.content ?? "");
    }
  }, [activeAgent, agentHeartbeat, agentSettingsOpen, agentSoul, standingOrders]);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId;
  }, [selectedTaskId]);

  useEffect(() => {
    selectedTaskFlowIdRef.current = selectedTaskFlowId;
  }, [selectedTaskFlowId]);

  useEffect(() => {
    if (typeof fetch !== "function") {
      return;
    }

    let cancelled = false;
    const checkBackendHealth = async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        if (!cancelled) {
          setBackendOnline(response.ok);
        }
      } catch {
        if (!cancelled) {
          setBackendOnline(false);
        }
      }
    };

    void checkBackendHealth();
    const intervalId = window.setInterval(() => {
      void checkBackendHealth();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!activeAgentId) {
      setSelectedTaskFlowId(null);
      setSelectedTaskFlow(null);
      return;
    }

    void refreshTaskFlowDetail(activeAgentId, selectedTaskFlowId);
  }, [activeAgentId, selectedTaskFlowId]);

  useEffect(() => {
    if (!activeAgentId && !activeConversationId) {
      clearPreflight();
      return;
    }
    void refreshPreflight(activeAgentId, activeConversationId);
  }, [activeAgentId, activeConversationId, activeConversation?.model, activeConversation?.providerKind]);

  const providersByKind = useMemo(
    () =>
      Object.fromEntries(providers.map((provider) => [provider.kind, provider])) as Record<
        ProviderKind,
        ProviderSummary
      >,
    [providers],
  );

  function abortAgentScopedRequests() {
    abortRef(conversationListControllerRef);
    abortConversationScopedRequests();
    abortRef(tasksControllerRef);
    abortRef(taskEventsControllerRef);
    abortRef(soulControllerRef);
    abortRef(heartbeatControllerRef);
    abortRef(heartbeatLogsControllerRef);
    abortRef(automationRulesControllerRef);
    abortRef(standingOrdersControllerRef);
    abortRef(taskFlowsControllerRef);
    abortRef(taskFlowDetailControllerRef);
    abortPreflightRequests();
    abortResearchRequests();
  }

  function abortAllPendingRequests() {
    abortAgentScopedRequests();
    abortRef(platformMetadataControllerRef);
    abortMcpMetadataRequests();
    abortPreflightRequests();
    abortResearchRequests();
    abortSkillTemplateRequests();
  }

  function abortConversationScopedRequests() {
    abortRef(conversationLoadControllerRef);
    abortRef(workspaceRunsControllerRef);
    abortRef(runArtifactsControllerRef);
    abortRef(sessionSummaryControllerRef);
    abortRef(workspaceEventsControllerRef);
    abortRef(streamControllerRef);
    abortRef(subagentSessionsControllerRef);
  }

  function resetConversationWorkspaceState() {
    selectedRunIdRef.current = null;
    manualRunSelectionRef.current = false;
    setWorkspaceRuns([]);
    setSelectedRunId(null);
    setWorkspaceRunEvents([]);
    setLiveEvents([]);
    setChangedFiles([]);
    setSessionSummary(null);
    setSessionSummaryDraft("");
    setSessionSummarySuggestions([]);
    setSummaryEditing(false);
    setFlowDraft(null);
    setFlowDraftPrompt("");
    setFlowDraftError(null);
    setRunArtifacts([]);
    setArtifactPreview(null);
    setArtifactDiff(null);
    setRunDebug(null);
    setSubagentSessions([]);
  }

  function resetWorkspaceState() {
    resetConversationWorkspaceState();
    selectedTaskIdRef.current = null;
    selectedTaskFlowIdRef.current = null;
    setSelectedTaskFlowId(null);
    setTasks([]);
    setAgentSoul(null);
    setAgentHeartbeat(null);
    setStandingOrders(null);
    setStandingOrdersDraft("");
    setTaskFlows([]);
    setSelectedTaskFlow(null);
    setHeartbeatLogs([]);
    setAutomationRules([]);
    setSelectedTaskId(null);
    setTaskEvents([]);
  }

  async function refreshProviders() {
    const response = await listProviders();
    setProviders(response.providers);
    setProviderDrafts((currentDrafts) => mergeProviderDrafts(response.providers, currentDrafts));
  }

  async function refreshEngineStatus() {
    setEngineStatusLoading(true);
    try {
      const response = await getEngineStatus();
      setEngineStatus(response);
      return response;
    } catch (error: any) {
      setAppNotice(error instanceof Error ? error.message : "실행 엔진 상태를 불러오지 못했습니다.");
      return null;
    } finally {
      setEngineStatusLoading(false);
    }
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
      title: DEFAULT_NEW_CONVERSATION_TITLE,
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
  async function refreshWorkspaceRuns(conversationId: string, preferredRunId?: string | null) {
    const request = beginRequest(workspaceRunsSeqRef, workspaceRunsControllerRef);

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
      setAppNotice(error instanceof Error ? error.message : "작업 목록을 불러오지 못했습니다.");
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

      setAppNotice(error instanceof Error ? error.message : "작업 이벤트를 불러오지 못했습니다.");
    } finally {
      if (taskEventsSeqRef.current === request.seq) {
        abortRef(taskEventsControllerRef);
      }
    }
  }

  async function refreshAgentSoul(agentId: string) {
    const request = beginRequest(soulSeqRef, soulControllerRef);

    try {
      const response = await getAgentSoul(agentId, request.controller.signal);
      if (
        request.controller.signal.aborted ||
        soulSeqRef.current !== request.seq ||
        activeAgentIdRef.current !== agentId
      ) {
        return;
      }

      setAgentSoul(response.soul);
    } catch (error) {
      if (request.controller.signal.aborted || soulSeqRef.current !== request.seq) {
        return;
      }

      setAppNotice(error instanceof Error ? error.message : "SOUL.md를 불러오지 못했습니다.");
    } finally {
      if (soulSeqRef.current === request.seq) {
        abortRef(soulControllerRef);
      }
    }
  }

  async function refreshStandingOrders(agentId: string) {
    const request = beginRequest(standingOrdersSeqRef, standingOrdersControllerRef);

    try {
      const response = await getAgentStandingOrders(agentId, request.controller.signal);
      if (
        request.controller.signal.aborted ||
        standingOrdersSeqRef.current !== request.seq ||
        activeAgentIdRef.current !== agentId
      ) {
        return;
      }

      setStandingOrders(response.standingOrders);
      setStandingOrdersDraft(response.standingOrders.content);
    } catch (error) {
      if (request.controller.signal.aborted || standingOrdersSeqRef.current !== request.seq) {
        return;
      }

      setAppNotice(error instanceof Error ? error.message : "상시 지침을 불러오지 못했습니다.");
    } finally {
      if (standingOrdersSeqRef.current === request.seq) {
        abortRef(standingOrdersControllerRef);
      }
    }
  }

  async function refreshSubagentSessions(sessionId: string) {
    const request = beginRequest(subagentSessionsSeqRef, subagentSessionsControllerRef);

    try {
      const response = await listSubagentSessions(sessionId, request.controller.signal);
      if (
        request.controller.signal.aborted ||
        subagentSessionsSeqRef.current !== request.seq ||
        activeConversationIdRef.current !== sessionId
      ) {
        return;
      }

      setSubagentSessions(response.sessions);
      setConversations((current) =>
        response.sessions.reduce((next, session) => mergeConversationList(next, session), current),
      );
    } catch (error) {
      if (request.controller.signal.aborted || subagentSessionsSeqRef.current !== request.seq) {
        return;
      }

      setAppNotice(error instanceof Error ? error.message : "하위 에이전트 세션을 불러오지 못했습니다.");
    } finally {
      if (subagentSessionsSeqRef.current === request.seq) {
        abortRef(subagentSessionsControllerRef);
      }
    }
  }

  async function refreshTaskFlows(agentId: string, preferredFlowId?: string | null) {
    const request = beginRequest(taskFlowsSeqRef, taskFlowsControllerRef);

    try {
      const response = await listTaskFlows(agentId, request.controller.signal);
      if (
        request.controller.signal.aborted ||
        taskFlowsSeqRef.current !== request.seq ||
        activeAgentIdRef.current !== agentId
      ) {
        return;
      }

      setTaskFlows(response.flows);
      const nextFlowId =
        preferredFlowId && response.flows.some((flow) => flow.id === preferredFlowId)
          ? preferredFlowId
          : selectedTaskFlowIdRef.current && response.flows.some((flow) => flow.id === selectedTaskFlowIdRef.current)
            ? selectedTaskFlowIdRef.current
            : response.flows[0]?.id ?? null;

      setSelectedTaskFlowId(nextFlowId);
      if (!nextFlowId) {
        setSelectedTaskFlow(null);
      }
    } catch (error) {
      if (request.controller.signal.aborted || taskFlowsSeqRef.current !== request.seq) {
        return;
      }

      setAppNotice(error instanceof Error ? error.message : "작업 흐름을 불러오지 못했습니다.");
    } finally {
      if (taskFlowsSeqRef.current === request.seq) {
        abortRef(taskFlowsControllerRef);
      }
    }
  }

  async function refreshTaskFlowDetail(agentId: string, flowId: string | null) {
    const request = beginRequest(taskFlowDetailSeqRef, taskFlowDetailControllerRef);

    if (!flowId) {
      setSelectedTaskFlow(null);
      abortRef(taskFlowDetailControllerRef);
      return;
    }

    try {
      const response = await getTaskFlow(flowId, request.controller.signal);
      if (
        request.controller.signal.aborted ||
        taskFlowDetailSeqRef.current !== request.seq ||
        activeAgentIdRef.current !== agentId ||
        selectedTaskFlowIdRef.current !== flowId
      ) {
        return;
      }

      setSelectedTaskFlow(response);
    } catch (error) {
      if (request.controller.signal.aborted || taskFlowDetailSeqRef.current !== request.seq) {
        return;
      }

      setAppNotice(error instanceof Error ? error.message : "작업 흐름 상세 정보를 불러오지 못했습니다.");
    } finally {
      if (taskFlowDetailSeqRef.current === request.seq) {
        abortRef(taskFlowDetailControllerRef);
      }
    }
  }

  async function refreshAgentHeartbeat(agentId: string) {
    const request = beginRequest(heartbeatSeqRef, heartbeatControllerRef);

    try {
      const response = await getAgentHeartbeat(agentId, request.controller.signal);
      if (
        request.controller.signal.aborted ||
        heartbeatSeqRef.current !== request.seq ||
        activeAgentIdRef.current !== agentId
      ) {
        return;
      }

      setAgentHeartbeat(response.heartbeat);
    } catch (error) {
      if (request.controller.signal.aborted || heartbeatSeqRef.current !== request.seq) {
        return;
      }

      setAppNotice(error instanceof Error ? error.message : "HEARTBEAT.md를 불러오지 못했습니다.");
    } finally {
      if (heartbeatSeqRef.current === request.seq) {
        abortRef(heartbeatControllerRef);
      }
    }
  }

  async function refreshHeartbeatLogs(agentId: string) {
    const request = beginRequest(heartbeatLogsSeqRef, heartbeatLogsControllerRef);

    try {
      const response = await listHeartbeatLogs(agentId, request.controller.signal);
      if (
        request.controller.signal.aborted ||
        heartbeatLogsSeqRef.current !== request.seq ||
        activeAgentIdRef.current !== agentId
      ) {
        return;
      }

      setHeartbeatLogs(response.logs);
    } catch (error) {
      if (request.controller.signal.aborted || heartbeatLogsSeqRef.current !== request.seq) {
        return;
      }

      setAppNotice(error instanceof Error ? error.message : "Heartbeat 로그를 불러오지 못했습니다.");
    } finally {
      if (heartbeatLogsSeqRef.current === request.seq) {
        abortRef(heartbeatLogsControllerRef);
      }
    }
  }

  async function refreshSessionSummary(conversationId: string) {
    const request = beginRequest(sessionSummarySeqRef, sessionSummaryControllerRef);
    try {
      const response = await getConversationSummary(conversationId, request.controller.signal);
      if (
        request.controller.signal.aborted ||
        sessionSummarySeqRef.current !== request.seq ||
        activeConversationIdRef.current !== conversationId
      ) {
        return;
      }
      setSessionSummary(response.summary);
      setSessionSummaryDraft(response.summary?.summary ?? "");
      setSummaryEditing(false);
    } catch (error) {
      if (!request.controller.signal.aborted) {
        setAppNotice(error instanceof Error ? error.message : "세션 요약을 불러오지 못했습니다.");
      }
    } finally {
      if (sessionSummarySeqRef.current === request.seq) {
        abortRef(sessionSummaryControllerRef);
      }
    }
  }

  async function refreshRunArtifacts(conversationId: string, runId: string | null) {
    const request = beginRequest(runArtifactsSeqRef, runArtifactsControllerRef);
    if (!runId) {
      setRunArtifacts([]);
      setArtifactPreview(null);
      setArtifactDiff(null);
      setRunDebug(null);
      abortRef(runArtifactsControllerRef);
      return;
    }
    try {
      const response = await listRunArtifacts(conversationId, runId, request.controller.signal);
      if (
        request.controller.signal.aborted ||
        runArtifactsSeqRef.current !== request.seq ||
        activeConversationIdRef.current !== conversationId ||
        selectedRunIdRef.current !== runId
      ) {
        return;
      }
      setRunArtifacts(response.artifacts);
    } catch (error) {
      if (!request.controller.signal.aborted) {
        setAppNotice(error instanceof Error ? error.message : "산출물을 불러오지 못했습니다.");
      }
    } finally {
      if (runArtifactsSeqRef.current === request.seq) {
        abortRef(runArtifactsControllerRef);
      }
    }
  }

  async function refreshAutomationRules(agentId: string) {
    const request = beginRequest(automationRulesSeqRef, automationRulesControllerRef);

    try {
      const response = await listAgentAutomationRules(agentId, request.controller.signal);
      if (
        request.controller.signal.aborted ||
        automationRulesSeqRef.current !== request.seq ||
        activeAgentIdRef.current !== agentId
      ) {
        return;
      }

      setAutomationRules(response.rules);
    } catch (error) {
      if (request.controller.signal.aborted || automationRulesSeqRef.current !== request.seq) {
        return;
      }

      setAppNotice(error instanceof Error ? error.message : "자동화 규칙을 불러오지 못했습니다.");
    } finally {
      if (automationRulesSeqRef.current === request.seq) {
        abortRef(automationRulesControllerRef);
      }
    }
  }

  async function refreshPlatformMetadata(agentId = activeAgentIdRef.current) {
    const request = beginRequest(platformMetadataSeqRef, platformMetadataControllerRef);

    try {
      const response = await listPlatformMetadata(agentId, request.controller.signal);
      if (
        request.controller.signal.aborted ||
        platformMetadataSeqRef.current !== request.seq ||
        agentId !== activeAgentIdRef.current
      ) {
        return;
      }
      setPlatformMetadata(response);
    } catch (error) {
      if (request.controller.signal.aborted || platformMetadataSeqRef.current !== request.seq) {
        return;
      }
      setAppNotice(error instanceof Error ? error.message : "플랫폼 정보를 불러오지 못했습니다.");
    } finally {
      if (platformMetadataSeqRef.current === request.seq) {
        abortRef(platformMetadataControllerRef);
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
      if (
        request.controller.signal.aborted ||
        workspaceEventsSeqRef.current !== request.seq ||
        activeConversationIdRef.current !== conversationId ||
        selectedRunIdRef.current !== runId
      ) {
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
        await refreshEngineStatus();
        const loadedAgents = await refreshAgents();
        await refreshPlatformMetadata(loadedAgents[0]?.id ?? null);
        await refreshMcpMetadata();
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
      setPlatformMetadata(null);
      setAgentSoul(null);
      setAgentHeartbeat(null);
      setHeartbeatLogs([]);
      setAutomationRules([]);
      setStandingOrders(null);
      setStandingOrdersDraft("");
      setTaskFlows([]);
      setSelectedTaskFlowId(null);
      setSelectedTaskFlow(null);
      setSubagentSessions([]);
      return;
    }

    abortAgentScopedRequests();
    resetWorkspaceState();
    setActiveConversation(null);
    setActiveConversationId(null);
    setConversations([]);
    setMessages([]);
    setPendingAssistantText("");
    setChatError(null);
    manualRunSelectionRef.current = false;

    void (async () => {
      void refreshPlatformMetadata(activeAgentId);
      void refreshMcpMetadata();
      void refreshSkillTemplates();
      void refreshAgentSoul(activeAgentId);
      void refreshAgentHeartbeat(activeAgentId);
      void refreshHeartbeatLogs(activeAgentId);
      void refreshAutomationRules(activeAgentId);
      void refreshStandingOrders(activeAgentId);
      void refreshTaskFlows(activeAgentId);
      void refreshResearchProjects(activeAgentId);
      const loadedConversations = await refreshConversationList(null, activeAgentId);
      void refreshAgentTasks(activeAgentId);
      if (loadedConversations.length === 0) {
        await createConversationThread(undefined, activeAgentId);
      }
    })();
  }, [activeAgentId]);

  useEffect(() => {
    if (activeSection !== "mcp") {
      return;
    }
    void refreshMcpMetadata();
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== "skills") {
      return;
    }
    void refreshSkillTemplates();
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== "research" || !activeAgentId) {
      return;
    }
    void refreshResearchProjects(activeAgentId);
    if (activeResearchProjectId) {
      void refreshResearchProjectDetail(activeResearchProjectId);
    }
  }, [activeSection, activeAgentId, activeResearchProjectId]);

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
      setSubagentSessions([]);
      return;
    }

    void loadConversation(activeConversationId);
    void refreshSessionSummary(activeConversationId);
    void refreshSubagentSessions(activeConversationId);
  }, [activeConversationId]);

  useEffect(() => {
    if (!activeConversationId) {
      return;
    }

    void refreshWorkspaceRuns(activeConversationId, selectedRunIdRef.current);
  }, [activeConversationId]);

  useEffect(() => {
    if (!activeConversationId) {
      setWorkspaceRunEvents([]);
      return;
    }

    void refreshWorkspaceRunEvents(activeConversationId, selectedRunId);
    void refreshRunArtifacts(activeConversationId, selectedRunId);
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
  const activeProviderLabel = activeConversation
    ? providersByKind[activeConversation.providerKind]?.label ?? activeConversation.providerKind
    : "선택 안 됨";
  const activeReasoningLabel = activeConversation
    ? getReasoningLabel(
        activeConversation.providerKind,
        activeConversation.model,
        activeConversation.reasoningLevel,
      )
    : "선택 안 됨";

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
      await refreshEngineStatus();
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

  function handleOpenAgentSettings() {
    setSettingsOpen(false);
    setAgentDraft(createAgentDraft(activeAgent));
    setAgentSoulDraft(createAgentSoulDraft(agentSoul));
    setAgentHeartbeatDraft(createAgentHeartbeatDraft(agentHeartbeat));
    setStandingOrdersDraft(standingOrders?.content ?? "");
    setAgentSettingsOpen(true);
  }

  function handleOpenProviderSettings() {
    setAgentSettingsOpen(false);
    setSettingsOpen(true);
  }

  function handleCockpitNavigate(target: CockpitNavTarget) {
    setActiveNavTarget(target);

    if (target === "chat") {
      setActiveSection("chat");
      return;
    }

    if (target === "settings") {
      setActiveSection("settings");
      return;
    }

    setActiveSection(target);
  }

  async function refreshSkillTemplates() {
    await refreshSkillTemplatesFromHook(activeAgentIdRef.current);
  }

  async function handleSaveAgentDefaults() {
    if (!activeAgentId) {
      setAppNotice("수정할 에이전트를 먼저 선택하세요.");
      return;
    }

    const agentId = activeAgentId;
    const parsedIntervalMinutes = Number.parseInt(agentHeartbeatDraft.intervalMinutes, 10);
    if (!Number.isInteger(parsedIntervalMinutes) || parsedIntervalMinutes < 1) {
      setAppNotice("Heartbeat 주기는 1분 이상의 정수여야 합니다.");
      return;
    }

    setSavingAgent(true);
    try {
      const agentResponse = await saveAgent({
        agentId,
        name: agentDraft.name.trim(),
        providerKind: agentDraft.providerKind,
        model: agentDraft.model,
        reasoningLevel: normalizeReasoningLevel(
          agentDraft.providerKind,
          agentDraft.model,
          agentDraft.reasoningLevel,
        ),
      });
      setAgents((current) =>
        current.map((agent) => (agent.id === agentResponse.agent.id ? agentResponse.agent : agent)),
      );
      const soulResponse = await saveAgentSoul(agentId, {
        content: agentSoulDraft,
      });
      const heartbeatResponse = await saveAgentHeartbeat(agentId, {
        enabled: agentHeartbeatDraft.enabled,
        intervalMinutes: parsedIntervalMinutes,
        instructions: agentHeartbeatDraft.instructions,
      });
      if (activeAgentIdRef.current === agentId) {
        setActiveAgent(agentResponse.agent);
        setAgentDraft(createAgentDraft(agentResponse.agent));
        setAgentSoul(soulResponse.soul);
        setAgentSoulDraft(soulResponse.soul.content);
        setAgentHeartbeat(heartbeatResponse.heartbeat);
        setAgentHeartbeatDraft(createAgentHeartbeatDraft(heartbeatResponse.heartbeat));
        setAppNotice("에이전트 설정을 저장했습니다.");
      }
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "에이전트 설정 저장에 실패했습니다.");
    } finally {
      setSavingAgent(false);
    }
  }

  async function handleSaveStandingOrders() {
    if (!activeAgentId) {
      setAppNotice("에이전트를 먼저 선택하세요.");
      return;
    }

    const agentId = activeAgentId;
    setSavingStandingOrders(true);
    try {
      const response = await saveAgentStandingOrders(agentId, {
        content: standingOrdersDraft,
      });
      if (activeAgentIdRef.current === agentId) {
        setStandingOrders(response.standingOrders);
        setStandingOrdersDraft(response.standingOrders.content);
        setAppNotice("상시 지침을 저장했습니다.");
      }
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "상시 지침 저장에 실패했습니다.");
    } finally {
      setSavingStandingOrders(false);
    }
  }

  async function handleDeleteAgent(agentId: string) {
    if (agentId === "default-agent") {
      setAppNotice("기본 에이전트는 삭제할 수 없습니다.");
      return;
    }

    setDeletingAgentId(agentId);
    try {
      await deleteAgent(agentId);
      const remaining = agents.filter((agent) => agent.id !== agentId);
      const nextAgentId =
        activeAgentId === agentId
          ? remaining.find((agent) => agent.id === "default-agent")?.id ?? remaining[0]?.id ?? null
          : activeAgentId;

      setAgents(remaining);
      if (nextAgentId !== activeAgentId) {
        setActiveAgentId(nextAgentId);
      }
      setAgentSettingsOpen(false);
      setAppNotice("에이전트를 삭제했습니다.");
      await refreshAgents(nextAgentId);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "에이전트 삭제에 실패했습니다.");
    } finally {
      setDeletingAgentId(null);
    }
  }

  function requestDeleteAgent(agentId: string) {
    const agent = agents.find((item) => item.id === agentId) ?? null;
    if (!agent) {
      setAppNotice("삭제할 에이전트를 찾을 수 없습니다.");
      return;
    }

    if (agent.id === "default-agent") {
      setAppNotice("기본 에이전트는 삭제할 수 없습니다.");
      return;
    }

    const confirmed =
      typeof window === "undefined" ||
      typeof window.confirm !== "function" ||
      window.confirm(`"${agent.name}" 에이전트를 삭제할까요? 이 에이전트의 세션과 작업도 함께 정리됩니다.`);

    if (!confirmed) {
      return;
    }

    void handleDeleteAgent(agentId);
  }

  async function handleStartBackgroundTask() {
    if (!activeAgentId || !activeConversation || !composerText.trim()) {
      setAppNotice("백그라운드 태스크로 실행할 내용을 입력하세요.");
      return;
    }

    const agentId = activeAgentId;
    const conversation = activeConversation;
    const prompt = composerText.trim();
    setComposerText("");
    try {
      const response = await createAgentTask(agentId, {
        conversationId: conversation.id,
        title: prompt.slice(0, 80),
        prompt,
        providerKind: conversation.providerKind,
        model: conversation.model,
        reasoningLevel: conversation.reasoningLevel,
      });
      if (
        activeAgentIdRef.current !== agentId ||
        activeConversationIdRef.current !== conversation.id
      ) {
        return;
      }
      setTasks((current) => [response.task, ...current.filter((task) => task.id !== response.task.id)]);
      setSelectedTaskId(response.task.id);
      setAppNotice("백그라운드 태스크를 시작했습니다.");
      void refreshAgentTasks(agentId);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "백그라운드 태스크를 시작하지 못했습니다.");
    }
  }

  async function handleCreateMcpTestRun(server: McpServerSummary) {
    if (!activeAgentId) {
      setAppNotice("에이전트를 먼저 선택하세요.");
      return null;
    }
    const agentId = activeAgentId;
    const conversationId = activeConversationIdRef.current;
    setMcpTestRunPendingId(server.id);
    try {
      const response = await createMcpTestRun({
        agentId,
        conversationId,
        catalogId: server.status === "candidate" ? server.id : undefined,
        serverId: server.status === "configured" ? server.id : undefined,
        autoStart: true,
      });
      if (activeAgentIdRef.current !== agentId) {
        return;
      }
      setTasks((current) => [response.task, ...current.filter((task) => task.id !== response.task.id)]);
      setSelectedTaskId(response.task.id);
      setConversations((current) => mergeConversationList(current, response.conversation));
      if (!activeConversationIdRef.current) {
        setActiveConversationId(response.conversation.id);
      }
      setAppNotice(`${server.name} MCP 테스트 Run을 생성했습니다.`);
      void refreshAgentTasks(agentId);
      void refreshMcpMetadata();
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "MCP 테스트 Run을 생성하지 못했습니다.");
    } finally {
      setMcpTestRunPendingId(null);
    }
  }

  async function handleCreateSkillFlow(template: SkillTemplateRecord) {
    if (!activeAgentId) {
      setAppNotice("에이전트를 먼저 선택하세요.");
      return;
    }
    setSkillActionPendingId(`flow:${template.id}`);
    try {
      const createdFlow = await handleCreateTaskFlow({
        title: template.flowTemplate.title,
        autoStart: false,
        steps: template.flowTemplate.steps,
      });
      if (createdFlow) {
        setActiveNavTarget("workflow");
        setActiveSection("workflow");
        setAppNotice(`${template.name} 템플릿으로 대기 중인 Flow를 만들었습니다.`);
      }
    } finally {
      setSkillActionPendingId(null);
    }
  }

  async function handleApplySkillStandingOrders(template: SkillTemplateRecord) {
    if (!activeAgentId) {
      setAppNotice("에이전트를 먼저 선택하세요.");
      return;
    }
    const agentId = activeAgentId;
    setSkillActionPendingId(`standing:${template.id}`);
    try {
      const response = await applySkillTemplateToStandingOrders(agentId, template.id);
      if (activeAgentIdRef.current !== agentId) {
        return;
      }
      setStandingOrders(response.standingOrders);
      setStandingOrdersDraft(response.standingOrders.content);
      setAppNotice(
        response.applied
          ? `${template.name} 스킬을 상시 지침에 추가했습니다.`
          : `${template.name} 스킬은 이미 상시 지침에 적용되어 있습니다.`,
      );
      void refreshStandingOrders(agentId);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "상시 지침에 스킬을 적용하지 못했습니다.");
    } finally {
      setSkillActionPendingId(null);
    }
  }

  async function handleApplySkillHeartbeat(template: SkillTemplateRecord) {
    if (!activeAgentId) {
      setAppNotice("에이전트를 먼저 선택하세요.");
      return;
    }
    const agentId = activeAgentId;
    setSkillActionPendingId(`heartbeat:${template.id}`);
    try {
      const response = await applySkillTemplateToHeartbeat(agentId, template.id);
      if (activeAgentIdRef.current !== agentId) {
        return;
      }
      setAgentHeartbeat(response.heartbeat);
      setAgentHeartbeatDraft(createAgentHeartbeatDraft(response.heartbeat));
      setAppNotice(
        response.applied
          ? `${template.name} Heartbeat 지침을 추가했습니다. 활성화 상태는 변경하지 않았습니다.`
          : `${template.name} Heartbeat 지침은 이미 적용되어 있습니다.`,
      );
      void refreshAgentHeartbeat(agentId);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "Heartbeat에 스킬을 적용하지 못했습니다.");
    } finally {
      setSkillActionPendingId(null);
    }
  }

  function handleInsertSkillPrompt(template: SkillTemplateRecord) {
    const prompt = template.suggestedPrompt.trim();
    setComposerText((current) => (current.trim() ? `${current.trim()}\n\n${prompt}` : prompt));
    setActiveNavTarget("chat");
    setActiveSection("chat");
    setAppNotice(`${template.name} 프롬프트를 채팅 입력창에 삽입했습니다.`);
  }

  async function handleCreateCustomSkillTemplate(
    payload: CustomSkillTemplateCreatePayload,
  ) {
    if (!activeAgentId) {
      setAppNotice("에이전트를 먼저 선택하세요.");
      return;
    }
    const agentId = activeAgentId;
    const template = await createCustomSkillTemplateFromHook(agentId, payload);
    if (template && activeAgentIdRef.current === agentId) {
      void refreshSkillTemplates();
    }
  }

  async function handleUpdateCustomSkillTemplate(
    template: SkillTemplateRecord,
    payload: CustomSkillTemplateUpdatePayload,
  ) {
    if (!activeAgentId) {
      setAppNotice("에이전트를 먼저 선택하세요.");
      return;
    }
    const agentId = activeAgentId;
    const updatedTemplate = await updateCustomSkillTemplateFromHook(agentId, template.id, payload);
    if (updatedTemplate && activeAgentIdRef.current === agentId) {
      void refreshSkillTemplates();
    }
  }

  async function handleDeleteCustomSkillTemplate(template: SkillTemplateRecord) {
    if (!activeAgentId || template.builtIn) {
      return;
    }
    if (!window.confirm(`"${template.name}" Skill을 삭제할까요?`)) {
      return;
    }
    const agentId = activeAgentId;
    await deleteCustomSkillTemplateFromHook(agentId, template);
  }

  async function handleCancelTask(taskId: string) {
    if (!activeAgentId) {
      return;
    }

    const agentId = activeAgentId;
    try {
      const response = await cancelAgentTask(agentId, taskId);
      if (activeAgentIdRef.current !== agentId) {
        return;
      }
      setTasks((current) =>
        current.map((task) => (task.id === response.task.id ? response.task : task)),
      );
      setAppNotice("백그라운드 작업을 취소했습니다.");
      void refreshAgentTasks(agentId);
      void refreshTaskEvents(agentId, taskId);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "백그라운드 작업을 취소하지 못했습니다.");
    }
  }

  async function handleRetryTask(taskId: string, force = false) {
    if (!activeAgentId) {
      return;
    }
    const agentId = activeAgentId;
    try {
      const response = await retryAgentTask(agentId, taskId, { autoStart: true, force });
      if (activeAgentIdRef.current !== agentId) {
        return;
      }
      setTasks((current) => [response.task, ...current.filter((task) => task.id !== response.task.id)]);
      setSelectedTaskId(response.task.id);
      setAppNotice("Task 재시도 작업을 만들었습니다.");
      void refreshAgentTasks(agentId);
      void refreshTaskEvents(agentId, response.task.id);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "Task 재시도에 실패했습니다.");
    }
  }

  async function handleCreateSubagentSession(payload: { title?: string; prompt: string }) {
    if (!activeConversation || !activeAgentId) {
      setAppNotice("대화를 먼저 선택하세요.");
      return;
    }

    const conversation = activeConversation;
    const agentId = activeAgentId;
    try {
      const response = await createSubagentSession(conversation.id, {
        title: payload.title,
        prompt: payload.prompt,
        providerKind: conversation.providerKind,
        model: conversation.model,
        reasoningLevel: conversation.reasoningLevel,
      });
      if (activeConversationIdRef.current !== conversation.id || activeAgentIdRef.current !== agentId) {
        return;
      }
      setSubagentSessions((current) =>
        [response.session, ...current.filter((session) => session.id !== response.session.id)].sort(
          (left, right) => right.updatedAt - left.updatedAt,
        ),
      );
      setTasks((current) =>
        [response.task, ...current.filter((task) => task.id !== response.task.id)].sort(
          (left, right) => right.updatedAt - left.updatedAt,
        ),
      );
      setSelectedTaskId(response.task.id);
      setConversations((current) => mergeConversationList(current, response.session));
      setAppNotice("하위 에이전트 세션을 만들었습니다.");
      void refreshSubagentSessions(conversation.id);
      void refreshAgentTasks(agentId);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "하위 에이전트 세션 생성에 실패했습니다.");
    }
  }

  async function handleCancelSubagentSession(sessionId: string) {
    try {
      const response = await cancelSubagentSession(sessionId);
      if (response.task) {
        setTasks((current) =>
          current.map((task) => (task.id === response.task?.id ? response.task : task)),
        );
      }
      if (activeConversationIdRef.current) {
        void refreshSubagentSessions(activeConversationIdRef.current);
      }
      if (activeAgentIdRef.current) {
        void refreshAgentTasks(activeAgentIdRef.current);
      }
      setAppNotice("서브에이전트 실행을 취소했습니다.");
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "하위 에이전트 세션 취소에 실패했습니다.");
    }
  }

  async function handleCreateTaskFlow(payload: {
    title: string;
    autoStart?: boolean;
    steps: Array<{
      stepKey: string;
      title: string;
      prompt: string;
      dependencyStepKey?: string | null;
    }>;
  }) {
    if (!activeAgentId) {
      setAppNotice("에이전트를 먼저 선택하세요.");
      return;
    }

    const agentId = activeAgentId;
    try {
      const response = await createTaskFlow(agentId, {
        conversationId: activeConversationId ?? null,
        title: payload.title,
        autoStart: payload.autoStart ?? true,
        steps: payload.steps,
      });
      if (activeAgentIdRef.current !== agentId) {
        return;
      }
      setTaskFlows((current) =>
        [response.flow, ...current.filter((flow) => flow.id !== response.flow.id)].sort(
          (left, right) => right.updatedAt - left.updatedAt,
        ),
      );
      setSelectedTaskFlowId(response.flow.id);
      setSelectedTaskFlow(response);
      setAppNotice("작업 흐름을 만들었습니다.");
      void refreshTaskFlows(agentId, response.flow.id);
      void refreshTaskFlowDetail(agentId, response.flow.id);
      return response.flow;
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "작업 흐름 생성에 실패했습니다.");
      return null;
    }
  }

  async function handleTaskFlowControl(
    flowId: string,
    action: "start" | "resume",
  ) {
    if (!activeAgentId) {
      return;
    }
    const agentId = activeAgentId;
    try {
      const response = action === "start" ? await startTaskFlow(flowId) : await resumeTaskFlow(flowId);
      if (activeAgentIdRef.current !== agentId) {
        return;
      }
      setSelectedTaskFlow(response);
      setSelectedTaskFlowId(response.flow.id);
      void refreshTaskFlows(agentId, response.flow.id);
      void refreshTaskFlowDetail(agentId, response.flow.id);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : `작업 흐름 ${action} 동작에 실패했습니다.`);
    }
  }

  async function handleTaskFlowStepControl(
    flowId: string,
    stepId: string,
    action: "retry" | "skip" | "approve" | "deny",
  ) {
    if (!activeAgentId) {
      return;
    }
    const agentId = activeAgentId;
    try {
      const response =
        action === "retry"
          ? await retryTaskFlowStep(flowId, stepId)
          : action === "approve"
            ? await approveTaskFlowStep(flowId, stepId)
            : action === "deny"
              ? await denyTaskFlowStep(flowId, stepId)
              : await skipTaskFlowStep(flowId, stepId);
      if (activeAgentIdRef.current !== agentId) {
        return;
      }
      setSelectedTaskFlow(response);
      setSelectedTaskFlowId(response.flow.id);
      void refreshTaskFlows(agentId, response.flow.id);
      void refreshTaskFlowDetail(agentId, response.flow.id);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : `작업 흐름 단계 ${action} 동작에 실패했습니다.`);
    }
  }

  async function handleCancelTaskFlow(flowId: string) {
    if (!activeAgentId) {
      return;
    }

    const agentId = activeAgentId;
    try {
      await cancelTaskFlow(flowId);
      if (activeAgentIdRef.current === agentId) {
        if (selectedTaskFlowIdRef.current === flowId) {
          setSelectedTaskFlow(null);
        }
        void refreshTaskFlows(agentId, selectedTaskFlowIdRef.current === flowId ? null : selectedTaskFlowIdRef.current);
      }
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "작업 흐름 취소에 실패했습니다.");
    }
  }

  async function handleSaveTaskFlowSteps(
    flowId: string,
    steps: TaskFlowStepDraft[],
    title?: string,
  ) {
    if (!activeAgentId) {
      return;
    }

    const agentId = activeAgentId;
    try {
      const response = await saveTaskFlowSteps(flowId, steps, title);
      if (activeAgentIdRef.current !== agentId || response.flow.id !== flowId) {
        return;
      }

      selectedTaskFlowIdRef.current = response.flow.id;
      setSelectedTaskFlowId(response.flow.id);
      setSelectedTaskFlow(response);
      setTaskFlows((current) =>
        [response.flow, ...current.filter((flow) => flow.id !== response.flow.id)].sort(
          (left, right) => right.updatedAt - left.updatedAt,
        ),
      );
      setAppNotice("Flow 단계를 저장했습니다.");
      void refreshTaskFlows(agentId, response.flow.id);
      void refreshTaskFlowDetail(agentId, response.flow.id);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "Flow 단계 저장에 실패했습니다.");
    }
  }

  async function handleDeleteTaskFlow(flowId: string) {
    if (!activeAgentId) {
      return;
    }

    const agentId = activeAgentId;
    try {
      await deleteTaskFlow(flowId);
      if (activeAgentIdRef.current !== agentId) {
        return;
      }

      const wasSelected = selectedTaskFlowIdRef.current === flowId;
      const remaining = taskFlows.filter((flow) => flow.id !== flowId);
      const nextFlowId =
        wasSelected || !remaining.some((flow) => flow.id === selectedTaskFlowIdRef.current)
          ? remaining[0]?.id ?? null
          : selectedTaskFlowIdRef.current;

      selectedTaskFlowIdRef.current = nextFlowId;
      setTaskFlows(remaining);
      setSelectedTaskFlowId(nextFlowId);
      if (!nextFlowId || wasSelected) {
        setSelectedTaskFlow(null);
      }
      setAppNotice("Flow를 삭제했습니다.");
      void refreshTaskFlows(agentId, nextFlowId);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "Flow 삭제에 실패했습니다.");
    }
  }

  async function handleSaveTaskFlowAsSkill(flowId: string, force = false) {
    if (!activeAgentId) {
      return;
    }
    const agentId = activeAgentId;
    try {
      const response = await saveSkillTemplateFromFlow(agentId, flowId, force);
      setAppNotice(
        response.updatedExisting
          ? "기존 Flow 기반 Skill을 갱신했습니다."
          : "현재 Flow를 사용자 정의 Skill로 저장했습니다.",
      );
      void refreshSkillTemplates();
      setActiveSection("skills");
      setActiveNavTarget("skills");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Flow를 Skill로 저장하지 못했습니다.";
      if (!force && window.confirm(`${message}\n\n기존 Skill을 갱신할까요?`)) {
        await handleSaveTaskFlowAsSkill(flowId, true);
        return;
      }
      setAppNotice(message);
    }
  }

  function handleSelectTaskFlow(flowId: string) {
    selectedTaskFlowIdRef.current = flowId;
    setSelectedTaskFlowId(flowId);
  }

  async function handleGenerateFlowDraft() {
    if (!activeAgentId || !activeConversationId) {
      setFlowDraftError("먼저 에이전트와 세션을 선택해 주세요.");
      return;
    }
    const prompt = (flowDraftPrompt || composerText).trim();
    if (!prompt) {
      setFlowDraftError("Flow로 만들 목표를 입력해 주세요.");
      return;
    }

    setFlowDraftLoading(true);
    setFlowDraftError(null);
    try {
      const response = await draftFlowFromPrompt(activeAgentId, {
        conversationId: activeConversationId,
        prompt,
      });
      setFlowDraft(response.draft);
      setFlowDraftEditing(false);
      setFlowDraftPrompt(prompt);
    } catch (error) {
      setFlowDraftError(error instanceof Error ? error.message : "Flow 초안을 만들지 못했습니다.");
    } finally {
      setFlowDraftLoading(false);
    }
  }

  async function handleSaveFlowDraft() {
    if (!flowDraft) {
      return;
    }
    await handleCreateTaskFlow({
      title: flowDraft.title,
      autoStart: false,
      steps: flowDraft.steps,
    });
    setFlowDraft(null);
    setFlowDraftEditing(false);
    setFlowDraftError(null);
    setActiveNavTarget("workflow");
    setActiveSection("workflow");
  }

  async function handleRefreshSummary() {
    if (!activeConversationId) {
      return;
    }
    setSummaryLoading(true);
    try {
      const response = await refreshConversationSummary(activeConversationId);
      setSessionSummary(response.summary);
      setSessionSummaryDraft(response.summary.summary);
      setSummaryEditing(false);
      setAppNotice("세션 요약을 새로고침했습니다.");
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "세션 요약 새로고침에 실패했습니다.");
    } finally {
      setSummaryLoading(false);
    }
  }

  async function handleRefreshSummaryTask() {
    if (!activeConversationId || !activeAgentId) {
      setAppNotice("요약 제안을 만들 세션이 없습니다.");
      return;
    }
    setSummaryLoading(true);
    try {
      const response = await refreshConversationSummaryTask(activeConversationId);
      setTasks((current) => [response.task, ...current.filter((task) => task.id !== response.task.id)]);
      setSelectedTaskId(response.task.id);
      setAppNotice(response.message);
      void refreshAgentTasks(activeAgentId);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "opencode 요약 제안 Task 생성에 실패했습니다.");
    } finally {
      setSummaryLoading(false);
    }
  }

  async function handleLoadSummarySuggestions() {
    if (!activeConversationId) {
      return;
    }
    setSummaryLoading(true);
    try {
      const response = await getConversationSummarySuggestions(activeConversationId);
      setSessionSummarySuggestions(response.suggestions);
      setAppNotice(
        response.suggestions.length
          ? "완료된 요약 제안을 불러왔습니다."
          : "아직 적용할 수 있는 완료된 요약 제안이 없습니다.",
      );
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "요약 제안을 불러오지 못했습니다.");
    } finally {
      setSummaryLoading(false);
    }
  }

  async function handleApplySummarySuggestion(suggestion: SessionSummarySuggestionRecord) {
    if (!activeConversationId) {
      return;
    }
    setSummaryLoading(true);
    try {
      const parsed = suggestion.suggestion.parsed;
      const response = await applyConversationSummarySuggestion(activeConversationId, {
        taskId: suggestion.task.id,
        summary: parsed.summary,
        decisions: parsed.decisions,
        openQuestions: parsed.openQuestions,
        nextActions: parsed.nextActions,
        metadata: parsed.metadata ?? {},
      });
      setSessionSummary(response.summary);
      setSessionSummaryDraft(response.summary.summary);
      setSummaryEditing(false);
      setAppNotice("검토한 요약 제안을 프로젝트 메모리에 저장했습니다.");
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "요약 제안 적용에 실패했습니다.");
    } finally {
      setSummaryLoading(false);
    }
  }

  async function handleSaveSummary() {
    if (!activeConversationId) {
      return;
    }
    setSummaryLoading(true);
    try {
      const response = await saveConversationSummary(activeConversationId, {
        summary: sessionSummaryDraft,
        decisions: sessionSummary?.decisions ?? [],
        openQuestions: sessionSummary?.openQuestions ?? [],
        nextActions: sessionSummary?.nextActions ?? [],
        metadata: sessionSummary?.metadata ?? {},
      });
      setSessionSummary(response.summary);
      setSessionSummaryDraft(response.summary.summary);
      setSummaryEditing(false);
      setAppNotice("세션 요약을 저장했습니다.");
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "세션 요약 저장에 실패했습니다.");
    } finally {
      setSummaryLoading(false);
    }
  }

  async function handlePreviewArtifact(artifactId: string, mode: "redacted" | "full" = "redacted") {
    setRunDetailLoading(true);
    try {
      setArtifactPreview(await previewArtifact(artifactId, undefined, mode));
    } catch (error) {
      setAppNotice(
        error instanceof Error
          ? error.message
          : mode === "full"
            ? "원문 보고서를 불러오지 못했습니다."
            : "산출물 미리보기를 불러오지 못했습니다.",
      );
    } finally {
      setRunDetailLoading(false);
    }
  }

  async function handleArtifactDiff(artifactId: string) {
    setRunDetailLoading(true);
    try {
      setArtifactDiff(await getArtifactDiff(artifactId));
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "산출물 diff를 불러오지 못했습니다.");
    } finally {
      setRunDetailLoading(false);
    }
  }

  async function handleOpenRunDebug(runId = selectedRunId) {
    if (!activeConversationId || !runId) {
      return;
    }
    setRunDetailLoading(true);
    try {
      setRunDebug(await getRunDebug(activeConversationId, runId));
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "Run 디버그 정보를 불러오지 못했습니다.");
    } finally {
      setRunDetailLoading(false);
    }
  }

  function handleCopyDebugBundle() {
    if (!runDebug) {
      return;
    }
    const payload = JSON.stringify(runDebug, null, 2);
    void navigator.clipboard?.writeText(payload).then(
      () => setAppNotice("Debug bundle을 클립보드에 복사했습니다."),
      () => setAppNotice("클립보드 복사에 실패했습니다."),
    );
  }

  async function readReportArtifactContent(artifactId: string) {
    const preview = await previewArtifact(artifactId);
    setArtifactPreview(preview);
    if (preview.preview.binary) {
      throw new Error("보고서 내용을 텍스트로 읽을 수 없습니다.");
    }
    return preview.preview.content;
  }

  async function handleCopyReportArtifact(artifactId: string) {
    try {
      const content = await readReportArtifactContent(artifactId);
      await navigator.clipboard?.writeText(content);
      setAppNotice("보고서를 클립보드에 복사했습니다.");
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "보고서 복사에 실패했습니다.");
    }
  }

  function findReportArtifact(artifactId: string) {
    return runArtifacts.find((artifact) => artifact.id === artifactId && artifact.kind === "report") ?? null;
  }

  async function handleCreateFollowUpTaskFromReport(artifactId: string) {
    const artifact = findReportArtifact(artifactId);
    if (!artifact || !activeAgentId || !activeConversation) {
      setAppNotice("후속 Task를 만들 보고서 또는 세션이 없습니다.");
      return;
    }
    const nextAction =
      typeof artifact.metadata.nextRecommendedAction === "string"
        ? artifact.metadata.nextRecommendedAction
        : "보고서를 바탕으로 후속 작업을 계획하고 실행하세요.";
    try {
      const response = await createAgentTask(activeAgentId, {
        conversationId: activeConversation.id,
        title: `후속 Task: ${artifact.title}`.slice(0, 80),
        prompt: [
          "다음 AetherOps 보고서를 바탕으로 후속 작업을 수행하세요.",
          "검증 명령이 필요하면 opencode 세션 sandbox 안에서 실행하고 결과를 요약하세요.",
          "",
          `권장 작업: ${nextAction}`,
          "",
          typeof artifact.metadata.markdown === "string" ? artifact.metadata.markdown : artifact.summary ?? "",
        ].join("\n"),
        providerKind: activeConversation.providerKind,
        model: activeConversation.model,
        reasoningLevel: activeConversation.reasoningLevel,
        autoStart: false,
      });
      setTasks((current) => [response.task, ...current.filter((task) => task.id !== response.task.id)]);
      setSelectedTaskId(response.task.id);
      setAppNotice("후속 Task를 대기열에 만들었습니다.");
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "후속 Task 생성에 실패했습니다.");
    }
  }

  async function handleCreateFollowUpFlowFromReport(artifactId: string) {
    const artifact = findReportArtifact(artifactId);
    if (!artifact) {
      setAppNotice("후속 Flow를 만들 보고서가 없습니다.");
      return;
    }
    const nextAction =
      typeof artifact.metadata.nextRecommendedAction === "string"
        ? artifact.metadata.nextRecommendedAction
        : "보고서를 검토하고 다음 실행 계획을 만드세요.";
    await handleCreateTaskFlow({
      title: `후속 Flow: ${artifact.title}`.slice(0, 80),
      autoStart: false,
      steps: [
        {
          stepKey: "review-report",
          title: "보고서 검토",
          prompt: [
            "AetherOps 보고서를 검토하고 완료/실패 원인을 정리하세요.",
            typeof artifact.metadata.markdown === "string" ? artifact.metadata.markdown : artifact.summary ?? "",
          ].join("\n\n"),
          dependencyStepKey: null,
        },
        {
          stepKey: "follow-up-plan",
          title: "후속 계획",
          prompt: `다음 권장 작업을 실행 가능한 opencode 작업 계획으로 정리하세요.\n\n${nextAction}`,
          dependencyStepKey: "review-report",
        },
      ],
    });
  }

  async function handleTriggerHeartbeat() {
    if (!activeAgentId) {
      setAppNotice("에이전트를 먼저 선택하세요.");
      return;
    }
    if (heartbeatTriggeringRef.current) {
      setAppNotice("Heartbeat 실행 요청을 이미 처리 중입니다.");
      return;
    }

    const agentId = activeAgentId;
    heartbeatTriggeringRef.current = true;
    setHeartbeatTriggering(true);
    try {
      const response = await triggerAgentHeartbeat(agentId);
      const nextLog = response.log ?? response.heartbeatLog ?? null;
      if (response.heartbeat && activeAgentIdRef.current === agentId) {
        setAgentHeartbeat(response.heartbeat);
      }
      if (nextLog && activeAgentIdRef.current === agentId) {
        setHeartbeatLogs((current) => [nextLog, ...current.filter((log) => log.id !== nextLog.id)]);
      }
      if (activeAgentIdRef.current === agentId) {
        setAppNotice(response.message ?? "Heartbeat를 수동으로 실행했습니다.");
      }
      void refreshAgentHeartbeat(agentId);
      void refreshHeartbeatLogs(agentId);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "Heartbeat 실행에 실패했습니다.");
    } finally {
      heartbeatTriggeringRef.current = false;
      setHeartbeatTriggering(false);
    }
  }

  async function handleCreateAutomationRule(payload: {
    title: string;
    prompt: string;
    intervalMinutes: number;
    enabled: boolean;
  }) {
    if (!activeAgentId) {
      setAppNotice("에이전트를 먼저 선택하세요.");
      return;
    }
    const agentId = activeAgentId;
    try {
      const response = await createAgentAutomationRule(agentId, {
        ...payload,
        conversationId: activeConversationIdRef.current,
        providerKind: activeConversation?.providerKind ?? activeAgent?.providerKind,
        model: activeConversation?.model ?? activeAgent?.model,
        reasoningLevel: activeConversation?.reasoningLevel ?? activeAgent?.reasoningLevel,
      });
      if (activeAgentIdRef.current === agentId) {
        setAutomationRules((current) => [response.rule, ...current.filter((rule) => rule.id !== response.rule.id)]);
        setAppNotice("자동화 규칙을 만들었습니다.");
      }
      void refreshAutomationRules(agentId);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "자동화 규칙을 만들지 못했습니다.");
    }
  }

  async function handleUpdateAutomationRule(
    ruleId: string,
    payload: Partial<{
      title: string;
      prompt: string;
      intervalMinutes: number;
      enabled: boolean;
    }>,
  ) {
    if (!activeAgentId) {
      setAppNotice("에이전트를 먼저 선택하세요.");
      return;
    }
    const agentId = activeAgentId;
    try {
      const response = await updateAgentAutomationRule(agentId, ruleId, payload);
      if (response.rule && activeAgentIdRef.current === agentId) {
        setAutomationRules((current) =>
          current.map((rule) => (rule.id === response.rule!.id ? response.rule! : rule)),
        );
      }
      setAppNotice("자동화 규칙을 저장했습니다.");
      void refreshAutomationRules(agentId);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "자동화 규칙을 저장하지 못했습니다.");
    }
  }

  async function handleDeleteAutomationRule(ruleId: string) {
    if (!activeAgentId) {
      setAppNotice("에이전트를 먼저 선택하세요.");
      return;
    }
    if (!window.confirm("이 자동화 규칙을 삭제할까요? 과거 작업 로그는 유지됩니다.")) {
      return;
    }
    const agentId = activeAgentId;
    try {
      await deleteAgentAutomationRule(agentId, ruleId);
      if (activeAgentIdRef.current === agentId) {
        setAutomationRules((current) => current.filter((rule) => rule.id !== ruleId));
        setAppNotice("자동화 규칙을 삭제했습니다.");
      }
      void refreshAutomationRules(agentId);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "자동화 규칙을 삭제하지 못했습니다.");
    }
  }

  async function handleTriggerAutomationRule(ruleId: string) {
    if (!activeAgentId) {
      setAppNotice("에이전트를 먼저 선택하세요.");
      return;
    }
    if (triggeringAutomationRuleIdsRef.current.has(ruleId)) {
      setAppNotice("이 자동화 규칙은 이미 실행 요청을 처리 중입니다.");
      return;
    }
    const agentId = activeAgentId;
    triggeringAutomationRuleIdsRef.current = new Set(triggeringAutomationRuleIdsRef.current).add(ruleId);
    setTriggeringAutomationRuleIds(Array.from(triggeringAutomationRuleIdsRef.current));
    try {
      const response = await triggerAgentAutomationRule(agentId, ruleId);
      if (activeAgentIdRef.current === agentId) {
        setAutomationRules((current) =>
          current.map((rule) => (rule.id === response.rule.id ? response.rule : rule)),
        );
        setTasks((current) => [response.task, ...current.filter((task) => task.id !== response.task.id)]);
        setSelectedTaskId(response.task.id);
        setAppNotice(response.message ?? "자동화 규칙을 즉시 실행했습니다.");
      }
      void refreshAutomationRules(agentId);
      void refreshAgentTasks(agentId);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "자동화 규칙을 실행하지 못했습니다.");
    } finally {
      const nextPendingRuleIds = new Set(triggeringAutomationRuleIdsRef.current);
      nextPendingRuleIds.delete(ruleId);
      triggeringAutomationRuleIdsRef.current = nextPendingRuleIds;
      setTriggeringAutomationRuleIds(Array.from(nextPendingRuleIds));
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

  async function handleRefreshOpenCodeModels() {
    setEngineStatusLoading(true);
    try {
      const result = await refreshOpenCodeModels();
      setAppNotice(result.message);
      await refreshEngineStatus();
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "opencode 모델 갱신에 실패했습니다.");
    } finally {
      setEngineStatusLoading(false);
    }
  }

  function beginProviderAuthAction(action: string) {
    if (providerAuthActionRef.current) {
      setAppNotice("다른 인증 작업을 처리 중입니다. 잠시 후 다시 시도하세요.");
      return false;
    }
    providerAuthActionRef.current = action;
    setProviderAuthAction(action);
    return true;
  }

  function finishProviderAuthAction(action: string) {
    if (providerAuthActionRef.current === action) {
      providerAuthActionRef.current = null;
      setProviderAuthAction(null);
    }
  }

  async function handleConnectOpenCodeOAuth() {
    const action = "opencode-oauth";
    if (!beginProviderAuthAction(action)) {
      return;
    }
    setEngineStatusLoading(true);
    try {
      const result = await startOpenCodeAuthLogin({ provider: "openai", launch: true });
      setAppNotice(result.message);
      await refreshEngineStatus();
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "opencode OAuth 연결을 시작하지 못했습니다.");
    } finally {
      setEngineStatusLoading(false);
      finishProviderAuthAction(action);
    }
  }

  async function handleConnectCodex() {
    const action = "codex-oauth";
    if (!beginProviderAuthAction(action)) {
      return;
    }
    try {
      setAppNotice("공식 Codex OAuth 흐름을 시작합니다.");
      const response = await startCodexOAuth(window.location.origin);
      await refreshProviders();
      const opencodeResult = await startOpenCodeAuthLogin({ provider: "openai", launch: true });
      await refreshEngineStatus();
      setAppNotice(`${response.message} ${opencodeResult.message}`);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "Codex OAuth 시작에 실패했습니다.");
    } finally {
      finishProviderAuthAction(action);
    }
  }

  async function handleImportCodex() {
    const action = "codex-import";
    if (!beginProviderAuthAction(action)) {
      return;
    }
    try {
      await importCodexCliAuth();
      await refreshProviders();
      const opencodeResult = await startOpenCodeAuthLogin({ provider: "openai", launch: true });
      await refreshEngineStatus();
      setAppNotice(`Codex CLI 인증 정보를 가져왔습니다. ${opencodeResult.message}`);
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "Codex CLI 인증 가져오기에 실패했습니다.");
    } finally {
      finishProviderAuthAction(action);
    }
  }

  async function handleLogoutCodex() {
    const action = "codex-logout";
    if (!beginProviderAuthAction(action)) {
      return;
    }
    try {
      await logoutCodex();
      await refreshProviders();
      await refreshEngineStatus();
      setAppNotice("OpenAI Codex 연결을 해제했습니다.");
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "Codex 로그아웃에 실패했습니다.");
    } finally {
      finishProviderAuthAction(action);
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

          if (eventName === "run_complete") {
            const completePayload = payload as StreamEventPayloadMap["run_complete"];
            setChangedFiles(completePayload.changedFiles ?? []);
            if (!manualRunSelectionRef.current && completePayload.runId) {
              setSelectedRunId(completePayload.runId);
            }
            void refreshWorkspaceRuns(conversation.id, completePayload.runId);
            void refreshRunArtifacts(conversation.id, completePayload.runId);
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
        await refreshSessionSummary(conversation.id);
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

  const selectedRun =
    selectedRunId ? workspaceRuns.find((run) => run.id === selectedRunId) ?? null : workspaceRuns[0] ?? null;

  return {
    activeSection,
    setActiveSection,
    activeNavTarget,
    setActiveNavTarget,
    agents,
    activeAgentId,
    setActiveAgentId,
    activeAgent,
    providers,
    engineStatus,
    engineStatusLoading,
    conversations,
    activeConversationId,
    setActiveConversationId,
    activeConversation,
    messages,
    modelsByProvider,
    modelsLoadingByProvider,
    modelErrorsByProvider,
    composerText,
    setComposerText,
    pendingAssistantText,
    setPendingAssistantText,
    chatError,
    setChatError,
    appNotice,
    setAppNotice,
    backendOnline,
    providerDrafts,
    setProviderDrafts,
    settingsOpen,
    setSettingsOpen,
    agentSettingsOpen,
    setAgentSettingsOpen,
    agentDraft,
    setAgentDraft,
    agentSoul,
    setAgentSoul,
    agentSoulDraft,
    setAgentSoulDraft,
    agentHeartbeat,
    setAgentHeartbeat,
    agentHeartbeatDraft,
    setAgentHeartbeatDraft,
    standingOrders,
    setStandingOrders,
    standingOrdersDraft,
    setStandingOrdersDraft,
    subagentSessions,
    taskFlows,
    selectedTaskFlowId,
    selectedTaskFlow,
    heartbeatLogs,
    automationRules,
    heartbeatTriggering,
    triggeringAutomationRuleIds,
    providerAuthAction,
    savingAgent,
    savingStandingOrders,
    deletingAgentId,
    savingKind,
    testingKind,
    streaming,
    workspaceRuns,
    tasks,
    selectedRunId,
    setSelectedRunId,
    selectedTaskId,
    workspaceRunEvents,
    taskEvents,
    platformMetadata,
    mcpTestRunPendingId,
    skillActionPendingId,
    liveEvents,
    setLiveEvents,
    changedFiles,
    setChangedFiles,
    sessionSummary,
    sessionSummaryDraft,
    setSessionSummaryDraft,
    sessionSummarySuggestions,
    summaryEditing,
    setSummaryEditing,
    summaryLoading,
    flowDraftPrompt,
    setFlowDraftPrompt,
    flowDraft,
    setFlowDraft,
    flowDraftEditing,
    setFlowDraftEditing,
    flowDraftLoading,
    flowDraftError,
    setFlowDraftError,
    runArtifacts,
    artifactPreview,
    setArtifactPreview,
    artifactDiff,
    setArtifactDiff,
    runDebug,
    runDetailLoading,
    mcpCatalog,
    mcpLoading,
    mcpSnippetValidation,
    mcpStatus,
    skillTemplates,
    skillTemplatesLoading,
    activeResearchProject,
    activeResearchProjectId,
    researchEvidence,
    researchHypotheses,
    researchLastReport,
    researchLoading,
    researchLoops,
    researchPreflight,
    researchProjects,
    researchQuestions,
    researchRagResults,
    researchRagStatus,
    researchSearchResults,
    researchSources,
    setActiveResearchProjectId,
    preflightLoading,
    preflightStatus,
    providersByKind,
    activeProvider,
    activeModelOption,
    activeModelCount,
    activeModelsLoading,
    activeModelsError,
    activeProviderLabel,
    activeReasoningLabel,
    selectedRun,
    manualRunSelectionRef,
    activeConversationIdRef,
    activeAgentIdRef,
    updateConversation,
    createConversationThread,
    refreshAgentTasks,
    refreshEngineStatus,
    refreshMcpMetadata,
    refreshPlatformMetadata,
    refreshPreflight,
    refreshRunArtifacts,
    refreshSkillTemplates,
    refreshSubagentSessions,
    refreshTaskEvents,
    refreshWorkspaceRunEvents,
    handleApplySkillHeartbeat,
    handleApplySkillStandingOrders,
    handleApplySummarySuggestion,
    handleArtifactDiff,
    handleCancelSubagentSession,
    handleCancelTask,
    handleCancelTaskFlow,
    handleCockpitNavigate,
    handleConnectCodex,
    handleConnectOpenCodeOAuth,
    handleCopyDebugBundle,
    handleCopyReportArtifact,
    handleCreateAgent,
    handleCreateAutomationRule,
    handleCreateCustomSkillTemplate,
    handleCreateFollowUpFlowFromReport,
    handleCreateFollowUpTaskFromReport,
    handleCreateMcpTestRun,
    handleCreateSkillFlow,
    handleCreateSubagentSession,
    handleCreateTaskFlow,
    handleDeleteAutomationRule,
    handleDeleteConversation,
    handleDeleteCustomSkillTemplate,
    handleDeleteTaskFlow,
    handleGenerateFlowDraft,
    handleImportCodex,
    handleInsertSkillPrompt,
    handleLoadSummarySuggestions,
    handleLogoutCodex,
    handleOpenAgentSettings,
    handleOpenProviderSettings,
    handleOpenRunDebug,
    handlePreviewArtifact,
    handleRefreshOpenCodeModels,
    handleRefreshSummary,
    handleRefreshSummaryTask,
    handleRetryTask,
    handleSaveAgentDefaults,
    handleSaveFlowDraft,
    handleSaveProvider,
    handleSaveStandingOrders,
    handleSaveSummary,
    handleSaveTaskFlowAsSkill,
    handleSaveTaskFlowSteps,
    handleSelectAgent,
    handleSelectTaskFlow,
    handleSendMessage,
    handleTaskFlowControl,
    handleTaskFlowStepControl,
    handleTestProvider,
    handleTriggerAutomationRule,
    handleTriggerHeartbeat,
    handleUpdateAutomationRule,
    handleUpdateCustomSkillTemplate,
    handleApplyMcpSnippet,
    handleValidateMcpSnippet,
    addResearchEvidence,
    addResearchHypothesis,
    addResearchQuestion,
    addResearchSource,
    cancelResearchLoop: cancelResearchLoopFromHook,
    createResearchProject: createResearchProjectFromHook,
    createResearchReport: createResearchReportFromHook,
    createResearchReportTask: createResearchReportTaskFromHook,
    createResearchSubagent: createResearchSubagentFromHook,
    patchResearchProject: patchResearchProjectFromHook,
    proposeResearchLoop: proposeResearchLoopFromHook,
    refreshResearchProjectDetail,
    refreshResearchProjects,
    rebuildProjectRagIndex,
    searchProjectRagRecords,
    searchResearchRecords,
    startResearchGoal: startResearchGoalFromHook,
    startSelfImprovementGoal: startSelfImprovementGoalFromHook,
    startResearchLoop: startResearchLoopFromHook,
    stopResearchGoal: stopResearchGoalFromHook,
    tickResearchGoal: tickResearchGoalFromHook,
    tickResearchLoop: tickResearchLoopFromHook,
    requestDeleteAgent,
  };
}
