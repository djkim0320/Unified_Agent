import { apiRequest } from "../../apiClient";
import type {
  ArtifactRecord,
  ProviderKind,
  ProjectRagQueryResult,
  ProjectRagRebuildResponse,
  ProjectRagSearchResponse,
  ReasoningLevel,
  ResearchEvidenceRecord,
  ResearchHypothesisRecord,
  ResearchLoopRecord,
  ResearchPreflightResponse,
  ResearchProjectRecord,
  ResearchProjectSessionRecord,
  ResearchQuestionRecord,
  ResearchSearchResult,
  ResearchSourceRecord,
  TaskFlowDetailResponse,
  TaskRecord,
} from "../../types";

export async function listResearchProjects(agentId?: string, signal?: AbortSignal) {
  const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
  return apiRequest<{ projects: ResearchProjectRecord[] }>(`/api/research/projects${query}`, { signal });
}

export async function createResearchProject(payload: {
  agentId: string;
  conversationId?: string | null;
  title: string;
  objective: string;
  domain?: string | null;
  autonomyEnabled?: boolean;
}) {
  return apiRequest<{
    project: ResearchProjectRecord;
    sessions?: ResearchProjectSessionRecord[];
    files?: { rootLabel: string; files: Array<{ path: string; content: string }> } | null;
  }>("/api/research/projects", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getResearchProject(projectId: string, signal?: AbortSignal) {
  return apiRequest<{
    project: ResearchProjectRecord;
    sessions?: ResearchProjectSessionRecord[];
    files?: { rootLabel: string; files: Array<{ path: string; content: string }> } | null;
    questions: ResearchQuestionRecord[];
    hypotheses: ResearchHypothesisRecord[];
    evidence: ResearchEvidenceRecord[];
    sources: ResearchSourceRecord[];
    loops: ResearchLoopRecord[];
  }>(`/api/research/projects/${encodeURIComponent(projectId)}`, { signal });
}

export async function updateResearchProject(
  projectId: string,
  payload: Partial<Pick<ResearchProjectRecord, "title" | "objective" | "domain" | "status" | "autonomyEnabled">>,
) {
  return apiRequest<{
    project: ResearchProjectRecord;
    sessions?: ResearchProjectSessionRecord[];
    files?: { rootLabel: string; files: Array<{ path: string; content: string }> } | null;
  }>(`/api/research/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function listResearchProjectSessions(projectId: string, signal?: AbortSignal) {
  return apiRequest<{
    sessions: Array<
      ResearchProjectSessionRecord & {
        conversation?: unknown;
        summary?: unknown;
      }
    >;
  }>(`/api/research/projects/${encodeURIComponent(projectId)}/sessions`, { signal });
}

export async function linkResearchProjectSession(
  projectId: string,
  payload: { conversationId: string; role?: string; includeInContext?: boolean },
) {
  return apiRequest<{
    session: ResearchProjectSessionRecord;
    sessions: ResearchProjectSessionRecord[];
    files?: { rootLabel: string; files: Array<{ path: string; content: string }> } | null;
  }>(`/api/research/projects/${encodeURIComponent(projectId)}/sessions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function unlinkResearchProjectSession(projectId: string, conversationId: string) {
  return apiRequest<{
    deleted: boolean;
    sessions: ResearchProjectSessionRecord[];
    files?: { rootLabel: string; files: Array<{ path: string; content: string }> } | null;
  }>(
    `/api/research/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(conversationId)}`,
    { method: "DELETE" },
  );
}

export async function getResearchProjectFiles(projectId: string, signal?: AbortSignal) {
  return apiRequest<{ rootLabel: string; files: Array<{ path: string; content: string }> }>(
    `/api/research/projects/${encodeURIComponent(projectId)}/files`,
    { signal },
  );
}

export async function createResearchQuestion(
  projectId: string,
  payload: { question: string; status?: ResearchQuestionRecord["status"]; priority?: number },
) {
  return apiRequest<{ question: ResearchQuestionRecord }>(
    `/api/research/projects/${encodeURIComponent(projectId)}/questions`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function updateResearchQuestion(
  questionId: string,
  payload: Partial<Pick<ResearchQuestionRecord, "question" | "status" | "priority">>,
) {
  return apiRequest<{ question: ResearchQuestionRecord }>(`/api/research/questions/${encodeURIComponent(questionId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function createResearchHypothesis(
  projectId: string,
  payload: {
    questionId?: string | null;
    hypothesis: string;
    status?: ResearchHypothesisRecord["status"];
    confidence?: number;
  },
) {
  return apiRequest<{ hypothesis: ResearchHypothesisRecord }>(
    `/api/research/projects/${encodeURIComponent(projectId)}/hypotheses`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function updateResearchHypothesis(
  hypothesisId: string,
  payload: Partial<Pick<ResearchHypothesisRecord, "questionId" | "hypothesis" | "status" | "confidence">>,
) {
  return apiRequest<{ hypothesis: ResearchHypothesisRecord }>(
    `/api/research/hypotheses/${encodeURIComponent(hypothesisId)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
}

export async function createResearchEvidence(
  projectId: string,
  payload: {
    questionId?: string | null;
    hypothesisId?: string | null;
    sourceType?: ResearchEvidenceRecord["sourceType"];
    sourceRef?: string | null;
    claim: string;
    summary: string;
    confidence?: number;
    uncertainty?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  return apiRequest<{ evidence: ResearchEvidenceRecord }>(
    `/api/research/projects/${encodeURIComponent(projectId)}/evidence`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function createResearchSource(
  projectId: string,
  payload: {
    evidenceId?: string | null;
    url?: string | null;
    title: string;
    author?: string | null;
    institution?: string | null;
    publishedAt?: string | null;
    accessedAt?: string | null;
    summary: string;
    quote?: string | null;
    snapshot?: string | null;
    reliability?: number;
    relatedClaim?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  return apiRequest<{ source: ResearchSourceRecord }>(
    `/api/research/projects/${encodeURIComponent(projectId)}/sources`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function getResearchRagContext(
  projectId: string,
  query?: { q?: string; questionId?: string | null },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  if (query?.q) params.set("q", query.q);
  if (query?.questionId) params.set("questionId", query.questionId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<{ context: string; ragResults?: ProjectRagQueryResult[] }>(
    `/api/research/projects/${encodeURIComponent(projectId)}/rag-context${suffix}`,
    { signal },
  );
}

export async function rebuildProjectRag(projectId: string) {
  return apiRequest<{ project: ResearchProjectRecord; rag: ProjectRagRebuildResponse }>(
    `/api/research/projects/${encodeURIComponent(projectId)}/rag/rebuild`,
    { method: "POST" },
  );
}

export async function searchProjectRag(
  projectId: string,
  query: { q: string; limit?: number; offset?: number },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ q: query.q });
  if (query.limit) params.set("limit", String(query.limit));
  if (query.offset) params.set("offset", String(query.offset));
  return apiRequest<ProjectRagSearchResponse>(
    `/api/research/projects/${encodeURIComponent(projectId)}/rag/search?${params.toString()}`,
    { signal },
  );
}

export async function getResearchPreflight(projectId: string, signal?: AbortSignal) {
  return apiRequest<ResearchPreflightResponse>(
    `/api/research/projects/${encodeURIComponent(projectId)}/preflight`,
    { signal },
  );
}

export async function proposeResearchLoop(
  projectId: string,
  payload: { questionId?: string | null; goal?: string | null; autoStart?: boolean },
) {
  return apiRequest<{ loop: ResearchLoopRecord; flow: TaskFlowDetailResponse["flow"]; steps: TaskFlowDetailResponse["steps"] }>(
    `/api/research/projects/${encodeURIComponent(projectId)}/loops/propose`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function startResearchLoop(loopId: string) {
  return apiRequest<{ loop: ResearchLoopRecord; flow: TaskFlowDetailResponse["flow"] | null }>(
    `/api/research/loops/${encodeURIComponent(loopId)}/start`,
    { method: "POST" },
  );
}

export async function tickResearchLoop(loopId: string) {
  return apiRequest<{
    loop: ResearchLoopRecord | null;
    flow: TaskFlowDetailResponse["flow"] | null;
    action: "started_flow" | "synced_terminal_flow" | "waiting_for_flow";
    summary: unknown;
  }>(`/api/research/loops/${encodeURIComponent(loopId)}/tick`, {
    method: "POST",
  });
}

export async function startResearchGoal(
  projectId: string,
  payload?: {
    questionId?: string | null;
    goal?: string | null;
    autoStart?: boolean;
    enableAutonomy?: boolean;
    workspaceMode?: "session" | "repository";
  },
) {
  return apiRequest<{
    project: ResearchProjectRecord;
    loop: ResearchLoopRecord;
    flow: TaskFlowDetailResponse["flow"];
    steps: TaskFlowDetailResponse["steps"];
    mode: "goal_runner";
  }>(`/api/research/projects/${encodeURIComponent(projectId)}/goal/start`, {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
}

export async function tickResearchGoal(projectId: string) {
  return apiRequest<{
    project: ResearchProjectRecord;
    loop: ResearchLoopRecord;
    flow: TaskFlowDetailResponse["flow"] | null;
    steps?: TaskFlowDetailResponse["steps"];
    mode: "goal_runner_tick";
    action: string;
  }>(`/api/research/projects/${encodeURIComponent(projectId)}/goal/tick`, {
    method: "POST",
  });
}

export async function stopResearchGoal(projectId: string) {
  return apiRequest<{ project: ResearchProjectRecord; mode: "goal_runner"; stopped: boolean }>(
    `/api/research/projects/${encodeURIComponent(projectId)}/goal/stop`,
    { method: "POST" },
  );
}

export async function startSelfImprovementGoal(
  agentId: string,
  payload?: {
    conversationId?: string | null;
    goal?: string | null;
    autoStart?: boolean;
    workspaceMode?: "session" | "repository";
  },
) {
  return apiRequest<{
    project: ResearchProjectRecord;
    question: ResearchQuestionRecord;
    loop: ResearchLoopRecord;
    flow: TaskFlowDetailResponse["flow"];
    steps: TaskFlowDetailResponse["steps"];
    mode: "self_improvement_goal";
  }>(`/api/research/agents/${encodeURIComponent(agentId)}/self-improvement-goal`, {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
}

export async function cancelResearchLoop(loopId: string) {
  return apiRequest<{ loop: ResearchLoopRecord }>(`/api/research/loops/${encodeURIComponent(loopId)}/cancel`, {
    method: "POST",
  });
}

export async function createResearchReport(projectId: string) {
  return apiRequest<{ artifact: ArtifactRecord; markdown: string; redacted: boolean }>(
    `/api/research/projects/${encodeURIComponent(projectId)}/report`,
    { method: "POST" },
  );
}

export async function createResearchReportTask(
  projectId: string,
  payload?: { autoStart?: boolean; providerKind?: ProviderKind; model?: string; reasoningLevel?: ReasoningLevel },
) {
  return apiRequest<{ task: TaskRecord }>(`/api/research/projects/${encodeURIComponent(projectId)}/report-task`, {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
}

export async function createResearchSubagent(
  projectId: string,
  payload: {
    role: "researcher" | "critic" | "verifier" | "synthesizer" | "experiment-planner";
    questionId?: string | null;
    prompt?: string | null;
    autoStart?: boolean;
  },
) {
  return apiRequest<{ task: TaskRecord }>(`/api/research/projects/${encodeURIComponent(projectId)}/subagents`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function searchResearch(query: { q: string; agentId?: string; conversationId?: string }, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query.q });
  if (query.agentId) params.set("agentId", query.agentId);
  if (query.conversationId) params.set("conversationId", query.conversationId);
  return apiRequest<{ query: string; results: ResearchSearchResult[]; redacted: boolean; indexMode: string }>(
    `/api/research/search?${params.toString()}`,
    { signal },
  );
}
