# ADR 001: Agent Gateway Architecture

## 상태

승인됨

## 배경

기존 Unified_Agent는 대화 중심 웹 채팅 앱이었다. 그러나 목표는 단순 채팅을 넘어서 로컬 우선 에이전트 플랫폼으로 확장하는 것이다. 이때 가장 큰 위험은 다음 두 가지였다.

- 새로운 자율성을 기존 대화 중심 구조에 그대로 덕지덕지 붙이면서 상태 관리가 무너지는 것
- 안전하지 않은 워크스페이스/실행/웹 조사 기반 위에 더 강한 에이전트를 올리는 것

## 결정

다음 구조를 채택한다.

### 1. Webchat-first Agent Gateway

서버는 장기 실행되는 로컬 게이트웨이 프로세스로 동작한다.

- 입력 채널은 추상화하되 현재는 `webchat`만 지원한다.
- 각 입력은 `agent -> session(conversation) -> run`으로 라우팅한다.

### 2. Conversation을 세션으로 승격

호환성을 위해 기존 `conversations` 테이블을 유지한다. 다만 의미는 세션으로 해석한다.

- `agent_id`로 에이전트 소유권을 부여한다.
- `channel_kind=webchat`을 저장한다.

### 3. Tool Registry + Plugin Manager

도구는 런타임 내부 switch 문에 박아두지 않고 레지스트리에 등록한다.

- 각 도구는 이름, 설명, 권한, Zod 스키마, 예시, 실행 함수를 가진다.
- 코어 파일/웹/브라우저/메모리/태스크 도구는 `server/plugins/core.ts`에서 등록한다.
- 플래너 프롬프트는 레지스트리에서 도구 가이드를 생성한다.

### 4. File-backed Memory

메모리는 숨겨진 DB 조각이 아니라 로컬 파일을 기준으로 유지한다.

- 영속 메모리: `MEMORY.md`
- 일일 메모: `memory/YYYY-MM-DD.md`

### 5. Detached Task Ledger

긴 작업은 채팅 턴과 분리된 태스크로 실행한다.

- 상태: `queued`, `running`, `completed`, `failed`, `timed_out`, `cancelled`
- 이벤트 원장으로 상태 전이를 추적한다.
- 필요 시 결과를 원래 세션에 다시 전달한다.

## 이유

- 기존 UX를 깨지 않고도 다중 에이전트와 세션 중심 모델을 도입할 수 있다.
- 파일 기반 메모리는 로컬 우선 철학과 디버깅 가능성을 모두 만족한다.
- 레지스트리 기반 도구 시스템은 향후 플러그인/권한/감사 확장에 유리하다.
- 태스크 원장은 장기 작업, 자동화, 재시도 정책의 기반이 된다.

## 결과

긍정적 효과:

- 기존 채팅 UX를 유지하면서도 다중 에이전트, 메모리, 태스크를 지원한다.
- 도구 호출과 실행 기록이 더 명시적이고 감사 가능해진다.
- 향후 채널/플러그인 확장 포인트가 생긴다.

부정적 효과:

- `App.tsx`와 `server/app.ts`에 과도한 오케스트레이션이 남아 있어 추가 분리가 필요하다.
- 일부 프로바이더는 아직 strict JSON 플래닝 경로에 더 많이 의존한다.

## 후속 작업

- frontend 훅 계층 분리 (`useAgents`, `useSessions`, `useWorkspace`, `useTasks`, `useMemory`)
- provider-native structured tool calling 확대
- plugin manifest 검증 및 권한 정책 강화
- 반복 자동화 스케줄러와 인박스 연결
