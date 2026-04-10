import { describe, expect, it, vi } from "vitest";
import { fetchWebPage } from "./web-fetch.js";

describe("fetchWebPage", () => {
  it("blocks localhost and private-network targets", async () => {
    const fetchImpl = vi.fn();

    await expect(
      fetchWebPage("http://127.0.0.1/internal", {
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toThrow(/blocked outbound/i);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects redirects into blocked targets", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(null, {
        status: 302,
        headers: {
          location: "http://127.0.0.1/private",
        },
      });
    });

    await expect(
      fetchWebPage("https://example.com/article", {
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toThrow(/blocked outbound/i);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("enforces fetch timeouts", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      await new Promise<never>((_, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason ?? new Error("aborted")),
          { once: true },
        );
      });
      throw new Error("unreachable");
    });

    await expect(
      fetchWebPage("https://example.com/slow", {
        fetchImpl: fetchImpl as typeof fetch,
        timeoutMs: 50,
      }),
    ).rejects.toThrow(/timed out/i);
  });

  it("caps extracted text length", async () => {
    const hugeBody = `<html><head><title>Test</title></head><body>${"word ".repeat(10_000)}</body></html>`;
    const fetchImpl = vi.fn(async () => new Response(hugeBody, { status: 200 }));

    const result = await fetchWebPage("https://example.com/huge", {
      fetchImpl: fetchImpl as typeof fetch,
      maxBytes: 1024,
      textLimit: 120,
    });

    expect(result.title).toBe("Test");
    expect(result.text.length).toBeLessThanOrEqual(120);
  });
});
