export function statusLabel(status: string | null | undefined) {
  if (!status) return "알 수 없음";
  const labels: Record<string, string> = {
    active: "활성",
    paused: "일시정지",
    completed: "완료",
    archived: "보관",
    open: "열림",
    investigating: "조사 중",
    answered: "답변됨",
    blocked: "막힘",
    proposed: "제안됨",
    supported: "지지됨",
    contradicted: "반박됨",
    unresolved: "미해결",
    queued: "대기",
    running: "실행 중",
    waiting_approval: "승인 대기",
    failed: "실패",
    cancelled: "취소",
  };
  return labels[status] ?? status;
}

export function compactTime(value: number | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
