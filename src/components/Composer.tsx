import { useEffect, useMemo, useRef, useState } from "react";
import { getModelOption } from "../model-catalog";
import {
  getReasoningLabel,
  getReasoningOptions,
  normalizeReasoningLevel,
} from "../reasoning-options";
import {
  providerKinds,
  providerLabels,
  type ProviderKind,
  type ProviderSummary,
  type ReasoningLevel,
} from "../types";

interface ComposerProps {
  providerKind: ProviderKind;
  providers: ProviderSummary[];
  model: string;
  modelsByProvider: Record<ProviderKind, string[]>;
  loadingByProvider: Record<ProviderKind, boolean>;
  reasoningLevel: ReasoningLevel;
  message: string;
  disabled: boolean;
  section?: "chat" | "workspace";
  onOpenSettings: () => void;
  onModelSelect: (providerKind: ProviderKind, model: string) => void;
  onReasoningChange: (reasoningLevel: ReasoningLevel) => void;
  onMessageChange: (message: string) => void;
  onSend: () => void;
}

function isProviderEnabled(provider: ProviderSummary | undefined) {
  return Boolean(provider && (provider.configured || provider.status !== "disconnected"));
}

export function Composer(props: ComposerProps) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement | null>(null);
  const reasoningPickerRef = useRef<HTMLDivElement | null>(null);
  const layoutSection = props.section ?? "chat";

  const providersByKind = useMemo(
    () =>
      Object.fromEntries(props.providers.map((provider) => [provider.kind, provider])) as Record<
        ProviderKind,
        ProviderSummary
      >,
    [props.providers],
  );

  const orderedProviderKinds = useMemo(
    () =>
      [...providerKinds].sort((left, right) => {
        const leftEnabled = isProviderEnabled(providersByKind[left]);
        const rightEnabled = isProviderEnabled(providersByKind[right]);
        return Number(rightEnabled) - Number(leftEnabled);
      }),
    [providersByKind],
  );

  const selectedModel = getModelOption(props.providerKind, props.model);
  const reasoningOptions = getReasoningOptions(props.providerKind, props.model);
  const selectedReasoning = normalizeReasoningLevel(
    props.providerKind,
    props.model,
    props.reasoningLevel,
  );

  useEffect(() => {
    setModelMenuOpen(false);
    setReasoningMenuOpen(false);
  }, [props.providerKind, props.model, props.reasoningLevel]);

  useEffect(() => {
    if (!modelMenuOpen && !reasoningMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (modelPickerRef.current?.contains(target) || reasoningPickerRef.current?.contains(target)) {
        return;
      }
      setModelMenuOpen(false);
      setReasoningMenuOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModelMenuOpen(false);
        setReasoningMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [modelMenuOpen, reasoningMenuOpen]);

  return (
    <section className={`composer ${layoutSection === "workspace" ? "is-detached" : ""}`}>
      <div className="composer__shell composer__shell--prompt">
        <textarea
          className="composer__textarea"
          rows={4}
          value={props.message}
          onChange={(event) => props.onMessageChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              props.onSend();
            }
          }}
          placeholder="에이전트에게 다음 작업을 요청해보세요"
        />

        <div className="composer__footer composer__footer--prompt">
          <div className="composer__control-row">
            <button
              aria-label="프로바이더 설정 열기"
              className="composer__icon-button composer__icon-button--text"
              onClick={props.onOpenSettings}
              type="button"
            >
              API
            </button>

            <div className="composer-picker" ref={modelPickerRef}>
              <button
                aria-expanded={modelMenuOpen}
                aria-haspopup="listbox"
                aria-label={`모델 선택: ${selectedModel.label}`}
                className="composer-picker__trigger"
                onClick={() => {
                  setModelMenuOpen((open) => !open);
                  setReasoningMenuOpen(false);
                }}
                type="button"
              >
                <span className="composer-picker__value">{selectedModel.label}</span>
                <span className="composer-picker__caret" aria-hidden="true">
                  ▾
                </span>
              </button>

              {modelMenuOpen ? (
                <div
                  aria-label="모델 선택지"
                  className="composer-picker__menu composer-picker__menu--grouped"
                  role="listbox"
                >
                  {orderedProviderKinds.map((kind) => {
                    const provider = providersByKind[kind];
                    const enabled = isProviderEnabled(provider);
                    const providerModels = props.modelsByProvider[kind] ?? [];
                    const options = providerModels.map((model) => getModelOption(kind, model));

                    if (kind === props.providerKind && !options.some((option) => option.id === props.model)) {
                      options.unshift(selectedModel);
                    }

                    return (
                      <section
                        className={`composer-picker__section ${enabled ? "" : "is-disabled"}`}
                        key={kind}
                      >
                        <div className="composer-picker__section-header">
                          <span className="composer-picker__section-title">
                            {provider?.label ?? providerLabels[kind]}
                          </span>
                          <span className="composer-picker__section-meta">
                            {props.loadingByProvider[kind]
                              ? "불러오는 중"
                              : enabled
                                ? "사용 가능"
                                : "연결 필요"}
                          </span>
                        </div>

                        <div className="composer-picker__section-options">
                          {options.map((option) => {
                            const selected = kind === props.providerKind && option.id === props.model;
                            return (
                              <button
                                aria-selected={selected}
                                className={`composer-picker__option ${selected ? "is-selected" : ""}`}
                                disabled={!enabled}
                                key={`${kind}:${option.id}`}
                                onClick={() => {
                                  props.onModelSelect(kind, option.id);
                                  setModelMenuOpen(false);
                                }}
                                role="option"
                                type="button"
                              >
                                <span className="composer-picker__option-title">{option.label}</span>
                                <span className="composer-picker__option-note">{option.note}</span>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div className="composer-picker" ref={reasoningPickerRef}>
              <button
                aria-expanded={reasoningMenuOpen}
                aria-haspopup="listbox"
                aria-label={`추론 수준 선택: ${getReasoningLabel(
                  props.providerKind,
                  props.model,
                  selectedReasoning,
                )}`}
                className="composer-picker__trigger"
                disabled={reasoningOptions.length <= 1}
                onClick={() => {
                  if (reasoningOptions.length <= 1) {
                    return;
                  }
                  setReasoningMenuOpen((open) => !open);
                  setModelMenuOpen(false);
                }}
                type="button"
              >
                <span className="composer-picker__value">
                  {getReasoningLabel(props.providerKind, props.model, selectedReasoning)}
                </span>
                <span className="composer-picker__caret" aria-hidden="true">
                  ▾
                </span>
              </button>

              {reasoningMenuOpen ? (
                <div aria-label="추론 수준 선택지" className="composer-picker__menu" role="listbox">
                  {reasoningOptions.map((option) => {
                    const selected = option.value === selectedReasoning;
                    return (
                      <button
                        aria-selected={selected}
                        className={`composer-picker__option ${selected ? "is-selected" : ""}`}
                        key={option.value}
                        onClick={() => {
                          props.onReasoningChange(option.value);
                          setReasoningMenuOpen(false);
                        }}
                        role="option"
                        type="button"
                      >
                        <span className="composer-picker__option-title">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>

          <div className="composer__action-row">
            <span className="composer__meta">Enter 전송, Shift+Enter 줄바꿈</span>
            <button
              aria-label="메시지 보내기"
              className="composer__send composer__send--icon"
              disabled={props.disabled || !props.message.trim()}
              onClick={props.onSend}
              type="button"
            >
              ↑
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
