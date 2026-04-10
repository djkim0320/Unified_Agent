import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamChat } from "./api";

function createSseResponse(body: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}

describe("streamChat", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        createSseResponse(
          [
            'event: delta',
            'data: {"delta":"Hello"}',
            "",
            'event: delta',
            'data: {"delta":" world"}',
            "",
            'event: done',
            'data: {"messageId":"assistant-1"}',
            "",
          ].join("\n"),
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses SSE delta and done events", async () => {
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
        payload: { messageId: "assistant-1" },
      },
    ]);
  });
});
