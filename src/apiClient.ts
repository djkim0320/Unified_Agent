declare global {
  // Optional bootstrap hook for production HTML, tests, or local shells that already know the token.
  // The normal browser path still falls back to GET /api/local-api-token.
  // eslint-disable-next-line no-var
  var __LOCAL_API_TOKEN__: string | undefined;
}

export async function readJsonOrThrow<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(text);
    }
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as { error?: unknown }).error === "string"
        ? ((payload as { error: string }).error ?? `Request failed (${response.status})`)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload as T;
}

let localApiTokenPromise: Promise<string> | null = null;

function isUnsafeMethod(method: string | undefined) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes((method ?? "GET").toUpperCase());
}

async function getLocalApiToken() {
  if (globalThis.__LOCAL_API_TOKEN__) {
    return globalThis.__LOCAL_API_TOKEN__;
  }

  if (!localApiTokenPromise) {
    localApiTokenPromise = fetch("/api/local-api-token", {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    })
      .then((response) => readJsonOrThrow<{ token: string }>(response))
      .then((payload) => payload.token)
      .catch((error) => {
        localApiTokenPromise = null;
        throw error;
      });
  }
  return localApiTokenPromise;
}

export async function buildHeaders(init?: RequestInit) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const providedHeaders = new Headers(init?.headers);
  providedHeaders.forEach((value, key) => {
    headers[key] = value;
  });

  if (isUnsafeMethod(init?.method)) {
    headers["X-Local-API-Token"] = await getLocalApiToken();
  }

  return headers;
}

export async function apiRequest<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: await buildHeaders(init),
  });
  return readJsonOrThrow<T>(response);
}

export {};
