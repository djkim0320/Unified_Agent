import { buildHeaders, readJsonOrThrow } from "../../apiClient";
import type { ProviderKind, ReasoningLevel, StreamEventPayloadMap } from "../../types";

function flushSseEvent(
  eventName: keyof StreamEventPayloadMap | "message",
  dataLines: string[],
  onEvent: <K extends keyof StreamEventPayloadMap>(
    eventName: K,
    payload: StreamEventPayloadMap[K],
  ) => void,
) {
  if (!dataLines.length || eventName === "message") {
    return;
  }

  const payloadText = dataLines.join("\n");
  const payload = JSON.parse(payloadText) as StreamEventPayloadMap[typeof eventName];
  onEvent(eventName, payload);
}

export async function streamChat(
  payload: {
    conversationId: string;
    providerKind: ProviderKind;
    model: string;
    reasoningLevel: ReasoningLevel;
    message: string;
  },
  onEvent: <K extends keyof StreamEventPayloadMap>(
    eventName: K,
    eventPayload: StreamEventPayloadMap[K],
  ) => void,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: await buildHeaders({ method: "POST" }),
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    await readJsonOrThrow(response);
  }

  if (!response.body) {
    throw new Error("Streaming is not supported by this browser.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName: keyof StreamEventPayloadMap | "message" = "message";
  let dataLines: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line) {
        flushSseEvent(eventName, dataLines, onEvent);
        eventName = "message";
        dataLines = [];
        continue;
      }

      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim() as keyof StreamEventPayloadMap;
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }
  }

  if (buffer.trim()) {
    if (buffer.startsWith("data:")) {
      dataLines.push(buffer.slice("data:".length).trimStart());
    }
  }
  flushSseEvent(eventName, dataLines, onEvent);
}
