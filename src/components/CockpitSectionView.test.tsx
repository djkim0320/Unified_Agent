import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CockpitSectionView } from "./CockpitSectionView";
import type { TaskFlowRecord, TaskFlowStepDetail } from "../types";

const queuedFlow: TaskFlowRecord = {
  id: "flow-1",
  agentId: "agent-1",
  conversationId: "conversation-1",
  title: "Queued Flow",
  status: "queued",
  createdAt: 1,
  updatedAt: 2,
};

const runningFlow: TaskFlowRecord = {
  ...queuedFlow,
  id: "flow-running",
  title: "Running Flow",
  status: "running",
};

const steps: TaskFlowStepDetail[] = [
  {
    id: "step-1",
    flowId: queuedFlow.id,
    stepKey: "requirements",
    title: "Requirements",
    prompt: "Requirements prompt",
    dependencyStepKey: null,
    position: 0,
    status: "queued",
    taskId: null,
    createdAt: 1,
    updatedAt: 1,
    task: null,
    run: null,
  },
  {
    id: "step-2",
    flowId: queuedFlow.id,
    stepKey: "research",
    title: "Research",
    prompt: "Research prompt",
    dependencyStepKey: "requirements",
    position: 1,
    status: "queued",
    taskId: null,
    createdAt: 1,
    updatedAt: 1,
    task: null,
    run: null,
  },
];

function renderWorkflow(
  overrides: Partial<Parameters<typeof CockpitSectionView>[0]> = {},
) {
  return render(
    <CockpitSectionView
      activeAgent={null}
      activeConversation={null}
      changedFiles={[]}
      computerUseAllowlistDraft=""
      computerUseClickSelector=""
      computerUseDetail={null}
      computerUseError={null}
      computerUseLoading={false}
      computerUseNavigationUrl=""
      computerUseSettings={null}
      file={null}
      liveEvents={[]}
      memory={null}
      modelLabel="gpt-5.4"
      onApproveComputerUseAction={vi.fn()}
      onCancelTaskFlow={vi.fn()}
      onClickComputerUseSession={vi.fn()}
      onCloseComputerUseSession={vi.fn()}
      onComputerUseAllowlistDraftChange={vi.fn()}
      onComputerUseClickSelectorChange={vi.fn()}
      onComputerUseNavigationUrlChange={vi.fn()}
      onCreateComputerUseSession={vi.fn()}
      onCreateConversation={vi.fn()}
      onCreateMcpServerProfile={vi.fn()}
      onCreateSkill={vi.fn()}
      onCreateTaskFlow={vi.fn()}
      onDeleteTaskFlow={vi.fn()}
      onDenyComputerUseAction={vi.fn()}
      onNavigate={vi.fn()}
      onNavigateComputerUseSession={vi.fn()}
      onOpenAgentSettings={vi.fn()}
      onOpenProviderSettings={vi.fn()}
      onRefreshFiles={vi.fn()}
      onRefreshPlatformMetadata={vi.fn()}
      onResumeTaskFlow={vi.fn()}
      onRetryTaskFlowStep={vi.fn()}
      onRiskyClickComputerUseSession={vi.fn()}
      onSaveComputerUseSettings={vi.fn()}
      onSaveTaskFlowSteps={vi.fn()}
      onScopeChange={vi.fn()}
      onScreenshotComputerUseSession={vi.fn()}
      onSelectFile={vi.fn()}
      onSelectTaskFlow={vi.fn()}
      onSensitiveTypeComputerUseSession={vi.fn()}
      onSkipTaskFlowStep={vi.fn()}
      onStartTaskFlow={vi.fn()}
      onToggleComputerUseEnabled={vi.fn()}
      platformMetadata={null}
      platformMetadataLoading={false}
      providerLabel="OpenAI"
      reasoningLabel="High"
      runEvents={null}
      runs={[]}
      scope="sandbox"
      selectedTaskFlow={{ flow: queuedFlow, steps }}
      target="workflow"
      taskFlows={[queuedFlow]}
      tasks={[]}
      tree={[]}
      workspaceLoading={false}
      {...overrides}
    />,
  );
}

describe("CockpitSectionView workflow editor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a persisted empty queued flow from the command strip", async () => {
    const user = userEvent.setup();
    const onCreateTaskFlow = vi.fn();
    const onNavigate = vi.fn();
    renderWorkflow({
      onCreateTaskFlow,
      onNavigate,
      selectedTaskFlow: null,
      taskFlows: [],
    });

    await user.click(screen.getByRole("button", { name: "빈 Flow 만들기" }));

    expect(onCreateTaskFlow).toHaveBeenCalledWith({
      title: "새 워크플로우",
      autoStart: false,
      steps: [],
    });
    expect(onNavigate).toHaveBeenCalledWith("workflow");
  });

  it("keeps empty queued flows editable and blocks starting until a step exists", async () => {
    const user = userEvent.setup();
    const onSaveTaskFlowSteps = vi.fn();
    const emptyFlow: TaskFlowRecord = {
      ...queuedFlow,
      id: "flow-empty",
      title: "새 워크플로우",
    };
    renderWorkflow({
      onSaveTaskFlowSteps,
      selectedTaskFlow: { flow: emptyFlow, steps: [] },
      taskFlows: [emptyFlow],
    });

    expect(screen.getByRole("button", { name: "시작/평가" })).toBeDisabled();
    expect(screen.getByText("빈 워크플로우 공간입니다.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "선택 Flow 수정" }));
    expect(screen.getByText("빈 워크플로우입니다.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "변경 저장" }));

    expect(onSaveTaskFlowSteps).toHaveBeenCalledWith(emptyFlow.id, [], "새 워크플로우");
  });

  it("adds, deletes, reorders, and saves queued flow steps", async () => {
    const user = userEvent.setup();
    const onSaveTaskFlowSteps = vi.fn();
    renderWorkflow({ onSaveTaskFlowSteps });

    await user.click(screen.getByRole("button", { name: "선택 Flow 수정" }));
    await user.click(screen.getByRole("button", { name: "단계 추가" }));

    const thirdStepTitle = screen.getByLabelText("선택 단계 제목");
    expect(thirdStepTitle).toHaveValue("Step 3");

    await user.click(within(screen.getByText("Step 3").closest("article") as HTMLElement).getByRole("button", { name: "삭제" }));
    await user.click(screen.getAllByRole("button", { name: "아래" })[0]);
    await user.click(screen.getByRole("button", { name: "변경 저장" }));

    expect(onSaveTaskFlowSteps).toHaveBeenCalledWith(queuedFlow.id, [
      { stepKey: "research", title: "Research", prompt: "Research prompt" },
      { stepKey: "requirements", title: "Requirements", prompt: "Requirements prompt" },
    ], "Queued Flow");
  });

  it("supports native drag and drop reordering", async () => {
    const user = userEvent.setup();
    const onSaveTaskFlowSteps = vi.fn();
    renderWorkflow({ onSaveTaskFlowSteps });

    await user.click(screen.getByRole("button", { name: "선택 Flow 수정" }));

    const firstCard = screen.getByText("Requirements").closest("article") as HTMLElement;
    const secondCard = screen.getByText("Research").closest("article") as HTMLElement;
    fireEvent.dragStart(firstCard, { dataTransfer: createDataTransfer() });
    fireEvent.drop(secondCard, { dataTransfer: createDataTransfer() });
    fireEvent.dragEnd(firstCard);

    await user.click(screen.getByRole("button", { name: "변경 저장" }));

    expect(onSaveTaskFlowSteps).toHaveBeenCalledWith(queuedFlow.id, [
      { stepKey: "research", title: "Research", prompt: "Research prompt" },
      { stepKey: "requirements", title: "Requirements", prompt: "Requirements prompt" },
    ], "Queued Flow");
  });

  it("confirms flow list deletion and disables deleting running flows", async () => {
    const user = userEvent.setup();
    const onDeleteTaskFlow = vi.fn();
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    renderWorkflow({
      onDeleteTaskFlow,
      taskFlows: [queuedFlow, runningFlow],
    });

    await user.click(screen.getByRole("button", { name: "Queued Flow 삭제" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Queued Flow"));
    expect(onDeleteTaskFlow).toHaveBeenCalledWith(queuedFlow.id);
    expect(screen.getByRole("button", { name: "Queued Flow 수정" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Running Flow 삭제" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Running Flow 수정" })).toBeDisabled();
  });

  it("blocks structural editing when the flow is not queued", () => {
    const failedFlow: TaskFlowRecord = { ...queuedFlow, status: "failed" };
    renderWorkflow({
      selectedTaskFlow: { flow: failedFlow, steps },
      taskFlows: [failedFlow],
    });

    expect(screen.getByRole("button", { name: "선택 Flow 수정" })).toBeDisabled();
    expect(screen.getByText("구조 편집은 아직 시작하지 않은 대기 상태 Flow에서만 가능합니다.")).toBeInTheDocument();
  });

  it("renders readable Korean workflow copy without replacement-character mojibake", () => {
    const { container } = renderWorkflow({ selectedTaskFlow: null, taskFlows: [] });

    expect(screen.getByRole("heading", { name: "워크플로우 관제" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Outline으로 빠르게 만들기" })).toBeInTheDocument();
    expect(screen.getByText("아직 생성된 Flow가 없습니다.")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\uFFFD/);
  });
});

function createDataTransfer(): DataTransfer {
  const data = new Map<string, string>();
  return {
    clearData: vi.fn(),
    dropEffect: "move",
    effectAllowed: "move",
    files: [] as unknown as FileList,
    getData: vi.fn((format: string) => data.get(format) ?? ""),
    items: [] as unknown as DataTransferItemList,
    setDragImage: vi.fn(),
    setData: vi.fn((format: string, value: string) => {
      data.set(format, value);
    }),
    types: [] as unknown as readonly string[],
  };
}
