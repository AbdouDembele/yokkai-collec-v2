"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useMemo, type ReactNode } from "react";
import type { CollectedCard } from "@/lib/data/cards";
import type { CollectionGroup } from "@/lib/ui/collection-groups";

const CollectionView = dynamic(
  () => import("@/components/collection").then(module => module.CollectionView),
  { loading: () => <CollectionBrowserLoading /> }
);

function CollectionBrowserLoading() {
  const t = useTranslations("packs");
  return (
    <p role="status" className="py-8 text-sm text-ink-2">
      {t("loadingCollection")}
    </p>
  );
}

export function TradeCollectionBrowser({
  cards,
  renderCardControls
}: {
  cards: CollectedCard[];
  renderCardControls: (group: CollectionGroup) => ReactNode;
}) {
  const categories = useMemo(
    () =>
      [...new Set(cards.map(card => card.category))].sort((a, b) =>
        a.localeCompare(b, "en-US")
      ),
    [cards]
  );
  return (
    <CollectionView
      cards={cards}
      categories={categories}
      readOnly
      renderCardControls={renderCardControls}
    />
  );
}
