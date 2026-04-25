import { createParser, type EventSourceMessage } from "eventsource-parser";
import { createAbortError } from "./process-control.js";

async function readWithSignal(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
) {
  if (signal?.aborted) {
    await reader.cancel().catch(() => undefined);
    throw createAbortError("Streaming request was cancelled.");
  }

  if (!signal) {
    return await reader.read();
  }

  return await new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
    const abortHandler = () => {
      void reader.cancel().finally(() =>
        reject(createAbortError("Streaming request was cancelled.")),
      );
    };

    signal.addEventListener("abort", abortHandler, { once: true });
    reader.read().then(
      (result) => {
        signal.removeEventListener("abort", abortHandler);
        resolve(result);
      },
      (error) => {
        signal.removeEventListener("abort", abortHandler);
        reject(error);
      },
    );
  });
}

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
  signal?: AbortSignal,
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
    const result = await readWithSignal(reader, signal);
    if (result.done) {
      break;
    }
    parser.feed(decoder.decode(result.value, { stream: true }));
  }
}

export async function consumeNdjsonStream(
  response: Response,
  onJson: (payload: Record<string, unknown>) => void,
  signal?: AbortSignal,
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
    const result = await readWithSignal(reader, signal);
    if (result.done) {
      break;
    }
    buffer += decoder.decode(result.value, { stream: true });
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
