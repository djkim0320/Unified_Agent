import type { OpenClawApp } from "../app.ts";
import { refreshChat } from "../app-chat.ts";
import { buildAgentMainSessionKey, resolveAgentIdFromSessionKey } from "../session-key.ts";
import type {
  ResearchAddonStatus,
  ResearchArtifactRecord,
  ResearchOverview,
  ResearchProject,
  ResearchRunRecord,
  SessionsListResult,
} from "../types.ts";

function sortProjects(projects: ResearchProject[]): ResearchProject[] {
  return [...projects].sort((a, b) => {
    const aTime = a.latestActivityAt ?? a.updatedAt;
    const bTime = b.latestActivityAt ?? b.updatedAt;
    return bTime - aTime;
  });
}

export function getCurrentResearchProject(host: OpenClawApp): ResearchProject | null {
  const projectId = host.researchProjectId;
  if (!projectId) {
    return host.researchProjects[0] ?? null;
  }
  return host.researchProjects.find((project) => project.id === projectId) ?? host.researchProjects[0] ?? null;
}

async function loadProjectSessions(host: OpenClawApp, agentId: string): Promise<SessionsListResult | null> {
  if (!host.client || !host.connected) {
    return null;
  }
  return await host.client.request<SessionsListResult>("sessions.list", {
    agentId,
    includeDerivedTitles: true,
    limit: 120,
  });
}

export async function loadResearchProjects(host: OpenClawApp): Promise<ResearchProject[]> {
  if (!host.client || !host.connected) {
    return [];
  }
  host.researchProjectsLoading = true;
  host.researchProjectsError = null;
  try {
    const res = await host.client.request<{ projects?: ResearchProject[]; defaultProjectId?: string | null }>(
      "research.projects.list",
      {},
    );
    const projects = sortProjects(Array.isArray(res.projects) ? res.projects : []);
    host.researchProjects = projects;
    const resolvedProjectId =
      (host.researchProjectId && projects.some((project) => project.id === host.researchProjectId)
        ? host.researchProjectId
        : null) ??
      (host.settings.researchProjectId &&
      projects.some((project) => project.id === host.settings.researchProjectId)
        ? host.settings.researchProjectId
        : null) ??
      res.defaultProjectId ??
      projects[0]?.id ??
      null;
    host.researchProjectId = resolvedProjectId;
    if (resolvedProjectId && resolvedProjectId !== host.settings.researchProjectId) {
      host.applySettings({
        ...host.settings,
        researchProjectId: resolvedProjectId,
      });
    }
    return projects;
  } catch (error) {
    host.researchProjectsError = error instanceof Error ? error.message : String(error);
    return [];
  } finally {
    host.researchProjectsLoading = false;
  }
}

export async function selectResearchProject(
  host: OpenClawApp,
  projectId: string,
  opts?: { keepSession?: boolean },
): Promise<void> {
  const project =
    host.researchProjects.find((entry) => entry.id === projectId) ??
    (await loadResearchProjects(host)).find((entry) => entry.id === projectId);
  if (!project) {
    return;
  }
  host.researchProjectId = project.id;
  host.agentsSelectedId = project.agentId;
  host.researchSelectedRunId = null;
  host.researchRunDetail = null;
  host.researchRunDetailError = null;
  host.researchSelectedArtifactId = null;
  host.researchArtifactDetail = null;
  host.researchArtifactDetailError = null;
  const sameAgent = resolveAgentIdFromSessionKey(host.sessionKey) === project.agentId;
  const nextSessionKey =
    opts?.keepSession && sameAgent
      ? host.sessionKey
      : buildAgentMainSessionKey({
          agentId: project.agentId,
          mainKey: host.agentsList?.mainKey,
        });
  host.sessionKey = nextSessionKey;
  host.applySettings({
    ...host.settings,
    researchProjectId: project.id,
    sessionKey: nextSessionKey,
    lastActiveSessionKey: nextSessionKey,
  });
  host.researchSessionsResult = await loadProjectSessions(host, project.agentId);
  if (host.tab === "chat") {
    await refreshChat(host);
  }
}

export async function loadResearchOverview(host: OpenClawApp): Promise<ResearchOverview | null> {
  const project = getCurrentResearchProject(host) ?? (await loadResearchProjects(host))[0] ?? null;
  if (!project || !host.client || !host.connected) {
    return null;
  }
  host.researchOverviewLoading = true;
  host.researchOverviewError = null;
  try {
    const res = await host.client.request<{ project?: ResearchProject; overview?: ResearchOverview }>(
      "research.projects.get",
      { projectId: project.id },
    );
    const overview = res.overview ?? null;
    host.researchOverview = overview;
    if (res.project) {
      host.researchProjects = sortProjects(
        host.researchProjects.map((entry) => (entry.id === res.project?.id ? res.project : entry)),
      );
    }
    return overview;
  } catch (error) {
    host.researchOverviewError = error instanceof Error ? error.message : String(error);
    return null;
  } finally {
    host.researchOverviewLoading = false;
  }
}

export async function loadResearchRuns(host: OpenClawApp): Promise<ResearchRunRecord[]> {
  const project = getCurrentResearchProject(host);
  if (!project || !host.client || !host.connected) {
    return [];
  }
  host.researchRunsLoading = true;
  host.researchRunsError = null;
  try {
    const res = await host.client.request<{ runs?: ResearchRunRecord[] }>("research.runs.list", {
      projectId: project.id,
    });
    host.researchRuns = Array.isArray(res.runs) ? res.runs : [];
    const selectedRunId =
      host.researchSelectedRunId &&
      host.researchRuns.some((run) => run.runId === host.researchSelectedRunId)
        ? host.researchSelectedRunId
        : host.researchRuns[0]?.runId ?? null;
    host.researchSelectedRunId = selectedRunId;
    if (selectedRunId) {
      await loadResearchRunDetail(host, selectedRunId);
    } else {
      host.researchRunDetail = null;
    }
    return host.researchRuns;
  } catch (error) {
    host.researchRunsError = error instanceof Error ? error.message : String(error);
    return [];
  } finally {
    host.researchRunsLoading = false;
  }
}

export async function loadResearchArtifacts(host: OpenClawApp): Promise<ResearchArtifactRecord[]> {
  const project = getCurrentResearchProject(host);
  if (!project || !host.client || !host.connected) {
    return [];
  }
  host.researchArtifactsLoading = true;
  host.researchArtifactsError = null;
  try {
    const res = await host.client.request<{ artifacts?: ResearchArtifactRecord[] }>(
      "research.artifacts.list",
      {
        projectId: project.id,
      },
    );
    host.researchArtifacts = Array.isArray(res.artifacts) ? res.artifacts : [];
    const selectedArtifactId =
      host.researchSelectedArtifactId &&
      host.researchArtifacts.some((artifact) => artifact.artifactId === host.researchSelectedArtifactId)
        ? host.researchSelectedArtifactId
        : host.researchArtifacts[0]?.artifactId ?? null;
    host.researchSelectedArtifactId = selectedArtifactId;
    if (selectedArtifactId) {
      await loadResearchArtifactDetail(host, selectedArtifactId);
    } else {
      host.researchArtifactDetail = null;
    }
    return host.researchArtifacts;
  } catch (error) {
    host.researchArtifactsError = error instanceof Error ? error.message : String(error);
    return [];
  } finally {
    host.researchArtifactsLoading = false;
  }
}

export async function loadResearchAddons(host: OpenClawApp): Promise<ResearchAddonStatus[]> {
  const project = getCurrentResearchProject(host);
  if (!project || !host.client || !host.connected) {
    return [];
  }
  host.researchAddonsLoading = true;
  host.researchAddonsError = null;
  try {
    const res = await host.client.request<{ addons?: ResearchAddonStatus[] }>(
      "research.addons.list",
      {
        projectId: project.id,
      },
    );
    host.researchAddons = Array.isArray(res.addons) ? res.addons : [];
    return host.researchAddons;
  } catch (error) {
    host.researchAddonsError = error instanceof Error ? error.message : String(error);
    return [];
  } finally {
    host.researchAddonsLoading = false;
  }
}

export async function setResearchAddonEnabled(
  host: OpenClawApp,
  addonId: string,
  enabled: boolean,
): Promise<void> {
  const project = getCurrentResearchProject(host);
  if (!project || !host.client || !host.connected) {
    return;
  }
  host.researchAddonsLoading = true;
  try {
    const res = await host.client.request<{ addons?: ResearchAddonStatus[] }>(
      "research.addons.patch",
      {
        projectId: project.id,
        addonId,
        enabled,
      },
    );
    host.researchAddons = Array.isArray(res.addons) ? res.addons : [];
    await loadResearchOverview(host);
  } catch (error) {
    host.researchAddonsError = error instanceof Error ? error.message : String(error);
  } finally {
    host.researchAddonsLoading = false;
  }
}

export async function loadResearchChatState(host: OpenClawApp): Promise<void> {
  const project = getCurrentResearchProject(host) ?? (await loadResearchProjects(host))[0] ?? null;
  if (!project) {
    return;
  }
  if (host.researchProjectId !== project.id || resolveAgentIdFromSessionKey(host.sessionKey) !== project.agentId) {
    await selectResearchProject(host, project.id, { keepSession: true });
  }
  host.researchSessionsLoading = true;
  host.researchSessionsError = null;
  try {
    host.researchSessionsResult = await loadProjectSessions(host, project.agentId);
    host.agentsSelectedId = project.agentId;
    await refreshChat(host);
    host.researchSessionsResult = await loadProjectSessions(host, project.agentId);
  } catch (error) {
    host.researchSessionsError = error instanceof Error ? error.message : String(error);
  } finally {
    host.researchSessionsLoading = false;
  }
}

export async function loadResearchRunDetail(
  host: OpenClawApp,
  runId: string,
): Promise<{ run: ResearchRunRecord; logText: string | null } | null> {
  const project = getCurrentResearchProject(host);
  if (!project || !host.client || !host.connected) {
    return null;
  }
  host.researchSelectedRunId = runId;
  host.researchRunDetailLoading = true;
  host.researchRunDetailError = null;
  try {
    const res = await host.client.request<{ run?: ResearchRunRecord; logText?: string | null }>(
      "research.runs.get",
      {
        projectId: project.id,
        runId,
      },
    );
    if (!res.run) {
      host.researchRunDetail = null;
      return null;
    }
    host.researchRunDetail = {
      run: res.run,
      logText: typeof res.logText === "string" ? res.logText : null,
    };
    return host.researchRunDetail;
  } catch (error) {
    host.researchRunDetailError = error instanceof Error ? error.message : String(error);
    return null;
  } finally {
    host.researchRunDetailLoading = false;
  }
}

export async function cancelResearchRunById(host: OpenClawApp, runId: string): Promise<void> {
  const project = getCurrentResearchProject(host);
  if (!project || !host.client || !host.connected) {
    return;
  }
  try {
    await host.client.request("research.runs.cancel", {
      projectId: project.id,
      runId,
    });
    await loadResearchRuns(host);
  } catch (error) {
    host.researchRunDetailError = error instanceof Error ? error.message : String(error);
  }
}

export async function loadResearchArtifactDetail(
  host: OpenClawApp,
  artifactId: string,
): Promise<ResearchArtifactRecord | null> {
  const project = getCurrentResearchProject(host);
  if (!project || !host.client || !host.connected) {
    return null;
  }
  host.researchSelectedArtifactId = artifactId;
  host.researchArtifactDetailLoading = true;
  host.researchArtifactDetailError = null;
  try {
    const res = await host.client.request<ResearchArtifactRecord>("research.artifacts.get", {
      projectId: project.id,
      artifactId,
    });
    host.researchArtifactDetail = res ?? null;
    return host.researchArtifactDetail;
  } catch (error) {
    host.researchArtifactDetailError = error instanceof Error ? error.message : String(error);
    return null;
  } finally {
    host.researchArtifactDetailLoading = false;
  }
}

export async function saveResearchProjectSettings(
  host: OpenClawApp,
  patch: Record<string, unknown>,
): Promise<void> {
  const project = getCurrentResearchProject(host);
  if (!project || !host.client || !host.connected) {
    return;
  }
  try {
    await host.client.request("research.projects.patch", {
      projectId: project.id,
      patch,
    });
    await Promise.all([loadResearchProjects(host), loadResearchOverview(host), loadResearchAddons(host)]);
  } catch (error) {
    host.researchOverviewError = error instanceof Error ? error.message : String(error);
  }
}

export async function loadResearchTabData(host: OpenClawApp): Promise<void> {
  await loadResearchProjects(host);
  if (host.tab === "overview") {
    await Promise.all([loadResearchOverview(host), loadResearchRuns(host), loadResearchArtifacts(host), loadResearchAddons(host)]);
    return;
  }
  if (host.tab === "chat") {
    await loadResearchChatState(host);
    return;
  }
  if (host.tab === "runs") {
    await loadResearchRuns(host);
    return;
  }
  if (host.tab === "artifacts") {
    await loadResearchArtifacts(host);
    return;
  }
  if (host.tab === "addons" || host.tab === "settings") {
    await loadResearchAddons(host);
  }
}
