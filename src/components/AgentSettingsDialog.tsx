import { useEffect, useState } from "react";
import { CustomSelect } from "./ui/CustomSelect";
import { getModelOption } from "../model-catalog";
import {
  getReasoningLabel,
  getReasoningOptions,
  normalizeReasoningLevel,
} from "../reasoning-options";
import {
  providerKinds,
  providerLabels,
  type AgentHeartbeatRecord,
  type AgentRecord,
  type AgentSoulRecord,
  type ProviderKind,
  type ProviderSummary,
  type ReasoningLevel,
  type StandingOrdersRecord,
} from "../types";

export interface AgentDraft {
  name: string;
  providerKind: ProviderKind;
  model: string;
  reasoningLevel: ReasoningLevel;
}

export interface AgentHeartbeatDraft {
  enabled: boolean;
  intervalMinutes: string;
  instructions: string;
}

export type AgentSoulDraft = string;

interface AgentSettingsDialogProps {
  activeAgentId: string | null;
  agents: AgentRecord[];
  deletingAgentId: string | null;
  draft: AgentDraft;
  heartbeat: AgentHeartbeatRecord | null;
  heartbeatDraft: AgentHeartbeatDraft;
  modelsByProvider: Record<ProviderKind, string[]>;
  notice: string | null;
  onClose: () => void;
  onCreate: () => void;
  onDelete: (agentId: string) => void;
  onDraftChange: (draft: AgentDraft) => void;
  onHeartbeatDraftChange: (draft: AgentHeartbeatDraft) => void;
  onSave: () => void;
  onSaveStandingOrders: () => void;
  onSoulDraftChange: (content: AgentSoulDraft) => void;
  onStandingOrdersDraftChange: (content: string) => void;
  open: boolean;
  providers: ProviderSummary[];
  saving: boolean;
  savingStandingOrders: boolean;
  soul: AgentSoulRecord | null;
  soulDraft: AgentSoulDraft;
  standingOrders: StandingOrdersRecord | null;
  standingOrdersDraft: string;
}

const DEFAULT_AGENT_ID = "default-agent";

function isProviderEnabled(provider: ProviderSummary | null | undefined) {
  return Boolean(provider && (provider.configured || provider.status !== "disconnected"));
}

function getProviderStatusLabel(provider: ProviderSummary | null | undefined) {
  if (!provider) {
    return "not configured";
  }

  return isProviderEnabled(provider) ? "available" : "needs setup";
}

function getAgentSummary(agent: AgentRecord) {
  return `${providerLabels[agent.providerKind]} / ${getModelOption(agent.providerKind, agent.model).label} / ${getReasoningLabel(
    agent.providerKind,
    agent.model,
    agent.reasoningLevel,
  )}`;
}

function formatMaybeDateString(value: string | null) {
  if (!value) {
    return "none";
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(parsed));
}

export function AgentSettingsDialog({
  activeAgentId,
  agents,
  deletingAgentId,
  draft,
  heartbeat,
  heartbeatDraft,
  modelsByProvider,
  notice,
  onClose,
  onCreate,
  onDelete,
  onDraftChange,
  onHeartbeatDraftChange,
  onSave,
  onSaveStandingOrders,
  onSoulDraftChange,
  onStandingOrdersDraftChange,
  open,
  providers,
  saving,
  savingStandingOrders,
  soul,
  soulDraft,
  standingOrders,
  standingOrdersDraft,
}: AgentSettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<"general" | "soul" | "heartbeat" | "standing-orders">(
    "general",
  );

  useEffect(() => {
    if (!open) {
      setActiveTab("general");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const activeAgent = agents.find((agent) => agent.id === activeAgentId) ?? null;
  const provider = providers.find((item) => item.kind === draft.providerKind) ?? null;
  const providerModels = modelsByProvider[draft.providerKind] ?? [];
  const modelOptions = providerModels.length ? providerModels : [draft.model];
  const reasoningOptions = getReasoningOptions(draft.providerKind, draft.model);
  const canDeleteActiveAgent = Boolean(activeAgent && activeAgent.id !== DEFAULT_AGENT_ID);

  return (
    <div className="provider-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        aria-label="agent settings"
        className="modal-card modal-card--settings"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-card__header modal-card__header--spacious">
          <div>
            <h2>Agent settings</h2>
            <p className="modal-card__lede">
              {activeAgent?.name ?? "No agent selected"} / {getProviderStatusLabel(provider)}
            </p>
          </div>
          <button className="icon-button" onClick={onClose} type="button">
            Close
          </button>
        </div>

        {notice ? <div className="notice-banner">{notice}</div> : null}

        <div className="settings-stack">
          <section className="settings-card">
            <div className="settings-card__title-row">
              <div>
                <h3 style={{ margin: 0 }}>Current agent</h3>
                <p style={{ margin: "0.35rem 0 0", color: "var(--muted)" }}>
                  {activeAgent ? getAgentSummary(activeAgent) : "No agent selected yet."}
                </p>
              </div>

              <div className="agent-settings__toolbar">
                <button className="ghost-button" onClick={onCreate} type="button">
                  New agent
                </button>
                <button
                  className="ghost-button agent-settings__delete-button"
                  disabled={!canDeleteActiveAgent || deletingAgentId === activeAgent?.id}
                  onClick={() => {
                    if (activeAgent) {
                      onDelete(activeAgent.id);
                    }
                  }}
                  type="button"
                >
                  {deletingAgentId === activeAgent?.id ? "Deleting..." : "Delete agent"}
                </button>
              </div>
            </div>

            {activeAgent?.id === DEFAULT_AGENT_ID ? (
              <p className="agent-settings__helper">
                The default agent cannot be deleted. Create and clean up a different agent instead.
              </p>
            ) : null}

            <div className="chat-panel__tabs" aria-label="settings tabs">
              <button
                className={`chat-panel__tab ${activeTab === "general" ? "is-active" : ""}`}
                onClick={() => setActiveTab("general")}
                type="button"
              >
                General
              </button>
              <button
                className={`chat-panel__tab ${activeTab === "soul" ? "is-active" : ""}`}
                onClick={() => setActiveTab("soul")}
                type="button"
              >
                SOUL
              </button>
              <button
                className={`chat-panel__tab ${activeTab === "heartbeat" ? "is-active" : ""}`}
                onClick={() => setActiveTab("heartbeat")}
                type="button"
              >
                Heartbeat
              </button>
              <button
                className={`chat-panel__tab ${activeTab === "standing-orders" ? "is-active" : ""}`}
                onClick={() => setActiveTab("standing-orders")}
                type="button"
              >
                Standing Orders
              </button>
            </div>

            {activeTab === "general" ? (
              <div className="tab-pane">
                <div className="settings-card__fields">
                  <label className="field">
                    <span>Agent name</span>
                    <input
                      autoComplete="off"
                      className="field__input"
                      onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
                      value={draft.name}
                    />
                  </label>

                  <label className="field">
                    <span>Default provider</span>
                    <CustomSelect
                      ariaLabel="Default provider"
                      className="field__input"
                      onChange={(value) => {
                        const providerKind = value as ProviderKind;
                        const nextModel = modelsByProvider[providerKind]?.[0] ?? draft.model;
                        onDraftChange({
                          ...draft,
                          providerKind,
                          model: nextModel,
                          reasoningLevel: normalizeReasoningLevel(
                            providerKind,
                            nextModel,
                            draft.reasoningLevel,
                          ),
                        });
                      }}
                      value={draft.providerKind}
                      options={providerKinds
                        .filter((kind) => {
                          const item = providers.find((p) => p.kind === kind);
                          return isProviderEnabled(item);
                        })
                        .map((kind) => {
                          const item = providers.find((p) => p.kind === kind);
                          return {
                            value: kind,
                            label: `${providerLabels[kind]} / ${getProviderStatusLabel(item)}`,
                          };
                        })}
                    />
                  </label>

                  <label className="field">
                    <span>Default model</span>
                    <CustomSelect
                      className="field__input"
                      onChange={(value) => {
                        const model = value;
                        onDraftChange({
                          ...draft,
                          model,
                          reasoningLevel: normalizeReasoningLevel(
                            draft.providerKind,
                            model,
                            draft.reasoningLevel,
                          ),
                        });
                      }}
                      value={draft.model}
                      options={modelOptions.map((model) => ({
                        value: model,
                        label: getModelOption(draft.providerKind, model).label,
                      }))}
                    />
                  </label>

                  <label className="field">
                    <span>Reasoning level</span>
                    <CustomSelect
                      className="field__input"
                      onChange={(value) =>
                        onDraftChange({
                          ...draft,
                          reasoningLevel: value as ReasoningLevel,
                        })
                      }
                      value={draft.reasoningLevel}
                      options={reasoningOptions.map((option) => ({
                        value: option.value,
                        label: option.label,
                      }))}
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {activeTab === "soul" ? (
              <div className="tab-pane">
                <div className="settings-card__header">
                  <h3>SOUL.md</h3>
                  <p>Agent identity, tone, and long-lived operating instructions.</p>
                </div>

                <div className="settings-card__fields">
                  <label className="field">
                    <span>SOUL.md content</span>
                    <textarea
                      aria-label="SOUL content"
                      className="field__input"
                      onChange={(event) => onSoulDraftChange(event.target.value)}
                      placeholder={"# SOUL\n\nKeep the agent thoughtful, explicit, and helpful."}
                      rows={14}
                      style={{
                        minHeight: "20rem",
                        resize: "vertical",
                        fontFamily: "monospace",
                        fontSize: "0.85rem",
                        lineHeight: 1.6,
                      }}
                      value={soulDraft}
                    />
                  </label>
                  <small className="text-muted">Current path: {soul?.path ?? "SOUL.md"}</small>
                </div>
              </div>
            ) : null}

            {activeTab === "heartbeat" ? (
              <div className="tab-pane">
                <div className="settings-card__header">
                  <h3>Heartbeat automation</h3>
                  <p>Background instructions the agent can use for recurring checks.</p>
                </div>

                <div className="settings-card__fields">
                  <div className="field field--inline">
                    <span>Heartbeat enabled</span>
                    <button
                      aria-checked={heartbeatDraft.enabled}
                      className={`settings-toggle${heartbeatDraft.enabled ? " is-on" : ""}`}
                      onClick={() =>
                        onHeartbeatDraftChange({
                          ...heartbeatDraft,
                          enabled: !heartbeatDraft.enabled,
                        })
                      }
                      role="switch"
                      type="button"
                    />
                  </div>

                  <label className="field">
                    <span>Interval minutes</span>
                    <input
                      aria-label="Interval minutes"
                      className="field__input"
                      min={1}
                      onChange={(event) =>
                        onHeartbeatDraftChange({
                          ...heartbeatDraft,
                          intervalMinutes: event.target.value,
                        })
                      }
                      step={1}
                      type="number"
                      value={heartbeatDraft.intervalMinutes}
                    />
                  </label>

                  <label className="field">
                    <span>Heartbeat instructions</span>
                    <textarea
                      aria-label="Heartbeat instructions"
                      className="field__input"
                      onChange={(event) =>
                        onHeartbeatDraftChange({
                          ...heartbeatDraft,
                          instructions: event.target.value,
                        })
                      }
                      placeholder="Check the active work, summarize progress, and identify next steps."
                      rows={6}
                      style={{ minHeight: "8rem", resize: "vertical" }}
                      value={heartbeatDraft.instructions}
                    />
                  </label>

                  <div className="agent-settings__heartbeat-meta">
                    <span>Last run: {formatMaybeDateString(heartbeat?.lastRun ?? null)}</span>
                    {heartbeat?.parseError ? (
                      <span className="agent-settings__heartbeat-error">
                        Parse error: {heartbeat.parseError}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === "standing-orders" ? (
              <div className="tab-pane">
                <div className="settings-card__header">
                  <h3>Standing Orders</h3>
                  <p>Persistent instructions loaded from the agent-scoped standing orders file.</p>
                </div>

                <div className="settings-card__fields">
                  <label className="field">
                    <span>Standing orders file</span>
                    <input
                      className="field__input"
                      readOnly
                      value={standingOrders?.path ?? "standing-orders.md"}
                    />
                  </label>

                  <label className="field">
                    <span>Standing orders content</span>
                    <textarea
                      aria-label="Standing orders content"
                      className="field__input"
                      onChange={(event) => onStandingOrdersDraftChange(event.target.value)}
                      placeholder="# Standing Orders\n\nKeep the agent focused, explicit, and safe."
                      rows={14}
                      style={{
                        minHeight: "20rem",
                        resize: "vertical",
                        fontFamily: "monospace",
                        fontSize: "0.85rem",
                        lineHeight: 1.6,
                      }}
                      value={standingOrdersDraft}
                    />
                  </label>
                </div>
              </div>
            ) : null}

            <div className="settings-card__actions agent-settings__actions">
              <button
                className="primary-button"
                disabled={
                  activeTab === "standing-orders"
                    ? savingStandingOrders
                    : saving || !draft.name.trim()
                }
                onClick={activeTab === "standing-orders" ? onSaveStandingOrders : onSave}
                type="button"
              >
                {activeTab === "standing-orders"
                  ? savingStandingOrders
                    ? "Saving..."
                    : "Save standing orders"
                  : saving
                    ? "Saving..."
                    : "Save settings"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
