import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../protocol/index.js";
import { researchHandlers } from "./research.js";

const runtimeMocks = vi.hoisted(() => ({
  buildResearchAddonStatuses: vi.fn(() => []),
  isResearchAddonId: vi.fn((value: string) => value === "mock_cfd"),
  updateProjectAddonState: vi.fn(async () => ({
    id: "demo-airfoil",
    enabledAddons: ["mock_cfd"],
  })),
  listResearchArtifacts: vi.fn(async () => []),
  resolveArtifactFile: vi.fn(async () => null),
  getResearchProject: vi.fn(async (projectId: string) =>
    projectId === "demo-airfoil"
      ? {
          id: "demo-airfoil",
          name: "Demo Airfoil Study",
          description: "Seed project",
          agentId: "main",
          workspacePath: "/tmp/demo",
          createdAt: 1,
          updatedAt: 2,
          enabledAddons: ["mock_cfd"],
        }
      : null,
  ),
  getResearchProjectWithOverview: vi.fn(async () => null),
  listResearchProjects: vi.fn(async () => ({
    ts: 123,
    defaultProjectId: "demo-airfoil",
    projects: [{ id: "demo-airfoil", name: "Demo Airfoil Study" }],
  })),
  patchResearchProject: vi.fn(async ({ projectId, patch }: { projectId: string; patch: unknown }) => ({
    id: projectId,
    ...(patch as object),
  })),
  cancelResearchRun: vi.fn(async () => ({ found: true, cancelled: false })),
  getResearchRun: vi.fn(async () => null),
  listResearchRuns: vi.fn(async () => []),
  readTextSnippet: vi.fn(async () => null),
}));

vi.mock("../../research/addons.js", () => ({
  buildResearchAddonStatuses: runtimeMocks.buildResearchAddonStatuses,
  isResearchAddonId: runtimeMocks.isResearchAddonId,
  updateProjectAddonState: runtimeMocks.updateProjectAddonState,
}));

vi.mock("../../research/artifacts.js", () => ({
  listResearchArtifacts: runtimeMocks.listResearchArtifacts,
  resolveArtifactFile: runtimeMocks.resolveArtifactFile,
}));

vi.mock("../../research/projects.js", () => ({
  getResearchProject: runtimeMocks.getResearchProject,
  getResearchProjectWithOverview: runtimeMocks.getResearchProjectWithOverview,
  listResearchProjects: runtimeMocks.listResearchProjects,
  patchResearchProject: runtimeMocks.patchResearchProject,
}));

vi.mock("../../research/runs.js", () => ({
  cancelResearchRun: runtimeMocks.cancelResearchRun,
  getResearchRun: runtimeMocks.getResearchRun,
  listResearchRuns: runtimeMocks.listResearchRuns,
}));

vi.mock("../../research/fs.js", () => ({
  readTextSnippet: runtimeMocks.readTextSnippet,
}));

type RespondCall = [boolean, unknown?, { code: number; message: string }?];

function createInvokeParams(method: keyof typeof researchHandlers, params: Record<string, unknown>) {
  const respond = vi.fn();
  return {
    respond,
    invoke: async () =>
      await researchHandlers[method]({
        params,
        respond: respond as never,
        context: {} as never,
        client: null,
        req: { type: "req", id: "req-1", method },
        isWebchatConnect: () => false,
      }),
  };
}

describe("research handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists projects", async () => {
    const { respond, invoke } = createInvokeParams("research.projects.list", {});
    await invoke();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toMatchObject({
      defaultProjectId: "demo-airfoil",
      projects: [{ id: "demo-airfoil" }],
    });
  });

  it("rejects unknown add-ons on patch", async () => {
    const { respond, invoke } = createInvokeParams("research.addons.patch", {
      projectId: "demo-airfoil",
      addonId: "unknown_addon",
      enabled: true,
    });
    await invoke();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.code).toBe(ErrorCodes.INVALID_REQUEST);
    expect(call?.[2]?.message).toContain("unknown addon");
  });

  it("patches project metadata", async () => {
    const { respond, invoke } = createInvokeParams("research.projects.patch", {
      projectId: "demo-airfoil",
      patch: { name: "Updated Project", description: "Updated description" },
    });
    await invoke();
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toMatchObject({
      id: "demo-airfoil",
      name: "Updated Project",
      description: "Updated description",
    });
  });
});
