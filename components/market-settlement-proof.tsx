"use client";

import { useEffect, useRef, useState } from "react";
import {
  auctionReconciliationScopes,
  type AuctionData
} from "@/lib/data/market";

const card = {
  id: "card",
  name: "Luffy",
  anime: "One Piece",
  category: "Anime/Manga",
  rarity: "SSR" as const,
  image: "/images/card-placeholder.svg"
};
const auction = (
  id: string,
  sellerId: string,
  buyerId: string
): AuctionData => ({
  id,
  card,
  amount: 100,
  endsAt: "2026-09-30T00:00:00Z",
  status: "active",
  seller: "Joueur",
  sellerId,
  buyerId,
  bids: 1,
  watched: false
});
const initial = [
  auction("sale", "observer", "other"),
  auction("win", "other", "observer"),
  auction("refund", "other", "observer")
];
const settled: AuctionData[] = [
  { ...initial[0], status: "sold" },
  { ...initial[1], status: "sold" },
  { ...initial[2], buyerId: "actor" }
];

export function MarketSettlementProof({
  disabled = false
}: {
  disabled?: boolean;
}) {
  const backend = useRef(initial);
  const observed = useRef(initial);
  const [state, setState] = useState({
    sellerBalance: 500,
    refundedBalance: 500,
    winnerCards: 3,
    emissions: 0,
    serverSettled: false
  });
  useEffect(() => {
    if (disabled) return;
    const timer = window.setInterval(() => {
      const next = backend.current;
      const scopes = auctionReconciliationScopes(
        observed.current,
        next,
        "observer"
      );
      observed.current = next;
      if (!scopes.length) return;
      setState(current => ({
        ...current,
        sellerBalance: scopes.includes("balance") ? 600 : current.sellerBalance,
        refundedBalance: scopes.includes("balance")
          ? 540
          : current.refundedBalance,
        winnerCards: scopes.includes("collection") ? 4 : current.winnerCards,
        emissions: current.emissions + 1
      }));
    }, 1200);
    return () => window.clearInterval(timer);
  }, [disabled]);
  function settle() {
    backend.current = settled;
    setState(current => ({ ...current, serverSettled: true }));
  }
  return (
    <div
      className="grid gap-8 lg:grid-cols-2"
      data-proof-state={JSON.stringify(state)}
    >
      <section className="yk-social-panel" data-proof-actor="actor">
        <p className="eyebrow">Acteur distant</p>
        <h2 className="yk-section-title mt-2">Règlement serveur</h2>
        <button
          type="button"
          className="yk-button yk-button-primary mt-5"
          onClick={settle}
        >
          Régler les enchères
        </button>
        <p className="mt-3 text-sm text-ink-2">
          {state.serverSettled
            ? "Vente, victoire et surenchère enregistrées."
            : "Enchères encore actives."}
        </p>
      </section>
      <section className="yk-social-panel" data-proof-actor="observer">
        <p className="eyebrow">Compte observateur</p>
        <h2 className="yk-section-title mt-2">
          Réconciliation au prochain cycle
        </h2>
        <p className="mt-4 text-sm text-ink-2">
          Vente : {state.sellerBalance} Karas · Remboursement :{" "}
          {state.refundedBalance} Karas · Collection gagnant :{" "}
          {state.winnerCards} cartes
        </p>
        <p className="mt-2 text-xs text-ink-3">Émissions : {state.emissions}</p>
      </section>
    </div>
  );
}
