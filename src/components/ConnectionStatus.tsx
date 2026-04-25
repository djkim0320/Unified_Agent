import { providerLabels, type ProviderSummary } from "../types";

interface ConnectionStatusProps {
  provider: ProviderSummary | null;
  modelCount: number;
  modelsLoading: boolean;
  modelsError: string | null;
}

export function ConnectionStatus(props: ConnectionStatusProps) {
  const statusLabel = props.provider
    ? props.provider.status === "connected"
      ? "연결됨"
      : props.provider.status === "configured"
        ? "구성됨"
        : "연결 필요"
    : "연결 필요";

  const statusClass =
    props.provider?.status === "connected"
      ? "is-connected"
      : props.provider?.status === "configured"
        ? "is-configured"
        : "is-disconnected";

  const summaryText = props.modelsLoading
    ? "모델 목록을 확인하는 중입니다."
    : `${props.modelCount}개 모델 후보`;

  return (
    <section className={`connection-status ${statusClass}`}>
      <div className="connection-status__badge">
        <span className="connection-status__dot" aria-hidden="true" />
        {statusLabel}
      </div>

      <div className="connection-status__body">
        <strong>{props.provider ? providerLabels[props.provider.kind] : "프로바이더 없음"}</strong>
        <span>{summaryText}</span>
        {props.modelsError ? <p className="connection-status__error">{props.modelsError}</p> : null}
        {!props.provider ? (
          <p className="connection-status__hint">먼저 API 연결을 설정해 주세요.</p>
        ) : null}
      </div>
    </section>
  );
}
