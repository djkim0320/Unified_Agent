import type { ResearchLoopRecord, ResearchProjectRecord, ResearchQuestionRecord } from "../../types.js";

export type ResearchBudgetCheckStatus = "ok" | "warn" | "error";

export interface ResearchBudgetCheck {
  id: string;
  label: string;
  status: ResearchBudgetCheckStatus;
  message: string;
}

export interface ResearchBudgetEvaluation {
  ok: boolean;
  blocked: boolean;
  errors: string[];
  warnings: string[];
  checks: ResearchBudgetCheck[];
  loopsToday: number;
  openQuestionCount: number;
}

export interface EvaluateResearchBudgetInput {
  project: ResearchProjectRecord;
  loops: ResearchLoopRecord[];
  questions: ResearchQuestionRecord[];
  proposedStepCount?: number;
  autoStart?: boolean;
  manualStart?: boolean;
  approvalGatePresent?: boolean;
  dangerousAutoApprove?: boolean;
  now?: number;
}

function pushCheck(
  checks: ResearchBudgetCheck[],
  errors: string[],
  warnings: string[],
  check: ResearchBudgetCheck,
) {
  checks.push(check);
  if (check.status === "error") {
    errors.push(check.message);
  }
  if (check.status === "warn") {
    warnings.push(check.message);
  }
}

export function evaluateResearchBudget(input: EvaluateResearchBudgetInput): ResearchBudgetEvaluation {
  const now = input.now ?? Date.now();
  const checks: ResearchBudgetCheck[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const budget = input.project.autonomyBudget;
  const openQuestionCount = input.questions.filter(
    (question) => question.status === "open" || question.status === "investigating",
  ).length;
  const loopsToday = input.loops.filter((loop) => loop.createdAt >= now - 24 * 60 * 60 * 1000).length;
  const activeLoopCount = input.loops.filter((loop) =>
    ["queued", "running", "waiting_approval"].includes(loop.status),
  ).length;
  const isExecutionRequest = Boolean(input.autoStart || input.manualStart);

  pushCheck(
    checks,
    errors,
    warnings,
    input.project.status === "active"
      ? { id: "project", label: "Project", status: "ok", message: "연구 프로젝트가 활성 상태입니다." }
      : {
          id: "project",
          label: "Project",
          status: "error",
          message: "활성 상태의 연구 프로젝트만 Loop를 제안하거나 실행할 수 있습니다.",
        },
  );

  pushCheck(
    checks,
    errors,
    warnings,
    openQuestionCount > 0
      ? { id: "questions", label: "Questions", status: "ok", message: "열린 연구 질문이 있습니다." }
      : {
          id: "questions",
          label: "Questions",
          status: "error",
          message: "연구 Loop를 만들려면 열린 연구 질문이 1개 이상 필요합니다.",
        },
  );

  if (input.autoStart && !input.project.autonomyEnabled) {
    pushCheck(checks, errors, warnings, {
      id: "autonomy",
      label: "Autonomy",
      status: "error",
      message: "프로젝트 자율 실행이 꺼져 있어 autoStart를 사용할 수 없습니다.",
    });
  } else {
    pushCheck(checks, errors, warnings, {
      id: "autonomy",
      label: "Autonomy",
      status: input.project.autonomyEnabled ? "ok" : "warn",
      message: input.project.autonomyEnabled
        ? "프로젝트 자율 실행이 켜져 있습니다."
        : "자율 실행은 꺼져 있습니다. 수동으로 제안한 Loop는 검토 후 실행할 수 있습니다.",
    });
  }

  const maxLoopsPerDay = Number(budget.maxLoopsPerDay ?? 3);
  const loopBudgetExceeded = loopsToday >= maxLoopsPerDay;
  pushCheck(
    checks,
    errors,
    warnings,
    loopBudgetExceeded && isExecutionRequest
      ? {
          id: "daily-loop-budget",
          label: "Budget",
          status: "error",
          message: `오늘 연구 Loop 예산을 초과했습니다. (${loopsToday}/${maxLoopsPerDay})`,
        }
      : {
          id: "daily-loop-budget",
          label: "Budget",
          status: loopBudgetExceeded ? "warn" : "ok",
          message: `오늘 연구 Loop 사용량: ${loopsToday}/${maxLoopsPerDay}`,
        },
  );

  const maxConsecutiveLoops = Number(budget.maxConsecutiveLoops ?? 1);
  const consecutiveExceeded = activeLoopCount >= maxConsecutiveLoops;
  pushCheck(
    checks,
    errors,
    warnings,
    consecutiveExceeded && isExecutionRequest
      ? {
          id: "consecutive-loop-budget",
          label: "Budget",
          status: "error",
          message: `동시에 진행 가능한 연구 Loop 수를 초과했습니다. (${activeLoopCount}/${maxConsecutiveLoops})`,
        }
      : {
          id: "consecutive-loop-budget",
          label: "Budget",
          status: consecutiveExceeded ? "warn" : "ok",
          message: `진행 중 또는 대기 중 Loop: ${activeLoopCount}/${maxConsecutiveLoops}`,
        },
  );

  const maxTasksPerLoop = Number(budget.maxTasksPerLoop ?? 7);
  if (typeof input.proposedStepCount === "number" && input.proposedStepCount > maxTasksPerLoop) {
    pushCheck(checks, errors, warnings, {
      id: "loop-step-budget",
      label: "Budget",
      status: "error",
      message: `제안된 Flow 단계 수가 Loop당 작업 예산을 초과했습니다. (${input.proposedStepCount}/${maxTasksPerLoop})`,
    });
  }

  const approvalRequired =
    Boolean(budget.requireApprovalForExternal) ||
    Boolean(budget.requireApprovalForFileWrites) ||
    Boolean(budget.requireApprovalForCommandExecution);
  if (approvalRequired && input.approvalGatePresent === false) {
    pushCheck(checks, errors, warnings, {
      id: "approval-gate",
      label: "Approval",
      status: "error",
      message: "현재 안전 정책은 승인 게이트를 요구하지만 제안된 Flow에 승인 게이트가 없습니다.",
    });
  } else {
    pushCheck(checks, errors, warnings, {
      id: "approval-gate",
      label: "Approval",
      status: "ok",
      message: approvalRequired ? "승인 게이트가 안전 정책 요구사항을 충족합니다." : "승인 게이트는 선택 사항입니다.",
    });
  }

  if (input.dangerousAutoApprove) {
    pushCheck(checks, errors, warnings, {
      id: "dangerous-auto-approve",
      label: "Safety",
      status: "warn",
      message: "위험한 opencode 권한 자동 승인 플래그가 켜져 있습니다. 연구 실행 전 확인이 필요합니다.",
    });
  }

  return {
    ok: errors.length === 0,
    blocked: errors.length > 0,
    errors,
    warnings,
    checks,
    loopsToday,
    openQuestionCount,
  };
}
