"use client";
import { useMemo, useState } from "react";
import { BoosterReveal } from "@/components/boosters";
import { TradesPanel, type TradesPanelAdapter } from "@/components/trades";
import type { CollectedCard } from "@/lib/data/cards";
import type { TradeOffer } from "@/lib/data/trades";

// Development-only browser fixtures. No real pack opening, trade or write RPC.
const examples = [
  {
    name: "SATORU GOJO",
    anime: "JUJUTSU KAISEN",
    image: "/assets/premium-examples/gojo-original.png",
    rarity: "SSR" as const
  },
  {
    name: "MONKEY D. LUFFY",
    anime: "ONE PIECE",
    image: "/assets/landing/luffy.webp",
    rarity: "LR" as const
  },
  {
    name: "LEVI ACKERMAN",
    anime: "Attack on Titan",
    image: "/assets/landing/levi.webp",
    rarity: "SR" as const
  },
  {
    name: "Collection exclusive avec un nom particulièrement long",
    anime: "Une licence très longue pour le test de lisibilité",
    image: "/assets/premium-examples/bbdou-card-1.png",
    rarity: "R" as const
  },
  {
    name: "Collection 5",
    anime: "Yokkai Collection",
    image: "/assets/premium-examples/bbdou-card-2.png",
    rarity: "C" as const
  }
];
const favoriteIds = async (ids: readonly string[]) =>
  ids.filter((_, i) => i % 3 !== 2);
export function TradePackFavoritesPreview({
  kind,
  count
}: {
  kind: "trade" | "pack";
  count: number;
}) {
  const [revealed, setRevealed] = useState(count);
  const cards = useMemo<CollectedCard[]>(
    () =>
      Array.from({ length: count }, (_, i) => ({
        ...examples[i % examples.length],
        id: `fixture-card-${i}`,
        instanceId: `fixture-copy-${i}`,
        category: "ANIME/MANGA",
        obtainedAt: "2026-11-03T00:00:00Z",
        shiny: false,
        isEvolved: false,
        isFirstOwner: true,
        folderId: null,
        catalogueImage: examples[i % examples.length].image,
        customImageUrl: null,
        isNew: i % 4 !== 0,
        copies: i % 4 === 0 ? 3 : 1,
        wishlisted: i % 5 === 0
      })),
    [count]
  );
  const adapter = useMemo<TradesPanelAdapter>(() => {
    const offer: TradeOffer = {
      id: "fixture-counteroffer",
      parentOfferId: "fixture-parent",
      fromUser: "fixture-friend",
      toUser: "fixture-viewer",
      fromPseudo: "Kitsune",
      toPseudo: "Akira",
      incoming: true,
      offeredCards: cards,
      requestedCards: cards.map(c => ({
        ...c,
        instanceId: `give-${c.instanceId}`
      })),
      offeredKaras: 1250,
      requestedKaras: 400,
      status: "pending",
      createdAt: "2026-11-03T00:00:00Z"
    };
    return {
      friendships: async () => ({
        friends: [{ id: "fixture-friend", pseudo: "Kitsune" }],
        incoming: [],
        outgoing: []
      }),
      listOffers: async () => [offer],
      context: async () => ({
        friend: { id: "fixture-friend", pseudo: "Kitsune" },
        balance: 9000,
        ownCards: offer.requestedCards,
        friendCards: cards
      }),
      create: async () => "fixture",
      respond: async () => true,
      cancel: async () => true
    };
  }, [cards]);
  return kind === "trade" ? (
    <main style={{ maxWidth: 1600, margin: "24px auto", padding: 12 }}>
      <TradesPanel
        adapter={adapter}
        pollIntervalMs={null}
        initialOfferId="fixture-counteroffer"
      />
    </main>
  ) : (
    <main className="yk-boosters-page">
      <BoosterReveal
        key={count}
        previewOnly
        packCount={count > 5 ? 10 : 1}
        cards={cards}
        collection={cards}
        revealed={revealed}
        onReveal={i => setRevealed(i + 1)}
        onReturn={() => {}}
        onDiscard={async () => {}}
        loadFavoriteCards={favoriteIds}
      />
    </main>
  );
}
