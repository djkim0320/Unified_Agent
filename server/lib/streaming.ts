import { createParser, type EventSourceMessage } from "eventsource-parser";

export async function readJson<T>(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text || `Request failed with ${response.status}`);
  }
}

export async function ensureOk(response: Response) {
  if (response.ok) {
    return response;
  }
  const text = await response.text();
  throw new Error(text || `Request failed with ${response.status}`);
}

export async function consumeSseStream(
  response: Response,
  onEvent: (event: EventSourceMessage) => void,
) {
  await ensureOk(response);
  const body = response.body;
  if (!body) {
    throw new Error("Missing response body");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createParser({
    onEvent,
  });

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    parser.feed(decoder.decode(value, { stream: true }));
  }
}

export async function consumeNdjsonStream(
  response: Response,
  onJson: (payload: Record<string, unknown>) => void,
) {
  await ensureOk(response);
  const body = response.body;
  if (!body) {
    throw new Error("Missing response body");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.trim();
      if (!line) {
        continue;
      }
      onJson(JSON.parse(line) as Record<string, unknown>);
    }
  }

  const finalLine = buffer.trim();
  if (finalLine) {
    onJson(JSON.parse(finalLine) as Record<string, unknown>);
  }
}

