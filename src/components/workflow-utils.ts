import type {
  AgentRecord,
  ConversationRecord,
  PreflightResponse,
  TaskFlowDetailResponse,
  TaskFlowRecord,
  TaskFlowStepDetail,
  TaskFlowStepDraft,
  TaskRecord,
  WorkspaceRunEventRecord,
  WorkspaceRunRecord,
} from "../types";
import type { CockpitNavTarget } from "./ConversationList";

type CockpitSectionTarget = Extract<CockpitNavTarget, "workflow">;

export type EditableFlowStep = TaskFlowStepDraft & {
  clientId: string;
};

export const MAX_FLOW_STEPS = 8;

export interface CockpitSectionViewProps {
  activeAgent: AgentRecord | null;
  activeConversation: ConversationRecord | null;
  liveEvents: WorkspaceRunEventRecord[];
  modelLabel: string;
  preflight: PreflightResponse | null;
  preflightLoading: boolean;
  providerLabel: string;
  reasoningLabel: string;
  runEvents: WorkspaceRunEventRecord[] | null;
  runs: WorkspaceRunRecord[];
  selectedTaskFlow: TaskFlowDetailResponse | null;
  target: CockpitSectionTarget;
  taskFlows: TaskFlowRecord[];
  tasks: TaskRecord[];
  onCancelTaskFlow: (flowId: string) => void;
  onCreateConversation: () => void;
  onCreateTaskFlow: (payload: {
    title: string;
    autoStart?: boolean;
    steps: Array<{
      stepKey: string;
      title: string;
      prompt: string;
      dependencyStepKey?: string | null;
    }>;
  }) => void;
  onDeleteTaskFlow: (flowId: string) => void;
  onNavigate: (target: CockpitNavTarget) => void;
  onOpenAgentSettings: () => void;
  onOpenArtifacts: (runId: string) => void;
  onOpenProviderSettings: () => void;
  onOpenRun: (runId: string) => void;
  onRefreshPlatformMetadata: () => void;
  onRefreshPreflight: () => void;
  onResumeTaskFlow: (flowId: string) => void;
  onRetryTask?: (taskId: string, force?: boolean) => void;
  onRetryTaskFlowStep: (flowId: string, stepId: string) => void;
  onApproveTaskFlowStep: (flowId: string, stepId: string) => void;
  onDenyTaskFlowStep: (flowId: string, stepId: string) => void;
  onSaveTaskFlowAsSkill?: (flowId: string) => void;
  onSelectTaskFlow: (flowId: string) => void;
  onSaveTaskFlowSteps: (flowId: string, steps: TaskFlowStepDraft[], title?: string) => void;
  onSkipTaskFlowStep: (flowId: string, stepId: string) => void;
  onStartTaskFlow: (flowId: string) => void;
}

export const sectionCopy: Record<CockpitSectionTarget, { eyebrow: string; title: string; description: string }> = {
  workflow: {
    eyebrow: "장기 작업",
    title: "워크플로우 관제",
    description:
      "긴 작업을 단계로 나누고, opencode 실행 흐름을 시작, 관찰, 재시도, 건너뛰기 할 수 있습니다.",
  },
};

export function formatTime(timestamp: number | null | undefined) {
  if (!timestamp) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function statusTone(status: string | null | undefined) {
  if (status === "completed" || status === "skipped") return "done";
  if (status === "running") return "active";
  if (status === "failed" || status === "cancelled" || status === "timed_out") return "error";
  return "queued";
}

export function statusLabel(status: string | null | undefined) {
  switch (status) {
    case "completed":
      return "완료";
    case "running":
      return "실행 중";
    case "queued":
      return "대기";
    case "failed":
      return "실패";
    case "cancelled":
      return "취소";
    case "skipped":
      return "건너뜀";
    case "timed_out":
      return "시간 초과";
    default:
      return "준비";
  }
}

export function taskKindLabel(kind: string | null | undefined) {
  switch (kind) {
    case "heartbeat":
      return "Heartbeat";
    case "scheduled":
      return "예약";
    case "continuation":
      return "이어가기";
    case "subagent":
      return "서브에이전트";
    case "flow_step":
      return "Flow 단계";
    default:
      return "백그라운드";
  }
}

export function countStatus<T extends { status: string }>(items: T[]) {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
}

export function eventName(event: WorkspaceRunEventRecord) {
  const payload = event.payload;
  const candidates = [payload.phase, payload.command, payload.action, payload.status, payload.name];
  const match = candidates.find((value) => typeof value === "string" && value.trim());
  return typeof match === "string" ? match : event.eventType;
}

export function eventSummary(event: WorkspaceRunEventRecord) {
  const payload = event.payload;
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.error === "string") return payload.error;
  if (typeof payload.summary === "string") return payload.summary;
  if (typeof payload.reason === "string") return payload.reason;
  return event.eventType;
}

export function normalizeStepKey(value: string, index: number) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^[\d.)\-\s]+/, "")
    .replace(/[^a-z0-9가-힣]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return normalized || `step-${index + 1}`;
}

export function parseFlowOutline(title: string, outline: string) {
  const lines = outline
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, MAX_FLOW_STEPS);

  if (!lines.length && title.trim()) {
    return [
      {
        stepKey: "step-1",
        title: title.trim(),
        prompt: `${title.trim()}\n\n기대 산출물, 변경 파일, 결정 사항, 다음 단계를 요약하세요.`,
        dependencyStepKey: null,
      },
    ];
  }

  return lines.map((line, index) => ({
    stepKey: normalizeStepKey(line, index),
    title: line.slice(0, 80),
    prompt: `${line}\n\n기대 산출물, 변경 파일, 결정 사항, 다음 단계를 요약하세요.`,
    dependencyStepKey: index === 0 ? null : normalizeStepKey(lines[index - 1], index - 1),
  }));
}

export function createAircraftResearchFlow() {
  const steps = [
    ["requirements", "요구사항 정리", "항공 과제의 목표, 제약 조건, 성능 기준, 필요한 산출물을 정리합니다."],
    ["research", "자료 조사", "관련 자료와 기준을 조사하고 출처, 적용 가능성, 불확실성을 기록합니다."],
    ["variants", "후보안 비교", "여러 개념안을 만들고 장단점, 리스크, 필요한 도구 연결을 비교합니다."],
    ["plan", "실행 계획", "CFD/CAD/문서화로 이어지는 실행 순서와 검증 체크리스트를 계획합니다."],
    ["decision", "결정 로그", "선택한 방향, 근거, 보류 이슈, 다음 액션을 결정 로그로 남깁니다."],
  ] as const;

  return steps.map(([stepKey, title, prompt], index) => ({
    stepKey,
    title,
    prompt: `${prompt}\n\n기대 산출물: ${title} 결과와 다음 단계 입력값.`,
    dependencyStepKey: index === 0 ? null : steps[index - 1][0],
  }));
}

export function createEditableStep(step: TaskFlowStepDetail, index: number): EditableFlowStep {
  return {
    clientId: step.id || `${step.stepKey}-${index}`,
    stepKey: step.stepKey,
    title: step.title,
    prompt: step.prompt,
    dependencyStepKey: step.dependencyStepKey,
  };
}

export function createBlankEditableStep(index: number, previousStepKey?: string | null): EditableFlowStep {
  return {
    clientId: `new-step-${Date.now()}-${index}`,
    stepKey: `step-${index + 1}`,
    title: `Step ${index + 1}`,
    prompt: "",
    dependencyStepKey: previousStepKey ?? null,
  };
}

export function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return items;
  }
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function draftStepForSave(step: EditableFlowStep): TaskFlowStepDraft {
  return {
    stepKey: step.stepKey.trim(),
    title: step.title.trim(),
    prompt: step.prompt.trim(),
    dependencyStepKey: step.dependencyStepKey?.trim() || null,
  };
}

export function validateFlowDraft(title: string, steps: EditableFlowStep[]) {
  const errors: string[] = [];
  if (!title.trim()) {
    errors.push("Flow 제목을 입력하세요.");
  }

  const normalizedSteps = steps.map(draftStepForSave);
  const stepKeys = new Set<string>();
  const dependencyMap = new Map<string, string | null | undefined>();

  normalizedSteps.forEach((step, index) => {
    const stepNumber = index + 1;
    if (!step.stepKey) {
      errors.push(`${stepNumber}번 단계의 Step Key를 입력하세요.`);
    } else if (stepKeys.has(step.stepKey)) {
      errors.push(`Step Key "${step.stepKey}"가 중복되었습니다.`);
    }
    stepKeys.add(step.stepKey);
    dependencyMap.set(step.stepKey, step.dependencyStepKey);
    if (!step.title) {
      errors.push(`${stepNumber}번 단계의 제목을 입력하세요.`);
    }
    if (!step.prompt) {
      errors.push(`${stepNumber}번 단계의 프롬프트를 입력하세요.`);
    }
  });

  normalizedSteps.forEach((step, index) => {
    if (!step.dependencyStepKey) {
      return;
    }
    if (step.dependencyStepKey === step.stepKey) {
      errors.push(`${index + 1}번 단계는 자기 자신에 의존할 수 없습니다.`);
      return;
    }
    if (!stepKeys.has(step.dependencyStepKey)) {
      errors.push(`${index + 1}번 단계의 의존성이 존재하지 않는 Step Key를 참조합니다.`);
      return;
    }
    const seen = new Set<string>([step.stepKey]);
    let current: string | null | undefined = step.dependencyStepKey;
    while (current) {
      if (seen.has(current)) {
        errors.push(`${index + 1}번 단계의 의존성 그래프에 순환이 있습니다.`);
        break;
      }
      seen.add(current);
      current = dependencyMap.get(current);
    }
  });

  return errors;
}

export function groupTasks(tasks: TaskRecord[]) {
  return {
    queued: tasks.filter((task) => task.status === "queued"),
    running: tasks.filter((task) => task.status === "running"),
    attention: tasks.filter((task) => task.status === "failed" || task.status === "timed_out"),
    completed: tasks.filter((task) => task.status === "completed"),
    cancelled: tasks.filter((task) => task.status === "cancelled"),
  };
}

export function safeTaskDebug(task: TaskRecord) {
  return {
    id: task.id,
    title: task.title,
    taskKind: task.taskKind,
    status: task.status,
    scheduledFor: task.scheduledFor,
    runId: task.runId,
    automationRuleId: task.automationRuleId,
    taskFlowId: task.taskFlowId,
    flowStepKey: task.flowStepKey,
    updatedAt: task.updatedAt,
  };
}
