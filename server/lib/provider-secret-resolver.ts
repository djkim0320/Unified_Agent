import { resolveCodexIdentity } from "./codex-auth.js";
import { refreshCodexSecret } from "../providers/openai-codex.js";
import type { createStore } from "../db.js";
import type { ProviderKind, ProviderSecret } from "../types.js";

export function createProviderSecretResolver(params: {
  store: ReturnType<typeof createStore>;
  fetchImpl: typeof fetch;
}) {
  return async function getSecret(kind: ProviderKind): Promise<ProviderSecret<ProviderKind> | null> {
    const secret = params.store.getProviderSecret(kind);
    if (kind !== "openai-codex" || !secret) {
      return secret;
    }

    const codexSecret = secret as ProviderSecret<"openai-codex">;
    const refreshed = await refreshCodexSecret(codexSecret, params.fetchImpl);
    if (JSON.stringify(refreshed) !== JSON.stringify(secret)) {
      const existingAccount = params.store.getProviderAccount(kind);
      const identity = resolveCodexIdentity({
        accessToken: refreshed.accessToken,
        idToken: refreshed.idToken ?? null,
        email: existingAccount?.email ?? null,
      });
      params.store.saveProviderConfiguration({
        kind,
        secret: refreshed,
        status: "connected",
        displayName: identity.profileName,
        email: identity.email,
        accountId: refreshed.chatgptAccountId ?? identity.accountId,
        metadata: {
          importedFromCli: Boolean(refreshed.importedFromCli),
        },
      });
    }
    return refreshed;
  };
}
