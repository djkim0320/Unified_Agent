import path from "node:path";
import {
  listAgentsForGateway,
  loadCombinedSessionStoreForGateway,
  listSessionsFromStore,
} from "../gateway/session-utils.js";
import { loadConfig } from "../config/config.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { normalizeOptionalString } from "../shared/string-coerce.js";
import {
  buildResearchAddonStatuses,
  getEnabledResearchAddonIds,
  readProjectManifestFromWorkspace,
  syncResearchSkillsToWorkspace,
} from "./addons.js";
import { listResearchArtifacts } from "./artifacts.js";
import { writeJsonFile } from "./fs.js";
import { ensureResearchLayout, resolveProjectManifestPath } from "./paths.js";
import { listResearchRuns } from "./runs.js";
import type {
  ResearchOverview,
  ResearchProject,
  ResearchProjectGetResult,
  ResearchProjectManifest,
  ResearchProjectsListResult,
} from "./types.js";

function titleCaseId(agentId: string): string {
  return agentId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(" ");
}

function buildDefaultManifest(params: {
  agent: { id: string; name?: string; identity?: { name?: string }; workspace?: string };
  isPrimary: boolean;
}): ResearchProjectManifest {
  const now = Date.now();
  const agentId = normalizeAgentId(params.agent.id);
  const workspacePath = path.resolve(params.agent.workspace ?? "");
  const fallbackName = params.isPrimary ? "Demo Airfoil Study" : titleCaseId(agentId);
  return {
    id: agentId,
    name:
      normalizeOptionalString(params.agent.name) ??
      normalizeOptionalString(params.agent.identity?.name) ??
      fallbackName,
    description: params.isPrimary
      ? "Seeded aerospace research workspace for Stage 1 aerodynamic studies."
      : `Research workspace mapped to OpenClaw agent "${agentId}".`,
    agentId,
    workspacePath,
    createdAt: now,
    updatedAt: now,
    enabledAddons: ["mock_cfd", "mock_concept", "mock_cad"],
    preferences: {
      approvalPolicy: "ask",
    },
  };
}

async function ensureManifestForAgent(params: {
  agent: { id: string; name?: string; identity?: { name?: string }; workspace?: string };
  isPrimary: boolean;
}): Promise<ResearchProjectManifest> {
  const workspacePath = path.resolve(params.agent.workspace ?? "");
  await ensureResearchLayout(workspacePath);
  const manifestPath = resolveProjectManifestPath(workspacePath);
  const existing = await readProjectManifestFromWorkspace(workspacePath);
  if (existing) {
    const defaults = buildDefaultManifest(params);
    const nextManifest: ResearchProjectManifest = {
      ...existing,
      id: normalizeAgentId(existing.id || params.agent.id),
      agentId: normalizeAgentId(params.agent.id),
      workspacePath,
      name: existing.name || defaults.name,
      description: existing.description || defaults.description,
      enabledAddons: getEnabledResearchAddonIds(existing),
    };
    if (JSON.stringify(existing) !== JSON.stringify(nextManifest)) {
      await writeJsonFile(manifestPath, nextManifest);
    }
    await syncResearchSkillsToWorkspace(workspacePath, nextManifest.enabledAddons);
    return nextManifest;
  }
  const created = buildDefaultManifest(params);
  await writeJsonFile(manifestPath, created);
  await syncResearchSkillsToWorkspace(workspacePath, created.enabledAddons);
  return created;
}

export async function listResearchProjects(): Promise<ResearchProjectsListResult> {
  const cfg = loadConfig();
  const agents = listAgentsForGateway(cfg);
  const projects: ResearchProject[] = [];
  for (const [index, agent] of agents.agents.entries()) {
    const project = await ensureManifestForAgent({
      agent,
      isPrimary: index === 0 || agent.id === agents.defaultId,
    });
    projects.push({
      ...project,
      latestActivityAt: null,
    });
  }
  return {
    ts: Date.now(),
    defaultProjectId: projects[0]?.id ?? null,
    projects,
  };
}

export async function getResearchProject(projectId: string): Promise<ResearchProjectManifest | null> {
  const listed = await listResearchProjects();
  const found = listed.projects.find((project) => project.id === normalizeAgentId(projectId));
  return found
    ? {
        ...found,
      }
    : null;
}

export async function patchResearchProject(params: {
  projectId: string;
  patch: Partial<
    Pick<
      ResearchProjectManifest,
      "name" | "description" | "defaultModel" | "defaultProvider" | "preferences"
    >
  >;
}): Promise<ResearchProjectManifest> {
  const project = await getResearchProject(params.projectId);
  if (!project) {
    throw new Error(`Project not found: ${params.projectId}`);
  }
  const next: ResearchProjectManifest = {
    ...project,
    ...params.patch,
    updatedAt: Date.now(),
  };
  await writeJsonFile(resolveProjectManifestPath(project.workspacePath), next);
  return next;
}

export async function buildResearchOverview(
  project: ResearchProjectManifest,
): Promise<ResearchOverview> {
  const cfg = loadConfig();
  const { storePath, store } = loadCombinedSessionStoreForGateway(cfg);
  const recentSessions = listSessionsFromStore({
    cfg,
    storePath,
    store,
    opts: {
      agentId: project.agentId,
      includeDerivedTitles: true,
      includeLastMessage: false,
      limit: 5,
    },
  }).sessions.map((session) => ({
    key: session.key,
    displayName: session.displayName ?? session.derivedTitle ?? session.key,
    updatedAt: session.updatedAt,
    status: session.status,
    model: session.model,
  }));
  const recentRuns = (await listResearchRuns({ project })).slice(0, 5);
  const recentArtifacts = (await listResearchArtifacts({ project })).slice(0, 6);
  const enabledAddons = buildResearchAddonStatuses(project).filter((addon) => addon.enabled);
  const latestActivityAt = [project.updatedAt]
    .concat(recentSessions.map((entry) => entry.updatedAt ?? 0))
    .concat(recentRuns.map((entry) => entry.endedAt ?? entry.startedAt))
    .concat(recentArtifacts.map((entry) => entry.createdAt))
    .reduce((latest, value) => (value > latest ? value : latest), 0);
  return {
    latestActivityAt: latestActivityAt > 0 ? latestActivityAt : null,
    recentSessions,
    recentRuns,
    recentArtifacts,
    enabledAddons,
  };
}

export async function getResearchProjectWithOverview(
  projectId: string,
): Promise<ResearchProjectGetResult | null> {
  const project = await getResearchProject(projectId);
  if (!project) {
    return null;
  }
  const overview = await buildResearchOverview(project);
  return {
    project: {
      ...project,
      latestActivityAt: overview.latestActivityAt,
    },
    overview,
  };
}
