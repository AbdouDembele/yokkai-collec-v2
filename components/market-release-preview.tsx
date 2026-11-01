"use client";
import { useMemo, useSyncExternalStore } from "react";
import {
  MarketView,
  AuctionView,
  presentAuction,
  buildAuctionLists,
  type AuctionChatAdapter
} from "@/components/community-views";
import { MarketHeading } from "@/components/market-heading";
import { CatalogueCardModal } from "@/components/catalogue-card-modal";

import type { CollectedCard } from "@/lib/data/cards";
import type { AuctionDetail } from "@/lib/data/market";
const card: CollectedCard = {
  id: "owned-card",
  instanceId: "owned-instance",
  name: "Levi",
  category: "ANIME/MANGA",
  anime: "Attack on Titan",
  rarity: "LR",
  image: "/assets/landing/levi.webp",
  catalogueImage: "/assets/landing/levi.webp",
  obtainedAt: "2026-10-29T09:00:00Z",
  shiny: false,
  isEvolved: false,
  isFirstOwner: true,
  folderId: null,
  customImageUrl: null
};
const raw: AuctionDetail = {
  id: "auction-fixture",
  card,
  amount: 4850,
  endsAt: "2099-01-01T12:00:00Z",
  status: "active",
  seller: "Alice",
  sellerId: "seller",
  buyerId: "viewer",
  bids: 1,
  watched: false,
  winner: null,
  balance: 10000,
  history: [
    {
      id: "bid-1",
      name: "Bob",
      amount: 4850,
      createdAt: "2026-10-29T12:30:00Z",
      mine: false
    }
  ]
};
export function MarketReleasePreview({ mode }: { mode: string }) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const chat = useMemo<AuctionChatAdapter>(
    () => ({
      get: async () => ({
        canPost: true,
        participants: [],
        messages: [
          {
            id: "msg",
            userId: "bob",
            pseudo: "Bob",
            message: "Bonjour !",
            mine: false,
            createdAt: "2026-10-29T12:30:00Z"
          }
        ]
      }),
      send: async () => {
        throw Error("Read-only fixture");
      }
    }),
    []
  );
  if (!mounted) return null;
  if (mode === "wishlist")
    return (
      <main className="p-4">
        <CatalogueCardModal
          selected={card}
          ownedCopies={1}
          onClose={() => {}}
        />
      </main>
    );
  if (mode === "auction")
    return (
      <main className="p-4">
        <AuctionView
          auction={presentAuction(raw, "viewer")}
          chatAdapter={chat}
        />
      </main>
    );
  const sold = {
    ...raw,
    id: "sold-fixture",
    status: "sold" as const,
    buyerId: "viewer",
    endsAt: "2026-10-28T15:00:00Z"
  };
  const ownershipFixtures = Array.from({ length: 12 }, (_, index) => ({
    ...raw,
    id: `ownership-fixture-${index}`,
    ownedCount: index % 4 === 0 ? index + 2 : 0,
    card: {
      ...card,
      rarity: index % 3 === 2 ? ("SSR" as const) : card.rarity,
      shiny: index % 3 !== 0,
      isEvolved: index % 3 === 2
    }
  }));
  return (
    <main className="p-4">
      <MarketView
        lists={
          mode === "empty"
            ? { active: [], mine: [], won: [], sold: [] }
            : buildAuctionLists(
                mode === "ownership" ? ownershipFixtures : [raw, sold],
                "viewer"
              )
        }
        activeSales="1"
        pageHeading={<MarketHeading />}
      />
    </main>
  );
}
