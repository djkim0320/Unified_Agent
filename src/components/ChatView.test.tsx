import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatView } from "./ChatView";
import type { WorkspaceRunEventRecord } from "../types";

function liveEvent(payload: Record<string, unknown>): WorkspaceRunEventRecord {
  return {
    id: crypto.randomUUID(),
    runId: "live",
    eventType: "status",
    payload,
    createdAt: Date.now(),
  };
}

describe("ChatView activity timeline", () => {
  it("shows safe execution activity and expandable thinking summary inside chat", () => {
    render(
      <ChatView
        activityEvents={[
          liveEvent({
            phase: "opencode_event",
            event: {
              type: "command.started",
              title: "Read project files",
            },
          }),
          liveEvent({
            phase: "snapshot_timing",
            changedFiles: 2,
          }),
        ]}
        changedFiles={[]}
        error={null}
        loading
        messages={[
          {
            id: "user-1",
            role: "user",
            content: "상태를 보여줘",
          },
        ]}
        pendingAssistantText=""
      />,
    );

    expect(screen.getByText("명령/작업 1개 실행")).toBeInTheDocument();
    expect(screen.getByText("생각 중")).toBeInTheDocument();
    expect(screen.getByText("내부 추론 전문은 표시하지 않고, 안전하게 공개 가능한 실행 단계와 관찰 로그만 보여줍니다.")).toBeInTheDocument();
    expect(screen.getAllByText("변경 파일 확인").length).toBeGreaterThan(0);
    expect(screen.getByText("2개 파일 변경을 확인했습니다.")).toBeInTheDocument();
  });

  it("hides raw markdown emphasis markers in assistant prose", () => {
    const { container } = render(
      <ChatView
        activityEvents={[]}
        changedFiles={[]}
        error={null}
        loading={false}
        messages={[
          {
            id: "assistant-1",
            role: "assistant",
            content: "**연구 프로젝트 단위**\n\n__출처 DB__가 필요합니다.",
          },
        ]}
        pendingAssistantText=""
      />,
    );

    expect(screen.getByText("연구 프로젝트 단위")).toBeInTheDocument();
    expect(screen.getByText("출처 DB가 필요합니다.")).toBeInTheDocument();
    expect(container.textContent).not.toContain("**");
    expect(container.textContent).not.toContain("__");
  });
});
