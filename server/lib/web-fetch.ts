import { createAbortError } from "./process-control.js";
import { assertSafeOutboundUrl, resolveRedirectTarget } from "./network-guard.js";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_TEXT_LIMIT = 12_000;
const MAX_REDIRECTS = 5;

function collapseWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(createAbortError(`Fetch timed out after ${timeoutMs}ms.`));
  }, timeoutMs);

  const abortListener = () => {
    controller.abort(signal?.reason ?? createAbortError());
  };

  if (signal?.aborted) {
    controller.abort(signal.reason ?? createAbortError());
  } else {
    signal?.addEventListener("abort", abortListener, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortListener);
    },
  };
}

async function readResponseText(response: Response, maxBytes: number) {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    const next = value ?? new Uint8Array();
    const remaining = maxBytes - totalBytes;
    if (remaining <= 0) {
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }

    if (next.byteLength > remaining) {
      chunks.push(next.slice(0, remaining));
      totalBytes += remaining;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }

    chunks.push(next);
    totalBytes += next.byteLength;
  }

  const text = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
  return truncated ? `${text}\n[content truncated after ${maxBytes} bytes]` : text;
}

async function guardedFetch(params: {
  url: string | URL;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  timeoutMs: number;
  maxBytes: number;
}) {
  let currentUrl = await assertSafeOutboundUrl(params.url);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const abort = combineSignals(params.signal, params.timeoutMs);
    try {
      const fetchPromise = params.fetchImpl(currentUrl, {
        redirect: "manual",
        signal: abort.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        },
      });
      const response = await Promise.race([
        fetchPromise,
        new Promise<Response>((_, reject) => {
          abort.signal.addEventListener(
            "abort",
            () => reject(abort.signal.reason ?? createAbortError()),
            { once: true },
          );
        }),
      ]);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`Redirect response from ${currentUrl.toString()} did not include Location.`);
        }
        currentUrl = await assertSafeOutboundUrl(resolveRedirectTarget(currentUrl, location));
        continue;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch ${currentUrl.toString()}: ${response.status}`);
      }

      const html = await readResponseText(response, params.maxBytes);
      return {
        url: currentUrl.toString(),
        html,
      };
    } finally {
      abort.cleanup();
    }
  }

  throw new Error(`Too many redirects while fetching ${currentUrl.toString()}.`);
}

export async function fetchWebPage(
  url: string,
  options?: {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxBytes?: number;
    textLimit?: number;
  },
) {
  const result = await guardedFetch({
    url,
    fetchImpl: options?.fetchImpl ?? fetch,
    signal: options?.signal,
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBytes: options?.maxBytes ?? DEFAULT_MAX_BYTES,
  });

  const titleMatch = result.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const bodyText = collapseWhitespace(
    result.html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );

  return {
    url: result.url,
    title: collapseWhitespace(titleMatch?.[1] ?? ""),
    text: bodyText.slice(0, options?.textLimit ?? DEFAULT_TEXT_LIMIT),
  };
}
