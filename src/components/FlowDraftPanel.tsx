import type { FlowDraft, FlowDraftStep } from "../types";

interface FlowDraftPanelProps {
  disabled: boolean;
  draft: FlowDraft | null;
  error: string | null;
  loading: boolean;
  prompt: string;
  editing: boolean;
  onCancel: () => void;
  onDraftChange: (draft: FlowDraft) => void;
  onEditingChange: (editing: boolean) => void;
  onGenerate: () => void;
  onPromptChange: (prompt: string) => void;
  onSave: () => void;
}

function validateDraft(draft: FlowDraft | null) {
  if (!draft) {
    return [];
  }
  const errors: string[] = [];
  if (!draft.title.trim()) {
    errors.push("Flow 제목을 입력하세요.");
  }
  if (draft.steps.length < 1) {
    errors.push("단계는 1개 이상 필요합니다.");
  }
  if (draft.steps.length > 8) {
    errors.push("단계는 최대 8개까지 가능합니다.");
  }

  const keys = new Set<string>();
  for (const step of draft.steps) {
    if (!step.stepKey.trim()) errors.push("모든 단계에 Step Key가 필요합니다.");
    if (!step.title.trim()) errors.push("모든 단계에 제목이 필요합니다.");
    if (!step.prompt.trim()) errors.push("모든 단계에 프롬프트가 필요합니다.");
    if (keys.has(step.stepKey)) errors.push(`중복 Step Key: ${step.stepKey}`);
    keys.add(step.stepKey);
  }

  const graph = new Map<string, string | null>();
  for (const step of draft.steps) {
    const dependency = step.dependencyStepKey ?? null;
    if (dependency && dependency === step.stepKey) {
      errors.push(`${step.stepKey} 단계는 자기 자신에 의존할 수 없습니다.`);
    }
    if (dependency && !keys.has(dependency)) {
      errors.push(`${step.stepKey} 단계의 의존성 ${dependency}를 찾을 수 없습니다.`);
    }
    graph.set(step.stepKey, dependency);
  }

  for (const step of draft.steps) {
    const seen = new Set<string>();
    let cursor: string | null | undefined = step.stepKey;
    while (cursor) {
      if (seen.has(cursor)) {
        errors.push(`의존성 순환이 있습니다: ${[...seen, cursor].join(" -> ")}`);
        break;
      }
      seen.add(cursor);
      cursor = graph.get(cursor) ?? null;
    }
  }

  return [...new Set(errors)];
}

function updateStep(draft: FlowDraft, index: number, patch: Partial<FlowDraftStep>): FlowDraft {
  const steps = [...draft.steps];
  steps[index] = { ...steps[index], ...patch };
  return { ...draft, steps };
}

function applyLinearDependencies(draft: FlowDraft): FlowDraft {
  return {
    ...draft,
    steps: draft.steps.map((step, index, steps) => ({
      ...step,
      dependencyStepKey: index === 0 ? null : steps[index - 1].stepKey,
    })),
  };
}

function clearDependencies(draft: FlowDraft): FlowDraft {
  return {
    ...draft,
    steps: draft.steps.map((step) => ({ ...step, dependencyStepKey: null })),
  };
}

export function FlowDraftPanel(props: FlowDraftPanelProps) {
  const validationErrors = validateDraft(props.draft);
  const saveDisabled = props.disabled || props.loading || Boolean(validationErrors.length);

  return (
    <section className="cockpit-drawer-panel cockpit-drawer-panel--flow-draft">
      <div className="cockpit-drawer-panel__header">
        <div>
          <h3>Flow 초안</h3>
          <p>채팅 목표를 검토 가능한 장기 작업 단계로 바꿉니다. 저장 전 의존성을 직접 조정할 수 있습니다.</p>
        </div>
        <span>Draft</span>
      </div>

      <label className="cockpit-field">
        <span>목표 또는 요청</span>
        <textarea
          rows={4}
          value={props.prompt}
          onChange={(event) => props.onPromptChange(event.target.value)}
          placeholder="예: 항공 연구 과제를 요구사항 정리, 자료 조사, 후보안 비교, 실행 계획, 검증 보고서 Flow로 나눠줘"
        />
      </label>

      <div className="cockpit-section-actions">
        <button
          className="cockpit-mini-button"
          disabled={props.disabled || props.loading || !props.prompt.trim()}
          onClick={props.onGenerate}
          type="button"
        >
          {props.loading ? "초안 생성 중..." : "Flow로 만들기"}
        </button>
        {props.draft ? (
          <button className="cockpit-mini-button" onClick={props.onCancel} type="button">
            취소
          </button>
        ) : null}
      </div>

      {props.error ? <p className="cockpit-validation-list">{props.error}</p> : null}

      {props.draft ? (
        <div className="flow-draft-review">
          <div className="flow-draft-review__title-row">
            <label className="cockpit-field">
              <span>Flow 제목</span>
              <input
                disabled={!props.editing}
                value={props.draft.title}
                onChange={(event) =>
                  props.onDraftChange({
                    ...props.draft!,
                    title: event.target.value,
                  })
                }
              />
            </label>
            <button
              className="cockpit-mini-button"
              onClick={() => props.onEditingChange(!props.editing)}
              type="button"
            >
              {props.editing ? "검토" : "수정"}
            </button>
          </div>

          {props.editing ? (
            <div className="cockpit-section-actions">
              <button
                className="cockpit-mini-button"
                onClick={() => props.onDraftChange(applyLinearDependencies(props.draft!))}
                type="button"
              >
                선형 연결 자동 적용
              </button>
              <button
                className="cockpit-mini-button"
                onClick={() => props.onDraftChange(clearDependencies(props.draft!))}
                type="button"
              >
                의존성 모두 제거
              </button>
            </div>
          ) : null}

          {validationErrors.length ? (
            <ul className="cockpit-validation-list">
              {validationErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          ) : null}

          <div className="flow-draft-review__steps">
            {props.draft.steps.map((step, index) => (
              <article className="flow-draft-step" key={`${step.stepKey}-${index}`}>
                <span>{index + 1}</span>
                <div>
                  {props.editing ? (
                    <>
                      <input
                        aria-label={`${index + 1}단계 키`}
                        value={step.stepKey}
                        onChange={(event) =>
                          props.onDraftChange(updateStep(props.draft!, index, { stepKey: event.target.value }))
                        }
                      />
                      <input
                        aria-label={`${index + 1}단계 제목`}
                        value={step.title}
                        onChange={(event) =>
                          props.onDraftChange(updateStep(props.draft!, index, { title: event.target.value }))
                        }
                      />
                      <select
                        aria-label={`${index + 1}단계 의존성`}
                        value={step.dependencyStepKey ?? ""}
                        onChange={(event) =>
                          props.onDraftChange(
                            updateStep(props.draft!, index, {
                              dependencyStepKey: event.target.value || null,
                            }),
                          )
                        }
                      >
                        <option value="">의존성 없음</option>
                        {index > 0 ? <option value={props.draft!.steps[index - 1].stepKey}>이전 단계</option> : null}
                        {props.draft!.steps
                          .filter((candidate) => candidate.stepKey !== step.stepKey)
                          .map((candidate) => (
                            <option key={candidate.stepKey} value={candidate.stepKey}>
                              {candidate.title} ({candidate.stepKey})
                            </option>
                          ))}
                      </select>
                      <textarea
                        aria-label={`${index + 1}단계 프롬프트`}
                        rows={4}
                        value={step.prompt}
                        onChange={(event) =>
                          props.onDraftChange(updateStep(props.draft!, index, { prompt: event.target.value }))
                        }
                      />
                    </>
                  ) : (
                    <>
                      <strong>{step.title}</strong>
                      <small>{step.stepKey}</small>
                      {step.dependencyStepKey ? (
                        <small className="status-pill status-pill--configured">depends on {step.dependencyStepKey}</small>
                      ) : (
                        <small className="status-pill status-pill--connected">의존성 없음</small>
                      )}
                      <p>{step.prompt}</p>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>

          <div className="cockpit-section-actions">
            <button
              className="cockpit-mini-button cockpit-mini-button--primary"
              disabled={saveDisabled}
              onClick={props.onSave}
              type="button"
            >
              Flow 생성
            </button>
            <button className="cockpit-mini-button" onClick={props.onCancel} type="button">
              취소
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
