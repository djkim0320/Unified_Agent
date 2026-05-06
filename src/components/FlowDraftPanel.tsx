import type { FlowDraft } from "../types";

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

export function FlowDraftPanel(props: FlowDraftPanelProps) {
  return (
    <section className="cockpit-drawer-panel cockpit-drawer-panel--flow-draft">
      <div className="cockpit-drawer-panel__header">
        <div>
          <h3>Flow 초안</h3>
          <p>채팅 목표를 실행 가능한 장기 작업 단계로 바꿉니다.</p>
        </div>
        <span>Draft</span>
      </div>

      <label className="cockpit-field">
        <span>목표 또는 요청</span>
        <textarea
          rows={4}
          value={props.prompt}
          onChange={(event) => props.onPromptChange(event.target.value)}
          placeholder="예: 항공 과제 요구사항을 정리하고 조사, 후보안 비교, 실행 계획까지 Flow로 만들어줘"
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
                        onChange={(event) => {
                          const steps = [...props.draft!.steps];
                          steps[index] = { ...step, stepKey: event.target.value };
                          props.onDraftChange({ ...props.draft!, steps });
                        }}
                      />
                      <input
                        aria-label={`${index + 1}단계 제목`}
                        value={step.title}
                        onChange={(event) => {
                          const steps = [...props.draft!.steps];
                          steps[index] = { ...step, title: event.target.value };
                          props.onDraftChange({ ...props.draft!, steps });
                        }}
                      />
                      <textarea
                        aria-label={`${index + 1}단계 프롬프트`}
                        rows={4}
                        value={step.prompt}
                        onChange={(event) => {
                          const steps = [...props.draft!.steps];
                          steps[index] = { ...step, prompt: event.target.value };
                          props.onDraftChange({ ...props.draft!, steps });
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <strong>{step.title}</strong>
                      <small>{step.stepKey}</small>
                      <p>{step.prompt}</p>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>

          <div className="cockpit-section-actions">
            <button className="cockpit-mini-button cockpit-mini-button--primary" onClick={props.onSave} type="button">
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
