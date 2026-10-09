export function formatPrompt(text: string, limit = 80): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > limit
    ? `${collapsed.slice(0, limit - 1)}…`
    : collapsed;
}
