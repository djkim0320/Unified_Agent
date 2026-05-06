import { describe, expect, it } from "vitest";
import { escapeHtml, renderOAuthResultPage } from "./oauth-result-page.js";

describe("OAuth result page", () => {
  it("escapes visible HTML content", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });

  it("keeps callback messages script-safe", () => {
    const html = renderOAuthResultPage({
      success: false,
      message: `</script><script>alert("xss")</script>`,
      frontendOrigin: "http://127.0.0.1:5173",
    });

    expect(html).toContain("&lt;/script&gt;&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    expect(html).toContain("\\u003C/script\\u003E\\u003Cscript\\u003E");
    expect(html).not.toContain(`const payload = {"type":"openai-codex-oauth","success":false,"message":"</script>`);
  });
});
