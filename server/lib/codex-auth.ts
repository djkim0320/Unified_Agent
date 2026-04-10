import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type CodexJwtPayload = {
  exp?: unknown;
  iss?: unknown;
  sub?: unknown;
  "https://api.openai.com/profile"?: {
    email?: unknown;
  };
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: unknown;
    chatgpt_account_user_id?: unknown;
    chatgpt_user_id?: unknown;
    user_id?: unknown;
  };
};

type CodexCliAuthFile = {
  auth_mode?: unknown;
  tokens?: {
    access_token?: unknown;
    refresh_token?: unknown;
    account_id?: unknown;
  };
};

function trimNonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function decodeCodexJwtPayload(
  accessToken: string,
): CodexJwtPayload | null {
  const parts = accessToken.split(".");
  if (parts.length !== 3) {
    return null;
  }

  try {
    return JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as CodexJwtPayload;
  } catch {
    return null;
  }
}

function resolveStableSubject(payload: CodexJwtPayload | null): string | null {
  const auth = payload?.["https://api.openai.com/auth"];
  const accountId = trimNonEmpty(auth?.chatgpt_account_id);
  if (accountId) {
    return accountId;
  }
  const accountUserId = trimNonEmpty(auth?.chatgpt_account_user_id);
  if (accountUserId) {
    return accountUserId;
  }
  const userId = trimNonEmpty(auth?.chatgpt_user_id) ?? trimNonEmpty(auth?.user_id);
  if (userId) {
    return userId;
  }
  const iss = trimNonEmpty(payload?.iss);
  const sub = trimNonEmpty(payload?.sub);
  if (iss && sub) {
    return `${iss}|${sub}`;
  }
  return sub ?? null;
}

export function resolveCodexWorkspaceId(accessToken: string) {
  const payload = decodeCodexJwtPayload(accessToken);
  return trimNonEmpty(payload?.["https://api.openai.com/auth"]?.chatgpt_account_id) ?? null;
}

export function resolveCodexExpiry(accessToken: string): number | null {
  const payload = decodeCodexJwtPayload(accessToken);
  const exp =
    typeof payload?.exp === "number"
      ? payload.exp
      : typeof payload?.exp === "string"
        ? Number(payload.exp)
        : NaN;
  return Number.isFinite(exp) && exp > 0 ? Math.trunc(exp * 1000) : null;
}

export function resolveCodexIdentity(params: {
  accessToken: string;
  email?: string | null;
}) {
  const payload = decodeCodexJwtPayload(params.accessToken);
  const email =
    trimNonEmpty(payload?.["https://api.openai.com/profile"]?.email) ??
    trimNonEmpty(params.email);
  if (email) {
    return {
      email,
      profileName: email,
      accountId: resolveStableSubject(payload),
    };
  }

  const stableSubject = resolveStableSubject(payload);
  if (!stableSubject) {
    return {
      email: null,
      profileName: "연결된 ChatGPT 계정",
      accountId: null,
    };
  }

  return {
    email: null,
    profileName: `id-${Buffer.from(stableSubject).toString("base64url")}`,
    accountId: stableSubject,
  };
}

function resolveCodexHome() {
  const configured = process.env.CODEX_HOME?.trim();
  if (!configured) {
    return path.join(os.homedir(), ".codex");
  }
  if (configured === "~") {
    return os.homedir();
  }
  if (configured.startsWith("~/")) {
    return path.join(os.homedir(), configured.slice(2));
  }
  return path.resolve(configured);
}

export function importCodexCliAuth() {
  const authPath = path.join(resolveCodexHome(), "auth.json");
  if (!fs.existsSync(authPath)) {
    throw new Error(`Codex auth file not found at ${authPath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(authPath, "utf8")) as CodexCliAuthFile;
  if (parsed.auth_mode !== "chatgpt") {
    throw new Error("Codex CLI is not logged in with ChatGPT");
  }

  const accessToken = trimNonEmpty(parsed.tokens?.access_token);
  const refreshToken = trimNonEmpty(parsed.tokens?.refresh_token);
  const accountId =
    trimNonEmpty(parsed.tokens?.account_id) ??
    resolveCodexWorkspaceId(accessToken ?? "") ??
    resolveCodexIdentity({ accessToken: accessToken ?? "" }).accountId;

  if (!accessToken || !refreshToken) {
    throw new Error("Codex auth.json is missing tokens");
  }

  return {
    accessToken,
    refreshToken,
    expiresAt: resolveCodexExpiry(accessToken),
    accountId: accountId ?? null,
    path: authPath,
  };
}
