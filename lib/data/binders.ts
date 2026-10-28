import { createClient } from "@/utils/supabase/client";
import { readRequest } from "@/lib/data/read-request";
import type { CardBinder } from "@/lib/ui/binder-identity";

export const stableBindersEnabled = () => process.env.NEXT_PUBLIC_STABLE_BINDERS_ENABLED === "true";

export type FavoriteConflict = {
  license: string;
  candidates: { binderKey: string; license: string; origin: "series" | "source"; category?: string; total?: number }[];
};

export async function withBinderMetadata<T extends { id: string }>(cards: T[]): Promise<(T & { binders?: CardBinder[] })[]> {
  if (!stableBindersEnabled() || !cards.length) return cards;
  const byId = new Map<string, CardBinder[]>();
  const ids = [...new Set(cards.map(card => card.id))];
  try {
    for (let i = 0; i < ids.length; i += 500) {
      const { data, error } = await readRequest(signal => createClient().rpc("get_card_binder_metadata", { p_card_ids: ids.slice(i, i + 500) }).abortSignal(signal));
      // Binders only enrich the cards: a failed lookup must never hide the collection.
      if (error) { console.warn("Binder metadata unavailable", error); return cards; }
      for (const row of (data ?? []) as { card_id: string; binders: CardBinder[] }[]) byId.set(row.card_id, row.binders);
    }
  } catch (error) {
    // readRequest rejects on network/deadline errors rather than returning error.
    console.warn("Binder metadata unavailable", error);
    return cards;
  }
  return cards.map(card => ({ ...card, binders: byId.get(card.id) ?? [] }));
}

export async function resolveBinderFavorite(license: string, binderKeys: string[]): Promise<void> {
  const { error } = await createClient().rpc("resolve_binder_favorite", { p_license: license, p_binder_keys: binderKeys });
  if (error) throw new Error("Couldn't resolve this favorite. Please try again.");
}
