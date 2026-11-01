"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { TradesPanel, type TradesPanelAdapter } from "@/components/trades";
import type { CollectedCard } from "@/lib/data/cards";
import type { TradeOffer } from "@/lib/data/trades";

// Isolated design-system fixture; every action remains in memory, no RPC.
const viewer = "designer",
  friend = "collector";
const cards: CollectedCard[] = [
  {
    id: "gojo",
    instanceId: "gojo-one",
    name: "SATORU GOJO",
    anime: "JUJUTSU KAISEN",
    category: "ANIME/MANGA",
    rarity: "SSR",
    image: "/assets/premium-examples/gojo-original.png",
    obtainedAt: "2026-10-01T12:00:00Z",
    shiny: false,
    isEvolved: false,
    isFirstOwner: true,
    folderId: null,
    catalogueImage: "/assets/premium-examples/gojo-original.png",
    customImageUrl: null
  },
  {
    id: "custom",
    instanceId: "custom-one",
    name: "Collection exclusive — édition de collection avec un nom très long",
    anime:
      "Une licence avec un titre particulièrement long pour vérifier la lisibilité",
    category: "ANIME/MANGA",
    rarity: "LR",
    image: "/assets/premium-examples/bbdou-card-1.png",
    obtainedAt: "2026-10-01T12:00:00Z",
    shiny: false,
    isEvolved: false,
    isFirstOwner: true,
    folderId: null,
    catalogueImage: "/assets/premium-examples/gojo-original.png",
    customImageUrl: null
  },
  {
    id: "gojo",
    instanceId: "gojo-two",
    name: "SATORU GOJO",
    anime: "JUJUTSU KAISEN",
    category: "ANIME/MANGA",
    rarity: "SSR",
    image: "/assets/premium-examples/gojo-original.png",
    obtainedAt: "2026-10-01T12:00:00Z",
    shiny: false,
    isEvolved: false,
    isFirstOwner: true,
    folderId: null,
    catalogueImage: "/assets/premium-examples/gojo-original.png",
    customImageUrl: null
  }
];
const extraCards: CollectedCard[] = [
  {
    id: "luffy",
    name: "MONKEY D. LUFFY",
    anime: "ONE PIECE",
    rarity: "LR" as const,
    image: "/assets/landing/luffy.webp"
  },
  {
    id: "levi",
    name: "LEVI ACKERMAN",
    anime: "Attack on Titan",
    rarity: "SR" as const,
    image: "/assets/landing/levi.webp"
  },
  ...(["C", "R", "SR", "SSR", "LR", "R"] as const).map((rarity, index) => ({
    id: `collection-${index + 2}`,
    name: `Collection ${index + 2}`,
    anime: "Yokkai Collection",
    rarity,
    image: `/assets/premium-examples/bbdou-card-${index + 2}.png`
  }))
].map(card => ({
  ...cards[0],
  ...card,
  instanceId: `${card.id}-one`,
  catalogueImage: card.image
}));
const ownCards = [
  cards[1],
  { ...cards[0], instanceId: "own-gojo-one" },
  ...extraCards.slice(0, -2).map(card => ({
    ...card,
    instanceId: `own-${card.instanceId}`
  })),
  { ...cards[0], instanceId: "own-gojo-two" },
  { ...extraCards[0], instanceId: "own-luffy-two" },
  { ...extraCards[0], instanceId: "own-luffy-three" },
  { ...extraCards[1], instanceId: "own-levi-two" }
];
const friendCards = [
  cards[0],
  cards[2],
  { ...cards[1], instanceId: "friend-custom-one" },
  ...extraCards.map(card => ({
    ...card,
    instanceId: `friend-${card.instanceId}`
  })),
  { ...extraCards[1], instanceId: "friend-levi-two", shiny: true }
];
const offer: TradeOffer = {
  id: "design-offer",
  fromUser: friend,
  toUser: viewer,
  fromPseudo: "Kitsune",
  toPseudo: "Akira",
  incoming: true,
  offeredCards: friendCards,
  requestedCards: ownCards,
  offeredKaras: 1250,
  requestedKaras: 400,
  status: "pending",
  parentOfferId: null,
  createdAt: "2026-11-01T10:30:00Z"
};
export function TradeDesignPreview() {
  const t = useTranslations();
  const statuses = useRef(new Map<string, TradeOffer["status"]>());
  const [adapter] = useState<TradesPanelAdapter>(() => ({
    friendships: async () => ({
      friends: [
        { id: friend, pseudo: "Kitsune" },
        { id: "second", pseudo: "Sakura" },
        {
          id: "third",
          pseudo: "Le collectionneur au pseudo particulièrement long"
        }
      ],
      incoming: [],
      outgoing: []
    }),
    listOffers: async () =>
      [
        offer,
        {
          ...offer,
          id: "sent-design",
          incoming: false,
          fromUser: viewer,
          toUser: friend,
          fromPseudo: "Akira",
          toPseudo: "Kitsune"
        },
        { ...offer, id: "history-design", status: "accepted" as const }
      ].map(item => ({
        ...item,
        status: statuses.current.get(item.id) ?? item.status
      })),
    context: async () => ({
      friend: { id: friend, pseudo: "Kitsune" },
      balance: 9480,
      ownCards,
      friendCards,
      ownedVariants: [
        ...ownCards,
        // A locked copy is owned but deliberately absent from tradable cards.
        { ...extraCards[6], count: 1 }
      ]
    }),
    create: async () => "design-only",
    cancel: async id => {
      statuses.current.set(id, "cancelled");
      return true;
    },
    respond: async (id, action) => {
      statuses.current.set(id, action === "accept" ? "accepted" : "declined");
      return action === "accept";
    }
  }));
  return (
    <main
      style={{ maxWidth: 1600, margin: "32px auto", padding: "0 12px 60px" }}
    >
      <h1 className="sr-only">{t("tradeDesign.title")}</h1>
      <TradesPanel
        adapter={adapter}
        pollIntervalMs={null}
        initialFriendId={friend}
      />
    </main>
  );
}
