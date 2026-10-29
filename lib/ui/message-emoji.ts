// DOM selection offsets and textarea maxLength both use UTF-16 code units.
export function insertMessageEmoji(
  text: string,
  emoji: string,
  start: number,
  end: number,
  maxLength = 2000
): { text: string; caret: number } | null {
  const from = Math.max(0, Math.min(text.length, start));
  const to = Math.max(from, Math.min(text.length, end));
  const next = text.slice(0, from) + emoji + text.slice(to);
  if (next.length > maxLength) return null;
  return { text: next, caret: from + emoji.length };
}
