import type { FlowDraft, FlowDraftStep } from "../types.js";

const MAX_FLOW_STEPS = 8;

const GENERIC_STEPS = [
  ["requirements", "요구사항 정리", "목표, 제약 조건, 성공 기준, 필요한 산출물을 정리합니다."],
  ["research", "자료 조사", "필요한 자료와 현재 맥락을 조사하고 근거와 불확실성을 기록합니다."],
  ["options", "대안 설계", "가능한 접근안과 장단점, 리스크를 비교합니다."],
  ["implementation-plan", "실행 계획", "실행 순서, 필요한 파일/작업, 검증 방법을 계획합니다."],
  ["verification", "검증", "산출물이 요구사항을 만족하는지 확인하고 누락된 부분을 점검합니다."],
  ["summary", "요약 및 다음 단계", "결과, 결정 사항, 남은 질문, 다음 액션을 정리합니다."],
] as const;

function stripListPrefix(line: string) {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
}

function splitOutline(prompt: string) {
  const numbered = prompt
    .split(/\r?\n/)
    .map(stripListPrefix)
    .filter(Boolean);
  if (numbered.length >= 2) {
    return numbered.slice(0, MAX_FLOW_STEPS);
  }

  const sentences = prompt
    .split(/[.;\n]/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 12);
  return sentences.length >= 2 ? sentences.slice(0, MAX_FLOW_STEPS) : [];
}

export function sanitizeStepKey(value: string, fallbackIndex: number, used = new Set<string>()) {
  const romanizedHints: Array<[RegExp, string]> = [
    [/요구|조건|require/i, "requirements"],
    [/조사|자료|research/i, "research"],
    [/대안|후보|옵션|variant|option/i, "options"],
    [/실행|구현|계획|plan|implement/i, "implementation-plan"],
    [/검증|테스트|확인|verify|test/i, "verification"],
    [/요약|정리|summary/i, "summary"],
  ];
  const hinted = romanizedHints.find(([pattern]) => pattern.test(value))?.[1];
  const raw = hinted ?? value;
  const base =
    raw
      .toLowerCase()
      .replace(/^[\d.)\-\s]+/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || `step-${fallbackIndex + 1}`;

  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function stepPrompt(goal: string, title: string, guidance: string) {
  return [
    `목표: ${goal}`,
    "",
    `이번 단계: ${title}`,
    guidance,
    "",
    "기대 산출물:",
    "- 수행한 내용",
    "- 변경/생성된 파일 또는 근거",
    "- 결정 사항",
    "- 다음 단계에 넘길 입력",
  ].join("\n");
}

export function generateFlowDraft(input: { prompt: string; title?: string | null }): FlowDraft {
  const goal = input.prompt.trim();
  const title = input.title?.trim() || goal.slice(0, 72) || "새 Flow 초안";
  const outline = splitOutline(goal);
  const used = new Set<string>();
  const sourceSteps =
    outline.length > 0
      ? outline.map((line) => [line, line, "이 단계의 목적을 명확히 하고 필요한 산출물을 생성합니다."] as const)
      : GENERIC_STEPS;

  const steps: FlowDraftStep[] = sourceSteps.slice(0, MAX_FLOW_STEPS).map((step, index) => {
    const [hintKey, stepTitle, guidance] = step;
    const stepKey = sanitizeStepKey(hintKey, index, used);
    return {
      stepKey,
      title: stepTitle.slice(0, 100),
      prompt: stepPrompt(goal, stepTitle, guidance),
      dependencyStepKey: index === 0 ? null : null,
    };
  });

  return {
    title,
    steps: steps.map((step, index) => ({
      ...step,
      dependencyStepKey: index === 0 ? null : steps[index - 1].stepKey,
    })),
  };
}

