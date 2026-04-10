import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkspaceFile, getWorkspaceTree, listWorkspaceRunEvents, streamChat } from "./api";

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

  it("includes conversationId when fetching workspace tree and file payloads", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ scope: "sandbox", path: ".", tree: [] }), {
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
    await getWorkspaceTree({
      conversationId: "11111111-1111-4111-8111-111111111111",
      scope: "sandbox",
      path: "docs",
      maxDepth: 2,
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/workspace/tree?conversationId=11111111-1111-4111-8111-111111111111&scope=sandbox&path=docs&maxDepth=2",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          file: {
            scope: "sandbox",
            path: "docs/readme.md",
            content: "# readme",
            binary: false,
            unsupportedEncoding: false,
            encoding: "utf-8",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );
    await getWorkspaceFile({
      conversationId: "11111111-1111-4111-8111-111111111111",
      scope: "sandbox",
      path: "docs/readme.md",
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/workspace/file?conversationId=11111111-1111-4111-8111-111111111111&scope=sandbox&path=docs%2Freadme.md",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });
});
