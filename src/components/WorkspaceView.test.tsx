import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceView } from "./WorkspaceView";
import type { TaskFlowRecord, TaskFlowStepDetail } from "../types";

function renderWorkspaceView(overrides: Partial<Parameters<typeof WorkspaceView>[0]> = {}) {
  return render(
    <WorkspaceView
      file={null}
      heartbeat={null}
      heartbeatLogs={[]}
      liveEvents={[]}
      loading={false}
      memory={null}
      memorySearchResults={[]}
      messages={[]}
      onScopeChange={vi.fn()}
      onSelectFile={vi.fn()}
      pendingAssistantText=""
      runEvents={null}
      runs={[]}
      scope="sandbox"
      selectedRunId={null}
      taskFlows={[]}
      tasks={[]}
      tree={[]}
      {...overrides}
    />,
  );
}

describe("WorkspaceView task flows", () => {
  it("converts an outline into multiple flow steps", async () => {
    const user = userEvent.setup();
    const onCreateTaskFlow = vi.fn();
    renderWorkspaceView({ onCreateTaskFlow });

    await user.type(screen.getByLabelText("Flow title"), "항공 개념 연구");
    await user.type(
      screen.getByPlaceholderText(/요구사항 정리/),
      "1. 요구사항 정리\n2. 자료 조사",
    );
    await user.click(screen.getByRole("button", { name: "Outline을 단계로 변환" }));

    expect(screen.getByDisplayValue("요구사항 정리")).toBeInTheDocument();
    expect(screen.getByDisplayValue("자료 조사")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Flow 생성" }));

    expect(onCreateTaskFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "항공 개념 연구",
        autoStart: true,
        steps: [
          expect.objectContaining({
            stepKey: "요구사항-정리",
            dependencyStepKey: null,
          }),
          expect.objectContaining({
            stepKey: "자료-조사",
            dependencyStepKey: "요구사항-정리",
          }),
        ],
      }),
    );
  });

  it("surfaces resume, retry, and skip controls for failed flows", async () => {
    const user = userEvent.setup();
    const flow: TaskFlowRecord = {
      id: "flow-1",
      agentId: "agent-1",
      conversationId: "conversation-1",
      title: "실패한 연구 흐름",
      status: "failed",
      createdAt: 1,
      updatedAt: 2,
    };
    const step: TaskFlowStepDetail = {
      id: "step-1",
      flowId: flow.id,
      taskId: "task-1",
      stepKey: "research",
      dependencyStepKey: null,
      title: "자료 조사",
      prompt: "자료를 조사한다.",
      status: "failed",
      createdAt: 1,
      updatedAt: 2,
      completedAt: 2,
      task: {
        id: "task-1",
        status: "failed",
        runId: null,
        resultText: "검색 실패",
        createdAt: 1,
        startedAt: 1,
        completedAt: 2,
        updatedAt: 2,
      },
      run: null,
    };
    const onResumeTaskFlow = vi.fn();
    const onRetryTaskFlowStep = vi.fn();
    const onSkipTaskFlowStep = vi.fn();
    renderWorkspaceView({
      onResumeTaskFlow,
      onRetryTaskFlowStep,
      onSkipTaskFlowStep,
      selectedTaskFlow: { flow, steps: [step] },
      taskFlows: [flow],
    });

    await user.click(screen.getAllByRole("button", { name: "Resume" })[0]);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await user.click(screen.getByRole("button", { name: "Skip" }));

    expect(onResumeTaskFlow).toHaveBeenCalledWith(flow.id);
    expect(onRetryTaskFlowStep).toHaveBeenCalledWith(flow.id, step.id);
    expect(onSkipTaskFlowStep).toHaveBeenCalledWith(flow.id, step.id);
  });
});
