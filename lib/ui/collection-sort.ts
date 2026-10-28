import type { CollectedCard, Rarity } from "@/lib/data/cards";

export type CollectionSort = "rarity" | "recent" | "oldest" | "name";
export const COLLECTION_SORTS: { value: CollectionSort; label: string }[] = [
  { value: "rarity", label: "Rarity" },
  { value: "recent", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "Name (A → Z)" }
];
export const DEFAULT_COLLECTION_SORT: CollectionSort = "rarity";
export const isCollectionSort = (value: unknown): value is CollectionSort =>
  COLLECTION_SORTS.some(sort => sort.value === value);

type Compare = (a: CollectedCard, b: CollectedCard) => number;
const rarityRank: Record<Rarity, number> = { LR: 0, SSR: 1, SR: 2, R: 3, C: 4 };
const byRarity: Compare = (a, b) =>
  rarityRank[a.rarity] - rarityRank[b.rarity] ||
  Number(b.shiny) - Number(a.shiny);
const byName: Compare = (a, b) =>
  a.name.localeCompare(b.name, "en-US", { sensitivity: "base", numeric: true });
const obtainedTime = (card: CollectedCard) => Date.parse(card.obtainedAt) || 0;
const compares: Record<CollectionSort, Compare[]> = {
  rarity: [byRarity, byName],
  recent: [(a, b) => obtainedTime(b) - obtainedTime(a), byRarity, byName],
  oldest: [(a, b) => obtainedTime(a) - obtainedTime(b), byRarity, byName],
  name: [byName, byRarity]
};

// The instance id closes every order so equal cards never swap between renders.
export function sortCollection(
  cards: CollectedCard[],
  sort: CollectionSort
): CollectedCard[] {
  return cards.slice().sort((a, b) => {
    for (const compare of compares[sort]) {
      const result = compare(a, b);
      if (result) return result;
    }
    return a.instanceId.localeCompare(b.instanceId);
  });
}
