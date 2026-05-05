import { providerLabels, type ProviderSummary } from "../types";

interface ConnectionStatusProps {
  provider: ProviderSummary | null;
  modelCount: number;
  modelsLoading: boolean;
  modelsError: string | null;
  backendOnline?: boolean | null;
}

export function ConnectionStatus(props: ConnectionStatusProps) {
  const backendOffline = props.backendOnline === false;
  const backendChecking = props.backendOnline === null || props.backendOnline === undefined;
  const statusLabel = backendOffline ? "서버 오프라인" : backendChecking ? "서버 확인 중" : "정상";
  const statusClass = backendOffline ? "is-backend-offline" : backendChecking ? "is-checking" : "is-connected";
  const summaryText = backendOffline
    ? "백엔드 서버 응답이 없습니다."
    : backendChecking
      ? "백엔드 연결 상태를 확인하는 중입니다."
      : props.modelsLoading
      ? "모델 목록을 확인하는 중입니다."
      : `${props.modelCount}개 모델 사용 가능`;

  return (
    <section className={`connection-status ${statusClass}`} aria-label={statusLabel}>
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
