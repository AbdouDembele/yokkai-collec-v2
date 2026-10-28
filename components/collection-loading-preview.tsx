"use client";

import { useEffect, useMemo, useRef } from "react";
import { Game, gameReads } from "@/components/game";
import type { CollectedCard } from "@/lib/data/cards";

const card: CollectedCard = {
  id: "loading-proof-card",
  instanceId: "loading-proof-copy",
  name: "Loading proof card",
  rarity: "LR",
  category: "ANIME/MANGA",
  image: "/assets/landing/gojou.webp",
  catalogueImage: "/assets/landing/gojou.webp",
  customImageUrl: null,
  obtainedAt: "2026-10-25T00:00:00Z",
  shiny: false,
  isEvolved: false,
  isFirstOwner: false,
  folderId: null
};
type Controls = {
  calls: Record<string, number>;
  complete: () => void;
  empty: () => void;
  fail: () => void;
  refresh: () => void;
};
declare global {
  interface Window {
    __collectionLoadingProof?: Controls;
  }
}

// Development-only deterministic reads: no sessions, mutations or real game RPCs.
export function CollectionLoadingPreview() {
  const request = useRef<{
    resolve?: (cards: CollectedCard[]) => void;
    reject?: (error: Error) => void;
  }>({});
  const proof = useMemo(() => {
    const calls: Record<string, number> = {};
    function held<T>(name: string): Promise<T> {
      calls[name] = (calls[name] ?? 0) + 1;
      return new Promise(() => {});
    }
    const reads: typeof gameReads = {
      getGameInfo: () => held("info"),
      getPackStatus: () => held("regular"),
      getDecisionPackStatus: () => held("decision"),
      getFolders: () => held("folders"),
      getActiveAuctionCards: () => held("auctions"),
      getUserCollection: () => {
        calls.collection = (calls.collection ?? 0) + 1;
        return new Promise((resolve, reject) => {
          request.current = { resolve, reject };
        });
      }
    };
    const controls: Controls = {
      calls,
      complete: () => request.current.resolve?.([{ ...card }]),
      empty: () => request.current.resolve?.([]),
      fail: () =>
        request.current.reject?.(new Error("Simulated network failure")),
      refresh: () => document.dispatchEvent(new Event("visibilitychange"))
    };
    return { reads, controls };
  }, []);
  useEffect(() => {
    window.__collectionLoadingProof = proof.controls;
    return () => {
      if (window.__collectionLoadingProof === proof.controls)
        delete window.__collectionLoadingProof;
    };
  }, [proof]);
  return <Game view="collection" previewData={proof.reads} />;
}
