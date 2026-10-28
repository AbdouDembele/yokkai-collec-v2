"use client";

import { useEffect, useRef, useState } from "react";
import {
  MarketView,
  type AuctionPresentation
} from "@/components/community-views";

const auctions: AuctionPresentation[] = [
  {
    id: "kitsune",
    card: {
      id: "c1",
      name: "Kuro Kitsune",
      category: "Yokai",
      anime: "Spirit Realm",
      rarity: "LR",
      image: "/assets/booster-pack.png"
    },
    amount: 900,
    remaining: "00:20:00",
    remainingSeconds: 1200,
    seller: "Mochi",
    bids: 3
  },
  {
    id: "dragon",
    card: {
      id: "c2",
      name: "Aoi Dragon",
      category: "Yokai",
      anime: "Neo Tokyo",
      rarity: "SR",
      image: "/assets/booster-pack.png"
    },
    amount: 120,
    remaining: "00:03:00",
    remainingSeconds: 180,
    seller: "Oni",
    bids: 1
  },
  {
    id: "ren",
    card: {
      id: "c3",
      name: "Ren Cyber",
      category: "Yokai",
      anime: "Neo Tokyo",
      rarity: "SSR",
      image: "/assets/booster-pack.png"
    },
    amount: 450,
    remaining: "01:00:00",
    remainingSeconds: 3600,
    seller: "Yuki",
    bids: 2
  },
  {
    id: "yuki",
    card: {
      id: "c4",
      name: "Yuki Frost",
      category: "Yokai",
      anime: "Winter Saga",
      rarity: "SR",
      image: "/assets/booster-pack.png"
    },
    amount: 300,
    remaining: "00:10:00",
    remainingSeconds: 600,
    seller: "Taro",
    bids: 4
  }
];
const lists = { active: auctions, mine: [], won: [], sold: [] };
const wait = (ms: number) =>
  new Promise(resolve => window.setTimeout(resolve, ms));

// Mounts the real MarketView and drives its search, rarity and sort controls in the browser.
export function MarketSearchProof() {
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
    const input = () =>
      document.querySelector<HTMLInputElement>("#market-query")!;
    const shown = () =>
      [
        ...document.querySelectorAll<HTMLAnchorElement>(".yk-market-tile-link")
      ].map(link => link.getAttribute("aria-label") ?? "");
    const type = async (value: string) => {
      const field = input();
      field.focus();
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      setter?.call(field, value);
      field.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: value
        })
      );
      await wait(80);
    };
    const filterButton = (section: string, label: string) => {
      const details = [
        ...document.querySelectorAll<HTMLDetailsElement>(
          "#market-filters .yk-filter-section"
        )
      ].find(item =>
        item.querySelector("summary")?.textContent?.includes(section)
      );
      return [
        ...(details?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      ].find(button => button.textContent?.trim() === label);
    };
    const rarity = async (label: string) => {
      filterButton("Rareté", label)?.click();
      await wait(80);
    };
    const sort = async (value: string) => {
      const label = {
        end: "Fin imminente",
        asc: "Prix croissant",
        desc: "Prix décroissant"
      }[value as "end" | "asc" | "desc"];
      filterButton("Trier par", label)?.click();
      await wait(80);
    };
    const run = async () => {
      await wait(150);
      await type("kitsune");
      check(
        "Recherche en temps réel sur le nom",
        shown().length === 1 && shown()[0].includes("Kuro Kitsune"),
        shown().join(" | ")
      );
      await type("neo tokyo");
      check(
        "Recherche sur la franchise",
        shown().length === 2 &&
          shown().every(
            item => item.includes("Aoi Dragon") || item.includes("Ren Cyber")
          ),
        shown().join(" | ")
      );
      await rarity("SR");
      check(
        "Recherche et rareté se combinent",
        shown().length === 1 && shown()[0].includes("Aoi Dragon"),
        shown().join(" | ")
      );
      await sort("desc");
      check(
        "Le tri par prix reste actif avec la recherche",
        filterButton("Trier par", "Prix décroissant")?.getAttribute(
          "aria-pressed"
        ) === "true" && shown()[0]?.includes("Aoi Dragon"),
        shown().join(" | ")
      );
      await rarity("Toutes");
      await type("winter");
      await sort("end");
      check(
        "Le tri fin imminente reste actif avec la recherche",
        shown().length === 1 && shown()[0].includes("Yuki Frost"),
        shown().join(" | ")
      );
      await type("introuvable");
      check(
        "Une recherche sans résultat affiche l’état vide",
        shown().length === 0 &&
          !!document
            .querySelector(".yk-empty-state")
            ?.textContent?.includes("Aucune enchère ne correspond"),
        document.querySelector(".yk-empty-state")?.textContent ?? ""
      );
    };
    void run();
  }, []);
  const failed = checks.some(item => !item.ok);
  const passed = checks.length === 6 && !failed;
  return (
    <div className="flex flex-col gap-6">
      <div
        className={`yk-feedback ${passed ? "yk-feedback-success" : ""}`}
        data-proof-result={passed ? "passed" : failed ? "failed" : "running"}
      >
        <strong>
          {passed
            ? "Preuve d’intégration réussie"
            : failed
              ? "Preuve en échec"
              : "Test de la recherche en cours…"}
        </strong>
        <span>{checks.filter(item => item.ok).length}/6 vérifications</span>
      </div>
      <ul id="market-search-proof-log">
        {checks.map(item => (
          <li key={item.label} data-ok={item.ok}>
            {item.ok ? "✓" : "✗"} {item.label}
            {item.ok ? "" : ` — obtenu : ${item.detail}`}
          </li>
        ))}
      </ul>
      <MarketView lists={lists} activeSales="0" />
    </div>
  );
}
