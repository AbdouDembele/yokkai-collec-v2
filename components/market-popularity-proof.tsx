"use client";

import { useSyncExternalStore } from "react";
import { buildAuctionLists, MarketView } from "@/components/community-views";
import type { AuctionData } from "@/lib/data/market";

const card = (id: string, name: string) => ({
  id,
  name,
  category: "Yokai",
  anime: "Spirit Realm",
  rarity: "SR" as const,
  image: "/assets/booster-pack.png"
});

export function MarketPopularityProof({
  disabled = false
}: {
  disabled?: boolean;
}) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const score = (value: number) => (disabled ? 0 : value);
  const auctions: AuctionData[] = [
    {
      id: "b-tie-late",
      card: card("c1", "Kuro · 900 favoris · fin tardive"),
      amount: 240,
      endsAt: "2099-10-01T14:00:00Z",
      status: "active",
      seller: "Mochi",
      sellerId: "s1",
      buyerId: null,
      hasBid: false,
      popularity: score(900),
      bids: 0,
      watched: false
    },
    {
      id: "a-tie-soon",
      card: card("c2", "Aoi · 900 favoris · fin proche"),
      amount: 180,
      endsAt: "2099-10-01T12:00:00Z",
      status: "active",
      seller: "Oni",
      sellerId: "s2",
      buyerId: null,
      hasBid: false,
      popularity: score(900),
      bids: 0,
      watched: false
    },
    {
      id: "c-lowest",
      card: card("c3", "Ren · 120 favoris · finit en premier"),
      amount: 90,
      endsAt: "2099-10-01T11:00:00Z",
      status: "active",
      seller: "Yuki",
      sellerId: "s3",
      buyerId: null,
      hasBid: false,
      popularity: score(120),
      bids: 0,
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
            ? "Contre-preuve : favoris neutralisés"
            : "Preuve : favoris_count exposé"}
        </strong>
        <span>
          Clique sur « Les + populaires » : 900/fin proche, 900/fin tardive,
          puis 120.
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
