"use client";

import { useSyncExternalStore } from "react";
import { buildAuctionLists, MarketView } from "@/components/community-views";
import type { AuctionData } from "@/lib/data/market";

const endsAt = "2099-10-01T12:00:00Z";
const card = (id: string, name: string) => ({
  id,
  name,
  category: "Yokai",
  anime: "Spirit Realm",
  rarity: "SR" as const,
  image: "/assets/booster-pack.png"
});

export function AuctionParticipationProof({
  disabled = false
}: {
  disabled?: boolean;
}) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const auctions: AuctionData[] = [
    {
      id: "outbid",
      card: card("c1", "Kuro Kitsune"),
      amount: 240,
      endsAt,
      status: "active",
      seller: "Mochi",
      sellerId: "seller-1",
      buyerId: "rival",
      hasBid: !disabled,
      bids: 4,
      watched: false
    },
    {
      id: "leading",
      card: card("c2", "Aoi Dragon"),
      amount: 180,
      endsAt,
      status: "active",
      seller: "Oni",
      sellerId: "seller-2",
      buyerId: "viewer",
      hasBid: true,
      bids: 2,
      watched: false
    },
    {
      id: "unrelated",
      card: card("c3", "Ren Cyber"),
      amount: 90,
      endsAt,
      status: "active",
      seller: "Yuki",
      sellerId: "seller-3",
      buyerId: "other",
      hasBid: false,
      bids: 1,
      watched: false
    }
  ];
  return (
    <div className="flex flex-col gap-6">
      <div
        className={`yk-feedback ${disabled ? "" : "yk-feedback-success"}`}
        data-proof-mode={disabled ? "counterproof" : "enabled"}
      >
        <strong>
          {disabled
            ? "Contre-preuve : participation masquée"
            : "Preuve : participation serveur exposée"}
        </strong>
        <span>
          Clique sur « Mes enchères », puis laisse « En cours » sélectionné.
        </span>
      </div>
      {mounted ? (
        <MarketView
          lists={buildAuctionLists(auctions, "viewer")}
          activeSales="0"
        />
      ) : (
        <p role="status">Chargement de la preuve…</p>
      )}
    </div>
  );
}
