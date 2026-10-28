import type { CollectedCard, Rarity } from "@/lib/data/cards";
import type { CardBinder } from "@/lib/ui/binder-identity";
import { matchesCardSearch } from "@/lib/ui/card-search";
import { sortCollection, type CollectionSort } from "@/lib/ui/collection-sort";

export type CollectionFilters = {
  query: string;
  category: string[];
  rarity: Rarity[];
  shinyOnly: boolean;
  folder: string | "unfiled" | "";
  auctionOnly: boolean;
  lockedOnly: boolean;
  sort: CollectionSort;
};

// The collection screen's filters and order. get_collection_groups_page
// (#388) reproduces this exactly in SQL; keep both in step.
export function filterCollection(
  cards: (CollectedCard & { binders?: CardBinder[] })[],
  filters: CollectionFilters,
  isFrozen: (instanceId: string) => boolean
): CollectedCard[] {
  const {
    query,
    category,
    rarity,
    shinyOnly,
    folder,
    auctionOnly,
    lockedOnly
  } = filters;
  return sortCollection(
    cards.filter(
      c =>
        (matchesCardSearch(query, [c.name, c.category, c.anime]) ||
          matchesCardSearch(query, [
            c.name,
            c.category,
            c.anime,
            ...(c.binders?.flatMap(binder => [
              binder.name,
              ...(binder.searchNames ?? [])
            ]) ?? [])
          ])) &&
        (!category.length || category.includes(c.category)) &&
        (!rarity.length || rarity.includes(c.rarity)) &&
        (!shinyOnly || c.shiny || c.isEvolved) &&
        (!folder ||
          (folder === "unfiled" ? !c.folderId : c.folderId === folder)) &&
        (!auctionOnly || isFrozen(c.instanceId)) &&
        (!lockedOnly || !!c.locked)
    ),
    filters.sort
  );
}
