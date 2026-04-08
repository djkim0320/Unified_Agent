import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadResearchProjects, selectResearchProject } from "./research.ts";

const runtimeMocks = vi.hoisted(() => ({
  refreshChat: vi.fn(async () => undefined),
}));

vi.mock("../app-chat.ts", () => ({
  refreshChat: runtimeMocks.refreshChat,
}));

function createState() {
  const applySettings = vi.fn();
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "research.projects.list") {
      return {
        defaultProjectId: "demo-airfoil",
        projects: [
          {
            id: "demo-airfoil",
            name: "Demo Airfoil Study",
            description: "Seed project",
            agentId: "main",
            workspacePath: "/tmp/demo",
            createdAt: 1,
            updatedAt: 2,
            latestActivityAt: 3,
          },
        ],
      };
    }
    if (method === "sessions.list") {
      return {
        ts: 1,
        count: 1,
        path: "/tmp/sessions.json",
        defaults: {},
        sessions: [
          {
            key: "agent:main:main",
            kind: "direct",
            updatedAt: 1,
            displayName: "Main Session",
          },
        ],
      };
    }
    throw new Error(`unexpected method: ${method} ${JSON.stringify(params ?? {})}`);
  });

  return {
    client: { request },
    connected: true,
    settings: {
      gatewayUrl: "ws://localhost:18789",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "claw" as const,
      themeMode: "system" as const,
      chatFocusMode: false,
      chatShowThinking: true,
      chatShowToolCalls: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navWidth: 220,
      navGroupsCollapsed: {},
      borderRadius: 50,
    },
    applySettings,
    tab: "overview" as const,
    sessionKey: "main",
    agentsList: { mainKey: "main", defaultId: "main", scope: "default", agents: [{ id: "main" }] },
    agentsSelectedId: null,
    researchProjectsLoading: false,
    researchProjectsError: null,
    researchProjects: [],
    researchProjectId: null,
    researchOverviewLoading: false,
    researchOverviewError: null,
    researchOverview: null,
    researchRunsLoading: false,
    researchRunsError: null,
    researchRuns: [],
    researchSelectedRunId: null,
    researchRunDetailLoading: false,
    researchRunDetailError: null,
    researchRunDetail: null,
    researchArtifactsLoading: false,
    researchArtifactsError: null,
    researchArtifacts: [],
    researchSelectedArtifactId: null,
    researchArtifactDetailLoading: false,
    researchArtifactDetailError: null,
    researchArtifactDetail: null,
    researchAddonsLoading: false,
    researchAddonsError: null,
    researchAddons: [],
    researchSessionsLoading: false,
    researchSessionsError: null,
    researchSessionsResult: null,
  };
}

describe("research controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads projects and persists the default project id", async () => {
    const state = createState();

    const projects = await loadResearchProjects(state as never);

    expect(projects).toHaveLength(1);
    expect(state.researchProjectId).toBe("demo-airfoil");
    expect(state.applySettings).toHaveBeenCalledWith(
      expect.objectContaining({
        researchProjectId: "demo-airfoil",
      }),
    );
  });

  it("selects a project, pins the mapped agent session, and loads project sessions", async () => {
    const state = createState();
    state.researchProjects = [
      {
        id: "demo-airfoil",
        name: "Demo Airfoil Study",
        description: "Seed project",
        agentId: "main",
        workspacePath: "/tmp/demo",
        createdAt: 1,
        updatedAt: 2,
        latestActivityAt: 3,
      },
    ];
    state.tab = "chat";

    await selectResearchProject(state as never, "demo-airfoil");

    expect(state.researchProjectId).toBe("demo-airfoil");
    expect(state.agentsSelectedId).toBe("main");
    expect(state.sessionKey).toBe("agent:main:main");
    expect(state.researchSessionsResult?.sessions?.[0]?.key).toBe("agent:main:main");
    expect(runtimeMocks.refreshChat).toHaveBeenCalledTimes(1);
  });
});
