import type { Card, Rarity } from "@/lib/data/cards";

const rarityRank: Record<Rarity, number> = { LR: 0, SSR: 1, SR: 2, R: 3, C: 4 };

type BannerCard = Pick<Card, "id" | "name" | "rarity">;

export function compareBannerCards(a: BannerCard, b: BannerCard): number {
  return (
    rarityRank[a.rarity] - rarityRank[b.rarity] ||
    a.name.localeCompare(b.name, "en-US") ||
    a.id.localeCompare(b.id, "en-US")
  );
}
