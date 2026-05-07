import { useEffect, useMemo, useState } from "react";
import type {
  AgentRecord,
  ConversationRecord,
  PreflightResponse,
  TaskFlowDetailResponse,
  TaskFlowRecord,
  TaskFlowStepDraft,
  TaskFlowStepDetail,
  TaskRecord,
  WorkspaceRunEventRecord,
  WorkspaceRunRecord,
} from "../types";
import type { CockpitNavTarget } from "./ConversationList";
import {
  MAX_FLOW_STEPS,
  type EditableFlowStep,
  type CockpitSectionViewProps,
  countStatus,
  createAircraftResearchFlow,
  createBlankEditableStep,
  createEditableStep,
  draftStepForSave,
  eventName,
  eventSummary,
  formatTime,
  groupTasks,
  moveItem,
  parseFlowOutline,
  safeTaskDebug,
  sectionCopy,
  statusLabel,
  statusTone,
  taskKindLabel,
  validateFlowDraft,
} from "./workflow-utils";

type CockpitSectionTarget = Extract<CockpitNavTarget, "workflow">;

export function CockpitSectionView({
  activeAgent,
  activeConversation,
  liveEvents,
  modelLabel,
  preflight,
  preflightLoading,
  providerLabel,
  reasoningLabel,
  runEvents,
  runs,
  selectedTaskFlow,
  target,
  taskFlows,
  tasks,
  onCancelTaskFlow,
  onCreateConversation,
  onCreateTaskFlow,
  onDeleteTaskFlow,
  onNavigate,
  onOpenAgentSettings,
  onOpenArtifacts,
  onOpenProviderSettings,
  onOpenRun,
  onRefreshPlatformMetadata,
  onRefreshPreflight,
  onResumeTaskFlow,
  onRetryTask = () => {},
  onRetryTaskFlowStep,
  onApproveTaskFlowStep,
  onDenyTaskFlowStep,
  onSaveTaskFlowAsSkill = () => {},
  onSelectTaskFlow,
  onSaveTaskFlowSteps,
  onSkipTaskFlowStep,
  onStartTaskFlow,
}: CockpitSectionViewProps) {
  const [flowTitle, setFlowTitle] = useState("");
  const [flowOutline, setFlowOutline] = useState("");
  const [flowAutoStart, setFlowAutoStart] = useState(true);
  const [flowEditingId, setFlowEditingId] = useState<string | null>(null);
  const [flowEditTitle, setFlowEditTitle] = useState("");
  const [flowEditSteps, setFlowEditSteps] = useState<EditableFlowStep[]>([]);
  const [selectedFlowEditStepId, setSelectedFlowEditStepId] = useState<string | null>(null);
  const [draggingStepIndex, setDraggingStepIndex] = useState<number | null>(null);
  const [pendingFlowEditId, setPendingFlowEditId] = useState<string | null>(null);

  const flowCounts = countStatus(taskFlows);
  const runCounts = countStatus(runs);
  const taskGroups = useMemo(() => groupTasks(tasks), [tasks]);
  const selectedOrFirstFlow =
    selectedTaskFlow ?? (taskFlows[0] ? { flow: taskFlows[0], steps: [] } : null);
  const selectedFlowId = selectedOrFirstFlow?.flow.id ?? null;
  const selectedFlowDetailLoaded =
    Boolean(selectedFlowId) && selectedTaskFlow?.flow.id === selectedFlowId;
  const selectedFlowSteps = selectedFlowDetailLoaded ? selectedTaskFlow?.steps ?? [] : [];
  const selectedFlowHasTaskLinkedSteps = selectedFlowSteps.some((step) => Boolean(step.taskId || step.task));
  const selectedFlowCanEdit =
    Boolean(selectedOrFirstFlow) &&
    selectedFlowDetailLoaded &&
    selectedOrFirstFlow?.flow.status === "queued" &&
    !selectedFlowHasTaskLinkedSteps;
  const isEditingSelectedFlow = Boolean(selectedFlowId && flowEditingId === selectedFlowId);
  const selectedFlowCanStart = Boolean(selectedOrFirstFlow && selectedFlowSteps.length > 0);
  const selectedFlowEditStepIndex = flowEditSteps.findIndex((step) => step.clientId === selectedFlowEditStepId);
  const selectedFlowEditStep =
    selectedFlowEditStepIndex >= 0 ? flowEditSteps[selectedFlowEditStepIndex] : null;
  const flowEditValidationErrors = validateFlowDraft(flowEditTitle, flowEditSteps);
  const canSaveFlowEdit = isEditingSelectedFlow && flowEditValidationErrors.length === 0;
  const editBlockReason = !selectedOrFirstFlow
    ? "편집할 Flow를 먼저 선택하세요."
    : !selectedFlowDetailLoaded
      ? "상세 불러오기로 단계 정보를 가져온 뒤 편집할 수 있습니다."
      : selectedOrFirstFlow.flow.status !== "queued"
        ? "구조 편집은 아직 시작하지 않은 대기 상태 Flow에서만 가능합니다."
        : selectedFlowHasTaskLinkedSteps
          ? "이미 task가 연결된 단계가 있어 구조를 바꿀 수 없습니다. 실행 이력 보호를 위해 새 Flow를 만들어 주세요."
          : "대기 중인 Flow입니다. 단계 구조와 의존성을 편집할 수 있습니다.";
  const allEvents = useMemo(
    () => [...(runEvents ?? []), ...liveEvents].slice(-10).reverse(),
    [liveEvents, runEvents],
  );
  const executionEvents = allEvents.filter(
    (event) => event.eventType === "status" || event.eventType === "error" || event.eventType.startsWith("run_"),
  );
  const copy = sectionCopy[target];

  useEffect(() => {
    if (!selectedFlowId || flowEditingId !== selectedFlowId) {
      return;
    }
    const nextSteps = selectedFlowSteps.map(createEditableStep);
    setFlowEditTitle(selectedOrFirstFlow?.flow.title ?? "");
    setFlowEditSteps(nextSteps);
    setSelectedFlowEditStepId((current) =>
      current && nextSteps.some((step) => step.clientId === current)
        ? current
        : nextSteps[0]?.clientId ?? null,
    );
  }, [flowEditingId, selectedFlowId, selectedFlowSteps, selectedOrFirstFlow?.flow.title]);

  useEffect(() => {
    if (!pendingFlowEditId || selectedTaskFlow?.flow.id !== pendingFlowEditId) {
      return;
    }
    if (selectedTaskFlow.flow.status === "queued" && !selectedTaskFlow.steps.some((step) => step.taskId)) {
      requestEditSelectedFlow();
    }
    setPendingFlowEditId(null);
  }, [pendingFlowEditId, selectedTaskFlow]);

  function createEmptyFlow() {
    const baseTitle = "새 워크플로우";
    const existingTitles = new Set(taskFlows.map((flow) => flow.title));
    let title = baseTitle;
    let index = 2;
    while (existingTitles.has(title)) {
      title = `${baseTitle} ${index}`;
      index += 1;
    }
    onCreateTaskFlow({ title, autoStart: false, steps: [] });
    onNavigate("workflow");
  }

  function createFlowFromEditor() {
    const steps = parseFlowOutline(flowTitle, flowOutline);
    onCreateTaskFlow({
      title: flowTitle.trim() || steps[0]?.title || "새 워크플로우",
      autoStart: flowAutoStart,
      steps,
    });
    setFlowTitle("");
    setFlowOutline("");
  }

  function createDefaultResearchFlow() {
    onCreateTaskFlow({
      title: "항공 연구 자동화 기본 Flow",
      autoStart: false,
      steps: createAircraftResearchFlow(),
    });
    onNavigate("workflow");
  }

  function requestEditSelectedFlow() {
    if (!selectedOrFirstFlow || !selectedFlowCanEdit) {
      return;
    }
    const steps = selectedFlowSteps.map(createEditableStep);
    setFlowEditingId(selectedOrFirstFlow.flow.id);
    setFlowEditTitle(selectedOrFirstFlow.flow.title);
    setFlowEditSteps(steps);
    setSelectedFlowEditStepId(steps[0]?.clientId ?? null);
  }

  function requestEditFlow(flow: TaskFlowRecord) {
    onSelectTaskFlow(flow.id);
    setPendingFlowEditId(flow.id);
  }

  function cancelFlowEdit() {
    setFlowEditingId(null);
    setFlowEditTitle("");
    setFlowEditSteps([]);
    setSelectedFlowEditStepId(null);
  }

  function addFlowStep() {
    if (flowEditSteps.length >= MAX_FLOW_STEPS) {
      return;
    }
    setFlowEditSteps((current) => {
      const previousStepKey = current[current.length - 1]?.stepKey ?? null;
      const next = [...current, createBlankEditableStep(current.length, previousStepKey)];
      setSelectedFlowEditStepId(next[next.length - 1].clientId);
      return next;
    });
  }

  function removeFlowStep(clientId: string) {
    setFlowEditSteps((current) => {
      const removed = current.find((step) => step.clientId === clientId);
      const index = current.findIndex((step) => step.clientId === clientId);
      const next = current
        .filter((step) => step.clientId !== clientId)
        .map((step) =>
          removed && step.dependencyStepKey === removed.stepKey ? { ...step, dependencyStepKey: null } : step,
        );
      if (selectedFlowEditStepId === clientId) {
        setSelectedFlowEditStepId(next[Math.min(index, next.length - 1)]?.clientId ?? null);
      }
      return next;
    });
  }

  function moveFlowStep(fromIndex: number, toIndex: number) {
    setFlowEditSteps((current) => moveItem(current, fromIndex, toIndex));
  }

  function updateSelectedStep(patch: Partial<TaskFlowStepDraft>) {
    if (!selectedFlowEditStep) {
      return;
    }
    setFlowEditSteps((current) =>
      current.map((step) =>
        step.clientId === selectedFlowEditStep.clientId
          ? { ...step, ...patch }
          : step,
      ),
    );
  }

  function applyLinearDependencies() {
    setFlowEditSteps((current) =>
      current.map((step, index) => ({
        ...step,
        dependencyStepKey: index === 0 ? null : current[index - 1]?.stepKey ?? null,
      })),
    );
  }

  function clearDependencies() {
    setFlowEditSteps((current) => current.map((step) => ({ ...step, dependencyStepKey: null })));
  }

  function saveFlowEdit() {
    if (!selectedFlowId || !canSaveFlowEdit) {
      return;
    }
    onSaveTaskFlowSteps(selectedFlowId, flowEditSteps.map(draftStepForSave), flowEditTitle.trim());
    setFlowEditingId(null);
  }

  function requestDeleteFlow(flow: TaskFlowRecord) {
    if (flow.status === "running") {
      return;
    }
    if (window.confirm(`"${flow.title}" Flow를 삭제할까요? 실행 기록과 산출물은 보존됩니다.`)) {
      onDeleteTaskFlow(flow.id);
    }
  }

  function copyTaskDebug(task: TaskRecord) {
    const payload = JSON.stringify(safeTaskDebug(task), null, 2);
    void navigator.clipboard?.writeText(payload);
  }

  function copyFlowReport() {
    const markdown = selectedTaskFlow?.report?.metadata.markdown;
    if (typeof markdown === "string" && markdown.trim()) {
      void navigator.clipboard?.writeText(markdown);
    }
  }

  return (
    <div className={`cockpit-section cockpit-section--${target}`}>
      <section className="cockpit-section__hero">
        <p className="cockpit-eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
        <div className="cockpit-section__hero-actions">
          <button className="cockpit-mini-button" onClick={() => onNavigate("chat")} type="button">
            채팅으로 이동
          </button>
          <button className="cockpit-mini-button" onClick={onOpenProviderSettings} type="button">
            opencode 설정
          </button>
          <button className="cockpit-mini-button" onClick={onRefreshPlatformMetadata} type="button">
            상태 새로고침
          </button>
        </div>
      </section>

      <section className={`cockpit-section-card cockpit-preflight-card cockpit-preflight-card--${preflight?.ok ? "ok" : "attention"}`}>
        <div className="cockpit-section-card__header">
          <div>
            <p className="cockpit-eyebrow">Preflight</p>
            <h2>{preflight?.ok ? "실행 준비 완료" : "실행 전 확인 필요"}</h2>
          </div>
          <button className="cockpit-mini-button" disabled={preflightLoading} onClick={onRefreshPreflight} type="button">
            {preflightLoading ? "점검 중..." : "다시 점검"}
          </button>
        </div>
        <div className="cockpit-preflight-list">
          {(preflight?.checks ?? []).slice(0, 8).map((check) => (
            <article className={`cockpit-preflight-item cockpit-preflight-item--${check.status}`} key={check.id}>
              <strong>{check.label}</strong>
              <span>{check.message}</span>
            </article>
          ))}
          {!preflight ? <p className="cockpit-empty">아직 실행 전 점검 결과가 없습니다.</p> : null}
        </div>
      </section>

      <div className="cockpit-command-strip" aria-label="빠른 작업">
        <button onClick={createEmptyFlow} type="button">빈 Flow 만들기</button>
        <button onClick={createDefaultResearchFlow} type="button">항공 연구 Flow 생성</button>
        <button onClick={onCreateConversation} type="button">새 채팅</button>
        <button onClick={onOpenAgentSettings} type="button">에이전트 지침</button>
      </div>

      <section className="cockpit-section-card cockpit-section-card--wide">
        <div className="cockpit-section-card__header">
          <div>
            <p className="cockpit-eyebrow">선택된 Flow</p>
            <h2>{selectedOrFirstFlow?.flow.title ?? "아직 Flow가 없습니다"}</h2>
          </div>
          <span className={`status-pill status-pill--${statusTone(selectedOrFirstFlow?.flow.status)}`}>
            {statusLabel(selectedOrFirstFlow?.flow.status)}
          </span>
        </div>

        <div className="cockpit-flow-actions">
          <button
            className="cockpit-mini-button"
            disabled={!selectedFlowId}
            onClick={() => selectedFlowId && onSelectTaskFlow(selectedFlowId)}
            type="button"
          >
            상세 불러오기
          </button>
          <button
            className="cockpit-mini-button"
            disabled={!selectedFlowId || !selectedFlowCanStart}
            onClick={() => selectedFlowId && onStartTaskFlow(selectedFlowId)}
            type="button"
          >
            시작/평가
          </button>
          <button
            className="cockpit-mini-button"
            disabled={!selectedFlowId || selectedOrFirstFlow?.flow.status !== "running"}
            onClick={() => selectedFlowId && onCancelTaskFlow(selectedFlowId)}
            type="button"
          >
            취소
          </button>
          <button
            className="cockpit-mini-button"
            disabled={!selectedFlowId || !["failed", "cancelled"].includes(selectedOrFirstFlow?.flow.status ?? "")}
            onClick={() => selectedFlowId && onResumeTaskFlow(selectedFlowId)}
            type="button"
          >
            재개
          </button>
          <button
            className="cockpit-mini-button"
            disabled={!selectedFlowCanEdit}
            onClick={requestEditSelectedFlow}
            type="button"
          >
            선택 Flow 수정
          </button>
          <button
            className="cockpit-mini-button"
            disabled={!selectedFlowId}
            onClick={() => selectedFlowId && onSaveTaskFlowAsSkill(selectedFlowId)}
            type="button"
          >
            현재 Flow를 Skill로 저장
          </button>
          {isEditingSelectedFlow ? (
            <>
              <button
                className="cockpit-mini-button"
                disabled={flowEditSteps.length >= MAX_FLOW_STEPS}
                onClick={addFlowStep}
                type="button"
              >
                단계 추가
              </button>
              <button className="cockpit-mini-button" onClick={applyLinearDependencies} type="button">
                선형 연결 자동 적용
              </button>
              <button className="cockpit-mini-button" onClick={clearDependencies} type="button">
                의존성 없음
              </button>
              <button
                className="cockpit-mini-button"
                disabled={!canSaveFlowEdit}
                onClick={saveFlowEdit}
                type="button"
              >
                변경 저장
              </button>
              <button className="cockpit-mini-button" onClick={cancelFlowEdit} type="button">
                되돌리기
              </button>
            </>
          ) : null}
        </div>

        {!selectedFlowCanStart && selectedOrFirstFlow ? (
          <p className="cockpit-muted">단계를 1개 이상 추가해야 실행할 수 있습니다.</p>
        ) : null}
        <p className="cockpit-muted">{editBlockReason}</p>

        {isEditingSelectedFlow ? (
          <div className="cockpit-flow-editor">
            <div className="cockpit-flow-editor__steps">
              <label className="cockpit-field">
                <span>Flow 제목</span>
                <input
                  value={flowEditTitle}
                  onChange={(event) => setFlowEditTitle(event.target.value)}
                />
              </label>

              <div className="cockpit-dependency-chain" aria-label="의존성 체인">
                {flowEditSteps.length ? (
                  flowEditSteps.map((step) => (
                    <span key={step.clientId}>
                      {step.stepKey || "step-key 없음"}
                      {step.dependencyStepKey ? ` ← ${step.dependencyStepKey}` : " ← 없음"}
                    </span>
                  ))
                ) : (
                  <span>아직 단계가 없습니다.</span>
                )}
              </div>

              {flowEditSteps.length ? (
                flowEditSteps.map((step, index) => (
                  <article
                    className={`cockpit-flow-step ${selectedFlowEditStepId === step.clientId ? "is-active" : ""}`}
                    draggable
                    key={step.clientId}
                    onClick={() => setSelectedFlowEditStepId(step.clientId)}
                    onDragEnd={() => setDraggingStepIndex(null)}
                    onDragStart={() => setDraggingStepIndex(index)}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggingStepIndex !== null) {
                        moveFlowStep(draggingStepIndex, index);
                      }
                    }}
                    onDragOver={(event) => event.preventDefault()}
                  >
                    <span className="cockpit-flow-step__number">{index + 1}</span>
                    <div>
                      <strong>{step.title || "제목 없음"}</strong>
                      <span>{step.stepKey || "step-key 없음"} · 의존성 {step.dependencyStepKey || "없음"}</span>
                    </div>
                    <div className="cockpit-flow-step__actions">
                      <button className="cockpit-mini-button" type="button" onClick={(event) => {
                        event.stopPropagation();
                        setSelectedFlowEditStepId(step.clientId);
                      }}>
                        수정
                      </button>
                      <button className="cockpit-mini-button" type="button" disabled={index === 0} onClick={(event) => {
                        event.stopPropagation();
                        moveFlowStep(index, index - 1);
                      }}>
                        위
                      </button>
                      <button className="cockpit-mini-button" type="button" disabled={index === flowEditSteps.length - 1} onClick={(event) => {
                        event.stopPropagation();
                        moveFlowStep(index, index + 1);
                      }}>
                        아래
                      </button>
                      <button className="cockpit-mini-button cockpit-mini-button--danger" type="button" onClick={(event) => {
                        event.stopPropagation();
                        removeFlowStep(step.clientId);
                      }}>
                        삭제
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <p className="cockpit-empty">빈 워크플로우입니다. 단계 추가로 첫 단계를 작성하세요.</p>
              )}
            </div>

            <section className="cockpit-inline-form">
              <div className="cockpit-inline-form__header">
                <strong>단계 편집</strong>
                <span>선택한 단계의 key, 제목, 프롬프트, 의존성을 수정합니다.</span>
              </div>
              {selectedFlowEditStep ? (
                <>
                  <label className="cockpit-field">
                    <span>Step Key</span>
                    <input
                      aria-label="선택 단계 Step Key"
                      value={selectedFlowEditStep.stepKey}
                      onChange={(event) => updateSelectedStep({ stepKey: event.target.value })}
                    />
                  </label>
                  <label className="cockpit-field">
                    <span>제목</span>
                    <input
                      aria-label="선택 단계 제목"
                      value={selectedFlowEditStep.title}
                      onChange={(event) => updateSelectedStep({ title: event.target.value })}
                    />
                  </label>
                  <label className="cockpit-field">
                    <span>의존성</span>
                    <select
                      aria-label="선택 단계 의존성"
                      value={selectedFlowEditStep.dependencyStepKey ?? ""}
                      onChange={(event) => updateSelectedStep({ dependencyStepKey: event.target.value || null })}
                    >
                      <option value="">의존성 없음</option>
                      {selectedFlowEditStepIndex > 0 ? (
                        <option value={flowEditSteps[selectedFlowEditStepIndex - 1]?.stepKey ?? ""}>
                          이전 단계
                        </option>
                      ) : null}
                      {flowEditSteps
                        .filter((step) => step.clientId !== selectedFlowEditStep.clientId)
                        .map((step) => (
                          <option key={step.clientId} value={step.stepKey}>
                            {step.title || step.stepKey} ({step.stepKey})
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="cockpit-field">
                    <span>프롬프트</span>
                    <textarea
                      aria-label="선택 단계 프롬프트"
                      rows={8}
                      value={selectedFlowEditStep.prompt}
                      onChange={(event) => updateSelectedStep({ prompt: event.target.value })}
                    />
                  </label>
                </>
              ) : (
                <p className="cockpit-empty">선택한 단계가 없습니다.</p>
              )}
              {flowEditValidationErrors.length ? (
                <ul className="cockpit-validation-list">
                  {flowEditValidationErrors.map((error) => <li key={error}>{error}</li>)}
                </ul>
              ) : null}
            </section>
          </div>
        ) : (
          <div className="cockpit-compact-list cockpit-compact-list--steps">
            {selectedFlowSteps.length ? (
              selectedFlowSteps.map((step, index) => (
                <article className={`cockpit-step-output cockpit-step-output--${statusTone(step.status)}`} key={step.id}>
                  <div className="cockpit-step-output__main">
                    <strong>{index + 1}. {step.title}</strong>
                    <span>
                      {step.stepKey} · 단계 {statusLabel(step.status)} · 의존성 {step.dependencyStepKey ?? "없음"}
                    </span>
                    <p>{step.prompt}</p>
                    <button
                      className="cockpit-mini-button cockpit-mini-button--primary"
                      disabled={step.status !== "waiting_approval"}
                      onClick={() => onApproveTaskFlowStep(selectedOrFirstFlow!.flow.id, step.id)}
                      type="button"
                    >
                      승인
                    </button>
                    <button
                      className="cockpit-mini-button"
                      disabled={step.status !== "waiting_approval"}
                      onClick={() => onDenyTaskFlowStep(selectedOrFirstFlow!.flow.id, step.id)}
                      type="button"
                    >
                      반려
                    </button>
                  </div>
                  <div className="cockpit-step-output__meta">
                    <span>Task: {statusLabel(step.task?.status ?? step.status)}</span>
                    <span>Run: {statusLabel(step.run?.status ?? null)}</span>
                    <span>산출물: {step.output?.artifactCount ?? 0}</span>
                    <span>변경 파일: {step.output?.changedFiles.length ?? 0}</span>
                  </div>
                  {step.output?.resultSummary ? <p className="cockpit-muted">결과: {step.output.resultSummary}</p> : null}
                  {step.output?.lastEventSummary ? <p className="cockpit-muted">최근 이벤트: {step.output.lastEventSummary}</p> : null}
                  {step.output?.lastError ? <p className="cockpit-error-text">오류: {step.output.lastError}</p> : null}
                  {step.status === "waiting_approval" ? (
                    <p className="settings-warning">이 단계는 사람의 승인 후 다음 단계로 진행됩니다.</p>
                  ) : null}
                  <div className="cockpit-section-actions">
                    <button
                      className="cockpit-mini-button"
                      disabled={!step.run?.id}
                      onClick={() => step.run?.id && onOpenRun(step.run.id)}
                      type="button"
                    >
                      Run 보기
                    </button>
                    <button
                      className="cockpit-mini-button"
                      disabled={!step.run?.id}
                      onClick={() => step.run?.id && onOpenArtifacts(step.run.id)}
                      type="button"
                    >
                      산출물 보기
                    </button>
                    <button
                      className="cockpit-mini-button"
                      disabled={step.status !== "failed"}
                      onClick={() => onRetryTaskFlowStep(selectedOrFirstFlow!.flow.id, step.id)}
                      type="button"
                    >
                      재시도
                    </button>
                    <button
                      className="cockpit-mini-button"
                      disabled={step.status === "completed" || step.status === "skipped"}
                      onClick={() => onSkipTaskFlowStep(selectedOrFirstFlow!.flow.id, step.id)}
                      type="button"
                    >
                      건너뜀
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <p className="cockpit-empty">빈 워크플로우 공간입니다. 수정 모드에서 단계를 추가하세요.</p>
            )}
          </div>
        )}
        {selectedTaskFlow?.report ? (
          <article className="cockpit-report-card">
            <div>
              <strong>Flow 완료 보고서</strong>
              <p>{selectedTaskFlow.report.summary ?? "완료된 Flow의 단계 결과와 후속 작업 제안을 저장했습니다."}</p>
            </div>
            <div className="cockpit-section-actions">
              <button className="cockpit-mini-button" onClick={copyFlowReport} type="button">
                보고서 복사
              </button>
              <span className="cockpit-pill">보고서 산출물 저장됨</span>
            </div>
          </article>
        ) : null}
      </section>

      <div className="cockpit-section-grid cockpit-section-grid--workflow">
        <section className="cockpit-section-card">
          <div className="cockpit-section-card__header">
            <h2>Outline으로 빠르게 만들기</h2>
            <span className="cockpit-pill">보조</span>
          </div>
          <label className="cockpit-field">
            <span>Flow 제목</span>
            <input
              onChange={(event) => setFlowTitle(event.target.value)}
              placeholder="예: 항공 연구 자동화"
              value={flowTitle}
            />
          </label>
          <label className="cockpit-field">
            <span>Outline 붙여넣기</span>
            <textarea
              onChange={(event) => setFlowOutline(event.target.value)}
              placeholder={"1. 요구사항 정리\n2. 자료 조사\n3. 후보안 비교\n4. 실행 계획\n5. 결정 로그"}
              rows={7}
              value={flowOutline}
            />
          </label>
          <label className="cockpit-field cockpit-field--inline">
            <span>생성 후 실행</span>
            <select onChange={(event) => setFlowAutoStart(event.target.value === "true")} value={String(flowAutoStart)}>
              <option value="true">바로 시작</option>
              <option value="false">수동 시작</option>
            </select>
          </label>
          <div className="cockpit-section-actions">
            <button
              className="cockpit-mini-button"
              disabled={!flowTitle.trim() && !flowOutline.trim()}
              onClick={createFlowFromEditor}
              type="button"
            >
              Outline으로 Flow 생성
            </button>
            <button className="cockpit-mini-button" onClick={createDefaultResearchFlow} type="button">
              항공 연구 템플릿
            </button>
          </div>
        </section>

        <section className="cockpit-section-card">
          <div className="cockpit-section-card__header">
            <h2>Flow 목록</h2>
            <span className="cockpit-pill">{taskFlows.length}</span>
          </div>
          <div className="cockpit-compact-list">
            {taskFlows.length ? (
              taskFlows.slice(0, 8).map((flow) => (
                <article className="cockpit-flow-list-item" key={flow.id}>
                  <button
                    className="cockpit-flow-list-item__main"
                    onClick={() => onSelectTaskFlow(flow.id)}
                    type="button"
                  >
                    <strong>{flow.title}</strong>
                    <span>{statusLabel(flow.status)} / {formatTime(flow.updatedAt)}</span>
                  </button>
                  <button
                    aria-label={`${flow.title} 수정`}
                    className="cockpit-mini-button cockpit-flow-list-item__edit"
                    disabled={flow.status !== "queued"}
                    onClick={() => requestEditFlow(flow)}
                    title={flow.status !== "queued" ? "대기 상태 Flow만 수정할 수 있습니다." : "Flow 수정"}
                    type="button"
                  >
                    수정
                  </button>
                  <button
                    aria-label={`${flow.title} 삭제`}
                    className="cockpit-mini-button cockpit-mini-button--danger cockpit-flow-list-item__delete"
                    disabled={flow.status === "running"}
                    onClick={() => requestDeleteFlow(flow)}
                    title={flow.status === "running" ? "실행 중인 Flow는 삭제할 수 없습니다." : "Flow 삭제"}
                    type="button"
                  >
                    삭제
                  </button>
                </article>
              ))
            ) : (
              <p className="cockpit-empty">아직 생성된 Flow가 없습니다.</p>
            )}
          </div>
        </section>
      </div>

      <section className="cockpit-section-card cockpit-section-card--wide">
        <div className="cockpit-section-card__header">
          <div>
            <p className="cockpit-eyebrow">Queue</p>
            <h2>Task Queue / 실패함</h2>
          </div>
          <span className="cockpit-pill">주의 {taskGroups.attention.length}</span>
        </div>
        <div className="cockpit-task-queue-grid">
          {([
            ["queued", "대기", taskGroups.queued],
            ["running", "실행 중", taskGroups.running],
            ["attention", "주의 필요", taskGroups.attention],
            ["completed", "완료", taskGroups.completed],
            ["cancelled", "취소", taskGroups.cancelled],
          ] as const).map(([key, label, group]) => (
            <section className={`cockpit-task-queue cockpit-task-queue--${key}`} key={key}>
              <h3>{label} <span>{group.length}</span></h3>
              {group.slice(0, 6).map((task) => (
                <article key={task.id}>
                  <strong>{task.title}</strong>
                  <span>{taskKindLabel(task.taskKind)} · {statusLabel(task.status)}</span>
                  <small>예약: {formatTime(task.scheduledFor)} · Run: {task.runId ?? "없음"}</small>
                  <small>Flow: {task.taskFlowId ? `${task.taskFlowId.slice(0, 8)} / ${task.flowStepKey ?? "-"}` : "연결 없음"}</small>
                  {task.automationRuleId ? <small>자동화: {task.automationRuleId}</small> : null}
                  {task.status === "failed" || task.status === "timed_out" ? (
                    <div className="cockpit-section-actions">
                      <button className="cockpit-mini-button" onClick={() => onRetryTask(task.id)} type="button">
                        재시도
                      </button>
                      <button className="cockpit-mini-button" onClick={() => copyTaskDebug(task)} type="button">
                        debug 정보 복사
                      </button>
                    </div>
                  ) : task.status === "cancelled" ? (
                    <button className="cockpit-mini-button" onClick={() => onRetryTask(task.id)} type="button">
                      재시도
                    </button>
                  ) : task.status === "completed" ? (
                    <button
                      className="cockpit-mini-button"
                      onClick={() => {
                        if (window.confirm("완료된 Task를 복제해서 다시 실행할까요?")) {
                          onRetryTask(task.id, true);
                        }
                      }}
                      type="button"
                    >
                      복제 실행
                    </button>
                  ) : null}
                </article>
              ))}
              {!group.length ? <p className="cockpit-empty">항목 없음</p> : null}
            </section>
          ))}
        </div>
      </section>

      <section className="cockpit-ops-drawer cockpit-ops-drawer--section" aria-label="최근 실행 이벤트">
        <div className="cockpit-drawer-panel cockpit-drawer-panel--wide">
          <div className="cockpit-drawer-panel__header">
            <h3>최근 실행 이벤트</h3>
            <span>{executionEvents.length}</span>
          </div>
          <div className="cockpit-tool-table">
            {executionEvents.length ? (
              executionEvents.slice(0, 6).map((event) => (
                <article className="cockpit-tool-row" key={`${event.id}-${event.createdAt}`}>
                  <time>{formatTime(event.createdAt)}</time>
                  <strong>{eventName(event)}</strong>
                  <span>{eventSummary(event)}</span>
                  <em>{event.eventType === "error" ? "오류" : "기록"}</em>
                </article>
              ))
            ) : (
              <p className="cockpit-empty">최근 실행 이벤트가 없습니다.</p>
            )}
          </div>
        </div>
        <div className="cockpit-drawer-panel">
          <div className="cockpit-drawer-panel__header">
            <h3>Run 상태</h3>
            <span>{runs.length}</span>
          </div>
          <div className="cockpit-metric-strip cockpit-metric-strip--stack">
            <span>실행 중 {runCounts.running ?? 0}</span>
            <span>완료 {runCounts.completed ?? 0}</span>
            <span>실패 {(runCounts.failed ?? 0) + (runCounts.cancelled ?? 0)}</span>
          </div>
        </div>
        <div className="cockpit-drawer-panel">
          <div className="cockpit-drawer-panel__header">
            <h3>Flow 상태</h3>
            <span>{taskFlows.length}</span>
          </div>
          <div className="cockpit-metric-strip cockpit-metric-strip--stack">
            <span>대기 {flowCounts.queued ?? 0}</span>
            <span>실행 {flowCounts.running ?? 0}</span>
            <span>완료 {flowCounts.completed ?? 0}</span>
          </div>
        </div>
      </section>

      <section className="cockpit-section-card">
        <div className="cockpit-section-card__header">
          <h2>현재 세션</h2>
          <span className="cockpit-pill">{activeConversation ? "연결됨" : "없음"}</span>
        </div>
        <p className="cockpit-muted">
          에이전트: {activeAgent?.name ?? "선택 없음"} / 공급자: {providerLabel} / 모델: {modelLabel} / 추론: {reasoningLabel}
        </p>
      </section>
    </div>
  );
}
