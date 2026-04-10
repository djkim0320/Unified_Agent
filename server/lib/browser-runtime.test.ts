import { describe, expect, it, vi } from "vitest";
import { createBrowserRuntime } from "./browser-runtime.js";

function neverSettles() {
  return new Promise<never>(() => undefined);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFakePage(
  longText = "content",
  overrides?: {
    goto?: (url: string) => Promise<unknown>;
    click?: () => Promise<unknown>;
    fill?: () => Promise<unknown>;
    press?: () => Promise<unknown>;
    goBack?: () => Promise<unknown>;
  },
) {
  let currentUrl = "about:blank";

  const locator = {
    first() {
      return this;
    },
    async innerText() {
      return longText;
    },
    async click() {
      if (overrides?.click) {
        await overrides.click();
        return;
      }
      return undefined;
    },
    async fill() {
      if (overrides?.fill) {
        await overrides.fill();
        return;
      }
      return undefined;
    },
    async press() {
      if (overrides?.press) {
        await overrides.press();
        return;
      }
      return undefined;
    },
  };

  return {
    async goto(url: string) {
      if (overrides?.goto) {
        await overrides.goto(url);
        return;
      }
      currentUrl = url;
    },
    async waitForTimeout() {
      return undefined;
    },
    async evaluate() {
      return [
        {
          title: "Example",
          url: currentUrl,
        },
      ];
    },
    async title() {
      return "Example";
    },
    url() {
      return currentUrl;
    },
    locator() {
      return locator;
    },
    async goBack() {
      if (overrides?.goBack) {
        await overrides.goBack();
        return null;
      }
      currentUrl = "about:blank";
      return null;
    },
  };
}

function createLaunchBrowserStub(pageFactory?: () => ReturnType<typeof createFakePage>) {
  const closedContexts: string[] = [];
  const closedBrowsers: string[] = [];
  let browserCount = 0;

  const launchBrowser = vi.fn(async () => {
    browserCount += 1;
    const browserId = `browser-${browserCount}`;
    const page = pageFactory?.() ?? createFakePage("x".repeat(8_000));
    const context = {
      async route() {
        return undefined;
      },
      async newPage() {
        return page as never;
      },
      async close() {
        closedContexts.push(browserId);
      },
    };

    return {
      async newContext() {
        return context as never;
      },
      async close() {
        closedBrowsers.push(browserId);
      },
    } as never;
  });

  return {
    launchBrowser,
    closedContexts,
    closedBrowsers,
  };
}

describe("browser runtime", () => {
  it("keeps sessions isolated by run and cleans them up by conversation", async () => {
    const stub = createLaunchBrowserStub();
    const runtime = createBrowserRuntime({
      launch: stub.launchBrowser as never,
      idleTimeoutMs: 60_000,
    });

    const first = await runtime.ensureSession({ sessionId: "run-1", conversationId: "conversation-a" });
    const reused = await runtime.ensureSession({ sessionId: "run-1", conversationId: "conversation-a" });
    const second = await runtime.ensureSession({ sessionId: "run-2", conversationId: "conversation-a" });

    expect(first).toBe(reused);
    expect(second).not.toBe(first);
    expect(stub.launchBrowser).toHaveBeenCalledTimes(2);

    await runtime.closeConversationSessions("conversation-a");
    expect(stub.closedContexts).toHaveLength(2);
    expect(stub.closedBrowsers).toHaveLength(2);
  });

  it("blocks unsafe outbound URLs before navigation", async () => {
    const stub = createLaunchBrowserStub();
    const runtime = createBrowserRuntime({
      launch: stub.launchBrowser as never,
      idleTimeoutMs: 60_000,
    });

    await expect(
      runtime.open({
        sessionId: "run-unsafe",
        conversationId: "conversation-a",
        url: "http://127.0.0.1/internal",
      }),
    ).rejects.toThrow(/blocked outbound/i);

    expect(stub.launchBrowser).not.toHaveBeenCalled();
  });

  it("bounds extracted text size", async () => {
    const stub = createLaunchBrowserStub();
    const runtime = createBrowserRuntime({
      launch: stub.launchBrowser as never,
      idleTimeoutMs: 60_000,
    });

    await runtime.open({
      sessionId: "run-extract",
      conversationId: "conversation-a",
      url: "https://example.com",
    });
    const extracted = await runtime.extract({
      sessionId: "run-extract",
      conversationId: "conversation-a",
    });

    expect(extracted.text.length).toBeLessThanOrEqual(6_000);
  });

  it("aborts a hung navigation promptly and closes only that run session", async () => {
    const stub = createLaunchBrowserStub(() =>
      createFakePage("content", {
        goto: async () => neverSettles(),
      }),
    );
    const runtime = createBrowserRuntime({
      launch: stub.launchBrowser as never,
      idleTimeoutMs: 60_000,
    });
    const controller = new AbortController();

    await runtime.ensureSession({ sessionId: "run-keep", conversationId: "conversation-a" });
    await runtime.ensureSession({ sessionId: "run-abort", conversationId: "conversation-a" });
    const pending = runtime.open({
      sessionId: "run-abort",
      conversationId: "conversation-a",
      url: "https://example.com",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error("stop navigation")), 20);

    const result = await Promise.race([
      pending.then(() => "resolved").catch((error: Error) => error),
      delay(1_000).then(() => "timeout"),
    ]);

    expect(result).toBeInstanceOf(Error);
    expect(String((result as Error).message)).toContain("stop navigation");
    expect(runtime.getSessionCount()).toBe(1);
    expect(stub.closedContexts).toHaveLength(1);
    expect(stub.closedBrowsers).toHaveLength(1);

    await runtime.closeSession("run-keep");
  });

  it("aborts hung click, type, and back actions by closing the run session", async () => {
    const cases = [
      {
        name: "click",
        page: () =>
          createFakePage("content", {
            click: async () => neverSettles(),
          }),
        run: (runtime: ReturnType<typeof createBrowserRuntime>, signal: AbortSignal) =>
          runtime.click({
            sessionId: "run-click",
            conversationId: "conversation-a",
            selector: "button",
            signal,
          }),
      },
      {
        name: "type",
        page: () =>
          createFakePage("content", {
            fill: async () => neverSettles(),
          }),
        run: (runtime: ReturnType<typeof createBrowserRuntime>, signal: AbortSignal) =>
          runtime.type({
            sessionId: "run-type",
            conversationId: "conversation-a",
            selector: "input",
            text: "hello",
            signal,
          }),
      },
      {
        name: "back",
        page: () =>
          createFakePage("content", {
            goBack: async () => neverSettles(),
          }),
        run: (runtime: ReturnType<typeof createBrowserRuntime>, signal: AbortSignal) =>
          runtime.back({
            sessionId: "run-back",
            conversationId: "conversation-a",
            signal,
          }),
      },
    ];

    for (const testCase of cases) {
      const stub = createLaunchBrowserStub(testCase.page);
      const runtime = createBrowserRuntime({
        launch: stub.launchBrowser as never,
        idleTimeoutMs: 60_000,
      });
      const controller = new AbortController();

      const pending = testCase.run(runtime, controller.signal);
      setTimeout(() => controller.abort(new Error(`stop ${testCase.name}`)), 20);

      const result = await Promise.race([
        pending.then(() => "resolved").catch((error: Error) => error),
        delay(1_000).then(() => "timeout"),
      ]);

      expect(result).toBeInstanceOf(Error);
      expect(String((result as Error).message)).toContain(`stop ${testCase.name}`);
      expect(runtime.getSessionCount()).toBe(0);
      expect(stub.closedContexts).toHaveLength(1);
      expect(stub.closedBrowsers).toHaveLength(1);
    }
  });
});
