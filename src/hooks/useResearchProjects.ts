import { useRef, useState } from "react";
import { abortRef, beginRequest } from "../appStateUtils";
import {
  cancelResearchLoop,
  createResearchEvidence,
  createResearchHypothesis,
  createResearchProject,
  createResearchQuestion,
  createResearchReport,
  createResearchReportTask,
  createResearchSource,
  createResearchSubagent,
  getResearchPreflight,
  getResearchProject,
  listResearchProjects,
  proposeResearchLoop,
  rebuildProjectRag,
  searchProjectRag,
  searchResearch,
  startResearchGoal,
  startResearchLoop,
  startSelfImprovementGoal,
  stopResearchGoal,
  tickResearchGoal,
  tickResearchLoop,
  updateResearchProject,
} from "../api";
import type {
  ArtifactRecord,
  ProjectRagQueryResult,
  ProjectRagRebuildResponse,
  ResearchEvidenceRecord,
  ResearchHypothesisRecord,
  ResearchLoopRecord,
  ResearchPreflightResponse,
  ResearchProjectRecord,
  ResearchQuestionRecord,
  ResearchSearchResult,
  ResearchSourceRecord,
  TaskFlowDetailResponse,
  TaskRecord,
} from "../types";

interface UseResearchProjectsOptions {
  onNotice?: (message: string) => void;
  onFlowCreated?: (flowId: string) => void;
}

export function useResearchProjects({ onNotice, onFlowCreated }: UseResearchProjectsOptions = {}) {
  const [researchProjects, setResearchProjects] = useState<ResearchProjectRecord[]>([]);
  const [activeResearchProjectId, setActiveResearchProjectId] = useState<string | null>(null);
  const [researchQuestions, setResearchQuestions] = useState<ResearchQuestionRecord[]>([]);
  const [researchHypotheses, setResearchHypotheses] = useState<ResearchHypothesisRecord[]>([]);
  const [researchEvidence, setResearchEvidence] = useState<ResearchEvidenceRecord[]>([]);
  const [researchSources, setResearchSources] = useState<ResearchSourceRecord[]>([]);
  const [researchLoops, setResearchLoops] = useState<ResearchLoopRecord[]>([]);
  const [researchPreflight, setResearchPreflight] = useState<ResearchPreflightResponse | null>(null);
  const [researchSearchResults, setResearchSearchResults] = useState<ResearchSearchResult[]>([]);
  const [researchRagResults, setResearchRagResults] = useState<ProjectRagQueryResult[]>([]);
  const [researchRagStatus, setResearchRagStatus] = useState<ProjectRagRebuildResponse | null>(null);
  const [researchLastReport, setResearchLastReport] = useState<ArtifactRecord | null>(null);
  const [researchLoading, setResearchLoading] = useState(false);

  const seqRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const activeResearchProject =
    researchProjects.find((project) => project.id === activeResearchProjectId) ?? null;

  function mergeProject(project: ResearchProjectRecord) {
    setResearchProjects((current) =>
      [project, ...current.filter((item) => item.id !== project.id)].sort(
        (left, right) => right.updatedAt - left.updatedAt,
      ),
    );
    setActiveResearchProjectId(project.id);
  }

  async function refreshResearchProjects(agentId?: string | null) {
    if (!agentId) {
      setResearchProjects([]);
      setActiveResearchProjectId(null);
      return;
    }
    const request = beginRequest(seqRef, controllerRef);
    setResearchLoading(true);
    try {
      const response = await listResearchProjects(agentId, request.controller.signal);
      if (request.controller.signal.aborted || seqRef.current !== request.seq) return;
      setResearchProjects(response.projects);
      setActiveResearchProjectId((current) => current ?? response.projects[0]?.id ?? null);
    } catch (error) {
      if (!request.controller.signal.aborted) {
        onNotice?.(error instanceof Error ? error.message : "연구 프로젝트를 불러오지 못했습니다.");
      }
    } finally {
      if (seqRef.current === request.seq) {
        setResearchLoading(false);
        abortRef(controllerRef);
      }
    }
  }

  async function refreshResearchProjectDetail(projectId = activeResearchProjectId) {
    if (!projectId) return;
    setResearchLoading(true);
    try {
      const [detail, preflight] = await Promise.all([
        getResearchProject(projectId),
        getResearchPreflight(projectId).catch(() => null),
      ]);
      mergeProject(detail.project);
      setResearchQuestions(detail.questions);
      setResearchHypotheses(detail.hypotheses);
      setResearchEvidence(detail.evidence);
      setResearchSources(detail.sources);
      setResearchLoops(detail.loops);
      setResearchPreflight(preflight);
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "연구 상세 정보를 불러오지 못했습니다.");
    } finally {
      setResearchLoading(false);
    }
  }

  async function createProject(payload: {
    agentId: string;
    conversationId?: string | null;
    title: string;
    objective: string;
    domain?: string | null;
  }) {
    setResearchLoading(true);
    try {
      const response = await createResearchProject(payload);
      mergeProject(response.project);
      await refreshResearchProjectDetail(response.project.id);
      onNotice?.("연구 프로젝트를 만들었습니다.");
      return response.project;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "연구 프로젝트 생성에 실패했습니다.");
      return null;
    } finally {
      setResearchLoading(false);
    }
  }

  async function patchProject(projectId: string, payload: Parameters<typeof updateResearchProject>[1]) {
    try {
      const response = await updateResearchProject(projectId, payload);
      mergeProject(response.project);
      onNotice?.("연구 프로젝트를 업데이트했습니다.");
      return response.project;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "연구 프로젝트 업데이트에 실패했습니다.");
      return null;
    }
  }

  async function addQuestion(projectId: string, question: string) {
    try {
      const response = await createResearchQuestion(projectId, { question, priority: 10 });
      setResearchQuestions((current) => [response.question, ...current]);
      return response.question;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "연구 질문 추가에 실패했습니다.");
      return null;
    }
  }

  async function addHypothesis(projectId: string, hypothesis: string, questionId?: string | null) {
    try {
      const response = await createResearchHypothesis(projectId, { hypothesis, questionId });
      setResearchHypotheses((current) => [response.hypothesis, ...current]);
      return response.hypothesis;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "가설 추가에 실패했습니다.");
      return null;
    }
  }

  async function addEvidence(projectId: string, payload: { claim: string; summary: string; questionId?: string | null }) {
    try {
      const response = await createResearchEvidence(projectId, payload);
      setResearchEvidence((current) => [response.evidence, ...current]);
      return response.evidence;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "증거 추가에 실패했습니다.");
      return null;
    }
  }

  async function addSource(projectId: string, payload: Parameters<typeof createResearchSource>[1]) {
    try {
      const response = await createResearchSource(projectId, payload);
      setResearchSources((current) => [response.source, ...current]);
      return response.source;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "출처 저장에 실패했습니다.");
      return null;
    }
  }

  async function proposeLoop(projectId: string, payload: { questionId?: string | null; goal?: string | null; autoStart?: boolean }) {
    setResearchLoading(true);
    try {
      const response = await proposeResearchLoop(projectId, payload);
      setResearchLoops((current) => [response.loop, ...current.filter((loop) => loop.id !== response.loop.id)]);
      onFlowCreated?.(response.flow.id);
      onNotice?.("연구 Loop와 연결된 Flow를 만들었습니다.");
      return response as { loop: ResearchLoopRecord; flow: TaskFlowDetailResponse["flow"]; steps: TaskFlowDetailResponse["steps"] };
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "연구 Loop 제안에 실패했습니다.");
      return null;
    } finally {
      setResearchLoading(false);
    }
  }

  async function startLoop(loopId: string) {
    try {
      const response = await startResearchLoop(loopId);
      setResearchLoops((current) => current.map((loop) => (loop.id === response.loop.id ? response.loop : loop)));
      if (response.flow) onFlowCreated?.(response.flow.id);
      onNotice?.("연구 Loop를 시작했습니다.");
      return response.loop;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "연구 Loop 시작에 실패했습니다.");
      return null;
    }
  }

  async function tickLoop(loopId: string) {
    try {
      const response = await tickResearchLoop(loopId);
      if (response.loop) {
        setResearchLoops((current) => [response.loop!, ...current.filter((loop) => loop.id !== response.loop!.id)]);
      }
      if (response.flow) onFlowCreated?.(response.flow.id);
      onNotice?.("연구 Loop 상태를 갱신했습니다.");
      return response;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "연구 Loop 갱신에 실패했습니다.");
      return null;
    }
  }

  async function startGoal(
    projectId: string,
    payload?: {
      questionId?: string | null;
      goal?: string | null;
      autoStart?: boolean;
      enableAutonomy?: boolean;
      workspaceMode?: "session" | "repository";
    },
  ) {
    setResearchLoading(true);
    try {
      const response = await startResearchGoal(projectId, payload);
      mergeProject(response.project);
      setResearchLoops((current) => [response.loop, ...current.filter((loop) => loop.id !== response.loop.id)]);
      onFlowCreated?.(response.flow.id);
      onNotice?.("Goal Runner를 시작했습니다. 이후 루프는 예산과 승인 게이트 안에서 이어집니다.");
      return response;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "Goal Runner 시작에 실패했습니다.");
      return null;
    } finally {
      setResearchLoading(false);
    }
  }

  async function tickGoal(projectId: string) {
    try {
      const response = await tickResearchGoal(projectId);
      mergeProject(response.project);
      setResearchLoops((current) => [response.loop, ...current.filter((loop) => loop.id !== response.loop.id)]);
      if (response.flow) onFlowCreated?.(response.flow.id);
      onNotice?.("Goal Runner를 다음 단계로 진행했습니다.");
      return response;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "Goal Runner 진행에 실패했습니다.");
      return null;
    }
  }

  async function stopGoal(projectId: string) {
    try {
      const response = await stopResearchGoal(projectId);
      mergeProject(response.project);
      onNotice?.("Goal Runner를 중지했습니다.");
      return response.project;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "Goal Runner 중지에 실패했습니다.");
      return null;
    }
  }

  async function startSelfImprovement(
    agentId: string,
    payload?: {
      conversationId?: string | null;
      goal?: string | null;
      autoStart?: boolean;
      workspaceMode?: "session" | "repository";
    },
  ) {
    setResearchLoading(true);
    try {
      const response = await startSelfImprovementGoal(agentId, payload);
      mergeProject(response.project);
      setResearchQuestions((current) => [response.question, ...current.filter((item) => item.id !== response.question.id)]);
      setResearchLoops((current) => [response.loop, ...current.filter((loop) => loop.id !== response.loop.id)]);
      onFlowCreated?.(response.flow.id);
      onNotice?.("AetherOps 자기개선 Goal을 만들고 Flow로 연결했습니다.");
      return response;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "자기개선 Goal 시작에 실패했습니다.");
      return null;
    } finally {
      setResearchLoading(false);
    }
  }

  async function cancelLoop(loopId: string) {
    try {
      const response = await cancelResearchLoop(loopId);
      setResearchLoops((current) => current.map((loop) => (loop.id === response.loop.id ? response.loop : loop)));
      onNotice?.("연구 Loop를 취소했습니다.");
      return response.loop;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "연구 Loop 취소에 실패했습니다.");
      return null;
    }
  }

  async function createReport(projectId: string) {
    try {
      const response = await createResearchReport(projectId);
      setResearchLastReport(response.artifact);
      onNotice?.("최종 연구 보고서를 생성했습니다.");
      return response;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "연구 보고서 생성에 실패했습니다.");
      return null;
    }
  }

  async function createReportTask(projectId: string) {
    try {
      const response = await createResearchReportTask(projectId);
      onNotice?.("opencode 보고서 초안 Task를 만들었습니다.");
      return response.task as TaskRecord;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "보고서 초안 Task 생성에 실패했습니다.");
      return null;
    }
  }

  async function createSubagent(projectId: string, role: Parameters<typeof createResearchSubagent>[1]["role"], questionId?: string | null) {
    try {
      const response = await createResearchSubagent(projectId, { role, questionId });
      onNotice?.("연구 역할 Task를 만들었습니다.");
      return response.task;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "연구 역할 Task 생성에 실패했습니다.");
      return null;
    }
  }

  async function search(agentId: string | undefined, q: string, conversationId?: string) {
    if (!q.trim()) {
      setResearchSearchResults([]);
      return;
    }
    try {
      const response = await searchResearch({ q, agentId, conversationId });
      setResearchSearchResults(response.results);
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "연구 검색에 실패했습니다.");
    }
  }

  async function rebuildRag(projectId: string) {
    try {
      const response = await rebuildProjectRag(projectId);
      mergeProject(response.project);
      setResearchRagStatus(response.rag);
      onNotice?.(`프로젝트 RAG를 재색인했습니다. 문서 ${response.rag.documentCount}개, 청크 ${response.rag.chunkCount}개`);
      return response.rag;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "프로젝트 RAG 재색인에 실패했습니다.");
      return null;
    }
  }

  async function searchRag(projectId: string, q: string) {
    if (!q.trim()) {
      setResearchRagResults([]);
      return;
    }
    try {
      const response = await searchProjectRag(projectId, { q, limit: 10 });
      setResearchRagResults(response.results);
      onNotice?.(`프로젝트 RAG에서 ${response.results.length}개 근거를 찾았습니다.`);
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "프로젝트 RAG 검색에 실패했습니다.");
    }
  }

  function abortResearchRequests() {
    abortRef(controllerRef);
  }

  return {
    abortResearchRequests,
    activeResearchProject,
    activeResearchProjectId,
    addEvidence,
    addHypothesis,
    addQuestion,
    addSource,
    cancelLoop,
    createProject,
    createReport,
    createReportTask,
    createSubagent,
    patchProject,
    proposeLoop,
    refreshResearchProjectDetail,
    refreshResearchProjects,
    researchEvidence,
    researchHypotheses,
    researchLastReport,
    researchLoading,
    researchLoops,
    researchPreflight,
    researchProjects,
    researchQuestions,
    researchRagResults,
    researchRagStatus,
    researchSearchResults,
    researchSources,
    rebuildProjectRagIndex: rebuildRag,
    searchProjectRagRecords: searchRag,
    searchResearchRecords: search,
    setActiveResearchProjectId,
    startGoal,
    startSelfImprovement,
    startLoop,
    stopGoal,
    tickGoal,
    tickLoop,
  };
}
