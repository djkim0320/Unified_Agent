import { getProviderModelCapabilities } from "./provider-capabilities.js";
import { getProviderAdapter } from "../provider-registry.js";
import type { createStore } from "../db.js";
import type { ProviderKind, ProviderSummary } from "../types.js";

export function formatProviderSummary(params: {
  kind: ProviderKind;
  label: string;
  configured: boolean;
  status: ProviderSummary["status"];
  displayName?: string | null;
  email?: string | null;
  accountId?: string | null;
  metadata?: Record<string, unknown>;
}): ProviderSummary {
  return {
    kind: params.kind,
    label: params.label,
    configured: params.configured,
    status: params.status,
    displayName: params.displayName ?? null,
    email: params.email ?? null,
    accountId: params.accountId ?? null,
    metadata: params.metadata ?? {},
    capabilities: getProviderModelCapabilities(params.kind, getProviderAdapter(params.kind).defaultModel),
  };
}

export function getProviderSummary(store: ReturnType<typeof createStore>, kind: ProviderKind): ProviderSummary {
  const adapter = getProviderAdapter(kind);
  const account = store.getProviderAccount(kind);
  const secret = store.getProviderSecret(kind);
  return formatProviderSummary({
    kind,
    label: adapter.label,
    configured: Boolean(secret),
    status: account?.status ?? "disconnected",
    displayName: account?.displayName,
    email: account?.email,
    accountId: account?.accountId,
    metadata: account?.metadata ?? {},
  });
}
