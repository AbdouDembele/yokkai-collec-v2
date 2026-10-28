// Preserve draw order and exclude cards already placed by individual reveals.
export function packRareRevealQueue(
  cards: { rarity: string }[],
  revealed: number
) {
  return cards.flatMap((card, index) =>
    index >= revealed && (card.rarity === "SSR" || card.rarity === "LR")
      ? [index]
      : []
  );
}

export async function runPackOpeningOnce<T>(
  lock: { current: boolean },
  task: () => Promise<T>
) {
  if (lock.current) return;
  lock.current = true;
  try {
    return await task();
  } finally {
    lock.current = false;
  }
}

// Wait for the existing server result and the decorative opening independently.
// Skipping visuals must never submit a second pack request.
export async function runFinalBoosterOpening<T>({
  open,
  finished,
  onResponse,
  preload
}: {
  open: () => Promise<T[] | undefined>;
  finished: Promise<void>;
  onResponse: (cards: T[] | undefined) => void;
  preload: () => Promise<void>;
}) {
  const cards = await open();
  onResponse(cards);
  if (!cards?.length) return false;
  await Promise.all([finished, preload()]);
  return true;
}

export function packCopySnapshot<T extends { id: string }>(
  collection: T[],
  complete: boolean
): Record<string, number> | null {
  return complete
    ? collection.reduce<Record<string, number>>((counts, card) => {
        counts[card.id] = (counts[card.id] || 0) + 1;
        return counts;
      }, {})
    : null;
}

// Results are browsed five at a time; unrevealed future groups stay inaccessible.
export function packRevealWindow(
  total: number,
  revealed: number,
  requestedPage?: number
) {
  const pages = Math.max(1, Math.ceil(total / 5));
  const latest = Math.min(pages - 1, Math.floor(Math.max(0, revealed) / 5));
  const page = Number.isInteger(requestedPage)
    ? Math.max(0, Math.min(latest, requestedPage!))
    : latest;
  return {
    page,
    pages,
    latest,
    start: page * 5,
    end: Math.min(total, (page + 1) * 5)
  };
}
// `wishlist` is captured before opening: the server drops owned cards from it.
export function packCopyLabels<T extends { id: string }>(
  cards: T[],
  snapshot: Record<string, number> | null,
  wishlist: ReadonlySet<string> | null = null
): (T & { isNew?: boolean; copies?: number; wishlisted?: boolean })[] {
  const counts = { ...snapshot };
  return cards.map(card => {
    const wishlisted = wishlist?.has(card.id) || undefined;
    if (snapshot === null)
      return { ...card, isNew: undefined, copies: undefined, wishlisted };
    const previous = counts[card.id] || 0;
    counts[card.id] = previous + 1;
    return { ...card, isNew: previous === 0, copies: previous + 1, wishlisted };
  });
}
