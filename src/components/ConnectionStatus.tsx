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
        : "연결 안 됨"
    : "연결 안 됨";

  const statusClass =
    props.provider?.status === "connected"
      ? "is-connected"
      : props.provider?.status === "configured"
        ? "is-configured"
        : "is-disconnected";

  return (
    <section className="connection-status">
      <div className={`connection-status__badge ${statusClass}`}>{statusLabel}</div>

      <div className="connection-status__body">
        <strong>{props.provider ? providerLabels[props.provider.kind] : "프로바이더 없음"}</strong>
        <span>{props.modelsLoading ? "모델 목록을 불러오는 중..." : `${props.modelCount}개 모델 후보`}</span>
        {props.modelsError ? <p className="connection-status__error">{props.modelsError}</p> : null}
        {!props.provider ? (
          <p className="connection-status__hint">프로바이더를 먼저 연결해 주세요.</p>
        ) : null}
      </div>
    </section>
  );
}
