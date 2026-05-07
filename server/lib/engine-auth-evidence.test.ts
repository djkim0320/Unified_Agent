import { describe, expect, it } from "vitest";
import type { EngineStatusRecord } from "../types.js";
import { computeEngineAuthEvidence } from "./engine-auth-evidence.js";

const baseStatus = {
  engineKind: "opencode",
  configuredEngineKind: "opencode",
  available: true,
  installed: true,
  version: "1.0.0",
  executable: "opencode",
  executableSource: "embedded-package",
  managedPackageVersion: "1.0.0",
  configDir: null,
  authStatus: "unknown",
  opencodeAuthProviders: [],
  credentialSync: {
    mode: "runtime-env",
    configuredProviders: [],
    entries: [],
  },
  models: [],
  sessions: [],
  lastFailure: null,
  environment: {
    autoUpdateDisabled: true,
    pruneDisabled: true,
    defaultPluginsDisabled: true,
    autoApprovePermissions: false,
  },
} satisfies EngineStatusRecord;

describe("engine auth evidence", () => {
  it("treats configured provider credentials as usable evidence", () => {
    const evidence = computeEngineAuthEvidence(baseStatus, {
      getProviderAccount: () => null,
      getProviderSecret: () => ({
        kind: "openai",
        configured: true,
        hasApiKey: true,
        baseUrl: null,
        updatedAt: Date.now(),
      }),
      getLatestSuccessfulWorkspaceRun: () => null,
    } as any);

    expect(evidence).toEqual(
      expect.objectContaining({
        status: "usable",
        source: "provider-secret",
      }),
    );
  });

  it("uses recent successful opencode runs as non-blocking auth evidence", () => {
    const completedAt = Date.now();
    const evidence = computeEngineAuthEvidence(baseStatus, {
      getProviderAccount: () => null,
      getProviderSecret: () => null,
      getLatestSuccessfulWorkspaceRun: () => ({
        id: "run-1",
        conversationId: "conversation-1",
        taskId: null,
        parentRunId: null,
        status: "completed",
        phase: "completed",
        providerKind: "openai",
        model: "gpt-5.4",
        userMessage: "hidden",
        checkpoint: null,
        resumeToken: null,
        createdAt: completedAt,
        updatedAt: completedAt,
      }),
    } as any);

    expect(evidence).toEqual(
      expect.objectContaining({
        status: "usable",
        source: "recent-successful-run",
        lastSuccessfulRunAt: completedAt,
      }),
    );
  });
});
