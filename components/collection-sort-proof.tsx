"use client";

import { useEffect, useRef, useState } from "react";
import { CollectionView } from "@/components/collection";
import type { CollectedCard, Rarity } from "@/lib/data/cards";
import { COLLECTION_SORT_STORAGE_KEY } from "@/hooks/use-collection-sort";

const card = (
  instanceId: string,
  name: string,
  rarity: Rarity,
  shiny: boolean,
  obtainedAt: string
): CollectedCard => ({
  id: `card-${instanceId}`,
  instanceId,
  name,
  category: "Yokai",
  anime: "Preview",
  rarity,
  shiny,
  obtainedAt,
  image: "/assets/booster-pack.png",
  catalogueImage: "/assets/booster-pack.png",
  customImageUrl: null,
  isEvolved: false,
  isFirstOwner: false,
  folderId: null
});
// Six cards with hand-written expected orders, plus 24 fillers so the default 24-card page has a second page.
const keyCards = [
  card("a", "Écho", "SR", false, "2026-03-01T10:00:00Z"),
  card("b", "akira", "LR", false, "2026-01-15T10:00:00Z"),
  card("c", "Zorro", "SSR", true, "2026-05-10T10:00:00Z"),
  card("d", "Mochi", "SSR", false, "2026-05-10T10:00:00Z"),
  card("e", "Bashō", "C", false, "2026-07-01T10:00:00Z"),
  card("f", "Kitsune", "R", true, "2025-12-31T10:00:00Z")
];
const fillers = Array.from({ length: 24 }, (_, index) =>
  card(
    `filler-${index}`,
    `Remplissage ${String(index + 1).padStart(2, "0")}`,
    "C",
    false,
    "2024-06-01T10:00:00Z"
  )
);
const keyNames = new Set(keyCards.map(item => item.name));
const expected = {
  rarity: ["akira", "Zorro", "Mochi", "Écho", "Kitsune", "Bashō"],
  recent: ["Bashō", "Zorro", "Mochi", "Écho", "akira", "Kitsune"],
  oldest: ["Kitsune", "akira", "Écho", "Zorro", "Mochi", "Bashō"],
  name: ["akira", "Bashō", "Écho", "Kitsune", "Mochi", "Zorro"]
};
const RELOAD_FLAG = "collection-sort-proof:phase-one";
const TOTAL_CHECKS = 12;
const wait = (ms: number) =>
  new Promise(resolve => window.setTimeout(resolve, ms));

// Mounts the real CollectionView and drives its sort <select>, pagination, selection mode and filters in the browser.
export function CollectionSortProof() {
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
    const sortSelect = () =>
      document.querySelector<HTMLSelectElement>(".yk-sort-control select")!;
    const choose = async (value: string) => {
      const select = sortSelect();
      select.focus();
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(80);
    };
    const shownNames = () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(".yk-collection-card")
      ].map(button =>
        (button.getAttribute("aria-label") ?? "")
          .replace(/^(Voir|Sélectionner) /, "")
          .replace(/, (C|R|SR|SSR|LR)$/, "")
      );
    const keyOrder = () => shownNames().filter(name => keyNames.has(name));
    const same = (actual: string[], wanted: string[]) =>
      actual.join(" | ") === wanted.join(" | ");
    const currentPage = () =>
      document.querySelector(
        'nav[aria-label="Pagination de la collection"] [aria-current="page"]'
      )?.textContent;
    const selectedCount = () =>
      document.querySelector(".yk-selection-bar strong")?.textContent;
    const pageSize = async (size: string) => {
      const select = [
        ...document.querySelectorAll<HTMLSelectElement>(
          ".yk-collection-pagination select"
        )
      ][0];
      select.value = size;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(80);
    };
    const run = async () => {
      await wait(150);
      const phaseOne = sessionStorage.getItem(RELOAD_FLAG);
      if (phaseOne) {
        sessionStorage.removeItem(RELOAD_FLAG);
        done.push(...JSON.parse(phaseOne));
        setChecks([...done]);
        await pageSize("48");
        check(
          "Après rechargement, le tri mémorisé est restauré",
          sortSelect().value === "name" &&
            document.querySelector(".yk-sort-control strong")?.textContent ===
              "Nom (A → Z)",
          sortSelect().value
        );
        check(
          "Après rechargement, les cartes suivent le tri mémorisé",
          same(keyOrder(), expected.name),
          keyOrder().join(", ")
        );
        localStorage.removeItem(COLLECTION_SORT_STORAGE_KEY);
        return;
      }
      check(
        "Tri par défaut : Rareté",
        sortSelect().value === "rarity" &&
          document.querySelector(".yk-sort-control strong")?.textContent ===
            "Rareté",
        sortSelect().value
      );
      await pageSize("48");
      check(
        "Rareté : LR → C, Shiny d’abord",
        same(keyOrder(), expected.rarity),
        keyOrder().join(", ")
      );
      for (const value of ["recent", "oldest", "name", "rarity"] as const) {
        await choose(value);
        check(
          `Option « ${sortSelect().selectedOptions[0]?.textContent} »`,
          same(keyOrder(), expected[value]),
          keyOrder().join(", ")
        );
      }
      await pageSize("24");
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Page 2"]')
        ?.click();
      await wait(80);
      const onPageTwo = currentPage() === "2";
      await choose("recent");
      check(
        "Changer le tri ramène à la page 1",
        onPageTwo && currentPage() === "1",
        `avant ${onPageTwo ? "2" : "?"}, après ${currentPage()}`
      );
      document.querySelector<HTMLButtonElement>(".yk-selection-mode")?.click();
      await wait(80);
      const [first, second] = document.querySelectorAll<HTMLButtonElement>(
        ".yk-collection-card"
      );
      first.click();
      second.click();
      await wait(80);
      const before = selectedCount();
      await choose("oldest");
      check(
        "La sélection multiple est conservée",
        before === "2" && selectedCount() === "2",
        `avant ${before}, après ${selectedCount()}`
      );
      document.querySelector<HTMLButtonElement>(".yk-selection-mode")?.click();
      await wait(80);
      const ssr = [
        ...document.querySelectorAll<HTMLButtonElement>(".yk-filter-option")
      ].find(
        button =>
          button.querySelector("span[class^='text-rarity']")?.textContent ===
          "SSR"
      );
      ssr?.click();
      await wait(80);
      await choose("name");
      check(
        "Tri appliqué après les filtres (SSR, par nom)",
        same(shownNames(), ["Mochi", "Zorro"]),
        shownNames().join(", ")
      );
      check(
        "Le choix est mémorisé dans ce navigateur",
        localStorage.getItem(COLLECTION_SORT_STORAGE_KEY) === "name",
        String(localStorage.getItem(COLLECTION_SORT_STORAGE_KEY))
      );
      sessionStorage.setItem(RELOAD_FLAG, JSON.stringify(done));
      window.location.reload();
    };
    void run();
  }, []);
  const failed = checks.some(item => !item.ok);
  const passed = checks.length === TOTAL_CHECKS && !failed;
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
              : "Test du tri en cours…"}
        </strong>
        <span>
          {checks.filter(item => item.ok).length}/{TOTAL_CHECKS} vérifications
        </span>
      </div>
      <ul id="collection-sort-proof-log">
        {checks.map(item => (
          <li key={item.label} data-ok={item.ok}>
            {item.ok ? "✓" : "✗"} {item.label}
            {item.ok ? "" : ` — obtenu : ${item.detail}`}
          </li>
        ))}
      </ul>
      <CollectionView
        cards={[...keyCards, ...fillers]}
        categories={["Yokai"]}
        onDiscardMany={async () => {}}
      />
    </div>
  );
}
