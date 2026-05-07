import {
  buildOpenCodeCredentialSync,
  mergeOpenCodeConfigContent,
} from "../opencode-credentials.js";
import { configuredOpenCodeConfigDir } from "../opencode-launcher.js";
import { createSanitizedEnvironment } from "../process-control.js";
import type { AgentEngineStore } from "../agent-engine.js";
import type { ProviderKind, ProviderSecret } from "../../types.js";

function readProviderSecrets(store: AgentEngineStore) {
  const secrets: Partial<Record<ProviderKind, ProviderSecret<ProviderKind> | null>> = {};
  if (!store.getProviderSecret) {
    return secrets;
  }

  for (const kind of ["openai", "anthropic", "gemini", "ollama", "openai-codex"] as ProviderKind[]) {
    secrets[kind] = store.getProviderSecret(kind) as ProviderSecret<ProviderKind> | null;
  }
  return secrets;
}

export function buildCredentialSync(params: {
  store: AgentEngineStore;
  selectedProviderKind?: ProviderKind | null;
  selectedModel?: string | null;
}) {
  return buildOpenCodeCredentialSync({
    secrets: readProviderSecrets(params.store),
    selectedProviderKind: params.selectedProviderKind,
    selectedModel: params.selectedModel,
  });
}

export function buildOpenCodeEnvironment(params?: {
  overrides?: NodeJS.ProcessEnv;
  credentialSync?: ReturnType<typeof buildOpenCodeCredentialSync>;
}) {
  const configDir = configuredOpenCodeConfigDir();
  const credentialSync = params?.credentialSync;
  const configContent = credentialSync
    ? mergeOpenCodeConfigContent(process.env.OPENCODE_CONFIG_CONTENT, credentialSync.config)
    : process.env.OPENCODE_CONFIG_CONTENT;
  return createSanitizedEnvironment({
    OPENCODE_DISABLE_AUTOUPDATE: process.env.OPENCODE_DISABLE_AUTOUPDATE ?? "true",
    OPENCODE_DISABLE_PRUNE: process.env.OPENCODE_DISABLE_PRUNE ?? "true",
    OPENCODE_DISABLE_DEFAULT_PLUGINS:
      process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS ?? "true",
    ...(configContent ? { OPENCODE_CONFIG_CONTENT: configContent } : {}),
    ...(process.env.OPENCODE_SERVER_PASSWORD
      ? { OPENCODE_SERVER_PASSWORD: process.env.OPENCODE_SERVER_PASSWORD }
      : {}),
    ...(configDir ? { OPENCODE_CONFIG_DIR: configDir } : {}),
    ...(credentialSync?.env ?? {}),
    ...(params?.overrides ?? {}),
  });
}

function isEnabledEnvFlag(value: string | undefined) {
  return value ? /^(1|true|yes|on)$/i.test(value.trim()) : false;
}

export function shouldAutoApproveOpenCodePermissions(env: NodeJS.ProcessEnv = process.env) {
  return (
    isEnabledEnvFlag(env.AETHEROPS_OPENCODE_AUTO_APPROVE) ||
    isEnabledEnvFlag(env.AETHEROPS_OPENCODE_DANGEROUS_SKIP_PERMISSIONS)
  );
}
