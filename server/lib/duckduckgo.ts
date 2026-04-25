function decodeHtml(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export async function searchDuckDuckGo(query: string, maxResults = 5) {
  const response = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed with ${response.status}`);
  }

  const html = await response.text();
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const resultRegex =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>)([\s\S]*?)(?:<\/a>|<\/div>)/gi;

  for (const match of html.matchAll(resultRegex)) {
    const url = decodeHtml(match[1] ?? "").trim();
    const title = decodeHtml((match[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
    const snippet = decodeHtml(
      (match[3] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
    ).trim();

    if (!url || !title) {
      continue;
    }

    results.push({ title, url, snippet });
    if (results.length >= maxResults) {
      break;
    }
  }

  return results;
}

