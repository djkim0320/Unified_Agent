export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function jsonForInlineScript(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function renderOAuthResultPage(params: {
  success: boolean;
  message: string;
  frontendOrigin: string;
}) {
  const displayTitle = params.success ? "연결 완료" : "연결 실패";
  const payload = jsonForInlineScript({
    type: "openai-codex-oauth",
    success: params.success,
    message: params.message,
  });

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Codex OAuth</title>
      <style>
        body {
          margin: 0;
          min-height: 100vh;
          display: grid;
          place-items: center;
          background: #10141f;
          color: #f5f7fb;
          font: 16px/1.4 "IBM Plex Sans", "Segoe UI Variable", sans-serif;
        }
        .card {
          width: min(92vw, 480px);
          padding: 24px;
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
        }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>${escapeHtml(displayTitle)}</h1>
        <p>${escapeHtml(params.message)}</p>
      </div>
      <script>
        const payload = ${payload};
        if (window.opener) {
          window.opener.postMessage(payload, ${jsonForInlineScript(params.frontendOrigin)});
        }
        setTimeout(() => window.close(), 250);
      </script>
    </body>
  </html>`;
}
