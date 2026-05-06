export function toSafeLocalName(value: string, fallback: string) {
  const normalized = value
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}
