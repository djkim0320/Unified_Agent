import { html, nothing, type TemplateResult } from "lit";
import { normalizeBasePath, RESEARCH_TABS, titleForTab, type Tab } from "../navigation.ts";
import type { AppViewState } from "../app-view-state.ts";
import type { ResearchAddonStatus, ResearchProject } from "../types.ts";

export type ResearchShellProps = {
  state: AppViewState;
  currentProject: ResearchProject | null;
  content: TemplateResult;
  onProjectSelect: (projectId: string) => void;
  onResearchTabSelect: (tab: Tab) => void;
  onLegacyNavigate: (tab: Tab) => void;
  requestUpdate?: () => void;
};

export type ResearchOverviewProps = {
  state: AppViewState;
  currentProject: ResearchProject | null;
};

export type ResearchChatProps = {
  state: AppViewState;
  chatContent: TemplateResult;
  onSessionSelect: (sessionKey: string) => void;
};

export type ResearchRunsProps = {
  state: AppViewState;
  currentProject: ResearchProject | null;
  onRunSelect: (runId: string) => void;
  onRunCancel: (runId: string) => void;
  onArtifactSelect: (artifactId: string) => void;
  requestUpdate?: () => void;
};

export type ResearchArtifactsProps = {
  state: AppViewState;
  currentProject: ResearchProject | null;
  onArtifactSelect: (artifactId: string) => void;
  onRunSelect: (runId: string) => void;
  requestUpdate?: () => void;
};

export type ResearchAddonsProps = {
  state: AppViewState;
  onAddonToggle: (addonId: string, enabled: boolean) => void;
};

export type ResearchSettingsProps = {
  state: AppViewState;
  currentProject: ResearchProject | null;
  onSave: (patch: Record<string, unknown>) => void;
};

export type ResearchAdvancedProps = {
  onLegacyNavigate: (tab: Tab) => void;
};

type RunFilterState = {
  status: string;
  addon: string;
};

type ArtifactFilterState = {
  type: string;
  addon: string;
  runId: string;
};

const runFiltersByProject = new Map<string, RunFilterState>();
const artifactFiltersByProject = new Map<string, ArtifactFilterState>();

const LEGACY_TAB_SECTIONS: Array<{ title: string; tabs: Tab[] }> = [
  { title: "Operations", tabs: ["channels", "instances", "sessions", "usage", "cron"] },
  { title: "Agents", tabs: ["agents", "skills", "nodes", "dreams"] },
  {
    title: "System",
    tabs: [
      "config",
      "communications",
      "appearance",
      "automation",
      "infrastructure",
      "aiAgents",
      "debug",
      "logs",
    ],
  },
];

function formatDateTime(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Not available";
  }
  return new Date(value).toLocaleString();
}

function formatRelative(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "No activity yet";
  }
  const diff = Date.now() - value;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function basePathForResearch(state: AppViewState): string {
  return normalizeBasePath(state.basePath ?? "");
}

function artifactHref(
  state: AppViewState,
  projectId: string,
  artifactId: string,
  download = false,
): string {
  const base = basePathForResearch(state);
  const url = `${base}/research/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(
    artifactId,
  )}`;
  return download ? `${url}?download=1` : url;
}

function renderEmptyState(title: string, description: string) {
  return html`
    <section class="research-empty">
      <h3>${title}</h3>
      <p>${description}</p>
    </section>
  `;
}

function renderStatusPill(status: string | null | undefined, tone?: string) {
  const value = (status ?? "unknown").replaceAll("_", " ");
  const normalizedTone = tone ?? status ?? "neutral";
  return html`<span class="research-pill research-pill--${normalizedTone}">${value}</span>`;
}

function renderMiniList<T>(
  items: T[],
  renderItem: (item: T) => TemplateResult,
  emptyTitle: string,
  emptyDescription: string,
) {
  if (items.length === 0) {
    return renderEmptyState(emptyTitle, emptyDescription);
  }
  return html`<div class="research-mini-list">${items.map((item) => renderItem(item))}</div>`;
}

function getRunFilterState(projectId: string): RunFilterState {
  if (!runFiltersByProject.has(projectId)) {
    runFiltersByProject.set(projectId, { status: "", addon: "" });
  }
  return runFiltersByProject.get(projectId)!;
}

function getArtifactFilterState(projectId: string): ArtifactFilterState {
  if (!artifactFiltersByProject.has(projectId)) {
    artifactFiltersByProject.set(projectId, { type: "", addon: "", runId: "" });
  }
  return artifactFiltersByProject.get(projectId)!;
}

function renderResearchSidebar(props: ResearchShellProps) {
  const { state, currentProject } = props;
  return html`
    <aside class="research-sidebar">
      <section class="research-sidebar__section">
        <div class="research-sidebar__eyebrow">Projects</div>
        ${currentProject
          ? html`
              <div class="research-project-card research-project-card--active">
                <div class="research-project-card__title">${currentProject.name}</div>
                <div class="research-project-card__meta">${currentProject.agentId}</div>
                <div class="research-project-card__description">${currentProject.description}</div>
                <div class="research-project-card__footer">
                  <span>${formatRelative(currentProject.latestActivityAt ?? currentProject.updatedAt)}</span>
                  <span>${currentProject.workspacePath}</span>
                </div>
              </div>
            `
          : renderEmptyState("No project", "Connect to load research projects.")}
        <div class="research-project-list">
          ${state.researchProjects.map(
            (project) => html`
              <button
                type="button"
                class="research-project-card ${project.id === currentProject?.id
                  ? "research-project-card--selected"
                  : ""}"
                @click=${() => props.onProjectSelect(project.id)}
              >
                <div class="research-project-card__title">${project.name}</div>
                <div class="research-project-card__meta">${project.agentId}</div>
                <div class="research-project-card__description">${project.description}</div>
              </button>
            `,
          )}
        </div>
      </section>

      <section class="research-sidebar__section">
        <div class="research-sidebar__eyebrow">Workspace</div>
        <nav class="research-nav">
          ${RESEARCH_TABS.map(
            (tab) => html`
              <button
                type="button"
                class="research-nav__item ${state.tab === tab ? "research-nav__item--active" : ""}"
                @click=${() => props.onResearchTabSelect(tab)}
              >
                <span>${titleForTab(tab)}</span>
              </button>
            `,
          )}
        </nav>
      </section>

      <details class="research-sidebar__section research-sidebar__section--legacy">
        <summary>Legacy admin tools</summary>
        ${LEGACY_TAB_SECTIONS.map(
          (section) => html`
            <div class="research-legacy-group">
              <div class="research-sidebar__eyebrow">${section.title}</div>
              <div class="research-legacy-group__items">
                ${section.tabs.map(
                  (tab) => html`
                    <button
                      type="button"
                      class="research-legacy-link ${state.tab === tab ? "research-legacy-link--active" : ""}"
                      @click=${() => props.onLegacyNavigate(tab)}
                    >
                      ${titleForTab(tab)}
                    </button>
                  `,
                )}
              </div>
            </div>
          `,
        )}
      </details>
    </aside>
  `;
}

export function renderResearchWorkspace(props: ResearchShellProps) {
  const { state, currentProject } = props;
  return html`
    <div class="research-workspace">
      ${renderResearchSidebar(props)}
      <section class="research-main">
        <header class="research-header">
          <div>
            <div class="research-header__eyebrow">Aerospace Research Workspace</div>
            <h1>${currentProject?.name ?? "Research Workspace"}</h1>
            <p>${currentProject?.description ?? "Project-scoped chat, runs, artifacts, and add-ons."}</p>
          </div>
          <div class="research-header__meta">
            <div class="research-header__meta-card">
              <span>Project</span>
              <strong>${currentProject?.agentId ?? "Unavailable"}</strong>
            </div>
            <div class="research-header__meta-card">
              <span>Updated</span>
              <strong>${formatRelative(currentProject?.latestActivityAt ?? currentProject?.updatedAt)}</strong>
            </div>
          </div>
        </header>

        <nav class="research-tabbar">
          ${RESEARCH_TABS.map(
            (tab) => html`
              <button
                type="button"
                class="research-tabbar__tab ${state.tab === tab ? "research-tabbar__tab--active" : ""}"
                @click=${() => props.onResearchTabSelect(tab)}
              >
                ${titleForTab(tab)}
              </button>
            `,
          )}
        </nav>

        <div class="research-content">${props.content}</div>
      </section>
    </div>
  `;
}

export function renderResearchOverview(props: ResearchOverviewProps) {
  const { state, currentProject } = props;
  const overview = state.researchOverview;
  if (!currentProject) {
    return renderEmptyState("No project selected", "Choose a project to load the research overview.");
  }
  if (state.researchOverviewLoading && !overview) {
    return renderEmptyState("Loading overview", "Collecting sessions, runs, artifacts, and add-on status.");
  }
  if (state.researchOverviewError) {
    return renderEmptyState("Overview unavailable", state.researchOverviewError);
  }
  if (!overview) {
    return renderEmptyState("No overview yet", "This project will populate as soon as activity appears.");
  }
  return html`
    <div class="research-grid research-grid--overview">
      <section class="research-panel">
        <div class="research-panel__header">
          <h2>Project summary</h2>
          ${renderStatusPill("ready", "ready")}
        </div>
        <dl class="research-stat-list">
          <div><dt>Agent</dt><dd>${currentProject.agentId}</dd></div>
          <div><dt>Workspace</dt><dd>${currentProject.workspacePath}</dd></div>
          <div><dt>Last activity</dt><dd>${formatDateTime(overview.latestActivityAt)}</dd></div>
          <div><dt>Enabled add-ons</dt><dd>${overview.enabledAddons.length}</dd></div>
        </dl>
      </section>
      <section class="research-panel">
        <div class="research-panel__header"><h2>Recent sessions</h2></div>
        ${renderMiniList(
          overview.recentSessions,
          (session) => html`
            <div class="research-mini-row">
              <div><strong>${session.displayName ?? session.key}</strong><span>${session.model ?? "Default model"}</span></div>
              <div>${renderStatusPill(session.status ?? "ready", session.status ?? "ready")}<span>${formatRelative(session.updatedAt)}</span></div>
            </div>
          `,
          "No sessions yet",
          "Start in Chat to create the first project session.",
        )}
      </section>
      <section class="research-panel">
        <div class="research-panel__header"><h2>Recent runs</h2></div>
        ${renderMiniList(
          overview.recentRuns,
          (run) => html`
            <div class="research-mini-row">
              <div><strong>${run.summary ?? run.runId}</strong><span>${run.addonId}</span></div>
              <div>${renderStatusPill(run.status, run.status)}<span>${formatRelative(run.endedAt ?? run.startedAt)}</span></div>
            </div>
          `,
          "No runs yet",
          "Long-running solver activity will appear here.",
        )}
      </section>
      <section class="research-panel">
        <div class="research-panel__header"><h2>Recent artifacts</h2></div>
        ${renderMiniList(
          overview.recentArtifacts,
          (artifact) => html`
            <div class="research-mini-row">
              <div><strong>${artifact.name}</strong><span>${artifact.type}</span></div>
              <div>${renderStatusPill(artifact.addonId, "neutral")}<span>${formatRelative(artifact.createdAt)}</span></div>
            </div>
          `,
          "No artifacts yet",
          "Generated files will show up after add-ons run.",
        )}
      </section>
      <section class="research-panel research-panel--full">
        <div class="research-panel__header"><h2>Enabled add-ons</h2></div>
        <div class="research-addon-strip">
          ${overview.enabledAddons.length > 0
            ? overview.enabledAddons.map(
                (addon) => html`
                  <div class="research-addon-chip">
                    <strong>${addon.name}</strong>
                    <span>${addon.description}</span>
                  </div>
                `,
              )
            : html`<p class="research-muted">Enable add-ons to expose research tools in chat.</p>`}
        </div>
      </section>
    </div>
  `;
}

export function renderResearchChatView(props: ResearchChatProps) {
  const sessions = props.state.researchSessionsResult?.sessions ?? [];
  return html`
    <div class="research-chat-layout">
      <aside class="research-chat-sessions">
        <div class="research-panel__header">
          <h2>Sessions</h2>
          ${props.state.researchSessionsLoading
            ? renderStatusPill("loading", "loading")
            : renderStatusPill(String(sessions.length), "neutral")}
        </div>
        ${props.state.researchSessionsError ? html`<p class="research-error">${props.state.researchSessionsError}</p>` : nothing}
        ${sessions.length > 0
          ? html`
              <div class="research-session-list">
                ${sessions.map(
                  (session) => html`
                    <button
                      type="button"
                      class="research-session-row ${props.state.sessionKey === session.key ? "research-session-row--active" : ""}"
                      @click=${() => props.onSessionSelect(session.key)}
                    >
                      <strong>${session.displayName ?? session.label ?? session.key}</strong>
                      <span>${formatRelative(session.updatedAt)}</span>
                    </button>
                  `,
                )}
              </div>
            `
          : renderEmptyState("No sessions", "Create a project session from the chat composer.")}
      </aside>
      <div class="research-chat-main">${props.chatContent}</div>
    </div>
  `;
}

export function renderResearchRuns(props: ResearchRunsProps) {
  const { state, currentProject } = props;
  if (!currentProject) {
    return renderEmptyState("No project selected", "Choose a project to inspect research runs.");
  }
  if (state.researchRunsError && state.researchRuns.length === 0) {
    return renderEmptyState("Runs unavailable", state.researchRunsError);
  }
  const filterState = getRunFilterState(currentProject.id);
  const addonOptions = [...new Set(state.researchRuns.map((run) => run.addonId))];
  const filteredRuns = state.researchRuns.filter((run) => {
    if (filterState.status && run.status !== filterState.status) return false;
    if (filterState.addon && run.addonId !== filterState.addon) return false;
    return true;
  });
  const selectedRun =
    state.researchRunDetail?.run.runId === state.researchSelectedRunId
      ? state.researchRunDetail.run
      : filteredRuns.find((run) => run.runId === state.researchSelectedRunId) ?? filteredRuns[0] ?? null;
  const selectedArtifacts = state.researchArtifacts.filter((artifact) =>
    selectedRun ? artifact.runId === selectedRun.runId : false,
  );
  return html`
    <div class="research-master-detail">
      <section class="research-panel">
        <div class="research-panel__header">
          <h2>Runs</h2>
          <div class="research-inline-filters">
            <label><span>Status</span><select .value=${filterState.status} @change=${(event: Event) => { filterState.status = (event.target as HTMLSelectElement).value; props.requestUpdate?.(); }}><option value="">All</option>${["queued", "running", "succeeded", "failed", "cancelled", "lost"].map((status) => html`<option value=${status}>${status}</option>`)}</select></label>
            <label><span>Add-on</span><select .value=${filterState.addon} @change=${(event: Event) => { filterState.addon = (event.target as HTMLSelectElement).value; props.requestUpdate?.(); }}><option value="">All</option>${addonOptions.map((addonId) => html`<option value=${addonId}>${addonId}</option>`)}</select></label>
          </div>
        </div>
        ${filteredRuns.length > 0
          ? html`<div class="research-list">${filteredRuns.map((run) => html`<button type="button" class="research-list-row ${run.runId === state.researchSelectedRunId ? "research-list-row--active" : ""}" @click=${() => props.onRunSelect(run.runId)}><div><strong>${run.summary ?? run.runId}</strong><span>${run.addonId}</span></div><div>${renderStatusPill(run.status, run.status)}<span>${formatRelative(run.endedAt ?? run.startedAt)}</span></div></button>`)}</div>`
          : renderEmptyState("No runs found", "Use chat to launch a mock solver or analysis run.")}
      </section>

      <section class="research-panel research-panel--detail">
        <div class="research-panel__header">
          <h2>Run detail</h2>
          ${state.researchRunDetailLoading ? renderStatusPill("loading", "loading") : selectedRun ? renderStatusPill(selectedRun.status, selectedRun.status) : nothing}
        </div>
        ${state.researchRunDetailError ? html`<p class="research-error">${state.researchRunDetailError}</p>` : nothing}
        ${selectedRun
          ? html`
              <div class="research-detail-grid">
                <div><span class="research-label">Run ID</span><strong>${selectedRun.runId}</strong></div>
                <div><span class="research-label">Started</span><strong>${formatDateTime(selectedRun.startedAt)}</strong></div>
                <div><span class="research-label">Ended</span><strong>${formatDateTime(selectedRun.endedAt)}</strong></div>
                <div><span class="research-label">Add-on</span><strong>${selectedRun.addonId}</strong></div>
              </div>
              <p class="research-summary">${selectedRun.progressSummary ?? selectedRun.summary ?? "No summary available."}</p>
              ${selectedRun.structuredOutputSummary ? html`<section class="research-subpanel"><h3>Structured output</h3><pre>${JSON.stringify(selectedRun.structuredOutputSummary, null, 2)}</pre></section>` : nothing}
              <section class="research-subpanel">
                <div class="research-subpanel__header"><h3>Artifacts</h3>${selectedArtifacts.length > 0 ? html`<span>${selectedArtifacts.length}</span>` : nothing}</div>
                ${selectedArtifacts.length > 0
                  ? html`<div class="research-chip-list">${selectedArtifacts.map((artifact) => html`<button type="button" class="research-chip" @click=${() => props.onArtifactSelect(artifact.artifactId)}>${artifact.name}</button>`)}</div>`
                  : html`<p class="research-muted">Artifacts from this run will appear here.</p>`}
              </section>
              <section class="research-subpanel">
                <div class="research-subpanel__header">
                  <h3>Logs</h3>
                  <div class="research-inline-actions">
                    <button type="button" class="btn btn--ghost" @click=${() => props.onRunSelect(selectedRun.runId)}>Refresh</button>
                    ${selectedRun.status === "running" ? html`<button type="button" class="btn btn--ghost" @click=${() => props.onRunCancel(selectedRun.runId)}>Cancel</button>` : nothing}
                  </div>
                </div>
                <pre class="research-log">${state.researchRunDetail?.logText ?? "No replayable log captured yet."}</pre>
              </section>
            `
          : renderEmptyState("No run selected", "Pick a run to inspect status, logs, and linked artifacts.")}
      </section>
    </div>
  `;
}

export function renderResearchArtifacts(props: ResearchArtifactsProps) {
  const { state, currentProject } = props;
  if (!currentProject) {
    return renderEmptyState("No project selected", "Choose a project to inspect artifacts.");
  }
  if (state.researchArtifactsError && state.researchArtifacts.length === 0) {
    return renderEmptyState("Artifacts unavailable", state.researchArtifactsError);
  }
  const filterState = getArtifactFilterState(currentProject.id);
  const typeOptions = [...new Set(state.researchArtifacts.map((artifact) => artifact.type))];
  const addonOptions = [...new Set(state.researchArtifacts.map((artifact) => artifact.addonId))];
  const runOptions = [...new Set(state.researchArtifacts.map((artifact) => artifact.runId))];
  const filteredArtifacts = state.researchArtifacts.filter((artifact) => {
    if (filterState.type && artifact.type !== filterState.type) return false;
    if (filterState.addon && artifact.addonId !== filterState.addon) return false;
    if (filterState.runId && artifact.runId !== filterState.runId) return false;
    return true;
  });
  const selectedArtifact =
    state.researchArtifactDetail?.artifactId === state.researchSelectedArtifactId
      ? state.researchArtifactDetail
      : filteredArtifacts.find((artifact) => artifact.artifactId === state.researchSelectedArtifactId) ?? filteredArtifacts[0] ?? null;
  return html`
    <div class="research-master-detail">
      <section class="research-panel">
        <div class="research-panel__header">
          <h2>Artifacts</h2>
          <div class="research-inline-filters">
            <label><span>Type</span><select .value=${filterState.type} @change=${(event: Event) => { filterState.type = (event.target as HTMLSelectElement).value; props.requestUpdate?.(); }}><option value="">All</option>${typeOptions.map((type) => html`<option value=${type}>${type}</option>`)}</select></label>
            <label><span>Add-on</span><select .value=${filterState.addon} @change=${(event: Event) => { filterState.addon = (event.target as HTMLSelectElement).value; props.requestUpdate?.(); }}><option value="">All</option>${addonOptions.map((addonId) => html`<option value=${addonId}>${addonId}</option>`)}</select></label>
            <label><span>Run</span><select .value=${filterState.runId} @change=${(event: Event) => { filterState.runId = (event.target as HTMLSelectElement).value; props.requestUpdate?.(); }}><option value="">All</option>${runOptions.map((runId) => html`<option value=${runId}>${runId}</option>`)}</select></label>
          </div>
        </div>
        ${filteredArtifacts.length > 0
          ? html`<div class="research-artifact-grid">${filteredArtifacts.map((artifact) => html`<button type="button" class="research-artifact-card ${artifact.artifactId === state.researchSelectedArtifactId ? "research-artifact-card--active" : ""}" @click=${() => props.onArtifactSelect(artifact.artifactId)}><strong>${artifact.name}</strong><span>${artifact.type}</span><span>${artifact.addonId}</span><span>${formatRelative(artifact.createdAt)}</span></button>`)}</div>`
          : renderEmptyState("No artifacts found", "Generated files will appear here once add-ons finish.")}
      </section>

      <section class="research-panel research-panel--detail">
        <div class="research-panel__header">
          <h2>Artifact detail</h2>
          ${state.researchArtifactDetailLoading ? renderStatusPill("loading", "loading") : nothing}
        </div>
        ${state.researchArtifactDetailError ? html`<p class="research-error">${state.researchArtifactDetailError}</p>` : nothing}
        ${selectedArtifact
          ? html`
              <div class="research-detail-grid">
                <div><span class="research-label">Name</span><strong>${selectedArtifact.name}</strong></div>
                <div><span class="research-label">Type</span><strong>${selectedArtifact.type}</strong></div>
                <div><span class="research-label">Created</span><strong>${formatDateTime(selectedArtifact.createdAt)}</strong></div>
                <div><span class="research-label">Source run</span><button type="button" class="research-inline-link" @click=${() => props.onRunSelect(selectedArtifact.runId)}>${selectedArtifact.runId}</button></div>
              </div>
              <p class="research-summary">${selectedArtifact.path}</p>
              <div class="research-inline-actions">
                <a class="btn btn--ghost" href=${artifactHref(state, currentProject.id, selectedArtifact.artifactId)}>Open</a>
                <a class="btn btn--ghost" href=${artifactHref(state, currentProject.id, selectedArtifact.artifactId, true)}>Download</a>
              </div>
              <section class="research-subpanel"><h3>Preview</h3>${selectedArtifact.preview?.kind === "image" ? html`<img class="research-artifact-preview-image" src=${artifactHref(state, currentProject.id, selectedArtifact.artifactId)} alt=${selectedArtifact.name} />` : html`<pre>${selectedArtifact.preview?.excerpt ?? "No preview available."}</pre>`}</section>
            `
          : renderEmptyState("No artifact selected", "Choose an artifact to preview or download it.")}
      </section>
    </div>
  `;
}

function renderAddonTools(addon: ResearchAddonStatus) {
  return html`<ul class="research-inline-list">${addon.tools.map((tool) => html`<li>${tool}</li>`)}</ul>`;
}

export function renderResearchAddons(props: ResearchAddonsProps) {
  if (props.state.researchAddonsError && props.state.researchAddons.length === 0) {
    return renderEmptyState("Add-ons unavailable", props.state.researchAddonsError);
  }
  return html`
    <div class="research-addon-grid">
      ${props.state.researchAddons.map(
        (addon) => html`
          <section class="research-panel">
            <div class="research-panel__header">
              <h2>${addon.name}</h2>
              <div class="research-inline-actions">
                ${renderStatusPill(addon.health, addon.health)}
                ${addon.isMock ? renderStatusPill("mock", "neutral") : nothing}
              </div>
            </div>
            <p class="research-summary">${addon.description}</p>
            <dl class="research-stat-list">
              <div><dt>Version</dt><dd>${addon.version}</dd></div>
              <div><dt>Permissions</dt><dd>${addon.permissions.join(", ")}</dd></div>
            </dl>
            <div class="research-subpanel"><h3>Tools</h3>${renderAddonTools(addon)}</div>
            <div class="research-inline-actions">
              <button type="button" class="btn btn--ghost" @click=${() => props.onAddonToggle(addon.id, !addon.enabled)}>
                ${addon.enabled ? "Disable" : "Enable"}
              </button>
            </div>
          </section>
        `,
      )}
    </div>
  `;
}

export function renderResearchSettings(props: ResearchSettingsProps) {
  const { currentProject, state } = props;
  if (!currentProject) {
    return renderEmptyState("No project selected", "Choose a project to configure research preferences.");
  }
  return html`
    <div class="research-settings-grid">
      <section class="research-panel">
        <div class="research-panel__header"><h2>Project settings</h2></div>
        <form
          class="research-form"
          @submit=${(event: Event) => {
            event.preventDefault();
            const form = event.currentTarget as HTMLFormElement;
            const data = new FormData(form);
            props.onSave({
              name: String(data.get("name") ?? "").trim(),
              description: String(data.get("description") ?? "").trim(),
              defaultProvider: String(data.get("defaultProvider") ?? "").trim() || null,
              defaultModel: String(data.get("defaultModel") ?? "").trim() || null,
              preferences: {
                approvalPolicy: String(data.get("approvalPolicy") ?? "ask") || "ask",
                notes: String(data.get("notes") ?? "").trim(),
              },
            });
          }}
        >
          <label><span>Name</span><input type="text" name="name" .value=${currentProject.name} /></label>
          <label><span>Description</span><textarea name="description" rows="4">${currentProject.description}</textarea></label>
          <label><span>Default provider</span><input type="text" name="defaultProvider" .value=${currentProject.defaultProvider ?? ""} /></label>
          <label><span>Default model</span><input type="text" name="defaultModel" .value=${currentProject.defaultModel ?? ""} /></label>
          <label><span>Approval policy</span><select name="approvalPolicy"><option value="ask" ?selected=${(currentProject.preferences?.approvalPolicy ?? "ask") === "ask"}>Ask before tool execution</option><option value="auto" ?selected=${currentProject.preferences?.approvalPolicy === "auto"}>Auto-approve mock tools</option></select></label>
          <label><span>Research notes</span><textarea name="notes" rows="5">${currentProject.preferences?.notes ?? ""}</textarea></label>
          <div class="research-inline-actions"><button type="submit" class="btn btn--ghost">Save settings</button></div>
        </form>
      </section>

      <section class="research-panel">
        <div class="research-panel__header"><h2>Workspace defaults</h2></div>
        <dl class="research-stat-list">
          <div><dt>Current project id</dt><dd>${currentProject.id}</dd></div>
          <div><dt>Mapped agent</dt><dd>${currentProject.agentId}</dd></div>
          <div><dt>Enabled add-ons</dt><dd>${state.researchAddons.filter((addon) => addon.enabled).length}</dd></div>
          <div><dt>Workspace path</dt><dd>${currentProject.workspacePath}</dd></div>
        </dl>
        <p class="research-muted">Raw gateway configuration, global model wiring, and operator-level controls remain in Advanced.</p>
      </section>
    </div>
  `;
}

export function renderResearchAdvanced(props: ResearchAdvancedProps) {
  return html`
    <div class="research-settings-grid">
      ${LEGACY_TAB_SECTIONS.map(
        (section) => html`
          <section class="research-panel">
            <div class="research-panel__header"><h2>${section.title}</h2></div>
            <div class="research-legacy-grid">
              ${section.tabs.map(
                (tab) => html`
                  <button type="button" class="research-legacy-card" @click=${() => props.onLegacyNavigate(tab)}>
                    <strong>${titleForTab(tab)}</strong>
                    <span>Open the preserved upstream surface.</span>
                  </button>
                `,
              )}
            </div>
          </section>
        `,
      )}
    </div>
  `;
}
