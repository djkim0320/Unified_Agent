import type { AgentHeartbeatRecord, FlowDraftStep, SkillTemplateRecord } from "../types.js";

const CATALOG_TIMESTAMP = Date.UTC(2026, 4, 7);

function chainSteps(
  steps: Array<Omit<FlowDraftStep, "dependencyStepKey">>,
): FlowDraftStep[] {
  return steps.map((step, index) => ({
    ...step,
    dependencyStepKey: index === 0 ? null : steps[index - 1].stepKey,
  }));
}

function template(input: Omit<SkillTemplateRecord, "createdAt" | "updatedAt">): SkillTemplateRecord {
  return {
    ...input,
    scope: "built-in",
    builtIn: true,
    createdAt: CATALOG_TIMESTAMP,
    updatedAt: CATALOG_TIMESTAMP,
  };
}

export const BUILT_IN_SKILL_TEMPLATES: SkillTemplateRecord[] = [
  template({
    id: "codebase-review",
    name: "Codebase Review",
    category: "Engineering",
    summary: "코드베이스를 읽고 위험, 회귀 가능성, 테스트 공백을 정리하는 리뷰 패턴입니다.",
    description:
      "큰 변경 전후에 구조, 보안 경계, 테스트 상태를 검토하도록 opencode 작업을 유도합니다. 실행형 플러그인이 아니라 리뷰 프롬프트와 체크리스트 묶음입니다.",
    standingOrderPatch:
      "- 코드 변경 전에는 관련 파일과 테스트를 먼저 읽는다.\n- 리뷰 결과는 심각도, 파일 위치, 재현 가능성, 권장 수정 순서로 정리한다.\n- 사용자 데이터, secret, workspace 경계를 약화하는 변경은 즉시 중단하고 보고한다.",
    flowTemplate: {
      title: "Codebase Review Flow",
      steps: chainSteps([
        {
          stepKey: "scope",
          title: "검토 범위 확정",
          prompt: "검토할 변경 범위, 관련 파일, 최근 실패나 우려 사항을 정리하세요. 산출물: 리뷰 범위 요약.",
        },
        {
          stepKey: "inspect",
          title: "구현과 경계 조사",
          prompt: "관련 코드와 테스트를 읽고 보안, 데이터 보존, opencode-only 경계 위반 여부를 점검하세요. 산출물: 발견 목록.",
        },
        {
          stepKey: "verify",
          title: "검증 계획 수립",
          prompt: "실행할 테스트와 수동 검증 경로를 제안하고, 누락된 테스트를 정리하세요. 산출물: 검증 체크리스트.",
        },
        {
          stepKey: "report",
          title: "리뷰 보고서 작성",
          prompt: "심각도순 findings, 잔여 리스크, 다음 조치로 리뷰 보고서를 작성하세요.",
        },
      ]),
    },
    verificationChecklist: [
      "보안 경계와 secret 노출 여부 확인",
      "영향 파일과 테스트 파일 연결 확인",
      "회귀 가능성이 큰 API/UI 경로 확인",
      "실행한 검증 명령과 실패 원인 기록",
    ],
    heartbeatInstructions:
      "최근 변경 파일과 실패한 테스트를 확인하고, 미해결 리뷰 항목이 있으면 다음 액션으로 요약하세요.",
    suggestedPrompt:
      "현재 변경 사항을 코드 리뷰 관점으로 점검해 주세요. 보안, 회귀 위험, 테스트 공백을 우선순위로 정리하고 필요한 검증 명령을 제안해 주세요.",
    tags: ["review", "security", "tests"],
  }),
  template({
    id: "implementation-plan",
    name: "Implementation Plan",
    category: "Planning",
    summary: "요구사항을 작은 구현 단계와 검증 단계로 나누는 계획 템플릿입니다.",
    description:
      "애매한 작업을 바로 구현하지 않고, 산출물과 리스크가 보이는 단계형 계획으로 바꾸도록 돕습니다.",
    standingOrderPatch:
      "- 큰 작업은 구현 전에 목표, 변경 범위, 검증 방법, 롤백 가능성을 짧게 정리한다.\n- 각 단계는 독립적으로 검증 가능한 크기로 유지한다.\n- 계획은 실제 파일/라우트/API 이름을 포함해야 한다.",
    flowTemplate: {
      title: "Implementation Plan Flow",
      steps: chainSteps([
        {
          stepKey: "requirements",
          title: "요구사항 정리",
          prompt: "사용자 목표, 불변 조건, 제외 범위, 성공 기준을 정리하세요.",
        },
        {
          stepKey: "architecture",
          title: "구조 매핑",
          prompt: "변경해야 할 서버, 클라이언트, DB, 테스트 위치를 찾고 이유를 설명하세요.",
        },
        {
          stepKey: "plan",
          title: "단계별 구현 계획",
          prompt: "작고 되돌리기 쉬운 구현 순서와 각 단계 검증 방법을 작성하세요.",
        },
        {
          stepKey: "risks",
          title: "리스크와 보류 항목",
          prompt: "숨은 위험, 결정이 필요한 항목, 후속 작업을 정리하세요.",
        },
      ]),
    },
    verificationChecklist: [
      "각 단계가 독립적으로 테스트 가능한지 확인",
      "DB/API/UI 타입 변경이 함께 반영되는지 확인",
      "opencode-only 방향을 깨지 않는지 확인",
    ],
    heartbeatInstructions:
      "진행 중 계획의 완료 단계, 막힌 단계, 다음 검증 명령을 요약하세요.",
    suggestedPrompt:
      "이 작업을 구현 계획으로 나눠 주세요. 관련 파일, 단계별 산출물, 테스트 계획, 위험 요소를 포함해 주세요.",
    tags: ["planning", "implementation", "workflow"],
  }),
  template({
    id: "verification-report",
    name: "Verification Report",
    category: "Quality",
    summary: "테스트/빌드/수동 검증 결과를 보고서로 묶는 템플릿입니다.",
    description:
      "작업이 끝난 뒤 어떤 검증을 했고 무엇이 남았는지 명확히 남기도록 합니다.",
    standingOrderPatch:
      "- 변경 후에는 타입체크, 테스트, 빌드 결과를 명확히 보고한다.\n- 실패가 있으면 원인, 재현 방법, 내 변경과의 관련성을 구분한다.\n- 수동 UI 검증은 관찰 내용과 남은 리스크를 기록한다.",
    flowTemplate: {
      title: "Verification Report Flow",
      steps: chainSteps([
        {
          stepKey: "collect",
          title: "검증 대상 수집",
          prompt: "이번 변경의 영향 범위와 필요한 자동/수동 검증 항목을 수집하세요.",
        },
        {
          stepKey: "run-checks",
          title: "자동 검증 실행",
          prompt: "타입체크, 테스트, 빌드 등 관련 검증 명령을 실행하고 결과를 기록하세요.",
        },
        {
          stepKey: "manual-checks",
          title: "수동 검증 정리",
          prompt: "UI/API 수동 확인이 필요한 경로와 관찰 내용을 정리하세요.",
        },
        {
          stepKey: "report",
          title: "검증 보고서",
          prompt: "통과/실패/미검증 항목과 후속 조치를 보고서로 작성하세요.",
        },
      ]),
    },
    verificationChecklist: [
      "pnpm typecheck 결과",
      "pnpm test 결과",
      "pnpm build 결과",
      "수동 확인이 필요한 화면/라우트",
    ],
    heartbeatInstructions:
      "마지막 검증 이후 새 실패가 있는지 확인하고, 실패가 있으면 첫 번째 재현 명령을 남기세요.",
    suggestedPrompt:
      "현재 변경에 대한 검증 보고서를 작성해 주세요. 실행한 명령, 결과, 남은 리스크, 다음 조치를 포함해 주세요.",
    tags: ["verification", "qa", "report"],
  }),
  template({
    id: "research-summary",
    name: "Research Summary",
    category: "Research",
    summary: "조사 내용을 근거, 불확실성, 다음 질문으로 정리하는 템플릿입니다.",
    description:
      "문서/코드/외부 자료 조사를 한 번의 결론으로 뭉개지 않고 출처와 미확인 영역을 남기도록 합니다.",
    standingOrderPatch:
      "- 조사 결과는 사실, 추론, 미확인 항목을 구분한다.\n- 코드베이스 내부 근거는 파일/라우트/테스트 이름으로 남긴다.\n- 결론에는 다음에 확인할 질문을 포함한다.",
    flowTemplate: {
      title: "Research Summary Flow",
      steps: chainSteps([
        {
          stepKey: "questions",
          title: "질문 정의",
          prompt: "조사 질문, 필요한 근거, 성공 기준을 정리하세요.",
        },
        {
          stepKey: "collect",
          title: "근거 수집",
          prompt: "관련 문서, 코드, 테스트, 기록을 읽고 핵심 근거를 모으세요.",
        },
        {
          stepKey: "synthesize",
          title: "요약과 해석",
          prompt: "사실과 추론을 구분해 조사 결과를 요약하세요.",
        },
        {
          stepKey: "next-questions",
          title: "미해결 질문",
          prompt: "불확실성, 추가 조사 경로, 다음 액션을 정리하세요.",
        },
      ]),
    },
    verificationChecklist: [
      "사실과 추론이 분리되어 있는지 확인",
      "근거 위치가 남아 있는지 확인",
      "미확인 항목이 결론처럼 쓰이지 않았는지 확인",
    ],
    heartbeatInstructions:
      "최근 조사 주제의 새 근거, 미해결 질문, 다음 조사 우선순위를 요약하세요.",
    suggestedPrompt:
      "다음 주제를 조사 요약으로 정리해 주세요. 사실, 추론, 근거 위치, 미해결 질문, 다음 액션을 구분해 주세요.",
    tags: ["research", "summary", "evidence"],
  }),
  template({
    id: "aircraft-research-flow",
    name: "Aircraft Research Flow",
    category: "Aerospace",
    summary: "항공 연구 과제를 요구사항, 조사, 후보안, 실행 계획, 결정 로그로 분해합니다.",
    description:
      "장기 항공 연구를 CFD/CAD 실행 전의 개념 설계와 의사결정 흐름으로 안정적으로 나눕니다.",
    standingOrderPatch:
      "- 항공 과제는 요구사항, 제약, 검증 기준을 먼저 고정한다.\n- 후보안 비교 시 성능, 제작성, 리스크, 검증 비용을 함께 본다.\n- CFD/CAD 실행이 필요한 경우 실제 실행 전 입력 조건과 승인 필요성을 명확히 한다.",
    flowTemplate: {
      title: "Aircraft Research Flow",
      steps: chainSteps([
        {
          stepKey: "requirements",
          title: "요구사항 정리",
          prompt: "항공 과제의 목표, 운용 조건, 제약, 성공 기준, 금지 조건을 정리하세요.",
        },
        {
          stepKey: "research",
          title: "자료 조사",
          prompt: "관련 개념, 선행 사례, 설계 변수, 검증 기준을 조사하고 근거를 남기세요.",
        },
        {
          stepKey: "variants",
          title: "후보안 구성",
          prompt: "가능한 설계 후보를 2~4개 만들고 장단점과 리스크를 비교하세요.",
        },
        {
          stepKey: "execution-plan",
          title: "실행 계획",
          prompt: "각 후보의 검증 순서, 필요한 CFD/CAD 준비물, 산출물 형식을 계획하세요.",
        },
        {
          stepKey: "comparison",
          title: "비교와 선정",
          prompt: "후보안을 기준표로 비교하고 잠정 선택안을 제안하세요.",
        },
        {
          stepKey: "decision-log",
          title: "결정 로그",
          prompt: "선택 근거, 보류 항목, 다음 실험/모델링 액션을 결정 로그로 남기세요.",
        },
      ]),
    },
    verificationChecklist: [
      "요구사항과 제약 조건이 명확한지 확인",
      "후보안 비교 기준이 일관적인지 확인",
      "CFD/CAD 전제와 입력값 공백이 표시되어 있는지 확인",
      "결정 로그에 근거와 보류 항목이 있는지 확인",
    ],
    heartbeatInstructions:
      "항공 연구 Flow의 최신 단계, 결정된 설계 방향, 남은 입력값, 다음 검증 과제를 점검하세요.",
    suggestedPrompt:
      "항공 연구 과제를 단계별 연구 Flow로 구성해 주세요. 요구사항, 조사, 후보안, 실행 계획, 비교, 결정 로그를 포함해 주세요.",
    tags: ["aerospace", "research", "flow"],
  }),
  template({
    id: "cfd-preparation-flow",
    name: "CFD Preparation Flow",
    category: "Aerospace",
    summary: "CFD 실행 전에 케이스 정의, 경계조건, 메시, 수렴 기준을 준비하는 템플릿입니다.",
    description:
      "실제 solver 실행이 아니라, opencode 작업 공간에서 CFD 케이스 준비 체크리스트와 입력 조건을 정리하는 패턴입니다.",
    standingOrderPatch:
      "- CFD 작업은 실제 실행 전에 물리 모델, 단위, 경계조건, 메시 전략, 수렴 기준을 명시한다.\n- solver 실행이나 비용이 큰 작업은 사용자의 명시적 승인 없이는 수행하지 않는다.\n- 결과를 실제 해석 결과처럼 꾸미지 않는다.",
    flowTemplate: {
      title: "CFD Preparation Flow",
      steps: chainSteps([
        {
          stepKey: "case-definition",
          title: "케이스 정의",
          prompt: "해석 목적, 형상 범위, 유동 조건, 단위계, 물리 가정을 정리하세요.",
        },
        {
          stepKey: "boundary-conditions",
          title: "경계조건 정리",
          prompt: "입구/출구/벽면/대칭/원방 경계조건과 필요한 값의 출처를 정리하세요.",
        },
        {
          stepKey: "mesh-plan",
          title: "메시 계획",
          prompt: "메시 전략, 경계층, 품질 기준, 격자 독립성 확인 계획을 작성하세요.",
        },
        {
          stepKey: "solver-plan",
          title: "Solver 계획",
          prompt: "solver 설정, 수렴 기준, 모니터링 변수, 실패 대응 기준을 정리하세요.",
        },
        {
          stepKey: "postprocess-plan",
          title: "후처리 계획",
          prompt: "필요한 결과량, plot/table/report 형식, 검증 방법을 정리하세요.",
        },
      ]),
    },
    verificationChecklist: [
      "단위와 물리 가정 확인",
      "경계조건 값의 출처 확인",
      "메시 품질 기준 확인",
      "수렴/후처리 기준 확인",
    ],
    heartbeatInstructions:
      "CFD 준비 상태에서 누락된 입력값, 승인 필요한 실행, 다음 준비 항목을 요약하세요.",
    suggestedPrompt:
      "CFD 실행 전 준비 Flow를 만들어 주세요. 케이스 정의, 경계조건, 메시 계획, solver 계획, 후처리 계획을 포함해 주세요.",
    tags: ["cfd", "aerospace", "preparation"],
  }),
  template({
    id: "documentation-writer",
    name: "Documentation Writer",
    category: "Documentation",
    summary: "변경 사항을 README/운영 가이드/개발 문서로 정리하는 템플릿입니다.",
    description:
      "실제 구현과 문서 사이의 불일치를 줄이도록 문서 범위, 사용자 경로, 검증 명령을 함께 기록합니다.",
    standingOrderPatch:
      "- 문서는 실제 현재 동작과 API 이름을 기준으로 작성한다.\n- 실행 방법, 제한사항, 안전 경계를 빠뜨리지 않는다.\n- 오래된 기능이나 제거된 런타임을 다시 존재하는 것처럼 쓰지 않는다.",
    flowTemplate: {
      title: "Documentation Writer Flow",
      steps: chainSteps([
        {
          stepKey: "doc-scope",
          title: "문서 범위 정리",
          prompt: "업데이트할 문서와 독자, 포함/제외 범위를 정리하세요.",
        },
        {
          stepKey: "facts",
          title: "현재 동작 확인",
          prompt: "코드와 라우트를 확인해 실제 동작, 명령, 제한사항을 수집하세요.",
        },
        {
          stepKey: "write",
          title: "문서 작성",
          prompt: "사용자가 따라 할 수 있는 구조로 문서를 업데이트하세요.",
        },
        {
          stepKey: "verify-docs",
          title: "문서 검증",
          prompt: "문서의 명령, 링크, API 이름, 제거된 기능 언급 여부를 확인하세요.",
        },
      ]),
    },
    verificationChecklist: [
      "문서의 명령이 package.json과 일치하는지 확인",
      "라우트와 타입 이름이 실제 코드와 일치하는지 확인",
      "제거된 legacy runtime을 부활시킨 표현이 없는지 확인",
    ],
    heartbeatInstructions:
      "최근 변경과 문서가 어긋나는 부분이 있는지 확인하고 업데이트 후보를 요약하세요.",
    suggestedPrompt:
      "현재 변경 내용을 사용자 문서로 정리해 주세요. 실행 방법, API, 제한사항, 안전 경계를 포함해 주세요.",
    tags: ["docs", "guide", "readme"],
  }),
  template({
    id: "debugging-assistant",
    name: "Debugging Assistant",
    category: "Quality",
    summary: "재현, 가설, 관찰, 수정, 검증 순서로 버그를 다루는 템플릿입니다.",
    description:
      "무작정 수정하지 않고 오류를 좁혀가며 opencode가 안전하게 원인을 찾도록 유도합니다.",
    standingOrderPatch:
      "- 버그 수정은 재현 조건과 기대/실제 동작을 먼저 기록한다.\n- 원인 가설을 세우고 가장 작은 확인부터 수행한다.\n- 수정 후에는 실패했던 경로와 인접 경로를 다시 검증한다.",
    flowTemplate: {
      title: "Debugging Assistant Flow",
      steps: chainSteps([
        {
          stepKey: "reproduce",
          title: "재현 조건 정리",
          prompt: "버그 증상, 재현 단계, 기대/실제 결과, 로그를 정리하세요.",
        },
        {
          stepKey: "hypotheses",
          title: "원인 가설",
          prompt: "가능한 원인을 우선순위와 확인 방법으로 정리하세요.",
        },
        {
          stepKey: "inspect",
          title: "관련 코드 조사",
          prompt: "가설과 관련된 코드, API, 상태 흐름, 테스트를 조사하세요.",
        },
        {
          stepKey: "fix-plan",
          title: "수정 계획",
          prompt: "가장 작은 수정안과 검증 계획을 작성하세요.",
        },
        {
          stepKey: "verify",
          title: "수정 검증",
          prompt: "재현 경로와 회귀 경로 검증 결과를 정리하세요.",
        },
      ]),
    },
    verificationChecklist: [
      "재현 단계가 구체적인지 확인",
      "수정 전후 관찰이 기록됐는지 확인",
      "원인과 증상이 분리되어 있는지 확인",
      "회귀 테스트가 있는지 확인",
    ],
    heartbeatInstructions:
      "열려 있는 버그의 재현 가능 상태, 마지막 가설, 다음 확인 명령을 요약하세요.",
    suggestedPrompt:
      "다음 문제를 디버깅 절차로 다뤄 주세요. 재현, 가설, 관련 코드 조사, 수정 계획, 검증 순서로 정리해 주세요.",
    tags: ["debugging", "bug", "verification"],
  }),
  template({
    id: "release-checklist",
    name: "Release Checklist",
    category: "Operations",
    summary: "릴리스 전 문서, 테스트, 보안, 마이그레이션, 롤백 상태를 확인하는 템플릿입니다.",
    description:
      "작업 완료 직전에 놓치기 쉬운 품질·운영 항목을 체크리스트와 Flow로 정리합니다.",
    standingOrderPatch:
      "- 릴리스 전에는 타입체크, 테스트, 빌드, 문서, 마이그레이션, 롤백 가능성을 확인한다.\n- 위험 플래그나 secret 노출 가능성이 있으면 릴리스 노트에 명시한다.\n- 검증하지 못한 항목은 통과처럼 쓰지 않는다.",
    flowTemplate: {
      title: "Release Checklist Flow",
      steps: chainSteps([
        {
          stepKey: "scope",
          title: "릴리스 범위",
          prompt: "릴리스에 포함되는 변경, 제외되는 항목, 사용자 영향 범위를 정리하세요.",
        },
        {
          stepKey: "quality-gates",
          title: "품질 게이트",
          prompt: "타입체크, 테스트, 빌드, 수동 확인 항목을 점검하세요.",
        },
        {
          stepKey: "safety",
          title: "보안과 데이터",
          prompt: "secret, local API token, DB migration, workspace 데이터 보존 리스크를 확인하세요.",
        },
        {
          stepKey: "notes",
          title: "릴리스 노트",
          prompt: "주요 변경, 검증 결과, 알려진 제한, 롤백/후속 작업을 작성하세요.",
        },
      ]),
    },
    verificationChecklist: [
      "pnpm typecheck/test/build 결과",
      "DB migration idempotency",
      "secret/path 노출 여부",
      "릴리스 노트와 알려진 제한",
    ],
    heartbeatInstructions:
      "릴리스 후보의 남은 gate, 실패한 검증, 출시 전 결정이 필요한 항목을 점검하세요.",
    suggestedPrompt:
      "릴리스 체크리스트를 작성해 주세요. 포함 범위, 검증 결과, 보안/데이터 리스크, 알려진 제한, 후속 작업을 포함해 주세요.",
    tags: ["release", "operations", "quality"],
  }),
];

export function listBuiltInSkillTemplates() {
  return BUILT_IN_SKILL_TEMPLATES;
}

export function listSkillTemplates(customTemplates: SkillTemplateRecord[] = []) {
  return [...BUILT_IN_SKILL_TEMPLATES, ...customTemplates];
}

export function getSkillTemplate(templateId: string) {
  return BUILT_IN_SKILL_TEMPLATES.find((template) => template.id === templateId) ?? null;
}

function marker(kind: "standing-orders" | "heartbeat", templateId: string) {
  return `<!-- aetherops-skill-template:${kind}:${templateId} -->`;
}

function normalizeEnd(content: string) {
  return content.trimEnd();
}

export function hasSkillTemplateSection(
  kind: "standing-orders" | "heartbeat",
  content: string,
  template: SkillTemplateRecord,
) {
  return content.includes(marker(kind, template.id)) || content.includes(`## Skill: ${template.name}`);
}

export function appendSkillTemplateToStandingOrders(
  content: string,
  template: SkillTemplateRecord,
) {
  if (hasSkillTemplateSection("standing-orders", content, template)) {
    return { content, applied: false };
  }

  const section = [
    marker("standing-orders", template.id),
    `## Skill: ${template.name}`,
    "",
    template.standingOrderPatch,
  ].join("\n");
  return {
    content: `${normalizeEnd(content)}\n\n${section}\n`,
    applied: true,
  };
}

export function appendSkillTemplateToHeartbeat(
  heartbeat: AgentHeartbeatRecord,
  template: SkillTemplateRecord,
) {
  if (hasSkillTemplateSection("heartbeat", heartbeat.instructions, template)) {
    return { instructions: heartbeat.instructions, applied: false };
  }

  const section = [
    marker("heartbeat", template.id),
    `## Skill: ${template.name}`,
    "",
    template.heartbeatInstructions,
  ].join("\n");
  return {
    instructions: `${normalizeEnd(heartbeat.instructions)}\n\n${section}\n`,
    applied: true,
  };
}
