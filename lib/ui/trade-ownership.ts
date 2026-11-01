import type { CollectedCard } from "@/lib/data/cards";
import { collectionGroupKey } from "@/lib/ui/collection-groups";

export type OwnedTradeVariant = Pick<
  CollectedCard,
  "id" | "rarity" | "shiny" | "isEvolved"
> & { count?: number };

export function tradeOwnershipIndex(cards: readonly OwnedTradeVariant[]) {
  const variants = new Map<string, number>();
  const catalogue = new Set<string>();
  for (const card of cards) {
    const key = collectionGroupKey(card);
    variants.set(key, (variants.get(key) ?? 0) + (card.count ?? 1));
    catalogue.add(card.id);
  }
  return { variants, catalogue };
}
