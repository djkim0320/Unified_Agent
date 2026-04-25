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
  last_refresh?: unknown;
  tokens?: {
    id_token?: unknown;
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
  token: string,
): CodexJwtPayload | null {
  const parts = token.split(".");
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

function resolveCodexWorkspaceIdFromPayload(payload: CodexJwtPayload | null) {
  return trimNonEmpty(payload?.["https://api.openai.com/auth"]?.chatgpt_account_id) ?? null;
}

export function resolveCodexWorkspaceId(accessToken: string, idToken?: string | null) {
  const idTokenPayload = idToken ? decodeCodexJwtPayload(idToken) : null;
  const idTokenAccountId = resolveCodexWorkspaceIdFromPayload(idTokenPayload);
  if (idTokenAccountId) {
    return idTokenAccountId;
  }

  const accessTokenPayload = decodeCodexJwtPayload(accessToken);
  return resolveCodexWorkspaceIdFromPayload(accessTokenPayload);
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
  idToken?: string | null;
  email?: string | null;
}) {
  const payload = decodeCodexJwtPayload(params.accessToken);
  const idTokenPayload = params.idToken
    ? decodeCodexJwtPayload(params.idToken)
    : null;
  const email =
    trimNonEmpty(payload?.["https://api.openai.com/profile"]?.email) ??
    trimNonEmpty(idTokenPayload?.["https://api.openai.com/profile"]?.email) ??
    trimNonEmpty(params.email);
  if (email) {
    return {
      email,
      profileName: email,
      accountId: resolveStableSubject(idTokenPayload) ?? resolveStableSubject(payload),
    };
  }

  const stableSubject =
    resolveStableSubject(idTokenPayload) ?? resolveStableSubject(payload);
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

function expandUserPath(input: string) {
  if (input === "~") {
    return os.homedir();
  }
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return path.resolve(input);
}

function uniquePaths(paths: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of paths) {
    if (!seen.has(candidate)) {
      seen.add(candidate);
      result.push(candidate);
    }
  }
  return result;
}

export function resolveCodexAuthFileCandidates(authFilePath?: string) {
  if (authFilePath?.trim()) {
    return [expandUserPath(authFilePath.trim())];
  }

  const chatgptLocalHome = process.env.CHATGPT_LOCAL_HOME?.trim();
  const codexHome = process.env.CODEX_HOME?.trim();
  return uniquePaths(
    [
      chatgptLocalHome
        ? path.join(expandUserPath(chatgptLocalHome), "auth.json")
        : undefined,
      codexHome ? path.join(expandUserPath(codexHome), "auth.json") : undefined,
      path.join(os.homedir(), ".chatgpt-local", "auth.json"),
      path.join(os.homedir(), ".codex", "auth.json"),
    ].filter((value): value is string => Boolean(value)),
  );
}

function parseCodexCliAuthFile(authPath: string) {
  const parsed = JSON.parse(fs.readFileSync(authPath, "utf8")) as CodexCliAuthFile;
  if (parsed.auth_mode !== "chatgpt") {
    throw new Error("Codex CLI is not logged in with ChatGPT");
  }

  const idToken = trimNonEmpty(parsed.tokens?.id_token);
  const accessToken = trimNonEmpty(parsed.tokens?.access_token);
  const refreshToken = trimNonEmpty(parsed.tokens?.refresh_token);
  const accountId =
    trimNonEmpty(parsed.tokens?.account_id) ??
    resolveCodexWorkspaceId(accessToken ?? "", idToken) ??
    resolveCodexIdentity({
      accessToken: accessToken ?? "",
      idToken,
    }).accountId;

  if (!accessToken || !refreshToken) {
    throw new Error("Codex auth.json is missing tokens");
  }

  return {
    accessToken,
    refreshToken,
    idToken,
    expiresAt: resolveCodexExpiry(accessToken),
    accountId: accountId ?? null,
    sourcePath: authPath,
    lastRefresh: trimNonEmpty(parsed.last_refresh) ?? null,
    authMode: "chatgpt" as const,
  };
}

export function importCodexCliAuth(options?: { authFilePath?: string }) {
  const candidates = resolveCodexAuthFileCandidates(options?.authFilePath);
  const errors: string[] = [];

  for (const authPath of candidates) {
    if (!fs.existsSync(authPath)) {
      continue;
    }

    try {
      return parseCodexCliAuthFile(authPath);
    } catch (error) {
      errors.push(
        `${authPath}: ${error instanceof Error ? error.message : "Failed to parse auth file"}`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(errors[0]);
  }

  throw new Error(
    `Codex auth file not found. Checked: ${candidates.join(", ")}`,
  );
}

export function writeCodexCliAuth(params: {
  authFilePath: string;
  accessToken: string;
  refreshToken: string;
  idToken?: string | null;
  accountId?: string | null;
  lastRefresh?: string | null;
}) {
  const authFilePath = expandUserPath(params.authFilePath);
  let existing: Record<string, unknown> = {};

  if (fs.existsSync(authFilePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(authFilePath, "utf8")) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }

  const existingTokens =
    typeof existing.tokens === "object" && existing.tokens !== null
      ? (existing.tokens as Record<string, unknown>)
      : {};

  const nextPayload: Record<string, unknown> = {
    ...existing,
    auth_mode: "chatgpt",
    last_refresh: params.lastRefresh ?? new Date().toISOString(),
    tokens: {
      ...existingTokens,
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
      account_id: params.accountId ?? existingTokens.account_id ?? null,
    },
  };

  if (params.idToken) {
    (nextPayload.tokens as Record<string, unknown>).id_token = params.idToken;
  }

  fs.mkdirSync(path.dirname(authFilePath), { recursive: true });
  fs.writeFileSync(authFilePath, `${JSON.stringify(nextPayload, null, 2)}\n`, "utf8");
}
