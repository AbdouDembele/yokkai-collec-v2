"use client";

import { CollectionView } from "@/components/collection";
import type { CollectedCard } from "@/lib/data/cards";

const proofCard: CollectedCard = {
  id: "proof-market-card",
  instanceId: "proof-market-copy",
  name: "Luffy Gear Five",
  category: "Anime/Manga",
  anime: "One Piece",
  rarity: "LR",
  image: "/assets/card-back.png",
  catalogueImage: "/assets/card-back.png",
  customImageUrl: null,
  obtainedAt: "2026-09-30T12:00:00.000Z",
  folderId: null,
  shiny: false,
  isEvolved: false,
  isFirstOwner: true
};

export function AuctionSuggestionProof({
  disabled = false
}: {
  disabled?: boolean;
}) {
  return (
    <CollectionView
      cards={[proofCard]}
      categories={["Anime/Manga"]}
      onCreateAuction={async () => {}}
      loadCardDiscovery={async () => ({ marketValue: disabled ? null : 240 })}
    />
  );
}
