import { describe, expect, it, vi } from "vitest";
import { createBrowserRuntime } from "./browser-runtime.js";

function createFakePage(longText = "content") {
  let currentUrl = "about:blank";

  const locator = {
    first() {
      return this;
    },
    async innerText() {
      return longText;
    },
    async click() {
      return undefined;
    },
    async fill() {
      return undefined;
    },
    async press() {
      return undefined;
    },
  };

  return {
    async goto(url: string) {
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
      currentUrl = "about:blank";
      return null;
    },
  };
}

function createLaunchBrowserStub() {
  const closedContexts: string[] = [];
  const closedBrowsers: string[] = [];
  let browserCount = 0;

  const launchBrowser = vi.fn(async () => {
    browserCount += 1;
    const browserId = `browser-${browserCount}`;
    const page = createFakePage("x".repeat(8_000));
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
});
