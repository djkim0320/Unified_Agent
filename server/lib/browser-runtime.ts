import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { assertSafeOutboundUrl } from "./network-guard.js";
import { createAbortError } from "./process-control.js";

type BrowserSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  conversationId: string;
  lastUsedAt: number;
};

type SessionParams = {
  sessionId: string;
  conversationId: string;
};

function summarizeText(text: string, maxLength = 6000) {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

async function assertSafeNavigationUrl(url: string) {
  if (url === "about:blank") {
    return;
  }
  await assertSafeOutboundUrl(url);
}

export function createBrowserRuntime(options?: {
  idleTimeoutMs?: number;
  launch?: typeof chromium.launch;
}) {
  const idleTimeoutMs = options?.idleTimeoutMs ?? 5 * 60_000;
  const launch = options?.launch ?? chromium.launch;
  const sessions = new Map<string, BrowserSession>();

  async function closeSession(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }
    sessions.delete(sessionId);
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
  }

  async function closeConversationSessions(conversationId: string) {
    const ids = [...sessions.entries()]
      .filter(([, session]) => session.conversationId === conversationId)
      .map(([sessionId]) => sessionId);
    await Promise.all(ids.map((sessionId) => closeSession(sessionId)));
  }

  function getAbortReason(signal: AbortSignal | undefined) {
    const reason = signal?.reason;
    return reason instanceof Error ? reason : createAbortError("Browser operation was cancelled.");
  }

  async function runAbortableSessionOperation<T>(
    params: SessionParams & { signal?: AbortSignal },
    operation: () => Promise<T>,
  ) {
    if (params.signal?.aborted) {
      await closeSession(params.sessionId);
      throw getAbortReason(params.signal);
    }

    let abortListener: (() => void) | null = null;
    const abortPromise = new Promise<T>((_, reject) => {
      abortListener = () => {
        void closeSession(params.sessionId);
        reject(getAbortReason(params.signal));
      };
      params.signal?.addEventListener("abort", abortListener, { once: true });
    });

    try {
      return await Promise.race([operation(), abortPromise]);
    } finally {
      if (abortListener) {
        params.signal?.removeEventListener("abort", abortListener);
      }
    }
  }

  async function ensureSession(params: SessionParams) {
    const existing = sessions.get(params.sessionId);
    if (existing) {
      if (existing.conversationId !== params.conversationId) {
        throw new Error("Browser session conversation mismatch.");
      }
      existing.lastUsedAt = Date.now();
      return existing;
    }

    try {
      const browser = await launch({
        headless: true,
      });
      const context = await browser.newContext();
      await context.route("**/*", async (route) => {
        const request = route.request();
        try {
          await assertSafeNavigationUrl(request.url());
          await route.continue();
        } catch {
          await route.abort("blockedbyclient").catch(() => undefined);
        }
      });
      const page = await context.newPage();
      const session = {
        browser,
        context,
        page,
        conversationId: params.conversationId,
        lastUsedAt: Date.now(),
      } satisfies BrowserSession;
      sessions.set(params.sessionId, session);
      return session;
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `${error.message}. Install Chromium with "pnpm exec playwright install chromium".`
          : 'Failed to launch Chromium. Install it with "pnpm exec playwright install chromium".',
      );
    }
  }

  function collectGarbage() {
    const now = Date.now();
    const staleIds = [...sessions.entries()]
      .filter(([, session]) => now - session.lastUsedAt > idleTimeoutMs)
      .map(([sessionId]) => sessionId);
    for (const sessionId of staleIds) {
      void closeSession(sessionId);
    }
  }

  async function search(params: SessionParams & { query: string; signal?: AbortSignal }) {
    const url = `https://duckduckgo.com/?q=${encodeURIComponent(params.query)}`;
    await runAbortableSessionOperation(params, async () => {
      await assertSafeOutboundUrl(url);
    });
    const session = await ensureSession(params);
    return await runAbortableSessionOperation(params, async () => {
      await session.page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await session.page.waitForTimeout(1_000);
      session.lastUsedAt = Date.now();

      const results = await session.page.evaluate(() => {
        const doc = (globalThis as unknown as {
          document: {
            querySelectorAll: (selector: string) => ArrayLike<{
              textContent?: string | null;
              getAttribute: (name: string) => string | null;
            }>;
          };
        }).document;
        const candidates = Array.from(
          doc.querySelectorAll("article a, [data-testid='result'] a, a[data-testid='result-title-a']"),
        );
        return candidates
          .map((link) => {
            const title = link.textContent?.replace(/\s+/g, " ").trim() ?? "";
            const urlValue = link.getAttribute("href") || "";
            if (!title || !urlValue) {
              return null;
            }
            return {
              title,
              url: urlValue,
            };
          })
          .filter(Boolean)
          .slice(0, 5);
      });

      return {
        query: params.query,
        url: session.page.url(),
        results,
      };
    });
  }

  async function open(params: SessionParams & { url: string; signal?: AbortSignal }) {
    await runAbortableSessionOperation(params, async () => {
      await assertSafeOutboundUrl(params.url);
    });
    const session = await ensureSession(params);
    return await runAbortableSessionOperation(params, async () => {
      await session.page.goto(params.url, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await assertSafeNavigationUrl(session.page.url());
      session.lastUsedAt = Date.now();
      return {
        url: session.page.url(),
        title: await session.page.title(),
      };
    });
  }

  async function snapshot(params: SessionParams) {
    const session = await ensureSession(params);
    session.lastUsedAt = Date.now();
    return {
      url: session.page.url(),
      title: await session.page.title(),
      text: summarizeText(await session.page.locator("body").innerText()),
    };
  }

  async function extract(params: SessionParams & { selector?: string }) {
    const session = await ensureSession(params);
    const locator = params.selector ? session.page.locator(params.selector).first() : session.page.locator("body");
    session.lastUsedAt = Date.now();
    return {
      url: session.page.url(),
      title: await session.page.title(),
      text: summarizeText(await locator.innerText()),
    };
  }

  async function click(params: SessionParams & { selector: string; signal?: AbortSignal }) {
    const session = await ensureSession(params);
    return await runAbortableSessionOperation(params, async () => {
      await session.page.locator(params.selector).first().click();
      await assertSafeNavigationUrl(session.page.url());
      session.lastUsedAt = Date.now();
      return {
        url: session.page.url(),
        title: await session.page.title(),
      };
    });
  }

  async function type(params: SessionParams & { selector: string; text: string; submit?: boolean; signal?: AbortSignal }) {
    const session = await ensureSession(params);
    return await runAbortableSessionOperation(params, async () => {
      await session.page.locator(params.selector).first().fill(params.text);
      if (params.submit) {
        await session.page.locator(params.selector).first().press("Enter");
      }
      await assertSafeNavigationUrl(session.page.url());
      session.lastUsedAt = Date.now();
      return {
        url: session.page.url(),
        title: await session.page.title(),
      };
    });
  }

  async function back(params: SessionParams & { signal?: AbortSignal }) {
    const session = await ensureSession(params);
    return await runAbortableSessionOperation(params, async () => {
      await session.page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
      await assertSafeNavigationUrl(session.page.url());
      session.lastUsedAt = Date.now();
      return {
        url: session.page.url(),
        title: await session.page.title(),
      };
    });
  }

  const interval = setInterval(collectGarbage, Math.min(idleTimeoutMs, 60_000));
  interval.unref?.();

  return {
    ensureSession,
    search,
    open,
    snapshot,
    extract,
    click,
    type,
    back,
    closeSession,
    closeConversationSessions,
    getSessionCount: () => sessions.size,
  };
}
