import { ChatView } from "../components/ChatView";
import { CockpitOpsDrawer, CockpitRightRail } from "../components/CockpitPanels";
import { CockpitSectionView } from "../components/CockpitSectionView";
import { AgentSettingsDialog } from "../components/AgentSettingsDialog";
import { Composer } from "../components/Composer";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { ConversationList } from "../components/ConversationList";
import { ExtensionsSectionView } from "../components/ExtensionsSectionView";
import { FlowDraftPanel } from "../components/FlowDraftPanel";
import { ProviderSettingsDialog } from "../components/ProviderSettingsDialog";
import { ResearchSectionView } from "../components/ResearchSectionView";
import { RunArtifactsPanel } from "../components/RunArtifactsPanel";
import { SessionSummaryPanel } from "../components/SessionSummaryPanel";
import { SettingsSectionView } from "../components/SettingsSectionView";
import { SubagentPanel } from "../components/SubagentPanel";
import { getReasoningLabel, normalizeReasoningLevel } from "../reasoning-options";
import { displayAppNotice, displayConversationTitle, createAgentHeartbeatDraft, createAgentSoulDraft } from "../appStateUtils";
import type { ProviderKind } from "../types";
import type { useAetherOpsController } from "./useAetherOpsController";

type AetherOpsController = ReturnType<typeof useAetherOpsController>;

export function AetherOpsShell({ controller }: { controller: AetherOpsController }) {
  const {
    activeSection, setActiveSection, activeNavTarget, setActiveNavTarget, agents, activeAgentId, activeAgent, providers,
    engineStatus, engineStatusLoading, conversations, activeConversationId, setActiveConversationId, activeConversation,
    messages, modelsByProvider, modelsLoadingByProvider, modelErrorsByProvider, composerText, setComposerText,
    pendingAssistantText, setPendingAssistantText, chatError, setChatError, appNotice, setAppNotice, backendOnline, providerDrafts,
    setProviderDrafts, settingsOpen, setSettingsOpen, agentSettingsOpen, setAgentSettingsOpen, agentDraft, setAgentDraft,
    agentSoul, setAgentSoulDraft, agentHeartbeat, agentHeartbeatDraft, setAgentHeartbeatDraft, standingOrders,
    standingOrdersDraft, setStandingOrdersDraft, subagentSessions, taskFlows, selectedTaskFlow, heartbeatLogs, automationRules,
    heartbeatTriggering, triggeringAutomationRuleIds, providerAuthAction, savingAgent, savingStandingOrders, deletingAgentId,
    savingKind, testingKind, streaming, workspaceRuns, tasks, setSelectedRunId, workspaceRunEvents, platformMetadata,
    mcpTestRunPendingId, skillActionPendingId, liveEvents, setLiveEvents, changedFiles, setChangedFiles, sessionSummary,
    sessionSummaryDraft, setSessionSummaryDraft, sessionSummarySuggestions, summaryEditing, setSummaryEditing, summaryLoading,
    flowDraftPrompt, setFlowDraftPrompt, flowDraft, setFlowDraft, flowDraftEditing, setFlowDraftEditing, flowDraftLoading,
    flowDraftError, setFlowDraftError, runArtifacts, artifactPreview, setArtifactPreview, artifactDiff, setArtifactDiff,
    runDebug, runDetailLoading, mcpCatalog, mcpLoading, mcpSnippetValidation, mcpStatus, skillTemplates, skillTemplatesLoading,
    activeResearchProject, activeResearchProjectId, researchEvidence, researchHypotheses, researchLastReport,
    researchLoading, researchLoops, researchPreflight, researchProjects, researchQuestions, researchSearchResults,
    setActiveResearchProjectId, preflightLoading, preflightStatus, providersByKind, activeProvider, activeModelOption, activeModelCount, activeModelsLoading,
    activeModelsError, activeProviderLabel, activeReasoningLabel, selectedRun, manualRunSelectionRef, activeConversationIdRef,
    activeAgentIdRef, updateConversation, createConversationThread, refreshAgentTasks, refreshEngineStatus, refreshMcpMetadata,
    refreshPlatformMetadata, refreshPreflight, refreshRunArtifacts, refreshSkillTemplates, refreshSubagentSessions, refreshTaskEvents,
    refreshWorkspaceRunEvents, handleApplySkillHeartbeat, handleApplySkillStandingOrders, handleApplySummarySuggestion,
    handleArtifactDiff, handleCancelSubagentSession, handleCancelTaskFlow, handleCockpitNavigate, handleConnectCodex,
    handleConnectOpenCodeOAuth, handleCreateAgent, handleCreateAutomationRule, handleCreateCustomSkillTemplate,
    handleCreateFollowUpFlowFromReport, handleCreateFollowUpTaskFromReport, handleCreateMcpTestRun, handleCreateSkillFlow,
    handleCreateSubagentSession, handleCreateTaskFlow, handleDeleteAutomationRule, handleDeleteConversation, handleDeleteCustomSkillTemplate,
    handleDeleteTaskFlow, handleGenerateFlowDraft, handleImportCodex, handleInsertSkillPrompt, handleLoadSummarySuggestions,
    handleCopyDebugBundle, handleCopyReportArtifact, handleLogoutCodex, handleOpenAgentSettings, handleOpenProviderSettings, handleOpenRunDebug, handlePreviewArtifact,
    handleRefreshOpenCodeModels, handleRefreshSummary, handleRefreshSummaryTask, handleRetryTask, handleSaveAgentDefaults,
    handleSaveFlowDraft, handleSaveProvider, handleSaveStandingOrders, handleSaveSummary, handleSaveTaskFlowAsSkill,
    handleSaveTaskFlowSteps, handleSelectAgent, handleSelectTaskFlow, handleSendMessage, handleTaskFlowControl,
    handleTaskFlowStepControl, handleTestProvider, handleTriggerAutomationRule, handleTriggerHeartbeat, handleUpdateAutomationRule,
    handleUpdateCustomSkillTemplate, handleValidateMcpSnippet, addResearchEvidence, addResearchHypothesis,
    addResearchQuestion, cancelResearchLoop, createResearchProject, createResearchReport, createResearchReportTask,
    createResearchSubagent, patchResearchProject, proposeResearchLoop, refreshResearchProjectDetail,
    refreshResearchProjects, searchResearchRecords, startResearchLoop, requestDeleteAgent, agentSoulDraft,
  } = controller;

  const composerControl = activeConversation ? (
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
      onOpenSettings={handleOpenProviderSettings}
      onReasoningChange={(reasoningLevel) => {
        void updateConversation({ reasoningLevel });
      }}
      onSend={() => {
        void handleSendMessage();
      }}
      providerKind={activeConversation.providerKind}
      providers={providers}
      reasoningLevel={activeConversation.reasoningLevel}
      section={activeSection === "chat" ? "chat" : "workspace"}
    />
  ) : null;
  return (
    <div className="app-shell">
      <div className="app-shell__orb app-shell__orb--top" />
      <div className="app-shell__orb app-shell__orb--bottom" />

      <ConversationList
        activeAgentId={activeAgentId}
        activeNavTarget={activeNavTarget}
        agents={agents}
        activeConversationId={activeConversationId}
        conversations={conversations}
        onCreateConversation={() => {
          setActiveNavTarget("chat");
          setActiveSection("chat");
          void createConversationThread(activeConversation?.providerKind, activeAgentId);
        }}
        onDeleteConversation={(conversationId) => {
          void handleDeleteConversation(conversationId);
        }}
        onNavigate={handleCockpitNavigate}
        onOpenAgentSettings={handleOpenAgentSettings}
        onOpenSettings={handleOpenProviderSettings}
        onSelectAgent={(agentId) => {
          void handleSelectAgent(agentId);
        }}
        onSelectConversation={(conversationId) => {
          setActiveNavTarget("chat");
          setActiveSection("chat");
          setActiveConversationId(conversationId);
          setChatError(null);
          setPendingAssistantText("");
          setLiveEvents([]);
          setChangedFiles([]);
        }}
      />

      <main className="chat-panel">
        <header className="chat-panel__topbar">
          <div className="chat-panel__global-brand" aria-label="AetherOps">
            <span className="chat-panel__brand-mark">◇</span>
            <strong>AetherOps</strong>
            <span className="chat-panel__mode-pill">
              <span aria-hidden="true" />
              로컬 모드
            </span>
          </div>

          <div className="chat-panel__actions">
            <ConnectionStatus
              backendOnline={backendOnline}
              modelCount={activeModelCount}
              modelsError={activeModelsError}
              modelsLoading={activeModelsLoading}
              provider={activeProvider}
            />
          </div>
        </header>

        <section
          className={`chat-panel__canvas ${activeSection === "chat" ? "is-cockpit" : "is-workspace"} ${
            activeSection === "settings" ? "is-settings" : ""
          }`}
        >
          <div className="chat-panel__intro" aria-hidden={activeSection === "chat"}>
            <p className="eyebrow">
              {activeSection === "chat"
                ? "대화"
                : activeSection === "settings"
                  ? "설정"
                   : activeSection === "mcp"
                     ? "MCP"
                     : activeSection === "skills"
                       ? "스킬"
                       : activeSection === "research"
                         ? "연구"
                       : "워크플로우"}
            </p>
            <h1>{displayConversationTitle(activeConversation?.title)}</h1>
            <p className="chat-panel__intro-copy">
              {activeSection === "chat"
                ? "대화는 opencode 실행 엔진을 통해 파일 작업, 명령 실행, 연구 흐름을 처리합니다."
                : activeSection === "settings"
                  ? "로컬 API/OAuth 연결, opencode 엔진, 자동화 정책을 한 화면에서 관리합니다."
                  : activeSection === "mcp"
                    ? "opencode가 사용할 MCP 서버 설정과 안전 경계를 확인합니다."
                    : activeSection === "skills"
                      ? "상시 지침, 스킬 카드, Heartbeat 기반 행동 정책을 관리합니다."
                      : activeSection === "research"
                        ? "질문, 가설, 증거, 연구 Loop를 묶어 장기 연구를 관제합니다."
                      : "긴 작업 Flow, 단계 편집, 실행 로그를 한 화면에서 관제합니다."}
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

          {appNotice ? <div className="app-notice">{displayAppNotice(appNotice)}</div> : null}

          {activeSection === "chat" ? (
            <>
              <div className="cockpit-chat-grid">
                <section className="cockpit-chat-card">
                  <ChatView
                    changedFiles={changedFiles}
                    error={chatError}
                    loading={streaming}
                    messages={messages}
                    pendingAssistantText={pendingAssistantText}
                  />
                  <section className={`preflight-strip preflight-strip--${preflightStatus?.ok ? "ok" : "attention"}`} aria-label="실행 전 점검">
                    <div>
                      <strong>{preflightStatus?.ok ? "실행 준비 완료" : "실행 전 확인 필요"}</strong>
                      <span>
                        {preflightLoading
                          ? "점검 중..."
                          : preflightStatus
                            ? `${preflightStatus.checks.filter((check) => check.status === "error").length} 오류 / ${preflightStatus.checks.filter((check) => check.status === "warn").length} 주의`
                            : "아직 점검 결과가 없습니다."}
                      </span>
                    </div>
                    <button className="cockpit-mini-button" onClick={() => void refreshPreflight()} type="button">
                      다시 점검
                    </button>
                  </section>
                  {composerControl}
                </section>

                <CockpitRightRail
                  activeConversation={activeConversation}
                  changedFiles={changedFiles}
                  liveEvents={liveEvents}
                  onOpenWorkspace={() => handleCockpitNavigate("workflow")}
                  onResumeTaskFlow={(flowId) => {
                    void handleTaskFlowControl(flowId, "resume");
                  }}
                  onStartTaskFlow={(flowId) => {
                    void handleTaskFlowControl(flowId, "start");
                  }}
                  platformMetadata={platformMetadata}
                  runEvents={workspaceRunEvents}
                  selectedTaskFlow={selectedTaskFlow}
                  taskFlows={taskFlows}
                />
              </div>

              <section className="cockpit-secondary-stack" aria-label="보조 패널">
                <FlowDraftPanel
                  disabled={!activeConversation || !activeAgentId}
                  draft={flowDraft}
                  editing={flowDraftEditing}
                  error={flowDraftError}
                  loading={flowDraftLoading}
                  onCancel={() => {
                    setFlowDraft(null);
                    setFlowDraftEditing(false);
                    setFlowDraftError(null);
                  }}
                  onDraftChange={setFlowDraft}
                  onEditingChange={setFlowDraftEditing}
                  onGenerate={() => {
                    if (!flowDraftPrompt.trim() && composerText.trim()) {
                      setFlowDraftPrompt(composerText.trim());
                    }
                    void handleGenerateFlowDraft();
                  }}
                  onPromptChange={setFlowDraftPrompt}
                  onSave={() => {
                    void handleSaveFlowDraft();
                  }}
                  prompt={flowDraftPrompt || composerText}
                />

                <SessionSummaryPanel
                  draft={sessionSummaryDraft}
                  editing={summaryEditing}
                  loading={summaryLoading}
                  suggestions={sessionSummarySuggestions}
                  onCancel={() => {
                    setSummaryEditing(false);
                    setSessionSummaryDraft(sessionSummary?.summary ?? "");
                  }}
                  onApplySuggestion={(suggestion) => {
                    void handleApplySummarySuggestion(suggestion);
                  }}
                  onDraftChange={setSessionSummaryDraft}
                  onEdit={() => {
                    setSummaryEditing(true);
                    setSessionSummaryDraft(sessionSummary?.summary ?? "");
                  }}
                  onLoadSuggestions={() => {
                    void handleLoadSummarySuggestions();
                  }}
                  onRefresh={() => {
                    void handleRefreshSummary();
                  }}
                  onRefreshTask={() => {
                    void handleRefreshSummaryTask();
                  }}
                  onSave={() => {
                    void handleSaveSummary();
                  }}
                  summary={sessionSummary}
                />

                <details className="cockpit-collapsible-panel">
                  <summary>
                    <span>
                      <strong>서브에이전트</strong>
                      <small>큰 작업을 작은 조사/검증 세션으로 나눕니다.</small>
                    </span>
                    <em>{subagentSessions.length}</em>
                  </summary>
                  <SubagentPanel
                    activeConversation={activeConversation}
                    onCancelSession={(sessionId) => {
                      void handleCancelSubagentSession(sessionId);
                    }}
                    onCreateSession={(payload) => {
                      void handleCreateSubagentSession(payload);
                    }}
                    onOpenSession={(sessionId) => {
                      setActiveNavTarget("chat");
                      setActiveSection("chat");
                      setActiveConversationId(sessionId);
                      setChatError(null);
                      setPendingAssistantText("");
                      setLiveEvents([]);
                      setChangedFiles([]);
                    }}
                    onRefresh={() => {
                      if (activeConversationId) {
                        void refreshSubagentSessions(activeConversationId);
                      }
                      if (activeAgentId) {
                        void refreshAgentTasks(activeAgentId);
                      }
                    }}
                    runs={workspaceRuns}
                    sessions={subagentSessions}
                    tasks={tasks}
                  />
                </details>

                <details className="cockpit-collapsible-panel">
                  <summary>
                    <span>
                      <strong>실행 로그와 변경 파일</strong>
                      <small>opencode 이벤트, 확장 상태, 변경된 파일을 확인합니다.</small>
                    </span>
                    <em>{workspaceRunEvents.length + liveEvents.length}</em>
                  </summary>
                  <CockpitOpsDrawer
                    activeConversation={activeConversation}
                    changedFiles={changedFiles}
                    liveEvents={liveEvents}
                    onOpenWorkspace={() => handleCockpitNavigate("workflow")}
                    platformMetadata={platformMetadata}
                    runEvents={workspaceRunEvents}
                    selectedTaskFlow={selectedTaskFlow}
                    taskFlows={taskFlows}
                  />
                </details>

                <RunArtifactsPanel
                  artifacts={runArtifacts}
                  debug={runDebug}
                  diff={artifactDiff}
                  latestRun={selectedRun}
                  loading={runDetailLoading}
                  onCloseDiff={() => setArtifactDiff(null)}
                  onClosePreview={() => setArtifactPreview(null)}
                  onCopyDebug={handleCopyDebugBundle}
                  onCopyReport={(artifactId) => {
                    void handleCopyReportArtifact(artifactId);
                  }}
                  onCreateFollowUpFlow={(artifactId) => {
                    void handleCreateFollowUpFlowFromReport(artifactId);
                  }}
                  onCreateFollowUpTask={(artifactId) => {
                    void handleCreateFollowUpTaskFromReport(artifactId);
                  }}
                  onDebug={() => {
                    void handleOpenRunDebug();
                  }}
                  onPreview={(artifactId) => {
                    void handlePreviewArtifact(artifactId);
                  }}
                  onPreviewFull={(artifactId) => {
                    void handlePreviewArtifact(artifactId, "full");
                  }}
                  onDiff={(artifactId) => {
                    void handleArtifactDiff(artifactId);
                  }}
                  preview={artifactPreview}
                />
              </section>
            </>
          ) : activeSection === "workflow" ? (
            <CockpitSectionView
              activeAgent={activeAgent}
              activeConversation={activeConversation}
              liveEvents={liveEvents}
              modelLabel={activeModelOption?.label ?? activeConversation?.model ?? "선택 안 됨"}
              onCancelTaskFlow={(flowId) => {
                void handleCancelTaskFlow(flowId);
              }}
              onCreateConversation={() => {
                setActiveNavTarget("chat");
                setActiveSection("chat");
                void createConversationThread(activeConversation?.providerKind, activeAgentId);
              }}
              onCreateTaskFlow={(payload) => {
                void handleCreateTaskFlow(payload);
              }}
              onDeleteTaskFlow={(flowId) => {
                void handleDeleteTaskFlow(flowId);
              }}
              onNavigate={handleCockpitNavigate}
              onOpenAgentSettings={handleOpenAgentSettings}
              onOpenProviderSettings={handleOpenProviderSettings}
              onOpenRun={(runId) => {
                manualRunSelectionRef.current = true;
                setSelectedRunId(runId);
                setAppNotice("Run 로그를 선택했습니다.");
                if (activeConversationId) {
                  void refreshWorkspaceRunEvents(activeConversationId, runId);
                }
              }}
              onOpenArtifacts={(runId) => {
                manualRunSelectionRef.current = true;
                setSelectedRunId(runId);
                setAppNotice("Run 산출물을 선택했습니다. 채팅 화면의 산출물 패널에서 확인하세요.");
                if (activeConversationId) {
                  void refreshRunArtifacts(activeConversationId, runId);
                  void handleOpenRunDebug(runId);
                }
              }}
              onRefreshPlatformMetadata={() => {
                void refreshPlatformMetadata(activeAgentId);
              }}
              onSelectTaskFlow={(flowId) => {
                handleSelectTaskFlow(flowId);
              }}
              onSaveTaskFlowSteps={(flowId, steps, title) => {
                void handleSaveTaskFlowSteps(flowId, steps, title);
              }}
              onSaveTaskFlowAsSkill={(flowId) => {
                void handleSaveTaskFlowAsSkill(flowId);
              }}
              onResumeTaskFlow={(flowId) => {
                void handleTaskFlowControl(flowId, "resume");
              }}
              onRetryTask={(taskId, force) => {
                void handleRetryTask(taskId, force);
              }}
              onRetryTaskFlowStep={(flowId, stepId) => {
                void handleTaskFlowStepControl(flowId, stepId, "retry");
              }}
              onApproveTaskFlowStep={(flowId, stepId) => {
                void handleTaskFlowStepControl(flowId, stepId, "approve");
              }}
              onDenyTaskFlowStep={(flowId, stepId) => {
                void handleTaskFlowStepControl(flowId, stepId, "deny");
              }}
              onSkipTaskFlowStep={(flowId, stepId) => {
                void handleTaskFlowStepControl(flowId, stepId, "skip");
              }}
              onStartTaskFlow={(flowId) => {
                void handleTaskFlowControl(flowId, "start");
              }}
              providerLabel={activeProviderLabel}
              reasoningLabel={activeReasoningLabel}
              runEvents={workspaceRunEvents}
              runs={workspaceRuns}
              selectedTaskFlow={selectedTaskFlow}
              preflight={preflightStatus}
              preflightLoading={preflightLoading}
              target="workflow"
              taskFlows={taskFlows}
              tasks={tasks}
              onRefreshPreflight={() => {
                void refreshPreflight();
              }}
            />
          ) : activeSection === "research" ? (
            <ResearchSectionView
              activeAgent={activeAgent}
              activeConversation={activeConversation}
              activeProject={activeResearchProject}
              evidence={researchEvidence}
              hypotheses={researchHypotheses}
              loading={researchLoading}
              loops={researchLoops}
              onAddEvidence={(projectId, payload) => {
                void addResearchEvidence(projectId, payload);
              }}
              onAddHypothesis={(projectId, hypothesis, questionId) => {
                void addResearchHypothesis(projectId, hypothesis, questionId);
              }}
              onAddQuestion={(projectId, question) => {
                void addResearchQuestion(projectId, question);
              }}
              onCancelLoop={(loopId) => {
                void cancelResearchLoop(loopId);
              }}
              onCreateProject={(payload) => {
                void createResearchProject(payload);
              }}
              onCreateReport={(projectId) => {
                void createResearchReport(projectId);
              }}
              onCreateReportTask={(projectId) => {
                void createResearchReportTask(projectId);
              }}
              onCreateSubagent={(projectId, role, questionId) => {
                void createResearchSubagent(projectId, role, questionId);
              }}
              onOpenFlow={(flowId) => {
                setActiveNavTarget("workflow");
                setActiveSection("workflow");
                handleSelectTaskFlow(flowId);
              }}
              onProposeLoop={(projectId, payload) => {
                void proposeResearchLoop(projectId, payload);
              }}
              onRefresh={(projectId) => {
                if (projectId) {
                  void refreshResearchProjectDetail(projectId);
                } else if (activeAgentId) {
                  void refreshResearchProjects(activeAgentId);
                }
              }}
              onSearch={(query) => {
                void searchResearchRecords(activeAgentId ?? undefined, query, activeConversationId ?? undefined);
              }}
              onSelectProject={(projectId) => {
                setActiveResearchProjectId(projectId);
                void refreshResearchProjectDetail(projectId);
              }}
              onStartLoop={(loopId) => {
                void startResearchLoop(loopId);
              }}
              preflight={researchPreflight}
              projects={researchProjects}
              questions={researchQuestions}
              searchResults={researchSearchResults}
            />
          ) : activeSection === "mcp" || activeSection === "skills" ? (
            <ExtensionsSectionView
              activeAgent={activeAgent}
              activeConversation={activeConversation}
              engineStatus={engineStatus}
              heartbeat={agentHeartbeat}
              mcpCatalog={mcpCatalog}
              mcpLoading={mcpLoading}
              mcpSnippetValidation={mcpSnippetValidation}
              mcpStatus={mcpStatus}
              mcpTestRunPendingId={mcpTestRunPendingId}
              skillActionPendingId={skillActionPendingId}
              skillTemplates={skillTemplates}
              skillTemplatesLoading={skillTemplatesLoading}
              onApplySkillHeartbeat={(template) => {
                void handleApplySkillHeartbeat(template);
              }}
              onApplySkillStandingOrders={(template) => {
                void handleApplySkillStandingOrders(template);
              }}
              onCreateMcpTestRun={(server) => {
                void handleCreateMcpTestRun(server);
              }}
              onCreateCustomSkill={(payload) => {
                void handleCreateCustomSkillTemplate(payload);
              }}
              onCreateSkillFlow={(template) => {
                void handleCreateSkillFlow(template);
              }}
              onDeleteCustomSkill={(template) => {
                void handleDeleteCustomSkillTemplate(template);
              }}
              onInsertSkillPrompt={handleInsertSkillPrompt}
              onNavigate={handleCockpitNavigate}
              onOpenAgentSettings={handleOpenAgentSettings}
              onOpenProviderSettings={handleOpenProviderSettings}
              onRefreshEngineStatus={() => {
                void refreshEngineStatus();
              }}
              onRefreshMcpMetadata={() => {
                void refreshMcpMetadata();
              }}
              onRefreshPlatformMetadata={() => {
                void refreshPlatformMetadata(activeAgentId);
              }}
              onRefreshSkillTemplates={() => {
                void refreshSkillTemplates();
              }}
              onTriggerHeartbeat={() => {
                void handleTriggerHeartbeat();
              }}
              onUpdateCustomSkill={(template, payload) => {
                void handleUpdateCustomSkillTemplate(template, payload);
              }}
              onValidateMcpSnippet={(snippet) => {
                void handleValidateMcpSnippet(snippet);
              }}
              platformMetadata={platformMetadata}
              providers={providers}
              soul={agentSoul}
              standingOrders={standingOrders}
              target={activeSection}
            />
          ) : (
            <SettingsSectionView
              activeAgent={activeAgent}
              activeConversation={activeConversation}
              backendOnline={backendOnline}
              engineStatus={engineStatus}
              engineStatusLoading={engineStatusLoading}
              heartbeat={agentHeartbeat}
              heartbeatLogs={heartbeatLogs}
              heartbeatTriggering={heartbeatTriggering}
              automationRules={automationRules}
              providerAuthPending={Boolean(providerAuthAction)}
              triggeringAutomationRuleIds={triggeringAutomationRuleIds}
              onConnectCodex={() => {
                void handleConnectCodex();
              }}
              onConnectOpenCodeOAuth={() => {
                void handleConnectOpenCodeOAuth();
              }}
              onImportCodex={() => {
                void handleImportCodex();
              }}
              onLogoutCodex={() => {
                void handleLogoutCodex();
              }}
              onOpenAgentSettings={handleOpenAgentSettings}
              onOpenProviderSettings={handleOpenProviderSettings}
              onRefreshEngineStatus={() => {
                void refreshEngineStatus();
              }}
              onRefreshOpenCodeModels={() => {
                void handleRefreshOpenCodeModels();
              }}
              onRefreshPlatformMetadata={() => {
                void refreshPlatformMetadata(activeAgentId);
              }}
              onTriggerHeartbeat={() => {
                void handleTriggerHeartbeat();
              }}
              onCreateAutomationRule={(payload) => {
                void handleCreateAutomationRule(payload);
              }}
              onUpdateAutomationRule={(ruleId, payload) => {
                void handleUpdateAutomationRule(ruleId, payload);
              }}
              onDeleteAutomationRule={(ruleId) => {
                void handleDeleteAutomationRule(ruleId);
              }}
              onTriggerAutomationRule={(ruleId) => {
                void handleTriggerAutomationRule(ruleId);
              }}
              platformMetadata={platformMetadata}
              providers={providers}
            />
          )}
        </section>
      </main>

      <AgentSettingsDialog
        activeAgentId={activeAgentId}
        agents={agents}
        deletingAgentId={deletingAgentId}
        draft={agentDraft}
        heartbeat={agentHeartbeat}
        heartbeatDraft={agentHeartbeatDraft}
        modelsByProvider={modelsByProvider}
        notice={appNotice}
        onClose={() => setAgentSettingsOpen(false)}
        onCreate={() => {
          void handleCreateAgent();
        }}
        onDelete={requestDeleteAgent}
        onDraftChange={setAgentDraft}
        onHeartbeatDraftChange={setAgentHeartbeatDraft}
        onSoulDraftChange={setAgentSoulDraft}
        onStandingOrdersDraftChange={setStandingOrdersDraft}
        soul={agentSoul}
        soulDraft={agentSoulDraft}
        standingOrders={standingOrders}
        standingOrdersDraft={standingOrdersDraft}
        onSave={() => {
          void handleSaveAgentDefaults();
        }}
        onSaveStandingOrders={() => {
          void handleSaveStandingOrders();
        }}
        open={agentSettingsOpen}
        providers={providers}
        saving={savingAgent}
        savingStandingOrders={savingStandingOrders}
      />

      <ProviderSettingsDialog
        drafts={providerDrafts}
        engineStatus={engineStatus}
        engineStatusLoading={engineStatusLoading}
        notice={appNotice}
        onClose={() => setSettingsOpen(false)}
        onConnectCodex={() => {
          void handleConnectCodex();
        }}
        onConnectOpenCodeOAuth={() => {
          void handleConnectOpenCodeOAuth();
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
        onRefreshEngineStatus={() => {
          void refreshEngineStatus();
        }}
        onRefreshOpenCodeModels={() => {
          void handleRefreshOpenCodeModels();
        }}
        onSave={(kind) => {
          void handleSaveProvider(kind as Exclude<ProviderKind, "openai-codex">);
        }}
        onTest={(kind) => {
          void handleTestProvider(kind);
        }}
        open={settingsOpen}
        providers={providers}
        providerAuthPending={Boolean(providerAuthAction)}
        savingKind={savingKind}
        testingKind={testingKind}
      />
    </div>
  );

}
