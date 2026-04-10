import type { ProviderSummary } from "../types";

interface ConnectionStatusProps {
  provider: ProviderSummary | null;
  modelCount: number;
  modelsLoading: boolean;
  modelsError: string | null;
}

function formatIdentity(provider: ProviderSummary | null) {
  if (!provider) {
    return "선택된 프로바이더가 없습니다";
  }
  return provider.email ?? provider.displayName ?? provider.label;
}

function formatStatus(status: "connected" | "configured" | "disconnected") {
  if (status === "connected") {
    return "연결됨";
  }
  if (status === "configured") {
    return "설정됨";
  }
  return "연결 안 됨";
}

export function ConnectionStatus(props: ConnectionStatusProps) {
  const provider = props.provider;
  const status = provider?.status ?? "disconnected";

  return (
    <div className="connection-status">
      <div className="connection-status__headline">
        <span className={`status-pill status-pill--${status}`}>{formatStatus(status)}</span>
        <div>
          <p className="connection-status__title">{provider?.label ?? "프로바이더 없음"}</p>
          <span className="connection-status__identity">{formatIdentity(provider)}</span>
        </div>
      </div>

      <div className="connection-status__models">
        {props.modelsLoading
          ? "최신 모델 목록을 불러오는 중입니다."
          : `정리된 모델 ${props.modelCount}개 준비됨`}
      </div>

      {props.modelsError ? (
        <div className="connection-status__warning">{props.modelsError}</div>
      ) : null}
    </div>
  );
}
