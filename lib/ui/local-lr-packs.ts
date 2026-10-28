import type { Card } from "@/lib/data/cards";
import type { RevealCard } from "@/components/boosters";

const openingCards: Card[] = [
  {
    id: "local-demo-luffy",
    name: "Monkey D. Luffy",
    category: "ANIME/MANGA",
    anime: "One Piece",
    rarity: "C",
    image: "/assets/landing/luffy.webp"
  },
  {
    id: "local-demo-levi",
    name: "Levi Ackerman",
    category: "ANIME/MANGA",
    anime: "Attack on Titan",
    rarity: "R",
    image: "/assets/landing/levi.webp"
  },
  {
    id: "local-demo-gojo",
    name: "Satoru Gojo",
    category: "ANIME/MANGA",
    anime: "JUJUTSU KAISEN",
    rarity: "SR",
    image: "/assets/premium-examples/gojo-original.png"
  },
  {
    id: "local-demo-higuruma",
    name: "Hiromi Higuruma",
    category: "ANIME/MANGA",
    anime: "JUJUTSU KAISEN",
    rarity: "SSR",
    image: "/assets/premium-examples/bbdou-card-7.png"
  }
];

const legendaryCards: Card[] = [
  {
    id: "local-demo-madara",
    name: "Madara Uchiha",
    category: "ANIME/MANGA",
    anime: "Naruto",
    rarity: "LR",
    image: "/assets/premium-examples/bbdou-card-1.png"
  },
  {
    id: "local-demo-omni-man",
    name: "Omni-Man",
    category: "COMICS",
    anime: "Invincible",
    rarity: "LR",
    image: "/assets/premium-examples/bbdou-card-2.png"
  },
  {
    id: "local-demo-shadow",
    name: "Shadow the Hedgehog",
    category: "VIDEO GAMES",
    anime: "Sonic Adventure 2",
    rarity: "LR",
    image: "/assets/premium-examples/bbdou-card-3.png"
  }
];

// Deliberately deterministic demo data, never used by the real pack RPCs.
export function createLocalLrPack(
  kind: "regular" | "decision",
  sequence: number
): RevealCard[] {
  if (
    !["regular", "decision"].includes(kind) ||
    !Number.isSafeInteger(sequence) ||
    sequence < 0
  ) {
    throw new Error("Invalid demo pack");
  }
  return [
    ...openingCards,
    legendaryCards[sequence % legendaryCards.length]
  ].map((card, index) => ({
    ...card,
    rarity:
      kind === "decision" && (card.rarity === "C" || card.rarity === "R")
        ? "SR"
        : card.rarity,
    instanceId: `local-demo-${kind}-${sequence}-${index}`,
    shiny: false
  }));
}
