"use client";

import type { Card } from "@/lib/data/cards";
import { LrCardReveal } from "@/components/lr-card-reveal";

// Both rarities use the same native player and the site's shared card face.
export function CardCinematic({
  card,
  onContinue,
  onRevealStart,
  onReplay,
  autoAdvance = false
}: {
  card: Pick<Card, "name" | "category" | "anime" | "image" | "rarity"> & {
    shiny?: boolean;
    isEvolved?: boolean;
  };
  onContinue?: () => void;
  onRevealStart?: () => void;
  onReplay?: () => void;
  autoAdvance?: boolean;
}) {
  return (
    <LrCardReveal
      key={`${card.rarity}:${!!card.shiny}:${!!card.isEvolved}:${card.name}:${card.image}`}
      card={card}
      onContinue={onContinue}
      onRevealStart={onRevealStart}
      onReplay={onReplay}
      autoAdvance={autoAdvance}
    />
  );
}
