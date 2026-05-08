export async function readJson(response: Response) {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }
  return JSON.parse(text) as unknown;
}

export async function ensureOk(response: Response) {
  if (response.ok) {
    return response;
  }

  const text = await response.text().catch(() => "");
  throw new Error(
    text.trim()
      ? `HTTP ${response.status}: ${text.slice(0, 500)}`
      : `HTTP ${response.status}`,
  );
}
