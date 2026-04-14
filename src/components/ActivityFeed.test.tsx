import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivityFeed } from "./ActivityFeed";
import type { DisplayMessage, WorkspaceRunEventRecord, WorkspaceRunRecord } from "../types";

const messages: DisplayMessage[] = [
  {
    id: "user-1",
    role: "user",
    content: "README.md 파일을 만들어줘",
  },
  {
    id: "assistant-1",
    role: "assistant",
    content: "README.md 파일을 만들었습니다.",
  },
];

const selectedRun: WorkspaceRunRecord = {
  id: "run-1",
  conversationId: "conversation-1",
  taskId: null,
  parentRunId: null,
  providerKind: "openai",
  model: "gpt-5.4",
  userMessage: "README.md 파일을 만들어줘",
  status: "completed",
  phase: "completed",
  checkpoint: null,
  resumeToken: null,
  createdAt: 10,
  updatedAt: 12,
};

const runEvents: WorkspaceRunEventRecord[] = [
  {
    id: "event-tool-call",
    runId: selectedRun.id,
    eventType: "tool_call",
    payload: {
      toolName: "write_file",
      path: "README.md",
    },
    createdAt: 11,
  },
  {
    id: "event-tool-result",
    runId: selectedRun.id,
    eventType: "tool_result",
    payload: {
      toolName: "write_file",
      success: true,
      path: "README.md",
    },
    createdAt: 12,
  },
];

describe("ActivityFeed", () => {
  it("renders conversation messages together with selected run events", () => {
    render(
      <ActivityFeed
        liveEvents={[]}
        messages={messages}
        pendingAssistantText=""
        runEvents={runEvents}
        selectedRun={selectedRun}
      />,
    );

    expect(screen.getByText("README.md 파일을 만들어줘")).toBeInTheDocument();
    expect(screen.getByText("README.md 파일을 만들었습니다.")).toBeInTheDocument();
    expect(screen.getAllByText("write_file")).toHaveLength(2);
    expect(screen.getByText("도구 호출")).toBeInTheDocument();
    expect(screen.getByText("성공")).toBeInTheDocument();
  });

  it("deduplicates live events when the same stored run event already exists", () => {
    render(
      <ActivityFeed
        liveEvents={[
          {
            id: "live-tool-call",
            runId: selectedRun.id,
            eventType: "tool_call",
            payload: {
              toolName: "write_file",
              path: "README.md",
            },
            createdAt: 13,
          },
        ]}
        messages={messages}
        pendingAssistantText=""
        runEvents={runEvents}
        selectedRun={selectedRun}
      />,
    );

    expect(screen.getAllByText("도구 호출")).toHaveLength(1);
  });

  it("shows live status and pending assistant text while a run is streaming", () => {
    render(
      <ActivityFeed
        liveEvents={[
          {
            id: "live-status",
            runId: "live",
            eventType: "status",
            payload: {
              message: "파일 작성 중",
            },
            createdAt: 20,
          },
        ]}
        messages={[
          {
            id: "user-2",
            role: "user",
            content: "hello_browser.ts 파일을 만들어줘",
          },
        ]}
        pendingAssistantText="작성 내용을 정리하고 있습니다."
        runEvents={[]}
        selectedRun={selectedRun}
      />,
    );

    expect(screen.getByText("파일 작성 중")).toBeInTheDocument();
    expect(screen.getByText("작성 내용을 정리하고 있습니다.")).toBeInTheDocument();
  });
});
