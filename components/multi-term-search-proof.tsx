"use client";

import { useEffect, useRef, useState } from "react";
import { CollectionView } from "@/components/collection";
import {
  MarketView,
  SearchView,
  type AuctionPresentation
} from "@/components/community-views";
import type { Card, CollectedCard } from "@/lib/data/cards";
import { matchesCardSearch } from "@/lib/ui/card-search";

const cards: Card[] = [
  {
    id: "luffy",
    name: "Monkey D. Luffy",
    category: "Pirate",
    anime: "One Piece",
    rarity: "LR",
    image: "/assets/booster-pack.png"
  },
  {
    id: "zoro",
    name: "Roronoa Zoro",
    category: "Pirate",
    anime: "One Piece",
    rarity: "SSR",
    image: "/assets/booster-pack.png"
  },
  {
    id: "naruto",
    name: "Naruto Uzumaki",
    category: "Ninja",
    anime: "Naruto",
    rarity: "SR",
    image: "/assets/booster-pack.png"
  }
];
const collected: CollectedCard[] = cards.map((card, index) => ({
  ...card,
  instanceId: `instance-${index}`,
  obtainedAt: `2026-09-${20 + index}T10:00:00Z`,
  shiny: false,
  isEvolved: false,
  isFirstOwner: false,
  folderId: null,
  catalogueImage: card.image,
  customImageUrl: null
}));
const active: AuctionPresentation[] = cards.map((card, index) => ({
  id: `auction-${index}`,
  card,
  amount: 100 + index * 50,
  remaining: "00:10:00",
  remainingSeconds: 600 + index,
  seller: "Kitsune",
  bids: index
}));
const lists = { active, mine: [], won: [], sold: [] };
const loadPage: NonNullable<
  Parameters<typeof SearchView>[0]
>["loadPage"] = async (options = {}) => {
  const { query = "", category = "", rarity = "" } = options;
  const found = cards.filter(
    card =>
      matchesCardSearch(query, [card.name, card.anime]) &&
      (!category || card.category === category) &&
      (!rarity || card.rarity === rarity)
  );
  return { cards: found, total: found.length };
};
const wait = (ms: number) =>
  new Promise(resolve => window.setTimeout(resolve, ms));

export function MultiTermSearchProof() {
  const [checks, setChecks] = useState<
    { label: string; ok: boolean; detail?: string }[]
  >([]);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const done: { label: string; ok: boolean; detail?: string }[] = [];
    const check = (label: string, ok: boolean, detail?: string) => {
      done.push({ label, ok, detail });
      setChecks([...done]);
    };
    const type = async (selector: string, value: string, delay = 100) => {
      const field = document.querySelector<HTMLInputElement>(selector)!;
      field.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set?.call(field, value);
      field.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: value
        })
      );
      await wait(delay);
    };
    const names = (selector: string) =>
      [...document.querySelectorAll<HTMLElement>(selector)].map(
        item => item.getAttribute("aria-label") ?? ""
      );
    const oneLuffy = (selector: string) => {
      const shown = names(selector);
      return {
        ok: shown.length === 1 && shown[0].includes("Luffy"),
        detail: shown.join(" | ")
      };
    };
    const run = async () => {
      await wait(400);
      await type("#collection-query", "one piece luffy");
      let result = oneLuffy('[data-proof="collection"] .yk-collection-card');
      check("Collection · franchise puis nom", result.ok, result.detail);
      await type("#collection-query", "LUFFY ONE PIECE");
      result = oneLuffy('[data-proof="collection"] .yk-collection-card');
      check("Collection · ordre inversé et casse", result.ok, result.detail);
      await type("#catalogue-query", "one piece luffy", 400);
      result = oneLuffy('[data-proof="catalogue"] .yk-catalogue-card');
      check("Catalogue · franchise puis nom", result.ok, result.detail);
      await type("#catalogue-query", "LUFFY ONE PIECE", 400);
      result = oneLuffy('[data-proof="catalogue"] .yk-catalogue-card');
      check("Catalogue · ordre inversé et casse", result.ok, result.detail);
      await type("#market-query", "one piece luffy");
      result = oneLuffy('[data-proof="market"] .yk-market-tile-link');
      check("Marché · franchise puis nom", result.ok, result.detail);
      await type("#market-query", "LUFFY ONE PIECE");
      result = oneLuffy('[data-proof="market"] .yk-market-tile-link');
      check("Marché · ordre inversé et casse", result.ok, result.detail);
    };
    void run();
  }, []);
  const failed = checks.some(item => !item.ok);
  const passed = checks.length === 6 && !failed;
  return (
    <div className="flex flex-col gap-10">
      <div
        className={`yk-feedback ${passed ? "yk-feedback-success" : ""}`}
        data-proof-result={passed ? "passed" : failed ? "failed" : "running"}
      >
        <strong>
          {passed
            ? "Preuve d’intégration réussie"
            : failed
              ? "Preuve en échec"
              : "Test des recherches en cours…"}
        </strong>
        <span>{checks.filter(item => item.ok).length}/6 vérifications</span>
      </div>
      <ul id="multi-term-search-proof-log">
        {checks.map(item => (
          <li key={item.label} data-ok={item.ok}>
            {item.ok ? "✓" : "✗"} {item.label}
            {item.ok ? "" : ` — obtenu : ${item.detail}`}
          </li>
        ))}
      </ul>
      <section data-proof="collection">
        <h2 className="yk-section-title mb-4">Collection</h2>
        <CollectionView
          cards={collected}
          categories={["Pirate", "Ninja"]}
          readOnly
        />
      </section>
      <section data-proof="catalogue">
        <h2 className="yk-section-title mb-4">Catalogue</h2>
        <SearchView
          loadPage={loadPage}
          previewCategories={["Pirate", "Ninja"]}
        />
      </section>
      <section data-proof="market">
        <h2 className="yk-section-title mb-4">Marché</h2>
        <MarketView lists={lists} activeSales="0" />
      </section>
    </div>
  );
}
