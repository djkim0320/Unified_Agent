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
  createResearchSubagent,
  getResearchPreflight,
  getResearchProject,
  listResearchProjects,
  proposeResearchLoop,
  searchResearch,
  startResearchLoop,
  updateResearchProject,
} from "../api";
import type {
  ArtifactRecord,
  ResearchEvidenceRecord,
  ResearchHypothesisRecord,
  ResearchLoopRecord,
  ResearchPreflightResponse,
  ResearchProjectRecord,
  ResearchQuestionRecord,
  ResearchSearchResult,
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
  const [researchLoops, setResearchLoops] = useState<ResearchLoopRecord[]>([]);
  const [researchPreflight, setResearchPreflight] = useState<ResearchPreflightResponse | null>(null);
  const [researchSearchResults, setResearchSearchResults] = useState<ResearchSearchResult[]>([]);
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
    researchSearchResults,
    searchResearchRecords: search,
    setActiveResearchProjectId,
    startLoop,
  };
}
