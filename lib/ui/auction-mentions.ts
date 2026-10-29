export type MentionPlayer = { userId: string; pseudo: string };
export type MentionPart = { text: string; player?: MentionPlayer };
// Match only identities supplied by the auction. Keep unknown @text and emails intact.
export function auctionMentionParts(
  text: string,
  players: readonly MentionPlayer[]
): MentionPart[] {
  const candidates = [...players]
    .filter(p => p.pseudo.trim())
    .sort((a, b) => b.pseudo.length - a.pseudo.length);
  const parts: MentionPart[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "@" || (i > 0 && /[\p{L}\p{N}_.@-]/u.test(text[i - 1])))
      continue;
    const player = candidates.find(p => {
      const end = i + p.pseudo.length + 1;
      return (
        text.slice(i + 1, end).toLocaleLowerCase("en-US") ===
          p.pseudo.toLocaleLowerCase("en-US") &&
        (end === text.length || !/[\p{L}\p{N}_@-]/u.test(text[end])) &&
        !(text[end] === "." && /[\p{L}\p{N}_]/u.test(text[end + 1] ?? ""))
      );
    });
    if (!player) continue;
    if (i > start) parts.push({ text: text.slice(start, i) });
    const end = i + player.pseudo.length + 1;
    parts.push({ text: text.slice(i, end), player });
    start = end;
    i = end - 1;
  }
  if (start < text.length) parts.push({ text: text.slice(start) });
  return parts;
}
