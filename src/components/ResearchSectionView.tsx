import { useEffect, useState } from "react";
import type {
  AgentRecord,
  ConversationRecord,
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
} from "../types";
import { ResearchHeroPanel } from "./research/ResearchHeroPanel";
import { ResearchEvidencePanel } from "./research/ResearchEvidencePanel";
import { ResearchHypothesesPanel } from "./research/ResearchHypothesesPanel";
import { ResearchLoopPanel } from "./research/ResearchLoopPanel";
import { ResearchProjectListPanel } from "./research/ResearchProjectListPanel";
import { ResearchProjectSummaryPanel } from "./research/ResearchProjectSummaryPanel";
import { ResearchQuestionsPanel } from "./research/ResearchQuestionsPanel";
import { ResearchSearchRolePanel } from "./research/ResearchSearchRolePanel";

interface ResearchSectionViewProps {
  activeAgent: AgentRecord | null;
  activeConversation: ConversationRecord | null;
  activeProject: ResearchProjectRecord | null;
  projects: ResearchProjectRecord[];
  questions: ResearchQuestionRecord[];
  hypotheses: ResearchHypothesisRecord[];
  evidence: ResearchEvidenceRecord[];
  sources: ResearchSourceRecord[];
  loops: ResearchLoopRecord[];
  preflight: ResearchPreflightResponse | null;
  ragResults: ProjectRagQueryResult[];
  ragStatus: ProjectRagRebuildResponse | null;
  searchResults: ResearchSearchResult[];
  loading: boolean;
  onAddEvidence: (projectId: string, payload: { claim: string; summary: string; questionId?: string | null }) => void;
  onAddSource: (
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
    },
  ) => void;
  onAddHypothesis: (projectId: string, hypothesis: string, questionId?: string | null) => void;
  onAddQuestion: (projectId: string, question: string) => void;
  onCancelLoop: (loopId: string) => void;
  onCreateProject: (payload: {
    agentId: string;
    conversationId?: string | null;
    title: string;
    objective: string;
    domain?: string | null;
  }) => void;
  onCreateReport: (projectId: string) => void;
  onCreateReportTask: (projectId: string) => void;
  onCreateSubagent: (
    projectId: string,
    role: "researcher" | "critic" | "verifier" | "synthesizer" | "experiment-planner",
    questionId?: string | null,
  ) => void;
  onOpenFlow: (flowId: string) => void;
  onProposeLoop: (projectId: string, payload: { questionId?: string | null; goal?: string | null; autoStart?: boolean }) => void;
  onRefresh: (projectId?: string | null) => void;
  onRebuildRag: (projectId: string) => void;
  onSearch: (query: string) => void;
  onSearchRag: (projectId: string, query: string) => void;
  onSelectProject: (projectId: string) => void;
  onStartGoal: (
    projectId: string,
    payload?: {
      questionId?: string | null;
      goal?: string | null;
      autoStart?: boolean;
      enableAutonomy?: boolean;
      workspaceMode?: "session" | "repository";
    },
  ) => void;
  onStartSelfImprovement: (
    agentId: string,
    payload?: {
      conversationId?: string | null;
      goal?: string | null;
      autoStart?: boolean;
      workspaceMode?: "session" | "repository";
    },
  ) => void;
  onStartLoop: (loopId: string) => void;
  onStopGoal: (projectId: string) => void;
  onTickGoal: (projectId: string) => void;
  onTickLoop: (loopId: string) => void;
}

export function ResearchSectionView({
  activeAgent,
  activeConversation,
  activeProject,
  projects,
  questions,
  hypotheses,
  evidence,
  sources,
  loops,
  preflight,
  ragResults,
  ragStatus,
  searchResults,
  loading,
  onAddEvidence,
  onAddSource,
  onAddHypothesis,
  onAddQuestion,
  onCancelLoop,
  onCreateProject,
  onCreateReport,
  onCreateReportTask,
  onCreateSubagent,
  onOpenFlow,
  onProposeLoop,
  onRefresh,
  onRebuildRag,
  onSearch,
  onSearchRag,
  onSelectProject,
  onStartGoal,
  onStartSelfImprovement,
  onStartLoop,
  onStopGoal,
  onTickGoal,
  onTickLoop,
}: ResearchSectionViewProps) {
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [newProjectObjective, setNewProjectObjective] = useState("");
  const [loopGoal, setLoopGoal] = useState("");
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [goalWorkspaceMode, setGoalWorkspaceMode] = useState<"session" | "repository">(
    activeProject?.safetyPolicy.workspaceMode === "repository" ? "repository" : "session",
  );

  useEffect(() => {
    setGoalWorkspaceMode(activeProject?.safetyPolicy.workspaceMode === "repository" ? "repository" : "session");
  }, [activeProject?.id, activeProject?.safetyPolicy.workspaceMode]);

  return (
    <div className="cockpit-section cockpit-section--research">
      <ResearchHeroPanel
        activeAgent={activeAgent}
        activeConversation={activeConversation}
        activeProject={activeProject}
        onCreateReport={onCreateReport}
        onCreateReportTask={onCreateReportTask}
        onRefresh={onRefresh}
        onStartSelfImprovement={onStartSelfImprovement}
      />

      <div className="cockpit-section-grid cockpit-section-grid--research">
        <ResearchProjectListPanel
          activeAgent={activeAgent}
          activeConversation={activeConversation}
          activeProject={activeProject}
          newProjectObjective={newProjectObjective}
          newProjectTitle={newProjectTitle}
          onCreateProject={onCreateProject}
          onSelectProject={onSelectProject}
          projects={projects}
          setNewProjectObjective={setNewProjectObjective}
          setNewProjectTitle={setNewProjectTitle}
        />

        <ResearchProjectSummaryPanel
          activeProject={activeProject}
          evidence={evidence}
          goalWorkspaceMode={goalWorkspaceMode}
          hypotheses={hypotheses}
          loops={loops}
          loopGoal={loopGoal}
          preflight={preflight}
          questions={questions}
          selectedQuestionId={selectedQuestionId}
          setGoalWorkspaceMode={setGoalWorkspaceMode}
          onStartGoal={onStartGoal}
          onStopGoal={onStopGoal}
          onTickGoal={onTickGoal}
        />
      </div>

      <div className="cockpit-section-grid cockpit-section-grid--research">
        <ResearchQuestionsPanel
          activeProject={activeProject}
          questions={questions}
          selectedQuestionId={selectedQuestionId}
          setSelectedQuestionId={setSelectedQuestionId}
          onAddQuestion={onAddQuestion}
        />
        <ResearchHypothesesPanel
          activeProject={activeProject}
          hypotheses={hypotheses}
          selectedQuestionId={selectedQuestionId}
          onAddHypothesis={onAddHypothesis}
        />
      </div>

      <ResearchLoopPanel
        activeProject={activeProject}
        loading={loading}
        loopGoal={loopGoal}
        loops={loops}
        questions={questions}
        selectedQuestionId={selectedQuestionId}
        setLoopGoal={setLoopGoal}
        onCancelLoop={onCancelLoop}
        onOpenFlow={onOpenFlow}
        onProposeLoop={onProposeLoop}
        onStartLoop={onStartLoop}
        onTickLoop={onTickLoop}
      />

      <div className="cockpit-section-grid cockpit-section-grid--research">
        <ResearchEvidencePanel
          activeProject={activeProject}
          evidence={evidence}
          sources={sources}
          selectedQuestionId={selectedQuestionId}
          onAddEvidence={onAddEvidence}
          onAddSource={onAddSource}
        />
        <ResearchSearchRolePanel
          activeProject={activeProject}
          ragResults={ragResults}
          ragStatus={ragStatus}
          searchResults={searchResults}
          selectedQuestionId={selectedQuestionId}
          onCreateSubagent={onCreateSubagent}
          onRebuildRag={onRebuildRag}
          onSearch={onSearch}
          onSearchRag={onSearchRag}
        />
      </div>
    </div>
  );
}
