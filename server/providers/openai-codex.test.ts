import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshCodexSecret } from "./openai-codex.js";

function createFakeJwt(payload: Record<string, unknown>) {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

describe("openai-codex provider auth refresh", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of tempDirs) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("writes refreshed imported CLI tokens back to the source auth.json file", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openai-codex-refresh-"));
    tempDirs.push(tempDir);
    const authFilePath = path.join(tempDir, "auth.json");

    fs.writeFileSync(
      authFilePath,
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: "old-access",
          refresh_token: "old-refresh",
          account_id: "acct-old",
        },
      }),
    );

    const refreshedAccessToken = createFakeJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct-refreshed",
      },
    });
    const refreshedIdToken = createFakeJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct-refreshed",
      },
    });

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: refreshedAccessToken,
          refresh_token: "refresh-updated",
          id_token: refreshedIdToken,
          expires_in: 3600,
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const refreshed = await refreshCodexSecret(
      {
        accessToken: "stale-access",
        refreshToken: "stale-refresh",
        expiresAt: Date.now() - 1_000,
        chatgptAccountId: "acct-old",
        importedFromCli: true,
        sourcePath: authFilePath,
        lastRefresh: "2026-04-22T08:00:00.000Z",
      },
      fetchMock as typeof fetch,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshed).toEqual(
      expect.objectContaining({
        accessToken: refreshedAccessToken,
        refreshToken: "refresh-updated",
        idToken: refreshedIdToken,
        chatgptAccountId: "acct-refreshed",
        importedFromCli: true,
        sourcePath: authFilePath,
      }),
    );

    const persisted = JSON.parse(fs.readFileSync(authFilePath, "utf8")) as {
      tokens?: Record<string, string>;
      last_refresh?: string;
    };
    expect(persisted.tokens).toEqual(
      expect.objectContaining({
        access_token: refreshedAccessToken,
        refresh_token: "refresh-updated",
        id_token: refreshedIdToken,
        account_id: "acct-refreshed",
      }),
    );
    expect(typeof persisted.last_refresh).toBe("string");
  });

  it("reuses a still-valid access token even when stored expiresAt is stale", async () => {
    const validAccessToken = createFakeJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct-current",
      },
    });

    const fetchMock = vi.fn();

    const refreshed = await refreshCodexSecret(
      {
        accessToken: validAccessToken,
        refreshToken: "refresh-still-present",
        expiresAt: Date.now() - 1_000,
        chatgptAccountId: "acct-current",
        importedFromCli: true,
        sourcePath: null,
        lastRefresh: "2026-04-22T08:00:00.000Z",
      },
      fetchMock as unknown as typeof fetch,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(refreshed).toEqual(
      expect.objectContaining({
        accessToken: validAccessToken,
        refreshToken: "refresh-still-present",
      }),
    );
  });
});
