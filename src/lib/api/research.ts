import { apiRequest } from "../../apiClient";
import type {
  ArtifactRecord,
  ProviderKind,
  ReasoningLevel,
  ResearchEvidenceRecord,
  ResearchHypothesisRecord,
  ResearchLoopRecord,
  ResearchPreflightResponse,
  ResearchProjectRecord,
  ResearchQuestionRecord,
  ResearchSearchResult,
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
  return apiRequest<{ project: ResearchProjectRecord }>("/api/research/projects", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getResearchProject(projectId: string, signal?: AbortSignal) {
  return apiRequest<{
    project: ResearchProjectRecord;
    questions: ResearchQuestionRecord[];
    hypotheses: ResearchHypothesisRecord[];
    evidence: ResearchEvidenceRecord[];
    loops: ResearchLoopRecord[];
  }>(`/api/research/projects/${encodeURIComponent(projectId)}`, { signal });
}

export async function updateResearchProject(
  projectId: string,
  payload: Partial<Pick<ResearchProjectRecord, "title" | "objective" | "domain" | "status" | "autonomyEnabled">>,
) {
  return apiRequest<{ project: ResearchProjectRecord }>(`/api/research/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
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
