import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  importCodexCliAuth,
  resolveCodexAuthFileCandidates,
  writeCodexCliAuth,
} from "./codex-auth.js";

function createFakeJwt(payload: Record<string, unknown>) {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

describe("codex-auth helpers", () => {
  let tempDir: string;
  let previousCodexHome: string | undefined;
  let previousChatgptLocalHome: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-auth-"));
    previousCodexHome = process.env.CODEX_HOME;
    previousChatgptLocalHome = process.env.CHATGPT_LOCAL_HOME;
    delete process.env.CODEX_HOME;
    delete process.env.CHATGPT_LOCAL_HOME;
  });

  afterEach(() => {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    if (previousChatgptLocalHome === undefined) {
      delete process.env.CHATGPT_LOCAL_HOME;
    } else {
      process.env.CHATGPT_LOCAL_HOME = previousChatgptLocalHome;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("prefers CHATGPT_LOCAL_HOME and CODEX_HOME auth candidates before home-directory fallbacks", () => {
    const chatgptLocalHome = path.join(tempDir, "chatgpt-local");
    const codexHome = path.join(tempDir, "codex-home");
    process.env.CHATGPT_LOCAL_HOME = chatgptLocalHome;
    process.env.CODEX_HOME = codexHome;

    const candidates = resolveCodexAuthFileCandidates();
    expect(candidates[0]).toBe(path.join(chatgptLocalHome, "auth.json"));
    expect(candidates[1]).toBe(path.join(codexHome, "auth.json"));
    expect(candidates).toEqual(
      expect.arrayContaining([
        path.join(os.homedir(), ".chatgpt-local", "auth.json"),
        path.join(os.homedir(), ".codex", "auth.json"),
      ]),
    );
  });

  it("imports auth from CHATGPT_LOCAL_HOME and derives account metadata from id_token", () => {
    const chatgptLocalHome = path.join(tempDir, "chatgpt-local");
    fs.mkdirSync(chatgptLocalHome, { recursive: true });
    process.env.CHATGPT_LOCAL_HOME = chatgptLocalHome;

    const accessToken = createFakeJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const idToken = createFakeJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_from_id_token",
      },
      "https://api.openai.com/profile": {
        email: "chatgpt-local@example.com",
      },
    });
    const lastRefresh = "2026-04-22T10:00:00.000Z";

    fs.writeFileSync(
      path.join(chatgptLocalHome, "auth.json"),
      JSON.stringify({
        auth_mode: "chatgpt",
        last_refresh: lastRefresh,
        tokens: {
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "refresh-token",
        },
      }),
    );

    const imported = importCodexCliAuth();
    expect(imported).toEqual(
      expect.objectContaining({
        accessToken,
        refreshToken: "refresh-token",
        idToken,
        accountId: "acct_from_id_token",
        sourcePath: path.join(chatgptLocalHome, "auth.json"),
        lastRefresh,
      }),
    );
  });

  it("writes refreshed auth data back to disk without dropping unrelated fields", () => {
    const authFilePath = path.join(tempDir, "codex-home", "auth.json");
    fs.mkdirSync(path.dirname(authFilePath), { recursive: true });
    fs.writeFileSync(
      authFilePath,
      JSON.stringify({
        OPENAI_API_KEY: "keep-me",
        auth_mode: "chatgpt",
        tokens: {
          access_token: "old-access",
          refresh_token: "old-refresh",
          account_id: "acct-old",
        },
      }),
    );

    writeCodexCliAuth({
      authFilePath,
      accessToken: "new-access",
      refreshToken: "new-refresh",
      idToken: "new-id",
      accountId: "acct-new",
      lastRefresh: "2026-04-22T11:00:00.000Z",
    });

    const payload = JSON.parse(fs.readFileSync(authFilePath, "utf8")) as {
      OPENAI_API_KEY?: string;
      last_refresh?: string;
      tokens?: Record<string, string>;
    };
    expect(payload.OPENAI_API_KEY).toBe("keep-me");
    expect(payload.last_refresh).toBe("2026-04-22T11:00:00.000Z");
    expect(payload.tokens).toEqual(
      expect.objectContaining({
        access_token: "new-access",
        refresh_token: "new-refresh",
        id_token: "new-id",
        account_id: "acct-new",
      }),
    );
  });
});
