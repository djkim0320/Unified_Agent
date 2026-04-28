import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { evaluateComputerUsePolicy } from "./policy.js";
import type { ComputerUseSettingsRecord } from "../../types.js";

type HarnessSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  createdAt: number;
  lastUsedAt: number;
  allowedDomains: string[];
};

type HarnessSessionCreate = {
  sessionId: string;
  allowedDomains: string[];
  settings: Pick<ComputerUseSettingsRecord, "enabled" | "allowExternalDomains" | "allowFileUrls">;
};

function minimalBrowserEnv(): Record<string, string> {
  if (process.platform === "win32") {
    return {
      SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
      TEMP: process.env.TEMP ?? "",
      TMP: process.env.TMP ?? "",
    };
  }
  return {
    HOME: "",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
  };
}

function summarizeText(text: string, maxLength = 6000) {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function createComputerUseBrowserHarness(options?: {
  launch?: typeof chromium.launch;
  idleTimeoutMs?: number;
}) {
  const launch = options?.launch ?? ((launchOptions) => chromium.launch(launchOptions));
  const idleTimeoutMs = options?.idleTimeoutMs ?? 15 * 60_000;
  const sessions = new Map<string, HarnessSession>();

  async function closeSession(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }
    sessions.delete(sessionId);
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
  }

  function sessionOrThrow(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session) {
      throw new Error("Computer Use browser session is not open.");
    }
    session.lastUsedAt = Date.now();
    return session;
  }

  async function createSession(params: HarnessSessionCreate) {
    const existing = sessions.get(params.sessionId);
    if (existing) {
      return {
        url: existing.page.url(),
        title: await existing.page.title().catch(() => ""),
      };
    }

    const browser = await launch({
      headless: true,
      env: minimalBrowserEnv(),
      args: [
        "--disable-extensions",
        "--disable-sync",
        "--disable-background-networking",
        "--disable-default-apps",
        "--disable-component-update",
        "--no-first-run",
      ],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      acceptDownloads: false,
      bypassCSP: false,
      permissions: [],
    });
    const mergedDomains = [...params.settings.allowExternalDomains, ...params.allowedDomains];
    await context.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      const verdict = evaluateComputerUsePolicy({
        actionType: "navigate",
        targetUrl: requestUrl,
        currentUrl: null,
        settings: {
          enabled: true,
          allowFileUrls: params.settings.allowFileUrls,
          allowExternalDomains: mergedDomains,
        },
      });
      if (verdict.decision === "blocked") {
        await route.abort("blockedbyclient").catch(() => undefined);
        return;
      }
      await route.continue();
    });

    const page = await context.newPage();
    sessions.set(params.sessionId, {
      browser,
      context,
      page,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      allowedDomains: params.allowedDomains,
    });
    return {
      url: page.url(),
      title: await page.title().catch(() => ""),
    };
  }

  async function navigate(params: { sessionId: string; url: string }) {
    const session = sessionOrThrow(params.sessionId);
    await session.page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    return {
      url: session.page.url(),
      title: await session.page.title(),
    };
  }

  async function screenshot(params: { sessionId: string; fullPage?: boolean }) {
    const session = sessionOrThrow(params.sessionId);
    const buffer = await session.page.screenshot({
      fullPage: Boolean(params.fullPage),
      type: "png",
    });
    return {
      url: session.page.url(),
      title: await session.page.title(),
      mimeType: "image/png",
      buffer,
    };
  }

  async function click(params: { sessionId: string; selector: string }) {
    const session = sessionOrThrow(params.sessionId);
    await session.page.locator(params.selector).first().click();
    return {
      url: session.page.url(),
      title: await session.page.title(),
    };
  }

  async function doubleClick(params: { sessionId: string; selector: string }) {
    const session = sessionOrThrow(params.sessionId);
    await session.page.locator(params.selector).first().dblclick();
    return {
      url: session.page.url(),
      title: await session.page.title(),
    };
  }

  async function type(params: { sessionId: string; selector: string; text: string; submit?: boolean }) {
    const session = sessionOrThrow(params.sessionId);
    const locator = session.page.locator(params.selector).first();
    await locator.fill(params.text);
    if (params.submit) {
      await locator.press("Enter");
    }
    return {
      url: session.page.url(),
      title: await session.page.title(),
    };
  }

  async function keypress(params: { sessionId: string; key: string; selector?: string }) {
    const session = sessionOrThrow(params.sessionId);
    if (params.selector) {
      await session.page.locator(params.selector).first().press(params.key);
    } else {
      await session.page.keyboard.press(params.key);
    }
    return {
      url: session.page.url(),
      title: await session.page.title(),
      key: params.key,
    };
  }

  async function scroll(params: { sessionId: string; deltaX: number; deltaY: number }) {
    const session = sessionOrThrow(params.sessionId);
    await session.page.mouse.wheel(params.deltaX, params.deltaY);
    return {
      url: session.page.url(),
      title: await session.page.title(),
      deltaX: params.deltaX,
      deltaY: params.deltaY,
    };
  }

  async function wait(params: { sessionId: string; timeoutMs: number }) {
    const session = sessionOrThrow(params.sessionId);
    await session.page.waitForTimeout(params.timeoutMs);
    return {
      url: session.page.url(),
      title: await session.page.title(),
      timeoutMs: params.timeoutMs,
    };
  }

  async function extractText(params: { sessionId: string; selector?: string }) {
    const session = sessionOrThrow(params.sessionId);
    const locator = params.selector ? session.page.locator(params.selector).first() : session.page.locator("body");
    return {
      url: session.page.url(),
      title: await session.page.title(),
      text: summarizeText(await locator.innerText()),
    };
  }

  function collectGarbage() {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
      if (now - session.lastUsedAt > idleTimeoutMs) {
        void closeSession(sessionId);
      }
    }
  }

  const interval = setInterval(collectGarbage, Math.min(idleTimeoutMs, 60_000));
  interval.unref?.();

  return {
    createSession,
    navigate,
    screenshot,
    click,
    doubleClick,
    type,
    keypress,
    scroll,
    wait,
    extractText,
    closeSession,
    getSessionCount: () => sessions.size,
  };
}
