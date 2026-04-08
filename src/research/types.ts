export type ResearchAddonId = "mock_cfd" | "mock_concept" | "mock_cad";

export type ResearchProjectPreferences = {
  approvalPolicy?: "ask" | "auto";
  notes?: string;
};

export type ResearchProjectManifest = {
  id: string;
  name: string;
  description: string;
  agentId: string;
  workspacePath: string;
  createdAt: number;
  updatedAt: number;
  enabledAddons: ResearchAddonId[];
  defaultModel?: string | null;
  defaultProvider?: string | null;
  preferences?: ResearchProjectPreferences;
};

export type ResearchProject = ResearchProjectManifest & {
  latestActivityAt: number | null;
};

export type ResearchAddonDefinition = {
  id: ResearchAddonId;
  name: string;
  version: string;
  description: string;
  tools: string[];
  permissions: string[];
  skillDirName: string;
  isMock: boolean;
};

export type ResearchAddonStatus = ResearchAddonDefinition & {
  enabled: boolean;
  health: "ready" | "disabled";
};

export type ResearchArtifactPreview = {
  kind: "text" | "json" | "csv" | "markdown" | "image" | "step" | "unknown";
  excerpt?: string;
};

export type ResearchArtifactRecord = {
  artifactId: string;
  projectId: string;
  runId: string;
  addonId: ResearchAddonId;
  name: string;
  type: string;
  path: string;
  createdAt: number;
  preview?: ResearchArtifactPreview;
};

export type ResearchRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "lost";

export type ResearchRunRecord = {
  runId: string;
  taskId?: string | null;
  projectId: string;
  agentId: string;
  addonId: ResearchAddonId;
  status: ResearchRunStatus;
  startedAt: number;
  endedAt?: number | null;
  progressSummary?: string | null;
  terminalSummary?: string | null;
  logPath?: string | null;
  artifactIds: string[];
  structuredOutputSummary?: Record<string, unknown> | null;
  sessionKey?: string | null;
  summary?: string | null;
  cancelSupported?: boolean;
};

export type ResearchOverview = {
  latestActivityAt: number | null;
  recentSessions: Array<{
    key: string;
    displayName?: string;
    updatedAt: number | null;
    status?: string;
    model?: string;
  }>;
  recentRuns: ResearchRunRecord[];
  recentArtifacts: ResearchArtifactRecord[];
  enabledAddons: ResearchAddonStatus[];
};

export type ResearchProjectsListResult = {
  ts: number;
  defaultProjectId: string | null;
  projects: ResearchProject[];
};

export type ResearchProjectGetResult = {
  project: ResearchProject;
  overview: ResearchOverview;
};

export type ResearchRunsListResult = {
  projectId: string;
  runs: ResearchRunRecord[];
};

export type ResearchArtifactsListResult = {
  projectId: string;
  artifacts: ResearchArtifactRecord[];
};

export type ResearchAddonsListResult = {
  projectId: string;
  addons: ResearchAddonStatus[];
};
