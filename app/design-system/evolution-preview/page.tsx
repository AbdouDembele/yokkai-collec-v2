import type { CollectedCard } from "@/lib/data/cards";
import { CollectionPreviewClient } from "@/components/collection-preview";
export const metadata = {
  title: "Evolution preview",
  robots: { index: false, follow: false }
};
const variants = [
  {
    id: "lr",
    name: "Broly",
    rarity: "LR" as const,
    shiny: false,
    isEvolved: false,
    count: 5
  },
  {
    id: "lr",
    name: "Broly",
    rarity: "LR" as const,
    shiny: true,
    isEvolved: false,
    count: 5
  },
  {
    id: "lr",
    name: "Broly",
    rarity: "LR" as const,
    shiny: false,
    isEvolved: true,
    count: 1
  },
  {
    id: "ssr",
    name: "Beerus",
    rarity: "SSR" as const,
    shiny: false,
    isEvolved: false,
    count: 5
  },
  {
    id: "ssr",
    name: "Beerus",
    rarity: "SSR" as const,
    shiny: true,
    isEvolved: true,
    count: 1
  }
];
const cards: CollectedCard[] = variants.flatMap((v, group) =>
  Array.from({ length: v.count }, (_, i) => ({
    id: v.id,
    name: v.name,
    rarity: v.rarity,
    shiny: v.shiny,
    isEvolved: v.isEvolved,
    instanceId: "evolution-" + group + "-" + i,
    category: "ANIME/MANGA",
    anime: "Dragon Ball",
    image: "/assets/booster-pack.png",
    catalogueImage: "/assets/booster-pack.png",
    obtainedAt: "2026-10-24T00:00:00Z",
    isFirstOwner: false,
    folderId: null,
    customImageUrl: null
  }))
);
export default function EvolutionPreview() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <CollectionPreviewClient
        cards={cards}
        pageHeading={<h1>Evolution preview</h1>}
      />
    </main>
  );
}
