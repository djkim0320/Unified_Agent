import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listWorkspaceRunEvents, streamChat } from "./api";

function createSseResponse(body: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}

describe("api helpers", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses SSE delta and done events", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createSseResponse(
        [
          'event: delta',
          'data: {"delta":"Hello"}',
          "",
          'event: delta',
          'data: {"delta":" world"}',
          "",
          'event: done',
          'data: {"messageId":"assistant-1","runId":"run-1","changedFiles":["notes.md"]}',
          "",
        ].join("\n"),
      ),
    );

    const events: Array<{ event: string; payload: unknown }> = [];

    await streamChat(
      {
        conversationId: "11111111-1111-4111-8111-111111111111",
        providerKind: "openai",
        model: "gpt-5.4",
        reasoningLevel: "high",
        message: "hello",
      },
      (eventName, payload) => {
        events.push({
          event: eventName,
          payload,
        });
      },
    );

    expect(events).toEqual([
      {
        event: "delta",
        payload: { delta: "Hello" },
      },
      {
        event: "delta",
        payload: { delta: " world" },
      },
      {
        event: "done",
        payload: { messageId: "assistant-1", runId: "run-1", changedFiles: ["notes.md"] },
      },
    ]);
  });

  it("includes conversationId when fetching run events", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ events: [] }), {
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    await listWorkspaceRunEvents(
      "11111111-1111-4111-8111-111111111111",
      "run-123",
    );

    expect(fetch).toHaveBeenCalledWith(
      "/api/workspace/runs/run-123/events?conversationId=11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });
});
