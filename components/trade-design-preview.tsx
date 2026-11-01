"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { TradesPanel, type TradesPanelAdapter } from "@/components/trades";
import { ConversationTrade } from "@/components/conversation-trade";
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
const offer: TradeOffer = {
  id: "design-offer",
  fromUser: friend,
  toUser: viewer,
  fromPseudo: "Kitsune",
  toPseudo: "Akira",
  incoming: true,
  offeredCards: [cards[0], cards[2]],
  requestedCards: [cards[1]],
  offeredKaras: 1250,
  requestedKaras: 400,
  status: "pending",
  parentOfferId: null,
  createdAt: "2026-11-01T10:30:00Z"
};
export function TradeDesignPreview() {
  const t = useTranslations();
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
    listOffers: async () => [
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
      { ...offer, id: "history-design", status: "accepted" }
    ],
    context: async () => ({
      friend: { id: friend, pseudo: "Kitsune" },
      balance: 9480,
      ownCards: [cards[1]],
      friendCards: [cards[0], cards[2]]
    }),
    create: async () => "design-only",
    cancel: async () => true,
    respond: async (_id, action) => action === "accept"
  }));
  return (
    <main
      style={{ maxWidth: 1120, margin: "32px auto", padding: "0 12px 60px" }}
    >
      <h1 className="sr-only">{t("tradeDesign.title")}</h1>
      <TradesPanel
        adapter={adapter}
        pollIntervalMs={null}
        initialFriendId={friend}
      />
      <section
        style={{ marginTop: 32 }}
        aria-label={t("socialUi.tradeHistory")}
      >
        <ConversationTrade
          offer={offer}
          viewerId={viewer}
          busy={false}
          onRespond={() => {}}
        />
      </section>
    </main>
  );
}
