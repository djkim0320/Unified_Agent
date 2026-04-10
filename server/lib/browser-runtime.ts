import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

type BrowserSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  lastUsedAt: number;
};

function summarizeText(text: string, maxLength = 6000) {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function createBrowserRuntime(options?: { idleTimeoutMs?: number }) {
  const idleTimeoutMs = options?.idleTimeoutMs ?? 5 * 60_000;
  const sessions = new Map<string, BrowserSession>();

  async function closeSession(conversationId: string) {
    const session = sessions.get(conversationId);
    if (!session) {
      return;
    }
    sessions.delete(conversationId);
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
  }

  async function ensureSession(conversationId: string) {
    const existing = sessions.get(conversationId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing;
    }

    try {
      const browser = await chromium.launch({
        headless: true,
      });
      const context = await browser.newContext();
      const page = await context.newPage();
      const session = {
        browser,
        context,
        page,
        lastUsedAt: Date.now(),
      } satisfies BrowserSession;
      sessions.set(conversationId, session);
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
      .map(([conversationId]) => conversationId);
    for (const conversationId of staleIds) {
      void closeSession(conversationId);
    }
  }

  async function search(conversationId: string, query: string) {
    const session = await ensureSession(conversationId);
    await session.page.goto(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, {
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
          const url =
            typeof link.getAttribute("href") === "string" ? link.getAttribute("href") : "";
          if (!title || !url) {
            return null;
          }
          return {
            title,
            url,
          };
        })
        .filter(Boolean)
        .slice(0, 5);
    });

    return {
      query,
      url: session.page.url(),
      results,
    };
  }

  async function open(conversationId: string, url: string) {
    const session = await ensureSession(conversationId);
    await session.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    session.lastUsedAt = Date.now();
    return {
      url: session.page.url(),
      title: await session.page.title(),
    };
  }

  async function snapshot(conversationId: string) {
    const session = await ensureSession(conversationId);
    session.lastUsedAt = Date.now();
    return {
      url: session.page.url(),
      title: await session.page.title(),
      text: summarizeText(await session.page.locator("body").innerText()),
    };
  }

  async function extract(conversationId: string, selector?: string) {
    const session = await ensureSession(conversationId);
    const locator = selector ? session.page.locator(selector).first() : session.page.locator("body");
    session.lastUsedAt = Date.now();
    return {
      url: session.page.url(),
      title: await session.page.title(),
      text: summarizeText(await locator.innerText()),
    };
  }

  async function click(conversationId: string, selector: string) {
    const session = await ensureSession(conversationId);
    await session.page.locator(selector).first().click();
    session.lastUsedAt = Date.now();
    return {
      url: session.page.url(),
      title: await session.page.title(),
    };
  }

  async function type(conversationId: string, selector: string, text: string, submit?: boolean) {
    const session = await ensureSession(conversationId);
    await session.page.locator(selector).first().fill(text);
    if (submit) {
      await session.page.locator(selector).first().press("Enter");
    }
    session.lastUsedAt = Date.now();
    return {
      url: session.page.url(),
      title: await session.page.title(),
    };
  }

  async function back(conversationId: string) {
    const session = await ensureSession(conversationId);
    await session.page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
    session.lastUsedAt = Date.now();
    return {
      url: session.page.url(),
      title: await session.page.title(),
    };
  }

  setInterval(collectGarbage, Math.min(idleTimeoutMs, 60_000)).unref?.();

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
  };
}
