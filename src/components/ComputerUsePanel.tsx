import type {
  ComputerUseActionEventRecord,
  ComputerUseSessionDetail,
  ComputerUseSettingsRecord,
} from "../types";

interface ComputerUsePanelProps {
  settings: ComputerUseSettingsRecord | null;
  detail: ComputerUseSessionDetail | null;
  loading: boolean;
  error: string | null;
  allowlistDraft: string;
  navigationUrl: string;
  clickSelector: string;
  onAllowlistDraftChange: (value: string) => void;
  onNavigationUrlChange: (value: string) => void;
  onClickSelectorChange: (value: string) => void;
  onToggleEnabled: () => void;
  onSaveSettings: () => void;
  onCreateSession: () => void;
  onNavigate: () => void;
  onScreenshot: () => void;
  onClick: () => void;
  onRiskyClick: () => void;
  onSensitiveType: () => void;
  onCloseSession: () => void;
  onApprove: (event: ComputerUseActionEventRecord) => void;
  onDeny: (event: ComputerUseActionEventRecord) => void;
}

function formatTime(timestamp: number | null | undefined) {
  if (!timestamp) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function latestPendingEvent(detail: ComputerUseSessionDetail | null) {
  return [...(detail?.events ?? [])].reverse().find((event) => event.status === "requires_approval") ?? null;
}

export function ComputerUsePanel(props: ComputerUsePanelProps) {
  const session = props.detail?.session ?? null;
  const pending = latestPendingEvent(props.detail);
  const screenshotSrc =
    props.detail?.latestScreenshotBase64 && props.detail.latestScreenshotMimeType
      ? `data:${props.detail.latestScreenshotMimeType};base64,${props.detail.latestScreenshotBase64}`
      : null;
  const sessionIsOpen = Boolean(session && session.status === "open");

  return (
    <div className="cockpit-section-grid cockpit-section-grid--computer">
      <section className="cockpit-section-card cockpit-section-card--wide">
        <div className="cockpit-section-card__header">
          <div>
            <span className="eyebrow">안전 설정</span>
            <h3>Computer Use 제어</h3>
          </div>
          <span className={`status-pill ${props.settings?.enabled ? "status-pill--live" : ""}`}>
            {props.settings?.enabled ? "활성" : "비활성"}
          </span>
        </div>
        <p className="muted">
          격리된 로컬 브라우저 세션으로 UI를 관찰하고 조작합니다. localhost/127.0.0.1은 기본 허용이며,
          외부 도메인, 민감 입력, 제출, 삭제, 업로드, 결제 같은 위험 액션은 승인 없이는 실행하지 않습니다.
        </p>
        {props.error ? <p className="form-error">{props.error}</p> : null}
        <div className="form-grid">
          <label>
            <span>기능 상태</span>
            <button className="primary-button" onClick={props.onToggleEnabled} type="button" disabled={props.loading}>
              {props.settings?.enabled ? "Computer Use 끄기" : "Computer Use 켜기"}
            </button>
          </label>
          <label>
            <span>외부 허용 도메인</span>
            <textarea
              onChange={(event) => props.onAllowlistDraftChange(event.target.value)}
              placeholder={"example.com\nopenai.com"}
              value={props.allowlistDraft}
            />
          </label>
        </div>
        <div className="button-row">
          <button onClick={props.onSaveSettings} type="button" disabled={props.loading}>
            설정 저장
          </button>
          <button onClick={props.onCreateSession} type="button" disabled={props.loading || !props.settings?.enabled}>
            브라우저 세션 시작
          </button>
          <button onClick={props.onCloseSession} type="button" disabled={props.loading || !sessionIsOpen}>
            세션 닫기
          </button>
        </div>
      </section>

      <section className="cockpit-section-card">
        <div className="cockpit-section-card__header">
          <div>
            <span className="eyebrow">현재 세션</span>
            <h3>{session ? session.status : "세션 없음"}</h3>
          </div>
        </div>
        <p className="muted">URL: {session?.currentUrl ?? "아직 열리지 않음"}</p>
        <p className="muted">액션 수: {session?.actionCount ?? 0}</p>
        <label>
          <span>이동 URL</span>
          <input
            onChange={(event) => props.onNavigationUrlChange(event.target.value)}
            value={props.navigationUrl}
          />
        </label>
        <div className="button-row">
          <button onClick={props.onNavigate} type="button" disabled={props.loading || !sessionIsOpen}>
            이동
          </button>
          <button onClick={props.onScreenshot} type="button" disabled={props.loading || !sessionIsOpen}>
            스크린샷
          </button>
        </div>
      </section>

      <section className="cockpit-section-card">
        <div className="cockpit-section-card__header">
          <div>
            <span className="eyebrow">검증 액션</span>
            <h3>클릭 / 승인 테스트</h3>
          </div>
        </div>
        <p className="muted">
          안전 클릭은 즉시 실행하고, 위험 클릭과 민감 입력은 정책에 따라 승인 대기로 남아야 합니다.
        </p>
        <label>
          <span>Playwright/CSS 셀렉터</span>
          <input
            onChange={(event) => props.onClickSelectorChange(event.target.value)}
            placeholder='button:has-text("컴퓨터")'
            value={props.clickSelector}
          />
        </label>
        <div className="button-row">
          <button onClick={props.onClick} type="button" disabled={props.loading || !sessionIsOpen}>
            안전 클릭
          </button>
          <button onClick={props.onRiskyClick} type="button" disabled={props.loading || !sessionIsOpen}>
            위험 클릭 테스트
          </button>
          <button onClick={props.onSensitiveType} type="button" disabled={props.loading || !sessionIsOpen}>
            민감 입력 테스트
          </button>
        </div>
      </section>

      <section className="cockpit-section-card">
        <div className="cockpit-section-card__header">
          <div>
            <span className="eyebrow">승인 대기</span>
            <h3>{pending ? pending.actionType : "없음"}</h3>
          </div>
        </div>
        {pending ? (
          <>
            <p>{pending.summary}</p>
            <pre>{JSON.stringify(pending.metadata, null, 2)}</pre>
            <div className="button-row">
              <button onClick={() => props.onApprove(pending)} type="button">
                승인
              </button>
              <button onClick={() => props.onDeny(pending)} type="button">
                거절
              </button>
            </div>
          </>
        ) : (
          <p className="muted">위험 액션이 감지되면 여기에서 승인하거나 거절할 수 있습니다.</p>
        )}
      </section>

      <section className="cockpit-section-card cockpit-section-card--wide">
        <div className="cockpit-section-card__header">
          <div>
            <span className="eyebrow">관찰</span>
            <h3>스크린샷과 타임라인</h3>
          </div>
        </div>
        {screenshotSrc ? (
          <img className="computer-use-screenshot" src={screenshotSrc} alt="Computer Use latest screenshot" />
        ) : (
          <p className="muted">아직 스크린샷이 없습니다.</p>
        )}
        <div className="event-list">
          {(props.detail?.events ?? []).slice(-12).reverse().map((event) => (
            <article className="event-list__item" key={event.id}>
              <strong>{event.actionType} · {event.status}</strong>
              <span>{event.summary}</span>
              <small>{formatTime(event.createdAt)}</small>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
